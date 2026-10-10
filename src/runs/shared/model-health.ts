import * as fs from "node:fs";
import * as path from "node:path";
import { writePrivateAtomicJson } from "../../shared/atomic-json.ts";
import { splitKnownThinkingSuffix } from "../../shared/model-info.ts";
import { TEMP_ROOT_DIR } from "../../shared/types.ts";

/**
 * How long a model with a retryable provider-style failure stays marked
 * unhealthy, so subsequent launches start at the next candidate instead of
 * re-paying one failed primary attempt per launch. After the TTL the model is
 * probed again automatically, which is how a recovered provider (topped-up
 * credits, expired rate window) is picked back up without a restart.
 */
export const UNHEALTHY_MODEL_TTL_MS = 30 * 60_000;

const MODEL_HEALTH_FILE = path.join(TEMP_ROOT_DIR, "model-health", "recent-failures.json");
const MAX_FAILURE_ENTRIES = 50;

interface ModelHealthStore {
	version: 1;
	failures: Record<string, { failedAt: number }>;
}

/**
 * Read the live failure marks. The file is shared by the parent process and
 * detached async runners (a runner marks the primary it failed on so the
 * parent's next launch sees it), so reads are best-effort and never throw.
 */
function readStore(now: number): Record<string, { failedAt: number }> {
	try {
		const parsed = JSON.parse(fs.readFileSync(MODEL_HEALTH_FILE, "utf-8")) as Partial<ModelHealthStore>;
		if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !parsed.failures || typeof parsed.failures !== "object") return {};
		const failures: Record<string, { failedAt: number }> = {};
		for (const [model, entry] of Object.entries(parsed.failures)) {
			if (!entry || typeof entry !== "object" || !Number.isFinite(entry.failedAt)) continue;
			const age = now - entry.failedAt;
			if (entry.failedAt > now || age >= UNHEALTHY_MODEL_TTL_MS) continue;
			failures[model] = { failedAt: entry.failedAt };
		}
		return failures;
	} catch {
		return {};
	}
}

/** True when the model recorded a retryable provider-style failure within the TTL. */
export function isUnhealthyModel(model: string, now = Date.now()): boolean {
	return Object.hasOwn(readStore(now), splitKnownThinkingSuffix(model).baseModel);
}

/**
 * Record a retryable provider-style failure for one model so later launches
 * can start below it. Thinking suffixes are stripped so a failure of
 * `provider/model:high` also marks `provider/model`. Best-effort: a failed
 * write must never fail the run itself.
 */
export function recordUnhealthyModel(model: string | undefined, now = Date.now()): void {
	if (!model) return;
	const key = splitKnownThinkingSuffix(model).baseModel;
	try {
		const failures = readStore(now);
		failures[key] = { failedAt: now };
		const pruned = Object.entries(failures)
			.sort(([, a], [, b]) => b.failedAt - a.failedAt)
			.slice(0, MAX_FAILURE_ENTRIES);
		writePrivateAtomicJson(MODEL_HEALTH_FILE, { version: 1, failures: Object.fromEntries(pruned) } satisfies ModelHealthStore);
	} catch {
		// Health marks are best-effort observability, not run state.
	}
}

/**
 * Drop leading unhealthy candidates — the head of the chain is what a launch
 * tries first — while at least one candidate remains. When every candidate is
 * marked (or the chain has one entry) the original order is kept, so an agent
 * without a fallback keeps its current behavior: one attempt per launch.
 */
export function trimUnhealthyLeadingCandidates<T extends string>(candidates: readonly T[]): T[] {
	if (candidates.length < 2) return [...candidates];
	const failures = readStore(Date.now());
	const marked = (model: string) => Object.hasOwn(failures, splitKnownThinkingSuffix(model).baseModel);
	// When every candidate is marked there is nothing to skip to; keep the
	// canonical order so the TTL probe sequence stays predictable.
	if (!candidates.some((candidate) => !marked(candidate))) return [...candidates];
	const trimmed = [...candidates];
	while (trimmed.length > 1 && marked(trimmed[0]!)) trimmed.shift();
	return trimmed;
}

/** Clear every failure mark (test hygiene and operator reset). */
export function clearModelHealth(): void {
	try {
		fs.rmSync(MODEL_HEALTH_FILE, { force: true });
	} catch {
		// Best-effort cleanup.
	}
}
