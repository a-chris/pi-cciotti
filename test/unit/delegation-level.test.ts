import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getConfigPath, loadConfig } from "../../src/extension/config.ts";
import {
	delegationLevelGuideline,
	DELEGATION_LEVELS,
	isDelegationLevel,
	resolveDelegationLevel,
	validateDelegationLevel,
} from "../../src/policy/delegation-level.ts";

// config.delegationLevel decides how eagerly the orchestrator delegates. The
// invariant this proves: the level is validated at load, resolves to `standard`
// when unset, and contributes exactly one distinct system-prompt guideline — a
// level that produced the same sentence as the default would be a dead setting.

describe("delegation level policy", () => {
	let agentDir: string;
	let previousAgentDirEnv: string | undefined;

	beforeEach(() => {
		previousAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-delegation-level-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
		fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
	});

	afterEach(() => {
		if (previousAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDirEnv;
		fs.rmSync(agentDir, { recursive: true, force: true });
	});

	it("resolves the shipped default when unset", () => {
		assert.equal(resolveDelegationLevel(undefined), "standard");
		assert.equal(delegationLevelGuideline(undefined), delegationLevelGuideline("standard"));
	});

	it("accepts exactly the four incremental levels", () => {
		assert.deepEqual([...DELEGATION_LEVELS], ["never", "rarely", "standard", "aggressive"]);
		for (const level of DELEGATION_LEVELS) {
			assert.equal(isDelegationLevel(level), true);
			assert.equal(resolveDelegationLevel(level), level);
			assert.equal(validateDelegationLevel(level), level);
		}
		assert.equal(isDelegationLevel("sometimes"), false);
		assert.equal(isDelegationLevel(undefined), false);
	});

	it("gives each level its own guideline", () => {
		const guidelines = DELEGATION_LEVELS.map((level) => delegationLevelGuideline(level));
		assert.equal(new Set(guidelines).size, DELEGATION_LEVELS.length, "levels must not share a guideline");
		for (const guideline of guidelines) {
			assert.match(guideline, /subagent/);
			assert.ok(Buffer.byteLength(guideline) < 400, `guideline too long: ${guideline}`);
		}
	});

	it("keeps the shipped gate verbatim at the default level", () => {
		// An install that never sets the key must read the rule it read before the
		// setting existed, so adding the setting cannot silently widen authority.
		assert.match(
			delegationLevelGuideline("standard"),
			/do not invoke subagents unless the operator requested delegation directly or through applicable instructions/,
		);
	});

	it("rejects an unknown level when validating config", () => {
		assert.equal(validateDelegationLevel(undefined), undefined);
		assert.throws(() => validateDelegationLevel("always"), /delegationLevel must be one of never, rarely, standard, aggressive/);
	});

	it("loads the configured level and fails closed on a bad one", () => {
		fs.writeFileSync(getConfigPath(), JSON.stringify({ delegationLevel: "aggressive", asyncByDefault: false }), "utf-8");
		const config = loadConfig();
		assert.equal(config.delegationLevel, "aggressive");
		assert.equal(config.asyncByDefault, false);

		// A typo must not silently degrade the rest of the operator's file to defaults.
		fs.writeFileSync(getConfigPath(), JSON.stringify({ delegationLevel: "very", asyncByDefault: false }), "utf-8");
		assert.throws(() => loadConfig(), /delegationLevel must be one of/);
	});
});
