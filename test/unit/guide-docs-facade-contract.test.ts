/**
 * Docs ↔ facade contract (M4).
 *
 * The model loads these files at runtime — the guide topics through
 * `action: "guide"`, the skills through the skill loader, the prompt templates
 * through slash commands. A doc that teaches a verb or param the tool schema
 * rejects is an instruction to do the impossible, and that drift survived the
 * whole facade cutover because nothing compared the prose to the schemas.
 *
 * Measured before the rules landed: 37 control examples named `subagent` (whose
 * schema requires `task`, so `{ action: "status" }` could not run at all), 40 more
 * named actions the control enum rejects (`children.list`, `worktree.discard`,
 * `inspector.*`, `doctor`, `refine*`, agent CRUD), the parameter reference
 * described the removed 81-param tool, and 18 delegation/workflow examples still
 * used pre-facade names such as `workflowScript`.
 *
 * The rules below derive the real surface from the schemas, so they cannot drift
 * from it, and every one is mutation-verified.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SUBAGENT_CONTROL_ACTIONS, SubagentControlParams, SubagentDelegationParams, SubagentWorkflowParams } from "../../src/extension/schemas.ts";
import { normalizeControlParams } from "../../src/extension/facade.ts";
import { SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";

const servedFiles = [
	"README.md",
	...SUBAGENT_GUIDE_TOPICS.filter((topic) => topic !== "overview").map((topic) => `docs/${topic}.md`),
	"skills/pi-subagents/SKILL.md",
	"skills/council-mode/SKILL.md",
	"prompts/council.md",
	...readdirSync("skills/pi-subagents/references").filter((name) => name.endsWith(".md")).map((name) => `skills/pi-subagents/references/${name}`),
];

const CONTROL_VERBS = new Set<string>(SUBAGENT_CONTROL_ACTIONS);
const facadeParams = (schema: unknown): Set<string> => new Set(Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {}));
const DELEGATION_PARAMS = facadeParams(SubagentDelegationParams);
const WORKFLOW_PARAMS = facadeParams(SubagentWorkflowParams);
const MODEL_FACING_PARAMS = new Set([...DELEGATION_PARAMS, ...WORKFLOW_PARAMS, ...facadeParams(SubagentControlParams)]);

/** Word values that share a shape with shorthand keys (`async: true,`) and are never keys. */
const BARE_WORD_VALUES = new Set(["true", "false", "null", "undefined"]);

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf-8");

/**
 * Control verbs whose required input cannot cross the tool boundary, so a
 * tool-call example for one always fails.
 *
 * D10 shrank this list to empty: `agent` now rides on control, so `get` and
 * `models <agent>` are drivable, and `mission` rides on control for
 * `mission.create`. `validate` left the enum together with its script input —
 * the static lint survives on the internal contract (`preflight`, RPC), not on
 * the model surface. A new verb is only allowed with its input on this tool.
 */
const UNREACHABLE_VERBS = new Set<string>([]);

/**
 * Params plan.md's disposition table removes from the model surface or moves to
 * config / internal contracts. An example that passes one is teaching a
 * capability the model does not have.
 *
 * `agent` and `mission` left this list with D10: both are on the control facade
 * and the executor reads them (`agent-management.ts` get/models, `missions/actions.ts`).
 */
const NEVER_MODEL_PARAMS = new Set([
	"view", "lines", "mode", "index", "childId", "handoffPath", "repo",
	"additional", "share", "sessionDir", "steeringRecovery", "agentScope", "capabilities",
]);

/** Every `action: "verb"` mention, including bare `{ action: "x" }` examples. */
function mentionedVerbs(): { file: string; line: number; verb: string }[] {
	const found: { file: string; line: number; verb: string }[] = [];
	for (const file of servedFiles) {
		read(file)
			.split(/\r?\n/)
			.forEach((text, index) => {
				for (const match of text.matchAll(/action:\s*\\?"([a-zA-Z][a-zA-Z.0-9-]*)\\?"/g)) {
					found.push({ file, line: index + 1, verb: match[1]! });
				}
			});
	}
	return found;
}

interface CallExample {
	file: string;
	line: number;
	tool: string;
	/** The `action` value, when the literal carries one. */
	verb: string | undefined;
	/** Keys at depth 1 of the argument literal (string bodies and nesting skipped). */
	keys: string[];
	/** True when the literal sits inside a ``` fence (a copyable example). */
	fenced: boolean;
}

/**
 * Parse every `{...}` argument literal — tool-prefixed (`subagent_control({...})`)
 * and bare (`{ action: "guide", topic: "..." }`, which the model copies just as
 * readily) — with brace matching that skips string bodies. Bare literals carry no
 * tool, so only the rules that do not depend on a tool name apply to them; that
 * hole is exactly how `{ action: "guide", topic: ... }` and
 * `{ action: "list", capabilities: true }` survived earlier sweeps.
 *
 * `fenced` marks literals inside ``` fences — the copyable ones. Inline prose
 * (`subagent({...})` in a sentence) is real text but not an example the model
 * pastes, so shape rules that prose could not satisfy police fences only.
 */
function allCallLiterals(): CallExample[] {
	const found: CallExample[] = [];
	for (const file of servedFiles) {
		const text = read(file);
		let consumedTo = -1;
		for (const match of text.matchAll(/\{/g)) {
			if (match.index < consumedTo) continue;
			const toolMatch = /(subagent_control|subagent_workflow|subagent)\(\s*$/.exec(text.slice(Math.max(0, match.index - 32), match.index));
			let i = match.index;
			let depth = 0;
			let end = -1;
			const keys: string[] = [];
			for (; i < text.length; i++) {
				const char = text[i];
				if (char === '"' || char === "'" || char === "`") {
					const quote = char;
					i++;
					while (i < text.length && text[i] !== quote) {
						if (text[i] === "\\") i++;
						i++;
					}
					continue;
				}
				if (char === "{") {
					depth++;
				} else if (char === "}") {
					depth--;
					if (depth === 0) {
						end = i;
						break;
					}
				}
				if (depth === 1) {
					// Lookahead, so a shorthand key or the closing brace is never consumed as
					// part of the key text.
					const key = /^([a-zA-Z]+)(?=\s*[:,}]|$)/.exec(text.slice(i));
					if (key) {
						// Bare words after a colon are values (`async: true,`), not keys.
						if (!BARE_WORD_VALUES.has(key[1]!)) keys.push(key[1]!);
						i += key[0].length - 1;
					}
				}
			}
			if (end < 0) continue;
			const body = text.slice(match.index, end + 1);
			const verb = /action:\s*\\?"([a-zA-Z][a-zA-Z.0-9-]*)\\?"/.exec(body)?.[1];
			found.push({
				file,
				line: text.slice(0, match.index).split("\n").length,
				tool: toolMatch ? toolMatch[1]! : "(bare)",
				verb,
				keys: [...new Set(keys)],
				fenced: ((text.slice(0, match.index).match(/^```/gm) ?? []).length % 2) === 1,
			});
			consumedTo = end + 1;
		}
	}
	return found;
}

function toolCallExamples(): CallExample[] {
	return allCallLiterals().filter((example) => example.verb !== undefined);
}

/** Examples that name a control verb, i.e. the ones the control rules police. */
const controlExamples = (): CallExample[] => toolCallExamples().filter((example) => example.verb !== undefined && CONTROL_VERBS.has(example.verb));

describe("served docs match the facade contract", () => {
	it("teaches only control verbs the control schema accepts", () => {
		const offenders = mentionedVerbs().filter((entry) => !CONTROL_VERBS.has(entry.verb));
		assert.deepEqual(
			offenders.map((e) => `${e.file}:${e.line} action: "${e.verb}"`),
			[],
			"served docs advertise actions the control schema rejects",
		);
	});

	it("routes control verbs to the subagent_control tool", () => {
		const offenders = controlExamples().filter((example) => example.tool !== "(bare)" && example.tool !== "subagent_control");
		assert.deepEqual(
			offenders.map((e) => `${e.file}:${e.line} ${e.tool}({ action: "${e.verb}" })`),
			[],
			"control verbs must be shown on subagent_control; the delegation tool requires task and rejects them",
		);
	});

	it("never shows a control example for a verb that cannot receive its input", () => {
		const offenders = controlExamples().filter((example) => UNREACHABLE_VERBS.has(example.verb!));
		assert.deepEqual(
			offenders.map((e) => `${e.file}:${e.line} ${e.tool}({ action: "${e.verb}" })`),
			[],
			"these verbs need a param the model surface does not carry, so teaching them guarantees a failed call",
		);
	});

	it("keeps every control verb drivable, with no orphan inputs", () => {
		// Rule P1 (plan.md): a verb belongs on the surface only if its required input
		// can arrive on that surface. D10 removed `validate` for exactly this reason,
		// so the test fails again if the verb returns without its script params — or
		// if the schema re-shares a script param with control.
		const controlKeys = facadeParams(SubagentControlParams);
		for (const forbidden of ["source", "workflowScript", "workflowScriptPath"]) {
			assert.ok(!controlKeys.has(forbidden), `control must not carry ${forbidden}; the workflow facade owns the script body`);
		}
		const controlActions = (SubagentControlParams as { properties: { action: { enum?: string[] } } }).properties.action.enum ?? [];
		assert.ok(!controlActions.includes("validate"), "validate needs a script body the control tool cannot carry");
		assert.ok(controlKeys.has("agent"), "get/models need agent on the control facade");
		assert.ok(controlKeys.has("mission"), "mission.create needs mission on the control facade");
		// Every verb on the enum must be reachable through the facade normalizer.
		for (const action of controlActions) {
			assert.equal(normalizeControlParams({ action: action as never }).action, action, `${action} must survive facade normalization`);
		}
	});

	it("keeps model and provider off every model-facing facade", () => {
		// Which model and provider a child runs on is operator policy: it comes from
		// the agent definition and extension settings (subagents.defaultModel,
		// subagents.agentOverrides), never from a call. The surface only reads the
		// resolution back via `models <agent>`.
		const byTool: Record<string, Set<string>> = {
			subagent: DELEGATION_PARAMS,
			subagent_workflow: WORKFLOW_PARAMS,
			subagent_control: facadeParams(SubagentControlParams),
		};
		for (const [tool, keys] of Object.entries(byTool)) {
			for (const forbidden of ["model", "provider", "thinking", "fast"]) {
				assert.ok(!keys.has(forbidden), `${tool} must not accept ${forbidden}; extension settings own it`);
			}
		}
	});

	it("does not pass control params the model surface does not carry", () => {
		const forwarded = new Set(Object.keys(normalizeControlParams({ id: "x", action: "status", message: "m" })).filter((key) => key !== undefined));
		const offenders: string[] = [];
		for (const example of controlExamples()) {
			if (UNREACHABLE_VERBS.has(example.verb!)) continue;
			for (const key of example.keys) {
				if (forwarded.has(key)) continue;
				const why = NEVER_MODEL_PARAMS.has(key) ? "removed, config-owned, or internal per plan.md" : "never reaches the executor";
				offenders.push(`${example.file}:${example.verb}+${key} (${why})`);
			}
		}
		assert.deepEqual([...new Set(offenders)].sort(), [], "control examples pass params the model surface does not carry");
	});

	it("names no surface-owned param in the call reference the model reads", () => {
		// README.md and docs/tool-reference.md teach what the model can pass, so a
		// param named there in inline code reads as a call input. NEVER_MODEL_PARAMS
		// live only on the script (`runs.*` options, `param?:` type syntax) or the
		// slash/RPC surfaces, which their own topics document — tool-reference.md
		// carried eight such mentions after the facade cutover because the prose
		// (unlike call literals) was never compared to the schemas.
		const offenders: string[] = [];
		for (const file of ["README.md", "docs/tool-reference.md"] as const) {
			for (const [lineNumber, text] of read(file).split(/\r?\n/).entries()) {
				for (const span of text.matchAll(/`([^`]+)`/g)) {
					const parsed = /^([a-zA-Z]+)(\?)?/.exec(span[1]!);
					if (!parsed || !NEVER_MODEL_PARAMS.has(parsed[1]!)) continue;
					if (parsed[2]) continue; // `param?: type` documents the script contract
					offenders.push(`${file}:${lineNumber + 1} \`${span[1]}\``);
				}
			}
		}
		assert.deepEqual(offenders, [], "the call reference names params the facade drops; they belong to the script/slash/RPC surfaces");
	});

	it("uses only that facade's params in every delegation and workflow example", () => {
		const byTool: Record<string, Set<string>> = { subagent: DELEGATION_PARAMS, subagent_workflow: WORKFLOW_PARAMS };
		const offenders: string[] = [];
		for (const example of allCallLiterals()) {
			const allowed = byTool[example.tool];
			if (!allowed) continue;
			for (const key of example.keys) {
				if (!allowed.has(key)) offenders.push(`${example.file}:${example.line} ${example.tool}+${key}`);
			}
		}
		assert.deepEqual(
			[...new Set(offenders)].sort(),
			[],
			"these literals pass params their tool does not accept (workflowScript/workflowScriptPath were merged into source; context moved to the agent)",
		);
	});

	it("gives every copyable delegation example its required params", () => {
		// A fenced `subagent({...})` literal is something the model pastes verbatim, so
		// one missing a required param teaches a call that always fails. This is how the
		// "Default agent when omitted" description survived: nothing checked the examples.
		const required = (schema: unknown): string[] => (schema as { required?: string[] }).required ?? [];
		const offenders: string[] = [];
		for (const example of allCallLiterals()) {
			if (!example.fenced || example.tool !== "subagent") continue;
			for (const key of required(SubagentDelegationParams)) {
				if (!example.keys.includes(key)) offenders.push(`${example.file}:${example.line} missing ${key}`);
			}
		}
		assert.deepEqual(
			[...new Set(offenders)].sort(),
			[],
			"copyable subagent examples must include every required param (task, agent)",
		);
	});

	it("never names the internal script params in model-read prose", () => {
		// The workflow facade merged `workflowScript` + `workflowScriptPath` into
		// `source`. Those two names survive only in the RPC/preflight contract, so a
		// model-read file must not use them as a param or as a feature word — the
		// model would pass a name the tool does not accept.
		const exempt = new Set(["docs/extension-api.md"]);
		const offenders: string[] = [];
		for (const file of servedFiles) {
			if (exempt.has(file)) continue;
			read(file)
				.split(/\r?\n/)
				.forEach((text, index) => {
					for (const match of text.matchAll(/workflowScriptPath|workflowScript/g)) {
						offenders.push(`${file}:${index + 1} ${match[0]}`);
					}
				});
		}
		assert.deepEqual(offenders, [], "model-read files must say `source` for the workflow script param");
	});

	it("keeps the parameter reference to model-facing params", () => {
		const [table = ""] = read("docs/tool-reference.md").split("### Budget guidance for writers");
		const documented = [...table.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((match) => match[1]!);
		assert.ok(documented.length >= 15, `expected the facade parameter table, found ${documented.length} rows`);
		assert.deepEqual(documented.filter((key) => !MODEL_FACING_PARAMS.has(key)), [], "parameter reference documents params the facades do not expose");
	});
});
