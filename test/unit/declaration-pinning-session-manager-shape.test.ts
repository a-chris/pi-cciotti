import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { registerPinnedTool } from "../../src/extension/declaration-pinning.ts";
import { delegationLevelGuideline } from "../../src/policy/delegation-level.ts";

/**
 * Pi's own session manager keeps its readers on the prototype, so the context this
 * extension sees is an instance, not an object literal. Reading a reader into a local and
 * calling it detached loses the receiver, and pi's `buildContextEntries` reads
 * `this.getEntries()` — which throws on a nullish `this`. Object-literal fixtures cannot
 * catch that, so both shapes below are prototype-backed.
 */
interface RegisteredTool {
	name: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

type ResumeHandler = (event: unknown, ctx: unknown) => void;

interface FakePi {
	registered: RegisteredTool[];
	handlers: ResumeHandler[];
	registerTool(tool: RegisteredTool): void;
	on(event: string, handler: ResumeHandler): void;
}

function createFakePi(): FakePi {
	const registered: RegisteredTool[] = [];
	const handlers: ResumeHandler[] = [];
	return {
		registered,
		handlers,
		registerTool(tool: RegisteredTool) {
			registered.push(tool);
		},
		on(_event: string, handler: ResumeHandler) {
			handlers.push(handler);
		},
	};
}

function freshTool(): unknown {
	return {
		name: "subagent",
		label: "Subagent",
		description: "Fresh description.",
		promptSnippet: "Fresh snippet",
		promptGuidelines: [delegationLevelGuideline("standard")],
		parameters: { type: "object" },
		execute: async () => "ok",
	};
}

/** One system entry declaring this tool with drifted text, plus the rendered sections. */
function declarationEntry(): Record<string, unknown> {
	return {
		type: "message",
		id: "e1",
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: {
			role: "system",
			content: "",
			sections: { tools: "- subagent: Recorded snippet", rules: `- ${delegationLevelGuideline("aggressive")}` },
			toolsAdded: [{ name: "subagent", description: "Recorded description.", parameters: { type: "object" } }],
			timestamp: 1,
		},
	};
}

/** Prototype-backed stand-in for pi's session manager. */
class StubSessionManager {
	entries: Record<string, unknown>[] = [declarationEntry()];
	getEntries(): Record<string, unknown>[] {
		return this.entries;
	}
	buildContextEntries(): Record<string, unknown>[] {
		// Mirrors pi: reads other readers through `this`.
		return this.getEntries().filter((entry) => entry != null);
	}
}

function pinThroughCtx(ctx: unknown): RegisteredTool[] {
	const pi = createFakePi();
	registerPinnedTool(pi as never, freshTool() as never);
	for (const handler of pi.handlers) handler({}, ctx);
	return pi.registered;
}

describe("tool declaration pinning against a real-shaped session manager", () => {
	it("reads entries through a prototype-backed session manager without losing the receiver", () => {
		const manager = new StubSessionManager();
		assert.equal(typeof manager.buildContextEntries, "function");

		const registered = pinThroughCtx({ sessionManager: manager });

		// A detached reader throws before reaching the pin, so this asserts the call shape too.
		assert.equal(registered.length, 2, "expected the fresh register plus one pinned register");
		assert.equal(registered[1]?.description, "Recorded description.");
		assert.equal(registered[1]?.promptSnippet, "Recorded snippet");
		assert.deepEqual(registered[1]?.promptGuidelines, [delegationLevelGuideline("aggressive")]);
	});

	it("falls back to getEntries when the manager projects nothing", () => {
		class ProjectOnlyManager extends StubSessionManager {
			override buildContextEntries(): Record<string, unknown>[] {
				return [];
			}
		}
		// An empty projection means nothing reached the model: keep the fresh definition.
		const registered = pinThroughCtx({ sessionManager: new ProjectOnlyManager() });
		assert.equal(registered.length, 1);
		assert.equal(registered[0]?.description, "Fresh description.");
	});

	it("pins using the real pi session manager when one is installed", async () => {
		const entry = resolveInstalledPi();
		if (!entry) {
			return; // No installed pi to load here; the stubbed shape above covers the call shape.
		}
		const pi = await import(entry);
		const manager = pi.SessionManager.create(process.cwd(), path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-pin-")), "sessions"));
		if (typeof manager.buildContextEntries !== "function") {
			return; // Older pi: the projection path does not exist to regress.
		}
		manager.appendMessage(declarationEntry().message as never);

		const registered = pinThroughCtx({ sessionManager: manager });

		assert.equal(registered.length, 2);
		assert.equal(registered[1]?.description, "Recorded description.");
	});
});

/**
 * Locate an installed pi package, preferring the documented isolated SDK root.
 *
 * The test harness rewrites HOME to a scratch directory, so the real home is taken from
 * the account record when the environment variable points somewhere temporary.
 */
function resolveInstalledPi(): string | undefined {
	const candidates: string[] = [];
	const sdkRoot = process.env.PI_CCIOTTI_NATIVE_SDK?.trim();
	if (sdkRoot) candidates.push(path.join(sdkRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js"));

	const homes = [process.env.HOME ?? os.homedir(), safeRealHome()].filter((home): home is string => Boolean(home));
	for (const home of homes) {
		for (const rel of [
			path.join(".bun", "install", "global", "node_modules"),
			path.join(".npm-global", "lib", "node_modules"),
		]) {
			candidates.push(path.join(home, rel, "@earendil-works", "pi-coding-agent", "dist", "index.js"));
		}
		// mise keeps node under a version directory, so widen that one with a glob.
		const miseRoot = path.join(home, ".local", "share", "mise", "installs", "node");
		for (const version of readdir(miseRoot)) {
			candidates.push(path.join(miseRoot, version, "lib", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js"));
		}
	}
	for (const root of ["/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules"]) {
		candidates.push(path.join(root, "@earendil-works", "pi-coding-agent", "dist", "index.js"));
	}
	return candidates.find((candidate) => fs.existsSync(candidate));
}

/** Directory names under `dir`, or empty when it is absent. */
function readdir(dir: string): string[] {
	try {
		return fs.readdirSync(dir);
	} catch {
		return [];
	}
}

/** The account home, which survives a scratch HOME override. */
function safeRealHome(): string | undefined {
	try {
		return os.userInfo().dir;
	} catch {
		return undefined;
	}
}
