import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";
import { resolveAsyncByDefault } from "../../src/extension/config.ts";

type JsonSchemaNode = Record<string, unknown>;

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

function propertyKeys(schema: unknown): string[] {
	const props = (schema as JsonSchemaNode | undefined)?.properties;
	return props && typeof props === "object" ? Object.keys(props) : [];
}

let schemas: Record<string, JsonSchemaNode> = {};
let SubagentWaitParams: JsonSchemaNode | undefined;
let schemasAvailable = true;
try {
	schemas = await import("../../src/extension/schemas.ts") as Record<string, JsonSchemaNode>;
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

describe("schema shape guards", { skip: !schemasAvailable ? "typebox not available" : undefined }, () => {
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
			async: "background run, default-on — identical switch on delegation and workflow",
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
});

describe("launch and RPC param surfaces", { skip: !schemasAvailable ? "typebox not available" : undefined }, () => {
	// Fields a runs.run/runs.all workflow child may set: validated and consumed by
	// validateRunCall (src/workflows/scripted-workflow.ts) plus the child launch path.
	const workflowChildKeys = [
		"agent", "task", "cwd", "output", "outputMode", "reads",
		"model", "fast", "skill", "outputSchema", "acceptance", "toolBudget",
		"toolTimeoutMs", "timeoutMs", "maxRuntimeMs", "checkpointBeforeDeadlineMs",
		"context", "worktree", "baseRef", "gate", "extensionBindings",
	];

	// The reviewed RPC allowlists, written literally. A key added to one of these schemas must
	// also be added here, so an unreviewed widening of the RPC surface fails instead of passing.
	const rpcSurface: Array<[string, string[]]> = [
		["RpcPingParams", []],
		["RpcSpawnParams", ["agent", "task", "cwd", "async", "output", "outputMode", "reads", "prequel", "worktree", "baseRef", "workflow", "args", "workflowScript", "workflowScriptPath", "timeoutMs"]],
		["RpcStatusParams", ["id", "runId", "dir", "index", "view", "lines"]],
		["RpcSteerParams", ["message", "mode", "id", "runId", "dir", "index"]],
		["RpcResumeParams", ["message", "output", "outputMode", "id", "runId", "dir", "index"]],
		["RpcInterruptParams", ["id", "runId", "dir", "index"]],
		["RpcStopParams", ["id", "runId", "dir", "index", "childId"]],
		["RpcManageParams", ["action", "id"]],
	];

	const rpcSchemas: Array<[string, unknown]> = rpcSurface.map(([name]) => [name, schemas[name]] as [string, unknown]);

	it("keeps every RPC allowlist exactly its reviewed key list", () => {
		for (const [name, keys] of rpcSurface) {
			assert.deepEqual(propertyKeys(schemas[name]).sort(), [...keys].sort(), name + " keys changed; update the reviewed allowlist in this test");
		}
	});

	it("reaches every launch key from a facade, an RPC allowlist, or a workflow child", () => {
		const launchKeys = propertyKeys(schemas.SubagentLaunchParams);
		assert.ok(launchKeys.length > 0, "SubagentLaunchParams should declare properties");
		// Written literally rather than read from the schemas under test, so that adding a key to
		// a schema cannot make itself "reachable" without this list being reviewed too.
		const facadeKeys = new Set([
			"task", "agent", "cwd", "async", "output", "worktree", "prequel", "reads",
			"workflow", "source", "args", "baseRef",
			"id", "action", "message", "topic", "mission",
			// `source` is the facade spelling of the workflowScript/workflowScriptPath launch keys.
			"workflowScript", "workflowScriptPath",
		]);
		const rpcKeys = new Set(rpcSurface.flatMap(([, keys]) => keys));
		const reachable = new Set([...facadeKeys, ...rpcKeys, ...workflowChildKeys]);
		const unreachable = launchKeys.filter((key) => !reachable.has(key)).sort();
		assert.deepEqual(unreachable, [], "every launch key must be reachable from a facade, an RPC allowlist, or a workflow child");
		for (const key of workflowChildKeys) {
			assert.ok(launchKeys.includes(key), "workflow-child key " + key + " should exist on SubagentLaunchParams");
		}
	});

	it("keeps every RPC allowlist a subset of the launch schema", () => {
		const launchKeys = new Set(propertyKeys(schemas.SubagentLaunchParams));
		for (const [name, schema] of rpcSchemas) {
			for (const key of propertyKeys(schema)) {
				assert.ok(launchKeys.has(key), name + " key " + key + " is not on SubagentLaunchParams");
			}
		}
	});

	it("keeps formerly pool-only keys off every RPC allowlist", () => {
		const forbidden = [
			"share", "artifacts", "includeProgress", "sessionDir", "agentScope",
			"capabilities", "config", "additional", "focus", "control", "missionId",
			"modelOrigin", "maxOutput", "model", "context", "skill", "fast",
			"outputSchema", "acceptance", "toolBudget", "toolTimeoutMs",
			"maxRuntimeMs", "checkpointBeforeDeadlineMs", "steeringRecovery",
			"handoffPath", "repo", "tasks", "chain", "concurrency", "chainDir",
			"step", "resume", "isolation", "preflight", "globalConcurrencyLimit",
			"maxSubagentSpawnsPerRun", "workflowParentRunId", "workflowKey",
			"workflowChildAsyncId", "workflowAwaitAsync", "workflowAwaitDetached",
			"workflowParentDeadlineAt", "workflowOutputClaimPath",
			"suppressRoutineResultIntercom", "runFanoutBudget", "runFanoutAdmitted",
			"capabilityCeiling", "name", "type", "scope", "target", "thinking",
			"clarify", "foregroundOnly", "gate",
		];
		for (const [name, schema] of rpcSchemas) {
			const keys = new Set(propertyKeys(schema));
			const leaked = forbidden.filter((key) => keys.has(key)).sort();
			assert.deepEqual(leaked, [], name + " must reject formerly pool-only keys");
		}
	});
});
