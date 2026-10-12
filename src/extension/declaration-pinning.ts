import { DELEGATION_LEVELS, delegationLevelGuideline } from "../policy/delegation-level.ts";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

/** A recorded tool declaration, as pi persists it in a transcript system message. */
interface RecordedTool {
  name: string;
  description: string;
  parameters?: unknown;
  constrainedSampling?: false | Record<string, unknown>;
}

/**
 * Registers a tool and keeps its declaration matching what this session's transcript
 * already records.
 *
 * Pi sends tool declarations in system messages and diffs the current state against the
 * replayed transcript state every turn: the `tools` and `rules` sections plus the tool
 * declarations themselves. Any difference emits a fresh system message, which busts the
 * provider prompt cache — and on providers without mid-conversation system messages the
 * new text only lands at the end of the next user message. So a resumed session whose
 * tool text drifted (different delegation level, a reworded description, `bg_wait`'s
 * child variant) keeps re-declaring and never hits its cache.
 *
 * Pi's own pinning option is global, and the global path forces the whole prompt into
 * one cacheable block. This helper gives the same protection to just this extension's
 * tools: on `session_start` and `session_tree` it reads the declarations the resumed
 * transcript recorded and re-registers with those values, so pi's diff comes out empty.
 *
 * Only what pi diffs is pinned: the `description` inside the tool declaration, and the
 * `promptSnippet` / `promptGuidelines` that render into the `tools` and `rules`
 * sections. Behaviour (`execute`, renderers, `parameters`) keeps coming from the fresh
 * definition, so a real schema change still reaches the model.
 */
export function registerPinnedTool(pi: ExtensionAPI, tool: ToolDefinition<any, any>): void {
  pi.registerTool(tool);
  // SAFETY: an API without event hooks (a bare registrar) still gets the tool. Pinning
  // only matters for a resumed session, which is exactly what these hooks observe.
  if (typeof pi.on !== "function") return;

  // Both events fire on a resumed session; remember what was already restored so the
  // second event does not register the same values twice.
  let restored: string | undefined;
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    const pinned = pinnedTool(ctx, tool);
    if (!pinned) return;
    const signature = signatureOf(pinned);
    if (signature === restored) return;
    restored = signature;
    pi.registerTool(pinned);
  };

  pi.on("session_start", restore);
  pi.on("session_tree", restore);
}

interface RecordedDeclaration {
  /** The declaration the transcript records for this name. */
  tool: RecordedTool;
  /** This tool's line in the rendered `tools` section. */
  snippet?: string;
  /** The rendered `rules` section. */
  rules?: string;
}

/** Merge the recorded declaration over the fresh definition, or skip when they agree. */
function pinnedTool(
  ctx: ExtensionContext,
  fresh: ToolDefinition<any, any>,
): ToolDefinition<any, any> | undefined {
  const recorded = recordedDeclaration(ctx, fresh.name);
  if (!recorded) return undefined; // Nothing recorded yet: the fresh definition is current.

  const snippet = recorded.snippet ?? fresh.promptSnippet;
  const guidelines = recordedGuidelines(recorded.rules, fresh.promptGuidelines);
  if (rendersSame(fresh, recorded, snippet, guidelines)) return undefined;

  return {
    ...fresh,
    description: recorded.tool.description,
    ...(snippet !== undefined ? { promptSnippet: snippet } : {}),
    promptGuidelines: guidelines.length > 0 ? guidelines : fresh.promptGuidelines,
  };
}

/** Whether the fresh definition already renders exactly what the transcript records. */
function rendersSame(
  fresh: ToolDefinition<any, any>,
  recorded: RecordedDeclaration,
  snippet: string | undefined,
  guidelines: string[],
): boolean {
  if (!declarationsMatch(fresh, recorded.tool)) return false;
  return (
    oneLine(fresh.promptSnippet) === oneLine(snippet) &&
    sameLines(normalizeGuidelines(fresh.promptGuidelines), guidelines)
  );
}

/**
 * Read the declarations this transcript currently records.
 *
 * Pi diffs against the projected context, so read the same projection: compacted
 * sessions drop the entries a compaction summary replaced, and a stale declaration that
 * no longer reaches the model must not be pinned back in. `buildContextEntries` is on
 * the read-only session manager; `getEntries` covers a context exposing nothing more.
 */
function recordedDeclaration(
  ctx: ExtensionContext,
  name: string,
): RecordedDeclaration | undefined {
  // SAFETY: buildContextEntries is on the real SessionManager and on the read-only
  // projection in current pi; older or hand-built contexts fall back to raw entries,
  // and a context with neither simply has nothing recorded to match.
  const manager = ctx.sessionManager as Record<string, unknown>;
  const entries = readEntries(manager.buildContextEntries) ?? readEntries(manager.getEntries);
  if (!entries) return undefined;

  const systemMessages = collectSystemMessages(entries);
  const declaration = replayToolDeclarations(systemMessages).find((tool) => tool.name === name);
  if (!declaration) return undefined; // Not declared yet: the fresh definition is current.

  const sections = replaySections(systemMessages);
  return {
    tool: declaration,
    snippet: sectionLine(sections.tools, name),
    rules: sections.rules ?? undefined,
  };
}

/** Call a session-manager entry reader, ignoring one this context does not provide. */
function readEntries(read: unknown): SessionEntry[] | undefined {
  if (typeof read !== "function") return undefined;
  const entries = (read as () => SessionEntry[])();
  return Array.isArray(entries) ? entries : undefined;
}

/**
 * The system messages a projection carries, oldest first.
 *
 * Only system messages hold declarations and prompt sections. A compaction replaces the
 * older messages, and pi carries the current system message on the compaction entry, so
 * read it from there.
 */
function collectSystemMessages(entries: readonly SessionEntry[]): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      const message = entry.message as unknown as Record<string, unknown>;
      if (message?.role === "system") messages.push(message);
    } else if (entry.type === "compaction") {
      // SAFETY: current pi stores the carried system message on the compaction entry.
      const carried = (entry as { systemMessage?: Record<string, unknown> }).systemMessage;
      if (carried?.role === "system") messages.push(carried);
    }
  }
  return messages;
}

/** Replay `toolsRemoved` then `toolsAdded` in order, the way pi resolves current tools. */
function replayToolDeclarations(messages: readonly Record<string, unknown>[]): RecordedTool[] {
  const tools = new Map<string, RecordedTool>();
  for (const message of messages) {
    for (const removed of asArray(message.toolsRemoved)) {
      const name = (removed as { name?: string }).name;
      if (name) tools.delete(name);
    }
    for (const added of asArray(message.toolsAdded)) {
      const tool = added as RecordedTool;
      if (tool?.name) tools.set(tool.name, tool);
    }
  }
  return [...tools.values()];
}

/** Patch each named section in order; `null` removes one. */
function replaySections(messages: readonly Record<string, unknown>[]): Record<string, string> {
  const sections = new Map<string, string | null>();
  for (const message of messages) {
    const patched = (message.sections ?? {}) as Record<string, string | null>;
    for (const [name, value] of Object.entries(patched)) sections.set(name, value);
  }
  const current: Record<string, string> = {};
  for (const [name, value] of sections) if (value != null) current[name] = value;
  return current;
}

/** Pull this tool's `- name: snippet` line out of the rendered `tools` section. */
function sectionLine(tools: string | undefined, name: string): string | undefined {
  if (!tools) return undefined;
  const prefix = `- ${name}: `;
  for (const line of tools.split("\n")) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return undefined;
}

/**
 * Recover this tool's rule bullets from the rendered `rules` section.
 *
 * Pi renders rules as one flat bullet list and does not attribute lines to the tool that
 * provided them, so match the recorded list against the bullets this tool can
 * legitimately produce: its own fresh bullets plus the delegation-level sentences the
 * fork's own tool contributes (a closed set). Pi's fixed trailing rules are not
 * candidates, so the filter drops them and pi adds them back on the next render. When
 * the recorded section holds none of the candidates (older session, rewritten rules),
 * keep the fresh order.
 */
function recordedGuidelines(rules: string | undefined, fresh: string[] | undefined): string[] {
  const bullets = normalizeGuidelines(fresh);
  if (bullets.length === 0) return bullets;
  const candidates = [
    ...bullets,
    ...DELEGATION_LEVELS.map(delegationLevelGuideline).filter((line) => !bullets.includes(line)),
  ];
  if (!rules) return bullets;

  const kept: string[] = [];
  for (const line of rules.split("\n")) {
    const text = line.trim().replace(/^-\s*/, "");
    if (!text || !candidates.includes(text)) continue;
    if (!kept.includes(text)) kept.push(text);
  }
  return kept.length > 0 ? kept : bullets;
}

/** Match pi's declaration comparison: name, description, parameters, constrained sampling. */
function declarationsMatch(fresh: ToolDefinition<any, any>, recorded: RecordedTool): boolean {
  return serialize(fresh) === serialize(recorded);
}

function serialize(tool: RecordedTool): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters ?? null,
    constrainedSampling: tool.constrainedSampling ?? null,
  });
}

function signatureOf(tool: ToolDefinition<any, any>): string {
  return JSON.stringify([tool.description, tool.promptSnippet ?? null, tool.promptGuidelines ?? null]);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Pi collapses a snippet to one line when it stores it; match that before comparing. */
function oneLine(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeGuidelines(guidelines: string[] | undefined): string[] {
  if (!guidelines) return [];
  const unique = new Set<string>();
  for (const guideline of guidelines) {
    const text = guideline.trim();
    if (text) unique.add(text);
  }
  return Array.from(unique);
}

function sameLines(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((line, i) => line === right[i]);
}
