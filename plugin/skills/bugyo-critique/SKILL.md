---
name: bugyo-critique
description: Review a change or PR critically, without going easy on it. Check the evidence (pnpm verify artifacts, tests) before the lines of code, and look for stopgap fixes, patterns that would hurt if copied, and mistakes that should become rules. Use when asked "review this", "is this OK?", "can I merge?" (「レビューして」「これで大丈夫？」「マージしていい？」), and as a self-review right before reporting your own work.
---

# bugyo-critique

Your job is to check that this change **does no harm if copied**, not only that it works.
Do not look for things to praise. If you find no problems, that is fine.

## 1. Look at the evidence first

Before reading the code, check that the evidence fits the kind of change (the "When work is done" table in `bugyo-mode`).

- A UI change with no `pnpm verify <id>` result → that alone is a reason to send it back
- A bug fix with no test that fails before the fix → send it back
- If there is evidence, check that it matches the claim (does the video really do that operation, is the screenshot diff the intended one)

## 2. Use independent eyes

A change you wrote looks right to you because of your own assumptions. Give the `slop-reviewer` subagent only the diff and what the change is for, and let it review. Do not hand over your conclusion.
For a large change, run several with separate angles (correctness / design boundaries / enough verification).

## 3. What to look for

- **Stopgaps**: stopping the symptom short of the root cause, matching timing with `setTimeout`, swallowing errors with `?.` or `?? []`
- **Shapes that hurt if copied**: whether a newly introduced pattern becomes a model for the next agent and spreads
- **Broken boundaries**: dependencies that skip the public entry point, side effects slipped into model
- **Silent disabling**: `eslint-disable` with a thin reason, skipped tests, loosened thresholds
- **Feature map drift**: the UI changed but `docs/features/<id>.md` is still old

## 4. Report

List the findings, heaviest first, and for each write concretely which input or state breaks what. Mark guesses as guesses.
If the same kind of finding comes up a second time, do not stop at pointing it out: propose a rule with `bugyo-rule-from-mistake`.
Write the report in the user's language.
