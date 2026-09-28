import {
	SUBAGENT_DELEGATION_CANCEL_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	SUBAGENT_DELEGATION_STARTED_EVENT,
	SUBAGENT_DELEGATION_UPDATE_EVENT,
	type SubagentDelegationInvalidResponse,
	type SubagentDelegationResponse,
	type SubagentDelegationUpdate,
} from "../api/delegation.ts";
import { parseSubagentDelegationRequest } from "./delegation-request.ts";
import {
	parsePromptTemplateRequest,
	toSubagentDelegationExecutionParams,
	toSubagentDelegationResponse,
	toSubagentDelegationUpdate,
	type DelegatedSubagentExecutionParams,
	type PromptTemplateBridgeResult,
	type PromptTemplateDelegationResponse,
} from "./delegation-adapters.ts";

export const PROMPT_TEMPLATE_SUBAGENT_REQUEST_EVENT = SUBAGENT_DELEGATION_REQUEST_EVENT;
export const PROMPT_TEMPLATE_SUBAGENT_STARTED_EVENT = SUBAGENT_DELEGATION_STARTED_EVENT;
export const PROMPT_TEMPLATE_SUBAGENT_RESPONSE_EVENT = SUBAGENT_DELEGATION_RESPONSE_EVENT;
export const PROMPT_TEMPLATE_SUBAGENT_UPDATE_EVENT = SUBAGENT_DELEGATION_UPDATE_EVENT;
export const PROMPT_TEMPLATE_SUBAGENT_CANCEL_EVENT = SUBAGENT_DELEGATION_CANCEL_EVENT;

export interface PromptTemplateBridgeEvents {
	on(event: string, handler: (data: unknown) => void): (() => void) | void;
	emit(event: string, data: unknown): void;
}

interface PromptTemplateBridgeOptions<Ctx extends { cwd?: string }> {
	events: PromptTemplateBridgeEvents;
	getContext: () => Ctx | null;
	execute: (
		requestId: string,
		params: DelegatedSubagentExecutionParams,
		signal: AbortSignal,
		ctx: Ctx,
		onUpdate: (result: PromptTemplateBridgeResult) => void,
	) => Promise<PromptTemplateBridgeResult>;
	/** Concurrent-safe executor for structured delegation requests. */
	executeStructured?: (
		requestId: string,
		params: DelegatedSubagentExecutionParams,
		signal: AbortSignal,
		ctx: Ctx,
		onUpdate: (result: PromptTemplateBridgeResult) => void,
	) => Promise<PromptTemplateBridgeResult>;
}

function hasStructuredDelegationMarker(data: unknown): boolean {
	if (!data || typeof data !== "object" || Array.isArray(data)) return false;
	const value = data as Record<string, unknown>;
	return Object.hasOwn(value, "ownerRunId")
		|| Object.hasOwn(value, "nodeId")
		|| Object.hasOwn(value, "result")
		|| Object.hasOwn(value, "version");
}

function validId(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\r\n]/.test(value);
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
	if (left === right) return true;
	if (!left || !right || left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function sameRecentTools(
	left: Array<{ tool: string; args: string }> | undefined,
	right: Array<{ tool: string; args: string }> | undefined,
): boolean {
	if (left === right) return true;
	if (!left || !right || left.length !== right.length) return false;
	return left.every((tool, index) => tool.tool === right[index]?.tool && tool.args === right[index]?.args);
}

/** Duration is a heartbeat clock, not delegation-visible progress; terminal usage remains authoritative. */
function sameStructuredDelegationUpdateProgress(left: SubagentDelegationUpdate, right: SubagentDelegationUpdate): boolean {
	return left.requestId === right.requestId
		&& left.ownerRunId === right.ownerRunId
		&& left.nodeId === right.nodeId
		&& left.runId === right.runId
		&& left.currentTool === right.currentTool
		&& left.currentToolArgs === right.currentToolArgs
		&& left.recentOutput === right.recentOutput
		&& sameStringArray(left.recentOutputLines, right.recentOutputLines)
		&& sameRecentTools(left.recentTools, right.recentTools)
		&& left.model === right.model
		&& left.toolCount === right.toolCount
		&& left.tokens === right.tokens;
}

export function registerPromptTemplateDelegationBridge<Ctx extends { cwd?: string }>(
	options: PromptTemplateBridgeOptions<Ctx>,
): {
	cancelAll: () => void;
	dispose: () => void;
} {
	const attemptControllers = new Map<string, AbortController>();
	const pendingAttemptCancels = new Map<string, true>();
	const activeOwnedNodes = new Map<string, { attemptKey: string; controller: AbortController }>();
	const settledAttempts = new Map<string, true>();
	const subscriptions: Array<() => void> = [];
	let disposed = false;
	let identitySaturated = false;

	const subscribe = (event: string, handler: (data: unknown) => void): void => {
		const unsubscribe = options.events.on(event, handler);
		if (typeof unsubscribe === "function") subscriptions.push(unsubscribe);
	};
	const ownsAttempt = (attemptKey: string, controller: AbortController): boolean =>
		!disposed && attemptControllers.get(attemptKey) === controller;
	const rememberIdentity = (map: Map<string, true>, key: string): void => {
		if (map.has(key) || identitySaturated) return;
		if (map.size >= 8_192) {
			identitySaturated = true;
			return;
		}
		map.set(key, true);
		if (map.size === 8_192) {
			// Exact cancellation and terminal-attempt facts are security state, not an
			// LRU cache. Once full, fail closed rather than evicting identity facts.
			identitySaturated = true;
		}
	};
	const nodeKey = (ownerRunId: string, nodeId: string): string => JSON.stringify([ownerRunId, nodeId]);
	const attemptKey = (requestId: string, ownerRunId: string, nodeId: string): string => JSON.stringify([requestId, ownerRunId, nodeId]);
	const emitTerminal = (key: string, payload: SubagentDelegationResponse): void => {
		if (disposed || settledAttempts.has(key)) return;
		rememberIdentity(settledAttempts, key);
		options.events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, payload);
	};

	subscribe(PROMPT_TEMPLATE_SUBAGENT_CANCEL_EVENT, (data) => {
		if (!data || typeof data !== "object" || Array.isArray(data)) return;
		const value = data as Record<string, unknown>;
		const requestId = value.requestId;
		if (!validId(requestId)) return;
		if (hasStructuredDelegationMarker(data)) {
			if (Object.keys(value).some((key) => key !== "requestId" && key !== "ownerRunId" && key !== "nodeId")) return;
			const ownerRunId = value.ownerRunId;
			const nodeId = value.nodeId;
			if (!validId(ownerRunId) || !validId(nodeId)) return;
			const key = attemptKey(requestId, ownerRunId, nodeId);
			const controller = attemptControllers.get(key);
			if (controller) controller.abort();
			else rememberIdentity(pendingAttemptCancels, key);
		}
	});

	subscribe(PROMPT_TEMPLATE_SUBAGENT_REQUEST_EVENT, async (data) => {
		if (!hasStructuredDelegationMarker(data)) {
			// Both legacy prompt-template transports were removed. Keep answering them with a
			// documented rejection instead of silently dropping the request.
			if (data && typeof data === "object" && !Array.isArray(data)) {
				const legacy = data as Record<string, unknown>;
				if ((legacy.tasks !== undefined || legacy.worktree !== undefined) && typeof legacy.requestId === "string" && legacy.requestId) {
					options.events.emit(PROMPT_TEMPLATE_SUBAGENT_RESPONSE_EVENT, {
						requestId: legacy.requestId,
						messages: [],
						isError: true,
						errorText: "Legacy prompt-template tasks/worktree orchestration was removed; use workflowScript.",
					});
					return;
				}
			}
			const legacyRequest = parsePromptTemplateRequest(data);
			if (!legacyRequest) return;
			options.events.emit(PROMPT_TEMPLATE_SUBAGENT_RESPONSE_EVENT, {
				...legacyRequest,
				messages: [],
				isError: true,
				errorText: "Legacy prompt-template direct delegation was removed; use workflowScript through the subagent tool or structured delegation.",
			} satisfies PromptTemplateDelegationResponse);
			return;
		}

		const parsed = parseSubagentDelegationRequest(data);
		if (parsed.ok === false) {
			if (!disposed && parsed.requestId) {
				const payload = {
					requestId: parsed.requestId,
					...(parsed.ownerRunId ? { ownerRunId: parsed.ownerRunId } : {}),
					...(parsed.nodeId ? { nodeId: parsed.nodeId } : {}),
					status: "invalid_request",
					error: parsed.error,
				} satisfies SubagentDelegationInvalidResponse;
				if (parsed.ownerRunId && parsed.nodeId) {
					const attemptedKey = attemptKey(parsed.requestId, parsed.ownerRunId, parsed.nodeId);
					if (!attemptControllers.has(attemptedKey)) emitTerminal(attemptedKey, payload);
				} else {
					options.events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, payload);
				}
			}
			return;
		}
		const structuredRequest = parsed.request;
		const requestId = parsed.request.requestId;
		const key = attemptKey(requestId, structuredRequest.ownerRunId, structuredRequest.nodeId);
		const params = toSubagentDelegationExecutionParams(structuredRequest);

		if (attemptControllers.has(key) || settledAttempts.has(key)) return;
		if (pendingAttemptCancels.delete(key)) {
			emitTerminal(key, {
				requestId,
				ownerRunId: structuredRequest.ownerRunId,
				nodeId: structuredRequest.nodeId,
				status: "cancelled",
			});
			return;
		}
		if (identitySaturated) {
			options.events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
				requestId,
				ownerRunId: structuredRequest.ownerRunId,
				nodeId: structuredRequest.nodeId,
				status: "unavailable_context",
				error: "Delegation identity capacity is exhausted for this extension context.",
			} satisfies SubagentDelegationResponse);
			return;
		}
		const ownedNodeKey = nodeKey(structuredRequest.ownerRunId, structuredRequest.nodeId);
		const active = activeOwnedNodes.get(ownedNodeKey);
		if (active) {
			emitTerminal(key, {
				requestId,
				ownerRunId: structuredRequest.ownerRunId,
				nodeId: structuredRequest.nodeId,
				status: "duplicate_node",
			});
			return;
		}
		const ctx = options.getContext();
		if (!ctx) {
			emitTerminal(key, {
				requestId,
				ownerRunId: structuredRequest.ownerRunId,
				nodeId: structuredRequest.nodeId,
				status: "unavailable_context",
				error: "No active extension context for delegated subagent execution.",
			});
			return;
		}

		const controller = new AbortController();
		attemptControllers.set(key, controller);
		activeOwnedNodes.set(ownedNodeKey, { attemptKey: key, controller });
		if (controller.signal.aborted) {
			emitTerminal(key, {
				requestId,
				ownerRunId: structuredRequest.ownerRunId,
				nodeId: structuredRequest.nodeId,
				status: "cancelled",
			});
			activeOwnedNodes.delete(ownedNodeKey);
			attemptControllers.delete(key);
			return;
		}

		options.events.emit(SUBAGENT_DELEGATION_STARTED_EVENT, {
			requestId,
			ownerRunId: structuredRequest.ownerRunId,
			nodeId: structuredRequest.nodeId,
		});

		try {
			const executeRequest = options.executeStructured ?? options.execute;
			let lastStructuredUpdate: SubagentDelegationUpdate | undefined;
			const result = await executeRequest(
				requestId,
				params,
				controller.signal,
				ctx,
				(update) => {
					if (!ownsAttempt(key, controller)) return;
					const payload = toSubagentDelegationUpdate(structuredRequest, update);
					if (payload && (!lastStructuredUpdate || !sameStructuredDelegationUpdateProgress(lastStructuredUpdate, payload))) {
						lastStructuredUpdate = payload;
						options.events.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, payload);
					}
				},
			);
			if (!ownsAttempt(key, controller)) return;
			emitTerminal(key, toSubagentDelegationResponse(structuredRequest, result, controller.signal.aborted));
		} catch (error) {
			if (!ownsAttempt(key, controller)) return;
			emitTerminal(key, {
				requestId,
				ownerRunId: structuredRequest.ownerRunId,
				nodeId: structuredRequest.nodeId,
				status: controller.signal.aborted ? "cancelled" : "failed",
				...(controller.signal.aborted ? {} : { error: error instanceof Error ? error.message : String(error) }),
			});
		} finally {
			if (attemptControllers.get(key) === controller) attemptControllers.delete(key);
			if (activeOwnedNodes.get(ownedNodeKey)?.controller === controller) activeOwnedNodes.delete(ownedNodeKey);
		}
	});

	return {
		cancelAll: () => {
			for (const controller of attemptControllers.values()) controller.abort();
			attemptControllers.clear();
			pendingAttemptCancels.clear();
			activeOwnedNodes.clear();
			settledAttempts.clear();
			identitySaturated = false;
		},
		dispose: () => {
			disposed = true;
			for (const controller of attemptControllers.values()) controller.abort();
			attemptControllers.clear();
			for (const unsubscribe of subscriptions) unsubscribe();
			subscriptions.length = 0;
			pendingAttemptCancels.clear();
			activeOwnedNodes.clear();
			settledAttempts.clear();
		},
	};
}
