import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getConfigPath, loadConfig } from "../../src/extension/config.ts";
import { DEFAULT_FOREGROUND_TIMEOUT_MS, resolveConfigDefaultTimeoutMs, resolveSingleAgentLaunchTimeout } from "../../src/runs/foreground/subagent-executor.ts";
import { resolveControlConfig } from "../../src/runs/shared/subagent-control.ts";
import { resolveToolTimeoutMs } from "../../src/runs/shared/tool-timeout.ts";
import { validateToolBudgetConfig } from "../../src/runs/shared/tool-budget.ts";

// M4 invariant: every config-enriched param has a validated config key, and the
// key actually reaches the run it is documented to enrich. A validator without a
// live reader is a lie, so each case asserts the resolved value a run would get —
// not merely that the config file was accepted.
//
// The untrusted boundary is a hand-edited config.json, so inputs are written as
// raw JSON text and read back through loadConfig() — the parser + validator.

describe("M4 config-enriched keys: validated and wired", () => {
	let agentDir: string;
	let previousAgentDirEnv: string | undefined;

	beforeEach(() => {
		previousAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cciotti-config-enrichment-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
		fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
	});

	afterEach(() => {
		if (previousAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDirEnv;
		fs.rmSync(agentDir, { recursive: true, force: true });
	});

	function writeRawConfig(json: string): void {
		fs.writeFileSync(getConfigPath(), json, "utf-8");
	}

	it("loads every enriched key into the typed config the executor reads", () => {
		writeRawConfig(JSON.stringify({
			timeoutMs: 45_000,
			toolTimeoutMs: 5_000,
			checkpointBeforeDeadlineMs: 60_000,
			toolBudget: { soft: 40, hard: 60, block: ["read", "grep"] },
			control: { enabled: true, needsAttentionAfterMs: 90_000, notifyChannels: ["event"] },
		}));
		const config = loadConfig();
		assert.equal(config.timeoutMs, 45_000);
		assert.equal(config.toolTimeoutMs, 5_000);
		assert.equal(config.checkpointBeforeDeadlineMs, 60_000);
		assert.deepEqual(config.toolBudget, { soft: 40, hard: 60, block: ["read", "grep"] });
		assert.equal(config.control?.needsAttentionAfterMs, 90_000);
		assert.deepEqual(config.control?.notifyChannels, ["event"]);
	});

	it("rejects a hand-edited value for every enriched key", () => {
		const invalid: [string, RegExp][] = [
			['{"timeoutMs": 0}', /config\.timeoutMs must be a positive integer/],
			['{"timeoutMs": 1.5}', /config\.timeoutMs must be a positive integer/],
			['{"timeoutMs": 2147483648}', /config\.timeoutMs must be a positive integer/],
			['{"toolTimeoutMs": "fast"}', /config\.toolTimeoutMs must be a positive integer/],
			['{"checkpointBeforeDeadlineMs": -1}', /config\.checkpointBeforeDeadlineMs must be a positive integer/],
			['{"toolBudget": {"soft": 80, "hard": 60}}', /config\.toolBudget\.soft must be <= /],
			['{"toolBudget": {"soft": 10}}', /config\.toolBudget\.hard must be an integer >= 1/],
			['{"control": []}', /config\.control must be a JSON object/],
			['{"control": {"needsAttentionAfterMs": 0}}', /config\.control\.needsAttentionAfterMs must be a positive integer/],
			['{"control": {"notifyChannels": ["carrier-pigeon"]}}', /config\.control\.notifyChannels must be an array/],
			['{"control": {"watchdogMode": "strict"}}', /config\.control\.watchdogMode is not supported/],
		];
		for (const [json, expected] of invalid) {
			writeRawConfig(json);
			assert.throws(() => loadConfig(), expected, json);
		}
	});

	it("refuses to silently discard an invalid launch default", () => {
		// Validation failure alone is not enough: keys outside this fail-closed list are
		// swallowed and the whole config degrades to defaults, so a typo in a launch
		// default must fail loudly instead of quietly restoring built-in behaviour.
		for (const key of ["timeoutMs", "toolTimeoutMs", "toolBudget", "control", "checkpointBeforeDeadlineMs"]) {
			writeRawConfig(`{"${key}": "not-a-number"}`);
			assert.throws(() => loadConfig(), /Subagent config|config\./, key);
		}
		// Contrast: an equally invalid key that is not a launch default degrades silently.
		writeRawConfig('{"maxActiveAsyncRunsPerSession": -1}');
		assert.deepEqual(loadConfig(), {});
	});

	it("rejects the removed maxSubagentDepth key instead of ignoring it", () => {
		// Before removal the key had no validator, so a hand-edited value failed the load
		// generically and silently replaced the operator's file with defaults.
		writeRawConfig('{"maxSubagentDepth": 1, "asyncByDefault": false}');
		assert.throws(() => loadConfig(), /maxSubagentDepth was removed/);
	});

	it("rejects the removed toolDescriptionMode key instead of ignoring it", () => {
		writeRawConfig('{"toolDescriptionMode": "compact"}');
		assert.throws(() => loadConfig(), /toolDescriptionMode was removed/);
	});

	it("rejects the removed authorityPolicy.projectOpen key without losing the file", () => {
		// The key is nested, so the generic fail-closed list cannot see it by name.
		// Without the explicit check this file would degrade to defaults silently.
		// No other fail-closed key present: this fixture isolates the nested-key check.
		writeRawConfig('{"authorityPolicy": { "projectOpen": "auto" }}');
		assert.throws(() => loadConfig(), /projectOpen was removed/);
		// A removed action without the fail-closed guard would log and return {}.
		writeRawConfig('{"authorityPolicy": { "steerRun": "maybe" }}');
		assert.deepEqual(loadConfig(), {});
	});

	it("config.timeoutMs becomes the launch default, and loses to an explicit call", () => {
		const configDefault = resolveConfigDefaultTimeoutMs(45_000);
		assert.equal(configDefault, 45_000);
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, false, configDefault), { timeoutMs: 45_000 });
		assert.deepEqual(resolveSingleAgentLaunchTimeout({ timeoutMs: 10_000 }, false, configDefault), { timeoutMs: 10_000 });
		// Composite launches keep their top level unbounded even with a config default.
		assert.deepEqual(resolveSingleAgentLaunchTimeout({ workflowScript: "x" }, true, configDefault), {});
		// Without a config default the built-in backstop applies.
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, false), { timeoutMs: DEFAULT_FOREGROUND_TIMEOUT_MS });
		// An unusable config value falls back instead of poisoning the run with a
		// timer that would overflow Node's delay ceiling.
		assert.equal(resolveConfigDefaultTimeoutMs(2_147_483_648), undefined);
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, false, resolveConfigDefaultTimeoutMs("nope")), { timeoutMs: DEFAULT_FOREGROUND_TIMEOUT_MS });
	});

	it("config.toolTimeoutMs is the third rung, after the call and the agent", () => {
		assert.deepEqual(
			resolveToolTimeoutMs({ configValue: 5_000 }),
			{ toolTimeoutMs: 5_000 },
		);
		assert.deepEqual(
			resolveToolTimeoutMs({ callValue: 1_000, agentValue: 2_000, configValue: 5_000 }),
			{ toolTimeoutMs: 1_000 },
		);
		assert.deepEqual(
			resolveToolTimeoutMs({ agentValue: 2_000, configValue: 5_000 }),
			{ toolTimeoutMs: 2_000 },
		);
		assert.deepEqual(resolveToolTimeoutMs({}), {});
	});

	it("config.control is the base rung the per-call override sits on", () => {
		const fromConfig = resolveControlConfig({ enabled: true, needsAttentionAfterMs: 90_000, notifyChannels: ["event"] });
		assert.equal(fromConfig.needsAttentionAfterMs, 90_000);
		assert.deepEqual(fromConfig.notifyChannels, ["event"]);
		assert.equal(resolveControlConfig({ needsAttentionAfterMs: 90_000 }, { needsAttentionAfterMs: 10_000 }).needsAttentionAfterMs, 10_000);
		assert.equal(resolveControlConfig({ needsAttentionAfterMs: 90_000 }, {}).needsAttentionAfterMs, 90_000);
	});

	it("config.toolBudget resolves into an executable budget", () => {
		const resolved = validateToolBudgetConfig({ soft: 40, hard: 60, block: ["read", "grep", "read"] }, "config.toolBudget");
		assert.equal(resolved.error, undefined);
		assert.deepEqual(resolved.budget, { soft: 40, hard: 60, block: ["read", "grep"] });
		assert.deepEqual(validateToolBudgetConfig(undefined, "config.toolBudget"), {});
	});
});
