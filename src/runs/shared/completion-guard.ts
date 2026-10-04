import type { Message } from "@earendil-works/pi-ai";
import type { TrackedMutationEvidence } from "../../shared/types.ts";
import { isMutatingTool } from "./long-running-guard.ts";

const READ_ONLY_BUILTIN_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"web_search",
	"fetch_content",
	"get_search_content",
	"source_check",
	"structured_output",
]);

// Cursor native edit/write often land as thinking traces (inactive_trace /
// transcript_trace) rather than toolCall parts when native tool replay is off
// or the tool is inactive in context. Match pi-cursor-sdk display labels.
const CURSOR_FILE_MUTATION_THINKING =
	/(?:^|\n)\s*Cursor (?:edit|write)\s*:/i;

export function completionGuardEnabled(agent: string, flag: boolean | undefined): boolean {
	return flag ?? agent === "worker";
}

export interface CompletionMutationGuardInput {
	expectsMutation: boolean;
	messages: Message[];
	tools?: string[];
	mcpDirectTools?: string[];
	mutationTools?: string[];
	toolAvailabilityError?: string;
	mutationEvidence?: TrackedMutationEvidence;
}

export interface CompletionMutationGuardResult {
	expectedMutation: boolean;
	attemptedMutation: boolean;
	triggered: boolean;
	blocked: boolean;
	message?: string;
}

export function hasMutationToolCapability(tools: string[] | undefined, mcpDirectTools: string[] | undefined): boolean {
	if ((mcpDirectTools?.length ?? 0) > 0) return true;
	if (tools === undefined) return true;
	return !tools.every((tool) => READ_ONLY_BUILTIN_TOOLS.has(tool));
}

export function validateImplementationToolContract(input: { agent: string; tools?: string[]; mcpDirectTools?: string[]; configuredExtensions?: string[]; requestedTools?: string[]; completionGuard?: boolean }): string | undefined {
	if (!completionGuardEnabled(input.agent, input.completionGuard)) return undefined;
	const requestedMutationTools = input.requestedTools?.filter((tool) => !READ_ONLY_BUILTIN_TOOLS.has(tool)) ?? [];
	const declaredMutationToolsWereRemoved = requestedMutationTools.length > 0 && !hasMutationToolCapability(input.tools, input.mcpDirectTools);
	const configuredExtensionCapability = (input.configuredExtensions?.length ?? 0) > 0 && !declaredMutationToolsWereRemoved;
	if (hasMutationToolCapability(input.tools, input.mcpDirectTools) || configuredExtensionCapability) return undefined;
	return `Agent '${input.agent}' has completionGuard enabled, but its tool allowlist has no mutation-capable tools. Add bash, edit, write, or another mutation-capable tool, or set completionGuard: false.`;
}

function hasCheckpointMutationEvidence(message: Message): boolean {
	const record = message as unknown as {
		role?: string;
		type?: string;
		customType?: unknown;
		data?: unknown;
		details?: unknown;
	};
	if ((record.role !== "custom" && record.type !== "custom") || record.customType !== "pi-checkpoint") return false;
	const details = typeof record.details === "object" && record.details !== null && !Array.isArray(record.details)
		? record.details as Record<string, unknown>
		: undefined;
	const data = typeof record.data === "object" && record.data !== null && !Array.isArray(record.data)
		? record.data as Record<string, unknown>
		: typeof details?.beforeCommit === "string" || typeof details?.afterCommit === "string"
			? details
			: details?.data && typeof details.data === "object" && !Array.isArray(details.data)
				? details.data as Record<string, unknown>
				: undefined;
	return typeof data?.beforeCommit === "string"
		&& typeof data.afterCommit === "string"
		&& data.beforeCommit !== data.afterCommit;
}

export function hasMutationToolCall(messages: Message[], mutationTools?: readonly string[]): boolean {
	for (const message of messages) {
		if (hasCheckpointMutationEvidence(message)) return true;
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "thinking" && CURSOR_FILE_MUTATION_THINKING.test(part.thinking)) return true;
			if (part.type !== "toolCall") continue;
			const args = typeof part.arguments === "object" && part.arguments !== null && !Array.isArray(part.arguments)
				? part.arguments as Record<string, unknown>
				: {};
			if (isMutatingTool(part.name, args, mutationTools)) return true;
		}
	}
	return false;
}

export function evaluateCompletionMutationGuard(input: CompletionMutationGuardInput): CompletionMutationGuardResult {
	const attemptedMutation = hasMutationToolCall(input.messages, input.mutationTools)
		|| input.mutationEvidence?.attemptedMutation === true;
	if (input.expectsMutation && input.toolAvailabilityError) {
		return { expectedMutation: true, attemptedMutation, triggered: false, blocked: true, message: input.toolAvailabilityError };
	}
	if (input.expectsMutation && !hasMutationToolCapability(input.tools, input.mcpDirectTools)) {
		return { expectedMutation: true, attemptedMutation, triggered: false, blocked: true,
			message: "completionGuard is enabled but the agent has no mutation-capable tools. Add a mutation tool or disable completionGuard." };
	}
	return { expectedMutation: input.expectsMutation, attemptedMutation,
		triggered: input.expectsMutation && !attemptedMutation, blocked: false };
}