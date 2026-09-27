/**
 * Docs ↔ facade contract (M4).
 *
 * The model reads the packaged guide topics at runtime (`action: "guide"`), so a
 * doc that teaches a verb or param the tool schema rejects is an instruction to
 * do the impossible. That drift survived the whole facade cutover because
 * nothing compared the prose to the schemas — 37 examples told the model to call
 * control verbs on a tool whose schema requires `task`, and dozens more named
 * actions (`children.list`, `worktree.discard`, `inspector.*`, agent CRUD,
 * `doctor`, `refine.*`) that the control enum rejects.
 *
 * This test is the comparison:
 *   1. every `action: "..."` in a served topic must be a verb the control schema
 *      accepts;
 *   2. a control example must name `subagent_control` — the same verb called as
 *      `subagent({...})` fails the delegation schema's required `task`;
 *   3. except where listed as a tracked gap, no control example may pass a param
 *      the facade normalization drops before the executor sees it.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SUBAGENT_CONTROL_ACTIONS } from "../../src/extension/schemas.ts";
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
const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf-8");

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
	verb: string;
	/** Keys at depth 1 of the argument literal (string bodies and nesting skipped). */
	keys: string[];
}

/** Parse `subagent*({...})` literals with brace matching that ignores strings. */
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
			if (!verb) continue;
			found.push({ file, line: text.slice(0, match.index).split("\n").length, tool: match[1]!, verb, keys: [...new Set(keys)] });
		}
	}
	return found;
}

/**
 * Control verbs whose required input cannot cross the tool boundary, so a tool-call
 * example for them is an instruction that always fails:
 *   get          needs `agent`      (delegation owns `agent`; the invariant forbids sharing)
 *   validate     needs a script     (workflow owns `source`/`args`)
 *   mission.create needs `mission`  (plan.md buckets `mission` as internal-contract only)
 * The verbs stay on the enum per D2/D5/D6; only their examples are forbidden.
 */
const UNREACHABLE_VERBS = new Set(["get", "validate", "mission.create"]);

/** Params the plan removes from the model surface or moves to config / internal contracts. */
const NEVER_MODEL_PARAMS = new Set([
	"topic", "view", "lines", "mode", "index", "childId", "handoffPath", "repo",
	"additional", "share", "sessionDir", "steeringRecovery", "agentScope", "capabilities", "mission",
]);

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
		const offenders = toolCallExamples().filter((e) => CONTROL_VERBS.has(e.verb) && e.tool !== "subagent_control");
		assert.deepEqual(
			offenders.map((e) => `${e.file}:${e.line} ${e.tool}({ action: "${e.verb}" })`),
			[],
			"control verbs must be shown on subagent_control; the delegation tool requires task and rejects them",
		);
	});

	it("never shows a control example for a verb that cannot receive its input", () => {
		const offenders = toolCallExamples().filter((e) => UNREACHABLE_VERBS.has(e.verb));
		assert.deepEqual(
			offenders.map((e) => `${e.file}:${e.line} ${e.tool}({ action: "${e.verb}" })`),
			[],
			"these verbs need a param the model surface does not carry, so teaching them guarantees a failed call",
		);
	});

	it("does not pass control params the model surface does not carry", () => {
		const forwarded = new Set(Object.keys(normalizeControlParams({ id: "x", action: "status", message: "m" })).filter((key) => key !== undefined));
		const offenders: string[] = [];
		for (const example of toolCallExamples()) {
			if (!CONTROL_VERBS.has(example.verb)) continue;
			for (const key of example.keys) {
				if (forwarded.has(key)) continue;
				const why = NEVER_MODEL_PARAMS.has(key) ? "removed/config/internal by plan.md" : "never reaches the executor";
				offenders.push(`${example.file}:${example.verb}+${key} (${why})`);
			}
		}
		assert.deepEqual([...new Set(offenders)].sort(), [], "control examples pass params the model surface does not carry");
	});

	it("keeps the parameter reference to facade params", () => {
		const [table = ""] = read("docs/tool-reference.md").split("### Budget guidance for writers");
		const documented = [...table.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((match) => match[1]!);
		const facadeParams = new Set(["task", "agent", "prequel", "reads", "cwd", "workflow", "source", "args", "baseRef", "async", "worktree", "output", "action", "id", "message"]);
		assert.ok(documented.length >= 15, `expected the facade parameter table, found ${documented.length} rows`);
		assert.deepEqual(documented.filter((key) => !facadeParams.has(key)), [], "parameter reference documents params the facades do not expose");
	});
});
