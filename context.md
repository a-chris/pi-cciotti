# Context for: Remove the chain orchestration subsystem (plan.md / issue #20)

Repo: `a-chris/pi-cciotti` — worktree `/Users/chris/github/.pi-perl-pi-subagents-remove-chain-orchestration`, branch `perl/work-remove-chain-orchestration` (clean at `afdf5ad2`). Read `VISION.md` before deciding anything; hard-cutover policy is at VISION.md:50-57 (no aliases/legacy paths). Read `plan.md` in full — line numbers in plan.md were verified against this checkout but WILL drift; re-grep before each edit.

Everything below was re-verified against the current checkout in this run.

## The one non-obvious survival trap (plan finding 1)

`src/runs/background/chain-root-attachment.ts` (256 LOC) must be **renamed**, not deleted: `waitForImportedAsyncRoot` / `resolveAsyncRootResultPath` / `ImportedAsyncRoot` / `ImportedAsyncRootResult` are used by the surviving workflowScript awaited-async + revive paths. Only the chain-step `importAsyncRoot` consumer in `subagent-runner.ts` (`:137`, step handling `~:700-721`) dies. Rename file → `src/runs/background/async-root-attachment.ts`, rename the unit test, update import sites.

## Files & Seams to Touch (by plan step)

### Step 1 — `src/extension/public-execution.ts` (273 LOC, NOT `src/runs/public-execution.ts`)
- Entry: `normalizePublicSubagentExecution()` — the per-legacy-field rejection branches to collapse into ONE generic message:
  - `params.chainName !== undefined` rejection (~`:116-118`, "Durable chain management was removed…")
  - `config.steps` object rejection (~`:119-121`)
  - `params.resume` rejection (~`:122-124`)
  - `hasLegacyOrchestration` = `tasks/chain/parallel/concurrency/chainDir` (~`:126-128`, "Legacy top-level chain and parallel inputs were removed…")
  - legacy actions: `append-step` (:130-132), `approve-checkpoint/reject-checkpoint` (:134-136), `single` (:137-139), `parallel|tasks|chain` (:140-142)
  - `params.step !== undefined` rejection (~`:152`, "step is not a public execution field…")
- Keep ONE generic "unknown/unsupported top-level params" rejection naming the supported surface (`agent`+`task`, `workflowScript`, current actions). Keep the `:141`-adjacent chain-management message only if merged into that generic form (plan says delete).
- `SUBAGENT_RPC_MANAGEMENT_ACTIONS = [] as const` at `src/extension/rpc.ts:65` — leave as-is.

### Step 2 — delete/rename modules (imports to fix)
| File | LOC | Action | Living consumers |
|---|---|---|---|
| `src/agents/chain-serializer.ts` | 280 | delete | `agents.ts:16` (`parseChain, parseJsonChain`); `test/unit/agent-frontmatter.test.ts:9`; `test/unit/chain-serializer.test.ts` |
| `src/runs/background/chain-append.ts` | 321 | delete | `subagent-runner.ts:138`; `async-execution.ts:75` (`statusStepDescription`); `subagent-executor.ts:51` (`enqueueChainAppendRequest, readPendingChainAppendRequests, runnerStepOutputNames`); `test/integration/async-execution.part-3.test.ts:21`; `test/unit/chain-append.test.ts` |
| `src/runs/shared/dynamic-fanout.ts` | 297 | delete | `subagent-runner.ts:94` (`DynamicFanoutError, materializeDynamicParallelStep, validateDynamicCollection`); `chain-outputs.ts:3` (dies with it); `test/unit/dynamic-fanout.test.ts` |
| `src/runs/background/chain-root-attachment.ts` | 256 | **rename** → `src/runs/background/async-root-attachment.ts` | `subagent-runner.ts:137`; `async-execution.ts:71` (type-only); `subagent-executor.ts:86`; `test/unit/chain-root-attachment.test.ts:7` |
| `src/runs/shared/chain-outputs.ts` | 107 | delete (unless single path needs output refs) | `subagent-runner.ts:89` (`outputEntryFromAsyncResult, resolveOutputReferences` — used at `:754`, `:4059`, `:4356`, chain/step paths); `async-execution.ts:37` (chain-only `validateChainOutputBindings`); `subagent-executor.ts:52` (`at :1234`, `:2426-2428` chain paths); `chain-serializer.ts:4`; `dynamic-fanout.test.ts:3` |
| `src/runs/background/parallel-groups.ts` | 45 | delete if nothing survives | `render.ts:31`; `stale-run-reconciler.ts:9`; `async-job-tracker.ts:20`; `run-status.ts:20`; `async-status.ts:12` — all chain/parallel-mode machinery; verify each after mode collapse |

### Step 3 — `src/shared/settings.ts` (385 LOC)
- Chain exports to remove: `SequentialStep`, `ParallelTaskItem`, `DynamicExpandSpec`, `DynamicParallelTemplate`, `DynamicCollectSpec`, `DynamicParallelStep`, `ParallelStep`, `ChainStep` (`:25-118`); `isParallelStep` (:124); `isDynamicParallelStep` (:128); `getStepAgents` (:133); `createChainDir` (:147); `cleanupOldChainDirs` (:153); `ResolvedTemplates`/`resolveChainTemplates` (:182-210); `resolveChainPath` (:230); `buildChainInstructions` (:256); **`resolveParallelBehaviors` (:300-379) — delete ENTIRELY** (plan.md lists it both "remove" and under the confusing "keep the helpers, drop the chainSkills param" note; it is chain-only — its only consumer is `async-execution.ts` `buildAsyncRunnerSteps` chain path `:965,:1002,:1203,:1232`, which dies in Step 2. The `chainSkills` param at settings.ts:319,369-375 is INSIDE `resolveParallelBehaviors`); the `aggregateParallelOutputs` re-export at `:385`.
- Keep (surviving consumers): `expandHomePath` (`agents.ts:2335,:2350`); `resolveExistingReadInstructionPaths` / `resolveExistingReadPaths` (`async-execution.ts:1746-1747` single path, `subagent-executor.ts:38,:3713`, `slash-commands.ts:880`); `writeInitialProgressFile` (`subagent-runner.ts:133,:1677`).
- `CHAIN_RUNS_DIR` import at `settings.ts:11` dies with `createChainDir`/`cleanupOldChainDirs` — but NOTE: the constant itself lives in `src/shared/types.ts:2531` and is renamed in Step 5; only the settings.ts import dies.
- Importers of settings.ts: `subagent-runner.ts:133`, `async-execution.ts:20`, `subagent-executor.ts:34-44` — prune their chain-shaped imports.
- `src/extension/index.ts:399` — remove `cleanupOldChainDirs()` call; `:32` import.

### Step 4 — `src/agents/agents.ts` (2901 LOC) discovery
- Remove: `parseChain, parseJsonChain` import (:16); `getUserChainDir` (:356); `PackageChainPath` interface (:373) + `chains` field plumbing (:381, :522, :541-546, :649-684); `.chain.md` exclusion in `listAgentDefinitionFiles` (:1860); `loadChainsFromDir` (:2222-2247); `resolveNearestProjectChainDirs` (:2272); source-load plumbing (:2444-2446, :2634-2636); `getAgentDiscoverySources` `includeChains` param (:2646, :2650, :2662); `buildAllDiscovery` chain merge (:2790-2822); snapshot fields `chains`/`chainDiagnostics` (:2393-2394); `discoverAgentSnapshot` options `includeChains` (:2837-2841).
- **Loud rejection**: when the directory scan (`listFilesRecursive`-driven, `shouldPruneDiscoveryDir` at :1722) encounters a `chains/` dir or `*.chain.md`/`*.chain.json` file, emit an `AgentDiscoveryDiagnostic`-style entry: `Chain definitions (.chain.md/.chain.json) were removed; convert to workflowScript (see /prompt-workflow)`. Never parse them.
- **Keep residual types** (compile only — proactive-skills.ts + identity.ts): `ChainStepConfig` (:213), `ChainConfig` (:236), `ChainDiscoveryDiagnostic` (:247), and `AgentDiscoveryDiagnostic extends ChainDiscoveryDiagnostic` (:253). Plan: prefer folding `ChainDiscoveryDiagnostic` into `AgentDiscoveryDiagnostic` if it carried only chain fields (it does: source/filePath/error).
- `src/extension/index.ts:496` — `discoverAgentSnapshot(cwd, scope, preferredModelProvider, { includeChains: false })` option removal (also at `:497` region). `test/unit/agent-discovery-cache.test.ts` passes `{ includeChains: false }` at :70,:89,:136,:159,:182.
- `src/agents/identity.ts:24` — keep `ChainConfig` in the union, no change.

### Step 5 — mode collapse
- `src/shared/types.ts:385` `SubagentRunMode = "single" | "parallel" | "chain" | "workflow"` → `"single" | "workflow"`; `:386` `SubagentResultMode = SubagentRunMode` follows.
- `src/shared/types.ts:2281` delete `interface ExtensionChainConfig` (only field `dynamicFanout.maxItems`); `:2422` delete `chain?: ExtensionChainConfig`.
- `src/missions/types.ts:12` `MissionRunMode = "single" | "parallel" | "chain" | "workflow" | "external"` → `"single" | "workflow" | "external"`.
- Artifact-dir rename (plan finding 9): `types.ts:2531` `CHAIN_RUNS_DIR = path.join(TEMP_ROOT_DIR, "chain-runs")` → `WORKFLOW_RUNS_DIR = .../workflow-runs`; `types.ts:2537` `DIRS.chain` rename. Update `src/shared/artifacts.ts`: `:3` import, `:18` legacy-layout probe `.pi/subagents/chain-runs/run.json` (decide: keep as read-only migration notice only if removing breaks a test — `test/unit/artifacts.test.ts` asserts `:60`/`:66-69` and `:52-53` packaging-warning paths), `:137-150` `getProjectChainRunsDir`/`getChainRunsDir`. Update `src/extension/doctor.ts` `:12,:24,:52,:229` ("chain runs" → "workflow runs"); `test/unit/doctor.test.ts:88` (`chainRunsDir: path.join(root, "missing-chains")`) and any artifacts.test.ts assertions.
- `mode: "chain" | "parallel"` literal references to update (verified):
  - `async-status.ts:693,:696-697` (parallel/chain step-label branches; `:684-698` region)
  - `async-job-tracker.ts:689` `mode: info.mode ?? (info.chain ? "chain" : "single")` — plan says fallback becomes `info.workflowScript ? "workflow" : "single"`; **verify the field**: `AsyncStartedEvent` (types.ts:1514) has NO `workflowScript`; it has `mode?`, `workflowGraph?`, `workflowKey?`, `parentWorkflowRunId?`. Use `info.mode ?? (info.workflowGraph ? "workflow" : "single")` or just `"single"` — decide with tsc. Also `:669` `info.chain` fallback for `rawAgents`.
  - `run-status.ts:146-148` (parallel/chain step labels)
  - `stale-run-reconciler.ts:202-217` (`chainStepCount`/`parallelGroups` propagation — drop if chain-only)
  - `async-resume.ts:303` (mode allowlist)
  - `async-retention.ts:27` (`RUN_MODES` set)
  - `missions/lifecycle.ts:91-94` (`missionRunModeForResult`; `mode` value is `Details["mode"]`, which already collapses — but the `["single","parallel","chain","workflow"].includes(...)` allowlist at `:354` must drop parallel/chain), `missions/store.ts:34`
  - `slash-live-state.ts:87` (`mode: "parallel"`), `:111`, `:147` (`mode: "chain"`), `:231`
  - `slash/delegation-adapters.ts:68` (mode union `"single" | "parallel" | "chain" | "workflow" | "management"`)
  - `foreground-history.ts:120` (restorable-run check)
  - `nested-events.ts:362,:366` (mode + chainStepCount passthrough)
  - `tui/fleet-status.ts:202,:215,:439,:459,:609`
  - `api/preflight.ts` — grep shows NO `chain`/`parallel` strings; nothing to change.
  - `src/runs/shared/async-status-projection.ts` — grep shows 0 `chain` hits already (two-mode: `kindForMode` at :186 returns `"workflow" | "subagent"`); plan's "find via grep" yields nothing.

### Step 6 — `src/runs/foreground/subagent-executor.ts` (6898 LOC — the big one)
- `:337-341` internal durable-run compat fields (`chain?`, `tasks?`, `concurrency?`) — delete (comment at :337).
- `params.chain`/`params.tasks`/`params.parallel` branches: `:539`, `:618-632` (step/count planning), `:1705` (attach root error), `:1726` (`attachChain`), `:2259-2311` (task/chain schema projection incl. `projectChainOutputSchemas` at :2311), `:2342-2428` (validation region, `validateChainOutputBindingsWithContext` at :1234,:2426-2428, `getStepAgents`-style loops), `:2550-2557`.
- `getRequestedModeLabel` (:2440-2444) → return only `"single" | "workflow"` (drop the `chain`/`parallel` branches).
- `inferExecutionMode` (:3976-3981) → `params.workflowScript !== undefined ? "workflow" : "single"`.
- `appendStepToAsyncChain` (:1138-1290) — delete; `:1293` `resultMode: "chain"` dies with it; `:6106-6112` `action === "append-step"` dispatch — delete.
- `isComposite` (:2660) → `(params.workflowScript ?? params.workflowScriptPath) !== undefined`. Wait — current is `(params.chain?.length ?? 0) > 0 || (params.tasks?.length ?? 0) > 0 || params.workflowScript !== undefined`; plan: reduce to `params.workflowScript !== undefined`.
- Keep workflowScript handling untouched: `loadWorkflowScriptPath` (:486-500), run dispatch (:4632-4726).
- Knip `rules: { "exports": "warn", "types": "warn" }` (non-blocking) — other knip findings are hard errors; see `knip.jsonc`.

### Step 7 — TUI render (`src/tui/render.ts`, 87 chain/parallel hits; `src/tui/fleet-status.ts`)
- `render.ts`: `:607` (empty steps guard for parallel/chain), `:1107-1108` (detail mode labels), `:1568` `widgetChainDetails` (delete function), `:1590-1599` (chain step widget branch), `:1746-1747`, `:1861-1985` (active-parallel-group machinery: `hasParallelInChain` :1920, `activeParallelGroup` :1921-1924, `buildMultiProgressLabel` :1918), `:2061-2075`, `:2215`, `:2383-2440` (`job.mode === "chain"` branches and chain step counts), `:3192,:3514` duration aggregations. Composite `"workflow"` runs must still render steps via the surviving `steps`/`workflowGraph` projection (`:366`, `:422`, `:448`, `:623-631`, `:1069-1070`, `:1628-1632` `buildChainStepSpans` — keep the workflowGraph path).
- `fleet-status.ts`: `:202,:215` (chain/parallel steps), `:439,:459` (chain current-step skipping), `:609` (`isActiveState` allowlist).
- `async-status-projection.ts` — no change needed (already workflow/other two-mode).

### Step 8 — parallel-support module audit
- `workflow-graph.ts` (225) — **keep** (render.ts:41, async-execution.ts:36).
- `parallel-handoff.ts` (389) — consumers `async-resume.ts:14`, `retained-children.ts:5`, `subagent-runner.ts:142`, `subagent-executor.ts:71` are all SURVIVING paths (worktree handoff, async resume). Keep unless knip proves otherwise.
- `parallel-utils.ts` (271) — surviving consumers: `scripted-workflow.ts:5` (`DEFAULT_GLOBAL_CONCURRENCY_LIMIT, Semaphore`), `utils.ts:586` (`mapConcurrent` re-export), `subagent-runner.ts:70-78` (mixed single/chain use of `mapConcurrent` at :3473,:3831, `flattenSteps` :72,:1824,:2414 — check if :2414 chain-append path dies with it), `settings.ts:385` re-export (dies). `RunnerSubagentStep`/`RunnerStep`/`isParallelGroup`/`isDynamicRunnerGroup`/`aggregateParallelOutputs` — mostly chain-shaped; let knip decide.
- `child-launch-plan.ts` (162) — keep (settings.ts, async-execution.ts, subagent-executor.ts import it); `projectChainOutputSchemas` (:66) looks chain-only — tsc/knip decide.

### Step 9 — tests (delete, don't port)
- Delete: `test/unit/chain-serializer.test.ts`, `test/unit/chain-append.test.ts`, `test/unit/dynamic-fanout.test.ts`.
- Rename: `test/unit/chain-root-attachment.test.ts` → `async-root-attachment.test.ts` (fix import `:7`, temp-dir prefix `:27` `pi-chain-root-attachment-`; keep only surviving-function assertions).
- Strip `.chain.md`/`.chain.json` fixtures and `"was removed"`/`"Legacy "` assertions from (verified chain references exist in): `agent-discovery-cache.test.ts` (`:103,:226,:334`), `pi-coding-agent-dir.test.ts` (`:119,:141`), `agent-exclude-dirs.test.ts` (`:212,:219`), `agent-frontmatter.test.ts` (`:9` import), `proactive-skills.test.ts` (keep pure recommend/format cases, drop chain-discovery cases `:26-88`), `agent-management.test.ts` (`:764-766`), `doctor.test.ts` (`:43-88`), `async-resume.test.ts` (`:158,:162,:520,:865-958`), `artifacts.test.ts` (`:52-69`), plus notify/child-tool-plan/delegation-api/authority-policy/preflight/prompt-template-bridge/config-enrichment-keys/path-resolution (plan lists them; verify current contents).
- `test/integration/async-execution.part-3.test.ts:21` — remove `readPendingChainAppendRequests` import.
- Add one NEW unit test: discovery emits the loud `.chain.md` rejection diagnostic (current-contract test, allowed).

### Step 10 — docs (strip chain/parallel key language; `grep chain docs/` = 35 hits)
- `docs/configuration.md` verified hits: `:19,:49,:138,:256,:264,:270,:310,:324,:332,:346`,`:348-352` (`## parallel` section), `:521` (delete "keeps its legacy name for compatibility" + document new `workflow-runs` dir).
- `docs/observability.md`: `:13,:17,:41`, `:267-270` (chain-runs naming).
- `docs/extension-api.md`: `:487-488` (discovery row), `:140`.
- `docs/models.md`: `:136`. `docs/tool-reference.md`: `:9,:265,:342`.
- `docs/workflows.md`: `:125,:137,:252-260,:325,:379` (migration section describes the removed shapes — rewrite to current workflowScript-only surface).
- `docs/agents.md`: `:29,:246,:352,:376`.

## Existing Conventions
- Each plan step ends with `npm run typecheck` green before moving on.
- Hard cutover, NO legacy aliases (VISION.md:50-57). Tests must prove the current contract; delete stale assertions rather than serving them (VISION.md:52-53 + AGENTS.md).
- `knip.jsonc` rules: unused `exports`/`types` are non-blocking warnings; everything else is a hard error. Dead exports in `src/shared/utils.ts` are a known knip blind spot — manual review.
- The one deliberate residual: `ChainConfig`/`ChainStepConfig` stay in `agents.ts` purely so `proactive-skills.ts` and `identity.ts` compile. `agent-management.ts:979-984` builds `proactiveInput` WITHOUT `chains` (verified).
- `src/slash/prompt-workflows.ts:211-234` (`chain:` frontmatter → workflowScript) — **do not touch** (acceptance criterion 3).

## Verification (run in order; all must pass)
```bash
npm run typecheck          # tsc --noEmit
npm run typecheck:tests    # node scripts/typecheck-tests.mjs
npm run test:all           # test:unit && test:integration
npm run check:dead-code    # knip
grep -rn "\"chain\"\|chainName\|chainDir\|append-step" src --include='*.ts'
grep -rn "\.chain\.md\|\.chain\.json" src --include='*.ts'
grep -rn "chain" docs/
```
Plus manual smoke: launch an async `workflowScript` run; confirm status/Fleet renders under mode `"workflow"` with step visibility.

## Architecture
`index.ts` → `src/extension/index.ts` (`registerSubagentExtension`, ~:388; guards on `PI_SUBAGENT_CHILD_ENV`) → `subagent-executor.ts` (foreground) / `async-execution.ts` (background) / `subagent-runner.ts` (child process). Discovery is centralized in `agents.ts`; shared config/types in `src/shared/`. TUI renders from async-status projections via `render.ts`/`fleet-status.ts`. Data exits via result files under `DIRS.results`/`DIRS.async` and workflow artifacts dir.

## Start Here
1. `src/extension/public-execution.ts` — normalizePublicSubagentExecution (Step 1).
2. `src/shared/types.ts` `SubagentRunMode` :385 then the module deletions (Step 2).
3. `src/runs/background/subagent-runner.ts` — the largest consumer of deleted modules; single-run logic here MUST survive.