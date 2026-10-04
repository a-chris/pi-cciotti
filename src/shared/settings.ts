/**
 * Chain behavior, template resolution, and directory management
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

// =============================================================================
// Chain Step Types
// =============================================================================

/** Sequential step: single agent execution */
export interface SequentialStep {
	agent: string;
	task?: string;
	phase?: string;
	label?: string;
	as?: string;
	outputSchema?: JsonSchemaObject | false;
	cwd?: string;
	output?: OutputOverrideInput;
	outputMode?: OutputMode;
	reads?: string[] | false;
	progress?: boolean;
	skill?: string | string[] | false;
	model?: string;
	fast?: boolean;
	toolBudget?: ToolBudgetConfig;
	acceptance?: AcceptanceInput;
	agentContract?: AgentContract;
	gateOn?: ChainGateLayer;
	/** Internal workflow child isolation; public workflowScript supplies this on runs.run. */
	worktree?: boolean;
}

/** Parallel task item within a parallel step */
export interface ParallelTaskItem {
	agent: string;
	task?: string;
	phase?: string;
	label?: string;
	as?: string;
	outputSchema?: JsonSchemaObject | false;
	cwd?: string;
	count?: number;
	output?: OutputOverrideInput;
	outputMode?: OutputMode;
	reads?: string[] | false;
	progress?: boolean;
	skill?: string | string[] | false;
	model?: string;
	fast?: boolean;
	toolBudget?: ToolBudgetConfig;
	acceptance?: AcceptanceInput;
	agentContract?: AgentContract;
	gateOn?: ChainGateLayer;
}

export interface DynamicExpandSpec {
	from: {
		output: string;
		path: string;
	};
	item?: string;
	key?: string;
	maxItems?: number;
	onEmpty?: "skip" | "fail";
}

export type DynamicParallelTemplate = Omit<ParallelTaskItem, "as" | "count">;

export interface DynamicCollectSpec {
	as: string;
	outputSchema?: JsonSchemaObject;
}

export interface DynamicParallelStep {
	expand: DynamicExpandSpec;
	parallel: DynamicParallelTemplate;
	collect: DynamicCollectSpec;
	concurrency?: number;
	failFast?: boolean;
	phase?: string;
	label?: string;
	acceptance?: AcceptanceInput;
	agentContract?: AgentContract;
	gateOn?: ChainGateLayer;
}

/** Parallel step: multiple agents running concurrently */
export interface ParallelStep {
	parallel: ParallelTaskItem[];
	concurrency?: number;
	failFast?: boolean;
	worktree?: boolean;
	cwd?: string;
	agentContract?: AgentContract;
	gateOn?: ChainGateLayer;
}

/** Union type for chain steps */
export type ChainStep = SequentialStep | ParallelStep | DynamicParallelStep;

// =============================================================================
// Type Guards
// =============================================================================

export function isParallelStep(step: ChainStep): step is ParallelStep {
	return "parallel" in step && Array.isArray((step as ParallelStep).parallel);
}

export function isDynamicParallelStep(step: ChainStep): step is DynamicParallelStep {
	return "expand" in step && "collect" in step && "parallel" in step && !Array.isArray((step as { parallel?: unknown }).parallel);
}

/** Get all agent names in a step (single for sequential, multiple for parallel) */
export function getStepAgents(step: ChainStep): string[] {
	if (isParallelStep(step)) {
		return step.parallel.map((t) => t.agent);
	}
	if (isDynamicParallelStep(step)) {
		return [step.parallel.agent];
	}
	return [step.agent];
}

// =============================================================================
// Chain Directory Management
// =============================================================================

// The chain subsystem was removed; chain-dir management helpers were deleted with it.

// =============================================================================
// Template Resolution
// =============================================================================

// Chain template resolution was removed with the chain subsystem.

// =============================================================================
// Chain Instruction Reading
// =============================================================================

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
