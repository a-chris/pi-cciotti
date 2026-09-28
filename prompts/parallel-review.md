---
description: Parallel subagents review
---

Launch parallel `reviewer` agents for an adversarial review of the current work.

Use fresh context, not forked context, unless I explicitly ask for forked context. Reviewers should inspect the repository, relevant instructions, and current diff directly from files and commands. Do not rely on the main conversation history.

Give each reviewer a distinct angle. Generate the angles dynamically from the user's intent, the plan, the implemented code, and the current diff. If I specify angles, use mine. Otherwise, choose the highest-value review angles for this specific work.

These are examples, not fixed defaults:

1. Correctness and regressions
   Check whether the change satisfies the request, preserves existing behavior, handles edge cases, and avoids hidden runtime failures.

2. Tests and validation
   Check whether tests or validation were added at the right layer, whether assertions are meaningful, and whether the chosen verification commands are enough.

3. Simplicity and maintainability
   Check for unnecessary complexity, duplicate structure, single-use wrappers, brittle abstractions, confusing names, verbosity, and cleanup that is clearly worth doing.

Choose or adapt angles when the work calls for it:
- TypeScript-heavy changes: include type safety, source-of-truth types, casts, and error-boundary discipline.
- UI-heavy changes: include UX, accessibility, copy, and visual quality.
- Security-sensitive changes: include unsafe input/output handling, auth boundaries, privacy, and data exposure.
- Docs-heavy changes: include clarity, accuracy, completeness, reader flow, and non-robotic prose.
- Large multi-file changes: consider a fourth reviewer for structural friction, module boundaries, and testability.

Prefer three strong reviewers over many vague reviewers.

Give every reviewer a specific task prompt naming its angle. Name the `reviewer` agent so each child carries its own contract — evidence bar, P0/P1/P2 labels, merge verdict wording, `No issues found.`, and the blockers-only rule — and put only the review target and angle in the task; do not restate that contract. Do not ask a first-pass review for `blockers only`; that mode is for a final pre-merge re-check or an emergency hotfix.

For a targeted follow-up review, ask only whether the named finding was resolved, whether the fix introduced a new defect in the fix blast radius, and whether prior P1/P2 notes still stand. For bot or PR-comment triage, classify each comment as VALID, STALE, INVALID, or OUT-OF-POLICY against current HEAD, then assign P0/P1/P2 only to VALID comments.

While reviewers run, do your own narrow inspection if useful. After they return, synthesize the feedback into:
- fixes worth doing now
- optional improvements
- feedback to ignore or defer, with a short reason

Do not blindly apply every reviewer suggestion.

Autofix mode: if the invocation contains the exact word `autofix`, remove it before deciding the review target — it changes what you do with findings, not what counts as one. In autofix mode, after synthesis apply only the fixes worth doing now, validate, and summarize; do not apply optional improvements unless I ask, and do not edit at all if there are no fixes worth doing now.

Without autofix mode, ask before applying fixes unless I already told you to address review feedback. When you ask, end with this numbered menu so I can reply with a number, adapting wording to the findings:

```text
Reply with [1], [2], or further instructions:
[1] Apply only the fixes worth doing now.
[2] Apply the fixes worth doing now plus optional improvements.
```

Additional review target or focus from the slash command invocation:

$@

If the invocation provides a URL, issue link, file path, plan path, or freeform focus, treat it as the primary review scope. Read or fetch that target before assigning reviewer angles, and pass the target explicitly into each reviewer task.
