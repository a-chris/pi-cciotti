---
description: Plan the task into plan.md; bare /perl executes the reviewed plan
---

Run the `perl` workflow through `subagent_workflow`.

- If the invocation below includes a task description, first make sure the direction is settled: if it is ambiguous or carries an unmade decision, ask me one or two focused questions before launching. Then call `subagent_workflow({ workflow: "perl", args: { task: "<the settled task description>" } })`. That runs the plan phase only: the `planner` agent writes `plan.md` and the run stops. Summarize the plan briefly and stop so I can review `plan.md`; do not run the execution phase in the same turn.
- If there is no task description, call `subagent_workflow({ workflow: "perl" })` to execute the existing `plan.md` (scout, worker, bounded review/fix loop). If `plan.md` does not exist in the working directory, say so instead of launching.

Task text from the slash command:

$@
