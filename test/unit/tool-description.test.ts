import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
	buildSubagentToolPromptMetadata,
	SUBAGENT_CONTROL_DESCRIPTION,
	SUBAGENT_DELEGATION_DESCRIPTION,
	SUBAGENT_TOOL_PROMPT_GUIDELINES,
	SUBAGENT_TOOL_PROMPT_SNIPPET,
	SUBAGENT_WORKFLOW_DESCRIPTION,
} from "../../src/extension/tool-description.ts";
import { SUBAGENT_CHILD_ENV } from "../../src/runs/shared/child-runtime-config.ts";
import * as schemas from "../../src/extension/schemas.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function parentToolEnv(agentDir?: string): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env[SUBAGENT_CHILD_ENV];
	if (agentDir) env.PI_CODING_AGENT_DIR = agentDir;
	return env;
}

describe("subagent facade tool descriptions", () => {
	it("keeps each facade description at most 60 words", () => {
		for (const [name, description] of [
			["subagent", SUBAGENT_DELEGATION_DESCRIPTION],
			["subagent_workflow", SUBAGENT_WORKFLOW_DESCRIPTION],
			["subagent_control", SUBAGENT_CONTROL_DESCRIPTION],
		]) {
			assert.ok(wordCount(description) <= 60, `${name} description should be <= 60 words, got ${wordCount(description)}`);
		}
	});

	it("points each description at guide topics for depth", () => {
		assert.match(SUBAGENT_DELEGATION_DESCRIPTION, /guide topics tool-reference, agents/);
		assert.match(SUBAGENT_WORKFLOW_DESCRIPTION, /guide topic workflows/);
		assert.match(SUBAGENT_CONTROL_DESCRIPTION, /guide topic tool-reference/);
	});

	it("keeps delegation authorization guidance on the delegation tool", () => {
		assert.match(SUBAGENT_DELEGATION_DESCRIPTION, /Delegate only when authorized/i);
	});

	/**
	 * A description that glosses its own parameters pays for the same sentence
	 * twice on every call, because the schema rides in the same payload. Measured
	 * before this rule: `subagent` listed "Optional: reads (files), cwd, async
	 * (background), output (durable path), worktree (isolate)" while all five
	 * params described themselves, and `subagent_control` enumerated verbs that
	 * `action.enum` already sends.
	 *
	 * The previous assertions pinned that gloss (they required "Optional: reads
	 * (files), cwd, async (background)" and "agent (installed name via ...) plus
	 * task"), which made the duplication load-bearing exactly as the old bg_wait
	 * assertions did: keeping the duplicate was mandatory and saying it once in the
	 * param failed. The facts are unchanged - each now appears once, in the param
	 * that owns it - and `required: ["task", "agent"]` is machine-enforced.
	 */
	it("does not restate its own parameter names or schema enums", () => {
		const offenders: string[] = [];
		const tools: Array<[string, string, { properties?: unknown }]> = [
			["subagent", SUBAGENT_DELEGATION_DESCRIPTION, schemas.SubagentDelegationParams],
			["subagent_workflow", SUBAGENT_WORKFLOW_DESCRIPTION, schemas.SubagentWorkflowParams],
			["subagent_control", SUBAGENT_CONTROL_DESCRIPTION, schemas.SubagentControlParams],
		];
		for (const [name, description, schema] of tools) {
			// The gloss form this repo used: a parenthetical attached to a param, or
			// naming one. `reads (files)`, `async (background)`, `steer (with message)`,
			// `resource (workflow)`, `get (agent)` — each re-says what that param's own
			// description says, in the same payload, so it is paid for twice per call.
			const props = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
			const verbs = ((schema.properties as { action?: { enum?: string[] } } | undefined)?.action?.enum ?? []).flatMap((verb) => verb.split("."));
			const vocabulary = new Set([...props, ...verbs]);
			for (const match of description.matchAll(/\b([a-z][a-zA-Z]{2,})\s*\(([^)]{1,44})\)/g)) {
				const [, attached, inside] = match;
				const namesVocabulary = [...(inside as string).matchAll(/[a-zA-Z][a-zA-Z.]{2,}/g)].some((word) => vocabulary.has(word[0]!.toLowerCase()));
				if (vocabulary.has(attached!.toLowerCase()) || namesVocabulary) {
					offenders.push(`${name}: "${match[0]}" glosses a param inline; that param's description already says it`);
				}
			}
			// Verbs are discoverable through action.enum; a hand-copied list drifts and
			// is a second copy of the schema.
			const quoted = verbs.filter((verb) => new RegExp(`\\b${verb.replace(".", "\\.")}\\b`).test(description));
			if (verbs.length && quoted.length === verbs.length) {
				offenders.push(`${name} description enumerates the entire action.enum (${verbs.length} verbs) that the schema already sends`);
			}
		}
		assert.deepEqual(offenders, []);
	});

	/**
	 * Two guards, because they catch different regressions.
	 *
	 * The description cap is what stops prose inflation: the three descriptions were
	 * 368 + 288 + 234 = 890 characters, and de-glossed they are 408. The shape cap is
	 * the backstop for anything the per-form rules above do not recognize, e.g. a new
	 * bloated parameter. Measured at 7c582f92 the three serialized tools totalled
	 * 3,457; after this change 3,077, of which ~140 is the async correctness fix.
	 * Verified: reverting only the descriptions trips the gloss rule and the 500 cap
	 * (890 chars); reverting descriptions and schemas together also trips this cap.
	 * Raising either number is a reviewable edit with a measured before/after, which
	 * is the point. Verified by mutation: reverting the descriptions trips the gloss
	 * rule and the 500 cap; a 447-char parameter description trips the 3,400 cap.
	 */
	it("keeps the whole model-facing tool surface inside its budget", () => {
		const tools: Array<[string, unknown]> = [
			[SUBAGENT_DELEGATION_DESCRIPTION, schemas.SubagentDelegationParams],
			[SUBAGENT_WORKFLOW_DESCRIPTION, schemas.SubagentWorkflowParams],
			[SUBAGENT_CONTROL_DESCRIPTION, schemas.SubagentControlParams],
		];
		const total = tools.reduce((sum, [description, schema]) => sum + description.length + JSON.stringify(schema).length, 0);
		const descriptions = tools.reduce((sum, [description]) => sum + description.length, 0);
		assert.ok(descriptions < 500, `three facade descriptions should stay under 500 chars combined, got ${descriptions} (408 after de-glossing, 890 before)`);
		assert.ok(total < 3_400, `three facade tools (description + schema) should stay under 3400 chars, got ${total} (3077 measured, 3457 pre-fix)`);
	});

	it("ships no stale text from removed subsystems in any description", () => {
		for (const description of [SUBAGENT_DELEGATION_DESCRIPTION, SUBAGENT_WORKFLOW_DESCRIPTION, SUBAGENT_CONTROL_DESCRIPTION]) {
			assert.doesNotMatch(description, /workflowScriptPath/);
			assert.doesNotMatch(description, /runs\.lanes/);
			assert.doesNotMatch(description, /schedule\./);
			assert.doesNotMatch(description, /watchdog/);
		}
	});

	it("keeps prompt metadata concise and current by default", () => {
		assert.equal(SUBAGENT_TOOL_PROMPT_SNIPPET, "For operator-requested delegation, use subagents; compose multi-child work in one workflow call.");
		assert.deepEqual(SUBAGENT_TOOL_PROMPT_GUIDELINES, [
			"Do not invoke subagents unless the operator requested delegation directly or through applicable instructions.",
		]);
		const metadata = buildSubagentToolPromptMetadata();
		assert.equal(metadata.promptSnippet, SUBAGENT_TOOL_PROMPT_SNIPPET);
		assert.deepEqual(metadata.promptGuidelines, SUBAGENT_TOOL_PROMPT_GUIDELINES);
		assert.ok(Buffer.byteLength(metadata.promptGuidelines!.join("\n")) < 400);
		for (const guideline of metadata.promptGuidelines!) assert.match(guideline, /subagent/);
	});
});

function readRegisteredTools(agentDir: string): { name: string; description: string; properties: string[] }[] {
	const script = String.raw`
		import registerSubagentExtension from "./src/extension/index.ts";
		const events = { on() { return () => {}; }, emit() {} };
		const registered = [];
		const fakePi = new Proxy({
			events,
			registerTool(tool) { registered.push(tool); },
			registerCommand() {},
			registerShortcut() {},
			registerMessageRenderer() {},
			sendMessage() {},
			getSessionName() { return undefined; },
		}, {
			get(target, prop) {
				if (prop in target) return target[prop];
				return () => undefined;
			},
		});
		registerSubagentExtension(fakePi);
		const facade = registered
			.filter((tool) => tool.name && tool.name.startsWith("subagent"))
			.map((tool) => ({ name: tool.name, description: tool.description, properties: Object.keys(tool.parameters.properties) }));
		process.stdout.write(JSON.stringify(facade));
	`;
	const output = execFileSync(
		process.execPath,
		[
			"--experimental-strip-types",
			"--import",
			"./test/support/register-loader.mjs",
			"--input-type=module",
			"--eval",
			script,
		],
		{ cwd: projectRoot, env: parentToolEnv(agentDir), encoding: "utf-8" },
	);
	// SAFETY: the inline registration script writes only the object we push for
	// each registered facade tool, so the parsed shape is guaranteed.
	return JSON.parse(output) as { name: string; description: string; properties: string[] }[];
}

describe("registered facade tools", { timeout: 120000 }, () => {
	it("registers the three facade tools with matching descriptions and params", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-facade-reg-"));
		const tools = readRegisteredTools(agentDir);
		const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
		assert.deepEqual(Object.keys(byName).sort(), ["subagent", "subagent_control", "subagent_workflow"]);
		assert.equal(byName.subagent.description, SUBAGENT_DELEGATION_DESCRIPTION);
		assert.equal(byName.subagent_workflow.description, SUBAGENT_WORKFLOW_DESCRIPTION);
		assert.equal(byName.subagent_control.description, SUBAGENT_CONTROL_DESCRIPTION);
		assert.deepEqual(byName.subagent.properties.sort(), ["agent", "async", "cwd", "output", "prequel", "reads", "task", "worktree"].sort());
		assert.deepEqual(byName.subagent_workflow.properties.sort(), ["args", "async", "baseRef", "source", "workflow", "worktree"].sort());
		assert.deepEqual(byName.subagent_control.properties.sort(), ["action", "agent", "id", "message", "mission", "topic"].sort());
	});
});