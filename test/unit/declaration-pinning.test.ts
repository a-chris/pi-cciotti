import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerPinnedTool } from "../../src/extension/declaration-pinning.ts";
import { DELEGATION_LEVELS, delegationLevelGuideline } from "../../src/policy/delegation-level.ts";

interface FakeTool {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: Record<string, unknown>;
	execute: () => Promise<unknown>;
}

interface FakePi {
	registered: FakeTool[];
	handlers: Array<{ event: string; handler: (event: unknown, ctx: unknown) => void }>;
}

function createFakePi(): FakePi {
	const pi: FakePi = { registered: [], handlers: [] };
	const api = {
		registerTool(tool: FakeTool) {
			pi.registered.push(tool);
		},
		on(event: string, handler: (event: unknown, ctx: unknown) => void) {
			pi.handlers.push({ event, handler });
		},
	};
	// The extension API surface is wider than the two members this module uses.
	return Object.assign(pi, api) as FakePi;
}

function systemEntry(message: Record<string, unknown>): Record<string, unknown> {
	return { type: "message", id: "e1", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message };
}

/** The module reads only the session manager's entry list, so the context is that alone. */
function createContext(entries: Record<string, unknown>[]): unknown {
	return { sessionManager: { getEntries: () => entries } };
}

function freshTool(overrides: Partial<FakeTool> = {}): FakeTool {
	return {
		name: "subagent",
		label: "Subagent",
		description: "Fresh description.",
		promptSnippet: "Fresh snippet",
		promptGuidelines: [delegationLevelGuideline("standard")],
		parameters: { type: "object", properties: { task: { type: "string" } } },
		execute: async () => "ok",
		...overrides,
	};
}

function recordedToolJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		name: "subagent",
		description: "Recorded description.",
		parameters: { type: "object", properties: { task: { type: "string" } } },
		...overrides,
	};
}

/** A system entry carrying this tool declaration and the rendered prompt sections. */
function declarationEntry(tools: Record<string, unknown>[], sections: Record<string, string | null>) {
	return systemEntry({ role: "system", content: "", sections, toolsAdded: tools, timestamp: 1 });
}

function fireHandlers(pi: FakePi, ctx: unknown): void {
	for (const { handler } of pi.handlers) handler({}, ctx);
}

function rulesFor(...bullets: string[]): string {
	return bullets.map((bullet) => `- ${bullet}`).join("\n");
}

describe("tool declaration pinning", () => {
	it("registers the fresh definition immediately and hooks the resume events", () => {
		const pi = createFakePi();
		registerPinnedTool(pi as never, freshTool() as never);

		assert.equal(pi.registered.length, 1);
		assert.equal(pi.registered[0]?.description, "Fresh description.");
		assert.deepEqual(
			pi.handlers.map((entry) => entry.event),
			["session_start", "session_tree"],
		);
	});

	it("re-registers with the recorded declaration when the transcript drifted", () => {
		const pi = createFakePi();
		registerPinnedTool(pi as never, freshTool() as never);

		const rules = rulesFor(delegationLevelGuideline("aggressive"), "Be concise in your responses");
		fireHandlers(pi, createContext([
			declarationEntry([recordedToolJson()], { tools: "- subagent: Recorded snippet", rules }),
		]));

		assert.equal(pi.registered.length, 2);
		const pinned = pi.registered[1];
		assert.equal(pinned?.description, "Recorded description.");
		assert.equal(pinned?.promptSnippet, "Recorded snippet");
		assert.deepEqual(pinned?.promptGuidelines, [delegationLevelGuideline("aggressive")]);
		// Behaviour fields keep coming from the fresh definition.
		assert.deepEqual(pinned?.parameters, { type: "object", properties: { task: { type: "string" } } });
		assert.equal(pinned?.label, "Subagent");
		assert.equal(typeof pinned?.execute, "function");
	});

	it("drops pi's fixed trailing rules and keeps this tool's own bullet", () => {
		const pi = createFakePi();
		registerPinnedTool(pi as never, freshTool() as never);

		// The recorded session ran with a different delegation level plus unrelated rules.
		const rules = rulesFor(
			"Use bash for file operations like ls, rg, find",
			delegationLevelGuideline("rarely"),
			"Be concise in your responses",
		);
		fireHandlers(pi, createContext([
			declarationEntry([recordedToolJson({ description: "Fresh description." })], { tools: "- subagent: Fresh snippet", rules }),
		]));

		assert.equal(pi.registered.length, 2);
		assert.deepEqual(pi.registered[1]?.promptGuidelines, [delegationLevelGuideline("rarely")]);
	});

	it("falls back to the fresh guidelines when the recorded rules hold none of them", () => {
		const pi = createFakePi();
		registerPinnedTool(pi as never, freshTool() as never);

		fireHandlers(pi, createContext([
			declarationEntry([recordedToolJson({ description: "Other description." })], {
				tools: "- subagent: Fresh snippet",
				rules: rulesFor("Be concise in your responses"),
			}),
		]));

		assert.equal(pi.registered.length, 2);
		assert.equal(pi.registered[1]?.description, "Other description.");
		assert.deepEqual(pi.registered[1]?.promptGuidelines, [delegationLevelGuideline("standard")]);
	});

	it("does not re-register when the fresh definition already matches", () => {
		const pi = createFakePi();
		const guidelines = [delegationLevelGuideline("standard")];
		registerPinnedTool(pi as never, freshTool() as never);

		fireHandlers(pi, createContext([
			declarationEntry([recordedToolJson({ description: "Fresh description." })], {
				tools: "- subagent: Fresh snippet",
				rules: rulesFor(...guidelines, "Be concise in your responses"),
			}),
		]));

		assert.equal(pi.registered.length, 1);
	});

	it("leaves the fresh definition alone when the transcript declares nothing yet", () => {
		const pi = createFakePi();
		registerPinnedTool(pi as never, freshTool() as never);

		fireHandlers(pi, createContext([
			systemEntry({ role: "system", content: "prompt", sections: { rules: "- Be concise" }, timestamp: 1 }),
			declarationEntry([{ name: "bg_wait", description: "other" }], { tools: "- bg_wait: other", rules: "" }),
		]));

		assert.equal(pi.registered.length, 1);
	});

	it("reads the recorded declaration from the latest system message", () => {
		const pi = createFakePi();
		registerPinnedTool(pi as never, freshTool() as never);

		fireHandlers(pi, createContext([
			declarationEntry([recordedToolJson({ description: "Oldest description." })], {
				tools: "- subagent: Oldest snippet",
				rules: rulesFor(delegationLevelGuideline("never")),
			}),
			declarationEntry([recordedToolJson({ description: "Latest description." })], {
				tools: "- subagent: Latest snippet",
				rules: rulesFor(delegationLevelGuideline("rarely")),
			}),
		]));

		assert.equal(pi.registered.length, 2);
		assert.equal(pi.registered[1]?.description, "Latest description.");
		assert.equal(pi.registered[1]?.promptSnippet, "Latest snippet");
		assert.deepEqual(pi.registered[1]?.promptGuidelines, [delegationLevelGuideline("rarely")]);
	});

	it("does not invent guidelines for a tool that declares none", () => {
		const pi = createFakePi();
		registerPinnedTool(pi as never, freshTool({ promptSnippet: undefined, promptGuidelines: undefined }) as never);

		fireHandlers(pi, createContext([
			declarationEntry([recordedToolJson()], { tools: "", rules: rulesFor("Be concise in your responses") }),
		]));

		assert.equal(pi.registered.length, 2);
		assert.equal(pi.registered[1]?.description, "Recorded description.");
		assert.equal(pi.registered[1]?.promptGuidelines, undefined);
	});

	it("recognises a recorded delegation level different from the fresh one", () => {
		// The recovery filter matches recorded bullets against candidate bullets, so a level
		// switch must still be recognised instead of dropped.
		for (const level of DELEGATION_LEVELS) {
			const pi = createFakePi();
			registerPinnedTool(pi as never, freshTool() as never);

			fireHandlers(pi, createContext([
				declarationEntry([recordedToolJson({ description: "Fresh description." })], {
					tools: "- subagent: Fresh snippet",
					rules: rulesFor(delegationLevelGuideline(level), "Show file paths clearly when working with files"),
				}),
			]));

			const changed = level !== "standard";
			assert.equal(pi.registered.length, changed ? 2 : 1, `level ${level} should ${changed ? "" : "not "}re-register`);
			assert.deepEqual(pi.registered.at(-1)?.promptGuidelines, [delegationLevelGuideline(level)]);
		}
	});
});
