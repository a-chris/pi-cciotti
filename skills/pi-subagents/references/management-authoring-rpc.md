# Pi Subagents: Management Authoring Rpc

This file is a detailed reference loaded from `skills/pi-subagents/SKILL.md`.

## The model-facing surface

Three tools split one job each: `subagent` runs one child, `subagent_workflow` runs a script or
named resource, and `subagent_control` carries the run and registry verbs. The verbs you can use
here are `status`, `resume`, `steer`, `stop`, `interrupt`, `list`, `get`, `models`, `guide`, and
`mission.create`; anything else is rejected by the tool schema before the executor sees it, so do
not invent control verbs. There is no script-lint verb: `source` lives on `subagent_workflow`, and
running a script reports the same syntax and budget errors before any child launches.

### Reading the registry

```typescript
subagent_control({ action: "list" })                      // discovered agents, one row each
subagent_control({ action: "models" })                    // provider/model ids, and which agents resolve to them
subagent_control({ action: "models", agent: "reviewer" }) // one agent's effective model and its source
subagent_control({ action: "get", agent: "reviewer" })    // one agent's full field set
```

Run `models` before choosing a `model` for a child or an agent. `list` reports the discovered
registry one line per agent and accepts no narrowing argument. `get` and `models` take the agent
name; an unknown name returns the available names rather than a guess.

Registry writes stay off the model surface. To change an agent, edit its file; to change
metadata interactively, use `/subagents`. Agent files are the authoring surface — see [Authoring
agents by file](#authoring-agents-by-file).

A workflow run creates its enclosing mission automatically; `mission.create` with a `mission`
object is the route when the mission needs an authored title, objective, labels, or budget first
— `subagent_control({ action: "mission.create", mission: { title: "Harden the parser", objective:
"Close the fuzz findings" } })`. Read the `missions` guide topic (`subagent_control({ action:
"guide", topic: "missions" })`) for the record layout and goal budgets.

### Retained children

Completed workflow children from this parent session stay addressable as retained children. Each
`runs.run`/`runs.all` result carries that child's `runId`; there is no listing verb on the model
surface, so capture the id from the result you already have.

Resume a completed child with `subagent_control({ action: "resume", id: "<run-id>", message: "..." })`,
or continue it inside a workflow with `runs.run(key, { resume: "<run-id>", task: "follow-up" })`.
Each workflow key identifies one workflow child, so use a new stable workflow key for every distinct
retained resume pass; same-key calls are reused only when launch parameters are identical, and
incompatible parameters are rejected. Every resume can return a new `runId`, so assign the result
back to your loop variable and always resume the latest returned id. The revived child keeps its
stored agent, model, and tool contract, and `resume` is mutually exclusive with `agent`.

A child is resumable only while its persisted session file still exists. Treat an `unavailable` or
`not resumable` resume failure as the signal to start a same-role fallback challenge, and label it as
fallback. Use `resume` rather than `steer` when the child has already completed.

### Refinement overlays

`/subagents-refine <agent>` builds a bounded project-local guidance overlay for one agent from recent
run evidence, using a fresh read-only proposal child. Validated guidance is stored under
`.pi/subagents/refinements/<agent>.md` with revision snapshots and is injected into that agent's child
system prompt for this project. Guidance that tries to override safety, policy, tool, output,
acceptance, developer, or system instructions is rejected.

## Authoring agents by file

Agents are created and edited as files: user scope `~/.pi/agent/agents/**/*.md`, project scope
`.pi/agents/**/*.md` in a standard Pi project. For a small change such as a model swap, prefer a
builtin override under `subagents.agentOverrides` in the user or project settings file instead of
copying a whole agent file.

A minimal agent file looks like this:

```markdown
---
name: my-agent
package: code-analysis
description: What this agent does
advertise: false
aliases: developer, coder
model: provider/model-id
thinking: high
tools: read, grep, find, ls, bash
systemPromptMode: replace
inheritProjectContext: true
inheritGlobalContext: false
inheritSkills: false
skills: safe-bash, review-checklist
skillPath: ./skills, ../shared-skills
---

Your system prompt here.
```

That is only a starting point. Omit `package` for the traditional unqualified runtime name; when you
set it, the runtime name is `{package}.{name}`. `advertise` defaults to true, so an agent's name and
description reach the parent prompt unless you set `advertise: false` to hold it back - opt out of
agents the parent should not see, rather than opting each one in. A `disabled: true` override hides
an agent from discovery without deleting it, and removing the override or the file restores the
bundled default. Common optional fields include:

- `defaultProgress`
- `defaultReads`
- `output`
- `aliases`
- `subagentOnlyExtensions`
- `skills`
- `skillPath`
- `memory`
- `acceptance`
- `acceptanceRole`
- `async` — single-agent default for background launch (`true`/`false`); explicit tool-call `async` wins
- `timeoutMs` — single-agent default run-level max runtime in ms; foreground calls use a 30-minute package default only when neither the call nor agent provides one (tool alias `maxRuntimeMs` is also accepted)

`aliases` is an optional comma-separated or block-list set of alternate names for selecting an agent.
Aliases resolve to the canonical `name` for execution, status, persistence, and config. Exact
canonical names take precedence over aliases, and alias collisions between distinct canonical agents
fail as ambiguous.

`acceptance` is a single-agent launch default. Use a scalar level such as `checked` or an inline/block
YAML map such as `{ level: "none", reason: "lightweight lookup" }`. An explicit tool-call value wins;
scripted workflow child acceptance remains configured on the `runs.run` or `runs.all` item. An empty
string clears the frontmatter default (`false` remains the deprecated disabled-policy shorthand).

`acceptanceRole` is `read-only` or `writer` and controls automatic acceptance inference only. Explicit
task mutation or no-edit intent wins; otherwise the role replaces agent-name guessing. Omission
preserves the current name heuristics. The field does not grant or revoke tools.

`tools` is a strict child allowlist, not an extension loader. For a named extension tool, keep its
registered name in `tools` and load its provider through normal Pi discovery, `extensions`, a
path-like `tools` entry, or `subagentOnlyExtensions`. For example, pair `tools: read, fixture_search`
with `subagentOnlyExtensions: ./tools/fixture-search.ts` when the provider should exist only in that
agent's child sessions. The child now fails with the unavailable names and provider-loading guidance
instead of silently continuing when a requested tool is absent; internal `structured_output` is
allowed automatically when an output schema requires it.

`skillPath` adds invocation-private skill files or discovery directories relative to the agent file;
it does not select them, so list the desired names under `skills`. Local matches win, unresolved or
unreadable matches use normal discovery, and local candidates never enter the parent/global catalog.
Use `memory: { scope: "project" | "user", path: "<name>" }` for opt-in role-specific durable memory
under the dedicated `agent-memory/` namespace; it is separate from parent/session project memory.

## Prompt Template Integration

The package includes prompt shortcuts for common workflows: `/parallel-review`,
`/review-loop`, `/parallel-research`, `/gather-context-and-clarify`, and
`/parallel-cleanup`. Use them when the user wants repeatable review,
review/fix loops, research, context handoff, implementation handoff,
clarification, or cleanup-review patterns. `/parallel-review autofix` and
`/parallel-cleanup autofix` synthesize reviewer feedback and then apply only the
fixes worth doing now. Parent agents can also apply the same recipes directly
with `subagent_workflow(...)` when the user describes the workflow in natural
language instead of invoking a slash command.

Additional user prompt templates can delegate into `pi-subagents` through the native `/prompt-workflow` command. This is useful when a slash command should always run through a particular agent or with forked context. Prompt frontmatter can set `subagent`, `model`, `skill`, `cwd`, `fresh`, `fork`, or `inheritContext` for the native adapter.

## Extension RPC

Other Pi extensions can call `pi-subagents` through the in-process event bus. The RPC channels are `subagents:rpc:v1:ready`, `subagents:rpc:v1:request`, and per-request replies at `subagents:rpc:v1:reply:<requestId>`. Envelopes use `{ version: 1, requestId, method, params }`, and replies use `{ version: 1, requestId, success, data | error }`. `ping` advertises the exact process-local async completion event as `events.asyncComplete` for RPC-spawn consumers.

Methods: `ping`, `status`, `spawn`, `steer`, `interrupt`, `resume`, and `stop`. `ping` capability metadata advertises optional projections: `capabilities.fleetStatus: { version: 1 }` adds bounded current-session `data.fleet` records (opaque reconciliation `key`, resolved `agent`, optional `role`, `model`, `effort`, caller-facing `goal`, `startedAt`, split `{ input, output, total }` tokens, plus `totalActive`/`omitted` overflow counts) to successful `status` replies; `capabilities.launchResolvedExtensions` advertises parent-resolved opaque launch-extension identifiers in status details; `capabilities.runtimeAcknowledgedExtensions` advertises the best-effort child-runtime acknowledgement projection fed by cooperating extensions emitting `subagent:acknowledge-extension`. Foreground `details.results[]` rows carry a stable numeric `index`; correlate children by `(runId, index)` rather than row position. Consumers should read status/result artifacts and RPC projections instead of scraping terminal output and must ignore unknown fields. `spawn` requires a workflow script body, is async-only, and rejects management actions, `async: false`, or `clarify: true`; it reuses the normal executor, so discovery, validation, session attribution, configured spawn caps, artifacts, and async status are shared with the `subagent` tool. `status`, acknowledged async `steer`, and `interrupt` map to the normal control actions. RPC steer disables pause-and-revive recovery and advertises `capabilities.nonRecoveringSteer`, preserving the caller's authority over the exact spawned child. `resume` requires a target plus non-empty message and delegates to the package-owned revival path; it may set a caller-owned `file-only` output path but cannot override the persisted child model, tools, budgets, session ownership, or exclusive session lease. For retained-child workflows, resume a child by the `runId` its result returned; treat a `not resumable` failure as the signal to start a same-role fallback challenge and label it as fallback. `stop` targets running async runs through the existing timeout control channel. `pi.events` is process-local, so separate Pi processes and child subagents coordinate through lifecycle artifact files.
