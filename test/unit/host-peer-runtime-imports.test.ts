import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { HOST_PEER_ALIAS_CANDIDATES, HOST_PEER_ALIASES, resolveHostPeerAliases } from "../../src/runs/background/runner-aliases.ts";
import { collectHostPeerImports, extractStaticImportSpecifiers } from "../../src/runs/background/host-peer-import-graph.ts";
import { resolveInstalledPiPackageRoot } from "../../src/runs/shared/pi-spawn.ts";
import { resolveCompileFromPackageRoot, validateStructuredOutputValue } from "../../src/runs/shared/structured-output.ts";
import type { JsonSchemaObject } from "../../src/shared/types.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Shared walker functions for BFS violation checks (replacing local copies).
const hostPeerPackages = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
] as const;

function matchingHostPeerPackage(specifier: string): string | undefined {
	return hostPeerPackages.find((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

function resolveRelativeImport(fromFile: string, specifier: string): string {
	const base = path.dirname(fromFile);
	const candidates = [path.resolve(base, specifier), path.resolve(base, `${specifier}.ts`), path.resolve(base, specifier, "index.ts")];
	for (const c of candidates) {
		if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
	}
	throw new Error(`Could not resolve relative import '${specifier}' from ${path.relative(process.cwd(), fromFile)}`);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Write a synthetic package directory given name, version and exports map. */
function writeFakePackage(dir: string, name: string, version: string, exportsMap: Record<string, string>): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name, version, exports: exportsMap }),
		"utf-8",
	);
	for (const target of Object.values(exportsMap)) {
		const full = path.join(dir, target);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, "export {};\n", "utf-8");
	}
}

// Discover the set of host-peer packages required by the runner graph (for this repo).
const runnerEntry = path.join(projectRoot, "src", "runs", "background", "subagent-runner.ts");
const graphRequiredPkgs = collectHostPeerImports(runnerEntry, [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"@earendil-works/chord",
	"typebox",
]);

test("every host peer package the detached async runner imports is aliased to the installed pi package (issues #334, #526)", () => {
	const entryPoint = path.join(projectRoot, "src", "runs", "background", "subagent-runner.ts");
	const visited = new Set<string>([entryPoint]);
	const queue: string[] = [entryPoint];
	const violations: string[] = [];
	const aliased = new Set(HOST_PEER_ALIASES.map((entry) => entry.specifier));

	while (queue.length > 0) {
		const file = queue.shift()!;
		const source = fs.readFileSync(file, "utf-8");
		for (const specifier of extractStaticImportSpecifiers(source)) {
			const hostPeerMatch = matchingHostPeerPackage(specifier);
			if (hostPeerMatch) {
				if (!aliased.has(specifier)) violations.push(`${path.relative(projectRoot, file)} imports '${specifier}' (host peer package '${hostPeerMatch}'), which has no runner alias`);
				continue;
			}
			if (!specifier.startsWith(".")) continue;
			const resolved = resolveRelativeImport(file, specifier);
			if (!visited.has(resolved)) {
				visited.add(resolved);
				queue.push(resolved);
			}
		}
	}

	assert.equal(violations.length, 0, `runtime import graph reaches host peer package(s) the runner does not alias:\n${violations.join("\n")}`);
	assert.ok(visited.size > 20, `expected a non-trivial reachable file set (a broken resolver could undercount it), got ${visited.size}`);
});

test("resolves pi-agent-core/node to its exact package export instead of appending to the root alias", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-agent-core-node-alias-"));
	const packageDir = path.join(root, "node_modules", "@earendil-works", "pi-agent-core");
	const distDir = path.join(packageDir, "dist");
	try {
		fs.mkdirSync(distDir, { recursive: true });
		fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
			name: "@earendil-works/pi-agent-core",
			version: "0.85.1-test",
			exports: {
				".": "./dist/index.js",
				"./node": "./dist/node.js",
			},
		}), "utf-8");
		fs.writeFileSync(path.join(distDir, "index.js"), "export {};\n", "utf-8");
		fs.writeFileSync(path.join(distDir, "node.js"), "export {};\n", "utf-8");

		const resolved = resolveHostPeerAliases(root);
		assert.equal(resolved.aliases["@earendil-works/pi-agent-core"], path.join(distDir, "index.js"));
		assert.equal(resolved.aliases["@earendil-works/pi-agent-core/node"], path.join(distDir, "node.js"));
		assert.notEqual(resolved.aliases["@earendil-works/pi-agent-core/node"], path.join(distDir, "index.js", "node"));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function writeFakeTypeboxPackage(typeboxDir: string): void {
	fs.mkdirSync(typeboxDir, { recursive: true });
	fs.writeFileSync(
		path.join(typeboxDir, "package.json"),
		JSON.stringify({ name: "typebox", version: "0.0.0-test", exports: { "./compile": "./compile.mjs" } }),
	);
	fs.writeFileSync(path.join(typeboxDir, "compile.mjs"), "export function Compile() {\n\treturn { Check: () => true, Errors: () => [], fakeTypebox: true };\n}\n");
}

test("resolveCompileFromPackageRoot loads typebox/compile from a fake Pi host package root", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-host-root-"));
	try {
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fake-pi-coding-agent", version: "0.0.0" }));
		writeFakeTypeboxPackage(path.join(root, "node_modules", "typebox"));

		const compile = await resolveCompileFromPackageRoot(root);
		assert.equal(typeof compile, "function");
		const compiled = compile!({});
		assert.equal(compiled.Check({}), true);
		assert.deepEqual([...compiled.Errors({})], []);
		assert.equal((compiled as { fakeTypebox?: boolean }).fakeTypebox, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}

	const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-empty-root-"));
	try {
		await assert.rejects(resolveCompileFromPackageRoot(emptyRoot));
	} finally {
		fs.rmSync(emptyRoot, { recursive: true, force: true });
	}
});

test("resolveCompileFromPackageRoot resolves typebox hoisted to an ancestor node_modules", async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-hoisted-root-"));
	try {
		writeFakeTypeboxPackage(path.join(tmp, "node_modules", "typebox"));
		const packageRoot = path.join(tmp, "apps", "pi", "node_modules", "@earendil-works", "pi-coding-agent");
		fs.mkdirSync(packageRoot, { recursive: true });
		fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.0.0" }));

		const compile = await resolveCompileFromPackageRoot(packageRoot);
		assert.equal(typeof compile, "function");
		const compiled = compile!({});
		assert.equal(compiled.Check({}), true);
		assert.equal((compiled as { fakeTypebox?: boolean }).fakeTypebox, true);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("validateStructuredOutputValue validates values against a JSON Schema", async () => {
	const valid = await validateStructuredOutputValue({ type: "object" }, {});
	assert.deepEqual(valid, { status: "valid" });

	const schema: JsonSchemaObject = {
		type: "object",
		properties: { a: { type: "number" } },
		required: ["a"],
		additionalProperties: false,
	};
	const invalid = await validateStructuredOutputValue(schema, {});
	assert.equal(invalid.status, "invalid");
	assert.ok(invalid.status === "invalid" && invalid.message.length > 0);
});

// ---------------------------------------------------------------------------
// Generation-fixture driven resolver tests
// ---------------------------------------------------------------------------

/**
 * Build a per-generation host root with specified exports for known packages.
 * Peer packages go under `<host>/node_modules/<scoped-dir>/` so that
 * `findPeerPackageDir` can discover them via its standard hoisting logic.
 *
 * @returns absolute path to the pi package root (the `host` directory).
 */
function buildFixture(packages: { pkg: string; exports: Record<string, string> }[]): string {
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-gen-"));
	const hostDir = path.join(tmpRoot, "host");
	const piPkg = "@earendil-works/pi-coding-agent";
	writeFakePackage(hostDir, piPkg, "0.99.0", { ".": "./index.mjs" });
	for (const { pkg, exports } of packages) {
		if (pkg === piPkg) continue; // already written above
		// Place in node_modules respecting npm scoped-package layout:
		//   @scope/name → node_modules/@scope/name/
		const atIdx = pkg.indexOf("@");
		const scope = atIdx === 0 ? pkg.slice(0, pkg.indexOf("/")) : "";
		const nmDir = scope
			? path.join(hostDir, "node_modules", scope, pkg.slice(scope.length + 1))
			: path.join(hostDir, "node_modules", pkg);
		writeFakePackage(nmDir, pkg, "0.0.0", exports);
	}
	return hostDir;  // Return the actual pi package root
}

test("generation 0.81: pi-agent-core with ./node, no chord — all graph-visible aliases resolve", () => {
	const root = buildFixture([
		{ pkg: "@earendil-works/pi-agent-core", exports: { ".": "./index.mjs", "./node": "./node.mjs" } },
	]);
	try {
		const resolved = resolveHostPeerAliases(root);
		// Graph requires only 'typebox' — should have nothing missing since typebox isn't provided but not graph-required either.
		// However our actual host doesn't provide typebox, so check the shape.
		// The key invariant: no panic on the bare specifiers.
		assert.ok(!resolved.missing.includes("@earendil-works/pi-agent-core"));
		assert.ok(!resolved.missing.includes("@earendil-works/pi-agent-core/node"));
		assert.ok(resolved.aliases["@earendil-works/pi-agent-core"]);
		assert.ok(resolved.aliases["@earendil-works/pi-agent-core/node"]);
		// chord should never appear (not graph-required, not present)
		assert.equal(resolved.aliases["@earendil-works/chord"], undefined);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("generation 0.84: pi-agent-core with ./node, no chord — identical to 0.81", () => {
	const root = buildFixture([
		{ pkg: "@earendil-works/pi-agent-core", exports: { ".": "./index.mjs", "./node": "./node.mjs" } },
	]);
	try {
		const resolved = resolveHostPeerAliases(root);
		assert.ok(!resolved.missing.includes("@earendil-works/pi-agent-core"));
		assert.ok(!resolved.missing.includes("@earendil-works/pi-agent-core/node"));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("generation 0.87: chord present with . and ./context, core with ./node", () => {
	const root = buildFixture([
		{ pkg: "@earendil-works/pi-agent-core", exports: { ".": "./index.mjs", "./node": "./node.mjs" } },
		{ pkg: "@earendil-works/chord", exports: { ".": "./index.mjs", "./context": "./context.mjs" } },
	]);
	try {
		const resolved = resolveHostPeerAliases(root);
		assert.ok(!resolved.missing.includes("@earendil-works/chord"));
		assert.ok(!resolved.missing.includes("@earendil-works/chord/context"));
		assert.ok(resolved.aliases["@earendil-works/chord"]);
		assert.ok(resolved.aliases["@earendil-works/chord/context"]);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("generation 1.0.0: pi-agent-core WITHOUT ./node — missing may only contain graph-required items", () => {
	const root = buildFixture([
		{ pkg: "@earendil-works/pi-agent-core", exports: { ".": "./index.mjs" } }, // NO ./node
		{ pkg: "@earendil-works/chord", exports: { ".": "./index.mjs", "./context": "./context.mjs" } },
		// NOTE: no typebox (graph-required) — expect it in missing.
	]);
	try {
		const resolved = resolveHostPeerAliases(root);
		// The whole point: 1.0.0 dropped ./node, but it's not graph-required,
		// so it should be silently skipped (not fail-closed).
		assert.ok(!resolved.missing.includes("@earendil-works/pi-agent-core/node"),
			"./node missing from 1.0.0 host must be silently skipped");
		assert.equal(resolved.aliases["@earendil-works/pi-agent-core/node"], undefined);
		// chord should still resolve since it IS provided
		assert.ok(resolved.aliases["@earendil-works/chord"]);
		assert.ok(resolved.aliases["@earendil-works/chord/context"]);
		// typebox IS graph-required but absent → must surface in missing
		assert.ok(resolved.missing.some(s => s.startsWith("typebox")),
			"typebox should appear as missing when graph-required and absent");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("generation 1.0.0-complete: all needed packages provide correct subpaths — missing stays empty", () => {
	const root = buildFixture([
		{ pkg: "@earendil-works/pi-agent-core", exports: { ".": "./index.mjs" } }, // NO ./node (1.0.0 real layout)
		{ pkg: "typebox", exports: { ".": "./index.mjs", "./compile": "./compile.mjs", "./value": "./value.mjs" } },
	]);
	try {
		const resolved = resolveHostPeerAliases(root);
		// Graph requires only typebox — typebox resolves fine, others are silently skipped.
		// This mirrors a production 1.0.0 host launch.
		assert.deepEqual(resolved.missing, [], "complete 1.0.0-style host should have no missing entries");
		assert.equal(resolved.aliases["@earendil-works/pi-agent-core/node"], undefined, "./node not aliased when unavailable");
		for (const spec of ["typebox", "typebox/compile", "typebox/value"]) {
			assert.ok(resolved.aliases[spec], `${spec} should be aliased when provided and graph-required`);
		}
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("fail-closed: removing a graph-required package specifier surfaces it in missing", () => {
	// Graph requires only 'typebox'. Remove typebox entirely.
	const root = buildFixture([{ pkg: "@earendil-works/pi-agent-core", exports: { ".": "./index.mjs", "./node": "./node.mjs" } }]);
	try {
		const resolved = resolveHostPeerAliases(root);
		// 'typebox' is graph-required but completely absent → all typebox candidates should be missing.
		const expectedMissing = HOST_PEER_ALIAS_CANDIDATES
			.filter((c) => c.pkg === "typebox" && !resolved.aliases[c.specifier])
			.map((c) => c.specifier);
		assert.ok(expectedMissing.length > 0, "expected some typebox candidates to be missing");
		for (const s of expectedMissing) {
			assert.ok(resolved.missing.includes(s), `graph-required specifier '${s}' should be in missing`);
		}
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("fail-closed: deleting a specific graph-required export subpath surfaces it", () => {
	// Create host with partial typebox (only root `.`, missing compile/value).
	const root = buildFixture([
		{ pkg: "typebox", exports: { ".": "./index.mjs" } }, // only root, not compile/value
	]);
	try {
		const resolved = resolveHostPeerAliases(root);
		// typebox/compile and typebox/value should be in missing since typebox IS graph-required.
		assert.ok(resolved.missing.includes("typebox/compile"), "typebox/compile should be missing when graph-required and unresolvable");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("non-graph-required specifiers are silently skipped when unavailable", () => {
	// Core without ./node, no typebox — @earendil-works/pi-agent-core/node should NOT appear in missing.
	const root = buildFixture([
		{ pkg: "@earendil-works/pi-agent-core", exports: { ".": "./index.mjs" } }, // NO ./node
	]);
	try {
		const resolved = resolveHostPeerAliases(root);
		// Only graph-required types would surface; chart-core/node is optional.
		assert.ok(!resolved.missing.includes("@earendil-works/pi-agent-core/node"), "missing ./node should be silently skipped when not graph-required");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("chord-local copy in extension node_modules is never used to satisfy host aliasing", () => {
	// 1.0.0-style host: no ./node for pi-agent-core, chord present.
	// But also add an extension-local chord copy that should NOT matter.
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-ext-chord-"));
	const hostDir = path.join(root, "host");
	const extDir = path.join(root, "extension");
	const chord = "@earendil-works/chord";
	try {
		// Host provides only core (no ./node), no chord at all.
		writeFakePackage(hostDir, "@earendil-works/pi-coding-agent", "1.0.0", { ".": "./index.mjs" });
		writeFakePackage(path.join(hostDir, "node_modules", "@earendil-works/pi-agent-core"), "@earendil-works/pi-agent-core", "1.0.0", { ".": "./index.mjs" });
		// Extension-local chord copy (should NEVER be used).
		writeFakePackage(path.join(extDir, "node_modules", chord), chord, "0.85.1", { ".": "./index.mjs", "./context": "./context.mjs" });

		const resolved = resolveHostPeerAliases(hostDir);
		// Chord is not graph-required here, so it should be silently skipped (no missing, no alias).
		assert.ok(!resolved.missing.includes(chord), "extension-local chord must not satisfy host requirements");
		assert.ok(!resolved.missing.includes(`${chord}/context`));
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
