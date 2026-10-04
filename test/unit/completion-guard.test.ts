import test from "node:test";
import assert from "node:assert/strict";

import type { Message } from "@earendil-works/pi-ai";

import {
	completionGuardEnabled,
	evaluateCompletionMutationGuard,
	hasMutationToolCall,
	validateImplementationToolContract,
} from "../../src/runs/shared/completion-guard.ts";
import { isMutatingTool } from "../../src/runs/shared/long-running-guard.ts";

function assistantToolCall(name: string, args: Record<string, unknown> = {}): Message {
	return {
		role: "assistant",
		content: [{ type: "toolCall", name, arguments: args }],
	} as unknown as Message;
}

function assistantText(text: string): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
	} as unknown as Message;
}

test("completionGuardEnabled defaults on for all agents and opts out only with false", () => {
	assert.equal(completionGuardEnabled(undefined), true);
	assert.equal(completionGuardEnabled(true), true);
	assert.equal(completionGuardEnabled(false), false);
});

test("expectsMutation with no mutation attempt triggers the completion guard", () => {
	const result = evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("Implemented the change.")],
	});

	assert.deepEqual(result, {
		expectedMutation: true,
		attemptedMutation: false,
		triggered: true,
		blocked: false,
	});
});

test("expectsMutation false never triggers regardless of messages and tools", () => {
	for (const messages of [
		[assistantText("Review findings only.")],
		[assistantText("No change made.")],
		[assistantText("Done.")],
	]) {
		assert.deepEqual(evaluateCompletionMutationGuard({
			expectsMutation: false,
			messages,
			tools: ["read", "bash", "edit", "write"],
		}), {
			expectedMutation: false,
			attemptedMutation: false,
			triggered: false,
			blocked: false,
		});
	}
});

test("expectsMutation true with a mutation tool call is not triggered", () => {
	const result = evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantToolCall("edit", { path: "a.ts" })],
	});

	assert.deepEqual(result, {
		expectedMutation: true,
		attemptedMutation: true,
		triggered: false,
		blocked: false,
	});
});

test("mutationEvidence.attemptedMutation prevents triggering", () => {
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("Done.")],
		mutationEvidence: { source: "tracked-files", trackedOnly: true, attemptedMutation: true, changedFiles: [] },
	}).triggered, false);
});

test("expectsMutation with only read-only tools is blocked and never triggered", () => {
	const result = evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("No edits.")],
		tools: ["read", "grep", "find", "ls"],
	});

	assert.deepEqual(result, {
		expectedMutation: true,
		attemptedMutation: false,
		triggered: false,
		blocked: true,
		message: "completionGuard is enabled but the agent has no mutation-capable tools. Add a mutation tool or disable completionGuard.",
	});
});

test("blocked result passes through the toolAvailabilityError message", () => {
	const result = evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("I cannot edit.")],
		tools: ["read", "grep", "find", "ls"],
		toolAvailabilityError: "Agent 'worker' requested unavailable child tools: fixture_search.",
	});

	assert.deepEqual(result, {
		expectedMutation: true,
		attemptedMutation: false,
		triggered: false,
		blocked: true,
		message: "Agent 'worker' requested unavailable child tools: fixture_search.",
	});
});

test("mutation-capable tools and MCP tools satisfy the expects-mutation contract", () => {
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("Validation only")],
	}).triggered, true);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("Validation only")],
		tools: [],
	}).triggered, false);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("Validation only")],
		tools: ["read", "bash", "ls"],
	}).triggered, true);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("Validation only")],
		tools: ["read", "custom_lookup"],
	}).triggered, true);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("Validation only")],
		tools: ["read", "write"],
	}).triggered, true);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [assistantText("Validation only")],
		tools: ["read", "grep"],
		mcpDirectTools: ["github/search"],
	}).triggered, true);
});

test("implementation tool contract rejects only-read-only worker launches", () => {
	assert.match(
		validateImplementationToolContract({
			agent: "worker",
			tools: ["read", "grep", "find", "ls"],
		}) ?? "",
		/completionGuard enabled, but its tool allowlist has no mutation-capable tools/,
	);
	// Guard is on by default for all agents; only an explicit opt-out passes.
	assert.equal(validateImplementationToolContract({
		agent: "reviewer",
		tools: ["read", "grep", "find", "ls"],
		completionGuard: false,
	}), undefined);
	assert.equal(validateImplementationToolContract({
		agent: "worker",
		tools: ["read", "edit"],
	}), undefined);
	assert.match(
		validateImplementationToolContract({
			agent: "worker",
			tools: ["read", "structured_output"],
		}) ?? "",
		/completionGuard enabled, but its tool allowlist has no mutation-capable tools/,
	);
	assert.equal(validateImplementationToolContract({
		agent: "worker",
		tools: ["read", "/tmp/mutation-tools.ts"],
	}), undefined);
	assert.equal(validateImplementationToolContract({
		agent: "worker",
		tools: ["read", "grep", "find", "ls"],
		completionGuard: false,
	}), undefined);
});

test("configured extensions satisfy the launch contract", () => {
	assert.match(validateImplementationToolContract({
		agent: "worker",
		tools: ["read", "grep", "find", "ls"],
		requestedTools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
	}) ?? "", /no mutation-capable tools/);
	assert.equal(validateImplementationToolContract({
		agent: "worker",
		tools: ["read", "grep", "find", "ls"],
		configuredExtensions: ["/tmp/mutation-extension.ts"],
		requestedTools: ["read", "grep", "find", "ls"],
	}), undefined);
});

test("edit and write tool calls count as mutation attempts", () => {
	assert.equal(hasMutationToolCall([assistantToolCall("edit", { path: "a.ts" })]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("write", { path: "a.ts" })]), true);
});

test("declared extension mutation tools count without weakening unknown tools", () => {
	const messages = [assistantToolCall("replace", { remove_from: "Liv" })];
	assert.equal(hasMutationToolCall(messages), false);
	assert.equal(hasMutationToolCall(messages, ["replace"]), true);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages,
		tools: ["read", "replace"],
		mutationTools: ["replace"],
		mutationEvidence: { source: "tracked-files", trackedOnly: true, attemptedMutation: false, changedFiles: [], unavailable: "not a Git worktree" },
	}).triggered, false);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages,
		tools: ["read", "replace"],
		mutationEvidence: { source: "tracked-files", trackedOnly: true, attemptedMutation: false, changedFiles: [], unavailable: "not a Git worktree" },
	}).triggered, true);
});

test("obvious mutating bash commands count as mutation attempts", () => {
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "mkdir -p src && cat > src/file.ts <<'EOF'\nhi\nEOF" })]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "cat <<'EOF' > src/file.ts\nhi\nEOF" })]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "python3 -c \"from pathlib import Path; Path('x').write_text('hi')\"" })]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "node script.js > generated.txt" })]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "echo 'a > b'" })]), false);
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "echo 'rm file'" })]), false);
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "git apply patch.diff" })]), true);
});

test("git publication commands count as mutation attempts", () => {
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "git add src/file.ts" })]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "git commit -m 'fix: finish change'" })]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("bash", { command: "git push origin HEAD" })]), true);
});

test("read-only and quoted git commands do not count as mutation attempts", () => {
	for (const command of [
		"git status --short",
		"git diff --check",
		"git log -1 --oneline",
		"gh pr view 749",
		"echo 'git add src/file.ts'",
	]) {
		assert.equal(hasMutationToolCall([assistantToolCall("bash", { command })]), false, command);
	}
});

function assistantThinking(thinking: string): Message {
	return {
		role: "assistant",
		content: [{ type: "thinking", thinking }],
	} as unknown as Message;
}

test("Cursor edit/write thinking traces count as mutation attempts", () => {
	assert.equal(
		hasMutationToolCall([assistantThinking("Cursor edit: docs/BACKEND_ARCHITECTURE.md added 10 lines, removed 3 lines\n")]),
		true,
	);
	assert.equal(
		hasMutationToolCall([assistantThinking("Cursor write: src/file.ts created\n")]),
		true,
	);
	assert.equal(
		hasMutationToolCall([assistantThinking("I plan to edit the file next\n")]),
		false,
	);
});

test("Cursor replay tool calls count only edit/write activity as mutation", () => {
	const cursorEdit = { activityTitle: "Cursor edit", path: "docs/BACKEND_ARCHITECTURE.md" };
	const cursorWrite = { activityTitle: "Cursor write", path: "src/file.ts" };
	assert.equal(hasMutationToolCall([assistantToolCall("cursor", cursorEdit)]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("cursor", cursorWrite)]), true);
	assert.equal(hasMutationToolCall([assistantToolCall("cursor", { activityTitle: "Cursor read" })]), false);
	assert.equal(isMutatingTool("cursor", cursorEdit), true);
	assert.equal(isMutatingTool("cursor", { activityTitle: "Cursor read" }), false);
});

function checkpointMessage(beforeCommit: string, afterCommit: string): Message {
	return {
		type: "custom",
		customType: "pi-checkpoint",
		data: { beforeCommit, afterCommit },
	} as unknown as Message;
}

test("provider checkpoint with a changed commit counts as mutation evidence", () => {
	assert.equal(hasMutationToolCall([checkpointMessage("before", "after")]), true);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [checkpointMessage("before", "after")],
	}).triggered, false);
});

test("unchanged provider checkpoint does not bypass the completion guard", () => {
	assert.equal(hasMutationToolCall([checkpointMessage("same", "same")]), false);
	assert.equal(evaluateCompletionMutationGuard({
		expectsMutation: true,
		messages: [checkpointMessage("same", "same")],
	}).triggered, true);
});