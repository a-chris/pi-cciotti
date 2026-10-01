---
description: Plan the task into plan.md; bare /perl executes the reviewed plan
---

Run the `perl` workflow through `subagent_workflow`.

- If the invocation below includes a task description, first make sure the direction is settled: if it is ambiguous or carries an unmade decision, ask me one or two focused questions before launching. Then call `subagent_workflow({ workflow: "perl", args: { task: "<the settled task description>", slug: "<short-kebab-name>" } })`. That runs the plan phase only: the `planner` agent writes `plan.md` and the run stops. The run works in a git worktree next to the repository root (default `.pi-perl-<repo>` on branch `perl/work`; with a slug, `.pi-perl-<repo>-<slug>` on `perl/work-<slug>`; the result reports the `worktree` path), so tell me where to review `plan.md`. Choose a short, descriptive slug (e.g. `auth-fix`); it distinguishes concurrent perl tasks in the same repo. Summarize the plan briefly and stop so I can review `plan.md`; do not run the execution phase in the same turn.
- If there is no task description, call `subagent_workflow({ workflow: "perl", args: { slug: "<the slug the plan call used>" } })` to execute the existing `plan.md` (scout, worker, bounded review/fix loop) in that same worktree — the slug must match the plan call or the execute phase will not find `plan.md`. Omit the slug only when the plan call used the default lane. If no `plan.md` exists in that worktree (or in the working directory), say so instead of launching.

Task text from the slash command:

$@
