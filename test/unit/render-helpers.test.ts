import test from "node:test";
import assert from "node:assert/strict";

import { visibleWidth } from "@earendil-works/pi-tui";
import { row, shouldSuppressSingleStep, stripRepeatedAgentPrefix, withDuplicateLabelDiscriminators } from "../../src/tui/render-helpers.ts";
import { buildWidgetLines, renderSubagentResult, truncLine, widgetRenderKey } from "../../src/tui/render.ts";
import type { AsyncJobState } from "../../src/shared/types.ts";

const theme = {
	fg(_name: string, text: string): string {
		return text;
	},
	bold(text: string): string {
		return text;
	},
};

function componentText(component: unknown): string {
	if (typeof component !== "object" || component === null) return "";
	if ("text" in component && typeof component.text === "string") return component.text;
	if ("children" in component && Array.isArray(component.children)) return component.children.map(componentText).filter(Boolean).join("\n");
	return "";
}

function result(agent: string, output: string) {
	return {
		agent,
		task: `${agent} task`,
		exitCode: 0,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		finalOutput: output,
	};
}

test("row clips content to the available width", () => {
	const rendered = row("abcdef", 6, theme as any);
	assert.equal(visibleWidth(rendered), 6);
});

test("stripRepeatedAgentPrefix removes only safe repeated job-name prefixes", () => {
	assert.equal(stripRepeatedAgentPrefix("  reviewer: Review the diff  ", "reviewer"), "Review the diff");
	assert.equal(stripRepeatedAgentPrefix("reviewer · Review the diff", "reviewer"), "Review the diff");
	assert.equal(stripRepeatedAgentPrefix("reviewer Review the diff", "reviewer"), "Review the diff");
	assert.equal(stripRepeatedAgentPrefix("reviewer-2: Review the diff", "reviewer"), "reviewer-2: Review the diff");
	assert.equal(stripRepeatedAgentPrefix("reviewerhood: Review the diff", "reviewer"), "reviewerhood: Review the diff");
	assert.equal(stripRepeatedAgentPrefix("worker: Review the diff", "reviewer"), "worker: Review the diff");
	assert.equal(stripRepeatedAgentPrefix("reviewer", "reviewer"), "reviewer");
});

test("shouldSuppressSingleStep uses logical totals instead of materialized step count", () => {
	assert.equal(shouldSuppressSingleStep(undefined, 1), true);
	assert.equal(shouldSuppressSingleStep(1, 1), true);
	assert.equal(shouldSuppressSingleStep(2, 1), false);
	assert.equal(shouldSuppressSingleStep(undefined, 2), false);
	assert.equal(shouldSuppressSingleStep(undefined, undefined), false);
});

test("withDuplicateLabelDiscriminators preserves unique labels and stable duplicate fractions", () => {
	const rows = [
		{ index: 0, displayName: "Gather context" },
		{ index: 1, displayName: "Review diff" },
		{ index: 2, displayName: "Review diff" },
	];

	assert.deepEqual(
		withDuplicateLabelDiscriminators(rows, 3).map((row) => row.rowLabel),
		["Gather context", "Agent 2/3: Review diff", "Agent 3/3: Review diff"],
	);

	const reordered = [rows[2]!, rows[0]!, rows[1]!];
	assert.deepEqual(
		withDuplicateLabelDiscriminators(reordered, 3).map((row) => row.rowLabel),
		["Agent 3/3: Review diff", "Gather context", "Agent 2/3: Review diff"],
	);
});

test("row normalizes multiline content before clipping", () => {
	const rendered = row("bash failed: line 1\nline 2\tvalue", 20, theme as any);
	assert.equal(visibleWidth(rendered), 20);
	assert.doesNotMatch(rendered, /[\r\n\t]/);
});

test("row keeps styled multiline content within the available width", () => {
	const rendered = row("\u001b[31merror line 1\nline 2\tvalue\u001b[39m", 18, theme as any);
	assert.equal(visibleWidth(rendered), 18);
	assert.doesNotMatch(rendered, /[\r\n\t]/);
});

test("truncLine preserves ANSI styles and resets through the ellipsis", () => {
	assert.equal(truncLine("\u001b[31mabcdef\u001b[0m", 4), "\u001b[31mabc\u001b[31m…");
	assert.equal(truncLine("\u001b[31mab\u001b[0mcdef", 4), "\u001b[31mab\u001b[0mc…");
	assert.equal(truncLine("ab\u001b[xcd", 4), "ab\u001b[…");
});

test("truncLine respects grapheme display width", () => {
	const rendered = truncLine("🙂🙂🙂", 5);
	assert.equal(rendered, "🙂🙂…");
	assert.equal(visibleWidth(rendered), 5);
});

test("truncLine emits no marker at zero width", () => {
	assert.equal(truncLine("abcdef", 0), "");
});

test("widget render keys keep compact payloads quiet and expanded payloads fresh", () => {
	const job: AsyncJobState = {
		asyncId: "workflow-1",
		asyncDir: "/tmp/workflow-1",
		status: "running",
		mode: "workflow",
		startedAt: 100,
		updatedAt: 200,
		steps: [{
			agent: "reviewer",
			workflowKey: "review",
			status: "running",
			currentTool: "grep",
			recentOutput: ["started", "x".repeat(20_000)],
			recentTools: [
				{ tool: "read", args: "hidden", endMs: 100 },
				{ tool: "grep", args: "visible", endMs: 150 },
			],
		}],
	};
	const noisy = structuredClone(job);
	noisy.steps![0]!.recentOutput = ["started", "y".repeat(20_000)];
	noisy.steps![0]!.recentTools = [
		{ tool: "read", args: "changed-hidden", endMs: 100 },
		{ tool: "grep", args: "visible", endMs: 150 },
	];
	assert.equal(widgetRenderKey(noisy), widgetRenderKey(job));
	assert.notEqual(widgetRenderKey(noisy, true), widgetRenderKey(job, true));

	const expandedVisibleChange = structuredClone(job);
	expandedVisibleChange.steps![0]!.recentTools![1]!.args = "changed-visible";
	assert.equal(widgetRenderKey(expandedVisibleChange), widgetRenderKey(job));
	assert.notEqual(widgetRenderKey(expandedVisibleChange, true), widgetRenderKey(job, true));

	const visibleChange = structuredClone(job);
	visibleChange.steps![0]!.currentTool = "bash";
	assert.notEqual(widgetRenderKey(visibleChange), widgetRenderKey(job));

	const visibleArgsChange = structuredClone(job);
	visibleArgsChange.steps![0]!.currentToolArgs = "{\"pattern\":\"workflow\"}";
	assert.notEqual(widgetRenderKey(visibleArgsChange), widgetRenderKey(job));

	const nestedVisibleChange = structuredClone(job);
	nestedVisibleChange.nestedChildren = [{ id: "nested-1", parentRunId: "workflow-1", depth: 1, path: [{ runId: "workflow-1" }], state: "failed", agent: "nested", error: "failed" }];
	assert.notEqual(widgetRenderKey(nestedVisibleChange), widgetRenderKey(job));

	const preflightJob: AsyncJobState = {
		...job,
		preflight: { version: 1, coverage: "complete", lanes: [{ key: "writer", decision: "Implement change" }] },
		workflow: { trace: [], emits: [], console: [], preflightWarnings: ["first mismatch"] },
	};
	const warningDetailChange = structuredClone(preflightJob);
	warningDetailChange.workflow!.preflightWarnings = ["different mismatch"];
	assert.equal(widgetRenderKey(warningDetailChange), widgetRenderKey(preflightJob));
	assert.notEqual(widgetRenderKey(warningDetailChange, true), widgetRenderKey(preflightJob, true));
});

test("seeded running glyphs stay stable until the supplied animation frame advances", () => {
	const originalNow = Date.now;
	const runningGlyph = (lines: string[]): string => lines
		.map((line) => line.match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●]/u)?.[0])
		.find((glyph): glyph is string => glyph !== undefined) ?? "";
	const seededJob: AsyncJobState = {
		asyncId: "seeded",
		asyncDir: "/tmp/seeded",
		status: "running",
		mode: "single",
		updatedAt: 1,
	};
	const unseededJob: AsyncJobState = {
		asyncId: "unseeded",
		asyncDir: "/tmp/unseeded",
		status: "running",
		mode: "single",
	};

	try {
		Date.now = () => 1_000;
		const seededFrame0 = runningGlyph(buildWidgetLines([seededJob], theme, 180, false, 0));
		const unseededBefore = runningGlyph(buildWidgetLines([unseededJob], theme, 180));

		Date.now = () => 1_125;
		const seededSameFrame = runningGlyph(buildWidgetLines([seededJob], theme, 180, false, 0));
		const unseededAfter = runningGlyph(buildWidgetLines([unseededJob], theme, 180));
		const seededNextFrame = runningGlyph(buildWidgetLines([seededJob], theme, 180, false, 1));

		assert.equal(seededSameFrame, seededFrame0);
		assert.equal(unseededAfter, unseededBefore);
		assert.equal(unseededBefore, "●");
		assert.notEqual(seededNextFrame, seededFrame0);
	} finally {
		Date.now = originalNow;
	}
});

test("multiline rendering omits two-column graphemes at one-column width", () => {
	const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	Object.defineProperty(process.stdout, "columns", { configurable: true, value: 5 });
	try {
		const rendered = componentText(renderSubagentResult({
			content: [{ type: "text", text: "a🙂b\n🙂" }],
		}, { expanded: true }, theme as any));
		assert.deepEqual(rendered.split("\n"), ["a", "b"]);
		for (const line of rendered.split("\n")) assert.ok(visibleWidth(line) <= 1);
	} finally {
		if (originalColumns) Object.defineProperty(process.stdout, "columns", originalColumns);
		else delete (process.stdout as { columns?: number }).columns;
	}
});

test("running single-subagent cards show the configured detach shortcut", () => {
	const running = {
		...result("reviewer", ""),
		progress: { status: "running", index: 0, agent: "reviewer", toolCount: 0, tokens: 0, durationMs: 0 },
	};
	const toolResult = {
		content: [{ type: "text", text: "running" }],
		details: { mode: "single", results: [running] },
	};

	const configured = componentText(renderSubagentResult(
		toolResult as never,
		{ expanded: false },
		theme as any,
		undefined,
		undefined,
		"ctrl+b",
	));
	assert.match(configured, /task: reviewer task/);
	assert.doesNotMatch(configured, /Fleet/);
	assert.match(configured, /Ctrl\+B to run in background/);

	const unconfigured = componentText(renderSubagentResult(toolResult as never, { expanded: false }, theme as any));
	assert.doesNotMatch(unconfigured, /run in background/);

	const alreadyBackground = componentText(renderSubagentResult(
		{ ...toolResult, details: { ...toolResult.details, asyncId: "async-123" } } as never,
		{ expanded: false },
		theme as any,
		undefined,
		undefined,
		"ctrl+b",
	));
	assert.doesNotMatch(alreadyBackground, /run in background/);

	const pendingBackground = componentText(renderSubagentResult(
		{ ...toolResult, details: { ...toolResult.details, background: true } } as never,
		{ expanded: false },
		theme as any,
		undefined,
		undefined,
		"ctrl+b",
	));
	assert.doesNotMatch(pendingBackground, /run in background/);
});

test("compact multi-result cards prefer bounded workflow labels over raw tasks", () => {
	const longLabel = `Review auth flow\n${"x".repeat(140)}`;
	const running = {
		...result("reviewer", ""),
		task: "raw task that should not win",
		progress: { status: "running", index: 0, agent: "reviewer", toolCount: 0, tokens: 0, durationMs: 0 },
	};
	const text = componentText(renderSubagentResult({
		content: [{ type: "text", text: "running" }],
		details: {
			mode: "parallel",
			results: [running],
			workflowGraph: {
				runId: "workflow-task-label",
				mode: "parallel",
				phases: [],
				nodes: [{ id: "review", kind: "agent", agent: "reviewer", label: longLabel, status: "running", flatIndex: 0 }],
			},
		},
	}, { expanded: false }, theme as any));

	assert.match(text, /task: Review auth flow x+/);
	assert.doesNotMatch(text, /raw task that should not win/);
	assert.match(text, /\.\.\.$/m);
	assert.doesNotMatch(text, /Fleet/);
});

test("workflow checklist does not map child-local result indexes onto graph nodes", () => {
	const text = componentText(renderSubagentResult({
		content: [{ type: "text", text: "failed" }],
			details: {
			mode: "workflow",
			results: [
				{ ...result("scout", "ok"), index: 0 },
				{ ...result("writer", "failed"), index: 0, exitCode: 1 },
			],
			workflowGraph: {
				runId: "workflow-local-indexes",
				mode: "workflow",
				phases: [{ title: "inventory", nodeIds: ["inventory"] }, { title: "write", nodeIds: ["writer"] }],
				nodes: [
					{ id: "inventory", kind: "agent", agent: "scout", label: "Inventory", status: "completed", flatIndex: 0 },
					{ id: "writer", kind: "agent", agent: "writer", label: "Writer", status: "failed", flatIndex: 1 },
				],
			},
		},
	}, { expanded: true }, theme as any));

	assert.match(text, /Checklist 1\/2 done · 1 failed/);
	assert.match(text, /✗ write 1 failed/);
	assert.match(text, /✗ Writer · writer · failed/);
});

test("collapsed async workflow widgets render compact lane rows while expanded widgets keep child detail", () => {
	const now = 50_000;
	const workflowGraph = {
		runId: "workflow-collapsed",
		mode: "workflow" as const,
		phases: [
			{ title: "inventory", nodeIds: ["inventory"] },
			{ title: "writers", nodeIds: ["writer-a", "writer-b"] },
			{ title: "reviews", nodeIds: ["review"] },
			{ title: "gates", nodeIds: ["gate"] },
		],
		nodes: [
			{ id: "inventory", kind: "step" as const, label: "inventory", agent: "scout", status: "completed" as const, flatIndex: 0 },
			{ id: "writer-a", kind: "agent" as const, label: "writer-a", agent: "writer", status: "running" as const, flatIndex: 1 },
			{ id: "writer-b", kind: "agent" as const, label: "writer-b", agent: "writer", status: "pending" as const, flatIndex: 2 },
			{ id: "review", kind: "step" as const, label: "review", agent: "reviewer", status: "pending" as const, flatIndex: 3 },
			{ id: "gate", kind: "step" as const, label: "gate", agent: "reviewer", status: "pending" as const, flatIndex: 4 },
		],
	};
	const job: AsyncJobState = {
		asyncId: "workflow-collapsed",
		asyncDir: "/tmp/workflow-collapsed",
		cwd: "/tmp/workflow",
		status: "running",
		mode: "workflow",
		agents: ["scout", "writer", "reviewer"],
		stepsTotal: 5,
		currentStep: 1,
		toolCount: 38,
		startedAt: 1_000,
		updatedAt: now,
		workflowGraph,
		steps: [
			{ index: 0, workflowKey: "inventory", agent: "scout", status: "complete", description: "Inspect the repository" },
			{ index: 1, workflowKey: "writer-a", agent: "writer", status: "running", description: "Review auth flow", currentTool: "edit", currentToolStartedAt: now - 2_000, toolCount: 19, outputName: "review-a.md" },
			{ index: 2, workflowKey: "writer-b", agent: "writer", status: "pending", description: "Review billing flow", outputName: "review-b.md" },
		],
	};

	const collapsed = buildWidgetLines([job], theme, 240).join("\n");
	assert.match(collapsed, /1\/5 done · 1 active · 3 queued/);
	assert.match(collapsed, /✓ inventory/);
	assert.match(collapsed, /writer-a · writer · active/);
	assert.match(collapsed, /writer-b · writer · queued/);
	assert.match(collapsed, /review · reviewer · queued/);
	assert.match(collapsed, /gate · reviewer · queued/);
	assert.doesNotMatch(collapsed, /bottleneck/);
	assert.match(collapsed, /Press configured-expand-key for details/);
	assert.doesNotMatch(collapsed, /Fleet/);
	assert.equal((collapsed.match(/1\/5 done · 1 active · 3 queued/g) ?? []).length, 1);
	assert.doesNotMatch(collapsed, /Step \d\/\d|task:|workspace:|ref:|out(?:put)?:/i);

	const expanded = buildWidgetLines([job], theme, 240, true).join("\n");
	assert.match(expanded, /stage 2\/5/);
	assert.match(expanded, /task: .*Review auth flow/);
	assert.match(expanded, /workspace:\/tmp\/workflow/);
	assert.match(expanded, /out:review-a\.md/);
	assert.match(expanded, /output: [\\/]tmp[\\/]workflow-collapsed[\\/]output-1\.log/);

	const generic = buildWidgetLines([{
		asyncId: "workflow-generic",
		asyncDir: "/tmp/workflow-generic",
		status: "running",
		mode: "workflow",
		agents: ["reviewer", "scout"],
		stepsTotal: 2,
		steps: [
			{ index: 0, agent: "reviewer", status: "running" },
			{ index: 1, agent: "scout", status: "running" },
		],
	} as AsyncJobState], theme, 240).join("\n");
	assert.match(generic, /id: workflow · 0\/2 done · 2 active/);
	assert.match(generic, /step-1 · reviewer · active · reviewer/);
	assert.match(generic, /step-2 · scout · active · scout/);
});

test("compact foreground workflow results use checklist phases instead of child rows", () => {
	const workflowGraph = {
		runId: "foreground-workflow",
		mode: "workflow" as const,
		phases: [{ title: "inventory", nodeIds: ["inventory"] }, { title: "writers", nodeIds: ["writer"] }],
		nodes: [
			{ id: "inventory", kind: "step" as const, label: "inventory", agent: "scout", status: "completed" as const, flatIndex: 0 },
			{ id: "writer", kind: "agent" as const, label: "writer", agent: "writer", status: "running" as const, flatIndex: 1 },
		],
	};
	const text = componentText(renderSubagentResult({
		content: [{ type: "text", text: "running" }],
		details: {
			mode: "workflow",
			results: [
				{ ...result("scout", "done"), workflowKey: "inventory" },
				{ ...result("writer", ""), workflowKey: "writer", task: "raw task that should stay in expanded detail", progress: { status: "running", index: 1, agent: "writer", toolCount: 7, tokens: 0, durationMs: 2_000 } },
			],
			workflowGraph,
		},
	} as never, { expanded: false }, theme as any));

	assert.match(text, /1\/2 done · 1 active/);
	assert.match(text, /✓ inventory/);
	assert.match(text, /writers 1 active/);
	assert.match(text, /Press configured-expand-key for live detail/);
	assert.doesNotMatch(text, /Fleet/);
	assert.doesNotMatch(text, /Step \d\/\d|task:|workspace:|ref:|out(?:put)?:/i);
});

test("compact multi-result rendering shows total cost in the header", () => {
	const text = componentText(renderSubagentResult({
		content: [{ type: "text", text: "done" }],
		details: {
			mode: "workflow",
			results: [result("scout", "a"), result("reviewer", "b")],
			totalCost: { inputTokens: 30, outputTokens: 12, costUsd: 0.04 },
		},
	}, { expanded: false }, theme as any));

	assert.match(text, /\/2 done/);
	assert.match(text, /in:30 out:12 \$0\.0400/);
});

test("expanded simple chain summaries strip repeated agent prefixes", () => {
	const expanded = componentText(renderSubagentResult({
		content: [{ type: "text", text: "done" }],
		details: {
			mode: "chain",
			chainAgents: ["chain-label"],
			totalSteps: 1,
			results: [{ ...result("worker", "done"), sessionName: "  worker: named task  " }],
		},
	}, { expanded: true }, theme as any));
	assert.match(expanded, /named task/);
	assert.doesNotMatch(expanded, /worker:\s+named task/);
	assert.doesNotMatch(expanded, /Step 1\/1/);
});

test("main-window renderer config removes compact result indentation without changing status glyphs", () => {
	const component = renderSubagentResult({
		content: [{ type: "text", text: "done" }],
		details: {
			mode: "workflow",
			results: [result("scout", "a"), { ...result("reviewer", ""), exitCode: 1, error: "failed" }],
		},
	}, { expanded: false }, theme as any, undefined, { horizontalSpacing: 0 });

	const text = componentText(component);
	assert.match(text, /^✗ workflow/m);
	assert.match(text, /reviewer task/);
	assert.match(text, /error:failed/);
});

test("main-window renderer config caps only collapsed rich result rows", () => {
	const rendered = renderSubagentResult({
		content: [{ type: "text", text: "done" }],
		details: {
			mode: "parallel",
			results: [
				result("scout", "a"),
				result("reviewer", "b"),
				result("writer", "c"),
			],
		},
	}, { expanded: false }, theme as any, undefined, { compactResultMaxLines: 3 }).render(120);

	assert.equal(rendered.length, 3);
	assert.match(rendered[2]!, /rows hidden/);

	const expanded = renderSubagentResult({
		content: [{ type: "text", text: "done" }],
		details: {
			mode: "parallel",
			results: [
				result("scout", "a"),
				result("reviewer", "b"),
				result("writer", "c"),
			],
		},
	}, { expanded: true }, theme as any, undefined, { compactResultMaxLines: 3 }).render(120);

	assert.ok(expanded.length > 3);
	assert.doesNotMatch(expanded.join("\n"), /rows hidden/);
});
