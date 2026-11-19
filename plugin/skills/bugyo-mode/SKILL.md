---
name: bugyo-mode
description: The entry point for all work — writing, fixing, investigating, reviewing code — in a project built on bugyo (@bugyo/lint, the bugyo CLI, and the feature map in docs/features). Tells the kind of work apart, picks the fitting way to proceed (new feature, bug fix, refactor, investigation, review, turning a mistake into a rule), and finishes with evidence. In a project whose CLAUDE.md or package.json mentions bugyo / @bugyo/lint, use this first on any request to implement or fix something, even if the user does not name it.
---

# bugyo-mode

This project is built so that an agent can only pick the right way of doing things.
Lint and types teach you what is banned, so you do not need to remember it.
Your job is to pick the way of working that fits the kind of work, and to show that it is done with **evidence**.

## Check first

- Read `CLAUDE.md` (it has the commands and the definition of done)
- Find the feature the change touches in `docs/features/README.md` and open **only that one** feature file. Do not read them all; spend tokens on verification

## Tell the kind of work apart

| Request | How to proceed |
| --- | --- |
| Add a new feature | Create the skeleton with `bugyo new feature <id>` → wire it into the screen → fill `docs/features/<id>.md`. Details in `bugyo-new-feature` |
| Fix a bug | **Reproduce it with a failing test first**, then fix it. Do not fix it until you can reproduce it |
| Refactor | Pin today's behavior with tests first, and show that they still pass after the change |
| Learn how something works | Trace the real code with `bugyo-explain`. Do not answer from guesses |
| Review something | Use `bugyo-critique`: look at the evidence first, then review critically |
| The same mistake a second time | Turn it into a rule with `bugyo-rule-from-mistake` |
| Write the feature map of an existing app | Draft it from the real code and checks with `bugyo-map-features` |

## While writing

- **Do not pick the smallest fix.** A stopgap gets copied by the next agent and spreads. Fix it in the right place, in the right shape. If the root cause is elsewhere, fix it there
- When lint stops you, follow the "what to use instead" in the error message. Do not silence it with `eslint-disable`. If it is truly needed, write `-- <reason>` and tell the user
- If existing code breaks a rule, fix it instead of copying it. Do not leave violations in an "exception list"
- Do not explain intent with comments (lint stops them in projects that use `noComments`). Express it with names, types, and tests

## When work is done

Passing `pnpm check` alone is not done. Finish only after you show the evidence for the kind of change.

| Kind of change | Evidence |
| --- | --- |
| Logic in model/ | Vitest and fast-check property tests pass |
| Bug fix | A test that fails before the fix and passes after it |
| UI interaction | `pnpm verify <id>` PASSes and `artifacts/` has the video and trace |
| UI look | The screenshot comparison shows only the intended diff |
| Refactor | Tests that passed before the change still pass after it, unchanged |

In the report, write "which evidence confirmed it" before what you changed. Write down what you could not confirm as not confirmed. Write the report in the user's language.
If you changed the UI or behavior, fix `docs/features/<id>.md` in the same change with `bugyo-sync-feature-map` (`pnpm test` finds a missing match).
