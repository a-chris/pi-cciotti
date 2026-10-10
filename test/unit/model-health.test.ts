import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	clearModelHealth,
	isUnhealthyModel,
	recordUnhealthyModel,
	trimUnhealthyLeadingCandidates,
	UNHEALTHY_MODEL_TTL_MS,
} from "../../src/runs/shared/model-health.ts";

describe("model health marks", () => {
	beforeEach(() => clearModelHealth());
	afterEach(() => clearModelHealth());

	it("marks a failed model for the TTL window and strips thinking suffixes", () => {
		assert.equal(isUnhealthyModel("openai/gpt-5-mini"), false);
		recordUnhealthyModel("openai/gpt-5-mini:high");
		assert.equal(isUnhealthyModel("openai/gpt-5-mini"), true);
		assert.equal(isUnhealthyModel("openai/gpt-5-mini:low"), true);
		assert.equal(isUnhealthyModel("anthropic/claude-sonnet-4"), false);
	});

	it("expires marks after the TTL so the primary is probed again", () => {
		const now = Date.now();
		recordUnhealthyModel("openai/gpt-5-mini", now);
		assert.equal(isUnhealthyModel("openai/gpt-5-mini", now + UNHEALTHY_MODEL_TTL_MS - 1), true);
		assert.equal(isUnhealthyModel("openai/gpt-5-mini", now + UNHEALTHY_MODEL_TTL_MS), false);
	});

	it("trims marked leading candidates while any candidate remains", () => {
		recordUnhealthyModel("openai/gpt-5-mini");
		assert.deepEqual(
			trimUnhealthyLeadingCandidates(["openai/gpt-5-mini", "anthropic/claude-sonnet-4"]),
			["anthropic/claude-sonnet-4"],
		);
		// A marked fallback behind a healthy primary is untouched.
		assert.deepEqual(
			trimUnhealthyLeadingCandidates(["anthropic/claude-sonnet-4", "openai/gpt-5-mini"]),
			["anthropic/claude-sonnet-4", "openai/gpt-5-mini"],
		);
		// A single-candidate chain keeps current behavior: one attempt per launch.
		assert.deepEqual(trimUnhealthyLeadingCandidates(["openai/gpt-5-mini"]), ["openai/gpt-5-mini"]);
	});

	it("keeps the canonical order when every candidate is marked", () => {
		recordUnhealthyModel("openai/gpt-5-mini");
		recordUnhealthyModel("anthropic/claude-sonnet-4");
		assert.deepEqual(
			trimUnhealthyLeadingCandidates(["openai/gpt-5-mini", "anthropic/claude-sonnet-4"]),
			["openai/gpt-5-mini", "anthropic/claude-sonnet-4"],
		);
	});

	it("clears marks on demand", () => {
		recordUnhealthyModel("openai/gpt-5-mini");
		clearModelHealth();
		assert.equal(isUnhealthyModel("openai/gpt-5-mini"), false);
	});
});
