const PROMPT_REDACTED_LABEL = "[prompt redacted]";

const MAX_STATUS_STEP_DESCRIPTION_CHARS = 160;

/** Bounded one-line per-step task description persisted into status.json for fleet display. */
export function statusStepDescription(task: string | undefined): string | undefined {
	if (!task?.trim()) return undefined;
	return PROMPT_REDACTED_LABEL.length > MAX_STATUS_STEP_DESCRIPTION_CHARS
		? `${PROMPT_REDACTED_LABEL.slice(0, MAX_STATUS_STEP_DESCRIPTION_CHARS - 1)}…`
		: PROMPT_REDACTED_LABEL;
}

export type ResolvedRunnerConfig = import("../../shared/types.ts").AgentRunnerConfig;

export interface RunnerSubagentStep {
	/** Session id of the direct parent session for permission-system ask forwarding. */
	parentSessionId?: string;
	/** Resolved opt-in rules for native Pi child tool calls. */
	permissionRules?: import("./permissions.ts").PermissionRules;
	agent: string;
	/** Human-readable display name for the child session, derived internally at launch. */
	sessionName?: string;
	task: string;
	runner?: ResolvedRunnerConfig;
	externalJobFollowUp?: {
		sourceRunId: string;
		sourceStepIndex: number;
		parentProviderJobId: string;
		requestId: string;
		requestDigest: string;
	};
	/** Resolved launch context for this child. */
	context?: "fresh" | "fork" | "summary";
	importAsyncRoot?: {
		runId: string;
		asyncDir: string;
		resultPath: string;
		index: number;
	};
	phase?: string;
	label?: string;
	outputName?: string;
	structured?: boolean;
	cwd?: string;
	/** Original cwd input retained for launch diagnostics. */
	requestedCwd?: string;
	model?: string;
	contextLimit?: number;
	fast?: boolean;
	thinking?: string;
	thinkingCeiling?: import("../../shared/model-info.ts").ThinkingLevel;
	modelCandidates?: string[];
	requestedModel?: string;
	/** The primary model is inherited from the parent session and should not be verified against the child-reported active registry model. */
	skipPrimaryModelVerification?: boolean;
	modelVerificationRegistry?: Array<{ provider: string; id: string; fullId: string; contextWindow?: number }>;
	modelResponseAliases?: Record<string, string[]>;
	tools?: string[];
	excludeTools?: string[];
	extensions?: string[];
	subagentOnlyExtensions?: string[];
	/** Private immutable host policy snapshot serialized to the native runner. */
	requiredExtensions?: import("../../shared/required-child-extensions.ts").RequiredChildExtensionSnapshot;
	mcpDirectTools?: string[];
	mutationTools?: string[];
	completionGuard?: boolean;
	systemPrompt?: string | null;
	systemPromptMode?: "append" | "replace";
	inheritProjectContext: boolean;
	inheritGlobalContext: boolean;
	inheritSkills: boolean;
	skills?: string[];
	outputPath?: string;
	outputClaimPath?: string;
	/** Defer the authoritative output instruction until a dynamic fanout item is materialized. */
	namespaceOutputPath?: boolean;
	outputMode?: "inline" | "file-only";
	sessionFile?: string;
	timeoutMs?: number;
	/** Resolved configured hard per-tool-call timeout (ms); fast tools still have a default when undefined. */
	toolTimeoutMs?: number;
	waitToolEnabled?: boolean;
	waitToolDefaultTimeoutMs?: number;
	structuredOutput?: import("./structured-output.ts").StructuredOutputRuntime;
	structuredOutputSchema?: import("../../shared/types.ts").JsonSchemaObject;
	definitionDigest?: string;
	launchBindingTask?: string;
	launchContractDigest?: string;
	extensionBindings?: import("./extension-bindings.ts").ExtensionBindings;
	launchResolvedExtensions?: import("../../shared/types.ts").LaunchResolvedChildExtensions;
	runtimeAcknowledgedExtensions?: import("../../shared/types.ts").RuntimeAcknowledgedChildExtensions;
	effectiveAcceptance?: import("../../shared/types.ts").ResolvedAcceptanceConfig;
	acceptanceInput?: import("../../shared/types.ts").AcceptanceInput;
	acceptanceRole?: import("../../shared/types.ts").AcceptanceRole;
	toolBudget?: import("../../shared/types.ts").ResolvedToolBudget;
	capabilityCeiling?: import("./capability-ceiling.ts").ResolvedSubagentCapabilityCeiling;
	capabilityAudit?: import("./capability-ceiling.ts").SubagentCapabilityAudit;
	/** Private stable logical-child path for inherited run fan-out accounting. */
	runFanoutPath?: string;
	/** Run this single child in one managed worktree. */
	worktree?: boolean;
}

export type RunnerStep = RunnerSubagentStep;

export const DEFAULT_GLOBAL_CONCURRENCY_LIMIT = 20;

/**
 * A promise-based semaphore for limiting concurrent access across multiple
 * mapConcurrent calls within a single run. Enforces a global cap on the total
 * number of subagent tasks executing simultaneously, regardless of each step's
 * per-step concurrency limit.
 */
export class Semaphore {
	private available: number;
	private readonly queue: Array<() => void> = [];

	constructor(limit: number) {
		this.available = Math.max(1, Math.floor(limit) || 1);
	}

	acquire(): Promise<void> {
		if (this.available > 0) {
			this.available--;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.available++;
		}
	}
}

export async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, i: number) => Promise<R>,
	globalSemaphore?: Semaphore,
	/** Invoked after every worker has stopped, including workers outliving an early rejection. */
	onSchedulingSettled?: () => void,
): Promise<R[]> {
	const safeLimit = Math.max(1, Math.floor(limit) || 1);
	const results: R[] = new Array(items.length);
	let next = 0;
	let liveWorkers = Math.min(safeLimit, items.length);
	const notifySchedulingSettled = () => {
		try {
			onSchedulingSettled?.();
		} catch {
			// Scheduling lifecycle cleanup must not replace the worker result.
		}
	};

	async function worker(_workerIndex: number): Promise<void> {
		try {
			while (next < items.length) {
				const i = next++;
				if (!(i in items)) throw new Error(`Missing parallel item at index ${i}`);
				const item = items[i] as T;
				if (globalSemaphore) {
					await globalSemaphore.acquire();
					try {
						results[i] = await fn(item, i);
					} finally {
						globalSemaphore.release();
					}
				} else {
					results[i] = await fn(item, i);
				}
			}
		} finally {
			liveWorkers--;
			if (liveWorkers === 0) notifySchedulingSettled();
		}
	}

	if (liveWorkers === 0) notifySchedulingSettled();
	await Promise.all(
		Array.from({ length: liveWorkers }, (_, wi) => worker(wi)),
	);
	return results;
}

