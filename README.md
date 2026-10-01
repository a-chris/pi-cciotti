<p>
  <img src="banner.png" alt="pi-cciotti" width="1100">
</p>

# pi-cciotti

`pi-cciotti` lets one Pi session delegate focused work to child agents. You ask in plain language, Pi hands the job to a specialist, and the result comes back into the conversation. Code review, scouting, implementation, parallel audits, background jobs: anything that benefits from a second or third set of model eyes.

<https://github.com/user-attachments/assets/702554ec-faaf-4635-80aa-fb5d6e292fd1>

Most subagent setups burn context on giant schemas before the agent does any work. `pi-cciotti` keeps the model-facing surface small and predictable, cutting it from 17.4K to about 5.3K characters.

## Why use it

`pi-cciotti` is a fork of [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) with a narrower contract focused on predictable delegation.

**Clear handoffs.** Each child takes one task and returns a result. If it cannot finish safely, it returns `BLOCKED: <reason>` so the parent can decide what to do next.

**Plan before you build.** `/perl` gives you a written plan to review before implementation starts, then coordinates the work and review in an isolated worktree. You stay in control without having to supervise every step.

**Delegation on your terms.** Choose how often Pi delegates once in config, from `never` to `aggressive`, instead of repeating the rule in every prompt. `never` removes about 2.8KB from each parent turn on a 16-agent setup while keeping agents available when you ask for them.

**A small surface.** The model gets separate tools for launching a child, composing workflows, and managing runs, each with one clear job. Their combined descriptions are 408 characters, down from 890, while deeper guidance stays in the docs.

**The right context for each job.** A child can start fresh, use the parent session, or receive a focused summary shaped for its role. Reviewers get decisions and diffs; scouts get entry points, without either receiving more context than the job needs.

**Documentation you can trust.** The README, guides, and skills are checked against live tool schemas, so examples do not teach calls the tools reject. The contract test fails when the model-facing docs drift.

**Failures are explicit.** Invalid or removed configuration keys stop loading with a clear error instead of silently restoring defaults.

**Focused orchestration.** The parent coordinates the work, and children cannot create more children. A top-level run allows six cumulative child spawns by default, which stops accidental fan-out early.

## Install

Install from this repository, not the npm registry:

```bash
pi install https://github.com/a-chris/pi-cciotti
```

This tracks the default branch. To pin a tag for a reproducible install, add it to the URL (`@v0.69.0`); `pi update --extensions` then reconciles the checkout to that ref. From a local clone of this repo, a path install works too and picks up edits on reload:

```bash
pi install /path/to/pi-cciotti
```

> **Not on npm.** The registry name `pi-subagents` belongs to the upstream project this fork is based on: `pi install npm:pi-subagents` would install upstream's newest release, which does not contain this fork's changes and whose version numbers no longer line up with the tags in this repository.

That is the only required step. Background children use the host's SDK: npm Pi keeps its detached Node runner; the official Pi 0.85.1 Linux x64 standalone release loads the same runner through Pi's embedded SDK, without a separate SDK install. See [Standalone background execution](docs/standalone-background.md) for the supported boundary and validation gate. To try the extension in a single session without installing it, use `pi -e /path/to/pi-cciotti`.

## Try this first

No agent files to write, no config, no slash commands to learn. After installing, ask Pi in plain language:

```text
Use reviewer to review this diff.
```

```text
Ask oracle for a second opinion on my current plan. Challenge assumptions and tell me what I might be missing.
```

```text
Use scout to understand this code based on our discussion, then ask me clarification questions.
```

```text
Run parallel reviewers: one for correctness, one for tests, and one for unnecessary complexity.
```

That is enough to start. Pi decides whether to call the `subagent` tool, which agent to use, and how to compose the work.

## How it works

Pi is the parent session. A subagent is a focused child Pi session with its own job.

When you ask for a subagent, Pi starts the child, gives it the task, and brings the result back. Foreground children run as sessions inside the parent Pi process and stream in the conversation. Background children run as sessions inside a detached runner process that keeps working after control returns to you (an omitted `async` backgrounds the run; that is the default).

Installing the extension does not start an automatic reviewer in the background. It gives Pi a delegation tool. If you want every implementation reviewed, say so in your prompt or project instructions:

```text
When you finish implementing, run a reviewer subagent before summarizing.
```

To set that appetite once instead of per request, set `delegationLevel` in the subagent config: `never`, `rarely`, `standard` (default), or `aggressive`. See [Configuration](docs/configuration.md#delegationlevel).

## Builtin agents

The extension ships with agents you can use immediately:

| Agent | Use it when you want... |
|-------|--------------------------|
| `scout` | Fast local codebase recon: relevant files, entry points, data flow, risks. |
| `researcher` | Web/docs research with sources and a concise research brief. Requires [pi-web-access in the child](docs/agents.md#web-research-prerequisites). |
| `evidence-auditor` | Independently checks whether important research claims are supported by their sources. Requires [pi-web-access in the child](docs/agents.md#web-research-prerequisites). |
| `planner` | Writes an executable `plan.md` from the brainstormed direction. The internal role of the `/perl` workflow; plans only, and it is `advertise: false` so it costs nothing in the per-turn catalog. |
| `worker` | Implementation work. Edits files, validates, escalates unapproved decisions instead of guessing. |
| `reviewer` | Code review and small fixes against the task/plan, tests, edge cases, and simplicity. |
| `oracle` | A second opinion before acting. Challenges assumptions without editing. |
| `delegate` | A lightweight general delegate that behaves close to the parent session. |

Rule of thumb: `scout` before you understand the code, `planner` to settle the plan before implementing, `researcher` before you trust external facts, `evidence-auditor` before you rely on important research, `worker` to implement, `reviewer` to check, and `oracle` when the decision itself feels risky.

## Common workflows

The package includes `/council` and `council-mode`; the model-based `council-*` agents are documented profiles you add in your own agent directory.

| Want | Ask naturally |
|------|---------------|
| Get a second opinion | "Ask oracle to review this plan and challenge assumptions." |
| Solve a hard problem | "Use oracle to investigate this bug before we edit." |
| Review a diff | "Use reviewer to review this diff." |
| Run parallel reviewers | "Run reviewers for correctness, tests, and cleanup." |
| Debate a material decision | "Use `/council` with model-based advisors to compare this decision." |
| Implement then review | "Implement this, then review it." |
| Review until clean | "Run a review loop on this change with a max of 3 rounds." |
| Plan, review, then execute | "`/perl <task>` writes `plan.md` for your review; a second `/perl` call executes it (scout, worker, reviewer loop) in a shared worktree on `perl/work`. A `slug` arg gives a concurrent task its own lane." |
| Execute a plan carefully | "Have worker implement this approved plan, then run reviewers and apply the feedback." |
| Scout before planning | "Use scout to inspect the auth flow before planning." |
| Run in the background | "Run this in the background." |
| Use a saved workflow | "Run the review chain on this branch." |
| Browse agents | "Show me the available subagents." |
| See running work | "Show active async runs." or "Show the subagent fleet." |
| Check setup | "Check whether subagents are configured correctly." |

For implementation work, the recommended loop is `clarify → scout → worker → fresh reviewers → worker`. Packaged prompt shortcuts like `/parallel-review` and `/review-loop` make these patterns repeatable — see [Workflows](docs/workflows.md).

## Where running work shows up

Foreground runs stream progress in the conversation. Background runs keep going in a detached runner process.

In the TUI, a persistent FleetView below the editor keeps active work visible. `/subagents-fleet` opens a live inspector where you can browse children, read transcripts, steer a running child, or stop a run. You can also just ask: "Show me the current async runs."

Details, keybindings, and the machine-readable run artifacts are in [Observability](docs/observability.md).

For bounded orchestration, `maxSubagentSpawnsPerRun` limits cumulative logical children in one run tree. It defaults to 6 and stays separate from active concurrency and the session-wide cumulative spawn budget. See [Configuration](docs/configuration.md#maxsubagentspawnsperrun).

## If something feels off

```text
/subagents-doctor
```

or ask: "Check whether subagents are set up correctly."

For installed-version help, use `subagent_control({ action: "guide", topic: "workflows" })` to read a packaged topic, or `subagent_control({ action: "guide" })` for the packaged overview; `/subagents-guide [topic]` is the slash equivalent. The available topics are `overview`, `workflows`, `agents`, `missions`, `observability`, `tool-reference`, `configuration`, `models`, and `extension-api`.

## Documentation

The full reference lives in `docs/`:

| Doc | What's in it |
|-----|--------------|
| [Agents](docs/agents.md) | Custom agents, frontmatter reference, overriding builtins, tools, extensions, skills, per-agent memory. |
| [Models](docs/models.md) | Single-model selection and launch, defaults, per-role overrides, recommended tiering, thinking levels, model scope enforcement, profiles. |
| [Workflows](docs/workflows.md) | Orchestration patterns, prompt shortcuts, scripted workflows, worktree isolation, child-to-parent coordination, the recursion guard. |
| [Tool reference](docs/tool-reference.md) | Every `subagent` parameter, management actions, status/control actions, acceptance gates, external CLI runners. |
| [Observability](docs/observability.md) | FleetView, the fleet inspector, lifecycle artifacts, events, logs, session sharing. |
| [Missions](docs/missions.md) | Durable mission records, delivery receipts, run recovery. |
| [Configuration](docs/configuration.md) | Every `config.json` key and environment variable. |
| [Extension API](docs/extension-api.md) | The RPC, delegation API, preflight, capability ceilings, [trusted workflow resources](docs/extension-api.md#trusted-workflow-resources), background-work providers. |
