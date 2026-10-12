import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerPinnedTool } from "../../extension/declaration-pinning.ts";
import { SubagentWaitParams } from "../../extension/schemas.ts";
import type { Details, SubagentState } from "../../shared/types.ts";
import { resolveWaitToolConfig, waitForSubagents } from "./subagent-wait.ts";
import type { WaitSubscriptionManager } from "./wait-subscriptions.ts";
import { finalizeToolResult } from "../../extension/tool-result.ts";

/**
 * Parent-only one-line escape hatch: ordinary async runs already notify this
 * session natively, so the model should not spend a call waiting. Folded verbatim
 * into `subagent`'s prepared description when the `bg_wait` declaration is hidden
 * (`src/extension/index.ts`), and kept out of the child description, where a
 * blocking wait is the correct behavior.
 */
export const PARENT_WAIT_ESCAPE_HATCH = "Ordinary async subagent runs already notify this session natively, so do not call this merely to wait on a child — return control instead.";

export function registerWaitTool(
	pi: ExtensionAPI,
	state: SubagentState,
	enabled = resolveWaitToolConfig().enabled,
	subscriptions?: Pick<WaitSubscriptionManager, "arm">,
	defaultTimeoutMs?: number,
	child?: { nestedRootRunId?: string },
): void {
	// One short description per tool; the wait-mode depth lives in the
	// `tool-reference` guide topic (docs/tool-reference.md) and the waitTool
	// configuration. The anti-overuse guardrail states ONCE, parent-only (a
	// child runtime has no native notifier, so telling a child to "return control"
	// would suppress the blocking wait it needs to collect its own descendants), and
	// `test/unit/schemas.test.ts` pins it as an exactly-once invariant across the
	// whole serialized tool surface. Four of the five parameter descriptions used to
	// repeat it too, which silently grew this one tool to 4,395 chars — 55% of the
	// parent tool surface — on every model call.
	const purpose = "Wait for background work that has no native completion notification: provider jobs, remembered detached foreground runs.";
	const policy = child
		? "This child runtime has no native completion notifier, so use a blocking bg_wait to collect owned descendants during this turn and read the result references before synthesizing. Draining at agent_end keeps owned work alive but does not synthesize results."
		: `${PARENT_WAIT_ESCAPE_HATCH} Call it only when this turn truly needs the result.`;
	const description = `${purpose}\n\n${policy}${enabled ? "" : "\n\nConfigured behavior: bg_wait is disabled by config.waitTool or PI_SUBAGENT_WAIT_TOOL_ENABLED and returns immediately without blocking."}\n\nDepth: guide topic tool-reference.`;
	const execute: ToolDefinition<typeof SubagentWaitParams, Details>["execute"] = async (_id, params, signal, onUpdate, ctx) => finalizeToolResult(await waitForSubagents(params, signal, {
		state,
		nestedRootRunId: child?.nestedRootRunId,
		events: pi.events,
		enabled,
		...(defaultTimeoutMs !== undefined ? { defaultTimeoutMs } : {}),
		onUpdate,
		...(subscriptions && ctx?.hasUI ? { subscribe: (input) => subscriptions.arm(input) } : {}),
	}));
	const primaryTool: ToolDefinition<typeof SubagentWaitParams, Details> = {
		name: "bg_wait",
		label: "Background Wait",
		description,
		parameters: SubagentWaitParams,
		execute,
	};
	registerPinnedTool(pi, primaryTool);
}
