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
	const declarations = report.sections.find((section) => section.title.startsWith("A."))!;
	// Bound the tool declarations, not the whole parent turn. The parent turn also
	// counts <advertised_subagents>, which grows with however many agents happen to
	// be installed locally (720 chars on the machine that set this bound), so an
	// upper limit on it is a false positive waiting for a contributor with a fuller
	// agent directory - and the 9,853/7,431 pair this assertion used to quote came
	// from a different local set than any later measurement reproduced.
	//
	// Measured tool declarations: 17,416 when one 81-parameter tool did everything,
	// then 8,025 before the bg_wait de-duplication, 5,603 after it, and 5,261 after
	// the same changes to the three facade tools. The bound sits above the current
	// value and below both regressions, so either one fails here rather than
	// spending chars per call unnoticed; the per-tool ceilings in schemas.test.ts
	// (bg_wait) and tool-description.test.ts (the three facades) say which tool moved.
	assert.ok(
		declarations.subtotalChars < 5_500,
		`tool declarations regressed toward the pre-fix surface (17,416 with one monolithic tool, 8,025 before the bg_wait de-duplication, 5,603 before the facade de-glossing): ${declarations.subtotalChars}`,
	);
	assert.ok(report.parentTurnChars > 5_000, `parent turn total should be substantial, got ${report.parentTurnChars}`);
	const labels = report.sections.flatMap((section) => section.rows.map((row) => row.label));
	for (const required of ["subagent", "subagent_workflow", "subagent_control", "<advertised_subagents>", "worker", "scout", "<child boundary block>"]) {
		assert.ok(labels.includes(required), `missing row: ${required}`);
	}
});
