# AGENTS.md

Agents working in this repository must read [VISION.md](VISION.md) before making product, architecture, scope, or backlog-disposition decisions.
VISION.md is the acceptance policy for this project: use it to judge whether a proposed change, issue, or PR fits.
This file intentionally does not duplicate user-global or tool-level instructions.

## Where work and PRs go

This checkout is a fork with two remotes:

- `origin` = `a-chris/pi-cciotti` — the owner's fork. **All work and all pull requests go here.**
- `upstream` = `nicobailon/pi-subagents` — the original project. Read-only: never push branches or open PRs against it.

Before creating a PR, verify which repo `gh` resolved to:

```
gh repo view --json nameWithOwner -q .nameWithOwner   # must print a-chris/pi-cciotti
```

If it prints `nicobailon/pi-subagents`, do not continue: run `gh repo set-default a-chris/pi-cciotti` and re-check. This is not hypothetical — when a remote named `upstream` exists, `gh` prefers it over `origin` for PR creation, and that silently targets the original repo.

When creating a PR: branch from `origin/main`, push to `origin`, and let `gh pr create` target the fork (or pass `--repo a-chris/pi-cciotti` explicitly).

## Running tests

Run the minimum number of test files needed to cover your changes. Do not run the full suite during development.

Single test file commands:

- Unit: `node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/<file>.test.ts`
- Integration: `node --experimental-strip-types --import ./test/support/register-loader.mjs --test test/integration/<file>.test.ts` (the register-loader import is required; plain `npm test` flags do not apply to a single file)

Pick the test files that cover the behavior you changed; if no existing test file covers it, add one. Only run the whole suite (`npm run test:all`) once, at the end of the work, together with `npm run typecheck`, as the final proof that everything is working.
