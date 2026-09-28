#!/usr/bin/env node
/**
 * Sum + breakdown of the context this extension injects into the model, on demand.
 *
 * Counted (the extension's whole model-facing surface):
 *   A. Tool declarations   name + description + JSON Schema, as sent to the API
 *   B. System prompt       promptSnippet/guidelines + <advertised_subagents> catalog
 *   C. Per child launch    agents/*.md role prompt + injected child boundary block
 *
 * A+B are paid on EVERY parent turn. C is paid once per child launch, not in the
 * parent. Token counts are estimates: pi's heuristic is chars/4, which measured
 * UNDERestimates dense JSON/XML (~2.6-3.5 chars/token); "dense" uses 2.9.
 *
 * Usage (from anywhere):
 *   node scripts/context-cost.mjs                     # parent surface for this cwd
 *   node scripts/context-cost.mjs --cwd path/to/repo  # project agents of another repo
 *   node scripts/context-cost.mjs --roles             # + per-child-launch breakdown
 *   node scripts/context-cost.mjs --json
 *
 * Historical comparison (one-off): git worktree add /tmp/x <ref>, symlink this
 * repo's node_modules into it, and import its src/extension/schemas.ts the same
 * way. Before the surface was split into three tools (commit 95073427), the
 * single 81-param subagent tool declaration measured 17,416 chars (~4.4-6k tok)
 * — section A is now less than a third of that.
 */

import {
	CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS,
} from "../src/runs/shared/subagent-prompt-runtime.ts";
import {
	SUBAGENT_CONTROL_DESCRIPTION,
	SUBAGENT_DELEGATION_DESCRIPTION,
	SUBAGENT_WORKFLOW_DESCRIPTION,
	buildSubagentToolPromptMetadata,
} from "../src/extension/tool-description.ts";
import {
	SubagentControlParams,
	SubagentDelegationParams,
	SubagentWaitParams,
	SubagentWorkflowParams,
} from "../src/extension/schemas.ts";
import { buildAdvertisedAgentPrompt } from "../src/agents/advertised-agent-prompt.ts";
import { discoverAgents, discoverAgentsAll } from "../src/agents/agents.ts";
import { registerWaitTool } from "../src/runs/background/wait-tool.ts";

const DENSE_CHARS_PER_TOKEN = 2.9;

function measure(text) {
	return {
		chars: text.length,
		tokens: Math.ceil(text.length / 4),
		dense: Math.ceil(text.length / DENSE_CHARS_PER_TOKEN),
	};
}

function row(label, text, note = "") {
	return { label, note, ...measure(text) };
}

// A tool declaration is what the API receives: TypeBox objects are plain JSON
// schema objects; JSON.stringify drops the symbol Kind markers.
function declaration(name, description, params) {
	return JSON.stringify({ name, description, input_schema: JSON.parse(JSON.stringify(params)) });
}

const cwd = (() => {
	const index = process.argv.indexOf("--cwd");
	return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : process.cwd();
})();

const tools = [
	row("subagent", declaration("subagent", SUBAGENT_DELEGATION_DESCRIPTION, SubagentDelegationParams)),
	row("subagent_workflow", declaration("subagent_workflow", SUBAGENT_WORKFLOW_DESCRIPTION, SubagentWorkflowParams)),
	row("subagent_control", declaration("subagent_control", SUBAGENT_CONTROL_DESCRIPTION, SubagentControlParams)),
];
if (!/^(0|false)$/u.test(process.env.PI_SUBAGENT_WAIT_TOOL_ENABLED ?? "")) {
	// Capture the real root-session description by registering against a stub.
	let captured = "";
	registerWaitTool({ registerTool: (tool) => { captured = tool.description; } }, {});
	tools.push(row("bg_wait", declaration("bg_wait", captured, SubagentWaitParams)));
}

// B: what lands in the parent system prompt. The guideline is the one sentence
// config.delegationLevel contributes, so the default level is what a fresh
// install pays; other levels differ by a few words, not by a stacked rule.
const promptMetadata = buildSubagentToolPromptMetadata();
const promptRows = [
	row("promptSnippet + guidelines", `${promptMetadata.promptSnippet}\n${promptMetadata.promptGuidelines.join("\n")}`, "pi merges these into the system prompt"),
];
// Same pipeline as the extension's before_agent_start hook: effective "both"
// scope, advertise===true, then the catalog builder's own caps (16 / 12 KiB).
const advertisedAgents = discoverAgents(cwd, "both").agents.filter((agent) => agent.advertise === true);
const advertised = buildAdvertisedAgentPrompt(advertisedAgents);
const advertisedNames = advertised ? [...advertised.matchAll(/<name>([^<]+)<\/name>/gu)].map((m) => m[1]) : [];
promptRows.push(row("<advertised_subagents>", advertised ?? "", advertised ? `${advertisedNames.length} agents` : "nothing advertises in this cwd"));

// C: paid once per child launch, never in the parent.
const roleRows = discoverAgentsAll(cwd).builtin
	.map((agent) => row(agent.name, agent.systemPrompt ?? ""));
const boundaryRow = row("<child boundary block>", CHILD_SUBAGENT_BOUNDARY_INSTRUCTIONS, "injected into every child, on top of its role prompt");

const subtotal = (rows) => rows.reduce((sum, r) => sum + r.chars, 0);
const sections = [
	{ title: "A. Tool declarations (every parent turn)", rows: tools },
	{ title: "B. System-prompt additions (every parent turn)", rows: promptRows },
	{ title: "C. Per child launch (not the parent)", rows: [...roleRows, boundaryRow] },
];

if (process.argv.includes("--json")) {
	console.log(JSON.stringify({
		cwd,
		sections: sections.map((s) => ({ title: s.title, rows: s.rows, subtotalChars: subtotal(s.rows) })),
		parentTurnChars: subtotal(tools) + subtotal(promptRows),
		estimate: (n) => ({ tokens_c4: Math.ceil(n / 4), tokens_dense: Math.ceil(n / DENSE_CHARS_PER_TOKEN) }),
	}, null, 2));
	process.exit(0);
}

const pad = (text, width) => String(text).padEnd(width);
console.log(`context cost @ ${cwd}\n`);
for (const section of sections) {
	const sum = subtotal(section.rows);
	const footerLabel = section.title.startsWith("C.") ? "all roles (never at once)" : "subtotal";
	console.log(section.title);
	for (const r of section.rows) {
		const pct = sum ? pad(`${Math.round((r.chars / sum) * 100)}%`, 5) : "";
		console.log(`  ${pad(r.label, 34)}${pad(r.chars, 8)}${pad(`~${r.tokens}`, 8)}${pad(`~${r.dense}`, 8)}${pct}${r.note && `  ${r.note}`}`);
	}
	console.log(`  ${pad(footerLabel, 34)}${pad(sum, 8)}${pad(`~${Math.ceil(sum / 4)}`, 8)}${pad(`~${Math.ceil(sum / DENSE_CHARS_PER_TOKEN)}`, 8)}\n`);
}
const parent = subtotal(tools) + subtotal(promptRows);
const cheapest = roleRows.reduce((a, b) => (a.chars <= b.chars ? a : b));
const priciest = roleRows.reduce((a, b) => (a.chars >= b.chars ? a : b));
const childLow = cheapest.chars + boundaryRow.chars;
const childHigh = priciest.chars + boundaryRow.chars;
console.log("SUM");
console.log(`  parent turn (A+B)          ${pad(parent, 8)}~${pad(Math.ceil(parent / 4), 7)}~${pad(Math.ceil(parent / DENSE_CHARS_PER_TOKEN), 7)}paid on EVERY model call`);
console.log(`  child launch, cheapest     ${pad(childLow, 8)}~${pad(Math.ceil(childLow / 4), 7)}~${pad(Math.ceil(childLow / DENSE_CHARS_PER_TOKEN), 7)}${cheapest.label} + boundary, per launch`);
console.log(`  child launch, priciest     ${pad(childHigh, 8)}~${pad(Math.ceil(childHigh / 4), 7)}~${pad(Math.ceil(childHigh / DENSE_CHARS_PER_TOKEN), 7)}${priciest.label} + boundary, per launch`);
console.log(`\n(baseline: the old single 81-param tool declaration alone was 17,416 chars)`);
