/**
 * Production import-graph walker for the detached async runner.
 *
 * Walks static TypeScript imports starting from the runner entry point
 * (`src/runs/background/subagent-runner.ts`) and returns the subset of
 * host-peer package specifiers that actually appear in the graph.
 *
 * The walk is memoized per process so repeated calls (spawnRunner,
 * isAsyncAvailable, doctor) are O(1) after the first walk.
 */
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Internal cache keyed by absolute entry path. Reset during tests only. */
let cachedGraph: Map<string, Set<string>> | undefined;

/** Exposed for tests that mutate files under the runner entry. */
export function _testResetImportGraphCache(): void {
	cachedGraph = undefined;
}

/** Absolute file path of the runner entry used as the default key. */
let resolvedDefaultEntry: string | undefined;

/** Resolve a `.ts` specifier against `fromFile`. Throws when resolution fails. */
export function resolveRelativeImport(fromFile: string, specifier: string): string {
	const base = path.dirname(fromFile);
	const candidates = [
		path.resolve(base, specifier),
		path.resolve(base, `${specifier}.ts`),
		path.resolve(base, specifier, "index.ts"),
	];
	for (const c of candidates) {
		if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
	}
	throw new Error(`Could not resolve relative import '${specifier}' from ${path.relative(process.cwd(), fromFile)}`);
}

/** Extract non-type import/export-from specifiers from TypeScript source text. */
export function extractStaticImportSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const lines = source.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!.trim();
		if (!/^(?:import|export)\b/.test(line)) {
			i++;
			continue;
		}
		let statement = line;
		while (!/from\s+["'][^"']+["']/.test(statement) && !statement.includes(";") && i + 1 < lines.length) {
			i++;
			statement += ` ${lines[i]!.trim()}`;
		}
		i++;
		if (/^import\s+type\b/.test(statement) || /^export\s+type\b/.test(statement)) continue;
		const fromMatch = statement.match(/from\s+["']([^"']+)["']/);
		if (fromMatch) {
			specifiers.push(fromMatch[1]!);
			continue;
		}
		const sideEffectMatch = statement.match(/^import\s+["']([^"']+)["']/);
		if (sideEffectMatch) specifiers.push(sideEffectMatch[1]!);
	}
	return specifiers;
}

/**
 * BFS over relative `.ts` imports from `entryPath`, returning every specifier
 * from `hostPeerPackages` that actually appears in the static graph.
 *
 * Known exception node: `"node"` imports should not be walked further because
 * they refer to Node builtins, not local TS files.
 */
export function collectHostPeerImports(entryPath: string, hostPeerPackages: readonly string[]): Set<string> {
	if (!cachedGraph) cachedGraph = new Map();
	const cached = cachedGraph.get(entryPath);
	if (cached) return cached;

	const visited = new Set<string>([entryPath]);
	const queue: string[] = [entryPath];
	const found = new Set<string>();

	while (queue.length > 0) {
		const file = queue.shift()!;
		const source = fs.readFileSync(file, "utf-8");
		for (const specifier of extractStaticImportSpecifiers(source)) {
			const pkgMatch = matchingHostPeerPackage(specifier, hostPeerPackages);
			if (pkgMatch) {
				found.add(specifier);
				continue;
			}
			if (!specifier.startsWith(".")) continue;
			// Skip node: builtins — never locally resolvable.
			if (specifier === "node") continue;
			try {
				const resolved = resolveRelativeImport(file, specifier);
				if (resolved && !visited.has(resolved)) {
					visited.add(resolved);
					queue.push(resolved);
				}
			} catch {
				// Unknown relative import ⇒ fail-closed.
				throw new Error(`Could not resolve relative import '${specifier}' from ${file}`);
			}
		}
	}

	cachedGraph.set(entryPath, found);
	return found;
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/** Default runner entry resolved relative to this module's location. */
function getDefaultEntry(): string {
	if (!resolvedDefaultEntry) {
		resolvedDefaultEntry = path.join(__dirname, "subagent-runner.ts");
	}
	return resolvedDefaultEntry;
}

/**
 * Check if a bare specifier is one of the known host-peer packages or a scoped variant.
 */
function matchingHostPeerPackage(specifier: string, hostPeerPackages: readonly string[]): string | undefined {
	return hostPeerPackages.find((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

/**
 * Construct a `Set<string>` of canonical host-peer specifiers (package name only,
 * not subpaths) present in the import graph starting at `entryPath`.
 * When `entryPath` is omitted the cached default entry is used.
 */
export function resolveHostPeerGraph(
	entryPath?: string,
	hostPeerPackages: readonly string[] = [
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-tui",
		"typebox",
	],
): Set<string> {
	return collectHostPeerImports(entryPath ?? getDefaultEntry(), hostPeerPackages);
}
