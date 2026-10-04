import type { ChainOutputMap, ChainOutputMapEntry } from "../../shared/types.ts";

const OUTPUT_REF_PATTERN = /\{outputs\.([^}]*)\}/g;
const SAFE_OUTPUT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class ChainOutputValidationError extends Error {}

export function resolveOutputReferences(template: string, outputs: ChainOutputMap): string {
	return template.replace(OUTPUT_REF_PATTERN, (rawReference, name: string) => {
		if (!SAFE_OUTPUT_NAME_PATTERN.test(name)) {
			throw new ChainOutputValidationError(`Invalid chain output reference '${rawReference}'. Use {outputs.name} with /^[A-Za-z_][A-Za-z0-9_]*$/ names.`);
		}
		const entry = outputs[name];
		if (!entry) throw new ChainOutputValidationError(`Unknown chain output reference '${rawReference}'.`);
		return entry.text;
	});
}

function compactStructuredText(value: unknown): string {
	return JSON.stringify(value);
}

export function outputEntryFromAsyncResult(result: { agent: string; output: string; structuredOutput?: unknown }, stepIndex: number): ChainOutputMapEntry {
	return {
		text: result.structuredOutput !== undefined ? compactStructuredText(result.structuredOutput) : result.output,
		...(result.structuredOutput !== undefined ? { structured: result.structuredOutput } : {}),
		agent: result.agent,
		stepIndex,
	};
}