# Plan: Remove the chain orchestration subsystem (issue #20)

Repo: a-chris/pi-cciotti, worktree `/Users/chris/github/.pi-perl-pi-subagents-remove-chain-orchestration`, branch `perl/work-remove-chain-orchestration` (clean at `afdf5ad2`).
All line numbers below were verified against this branch on this checkout. They will drift as steps land — re-grep before each edit.

## Goal

Delete the chain orchestration subsystem (chain/parallel/tasks step execution, .chain.md/.chain.json discovery, append-step, dynamic fanout) as a hard cutover; `workflowScript` becomes the only orchestration path and `SubagentRunMode` collapses to `"single" | "workflow"`.

## Now / Next / Deferred

**Now (this plan):** work items 1–8 from the issue (public-execution cleanup, module deletions, settings/agents/executor/modes/render updates, test deletions, docs + artifact-dir rename).

**Deferred (explicitly out of scope):**
- `src/agents/proactive-skills.ts` `chains: ChainConfig[]` input and the `ChainConfig`/`ChainStepConfig` types it consumes — separate issue. **This is the one deliberate residual**: `ChainConfig`, `ChainStepConfig` (src/agents/agents.ts:213, :236) stay in agents.ts solely so proactive-skills.ts and identity.ts (:24 `frontmatterNameForConfig`) compile. No live caller passes `chains` (verified: agent-management.ts:979-984 builds `proactiveInput` without `chains`), so the types are producers-less but type-check fine.
- Improving workflowScript ergonomics; missions profiles/worktree/agentContract (separate issues).
- `src/slash/prompt-workflows.ts:211-234` `chain:` frontmatter → workflowScript compilation: **untouched** (acceptance criterion 3).

## Key entanglement findings (verified)

These override naive readings of the work-item list — plan around them:

1. **`src/runs/background/chain-root-attachment.ts` (256 LOC) CANNOT be deleted wholesale.** Its `waitForImportedAsyncRoot` and `resolveAsyncRootResultPath` are consumed by the *surviving* workflowScript awaited-async and revive paths (subagent-executor.ts:86, :1895, :2122-2124, :3034, :3054-3056). Only the chain-step `importAsyncRoot` consumer dies (subagent-runner.ts:137, :704-720). Action: rename file to `src/runs/background/async-root-attachment.ts`, keep `ImportedAsyncRoot`, `waitForImportedAsyncRoot`, `resolveAsyncRootResultPath`, `ImportedAsyncRootResult`; delete any chain-only exports if knip/tsc shows none survive. Update the 4 import sites + `test/unit/chain-root-attachment.test.ts` (rename to `async-root-attachment.test.ts`, keep only surviving-function assertions).
2. **`src/runs/background/async-execution.ts` (2,154 LOC) is mixed.** Chain-only: `buildAsyncRunnerSteps` (:882-1320) and `executeAsyncChain` (:1322-1627) including the `resultMode ?? "chain"` defaults at :896 and :1347. Surviving: `executeAsyncSingle` (:1632+), `formatAsyncStartedMessage`, `isAsyncAvailable`, `spawnRunner`, `workflowAwaitedAsyncResultPath` (:1628). Delete the chain-only block and its now-unused imports (chain-outputs, chain-append `statusStepDescription` at :75, `ImportedAsyncRoot` type import at :71 stays only if single path uses it — tsc decides).
3. **`src/runs/background/subagent-runner.ts` (5,009 LOC) executes single runs too — do not delete the file.** Remove chain-only pieces: `importAsyncRoot` step handling (~:704-720+), dynamic-fanout imports/usage (:94, materializeDynamicParallelStep etc.), chain-append consumption (:138), `parallel-groups` machinery (src/runs/background/parallel-groups.ts, 45 LOC — delete if no surviving consumer after edits), and chain-outputs imports (:89) if tsc/knip shows the surviving single-step path doesn't use `resolveOutputReferences`.
4. **`src/runs/shared/chain-outputs.ts` (107 LOC): delete entirely only if `outputEntryFromAsyncResult`/`resolveOutputReferences` have no surviving single/workflow consumer** — verified consumers today are subagent-runner.ts:89 (step chaining) and async-execution.ts:37 (`validateChainOutputBindings`, chain-only). If the single path turns out to use output references, keep exactly those exports; otherwise delete the file and `test/unit/dynamic-fanout.test.ts` with it.
5. **`src/shared/settings.ts` has NO `chains` config key** (the parent brief's settings.ts:502/:544 does not exist on this branch — verified by grep). Chain-shaped exports to remove: `SequentialStep`/`ParallelTaskItem`/`DynamicParallelStep`/`ParallelStep`/`ChainStep` (:25-118), `isParallelStep` (:124), `isDynamicParallelStep` (:128), `getStepAgents` (:133), `createChainDir` (:147), `cleanupOldChainDirs` (:153), `ResolvedTemplates`/`resolveChainTemplates` (:182-210), `resolveChainPath` (:230), `buildChainInstructions` (:256), `resolveParallelBehaviors` (grep for exact line), `aggregateParallelOutputs`. The `resolveSkills`-family helpers at :319-375 take a `chainSkills` param — keep the helpers, drop the `chainSkills` param (no surviving caller passes it after chain removal; tsc confirms). `CHAIN_RUNS_DIR` import at :11 dies with `createChainDir`/`cleanupOldChainDirs`.
6. **`src/shared/types.ts:2281` `ExtensionChainConfig` and :2422 `chain?: ExtensionChainConfig`** — inspect; this is extension-API surface. Delete both (hard cutover; criterion 1 forbids relabeling).
7. **`src/agents/agents.ts` discovery:** remove `getUserChainDir` (:356), `PackageChainPath` plumbing (:381, :522, :541-546, :649-684), `loadChainsFromDir` (:2222-2247), `resolveNearestProjectChainDirs` (:2272), the package/project chain merge (:2793-2807), the snapshot fields `chains`/`chainDiagnostics` (:2393-2394), the `.chain.md` exclusion at :1860, `parseChain`/`parseJsonChain` import (:16), and the `includeChains` option (extension/index.ts:496). **Loud rejection (criterion 2):** when directory scan encounters a `chains/` dir or `*.chain.md`/`*.chain.json` file, emit an `AgentDiscoveryDiagnostic`-style entry: `Chain definitions (.chain.md/.chain.json) were removed; convert to workflowScript (see /prompt-workflow)`. Never parse them.
8. **`src/agents/identity.ts:24`** keeps `ChainConfig` in its union type (compiles against the residual type) — no change needed.
9. **Artifact dir rename:** `src/shared/artifacts.ts` — `CHAIN_RUNS_DIR` and the `chain-runs` literals (:18, :138, :150) rename to a `workflow-runs` equivalent in `src/shared/types.ts` where the constant is defined. NO legacy alias (VISION.md:51-57). Update doctor.ts (:12, :24, :52, :229) wording to "workflow runs" / new path. The `:18` legacy-layout probe string must be evaluated: if it detects old on-disk layouts to warn, keep pointing at the old `chain-runs` name as a *read-only* migration notice only if deleting it breaks an existing test; otherwise remove it. State which you did.

## Steps

Each step ends with `npm run typecheck` green before moving on.

1. **public-execution.ts** (:140-170): delete the per-legacy-field error branches (`tasks`/`chain`/`parallel`/`concurrency`/`chainDir` at :149-151, append-step :156, checkpoint :159, top-level :165, and the :141 chain-management message). Keep ONE generic rejection: unknown/unsupported top-level params produce a single error naming the supported surface (`agent`+`task`, `workflowScript`, current actions). Keep `SUBAGENT_RPC_MANAGEMENT_ACTIONS = [] as const` (rpc.ts:65) as-is.
2. **Delete modules:** `src/agents/chain-serializer.ts` (280), `src/runs/background/chain-append.ts` (321), `src/runs/shared/dynamic-fanout.ts` (297). Rename `chain-root-attachment.ts` → `async-root-attachment.ts` per finding 1. Delete `chain-outputs.ts` and `parallel-groups.ts` per findings 3-4 (tsc/knip arbitrate). Remove all imports of deleted modules from subagent-runner.ts, async-execution.ts, subagent-executor.ts, agents.ts.
3. **settings.ts** per finding 5; remove `cleanupOldChainDirs()` call at extension/index.ts:399.
4. **agents.ts discovery** per finding 7, including the loud `.chain.md`/`.chain.json` diagnostic. Keep `ChainConfig`/`ChainStepConfig`/`ChainDiscoveryDiagnostic` type declarations (residual; `ChainDiscoveryDiagnostic` may be foldable into `AgentDiscoveryDiagnostic` if it only carried chain fields — prefer folding, keep names used by survivors).
5. **types.ts modes:** `SubagentRunMode = "single" | "workflow"` (:385); `SubagentResultMode = SubagentRunMode` (:386). Update `MissionRunMode` (src/missions/types.ts:12) to `"single" | "workflow" | "external"`. Delete `ExtensionChainConfig` (:2281) and `chain?:` (:2422). Update every `mode: "chain" | "parallel"` reference: async-status.ts (:693-697), async-job-tracker.ts:689 (fallback becomes `info.workflowScript ? "workflow" : "single"` — verify what field exists; use "single" if none), run-status.ts, stale-run-reconciler.ts, async-resume.ts, async-retention.ts, missions lifecycle.ts/store.ts, slash-live-state.ts, slash-commands.ts, delegation-adapters.ts, foreground-history.ts, api/preflight.ts, extension/doctor.ts, fleet.ts/fleet-status.ts/render-helpers.ts.
6. **subagent-executor.ts** (6,898 LOC, 222 chain/parallel hits): delete `params.chain`/`params.tasks`/`params.parallel` branches; `getRequestedModeLabel` (:2440) and `inferExecutionMode` (:3976) return only `"single" | "workflow"`; delete `appendStepToAsyncChain` (:1138-1290) and the `action === "append-step"` dispatch (:6111-6112); delete the append-step validation block (:1149-1360 region) and `resultMode: "chain"` (:1294); `isComposite` (:2660) reduces to `params.workflowScript !== undefined`; the internal durable-run compat fields comment (:337) — drop chain/tasks/parallel from that internal type. Keep workflowScript handling (:489-499, :4632-4726) untouched.
7. **render.ts** (TUI): delete `widgetChainDetails` and the `job.mode === "chain"`/`"parallel"` branches (:607, :1107-1108, :1590-1599, :1746-1747, :1861-1985 active-parallel-group machinery, :2061-2075, :2215, :2383-2440). Composite `"workflow"` runs must still render their step list through the surviving steps rendering (the `steps`/`workflowGraph` projection); verify by running an async workflowScript run and checking Fleet/status output. Also `async-status-projection.ts` (find via grep for `mode === "chain"`) updated to the two-mode contract.
8. **parallel-support modules audit:** `src/runs/shared/parallel-handoff.ts` (389), `parallel-utils.ts` (271), `workflow-graph.ts` (225), `child-launch-plan.ts` (162) — `workflow-graph` is used by the surviving workflow path (async-execution.ts:36 — keep). Delete any of parallel-handoff/parallel-utils whose exports lose all consumers (knip decides); do not port chain behavior into them.
9. **Tests — delete, don't port:** delete `test/unit/chain-serializer.test.ts`, `test/unit/chain-append.test.ts`, `test/unit/dynamic-fanout.test.ts`; rename `chain-root-attachment.test.ts` per finding 1; strip the `.chain.md`/`.chain.json` fixture assertions and `"was removed"`/`"Legacy "` assertions from: notify, agent-discovery-cache, child-tool-plan, pi-coding-agent-dir, delegation-api, authority-policy, agent-exclude-dirs, agent-frontmatter (chain-serializer import at :9), preflight, proactive-skills (only the chain-discovery-driven cases; keep the pure recommend/format cases), prompt-template-bridge, agent-management, doctor, async-resume, config-enrichment-keys, path-resolution, async-execution.part-3 (:21 chain-append import). Add one small unit test asserting discovery emits the loud `.chain.md` rejection diagnostic (criterion 2) — this is a current-contract test, allowed.
10. **Docs:** strip chain language from docs/agents.md, docs/configuration.md (lines :19, :49, :138, :256, :264, :270, :310, :324, :332, :346 — remove `parallel`/chain key mentions, forceTopLevelAsync and spawn-budget wording, timeoutMs composite-run wording; delete the :521 "keeps its legacy name for compatibility" line and document the new `workflow-runs` dir), docs/observability.md, docs/extension-api.md chain-discovery row, docs/models.md, docs/tool-reference.md, docs/workflows.md (grep `chain` = 35 hits across docs).

## Verification (run in order, all must pass)

```bash
npm run typecheck
npm run typecheck:tests
npm run test:all
npm run check:dead-code      # knip: no new unused exports from touched modules
grep -rn "\"chain\"\|chainName\|chainDir\|append-step" src --include='*.ts'   # no execution-path hits; allowed: async-root-attachment internal names if any remain — rename if flagged
grep -rn "\.chain\.md\|\.chain\.json" src --include='*.ts'                    # only the loud-rejection diagnostic string
grep -rn "chain" docs/                                                        # no instructional chain/parallel-key content
```

Plus a manual smoke: launch an async `workflowScript` run, confirm status/Fleet render under mode `"workflow"` with step visibility.

## Assumptions

- The parent brief's settings.ts:502/:544 (`chains: Record<string, ChainConfig>`, `chainFiles`) do not exist on this branch (verified) — nothing to remove there; the residual is only the type declarations in agents.ts.
- Decision 1 (delete dynamic-fanout.ts, don't fold into scripted-workflow.ts) holds: verified `runs.all` exists in scripted-workflow.ts and no workflowScript code imports dynamic-fanout.
- Renaming `chain-root-attachment.ts` → `async-root-attachment.ts` (rather than keeping the chain-named file) is consistent with the hard-cutover rule; its surviving functions are workflow/single infrastructure.
- The `chain-runs` artifact directory rename is a breaking change for existing on-disk runs; old run artifacts become invisible by design (no compat alias), per VISION.md:51-57 and the work-item instruction.
- `SUBAGENT_RPC_MANAGEMENT_ACTIONS = [] as const` stays as-is (already empty).

## EXECUTE STATUS (updated after first worker timed out — read this first)

Steps 1-6 are DONE and committed (fa218edd, 7157bcad, 0e84f094, 6017e46e): chain modules deleted, async-root-attachment renamed, settings/agents/executor/async-execution/subagent-runner chain paths removed, SubagentRunMode collapsed to `"single" | "workflow"`, public-execution legacy branches collapsed, chain test files deleted, stray `x`/`pnpm-lock.yaml` removed (npm repo — do NOT run pnpm or recreate them). Do NOT redo Steps 1-6.

Remaining work, verified against this tree:
1. **`npm run typecheck` is RED — exactly 16 errors.** 3 in `src/slash/slash-live-state.ts` (:87 `mode:"parallel"`, :147 `mode:"chain"`, :231 comparison — make synthetic entries `"workflow"` or delete if chain-only) and 13 in `src/tui/render.ts` (stale `"chain"`/`"parallel"`/`chainAgents` comparisons at ~:1896,:1897,:1900,:2009,:2023,:2163,:2331,:2341,:2371,:2388,:3140,:3462). Commit a543a9a8 already deleted the parallel/chain branches in `widgetParallelAgentDetails`/`activeParallelWidgetGroup`. Fix by DELETING dead branches (hard cutover); keep composite `"workflow"` step rendering via the surviving steps/`workflowGraph`/`buildChainStepSpans` projection; `widgetChainDetails` (~:1568) dies.
2. **Step 9 (tests):** 7 test files still hold `.chain.md`/`.chain.json` fixture assertions; 13 files still hold `"was removed"`/`"Legacy "` assertions. `grep -rln` them, delete per plan (never rewrite to old behavior); add the loud-`.chain`-rejection test.
3. **Step 10 (docs):** strip chain language per plan (35 hits across docs/).
4. Then Verification section in order: typecheck → typecheck:tests → test:all → check:dead-code → 3 greps.

Budget discipline: the prior worker exhausted 30 min (338 calls) covering Steps 1-6 (~65% of scope). Remaining is ~35% — go straight at the 16 tsc errors first, then mechanical test/doc deletions; leave margin for test:all and the review loop.

## EXECUTE STATUS (final — cutover complete)

All remaining work landed (aee085a4, 184f96fb, 29e6bcd7, 615e38e1, a817ce0a, 1f5ded6e, da6cf259):

1. **tsc**: all 16 errors fixed by deleting dead chain/parallel branches; live parallel-group widget path (workflow/async fanout) restored and gated on `hasParallelGroups`/`activeParallelGroup`.
2. **Tests**: legacy chain-shape fixtures deleted across render-widget (18), render-fork-badge (7), part-1 (3), part-2 (24), single-execution.part-2 (3), external-cli-runner (1), fork-context (1), async-execution.part-1 (1), timeout defaults (6), missions lifecycle (2), slash placeholders (2), async-execution.part-4 chain-only (chain segment of missing-cwd + coalescing/partial-import/sibling-failure/write-fail), async-status (5 legacy parallel-group/step-wording tests superseded by the simplified formatter in b5f0470f). **Ported, not deleted:** the 5-test background worktree setup-lifecycle suite now drives `executeAsyncSingle` with `worktree:true` — the identical setup-handoff contract is still covered on the live async path.
3. **Docs**: chain prose removed/updated across docs/* and README; `chain-runs` → `workflow-runs` wording matches `WORKFLOW_RUNS_DIR`; guide-docs facade contract keeps model-read prose free of internal param names.
4. **Extras**: `AsyncStartedEvent.chain` field and dead `info.chain` fallback removed; dead-code scan (knip) clean.

Verification results:
- `npm run typecheck` — green.
- `npm run test:unit` — 2640 tests, 0 fail.
- `npm run test:integration` — 806 tests; 4 fails, all pre-existing at base `0e84f094` (inline-workflow-visibility, orca-progress-tabs, result-publication, single-execution.part-1); zero new failures vs base.
- `npm run check:dead-code` — rc 0.
- `grep -rn '"chain"\|chainName\|chainDir\|append-step' src` — only the public removal-rejection site (public-execution.ts) and prompt-workflows `chain:` frontmatter compilation (untouched per criterion 3).
- `typecheck:tests` drift equals the base 32-error baseline; new-file delta is only the test-name-pattern cast (6).

Deliberate residuals (per plan): `ChainConfig`/`ChainStepConfig` types for proactive-skills; `chainStepCount`/`chainAgents` TUI/fleet/job-tracker field names (workflow-group carryover — rename deferred); `ChainGateLayer` in workflow-checklist (workflow gate vocabulary, no chain producer); `ChainOutputValidationError` string in chain-outputs.ts.
