# Plan: Facade rewrite of the subagent tool surface

> Status: **M4 in progress — U1, U2a, U2b-1, U2b-2, U3a, U2b-3 (depth cap removed), U3b-1 (chatProgress), U3b-2/U3b-3/U3b-4 (all model-read prose now matches the three facades, enforced by a 6-rule contract test) committed. Next: U5, the REMOVE-list params end-to-end. One owner-gated decision open: the three control verbs that cannot receive their inputs (see the U3b-3 log).**
> VISION updated; decisions resolved.
> Current milestone: **M4 — Enrichment + param sweep** (config keys for config-enriched params
> before removing per-call forms; delete REMOVE params end-to-end — types, executor, preflight,
> TUI, docs, tests).
> M3.3a split per the scout's session-size verdict; implemented directly by the parent
> (operator: "implement the milestone yourself" after the delegation lane lost its tool
> registration). Result: src watchdog-free (typecheck 0), unit 2,719/2,719 — the two
> watchdog-lsp parallel-load flake baselines are GONE (watchdog-lsp-diagnostics.test.ts
> deleted with the subsystem); the integrated 7-test files are documented known-red for 3.3b.
> Parent rulings: `focus` param stays (inspector-owned; M4 sweep), `thinking` param removed
> now (watchdog-only), the 3 comment rewords applied; VISION refusal lines untouched.
> M3.3a commits: U1 deletions → U2 types/schemas/index → U3a foreground → U3b background →
> U4 unit tests → U5 docs/CHANGELOG. Net diff: 76 files, +40/−9,379.
> M3.4 result (user-directed order; missions trim before 3.3b): the mission patch actions
> (`mission.list/show/update/resolve-decision/attach-run/close`) and patch-metadata params
> (`missionId`/`missionUpdate`/`missionStatus`/`missionScope`, plus attach-only `runMode`/
> `runStatus` and close-only `summary`) are off the surface — schema pool, executor contract,
> `SUBAGENT_ACTIONS`, MUTATING/DESTRUCTIVE action sets, docs, tests. KEPT: auto-mission for
> workflows, durable `state.get/set`, mission records, `mission.create` (control facade);
> `missionId`/`mission` stay on the internal executor contract for workflow mission-attach
> (`prepareMissionLaunch`), so the durable-state integration test stays green. `handleMissionAction`
> lost its action-dispatch param (single-action contract). Goal pause/resume/opt-out is an
> operator edit to the mission record. Typecheck 0; unit 2,707/2,707 (11 pre-existing skips);
> integration failure set identical to HEAD (~200 env-shaped failures in this sandbox on BOTH
> trees — previous-session baseline was 767/769; the one-test delta was the result-publication
> 15s watcher deadline flake, passes isolated). Residuals: pi-lens advisories on carried
> baseline code recorded, not fixed (option-a): executor 521 conditional-spread items at
> untouched coordinates (whole-file re-scan from fingerprint invalidation; the 3 edit sites are
> pure deletions); actions.ts `validateMissionLaunch` budget/labels guards' typeof (behavior-
> preserving fix does not exist — pinned error messages require the boundary patterns; new/
> converted code in the file is clean); store.ts internal `"mission.update.*"` validation labels
> on the surviving `updateMission` primitive.
> M3.3b result: the 7 integration files are watchdog-free and green. part-2 was deduplicated
> (doubled since `1d416cd1`, parse-broken; kept copy = pre-doubling baseline minus intentional
> watchdog/lane/usageBudget excisions, `contact_supervisor`→`bg_wait` renames; no tests lost).
> Reality exceeded the definition-of-done: the remaining reds traced to ONE shared-fixture bug —
> the M3.3a trim (`cae19f1f`) left a dangling `else` in `test/support/fake-child-session.ts`
> that swallowed every scripted assistant `message_end` — fixed by restoring unconditional
> emission; no test-body edits were needed in the previously-red files. Evidence: part-1 98/98,
> part-2 165/165, part-4 28/28, slash-commands 30/30, external-cli-runner 16/16, render-widget
> 73/73, async-status 41/41, model-resolution-diagnostic 4/4, render-fork-badge 44/44; typecheck
> 0; unit 2,707/2,707 (11 pre-existing skips). The earlier "~200 env-shaped failures" reading was
> this bug, not env — the M3.4 block's "~200 env-shaped" integration note is superseded by this
> finding. Residual (recorded,
> not fixed, option-a): 21 pre-existing pi-lens advisories in fake-child-session.ts at untouched
> coordinates; `setupPoison` in `src/runs/shared/worktree.ts:199` is process-global and never
> reset (one aborted setup poisons all later worktree tests in a process — magnifier, not root
> cause); `releaseUnknownIO()` in worktree-setup-command.ts overwrites the original error with
> the generic "settlement is unverified" message.
> M1 result: three facade tools on main; rendered facade schemas 1,995 B total (was 12,449);
> suite 2,931/2,944 at head, sole failure = pre-existing `watchdog-lsp-diagnostics` parallel-load
> flake (passes isolated on both heads). Reviewer accepted the fixes for its two blockers.
> M2 result: agent-owned `defaultContext` (missing → fresh), `config.defaultSubagentContext` removed,
> `profile` removed, `prequel` wired (outermost labeled block for fork|summary, absent for fresh).
> Unit 2,942/2,942 green at head; integration 779/781 (sole pre-existing `single-execution.part-2`
> parse break). Reviewer: APPROVE, no blockers. Residuals: tool-reference/extension-api docs updated
> for context-owner change but full rewrite deferred to M6; `defaultSubagentContext` grep hit is one
> anti-regression assert in schemas.test.ts:219 after M2.
> M3.1 result: multi-lane orchestration removed — `runs.lanes` DSL (scripted-workflow.ts),
> `lane` param + `lane.*` actions, merge/supersession evidence, `usageBudget`, `planId`/`laneId`,
> reference doc; preflight lanes contract kept. Unit 2,911/2,924 (sole fail = the watchdog-lsp
> parallel-load flake family, both :93 and the malformed-JSON sibling pass isolated); integration
> 774/776 (sole pre-existing part-2 parse break). Reviewer verdict was REJECT on two P1s; parent
> evidence showed P1-1 (executable `runs.lanes` tests) was a misclassification — zero executable
> DSL tests remain, only two stale test titles (renamed); P1-2 (`progress.md` staged) + both P2s
> (usageBudget guidance leftovers) fixed in synthesis commit `aaa11a84`.
> Residuals: pi-lens style advisories on pre-existing baseline code (parallel-handoff
> `validateManifestIdentity` L52-63 etc.) recorded, not fixed (option-a decision, M2 precedent).
> M3.2 result: schedule subsystem removed entirely — `scheduled-runs.ts` engine deleted, all nine
> `schedule.*` actions + `at`/`every`/`timezone`/`catchUp`/`overlap`/`on`/`name`/`sessionOnly`/
> `quiet` off the surface, `ScheduleOrigin`/`ScheduledRunsConfig`/mission `"scheduled"` mode gone,
> RPC `manage` allowlist emptied (`managementActions` = `[]`), slash stop selector async-only,
> docs/skills edited, one CHANGELOG line. Typecheck green; unit 2,850/2,863 (sole fail = the known
> watchdog-lsp parallel-load flake, pass isolated); integration 767/769 (sole pre-existing part-2
> parse break). Residuals: `scheduling`-wording/`schedule evidence` doc lines the scout missed fixed
> in-tree (tool-reference.md L13/L15, extension-api.md L28, prompting-and-roles.md L7).
> Read "Vision & mindset" below first — it is the guideline set for anyone working on
> this plan, in any session, and it is the tie-breaker for implementation issues.

## Vision & mindset — read this first

These are the guidelines. When a contributor hits a decision or an implementation issue,
the principle beats the page: resolve it with this mindset, not by adding a special case.

1. **Facade for the model, engine for TypeScript.** The model sees a small, deliberate
   surface; validation, enrichment, and defaults happen in TypeScript and in declarations
   (agent + config). The internal contract (executor, preflight, bridges) is stable; only
   the surface changes shape.
2. **Impossible states unrepresentable.** Modes live in separate tools; a param exists on
   exactly one tool and cannot appear on another — except the declared cross-cutting set
   `{async, worktree}`, which carry identical meaning on both the delegation and workflow
   facades and create no impossible call. The invariant test asserts the exempt set is exactly
   `{async, worktree}` and never larger. Prefer a schema shape that makes a wrong
   call impossible over a rule the model must remember. Do not reach for `oneOf`/`if-then`
   to fake shape — split the surface instead.
3. **Policy rides with the agent, not the call.** Context mode, recurring reads, skills,
   and model preferences are declared on the agent definition (`defaultContext`,
   `defaultReads`, …) and cannot be overridden per call. Missing declarations fall back to
   a safe default (`fresh` / no reads).
4. **`task` ≠ `prequel`.** `task` states the action to do or problem to solve; `prequel`
   states the current state of the work and what led here. The child consumes `prequel`
   only when its declared mode is `fork|summary`; with `fresh` it stays empty and unused.
5. **Small models are first-class.** Sessions may run weak local models. The surface uses
   simple shapes (string/enum/boolean), ≤ 8 params per tool, enums for closed sets,
   ≤ 60-word descriptions, and live discovery (agent names injected into the description
   at load time).
6. **Removal over compatibility.** A feature whose outcome another path already produces
   (OS scheduling, configuration, a composed workflow) is removed, not maintained. No
   aliases, no shims, no compat modes. Hard cutovers with a CHANGELOG line apiece.
7. **Every removal is deliberate and proven.** One removed param/action = one CHANGELOG
   line + one deleted/updated test. Tests prove the current contract; no defensive tests
   for removed behavior. Delete obsolete assertions rather than neuter them.
8. **One invariant per milestone.** Each milestone proves one property and lands green:
   `npm run test:unit` (+ `test:integration` from M2), measurement recorded when applicable,
   plan.md status + current-milestone updated, committed.

## Why

The `subagent` tool today is one flat, 81-param JSON schema (~12.4 kB rendered) plus a
586–716-word description, injected into the parent session's system prompt **every turn**
(~18.6 kB ≈ 4.5–5.5k tokens). It is the union of three different APIs in one call
contract: delegate-one-child, run-workflow, manage/control. Consequences:

- The model must learn mode-specific rules (`agent` excludes `workflowScript`, `preflight`
  requires a workflow, `action` is management-only…) enforced afterward by a ~90-line
  normalization gate — rules the model carries instead of the system enforcing by shape.
- Every optional param sits at equal depth with no mode grouping, no defaults visible,
  no signal about what matters. This is hostile to small local models.
- Params that serve a single management action (e.g. `repo` for `worktree.cleanup`,
  `at`/`every`/`timezone` for `schedule.create`) are advertised as first-class model choices.

## Baseline (measured 2026-09)

| Surface | Current |
|---|---|
| `subagent` tool params (rendered JSON Schema, minified) | 12,449 chars / 81 top-level params (70 with descriptions) |
| Tool description (default / full) | 4,885 / 6,174 chars |
| Per-session recurring cost | ~18.6 kB ≈ 4.5–5.5k tokens/turn |
| `bg_wait` tool | separate registration (stays) — precedent for multi-tool extensions |

Engine fact that de-risks the change: the 7,196-line executor already takes the full
internal param contract (`executor.executePublic(id, params, …)`). The tool definition is
a **facade** today. Prompt-template, RPC, and slash bridges call `executePublic` /
`executeDelegated` directly and are unaffected by facade changes. Extension consumers use
internal contracts (`preflight`, `delegation`, `background-work`, etc.) and keep working.

## Target design

Three tools, each ≤ 8 params, rendered schemas total ≈ 1.5–2 kB (≈ 85–88% reduction).

### `subagent` — delegate one child (8 params)

```json
{
  "type": "object",
  "required": ["task"],
  "properties": {
    "task":       { "type": "string", "description": "The action to do or problem to solve." },
    "agent":      { "type": "string", "description": "One of the installed agent names (via subagent_control action:list). Default agent when omitted." },
    "prequel":    { "type": "string", "description": "Current state of the work and what led here — separate from task. Consumed when the agent's declared context mode is fork|summary; stays empty with fresh." },
    "reads":      { "type": "array", "items": { "type": "string" }, "description": "Task-specific file paths the child reads before running; the agent's defaultReads still apply." },
    "cwd":        { "type": "string", "description": "Working directory; default: session directory." },
    "async":      { "type": "boolean", "description": "Background run; default false." },
    "output":     { "anyOf": [{ "type": "string" }, { "type": "boolean" }], "description": "Durable result path, or false." },
    "worktree":   { "type": "boolean", "description": "Isolate in a managed git worktree; default false." }
  }
}
```

> Field name: **`prequel`** (locked). Distinctive so it never collides with `async`
> ("background run"), the context-*mode* concept, or mission `state`.
> Contract (D4): `task` = action/problem; `prequel` = current state and what led here;
> the runtime consumes `prequel` only when the agent's declared mode is `fork` or `summary`
> (for `fresh` it stays empty and unused).

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

### `subagent_control` — control runs by id (4 params)

```json
{
  "type": "object",
  "properties": {
    "id":      { "type": "string", "description": "Run id/prefix; required for run-targeting actions." },
    "action":  { "enum": ["status", "resume", "steer", "stop", "interrupt", "validate", "list", "get", "models", "guide", "mission.create"], "description": "What to do; omitted = status." },
    "message": { "type": "string", "description": "Guidance for steer/resume." }
  }
}
```

> Read verbs (`list`/`get`/`models`/`guide`) let the model read the agent registry and name
> an agent (D5). `validate` is the cheap script lint (D6). `mission.create` is the only
> mission action kept on the surface (D2).

## Param disposition (complete bucketing of the current 81)

| Bucket | Params | Decision |
|---|---|---|
| Delegation facade | `task`, `agent`, `prequel` (new), `reads` (new on main tool), `cwd`, `async`, `output`, `worktree` | KEEP model-facing |
| Workflow facade | `workflow`, `source` (merges `workflowScript`+`workflowScriptPath` into one shape), `args`, `async`, `worktree`, `baseRef` | KEEP model-facing |
| Control facade | `id`, `action` (trimmed enum incl. read verbs + `validate` + `mission.create`), `message` | KEEP model-facing |
| Agent-declared | `context` → `defaultContext` (mode only), `skill` (agents declare skills), `model` (agent `model`/config), `reads`-recurring (agent `defaultReads`) | MOVE to agent frontmatter; model never passes mode |
| Config-enriched | `model`, `timeoutMs`/`maxRuntimeMs`, `checkpointBeforeDeadlineMs`, `toolTimeoutMs`, `toolBudget`, `usageBudget`, `agentScope`, `fast`, `includeProgress`, `outputMode` defaults, `control` (attention thresholds), `thinking` | MOVE to `config.ts`-validated keys; executor enriches |
| Extension/API-only (internal contract, stays) | `outputSchema`, `agentContract`, `gate`, `extensionBindings`, `capabilities`, `preflight`, `context` (internal), `reads`-step (workflow steps), `mission` (object + `false` opt-out) | REMAIN on internal `SubagentParams` for `preflight`/delegation consumers, not on any facade |
| Remove entirely | `lane` (654 B), `usageBudget`, `mission*` patch metadata (`missionUpdate`/`missionStatus`/`missionScope`/`missionId`), `chatProgress`, `on`, `runMode`, `runStatus`, `summary`, `additional` (grant-spawn-budget), `planId`, `merge`, `supersession`, `share`, `sessionDir`, `sessionOnly`, `quiet`, `timezone`, `at`, `every`, `name`, `scope`, `target`, `focus`, `overlap`, `catchUp`, `topic`, `lines`, `view`, `handoffPath`, `repo`, `mode`, `steeringRecovery`, `index`, `childId` | DELETE from internal contract, executor, types, docs, tests |
| Control action long tail | `schedule.*`, `watchdog.*`, `inspector.*`, `project.*`, `lane.*`, `mission.*` (except `mission.create`), `worktree.discard`/`cleanup`, `doctor`, `grant-spawn-budget`, agent CRUD (`create`/`update`/`delete`/`eject`/`disable`/`enable`/`reset`/`refine`) | REMOVE from tool. Discovery stays via `list`/`get`/`models`/`guide`. Subsystem removal per D2/D5 |

## Feature removals (owner-approved)

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
| 9 | `preflight` param internal-only; `validate` action stays | **As stated** (D6) |
| 10 | `reads` per-call (plain path list) + agent `defaultReads` compose in TypeScript | **Keep both** (D7) |
| 11 | Bundled-agent `defaultContext` (below); call cannot override | **Keep per-agent** (D8) |

## Milestones (one landable unit per session)

Order rule: M1 before M2 (facades carry `task`/`prequel`); M2 before M6 (agents declare
context before docs describe it). M3.x are independent of each other and of M1–M2 — each
is a safe checkpoint on its own.

### M1 — Facade (≈ 1 session)
- **Files:** `src/extension/schemas.ts`, `src/extension/facade.ts` (new), `src/extension/index.ts`,
  `src/extension/tool-description.ts`, `test/unit/schemas.test.ts`, `test/unit/tool-description.test.ts`,
  `test/unit/index-child-registration.test.ts`, `test/unit/advertised-agent-refresh.test.ts`
  (the last two are tests of the deleted single-tool surface — retarget to the new facades,
  delete obsolete CRUD asserts; discovered during M1)
- Add `SubagentDelegationParams` / `SubagentWorkflowParams` / `SubagentControlParams` —
  **projections derived from the internal full schema**, not hand-copied (no drift).
- New `facade.ts` normalizes facade params → internal `SubagentParams` → `executePublic`.
- Register the three tools (+ `renderCall`/`renderResult` per tool); delete the old
  `subagent` registration. Bridges/extensions untouched.
- Rewrite the three descriptions ≤ 60 words each; guide topics carry depth.
- **Verify:** `npm run test:unit` green; `package-manifest.test.ts` green (exports unchanged);
  rendered bytes measured (target ≈ 1.5–2 kB total).
- **Done-when:** one tool = one mode; invariant test proves no param name appears on two
  facades except the declared cross-cutting set `{async, worktree}` (and asserts the exempt
  set is never larger).

### M2 — Context → agent-owned + `prequel` (≈ 1 session)
- **Files:** `src/shared/fork-context.ts`, `src/extension/config.ts`, `src/shared/types.ts`,
  `src/runs/foreground/subagent-executor.ts` (prequel wiring), `agents/*.md`, `docs/agents.md`
- Rewire `resolveSubagentContext`: read `agent.defaultContext`, fallback `fresh`; delete
  `profile`/implicit-from-call paths; delete `config.defaultSubagentContext` (+ validator).
- Wire `prequel` (D4): consumed for `fork|summary` (prepend to child packet / feed brief),
  ignored for `fresh`. Exact wiring decided during implementation; contract above.
- Add `defaultContext` (+ `contextBrief` where fitting) to bundled agents; rewrite the
  `docs/agents.md` precedence section (163–165) to agent-only.
- **Verify:** `test:unit` + `test:integration`; context-mode tests updated; grep
  `defaultSubagentContext` → zero hits.
- **Done-when:** a call cannot override mode; `prequel` reaches the child for `fork|summary`
  and is absent for `fresh`.

### M3 — Subsystem removals (independent, ≈ 1 session each)
- **3.1 Lanes** — `runs.lanes` DSL (scripted-workflow.ts), `lane` param + `lane.*` actions,
  `merge`/`supersession`/`planId`/`handoffPath`, `skills/pi-subagents/references/multi-lane-orchestration.md`.
  Verify: grep `lane` → zero hits; suite green.
- **3.2 Schedules** — `schedule.*` actions, `at`/`every`/`timezone`/`catchUp`/`overlap`/`on`/`name`,
  `src/runs/background/scheduled-runs.ts` engine.
  Verify: `schedule.*` gone; related tests deleted.
- **3.3 Watchdog** — `watchdog.*` actions, `scope`/`target`/`focus`/`thinking`,
  `src/watchdog/runtime.ts` + watchdog config validators + `docs/watchdog.md`.
  Verify: watchdog references gone (the VISION refusal line stays — unrelated wording).
- **3.4 Missions trim** — `missionUpdate`/`missionStatus`/`missionScope`/`missionId` off the
  surface; keep auto-mission for workflows, `state.get/set`, and `mission.create`.
  Verify: patch metadata gone; `state` tests green.
- **Done-when (each):** removed code/tests/docs + one CHANGELOG line; suite green.

### M4 — Enrichment + param sweep (≈ 1–2 sessions)
- **Files:** `src/extension/config.ts` (new keys + validators), `src/shared/types.ts`, executor,
  `preflight`, TUI files, `docs/configuration.md`; all listed REMOVE params.
- Add config keys for the config-enriched params **before** removing their per-call forms.
- Delete REMOVE params end-to-end (types, executor, preflight, TUI, docs, tests).
- **Verify:** grep removed names → zero hits; suite green; obsolete assertions deleted, not neutered.
- **Done-when:** every param the model can pass is a facade param or an internal contract field;
  every config-enriched param has a validated config key.

### M5 — Small-model polish (≈ 1 session)
- **Files:** `src/extension/tool-description.ts` (live agent list), `src/extension/index.ts` (load-time discovery)
- Inject the actual installed agent-name list into `subagent.description` at load.
- Fixture test: a weak-model-shaped call validates and enriches.
- **Done-when:** the description lists real agent names; fixture passes.

### M6 — Docs, measurement, release (≈ 1 session)
- **Files:** `docs/tool-reference.md` (three tools), `docs/extension-api.md` (internal contract note),
  `docs/configuration.md` (removed keys), CHANGELOG, byte-count regression test.
- Byte-count regression test (< threshold, e.g. 2.5 kB total rendered).
- **Done-when:** docs match the three tools, no dead refs; CHANGELOG captures every removal;
  `test:unit` + `test:integration` green.

> VISION.md has already been updated with the facade principle and new refusals (2026-09) —
> M6's doc work keeps the rest of the repo consistent with it.

## Session protocol (prevents drift and confusion across sessions)

1. **Start:** read `plan.md` + VISION.md; the **current-milestone marker** at the top tells you
   where to start. Nothing else from the plan is in scope this session.
2. **During:** stay inside the milestone's Files / Verify / Done-when. If a milestone grows
   beyond the session, **stop at the last green checkpoint**, split it, and update the plan.
3. **Commit hygiene:** in worktrees that link `node_modules` (validation symlink), commit
   **explicit file lists only — never `git add -A`** (the link gets swept into the branch;
   M2's merge carried it and needed a corrective revert).
4. **End:** suite green; measurement recorded when applicable; plan.md status + current-milestone
   updated; committed. A milestone is never "mostly done" — it is done (done-when met) or not.

### M4 execution log — U3b-3 (skills/prompts truth sweep + repo-wide record)

Same defect class as U3b-2, in the other surfaces the model loads: `skills/pi-subagents/SKILL.md`,
its four `references/*.md`, `skills/council-mode/SKILL.md`, and `prompts/council.md`.

| Measured before | Detail |
|---|---|
| 8 control examples on the wrong tool | `subagent({ action: "list" })` fails the delegation schema's required `task`, so `/council` and the skill's own instructions could not list agents at all |
| 15 dead-verb examples | `children.list`, `doctor`, `refine`/`refine.show`/`refine.rollback`, and agent CRUD write verbs |
| `management-authoring-rpc.md` built on the removed write surface | 14 of its call examples were `create`/`update`/`delete`/`eject`/`disable`/`enable`/`reset` |
| stale subsystem text | RPC section described "child-safety depth" (removed in U2b-3) and told readers to "list children first" via a verb that no longer exists |

Rewrote `management-authoring-rpc.md` around the real surface (registry reads on `subagent_control`,
file-based authoring in place of the write verbs, the slash route for refinement), and corrected the
other six files. Also swept `docs/` for the params the disposition table removes rather than adds:
`topic`, `view`, `lines`, `index`, `mode`, `capabilities`, `additional`, `agentScope` no longer appear
as call params anywhere the model reads.

**Guard rewritten, not extended.** The U3b-2 test tracked the dropped params as an allow-list of
"U4 will fix these" gaps — which was wrong, because the table removes them. `trackedFacadeGaps` is
gone; the rules are now hard assertions:
1. only enum verbs may be mentioned;
2. control verbs must be shown on `subagent_control`;
3. **no** tool-call example for `get`/`validate`/`mission.create` (their inputs cannot cross the tool boundary);
4. **no** control example may pass a param the surface does not carry — `NEVER_MODEL_PARAMS` names the plan's removal set, and the failure message says which rule applies;
5. the parameter reference carries facade params only;
and the scanned file list now includes the skills and prompt templates, not just the guide topics.

**Found by the guard, in the guard:** the verb regex used `[a-zA-Z.]`, which cannot match a hyphen, so
rule 1 silently skipped `grant-spawn-budget` sitting in `docs/configuration.md`. Widened to
`[a-zA-Z][a-zA-Z.0-9-]*`; it immediately flagged the offending line. All five rules mutation-verified
(planted offender → red → restore → green), including a hyphenated dead verb and a removed param
planted in a skill reference to prove skill files are scanned. `tsc` 0, ratchet clean, unit
2658 pass / 0 fail / 11 skipped, integration 914 pass / 0 fail / 1 skipped.

**U3b-4 (same session, follow-on) — the delegation/workflow half, DONE.** The rules above only
policed control examples, so a sixth rule now covers the other two tools: *every delegation and
workflow literal may use only that facade's params*. It derives the sets from the schemas
(`SubagentDelegationParams` / `SubagentWorkflowParams` properties) rather than hardcoding them, and
it found 25 offenders in three files:

| Fix | Where |
|---|---|
| `subagent({ workflowScript })` → `subagent_workflow({ source })` | `docs/workflows.md` ×11, `execution-controls.md` ×2, `prompting-and-roles.md` ×1 |
| `subagent({ workflowScriptPath })` → `subagent_workflow({ source: { path } })` | `docs/workflows.md` |
| `subagent({ workflow, args })` → `subagent_workflow({ ... })` | `docs/workflows.md` ×4 |
| dropped `timeoutMs` / `toolBudget` from the call example | they are validated config keys (U1), so the prose now attributes the bound to configuration |
| dropped `context` (per D4, mode is agent-owned) | the literal in `prompting-and-roles.md`, the imperative in `prompts/council.md` and `skills/council-mode/SKILL.md`, and descriptive prose in `tool-reference.md` / `workflows.md` / `observability.md` reworded to agent-owned framing |

`docs/extension-api.md`'s `context:` and `workflowScript:` examples are **left alone on purpose**:
those are RPC and preflight contracts, which plan.md buckets as internal-contract fields, not model
tool calls. Orphaned validate prose in `workflows.md`/`tool-reference.md` was folded into statements
about launch-time validation, which does run (subagent-executor.ts:4677).

Rule 6 mutation-verified (a `subagent({ workflowScript })` planted in a skill reference → red →
restore → green). `tsc` 0, ratchet clean, unit 2659 pass / 0 fail / 11 skipped, integration
914 pass / 0 fail / 1 skipped.

### M4 execution log — U3b-2 (docs ↔ facade contract)

**Live defect, not a param trim.** The guide topics are served to the model at
runtime (`action: "guide"` → `readSubagentGuide`), and after the M1 facade cutover
they instructed the model to call things its own tool schema rejects:

| Measured | Evidence |
|---|---|
| 37 control examples named the wrong tool | prose said `subagent({ action: "status" })`; the delegation schema **requires `task`**, so following the docs launches a child instead of reporting status |
| 25 examples taught verbs the enum rejects | `children.list`, `worktree.discard/cleanup`, `inspector.*`, `doctor`, `refine*`, agent CRUD — verified rejected by an enum probe on `SubagentControlParams` |
| Parameter reference described the removed 81-param tool | 24 of 29 documented rows were not on any facade |
| 18 of 31 internal actions are unreachable | facade enum (11) ∪ slash (7 more) ∪ RPC manage (**empty allow-list**) |

Fixed in `docs/tool-reference.md`, `docs/agents.md`, `docs/configuration.md`,
`docs/extension-api.md`, `README.md`: renamed all 37 examples to
`subagent_control`, deleted dead-verb examples and the agent-CRUD block (D5),
replaced the parameter reference with the real facade surface, and rewrote
`extension-api.md`'s inspect section around the routes that actually dispatch
(`/subagents-fleet`, `/subagents-inspect-rpc`) instead of four unreachable actions.

**Regression test:** `test/unit/guide-docs-facade-contract.test.ts` parses every
`served topic → tool-call literal` with a brace-matching, string-skipping scanner
and asserts (1) only enum verbs, (2) control verbs ride `subagent_control`,
(3) no control example passes a param the facade drops except the tracked list,
(4) the parameter reference contains facade params only. All four rules
mutation-verified (planted offender → red → restore → green).

**New functional defect found while writing rule 3 — U4 must fix, docs cannot hide.**
`normalizeControlParams` (facade.ts) forwards **only** `id`/`action`/`message`, so
kept verbs are silently crippled at the tool boundary:

| Call the model can make | Executor receives | Consequence |
|---|---|---|
| `{ action: "get", agent: "scout" }` | `{ action: "get" }` | cannot inspect one agent |
| `{ action: "guide", topic: "agents" }` | `{ action: "guide" }` | always `overview`; 8 topics unreachable |
| `{ action: "status", view: "transcript" }` | `{ action: "status" }` | transcript tail unreachable (`view`/`index`/`lines`) |
| `{ action: "steer", mode: "follow_up" }` | `{ action: "steer" }` | delivery mode unreachable |
| `{ action: "list", capabilities: true }` | `{ action: "list" }` | capability rows unreachable |

Executor reads all of these (`params.topic` at subagent-executor.ts:5943,
`params.view` at :2456), so only the facade is missing them. **Unit tests do not
catch this** — they call the executor with the params directly, bypassing the
facade. Fix in U4: add `topic`/`view`/`index`/`lines`/`mode`/`agent`/`capabilities`
to `SubagentControlParams` + `normalizeControlParams`, then delete the matching
entries from `trackedFacadeGaps` in the contract test.

**Also found, same class, NOT yet fixed (next unit):** `skills/pi-subagents/references/*`
and `prompts/council.md` carry identical dead-verb and wrong-tool text
(`management-authoring-rpc.md` is built almost entirely around the removed
create/update/delete/eject/disable/enable/reset verbs, so it needs an authoring
pass, not a rename). Extend the contract test's file list when that sweep lands.

**Deferred at owner-gate 50% (ask_jeff, below the ≥60% threshold):** deleting
`handoffPath` + `repo` + the two dead `worktree.*` handlers +
`worktree-cleanup-plan.ts`, and `additional` + the dead `grant-spawn-budget`
handler. Both are on the REMOVE list, but neither has a replacement route
recorded: removing them leaves preserved worktrees reclaimable only by
`git worktree remove`/`git branch -D`, and spawn-budget grants unreachable. That
is a capability decision, so it waits for the owner rather than riding a
measured-reachability argument. `additional` is read **only** by
`grant-spawn-budget` (subagent-executor.ts:5893), so it shares the same gate.

### M4 execution log — U1 + U2a

**U1 — config layer (committed `f0928173`).** Kept + fail-closed validated the five enrichment keys
with real readers (`timeoutMs`, `toolTimeoutMs`, `checkpointBeforeDeadlineMs`, `toolBudget`,
`control`); dropped the five phantom validators (`model` — no global-reader call site;
`agentScope`/`fast`/`includeProgress`/`outputMode` — declared per-agent instead; `model` stays an
unvalidated *passthrough* so `subagents.defaultModel` still reads it); completed `toolDescriptionMode`
removal end-to-end (load-time throw, `ToolDescriptionMode` type, zero-arg
`buildSubagentToolPromptMetadata()`, custom-template lookup, docs "Removed:" section). New
`test/unit/config-enrichment-keys.test.ts` (8 tests) proves each kept key reaches the runtime output
it documents and each rejected key throws. 2715 / 0 / 11.

**Owner ruling: children must not launch subagents → delete the fanout-child subsystem.** U2 split:

- **U2a — capability removal (committed).** `git rm src/extension/fanout-child.ts` +
  `test/unit/nested-control.test.ts`. Removed `fanoutAuthorized` (tool-plan decision), `fanoutChild`
  (runtime config), the `FANOUT_CHILD_EXTENSION_PATH` child grant, `allowNestedSubagents`
  (frontmatter + builtin override + every plumb-through: preflight, agents, serializer, management,
  registry, launch-contract, async-execution, async-resume, runner, child-launch, execution,
  parallel-utils, dynamic-fanout, types), the child-side writes that existed only so fanout children
  could route (`nestedRoute`/`nestedParent`/child `runFanoutBudget` in child-launch), the fanout
  boundary prompt variant + `preserveFanoutToolHistory`, and the fanout child-safe `runtimeState`
  block. **Enforcement is explicit per hard cutover:** an agent listing `subagent` in `tools`, or
  setting `allowNestedSubagents` in frontmatter or a builtin override, throws naming the removal. A
  child session never registers a delegation tool (`index.ts` still early-returns under
  `SUBAGENT_CHILD_ENV`). Parent-side fanout (`dynamic-fanout`, `run-fanout-budget`, spawn budgets) is
  **kept** — it budgets a parent's own children. Docs corrected (agents/configuration/observability);
  the skill's stale "children spawn subagents when delegated" claim rewritten. 2688 / 0 / 11
  (−27 fanout tests, +1 enforcement test); `in-process-child` 25/25 and `single-execution.part-2`
  164/164 green.
- **U2b — dead depth plumbing.** Three units, all committed: U2b-1 (child-safe management boundary),
  U2b-2 (dead `project.*` actions + `projectOpen`), U2b-3 (depth cap). Remaining candidates from the
  original list: `ExecutorDeps.childRuntime` wholesale removal and child-side `runFanoutBudget`
  remnants — see the U3b notes; `nested-events.ts` and `nested-path.ts` are **load-bearing** (below).
  - **U2b-1 DONE (`52b84fce`) — removed the child-safe management boundary**: the
    `allowMutatingManagementActions` dep, `MUTATING_MANAGEMENT_ACTIONS`, the seven
    `child-safe subagent fanout mode` guards, and the fixture param. Verified dead first: the executor
    is built at `index.ts:584`, *after* the child early-return at `index.ts:391`, and the deleted
    fanout-child was the dep's only setter. `nestedResolutionScopeForExecutor` keeps its
    `!route -> undefined` early return so non-child callers are unchanged. The 23 positional
    `makeExecutor` call sites were rewritten with the TypeScript compiler API — a hand-rolled comma
    splitter corrupted both integration files first (restored from git); positional args are a trap.
  - **Correction:** `nested-events.ts` is **load-bearing, not dead** — the Fleet tree, run-id
    resolution and the runner's own self-events read it (`buildNestedRouteIndex`,
    `projectNestedRegistryForRoot`, `findNestedRouteForRootId`, `readNestedRegistry`). Keep the
    nested-event surface; only the child-side route/nestedParent writes are dead.
  - **U2b-3 DONE** (`24e16687`) — **`maxSubagentDepth` removed** (owner: "clean up maxSubagentDepth
    too"; option 2 of the three previously recorded here — remove the cap entirely rather than give it a
    validator or document depth-0 as an intentional kill switch). Executed the measured mapping, `tsc`-driven: deleted
    the Recursion Depth Guard section of `types.ts` (all six resolve/check helpers,
    `DEFAULT_SUBAGENT_MAX_DEPTH`, `SubagentDepthContext`, `SUBAGENT_MAX_DEPTH_ENV`), the three executor
    depth gates, the `SteeringRecoveryDescriptor` / `RunSyncOptions` / `Async*Params` / chain-step /
    launch-contract fields, the recovery-descriptor field + its allow-list entry, the
    `ChildRuntimeConfig.depth`/`maxDepth` fields and their inheritance, and the `depth` parameter of
    `applyForceTopLevelAsyncOverride` (`depth === 0 && force` ≡ `force`). Hard cutover in the U1/U2a
    shape: config still setting the key throws by name and is in `FAIL_CLOSED_CONFIG_KEYS`; agent
    frontmatter fails discovery by name. Kept `depth` on nested-parent addresses and the unrelated
    render/preflight caps. `recursion-guard.test.ts` deleted (it tested the removed contract); the
    frontmatter tests now assert the removal error; child-runtime depth assertions deleted, not
    neutered; both new guards mutation-verified. 2665 / 0 / 11, integration 915 / 0 / 1, `tsc` clean.
    **Lesson: an integration test declared the helper's old signature in its own local `interface`, so
    `tsc` could not catch the arity change — signature changes to exported helpers need the test files
    read, not just typechecked.**
  - **U2b-2 candidate found (measured):** the Herdr-panes removal left `project.open`/`project.status`/
    `project.close` in `SUBAGENT_ACTIONS` (types.ts:2552) with **no handler** in the executor — they
    fall through to "Unknown action", and the enum is built from that list. `authorityPolicy.projectOpen`
    (authority.ts:8,22) is a **documented** config key (`docs/configuration.md:486`) whose only consumer
    was that removed path — the same phantom-validator class U1 deleted. Also two schema descriptions
    still mention `project.open` (schemas.ts:284,288). Plan's action long-tail already says remove
    `project.*`; do it as one narrow unit (enum entries, policy action + default, 2 schema descriptions,
    docs row, `test/unit/authority-policy.test.ts` assertions, CHANGELOG — user-facing key removal).
    `focus` (REMOVE list) is the adjacent same-file edit.
  - **U2b-2 DONE** (`4cfe6a1c`): removed the three dead action entries, the `projectOpen` authority
    action + default + executor mapping, and the two stale schema descriptions. `focus` **stays** — the
    owner ruling (top of this plan) keeps it inspector-owned; only its description lost the project-pane
    reference. Because `projectOpen` is a *documented* key, it follows the U1 precedent: a named removal
    throw, plus the fail-closed config list extracted into `FAIL_CLOSED_CONFIG_KEYS` with a nested-key
    check, so a stale file reports the removal instead of degrading to defaults. Proven by mutation:
    neutralising the nested check turns the new regression test red, restoring it is green.
    2686 pass / 0 fail / 11 skipped, integration part-1 98/98, `tsc` clean.
  - **U3a DONE** (`08506dde`): the dead-schema half of U3. `ChainItem`, `ParallelTaskSchema`,
    `DynamicExpandSchema`, `DynamicParallelTemplateSchema`, `DynamicCollectSchema` had **zero importers
    and zero references from `SubagentParamProperties`** — `chain` is not a model-facing key at all
    (legacy top-level chain/parallel input is rejected in `public-execution`). `OutputOverride`,
    `ReadsOverride`, `ChainGateOverride` became definition-only and went with them: 119 lines, pool
    unchanged at 56 keys, 2686 pass / 0 fail, integration `in-process-child` 25/25.
  - **Reachability, not reference-count, is the U3b test.** Measured per key: the model can pass 15
    keys across the three facades; `rpc.ts` writes 14 more into its per-method params; slash adds
    `agentScope`/`config`/`control`/`index`/`view`/`workflowScript`. That leaves **37 pool keys no entry
    point can deliver**, each with live executor *readers* but no producer — dead-read branches, which
    is exactly what the pool trim should take. `createSubagentParamsSchema` (schemas.ts:231) has zero
    callers and should go with them.
  - **`tsconfig.json` includes only `index.ts` + `src/**` — `tsc` cannot see `test/`.** This is the
    mechanism behind the U2b-3 local-interface lesson. **Corrected after measuring:** the obvious
    prescription ("just add `test/**` to the typecheck") does **not** fix the U2b-3 class. A minimal
    probe showed why — the trap files resolve the module through `tryImport<LocalShape>` and then call
    *through the locally declared shape*, so call and declaration agree with each other and `tsc` is
    blind either way. It caught only drift where the local copy and its call sites disagreed.
  - **U3b-1b — process fix landed instead: a test-aware typecheck ratchet.** Adding `test/**` to the
    gate reports **2093 errors across 118 files** (only 88 come from `noUncheckedIndexedAccess`), which
    is its own milestone, not a param trim. So `tsconfig.test.json` + `scripts/typecheck-tests.mjs`
    typecheck src+test and enforce a **committed per-file baseline** (`test/typecheck-baseline.json`,
    2091 errors / 117 files): a file may only ever go *down*, new files start at zero, and a shrunken
    count must be refreshed with `--update`. `--files <paths>` gates just the files a unit touched,
    which is what M4 units use — it makes stale test-side signatures visible on the next edit instead of
    silently green. Wired as `npm run typecheck:tests` and into CI (Linux job only: per-file *counts* can
    drift across platforms, the scoped mode cannot). Verified by mutation in both modes (planted error →
    red → restore → green); publish `files` untouched, `build:pkg` unaffected.
  - **Two real defects the ratchet exposed and fixed** (`add71be3` + this unit): (1)
    `agent-overrides.test.ts` called `removeBuiltinAgentOverride` with a 4th `{ preserveMachine }`
    argument the function lost in the saved-machine removal — invisible at runtime (extra args are
    discarded) and invisible to `tsc`, so the test was green while asserting nothing about its own
    title; rewritten against the live contract and mutation-verified. (2) `test/support/helpers.ts`
    declares its **own local `AgentConfig`** (the trap again) that was missing `inheritGlobalContext`,
    a field both its factories always set. `machine`/`machineCwd` in `AsyncRunnerStepBuildParams` had
    zero producers and zero readers and went with them. **The ratchet's first run found two live masked
    defects — that is the case for it.**
  - **U3b-1 DONE — `chatProgress` removed** (pool 56 → 55). Unreachable from every entry point *and* on
    the REMOVE list. With no way to request a mode, `auto` is the only behaviour, so
    `resolveWorkflowChatProgress` lost its `requested` input and both error returns (both were
    `requested`-only) — it is now total, returning `WorkflowChatProgressProjection` directly. Kept
    `details.chatProgress` and the whole TUI live-card path, which are live. Tests: the impossible
    `explicit off` rendering scenario was deleted, not neutered; `schemas.test.ts` now asserts the key is
    absent from the public pool. `tsc` 0, 2653 pass / 0 fail / 11 skipped, integration 914 / 0 / 1.
  - **Pool measured: 56 keys, not 68** (the plan's figure predates M1–M3; now 55). Remaining U3b/U5 work is the
    REMOVE-list survivors still in the pool — cheapest first by `src`/`test` file count:
    `steeringRecovery` 4/2, `additional` 6/8, `handoffPath` 5/6, `share`/`sessionDir`,
    then `childId` 15/13, `repo` 8/42. `merge`/`supersession`/`sessionOnly`/`quiet` as *params* are
    already gone (M3); `planId` survives only as an internal cleanup-plan field, not a param.
  - **M3 already covered by earlier milestones** — `schedule.*`/`watchdog.*`/`lane` count zero in
    `schemas.ts`, so U3 is only the key trim, not a second subsystem pass.
  - **M6's byte-budget test already exists** (`schemas.test.ts:740`, < 3000 chars across the three
    facades); U3a removed dead weight, threshold untouched.
- **U3b** trim the 56-key pool to facade/RPC-derivable keys; **U5** the REMOVE-list params end-to-end.
  - **U4 as previously written here is CANCELLED — it contradicted the disposition table above.**
    An earlier session recorded "U4: add `topic`/script-source/`mission` to the control facade". The
    param-disposition table is the owner's, and it says the opposite: `topic`, `view`, `lines`, `mode`,
    `index`, `childId`, `handoffPath`, `repo`, `additional`, `share`, `sessionDir` are **Remove
    entirely**; `agentScope` is **Config-enriched**; `capabilities` and `mission` are
    **Extension/API-only**. So the control facade stays `id`/`action`/`message`, and the fix for the
    dropped params is to stop teaching them (done in U3b-3), not to add params back.
  - **Owner-gated residue:** `get`, `validate`, and `mission.create` are on the control enum (D5/D6/D2
    keep them) but cannot receive their required inputs — `agent` (delegation owns it; the M1
    invariant forbids sharing), a script body (`source`/`args` are workflow-owned), and `mission`
    (bucketed internal-only). Measured: `handleGet` returns "Specify 'agent' for get." with no agent;
    `validateMissionLaunch(undefined)` throws "mission must be an object"; `validate` with no script
    returns an error payload. Resolution is an owner call: drop the three verbs from the enum, or
    admit the params (grow the exempt set / add `source` to control / put `mission` on a facade).
  - **Do not blind-remove `steeringRecovery`.** It is absent from all three facades (delegation 8 keys,
    workflow 6, control 3) so the model cannot pass it, but the two internal callers (`rpc.ts:526`,
    `slash-commands.ts:1091`) pass `false` to *suppress* a `recover` callback the executor builds
    (`params.steeringRecovery === false ? {} : { recover: ... }`). That makes it an internal contract
    field, which the M4 done-when rule allows. Removing it means hard-wiring the RPC/slash steer
    ownership semantics — a behaviour change, not a trim. Decide with the owner or leave it as internal.
  - **`ExecutorDeps.childRuntime` wholesale removal is a separate unit.** After U2b-3 the dep still
    carries `nestedRoute`/`nestedParent`/`requiredExtensions`/`runFanoutBudget`, and it has **zero
    assignment sites** in `src` (`index.ts:562` omits it; `index.ts:391` returns before the executor is
    built for child sessions; no test passes it). Every `inheritedNestedRoute(deps)` read is therefore
    always `undefined` in production — the same dead-plumbing shape U2a/U2b-1 removed. It is a large
    blast radius (status tree, run-id resolution, runner self-events), so scope it deliberately rather
    than folding it into a key trim.

**pi-lens residual added in U3b-1 (recorded, not fixed — option-a precedent).** The lens gate fires on
`src/extension/schemas.ts` L5–22 (`pruneNestedDescriptions`: `unknown` param/return, two `typeof`
narrowings, an assertion without `SAFETY:`) and on `src/workflows/chat-progress.ts` L95–98 (`cleanLabel`:
`unknown` param + `typeof`). Both regions are **byte-identical to HEAD** (`git diff` shows the only
schemas.ts change is the deleted `chatProgress` line; `cleanLabel` appears in zero diff lines), and
`pruneNestedDescriptions` was introduced by `a512bb7f`, which `git merge-base` confirms is an ancestor of
the M4 start — carried baseline, not this milestone's code. The one finding on a line I actually wrote
(chat-progress.ts conditional spread) was fixed.

**pi-lens residual (recorded, not fixed — option-a precedent, sessions 4–6).** `src/extension/index.ts`
reports 26 findings (17 errors: `no-runtime-typeof`, `require-exact-type`,
`no-conditional-empty-object-spread`, `no-known-value-widening`, `no-unsafe-dictionary-type`).
Verified byte-identical to HEAD (`git diff HEAD -- src/extension/index.ts` empty) with flagged lines
present verbatim at HEAD; U1 touched one line there (699) and U2a touched none. The findings are a
whole-file re-scan artifact of advanced lens packs on **carried baseline code**, so per plan
discipline they are recorded, not refactored mid-milestone.

## Resolved decisions (owner, 2026-09)

- **D1** Multi-lane orchestration → **remove entirely** (surface + `runs.lanes` DSL + actions + doc). Flag if the script-level `runs.lanes` API was meant to survive.
- **D2** Schedules + watchdog → **remove** (watchdog is a redundant second path over config; reviewer workflow composes; cron/OS covers schedules). **Missions → keep**, trimmed.
- **D3** `toolDescriptionMode` → **remove** the config option; shorten the default description.
- **D4** Per-call context *mode* → **remove** (agent-owned). **Add `prequel` field** (name locked): model-authored context/summary of the chat, separated from `task`; consumed for `fork|summary`, empty with `fresh`.
- **D5** Agent-management CRUD → **remove write** from the model surface; read verbs stay. The model can read the registry and name an agent, but cannot create/edit/disable/delete one.
- **D6** `preflight` param → internal-only; `validate` action stays on the model surface.
- **D7** `reads` → keep per-call (plain list of file paths) + agent `defaultReads` compose.
- **D8** `defaultContext` per agent → **keep**, and the call cannot override it; missing → `fresh`.

## Risks / guardrails

- **Breaking release surface:** one `subagent` tool → three tools is a hard cutover for any
  user/extension that calls the tool by name; internal contracts (`executePublic`, preflight,
  delegation) stay stable so the engine and bridges survive.
- **Behavior change:** params moved to config must have a config key *before* removal,
  else the model silently loses the ability to set them.
- **Small-model regression:** description too terse → model misuses a tool; mitigated by
  live agent list, guide topics, and the `validate` action.
- **Engine untouched until M4** keeps each PR narrow (VISION: scope must earn size).
- **Test churn is a feature:** delete assertions for removed behavior; do not neuter them.

## Resume checklist (next session)

1. Start **M4 — Enrichment + param sweep**: add validated config keys for the config-enriched
   params **before** removing their per-call forms, then delete the REMOVE params end-to-end
   (types, executor, preflight, TUI, docs, tests). `focus` stays (inspector-owned). Verify by
   grep: removed names → zero hits; suite green; obsolete assertions deleted, not neutered.
   Each is an independent, narrow PR; keep one writer per worktree; reviewer each before merge.
   Follow the session protocol.
2. Reuse the M3.1 orchestration lesson: scout map must include the subsystem's OWN test files
   (the lanes scout missed scripted-workflow.test.ts); reviewer verdicts are evidence to verify
   (a tool-less reviewer misread test titles as executable DSL tests — parent re-verification
   caught it, but cheaper to give the reviewer a verified evidence pack).
3. Gate each milestone on `npm run test:unit` (+ `test:integration`; the integration suite is
   GREEN at HEAD after M3.3b — part-1 98/98, part-2 165/165, part-4 28/28, plus the 4 smaller
   files; the former "env-shaped" baseline failures were the fake-child-session.ts dangling-
   `else` bug, fixed). Full-file integration runs hang at process exit in this sandbox — judge
   by per-test ✔/✖ lines, not the final summary).