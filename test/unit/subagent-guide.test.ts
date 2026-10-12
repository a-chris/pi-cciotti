import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { readSubagentGuide, SUBAGENT_GUIDE_TOPICS } from "../../src/extension/subagent-guide.ts";
import { SUBAGENT_ACTIONS } from "../../src/shared/types.ts";

const SECTION_LIMIT = 8000;
const SECTIONED_TOPICS = SUBAGENT_GUIDE_TOPICS.filter((topic) => topic !== "overview");
const packageRoot = path.resolve(import.meta.dirname, "..", "..");

/** Every section address a bare docs topic currently advertises. */
function sectionAddresses(topic: string): string[] {
	return [...readSubagentGuide(topic).matchAll(new RegExp(`^\\s*(${topic}/\\S+) — `, "gm"))].map((match) => match[1]!);
}

function withTempDocs(files: Record<string, string>, run: (root: string) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-guide-fixture-"));
	try {
		fs.mkdirSync(path.join(root, "docs"));
		for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, "docs", name), content);
		run(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

describe("subagent guide", () => {
	it("reads the packaged overview by default", () => {
		const guide = readSubagentGuide();

		assert.match(guide, /# pi-cciotti/);
	});

	it("returns the whole document for the overview topic", () => {
		// `overview` reads README.md, which is intentionally exempt from the section cap.
		const overview = readSubagentGuide("overview");

		assert.match(overview, /# pi-cciotti/);
		assert.ok(overview.length > SECTION_LIMIT, `overview is ${overview.length} chars; the whole-document behavior was lost`);
	});

	it("lists valid topics for an unknown topic without changing files", () => {
		const guide = readSubagentGuide("unknown");

		assert.match(guide, /Unknown subagents guide topic 'unknown'/);
		assert.match(guide, /No files were changed\./);
		assert.match(guide, new RegExp(SUBAGENT_GUIDE_TOPICS.join(", ")));
	});

	it("rejects a section address on the overview topic with the unknown-topic message", () => {
		const guide = readSubagentGuide("overview/introduction");

		assert.match(guide, /Unknown subagents guide topic 'overview\/introduction'/);
		assert.match(guide, /No files were changed\./);
	});

	it("registers the guide action for action recovery", () => {
		assert.ok(SUBAGENT_ACTIONS.includes("guide"));
	});

	it("documents external CLI runner limits in packaged guide topics", () => {
		assert.match(readSubagentGuide("tool-reference/external-cli-agent-profiles"), /External CLI agent profiles[\s\S]*native Pi child options[\s\S]*model override[\s\S]*native Pi tools/);
		assert.match(readSubagentGuide("agents/advisory-runner-data-boundary"), /External CLI agents use their own runner contract[\s\S]*native Pi child options/);
	});

	it("documents execution-mode boundary guidance in packaged guide topics", () => {
		const workflows = readSubagentGuide("workflows/execution-mode-boundaries-after-failures");
		const toolReference = readSubagentGuide("tool-reference/execution-mode-boundaries-after-failures");
		assert.match(workflows, /subagent workflow[\s\S]*child launch[\s\S]*prompt runtime[\s\S]*extension loading[\s\S]*child tooling setup[\s\S]*workflow infrastructure blocker/);
		assert.match(workflows, /exact failure[\s\S]*run\/status[\s\S]*(?:repo|repository)\/cwd\/worktree\/branch\/ref/);
		assert.match(workflows, /clean[\s\S]*partial diff/);
		assert.match(workflows, /same-protocol retry/);
		assert.match(workflows, /asking the owner/);
		assert.match(workflows, /external\/foreground\/CLI fallback requires explicit owner approval/);
		assert.match(workflows, /Pi core[\s\S]*pi -ne[\s\S]*out-of-repo hint[\s\S]*not protocol-approved fallback/);
		assert.match(toolReference, /workflow infrastructure blocker[\s\S]*external\/foreground\/CLI fallback requires explicit owner approval[\s\S]*interactive_shell[\s\S]*pi -ne/);
	});

	it("keeps advanced workflow details in the packaged guide", () => {
		assert.match(readSubagentGuide("workflows/host-command-steps"), /### Host command steps[\s\S]*runs\.host/);
		assert.match(readSubagentGuide("workflows/advanced-rolling-child-runs"), /### Advanced rolling child runs[\s\S]*Promise\.race[\s\S]*Promise\.all/);
	});

	it("returns a bare docs topic as a table of section addresses, not the whole document", () => {
		const toc = readSubagentGuide("tool-reference");

		assert.ok(toc.length <= SECTION_LIMIT, `TOC is ${toc.length} chars`);
		assert.match(toc, /^tool-reference\/execution-examples — Execution examples$/m);
		assert.match(toc, /^ {2}tool-reference\/budget-guidance-for-writers — Budget guidance for writers$/m);
		assert.doesNotMatch(toc, /\| `agent` \| string \|/);
	});

	it("returns one section and stops before its next sibling", () => {
		const leaf = readSubagentGuide("tool-reference/execution-examples");
		const nested = readSubagentGuide("tool-reference/status");

		assert.match(leaf, /^## Execution examples\n/);
		assert.doesNotMatch(leaf, /## Parameter reference/);
		assert.match(nested, /^### status\n/);
		assert.doesNotMatch(nested, /### resume/);
	});

	it("uses the intro and child addresses when a section would exceed the cap", () => {
		const filler = "filler-".repeat(1400);
		withTempDocs({ "workflows.md": `# Workflows\n\nIntro.\n\n## Big\n\nBig intro.\n\n### Small\n\n${filler}\n` }, (root) => {
			const parent = readSubagentGuide("workflows/big", root);

			assert.ok(parent.length <= SECTION_LIMIT, `parent is ${parent.length} chars`);
			assert.match(parent, /## Big/);
			assert.match(parent, /Subsections \(read one with \{action:"guide",topic:"<address>"\}\):/);
			assert.match(parent, /^workflows\/small — Small$/m);
			assert.doesNotMatch(parent, /filler-/);
		});
	});

	it("keeps every section of every docs topic within the response limit", () => {
		for (const topic of SECTIONED_TOPICS) {
			const addresses = sectionAddresses(topic);
			assert.ok(addresses.length > 0, `${topic} lists no sections`);
			for (const address of addresses) {
				const text = readSubagentGuide(address);
				assert.doesNotMatch(text, /^Unknown/, address);
				assert.ok(text.length <= SECTION_LIMIT, `${address} is ${text.length} chars`);
			}
		}
	});

	it("lists the topic's sections for an unknown section", () => {
		const guide = readSubagentGuide("workflows/no-such-section");

		assert.match(guide, /Unknown section 'workflows\/no-such-section'/);
		assert.match(guide, /^workflows\/scripted-workflows-source — Scripted workflows/m);
	});

	it("reads sections the same way from a CRLF checkout", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-guide-crlf-"));
		try {
			fs.mkdirSync(path.join(root, "docs"));
			fs.writeFileSync(path.join(root, "docs", "workflows.md"), "# Workflows\r\n\r\nIntro.\r\n\r\n## First\r\n\r\nOne.\r\n\r\n## Second\r\n\r\nTwo.\r\n");
			assert.equal(readSubagentGuide("workflows/first", root), "## First\n\nOne.");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("ignores headings inside fenced code blocks", () => {
		withTempDocs(
			{ "workflows.md": "# Workflows\n\nIntro.\n\n```md\n## Not a heading\n```\n\n~~~\n## Also not a heading\n~~~\n\n## Real\n\nBody.\n" },
			(root) => {
				const toc = readSubagentGuide("workflows", root);
				assert.doesNotMatch(toc, /not-a-heading/);
				assert.match(toc, /^workflows\/real — Real$/m);
			},
		);
	});

	it("generates stable duplicate-safe section slugs", () => {
		withTempDocs(
			{ "workflows.md": "# Workflows\n\n## Repeated\n\nOne.\n\n## Repeated\n\nTwo.\n\n## Parent A\n\n### Child\n\nA.\n\n## Parent B\n\n### Child\n\nB.\n" },
			(root) => {
				const toc = readSubagentGuide("workflows", root);
				assert.match(toc, /^workflows\/repeated — Repeated$/m);
				assert.match(toc, /^workflows\/repeated-2 — Repeated$/m);
				assert.equal(readSubagentGuide("workflows/repeated-2", root), "## Repeated\n\nTwo.");
				assert.match(toc, /^\s*workflows\/child — Child$/m);
				assert.match(toc, /^\s*workflows\/parent-b-child — Child$/m);
			},
		);
	});

	it("slugifies headings into the schema's address pattern", () => {
		withTempDocs(
			{ "configuration.md": "# Configuration\n\n## `PI_SUBAGENT_PI_BINARY` and `bg_wait`\n\nBody.\n" },
			(root) => {
				const toc = readSubagentGuide("configuration", root);
				assert.match(toc, /^configuration\/pi-subagent-pi-binary-and-bg-wait — /m);
			},
		);
	});

	it("resolves every guide pointer in shipped prompts, skills and source", () => {
		const topicNames = SUBAGENT_GUIDE_TOPICS.join("|");
		const pointer = new RegExp(`topic:\\s*\\\\?["']([a-z][a-z0-9/-]*)|guide (?:topics? )?((?:${topicNames})(?:/[a-z0-9-]+)?)\\b`, "g");
		const files = ["src", "skills", "prompts", "agents"].flatMap((dir) => fs.readdirSync(path.join(packageRoot, dir), { recursive: true, encoding: "utf-8" })
			.filter((file) => /\.(ts|md)$/.test(file))
			.map((file) => path.join(packageRoot, dir, file)));
		const pointers = files.flatMap((file) => [...fs.readFileSync(file, "utf-8").matchAll(pointer)].map((match) => ({ file, address: match[1] ?? match[2]! })));

		assert.ok(pointers.length > 0, "expected guide pointers");
		for (const { file, address } of pointers) {
			assert.doesNotMatch(readSubagentGuide(address), /^Unknown/, `${path.relative(packageRoot, file)} points to ${address}`);
		}
	});
});
