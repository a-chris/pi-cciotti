/**
 * Nested-child health monitor.
 *
 * The async job tracker reads `subagent.control` events only for the top-level
 * run, so a nested (workflow or child-of-child) descendant that stalls, wedges
 * inside a tool, or loses its runner process produces no signal to the parent
 * orchestrator - its own self-report goes to a log nobody reads, and a dead or
 * wedged child may never write one at all. Its result also lands under
 * `results/nested/<root>/`, which the result watcher does not scan.
 *
 * This module therefore does not wait for a child to ask for attention: once
 * per minute it re-derives each live descendant's health from observable status
 * facts in the nested projection - recorded PID liveness, last observed
 * activity, open tool age - using the same primitives and windows the child
 * runners themselves use (`checkPidLiveness`, `deriveActivityState`,
 * `shouldEmitOpenToolAttention`, and the operator's `control` config). A report
 * names the owning background run and the descendant separately - the notice
 * routes its nudge at the nested child's own id and its run-scoped commands at
 * the owner - and carries identity and timing facts only; no child transcript,
 * prompt, or output is opened.
 */

import type { AsyncJobState, ControlEvent, NestedRunSummary, ResolvedControlConfig } from "../../shared/types.ts";
import { buildControlEvent, DEFAULT_CONTROL_CONFIG, deriveActivityState, shouldEmitOpenToolAttention, shouldNotifyControlEvent } from "../shared/subagent-control.ts";
import { checkPidLiveness } from "./stale-run-reconciler.ts";

/** One check per minute: a new stall or death reaches the parent within a minute of becoming observable. */
const CHECK_INTERVAL_MS = 60_000;

type PidProbe = (pid: number, signal?: NodeJS.Signals | 0) => boolean;

function labelOf(run: NestedRunSummary): string {
	return run.sessionName ?? run.agent ?? run.id;
}

function isLive(state: NestedRunSummary["state"]): boolean {
	return state === "running" || state === "queued";
}

interface ReportRecord {
	/** The most recently reported reason for this descendant, or undefined for none. */
	reason: string;
	/** The child's lastActivityAt at the time of that report; a later value means
	 * the child worked since, which ends the episode - a future stall is new. */
	lastActivityAt: number;
}

/** Depth-first walk of the nested projection in source order. */
function collectLiveDescendants(children: NestedRunSummary[] | undefined, out: NestedRunSummary[]): void {
	for (const run of children ?? []) {
		if (isLive(run.state)) out.push(run);
		collectLiveDescendants(run.children, out);
		for (const step of run.steps ?? []) collectLiveDescendants(step.children, out);
	}
}

/** The child's thinking level when the projection carries it; scaling only applies to the config default. */
function thinkingOf(run: NestedRunSummary): string | undefined {
	if (run.thinking) return run.thinking;
	return run.currentStep !== undefined ? run.steps?.[run.currentStep]?.thinking : undefined;
}

/**
 * Derive one descendant's health from observable status facts. Independent of
 * anything the child itself published as a verdict: a dead process is caught by
 * the PID probe, a wedge inside a tool by the open-tool window, and silence by
 * the activity window - all with the rules and thresholds the operator's
 * `control` config already defines for the children themselves.
 */
function healthEvent(run: NestedRunSummary, ownerRunId: string, ts: number, controlConfig: ResolvedControlConfig, kill?: PidProbe): ControlEvent | undefined {
	const agent = labelOf(run);
	const shared = {
		type: "needs_attention" as const,
		to: "needs_attention" as const,
		// The owning background run is what `subagent_control` resolves for
		// run-scoped commands; `nestedRunId` names the child the nudge routes to.
		runId: ownerRunId,
		agent,
		ts,
		turns: run.turnCount,
		toolCount: run.toolCount,
		currentTool: run.currentTool,
		currentPath: run.currentPath,
		nestedRunId: run.id,
		nestingPath: run.path,
	};
	if (run.pid !== undefined) {
		const liveness = checkPidLiveness(run.pid, kill);
		if (liveness === "dead") {
			return buildControlEvent({
				...shared,
				lastActivityAt: run.lastActivityAt,
				message: `${agent} is dead: runner process ${run.pid} is gone while the run still reports '${run.state}'`,
				reason: "nested_unreachable",
			});
		}
		if (liveness === "unknown") {
			return buildControlEvent({
				...shared,
				lastActivityAt: run.lastActivityAt,
				message: `${agent} cannot be confirmed alive: runner process ${run.pid} ownership is unverifiable`,
				reason: "nested_unreachable",
			});
		}
	}
	if (run.currentTool && run.currentToolStartedAt !== undefined
		&& shouldEmitOpenToolAttention({ config: controlConfig, currentTool: run.currentTool, currentToolStartedAt: run.currentToolStartedAt, now: ts })) {
		const openMs = Math.max(0, ts - run.currentToolStartedAt);
		return buildControlEvent({
			...shared,
			lastActivityAt: run.lastActivityAt,
			message: `${agent} has had tool '${run.currentTool}' open for ${Math.floor(openMs / 1000)}s`,
			reason: "tool_open_threshold",
			currentToolDurationMs: openMs,
		});
	}
	const state = deriveActivityState({
		config: controlConfig,
		startedAt: run.startedAt ?? ts,
		lastActivityAt: run.lastActivityAt,
		turnCount: run.turnCount,
		currentTool: run.currentTool,
		thinking: thinkingOf(run),
		now: ts,
	});
	if (state !== "needs_attention") return undefined;
	const lastActivity = run.lastActivityAt ?? run.startedAt ?? ts;
	const idleMs = Math.max(0, ts - lastActivity);
	return buildControlEvent({
		...shared,
		lastActivityAt: run.lastActivityAt,
		message: `${agent} stopped making progress: no observed activity for ${Math.floor(idleMs / 1000)}s`,
		reason: "nested_idle",
	});
}

export function createNestedChildHealthMonitor(options: {
	/** The operator's resolved control config. Its `enabled` and `notifyOn` gate
	 * these reports exactly as they gate the ones a child emits for itself, and
	 * its windows are the ones every check derives from. */
	controlConfig?: ResolvedControlConfig;
	/** Minimum gap between checks of one job's descendants. */
	intervalMs?: number;
	now?: () => number;
	kill?: PidProbe;
} = {}) {
	const controlConfig = options.controlConfig ?? DEFAULT_CONTROL_CONFIG;
	if (!controlConfig.enabled) return { observe: () => [], forgetJob: () => {}, reset: () => {} };
	const intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS;
	const now = options.now ?? (() => Date.now());
	const nextCheckAt = new Map<string, number>();
	// The check runs every minute so a new stall or death is surfaced within a
	// minute, but an unchanged reason is not restated each time: that would put
	// the same sentence in the parent's context once per minute per stuck child.
	// A descendant reports when it first turns unhealthy and again only when the
	// reason changes (stalled to dead, or into a tool wedge) or when a reported
	// stall ends - proven by activity advancing past the report - and a later
	// stall begins.
	const reportedReasons = new Map<string, ReportRecord>();

	return {
		observe(job: AsyncJobState): ControlEvent[] {
			const children = job.nestedChildren;
			if (!children?.length) return [];
			const ts = now();
			const due = nextCheckAt.get(job.asyncId);
			if (due !== undefined && ts < due) return [];
			nextCheckAt.set(job.asyncId, ts + intervalMs);

			const live: NestedRunSummary[] = [];
			collectLiveDescendants(children, live);
			const events: ControlEvent[] = [];
			const prefix = `${job.asyncId}:`;
			const seen = new Set<string>();
			for (const run of live) {
				const childKey = `${prefix}${run.id}`;
				seen.add(childKey);
				const event = healthEvent(run, job.asyncId, ts, controlConfig, options.kill);
				if (!event || !shouldNotifyControlEvent(controlConfig, event)) {
					// Activity that advanced past the report means the child worked
					// since; the episode is over and a later stall is reportable.
					const record = reportedReasons.get(childKey);
					if (record && run.lastActivityAt !== undefined && run.lastActivityAt > record.lastActivityAt) reportedReasons.delete(childKey);
					continue;
				}
				// buildControlEvent always materialises a reason; the type keeps it optional.
				const reason = event.reason ?? "idle";
				if (reportedReasons.get(childKey)?.reason === reason) continue;
				reportedReasons.set(childKey, { reason, lastActivityAt: run.lastActivityAt ?? ts });
				events.push(event);
			}
			// Only descendants this check actually walked may go; keys belonging to
			// other concurrently swept jobs survive untouched.
			for (const key of reportedReasons.keys()) if (key.startsWith(prefix) && !seen.has(key)) reportedReasons.delete(key);
			return events;
		},
		forgetJob(asyncId: string) {
			nextCheckAt.delete(asyncId);
			const prefix = `${asyncId}:`;
			for (const key of reportedReasons.keys()) if (key.startsWith(prefix)) reportedReasons.delete(key);
		},
		reset() {
			nextCheckAt.clear();
			reportedReasons.clear();
		},
	};
}
