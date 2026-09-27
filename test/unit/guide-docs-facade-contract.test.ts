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

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf-8");

/**
 * Control verbs whose required input cannot cross the tool boundary, so a
 * tool-call example for one always fails:
 *   get            needs `agent`     — delegation owns it and the facade invariant forbids sharing
 *   validate       needs a script    — workflow owns `source`/`args`
 *   mission.create needs `mission`   — plan.md buckets `mission` as internal-contract only
 * The verbs stay on the enum (plan.md D2/D5/D6); only their examples are forbidden.
 */
const UNREACHABLE_VERBS = new Set(["get", "validate", "mission.create"]);

/**
 * Params plan.md's disposition table removes from the model surface or moves to
 * config / internal contracts. An example that passes one is teaching a
 * capability the model does not have.
 */
const NEVER_MODEL_PARAMS = new Set([
	"topic", "view", "lines", "mode", "index", "childId", "handoffPath", "repo",
	"additional", "share", "sessionDir", "steeringRecovery", "agentScope", "capabilities", "mission",
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
}

/** Parse `subagent*({...})` literals with brace matching that ignores string bodies. */
function toolCallExamples(): CallExample[] {
	const found: CallExample[] = [];
	for (const file of servedFiles) {
		const text = read(file);
		for (const match of text.matchAll(/\b(subagent|subagent_control|subagent_workflow)\(\{/g)) {
			let i = match.index + match[0].length - 1;
			let depth = 0;
			let openDepth = 0;
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
					openDepth++;
				} else if (char === "}") {
					depth--;
					openDepth--;
					if (depth === 0) {
						end = i;
						break;
					}
				}
				if (openDepth === 1) {
					const key = /^([a-zA-Z]+)\s*:/.exec(text.slice(i));
					if (key) {
						keys.push(key[1]!);
						i += key[0].length - 1;
					}
				}
			}
			if (end < 0) continue;
			const body = text.slice(match.index, end + 1);
			const verb = /action:\s*\\?"([a-zA-Z][a-zA-Z.0-9-]*)\\?"/.exec(body)?.[1];
			found.push({ file, line: text.slice(0, match.index).split("\n").length, tool: match[1]!, verb, keys: [...new Set(keys)] });
		}
	}
	return found;
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
		const offenders = controlExamples().filter((example) => example.tool !== "subagent_control");
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

	it("uses only that facade's params in every delegation and workflow example", () => {
		const byTool: Record<string, Set<string>> = { subagent: DELEGATION_PARAMS, subagent_workflow: WORKFLOW_PARAMS };
		const offenders: string[] = [];
		for (const example of toolCallExamples()) {
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
