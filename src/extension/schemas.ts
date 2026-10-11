/**
 * TypeBox schemas for subagent tool parameters.
 *
 * Two surfaces share this file:
 *  - the three model-facing facade tools (`SubagentDelegationParams`,
 *    `SubagentWorkflowParams`, `SubagentControlParams`) plus `SubagentWaitParams`;
 *  - `SubagentLaunchParams`, the single surviving launch schema from which the
 *    executor derives its internal `SubagentParamsLike` input type, and the
 *    per-RPC-method `Rpc*Params` allowlists compiled by `rpc.ts`.
 *
 * The RPC allowlists set `additionalProperties: false` so an unknown field is a
 * loud `invalid_params` rejection instead of a silently ignored key.
 */

import { Type } from "typebox";
import type { AcceptanceInput, JsonSchemaObject, ToolBudgetConfig } from "../shared/types.ts";
import type { ExtensionBindings } from "../runs/shared/extension-bindings.ts";
import { SUBAGENT_GUIDE_TOPICS } from "./subagent-guide.ts";

const SkillInput = Type.Unsafe<string | string[] | boolean>({
	anyOf: [
		{ type: "array", items: { type: "string" } },
		{ type: "boolean" },
		{ type: "string" },
	],
});

const OutputInput = Type.Unsafe<string | boolean>({
	anyOf: [
		{ type: "string" },
		{ type: "boolean" },
	],
});

const OutputModeInput = Type.Unsafe<"inline" | "file-only">({
	type: "string",
	enum: ["inline", "file-only"],
});

const ReadsInput = Type.Unsafe<string[] | false>({
	anyOf: [
		{ type: "array", items: { type: "string" } },
		{ type: "boolean" },
	],
});

const OutputSchemaInput = Type.Unsafe<JsonSchemaObject | false>({
	anyOf: [
		{ type: "object", additionalProperties: true },
		{ type: "boolean" },
	],
});

const AcceptanceInputSchema = Type.Unsafe<AcceptanceInput>({
	anyOf: [
		{ type: "string", enum: ["auto", "attested", "checked"] },
		{ type: "string", pattern: "^\\s*\\{" },
		{ type: "boolean" },
		{ type: "object", additionalProperties: true },
	],
});

const ArgsInput = Type.Unsafe<Record<string, unknown>>({
	type: "object",
	additionalProperties: true,
});

const ExtensionBindingsInput = Type.Unsafe<ExtensionBindings>({
	type: "object",
	additionalProperties: true,
});

const ToolBudgetInput = Type.Unsafe<ToolBudgetConfig>({
	type: "object",
	additionalProperties: true,
});

// Provider boolean branches intentionally overapproximate false-only runtime inputs.
// The mission object is validated loudly at the mission boundary.
const MissionLaunchOverride = Type.Unsafe({
	anyOf: [
		{ type: "object", additionalProperties: true },
		{ type: "boolean" },
	],
});

// ---------------------------------------------------------------------------
// The surviving launch schema.
//
// `SubagentLaunchParams` is the single named record of the executor's public
// launch surface: the model facade fields, the RPC control/status fields, and the
// per-child launch fields a workflowScript passes to a runs.run/runs.all child.
// The executor derives its `SubagentParamsLike` input type from it (plus a small
// internal extension type for host metadata that no public caller sets), so the
// three surfaces above cannot silently drift apart. It is NOT model-facing: the
// facade schemas below carry their own descriptions, and it is never compiled.
//
// `additionalProperties` stays open on purpose: internal callers widen the type
// through `SubagentParamsInternal`, not by smuggling extra runtime keys.
// ---------------------------------------------------------------------------
export const SubagentLaunchParams = Type.Object({
	// One-child execution and delegation.
	agent: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
	cwd: Type.Optional(Type.String()),
	async: Type.Optional(Type.Boolean()),
	output: Type.Optional(OutputInput),
	outputMode: Type.Optional(OutputModeInput),
	reads: Type.Optional(ReadsInput),
	prequel: Type.Optional(Type.String()),
	context: Type.Optional(Type.Unsafe<"fresh" | "fork" | "summary">({
		type: "string",
		enum: ["fresh", "fork", "summary"],
	})),
	worktree: Type.Optional(Type.Boolean()),
	baseRef: Type.Optional(Type.String()),
	gate: Type.Optional(Type.String()),
	// Per-call policy fields a workflow child may set; they are deliberately absent
	// from the model facade and the RPC allowlists (VISION: policy rides with the agent).
	model: Type.Optional(Type.String()),
	fast: Type.Optional(Type.Boolean()),
	skill: Type.Optional(SkillInput),
	outputSchema: Type.Optional(OutputSchemaInput),
	acceptance: Type.Optional(AcceptanceInputSchema),
	toolBudget: Type.Optional(ToolBudgetInput),
	extensionBindings: Type.Optional(ExtensionBindingsInput),
	toolTimeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
	maxRuntimeMs: Type.Optional(Type.Integer({ minimum: 1 })),
	checkpointBeforeDeadlineMs: Type.Optional(Type.Integer({ minimum: 1 })),
	// Workflow launch.
	workflow: Type.Optional(Type.String()),
	args: Type.Optional(ArgsInput),
	workflowScript: Type.Optional(Type.String()),
	workflowScriptPath: Type.Optional(Type.String()),
	// Control and status by run identity.
	action: Type.Optional(Type.String()),
	id: Type.Optional(Type.String()),
	runId: Type.Optional(Type.String()),
	dir: Type.Optional(Type.String()),
	index: Type.Optional(Type.Integer({ minimum: 0 })),
	view: Type.Optional(Type.Unsafe<"fleet" | "transcript">({
		type: "string",
		enum: ["fleet", "transcript"],
	})),
	lines: Type.Optional(Type.Integer({ minimum: 1 })),
	childId: Type.Optional(Type.String()),
	topic: Type.Optional(Type.String()),
	message: Type.Optional(Type.String()),
	mode: Type.Optional(Type.Unsafe<"steer" | "follow_up" | "auto">({
		type: "string",
		enum: ["steer", "follow_up", "auto"],
	})),
	mission: Type.Optional(MissionLaunchOverride),
});

// ---------------------------------------------------------------------------
// Per-RPC-method allowlists. Each is the complete set of fields that method
// accepts; anything else is rejected as an unknown field.
// ---------------------------------------------------------------------------

/** RPC `ping` takes no params; the empty object is still an allowlist, so unknown fields are rejected. */
export const RpcPingParams = Type.Object({}, { additionalProperties: false });

/** RPC `spawn` is async-only: `async: true` is accepted, `async: false` gets the detached-async error. */
export const RpcSpawnParams = Type.Object({
	agent: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
	cwd: Type.Optional(Type.String()),
	async: Type.Optional(Type.Boolean()),
	output: Type.Optional(OutputInput),
	outputMode: Type.Optional(OutputModeInput),
	reads: Type.Optional(ReadsInput),
	prequel: Type.Optional(Type.String()),
	worktree: Type.Optional(Type.Boolean()),
	baseRef: Type.Optional(Type.String()),
	workflow: Type.Optional(Type.String()),
	args: Type.Optional(ArgsInput),
	workflowScript: Type.Optional(Type.String()),
	workflowScriptPath: Type.Optional(Type.String()),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export const RpcStatusParams = Type.Object({
	id: Type.Optional(Type.String()),
	runId: Type.Optional(Type.String()),
	dir: Type.Optional(Type.String()),
	index: Type.Optional(Type.Integer({ minimum: 0 })),
	view: Type.Optional(Type.Unsafe<"fleet" | "transcript">({
		type: "string",
		enum: ["fleet", "transcript"],
	})),
	lines: Type.Optional(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

export const RpcSteerParams = Type.Object({
	message: Type.Optional(Type.String()),
	mode: Type.Optional(Type.Unsafe<"steer" | "follow_up" | "auto">({
		type: "string",
		enum: ["steer", "follow_up", "auto"],
	})),
	id: Type.Optional(Type.String()),
	runId: Type.Optional(Type.String()),
	dir: Type.Optional(Type.String()),
	index: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

/** `outputMode` is only an input so the file-only-only contract can be enforced with its own message. */
export const RpcResumeParams = Type.Object({
	message: Type.Optional(Type.String()),
	output: Type.Optional(Type.String()),
	outputMode: Type.Optional(OutputModeInput),
	id: Type.Optional(Type.String()),
	runId: Type.Optional(Type.String()),
	dir: Type.Optional(Type.String()),
	index: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

export const RpcInterruptParams = Type.Object({
	id: Type.Optional(Type.String()),
	runId: Type.Optional(Type.String()),
	dir: Type.Optional(Type.String()),
	index: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

export const RpcStopParams = Type.Object({
	id: Type.Optional(Type.String()),
	runId: Type.Optional(Type.String()),
	dir: Type.Optional(Type.String()),
	index: Type.Optional(Type.Integer({ minimum: 0 })),
	childId: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const RpcManageParams = Type.Object({
	action: Type.String(),
	id: Type.Optional(Type.String()),
}, { additionalProperties: false });

// ---------------------------------------------------------------------------
// Model-facing facade schemas: three small tools replace the single flat
// surface. Each is a plain object literal with its own facade-layer description.
// `async` and `worktree` are identical-meaning execution switches shared by the
// delegation and workflow facades; every other param lives on exactly one tool.
// ---------------------------------------------------------------------------

// --- subagent (delegate one child) -----------------------------------------
export const SubagentDelegationParams = Type.Object({
	task: Type.String({ description: "The action to do or problem to solve." }),
	agent: Type.String({ description: "One of the installed agent names (via subagent_control action:list). Required: no default agent exists." }),
	cwd: Type.Optional(Type.String({ description: "Working directory; default: session directory." })),
	// Was "default false", which is wrong: an omitted `async` resolves through
	// agent.defaultAsync then asyncByDefault, and resolveAsyncByDefault({}) === true,
	// so it runs in the BACKGROUND (docs/tool-reference.md says "default-on").
	async: Type.Optional(Type.Boolean({ description: "Run in the background. When omitted the run is background by default; set false to block the parent." })),
	output: Type.Optional(Type.Unsafe<string | boolean>({
		anyOf: [{ type: "string" }, { type: "boolean" }],
		description: "Durable result path, or false.",
	})),
	worktree: Type.Optional(Type.Boolean({ description: "Isolate in a managed git worktree; default false." })),
	prequel: Type.Optional(Type.String({ description: "Current state of the work and what led here — separate from task. Consumed when the agent's declared context mode is fork|summary; stays empty with fresh." })),
	reads: Type.Optional(Type.Array(Type.String(), { description: "Task-specific file paths the child reads before running; the agent's defaultReads still apply." })),
}, { required: ["task", "agent"] });

// --- subagent_workflow (run a workflow) ------------------------------------
export const SubagentWorkflowParams = Type.Object({
	workflow: Type.Optional(Type.String({ description: "Named workflow resource, e.g. \"review\", \"run-ci\", \"perl\" (unattended: plan then execute in one run), or \"perla\" (plan, stop for approval, then execute)." })),
	source: Type.Optional(Type.Unsafe<string | { path?: string }>({
		anyOf: [{ type: "string" }, { type: "object", properties: { path: { type: "string" } } }],
		description: "Inline script body, or { path } to a script file.",
	})),
	args: Type.Optional(Type.Unsafe<Record<string, unknown>>({ type: "object", description: "Bounded JSON inputs for the workflow." })),
	// Workflows are background UNLESS async:false (`asyncWorkflow = async !== false`).
	async: Type.Optional(Type.Boolean({ description: "Run in the background. When omitted the run is background by default; set false to block the parent." })),
	worktree: Type.Optional(Type.Boolean({ description: "Isolate in a managed git worktree; default false." })),
	baseRef: Type.Optional(Type.String({ description: "Branch/ref for worktree isolation." })),
});

// `validate` left this enum. Its only input is a script body, which lives on
// subagent_workflow (`source`); the static lint stays available through the RPC
// and preflight contract.
export const SUBAGENT_CONTROL_ACTIONS = [
	"status", "resume", "steer", "stop", "interrupt",
	"list", "get", "models", "guide", "mission.create",
] as const;

// --- subagent_control (control runs by id) --------------------------------
export const SubagentControlParams = Type.Object({
	id: Type.Optional(Type.String({ description: "Run id/prefix; required for run-targeting actions." })),
	action: Type.Optional(Type.String({ enum: [...SUBAGENT_CONTROL_ACTIONS], description: "What to do; omitted = status." })),
	message: Type.Optional(Type.String({ description: "Guidance for steer/resume." })),
	topic: Type.Optional(Type.String({ enum: [...SUBAGENT_GUIDE_TOPICS], description: "Guide topic served by the guide action. Omit to read the overview." })),
	agent: Type.Optional(Type.String({ description: "Agent name for `get` and `models`." })),
	mission: Type.Optional(Type.Unsafe({ ...MissionLaunchOverride, description: "Mission object for `mission.create`: `title` or `summary` (exactly one), optional `objective`, `goal: true` requires `budget.tokens`, optional `labels`." })),
});

export const SubagentWaitParams = Type.Object({
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
