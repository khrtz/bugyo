# Adding bugyo to an existing project

English ・ [日本語](adopt.md)

These are the steps for adding bugyo to a project you already have, without `bugyo init`. It works whether you install with pnpm, npm, yarn, or bun.

## Only verification and the ledger

This setup uses no lint, only `bugyo verify` (running features for real and keeping the evidence) and the task ledger (only `bugyo task done` collects evidence and closes a task). It changes neither your folder structure nor your existing code. `bugyo` depends only on zod, and does not need `@bugyo/lint`.

### 1. Install

It is not published to npm, so build the package in this repository and install that file.

```bash
pnpm install && pnpm --filter bugyo pack
```

```bash
npm install --save-dev ../bugyo/packages/bugyo/bugyo-0.1.0.tgz
```

### 2. Write `.bugyo/config.json`

Pick one of two ways to check features.

**Check with a command per feature** (for things without a screen, or when your own script checks the screen):

```json
{
  "verify": { "runner": "command", "command": "node {spec}" },
  "featureMap": { "specDir": "checks", "specSuffix": ".mjs", "featuresDir": null },
  "evidence": { "tree": ["src", "checks"] }
}
```

**Check by operating the screen with Playwright**:

```json
{
  "featureMap": { "specDir": "e2e", "specSuffix": ".spec.ts", "featuresDir": null },
  "evidence": { "tree": ["src", "e2e"] }
}
```

You can keep your own Playwright config. To keep video, screenshots, and traces in `artifacts/`, use `defineBugyoConfig` from `bugyo/playwright` ([foundation.en.md](foundation.en.md#verification-playwright)).

| Key | How to decide |
| --- | --- |
| `featureMap.featuresDir` | Where the per-feature folders are, if you have them (e.g. `web/features`). Otherwise `null` (skips the check that matches feature folders) |
| `evidence.tree` | The paths hashed into the evidence: your product code and the folder of the check scripts |
| `commands` | If not written, defaults that follow the package manager are used (for npm, `npm run check` / `npm test` / `bugyo verify {feature}`). You need `check` and `test` scripts in `package.json` |
| `locale` | The language of the CLI output and rule messages: `en` (default) or `ja` |

Only a person changes this file (it changes what `done` decides). With bugyo's Claude Code plugin installed, agents are refused even when creating it, so a person writes the first version too.

With settings that create no lockfile (`package-lock=false` in `.npmrc`, for example), the package manager cannot be told from a lockfile and defaults to npm. To use another, write it in `packageManager` of `package.json` or of `.bugyo/config.json`.

In projects without feature folders (`featuresDir: null`), `logic` tasks (which need tests in the feature's `model/`) cannot be created. Use `bugfix` or `refactor`.

### 3. Put features on the map one at a time

Put one `docs/features/<id>.md` per feature. You do not need to map them all at once. Start with the features that break most often.

```md
---
id: billing
spec: checks/billing.mjs
---

# billing

## What is there
- The list of invoices, and PDF export

## How to reach it
- From "Billing" on the screen. The API is `/api/invoices`

## How to check it
- `npx bugyo verify billing`
- Success: this month's invoices appear in the list
- Error: when the API returns 500, a reload button appears
- Empty: with no invoices, "Nothing yet" appears

## Where it lies
- The list can show while only the PDF export is broken
```

In `spec`, write the file that really runs the feature to check it. Exit code 0 counts as passing.

```bash
npx bugyo verify billing
```

### 4. Add the ledger check to `check`

Add `bugyo task lint` at the end of the `check` script in `package.json`. Tasks hand-edited to `status: done` fail here.

```json
{ "scripts": { "check": "tsc --noEmit && eslint . && bugyo task lint" } }
```

Add `artifacts/` to `.gitignore`.

### 5. Close tasks with evidence

```bash
npx bugyo task add "Invoice PDF shows garbled text" --type bugfix --feature billing
```

```bash
npx bugyo task start t-001 --as worker-1
```

```bash
npx bugyo task done t-001
```

`done` runs what the task's type needs (check, test, verify, and so on) by itself, closes the task only if they pass, and keeps the evidence in `.bugyo/evidence/t-001.json`. The conditions per type are in [tasks.en.md](tasks.en.md#done-with-evidence).

### 6. Re-collect the evidence in CI

The local `task lint` only finds "done without evidence". To stop fake evidence too, re-collect the evidence of tasks closed in a PR in CI.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: npm ci
- run: npx bugyo task recheck --base "origin/${{ github.base_ref }}"
- run: npx bugyo task pr-check --base "origin/${{ github.base_ref }}"
```

`pr-check` checks that the PR's work is linked to a task (a `task/<id>` branch, or a task file changed in the PR). Write branches that need no task, such as dependency updates, as globs in `pullRequests.allowBranches` of `.bugyo/config.json`.

If you use an outside issue tracker, link an issue with `task add --issue <ref>`, and `recheck --notify` can report to that issue that the evidence was re-collected and passed ([Reporting to issues](tasks.en.md#reporting-to-issues)).

To require a person's review on PRs that change `.bugyo/config.json`, copy this repository's [config guard](../.github/workflows/config-guard.yml).

## Adding lint step by step

If your layer folders are not `src/app`, `src/features`, and `src/shared`, first write their places in `layers` of `.bugyo/config.json`, and pass it to ESLint and dependency-cruiser too ([Renaming the layer folders](foundation.en.md#renaming-the-layer-folders)).

Installing `@bugyo/lint` reports the violations in your existing code all at once. Keep today's violations as a baseline without stopping them, stop only new violations, and only ever shrink the baseline.

### 1. Count before you install

Only the parts and bans listed in `bugyo({ parts })` apply. Start with `[common, structure]`, and add bans such as comments, `fetch`, and `useEffect` ([Parts and bans](foundation.en.md#parts-and-bans)) one at a time, as your team agrees on them.

```bash
npx bugyo doctor --tsconfig tsconfig.json
```

Without changing anything, it prints the number of violations per ban, largest first. With `layers`, it also lists files that belong to no layer (the layer boundary rules do not apply to them). It also prints the folders inside features that belong to no role (`layers.featureParts`), and the number of files the `ui` and `model` bans apply to ([Renaming the folders inside a feature](foundation.en.md#renaming-the-folders-inside-a-feature)). For files ESLint could not read (syntax errors), it prints the file, the place, and the message. No other ban applies to such a file either, so check the parser or the `files` setting. Running it after adding `@bugyo/lint` to your ESLint config gives an estimate of the counts after installing. With `--tsconfig`, it also prints the number of `tsc` errors with that tsconfig (an estimate of adding the strictness of `@bugyo/lint/tsconfig`). With a dependency-cruiser config, it also counts violations of the dependency rules. Change the folders it counts with `--dirs web,server` (default `src`). Violations stopped by an `eslint-disable` comment with a reason are not counted.

### 2. Make today's violations the baseline

```bash
npx bugyo baseline save
```

It writes three files.

| File | Contents |
| --- | --- |
| `eslint-suppressions.json` | ESLint's suppressions (counts per file and rule). A feature since ESLint 9.24; violations listed here do not show in `eslint .` |
| `.dependency-cruiser-known-violations.json` | dependency-cruiser's known violations. Only with a dependency-cruiser config |
| `.bugyo/baseline.json` | counts per ban |

ESLint's suppressions are counts per file and rule, so swapping within the same rule in the same file, such as replacing `useEffect` with `useLayoutEffect`, gets through `eslint .`. `.bugyo/baseline.json` counts `no-restricted-imports` and the like per message, so it finds such swaps too.

`@bugyo/lint` puts the ban's name at the head of each ban message (in the form `[bugyo:use-effect]`). `.bugyo/baseline.json` counts the message up to that name. Rewriting the explanation after the name still counts as the same ban. Ban items without a message get no name and are counted by ESLint's default message.

A `.bugyo/baseline.json` from before counting by name (no `version`) is checked by `baseline check` the old way. Rebuilding it with `bugyo baseline save` gives the format that counts by name (`"version": 2`). In the PR that rebuilds it, `baseline diff` compares counts per rule, because the format differs from the base. Rebuilding alone does not count as growth. Conversely, a baseline put back to a format older than the base counts as growth and fails.

### 3. Check the counts in `check`

```json
{ "scripts": { "check": "tsc --noEmit && eslint . && depcruise src --ignore-known && bugyo baseline check && bugyo task lint" } }
```

`bugyo baseline check` fails unless the count per ban equals the baseline.

- When it grew: it is a new violation. Fix it instead of adding it to the baseline
- When it shrank: a fixed violation is still in the baseline. Shrink it with `bugyo baseline save` and commit it together
- When `eslint-suppressions.json` or `.dependency-cruiser-known-violations.json` exists without `.bugyo/baseline.json`: it fails, because swaps cannot be found

A ban that hits too many files to even put in the baseline can be lowered to warn with `bugyo({ severity })` ([Lowering a ban to warn](foundation.en.md#lowering-a-ban-to-warn)). Warnings do not fail lint, but `bugyo doctor` keeps counting them as debt.

### 4. Check in CI that the baseline did not grow

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: npm ci
- run: npx bugyo baseline diff --base "origin/${{ github.base_ref }}"
```

`baseline diff` fails if any of the three files grew compared to the base. Shrinking and deleting files pass. When it truly must grow, set it up so a person checks the diff before it passes. This repository's [config guard](../.github/workflows/config-guard.yml) passes only PRs with the label `bugyo-baseline-approved`.

### Counting results of other linters

Linters other than ESLint and dependency-cruiser can be counted together in `bugyo doctor` and `bugyo baseline` if they can write their results as SARIF. List the command and the file in `sarif` of `.bugyo/config.json`.

```json
{ "sarif": [{ "command": "semgrep scan --sarif --output artifacts/semgrep.sarif", "file": "artifacts/semgrep.sarif" }] }
```

- It counts per tool and rule (`sarif: <tool>/<rule>`; the tool name is SARIF's `tool.driver.name`). It does not count files and lines, so a violation that only moved does not change the count
- With `command`, it deletes `file`, runs the command, and reads what was written. It does not look at the exit code (many tools exit non-zero when there are violations). It fails if `file` was not written
- Without `command`, it only reads `file` (when an earlier CI step writes it)
- Results with an accepted suppression (a `suppressions` entry whose `status` is not `rejected`) and results whose `kind` is not `fail` are not counted

## What cannot be checked

`bugyo verify` only checks whether the steps written in the spec pass in the current environment. It cannot stop an "I checked it" about the state of outside environments (production data, another service's settings, and so on).
