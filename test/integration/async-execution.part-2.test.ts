/**
 * Integration tests for async (background) agent execution.
 *
 * Tests the async support utilities: jiti availability check,
 * status file reading/caching.
 *
 * Requires pi packages to be importable. Skips gracefully if unavailable.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempDir, events, makeAgent, makeMinimalCtx, removeTempDir, resolveMockPiCallArgs } from "../support/helpers.ts";
import { deliverInterruptRequest, deliverStopRequest, deliverTimeoutRequest, requestAsyncSteer } from "../../src/runs/background/control-channel.ts";
import { writeAtomicJson } from "../../src/shared/atomic-json.ts";
import { runSync } from "../../src/runs/foreground/execution.ts";
import { getHostBuiltinToolNames } from "../../src/runs/shared/child-tool-plan.ts";
import { SUBAGENT_ASYNC_STARTED_EVENT, SUBAGENT_LIFECYCLE_ARTIFACT_VERSION } from "../../src/shared/types.ts";
import type { AsyncResultPayload, AsyncStatusPayload, MockPiCallRecord } from "../support/async-execution-fixture.ts";
import {
	installAsyncExecutionHooks, waitForMockPiRuntime, mockAssistantMessage,
	available, isAsyncAvailable, executeAsyncSingle, readStatus,
	pruneStatusCacheForAsyncRoot, ASYNC_DIR, RESULTS_DIR, createSubagentExecutor,
	createRepo, waitForAsyncResultFile, waitForAsyncEvent, waitForAsyncState,
	waitForMockPiCall, readMockPiArgs, readMockPiArgsMatching, tempDir, mockPi,
	makeAsyncExecutor, readAsyncPayload, readMockPiRequiredTools,
} from "../support/async-execution-fixture.ts";

describe("async execution utilities", { skip: !available ? "pi packages not available" : undefined }, () => {
	installAsyncExecutionHooks();

	it("keeps named output references literal in async single tasks", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const task = "Reply with OK. You may reference {outputs.name} if it helps.";
		mockPi.onCall({ output: "OK" });
		const id = `async-single-literal-output-ref-${Date.now().toString(36)}`;
		const result = executeAsyncSingle(id, {
			agent: "worker",
			task,
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			shareEnabled: false,
			sessionRoot: path.join(tempDir, "sessions"),
		});

		assert.equal(result.isError, undefined);
		const call = await waitForMockPiCall(mockPi, 0);
		assert.match(call.args.at(-1) ?? "", /\{outputs\.name\}/);
		const payload = await readAsyncPayload(id);
		assert.equal(payload.success, true);
		assert.equal(payload.results[0]?.output, "OK");
	});

	it("spawns the async runner with node when process.execPath is not node", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const originalExecPath = process.execPath;
		process.execPath = path.join(tempDir, process.platform === "win32" ? "pi.exe" : "pi");
		try {
			mockPi.onCall({ output: "non-node exec async done" });
			const id = `async-non-node-exec-${Date.now().toString(36)}`;
			const result = executeAsyncSingle(id, {
				agent: "worker",
				task: "Say non-node exec async done. Do not edit files.",
				agentConfig: makeAgent("worker"),
				ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
				artifactConfig: {
					enabled: false,
					includeInput: false,
					includeOutput: false,
					includeJsonl: false,
					includeMetadata: false,
					cleanupDays: 7,
				},
				shareEnabled: false,
				sessionRoot: path.join(tempDir, "sessions"),
			});

			assert.equal(result.isError, undefined);
			const resultPath = await waitForAsyncResultFile(id, 30_000);
			const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
			assert.equal(payload.success, true);
			assert.equal(payload.results[0]?.output, "non-node exec async done");
		} finally {
			process.execPath = originalExecPath;
		}
	});


	it("readStatus returns null for missing directory", () => {
		const status = readStatus("/nonexistent/path/abc123");
		assert.equal(status, null);
	});

	it("readStatus parses valid status file", () => {
		const dir = createTempDir();
		try {
			const statusData = {
				runId: "test-123",
				state: "running",
				mode: "single",
				startedAt: Date.now(),
				lastUpdate: Date.now(),
				steps: [{ agent: "test", status: "running" }],
			};
			fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(statusData));

			const status = readStatus(dir);
			assert.ok(status, "should parse status");
			assert.equal(status.runId, "test-123");
			assert.equal(status.state, "running");
			assert.equal(status.mode, "single");
		} finally {
			removeTempDir(dir);
		}
	});

	it("delivers inbox steer requests to the background child session", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const release = path.join(tempDir, "steer-release");
		mockPi.onCall({ steps: [{ waitForPath: release, jsonl: [events.assistantMessage("steered result")] }] });
		const id = `async-inbox-steer-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Wait for guidance",
			agentConfig: makeAgent("worker", { completionGuard: false }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-inbox-steer" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			shareEnabled: false,
		});
		await waitForMockPiCall(mockPi, 0, 10_000);
		const asyncDir = path.join(ASYNC_DIR, id);
		requestAsyncSteer(asyncDir, { message: "Focus on the tests.", id: "steer-1", ts: Date.now() });
		requestAsyncSteer(asyncDir, { message: "Then update the docs.", id: "steer-2", ts: Date.now() + 1, mode: "follow_up" });
		type SteeringTarget = { index: number; state: string; reason?: string };
		type SteeringTargets = { steering?: { recent: Array<{ id: string; targets: SteeringTarget[] }> } };
		const status = await waitForAsyncState(id, (candidate) => {
			const recent = (candidate as SteeringTargets).steering?.recent ?? [];
			return recent.some((request) => request.id === "steer-1" && request.targets[0]?.state === "queued")
				&& recent.some((request) => request.id === "steer-2" && request.targets[0]?.state === "queued");
		}) as AsyncStatusPayload & SteeringTargets;
		assert.equal(status.state, "running");
		const steers = fs.readFileSync(path.join(mockPi.dir, "steers.jsonl"), "utf-8").trim().split("\n").map((line) => JSON.parse(line) as { text: string; mode: string });
		assert.deepEqual(steers.map((steer) => steer.mode), ["steer", "followUp"]);
		assert.match(steers[0]?.text ?? "", /Mid-run steering from the parent orchestrator:\n\nFocus on the tests\./);
		assert.match(steers[1]?.text ?? "", /Queued follow-up from the parent orchestrator:\n\nThen update the docs\./);
		fs.writeFileSync(release, "go");
		const payload = await readAsyncPayload(id);
		assert.equal(payload.success, true);
		assert.equal(payload.results[0]?.output, "steered result");
		const terminal = await waitForAsyncState(id, (candidate) => candidate.state === "complete") as AsyncStatusPayload & SteeringTargets;
		const recent = terminal.steering?.recent ?? [];
		assert.equal(recent.find((request) => request.id === "steer-1")?.targets[0]?.state, "failed");
		assert.equal(recent.find((request) => request.id === "steer-2")?.targets[0]?.state, "failed");
		assert.equal(recent.find((request) => request.id === "steer-1")?.targets[0]?.reason, "child completed before consuming steering");
		assert.equal(recent.find((request) => request.id === "steer-2")?.targets[0]?.reason, "child completed before consuming follow-up");
		const journal = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf-8").trim().split("\n").map((line) => JSON.parse(line) as { type?: string; requestId?: string; reason?: string });
		assert.ok(journal.some((event) => event.type === "subagent.steer.failed" && event.requestId === "steer-1" && event.reason === "child completed before consuming steering"));
		assert.ok(journal.some((event) => event.type === "subagent.steer.failed" && event.requestId === "steer-2" && event.reason === "child completed before consuming follow-up"));
		for (const requestId of ["steer-1", "steer-2"]) {
			assert.ok(journal.some((event) => event.type === "subagent.steer.queued" && event.requestId === requestId));
			assert.ok(!journal.some((event) => event.type === "subagent.steer.delivered" && event.requestId === requestId));
		}
	});

	it("fails mixed unconsumed modes with request-specific reasons while queued input remains", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [events.assistantMessage("before queued hold")],
			holdQueuedMessagesUntilAbort: true,
		});
		const id = `async-steer-unconsumed-queued-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Wait for guidance",
			agentConfig: makeAgent("worker", { completionGuard: false }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-steer-unconsumed-queued" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			shareEnabled: false,
		});
		await waitForMockPiCall(mockPi, 0, 10_000);
		const scriptedFinal = path.join(mockPi.dir, "scripted-final.jsonl");
		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(scriptedFinal)) {
			if (Date.now() > deadline) assert.fail("Timed out waiting for scripted final message");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		const asyncDir = path.join(ASYNC_DIR, id);
		requestAsyncSteer(asyncDir, { message: "Steer while the queue is still live.", id: "queued-steer", ts: Date.now() });
		requestAsyncSteer(asyncDir, { message: "Follow up while the queue is still live.", id: "queued-follow", ts: Date.now() + 1, mode: "follow_up" });
		type SteeringTargets = { steering?: { recent: Array<{ id: string; targets: Array<{ state: string; reason?: string }> }> } };
		const queuedStatePath = path.join(mockPi.dir, "queued-messages.json");
		const accepted = await waitForAsyncState(id, (candidate) => {
			const recent = (candidate as SteeringTargets).steering?.recent ?? [];
			let queuedState: { count?: number; modes?: string[] } | undefined;
			try {
				queuedState = JSON.parse(fs.readFileSync(queuedStatePath, "utf-8")) as { count?: number; modes?: string[] };
			} catch {
				queuedState = undefined;
			}
			return recent.some((request) => request.id === "queued-steer" && request.targets[0]?.state === "queued")
				&& recent.some((request) => request.id === "queued-follow" && request.targets[0]?.state === "queued")
				&& queuedState?.count === 2
				&& queuedState.modes?.includes("steer") === true
				&& queuedState.modes?.includes("followUp") === true;
		}) as AsyncStatusPayload & SteeringTargets;
		assert.equal(accepted.state, "running");
		assert.deepEqual(JSON.parse(fs.readFileSync(queuedStatePath, "utf-8")), { count: 2, modes: ["steer", "followUp"] });
		deliverStopRequest({ asyncDir, pid: accepted.pid, source: "test" });
		await readAsyncPayload(id);
		const terminal = await waitForAsyncState(id, (candidate) => candidate.state !== "running") as AsyncStatusPayload & SteeringTargets;
		const recent = terminal.steering?.recent ?? [];
		assert.equal(recent.find((request) => request.id === "queued-steer")?.targets[0]?.state, "failed");
		assert.equal(recent.find((request) => request.id === "queued-follow")?.targets[0]?.state, "failed");
		assert.equal(recent.find((request) => request.id === "queued-steer")?.targets[0]?.reason, "child completed before consuming steering");
		assert.equal(recent.find((request) => request.id === "queued-follow")?.targets[0]?.reason, "child completed before consuming follow-up");
		assert.notEqual(recent.find((request) => request.id === "queued-steer")?.targets[0]?.reason, recent.find((request) => request.id === "queued-follow")?.targets[0]?.reason);
		const journal = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf-8").trim().split("\n").map((line) => JSON.parse(line) as { type?: string; requestId?: string; reason?: string });
		assert.ok(journal.some((event) => event.type === "subagent.steer.failed" && event.requestId === "queued-steer" && event.reason === "child completed before consuming steering"));
		assert.ok(journal.some((event) => event.type === "subagent.steer.failed" && event.requestId === "queued-follow" && event.reason === "child completed before consuming follow-up"));
		assert.ok(!journal.some((event) => event.reason === "run ended before queued follow-up delivery"));
	});

	it("reports consumed inbox steer and follow-up at run end, including equal-text duplicates", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [events.assistantMessage("before steer")],
			keepAliveAfterFinalMessageMs: 15_000,
			queuedMessageOutput: "after steer",
		});
		const id = `async-steer-consumed-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Wait for guidance",
			agentConfig: makeAgent("worker", { completionGuard: false }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-steer-consumed" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			shareEnabled: false,
		});
		await waitForMockPiCall(mockPi, 0, 10_000);
		const scriptedFinal = path.join(mockPi.dir, "scripted-final.jsonl");
		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(scriptedFinal)) {
			if (Date.now() > deadline) assert.fail("Timed out waiting for scripted final message");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		const asyncDir = path.join(ASYNC_DIR, id);
		requestAsyncSteer(asyncDir, { message: "Continue after the final stop.", id: "consumed-steer", ts: Date.now() });
		requestAsyncSteer(asyncDir, { message: "Then check the docs.", id: "consumed-follow", ts: Date.now() + 1, mode: "follow_up" });
		requestAsyncSteer(asyncDir, { message: "Same follow-up twice.", id: "dup-a", ts: Date.now() + 2, mode: "follow_up" });
		requestAsyncSteer(asyncDir, { message: "Same follow-up twice.", id: "dup-b", ts: Date.now() + 3, mode: "follow_up" });
		type LiveSteering = { steering?: { recent: Array<{ id: string; targets: Array<{ state: string }> }> } };
		await waitForAsyncState(id, (candidate) => {
			const recent = (candidate as LiveSteering).steering?.recent ?? [];
			return ["consumed-steer", "consumed-follow", "dup-a", "dup-b"].every((requestId) => {
				const state = recent.find((request) => request.id === requestId)?.targets[0]?.state;
				return state === "queued" || state === "delivered";
			});
		});
		const payload = await readAsyncPayload(id);
		assert.equal(payload.success, true, payload.results[0]?.error);
		assert.equal(payload.results[0]?.output, "after steer");
		type SteeringTargets = { steering?: { recent: Array<{ id: string; targets: Array<{ state: string; reason?: string }> }>; delivered?: number; failed?: number; pending?: number } };
		const terminal = await waitForAsyncState(id, (candidate) => candidate.state === "complete") as AsyncStatusPayload & SteeringTargets;
		const recent = terminal.steering?.recent ?? [];
		for (const requestId of ["consumed-steer", "consumed-follow", "dup-a", "dup-b"]) {
			assert.equal(recent.find((request) => request.id === requestId)?.targets[0]?.state, "delivered", requestId);
			assert.equal(recent.find((request) => request.id === requestId)?.targets[0]?.reason, undefined, requestId);
		}
		assert.equal(terminal.steering?.delivered, 4, JSON.stringify(terminal.steering, null, 2));
		assert.equal(terminal.steering?.failed, 0, JSON.stringify(terminal.steering, null, 2));
		assert.equal(terminal.steering?.pending, 0, JSON.stringify(terminal.steering, null, 2));
		const journal = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf-8").trim().split("\n").map((line) => JSON.parse(line) as { type?: string; requestId?: string });
		for (const requestId of ["consumed-steer", "consumed-follow", "dup-a", "dup-b"]) {
			assert.equal(journal.filter((event) => event.type === "subagent.steer.queued" && event.requestId === requestId).length, 1, requestId);
			assert.equal(journal.filter((event) => event.type === "subagent.steer.delivered" && event.requestId === requestId).length, 1, requestId);
			assert.ok(!journal.some((event) => event.type === "subagent.steer.failed" && event.requestId === requestId), requestId);
		}
	});

	it("hard-kills async children that ignore timeout SIGTERM", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ delay: 60_000, ignoreSigterm: true, output: "too late" });
		const id = `async-timeout-hard-kill-${Date.now().toString(36)}`;
		const timeoutMs = process.platform === "win32" ? 5_000 : 1_500;
		const startedAt = Date.now();
		executeAsyncSingle(id, {
			agent: "stubborn",
			task: "Ignore soft termination",
			agentConfig: makeAgent("stubborn", { model: "primary-model" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			shareEnabled: false,
			timeoutMs,
		});

		await waitForMockPiCall(mockPi, 0, 10_000);
		const resultPath = await waitForAsyncResultFile(id, 10_000);
		const elapsedMs = Date.now() - startedAt;
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		const status = await waitForAsyncState(id, (candidate) => candidate.state === "failed");
		assert.equal(payload.state, "failed");
		assert.equal(payload.timedOut, true);
		assert.equal(payload.results[0]?.timedOut, true);
		assert.equal(payload.results[0]?.error, `Subagent timed out after ${timeoutMs}ms.`);
		assert.equal(status.timedOut, true);
		assert.equal(status.steps?.[0]?.timedOut, true);
		assert.ok(elapsedMs < timeoutMs + 4_000, `timeout result should settle after hard kill, elapsed ${elapsedMs}ms`);
		assert.equal(mockPi.callCount(), 1);
	});

	it("cancels async acceptance verification when the run times out", { skip: !isAsyncAvailable() ? "jiti not available" : process.platform === "win32" ? "timeout signal delivery intermittent on Windows CI" : undefined }, async () => {
		mockPi.onCall({ output: "implementation complete" });
		const id = `async-timeout-acceptance-${Date.now().toString(36)}`;
		const timeoutMs = 1_000;
		const startedAt = Date.now();
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Implement with verified acceptance",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: true,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: true,
				cleanupDays: 7,
			},
			artifactsDir: path.join(tempDir, ".pi/subagents", "artifacts"),
			shareEnabled: false,
			timeoutMs,
			acceptance: {
				level: "verified",
				verify: [{ id: "slow", command: `${process.execPath} -e "setTimeout(()=>process.exit(0), 30000)"`, timeoutMs: 60_000 }],
			},
		});

		const resultPath = await waitForAsyncResultFile(id, 5_000);
		const elapsedMs = Date.now() - startedAt;
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		const status = await waitForAsyncState(id, (candidate) => candidate.state === "failed");
		assert.equal(payload.state, "failed");
		assert.equal(payload.timedOut, true);
		assert.equal(payload.results[0]?.timedOut, true);
		assert.equal(payload.results[0]?.acceptance?.status, "rejected");
		assert.equal(payload.results[0]?.acceptance?.runtimeChecks?.[0]?.id, "timeout");
		assert.equal(status.steps?.[0]?.timedOut, true);
		const metadataPath = payload.results[0]?.artifactPaths?.metadataPath;
		assert.ok(metadataPath);
		const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as { acceptance?: { status?: string; runtimeChecks?: Array<{ id?: string }> } };
		assert.equal(metadata.acceptance?.status, "rejected");
		assert.equal(metadata.acceptance?.runtimeChecks?.[0]?.id, "timeout");
		assert.ok(elapsedMs < timeoutMs + 4_000, `timeout should cancel acceptance verification well before the verify command completes, elapsed ${elapsedMs}ms`);
	});

	it("preserves the same tool menu and runtime requirements in foreground and background children", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const host = { events: { emit() {} }, getAllTools: () => [
			{ name: "read", sourceInfo: { source: "extension" } },
			{ name: "bash", sourceInfo: { source: "builtin" } },
		] };
		const tools = ["read", "fixture_search", "__proto__"];
		const agent = makeAgent("extension-worker", { tools, subagentOnlyExtensions: [path.join(tempDir, "child-provider.ts")] });
		fs.writeFileSync(agent.subagentOnlyExtensions![0]!, "export default function () {}\n");
		mockPi.onCall({ output: "foreground done" });
		const foreground = await runSync(tempDir, [agent], agent.name, "Inspect using fixture search", {
			hostAvailableBuiltins: getHostBuiltinToolNames(host), acceptance: false,
		});
		assert.equal(foreground.exitCode, 0, foreground.error);
		assert.deepEqual(mockPi.sessions[0]?.launch.tools, tools);
		assert.deepEqual(mockPi.sessions[0]?.launch.runtime.requiredTools, tools);

		mockPi.onCall({ output: "background done" });
		const id = `async-tool-menu-parity-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: agent.name, task: "Inspect using fixture search", agentConfig: agent,
			ctx: { pi: host, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			shareEnabled: false, sessionRoot: path.join(tempDir, "sessions"), acceptance: false,
		});
		const payload = await readAsyncPayload(id);
		assert.equal(payload.success, true);
		const args = readMockPiArgs(mockPi, 1);
		assert.equal(args[args.indexOf("--tools") + 1], tools.join(","));
		assert.deepEqual(readMockPiRequiredTools(mockPi, 1), tools);
	});

	it("records blocked mutation effects when background implementation tools are missing", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "I cannot edit because fixture_search is missing", missingTools: ["fixture_search"] });
		const id = `async-missing-implementation-tool-${Date.now().toString(36)}`;

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Implement the requested source fix",
			agentConfig: makeAgent("worker", { tools: ["read", "fixture_search"], completionGuard: true }),
			ctx: { pi: { events: { emit() {} }, getAllTools: () => [{ name: "read", sourceInfo: { source: "builtin" } }] }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			shareEnabled: false,
			sessionRoot: path.join(tempDir, "sessions"),
			acceptance: false,
		});

		const resultPath = await waitForAsyncResultFile(id, 10_000);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		const statusPayload = await waitForAsyncState(id, (candidate) => candidate.state === "failed");

		assert.equal(payload.success, false);
		assert.equal(payload.state, "failed");
		assert.match(payload.results[0]?.error ?? "", /requested unavailable child tools: fixture_search/);
		assert.doesNotMatch(payload.results[0]?.error ?? "", /completed without making edits/);
		assert.equal(payload.results[0]?.effects?.fileMutation?.status, "blocked");
		assert.equal(payload.results[0]?.effects?.fileMutation?.expected, true);
		assert.equal(payload.results[0]?.effects?.fileMutation?.attempted, false);
		assert.match(payload.results[0]?.effects?.fileMutation?.message ?? "", /requested unavailable child tools: fixture_search/);
		assert.equal(statusPayload.steps?.[0]?.effects?.fileMutation?.status, "blocked");
	});

	it("applies agent acceptance roles to inferred async acceptance", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		mockPi.onCall({ output: "exploration complete" });
		const executor = makeAsyncExecutor([makeAgent("worker", { acceptanceRole: "read-only" })]);

		const result = await executor.execute(
			"async-agent-acceptance-role",
			{ agent: "worker", task: "Explore the authentication flow", async: true, clarify: false },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);

		const asyncId = result.details?.asyncId;
		assert.ok(asyncId, "expected asyncId");
		const payload = await readAsyncPayload(asyncId);
		assert.equal(payload.results[0]?.acceptance?.effectiveAcceptance.level, "none");
	});











	it("async single preserves checked evidence while independent review is pending", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			output: [
				"implemented",
				"```acceptance-report",
				JSON.stringify({
					criteriaSatisfied: [{ id: "criterion-1", status: "satisfied", evidence: "patched" }],
					changedFiles: ["src/file.ts"],
					testsAddedOrUpdated: ["test/file.test.ts"],
					commandsRun: [{ command: "npm test", result: "passed", summary: "passed" }],
					validationOutput: ["passed"],
					residualRisks: [],
					noStagedFiles: true,
					notes: "done",
				}),
				"```",
			].join("\n"),
		});
		const artifactConfig = {
			enabled: false,
			includeInput: false,
			includeOutput: false,
			includeJsonl: false,
			includeMetadata: false,
			cleanupDays: 7,
		};
		const id = `async-acceptance-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Implement acceptance-covered fix",
			agentConfig: makeAgent("worker", { completionGuard: false }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-acceptance" },
			artifactConfig,
			shareEnabled: false,
			acceptance: { level: "checked", criteria: ["Patch bug"], review: { agent: "reviewer", required: true } },
		});
		const resultPath = await waitForAsyncResultFile(id, 10_000);
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		const status = JSON.parse(fs.readFileSync(path.join(ASYNC_DIR, id, "status.json"), "utf-8")) as AsyncStatusPayload;

		assert.equal(result.success, true);
		assert.equal(result.results[0]?.acceptance?.status, "review-required");
		assert.equal(result.results[0]?.acceptance?.evidenceStatus, "checked");
		assert.ok(result.results[0]?.acceptance?.childReport);
		assert.equal(result.results[0]?.acceptance?.reviewResult?.status, "review-required");
		assert.equal(status.steps?.[0]?.acceptance?.status, "review-required");
	});

	it("persists background staged-index baseline failures without launching a child", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const id = `async-preserved-index-failure-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Preserve the staged index",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-preserved-index" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			shareEnabled: false,
			acceptance: { level: "checked", preserveStagedIndex: true },
		});
		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id, 10_000), "utf-8")) as AsyncResultPayload;
		const status = await waitForAsyncState(id, (candidate) => candidate.state === "failed");
		const diagnostic = /Unable to capture staged index baseline:.*not a git repository/is;

		assert.equal(payload.success, false);
		assert.match(payload.results[0]?.error ?? "", diagnostic);
		assert.equal(status.steps?.[0]?.status, "failed");
		assert.match(status.steps?.[0]?.error ?? "", diagnostic);
		assert.equal(mockPi.callCount(), 0);
	});











	it("readStatus caches ordered sweeps above 50 files and invalidates same-mtime replacements", () => {
		const root = createTempDir();
		try {
			const fixedTimestamp = new Date(1_700_000_000_000);
			const dirs = Array.from({ length: 51 }, (_, index) => {
				const dir = path.join(root, `run-${index}`);
				const statusPath = path.join(dir, "status.json");
				fs.mkdirSync(dir);
				fs.writeFileSync(statusPath, JSON.stringify({
					runId: `cache-test-${index}`,
					state: "running",
					mode: "single",
					startedAt: fixedTimestamp.getTime(),
				}));
				fs.utimesSync(statusPath, fixedTimestamp, fixedTimestamp);
				return dir;
			});

			const cached = dirs.map((dir) => readStatus(dir));
			cached.forEach((status) => assert.ok(status));
			dirs.forEach((dir, index) => assert.strictEqual(readStatus(dir), cached[index]));

			const replacedDir = dirs[25]!;
			const cachedStatus = cached[25];
			assert.ok(cachedStatus);
			const statusPath = path.join(replacedDir, "status.json");
			writeAtomicJson(statusPath, { ...cachedStatus, state: "stopped" });
			fs.utimesSync(statusPath, fixedTimestamp, fixedTimestamp);
			assert.equal(fs.statSync(statusPath).mtimeMs, fixedTimestamp.getTime());
			const replaced = readStatus(replacedDir);
			assert.ok(replaced);
			assert.equal(replaced.state, "stopped");
			assert.notStrictEqual(replaced, cachedStatus);

			fs.rmSync(statusPath);
			assert.equal(readStatus(replacedDir), null);

			const removedDir = dirs[50]!;
			assert.ok(readStatus(removedDir));
			fs.rmSync(removedDir, { recursive: true, force: true });
			assert.equal(pruneStatusCacheForAsyncRoot(root, dirs.slice(0, 50).map((dir) => path.basename(dir))), 1);
		} finally {
			removeTempDir(root);
		}
	});

	it("readStatus throws for malformed status files", () => {
		const dir = createTempDir();
		try {
			fs.writeFileSync(path.join(dir, "status.json"), "{bad-json", "utf-8");
			assert.throws(() => readStatus(dir), /Failed to parse async status file/);
		} finally {
			removeTempDir(dir);
		}
	});

	it("background runs fail when a configured provider-qualified model starts on a different child model", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ jsonl: [events.assistantMessage("wrong async provider", "openai-codex/gpt-5.6-sol")] });
		const id = `async-model-verification-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { model: "opencode-go/ox-alpha-free:max" }),
			ctx: {
				pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1",
				modelResponseAliases: { "opencode-go/ox-alpha-free": ["declared-echo"] },
			},
			availableModels: [
				{ provider: "opencode-go", id: "ox-alpha-free", fullId: "opencode-go/ox-alpha-free" },
				{ provider: "openai-codex", id: "gpt-5.6-sol", fullId: "openai-codex/gpt-5.6-sol" },
			],
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			shareEnabled: false,
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id), "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, false);
		assert.equal(payload.results[0]?.model, "opencode-go/ox-alpha-free:max");
		assert.match(payload.results[0]?.error ?? "", /model_verification_failed/);
		assert.match(payload.results[0]?.error ?? "", /Expected 'opencode-go\/ox-alpha-free:max'/);
		assert.match(payload.results[0]?.error ?? "", /observed 'openai-codex\/gpt-5\.6-sol'/);
		const args = readMockPiArgs(mockPi, 0);
		assert.equal(args[args.indexOf("--model") + 1], "opencode-go/ox-alpha-free:max");
		assert.equal(mockPi.callCount(), 1);
	});

	it("background runs return a trailing tool failure after one launch", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [
				mockAssistantMessage("checking connectivity", "tool_use"),
				events.toolResult("bash", "curl: (28) Connection timed out after 5000 ms\nCommand exited with code 1", true),
			],
			exitCode: 0,
		});
		mockPi.onCall({ output: "second launch must not run" });
		const id = `async-single-launch-toolfail-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", {
				model: "openai/gpt-5-mini:high",
			}),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			availableModels: [
				{ provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" },
				{ provider: "anthropic", id: "claude-sonnet-4", fullId: "anthropic/claude-sonnet-4" },
			],
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			shareEnabled: false,
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id), "utf-8"));
		assert.equal(payload.success, false);
		assert.match(payload.results[0].error ?? "", /^bash failed \(exit 1\)/);
		assert.match(payload.results[0].error ?? "", /timed out/i);
		assert.equal("modelAttempts" in payload.results[0], false);
		assert.equal(mockPi.callCount(), 1);
	});

	it("background runs do not retry raw connection stderr after child activity", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [{
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "completed side effect" }],
					model: "openai/gpt-5-mini",
					stopReason: "stop",
					usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
				},
			}],
			stderr: "APIConnectionError: Connection closed.",
			exitCode: 1,
		});
		mockPi.onCall({ output: "second launch must not run" });
		const id = `async-single-launch-raw-stderr-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", {
				model: "openai/gpt-5-mini:high",
			}),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			availableModels: [
				{ provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" },
				{ provider: "anthropic", id: "claude-sonnet-4", fullId: "anthropic/claude-sonnet-4" },
			],
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			shareEnabled: false,
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id), "utf-8"));
		assert.equal(payload.success, false);
		assert.match(payload.results[0].error ?? "", /Connection closed/u);
		assert.equal(mockPi.callCount(), 1);
	});

	it("background resumes a retained compaction-aborted session once on the same model", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const sessionFile = path.join(tempDir, "async-abort-recovery-session.jsonl");
		mockPi.onCall({
			jsonl: [
				events.toolStart("write", { path: "side-effect.txt", content: "done" }),
				events.toolEnd("write"),
				events.toolResult("write", "Wrote side-effect.txt"),
				{ type: "compaction_start" },
				{ type: "message_end", message: { role: "assistant", content: [], model: "openai/gpt-5-mini", stopReason: "aborted", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } },
				{ type: "agent_settled" },
			],
			writeFiles: [{ path: "side-effect.txt", content: "done" }, { path: sessionFile, content: "{}\n" }],
			keepAliveAfterFinalMessageMs: 5_000,
			exitCode: 0,
		});
		mockPi.onCall({ output: "Recovered asynchronously from retained session" });
		const id = `async-same-model-abort-recovery-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			sessionFile,
			agentConfig: makeAgent("worker", { model: "openai/gpt-5-mini:high" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			availableModels: [{ provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" }],
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			shareEnabled: false,
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id), "utf-8"));
		assert.equal(payload.success, true);
		assert.equal(mockPi.callCount(), 2);
		for (let index = 0; index < 2; index++) {
			const args = readMockPiArgs(mockPi, index);
			assert.equal(args[args.indexOf("--model") + 1], "openai/gpt-5-mini:high");
			assert.equal(args[args.indexOf("--session") + 1], sessionFile);
		}
		assert.match(readMockPiArgs(mockPi, 1).at(-1) ?? "", /Continue from the current files and transcript/);
	});

	it("background does not recover a compaction abort without a retained session", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [
				events.assistantMessage("Useful inspection completed."),
				{ type: "compaction_start" },
				{ type: "message_end", message: { role: "assistant", content: [], model: "openai/gpt-5-mini", stopReason: "aborted", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } },
				{ type: "agent_settled" },
			],
			exitCode: 0,
		});
		mockPi.onCall({ output: "unexpected recovery" });
		const id = `async-abort-recovery-no-session-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { model: "openai/gpt-5-mini:high" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			availableModels: [{ provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" }],
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			shareEnabled: false,
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id), "utf-8"));
		assert.equal(payload.success, false);
		assert.match(payload.results[0]?.error ?? "", /Compaction-induced child abort could not be resumed safely: retained session unavailable/);
		assert.equal(mockPi.callCount(), 1);
	});

});
