---
description: Run a bounded supervisor-mediated council of advisors and write a decision memo
argument-hint: "<question> [--advisors name,name] [--max-passes 2|3] [--scope ...] [--non-goals ...]"
---

Run a bounded, supervisor-mediated council on this question. You, the parent
session, are the supervisor, the only synthesizer, and the decision maker.

Before you orchestrate, read `skills/council-mode/SKILL.md` and follow it for the
supervisor role, the roster and its fallback rules, degraded-mode labeling, the
pass cap and its defaults, the protocol, execution controls, and the memo
requirements. The
question and scope provide the decision frame, so when the user wants a specific
lens they put it in the question, the scope, or the profile definition.

Parse the flags yourself; they are conventions, not runtime options. An
`--advisors` name is an exact agent name: fail clearly on an unknown one, and do
not require or invent per-advisor role labels.

If the question is trivial or settled, answer directly instead of convening a
council.

Question and options from the slash command invocation:

$@
