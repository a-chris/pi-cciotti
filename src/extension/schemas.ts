/**
 * TypeBox schemas for subagent tool parameters
 */

import { Type, type TSchema } from "typebox";
import { SUBAGENT_GUIDE_TOPICS } from "./subagent-guide.ts";

function keepTopLevelParameterDescriptions<T>(schema: T): T {
	return pruneNestedDescriptions(schema, []) as T;
}

function pruneNestedDescriptions(value: unknown, path: string[]): unknown {
	if (!value || typeof value !== "object") return value;

	const result = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (key === "description" && !isTopLevelParameterDescription(path)) continue;
		if ("value" in descriptor) {
			const nextPath = typeof key === "string" ? [...path, key] : path;
			descriptor.value = pruneNestedDescriptions(descriptor.value, nextPath);
		}
		Object.defineProperty(result, key, descriptor);
	}
	return result;
}

function isTopLevelParameterDescription(path: string[]): boolean {
	return path.length === 2 && path[0] === "properties";
}

const SkillOverride = Type.Unsafe({
	anyOf: [
		{ type: "array", items: { type: "string" } },
		{ type: "boolean" },
		{ type: "string" },
	],
	description: "Skills: names/CSV/array; false disables, true uses default.",
});

const OutputModeOverride = Type.String({
	enum: ["inline", "file-only"],
	description: "Default inline; file-only requires output path.",
});

const JsonSchemaObject = Type.Unsafe({
	type: "object",
	additionalProperties: true,
	description: "Strict structured output; object-root JSON Schema only.",
});

const OutputSchemaOverride = Type.Unsafe({
	anyOf: [JsonSchemaObject, { type: "boolean" }],
	description: "Structured output schema override; false disables an agent default.",
});

// Provider boolean branches intentionally overapproximate false-only runtime inputs.
// Restricted function-declaration converters only support string enum members.
const AcceptanceOverride = Type.Unsafe({
	anyOf: [
		{ type: "string", enum: ["auto", "attested", "checked"] },
		{
			type: "string",
			enum: ["reviewed"],
			deprecated: true,
			description: "Invalid as an explicit policy. Recognized only so preflight can explain that reviewed is an achieved status.",
		},
		{
			type: "string",
			pattern: "^\\s*\\{",
		},
		{ type: "boolean" },
		{ type: "object", additionalProperties: true },
	],
	description: "Evidence policy; omit for read-only/review. false disables; true invalid. Prefer object; see guide tool-reference for levels, evidence and review.required.",
});

const AgentContractOverride = Type.Object({
	version: Type.Integer({ minimum: 1, maximum: 1, description: "Enable compatibility behavior for this run/child." }),
}, { additionalProperties: false, description: "Compatibility behavior. Omit for the default behavior." });

const ToolBudgetBlock = Type.Unsafe({
	anyOf: [
		{ type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
		{ type: "string", enum: ["*"] },
	],
});

const ToolBudgetOverride = Type.Object({
	soft: Type.Optional(Type.Integer({ minimum: 1 })),
	hard: Type.Integer({ minimum: 1 }),
	block: Type.Optional(ToolBudgetBlock),
}, { additionalProperties: false, description: "soft nudges; after hard, block tools (default read/grep/find/ls, '*' for all) so child can finalize." });

const WorkflowPreflightLane = Type.Object({
	key: Type.String({ minLength: 1, maxLength: 128 }),
	mode: Type.Optional(Type.String({ enum: ["mutation", "review", "scout", "gate"] })),
	decision: Type.Optional(Type.String({ maxLength: 256 })),
	claims: Type.Optional(Type.Array(Type.String({ maxLength: 256 }), { maxItems: 16 })),
	expectedOutput: Type.Optional(Type.String({ maxLength: 256 })),
	independence: Type.Optional(Type.String({ maxLength: 256 })),
}, { additionalProperties: false });

const WorkflowPreflightOverride = Type.Object({
	version: Type.Integer({ minimum: 1, maximum: 1 }),
	coverage: Type.Optional(Type.String({ enum: ["complete", "partial"] })),
	lanes: Type.Array(WorkflowPreflightLane, { maxItems: 64 }),
}, { additionalProperties: false, description: "Display-only planned workflow lanes; coverage mismatches warn, never change authority/execution." });

// Parallel task item (within a parallel step)
// Flattened so chain steps do not need an object-shape anyOf/oneOf union.
// Runtime mission handlers validate these untrusted nested objects loudly. Keeping
// their provider schema shallow avoids repeating a full durable-record schema in
// every tool request.
const MissionLaunchOverride = Type.Unsafe({
	anyOf: [
		{ type: "object", additionalProperties: true },
		{ type: "boolean" },
	],
});

const ControlOverrides = Type.Object({
	enabled: Type.Optional(Type.Boolean({ description: "Enable/disable subagent control attention tracking for this run" })),
	needsAttentionAfterMs: Type.Optional(Type.Integer({ minimum: 1, description: "No-observed-activity window before a run needs attention" })),
	activeNoticeAfterMs: Type.Optional(Type.Integer({ minimum: 1, description: "Active-long-running notice threshold by elapsed ms (default: 240000)" })),
	activeNoticeAfterTurns: Type.Optional(Type.Integer({ minimum: 1, description: "Optional active-long-running notice threshold by assistant turns (disabled by default)" })),
	activeNoticeAfterTokens: Type.Optional(Type.Integer({ minimum: 1, description: "Optional active-long-running notice threshold by total tokens (disabled by default)" })),
	failedToolAttemptsBeforeAttention: Type.Optional(Type.Integer({ minimum: 1, description: "Consecutive mutating-tool failures before escalating to needs_attention (default: 3)" })),
	notifyOn: Type.Optional(Type.Array(Type.String({ enum: ["active_long_running", "needs_attention"] }), {
		description: "Control event types that should notify the parent/orchestrator. Defaults to active_long_running and needs_attention.",
	})),
	notifyChannels: Type.Optional(Type.Array(Type.String({ enum: ["event", "async"] }), {
		description: "Notification channels to use when available. Defaults to event and async.",
	})),
});

const SubagentParamProperties = {
	agent: Type.Optional(Type.String({ description: "One-child agent or management target." })),
	task: Type.Optional(Type.String({ description: "One-child task; requires agent." })),
	extensionBindings: Type.Optional(Type.Unsafe({ type: "object", maxProperties: 16, additionalProperties: true, description: "Child-only bounded JSON; namespaces package.name/1." })),
	// Management action (when present, tool operates in management mode)
	action: Type.Optional(Type.String({ minLength: 1,
		description: "Management/control only; omit for execution. validate accepts either script input. Discover actions with guide topic tool-reference."
	})),
	capabilities: Type.Optional(Type.Boolean({ description: "list: compact capability rows/details without system prompts." })),
	id: Type.Optional(Type.String({
		description: "Run id/prefix for status/control."
	})),
	runId: Type.Optional(Type.String({
		description: "Target run ID; prefer id."
	})),
	dir: Type.Optional(Type.String({
		description: "Async directory for status/control."
	})),
	handoffPath: Type.Optional(Type.String({ description: "Existing manifest for worktree cleanup/discard actions." })),
	repo: Type.Optional(Type.String({ description: "worktree.cleanup repo; default cwd." })),
	index: Type.Optional(Type.Integer({ minimum: 0, description: "Zero-based child/transcript index." })),
	childId: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Child-scoped stop identity." })),
	view: Type.Optional(Type.String({
		enum: ["fleet", "transcript"],
		description: "status view: fleet overview or transcript tail with id/dir and optional index.",
	})),
	lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Transcript tail lines; default 80." })),
	topic: Type.Optional(Type.String({ enum: [...SUBAGENT_GUIDE_TOPICS], description: "Guide topic served by the guide action. Omit to read the overview." })),
	message: Type.Optional(Type.String({ description: "resume/steer guidance or a control action prompt." })),
	mode: Type.Optional(Type.String({ enum: ["steer", "follow_up", "auto", "plan", "apply"], description: "steer delivery mode; worktree.cleanup supports plan only, no apply/removal." })),
	steeringRecovery: Type.Optional(Type.Boolean({ description: "steer: pause/revive after missed acknowledgment; default true in direct steer mode, forced false by extension RPC for exact ownership." })),
	additional: Type.Optional(Type.Integer({ minimum: 1, description: "grant-spawn-budget: root interactive parent + native user confirmation only; total grants capped at original configured cap." })),
	focus: Type.Optional(Type.Boolean({ description: "Focus the inspector pane." })),
	mission: Type.Optional(Type.Unsafe({ ...MissionLaunchOverride, description: "false disables; true invalid. Object: exactly one non-empty title or summary; objective/labels optional; goal only true, requires budget.tokens." })),
	// Agent configuration for create/update (nested to avoid conflicts with execution fields)
	config: Type.Optional(Type.Unsafe({
		anyOf: [
			{ type: "object", additionalProperties: true },
			{ type: "string" },
		],
		description: "create/update agent config; object or JSON string."
	})),
	workflow: Type.Optional(Type.String({ minLength: 1, description: "Extension-owned workflow resource." })),
	args: Type.Optional(Type.Unsafe({ type: "object", maxProperties: 16, additionalProperties: true, description: "Bounded plain-JSON args for named, inline, or file-backed workflows; raw-script args are exposed deeply frozen and persisted, so do not include secrets." })),
	workflowScript: Type.Optional(Type.String({ minLength: 1, description: "Inline JavaScript statement body; raw/unknown provenance, no runs.host. Use explicit return and top-level await; see tool guidance/guide workflows." })),
	workflowScriptPath: Type.Optional(Type.String({ minLength: 1, description: "Raw script file; host reads from request cwd before sandbox. Mutually exclusive with workflowScript and workflow." })),
	globalConcurrencyLimit: Type.Optional(Type.Integer({ minimum: 1 })),
	maxSubagentSpawnsPerRun: Type.Optional(Type.Integer({ minimum: 1 })),
	preflight: Type.Optional(WorkflowPreflightOverride),
	isolation: Type.Optional(Type.String({ enum: ["none", "worktree"], description: "Shared cwd or managed git worktrees." })),
	worktree: Type.Optional(Type.Boolean({ description: "Isolate each workflow child in a managed git worktree; child worktree:false overrides default." })),
	baseRef: Type.Optional(Type.String()),
	context: Type.Optional(Type.String({
		enum: ["fresh", "fork", "summary"],
		description: "fresh/fork/summary overrides every child. Omitted: each agent's declared defaultContext applies, else fresh; implicit fork/summary needs persisted parent + leaf, else fresh. forkContext may prune forks before spawn; summary generates a role-directed brief from the parent session.",
	})),
	async: Type.Optional(Type.Boolean({ description: "Background; default asyncByDefault. false only to block parent." })),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Timeout. Foreground and single async runs use config timeoutMs, else 30m; async composites have no default parent deadline. Alias maxRuntimeMs." })),
	maxRuntimeMs: Type.Optional(Type.Integer({ minimum: 1, description: "Alias timeoutMs (same defaults)." })),
	checkpointBeforeDeadlineMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_147_483_647, description: "Async single-agent runs only: the runner requests that the child checkpoint and stop this many ms before the run deadline (best-effort; the deadline kill still applies)." })),
	toolTimeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Per-tool deadline (ms); fast builtins default 5m." })),
	toolBudget: Type.Optional(ToolBudgetOverride),
	agentScope: Type.Optional(Type.String({ description: "user/project/both (default); project wins collisions." })),
	cwd: Type.Optional(Type.String({ description: "Execution directory." })),
	artifacts: Type.Optional(Type.Boolean({ description: "Debug artifacts; default true." })),
	includeProgress: Type.Optional(Type.Boolean({ description: "Full result progress; default false." })),
	share: Type.Optional(Type.Boolean({ description: "Upload session to GitHub Gist; default false." })),
	sessionDir: Type.Optional(
		Type.String({ description: "Session log directory; default temp, independent of share." }),
	),
	control: Type.Optional(ControlOverrides),
	// Workflow defaults forwarded to each runs.run/runs.all child unless overridden there.
	output: Type.Optional(Type.Unsafe({
		anyOf: [
			{ type: "string" },
			{ type: "boolean" },
		],
		description: "Child output path or false; relative workflow paths use managed artifact routing. Bind durable output here, not task prose; return outputReference/outputPathMapping/artifactPaths.",
	})),
	outputMode: Type.Optional(OutputModeOverride),
	skill: Type.Optional(SkillOverride),
	model: Type.Optional(Type.String({ description: "Child model provider/id; bare id only if unique. Suffix :off/minimal/low/medium/high/xhigh/max overrides agent thinking default." })),
	fast: Type.Optional(Type.Boolean({ description: "Native OpenAI-Codex priority tier; default false, may cost more/quota." })),
	outputSchema: Type.Optional(OutputSchemaOverride),
	agentContract: Type.Optional(AgentContractOverride),
	acceptance: Type.Optional(AcceptanceOverride),
	gate: Type.Optional(Type.String({ minLength: 1, description: "Host gate command. Cannot be combined with acceptance; an explicit acceptance of false is treated as omitted." })),
};

const SubagentParamsSchema = Type.Object(SubagentParamProperties);

export const SubagentParams = keepTopLevelParameterDescriptions(SubagentParamsSchema);

export function createSubagentParamsSchema(): typeof SubagentParams {
	return SubagentParams;
}

// ---------------------------------------------------------------------------
// Model-facing facade schemas (M1): three small tools replace the single flat
// 81-param surface. Shared fields are DERIVED projections OF `SubagentParamProperties`
// BY REFERENCE so their types/shapes are single-sourced with the internal contract
// and can never drift. Description overrides are the facade layer and sit in one
// central place next to each facade (keepTopLevelParameterDescriptions ships only
// top-level descriptions). `async` and `worktree` are identical-meaning execution
// switches shared by the delegation and workflow facades; every other param lives
// on exactly one tool.
// ---------------------------------------------------------------------------

type PoolKey = keyof typeof SubagentParamProperties;

// Project one shared field FROM THE INTERNAL POOL BY REFERENCE so its type and
// shape are single-sourced with the internal contract and cannot drift. Return
// type preserves the pool field's own TypeBox schema type.
function poolField<K extends PoolKey>(key: K): (typeof SubagentParamProperties)[K] {
	return SubagentParamProperties[key];
}

// Clone a schema node preserving TypeBox metadata (incl. the optional marker),
// then set a fresh facade-level description. Shape stays identical to the pool;
// only the description is the facade layer.
function withFacadeDescription<T extends TSchema>(schemaNode: T, description: string): T {
	// SAFETY: schemaNode is always an object-shaped TypeBox schema node.
	const source = schemaNode as object;
	// SAFETY: cloning from the prototype yields the same schema shape; the cast
	// keeps the TypeBox schema type through descriptor-copy and re-description.
	const result = Object.create(Object.getPrototypeOf(source)) as T;
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor) {
			// SAFETY: the descriptor belongs to the source node; redefining it on the clone preserves non-enumerable TypeBox metadata.
			Object.defineProperty(result as object, key, descriptor);
		}
	}
	// SAFETY: re-adding an enumerable `description` is the facade layer on top of the internal shape.
	Object.defineProperty(result as object, "description", { value: description, enumerable: true, writable: true, configurable: true });
	return result;
}

// --- subagent (delegate one child) -----------------------------------------
// Central facade-layer descriptions: types come from the pool (poolField), and
// only descriptions (and the purely-facade prequel/reads fields) are authored here.
const delegationDescriptions = {
	task: "The action to do or problem to solve.",
	agent: "One of the installed agent names (via subagent_control action:list). Required: no default agent exists.",
	cwd: "Working directory; default: session directory.",
	async: "Background run; default false.",
	output: "Durable result path, or false.",
	worktree: "Isolate in a managed git worktree; default false.",
};
const delegationProperties = {
	task: withFacadeDescription(poolField("task"), delegationDescriptions.task),
	agent: withFacadeDescription(poolField("agent"), delegationDescriptions.agent),
	cwd: withFacadeDescription(poolField("cwd"), delegationDescriptions.cwd),
	async: withFacadeDescription(poolField("async"), delegationDescriptions.async),
	output: withFacadeDescription(poolField("output"), delegationDescriptions.output),
	worktree: withFacadeDescription(poolField("worktree"), delegationDescriptions.worktree),
	// Newly introduced fields, not on the internal contract yet (M2 wires prequel).
	prequel: Type.Optional(Type.String({ description: "Current state of the work and what led here — separate from task. Consumed when the agent's declared context mode is fork|summary; stays empty with fresh." })),
	reads: Type.Optional(Type.Array(Type.String(), { description: "Task-specific file paths the child reads before running; the agent's defaultReads still apply." })),
};
export const SubagentDelegationParams = keepTopLevelParameterDescriptions(Type.Object(delegationProperties, { required: ["task", "agent"] }));

// --- subagent_workflow (run a workflow) ------------------------------------
const workflowDescriptions = {
	workflow: "Named workflow resource, e.g. \"review\" or \"run-ci\".",
	source: "Inline script body, or { path } to a script file.",
	args: "Bounded JSON inputs for the workflow.",
	async: "Background run; default false.",
	worktree: "Isolate in a managed git worktree; default false.",
	baseRef: "Branch/ref for worktree isolation.",
};
const workflowProperties = {
	// Facade-layer fields: plan Target shapes differ from the pool for these.
	workflow: Type.Optional(Type.String({ description: workflowDescriptions.workflow })),
	source: Type.Optional(Type.Unsafe<string | { path?: string }>({ anyOf: [{ type: "string" }, { type: "object", properties: { path: { type: "string" } } }], description: workflowDescriptions.source })),
	args: Type.Optional(Type.Unsafe<object>({ type: "object", description: workflowDescriptions.args })),
	async: withFacadeDescription(poolField("async"), workflowDescriptions.async),
	worktree: withFacadeDescription(poolField("worktree"), workflowDescriptions.worktree),
	baseRef: withFacadeDescription(poolField("baseRef"), workflowDescriptions.baseRef),
};
export const SubagentWorkflowParams = keepTopLevelParameterDescriptions(Type.Object(workflowProperties));

// D10: `validate` left this enum. Its only input is a script body, which lives
// on subagent_workflow (`source`), so on this tool the verb could never receive
// what it needs; the static lint stays on the internal contract (RPC/preflight).
export const SUBAGENT_CONTROL_ACTIONS = [
	"status", "resume", "steer", "stop", "interrupt",
	"list", "get", "models", "guide", "mission.create",
] as const;

// --- subagent_control (control runs by id) --------------------------------
const controlDescriptions = {
	id: "Run id/prefix; required for run-targeting actions.",
	action: "What to do; omitted = status.",
	message: "Guidance for steer/resume.",
	topic: "Guide topic served by the guide action. Omit to read the overview.",
	agent: "Agent name for `get` and `models`.",
	mission: "Mission object for `mission.create`: `title` or `summary` (exactly one), optional `objective`, `goal: true` requires `budget.tokens`, optional `labels`.",
};
const controlProperties = {
	id: withFacadeDescription(poolField("id"), controlDescriptions.id),
	action: Type.Optional(Type.String({ enum: [...SUBAGENT_CONTROL_ACTIONS], description: controlDescriptions.action })),
	message: withFacadeDescription(poolField("message"), controlDescriptions.message),
	topic: withFacadeDescription(poolField("topic"), controlDescriptions.topic),
	// D10 drivable verbs: get/models read `agent`; mission.create reads `mission`.
	agent: withFacadeDescription(poolField("agent"), controlDescriptions.agent),
	mission: withFacadeDescription(poolField("mission"), controlDescriptions.mission),
};
export const SubagentControlParams = keepTopLevelParameterDescriptions(Type.Object(controlProperties));

const SubagentWaitParamsSchema = Type.Object({
	id: Type.Optional(Type.String({
		description: "Async run or remembered detached foreground run id/prefix to wait for one specific run. A named run that already finished returns its stored terminal result references. Omit to wait across every active async run started in this session.",
	})),
	nonBlocking: Type.Optional(Type.Boolean({
		description: "With id, resolve that run once, persist a wake subscription, and return immediately. The originating session is woken on completion, failure, attention, reconciliation failure, or timeout. Requires id, cannot be combined with all, and needs a long-lived interactive runtime - a blocking-only runtime errors instead. Armed subscriptions appear in status output and differ from waitTool.enabled=false, which returns immediately without registering any future wake.",
	})),
	all: Type.Optional(Type.Boolean({
		description: "Wait for every async run, provider item, and remembered detached foreground descendant that was active when the call began. Default false: return as soon as the first one finishes or needs attention. Ignored when id targets a single run.",
	})),
	timeoutMs: Type.Optional(Type.Integer({
		minimum: 1,
		description: "Give up waiting after this many milliseconds (the runs keep going regardless). Defaults to config waitTool.defaultTimeoutMs, then 1800000 (30 minutes). Window expiry is a non-error window_elapsed result naming the work still active.",
	})),
	stopOnAttention: Type.Optional(Type.Boolean({
		description: "Blocking waits stop when a run needs attention by default. Set false to keep waiting through idle or long-thinking attention.",
	})),
});

export const SubagentWaitParams = keepTopLevelParameterDescriptions(SubagentWaitParamsSchema);
