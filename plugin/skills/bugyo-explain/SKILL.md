---
name: bugyo-explain
description: Explain how a mechanism in this codebase (a feature, a data flow, state, the build or verification) "actually" works by tracing the code. Use when asked "how does X work?", "where does it do X?", "what is affected if I change X?" (「〜はどう動いてる？」「どこで〜してる？」「〜を変えたらどこに影響する？」), and before a large change to grasp its reach. Use this before answering from memory or guesses.
---

# bugyo-explain

Base the explanation on code you traced, not on guesses.

## Steps

1. **Pick the entry point.** For a feature, start from "How to reach it" and `route` in `docs/features/<id>.md`; for code, start from `src/features/<id>/index.ts` (the public entry point)
2. **Trace the flow.** Follow the direction of bugyo's layers: `app` → `features/<id>/ui` → `api` (`useXxxQuery` → `getJson` and the schema in `shared/api`) → `model` (pure functions). Side effects live only in the hooks of `shared/lib`
3. **Back every claim.** Each time you write "it does X", add `path:line`. Mark the parts you could not trace as "not confirmed"
4. **Run it to check (when needed).** If the explanation is about behavior, check it with a test or `pnpm verify <id>`. Keep explanations from reading apart from explanations you checked by running

## Output

Write it in the user's language.

- A three-line summary (what works, where, and how)
- The flow (from entry to exit, with `path:line`)
- Where to touch to change it, and what breaks easily
- Any disagreement with the feature map (and a proposal to fix `docs/features/<id>.md`)
