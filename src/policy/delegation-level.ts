/** How eagerly the orchestrator may delegate. Levels are incremental: each one authorizes more than the last. */
export const DELEGATION_LEVELS = ["never", "rarely", "standard", "aggressive"] as const;

export type DelegationLevel = typeof DELEGATION_LEVELS[number];

const DEFAULT_DELEGATION_LEVEL: DelegationLevel = "standard";
const DELEGATION_LEVEL_SET = new Set<string>(DELEGATION_LEVELS);

/**
 * One self-contained guideline per level, so the model-facing rule moves with the
 * setting instead of stacking a level sentence on top of a fixed conservative one.
 * `standard` keeps the gate the product shipped with; `aggressive` carries the
 * standing authorization the operator granted by setting it.
 */
const GUIDELINES = {
	never: "Delegation level 'never': do not invoke subagents unless the operator explicitly asks for delegation in the current request.",
	rarely: "Delegation level 'rarely': invoke subagents only for a large slice of work, or when delegation is clearly needed.",
	standard: "Delegation level 'standard': do not invoke subagents unless the operator requested delegation directly or through applicable instructions.",
	aggressive: "Delegation level 'aggressive': the operator grants standing delegation, so invoke subagents for bounded work when it materially helps; the parent keeps decisions and final acceptance.",
} satisfies Record<DelegationLevel, string>;

export function isDelegationLevel(value: unknown): value is DelegationLevel {
	return typeof value === "string" && DELEGATION_LEVEL_SET.has(value);
}

/** An unset level resolves to `standard`, the shipped default. */
export function resolveDelegationLevel(level?: DelegationLevel): DelegationLevel {
	return isDelegationLevel(level) ? level : DEFAULT_DELEGATION_LEVEL;
}

/** The single guideline the delegation level contributes to the parent system prompt. */
export function delegationLevelGuideline(level?: DelegationLevel): string {
	return GUIDELINES[resolveDelegationLevel(level)];
}

export function validateDelegationLevel(value: unknown, label = "config.delegationLevel"): DelegationLevel | undefined {
	if (value === undefined) return undefined;
	if (!isDelegationLevel(value)) {
		throw new Error(`${label} must be one of ${DELEGATION_LEVELS.join(", ")}`);
	}
	return value;
}
