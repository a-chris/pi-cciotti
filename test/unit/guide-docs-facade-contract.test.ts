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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SUBAGENT_CONTROL_ACTIONS } from "../../src/extension/schemas.ts";
import { normalizeControlParams } from "../../src/extension/facade.ts";
import { SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";

const servedFiles = ["README.md", ...SUBAGENT_GUIDE_TOPICS.filter((topic) => topic !== "overview").map((topic) => `docs/${topic}.md`)];
const CONTROL_VERBS = new Set<string>(SUBAGENT_CONTROL_ACTIONS);
const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf-8");

/** Every `action: "verb"` mention, including bare `{ action: "x" }` examples. */
function mentionedVerbs(): { file: string; line: number; verb: string }[] {
	const found: { file: string; line: number; verb: string }[] = [];
	for (const file of servedFiles) {
		read(file)
			.split(/\r?\n/)
			.forEach((text, index) => {
				for (const match of text.matchAll(/action:\s*\\?"([a-zA-Z.]+)\\?"/g)) {
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
			const verb = /action:\s*\\?"([a-zA-Z.]+)\\?"/.exec(body)?.[1];
			if (!verb) continue;
			found.push({ file, line: text.slice(0, match.index).split("\n").length, tool: match[1]!, verb, keys: [...new Set(keys)] });
		}
	}
	return found;
}

/**
 * Control params the facade does not forward yet, tracked per doc+verb. U4 adds
 * these to the control facade (plan.md M4); until then each entry is a known
 * over-promise, and anything new must be added here deliberately.
 */
const trackedFacadeGaps = new Set([
	"README.md:guide+topic",
	"docs/agents.md:list+capabilities",
	"docs/extension-api.md:status+view",
	"docs/missions.md:mission.create+mission",
	"docs/observability.md:status+view",
	"docs/tool-reference.md:status+view",
	"docs/tool-reference.md:status+index",
	"docs/tool-reference.md:status+lines",
	"docs/tool-reference.md:resume+index",
	"docs/tool-reference.md:steer+mode",
	"docs/tool-reference.md:steer+index",
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

	it("does not rely on control params the facade drops", () => {
		const forwarded = new Set(Object.keys(normalizeControlParams({ id: "x", action: "status", message: "m" })).filter((key) => key !== undefined));
		const offenders: string[] = [];
		for (const example of toolCallExamples()) {
			if (!CONTROL_VERBS.has(example.verb) || example.verb === "validate") continue;
			const dropped = example.keys.filter((key) => !forwarded.has(key));
			if (dropped.length === 0) continue;
			const label = `${example.file}:${example.verb}`;
			if (!dropped.every((key) => trackedFacadeGaps.has(`${label}+${key}`))) offenders.push(`${label}+${dropped.join(",")}`);
		}
		assert.deepEqual([...new Set(offenders)].sort(), [], "control examples pass params that never reach the executor and are not tracked as U4 gaps");
	});

	it("keeps the parameter reference to facade params", () => {
		const [table = ""] = read("docs/tool-reference.md").split("### Budget guidance for writers");
		const documented = [...table.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((match) => match[1]!);
		const facadeParams = new Set(["task", "agent", "prequel", "reads", "cwd", "workflow", "source", "args", "baseRef", "async", "worktree", "output", "action", "id", "message"]);
		assert.ok(documented.length >= 15, `expected the facade parameter table, found ${documented.length} rows`);
		assert.deepEqual(documented.filter((key) => !facadeParams.has(key)), [], "parameter reference documents params the facades do not expose");
	});
});
