---
description: Plan and execute unattended in one run; bare /perl executes an existing plan.md
---

Run the `perl` workflow through `subagent_workflow`.

- If the invocation below includes a task description, first make sure the direction is settled: if it is ambiguous or carries an unmade decision, say so and stop instead of launching — this lane never waits for a confirmation. Otherwise call `subagent_workflow({ workflow: "perl", args: { task: "<the settled task description>", slug: "<short-kebab-name>" } })`. That one run writes `plan.md` and immediately executes it (scout, worker, bounded review/fix loop) with no pause for approval. The run works in a git worktree next to the repository root (default `.pi-perl-<repo>` on branch `perl/work`; with a slug, `.pi-perl-<repo>-<slug>` on `perl/work-<slug>`; the result reports the `worktree` path). Choose a short, descriptive slug (e.g. `auth-fix`); it distinguishes concurrent perl tasks in the same repo. Summarize the result (verdict, findings, worktree) and stop. To review the plan before execution, use `/perla` instead.
- If there is no task description, call `subagent_workflow({ workflow: "perl", args: { slug: "<the slug of the run that wrote the plan>" } })` to execute an existing `plan.md` (scout, worker, bounded review/fix loop) in that same worktree — the slug must match the plan call or the execute phase will not find `plan.md`. Omit the slug only when the plan call used the default lane. If no `plan.md` exists in that worktree (or in the working directory), say so instead of launching.

Task text from the slash command:

$@
