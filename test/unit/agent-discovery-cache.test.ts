import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgent } from "../../src/api/agents.ts";
import { clearAgentDiscoveryCache, discoverAgentSnapshot, discoverAgents, discoverAgentsAll, MAX_DISCOVERY_CACHE_ENTRIES } from "../../src/agents/agents.ts";
import { mergeRuntimeAgents, clearRuntimeAgentsForPi } from "../../src/agents/runtime-agent-registry.ts";
import { fileURLToPath } from "node:url";

let tempRoot = "";
let home = "";
let project = "";
let pi: ExtensionAPI;
const previousEnv: Record<string, string | undefined> = {};
const managedEnv = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_SUBAGENT_EXTRA_AGENT_DIRS", "PI_OFFLINE"];

function writeAgent(filePath: string, name: string, description: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}.\n`, "utf-8");
}

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function makePi(): ExtensionAPI {
	return { on() {}, registerTool() {} } as unknown as ExtensionAPI;
}

describe("agent discovery snapshots", () => {
	beforeEach(() => {
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-discovery-cache-"));
		home = path.join(tempRoot, "home");
		project = path.join(tempRoot, "project");
		for (const name of managedEnv) previousEnv[name] = process.env[name];
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.env.PI_CODING_AGENT_DIR = path.join(home, ".pi", "agent");
		process.env.PI_OFFLINE = "true";
		delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
		pi = makePi();
		clearAgentDiscoveryCache();
	});

	afterEach(() => {
		clearRuntimeAgentsForPi(pi);
		clearAgentDiscoveryCache();
		for (const name of managedEnv) {
			const value = previousEnv[name];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	it("keeps effective and all-source projections distinct in one snapshot", () => {
		const userAgentPath = path.join(home, ".pi", "agent", "agents", "shared.md");
		const projectAgentPath = path.join(project, ".pi", "agents", "shared.md");
		writeAgent(userAgentPath, "shared", "User shared");
		writeAgent(projectAgentPath, "shared", "Project shared");
		writeAgent(path.join(home, ".pi", "agent", "agents", "scope-hidden.md"), "scope-hidden", "User hidden");
		writeJson(path.join(project, ".pi", "settings.json"), {
			subagents: { agentOverrides: { "scope-hidden": { disabled: true } } },
		});

		const snapshot = discoverAgentSnapshot(project, "both", undefined, { includeChains: false });
		assert.equal(snapshot.effective.agents.find((agent) => agent.name === "shared")?.source, "project");
		assert.equal(snapshot.effective.agents.some((agent) => agent.name === "scope-hidden"), false);
		assert.equal(snapshot.all.user.some((agent) => agent.name === "shared"), true);
		assert.equal(snapshot.all.project.some((agent) => agent.name === "shared"), true);
		assert.equal(snapshot.all.user.some((agent) => agent.name === "scope-hidden"), true);
		assert.equal(snapshot.all.project.some((agent) => agent.name === "scope-hidden"), false);
		assert.equal(snapshot.effective.directories.some((directory) => directory.source === "project"), true);
	});

	it("retains hidden definitions for runtime collision checks", () => {
		const hiddenPath = path.join(home, ".pi", "agent", "agents", "scope-hidden.md");
		writeAgent(hiddenPath, "scope-hidden", "User hidden");
		const registration = registerAgent({
			pi,
			name: "scope-hidden",
			definition: { description: "Runtime hidden collision", systemPrompt: "Runtime." },
		});
		try {
			const snapshot = discoverAgentSnapshot(project, "project", undefined, { includeChains: false });
			const configured = [...snapshot.all.builtin, ...snapshot.all.package, ...snapshot.all.user, ...snapshot.all.project];
			assert.equal(snapshot.effective.agents.some((agent) => agent.name === "scope-hidden"), false);
			assert.throws(
				() => mergeRuntimeAgents(pi, snapshot.effective, configured),
				/collides with configured agent 'scope-hidden'/,
			);
		} finally {
			registration.dispose();
		}
	});

	it("invalidates agent and chain projections when files change or appear", () => {
		const agentPath = path.join(project, ".pi", "agents", "fresh.md");
		const chainPath = path.join(project, ".pi", "chains", "fresh.chain.md");
		writeAgent(agentPath, "fresh", "Initial agent");
		fs.mkdirSync(path.dirname(chainPath), { recursive: true });
		fs.writeFileSync(chainPath, "---\nname: fresh-chain\ndescription: Initial chain\n---\n\n## fresh\nInspect\n", "utf-8");

		const first = discoverAgentSnapshot(project, "both");
		assert.equal(first.effective.agents.find((agent) => agent.name === "fresh")?.description, "Initial agent");
		assert.equal(first.all.chains.find((chain) => chain.name === "fresh-chain")?.description, "Initial chain");

		writeAgent(agentPath, "fresh", "Updated agent");
		fs.writeFileSync(chainPath, "---\nname: fresh-chain\ndescription: Updated chain\n---\n\n## fresh\nInspect\n", "utf-8");
		const updated = discoverAgentSnapshot(project, "both");
		assert.equal(updated.effective.agents.find((agent) => agent.name === "fresh")?.description, "Updated agent");
		assert.equal(updated.all.chains.find((chain) => chain.name === "fresh-chain")?.description, "Updated chain");

		fs.rmSync(agentPath);
		const addedPath = path.join(project, ".pi", "agents", "added.md");
		writeAgent(addedPath, "added", "Added agent");
		const changedFiles = discoverAgents(project, "both");
		assert.equal(changedFiles.agents.some((agent) => agent.name === "fresh"), false);
		assert.equal(changedFiles.agents.some((agent) => agent.name === "added"), true);
	});

	it("matches scoped discovery settings and precedence for user and project views", () => {
		writeAgent(path.join(home, ".pi", "agent", "agents", "shared.md"), "shared", "User shared");
		writeAgent(path.join(project, ".pi", "agents", "shared.md"), "shared", "Project shared");
		writeAgent(path.join(home, ".pi", "agent", "agents", "user-only.md"), "user-only", "User only");
		writeAgent(path.join(project, ".pi", "agents", "project-only.md"), "project-only", "Project only");
		writeJson(path.join(home, ".pi", "agent", "settings.json"), { subagents: { agentOverrides: { shared: { description: "User override" } } } });
		writeJson(path.join(project, ".pi", "settings.json"), { subagents: { agentOverrides: { shared: { description: "Project override" } } } });

		for (const scope of ["user", "project"] as const) {
			const direct = discoverAgents(project, scope);
			const snapshot = discoverAgentSnapshot(project, scope, undefined, { includeChains: false }).effective;
			assert.deepEqual(snapshot, direct);
		}
	});

	it("invalidates when a new agent appears in a previously inspected nested directory", () => {
		const nestedDir = path.join(project, ".pi", "agents", "nested");
		fs.mkdirSync(nestedDir, { recursive: true });

		const initial = discoverAgents(project, "both");
		assert.equal(initial.agents.some((agent) => agent.name === "nested-agent"), false);

		writeAgent(path.join(nestedDir, "nested-agent.md"), "nested-agent", "Nested agent");
		const updated = discoverAgents(project, "both");
		assert.equal(updated.agents.some((agent) => agent.name === "nested-agent"), true);
	});

	it("does not read out-of-scope user settings for a project snapshot", () => {
		writeAgent(path.join(project, ".pi", "agents", "project-agent.md"), "project-agent", "Project agent");
		const userSettingsPath = path.join(home, ".pi", "agent", "settings.json");
		fs.mkdirSync(path.dirname(userSettingsPath), { recursive: true });
		fs.writeFileSync(userSettingsPath, "{ malformed", "utf-8");

		const snapshot = discoverAgentSnapshot(project, "project", undefined, { includeChains: false });
		assert.equal(snapshot.effective.agents.some((agent) => agent.name === "project-agent"), true);
		assert.equal(snapshot.all.project.some((agent) => agent.name === "project-agent"), true);
	});

	it("keeps shared package agent metadata scoped to the selected settings source", () => {
		const userPackageRoot = path.join(tempRoot, "user-package");
		const projectPackageRoot = path.join(tempRoot, "project-package");
		const sharedAgentDir = path.join(tempRoot, "shared-package-agents");
		writeJson(path.join(home, ".pi", "agent", "settings.json"), { packages: [userPackageRoot] });
		writeJson(path.join(project, ".pi", "settings.json"), { packages: [projectPackageRoot] });
		writeJson(path.join(userPackageRoot, "package.json"), {
			name: "user-package",
			"pi-cciotti": { agents: [path.relative(userPackageRoot, sharedAgentDir)] },
		});
		writeJson(path.join(projectPackageRoot, "package.json"), {
			name: "project-package",
			"pi-cciotti": { agents: [path.relative(projectPackageRoot, sharedAgentDir)] },
		});
		writeAgent(path.join(sharedAgentDir, "shared.md"), "shared", "Shared package agent");

		const directUser = discoverAgents(project, "user").agents.find((agent) => agent.name === "shared");
		const directProject = discoverAgents(project, "project").agents.find((agent) => agent.name === "shared");
		const snapshotUser = discoverAgentSnapshot(project, "user", undefined, { includeChains: false }).effective.agents.find((agent) => agent.name === "shared");
		const snapshotProject = discoverAgentSnapshot(project, "project", undefined, { includeChains: false }).effective.agents.find((agent) => agent.name === "shared");

		assert.equal(directUser?.packageSourceName, "user-package");
		assert.equal(directProject?.packageSourceName, "project-package");
		assert.equal(snapshotUser?.packageSourceName, directUser?.packageSourceName);
		assert.equal(snapshotProject?.packageSourceName, directProject?.packageSourceName);
	});

	it("surfaces malformed in-scope settings while collecting package roots", () => {
		const settingsPath = path.join(home, ".pi", "agent", "settings.json");
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(settingsPath, "{ malformed", "utf-8");

		assert.throws(
			() => discoverAgentSnapshot(project, "both", undefined, { includeChains: false }),
			(error: unknown) => error instanceof Error
				&& error.message.includes(settingsPath)
				&& error.message.includes("Failed to parse settings file"),
		);
	});

	it("invalidates when project-root policy changes", () => {
		const outer = path.join(tempRoot, "outer");
		const nested = path.join(outer, "nested");
		fs.mkdirSync(path.join(outer, ".git"), { recursive: true });
		writeAgent(path.join(outer, ".pi", "agents", "outer.md"), "outer", "Outer agent");
		writeAgent(path.join(nested, ".pi", "agents", "nested.md"), "nested", "Nested agent");
		writeJson(path.join(nested, ".pi", "settings.json"), { subagents: { projectRootResolution: "git-root" } });

		const gitRoot = discoverAgents(nested, "both");
		assert.equal(gitRoot.projectAgentsDir, path.join(outer, ".pi", "agents"));
		assert.equal(gitRoot.agents.some((agent) => agent.name === "outer"), true);
		assert.equal(gitRoot.agents.some((agent) => agent.name === "nested"), false);

		writeJson(path.join(nested, ".pi", "settings.json"), { subagents: { projectRootResolution: "nearest" } });
		const nearest = discoverAgents(nested, "both");
		assert.equal(nearest.projectAgentsDir, path.join(nested, ".pi", "agents"));
		assert.equal(nearest.agents.some((agent) => agent.name === "nested"), true);
		assert.equal(nearest.agents.some((agent) => agent.name === "outer"), false);
	});

	it("does not parse chains on the ordinary effective discovery fast path", () => {
		const agentPath = path.join(project, ".pi", "agents", "worker.md");
		const chainPath = path.join(project, ".pi", "chains", "broken.chain.md");
		writeAgent(agentPath, "worker", "Worker");
		fs.mkdirSync(path.dirname(chainPath), { recursive: true });
		fs.writeFileSync(chainPath, "not a valid chain", "utf-8");

		assert.equal(discoverAgents(project, "both").agents.some((agent) => agent.name === "worker"), true);
		assert.equal(discoverAgentsAll(project).chainDiagnostics.some((diagnostic) => diagnostic.filePath === chainPath), true);
	});
});

const sliceTestRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Absolute path to agents module so imports work in eval-based nested processes
const AGENTS_MODULE = `file://${path.join(sliceTestRoot, "src", "agents", "agents.ts")}`;

describe("slice1: skip redundant fingerprint on warm cache hits", () => {
	let home = "";
	let projectDir = "";

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-slice1-"));
		projectDir = path.join(home, "project");
		for (const name of managedEnv) previousEnv[name] = process.env[name];
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.env.PI_CODING_AGENT_DIR = path.join(home, ".pi", "agent");
		process.env.PI_OFFLINE = "true";
		delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
		clearAgentDiscoveryCache();
	});

	afterEach(() => {
		clearAgentDiscoveryCache();
		for (const name of managedEnv) {
			const value = previousEnv[name];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		fs.rmSync(home, { recursive: true, force: true });
	});

	it("warm cache hit: discoverAgents('both') and discoverAgentsAll cost same syscalls", () => {
		writeAgent(path.join(home, ".pi", "agent", "agents", "test.md"), "test-user", "User agent");
		writeAgent(path.join(projectDir, ".pi", "agents", "test.md"), "test-project", "Project agent");

		const script = `\
import fsDefault from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { discoverAgents, discoverAgentsAll, clearAgentDiscoveryCache } from "${AGENTS_MODULE.replace(/\\/g, "/")}";
clearAgentDiscoveryCache();
let count = 0;
const origStat = fsDefault.statSync;
const origReaddir = fsDefault.readdirSync;
fsDefault.statSync = (...a) => { count++; return origStat(...a); };
fsDefault.readdirSync = (...a) => { count++; return origReaddir(...a); };
syncBuiltinESMExports();
const cwd = process.env.PROJECT_DIR + "/project";
discoverAgentsAll(cwd);
const c1 = count; count = 0;
discoverAgents(cwd, "both");
const c2 = count; count = 0;
discoverAgentsAll(cwd);
const c3 = count;
console.log(JSON.stringify({ chainMaterialize: c1, noChain: c2, reuseChains: c3 }));`;

		const output = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--input-type=module", "--eval", script],
			{ env: { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), PI_OFFLINE: "true", PROJECT_DIR: home }, encoding: "utf8", stdio: "pipe" }
		);
		const result = JSON.parse(output.toString().trim());
		assert.equal(result.reuseChains, result.noChain, "after chains are materialized, warm discoverAgentsAll must equal warm discoverAgents(syscalls)");
	});

	it("cache still detects new agent files after warm hit", () => {
		writeAgent(path.join(home, ".pi", "agent", "agents", "existing.md"), "existing", "Existing agent");
		writeAgent(path.join(projectDir, ".pi", "agents", "existing.md"), "proj-existing", "Project agent");

		const script = `\
import fsDefault from "node:fs";
import path from "node:path";
import { discoverAgentsAll, clearAgentDiscoveryCache } from "${AGENTS_MODULE.replace(/\\/g, "/")}";
clearAgentDiscoveryCache();
const cwd = process.env.PROJECT_DIR + "/project";
let result = discoverAgentsAll(cwd);
const allAgents = [...result.builtin, ...result.package, ...result.user, ...result.project];
if (allAgents.length === 0) throw new Error("Expected agents");
console.log(JSON.stringify({ initialCount: allAgents.length }));
fsDefault.writeFileSync(path.join(cwd, ".pi", "agents", "fresh.md"),
	"---\\nname: fresh-agent\\ndescription: Fresh agent\\n---\\nFresh content.", "utf-8");
result = discoverAgentsAll(cwd);
	const all2 = [...result.builtin, ...result.package, ...result.user, ...result.project];
	console.log(JSON.stringify({ foundFresh: all2.some(a => a.name === "fresh-agent") }));`;

		const output = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--input-type=module", "--eval", script],
			{ env: { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), PI_OFFLINE: "true", PROJECT_DIR: home }, encoding: "utf8", stdio: "pipe" }
		);
		const lines = output.toString().trim().split(/\r?\n/).filter(Boolean);
		const finalLine = lines[lines.length - 1];
		const finalResult = JSON.parse(finalLine ?? "");
		assert.ok(finalResult.foundFresh, "discoverAgentsAll must detect newly written agent files (invalidation still works)");
	});

	it("cold includeChains=true still materializes chains", () => {
		fs.mkdirSync(path.join(projectDir, ".pi", "chains"), { recursive: true });
		fs.writeFileSync(
			path.join(projectDir, ".pi", "chains", "test-chain.chain.md"),
			"---\nname: test-chain\ndescription: Test chain\n---\n\n## test-chain\nInspect\n",
			"utf-8"
		);

		const script = `\
import path from "node:path";
import { discoverAgentSnapshot, clearAgentDiscoveryCache } from "${AGENTS_MODULE.replace(/\\/g, "/")}";
clearAgentDiscoveryCache();
const cwd = process.env.PROJECT_DIR + "/project";
const snapshot = discoverAgentSnapshot(cwd, "both", undefined, { includeChains: true });
console.log(JSON.stringify({ chainNames: snapshot.all.chains.map(c => c.name) }));`;

		const output = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--input-type=module", "--eval", script],
			{ env: { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), PI_OFFLINE: "true", PROJECT_DIR: home }, encoding: "utf8", stdio: "pipe" }
		);
		const result = JSON.parse(output.toString().trim());
		assert.ok(result.chainNames.includes("test-chain"), "chains must be materialized on cold includeChains=true call");
	});
});

// Slice 2: bound agentDiscoveryCache with insertion-order eviction

describe("slice2: bound agentDiscoveryCache with FIFO eviction", () => {
	let home = "";
	let projectDir = "";

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-slice2-"));
		projectDir = path.join(home, "project");
		for (const name of managedEnv) previousEnv[name] = process.env[name];
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.env.PI_CODING_AGENT_DIR = path.join(home, ".pi", "agent");
		process.env.PI_OFFLINE = "true";
		delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
		clearAgentDiscoveryCache();
	});

	afterEach(() => {
		clearAgentDiscoveryCache();
		for (const name of managedEnv) {
			const value = previousEnv[name];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		fs.rmSync(home, { recursive: true, force: true });
	});

	it("eviction happens after MAX+4 cwds, correctness survives", () => {
		const numCwds = MAX_DISCOVERY_CACHE_ENTRIES + 4;
		const cwds: string[] = [];
		for (let i = 0; i < numCwds; i++) {
			const cwd = path.join(home, "project-" + i);
			fs.mkdirSync(cwd, { recursive: true });
			writeAgent(path.join(cwd, ".pi", "agents", "agent.md"), "test-agent", "Test agent " + i);
			cwds.push(cwd);
		}

		const script = `\
import fsDefault from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as path from "node:path";
import { discoverAgentsAll, clearAgentDiscoveryCache } from "${AGENTS_MODULE.replace(/\\/g, "/")}";
clearAgentDiscoveryCache();
const cwds = ${JSON.stringify(cwds)};
// Prime all cwds through discoverAgentsAll — first MAX should be evicted by last writes
for (const cwd of cwds) discoverAgentsAll(cwd);
// Measure readFileSync on a repeat call: cold-miss (cache miss) is > 0, warm hit is 0.
const readCount = (cwd) => {
	let rfCount = 0;
	const origReadFile = fsDefault.readFileSync;
	fsDefault.readFileSync = (...a) => { rfCount++; return origReadFile(...a); };
	syncBuiltinESMExports();
	discoverAgentsAll(cwd);
	fsDefault.readFileSync = origReadFile;
	syncBuiltinESMExports();
	return rfCount;
};
console.log(JSON.stringify({ early: readCount(cwds[0]), late: readCount(cwds[cwds.length - 1]) }));`;

		const output = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--input-type=module", "--eval", script],
			{ env: { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), PI_OFFLINE: "true" }, encoding: "utf8", stdio: "pipe" }
		);
		const result = JSON.parse(output.toString().trim());

		// The earliest cwd was evicted — a repeat shows the cold-miss readFileSync signature.
		assert.ok(result.early > 0, "early cwd must be evicted from discovery cache (cold-miss readFileSync > 0)");
		// The most recent cwd is still cached — a repeat is a warm hit (no fs reads).
		assert.equal(result.late, 0, "most recent cwd should still be cached (warm hit, readFileSync === 0)");

		// Correctness: even evicted entries must return valid agents when re-discovered
		const agentScript = `\
import { discoverAgentsAll, clearAgentDiscoveryCache } from "${AGENTS_MODULE.replace(/\\/g, "/")}";
clearAgentDiscoveryCache();
const cwd = process.cwd();
const result = discoverAgentsAll(cwd);
const found = [...result.builtin, ...result.package, ...result.user, ...result.project];
console.log(JSON.stringify({ found: found.some(a => a.name === "test-agent") }));`;

		for (let i = 0; i < numCwds; i++) {
			const cwd = cwds[i];
			const out = execFileSync(
				process.execPath,
				["--experimental-strip-types", "--input-type=module", "--eval", agentScript],
				{ cwd, env: { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), PI_OFFLINE: "true" }, encoding: "utf8", stdio: "pipe" }
			);
			const r = JSON.parse(out.toString().trim());
			assert.ok(r.found, "cwd-" + i + " must still resolve its agent after eviction cycle");
		}
	});

	it("early-cwd repeat shows cold-miss via readFileSync after eviction sweep", () => {
		// Drive enough distinct cwds to force eviction, then prove the earliest one misses
		const cwds: string[] = [];
		for (let i = 0; i < MAX_DISCOVERY_CACHE_ENTRIES + 4; i++) {
			const cwd = path.join(home, "sweep-" + i);
			fs.mkdirSync(cwd, { recursive: true });
			writeAgent(path.join(cwd, ".pi", "agents", "agent.md"), "sw-agent", "Sweep agent " + i);
			cwds.push(cwd);
		}

		const script = `\
import fsDefault from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { discoverAgentsAll, clearAgentDiscoveryCache } from "${AGENTS_MODULE.replace(/\\/g, "/")}";
clearAgentDiscoveryCache();
const cwds = ${JSON.stringify(cwds)};
// Sweep all cwds through
for (const cwd of cwds) discoverAgentsAll(cwd);
// Now probe the very first cwd again — it should be evicted
let rfCount = 0;
const origReadFile = fsDefault.readFileSync;
fsDefault.readFileSync = (...a) => { rfCount++; return origReadFile(...a); };
syncBuiltinESMExports();
discoverAgentsAll(cwds[0]);
console.log(JSON.stringify({ firstCwdReadCount: rfCount }));`;

		const output = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--input-type=module", "--eval", script],
			{ env: { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), PI_OFFLINE: "true" }, encoding: "utf8", stdio: "pipe" }
		);
		const result = JSON.parse(output.toString().trim());
		assert.ok(result.firstCwdReadCount > 0, "first cwd must show cold-miss (readFileSync > 0) after MAX+4 sweep");
	});
});
