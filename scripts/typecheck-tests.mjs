#!/usr/bin/env node
/**
 * Test-aware typecheck with a per-file error ratchet.
 *
 * The published `typecheck` script (`tsc --noEmit`) only includes `src/**` and
 * `index.ts`, so `test/**` is never typechecked. That blindness has repeatedly
 * let stale test-side signatures pass review: a test that re-declares an
 * exported helper's signature locally, or calls a function with arguments the
 * function no longer accepts, stays green under both `tsc` and the runtime
 * (extra call arguments are discarded silently). See plan.md, M4 lessons.
 *
 * Typechecking `test/**` today reports thousands of pre-existing errors, so a
 * hard gate on all of them would block every change. Instead this script:
 *
 *   1. typechecks `tsconfig.test.json` (src + test + index),
 *   2. compares the error count per file against a committed baseline,
 *   3. fails if any file gained errors, or if the total dropped without the
 *      baseline being refreshed.
 *
 * Fix a file's errors, then run `node scripts/typecheck-tests.mjs --update`
 * and commit the shrunken baseline. New test files start from zero allowed
 * errors, so the debt can only shrink.
 *
 * Usage:
 *   node scripts/typecheck-tests.mjs              # verify (CI)
 *   node scripts/typecheck-tests.mjs --update     # rewrite the baseline
 *   node scripts/typecheck-tests.mjs --files a.ts # only gate these paths
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "test", "typecheck-baseline.json");
const args = process.argv.slice(2);
const update = args.includes("--update");
const filesFlag = args.indexOf("--files");
const scoped = filesFlag >= 0 ? args.slice(filesFlag + 1).filter((a) => !a.startsWith("--")).flatMap((a) => a.split(",")).filter(Boolean) : [];

function resolveTscBin() {
	const require = createRequire(import.meta.url);
	const lib = require.resolve("typescript");
	const bin = path.join(path.dirname(path.dirname(lib)), "bin", "tsc");
	if (!fs.existsSync(bin)) throw new Error(`TypeScript CLI not found next to ${lib}`);
	return bin;
}

function runTypecheck() {
	let output = "";
	try {
		output = execFileSync(process.execPath, [
			resolveTscBin(),
			"--noEmit", "--pretty", "false", "-p", "tsconfig.test.json",
		], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
	}
	const counts = new Map();
	for (const line of output.split("\n")) {
		const match = /^(.+?)\((\d+),(\d+)\): error TS\d+:/.exec(line);
		if (!match) continue;
		const file = path.relative(root, path.resolve(root, match[1])).split(path.sep).join("/");
		counts.set(file, (counts.get(file) ?? 0) + 1);
	}
	return counts;
}

function readBaseline() {
	if (!fs.existsSync(baselinePath)) return {};
	return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

const counts = runTypecheck();
const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

if (update) {
	const baseline = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
	fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
	console.log(`typecheck-baseline: wrote ${Object.keys(baseline).length} files, ${total} allowed errors`);
	process.exit(0);
}

const baseline = readBaseline();
const regressions = [];
for (const [file, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
	const allowed = baseline[file] ?? 0;
	if (count > allowed) regressions.push({ file, count, allowed });
}

if (scoped.length > 0) {
	const touched = regressions.filter((r) => scoped.some((f) => r.file === f || r.file.endsWith(`/${f}`)));
	if (touched.length > 0) {
		console.error(`Test-aware typecheck found new errors in files touched by this change:`);
		for (const r of touched) console.error(`  ${r.file}: ${r.count} errors (baseline ${r.allowed})`);
		console.error(`Fix them, or lower the count and refresh with: node scripts/typecheck-tests.mjs --update`);
		process.exit(1);
	}
	console.log(`Test-aware typecheck: touched files clean (${total} pre-existing errors elsewhere, ratcheted).`);
	process.exit(0);
}

if (regressions.length > 0) {
	console.error(`Test-aware typecheck found ${regressions.length} file(s) above their baseline:`);
	for (const r of regressions) console.error(`  ${r.file}: ${r.count} errors (baseline ${r.allowed})`);
	process.exit(1);
}

const stale = Object.keys(baseline).filter((file) => !counts.has(file));
if (stale.length > 0) {
	console.error(`Baseline is stale: ${stale.length} file(s) no longer report errors. Refresh with --update:`);
	for (const file of stale.slice(0, 10)) console.error(`  ${file}`);
	process.exit(1);
}
console.log(`Test-aware typecheck passed: ${total} pre-existing errors across ${counts.size} files, none above baseline.`);
