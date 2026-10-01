import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerWorkflowResource, type WorkflowResourceDefinition } from "../../src/api/workflow-resources.ts";
import {
	authorizeWorkflowResourceHost,
	consumeWorkflowResourcePermit,
} from "../../src/shared/workflow-child-permit.ts";
import { resolveWorkflowResource, sanitizePerlSlug } from "../../src/workflows/workflow-resources.ts";
import { runWorkflowScript, validateWorkflowScript, WorkflowScriptError } from "../../src/workflows/scripted-workflow.ts";

describe("named workflow resources", () => {
	it("scopes registrations by session and snapshots definitions, args and issued grants", () => {
		const args = { nested: { task: "original" } };
		const expansion = { script: "return 'original';", hostCommands: [{ key: "check", command: " node check.mjs " }, { key: "other", command: "node other.mjs" }] };
		const definition: WorkflowResourceDefinition = {
			name: "acme.check", version: 2,
			resolve(input) {
				(input.nested as { task: string }).task = "changed";
				return expansion;
			},
		};
		const registration = registerWorkflowResource({ sessionId: "one", definition });
		const other = registerWorkflowResource({ sessionId: "two", definition: { ...definition, resolve: () => ({ script: "return 'two';" }) } });
		try {
			definition.version = 99;
			definition.resolve = () => ({ error: "replacement must not run" });
			assert.throws(() => registerWorkflowResource({ sessionId: "one", definition }), /already registered/);
			assert.equal(resolveWorkflowResource("acme.check", args).ok, false);
			assert.equal(resolveWorkflowResource("acme.check", args, "wrong").ok, false);
			const resolved = resolveWorkflowResource("acme.check", args, "one");
			assert.equal(resolved.ok, true);
			if (!resolved.ok) return;
			assert.equal(args.nested.task, "original");
			assert.equal(resolved.resource.provenance.version, 2);
			expansion.script = "return 'changed';";
			expansion.hostCommands[0].command = "node changed.mjs";
			registration.dispose();
			assert.equal(resolveWorkflowResource("acme.check", args, "one").ok, false);
			const replacement = registerWorkflowResource({ sessionId: "one", definition: { ...definition, resolve: () => ({ script: "return 'new';" }) } });
			try {
				registration.dispose();
				assert.equal(resolveWorkflowResource("acme.check", {}, "one").ok, true);
				assert.equal(resolveWorkflowResource("acme.check", {}, "two").ok, true);
				const consumed = consumeWorkflowResourcePermit(resolved.resource.permit, resolved.resource.script);
				assert.equal(typeof consumed, "object");
				assert.equal(resolved.resource.script, "return 'original';");
				assert.equal(authorizeWorkflowResourceHost(resolved.resource.permit, "check", "node check.mjs"), undefined);
				assert.equal(authorizeWorkflowResourceHost(resolved.resource.permit, "other", "node other.mjs"), undefined);
				assert.match(authorizeWorkflowResourceHost(resolved.resource.permit, "check", "node other.mjs")!, /not allowed/);
				assert.match(authorizeWorkflowResourceHost(resolved.resource.permit, "other", "node check.mjs")!, /not allowed/);
				assert.match(authorizeWorkflowResourceHost(resolved.resource.permit, "check", "node changed.mjs")!, /not allowed/);
				assert.match(consumeWorkflowResourcePermit(resolved.resource.permit, resolved.resource.script) as string, /already consumed/);
			} finally { replacement.dispose(); }
		} finally { registration.dispose(); other.dispose(); }
	});

	it("lets trusted validation select fixed commands while task text remains data", async () => {
		const registration = registerWorkflowResource({ sessionId: "binding", definition: {
			name: "acme.review-check", version: 1,
			resolve(args) {
				if (Object.keys(args).some((key) => key !== "task" && key !== "check") || typeof args.task !== "string" || args.check !== "quick") return { error: "Only task and check=quick are supported." };
				return { script: `return ${JSON.stringify(args.task)};`, hostCommands: [{ key: "check", command: "node check.mjs --quick" }] };
			},
		} });
		try {
			const task = `\"); await runs.host("injected", { command: "bad" }); //`;
			const resolved = resolveWorkflowResource("acme.review-check", { task, check: "quick" }, "binding");
			assert.equal(resolved.ok, true);
			if (!resolved.ok) return;
			const execution = await runWorkflowScript({
				script: resolved.resource.script,
				async launch() { throw new Error("No child expected"); },
				async status() { throw new Error("No status expected"); },
			});
			assert.equal(execution.value, task);
			for (const args of [{ task, check: "quick; bad" }, { task, check: "quick", flags: "--extra" }, { task, check: "quick", command: "bad" }, { task: new Date(), check: "quick" }, { task: "x".repeat(16385), check: "quick" }]) {
				assert.equal(resolveWorkflowResource("acme.review-check", args, "binding").ok, false);
			}
		} finally { registration.dispose(); }
	});

	it("rejects invalid registrations and protects builtin names", () => {
		const valid = { sessionId: "validation", definition: { name: "acme.check", version: 1, resolve: () => ({ script: "return true;" }) } };
		for (const input of [
			{ ...valid, sessionId: " " },
			{ ...valid, trusted: true },
			{ ...valid, definition: { ...valid.definition, name: "perl" } },
			{ ...valid, definition: { ...valid.definition, name: "run-ci" } },
			{ ...valid, definition: { ...valid.definition, name: "review" } },
			{ ...valid, definition: { ...valid.definition, name: "bad name" } },
			{ ...valid, definition: { ...valid.definition, version: 0 } },
			{ ...valid, definition: { ...valid.definition, resolve: undefined } },
			{ ...valid, definition: { ...valid.definition, issuerPackage: "trusted" } },
		]) assert.throws(() => registerWorkflowResource(input as typeof valid));
	});

	it("contains throws, async results and malformed expansions without issuing permits", async () => {
		const invalid = [
			() => { throw new Error("x".repeat(5000)); },
			() => Promise.reject(new Error("async rejection")),
			() => ({ then(resolve: (value: unknown) => void) { resolve({ script: "return true;" }); } }),
			() => null,
			() => ({ script: " " }),
			() => ({ script: "return true;", authority: {} }),
			() => ({ error: 42 }),
			() => ({ script: "return true;", hostCommands: { keys: ["a"], commands: ["node a.mjs"] } }),
			() => ({ script: "return true;", hostCommands: [{ key: "a", command: "node a.mjs" }, { key: "a", command: "node b.mjs" }] }),
			() => ({ script: "return true;", hostCommands: [{ key: "../a", command: "node a.mjs" }] }),
			() => ({ script: "return true;", hostCommands: [{ key: "a", command: "node\0a" }] }),
		];
		for (const resolve of invalid) {
			const registration = registerWorkflowResource({ sessionId: "invalid", definition: { name: "acme.invalid", version: 1, resolve: resolve as WorkflowResourceDefinition["resolve"] } });
			try {
				const result = resolveWorkflowResource("acme.invalid", {}, "invalid");
				assert.equal(result.ok, false);
				assert.equal("resource" in result, false);
				if (!result.ok) assert.ok(result.error.length <= 4096);
			} finally { registration.dispose(); }
		}
		await new Promise<void>((resolve) => setImmediate(resolve));
	});

	it("shares registrations across evaluated module copies", async () => {
		const copy = await import(`../../src/workflows/workflow-resources.ts?copy=registration-test`);
		const registration = copy.registerWorkflowResource({ sessionId: "copies", definition: { name: "acme.copy", version: 1, resolve: () => ({ script: "return true;" }) } });
		try {
			assert.notEqual(copy.resolveWorkflowResource, resolveWorkflowResource);
			const resolved = resolveWorkflowResource("acme.copy", {}, "copies");
			assert.equal(resolved.ok, true);
			if (resolved.ok) assert.equal(typeof consumeWorkflowResourcePermit(resolved.resource.permit, resolved.resource.script), "object");
		} finally { registration.dispose(); }
		assert.equal(resolveWorkflowResource("acme.copy", {}, "copies").ok, false);
	});

	it("resolves and executes an extension-owned named workflow script", async () => {
		const resolved = resolveWorkflowResource("run-ci", { command: "npm test", timeoutMs: 1_000 });
		assert.equal(resolved.ok, true);
		if (!resolved.ok) return;
		assert.match(resolved.resource.script, /runs\.host\("ci"/);
		assert.deepEqual(resolved.resource.provenance, {
			kind: "workflow",
			name: "run-ci",
			version: 1,
			invocation: "named",
			expansion: "resolved",
			id: resolved.resource.provenance.id,
		});
		assert.equal(authorizeWorkflowResourceHost(resolved.resource.permit, "ci", "npm test"), "Workflow resource authority is unavailable.");
		const consumed = consumeWorkflowResourcePermit(resolved.resource.permit, resolved.resource.script);
		assert.equal(typeof consumed, "object");
		assert.equal(authorizeWorkflowResourceHost(resolved.resource.permit, "ci", "npm test"), undefined);
		const execution = await runWorkflowScript({
			script: resolved.resource.script,
			async host(key, params) {
				assert.equal(key, "ci");
				assert.equal(params.command, "npm test");
				return { key, kind: "command", ok: true, state: "passed", exitCode: 0, stdout: "ok", stderr: "", outputPath: "ci.log", durationMs: 1 };
			},
			async launch(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
			async status(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
		});
		assert.equal((execution.value as { ok?: boolean }).ok, true);
	});

	it("resolves and executes the perl plan phase as a single planner child inside the shared worktree", async () => {
		const resolved = resolveWorkflowResource("perl", { task: "Add prequel passthrough to workflow children", prequel: "Decisions: use pass-through, not a whitelist" });
		assert.equal(resolved.ok, true);
		if (!resolved.ok) return;
		assert.equal(validateWorkflowScript(resolved.resource.script).ok, true);
		assert.match(resolved.resource.script, /runs\.host\("wt-setup"/);
		assert.match(resolved.resource.script, /runs\.run\("planner"/);
		assert.equal(resolved.resource.provenance.name, "perl");
		const worktree = "/tmp/perl-fixtures/.pi-perl-fixtures";
		const hostCalls: string[] = [];
		const calls: Array<{ key: string; agent?: unknown; task?: unknown; prequel?: unknown; cwd?: unknown }> = [];
		const execution = await runWorkflowScript({
			script: resolved.resource.script,
			async host(key, params) {
				hostCalls.push(`${key}:${params.command.length}`);
				assert.equal(key, "wt-setup");
				return { key, kind: "command", ok: true, state: "passed", exitCode: 0, stdout: `created\n${worktree}\n`, stderr: "", outputPath: "wt.log", durationMs: 1 };
			},
			async launch(key, params) {
				calls.push({ key, agent: params.agent, task: params.task, prequel: params.prequel, cwd: params.cwd });
				return { key, ok: true, output: "Planned: three steps", artifactPaths: [] };
			},
			async status(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
		});
		assert.equal(hostCalls.length, 1);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].key, "planner");
		assert.equal(calls[0].agent, "planner");
		assert.ok(String(calls[0].task).startsWith("Add prequel passthrough to workflow children"));
		assert.match(String(calls[0].task), /Working in git worktree \/tmp\/perl-fixtures\/.pi-perl-fixtures on branch perl\/work\./);
		assert.equal(calls[0].prequel, "Decisions: use pass-through, not a whitelist");
		assert.equal(calls[0].cwd, worktree);
		assert.deepEqual(execution.value, { phase: "plan", plan: "plan.md", worktree, summary: "Planned: three steps" });
	});

	it("runs the perl plan phase in the plain cwd when worktree setup fails", async () => {
		const resolved = resolveWorkflowResource("perl", { task: "Do the thing" });
		assert.equal(resolved.ok, true);
		if (!resolved.ok) return;
		const calls: Array<{ key: string; cwd?: unknown }> = [];
		const execution = await runWorkflowScript({
			script: resolved.resource.script,
			async host(key) { return { key, kind: "command", ok: false, state: "failed", exitCode: 1, stdout: "", stderr: "not a git repository", outputPath: "wt.log", durationMs: 1, error: "Command exited with code 1." }; },
			async launch(key, params) {
				calls.push({ key, cwd: params.cwd ?? null });
				return { key, ok: true, output: "planned", artifactPaths: [] };
			},
			async status(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
		});
		assert.deepEqual(calls, [{ key: "planner", cwd: null }]);
		assert.deepEqual(execution.value, { phase: "plan", plan: "plan.md", worktree: null, summary: "planned" });
	});

	it("resolves and executes the perl execution phase with a bounded review/fix loop in the shared worktree", async () => {
		const resolved = resolveWorkflowResource("perl", {});
		assert.equal(resolved.ok, true);
		if (!resolved.ok) return;
		assert.equal(validateWorkflowScript(resolved.resource.script).ok, true);
		assert.match(resolved.resource.script, /runs\.host\("wt-setup"/);
		assert.match(resolved.resource.script, /runs\.run\("recon"/);
		assert.match(resolved.resource.script, /runs\.run\("implement"/);
		const worktree = "/tmp/perl-fixtures/.pi-perl-fixtures";
		const calls: Array<{ key: string; cwd?: unknown }> = [];
		const execution = await runWorkflowScript({
			script: resolved.resource.script,
			async host(key) { return { key, kind: "command", ok: true, state: "passed", exitCode: 0, stdout: worktree, stderr: "", outputPath: "wt.log", durationMs: 1 }; },
			async launch(key, params) {
				calls.push({ key, cwd: params.cwd });
				if (key.startsWith("review-")) assert.deepEqual(params.outputSchema?.properties?.verdict?.enum, ["BLOCK", "OK", "OK with notes"]);
				if (key === "review-1") return { key, ok: true, output: "review one", artifactPaths: [], structuredOutput: { verdict: "BLOCK", findings: ["src/x.ts: missing case"] } };
				if (key === "review-2") return { key, ok: true, output: "review two", artifactPaths: [], structuredOutput: { verdict: "OK", findings: [] } };
				return { key, ok: true, output: "done", artifactPaths: [] };
			},
			async status(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
		});
		assert.deepEqual(calls.map(({ key }) => key), ["recon", "implement", "review-1", "fix-1", "review-2"]);
		assert.ok(calls.every(({ cwd }) => cwd === worktree));
		const value = execution.value as { phase: string; plan: string; worktree: string | null; branch: string | null; verdict: string; fixRounds: number; findings: string[] };
		assert.equal(value.phase, "executed");
		assert.equal(value.plan, "plan.md");
		assert.equal(value.worktree, worktree);
		assert.equal(value.branch, "perl/work");
		assert.equal(value.verdict, "OK");
		assert.equal(value.fixRounds, 1);
		assert.deepEqual(value.findings, []);
	});

	it("caps the perl review loop at maxRounds and reports the remaining findings", async () => {
		const resolved = resolveWorkflowResource("perl", { maxRounds: 2 });
		assert.equal(resolved.ok, true);
		if (!resolved.ok) return;
		const calls: string[] = [];
		const execution = await runWorkflowScript({
			script: resolved.resource.script,
			async host(key) { return { key, kind: "command", ok: true, state: "passed", exitCode: 0, stdout: "/tmp/perl-fixtures/.pi-perl-fixtures", stderr: "", outputPath: "wt.log", durationMs: 1 }; },
			async launch(key) {
				calls.push(key);
				if (key.startsWith("review-")) return { key, ok: true, output: "blocked", artifactPaths: [], structuredOutput: { verdict: "BLOCK", findings: ["still broken"] } };
				return { key, ok: true, output: "done", artifactPaths: [] };
			},
			async status(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
		});
		assert.deepEqual(calls, ["recon", "implement", "review-1", "fix-1", "review-2"]);
		const value = execution.value as { phase: string; verdict: string; fixRounds: number; findings: string[] };
		assert.equal(value.phase, "executed");
		assert.equal(value.verdict, "BLOCK");
		assert.equal(value.fixRounds, 1);
		assert.deepEqual(value.findings, ["still broken"]);
	});

	it("sanitizes perl worktree slugs into safe lane names", () => {
		assert.equal(sanitizePerlSlug("Auth Fix!!"), "auth-fix");
		assert.equal(sanitizePerlSlug("  a--b__c  "), "a-b-c");
		assert.equal(sanitizePerlSlug("-leading"), "leading");
		assert.equal(sanitizePerlSlug("trailing-"), "trailing");
		assert.equal(sanitizePerlSlug("42"), "42");
		assert.equal(sanitizePerlSlug("-"), "");
		assert.equal(sanitizePerlSlug("x".repeat(60)).length, 40);
		assert.ok(!sanitizePerlSlug("x".repeat(60)).endsWith("-"));
	});

	it("runs a slugged perl lane in its own worktree and branch", async () => {
		for (const args of [{ task: "Fix auth", slug: "Auth Fix!!" }, { slug: "Auth Fix!!" }] as const) {
			const resolved = resolveWorkflowResource("perl", { ...args });
			assert.equal(resolved.ok, true);
			if (!resolved.ok) return;
			const commands: string[] = [];
			const execution = await runWorkflowScript({
				script: resolved.resource.script,
				async host(key, params) {
					commands.push(params.command);
					return { key, kind: "command", ok: true, state: "passed", exitCode: 0, stdout: "/tmp/perl-fixtures/.pi-perl-fixtures-auth-fix", stderr: "", outputPath: "wt.log", durationMs: 1 };
				},
				async launch(key, params) {
					assert.equal(params.cwd, "/tmp/perl-fixtures/.pi-perl-fixtures-auth-fix");
					if (key.startsWith("review-")) return { key, ok: true, output: "ok", artifactPaths: [], structuredOutput: { verdict: "OK", findings: [] } };
				return { key, ok: true, output: "done", artifactPaths: [] };
			},
				async status(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
			});
			assert.equal(commands.length, 1);
			assert.match(commands[0], /\.pi-perl-\$\(basename \"\$R\"\)-auth-fix\"/);
			assert.match(commands[0], /git worktree add "\$P" -b perl\/work-auth-fix/);
			if ("task" in args && args.task) assert.deepEqual(execution.value, { phase: "plan", plan: "plan.md", worktree: "/tmp/perl-fixtures/.pi-perl-fixtures-auth-fix", summary: "done" });
			else assert.equal((execution.value as { branch: string }).branch, "perl/work-auth-fix");
		}
	});

	it("authorizes only the exact perl wt-setup host command", () => {
		for (const args of [{ task: "plan" }, {}]) {
			const resolved = resolveWorkflowResource("perl", args);
			assert.equal(resolved.ok, true);
			if (!resolved.ok) return;
			assert.match(resolved.resource.script, /runs\.host\("wt-setup"/);
			assert.equal(typeof consumeWorkflowResourcePermit(resolved.resource.permit, resolved.resource.script), "object");
			assert.equal(authorizeWorkflowResourceHost(resolved.resource.permit, "wt-setup", "git worktree add /tmp/x"), "The command for runs.host('wt-setup') is not allowed for workflow resource 'perl'.");
			assert.match(authorizeWorkflowResourceHost(resolved.resource.permit, "other", "git status") ?? "", /not allowed/);
		}
	});

	it("does not authorize raw equivalent scripts or unconsumed/forged permits", () => {
		const forged = { __workflowResourcePermit: Symbol("forged") } as never;
		assert.equal(authorizeWorkflowResourceHost(forged, "ci", "npm test"), "Workflow resource authority is unavailable.");
		const raw = `return await runs.host("ci", { kind: "command", command: "npm test", timeoutMs: 1000 });`;
		const resolved = resolveWorkflowResource("run-ci", { command: "npm test", timeoutMs: 1_000 });
		assert.equal(resolved.ok, true);
		if (!resolved.ok) return;
		assert.equal(authorizeWorkflowResourceHost(resolved.resource.permit, "ci", "npm test"), "Workflow resource authority is unavailable.");
		assert.notEqual(raw, resolved.resource.script);
	});

	it("rejects missing metadata, mismatched scripts, and unauthorized host combinations", () => {
		const resolved = resolveWorkflowResource("run-ci", { command: "npm test" });
		assert.equal(resolved.ok, true);
		if (!resolved.ok) return;
		assert.equal(consumeWorkflowResourcePermit(resolved.resource.permit, `${resolved.resource.script}\n`), "Workflow resource permit does not match the resolved workflow script.");
		assert.equal(authorizeWorkflowResourceHost(resolved.resource.permit, "shell", "npm test"), "Workflow resource authority is unavailable.");
		const consumed = consumeWorkflowResourcePermit(resolved.resource.permit, resolved.resource.script);
		assert.equal(typeof consumed, "object");
		assert.match(authorizeWorkflowResourceHost(resolved.resource.permit, "shell", "npm test") ?? "", /not allowed/);
		assert.match(authorizeWorkflowResourceHost(resolved.resource.permit, "ci", "git status") ?? "", /not allowed/);
		assert.match(authorizeWorkflowResourceHost(resolved.resource.permit, "ci", "npm test") ?? "", /^$/);

		const review = resolveWorkflowResource("review", { task: "Review" });
		assert.equal(review.ok, true);
		if (!review.ok) return;
		const reviewConsumed = consumeWorkflowResourcePermit(review.resource.permit, review.resource.script);
		assert.equal(typeof reviewConsumed, "object");
		assert.match(authorizeWorkflowResourceHost(review.resource.permit, "ci", "npm test") ?? "", /not allowed/);
	});

	it("validates resource names and bounded arguments before creating permits", () => {
		for (const [name, args] of [
			["unknown", {}],
			["run ci", {}],
			["run-ci", { command: "rm -rf /" }],
			["run-ci", { timeoutMs: 0 }],
			["run-ci", { extra: true }],
			["review", { task: "" }],
			["review", { task: "Review", extra: true }],
			["review", { task: "x".repeat(16 * 1024 + 1) }],
			["perl", { task: 42 }],
			["perl", { task: "plan", prequel: 7 }],
			["perl", { task: "plan", extra: true }],
			["perl", { maxRounds: 0 }],
			["perl", { maxRounds: 11 }],
			["perl", { maxRounds: 1.5 }],
			["perl", { slug: 7 }],
			["perl", { slug: "!!" }],
		] as const) {
			const result = resolveWorkflowResource(name, args);
			assert.equal(result.ok, false, `${name}: ${JSON.stringify(args)}`);
		}
	});

	it("rejects argument validation failures even when the error message is empty", () => {
		const registration = registerWorkflowResource({ sessionId: "invalid-args", definition: {
			name: "check-args", version: 1, resolve: () => assert.fail("invalid args reached the resolver"),
		} });
		try {
			assert.deepEqual(resolveWorkflowResource("check-args", { get task() { throw new Error(""); } }, "invalid-args"), { ok: false, error: "" });
		} finally { registration.dispose(); }
	});

	it("reports unauthorized raw host execution through the workflow primitive when no host is supplied", async () => {
		await assert.rejects(
			runWorkflowScript({
				script: `return await runs.host("ci", { kind: "command", command: "npm test", timeoutMs: 1000 });`,
				async launch(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
				async status(key) { return { key, ok: true, output: "unused", artifactPaths: [] }; },
			}),
			(error: unknown) => error instanceof WorkflowScriptError && /runs\.host is unavailable/.test(error.message),
		);
	});
});
