import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNestedChildHealthMonitor } from "../../src/runs/background/child-health-monitor.ts";
import { DEFAULT_CONTROL_CONFIG } from "../../src/runs/shared/subagent-control.ts";
import type { AsyncJobState, NestedRunSummary } from "../../src/shared/types.ts";

type KillFn = (pid: number, signal?: NodeJS.Signals | 0) => boolean;

const NOW = 10_000;
const MINUTE = 60_000;

/**
 * A live descendant that has been quiet for 90s (past the default 60s window),
 * with no self-reported verdict of any kind: the monitor must derive the stall
 * itself from these facts.
 */
function nested(overrides: Partial<NestedRunSummary> = {}): NestedRunSummary {
	return {
		id: "child-1",
		parentRunId: "root-run",
		parentStepIndex: 0,
		depth: 1,
		path: [{ runId: "root-run", stepIndex: 0 }],
		state: "running",
		agent: "worker",
		pid: 4242,
		startedAt: NOW - 5 * MINUTE,
		lastUpdate: NOW - MINUTE,
		lastActivityAt: NOW - 90_000,
		turnCount: 3,
		toolCount: 7,
		currentPath: "src/app.ts",
		...overrides,
	};
}

function job(children: NestedRunSummary[] | undefined): AsyncJobState {
	return {
		asyncId: "root-run",
		asyncDir: "/tmp/async/root-run",
		status: "running",
		nestedChildren: children,
	};
}

function monitor(children: NestedRunSummary[] | undefined, options: { kill?: KillFn; intervalMs?: number; asyncId?: string } = {}) {
	let clock = NOW;
	const instance = createNestedChildHealthMonitor({
		now: () => clock,
		kill: options.kill ?? (() => true),
		...options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {},
	});
	const asyncId = options.asyncId ?? "root-run";
	return {
		observe: () => instance.observe(job(children)),
		reset: () => instance.reset(),
		forget: () => instance.forgetJob(asyncId),
		advance: (ms: number) => { clock += ms; },
	};
}

describe("nested child health monitor", () => {
	it("stays silent for a healthy fleet", () => {
		const subject = monitor([nested({ lastActivityAt: NOW })]);
		assert.deepEqual(subject.observe(), []);
	});

	it("reports a stalled descendant that never asked for attention", () => {
		// The core invariant: the parent's own per-minute check derives the stall
		// from status facts. No activityState flag, no self-report required.
		const subject = monitor([nested()]);
		const first = subject.observe();
		assert.equal(first.length, 1);
		assert.equal(first[0]!.type, "needs_attention");
		assert.equal(first[0]!.reason, "nested_idle");
		assert.equal(first[0]!.agent, "worker");
		assert.equal(first[0]!.runId, "root-run", "the owning background run is what run-scoped control resolves");
		assert.equal(first[0]!.nestedRunId, "child-1", "the nested child is named separately");
		assert.match(first[0]!.message, /no observed activity for 90s/);

		subject.advance(MINUTE);
		assert.deepEqual(subject.observe(), [], "an unchanged reason must not repeat");
		subject.advance(MINUTE);
		assert.deepEqual(subject.observe(), []);
	});

	it("ignores a stale self-reported flag over fresh activity", () => {
		// The projection cannot clear needs_attention once a child ever set it,
		// so the flag may read stalled while the child demonstrably works.
		const subject = monitor([nested({ activityState: "needs_attention", lastActivityAt: NOW })]);
		assert.deepEqual(subject.observe(), [], "fresh activity decides, whatever the stale flag says");
	});

	it("reports a dead runner even though the child cannot report itself", () => {
		const subject = monitor([nested()], { kill: (_pid, signal) => {
			if (signal === 0) throw Object.assign(new Error("no such process"), { code: "ESRCH" });
			return true;
		} });
		const [event] = subject.observe();
		assert.ok(event);
		assert.equal(event.reason, "nested_unreachable");
		assert.match(event.message, /runner process 4242 is gone/);
		assert.match(event.message, /still reports 'running'/);
	});

	it("distinguishes an unverifiable PID from a proven dead one", () => {
		const subject = monitor([nested()], { kill: (_pid, signal) => {
			if (signal === 0) throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
			return true;
		} });
		assert.match(subject.observe()[0]!.message, /cannot be confirmed alive/);
	});

	it("reports a wedge inside an open tool only past the open-tool window", () => {
		// Below activeNoticeAfterMs (default 240s) an open tool is still legitimate work.
		const toolFresh = monitor([nested({ currentTool: "bash", currentToolStartedAt: NOW - 90_000 })]);
		assert.deepEqual(toolFresh.observe(), []);

		const toolWedged = monitor([nested({ currentTool: "bash", currentToolStartedAt: NOW - 250_000 })]);
		const [event] = toolWedged.observe();
		assert.ok(event);
		assert.equal(event.reason, "tool_open_threshold");
		assert.match(event.message, /has had tool 'bash' open for 250s/);

		toolWedged.advance(MINUTE);
		assert.deepEqual(toolWedged.observe(), [], "and it is reported only once");
	});

	it("waits for the first turn before calling silence a stall", () => {
		// Shared rule with the child runners: a descendant that has not completed
		// a turn yet is starting up, not stuck.
		const subject = monitor([nested({ turnCount: 0 })]);
		assert.deepEqual(subject.observe(), []);
	});

	it("scales the quiet window by the child's thinking level", () => {
		// needsAttentionAfterMsIsExplicit is false by default, so high thinking
		// scales 60s to 300s - the same scaledNeedsAttentionAfterMs rule the
		// child's own runner applies.
		const subject = monitor([nested({ thinking: "high" })]);
		assert.deepEqual(subject.observe(), [], "90s of silence is inside the scaled 300s window");

		subject.advance(4 * MINUTE);
		const [event] = subject.observe();
		assert.ok(event, "silence beyond the scaled window is a stall");
		assert.match(event.message, /no observed activity for 330s/);
	});

	it("walks nested depth and carries the nesting trail", () => {
		const grandchild = nested({
			id: "child-2",
			agent: "reviewer",
			parentRunId: "child-1",
			depth: 2,
			path: [{ runId: "root-run", stepIndex: 0 }, { runId: "child-1", stepIndex: 0 }],
			pid: 99,
		});
		const parent = nested({ id: "child-1", agent: "planner", lastActivityAt: NOW, children: [grandchild] });
		const [event] = monitor([parent]).observe();
		assert.ok(event);
		assert.equal(event.agent, "reviewer");
		assert.equal(event.nestedRunId, "child-2");
		assert.equal(event.nestingPath?.length, 2);
		assert.match(event.message, /reviewer stopped making progress/);
		// The trail travels as structured addresses for the notice to render, so the
		// message stays free of duplicated nesting text and filesystem paths.
		assert.equal(JSON.stringify(event).includes("/tmp/"), false);
	});

	it("does not report descendants that already reached a terminal state", () => {
		for (const state of ["complete", "failed", "paused", "stopped"] as const) {
			assert.deepEqual(monitor([nested({ state })]).observe(), [], `${state} is the completion path's job`);
		}
	});

	it("re-reports when the reason changes from stalled to dead", () => {
		const child = nested();
		let alive = true;
		const subject = monitor([child], { kill: (_pid, signal) => {
			if (signal === 0 && !alive) throw Object.assign(new Error("no such process"), { code: "ESRCH" });
			return true;
		} });
		assert.equal(subject.observe()[0]?.reason, "nested_idle");
		subject.advance(MINUTE);
		alive = false;
		const [escalated] = subject.observe();
		assert.equal(escalated?.reason, "nested_unreachable");
	});

	it("treats a resumed descendant as a new episode", () => {
		const child = nested();
		const subject = monitor([child]);
		assert.equal(subject.observe()[0]?.reason, "nested_idle");

		// The child resumes work: each check sees activity advance past the report.
		subject.advance(MINUTE);
		child.lastActivityAt = NOW + MINUTE;
		assert.deepEqual(subject.observe(), [], "a working child is not reported");

		for (let minute = 2; minute <= 5; minute++) {
			subject.advance(MINUTE);
			child.lastActivityAt = NOW + minute * MINUTE;
			assert.deepEqual(subject.observe(), [], "no report while activity stays fresh");
		}

		// A genuine stall begins: activity froze 5 minutes before this check.
		subject.advance(5 * MINUTE);
		const [second] = subject.observe();
		assert.ok(second, "the second genuine stall must be reported, not deduped");
		assert.equal(second.reason, "nested_idle");
		assert.match(second.message, /no observed activity for 300s/);

		subject.advance(MINUTE);
		assert.deepEqual(subject.observe(), [], "and it is still reported only once");
	});

	it("keeps one job's check state when another job's check prunes its own", () => {
		// Two background jobs share one monitor; checking one must not clear the
		// report state of the other, or the other re-reports every minute.
		let clock = NOW;
		const instance = createNestedChildHealthMonitor({ now: () => clock, kill: () => true });
		const jobA = { ...job([nested()]), asyncId: "job-a", asyncDir: "/tmp/a" };
		const jobB = { ...job([nested({ id: "child-b" })]), asyncId: "job-b", asyncDir: "/tmp/b" };
		assert.equal(instance.observe(jobA).length, 1);
		assert.equal(instance.observe(jobB).length, 1);
		for (let round = 0; round < 3; round++) {
			clock += MINUTE;
			assert.deepEqual(instance.observe(jobA), [], "job A's unchanged reason stays deduped");
			assert.deepEqual(instance.observe(jobB), [], "even though job B was checked in between");
		}
	});

	it("forgets check state for a job that was cleaned up", () => {
		const child = nested();
		const subject = monitor([child]);
		assert.equal(subject.observe()[0]?.reason, "nested_idle");
		subject.advance(MINUTE);
		assert.deepEqual(subject.observe(), []);
		subject.forget();
		subject.advance(MINUTE);
		assert.equal(subject.observe()[0]?.reason, "nested_idle", "a forgotten job re-reads the projection");
	});

	it("reports status facts only, never child content", () => {
		const [event] = monitor([nested({ sessionFile: "/secret/child-session.jsonl" })]).observe();
		assert.ok(event);
		// A stall report is useful without the child's transcript, prompt, or output.
		// Pinning the key set is what keeps a future field from smuggling content in.
		assert.deepEqual(
			Object.keys(event).sort(),
			["agent", "currentPath", "elapsedMs", "message", "nestedRunId", "nestingPath", "reason", "runId", "to", "toolCount", "ts", "turns", "type"],
		);
		assert.equal(JSON.stringify(event).includes("/secret/"), false);
	});

	it("does not check before the interval elapses", () => {
		const subject = monitor([nested()], { intervalMs: 5_000 });
		assert.equal(subject.observe().length, 1);
		subject.advance(1_000);
		assert.deepEqual(subject.observe(), [], "the check must not run on every tracker tick");
		subject.advance(4_000);
		assert.equal(monitor([nested({ id: "child-2", agent: "builder" })]).observe().length, 1);
	});

	it("is inert when the operator silenced control notices", () => {
		const disabled = createNestedChildHealthMonitor({ controlConfig: { ...DEFAULT_CONTROL_CONFIG, enabled: false }, now: () => NOW });
		assert.deepEqual(disabled.observe(job([nested()])), []);
	});

	it("honours notifyOn so a filtered event type is not reported", () => {
		const idleOnly = createNestedChildHealthMonitor({
			controlConfig: { ...DEFAULT_CONTROL_CONFIG, notifyOn: [] },
			now: () => NOW,
		});
		assert.deepEqual(idleOnly.observe(job([nested()])), [], "notifyOn: [] silences needs_attention reports");
	});

	it("treats an unset control config as defaults, not as off", () => {
		// The factory contract is an *optional* ResolvedControlConfig: an absent
		// option must fall back to DEFAULT_CONTROL_CONFIG, not a bare `{}`.
		// A live-PID probe keeps this about the config default, not process state.
		const live: KillFn = () => true;
		const monitorOptions: Parameters<typeof createNestedChildHealthMonitor>[0] = { now: () => NOW, kill: live };
		const subject = createNestedChildHealthMonitor(monitorOptions);
		assert.equal(subject.observe(job([nested()]))[0]?.reason, "nested_idle");
		// Same for an explicitly passed undefined controlConfig.
		assert.equal(createNestedChildHealthMonitor({ controlConfig: undefined, now: () => NOW, kill: live }).observe(job([nested()]))[0]?.reason, "nested_idle");
	});

	it("forgets cadence and reasons on reset", () => {
		const child = nested();
		const subject = monitor([child]);
		assert.equal(subject.observe()[0]?.reason, "nested_idle");
		subject.reset();
		assert.equal(subject.observe()[0]?.reason, "nested_idle", "a reset monitor re-reads the projection from scratch");
	});
});
