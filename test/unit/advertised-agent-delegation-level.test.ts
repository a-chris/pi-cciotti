import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { SUBAGENT_CHILD_ENV } from "../../src/runs/shared/child-runtime-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * `delegationLevel: "never"` must change what the parent is told about agents, not what the
 * parent can do: the catalog entries go, and the guidance that keeps a guessed name from
 * becoming a failed run stays. Writing a real config file and registering the extension is the
 * only path that proves the level survives config load, session start, and the prompt hook —
 * calling the builder with a level argument would prove the builder and never the wiring.
 *
 * The agent set comes from the same extension's own discovery, so the assertion is about the
 * difference the level makes to whatever is genuinely in the prompt, not about agents this test
 * hoped would be discovered.
 */
it("withdraws advertised agent entries at delegationLevel never and keeps the guidance", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "advertised-never-"));
	const env: Record<string, string | undefined> = { ...process.env, PI_CODING_AGENT_DIR: home };
	delete env[SUBAGENT_CHILD_ENV];
	try {
		const output = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./test/support/register-loader.mjs", "--input-type=module", "--eval", String.raw`
			import assert from "node:assert/strict";
			import fs from "node:fs";
			import path from "node:path";
			import register from "./src/extension/index.ts";
			const home = process.env.PI_CODING_AGENT_DIR;
			const cwd = path.join(home, "project");
			fs.mkdirSync(cwd, { recursive: true });

			// Config is read once at load, so each level needs its own registration; a shared
			// registration would report whichever level was loaded first.
			const promptForLevel = (delegationLevel) => {
				const configDir = path.join(home, "extensions", "subagent");
				fs.mkdirSync(configDir, { recursive: true });
				fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify(delegationLevel ? { delegationLevel } : {}));
				const handlers = new Map();
				const pi = new Proxy({
					events: { on() { return () => {}; }, emit() {} },
					on(event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
					registerTool() {},
					getActiveTools() { return ["subagent"]; },
				}, { get(target, key) { return key in target ? target[key] : () => undefined; } });
				register(pi);
				const ctx = {
					cwd, hasUI: false, model: { provider: "test", id: "test" },
					modelRegistry: { getAvailable() { return []; }, getAll() { return []; } },
					sessionManager: { getSessionId() { return "level-" + (delegationLevel ?? "default"); }, getSessionFile() { return undefined; }, getBranch() { return []; } },
				};
				handlers.get("session_start").at(-1)({ reason: "startup" }, ctx);
				const emitted = handlers.get("before_agent_start").at(-1)({ systemPrompt: "base", systemPromptOptions: { selectedTools: ["subagent"] } }, ctx);
				return emitted?.systemPrompt ?? "base";
			};

			const names = (prompt) => [...prompt.matchAll(/<name>([^<]+)<\/name>/gu)].map((match) => match[1]);

			const standard = promptForLevel(undefined);
			const discovered = names(standard);
			// Without this the test would pass vacuously on an empty catalog.
			assert.ok(discovered.length > 0, "the default prompt must carry a catalog to withdraw");

			for (const level of ["rarely", "aggressive"]) {
				assert.equal(promptForLevel(level), standard, level + " must stay byte-identical to the default");
			}

			const never = promptForLevel("never");
			assert.match(never, /<advertised_subagents>/, "the block survives so the guidance is not lost");
			assert.deepEqual(names(never), [], "never must list no agents, and it found: " + discovered.join(", "));
			assert.doesNotMatch(never, /<subagent>/);
			assert.doesNotMatch(never, /<omitted/, "withheld by policy is not a trimmed catalog");
			assert.match(never, /delegationLevel to never|Delegation level never/);
			assert.match(never, /not instructions to delegate/);
			assert.match(never, /action: "list"/, "the block must name where to retrieve the catalog");
			assert.match(never, /confirm the selected agent appears there/);
			// Concatenation, not a template literal: the harness embeds this script inside a
			// String.raw tag, so a dollar-brace would be interpolated by the outer file.
			assert.ok(
				Buffer.byteLength(never) < Buffer.byteLength(standard) / 2,
				"never should cost far less than the catalog: " + Buffer.byteLength(never) + " vs " + Buffer.byteLength(standard),
			);
			process.stdout.write("never-mode catalog contract passed (" + discovered.length + " agents withdrawn)");
		`], { cwd: root, env, encoding: "utf8", timeout: 120_000 });
		assert.match(output, /never-mode catalog contract passed/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});
