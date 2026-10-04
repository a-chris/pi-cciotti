# Context for: Remove chain orchestration — worker brief (post-Steps 1–6)

Repo `a-chris/pi-cciotti`, worktree `/Users/chris/github/.pi-perl-pi-subagents-remove-chain-orchestration`, branch `perl/work-remove-chain-orchestration`, working tree CLEAN. Read `plan.md` (EXECUTE STATUS section first) and `VISION.md:50-57` (hard cutover: no aliases/legacy paths; tests prove current contract, delete obsolete assertions instead of serving them).

**Everything below was re-verified against the current tree in this scout run** (commits `fa218edd`, `0e84f094`, `7157bcad`, `a543a9a8`, `f018ee38` = plan.md with EXECUTE STATUS). Plan's Steps 1–6 are committed; do NOT redo them. What "done" means is verified below under **Current State** — including places where the plan's "done" claim is contradicted by the tree.

# Files Retrieved

- `plan.md` (whole file) — scope, findings 1–10, steps, verification, EXECUTE STATUS.
- `src/slash/slash-live-state.ts` (310 LOC, whole) — 3 of the 16 tsc errors.
- `src/tui/render.ts` (3646 LOC; read error-line neighborhoods) — 13 of the 16 tsc errors.
- `src/shared/types.ts` (:385 modes, :813 AsyncJobState key list, :1306 `chainAgents?`, :2524 `WORKFLOW_RUNS_DIR`) — mode/type surface.
- `src/extension/public-execution.ts` (:120-180) — surviving loud-rejection shape (steps 1 done).
- `src/runs/background/subagent-runner.ts`, `src/runs/shared/chain-outputs.ts` (30 LOC), `src/runs/background/parallel-groups.ts` (45 LOC), `src/runs/background/async-root-attachment.ts` (256 LOC) — surviving modules with chain-origin names.
- `scripts/typecheck-tests.mjs` (whole) + `test/typecheck-baseline.json` — test typecheck ratchet mechanics.
- `package.json`, `knip.jsonc`, `VISION.md:45-60`, `docs/*` (grep), `test/` (targeted greps + a 17-file `node --test` run for baseline failures).

# Current State (verified against tree — read this first)

## 1. `npm run typecheck` is RED — exactly 16 errors (re-run confirmed, list is complete)

**`src/slash/slash-live-state.ts` (3):**
- `:87` `mode: "parallel"` — inside `buildParallelInitialResult` (dead: `params.tasks` no longer reachable).
- `:147` `mode: "chain"` — inside `buildChainInitialResult` (dead: `params.chain` no longer reachable).
- `:231` `details.mode === "chain"` — inside `applySlashUpdate` (currentStepIndex propagation).

Dead-with-them (delete too): `isParallelChainStep` (:111), `chainStepLabel`, `flattenChainResults`, `ChainStepLike`/`SequentialChainStepLike`/`ParallelChainStepLike` types (:28-39), and the `buildSlashInitialResult` dispatch that picks parallel/chain (:246-250) — reduce to `buildSingleInitialResult` only (`mode: "single"`; it already handles `workflowScript` via `previewSimpleWorkflowRun`).

**`src/tui/render.ts` (13):** `:1896`, `:1897`, `:1900` (inside `buildMultiProgressLabel` — `hasParallelInChain`/`activeParallelGroup`/`itemTitle`), `:2009`+`:2023` (inside `widgetStats` `job.activeParallelGroup` / `job.currentStep` branches), `:2163` (nested-children `steps` condition), `:2331` (`widgetChainDetails` call), `:2341`+`:2371` (step totals), `:2388` (compact widget collapse condition), `:3140`+`:3462` (duration aggregation `d.mode === "chain"`).

Surviving render machinery to KEEP (workflow path): `buildChainStepSpans` (:1620, uses `workflowGraph` first, falls back to `chainAgents`), `buildAsyncChainStepSpans`, `ChainStepSpan` interface (:1619), `flatToLogicalStepIndex` (import :31 from `../runs/background/parallel-groups.ts`), `activeParallelWidgetGroup`/`parallelWidgetGroupDetails`/`widgetParallelAgentDetails` (already de-chained in a543a9a8), the `mode === "workflow"` branch inside `buildMultiProgressLabel` (:1930-1948), workflow checklist/stage/`workflowGraph` projection. `widgetChainDetails` (:1565-1584) dies. Only delete dead branches — keep composite `"workflow"` step rendering through the surviving steps/workflowGraph projection. `chainAgents` (types.ts:1306) and `chainStepCount`/`parallelGroups`/`currentStepIndex`/`totalSteps` fields REMAIN on `Details`/`AsyncJobState` and are read by surviving code (async-job-tracker still normalizes them) — do not delete those fields now.

## 2. Verification grep 1 will still fail after the 16 errors are fixed — 30 hits today, categorized

`grep -rn "\"chain\"\|chainName\|chainDir\|append-step" src --include='*.ts'` currently:
- **Must-fix (the 16 tsc errors):** `tui/render.ts:1896,1897,1900,2009,2023,2163,2331,2341,2371,2388,3140,3462`; `slash/slash-live-state.ts:147,231` (+ `:87`).
- **Plan-authorized keep (loud rejection / survived guards):** `extension/public-execution.ts:141,146,155` (`chainName`/`chainDir`/`"append-step"` rejection detection — step 1 done, message generic: "Unknown or unsupported top-level parameter. Public execution supports only { agent, task? } … and the current control actions."); `workflows/scripted-workflow.ts:397,2115` (legacy top-level param guards); `slash/prompt-workflows.ts:27,87` (`chain:` frontmatter → workflowScript — acceptance criterion 3, must NOT touch).
- **Leftover from step 5 the plan claims done but the tree contradicts — decide + fix (compiles, so no tsc signal):** `missions/types.ts:12` `MissionRunMode = "single" | "parallel" | "chain" | "workflow" | "external"` (plan step 5 says → `"single" | "workflow" | "external"`; no commit touched missions), `missions/store.ts:34` (same `MISSION_RUN_MODES` set — if you narrow `MissionRunMode`, this set is a type error → update it), `missions/lifecycle.ts:354` (`["single","parallel","chain","workflow"].includes(event.mode)` — narrow and coerce persisted old values, e.g. map legacy chain/parallel to `"single"` or drop), `slash/delegation-adapters.ts:68` (mode union `"single" | "parallel" | "chain" | "workflow" | "management"` — collapse to `"single" | "workflow" | "management"`).
- **Name-only residuals in surviving code (plan silent; compiles; grep-flagged — rename only if you want grep 1 fully clean, otherwise document):** `shared/settings.ts:170-174` `resolveChainPath(filePath, chainDir)` — now internal only, resolves instruction paths; rename to non-chain name (e.g. `resolveInstructionPath`/`instructionDir`). `runs/foreground/subagent-executor.ts:299` `chainName?: string` and `:382` `chainDir?: string` on `SubagentParamsLike` — required by public-execution's rejection checks; keep unless you also rework the rejection.

## 3. Tests: what actually fails today (empirical run of the affected unit files)

Ran all 17 flagged unit files. **Failing now:**
- `test/unit/agent-frontmatter.test.ts` — whole file fails to LOAD: `ERR_MODULE_NOT_FOUND …/src/agents/chain-serializer.ts` (import at `:9` `import { parseChain, serializeChain }`). Must strip all chain fixture tests (file is ~2.3k lines; only the `chain-serializer` import and `.chain.md`/`.chain.json` fixture tests die).
- `test/unit/async-root-attachment.test.ts` — whole file fails to LOAD: stale import `:7` still points at renamed `../../src/runs/background/chain-root-attachment.ts` → retarget to `async-root-attachment.ts`. Also `:27` tempDir prefix `pi-chain-root-attachment-` and describe title "async chain root attachment" (:24) are cosmetic chain names — rename, keep surviving-function assertions.
- `test/unit/agent-discovery-cache.test.ts` — 5 failing: "agent discovery snapshots", "invalidates agent and chain projections when files change or appear", "does not parse chains on the ordinary effective discovery fast path", "cold includeChains=true still materializes chains", "does not re-include excluded package roots or change chain discovery" (`.chain.md` fixtures at `:103,:226,:334-353`).
- `test/unit/agent-exclude-dirs.test.ts` — 1 failing: "settings subagents.agentExcludeDirs" (`.chain.json` fixtures at `:212,:219`; exclusion behavior no longer chain-aware — drop the two chain fixture wrangles or fold into agent-only assertions).
- `test/unit/pi-coding-agent-dir.test.ts` — 2 failing: "PI_CODING_AGENT_DIR runtime paths" and "discovers user agents, chains, and settings" (`.chain.md` at `:119,:141`, asserts `discovered.chains` — field no longer exists).

**Passing today (verified — do NOT strip these):** `agent-management`, `doctor`, `proactive-skills`, `public-execution`, `notify`, `preflight`, `path-resolution`, `delegation-api`, `child-tool-plan`, `prompt-template-bridge`, `config-enrichment-keys`, `authority-policy`, `async-resume`.

⚠ **Important: the plan's "strip `'was removed'`/`'Legacy '` assertions" instruction is over-broad and will destroy unrelated coverage if followed mechanically.** Verified: `notify.test.ts:421` "Legacy cwd-scoped done", `pi-coding-agent-dir.test.ts:327,334` (`modelExclusions was removed`), `delegation-api.test.ts:578,586` + `prompt-template-bridge.test.ts:216` (prompt-template delegation), `child-tool-plan.test.ts:95` (`'subagent' tool was removed`), `authority-policy.test.ts:18` + `config-enrichment-keys.test.ts:95-108` (`projectOpen`/`maxSubagentDepth`/`toolDescriptionMode` removed), `path-resolution.test.ts:76` ("Legacy agent" in a `.agents` dir fixture), `preflight.test.ts:574-576` (`.agents` legacy dir fixture), `async-resume.test.ts:368-369` (turn-budget recovery) — **none are chain-related; all 13 of these files pass today**. Only strip chain-driven assertions (the `.chain.md`/`.chain.json` fixtures and `append-step`/`chainName` cases). The plan's own `proactive-skills` note ("only the chain-discovery-driven cases; keep the pure recommend/format cases") is the correct discriminator — apply it everywhere. `proactive-skills.test.ts:31` (`filePath: /tmp/${name}.chain.md`) and `doctor.test.ts:45` (`filePath: /tmp/${name}.chain.md`) are fixture helpers feeding chain-discovery-shaped input; both files pass because the fixtures are inert — judge by the plan's note, don't cascade-delete.

**Still to strip — chain assertions that do NOT fail today but contradict the cutover (plan step 9):**
- `test/unit/public-execution.test.ts:175` (`action: "append-step"`) and `:188` (`chainName: "review-pipeline"`) — legacy-rejection tests; rewrite to assert the surviving generic rejection (or delete).
- `test/unit/agent-management.test.ts:764-766` (`.chain.md` fixture files in a "keeps old chains" scenario) — passed today; plan says strip.
- `test/integration/async-execution.part-3.test.ts:21` imports deleted `../../src/runs/background/chain-append.ts` (whole-file load failure; also `append-step` cases at `:1536-1586`).
- `test/integration/single-execution.part-2.test.ts:3239` `action: "append-step"` + expect "Cannot append step: …" — executor no longer dispatches append-step; the rejection path survived as the public-execution generic message; update or delete.
- **GAP (not in plan's list): `test/integration/external-cli-runner.test.ts:8` imports deleted `chain-append.ts` (`enqueueChainAppendRequest`) and a whole test at `:347-397` "applies external idle attention to runtime-appended chain steps" with `resultMode: "chain"`. Broken import → `test:integration` fails. Delete that test + import.**
- New test to ADD (current-contract, plan-authorized): discovery emits the loud rejection diagnostic — unit test asserting `Chain definitions (.chain.md/.chain.json) were removed; convert to workflowScript (see /prompt-workflow)` appears as an `AgentDiscoveryDiagnostic`-style entry when a scan hits `chains/` dir or `*.chain.md`/`*.chain.json` (see `src/agents/agents.ts:1844,1836,2196`). Natural home: `test/unit/agent-discovery-cache.test.ts`.

**Test-typecheck ratchet (`npm run typecheck:tests`):** script `scripts/typecheck-tests.mjs` only fails on (a) files whose per-file tsc error count EXCEEDS `test/typecheck-baseline.json`, (b) baseline entries no longer producing errors ("stale"). Right now (a) is triggered by the 4 broken-import test files and (b) by stale baseline entries `test/unit/chain-append.test.ts` / `test/unit/dynamic-fanout.test.ts` (:58,:66) for files already deleted. After fixing tests, run `node scripts/typecheck-tests.mjs --update` and commit the shrunken baseline. (The earlier worker already renamed `chain-root-attachment.test.ts` → `async-root-attachment.test.ts` in the baseline.)

## 4. Docs (step 10) — `grep -rn "chain" docs/` = 35 hits

- `docs/agents.md`: `:29` (".chain.md files do not define agents" — reverse it: they no longer define anything; loud-reject), `:246`, `:352`, `:376` (chain/parallel acceptance & skill wording).
- `docs/configuration.md`: `:19` (chains anchored to git-root), `:49` ("chain discovery keeps its own unchanged watches" — delete), `:138` (parallel/chain children share a tab), `:256` (forceTopLevelAsync wording), `:264` (:timeoutMs composite), `:270` ("async chains, parallel tasks…"), `:310`, `:324` (spawn budget wording incl. "appended chain steps"), `:332`, `:346` (static chains/parallel), `:521` ("…keeps its legacy name for compatibility" — delete; `chain-runs` → `workflow-runs`).
- `docs/observability.md`: `:13,:17,:41` (chain/parallel live-progress wording), `:267-270` ("still named `chain-runs` for compatibility" — rename to `workflow-runs`; artifact layout is `…/workflow-runs/{runId}/` now, constant `WORKFLOW_RUNS_DIR` at `src/shared/types.ts:2524`).
- `docs/extension-api.md`: `:140` ("single, counted parallel, and chain children"), `:487-488` (discovery row "Agent and chain discovery"; executor row "single, parallel, chain, management").
- `docs/models.md`: `:136`. `docs/tool-reference.md`: `:9,:265,:342`.
- `docs/workflows.md`: `:125`, `:137` (scripted chaining — keep, this is the surviving path), `:252` (`{chain_dir}` legacy template keeps working — keep, it's live behavior), `:254-260` (migration section — rewrite to read as "these shapes were removed"), `:325`, `:379` (legacy commands not registered).

# Key Code

- `SubagentRunMode` — `src/shared/types.ts:385` `"single" | "workflow"`; `SubagentResultMode = SubagentRunMode` :386. Collapsed already.
- `MissionRunMode` — `src/missions/types.ts:12` still has `"parallel" | "chain"` (leftover, see above).
- `WORKFLOW_RUNS_DIR` — `src/shared/types.ts:2524` (`TEMP_ROOT_DIR/workflow-runs`), `DIRS.workflow` :2530. Artifact rename already landed in `src/shared/artifacts.ts` (0e84f094) and `src/extension/doctor.ts:52,229` ("workflow runs") — **docs are the only remaining `chain-runs` mentions** (verified: zero `chain-runs`/`CHAIN_RUNS_DIR` hits in `src/`).
- Surviving renamed module: `src/runs/background/async-root-attachment.ts` — consumed by `subagent-runner.ts:135` (`waitForImportedAsyncRoot`, incl. step handling at :676-720) and `subagent-executor.ts:85` (`resolveAsyncRootResultPath, waitForImportedAsyncRoot`). All imports updated.
- Deleted modules (do not re-create): `agents/chain-serializer.ts`, `background/chain-append.ts`, `shared/dynamic-fanout.ts`. Still present but ONLY `subagent-runner.ts` imports them: `chain-outputs.ts` (30 LOC, `subagent-runner.ts:88`) and `parallel-groups.ts` (45 LOC, `render.ts:31` `flatToLogicalStepIndex`, `async-job-tracker.ts:20`, `async-status.ts:12`, `stale-run-reconciler.ts:9` `normalizeParallelGroups`) — both compile and have live consumers; **out of remaining scope unless knip/tests prove otherwise** (do not port chain behavior into them).
- Loud rejection, already in `src/agents/agents.ts`: scan collects `chainFiles` (:1801,:1836-1837,:1844) and `:2196` pushes diagnostic "Chain definitions (.chain.md/.chain.json) were removed; convert to workflowScript (see /prompt-workflow)". Residual types `ChainConfig` (:235)/`ChainStepConfig` (:212) stay for `proactive-skills.ts`/`identity.ts` (plan finding 7 — do NOT remove).
- Also untouched on purpose: `src/slash/prompt-workflows.ts:211-234` `chain:` → workflowScript compilation.

# Architecture

`index.ts` → `src/extension/index.ts` → foreground `runs/foreground/subagent-executor.ts` / background `runs/background/async-execution.ts` (spawns `subagent-runner.ts` child processes) / slash `src/slash/*` / TUI `src/tui/*` reading async-status projections. `workflowScript` is now the only orchestration path; `"chain"`/`"parallel"` survive only as (a) legacy-input rejections, (b) persisted-data unions (`MissionRunMode`), and (c) mode comparisons awaiting deletion (the 16 errors). Data exits via result files under `DIRS.results`/`DIRS.async` and `WORKFLOW_RUNS_DIR`.

# Existing Conventions

- Each step ends with `npm run typecheck` green; verification order is fixed: typecheck → typecheck:tests → test:all → check:dead-code → 3 greps (see below) + manual smoke.
- Hard cutover/no aliases (VISION.md:50-57). Delete stale assertions; never rewrite production to serve old tests. Everything added by knip/tsc arbitrates deletions.
- `knip.jsonc`: unused `exports`/`types` are non-blocking warnings; all other knip findings are hard errors. Dead exports in `src/shared/utils.ts` are a known knip blind spot.
- `typecheck:tests` is a per-file error ratchet against `test/typecheck-baseline.json`; refresh with `node scripts/typecheck-tests.mjs --update` after test deletions and commit the shrunken baseline.
- **npm repo** — do NOT run pnpm, do not re-create `pnpm-lock.yaml`; stray `x` file must not reappear (both removed in 6017e46e).
- Rule of thumb used throughout the earlier steps: `grep -rln` then adjudicate per file — a hit is not automatically a deletion target (proactive-skills precedent).
- `test/smoke/standalone-shared.ts:21` still calls the public API with `chain:` params — a manual smoke fixture only (not in `test:all`), but it exercises removed API surface; update or remove it while in there.

# Verification (already shipped shell of each command; run in order)

```bash
npm run typecheck          # currently RED: 16 errors — target: green
npm run typecheck:tests    # currently RED (broken test imports + stale baseline) — run `node scripts/typecheck-tests.mjs --update` after test edits
npm run test:all           # currently RED (agent-frontmatter, async-root-attachment, agent-discovery-cache, agent-exclude-dirs, pi-coding-agent-dir, async-execution.part-3, external-cli-runner)
npm run check:dead-code    # knip
grep -rn "\"chain\"\|chainName\|chainDir\|append-step" src --include='*.ts'   # see hit list + adjudication above
grep -rn "\.chain\.md\|\.chain\.json" src --include='*.ts'                    # current: only agents.ts:1755(:1756),:1843,:1844,:2196 — exactly the loud-rejection path, already passing
grep -rn "chain" docs/                                                        # 35 hits, all in step-10 files above
```

Manual smoke (plan): launch an async `workflowScript` run, confirm TUI status/Fleet renders mode `"workflow"` with step visibility (this is the check that the render.ts deletions kept the workflow path intact).

# Start Here

1. **Kill the 16 tsc errors first** (plan budget note: prior worker used ~65% of budget; remaining work is mechanical). Slash-live-state: delete the three chain/parallel builders + dispatch, collapse to `buildSingleInitialResult`, drop the `:231` branch. Render.ts: delete dead `"chain"`/`"parallel"` branches per line list above, keep workflowGraph/chainAgents-based workflow rendering.
2. Decide the plan-vs-tree gaps: `missions/types.ts:12` + `store.ts:34` + `lifecycle.ts:354`, `slash/delegation-adapters.ts:68` (all grep-1 hits the plan's "steps 1-6 done" implies are gone), and whether to rename `settings.ts` `resolveChainPath`/`chainDir`.
3. Tests: fix the 4 broken imports, strip the 5 failing files' chain fixtures, add the loud-rejection diagnostic test, update/delete `append-step` assertions (public-execution, single-execution.part-2, async-execution.part-3, **external-cli-runner — the uncovered gap**), then `--update` the typecheck baseline.
4. Docs per the exact line list. 5. Verification in order, then manual smoke.