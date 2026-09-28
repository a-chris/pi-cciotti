import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Remove a repeated job name from a child label when a safe separator follows it. */
export function stripRepeatedAgentPrefix(label: string, jobName: string | undefined): string {
	const value = label.trim();
	const prefix = jobName?.trim();
	if (!prefix || !value.startsWith(prefix)) return value;

	const suffix = value.slice(prefix.length);
	if (!suffix || !/^(?::|·|\s)/u.test(suffix)) return value;
	return suffix.replace(/^\s*(?::|·)?\s*/u, "").trim();
}

/** Whether a status label may omit the one logical step marker. */
export function shouldSuppressSingleStep(chainStepCount?: number, stepsTotal?: number): boolean {
	return (chainStepCount ?? stepsTotal) === 1;
}

/** Add an Agent fraction only when visible candidates collide. */
export function withDuplicateLabelDiscriminators<T extends { index: number; displayName: string }>(
	rows: readonly T[],
	total: number,
): Array<T & { rowLabel: string }> {
	const counts = new Map<string, number>();
	for (const row of rows) counts.set(row.displayName, (counts.get(row.displayName) ?? 0) + 1);
	return rows.map((row) => ({
		...row,
		rowLabel: (counts.get(row.displayName) ?? 0) > 1
			? `Agent ${row.index + 1}/${total}: ${row.displayName}`
			: row.displayName,
	}));
}

export function pad(s: string, len: number): string {
	const vis = visibleWidth(s);
	return s + " ".repeat(Math.max(0, len - vis));
}

export function row(content: string, width: number, theme: Theme): string {
	const innerW = width - 2;
	const singleLine = content.replace(/[\r\n]+/g, " ").replace(/\t/g, "  ");
	const clipped = truncateToWidth(singleLine, innerW);
	return theme.fg("border", "│") + pad(clipped, innerW) + theme.fg("border", "│");
}
