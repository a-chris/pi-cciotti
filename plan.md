# Plan: Facade rewrite of the subagent tool surface

**Where we are:** the three facade tools are built and the docs match them. Nothing is blocked and
there are no open decisions. D9, D10, D10b, D11, the test-invariant relaxation, and the doc re-teaching
are done and green; what remains is the release itself — version bump, consolidated CHANGELOG, push,
and one recorded real-session smoke run. Scope was reduced 2026-09-28: finish the
existing surface, ship one working version, iterate later.

**How to read this file:** sections 1–7 are the contract (rules, design, decisions)
Read **Vision & mindset** before doing anything; it is the tie-breaker for implementation issues.

---

## 1. Vision & mindset — read this first

These are the guidelines. When a contributor hits a decision or an implementation issue, the
principle beats the page: resolve it with this mindset, not by adding a special case.

1. **Facade for the model, engine for TypeScript.** The model sees a small, deliberate surface;
   validation, enrichment, and defaults happen in TypeScript and in declarations (agent + config).
   The internal contract (executor, preflight, bridges) is stable; only the surface changes shape.
2. **Impossible states unrepresentable.** Modes live in separate tools; a param exists on exactly
   one tool and cannot appear on another — except the declared cross-cutting share list (§3), which
   carries identical meaning on every tool it appears on and creates no impossible call. Prefer a
   schema shape that makes a wrong call impossible over a rule the model must remember. Do not
   reach for `oneOf`/`if-then` to fake shape — split the surface instead.
3. **Policy rides with the agent, not the call.** Context mode, recurring reads, skills, and model
   preferences are declared on the agent definition (`defaultContext`, `defaultReads`, …) and cannot
   be overridden per call. Missing declarations fall back to a safe default (`fresh` / no reads).
4. **`task` ≠ `prequel`.** `task` states the action to do or problem to solve; `prequel` states the
   current state of the work and what led here. The child consumes `prequel` only when its declared
   mode is `fork|summary`; with `fresh` it stays empty and unused.
5. **Small models are first-class.** Sessions may run weak local models. The surface uses simple
   shapes (string/enum/boolean), ≤ 8 params per tool, enums for closed sets, ≤ 60-word descriptions,
   and live discovery (agent names injected into the description at load time).
6. **Removal over compatibility.** A feature whose outcome another path already produces (OS
   scheduling, configuration, a composed workflow) is removed, not maintained. No aliases, no shims,
   no compat modes. Hard cutovers with a CHANGELOG line apiece.
7. **Every removal is deliberate and proven.** One removed param/action = one CHANGELOG line + one
   deleted/updated test. Tests prove the current contract; no defensive tests for removed behavior.
   Delete obsolete assertions rather than neuter them.
8. **One invariant per milestone.** Each milestone proves one property and lands green:
   `npm run test:unit` (+ `test:integration`), measurement recorded when applicable, plan.md status +
   current-milestone updated, committed.

### Session protocol (prevents drift across sessions)

1. **Start:** read `plan.md` + VISION.md; **§2 Now** tells you where to start. Nothing else is in
   scope this session.
2. **During:** stay inside the item's scope. If it grows beyond the session, **stop at the last
   green checkpoint**, split it, and update the plan.
3. **Commit hygiene:** in worktrees that link `node_modules` (validation symlink), commit **explicit
   file lists only — never `git add -A`** (the link gets swept into the branch; M2's merge carried it
   and needed a corrective revert).
4. **End:** suite green; measurement recorded when applicable; this file's status + Now section
   updated; committed. A unit is never "mostly done" — it is done or not.

## 2. Now → Next → Deferred → Never

### Now — finish and release (owner, 2026-09-28)

**Decision:** stop extending the removal sweep, finish the surface that already exists, ship one
working version, then keep iterating.

**Finish line:** one release in which the three facade tools are complete and coherent — every verb
on `subagent_control` can receive its inputs, every file the model reads matches the shipped schemas,
and the suites are green.

Five items, small and bounded:

1. **D9 — `topic` on the control facade — DONE (2026-09-28).** Carried through
   `controlProperties` + `normalizeControlParams`; enum derived from `SUBAGENT_GUIDE_TOPICS`
   (exported; `subagent-guide.ts` imports only node builtins, so no cycle); the pool entry at
   `schemas.ts:164` now carries `enum` + description ("Guide topic served by the guide action.
   Omit to read the overview."). Facades render at 993 + 624 + 613 = 2,230 chars (< 3,000).
   Tests flipped: facade shape + no-drift + tool-description property list, and `topic` removed
   from `NEVER_MODEL_PARAMS`. `docs/tool-reference.md` and the README re-teach
   `subagent_control({ action: "guide", topic: ... })` with `/subagents-guide [topic]` as the slash
   equivalent; CHANGELOG entry added. Real-session smoke: `topic` serves the topic doc, omitted
   `topic` serves the overview, an unknown topic lists the valid values, and `status` is
   unchanged.
2. **D10 — keep `get` and `mission.create` and make them drivable — DONE (2026-09-28)** (owner later
   chose "do not add validate"; see D10b). Control gained `agent` (for `get` and `models <agent>`)
   and `mission` (for `mission.create`), both projected by reference with a facade description and
   carried through `normalizeControlParams`. `test/unit/facade-control-routes.test.ts` boots the real
   extension against a fake Pi host and proves `get`, `models <agent>`, and `mission.create` dispatch
   end to end, that a `mission` object failing validation returns a readable error rather than a
   stack, and that a `validate` call is schema-rejected.
3. **Relax the M1 invariant — DONE.** The fixed exempt set became a declared share list —
   `{async, worktree, agent}`, each with a one-line "same meaning on each tool" rationale in the
   test, so growing it is a reviewable one-line change instead of forbidden. `mission` is not a
   share: it lands on control only. `UNREACHABLE_VERBS` shrank to empty and the test gained a P1
   rule in its place: control must never carry a script param, and every enum verb must survive
   facade normalization.
4. **Re-teach the docs that now work — DONE.** The truth sweep (U3b-2…U3b-6) removed the `guide`+`topic`,
   `get`/`models` with an agent, and `validate` examples *because they could not work*. The first two
   are back in `docs/tool-reference.md`, `docs/missions.md`, and the management skill reference;
   `validate` is not (D10b) — `docs/workflows.md` now says the same errors come back from running
   the script.
4b. **D11 — delegation `agent` is required — DONE.** Fixing a pre-existing lie found while writing
   the D10 route test: the description promised "Default agent when omitted" and the schema required
   only `task`, but no default-agent setting has ever existed and the engine always rejected the
   agent-less call. `agent` joined `required`, the description names `agent` + `task` as the pair,
   and `plan.md` §3 (where the bug was authored) now matches. Two guards were added and
   mutation-verified: no facade may accept `model`/`provider`/`thinking`/`fast` (operator policy,
   not call input), and every fenced copyable `subagent({...})` example must carry all required
   params. Fixing the second exposed a hole in the docs parser — it dropped any literal without an
   `action:`, so no delegation or workflow example had ever been shape-checked; it now reports all
   of them.
5. **Green suites, then release — DONE (2026-09-27).** v0.69.0: `package.json` + lockfile bumped
   from the upstream 0.68.0, CHANGELOG consolidated, annotated tag, pushed to `origin/main`.

   **Recorded real-session smoke** (real `pi` 0.85.1 CLI, `pi -p --offline --approve -ne -e
   ./index.ts --mode json`, judgement taken from the JSON transcript's `tool_execution_end` records,
   never from model prose): the extension loads and registers the three facades; `subagent_control
   {action:"list"}` printed the live registry; **D10's two new routes drove for real** —
   `{action:"get",agent:"reviewer"}` returned reviewer's full field set and
   `{action:"mission.create",mission:{title:"Smoke mission",labels:["smoke"]}}` returned
   *Created mission e8ba843c-…*; a delegation
   `subagent {task, agent:"worker"}` ran a child that returned `pi-subagents`; and a foreground
   workflow `runs.all([{key:"a",agent:"worker",…}])` reported *Workflow completed* with its child
   finishing in 3.5s. Two further observations, both favourable to the design: a capable model was
   instructed verbatim to make an agent-less `subagent({task})` call and **refused**, stating the
   arguments did not match the tool schema (D11's requirement is legible from the model side); and a
   tiny local model that improvised `agent`→`id` and `mission`→`message` got targeted validation
   errors back rather than a silent misfire. `validate` was never emitted by either model.

   One smoke attempt failed *outside this repo*: the async child recorded
   `Agent 'scout' requested unavailable child tools: contact_supervisor`. Repo `agents/` and `src/`
   contain zero references (cleaned in `1d416cd1`); the cause is the operator's global override
   `~/.pi/agent/agents/scout.md`, which still allowlists the removed tool and shadows the builtin
   scout. The retry on an agent with no override passed. Operator action: delete that stale override
   file or drop `contact_supervisor` from its `tools` line — children now report `BLOCKED: <reason>`
   instead of calling a supervisor tool.

**Measured size of (2)+(3):** the three facade schemas render at **1,995** chars today; the five added
params cost **601** (`topic` 27, `agent` 81, `source` 2, `args` 242, `mission` 249) → **2,596**,
inside the existing 3,000-char test threshold, plus roughly 200 for the descriptions `topic` and
`source` still lack. The byte budget does not have to move.

**Shipped size (D9 + D10 + D10b + D11):** delegation 1,008 + workflow 624 + control 935 =
**2,567** chars, inside the 3,000 threshold enforced by `schemas.test.ts`. Measured, not estimated:
D10's `agent` + `mission` cost **+333** on control (935 with them, 602 without), and dropping
`validate` from the enum paid back 18. Net over D9's 647-char control schema: **+288**.
D10b is why the budget held — `source` + `args` never landed on control.

**Acceptance for "fully working" (not a demo):** `tsc` 0; unit + integration green; the docs contract
test green with `topic` no longer an exception; and one recorded end-to-end run of each facade mode
against a real Pi session — a delegation, a workflow, and a control verb with its argument.

### Deferred to the next iteration (recorded, not cancelled)

| Deferred | Why it can wait |
|---|---|
| U5 — the remaining REMOVE-list params | Already unreachable from the model (measured), so keeping them is code hygiene, not user-visible wrongness |
| Deleting the dead handlers (`worktree.cleanup`/`discard`, `grant-spawn-budget`) and `worktree-cleanup-plan.ts` | Unreachable and harmless today; deleting them removes the only automated reclaim route, so the manual route must be documented first (P2) |
| `ExecutorDeps.childRuntime` wholesale removal | Zero assignment sites in `src` (`index.ts:562` omits it; `index.ts:391` returns before the executor is built for child sessions; no test passes it), so every `inheritedNestedRoute(deps)` read is already `undefined` in production — the same dead-plumbing shape U2a/U2b-1 removed. Large blast radius (status tree, run-id resolution, runner self-events): scope it deliberately, don't fold it into a key trim |
| `steeringRecovery` | Absent from all three facades so the model cannot pass it, but `rpc.ts:526` and `slash-commands.ts:1091` pass `false` to *suppress* a `recover` callback the executor builds. It is an internal contract field, which the done-when rule allows; removing it would hard-wire RPC/slash steer ownership — a behaviour change, not a trim |
| `createSubagentParamsSchema` (schemas.ts:231) | Zero callers; goes with the 37 unreachable pool keys |
| M5 — small-model polish | Polish on a surface nobody has measured yet |
| Behavioural measurement (bytes vs behaviour) | Belongs to the iteration after release: measure what ships, then decide |
| Test-typecheck burn-down (117 files / 2,091 errors) | Independent, and the ratchet already stops the debt growing |
| Structural "three tools" rewrite of the docs | O3: the prose the model reads already matches the schemas; not needed for a working release |

### Never — measured, not forgotten

- The central claim stays unmeasured post-release. The rewrite is justified by "small models handle a
  smaller surface better", and the only recorded criterion is rendered byte count (< 3,000 chars).
  Decide after shipping: compare the old single tool against the three facades on a fixed task set, or
  keep byte count as the criterion. VISION.md's own rule is that a passing demo is not a capability
  contract.

## 3. Target design

Three tools, each ≤ 8 params, rendered schemas total ≈ 1.5–2 kB (≈ 85–88% reduction).

### `subagent` — delegate one child (8 params)

```json
{
  "type": "object",
  "required": ["task", "agent"],
  "properties": {
    "task":       { "type": "string", "description": "The action to do or problem to solve." },
    "agent":      { "type": "string", "description": "One of the installed agent names (via subagent_control action:list). Required: no default agent exists." },
    "prequel":    { "type": "string", "description": "Current state of the work and what led here — separate from task. Consumed when the agent's declared context mode is fork|summary; stays empty with fresh." },
    "reads":      { "type": "array", "items": { "type": "string" }, "description": "Task-specific file paths the child reads before running; the agent's defaultReads still apply." },
    "cwd":        { "type": "string", "description": "Working directory; default: session directory." },
    "async":      { "type": "boolean", "description": "Background run; default false." },
    "output":     { "anyOf": [{ "type": "string" }, { "type": "boolean" }], "description": "Durable result path, or false." },
    "worktree":   { "type": "boolean", "description": "Isolate in a managed git worktree; default false." }
  }
}
```

> Field name: **`prequel`** (locked). Distinctive so it never collides with `async` ("background
> run"), the context-*mode* concept, or mission `state`.
> Contract (D4): `task` = action/problem; `prequel` = current state and what led here; the runtime
> consumes `prequel` only when the agent's declared mode is `fork` or `summary` (for `fresh` it stays
> empty and unused).

### `subagent_workflow` — run a workflow (6 params)

```json
{
  "type": "object",
  "properties": {
    "workflow": { "type": "string", "description": "Named workflow resource, e.g. \"review\" or \"run-ci\"." },
    "source":   { "anyOf": [{ "type": "string" }, { "type": "object", "properties": { "path": { "type": "string" } } }], "description": "Inline script body, or { path } to a script file." },
    "args":     { "type": "object", "description": "Bounded JSON inputs for the workflow." },
    "async":    { "type": "boolean", "description": "Background run; default false." },
    "worktree": { "type": "boolean", "description": "Isolate in a managed git worktree; default false." },
    "baseRef":  { "type": "string", "description": "Branch/ref for worktree isolation." }
  }
}
```

### `subagent_control` — control runs by id (4 params today; 6 after D9 + D10)

```json
{
  "type": "object",
  "properties": {
    "id":      { "type": "string", "description": "Run id/prefix; required for run-targeting actions." },
    "action":  { "enum": ["status", "resume", "steer", "stop", "interrupt", "list", "get", "models", "guide", "mission.create"], "description": "What to do; omitted = status." },
    "message": { "type": "string", "description": "Guidance for steer/resume." },
    "topic":   { "D9": "guide topic; enum derived from SUBAGENT_GUIDE_TOPICS" },
    "agent":   { "D10": "for get / models <agent>" },
    "mission": { "D10": "mission object for mission.create" }
  }
}
```

> Read verbs (`list`/`get`/`models`/`guide`) let the model read the agent registry and name an agent
> (D5). `mission.create` is the only mission action kept on the surface (D2). `validate` left the
> surface with D10b: its only input is a script body, which lives on `subagent_workflow`.

### Cross-cutting share list

Params allowed on more than one facade, each with identical meaning. The invariant test asserts this
set and its rationale line per entry (was `{async, worktree}` only; grows with D10).

| Param | On | Same meaning |
|---|---|---|
| `async` | delegation, workflow | background run, default false |
| `worktree` | delegation, workflow | isolate in a managed git worktree |
| `agent` | delegation, control | name the agent to delegate to / the agent to inspect |

(`source` / `args` were listed here for D10's `validate` plan; D10b returned them to the workflow
facade alone, so they are no longer shared.)

## 4. Why, and the baseline it started from

The `subagent` tool was one flat, 81-param JSON schema (~12.4 kB rendered) plus a 586–716-word
description, injected into the parent session's system prompt **every turn** (~18.6 kB ≈ 4.5–5.5k
tokens). It was the union of three different APIs in one call contract: delegate-one-child,
run-workflow, manage/control. Consequences:

- The model had to learn mode-specific rules (`agent` excludes `workflowScript`, `preflight` requires
  a workflow, `action` is management-only…) enforced afterward by a ~90-line normalization gate —
  rules the model carried instead of the system enforcing by shape.
- Every optional param sat at equal depth with no mode grouping, no defaults visible, no signal about
  what matters. Hostile to small local models.
- Params that serve a single management action (e.g. `repo` for `worktree.cleanup`,
  `at`/`every`/`timezone` for `schedule.create`) were advertised as first-class model choices.

| Baseline (measured 2026-09) | Before | Now |
|---|---|---|
| `subagent` tool params (rendered JSON Schema, minified) | 12,449 chars / 81 top-level params (70 with descriptions) | three facades, 1,995 chars total |
| Tool description (default / full) | 4,885 / 6,174 chars | three descriptions, ≤ 60 words each |
| Per-session recurring cost | ~18.6 kB ≈ 4.5–5.5k tokens/turn | ≈ 2 kB + descriptions |
| `bg_wait` tool | separate registration | unchanged (precedent for multi-tool extensions) |

Engine fact that de-risked the change: the 7,196-line executor already takes the full internal param
contract (`executor.executePublic(id, params, …)`). The tool definition was a **facade** all along.
Prompt-template, RPC, and slash bridges call `executePublic` / `executeDelegated` directly and are
unaffected by facade changes. Extension consumers use internal contracts (`preflight`, `delegation`,
`background-work`, etc.) and keep working.

## 5. Decisions (owner)

- **D1** Multi-lane orchestration → **remove entirely** (surface + `runs.lanes` DSL + actions + doc). Flag if the script-level `runs.lanes` API was meant to survive.
- **D2** Schedules + watchdog → **remove** (watchdog is a redundant second path over config; reviewer workflow composes; cron/OS covers schedules). **Missions → keep**, trimmed.
- **D3** `toolDescriptionMode` → **remove** the config option; shorten the default description.
- **D4** Per-call context *mode* → **remove** (agent-owned). **Add `prequel` field** (name locked): model-authored context/summary of the chat, separated from `task`; consumed for `fork|summary`, empty with `fresh`.
- **D5** Agent-management CRUD → **remove write** from the model surface; read verbs stay. The model can read the registry and name an agent, but cannot create/edit/disable/delete one.
- **D6** `preflight` param → internal-only; `validate` action stays on the model surface. *(Later
  reversed by D10b: the verb has no drivable input on that surface.)*
- **D7** `reads` → keep per-call (plain list of file paths) + agent `defaultReads` compose.
- **D8** `defaultContext` per agent → **keep**, and the call cannot override it; missing → `fresh`.
- **D9** `topic` → **keep** (reverses the bucketing row, owner decision 2026-09-28; "keep it for now").
  `topic` is the only bridge from the ~2 kB always-loaded surface to the 229 kB of packaged docs (9
  topics, 5–42 kB each), it collides with no other facade, and the executor already reads it
  (`subagent-executor.ts:5943`). Cost: ~250 always-loaded bytes for enum + description, and the three
  tool descriptions must point at `guide` or the model will not call it.
- **D10** `get`/`validate`/`mission.create` → **keep, and make them drivable** (resolves O1: owner chose "keep the verbs and relax the invariant"). Control takes `agent`, `source` + `args`, and `mission`; the invariant becomes the declared share list in §3. Supersedes the O1 row and the "exempt set may never grow" wording in M1's done-when.
- **D10b** `validate` → **leaves the model surface** (owner: "do not add validate"). Adding `source` + `args` to control would duplicate the workflow facade's script entry points to serve one verb, and control would then accept scripts it never runs — exactly the ambiguity the facade split removes. `validate` is also redundant here: calling `subagent_workflow` with the same script returns the identical validation errors before spawning. Control's enum keeps every remaining verb drivable; the engine handler stays for the internal contract (RPC, preflight, integration tests). No capability is lost, so P2 names no new route — the route already exists.
- **D11** delegation `agent` → **required by the schema** (owner: specifying the agent is fine). The facade description claimed "Default agent when omitted", but no default-agent setting has ever existed (no `defaultAgent` key in `config.ts`, `configuration.md`, or the types) and the engine hard-requires a non-empty `agent` — so a `{ task }`-only call was always a failure while remaining schema-representable. P1 in the negative direction: an input combination that cannot be carried out must not be representable. Fixed as removal-over-compatibility (the stricter schema rejects what never worked); no default-agent feature was invented.

**O1 → D10.** Keep `get`/`validate`/`mission.create`; relax the invariant so each can receive its inputs. (Refined by D10b: `validate` leaves the surface.)
**O2 → closed by the scope reduction.** The handlers and their params stay. The finishing work is one documentation line per surface: preserved worktrees are reclaimed with `git worktree remove` / `git branch -D` on the paths the handoff manifest names, and spawn budget is raised with `maxSubagentSpawnsPerSession` in configuration.
**O3 → closed by the scope reduction plus U3b-2…U3b-6.** The prose the model reads already matches the schemas; the structural "three tools" rewrite of the docs is deferred and is not needed for a working release.

**Policies adopted with those decisions (veto-able):**

- **P1 — sufficiency.** Every verb on the model surface must be drivable; if its required input cannot live on that surface, the verb does not belong on it. D10 is P1 applied. P1 runs the other way too: an input combination that cannot be carried out must not be representable — D11 makes an agent-less delegation unrepresentable rather than a guaranteed error.
- **P2 — named route.** A capability leaves the model surface only in the same change that names its operator route — a config key, a slash command, or an explicit manual step.

## 6. Param disposition (complete bucketing of the original 81)

| Bucket | Params | Decision |
|---|---|---|
| Delegation facade | `task`, `agent`, `prequel` (new), `reads` (new on main tool), `cwd`, `async`, `output`, `worktree` | KEEP model-facing |
| Workflow facade | `workflow`, `source` (merges `workflowScript`+`workflowScriptPath` into one shape), `args`, `async`, `worktree`, `baseRef` | KEEP model-facing |
| Control facade | `id`, `action` (trimmed enum: run verbs + read verbs + `mission.create`), `message`, `topic` (**D9**), `agent` / `mission` (**D10**) | KEEP model-facing (`validate` left with **D10b**) |
| Agent-declared | `context` → `defaultContext` (mode only), `skill` (agents declare skills), `model` (agent `model`/config), `reads`-recurring (agent `defaultReads`) | MOVE to agent frontmatter; model never passes mode |
| Config-enriched | `model`, `timeoutMs`/`maxRuntimeMs`, `checkpointBeforeDeadlineMs`, `toolTimeoutMs`, `toolBudget`, `usageBudget`, `agentScope`, `fast`, `includeProgress`, `outputMode` defaults, `control` (attention thresholds), `thinking` | MOVE to `config.ts`-validated keys; executor enriches |
| Extension/API-only (internal contract, stays) | `outputSchema`, `agentContract`, `gate`, `extensionBindings`, `capabilities`, `preflight`, `context` (internal), `reads`-step (workflow steps), `mission` (object + `false` opt-out) | REMAIN on internal `SubagentParams` for `preflight`/delegation consumers, not on any facade |
| Remove entirely | `lane` (654 B), `usageBudget`, `mission*` patch metadata (`missionUpdate`/`missionStatus`/`missionScope`/`missionId`), `chatProgress`, `on`, `runMode`, `runStatus`, `summary`, `additional` (grant-spawn-budget), `planId`, `merge`, `supersession`, `share`, `sessionDir`, `sessionOnly`, `quiet`, `timezone`, `at`, `every`, `name`, `scope`, `target`, `focus`, `overlap`, `catchUp`, `lines`, `view`, `handoffPath`, `repo`, `mode`, `steeringRecovery`, `index`, `childId` | DELETE from internal contract, executor, types, docs, tests (**U5 deferred**; `topic` returned by D9; `focus` stays inspector-owned; `steeringRecovery` is internal — see §2) |
| Control action long tail | `schedule.*`, `watchdog.*`, `inspector.*`, `project.*`, `lane.*`, `mission.*` (except `mission.create`), `worktree.discard`/`cleanup`, `doctor`, `grant-spawn-budget`, agent CRUD (`create`/`update`/`delete`/`eject`/`disable`/`enable`/`reset`/`refine`) | REMOVE from tool. Discovery stays via `list`/`get`/`models`/`guide`. Subsystem removal per D2/D5 |

## 7. Feature removals (owner-approved)

| # | Removed | Verdict |
|---|---|---|
| 1 | Per-call `context` (mode) + `profile` + `config.defaultSubagentContext` — mode agent-owned | **Remove** (D4/D8); add `prequel` field |
| 2 | `toolDescriptionMode` config (`full`/`compact`/`custom`) — `compact` is a no-op alias today; default description text shortened | **Remove** (D3) |
| 3 | `intercom` enum value in `notifyChannels` (schemas.ts:271) + stale supervisor guidance in tool description | **Remove** (no decision needed) |
| 4 | Multi-lane orchestration: `lane` param, `usageBudget`, `lane.*` actions, `runs.lanes` DSL (scripted-workflow.ts), `merge`/`supersession`/`planId`/`handoffPath`, `multi-lane-orchestration.md` reference | **Remove entirely** (D1) — incl. the script-level API |
| 5 | Schedules: `schedule.*` actions + `at`/`every`/`timezone`/`catchUp`/`overlap`/`on`/`name`, `scheduled-runs.ts` engine | **Remove** (D2) — cron/OS equivalent |
| 6 | Watchdog: `watchdog.*` actions + `scope`/`target`/`focus`/`thinking`, `runtime.ts` + watchdog config — second path over config; reviewer workflow composes | **Remove subsystem** (D2) |
| 7 | Missions: keep records + durable `state.get/set` + auto-mission for workflows; keep `mission.create` on surface; drop patch metadata | **Keep, trimmed** (D2) |
| 8 | Agent-management CRUD (`create`/`update`/`delete`/`eject`/`disable`/`enable`/`reset`/`refine`) — read stays (`list`/`get`/`models`/`guide`), write goes to slash/config | **Remove write surface** (D5) |
| 9 | `preflight` param internal-only; `validate` action stays | **As stated** (D6), later narrowed by D10b: `validate` leaves the model surface |
| 10 | `reads` per-call (plain path list) + agent `defaultReads` compose in TypeScript | **Keep both** (D7) |
| 11 | Bundled-agent `defaultContext` (below); call cannot override | **Keep per-agent** (D8) |

### Risks / guardrails

- **Breaking release surface:** one `subagent` tool → three tools is a hard cutover for any
  user/extension that calls the tool by name; internal contracts (`executePublic`, preflight,
  delegation) stay stable so the engine and bridges survive.
- **Behavior change:** params moved to config must have a config key *before* removal,
  else the model silently loses the ability to set them.
- **Small-model regression:** description too terse → model misuses a tool; mitigated by
  live agent list, guide topics, and required-by-shape inputs.
- **Engine untouched until M4** keeps each PR narrow (VISION: scope must earn size).
- **Test churn is a feature:** delete assertions for removed behavior; do not neuter them.