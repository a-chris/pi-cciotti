import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MISSING_IMPLEMENTATION_MUTATION_ERROR,
	MISSING_IMPLEMENTATION_MUTATION_MESSAGE,
	planCompletionEvidence,
	projectSettlementDiagnostic,
} from "../../src/runs/shared/completion-evidence.ts";

const evidence = {
	source: "tracked-files" as const,
	trackedOnly: true as const,
	changedFiles: [],
	attemptedMutation: false,
};

describe("planCompletionEvidence", () => {
	it("fails closed when expected mutation evidence is missing", () => {
		const plan = planCompletionEvidence({
			guard: { expectedMutation: true, attemptedMutation: false, triggered: true, blocked: false },
			completionGuardEnabled: true,
			mutationCapable: true,
			mutationAttemptObserved: false,
			mutationEvidence: evidence,
		});

		assert.equal(plan.guardTriggered, true);
		assert.equal(plan.legacyFailureError, MISSING_IMPLEMENTATION_MUTATION_ERROR);
		assert.deepEqual(plan.fileMutation, {
			status: "missing",
			expected: true,
			attempted: false,
			evidence,
			message: MISSING_IMPLEMENTATION_MUTATION_MESSAGE,
		});
	});

	it("projects blocked tool availability and observed/not-applicable completions", () => {
		const blocked = planCompletionEvidence({
			guard: { expectedMutation: true, attemptedMutation: false, triggered: false, blocked: true, message: "tools unavailable" },
			completionGuardEnabled: true,
			mutationCapable: false,
			mutationAttemptObserved: true,
		});
		assert.deepEqual(blocked.fileMutation, {
			status: "blocked",
			expected: true,
			attempted: false,
			message: "tools unavailable",
		});
		assert.equal(blocked.mutationAttempted, true);
		assert.deepEqual(projectSettlementDiagnostic(blocked, {
			terminalFailed: true,
			finalTextPresent: false,
			mutationObserved: true,
		}), {
			finalTextPresent: false,
			mutation: { expected: true, attempted: true, observed: true },
			afterCompactionSettlement: false,
		});

		const observed = planCompletionEvidence({
			guard: { expectedMutation: true, attemptedMutation: true, triggered: false, blocked: false },
			guardTriggered: false,
			completionGuardEnabled: true,
			mutationCapable: true,
			mutationAttemptObserved: true,
		});
		assert.deepEqual(observed.fileMutation, {
			status: "observed",
			expected: true,
			attempted: true,
		});
		assert.equal(observed.legacyFailureError, undefined);

		const notApplicable = planCompletionEvidence({
			guard: { expectedMutation: false, attemptedMutation: false, triggered: false, blocked: false },
			completionGuardEnabled: true,
			mutationCapable: true,
			mutationAttemptObserved: false,
		});
		assert.deepEqual(notApplicable.fileMutation, {
			status: "not-applicable",
			expected: false,
			attempted: false,
		});
	});

	it("derives fallback expectation when terminal failure prevents guard evaluation", () => {
		const plan = planCompletionEvidence({
			completionGuardEnabled: true,
			mutationCapable: true,
			mutationAttemptObserved: false,
		});
		assert.equal(plan.mutationExpected, true);
		assert.equal(plan.fileMutation, undefined);
	});
});

describe("projectSettlementDiagnostic", () => {
	it("emits explicit missing-output and mutation evidence on terminal failure", () => {
		const plan = planCompletionEvidence({
			completionGuardEnabled: true,
			mutationCapable: true,
			mutationAttemptObserved: false,
		});
		assert.deepEqual(projectSettlementDiagnostic(plan, {
			terminalFailed: true,
			finalTextPresent: false,
			mutationObserved: false,
			requiredOutput: { kind: "file-only", path: "/tmp/report.md", missing: true },
			afterCompactionSettlement: false,
		}), {
			finalTextPresent: false,
			mutation: { expected: true, attempted: false, observed: false },
			requiredOutput: { kind: "file-only", path: "/tmp/report.md", missing: true },
			afterCompactionSettlement: false,
		});
	});

	it("omits diagnostics for accepted completion with no guard finding", () => {
		const plan = planCompletionEvidence({
			completionGuardEnabled: false,
			mutationCapable: false,
			mutationAttemptObserved: false,
		});
		assert.equal(projectSettlementDiagnostic(plan, {
			terminalFailed: false,
			finalTextPresent: true,
			mutationObserved: false,
		}), undefined);
	});
});