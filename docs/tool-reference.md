# Tool reference

Parameters and actions for the three model-facing tools: `subagent` (one child), `subagent_workflow` (a script or named resource), and `subagent_control` (run and registry verbs). These are what the LLM passes when it calls them; most users ask naturally or use slash commands instead.

`{ action: "guide" }` reads the packaged overview (this file is `tool-reference`); `subagent_control({ action: "guide", topic: "workflows" })` reads a specific topic — e.g. `workflows` for [workflow recipes](workflows.md), `agents` for authoring, or `missions` for missions. `/subagents-guide [topic]` is the slash equivalent. Guide reads do not change the schema or grant authority.

## Execution examples

Chaining is code-driven through a workflow script (`source`). Use `await runs.run(...)` for sequential steps and `await runs.all([{ key, agent, task }, ...])` for ordinary parallel fanout. `runs.all` resolves to an ordered array, not a key map, so use indexes, destructuring, or `.map(...)`, not `results.<key>`. Do not read `.output` from an unawaited `runs.run` launch. Stored `runs.run` promises are only for the advanced rolling fanout pattern under [Workflow steering](#workflow-steering), where every promise is later observed with direct `await`, `Promise.race`, or `Promise.all`. Legacy top-level `chain`, `tasks`, and `parallel` inputs are not supported. Helper functions must be plain functions or explicit Promise chains. Nested `async function` helpers, async arrows, and async methods are rejected so child-launch tracking stays portable across Node and Bun. For permission-sensitive host calls, use an extension-owned named resource such as `{ workflow: "run-ci", args: { command: "npm test" } }`; a raw public `source` script has unknown resource provenance and cannot call `runs.host`. A resolved resource may internally use `runs.host(key, { kind: "command", command, timeoutMs, output?, role?, provider? })` within its authority ceiling; there is no per-step `cwd`, and commands and relative output paths use the workflow `cwd`. Set `cwd` on the outer `subagent({...})` request instead, or put a trusted directory change in the command (for example, `cd /path/to/worktree && npm test`).

Every script is checked for statically decidable syntax and structure before any child starts. The result is `{ ok, errors }`, and a script that fails the check fails the tool call. Literal child `baseRef` values are checked against the runtime ref policy. Dynamic keys and values remain subject to runtime checks; static validation does not guess them.

Pass `source: { path }` instead of an inline `source` string to load the same JavaScript statement body from a file. The two shapes are mutually exclusive. Relative paths resolve against the request `cwd`, and absolute paths pass through. The host reads the file before validation or sandbox execution. The workflow sandbox still has no filesystem access. Missing, unreadable, and empty files fail as file input errors.

Raw inline and file-backed scripts accept bounded plain-JSON `args`. Omitted raw args become `{}`; supplied args are deeply frozen in the sandbox. Normalized args persist in run evidence for diagnosis and exact replay, so never include secrets. Args are data only and do not grant `runs.host` authority.

For permission-extension interoperability, use one of the package-owned named resources with bounded `args` instead of caller-supplied workflow text:

```js
{ workflow: "review", args: { task: "Review the auth flow" } }
{ workflow: "run-ci", args: { command: "npm test" } }
{ workflow: "perl", args: { task: "Implement the auth fix" } }
```

The host resolves the script and authority internally and records bounded provenance in workflow details and receipts. Named resources cannot be combined with `agent`, `task`, or `source`; user/project resource registries are not part of this first slice.

```js
{ source: { path: "workflows/review.js" }, args: { target: "src/workflows" }, cwd: "/path/to/project" }
```

```js
// One child; return the child promise explicitly
{ source: `return runs.run("main", { agent: "scout", task: "Analyze the auth flow" })` }

// Sequential workflow
{ source: `
  const scan = await runs.run("scan", { agent: "scout", task: "Analyze auth" });
  return (await runs.run("implement", { agent: "worker", task: "Implement from: " + scan.output })).output;
` }

// Parallel workflow
{ source: `
  const results = await runs.all([
    { key: "backend", agent: "reviewer", task: "Review backend" },
    { key: "frontend", agent: "reviewer", task: "Review frontend" }
  ]);
  return results.map(result => result.output);
` }
```

## Parameter reference

| Param | Type | Default | Available on | Description |
|-------|------|---------|--------------|-------------|
| `task` | string | agent default | `subagent_delegation` | The child's task. Required; `agent` names the agent that runs it. |
| `agent` | string | required for `subagent` | `subagent_delegation`, `subagent_control` | Named agent: the child to delegate to, or the agent to inspect with `get` / `models`. There is no default agent — name one (`subagent_control({ action: "list" })` prints the names). |
| `prequel` | string | - | `subagent_delegation` | Model-authored summary of the conversation that led here. Consumed when the agent resolves to `fork` or `summary` context; ignored for `fresh`. |
| `reads` | string[] | agent `defaultReads` | `subagent_delegation` | Plain list of file paths the child should read, composed with the agent's declared defaults. |
| `cwd` | string | runtime cwd | `subagent_delegation` | Override the child's working directory. |
| `workflow` | string | - | `subagent_workflow` | Package-owned named workflow resource (`review`, `run-ci`, `perl`) with bounded `args`. |
| `source` | string \| `{ path }` | - | `subagent_workflow` | Inline JavaScript statement body, or `{ path }` to load the same body from a file. Mutually exclusive with `workflow`. |
| `args` | object | `{}` | `subagent_workflow` | Bounded plain-JSON args for the script; deep-frozen for the script body. |
| `baseRef` | string | `HEAD` | `subagent_workflow` | `HEAD` or a supported named ref such as `refs/heads/release`, `refs/tags/v1`, or `origin/main`. Full 40/64-character commit IDs and revision expressions such as `HEAD~1` are unsupported. |
| `async` | boolean | background | `subagent_delegation`, `subagent_workflow` | Background execution. **An omitted `async` is background by default** — for delegation it resolves call param → the agent's `defaultAsync` → `asyncByDefault` (which is `true` unless config sets it `false`); workflows are background unless `async:false`. `async:false` blocks the parent until completion. A local foreground child runs inside the parent Pi process and never loads the parent's ambient extensions, but it does inherit the providers those extensions registered. Agents that need MCP tools (`mcpDirectTools`, or MCP tools from an ambient adapter such as pi-mcp-adapter) must run as background children, which load them inside the detached runner process. |
| `worktree` | boolean | - | `subagent_delegation`, `subagent_workflow` | Run the child in a managed Git worktree instead of the shared cwd. |
| `output` | string \| boolean | `true` | `subagent_delegation` | Bind durable child output: a path, or `false` to withhold it. |
| `action` | string | `status` | `subagent_control` | One of `status`, `resume`, `steer`, `stop`, `interrupt`, `list`, `get`, `models`, `guide`, `mission.create`. Anything else is rejected by the tool schema. |
| `id` | string | - | `subagent_control`, `bg_wait` | Run id or id prefix for run-targeting actions. |
| `message` | string | - | `subagent_control` | Guidance for `steer`, follow-up text for `resume`. |
| `topic` | string | `overview` | `subagent_control` | Guide topic for `action: "guide"`. Omit to read the overview. |
| `mission` | object \| boolean | - | `subagent_control` | Mission record for `action: "mission.create"`: exactly one non-empty `title` or `summary`, optional `objective` and `labels`; `goal: true` requires `budget.tokens`. `false` disables an automatic mission on the internal contract only and is invalid here. |

Options that shape a child's runtime (tool budgets, deadlines, attention
thresholds, output truncation, model and context policy) are **not** per-call
params. They come from the agent definition and from
[configuration.md](configuration.md); see
[workflows.md](workflows.md) for what a workflow step can still set.

### Budget guidance for writers

As a conservative orchestration policy, do not set a hard `toolBudget` on implementation workers, fix workers, reviewers with edit authority, or other mutation-capable children. A default tool budget blocks read/search tools rather than mutation tools, , so tool-call counts and token/cost totals by themselves do not measure whether a delivery slice is buildable or safe to hand off. Hard caps remain appropriate for explicitly read-only scouts, reviewers, and validators.

Bound writer work with a narrow task and an outer `timeoutMs` or `maxRuntimeMs` that leaves enough margin for the slice. An elapsed timeout is not a mutation-safe boundary and may still signal a child during tool work. Request a checkpoint after the current tool returns that records changed files, build/test state, and commit or PR state; for async single-agent runs, set `checkpointBeforeDeadlineMs`, otherwise steer by hand.

### Fork context details

A strictly forked launch fails fast when the parent session is not persisted, the current leaf is missing, or the branched child session cannot be created. By contrast, an agent-level `defaultContext: fork` is a preference: when the parent has no persisted session file or current leaf yet, the launch uses `fresh` immediately instead of failing and requiring a retry. Explicit `context: "fresh"` always wins over agent defaults.

When the inherited transcript contains signed Anthropic `thinking` / `redacted_thinking` blocks, `pi-subagents` strips those provider-private blocks from the forked child session: a thinking signature is bound to the session that produced it and cannot be replayed into a branch. The child keeps its requested thinking level and reasons fresh from its first turn; sanitizing the inherited transcript is not a downgrade. Explicit `context: "fork"` never silently downgrades to `fresh`.

Each `runs.run` child follows its own agent's `defaultContext`, with `fresh` when the agent declares none. A fresh-default scout can run fresh beside a fork-default custom agent. If the parent session file or current leaf is not available yet, implicit fork-default or summary-default children run fresh. Pass explicit `context: "fork"` or `context: "fresh"` when you intentionally want one context for every child.

### Workflow steering

`runs.steer(key, message, options?)` targets a stable key already launched by `runs.run` or `runs.all`. It does not accept a raw run id. Options are `mode?: "steer" | "follow_up" | "auto"`, `index?: number`, and `ackTimeoutMs?: number`. The promise returns `{ key, state, requestId?, deliveryStatus?, targets?, error? }`, where `state` is `queued`, `delivered`, `missed`, or `failed`.

The workflow trace records the attempt and receipt. Always await, return, or include the promise in an awaited standard Promise combinator. Unawaited steering calls reject workflow completion after the side effect settles. `Promise.race` remains the rolling primitive. Foreground children are steered through their in-process session (`steer` and `auto` report `delivered` when that transport accepts the input; `follow_up` reports `queued` when accepted into Pi's queue). Async children use the file control inbox and report correlated consumption by the child, not merely inbox acceptance. Steering recovery is disabled in both cases.

For advanced rolling fanout, keep the launched `runs.run` promises in ordinary JavaScript data only when every promise is later observed with direct `await`, `Promise.race`, or `Promise.all`. `Promise.race` gives the next completed child, `runs.steer` can challenge a still-running keyed sibling, and `Promise.all` collects the rest. No separate `runs.start`, `runs.next`, or `runs.collect` API is exposed.

```js
{ source: `
  let pending = [
    { key: "writer", promise: runs.run("writer", { agent: "worker", task: "Draft the fix" }).then((result) => ({ key: "writer", result })) },
    { key: "reviewer", promise: runs.run("reviewer", { agent: "reviewer", task: "Review likely risks" }).then((result) => ({ key: "reviewer", result })) }
  ];
  const first = await Promise.race(pending.map((child) => child.promise));
  pending = pending.filter((child) => child.key !== first.key);
  const target = pending[0];
  const receipt = await runs.steer(target.key, "Use this early review:\n" + first.result.output, { mode: "auto" });
  const rest = await Promise.all(pending.map((child) => child.promise));
  return { first: first.key, rest: rest.map((child) => child.key), receipt };
` }
```

### Output mode details

Use `outputMode: "file-only"` when a saved output may be large and the parent only needs a pointer. The returned text is a compact reference like `Output saved to: /abs/report.md (48.2 KB, 2847 lines). Read this file if needed.` Failed runs and save errors still return normal inline output for debugging.

In a workflow script, give each child an explicit output path when later script steps need a durable file reference. A child with only read-only tools does not need direct filesystem access for `output`: it returns the complete artifact in its final response and the runtime persists it. Children with mutation-capable tools retain the direct-write instruction.

The `output` field is the API binding; a filename mentioned in task text (for example, `Write your findings to exactly this path: report.md`) is only instruction and does not override runtime routing. When a later workflow step or parent needs a durable file, set `output` on `runs.run`/`runs.all` and return the child’s `outputReference`, `outputPathMapping`, or `artifactPaths`; arbitrary literal strings returned by workflow JavaScript are not rewritten. Omitted child output may use a managed aggregate-derived sibling path.

Workflows get `await state.get(key)` and `await state.set(key, value)` through their default or explicit mission. Use them to share durable JSON values across later runs that share the mission. Each `set` takes the state-file lock and merges its key with the latest on-disk state. Missing keys return `undefined`, and the complete state file has a strict 256 KiB limit. `mission:false` workflows have no `state` global.

### Retained children

Completed workflow children from the current parent session stay addressable as retained children. Address them by the `runId` each `runs.run` result returned. Resume only rows reported `resumable`; if no row is resumable, start a same-role fallback challenge and label it as fallback. A later workflow continues a resumable child by passing `resume` instead of `agent`:

```js
{ source: `
  let writer = await runs.run("implement", { agent: "worker", task: "Implement the accepted contract" });
  for (const pass of [1, 2]) {
    if (!writer.runId) throw new Error("writer did not return a retained run id");
    writer = await runs.run("followup-" + pass, { resume: writer.runId, task: "Revisit pass " + pass + ": " + writer.output });
  }
  return writer;
` }
```

Each workflow key identifies one workflow child. Use a new stable workflow key for every distinct retained resume pass; same-key calls are reused only when launch parameters are identical, and incompatible parameters are rejected.

Inside the script, `await runs.run(key, { resume, task })` waits for the revived child to finish and returns its completed output and new `runId`. Each resume can return a new retained run id, so loops must continue from the latest returned `runId`. Top-level `{ action: "resume" }` remains detached and returns a background-run receipt.

For a simple implementation challenge outside a workflow script, send the challenge through `subagent_control({ action: "resume", id: "<retained-writer-run>", message: "Reconsider the implementation and make any better current-scope change." })` only when that writer's `runs.run` result reported a resumable `runId`. If no retained writer is resumable, start a same-role fallback challenge and record why it is a fallback. Use workflow `runs.run({ resume })` only when the script must await the revived writer output before the next step. Do not use `steer` as the sole challenge action for a completed retained child; a follow-up steer only queues text for the next `resume`.

`resume` and `agent` are mutually exclusive. The revived child keeps its stored agent, model, and tool contract. `gate` is rejected on retained resume items because resume uses the retained child contract.

## Management actions

### Guide

`{ action: "guide" }` reads the packaged `README.md` from the installed version; `subagent_control({ action: "guide", topic: "workflows" })` reads one specific topic at a time — the packaged `docs/<topic>.md`. Valid topics are `overview`, `workflows`, `agents`, `missions`, `observability`, `tool-reference`, `configuration`, `models`, and `extension-api`. Unknown topics list the valid values and do not change files. `/subagents-guide [topic]` is the slash equivalent.

Agent definitions are not loaded into context by default. The read verbs let the LLM discover and inspect the agent registry at runtime; agent files and overrides are edited in `~/.pi/agent/` or `.pi/`, not by the model. An unknown action returns safe next steps (`status` and `list`) and may suggest a close read-only action.

```ts
{ action: "list" }
{ action: "models" }
{ action: "models", agent: "reviewer" }
{ action: "get", agent: "reviewer" }
```

`list` prints one line per discovered agent. `models` prints the provider/model ids and which agents resolve to them; with `agent` it narrows to that agent's effective model, thinking level, and where the value came from. `get` prints one agent's full field set. Scope selection and the capability rows (`runner.available`, ceiling sources, and the rest) belong to the `/subagents` admin surface, not to a call param.

### Opening a mission

```ts
{ action: "mission.create", mission: { title: "Ship the facade release", objective: "Land D10, docs, and a green suite", labels: ["release"] } }
```

`mission.create` writes one durable mission record and returns its id; see [missions.md](missions.md). A workflow run creates its enclosing mission automatically, so reach for this verb only when the mission needs an authored title, objective, or budget before the work starts. Registry writes (create/update/delete/enable/disable/reset) are not on the model surface; agent files and `/subagents` are the authoring routes.

### Refinement overlays

`/subagents-refine <agent>` manages the project-local refinement overlay for one agent; see [agents.md](agents.md#refinement-overlays) for behavior and storage.

## Status and control actions

### Execution-mode boundaries after failures

A failure in the subagent workflow, child launch, prompt runtime, extension loading, or child tooling setup is a workflow infrastructure blocker, not permission to silently change execution mode. Stop and report the exact failure, run/status, and repo/cwd/worktree/branch/ref state. Before a same-protocol retry or asking the owner, verify the worktree is clean or capture the partial diff. Retry or fix the `subagent` path only through a clear same-protocol action.

For other subagent-governed workflows, external/foreground/CLI fallback requires explicit owner approval. Do not silently switch to `interactive_shell`, `pi -ne`, Codex/Claude/Cursor CLI, a foreground agent, or another external mode. `interactive_shell` remains valid when the user explicitly requests visible foreground/CLI work or the task is outside the governed subagent protocol. Pi core may print a generic `pi -ne` extension-load hint; that out-of-repo hint is not protocol-approved fallback. A verified compaction abort may continue the retained child once on its already resolved model; it never selects another model.

```ts
subagent_control({ action: "status" })
subagent_control({ action: "status", id: "<run-id>" })
subagent_control({ action: "status", id: "<nested-run-id>" })
subagent_control({ action: "interrupt", id: "<run-id>" })
subagent_control({ action: "interrupt", id: "<nested-run-id>" })
subagent_control({ action: "stop", id: "<run-id>" })
subagent_control({ action: "resume", id: "<run-id>", message: "follow-up question after it pauses or finishes" })
subagent_control({ action: "resume", id: "<nested-run-id>", message: "follow-up for a nested child" })
subagent_control({ action: "steer", id: "<run-id>", message: "guidance for the running child" })
```

### status

`status` resolves exact foreground ids, top-level async ids, and nested run ids before falling back to prefix matching.

- The read-only fleet overview and transcript tails belong to the `/subagents` slash command and the RPC surfaces, not to a tool call; bare `status` lists the active async runs and armed wait subscriptions, and an id returns that run's status with its output and session paths.
- Nested status shows the root/parent path, nested children, session/artifact paths when known, and nested control commands.
- Inside child-safe fanout mode, bare `status` requires an id when no local foreground run is active, so children cannot enumerate unrelated top-level async runs.
- Bare `interrupt` still targets only the visible top-level run; interrupting a nested run requires its explicit nested id.

### resume

`resume` revives a paused, completed, or failed async/foreground child by starting a new child from its stored session file. Stopped runs remain non-resumable, and it does not interrupt a live top-level async child. Use `steer` for acknowledged live async guidance.

- A single-child run revives by run id. Picking one child of several is not addressable from the model surface — the call fails closed naming the child count — while workflow children carry their own run ids in status output and revive by them.
- Nested runs can be resumed by nested id when their live route or persisted nested session metadata is available.
- Completed external-job runs can use the same `resume` action as a provider follow-up when the registered provider exposes `followUp(input)`. Running external-job parents fail closed with guidance to wait for completion. Unsupported providers fail with an update/reload message.
- Revive starts a new child session from the old session context; it does not resume the live session, and it requires the chosen child to have a persisted `.jsonl` session file.
- Direct revival takes an exclusive cross-process lease on the canonical session file until the new child finishes. A concurrent attempt fails before Pi is spawned and identifies the owning revived run; dead-owner leases are reclaimed only when staleness can be proved.

### stop

`stop` ends a current-session top-level async run. It is deliberately stronger than `interrupt`:

- It is not a resumable pause; stopped runs should be restarted as new runs.
- Foreground and nested targets are rejected.
- Direct id calls execute immediately.
- `/subagents-stop` without an id opens a selector with confirmation when a TUI is available. Use `↑`/`↓` or `j`/`k` to move through the selector.
- In non-TUI contexts the slash command prints exact `subagent_control({ action: "stop", id })` and `/subagents-stop <id>` commands.
- Pass a child id to stop one child of a multi-child async run or workflow while the rest continue: `/subagents-stop <run-id> <child-id>`. Child ids come from status output, the async status snapshot, or `/subagents-inspect-rpc` replies. Only pending or running children are stoppable; the request is rejected for anything else instead of widening to a run-level stop.

### steer

`steer` waits up to three seconds for a correlated receipt and returns a request id with `delivered`, `scheduled`, `pending`, `partial`, `recovered`, or `failed` plus per-child states. The receipt also has `deliveryStatus: "delivered" | "queued"`. For async runs, delivery means the child consumed the correlated user input; foreground delivery means the in-process Pi transport accepted it. Neither means model compliance. A pending indexed child returns `scheduled`.

Tool calls steer in the default direct mode; the follow-up and auto delivery modes belong to the script and slash/RPC surfaces. A follow-up waits for the next turn boundary. Auto uses the same native steer delivery path as direct steering, without automatic pause-and-revive recovery after a missed acknowledgment. The retained revival-brief queue holds 20 messages and returns a clear error when full; this is not a live follow-up queue bound. A live follow-up acknowledgment reports queue acceptance, not consumption. Async runs later record correlated consumption or fail unconsumed requests at settlement; foreground follow-ups have no later correlated receipt. A follow-up sent to a completed retained workflow child becomes the first brief for its next `resume`; it does not revive the child by itself.

Only a top-level single run may interrupt after the acknowledgment deadline and recover after a further 15-second pause/revival bound; durable multi-child and nested runs never auto-interrupt. Recovery launches a replacement only after the source is confirmed paused, a valid persisted session exists, and deadline, turn, and tool budgets remain. It preserves the original child contract and remaining limits; otherwise the source stays paused with an explicit failure. Late acceptance is recorded but cannot cancel committed recovery.

The persisted `steering` ledger retains 20 requests and replaces the old `steerCount`/`lastSteerAt` fields.

The `/subagents-steer <run-id> [--child <child-id>] <message>` slash command is the host bridge for non-TUI sessions and RPC hosts. `--child` accepts the stable child identity shown in status output and inspect replies (workflow key, child run id, or `step:<index>`) and resolves it to the child index before steering; unknown or ambiguous child ids fail closed. Flags are parsed only between the run id and the message tail — once the message starts, `--` tokens are message text. The bridge always disables pause-and-revive recovery, matching the extension RPC `nonRecoveringSteer` guarantee so the caller keeps authority over the exact child it addressed.

## `bg_wait`

`bg_wait` waits for background work that has no native completion notification and returns its result in the same turn. The tool description carries only the purpose and the policy; the wait modes are here, reached by `subagent_control({ action: "guide", topic: "tool-reference" })`. Configuration semantics for `waitTool.enabled` and `waitTool.defaultTimeoutMs` are in [`waitTool`](configuration.md#waittool).

**When not to call it.** Ordinary async subagent runs notify this session natively when they complete or need attention, so a child being active is not a reason to wait on it — return control and let the notification wake you. Call `bg_wait` for provider jobs, remembered detached foreground runs, and other background work with no native notification path, or when this turn genuinely cannot finish without the result. Headless runs auto-drain current-session subagent work at `agent_end`, so detached children are not abandoned even with no wait call.

```ts
bg_wait({})                                  // return when the first initially active async run or registered provider item finishes, or when a subagent needs attention
bg_wait({ all: true })                       // wait for every async run, provider item, and remembered detached foreground descendant active when the call began
bg_wait({ id: "run-prefix" })                // wait for one run by id or prefix; an already-finished named run returns its stored terminal result references
bg_wait({ id: "run-prefix", nonBlocking: true }) // subscribe once and return immediately
bg_wait({ stopOnAttention: false })          // keep waiting through idle or long-thinking attention
bg_wait({ timeoutMs: 600000 })               // stop waiting after N ms; the work keeps running
```

- **Blocking window.** `timeoutMs` falls back to `waitTool.defaultTimeoutMs`, then 30 minutes. Window expiry is not an error: the call returns a non-error `window_elapsed` result naming the work still active, and that work keeps running. Wait again or inspect status rather than treating expiry as failure.
- **Attention.** A blocking wait stops when a run needs attention (`activityState: "needs_attention"` on the run or one of its steps). `stopOnAttention: false` keeps waiting through idle or long-thinking attention, which is what a run-to-completion flow wants.
- **Non-blocking subscriptions.** `nonBlocking: true` resolves the id to one exact run, persists a wake subscription, and returns a token immediately. The originating session is woken on completion, failure, attention, reconciliation failure, or timeout. It requires `id`, cannot combine with `all`, and needs a long-lived interactive runtime — a blocking-only runtime returns an error instead of subscribing. Armed subscriptions appear in `subagent_control({ action: "status" })` output and are not counted as active child work.
- **A subscription is not `enabled: false`.** `waitTool.enabled=false` makes direct calls return immediately without registering any future wake; a non-blocking subscription is a durable wake contract.
- **Provider items.** They are session-scoped and identified exactly, so replacing one job with another cannot hide a completion. Provider extensions must be explicitly loaded in this process — `bg_wait` never loads providers or grants tools. In a child agent, keep `bg_wait` in the child's tool allowlist and load each provider through the agent's `extensions` or `subagentOnlyExtensions`.
- **Inside a child runtime.** A child does not install the root session's native completion notifier, so a child with `bg_wait` allowlisted uses a blocking wait to collect its own descendants during its turn, then reads the returned result references before synthesizing. Automatic draining at `agent_end` keeps owned work alive but does not synthesize its results.

## Acceptance gates

Every run resolves an effective acceptance policy. Callers may omit `acceptance` for the inferred default, or set it on single runs, top-level parallel task items, chain steps, static parallel tasks, and dynamic fanout templates.

Checked writers reject staged files by default. When a parent intentionally starts a single writer with reviewed staged content, opt in with `acceptance: { level: "checked", preserveStagedIndex: true }`. The host captures the repository-wide index tree immediately before each launch (including each retained resume) and accepts only if `git write-tree` produces the same tree at completion. Working-tree-only fixes are allowed; child-created staging is rejected. Capture or terminal Git failures, including an unavailable or unmerged index, fail closed. This option does not stage or restore files and should not be used for concurrent writers sharing one worktree.

Prefer an inline JSON object. JSON-encoded object strings are tolerated only during input normalization; invalid strings fail closed. `true` is invalid. Supported evidence kinds are `changed-files`, `tests-added`, `commands-run`, `validation-output`, `residual-risks`, `no-staged-files`, `diff-summary`, `review-findings`, and `manual-notes`. For example: `{level:"checked",evidence:["commands-run","changed-files"],review:{required:true}}`. Evidence levels end at `verified`; independent review is a separate gate, not a stronger evidence level.

```ts
{
  agent: "worker",
  task: "Implement the fix",
  acceptance: {
    level: "verified",
    criteria: ["Patch the bug without widening scope"],
    evidence: ["changed-files", "tests-added", "commands-run", "residual-risks", "no-staged-files"],
    verify: [{ id: "focused", command: "npm test", timeoutMs: 120000 }]
  }
}
```

### One-command gates

When one host-run command is the entire verification contract, use the `gate` shorthand instead of a full `acceptance` object:

```js
{ source: `return runs.run("impl", { agent: "worker", task: "Implement the fix", gate: "npm test" })` }
```

`gate` normalizes to verified acceptance with that single command, so the runtime executes it on the host and records the result as evidence. Verification results are memoized per tracked workspace state and effective environment, so an unchanged tree does not rerun the same command. Use explicit `acceptance.verify` when you need multiple commands, timeouts, or custom criteria. `gate` rejects `acceptance` except `false` (treated as omitted), and rejects retained `resume` items. With `worktree: true`, the gate runs inside the child's managed worktree.

### Levels and inference

Acceptance evidence levels are `auto`, `none`, `attested`, `checked`, and `verified`. `acceptance: "auto"` is the default.

Review is a separate gate configured with `acceptance.review`:

- Async, risky, and dynamic writer contexts infer checked evidence plus `review: { agent: "reviewer", required: true }`.
- Tasks classified as read-only infer no acceptance by default, including reviews of release, migration, or security work; those topics do not turn a read-only task into implementation. With role metadata omitted, unknown risk-topic tasks retain their gate even when the agent name suggests a reviewer. Explicit acceptance requests still apply.
- Normal writer tasks infer checked evidence without review.

Agent frontmatter or `subagents.agentOverrides` may set `acceptanceRole: "read-only" | "writer"` for ambiguous tasks. Explicit task mutation or no-edit intent wins over that role, while omitted metadata preserves the existing reviewer/scout/worker name heuristics. The role affects acceptance inference only and does not change tool access.

Edge cases:

- The bare string `"none"` is rejected; use `{ level: "none", reason: "..." }` instead.
- `acceptance: false` is accepted only as a deprecated shorthand for disabling gates.
- For reviewer/read-only calls, omit `acceptance`.
- The explicit value `"reviewed"` is not a policy level: it remains schema-recognized only so semantic preflight can explain the mistake without spawning a child. To require review of a writer result, use `acceptance: { level: "checked", review: { required: true, agent: "reviewer" } }` and orchestrate the reviewer separately.
- With `agentContract: { version: 1 }`, omitted, `"auto"`, and `false` mean no acceptance request for that run; explicit acceptance is reported separately from execution.

### Evidence status

Acceptance provenance is stored separately from child prose. `evidenceStatus` preserves evidence progress when the overall status is waiting on or has completed review:

- `claimed`: child finished but did not provide structured evidence.
- `attested`: child returned a structured acceptance report.
- `checked`: runtime structural checks passed, such as required evidence and no staged files.
- `verified`: configured runtime verification commands passed. Child-reported command success does not count.
- `review-required`: required evidence passed, but no independent reviewer result has been supplied.
- `reviewed`: an independent reviewer result is present and has no blockers.
- `rejected`: attestation, structural checks, verification, or review failed.

### The acceptance report

For `attested` or stricter levels, the child prompt includes a standardized acceptance section and asks for a fenced `acceptance-report` JSON block. Reviewer/read-only inference resolves to `none`, so it does not add this section; explicit acceptance still does. With `outputSchema`, set `acceptance.report: "on"` to require the same report in the final `structured_output` call, or `"off"` to keep the fenced-report path. Omitting `report` preserves the default behavior. Runs without `outputSchema` never gain a standalone structured-output tool from this option.

The parser canonicalizes known enum synonyms, snake_case report keys and wrappers, underscore fence tags, unambiguous scalar arrays, string booleans, and criterion-id separators. Unknown or ambiguous keys and enum values fail with field-level diagnostics. Explicit empty `changedFiles` and `testsAddedOrUpdated` arrays are recorded as not applicable; missing fields and empty required command or validation evidence still fail.

Acceptance fences are removed from normal output artifacts, while the raw child transcript remains intact and per-child metadata stores the complete acceptance ledger and parsed report. Explicit failed gates fail the run. Inferred gates remain observable without failing the run.

## Orca progress tabs (experimental observer)

Orca progress tabs are a global, opt-in observer, not an agent runner. Enable them in the extension config:

```json
{ "orcaProgressTabs": { "enabled": true } }
```

Foreground and background children keep running through their normal native Pi or `external-cli` path. For each top-level subagent call, the observer asks Orca to create one background terminal tab in the owning worktree and mirrors progress into it. Parallel and chain children share that tab and are separated by child headers. Titles receive a persistent worktree-local sequence number, including across separate workflow calls. Creates for the same worktree are serialized in that sequence so tabs appear to the right in order (`1`, then `2`, then `3`) instead of racing. Model/startup retries reuse the same observer. Attaching an already-running async root does not create a duplicate child tab. Terminal control sequences are removed at the viewer sink across read boundaries. Each mirror is capped at 1 MiB and truncates when the cap or stream backpressure is reached. After the run finishes, its viewer returns to the terminal shell instead of ending the terminal session, so the tab and scrollback remain until the user closes them. Successful native Pi runs with a known session append a safely quoted removal command for the exact verified session path; unsuccessful and sessionless runs append only their terminal status.

The observer supports macOS and Linux and is disabled on Windows. It requires executable `orca` on `PATH` (or `PI_SUBAGENT_ORCA_BINARY`) and a running Orca runtime that recognizes the cwd. Availability and tab creation are best-effort: failures never fail, stop, or delay the subagent. When possible, the observer writes a passive manifest under `<worktree>/.pi/subagents/views/orca/`; the manifest is display metadata only, not a lifecycle or control source. Set `orcaProgressTabs.enabled` to `false` to guarantee that no Orca command or tab is created.

Agent profile `runner.type` supports native Pi (the default), `external-cli`, and `external-job`. Orca is intentionally not a profile runner and does not own subagent execution, completion, cancellation, artifacts, or result delivery. External-job providers can optionally expose `followUp(input)` so a completed provider job can continue its parent conversation through `subagent_control({ action: "resume", id: "<run>", message: "..." })`.

## External CLI agent profiles

Agent profiles can opt into a local one-shot command instead of a Pi child. External runners add no install dependency, but the configured executable must exist at runtime. They are async-only, receive one combined system/task prompt over stdin, and use argv arrays without a shell:

```yaml
runner:
  type: external-cli
  command: node
  args: ["./scripts/local-reviewer.mjs"]
  promptDelivery: stdin
async: true
```

Supported: status artifacts, stdout/stderr logs, timeout, and stop. Full stdout and stderr are written to log files, while the in-memory final stdout response and stderr error are limited to their last 64 KiB.

Intentionally unsupported: native Pi child options such as model override, structured output, acceptance/agent contract, tool budgets, fast mode, fork context, skills, or native Pi tools unless the runner explicitly implements them. Foreground/clarify, steer/resume/interrupt-as-pause, and nested subagents are also unsupported.
