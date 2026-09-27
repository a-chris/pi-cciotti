import assert from "node:assert/strict";
import * as os from "node:os";
import { describe, it } from "node:test";
import { createSubagentExecutor } from "../../src/runs/foreground/subagent-executor.ts";
import type { AuthorityPolicyConfig, SubagentState } from "../../src/shared/types.ts";

function createState(): SubagentState {
	return {
		baseCwd: "",
		currentSessionId: null,
		asyncJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		pendingForegroundControlNotices: new Map(),
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: { schedule: () => false, clear: () => {} },
	};
}

function createExecutor(authorityPolicy?: AuthorityPolicyConfig) {
	return createSubagentExecutor({
		pi: { events: { emit() {}, on() { return () => {}; } }, getSessionName() { return "parent"; } } as any,
		state: createState(),
		config: { maxSubagentDepth: 2, control: {}, ...(authorityPolicy ? { authorityPolicy } : {}) } as any,
		asyncByDefault: false,
		tempArtifactsDir: os.tmpdir(),
		getSubagentSessionRoot: () => os.tmpdir(),
		expandTilde: (value) => value,
		discoverAgents: () => ({ agents: [] }),
	});
}

function ctx(ui?: { confirm: () => Promise<boolean> }) {
	return {
		cwd: os.tmpdir(),
		hasUI: Boolean(ui),
		...(ui ? { ui } : {}),
		sessionManager: { getSessionId() { return "session"; }, getSessionFile() { return null; } },
		modelRegistry: { getAvailable() { return []; } },
	} as any;
}

async function run(action: string, policy?: AuthorityPolicyConfig, ui?: { confirm: () => Promise<boolean> }): Promise<{ text: string; isError?: boolean }> {
	const result = await createExecutor(policy).execute(action, { action }, new AbortController().signal, undefined, ctx(ui));
	return { text: result.content.find((entry) => entry.type === "text")?.text ?? "", ...(result.isError === undefined ? {} : { isError: result.isError }) };
}

describe("inspector and project pane authority policy", () => {
	it("leaves inspector.open automatic by default so the plugin gate still decides", async () => {
		const { text } = await run("inspector.open");

		assert.doesNotMatch(text, /Authority policy/);
		assert.match(text, /Inspector actions require id or dir/);
	});

	it("forbids inspector.open when the policy says so", async () => {
		const { text, isError } = await run("inspector.open", { inspectorOpen: "forbid" });

		assert.equal(isError, true);
		assert.match(text, /Authority policy forbids action 'inspector\.open'\./);
	});

	it("requires confirmation for inspector.open when the operator opts in", async () => {
		const { text, isError } = await run("inspector.open", { inspectorOpen: "confirm" });

		assert.equal(isError, true);
		assert.match(text, /requires user confirmation for action 'inspector\.open'/);
	});

});
