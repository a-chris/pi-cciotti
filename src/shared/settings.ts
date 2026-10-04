/**
 * Shared path resolution and progress-file helpers for subagent runs.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents, formatUnknownAgentError, unknownAgentDiagnosticContext, type AgentConfig, type AgentScope, type UnknownAgentDiagnosticContext } from "../agents/agents.ts";
import { normalizeSkillInput } from "../agents/skills.ts";
import { normalizeOutputOverride, type OutputOverrideInput, type ResolvedStepBehavior } from "../runs/shared/child-launch-plan.ts";
import { type AcceptanceInput, type AgentContract, type ChainGateLayer, type JsonSchemaObject, type OutputMode, type ToolBudgetConfig } from "./types.ts";
const INITIAL_PROGRESS_CONTENT = "# Progress\n\n## Status\nIn Progress\n\n## Tasks\n\n## Files Changed\n\n## Notes\n";

export {
	planChildLaunch,
	resolveStepBehavior,
	resolveTaskTextForFileUpdatePolicy,
	suppressProgressForReadOnlyTask,
	taskDisallowsFileUpdates,
} from "../runs/shared/child-launch-plan.ts";
export type { OutputOverrideInput, ResolvedStepBehavior, StepOverrides } from "../runs/shared/child-launch-plan.ts";

/**
 * Expand a leading `~`/`~/` to the user's home directory. Other forms (relative,
 * absolute, `~user/`) pass through unchanged.
 */
export function expandHomePath(filePath: string): string {
	if (filePath === "~") return os.homedir();
	if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
	return filePath;
}

/**
 * Resolve a file path: `~`/`~/` expand to home first, then absolute paths pass
 * through and relative paths get baseDir prepended.
 */
export function resolveTaskFilePath(filePath: string, baseDir: string): string {
	const expanded = expandHomePath(filePath);
	return path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded);
}

export function resolveExistingReadInstructionPaths(reads: readonly string[], instructionCwd: string, existenceCwd = instructionCwd): string[] {
	return reads.flatMap((filePath) => {
		const instructionPath = resolveTaskFilePath(filePath, instructionCwd);
		const existencePath = resolveTaskFilePath(filePath, existenceCwd);
		return fs.existsSync(existencePath) ? [instructionPath] : [];
	});
}

export function resolveExistingReadPaths(reads: readonly string[], cwd: string): string[] {
	return resolveExistingReadInstructionPaths(reads, cwd);
}

/**
 * Build chain instructions from resolved behavior.
 * These are appended to the task to tell the agent what to read/write.
 */
export function writeInitialProgressFile(progressDir: string): void {
	fs.mkdirSync(progressDir, { recursive: true });
	fs.writeFileSync(path.join(progressDir, "progress.md"), INITIAL_PROGRESS_CONTENT);
}
