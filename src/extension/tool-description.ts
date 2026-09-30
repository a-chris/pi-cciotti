/**
 * Model-facing tool descriptions: one short description per facade tool,
 * each at most 60 words. Depth lives in guide topics, reachable via the
 * subagent_control action:guide (e.g. tool-reference, workflows, agents).
 */

import { delegationLevelGuideline, type DelegationLevel } from "../policy/delegation-level.ts";

export const SUBAGENT_TOOL_PROMPT_SNIPPET = "For operator-requested delegation, use subagents; compose multi-child work in one workflow call.";

export interface SubagentToolPromptMetadata {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

/**
 * `config.delegationLevel` owns how eagerly to delegate, so the guideline is one
 * level-owned sentence rather than a fixed conservative rule plus an exception it
 * contradicts: choosing a level is itself the operator's standing instruction.
 */
export function buildSubagentToolPromptMetadata(delegationLevel?: DelegationLevel): SubagentToolPromptMetadata {
	return {
		promptSnippet: SUBAGENT_TOOL_PROMPT_SNIPPET,
		promptGuidelines: [delegationLevelGuideline(delegationLevel)],
	};
}

// A description states what the tool is for plus the policy the schema cannot
// carry. It must not gloss parameters: the schema ships in the same payload, so
// `async (background)` says the same thing twice per call, and anything already
// in `required` or an `enum` is a third copy. `subagent_control` used to
// enumerate its verbs verbatim; what stays is the read/mutate split, which an
// enum cannot express.
export const SUBAGENT_DELEGATION_DESCRIPTION = "Delegate one child agent for a focused task. Delegate only when authorized. Depth: guide topics tool-reference, agents.";

export const SUBAGENT_WORKFLOW_DESCRIPTION = "Run a multi-child workflow from a named resource or a script body, with bounded JSON args. Depth: guide topic workflows.";

export const SUBAGENT_CONTROL_DESCRIPTION = "Run and registry control. Omit action for status. resume, steer, stop, interrupt, and mission.create mutate; the remaining verbs read. Depth: guide topic tool-reference.";
