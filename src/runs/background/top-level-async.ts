interface AsyncOverrideParams {
	async?: boolean;
	clarify?: boolean;
	foregroundOnly?: boolean;
}

/**
 * Applies the operator's force-top-level-async policy. The executor always runs at the
 * top level — children cannot delegate — so there is no depth to consult.
 */
export function applyForceTopLevelAsyncOverride<T extends AsyncOverrideParams>(
	params: T,
	forceTopLevelAsync: boolean,
): T {
	if (params.foregroundOnly || !forceTopLevelAsync) return params;
	return { ...params, async: true, clarify: false };
}
