---
name: bugyo-map-features
description: Draft the feature map (docs/features/<id>.md) for an app that already exists, by tracing the real code and checks, so agents can find and check each feature without reading the source. Use when bugyo is being added to an existing project, when docs/features is empty or missing features, or when asked "write the feature map", "map the features", "make docs/features" (「feature map を作って」「機能の地図を書いて」「docs/features を起こして」). Do not create feature folders by hand for this; it only writes the map and the checks.
---

# bugyo-map-features

The feature map tells the next agent what each feature is, how to reach it, how to check it, and where it lies. A wrong map is worse than none, so write only what you traced or ran.

## 1. Find the features

- List what users can see or call: screens and routes, commands, API endpoints, jobs. One user-visible unit is one feature
- If the project has feature folders (`featureMap.featuresDir` in `.bugyo/config.json`, by default `src/features`), each folder is one feature and the id is the folder name. Otherwise, pick short ids of lowercase letters, digits, and hyphens
- Start with the features that break most often or matter most. You do not need to map everything at once; say in the report which ones are left

## 2. Find or write the check

Each feature needs a `spec`: a file that really operates the feature and fails when it is broken.

- Prefer an existing E2E test or script that already does this (it must live under `featureMap.specDir` with `featureMap.specSuffix`, or `pnpm test` reports it as unmapped)
- If there is none, write one in the spec folder. It must exercise the feature from the outside (drive the screen, run the command, call the endpoint), not call internal functions
- Run `pnpm verify <id>` (or the project's verify command) and see it pass. Then break the feature on purpose once, see it fail, and undo the break

## 3. Write `docs/features/<id>.md`

Use the headings in the project's language (`locale` in `.bugyo/config.json`): `What is there` / `How to reach it` / `How to check it` / `Where it lies`, or `何があるか` / `どう辿り着くか` / `どう操作して確かめるか` / `よく嘘をつくところ`.

```md
---
id: invoices
route: /invoices
spec: e2e/invoices.spec.ts
---

# invoices

## What is there
- The list of this month's invoices, and PDF export of one invoice

## How to reach it
- "Invoices" in the top menu. The data comes from `/api/invoices`

## How to check it
- `pnpm verify invoices`
- Success: this month's invoices appear, newest first
- Error: when the API returns 500, a retry button appears
- Empty: with no invoices, "Nothing yet" appears

## Where it lies
- The list can show while PDF export is broken; the spec opens one PDF
```

- Write at the level of behavior, short. Someone who never read the code must be able to operate it from this file alone
- Every claim comes from code you traced or a run you saw. If you could not confirm something, leave it out rather than guess
- Do not leave template items: no item that is only `(…)` / `（…）`, and no item that ends with `:` / `：` with nothing after it. `bugyo task done` refuses those
- Under "Where it lies", write what looks fine while broken: things tests pass but users hit, from bug history, issues, and fragile code you saw
- Add `route` only for features with a screen

## 4. Put it in the order and check

- Add `[id](id.md)` to the regression order in `docs/features/README.md`
- Run `pnpm test`. The feature map checks find missing headings, missing specs, unmapped spec files, and unmapped feature folders
- Run `pnpm verify <id>` for every feature you mapped

## Report

Write it in the user's language: which features you mapped, the verify result of each, what you broke on purpose to see the spec fail, and which features are not mapped yet.
