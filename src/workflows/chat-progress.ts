import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Details, WorkflowPreflightLane, WorkflowPreflight } from "../shared/types.ts";
import { workflowPreflightLaneForRuntimeKey } from "./workflow-preflight.ts";

export type ResolvedWorkflowChatProgressMode = "live-card" | "off";

export interface GitRepositoryIdentity {
	root: string;
	commonDir: string;
}

export interface WorkflowChatProgressProjection {
	mode: ResolvedWorkflowChatProgressMode;
	repoRelation: "same" | "other";
	repoLabel?: string;
}

interface ResolveWorkflowChatProgressInput {
	parentCwd: string;
	workflowCwd: string;
	background: boolean;
}

function git(cwd: string, args: string[]): string | undefined {
	const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8", windowsHide: true });
	if (result.status !== 0) return undefined;
	const output = result.stdout.trim();
	return output || undefined;
}

function realPath(value: string): string {
	try {
		return fs.realpathSync.native(value);
	} catch {
		return path.resolve(value);
	}
}

export function resolveGitRepositoryIdentity(cwd: string): GitRepositoryIdentity | undefined {
	if (git(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") return undefined;
	const root = git(cwd, ["rev-parse", "--show-toplevel"]);
	const commonDir = git(cwd, ["rev-parse", "--git-common-dir"]);
	if (!root || !commonDir) return undefined;
	const commonDirPath = path.isAbsolute(commonDir)
		? commonDir
		: [path.resolve(cwd, commonDir), path.resolve(root, commonDir)].find((candidate) => fs.existsSync(candidate)) ?? path.resolve(root, commonDir);
	return {
		root: realPath(root),
		commonDir: realPath(commonDirPath),
	};
}

function isSameGitRepositoryIdentity(left: GitRepositoryIdentity | undefined, right: GitRepositoryIdentity | undefined): boolean {
	if (!left || !right) return false;
	return left.commonDir === right.commonDir || left.root === right.root;
}

export function isSameGitRepository(leftCwd: string, rightCwd: string): boolean {
	return isSameGitRepositoryIdentity(resolveGitRepositoryIdentity(leftCwd), resolveGitRepositoryIdentity(rightCwd));
}

/**
 * Derives the chat projection for a workflow run. There is no per-call override:
 * a watched foreground workflow in the same Git repository gets the live card,
 * everything else renders nothing inline.
 */
export function resolveWorkflowChatProgress(input: ResolveWorkflowChatProgressInput): WorkflowChatProgressProjection {
	const parentIdentity = resolveGitRepositoryIdentity(input.parentCwd);
	const workflowIdentity = resolveGitRepositoryIdentity(input.workflowCwd);
	const sameRepo = !!(
		parentIdentity
		&& workflowIdentity
		&& (parentIdentity.commonDir === workflowIdentity.commonDir || parentIdentity.root === workflowIdentity.root)
	);
	const repoLabel = workflowIdentity ? path.basename(workflowIdentity.root) : undefined;
	const repoRelation = sameRepo ? "same" : "other";

	const mode: ResolvedWorkflowChatProgressMode = sameRepo && !input.background ? "live-card" : "off";
	const projection: WorkflowChatProgressProjection = { mode, repoRelation };
	if (repoLabel !== undefined) projection.repoLabel = repoLabel;
	return projection;
}

export interface WorkflowChatProgressRow {
	key: string;
	state: "planned" | "running" | "complete" | "failed" | "detached" | "stopped";
	label?: string;
	phase?: string;
	runId?: string;
	durationMs?: number;
	error?: string;
	preflight?: WorkflowPreflightLane;
}

function cleanLabel(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function buildWorkflowChatProgressRows(trace: NonNullable<Details["workflow"]>["trace"], preflight?: WorkflowPreflight): WorkflowChatProgressRow[] {
	const rows = new Map<string, WorkflowChatProgressRow>();
	for (const entry of trace) {
		if (entry.operation !== "run") continue;
		const existing = rows.get(entry.key);
		if (entry.state === "reused") {
			if (existing) {
				const label = cleanLabel(entry.label);
				const phase = cleanLabel(entry.phase);
				if (label) existing.label = label;
				if (phase) existing.phase = phase;
			}
			continue;
		}
		const lane = workflowPreflightLaneForRuntimeKey(preflight, entry.key);
		const next: WorkflowChatProgressRow = existing ?? { key: entry.key, state: "running" };
		if (lane && !next.preflight) next.preflight = lane;
		next.state = entry.state === "completed"
			? "complete"
			: entry.state === "failed"
				? "failed"
				: entry.state === "detached"
					? "detached"
					: entry.state === "stopped"
						? "stopped"
						: "running";
		const label = cleanLabel(entry.label);
		const phase = cleanLabel(entry.phase);
		if (label) next.label = label;
		if (phase) next.phase = phase;
		if (entry.runId === undefined) delete next.runId;
		else next.runId = entry.runId;
		if (entry.durationMs === undefined) delete next.durationMs;
		else next.durationMs = entry.durationMs;
		if (entry.error === undefined) delete next.error;
		else next.error = entry.error;
		rows.set(entry.key, next);
	}
	return [...rows.values()];
}
