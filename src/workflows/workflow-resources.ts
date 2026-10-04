import { randomUUID } from "node:crypto";
import { stableJsonDigest } from "../shared/launch-contract.ts";
import {
	createWorkflowResourcePermit,
	type WorkflowResourceHostAuthority,
	type WorkflowResourcePermit,
} from "../shared/workflow-child-permit.ts";
import type { WorkflowResourceProvenance } from "../shared/types.ts";

const RESOURCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_ARGS_BYTES = 16 * 1024;
const MAX_STRING_BYTES = 16 * 1024;

export interface ResolvedWorkflowResource {
	script: string;
	permit: WorkflowResourcePermit;
	provenance: WorkflowResourceProvenance;
}

export type WorkflowResourceResolution =
	| { ok: true; resource: ResolvedWorkflowResource }
	| { ok: false; error: string };

export interface WorkflowResourceDefinition {
	name: string;
	version: number;
	/** Trusted synchronous validation/expansion. The extension owns semantic command binding. */
	resolve: (args: Readonly<Record<string, unknown>>) => { script: string; hostCommands?: readonly WorkflowResourceHostAuthority[] } | { error: string };
}

export interface WorkflowResourceRegistration {
	dispose(): void;
}

export interface RegisterWorkflowResourceInput {
	sessionId: string;
	definition: WorkflowResourceDefinition;
}

interface WorkflowResourceRegistry {
	version: 1;
	bySession: Map<string, Map<string, WorkflowResourceDefinition>>;
}

function registry(): WorkflowResourceRegistry {
	const key = Symbol.for("pi-cciotti.workflow-resources.v1");
	const globalObject = globalThis as Record<PropertyKey, unknown>;
	const existing = globalObject[key];
	if (existing === undefined) {
		const created: WorkflowResourceRegistry = { version: 1, bySession: new Map() };
		globalObject[key] = created;
		return created;
	}
	if (!isPlainRecord(existing) || existing.version !== 1 || !(existing.bySession instanceof Map)) throw new Error("Malformed or unsupported workflow resource registry.");
	return existing as unknown as WorkflowResourceRegistry;
}

/** Session ID scopes lookup, not authentication. Dispose on session_shutdown; issued permits remain valid. */
export function registerWorkflowResource(input: RegisterWorkflowResourceInput): WorkflowResourceRegistration {
	if (!isPlainRecord(input) || Object.keys(input).some((key) => key !== "sessionId" && key !== "definition")) throw new Error("Workflow registration requires only sessionId and definition.");
	const { sessionId, definition } = input;
	if (typeof sessionId !== "string" || !sessionId || sessionId.trim() !== sessionId || sessionId.length > 256 || sessionId.includes("\0")) throw new Error("Workflow registration requires a non-empty trimmed sessionId of at most 256 characters without NUL.");
	if (!isPlainRecord(definition) || Object.keys(definition).some((key) => !["name", "version", "resolve"].includes(key))) throw new Error("Workflow definition requires only name, version and resolve.");
	const { name, version, resolve } = definition;
	if (typeof name !== "string" || !RESOURCE_NAME_PATTERN.test(name)) throw new Error("Workflow definition requires a safe resource name.");
	if (!Number.isSafeInteger(version) || version < 1) throw new Error("Workflow definition version must be a positive safe integer.");
	if (typeof resolve !== "function") throw new Error("Workflow definition requires a synchronous resolve function.");
	if (findWorkflowResource(name)) throw new Error(`Workflow resource '${name}' is a protected builtin.`);
	const current = registry();
	const bucket = current.bySession.get(sessionId) ?? new Map<string, WorkflowResourceDefinition>();
	if (!(bucket instanceof Map)) throw new Error("Malformed workflow resource session registry.");
	if (bucket.has(name)) throw new Error(`Workflow resource '${name}' is already registered in this session; dispose it first.`);
	const snapshot = Object.freeze({ name, version, resolve });
	bucket.set(name, snapshot);
	current.bySession.set(sessionId, bucket);
	let disposed = false;
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			if (bucket.get(name) === snapshot) bucket.delete(name);
			if (bucket.size === 0 && current.bySession.get(sessionId) === bucket) current.bySession.delete(sessionId);
		},
	};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function jsonByteLength(value: unknown): number {
	try {
		const encoded = JSON.stringify(value);
		if (encoded === undefined) throw new Error("must contain JSON data");
		return Buffer.byteLength(encoded, "utf8");
	} catch (error) {
		throw new Error(`must contain plain JSON data: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function validatePlainJson(value: unknown, path: string, depth = 0): void {
	if (depth > 8) throw new Error(`${path} is too deeply nested.`);
	if (value === null || typeof value === "boolean") return;
	if (typeof value === "string") {
		if (!value.trim()) throw new Error(`${path} must not be empty.`);
		if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) throw new Error(`${path} exceeds ${MAX_STRING_BYTES} bytes.`);
		return;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${path} must be finite.`);
		return;
	}
	if (Array.isArray(value)) {
		if (value.length > 64) throw new Error(`${path} contains too many items.`);
		for (const [index, entry] of value.entries()) validatePlainJson(entry, `${path}[${index}]`, depth + 1);
		return;
	}
	if (!isPlainRecord(value)) throw new Error(`${path} must contain plain JSON data.`);
	if (Object.keys(value).length > 16) throw new Error(`${path} contains too many fields.`);
	for (const [key, entry] of Object.entries(value)) {
		if (!key.trim()) throw new Error(`${path} contains an empty field name.`);
		validatePlainJson(entry, `${path}.${key}`, depth + 1);
	}
}

export function normalizeWorkflowArgs(value: unknown): { args: Record<string, unknown> } | { error: string } {
	if (value === undefined) return { args: {} };
	if (!isPlainRecord(value)) return { error: "workflow args must be a plain JSON object." };
	try {
		validatePlainJson(value, "workflow args");
		if (jsonByteLength(value) > MAX_ARGS_BYTES) return { error: `workflow args exceed ${MAX_ARGS_BYTES} bytes.` };
		return { args: JSON.parse(JSON.stringify(value)) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export function deepFreezeWorkflowArgs<T extends Record<string, unknown>>(args: T): Readonly<T> {
	deepFreezeWorkflowValue(args);
	return args;
}

function deepFreezeWorkflowValue(value: unknown): void {
	if (!Array.isArray(value) && !isPlainRecord(value)) return;
	for (const entry of Object.values(value)) deepFreezeWorkflowValue(entry);
	Object.freeze(value);
}

function resolveRunCi(args: Readonly<Record<string, unknown>>): ReturnType<WorkflowResourceDefinition["resolve"]> {
	const allowed = new Set(["command", "timeoutMs"]);
	const unsupported = Object.keys(args).filter((key) => !allowed.has(key));
	if (unsupported.length > 0) return { error: `workflow 'run-ci' args contain unsupported fields: ${unsupported.join(", ")}.` };
	const command = args.command === undefined ? "npm test" : args.command;
	if (command !== "npm test" && command !== "npm run typecheck") return { error: "workflow 'run-ci' args.command must be 'npm test' or 'npm run typecheck'." };
	const timeoutMs = args.timeoutMs === undefined ? 120_000 : args.timeoutMs;
	if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86_400_000) return { error: "workflow 'run-ci' args.timeoutMs must be an integer from 1 to 86400000." };
	const params = { kind: "command", command, timeoutMs, role: "ci" };
	return {
		script: `return await runs.host("ci", ${JSON.stringify(params)});`,
		hostCommands: [{ key: "ci", command }],
	};
}

function resolveReview(args: Readonly<Record<string, unknown>>): ReturnType<WorkflowResourceDefinition["resolve"]> {
	const unsupported = Object.keys(args).filter((key) => key !== "task");
	if (unsupported.length > 0) return { error: `workflow 'review' args contain unsupported fields: ${unsupported.join(", ")}.` };
	const task = args.task;
	if (typeof task !== "string" || !task.trim()) return { error: "workflow 'review' requires a non-empty string args.task." };
	return {
		script: `return (await runs.run("review", { agent: "reviewer", task: ${JSON.stringify(task.trim())} })).output;`,
	};
}

const PERL_MAX_REVIEW_ROUNDS = 10;
const PERL_DEFAULT_REVIEW_ROUNDS = 3;
const PERL_WORKTREE_BRANCH = "perl/work";
const PERL_WORKTREE_SETUP_TIMEOUT_MS = 30_000;
const PERL_SLUG_MAX_LENGTH = 40;

/**
 * Sanitize a perl worktree slug: lowercase, keep only [a-z0-9-], collapse
 * dashes, strip leading/trailing dashes, bound the length. The result is safe
 * to embed in the granted shell command and in a branch name.
 */
export function sanitizePerlSlug(raw: string): string {
	return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, PERL_SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

/**
 * Idempotent POSIX shell setup for the perl worktree, run through the granted
 * `wt-setup` host command. Resolves the repo root from the workflow cwd, reuses
 * or creates a sibling `.pi-perl-<repo>[-<slug>]` worktree on the
 * `perl/work[-<slug>]` branch, and prints `WORKTREE <path>`. Outside a git
 * repository there is no worktree to isolate into, so it prints `PLAIN <pwd>`
 * (the workflow cwd, which is where the host command runs) and succeeds — the
 * plain lane still needs a shared directory for `plan.md`. It exits 1 only when
 * the worktree genuinely cannot be created, which leaves the run on the engine's
 * default artifact routing. The slug is sanitized before it reaches this string,
 * so it cannot inject shell.
 */
function perlWorktreeCommand(slug?: string): string {
	const suffix = slug ? `-${slug}` : "";
	const branch = slug ? `perl/work-${slug}` : PERL_WORKTREE_BRANCH;
	return `R=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "PLAIN $(pwd)"; exit 0; }; P="$(dirname "$R")/.pi-perl-$(basename "$R")${suffix}"; git worktree prune 2>/dev/null; if [ -e "$P" ] && [ ! -e "$P/.git" ]; then echo "refusing to replace existing non-worktree path: $P" >&2; exit 1; fi; if [ ! -e "$P/.git" ]; then git worktree add "$P" -b ${branch} 2>/dev/null || git worktree add "$P" ${branch} || exit 1; fi; test -d "$P" || exit 1; echo "WORKTREE $P"`;
}

/** Prefixes the setup command prints so the script can tell a real worktree from a plain-cwd fallback. */
const PERL_WORKTREE_PREFIX = "WORKTREE ";
const PERL_PLAIN_PREFIX = "PLAIN ";

/**
 * Generated-script preamble that creates the worktree through the granted
 * `wt-setup` host command and returns two launch wrappers over the shared
 * directory (`base`):
 * - `withWt` pins a child's `cwd` into it.
 * - `intoWt(launch, name)` additionally pins the child's `output` to an absolute
 *   `<base>/<name>`.
 *
 * `base` is the worktree, or the plain workflow cwd when the setup command
 * reports `PLAIN` (not a git repository). It is empty only when setup genuinely
 * failed, and then both wrappers are identity and children fall back to the
 * engine's default artifact routing.
 *
 * The absolute output pin is what lets the two phases hand work to each other.
 * A workflow child's relative `output` is deliberately routed to the managed
 * artifact directory (so a review run cannot litter the repo), which is right for
 * prose reports but wrong for `plan.md` and `context.md`: the operator reviews
 * `plan.md` in the shared directory and the execute phase reads both files back
 * from there, so they must land there under their own names. Only the generated
 * script knows `base` at runtime, so it passes the absolute path.
 */
function perlWorktreePreamble(setupCommand: string): string {
	return `let worktree = "";
let base = "";
try {
	const wtSetup = await runs.host("wt-setup", { kind: "command", command: ${JSON.stringify(setupCommand)}, timeoutMs: ${PERL_WORKTREE_SETUP_TIMEOUT_MS} });
	const wtLine = wtSetup.stdout.trim().split("\\n").pop() || "";
	if (wtLine.startsWith(${JSON.stringify(PERL_WORKTREE_PREFIX)})) {
		worktree = wtLine.slice(${PERL_WORKTREE_PREFIX.length});
		base = worktree;
	} else if (wtLine.startsWith(${JSON.stringify(PERL_PLAIN_PREFIX)})) {
		base = wtLine.slice(${PERL_PLAIN_PREFIX.length});
	}
} catch { worktree = ""; base = ""; }
const withWt = (launch) => (base ? { ...launch, cwd: base } : launch);
const intoWt = (launch, name) => (base ? { ...launch, cwd: base, output: base + "/" + name } : launch);
const planPath = base ? base + "/plan.md" : "plan.md";
`;
}

/**
 * Generated-script tail for the execute phase (assumes the worktree preamble
 * already ran): scout writes context.md, worker implements plan.md, then up to
 * `rounds` reviewer/fix rounds with a machine-readable verdict. `resultFields`
 * completes the returned evidence object, because the bare execute call and the
 * unattended plan+execute run report slightly different shapes.
 */
function perlExecuteScript(rounds: number, branch: string, implementLaunch: Record<string, unknown>, resultFields: string): string {
	const reviewSchema = {
		type: "object",
		additionalProperties: false,
		required: ["verdict"],
		properties: {
			verdict: { type: "string", enum: ["BLOCK", "OK", "OK with notes"] },
			findings: { type: "array", items: { type: "string" } },
		},
	};
	return `const reviewSchema = ${JSON.stringify(reviewSchema)};
const recon = await runs.run("recon", intoWt({ agent: "scout", task: "Read plan.md and write context.md for the worker that will implement it: the exact files and seams to touch, existing conventions, and the verification commands that already exist. Do not implement anything.", async: false, output: true, worktree: false }, "context.md"));
const implementation = await runs.run("implement", withWt(${JSON.stringify(implementLaunch)}));
let verdict = "BLOCK";
let findings = [];
let fixRounds = 0;
for (let round = 1; round <= ${rounds}; round++) {
	const review = await runs.run("review-" + round, withWt({ agent: "reviewer", task: "Review the implementation of plan.md. Read plan.md and inspect the files it names, plus their immediate callers, directly against the plan's steps and scope bounds. Report only concrete findings (file, issue, why it matters) and end with a merge verdict.", async: false, worktree: false, outputSchema: reviewSchema }));
	verdict = review.structuredOutput?.verdict ?? "BLOCK";
	findings = Array.isArray(review.structuredOutput?.findings) ? review.structuredOutput.findings : [];
	if (verdict === "OK" || verdict === "OK with notes") break;
	if (round < ${rounds}) {
		fixRounds = round;
		const detail = findings.length > 0 ? "- " + findings.join("\\n- ") : String(review.output).slice(0, 2000);
		await runs.run("fix-" + round, withWt({ agent: "worker", task: "Fix these review findings from the implementation of plan.md:\\n\\n" + detail + "\\n\\nRe-check each finding against the code before applying it, re-run the plan's verification commands, and report what you changed plus the results.", async: false, worktree: false }));
	}
}
return { phase: "executed", ${resultFields}verdict, fixRounds, findings, implementation: implementation.output };`;
}

/** The execute-phase worker launch; `prequel` rides with the child like on the planner. */
function perlImplementLaunch(prequel: string | undefined): Record<string, unknown> {
	const implementLaunch: Record<string, unknown> = {
		agent: "worker",
		task: "Implement plan.md, guided by context.md. Follow the plan's steps and scope bounds (Now only). Verify with the plan's verification commands and report what you changed, what you verified with which results, and anything BLOCKED.",
		async: false,
		worktree: false,
	};
	if (prequel !== undefined) implementLaunch.prequel = prequel.trim();
	return implementLaunch;
}

/**
 * perl and perla are one plan ↦ execute ↦ review ↦ loop engine that differs
 * only in where the run stops. `perl` is the unattended lane: with `task` the
 * planner writes plan.md and the same run continues straight into scout,
 * worker, and the bounded review/fix loop. `perla` is the approval lane: with
 * `task` it runs the plan phase only and stops, the operator reviews plan.md
 * between the two calls, and the bare call executes the existing plan.md
 * through scout, worker, and the bounded review/fix loop. All children share
 * one sibling worktree (`.pi-perl-<repo>[-<slug>]` on `perl/work[-<slug>]`)
 * when the workflow cwd is a git repository, otherwise they share the plain
 * cwd. The optional `slug` names a lane so concurrent runs in the same repo
 * get distinct worktrees; the slug is the stable identity that makes an
 * execute call find the worktree the plan call made.
 */
function resolvePerlResource(name: "perl" | "perla", gate: "auto" | "manual") {
	return (args: Readonly<Record<string, unknown>>): ReturnType<WorkflowResourceDefinition["resolve"]> => {
		const unsupported = Object.keys(args).filter((key) => key !== "task" && key !== "prequel" && key !== "maxRounds" && key !== "slug");
		if (unsupported.length > 0) return { error: `workflow '${name}' args contain unsupported fields: ${unsupported.join(", ")}.` };
		const prequel = args.prequel;
		if (prequel !== undefined && (typeof prequel !== "string" || !prequel.trim())) return { error: `workflow '${name}' args.prequel must be a non-empty string.` };
		const maxRounds = args.maxRounds;
		if (maxRounds !== undefined && (typeof maxRounds !== "number" || !Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > PERL_MAX_REVIEW_ROUNDS)) return { error: `workflow '${name}' args.maxRounds must be an integer from 1 to ${PERL_MAX_REVIEW_ROUNDS}.` };
		const rounds = maxRounds === undefined ? PERL_DEFAULT_REVIEW_ROUNDS : maxRounds;
		let slug: string | undefined;
		if (args.slug !== undefined) {
			if (typeof args.slug !== "string") return { error: `workflow '${name}' args.slug must be a string.` };
			slug = sanitizePerlSlug(args.slug);
			if (!slug) return { error: `workflow '${name}' args.slug must contain at least one alphanumeric character.` };
		}
		const setupCommand = perlWorktreeCommand(slug);
		const branch = slug ? `perl/work-${slug}` : PERL_WORKTREE_BRANCH;
		const hostCommands: readonly WorkflowResourceHostAuthority[] = [{ key: "wt-setup", command: setupCommand }];

		const task = args.task;
		if (task !== undefined) {
			if (typeof task !== "string" || !task.trim()) return { error: `workflow '${name}' args.task must be a non-empty string.` };
			const launch: Record<string, unknown> = { agent: "planner", async: false, output: true, worktree: false };
			if (prequel !== undefined) launch.prequel = prequel.trim();
			// The planner is pinned into the worktree (cwd) but is not otherwise told where it
			// is, so it would invent a branch name in plan.md. The task is assembled in the
			// generated script (where the runtime worktree path is known) so plan.md references
			// the real path and branch.
			const planSetup = `const launch = ${JSON.stringify(launch)}; launch.task = ${JSON.stringify(task.trim())} + (worktree ? " (Working in git worktree " + worktree + " on branch " + ${JSON.stringify(branch)} + ". Use these exact paths and branch name in plan.md.)" : "");`;
			if (gate === "manual") {
				return {
					script: `${perlWorktreePreamble(setupCommand)}${planSetup} return { phase: "plan", plan: planPath, worktree: worktree || null, summary: (await runs.run("planner", intoWt(launch, "plan.md"))).output };`,
					hostCommands,
				};
			}
			return {
				script: `${perlWorktreePreamble(setupCommand)}${planSetup} const planned = (await runs.run("planner", intoWt(launch, "plan.md"))).output;
${perlExecuteScript(rounds, branch, perlImplementLaunch(prequel), `plan: planPath, worktree: worktree || null, branch: ${JSON.stringify(branch)}, summary: planned, `)}`,
				hostCommands,
			};
		}
		return {
			script: `${perlWorktreePreamble(setupCommand)}${perlExecuteScript(rounds, branch, perlImplementLaunch(prequel), `plan: "plan.md", worktree: worktree || null, branch: ${JSON.stringify(branch)}, `)}`,
			hostCommands,
		};
	};
}

const WORKFLOW_RESOURCES: readonly WorkflowResourceDefinition[] = [
	{ name: "perl", version: 1, resolve: resolvePerlResource("perl", "auto") },
	{ name: "perla", version: 1, resolve: resolvePerlResource("perla", "manual") },
	{ name: "review", version: 1, resolve: resolveReview },
	{ name: "run-ci", version: 1, resolve: resolveRunCi },
];

function findWorkflowResource(name: string): WorkflowResourceDefinition | undefined {
	return WORKFLOW_RESOURCES.find((resource) => resource.name === name);
}

function listWorkflowResourceNames(): string[] {
	return WORKFLOW_RESOURCES.map((resource) => resource.name);
}

/** Resolve only extension-owned resources so policy can distinguish them from raw scripts; caller-provided script text is never consulted. */
export function resolveWorkflowResource(nameValue: unknown, argsValue?: unknown, sessionId?: string): WorkflowResourceResolution {
	try {
		const result = resolveResource(nameValue, argsValue, sessionId);
		return result.ok ? result : { ok: false, error: result.error.slice(0, 4096) };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message.slice(0, 4096) : "Workflow resource resolution failed." };
	}
}

function resolveResource(nameValue: unknown, argsValue?: unknown, sessionId?: string): WorkflowResourceResolution {
	if (typeof nameValue !== "string" || !nameValue.trim()) return { ok: false, error: "workflow must be a non-empty resource name." };
	const name = nameValue.trim();
	if (!RESOURCE_NAME_PATTERN.test(name)) return { ok: false, error: "workflow must use a safe resource name." };
	const resource = findWorkflowResource(name) ?? (sessionId ? registry().bySession.get(sessionId)?.get(name) : undefined);
	if (!resource) return { ok: false, error: `Unknown workflow resource '${name}'. Available resources: ${listWorkflowResourceNames().join(", ")}.` };
	const normalizedArgs = normalizeWorkflowArgs(argsValue);
	if ("error" in normalizedArgs) return { ok: false, error: normalizedArgs.error };
	const resolved = resource.resolve(normalizedArgs.args);
	if (resolved && typeof (resolved as unknown as { then?: unknown }).then === "function") {
		void Promise.resolve(resolved).catch(() => {});
		throw new Error("Workflow resource resolve must be synchronous.");
	}
	if (!isPlainRecord(resolved)) throw new Error("Workflow resource resolve must return an expansion or error object.");
	if ("error" in resolved) {
		if (Object.keys(resolved).some((key) => key !== "error") || typeof resolved.error !== "string" || !resolved.error.trim()) throw new Error("Workflow resource returned an invalid error.");
		return { ok: false, error: resolved.error };
	}
	const { script, hostCommands } = resolved;
	if (Object.keys(resolved).some((key) => key !== "script" && key !== "hostCommands") || typeof script !== "string" || !script.trim()) throw new Error("Workflow resource returned an invalid expansion.");
	const resourceId = randomUUID();
	const permit = createWorkflowResourcePermit({
		resourceName: resource.name,
		resourceVersion: resource.version,
		resourceId,
		scriptDigest: stableJsonDigest(script),
		authority: { host: hostCommands },
	});
	const provenance: WorkflowResourceProvenance = Object.freeze({
		kind: "workflow",
		name: resource.name,
		version: resource.version,
		invocation: "named",
		expansion: "resolved",
		id: resourceId,
	});
	return { ok: true, resource: { script, permit, provenance } };
}
