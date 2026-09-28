import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";
import { resolveAsyncByDefault } from "../../src/extension/config.ts";

type JsonSchemaNode = Record<string, unknown>;

interface SubagentParamsSchema {
	properties?: {
		context?: {
			type?: string;
			enum?: string[];
			description?: string;
		};
		tasks?: {
			items?: {
				properties?: {
					count?: {
						minimum?: number;
						description?: string;
					};
				};
			};
		};
		concurrency?: {
			minimum?: number;
			description?: string;
		};
		workflow?: {
			type?: string;
			minLength?: number;
			description?: string;
		};
		args?: JsonSchemaNode;
		workflowScript?: {
			type?: string;
			minLength?: number;
			description?: string;
		};
		workflowScriptPath?: {
			type?: string;
			minLength?: number;
			description?: string;
		};
		globalConcurrencyLimit?: {
			type?: string;
			minimum?: number;
			maximum?: number;
			description?: string;
		};
		maxSubagentSpawnsPerRun?: {
			type?: string;
			minimum?: number;
			maximum?: number;
			description?: string;
		};
		preflight?: JsonSchemaNode;
		timeoutMs?: {
			minimum?: number;
			description?: string;
		};
		maxRuntimeMs?: {
			minimum?: number;
			description?: string;
		};
		turnBudget?: {
			properties?: {
				maxTurns?: { minimum?: number };
				graceTurns?: { minimum?: number };
			};
		};
		id?: {
			type?: string;
			description?: string;
		};
		runId?: {
			type?: string;
			description?: string;
		};
		dir?: {
			type?: string;
			description?: string;
		};
		action?: {
			type?: string;
			enum?: string[];
			description?: string;
		};
		capabilities?: {
			type?: string;
			description?: string;
		};
		view?: {
			type?: string;
			enum?: string[];
			description?: string;
		};
		lines?: {
			minimum?: number;
			maximum?: number;
			description?: string;
		};
		control?: {
			properties?: {
				needsAttentionAfterMs?: { minimum?: number };
				activeNoticeAfterMs?: { minimum?: number };
				activeNoticeAfterTurns?: { minimum?: number };
				activeNoticeAfterTokens?: { minimum?: number };
				failedToolAttemptsBeforeAttention?: { minimum?: number };
				notifyOn?: { items?: { enum?: string[] } };
				notifyChannels?: { items?: { enum?: string[] } };
			};
		};
		skill?: JsonSchemaNode;
		output?: JsonSchemaNode;
		config?: JsonSchemaNode;
		chain?: {
			items?: JsonSchemaNode & {
				properties?: Record<string, JsonSchemaNode>;
			};
		};
	};
}

function missingPackageName(error: unknown): string | undefined {
	const message = error instanceof Error ? error.message : String(error);
	return message.match(/Cannot find package ['"]([^'"]+)['"]/i)?.[1];
}

function anyOfBranches(schema: JsonSchemaNode | undefined): JsonSchemaNode[] {
	const anyOf = schema?.anyOf;
	if (!Array.isArray(anyOf)) return [];
	return anyOf.filter((branch): branch is JsonSchemaNode => !!branch && typeof branch === "object");
}

function hasAnyOfType(schema: JsonSchemaNode | undefined, type: string): boolean {
	return anyOfBranches(schema).some((branch) => branch.type === type);
}

function hasAnyOfArrayWithStringItems(schema: JsonSchemaNode | undefined): boolean {
	return anyOfBranches(schema).some((branch) => {
		if (branch.type !== "array") return false;
		const items = branch.items;
		return !!items && typeof items === "object" && (items as JsonSchemaNode).type === "string";
	});
}

function getPropertySchema(schema: JsonSchemaNode | undefined, path: string[]): JsonSchemaNode | undefined {
	let current: unknown = schema;
	for (const key of path) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as JsonSchemaNode).properties;
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current && typeof current === "object" ? current as JsonSchemaNode : undefined;
}

let schemas: Record<string, JsonSchemaNode> = {};
let SubagentParams: SubagentParamsSchema | undefined;
let SubagentWaitParams: JsonSchemaNode | undefined;
let schemasAvailable = true;
try {
	schemas = await import("../../src/extension/schemas.ts") as Record<string, JsonSchemaNode>;
	SubagentParams = schemas.SubagentParams as SubagentParamsSchema;
	SubagentWaitParams = schemas.SubagentWaitParams as JsonSchemaNode;
} catch (error) {
	if (missingPackageName(error) !== "typebox") throw error;
	schemasAvailable = false;
}
let CompileSchema: ((schema: unknown) => { Check(value: unknown): boolean; Errors(value: unknown): Iterable<{ message: string }> }) | undefined;
try {
	const compileModule = await import("typebox/compile") as { Compile: typeof CompileSchema };
	CompileSchema = compileModule.Compile;
} catch (error) {
	if (missingPackageName(error) !== "typebox") throw error;
	// The structural schema assertions below do not need the optional compiler package.
}

describe("SubagentParams schema", { skip: !schemasAvailable ? "typebox not available" : undefined }, () => {
	it("accepts object or false output schema overrides and rejects null", () => {
		assert.ok(SubagentParams);
		assert.ok(CompileSchema);
		const validator = CompileSchema!(SubagentParams);
		const base = { agent: "worker", task: "work" };
		assert.equal(validator.Check({ ...base, outputSchema: { type: "object" } }), true);
		assert.equal(validator.Check({ ...base, outputSchema: false }), true);
		assert.equal(validator.Check({ ...base, outputSchema: null }), false);
	});

	it("includes context field with agent-owned precedence for fresh/fork/summary execution mode", () => {
		const contextSchema = SubagentParams?.properties?.context;
		assert.ok(contextSchema, "context schema should exist");
		assert.equal(contextSchema.type, "string");
		assert.deepEqual(contextSchema.enum, ["fresh", "fork", "summary"]);
		const description = String(contextSchema.description ?? "");
		assert.match(description, /fresh/);
		assert.match(description, /fork/);
		assert.match(description, /summary/);
		assert.match(description, /overrides every child/);
		assert.match(description, /each agent's declared defaultContext/);
		assert.match(description, /implicit fork/);
		assert.match(description, /else fresh/);
		assert.doesNotMatch(description, /profile/);
		assert.doesNotMatch(description, /defaultSubagentContext/);
	});

	it("exposes named resources plus raw inline and file workflow script modes", () => {
		const workflow = SubagentParams?.properties?.workflow;
		assert.equal(workflow?.type, "string");
		assert.equal(workflow?.minLength, 1);
		assert.match(String(workflow?.description ?? ""), /extension-owned workflow resource/i);
		const args = SubagentParams?.properties?.args;
		assert.equal(args?.type, "object");
		assert.equal(args?.maxProperties, 16);
		assert.match(String(args?.description ?? ""), /bounded plain-JSON/i);
		assert.match(String(args?.description ?? ""), /inline.*file-backed.*deeply frozen.*persisted.*secrets/i);
		const workflowScript = SubagentParams?.properties?.workflowScript;
		assert.equal(workflowScript?.type, "string");
		assert.equal(workflowScript?.minLength, 1);
		assert.match(String(workflowScript?.description ?? ""), /Inline JavaScript statement body/);
		assert.match(String(workflowScript?.description ?? ""), /top-level await/);
		assert.match(String(workflowScript?.description ?? ""), /no runs.host/);
		assert.match(String(workflowScript?.description ?? ""), /guide workflows/);
		const workflowScriptPath = SubagentParams?.properties?.workflowScriptPath;
		assert.equal(workflowScriptPath?.type, "string");
		assert.equal(workflowScriptPath?.minLength, 1);
		assert.match(String(workflowScriptPath?.description ?? ""), /mutually exclusive with workflowScript/i);
		assert.match(String(workflowScriptPath?.description ?? ""), /request cwd/i);
		assert.match(String(workflowScriptPath?.description ?? ""), /host reads.*before sandbox/i);
		for (const name of ["globalConcurrencyLimit", "maxSubagentSpawnsPerRun"] as const) {
			const capacity = SubagentParams?.properties?.[name];
			assert.equal(capacity?.type, "integer");
			assert.equal(capacity?.minimum, 1);
		}
		const preflight = SubagentParams?.properties?.preflight;
		assert.equal(preflight?.type, "object");
		assert.equal(preflight?.additionalProperties, false);
		assert.match(String(preflight?.description ?? ""), /display-only/i);
		assert.equal((preflight?.properties as JsonSchemaNode | undefined)?.version?.minimum, 1);
		assert.equal((preflight?.properties as JsonSchemaNode | undefined)?.version?.maximum, 1);
		assert.equal((preflight?.properties as JsonSchemaNode | undefined)?.lanes?.maxItems, 64);
		const worktree = SubagentParams?.properties?.worktree;
		assert.equal(worktree?.type, "boolean");
		assert.match(String(worktree?.description ?? ""), /each workflow child/i);
		const isolation = SubagentParams?.properties?.isolation;
		assert.equal(isolation?.type, "string");
		assert.deepEqual(isolation?.enum, ["none", "worktree"]);
		const gate = SubagentParams?.properties?.gate;
		assert.equal(gate?.type, "string");
		assert.equal(gate?.minLength, 1);
		assert.match(String(gate?.description ?? ""), /cannot be combined with acceptance/i);
		const properties = SubagentParams?.properties as Record<string, JsonSchemaNode> | undefined;
		assert.equal(properties?.task?.type, "string");
		assert.match(String(properties?.task?.description ?? ""), /one-child/i);
		assert.match(String((properties?.agent as JsonSchemaNode | undefined)?.description ?? ""), /one-child/i);
		assert.equal(properties?.clarify, undefined, "clarify should not be model-facing");
		assert.ok(properties?.output, "output remains a workflow child default");
		assert.match(String(properties?.output?.description ?? ""), /relative workflow paths use managed artifact routing/i);
		assert.match(String(properties?.output?.description ?? ""), /Bind durable output here, not task prose/i);
		assert.match(String(properties?.output?.description ?? ""), /outputReference.*outputPathMapping.*artifactPaths/i);
	});

	it("omits removed legacy and workflow-child-only fields", () => {
		for (const name of ["tasks", "chain", "concurrency", "chainDir", "step", "resume", "chatProgress"]) {
			assert.equal((SubagentParams?.properties as Record<string, unknown> | undefined)?.[name], undefined, `${name} should not be public`);
		}
	});

	it("allows runtime validation of management and control action strings", () => {
		const actionSchema = SubagentParams?.properties?.action;
		assert.ok(actionSchema, "action schema should exist");
		assert.equal(actionSchema.type, "string");
		assert.equal(actionSchema.minLength, 1);
		assert.equal(actionSchema.enum, undefined);
		const description = String(actionSchema.description ?? "");
		assert.match(description, /Management\/control only; omit for execution/);
		assert.match(description, /validate accepts either script input/);
		assert.match(description, /guide topic tool-reference/);
		assert.doesNotMatch(description, /orchestration\./);
	});

	it("accepts prompt-free capability discovery on list requests", () => {
		const capabilitiesSchema = SubagentParams?.properties?.capabilities;
		assert.ok(capabilitiesSchema, "capabilities schema should exist");
		assert.equal(capabilitiesSchema.type, "boolean");
		const description = String(capabilitiesSchema.description ?? "");
		assert.match(description, /list:/i);
		assert.match(description, /compact/i);
		assert.match(description, /system prompt/i);

		if (CompileSchema) {
			const validator = CompileSchema(SubagentParams);
			assert.equal(validator.Check({ action: "list", capabilities: true }), true);
			assert.equal(validator.Check({ action: "list", capabilities: "true" }), false);
		}
	});

	it("keeps agentContract.version as integer bounds without an enum (Gemini schema subset)", () => {
		const agentContract = (SubagentParams?.properties as Record<string, JsonSchemaNode> | undefined)?.agentContract;
		assert.ok(agentContract, "agentContract schema should exist");
		const version = (agentContract.properties as Record<string, JsonSchemaNode> | undefined)?.version;
		assert.ok(version, "agentContract.version schema should exist");
		assert.equal(version.type, "integer");
		assert.equal(version.minimum, 1);
		assert.equal(version.maximum, 1);
		assert.equal(version.enum, undefined);
	});

	it("documents workflow timeout aliases and omits removed turn budgets", () => {
		const timeoutSchema = SubagentParams?.properties?.timeoutMs;
		const maxRuntimeSchema = SubagentParams?.properties?.maxRuntimeMs;
		const turnBudgetSchema = SubagentParams?.properties?.turnBudget;
		const toolBudgetSchema = SubagentParams?.properties?.toolBudget;
		assert.ok(timeoutSchema, "timeoutMs schema should exist");
		assert.ok(maxRuntimeSchema, "maxRuntimeMs schema should exist");
		assert.equal(timeoutSchema.minimum, 1);
		assert.equal(maxRuntimeSchema.minimum, 1);
		assert.match(String(timeoutSchema.description ?? ""), /foreground and single async runs/i);
		assert.match(String(timeoutSchema.description ?? ""), /use config timeoutMs, else 30m/i);
		assert.match(String(timeoutSchema.description ?? ""), /async composites have no default parent deadline/i);
		assert.doesNotMatch(String(timeoutSchema.description ?? ""), /foreground-only/i);
		assert.match(String(maxRuntimeSchema.description ?? ""), /timeoutMs/i);
		assert.match(String(maxRuntimeSchema.description ?? ""), /Alias timeoutMs \(same defaults\)/);
		assert.equal(turnBudgetSchema, undefined);
		assert.equal(toolBudgetSchema?.properties?.soft?.minimum, 1);
		assert.equal(toolBudgetSchema?.properties?.hard?.minimum, 1);
	});

	it("includes subagent control fields", () => {
		const idSchema = SubagentParams?.properties?.id;
		assert.ok(idSchema, "id schema should exist");
		assert.equal(idSchema.type, "string");
		assert.match(String(idSchema.description ?? ""), /status/i);
		assert.match(String(idSchema.description ?? ""), /control/i);
		const runIdSchema = SubagentParams?.properties?.runId;
		assert.ok(runIdSchema, "runId schema should exist");
		assert.equal(runIdSchema.type, "string");
		assert.match(String(runIdSchema.description ?? ""), /prefer id/i);
		const dirSchema = SubagentParams?.properties?.dir;
		assert.ok(dirSchema, "dir schema should exist");
		assert.equal(dirSchema.type, "string");
		assert.match(String(dirSchema.description ?? ""), /status/i);
		assert.match(String(dirSchema.description ?? ""), /control/i);

		const viewSchema = SubagentParams?.properties?.view;
		assert.ok(viewSchema, "view schema should exist");
		assert.equal(viewSchema.type, "string");
		assert.deepEqual(viewSchema.enum, ["fleet", "transcript"]);
		assert.match(String(viewSchema.description ?? ""), /status view/i);
		assert.match(String(viewSchema.description ?? ""), /transcript/i);

		const linesSchema = SubagentParams?.properties?.lines;
		assert.ok(linesSchema, "lines schema should exist");
		assert.equal(linesSchema.minimum, 1);
		assert.equal(linesSchema.maximum, 500);
		assert.match(String(linesSchema.description ?? ""), /transcript/i);

		const additionalSchema = SubagentParams?.properties?.additional;
		assert.ok(additionalSchema, "additional schema should exist");
		assert.equal(additionalSchema.minimum, 1);
		assert.match(String(additionalSchema.description ?? ""), /grant-spawn-budget/);
		assert.match(String(additionalSchema.description ?? ""), /root interactive parent/i);

		const controlSchema = SubagentParams?.properties?.control;
		assert.ok(controlSchema, "control schema should exist");
		assert.equal(controlSchema.properties?.needsAttentionAfterMs?.minimum, 1);
		assert.equal(controlSchema.properties?.activeNoticeAfterMs?.minimum, 1);
		assert.equal(controlSchema.properties?.activeNoticeAfterTurns?.minimum, 1);
		assert.equal(controlSchema.properties?.activeNoticeAfterTokens?.minimum, 1);
		assert.equal(controlSchema.properties?.failedToolAttemptsBeforeAttention?.minimum, 1);
		assert.deepEqual(controlSchema.properties?.notifyOn?.items?.enum, ["active_long_running", "needs_attention"]);
		assert.deepEqual(controlSchema.properties?.notifyChannels?.items?.enum, ["event", "async"]);
	});

	it("exposes tolerant wait mode on bg_wait", () => {
		const properties = SubagentWaitParams?.properties as Record<string, JsonSchemaNode> | undefined;
		const id = properties?.id;
		const nonBlocking = properties?.nonBlocking;
		const all = properties?.all;
		const stopOnAttention = properties?.stopOnAttention;
		const timeoutMs = properties?.timeoutMs;
		assert.ok(id, "id schema should exist");
		assert.match(String(id.description ?? ""), /id\/prefix to wait for one specific run/);
		assert.match(String(id.description ?? ""), /already finished returns its stored terminal result references/);
		assert.ok(nonBlocking, "nonBlocking schema should exist");
		assert.match(String(nonBlocking.description ?? ""), /persist a wake subscription, and return immediately/);
		assert.match(String(nonBlocking.description ?? ""), /woken on completion, failure, attention, reconciliation failure, or timeout/);
		assert.match(String(nonBlocking.description ?? ""), /cannot be combined with all/);
		assert.ok(all, "all schema should exist");
		assert.match(String(all.description ?? ""), /every async run, provider item, and remembered detached foreground descendant/);
		assert.doesNotMatch(String(all.description ?? ""), /spawn a replacement/);
		assert.ok(stopOnAttention, "stopOnAttention schema should exist");
		assert.equal(stopOnAttention.type, "boolean");
		assert.match(String(stopOnAttention.description ?? ""), /idle or long-thinking attention/);
		assert.match(String(timeoutMs?.description ?? ""), /waitTool\.defaultTimeoutMs/);
		assert.match(String(timeoutMs?.description ?? ""), /non-error window_elapsed result/);
	});

	/**
	 * The bg_wait anti-overuse guardrail is product, not prose: it is what stops the
	 * model from holding a blocking tool call open on children that already notify
	 * the session natively. It was added in commit 1353c734 by repeating one
	 * sentence in the tool description AND in four of the five parameter descriptions, so
	 * `bg_wait` reached 4,395 chars — 55% of the parent tool surface, paid on every
	 * model call — while saying nothing a single copy plus the guide did not.
	 *
	 * The old assertion required that sentence inside the `id` parameter
	 * description, which made the duplication load-bearing in both directions:
	 * deleting it failed the test, and adding more copies anywhere else passed.
	 * These assert the opposite invariant — the
	 * guardrail survives, and it appears exactly once across the whole surface.
	 * The behavioral depth it was protecting stays taught at the decision point,
	 * where the launch result already says it (`formatAsyncStartedMessage`) and in
	 * the `tool-reference` guide topic.
	 */
	it("states the bg_wait anti-overuse guardrail exactly once, not once per param", async () => {
		const { registerWaitTool } = await import("../../src/runs/background/wait-tool.ts");
		const grab = (child?: { nestedRootRunId?: string }): { description: string } => {
			const registered: Array<{ name: string; description: string }> = [];
			// registerWaitTool only reads `registerTool` when it declares the tool, so
			// the rest of the API surface is irrelevant here (same stub shape as
			// wait-subscriptions.test.ts).
			registerWaitTool({ registerTool: (value: unknown) => registered.push(value as { name: string; description: string }) } as never, {} as never, true, undefined, undefined, child);
			assert.deepEqual(registered.map((entry) => entry.name), ["bg_wait"], "bg_wait must always be registered");
			return registered[0]!;
		};
		const countGuardrails = (text: string): number => (text.match(/already notify this session natively/gi) ?? []).length;
		const parent = grab();
		const serializedTool = JSON.stringify({ description: parent.description, parameters: SubagentWaitParams });

		// The guardrail is present, and stated once for the entire tool.
		assert.equal(countGuardrails(parent.description), 1, "guardrail belongs in the description exactly once");
		assert.equal(countGuardrails(serializedTool), 1, `guardrail must not be restated per-parameter; found ${countGuardrails(serializedTool)} copies`);
		assert.match(parent.description, /do not call this merely to wait on a child/);

		// A child runtime has no native notifier, so the parent guardrail must not
		// leak into it — it would suppress the blocking wait a child needs.
		const child = grab({ nestedRootRunId: "root-run" });
		assert.equal(countGuardrails(child.description), 0, "child runtime must not inherit the parent's notify-natively guardrail");
		assert.match(child.description, /no native completion notifier/);

		// One description per tool, at most 60 words, and the whole tool must stay
		// well under the weight of a single redundant wait call.
		for (const tool of [parent, child]) {
			assert.ok(tool.description.split(/\s+/).filter(Boolean).length <= 60, `bg_wait description exceeds 60 words: ${tool.description}`);
		}
		const total = parent.description.length + JSON.stringify(SubagentWaitParams).length;
		assert.ok(total < 2_200, `expected the whole bg_wait tool under 2200 chars, got ${total}`);
	});

	it("documents the relocated bg_wait wait modes in a served guide topic", () => {
		// Cutting the description must not lose information: the six call shapes the
		// description used to enumerate have to be readable by a model that follows
		// the description's "Depth: guide topic tool-reference." pointer.
		const doc = readFileSync(join(process.cwd(), "docs", "tool-reference.md"), "utf-8");
		assert.ok(SUBAGENT_GUIDE_TOPICS.includes("tool-reference"), "tool-reference must stay a loadable guide topic");
		const section = doc.slice(doc.indexOf("\n## `bg_wait`"));
		assert.ok(section.length > 200, "tool-reference must carry a bg_wait section");
		for (const fact of [
			/first initially active async run|first .* finishes/s,
			/all: true/,
			/nonBlocking: true/,
			/stopOnAttention: false/,
			/timeoutMs/,
			/window_elapsed/,
			/enabled=false/,
		]) {
			assert.match(section, fact, `bg_wait guide section lost a wait mode: ${fact}`);
		}
	});

	it("does not emit description-only schema nodes", () => {
		const descriptionOnlyPaths: string[] = [];

		for (const [name, schema] of Object.entries(schemas)) {
			const stack: Array<{ path: string; value: unknown }> = [{ path: name, value: schema }];
			while (stack.length > 0) {
				const current = stack.pop()!;
				if (!current.value || typeof current.value !== "object") continue;

				const node = current.value as JsonSchemaNode;
				if (Object.hasOwn(node, "description") && !Object.hasOwn(node, "type") && !Object.hasOwn(node, "anyOf")) {
					descriptionOnlyPaths.push(current.path);
				}

				if (Array.isArray(current.value)) {
					current.value.forEach((value, index) => stack.push({ path: `${current.path}[${index}]`, value }));
					continue;
				}

				for (const [key, value] of Object.entries(node)) {
					stack.push({ path: `${current.path}.${key}`, value });
				}
			}
		}

		assert.deepEqual(descriptionOnlyPaths, []);
	});

	it("does not emit array-typed schema nodes without items", () => {
		const missingItemsPaths: string[] = [];

		for (const [name, schema] of Object.entries(schemas)) {
			const stack: Array<{ path: string; value: unknown }> = [{ path: name, value: schema }];
			while (stack.length > 0) {
				const current = stack.pop()!;
				if (!current.value || typeof current.value !== "object") continue;

				const node = current.value as JsonSchemaNode;
				if (node.type === "array" && !Object.hasOwn(node, "items")) {
					missingItemsPaths.push(current.path);
				}

				if (Array.isArray(current.value)) {
					current.value.forEach((value, index) => stack.push({ path: `${current.path}[${index}]`, value }));
					continue;
				}

				for (const [key, value] of Object.entries(node)) {
					stack.push({ path: `${current.path}.${key}`, value });
				}
			}
		}

		assert.deepEqual(missingItemsPaths, []);
	});

	it("keeps only top-level parameter descriptions to keep the provider payload compact", () => {
		assert.ok(SubagentParams, "SubagentParams schema should exist");
		const schema = SubagentParams as unknown as JsonSchemaNode;
		const serialized = JSON.stringify(schema);
		assert.ok(serialized.length <= 13_000, `expected concise schema at or under 13k chars, got ${serialized.length}`);
		assert.equal(serialized.includes('"$ref"'), false);
		assert.equal(serialized.includes('"$defs"'), false);
		assert.equal(serialized.split("Evidence policy;").length - 1, 1);
		assert.match(String((schema.properties as Record<string, JsonSchemaNode> | undefined)?.agent?.description ?? ""), /management target/);
		const acceptanceDescription = String((schema.properties as Record<string, JsonSchemaNode> | undefined)?.acceptance?.description ?? "");
		assert.match(acceptanceDescription, /Evidence policy/);
		assert.match(acceptanceDescription, /guide tool-reference.*levels, evidence and review.required/);
		const missionDescription = String((schema.properties as Record<string, JsonSchemaNode> | undefined)?.mission?.description ?? "");
		assert.match(missionDescription, /exactly one non-empty title or summary/);
		assert.match(missionDescription, /goal only true/);
		assert.match(missionDescription, /requires budget\.tokens/);

		const nestedDescriptionPaths: string[] = [];
		const stack: Array<{ path: string; value: unknown }> = [{ path: "SubagentParams", value: schema }];
		while (stack.length > 0) {
			const current = stack.pop()!;
			if (!current.value || typeof current.value !== "object") continue;
			const node = current.value as JsonSchemaNode;
			const pathParts = current.path.split(".");
			const isTopLevelParameter = pathParts.length === 3 && pathParts[0] === "SubagentParams" && pathParts[1] === "properties";
			if (typeof node.description === "string" && !isTopLevelParameter) nestedDescriptionPaths.push(`${current.path}.description`);
			if (Array.isArray(current.value)) {
				current.value.forEach((value, index) => stack.push({ path: `${current.path}[${index}]`, value }));
			} else {
				for (const [key, value] of Object.entries(node)) stack.push({ path: `${current.path}.${key}`, value });
			}
		}
		assert.deepEqual(nestedDescriptionPaths, []);
	});

	it("preserves TypeBox metadata while pruning provider-visible descriptions", () => {
		assert.ok(SubagentParams, "SubagentParams schema should exist");
		const schema = SubagentParams as unknown as JsonSchemaNode;
		const rootKind = Object.getOwnPropertyDescriptor(schema, "~kind");
		assert.equal(rootKind?.value, "Object");
		assert.equal(rootKind?.enumerable, false);

		const agentSchema = getPropertySchema(schema, ["agent"]);
		assert.equal(Object.getOwnPropertyDescriptor(agentSchema, "~kind")?.enumerable, false);
		assert.equal(Object.getOwnPropertyDescriptor(agentSchema, "~optional")?.value, true);
		assert.equal(Object.getOwnPropertyDescriptor(agentSchema, "~optional")?.enumerable, false);
	});

	it("does not emit provider-rejected schema shapes", () => {
		const rejectedPaths: string[] = [];
		const rejectedKeywords = ["allOf", "const", "if", "then", "not"];

		for (const [name, schema] of Object.entries(schemas)) {
			const stack: Array<{ path: string; value: unknown }> = [{ path: name, value: schema }];
			while (stack.length > 0) {
				const current = stack.pop()!;
				if (!current.value || typeof current.value !== "object") continue;

				const node = current.value as JsonSchemaNode;
				// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Inspecting JSON Schema enum representation is the portability contract under test.
				if (Array.isArray(node.enum) && node.enum.some((value) => typeof value !== "string")) {
					rejectedPaths.push(`${current.path}.enum`);
				}
				if (Array.isArray(node.type)) {
					rejectedPaths.push(`${current.path}.type`);
				}
				if (Object.hasOwn(node, "anyOf") && Object.hasOwn(node, "type")) {
					rejectedPaths.push(`${current.path}.type+anyOf`);
				}
				for (const keyword of rejectedKeywords) {
					if (Object.hasOwn(node, keyword)) rejectedPaths.push(`${current.path}.${keyword}`);
				}

				if (Array.isArray(current.value)) {
					current.value.forEach((value, index) => stack.push({ path: `${current.path}[${index}]`, value }));
					continue;
				}

				for (const [key, value] of Object.entries(node)) {
					stack.push({ path: `${current.path}.${key}`, value });
				}
			}
		}

		assert.deepEqual(rejectedPaths, []);
	});

	it("uses provider-friendly anyOf unions for flexible fields and chain items", () => {
		const skillSchema = SubagentParams?.properties?.skill;
		assert.ok(skillSchema, "skill schema should exist");
		assert.equal(skillSchema.type, undefined);
		assert.equal(hasAnyOfArrayWithStringItems(skillSchema), true);
		assert.equal(hasAnyOfType(skillSchema, "boolean"), true);
		assert.equal(hasAnyOfType(skillSchema, "string"), true);

		const outputSchema = SubagentParams?.properties?.output;
		assert.ok(outputSchema, "output schema should exist");
		assert.equal(outputSchema.type, undefined);
		assert.equal(hasAnyOfType(outputSchema, "string"), true);
		assert.equal(hasAnyOfType(outputSchema, "boolean"), true);

		const configSchema = SubagentParams?.properties?.config;
		assert.ok(configSchema, "config schema should exist");
		assert.equal(configSchema.type, undefined);
		assert.equal(anyOfBranches(configSchema).some((branch) => branch.type === "object" && branch.additionalProperties === true), true);
		assert.equal(hasAnyOfType(configSchema, "string"), true);

		const acceptanceSchema = SubagentParams?.properties?.acceptance;
		assert.ok(acceptanceSchema, "acceptance schema should exist");
		assert.equal(acceptanceSchema.type, undefined);
		assert.equal(hasAnyOfType(acceptanceSchema, "string"), true);
		assert.equal(hasAnyOfType(acceptanceSchema, "boolean"), true);
		const acceptanceStringBranches = anyOfBranches(acceptanceSchema).filter((branch) => branch.type === "string");
		const acceptanceLevelBranch = acceptanceStringBranches.find((branch) => Array.isArray(branch.enum) && branch.enum.includes("auto"));
		assert.deepEqual(acceptanceLevelBranch?.enum, ["auto", "attested", "checked"], "verified requires object form with runtime commands");
		const reviewedRecoveryBranch = acceptanceStringBranches.find((branch) => Array.isArray(branch.enum) && branch.enum.includes("reviewed"));
		assert.deepEqual(reviewedRecoveryBranch?.enum, ["reviewed"]);
		assert.equal(reviewedRecoveryBranch?.deprecated, true);
		const acceptanceObjectStringBranch = acceptanceStringBranches.find((branch) => branch.enum === undefined);
		assert.equal(acceptanceObjectStringBranch?.pattern, "^\\s*\\{", "acceptance should tolerate only object-shaped JSON strings");
		assert.match(String(acceptanceSchema.description ?? ""), /omit for read-only\/review/i);
		assert.match(String(acceptanceSchema.description ?? ""), /prefer object/i);
		assert.match(String(acceptanceSchema.description ?? ""), /false disables; true invalid/i);
		assert.match(String(acceptanceSchema.description ?? ""), /review\.required/);
		const acceptanceObjectBranch = anyOfBranches(acceptanceSchema).find((branch) => branch.type === "object");
		assert.ok(acceptanceObjectBranch, "acceptance should support object config");
		assert.equal(acceptanceObjectBranch.additionalProperties, true);
		assert.equal(JSON.stringify(acceptanceObjectBranch).includes('"anyOf"'), false);

	});

	it("validates representative flexible field values with TypeBox compiler", { skip: !CompileSchema ? "typebox compiler not available" : undefined }, () => {
		assert.ok(SubagentParams, "SubagentParams schema should exist");
		assert.ok(CompileSchema, "TypeBox compiler should exist");
		const validator = CompileSchema(SubagentParams);
		// Transport accepts both booleans; semantic boundaries still reject unsupported true.
		for (const field of ["acceptance", "mission"]) {
			assert.deepEqual(anyOfBranches(SubagentParams.properties[field]).find((branch) => branch.type === "boolean"), { type: "boolean" });
			assert.equal(validator.Check({ [field]: false }), true);
			assert.equal(validator.Check({ [field]: true }), true);
			assert.equal(validator.Check({ [field]: 123 }), false);
		}
		for (const acceptance of ["auto", "attested", "checked", false, { level: "checked" }, '{"level":"checked"}', '  \n {"level":"checked"}']) {
			assert.equal(validator.Check({ agent: "worker", task: "Fix", acceptance }), true, `${JSON.stringify(acceptance)} acceptance should validate`);
		}
		for (const acceptance of ["cheked", "none", "verified", "not-json", '[{"level":"checked"}]']) {
			assert.equal(validator.Check({ agent: "worker", task: "Fix", acceptance }), false, `${JSON.stringify(acceptance)} acceptance should not validate`);
		}
		const validValues = [
			{ skill: "review" },
			{ workflowScript: "return await runs.run(\"one\", {agent: \"reviewer\", task: \"check\"})" },
			{ workflowScriptPath: "workflows/review.js" },
			{ skill: false },
			{ action: "get", agent: "worker" },
			{ workflowScript: "return runs.run('main', { agent: 'worker', task: 'Fix', acceptance: false })", timeoutMs: 1000 },
			{ action: "steer", id: "run-1", message: "focus on tests" },
			{ action: "steer", id: "run-1", index: 0, message: "focus on tests" },
			{ action: "not-a-real-action" },
			{ config: { name: "reviewer", description: "Review things" } },
			{ config: JSON.stringify({ name: "reviewer", description: "Review things" }) },
			{ agent: "worker", task: "Fix", acceptance: JSON.stringify({ level: "checked", evidence: ["commands-run"] }) },
		];
		const invalidValues = [
			{ skill: 123 },
			{ skill: [123] },
			{ output: 123 },
			{ timeoutMs: 0 },
			{ maxRuntimeMs: -1 },
			{ config: [] },
			{ config: null },
			{ agent: "worker", task: "Fix", toolBudget: { hard: 0 } },
			{ agent: "worker", task: "Fix", toolBudget: { hard: 3, soft: 0 } },
			{ agent: "worker", task: "Fix", toolBudget: { hard: 3, block: [123] } },
			{ agent: "worker", task: "Fix", toolBudget: { hard: 3, block: [] } },
			{ agent: "worker", task: "Fix", toolBudget: { hard: 3, block: "read" } },
		];

		for (const value of validValues) {
			assert.doesNotThrow(() => validator.Check(value), `validator should not throw for ${JSON.stringify(value)}`);
			assert.equal(
				validator.Check(value),
				true,
				`${JSON.stringify(value)} should validate: ${[...validator.Errors(value)].map((error) => error.message).join(", ")}`,
			);
		}
		for (const value of invalidValues) {
			assert.equal(validator.Check(value), false, `${JSON.stringify(value)} should not validate`);
		}
	});
});

describe("facade schemas", { skip: !schemasAvailable ? "typebox not available" : undefined }, () => {
	function properties(schema: unknown): Record<string, JsonSchemaNode> {
		const props = (schema as JsonSchemaNode | undefined)?.properties;
		return (props && typeof props === "object" ? props : {}) as Record<string, JsonSchemaNode>;
	}

	it("delegation facade matches the target shape", () => {
		const delegation = schemas.SubagentDelegationParams as JsonSchemaNode;
		assert.ok(delegation, "SubagentDelegationParams schema should exist");
		const props = properties(delegation);
		// `agent` is required because no default agent exists: an agent-less call
		// cannot be carried out, so it must not be representable.
		assert.deepEqual(delegation.required, ["task", "agent"]);
		assert.deepEqual(Object.keys(props).sort(), [
			"agent", "async", "cwd", "output", "prequel", "reads", "task", "worktree",
		].sort());
		assert.equal(props.task?.type, "string");
		assert.equal(props.agent?.type, "string");
		assert.doesNotMatch(String(props.agent?.description ?? ""), /default agent when omitted/i);
		// Model and provider are never call inputs; they come from settings/agent defs.
		for (const forbidden of ["model", "provider", "thinking", "fast"]) {
			assert.equal(props[forbidden], undefined, `${forbidden} must not be a subagent input`);
		}
		assert.match(String(props.task?.description ?? ""), /action to do or problem to solve/);
		assert.equal(props.prequel?.type, "string");
		assert.match(String(props.prequel?.description ?? ""), /separate from task/i);
		assert.match(String(props.prequel?.description ?? ""), /fork\|summary/);
		assert.match(String(props.prequel?.description ?? ""), /fresh/);
		assert.equal(props.async?.type, "boolean");
		assert.equal(props.worktree?.type, "boolean");
		assert.equal(props.cwd?.type, "string");
		assert.equal(props.reads?.type, "array");
		assert.equal((props.reads?.items as JsonSchemaNode | undefined)?.type, "string");
		assert.equal(hasAnyOfType(props.output, "string"), true);
		assert.equal(hasAnyOfType(props.output, "boolean"), true);
	});

	it("workflow facade matches the target shape", () => {
		const workflow = schemas.SubagentWorkflowParams as JsonSchemaNode;
		assert.ok(workflow, "SubagentWorkflowParams schema should exist");
		const props = properties(workflow);
		assert.deepEqual(Object.keys(props).sort(), [
			"args", "async", "baseRef", "source", "workflow", "worktree",
		].sort());
		assert.equal(props.workflow?.type, "string");
		assert.equal(props.async?.type, "boolean");
		assert.equal(props.worktree?.type, "boolean");
		assert.equal(props.baseRef?.type, "string");
		assert.equal(hasAnyOfType(props.source, "string"), true);
		const sourceObjectBranch = anyOfBranches(props.source).find((branch) => branch.type === "object") ?? {};
		const pathProp = (sourceObjectBranch.properties as Record<string, JsonSchemaNode> | undefined)?.path;
		assert.equal(pathProp?.type, "string");
		assert.equal(props.args?.type, "object");
	});

	it("control facade matches the target shape with a closed action enum", () => {
		const control = schemas.SubagentControlParams as JsonSchemaNode;
		assert.ok(control, "SubagentControlParams schema should exist");
		const props = properties(control);
		assert.deepEqual(Object.keys(props).sort(), ["action", "agent", "id", "message", "mission", "topic"].sort());
		assert.equal(props.id?.type, "string");
		assert.equal(props.message?.type, "string");
		assert.equal(props.action?.type, "string");
		assert.deepEqual(props.action?.enum, [
			"status", "resume", "steer", "stop", "interrupt",
			"list", "get", "models", "guide", "mission.create",
		]);
		assert.equal(props.topic?.type, "string");
		assert.deepEqual(props.topic?.enum, [...SUBAGENT_GUIDE_TOPICS]);
		assert.ok(Boolean(props.topic?.description), "topic should carry a description");
		// The verbs must be drivable: get/models read agent, mission.create reads mission.
		assert.equal(props.agent?.type, "string");
		assert.match(String(props.agent?.description ?? ""), /get/);
		assert.equal(hasAnyOfType(props.mission, "object"), true);
		assert.equal(hasAnyOfType(props.mission, "boolean"), true);
		assert.match(String(props.mission?.description ?? ""), /mission\.create/);
		assert.ok(!(props.action?.enum as readonly string[]).includes("validate"), "validate left the model surface together with its script input");
	});

	/**
	 * The facade advertised `async` as "Background run; default false." for its whole
	 * life while the executor read `async ?? asyncByDefault` and
	 * resolveAsyncByDefault({}) returned true. A model that believed the schema would
	 * omit `async` expecting a blocking call, get a background run, and then wait on a
	 * run it never asked for. docs/tool-reference.md said "default-on" the entire
	 * time; only the model-facing schema was wrong. Derived from the resolver rather
	 * than asserted as a literal, so the prose cannot drift from the code again.
	 */
	it("states the real async default instead of inverting it", () => {
		const backgroundByDefault = resolveAsyncByDefault({});
		assert.equal(backgroundByDefault, true, "baseline: an omitted asyncByDefault means background");
		for (const [name, schema] of [
			["subagent", schemas.SubagentDelegationParams],
			["subagent_workflow", schemas.SubagentWorkflowParams],
		] as const) {
			const description = String(properties(schema).async?.description ?? "");
			assert.ok(description.length > 0, `${name} should describe async`);
			if (backgroundByDefault) {
				assert.doesNotMatch(description, /default (false|off)/i, `${name} claims a non-background default the resolver contradicts: ${description}`);
				assert.match(description, /background by default|Run in the background/i, `${name} should say the run backgrounds when async is omitted`);
			}
		}
	});

	it("keeps exactly the declared cross-cutting params shared and all others one-per-tool", () => {
		// Params may appear on more than one facade only when they mean the same
		// thing on each. This list is the reviewable record of that judgement:
		// growing it is a one-line edit that has to carry a rationale, not a
		// forbidden step.
		const sharedRationale: Record<string, string> = {
			async: "background run, background unless resolved false — identical switch on delegation and workflow",
			worktree: "isolate in a managed git worktree — identical switch on delegation and workflow",
			agent: "name the agent to delegate to / the agent to inspect — same name, same registry",
		};
		const deleg = new Set(Object.keys(properties(schemas.SubagentDelegationParams)));
		const workflows = new Set(Object.keys(properties(schemas.SubagentWorkflowParams)));
		const control = new Set(Object.keys(properties(schemas.SubagentControlParams)));

		const occurrences = new Map<string, number>();
		for (const name of [...deleg, ...workflows, ...control]) occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
		for (const [name, count] of occurrences) {
			if (count < 2) continue;
			assert.ok(sharedRationale[name], `param ${name} appears on ${count} facades but is not in the declared share list with a rationale`);
			assert.equal(count, 2, `shared param ${name} should appear on exactly two facades`);
		}
		// The share list stays exactly what is declared: a third colliding name (or
		// one landing on three facades) fails the test, and every listed param must
		// actually be shared.
		assert.deepEqual(
			Object.keys(sharedRationale).filter((name) => (occurrences.get(name) ?? 0) > 1).sort(),
			["agent", "async", "worktree"],
		);
		assert.deepEqual(
			Object.keys(sharedRationale).filter((name) => (occurrences.get(name) ?? 0) === 1),
			[],
			"every declared share-list entry must actually appear on two facades",
		);
	});

	it("renders the three facade schemas compactly (under 3000 bytes total)", () => {
		const total = JSON.stringify(schemas.SubagentDelegationParams).length
			+ JSON.stringify(schemas.SubagentWorkflowParams).length
			+ JSON.stringify(schemas.SubagentControlParams).length;
		assert.ok(total < 3000, `expected facade schemas under 3000 chars, got ${total}`);
	});

	it("projects shared facade fields by reference (no drift from the internal pool)", () => {
		const internal = (SubagentParams?.properties ?? {}) as Record<string, JsonSchemaNode>;
		const delegationProps = properties(schemas.SubagentDelegationParams);
		const workflowProps = properties(schemas.SubagentWorkflowParams);
		const controlProps = properties(schemas.SubagentControlParams);
		const sharedByFacade: string[][] = [
			["task", "agent", "cwd", "async", "worktree", "output"],
			["async", "worktree", "baseRef"],
			["id", "message", "topic", "agent", "mission"],
		];
		const facades = [delegationProps, workflowProps, controlProps];
		const stripDescription = (node: JsonSchemaNode | undefined): JsonSchemaNode | undefined => {
			if (!node || typeof node !== "object") return node;
			return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "description"));
		};
		for (let facadeIndex = 0; facadeIndex < facades.length; facadeIndex += 1) {
			for (const name of sharedByFacade[facadeIndex] ?? []) {
				const facadeField = facades[facadeIndex]?.[name];
				const internalField = internal[name];
				assert.ok(facadeField, `facade field ${name} should exist`);
				assert.ok(internalField, `internal pool field ${name} should exist`);
				assert.deepEqual(
					stripDescription(facadeField as JsonSchemaNode),
					stripDescription(internalField),
					`projected field ${name} shape should match the internal pool (no drift)`,
				);
			}
		}
	});
});
