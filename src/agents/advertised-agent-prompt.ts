import { Buffer } from "node:buffer";
import type { DelegationLevel } from "../policy/delegation-level.ts";
import type { ResolvedSubagentCapabilityCeiling } from "../runs/shared/capability-ceiling.ts";
import { isAgentAllowedByCapabilityCeiling } from "../runs/shared/capability-ceiling.ts";
import type { AgentConfig } from "./agents.ts";

const MAX_ADVERTISED_AGENTS = 16;
const MAX_CATALOG_BYTES = 12_288;
const MAX_DESCRIPTION_BYTES = 512;
const ADVERTISED_AGENTS_BLOCK = /\n*<advertised_subagents>\n[\s\S]*?\n<\/advertised_subagents>/gu;

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function promptDescription(description: string): string {
	let text = description.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
	if (Buffer.byteLength(text, "utf8") > MAX_DESCRIPTION_BYTES) {
		text = Buffer.from(text, "utf8").subarray(0, MAX_DESCRIPTION_BYTES - 3).toString("utf8").replace(/\uFFFD$/u, "").trimEnd() + "…";
	}
	return escapeXml(text);
}

export function buildAdvertisedAgentPrompt(
	agents: readonly AgentConfig[],
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling,
	delegationLevel?: DelegationLevel,
): string | undefined {
	const advertised = agents
		.filter((agent) => agent.source !== "runtime" && agent.advertise === true && agent.disabled !== true && isAgentAllowedByCapabilityCeiling(agent.name, capabilityCeiling))
		.sort((left, right) => left.name.localeCompare(right.name));
	if (advertised.length === 0) return undefined;

	// `never` drops the entries, never the guidance. The sentence telling the model to
	// confirm an agent through action:"list" before executing is what turns a guessed
	// name into a failed run instead of a confident wrong one, and it costs a fixed
	// ~400 bytes whether or not entries follow it. The entries are the part that grows
	// with the agent directory, and `never` is the one level where the operator has said
	// they should not be re-injected on every parent turn. No <omitted/> is emitted:
	// these are withheld by policy, not trimmed for budget, and saying "omitted 16"
	// would read as a catalog defect and invite the model to guess at the remainder.
	if (delegationLevel === "never") {
		return [
			"<advertised_subagents>",
			"Delegation level never: no subagents are listed, but file-defined subagents still exist and their names are not instructions to delegate. Invoke subagent only when the operator explicitly asks for delegation now, as when their task names an agent. Otherwise call subagent_control with { action: \"list\" } to read available agents, and confirm the selected agent appears there; if it does not, the run would fail, so pick a listed agent.",
			"</advertised_subagents>",
		].join("\n");
	}

	const render = (entries: string[]) => [
		"<advertised_subagents>",
		"The following file-defined subagents opted into discovery. Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed. Before execution, call subagent_control with { action: \"list\" } and confirm the selected agent appears there; if it does not, the run would fail, so pick a listed agent.",
		...entries,
		...(advertised.length > entries.length ? [`  <omitted count=\"${advertised.length - entries.length}\" />`] : []),
		"</advertised_subagents>",
	].join("\n");
	const entries: string[] = [];
	for (const agent of advertised) {
		if (entries.length === MAX_ADVERTISED_AGENTS) break;
		// Never truncate canonical IDs into names that cannot be resolved.
		if (Buffer.byteLength(agent.name, "utf8") > MAX_CATALOG_BYTES) continue;
		const entry = [
			"  <subagent>",
			`    <name>${escapeXml(agent.name)}</name>`,
			`    <description>${promptDescription(agent.description)}</description>`,
			"  </subagent>",
		].join("\n");
		if (Buffer.byteLength(render([...entries, entry]), "utf8") <= MAX_CATALOG_BYTES) entries.push(entry);
	}
	return render(entries);
}

export function appendAdvertisedAgentPrompt(systemPrompt: string, advertisedPrompt: string | undefined): string;
export function appendAdvertisedAgentPrompt(systemPrompt: string[], advertisedPrompt: string | undefined): string[];
export function appendAdvertisedAgentPrompt(systemPrompt: undefined, advertisedPrompt: string | undefined): string | undefined;
export function appendAdvertisedAgentPrompt(
	systemPrompt: string | string[] | undefined,
	advertisedPrompt: string | undefined,
): string | string[] | undefined;
export function appendAdvertisedAgentPrompt(
	systemPrompt: string | string[] | undefined,
	advertisedPrompt: string | undefined,
): string | string[] | undefined {
	if (Array.isArray(systemPrompt)) {
		let changed = false;
		const cleaned = systemPrompt
			.map((part) => {
				if (typeof part !== "string") return part;
				const stripped = part.replace(ADVERTISED_AGENTS_BLOCK, "");
				if (stripped !== part) changed = true;
				return stripped;
			})
			.filter((b) => typeof b === "string" && b.length > 0);

		if (advertisedPrompt) {
			return [...cleaned, advertisedPrompt];
		}
		return changed ? cleaned : systemPrompt;
	}

	if (typeof systemPrompt === "string") {
		const base = systemPrompt.replace(ADVERTISED_AGENTS_BLOCK, "");
		return advertisedPrompt ? (base.trim() ? `${base.trimEnd()}\n\n${advertisedPrompt}` : advertisedPrompt) : base;
	}

	return advertisedPrompt;
}
