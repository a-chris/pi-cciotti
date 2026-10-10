import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleSubagentControlNotice } from "../../src/extension/control-notices.ts";
import type { ControlEvent, SubagentState } from "../../src/shared/types.ts";

function makeState(): SubagentState {
	return {
		baseCwd: "/tmp/project",
		currentSessionId: null,
		asyncJobs: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: { schedule: () => false, clear: () => {} },
	};
}

function needsAttentionEvent(overrides: Partial<ControlEvent> = {}): ControlEvent {
	return {
		type: "needs_attention",
		to: "needs_attention",
		ts: 1,
		runId: "run-1",
		agent: "worker",
		index: 0,
		message: "worker needs attention",
		reason: "idle",
		...overrides,
	};
}

function makeRecorder() {
	const sent: Array<{ message: unknown; options: unknown }> = [];
	return {
		sent,
		pi: {
			sendMessage(message: unknown, options: unknown) {
				sent.push({ message, options });
			},
		},
	};
}

describe("subagent control notice delivery", () => {
	it("delivers async needs-attention notices immediately", () => {
		const state = makeState();
		const recorder = makeRecorder();

		handleSubagentControlNotice({
			pi: recorder.pi,
			state,
			visibleControlNotices: new Set(),
			details: { source: "async", event: needsAttentionEvent() },
		});

		assert.equal(recorder.sent.length, 1);
		assert.deepEqual(recorder.sent[0]?.options, { triggerTurn: true });
	});

	it("delivers goal notices without starting a new turn", () => {
		const state = makeState();
		const recorder = makeRecorder();

		handleSubagentControlNotice({
			pi: recorder.pi,
			state,
			visibleControlNotices: new Set(),
			details: { source: "goal", event: needsAttentionEvent(), noticeText: "Goal is ready." },
		});

		assert.equal(recorder.sent.length, 1);
		assert.deepEqual(recorder.sent[0]?.options, { triggerTurn: false });
	});

	it("reports a nested descendant without waking the parent by default", () => {
		const recorder = makeRecorder();

		handleSubagentControlNotice({
			pi: recorder.pi,
			state: makeState(),
			visibleControlNotices: new Set(),
			details: { source: "nested", event: needsAttentionEvent({ reason: "nested_idle" }) },
		});

		assert.equal(recorder.sent.length, 1, "the operator still sees the stall");
		assert.deepEqual(recorder.sent[0]?.options, { triggerTurn: false }, "a nested stall must not spend a parent turn unasked");
	});

	it("wakes the parent for a nested descendant when the operator opted in", () => {
		const recorder = makeRecorder();

		handleSubagentControlNotice({
			pi: recorder.pi,
			state: makeState(),
			visibleControlNotices: new Set(),
			details: { source: "nested", wakeParent: true, event: needsAttentionEvent({ reason: "nested_unreachable" }) },
		});

		assert.deepEqual(recorder.sent[0]?.options, { triggerTurn: true });
	});

	it("delivers both siblings of a shared owning run without dedupe collision", () => {
		// A nested event's runId is the owning run; delivery dedupes by event key
		// per session, so two stalling siblings must differ on the nested id.
		const recorder = makeRecorder();
		const shared = new Set<string>();
		const sibling = (nestedRunId: string, agent: string) => needsAttentionEvent({ index: undefined, reason: "nested_idle", agent, nestedRunId });

		handleSubagentControlNotice({ pi: recorder.pi, state: makeState(), visibleControlNotices: shared, details: { source: "nested", event: sibling("child-a", "builder") } });
		handleSubagentControlNotice({ pi: recorder.pi, state: makeState(), visibleControlNotices: shared, details: { source: "nested", event: sibling("child-b", "tester") } });
		handleSubagentControlNotice({ pi: recorder.pi, state: makeState(), visibleControlNotices: shared, details: { source: "nested", event: sibling("child-a", "builder") } });

		assert.equal(recorder.sent.length, 2, "each sibling is delivered once, and the repeat is deduped");
	});

	it("does not queue a foreground notice that Pi could flush after completion", () => {
		const state = makeState();
		state.foregroundControls.set("run-1", {
			runId: "run-1",
			mode: "parallel",
			startedAt: 0,
			updatedAt: 0,
			currentAgent: "worker",
			currentIndex: 0,
			currentActivityState: "needs_attention",
		});
		const queued: Array<{ message: unknown; options: unknown }> = [];
		const visible: Array<{ message: unknown; options: unknown }> = [];
		const pi = {
			sendMessage(message: unknown, options: unknown) {
				queued.push({ message, options });
			},
		};

		handleSubagentControlNotice({
			pi,
			state,
			visibleControlNotices: new Set(),
			details: { source: "foreground", event: needsAttentionEvent() },
		});
		state.foregroundControls.delete("run-1");
		visible.push(...queued);

		assert.deepEqual(visible, []);
	});
});
