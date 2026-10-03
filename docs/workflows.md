# Workflows and orchestration

How to compose subagents: the recommended pattern, packaged prompt shortcuts, scripted workflows, direct commands, worktree isolation, and child-to-parent coordination.

## Recommended orchestration pattern

Use orchestration as parent-agent guidance, not as a runtime workflow mode. For implementation work, the recommended loop is:

```text
clarify → scout → worker → fresh reviewers → worker
```

Packaged `worker`, `oracle`, and `reviewer` declare a summary brief in their agent definitions; no packaged agent forks by default. If the parent has no persisted session file or current leaf yet, that implicit default falls back to `fresh`. A call cannot choose the mode; pick an agent whose `defaultContext` matches what you want.

Child-safety boundaries are enforced at runtime:

- Child sessions do not receive the bundled `pi-cciotti` skill.
- Forked child context filtering removes parent-only subagent artifacts (including old hidden orchestration-instruction messages, slash/status/control messages, and prior parent `subagent` tool-call/tool-result history) while preserving ordinary prose and unrelated tool calls/results.
- By default, children do not register the `subagent` tool and receive boundary instructions that they are not the parent orchestrator and must not propose or run subagents.

### Execution-mode boundaries after failures

A failure in the subagent workflow, child launch, prompt runtime, extension loading, or child tooling setup is a workflow infrastructure blocker. It is not permission to silently retry through `interactive_shell`, `pi -ne`, Codex/Claude/Cursor CLI, a foreground agent, or another external execution mode.

Stop and report the exact failure, run/status, and repository/cwd/worktree/branch/ref state. Before a same-protocol retry or asking the owner, verify the worktree is clean or capture the partial diff. Retry or fix the `subagent` path only through a clear same-protocol action. For other subagent-governed workflows, external/foreground/CLI fallback requires explicit owner approval. `interactive_shell` remains valid when the user explicitly requests visible foreground/CLI work or the task is outside the governed subagent protocol.

Pi core may print a generic `pi -ne` extension-load hint; that out-of-repo hint is not protocol-approved fallback. A verified compaction abort may continue the retained child once on its already resolved model; it does not authorize an execution-mode or model switch.

## Prompt shortcuts

The package includes reusable prompt templates for common workflows. You do not need them, but they are handy when you want the same shape every time:

| Prompt | Use it for |
|--------|------------|
| `/parallel-review` | Launch fresh-context reviewers with distinct angles, then synthesize what to fix. |
| `/review-loop` | Run parent-controlled worker, reviewer, and fix-worker cycles until clean or capped. |
| `/perl` | Plan a task into `plan.md` for your review; bare `/perl` then executes the reviewed plan through scout, worker, and a bounded review/fix loop. |
| `/parallel-research` | Combine `researcher` and `scout` for external evidence, local code context, and practical tradeoffs. |
| `/gather-context-and-clarify` | Scout/research first, then ask the user the clarification questions that matter. |
| `/parallel-cleanup` | Run review-only cleanup passes after implementation. |

Add `autofix` to `/parallel-review` or `/parallel-cleanup` to apply only the synthesized fixes worth doing now after reviewers return.

## Scripted workflows (`source`)

Use direct `{ agent, task }` for one bounded child. Use a workflow script (`source`) when the parent needs a stable keyed child, sequence, fanout, steering, retry, or aggregation. For ordinary parallel fanout, use `await runs.all([{ key, agent, task }, ...])`. It resolves to an ordered array, not a key map, so use indexes, destructuring, or `.map(...)`, not `results.<key>`. Do not read `.output` from unawaited `runs.run` launches. Store a `runs.run` promise only when the script later observes it with `await`, `Promise.race`, or `Promise.all`, such as steering a live child before awaiting its result. Scripts are ordinary JavaScript statement bodies. Use an explicit `return` for a useful result:

For multi-step or parallel work, make exactly one top-level `subagent` workflow call with `async:true` and launch children only inside it. Read this guide for recipes rather than constructing a second top-level orchestration. Available sandbox helpers include `runs.run`, `runs.all`, `runs.steer`, `runs.status`, `runs.ref`/`runs.refs`, `emit`, `console`, standard JavaScript, and mission `state` when enabled. No filesystem, shell, arbitrary Pi tools, or host globals are available; named resources alone may grant `runs.host` authority.

Workflow-level child controls default onto each `runs.run`/`runs.all` launch; explicit child fields override them. See [retained children](tool-reference.md#retained-children) for follow-up challenges and [output binding](tool-reference.md#output-mode-details) for durable artifacts.

Child results cross into the script as plain JSON data. Non-JSON host metadata is omitted, so use returned fields such as `runId`, `ok`, `output`, and `structuredOutput` for workflow control.

Scripts are supplied as `source`: either an inline statement body or `{ path }` to load one from a
file. The two shapes are mutually exclusive.

```js
subagent_workflow({ source: "return runs.run('main', { agent: 'scout', task: 'Scan' })" });
subagent_workflow({ source: { path: "workflows/review.js" } });
```

There is no separate static-lint verb on the model surface: linting a script needs the script body,
which only `subagent_workflow` carries, and the same script run reports the same syntax and
spawn-budget errors before any child launches. Relative paths resolve against the request `cwd`; absolute paths pass through. The host reads the file before validation or workflow sandbox execution. The sandbox still has no filesystem access. Missing, unreadable, and empty files return file input errors instead of script syntax errors.

Inline and file-backed scripts accept bounded plain-JSON `args`:

```js
subagent_workflow({ source: { path: "workflows/review.js" }, args: { target: "src/workflows" } });
// workflows/review.js
return runs.run("review", { agent: "reviewer", task: `Review ${args.target}` });
```

Omitted arguments are an empty object. The `args` object, its nested objects, and its arrays are frozen in the sandbox. Arguments are data only: they do not grant `runs.host` or other authority. Normalized arguments are persisted with workflow evidence for replay and diagnosis, so do not put secrets in them. Routine status text does not render argument values.

### Named workflow resources for permission extensions

Use a named workflow resource when a permission or policy extension needs to distinguish extension-resolved workflow content from raw model-authored scripts:

```js
subagent_workflow({ workflow: "review", args: { task: "Review the change" } });
subagent_workflow({ workflow: "run-ci", args: { command: "npm test" } });
subagent_workflow({ workflow: "perl", args: { task: "Implement the auth fix" } });
```

The host resolves the name and validates bounded plain-JSON `args` before starting the workflow. Resource provenance is recorded in workflow details and receipts for downstream permission/policy checks. Resource authority is not caller-supplied: `runs.host` is available only when the resolved resource explicitly grants the requested host key and command. An inline `source` script and a file-backed `source: { path }` remain raw, unknown-provenance inputs, so their `runs.host` calls are unavailable through the public execution boundary. Named resources cannot be combined with `agent`, `task`, or `source`; the package-owned resources are `review`, `run-ci`, and `perl`, and there is no user/project resource registry.

`perl` is a plan/execute pair keyed on the `plan.md` file. At the start of each run the workflow provisions one worktree for all of its children through its granted `wt-setup` host command: an idempotent shell step that creates or reuses a sibling worktree (next to the repository root, so it is never part of the working tree) and reports it as `WORKTREE <path>`, or `PLAIN <cwd>` when the workflow cwd is not a git repository. Both phases run every child (`planner`, `scout`, `worker`, `reviewer`, fix `worker`) inside that shared directory, and the workflow pins `plan.md` and `context.md` to absolute paths inside it — a workflow child's relative `output` would otherwise route to the session's managed artifact directory, and the execute phase could never find the plan to run. The run result reports the `worktree` path and, in the execution phase, the `branch`; outside a git repository `worktree` is `null` while the plain cwd still owns the files. If setup fails outright (a failed `git worktree add`, or a refused pre-existing path), the run falls back to default artifact routing and reports `worktree: null`. The optional `args.slug` names a **lane**: `slug: "auth-fix"` runs in `.pi-perl-<repo>-auth-fix` on branch `perl/work-auth-fix` instead of the default `.pi-perl-<repo>` / `perl/work`. The slug is sanitized to lowercase `[a-z0-9-]` (max 40 chars), and it is the stable identity that lets the execute call find the worktree the plan call created — pass the same `slug` to both calls, and use distinct slugs when you want two perl tasks running concurrently in the same repo. `args.task` runs the plan phase only: the `planner` agent writes `plan.md` into the shared directory — the plan result names the full path — and the run stops. A call without `task` executes the existing `plan.md` through `scout` (writes `context.md`), `worker`, and up to `args.maxRounds` (default 3, max 10) review/fix rounds with a machine-readable reviewer verdict. The manual review gate is the file itself: review or edit `plan.md` between the two calls, then call `perl` again (with the same `slug`) to execute. Each `perl/work*` branch is yours to merge, push, or delete when the work is done; nothing in the workflow touches it automatically.

### Opt-in bounded workflows

Composite workflows have no default parent deadline. Set the `timeoutMs` and `toolBudget` config keys only when the workflow contract calls for a bound:

```js
subagent_workflow({
  source: `
    const scan = await runs.run("scan", { agent: "scout", task: "Inspect the named files." });
    return runs.run("review", { agent: "reviewer", task: "Review:\n" + scan.output });
  `,
});
```

- The validated `timeoutMs` config key sets the workflow deadline and bounds child deadlines to the remaining time.
- The validated `toolBudget` config key becomes the default for each child unless that child supplies a narrower value in its `runs.run` item.
- Budget and timeout stops return a structured `terminalOutcome` with `state: "partial"` and reason `budget_exhausted` or `timeout`. Workflow receipts keep settled child evidence for recovery.
- After an async workflow receipt is successfully published, `workflowReceiptPath` exposes its exact path in wait completion details, completion notifications, and exact status/debug details. Text responses also identify the receipt. Pending runs and failed receipt publications omit the reference; older status records are not backfilled. The reference records publication, not a guarantee against later retention cleanup. Raw result files retain `workflowReceipt: { path, receipt }`.

These controls are opt-in. Avoid tight hard budgets for mutation-capable workers unless the workflow has an explicit checkpoint and handoff path.

A script that fails to parse returns a tool error with line and column data when available. Validation checks syntax, portable nested-async rules, literal `runs.run` and `runs.all` keys and child `baseRef` values, duplicate literal keys in one `runs.all` group, direct keyed access to a known `runs.all` result, and statically clear non-JSON boundary values. Dynamic keys and other runtime-only values are accepted without a warning. Validation does not discover agents, launch children, or create run artifacts.

```js
subagent_workflow({ source: `
  const scan = await runs.run("scan", { label: "Map codebase behavior", agent: "scout", task: "Scan the codebase" });
  const reviews = await runs.all([
    { key: "correctness", label: "Review codebase correctness", agent: "reviewer", task: "Review correctness: " + scan.output },
    { key: "tests", label: "Review test coverage", agent: "reviewer", task: "Review tests: " + scan.output }
  ]);
  return reviews.map(result => result.output);
` });
```

Keep helper functions portable across Node and Bun. Use top-level `await`, plain helper functions that return `runs.run(...)`, or explicit Promise chains. Do not define nested `async function` helpers, async arrows, or async methods inside the script; native async helpers hide child-launch observation in Bun and are rejected.

```js
subagent_workflow({ source: `
  function scan() {
    return runs.run("scan", { label: "Map codebase behavior", agent: "scout", task: "Scan the codebase" });
  }
  const result = await scan();
  return result.output;
` });
```

Chaining is still supported. The supported form is scripted chaining: await one `runs.run(...)` result, then pass its output into the next step. Parallel fanout uses `runs.all(...)` inside the same script.

```js
subagent_workflow({ source: `
  const plan = await runs.run("plan", { label: "Plan migration behavior", agent: "scout", task: "Plan the migration" });
  const patch = await runs.run("patch", { label: "Implement migration behavior", agent: "worker", task: "Implement this plan:\n" + plan.output });
  return patch.output;
` });
```

### Host command steps

Use the named `run-ci` resource when a permission/policy extension needs to admit one supported non-interactive command as workflow evidence instead of a child-agent run:

```js
subagent_workflow({ workflow: "run-ci", args: { command: "npm test", timeoutMs: 120000 } });
```

The first named resource version supports only `npm test` and `npm run typecheck`, with bounded timeout values. Its resolved script uses `runs.host("ci", ...)` and the resource authority admits only the selected command. **There is no per-step `cwd` field:** the command and relative output path use the workflow cwd. The workflow tool takes no `cwd` parameter — the workflow cwd is the session directory — so to run the command in another directory, put a trusted directory change in the command itself (for example, `cd /path/to/dir && npm test`). The command has no stdin, receives the workflow cwd, and must be awaited or returned. Stdout, stderr, and the saved log are bounded. A nonzero exit, timeout, abort, or output-write failure fails the workflow. Async status and terminal receipts store the bounded host-step state; renderers do not run commands or read command output.

### Steering a workflow child

Use `await runs.steer(key, message, options?)` after `runs.run` or `runs.all` has launched that stable key. Scripts do not target raw run ids. The optional fields are `mode: "steer" | "follow_up" | "auto"`, a non-negative child `index`, and a positive `ackTimeoutMs`.

```js
subagent_workflow({ source: `
  const writer = runs.run("writer", { agent: "worker", task: "Implement the change" });
  const evidence = await runs.run("evidence", { agent: "scout", task: "Find the exact contract" });
  const receipt = await runs.steer("writer", "Also check: " + evidence.output, { mode: "follow_up" });
  return { writer: await writer, receipt };
` });
```

The receipt state is `queued`, `delivered`, `missed`, or `failed`. For an async child, `delivered` means it consumed the correlated user input; for a foreground child, it means the in-process Pi transport accepted the input. It does not mean the model followed it. `missed` means the keyed child became terminal or had no live route before delivery. This first slice uses the existing foreground and async steering transports but does not start steering recovery. Workflow traces include one steering attempt entry and one receipt entry.

Always await or return a `runs.steer` promise. The workflow waits for an observed steering side effect to settle before it exits and rejects fire-and-forget calls. Use ordinary `Promise.race` when the first child or steering receipt should advance the script. There is no callback API or child inbox access.

### Advanced rolling child runs

`runs.run` starts a keyed child when you call it. You do not need separate `runs.start`, `runs.next`, or `runs.collect` helpers for rolling councils or staged reviews. This is the advanced exception to ordinary `runs.all` fanout: keep launched promises only when the script later observes each one with direct `await`, `Promise.race`, or `Promise.all`. Use `Promise.race` to wait for the next completed child, steer a still-running sibling by its stable key, and use `Promise.all` to collect the remaining children.

```js
subagent_workflow({ source: `
  let pending = [
    { key: "analysis-a", promise: runs.run("analysis-a", { agent: "reviewer", task: "Analyze option A" }).then((result) => ({ key: "analysis-a", result })) },
    { key: "analysis-b", promise: runs.run("analysis-b", { agent: "reviewer", task: "Analyze option B" }).then((result) => ({ key: "analysis-b", result })) },
    { key: "critic", promise: runs.run("critic", { agent: "reviewer", task: "Find the strongest objection" }).then((result) => ({ key: "critic", result })) }
  ];

  const first = await Promise.race(pending.map((child) => child.promise));
  pending = pending.filter((child) => child.key !== first.key);

  const target = pending.find((child) => child.key === "critic") ?? pending[0];
  const receipt = await runs.steer(target.key, "Challenge this early result:\n" + first.result.output, { mode: "auto" });
  const rest = await Promise.all(pending.map((child) => child.promise));

  return { first: first.result.output, rest: rest.map((child) => child.result.output), receipt };
` });
```

The workflow trace records the run completions and steering receipt. Scripts still never see raw async directories, inbox paths, or session files. If the keyed child is terminal, stale, or has no live route when `runs.steer` runs, the receipt reports `missed` or `failed` and the script can decide whether to continue.

Use named outputs when later workflow steps need structured data or durable references:

```js
subagent_workflow({ source: `
  const inventory = await runs.run("inventory", {
    agent: "scout",
    task: "List the files that need review.",
    outputSchema: {
      type: "object",
      properties: { files: { type: "array", items: { type: "string" } } },
      required: ["files"],
      additionalProperties: false
    }
  });
  return runs.run("review", {
    agent: "reviewer",
    task: "Review these files: " + inventory.structuredOutput.files.join(", ")
  });
` });
```

For dynamic fanout, have one step return a structured list, check it in JavaScript, then map the bounded entries into `runs.all(...)`:

```js
subagent_workflow({ source: `
  const targets = await runs.run("targets", {
    agent: "scout",
    task: "Return up to five source files that need review.",
    outputSchema: {
      type: "object",
      properties: { files: { type: "array", items: { type: "string" }, maxItems: 5 } },
      required: ["files"],
      additionalProperties: false
    }
  });
  const files = targets.structuredOutput.files.slice(0, 5);
  return runs.all(files.map((file, index) => ({
    key: "review-" + index,
    agent: "reviewer",
    task: "Review " + file
  })));
` });
```

For intermediate data that only later steps need, prefer the prior child's returned output or `structuredOutput` instead of writing shared files:

```js
subagent_workflow({ source: `
  const scan = await runs.run("scan", { agent: "scout", task: "Find the files that need fixes." });
  return runs.run("fix", { agent: "worker", task: "Implement these findings:\n" + scan.output });
` });
```

`{chain_dir}` remains available inside scripted workflow step templates for legacy-compatible path templates. It expands to the workflow cwd, not to private temporary storage.

### Migrating old chain shapes

Legacy top-level `chain`, `tasks`, `parallel`, `chainDir`, `/chain`, `/parallel`, `/run-chain`, and durable `.chain.md` execution are no longer the public workflow API. Rewrite them as JavaScript:

```js
// Old shape, no longer supported:
// { chain: [{ agent: "scout", task: "Scan" }, { agent: "worker", task: "Fix from {previous}" }] }

// Current shape:
{ source: `
  const scan = await runs.run("scan", { agent: "scout", task: "Scan" });
  return runs.run("fix", { agent: "worker", task: "Fix from: " + scan.output });
` }
```

```js
// Old shape, no longer supported:
// { tasks: [{ agent: "reviewer", task: "Review API" }, { agent: "reviewer", task: "Review UI" }] }

// Current shape:
{ source: `
  return runs.all([
    { key: "api", agent: "reviewer", task: "Review API" },
    { key: "ui", agent: "reviewer", task: "Review UI" }
  ]);
` }
```

For long task text with Markdown fences or shell blocks, use quoted lines instead of a raw template literal:

````js
const task = [
  "Run this command:",
  "```bash",
  "npm test",
  "```"
].join("\n");
return runs.run("test", { agent: "worker", task });
````

A plain workflow creates one enclosing mission by default. Its children do not create separate missions. The result exposes the id as `details.missionId`, and human-readable output ends with `Mission: <id> (<status>)`. An ephemeral workflow — no mission for it or its children and no durable `state` global — is set up through the extension API, not from a call param.

### Repeatable workflows

Use stable child keys and keep process logic in ordinary JavaScript. `runs.run` launches one child, `runs.all` launches independent children together, and later steps can use each completed child's `output`. Put long task text in arrays joined with `"\n"` so Markdown fences do not conflict with the script string.

For a process you run often, save the task as a prompt template under `.pi/prompts/` or `~/.pi/agent/prompts/` and launch it with `/prompt-workflow`. The adapter compiles prompt steps into a workflow script, so templates describe the work instead of embedding raw `subagent` tool-call JSON. You can ask the parent agent to create or update these prompt files from a process described in natural language.

```md
---
description: Review a release candidate
subagent: reviewer
fresh: true
---
Review $@. Return concrete findings with source proof, or state that no issue was found.
```

For first-pass review prompts, filter by evidence rather than by severity. Ask the
reviewer to label concrete current findings P0/P1/P2 and end with `Merge verdict:
BLOCK`, `Merge verdict: OK`, or `Merge verdict: OK with notes`. Reserve
`blockers only` for final pre-merge re-checks after P1/P2 findings are already
known, or for explicit emergency hotfix tracks.

```text
/prompt-workflow review-release-candidate v0.51.0
```

For watched same-repo workflows, pass `async:false` only when the parent must block until completion. That blocking mode also shows the live in-chat workflow card; there is no per-call override of this policy. Blocking workflows default to a 30-minute timeout; async workflows have no default timeout. See the [tool reference](tool-reference.md) for the full parameter list.

Synchronous workflows publish trace and `emit(...)` updates through the tool update callback regardless of the live card, including RPC/headless and cross-repository runs. These updates include `details.workflow` and `details.workflowChildren`; the live card being off does not stop transport progress. Running foreground child rows additionally expose bounded `activity` (current tool, timing, and counters), plus resolved model/thinking when available, keyed by `childId`. Activity-only updates coalesce over 100 ms; lifecycle updates remain immediate. Activity clears when children settle, and is not persisted for async workflows. Tool names are limited to 256 UTF-8 bytes and each activity object is below 2 KiB (including JSON escaping); arguments and transcripts are not forwarded.

The legacy `/chain`, `/parallel`, and `/run-chain` commands are not registered.

## Direct commands

Use `/run <agent> [task] [--bg] [--fork]` for one child.

## Worktree isolation

Scripted workflows can give each writing child a separate managed git worktree by setting `worktree: true` on each `runs.run` / `runs.all` item:

```javascript
const [api, ui] = await runs.all([
  { key: "api", agent: "worker", task: "Implement the API", worktree: true },
  { key: "ui", agent: "worker", task: "Implement the UI", worktree: true }
]);
return { api: api.artifactPaths, ui: ui.artifactPaths };
```

Each child uses the existing worktree lifecycle: it branches from clean HEAD, journals ownership before launch, captures a patch and handoff manifest, then removes cleanly captured temporary worktrees and branches. The handoff manifest path remains available in the child's `artifactPaths`; return or emit it when the orchestrator needs to apply or inspect the patches. `runs.ref` stays concise and intentionally omits full paths.

A top-level `{ source, worktree: true }` makes isolation the default for every workflow child. An individual child can override that default with `worktree: false`. Keep one writer when parallel writes are not intentionally isolated.

Before a materialized `runs.run` or `runs.all` group dispatches fresh children, isolated sources must be Git repositories with clean working trees (excluding `.pi/subagents/` runtime state). A rejected group dispatches no children and spends no fan-out slots or child output claims; key-level failure traces can remain. Checks are shared only within that group, are cancellable, and run again at allocation because sources can change. Retained resumes keep their stored contracts. Select the correct cwd or arrange an operator-approved commit/stash; isolation is never dropped automatically.

Use `baseRef` to branch managed worktrees from `HEAD` or a supported named ref such as `refs/heads/release`, `refs/tags/v1`, or `origin/main`. Full 40/64-character commit IDs and revision expressions such as `HEAD~1` are unsupported. For example, `{ source, worktree: true, baseRef: "refs/heads/release" }` applies the release ref to children unless a child supplies its own `baseRef`. If omitted, the default `HEAD` is resolved at worktree allocation, not when the script is validated. The source checkout must still be clean, and the ref must resolve to a commit before any worktree is allocated.

Configure the worktree provider, native path layout, base directory, and setup hook in [configuration.md](configuration.md).

Setup waits remain nonblocking and cancellable. Normal cleanup, including detached foreground finalization, waits for the same in-process setup turn rather than retaining worktrees merely because another setup is active. This is not a cross-process lock. Hooks must follow the [finite setup contract](configuration.md#worktreesetuphook).

## Prompt-template integration

`pi-cciotti` includes a native prompt-workflow adapter for reusable subagent prompt templates, so you do not need `pi-prompt-template-model` for the common subagent workflow path.

Create a prompt in `.pi/prompts/` or `~/.pi/agent/prompts/`:

```md
---
description: Take a screenshot
model: claude-sonnet-4-20250514
subagent: browser-screenshoter
cwd: /tmp/screenshots
---
Use url in the prompt to take screenshot: $@
```

Then run it through the native adapter:

```text
/prompt-workflow take-screenshot https://example.com
```

The adapter delegates to the named subagent, applies `model`, `skill`, `cwd`, and fork/fresh context metadata, and supports runtime overrides such as `--subagent reviewer`, `--fork`, `--fresh`, and `--bg`.

Prompt templates with `chain:` frontmatter are translated into a workflow script and launched through `/prompt-workflow`; `/chain-prompts` is no longer registered.
