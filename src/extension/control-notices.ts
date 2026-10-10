import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { controlNotificationKey, formatControlNoticeMessage } from "../runs/shared/subagent-control.ts";
import type { ControlEvent, SubagentState } from "../shared/types.ts";

export const SUBAGENT_CONTROL_MESSAGE_TYPE = "subagent_control_notice";

export interface SubagentControlMessageDetails {
	event: ControlEvent;
	source?: "foreground" | "async" | "goal" | "nested";
	asyncDir?: string;
	/** Nested notices reach the operator without a parent turn unless this is set. */
	wakeParent?: boolean;
	noticeText?: string;
}

export function formatSubagentControlNotice(details: SubagentControlMessageDetails, content?: string): string {
	return details.noticeText ?? content ?? formatControlNoticeMessage(details.event);
}

function deliverControlNotice(input: {
	pi: Pick<ExtensionAPI, "sendMessage">;
	visibleControlNotices: Set<string>;
	details: SubagentControlMessageDetails;
}): void {
	const key = controlNotificationKey(input.details.event);
	if (input.visibleControlNotices.has(key)) return;
	input.visibleControlNotices.add(key);
	const noticeText = input.details.noticeText ?? formatControlNoticeMessage(input.details.event);
	input.pi.sendMessage(
		{
			customType: SUBAGENT_CONTROL_MESSAGE_TYPE,
			content: noticeText,
			display: true,
			details: { ...input.details, noticeText },
		},
		{ triggerTurn: input.details.source === "async" || (input.details.source === "nested" && input.details.wakeParent === true) },
	);
}

export function handleSubagentControlNotice(input: {
	pi: Pick<ExtensionAPI, "sendMessage">;
	state: SubagentState;
	visibleControlNotices: Set<string>;
	details: SubagentControlMessageDetails;
}): void {
	if (!input.details?.event || input.details.event.type === "active_long_running") return;
	if (input.details.source === "foreground") {
		// A foreground tool blocks Pi from displaying this message. The run can
		// finish before Pi flushes it, and queued messages cannot be withdrawn.
		// Foreground control remains available through the live tool and fleet state.
		return;
	}
	deliverControlNotice(input);
}
