import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const scriptPath = fileURLToPath(new URL("../../scripts/context-cost.mjs", import.meta.url));

it("context-cost script reports a positive parent-turn total from live sources", () => {
	const out = execFileSync(process.execPath, ["--experimental-strip-types", scriptPath, "--cwd", ".", "--json"], {
		cwd: fileURLToPath(new URL("../..", import.meta.url)),
		encoding: "utf-8",
	});
	const report = JSON.parse(out) as {
		sections: { title: string; subtotalChars: number; rows: { label: string; chars: number }[] }[];
		parentTurnChars: number;
	};
	const titles = report.sections.map((section) => section.title);
	assert.ok(titles.some((title) => title.startsWith("A.")), "tool declaration section present");
	assert.ok(titles.some((title) => title.startsWith("B.")), "system prompt section present");
	assert.ok(titles.some((title) => title.startsWith("C.")), "child launch section present");
	assert.ok(report.parentTurnChars > 5_000, `parent turn total should be substantial, got ${report.parentTurnChars}`);
	// Pre-M1, the tool declarations alone were 17,416 chars; reverting the facade
	// split would land near 19k. Anything above 9.5k is a regression to catch.
	// Measured: 9,853 before the bg_wait description/schema de-duplication, 7,431
	// after (bg_wait alone was 4,395 chars — 55% of the tool surface — because the
	// #1729 guardrail was restated in the description and in all five parameter
	// descriptions). The bound sits BELOW that 9,853 pre-fix total, so re-inflating
	// that tool fails here instead of quietly spending 2.4k chars per call again;
	// the exact per-tool ceiling lives in schemas.test.ts.
	assert.ok(report.parentTurnChars < 9_500, `parent turn total regressed toward the pre-M1 monolith (was 17,416 chars for the tool alone, 9,853 before the bg_wait de-duplication): ${report.parentTurnChars}`);
	const labels = report.sections.flatMap((section) => section.rows.map((row) => row.label));
	for (const required of ["subagent", "subagent_workflow", "subagent_control", "<advertised_subagents>", "worker", "scout", "<child boundary block>"]) {
		assert.ok(labels.includes(required), `missing row: ${required}`);
	}
});
