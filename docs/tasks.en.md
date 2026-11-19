# Task ledger and gate

English ・ [日本語](tasks.md)

This layer records each piece of work handed to agents as one file, and lets it close only when the evidence passes. Whether a task is done is decided by the ledger, not by the agent's report.

Everything on this page works in the current code.

## The shape of a task

Each task is one file, `.bugyo/tasks/<id>.md`. Several agents can update different tasks at the same time without conflicts, and people can read them as they are in an editor. The CLI assigns ids in order from `t-001`.

Ids and claims do not collide even when tasks run in parallel, one worktree per task.

- Inside a git repository, `add` records the id and `start` records the claim as git refs (`refs/bugyo/<project path>/ids/<id>` and `.../claims/<id>`), created only if they do not exist yet. Worktrees of the same repository share refs, so two worktrees running `add` at once get different ids, `start` refuses a task claimed in another worktree, and such a task does not appear in `ready`
- To share with other machines (other clones) too, write the remote's name in `claims.remote` of `.bugyo/config.json`. The remote refs are fetched before reserving and claiming, and pushed after creating them
- A claim disappears with `drop`, and `rework --as` changes its assignee. A person clears the claim of a stuck agent with `bugyo task release <id>`
- As a last net for refs overwritten by a force push, run `bugyo task lint --base <ref>` in CI. It fails, before merging, on a different task with an id that already exists on the base branch
- Outside a git repository, only the local files decide

```md
---
status: active
type: bugfix
feature: todos
blocked-by:
assignee: worker-1
rework: 0
gate-attempts: 1
created: 2026-11-18T09:00:00.000Z
tests-hash: sha256:…
repro: pnpm exec vitest run src/features/todos/model/todo.test.ts
repro-at: 2026-11-18T09:10:00.000Z
---

# Remaining count drifts when switching the filter

(What is happening, and what counts as done)
```

The frontmatter is a single level of `key: value`, read the same way as the feature map. Unknown keys make `bugyo task lint` fail.

| Key | Meaning |
| --- | --- |
| `status` | `open` (not started) → `active` (in progress) → `done` (done with evidence). Dropped work is `dropped` |
| `type` | The kind of change. It decides the evidence needed to finish |
| `feature` | The `id` of `docs/features/<id>.md`. It decides which feature to verify |
| `issue` | Optional. A reference to an outside issue tracker (`123`, `PROJ-45`, an issue URL, ...). When CI re-collects the evidence and it passes, the `notify.verified` command reports to it |
| `blocked-by` | Ids of tasks that must be done first (comma-separated) |
| `assignee` | The name of the agent or person working on it |
| `model` / `harness` | Optional. The names of the model and harness that did the work. The CLI writes them from `--model` / `--harness` of `start` and `done` (or the environment variables `BUGYO_MODEL` / `BUGYO_HARNESS`). `bugyo stats` splits results by them |
| `rework` | How many times a person sent it back after it was done |
| `gate-attempts` | How many times `done` tried to close it. Keeps counting after rework |
| `created` | When it was created |
| `tests-hash` | The hash of the test files at `start`. Compared when a `refactor` closes |
| `repro` / `repro-at` | For `bugfix`, the test command that failed before the fix, and when |
| `repro-status` / `repro-log` / `repro-tests-hash` / `repro-expect` | At `repro`: the exit code, the file with the tail of the output (`.bugyo/evidence/<id>.repro.log`), the hash of the test files, and the `--expect` text |
| `drop-reason` / `dropped-at` | Why it was dropped, and when |
| `evidence-file` / `evidence-tree` / `evidence-at` | Written only by the CLI when it closes: where the evidence file is, the hash of the code at that time, and when it closed |

Done and dropped tasks move to `.bugyo/tasks/archive/`. Neither the list nor what agents read keeps growing.

## Commands

Agents use four: `ready` → `start` → `show` → `done`. The output is one line per task, and `--json` gives short JSON. The exit code is 0 on success, 1 when refused, and 2 for a usage error.

| Command | Used by | What it does |
| --- | --- | --- |
| `bugyo task add "<title>" --type <type> [--feature <id>] [--issue <ref>] [--blocked-by <id,...>] [--body "<body>"]` | people, agents | Creates a task. Refuses a `--feature` that is not in the feature map. `--feature` is required for `feature`, `ui-flow`, `ui-look`, and `logic`. Refuses a `--blocked-by` that does not exist. `--issue` starts with a letter or digit and uses only letters, digits, and `# . _ : / -` (a leading `#` starts a comment in the shell, so write `123`, not `#123`) |
| `bugyo task ready` | agents | Lists open tasks whose `blocked-by` are all `done`, in creation order |
| `bugyo task start <id> --as <name> [--model <model>] [--harness <harness>]` | agents | Marks it in progress. Refuses if someone is already on it, if the same name is on another task, or if its `blocked-by` are not done |
| `bugyo task show <id>` | agents | Prints the body, the feature map to read, and what done requires |
| `bugyo task repro <id> [--expect "<text>"] -- <test command>` | agents | For `bugfix`. Checks that the command fails before the fix, and records the exit code, the tail of the output, and the hash of the test files. Refuses a command that passes now, one whose first command is not found (also exit codes 127 / 9009), one that ran no tests, and one whose output lacks the `--expect` text |
| `bugyo task done <id> [--model <model>] [--harness <harness>]` | agents | Collects the evidence and closes the task if it passes. Otherwise prints why and keeps it in progress |
| `bugyo task rework <id> -r "<reason>" --kind <mistake kind> [--as <name>]` | people | Moves a done task back to in progress and records the rework and the kind of mistake. The assignee stays the same; if that person is on another task it refuses, so name another assignee with `--as` |
| `bugyo task drop <id> -r "<reason>"` | people | Drops it. A done task cannot be dropped. Also clears the claim |
| `bugyo task release <id>` | people | Clears the claim of a stuck agent. Does not change the ledger file |
| `bugyo task ls [--all]` | people | Lists tasks. `--all` includes done and dropped ones |
| `bugyo task lint [--base <ref>]` | `pnpm check`, CI | Checks the ledger. With `--base`, it also finds tasks added in `<ref>...HEAD` whose id belongs to a different task (with a different creation time) already in `<ref>` |
| `bugyo task recheck [<id>...] [--base <ref>] [--notify]` | CI | Re-collects and compares the evidence of done tasks. With `--base`, the targets are tasks added or changed in `archive/` in `<ref>...HEAD`. Does not rewrite evidence files. With `--notify`, reports tasks with an `issue` that passed through the `notify.verified` command |
| `bugyo task pr-check [--branch <name>] [--base <ref>]` | CI | Checks that the PR's work is linked to a task. Passes if the branch name is `task/<id>` (a description may follow, as in `task/t-001-login`) and that task is in the ledger, or if a task file changed in the diff from `--base`. The branch name comes from `--branch`, then `GITHUB_HEAD_REF`, then the current branch |
| `bugyo mistake ls` / `rule <kind> --at <path> [--name <rule name>]` | people, agents | The list of mistakes with the number of kinds that became rules, and recording that one became a rule |
| `bugyo gate` | people | Decides whether to widen what agents may do. 0 on pass, 1 on fail |
| `bugyo stats` | people | Results of closed tasks per task type, model, and harness |

`show` prints enough that an agent knows "what to read and what to deliver" from it alone. Commands appear after the config strings are substituted.

```
t-014 [active/bugfix] Remaining count drifts when switching the filter  (feature: todos, assignee: worker-1)
read: docs/features/todos.md
done requires: a recorded repro → the same test passes → pnpm check → pnpm test
```

## Done with evidence

Only `bugyo task done <id>` can make a task `done`, and the command collects the evidence itself. The agent's "I checked it" report is not used.

1. Decide what is needed from the task's `type` (the table below). If a needed command is not in the config (undefined or empty), refuse without running anything
2. Add 1 to `gate-attempts`
3. Check in the order of the table. Commands run in a shell exactly as written in the config
4. If everything passes, write a summary of the results to `.bugyo/evidence/<id>.json`, fill `evidence-*`, mark it `done`, and move it to `archive/`
5. If anything fails, print only what failed, why, and the last 30 lines of the command's output, and keep it `active`

| `type` | Kind of change | What done requires (checked in this order) |
| --- | --- | --- |
| `feature` | a new feature | the four headings of the feature map are neither empty nor still the template, check, test, verify |
| `ui-flow` | UI interaction | check, test, verify |
| `ui-look` | UI look | check, verify |
| `logic` | logic in `model/` | the feature's `model/` has tests (`*.test.*`), check, test |
| `bugfix` | a bug fix | a recorded `repro`, the same command passes now, check, test. If the test files changed after `repro`, it closes but warns, and records it in the evidence's `warnings` |
| `refactor` | a refactor | the test files are unchanged since `start`, check, test |
| `chore` | config, docs | check only |

- "Still the template" means a heading with nothing under it, or with items that are only `(…)` / `（…）` or have nothing after `:` / `：`
- Test files are JS / TS files under the `evidence.tree` paths whose names contain `.test.` or `.spec.`
- Screenshot baselines (by default `e2e/__screenshots__`) are under `evidence.tree`, so updating baselines in a `ui-look` task puts their contents into the `evidence-tree` hash

The evidence file holds the command strings that actually ran, their exit codes and durations, the conditions that passed, the verify result (the contents of `artifacts/verify.json`: each feature's result, the commands verify ran inside, and where the evidence is), and the hashed paths and their hash.

```json
{
  "task": "t-001",
  "type": "ui-flow",
  "feature": "todos",
  "closedAt": "2026-11-18T09:30:00.000Z",
  "attempt": 2,
  "rework": 0,
  "conditions": [],
  "steps": [
    { "name": "check", "command": "pnpm check", "status": 0, "ms": 11557 },
    { "name": "test", "command": "pnpm test", "status": 0, "ms": 1952 },
    { "name": "verify", "command": "bugyo verify todos", "status": 0, "ms": 6269, "results": { "file": "artifacts/verify.json", "runner": "playwright", "passed": true, "features": [{ "id": "todos", "ok": true, "command": "playwright test \"e2e/todos.spec.ts\" --reporter=line,json,html" }], "evidence": ["…"] } }
  ],
  "tree": { "paths": ["src", "e2e"], "hash": "sha256:…" }
}
```

Stale evidence can be detected too. `evidence-tree` holds the hash of the contents of the files under the `evidence.tree` paths when the evidence was collected (`node_modules` excluded). Line endings of text files are normalized to LF before hashing (so Windows line-ending conversion does not make local and CI values differ).

CI runs `bugyo task recheck` on the tasks closed in the PR (files added or changed in `archive/`) and fails if any of these hold. Tasks closed earlier are not compared (later changes would always break them).

- The commands recorded in the evidence differ from the commands the current config needs for that kind of task
- Re-running the same steps as `done` (conditions and commands) does not pass
- The hash of the current code differs from `evidence-tree`

What is compared is "whether the same steps pass in CI", not "whether the agent really ran them locally".

Close one task per PR. If one PR closes several tasks in a row, the `evidence-tree` of the earlier ones does not match the current code, which includes the later tasks' changes, so the comparison fails.

Videos and traces do not go into git. The repository keeps only the summary JSON; the real files stay in the local `artifacts/` and in CI artifacts.

### Reporting to issues

Tasks with an `issue` can be reported to the outside issue tracker when CI re-collects the evidence and it passes. Only `bugyo task recheck --notify` reports; a local `done` does not (local evidence is not certain until CI re-collects it).

```json
{ "notify": { "verified": "gh issue comment {issue} --body \"CI re-collected and confirmed the evidence of {task} ({evidence})\"" } }
```

Adding `--notify` on every PR would report to the same issue on every push. Report once, when it lands on main.

```yaml
on:
  push:
    branches: [main]
permissions:
  contents: read
  issues: write
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - run: npm ci
      - run: npx bugyo task recheck --base HEAD^ --notify
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`--base HEAD^` compares only the tasks closed by the commit that landed on main (a merge or a squash).

- The command runs in a shell. `{issue}`, `{task}`, and `{evidence}` (where the evidence file is) are replaced, and the same values plus the task title are also in the environment variables `BUGYO_ISSUE`, `BUGYO_TASK`, `BUGYO_EVIDENCE`, and `BUGYO_TITLE`. The title is not embedded in the command; read it from the environment
- Only tasks that passed the comparison are reported. If the command fails, it only warns, and the result of `recheck` does not change
- Whether the issue gets closed is up to this command (just a comment, or closing it too)

## Settings

The commands `done` runs, the hashed paths, and the gate thresholds are set in `.bugyo/config.json`. Where the file lives and the settings for how features are checked (`verify`, `featureMap`) are in [foundation.en.md](foundation.en.md#config-file-bugyoconfigjson).

```json
{
  "commands": { "check": "pnpm check", "test": "pnpm test", "verify": "bugyo verify {feature}" },
  "evidence": { "tree": ["src", "e2e"] },
  "gate": { "window": 20, "maxRework": 2, "minFirstPass": 16, "maxDropped": 2 }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `commands.check` / `test` / `verify` | follows the package manager (pnpm: `pnpm check` / `pnpm test`, npm: `npm run check` / `npm test`, yarn: `yarn run check` / `yarn test`, bun: `bun run check` / `bun run test`; `verify` is always `bugyo verify {feature}`) | The commands `done` runs. How the package manager is decided: `packageManager` in [foundation.en.md](foundation.en.md#config-file-bugyoconfigjson). `{feature}` is replaced by the task's feature and `{task}` by the task id. They run in a shell with `node_modules/.bin` added to the front of `PATH` |
| `evidence.tree` | `["src", "e2e"]` | The paths hashed into `evidence-tree`. Test files are hashed under these too |
| `gate.window` | `20` | How many of the latest closed tasks (done and dropped) the gate looks at |
| `gate.maxRework` | `2` | The most of those that may have needed rework |
| `gate.minFirstPass` | `16` | The fewest of those that must have closed on the first `done` |
| `gate.maxDropped` | `2` | The most of those that may have been dropped |
| `gate.scopes` | the three below | The verdict per group of task types. `{ "<name>": { "types": [...], "window"?: …, "maxRework"?: …, "minFirstPass"?: …, "maxDropped"?: … } }`. A group without thresholds uses the values above |
| `claims.remote` | none | The name of the remote that shares id reservations and claims (e.g. `origin`). Without it, they are shared only between worktrees on the same machine |
| `pullRequests.allowBranches` | `[]` | Globs of branch names that `bugyo task pr-check` lets through without a task (e.g. `["dependabot/**", "release/*"]`) |
| `notify.verified` | none | The command `bugyo task recheck --notify` runs for each task with an `issue` that passed the comparison (see "Reporting to issues" above) |
| `locale` | `en` | The language of the CLI output: `en` or `ja`. `BUGYO_LOCALE` comes first |

- The defaults are used only when the `commands` key itself is missing. If `commands` exists, only what is written is used, and `done` refuses when a command the task type needs is undefined or empty
- **Only a person changes `.bugyo/config.json`.** Changing the commands changes what `done` decides. Agents do not rewrite this file. To leave a trace of changes, the evidence file records the command strings that ran (including the ones verify ran inside) and the hashed paths as they are

## Where it is enforced by machine

What must always hold is stopped by the CLI, `pnpm check`, and CI, not by skills (written instructions). It is built on the assumption that a skill may not be invoked.

| Where | What it stops |
| --- | --- |
| CLI | Only `done` collects and writes evidence. `start` refuses double claims (from another worktree, or from another clone with `claims.remote`) and one person holding two tasks. `add` does not reuse an id from another worktree. `add` refuses features not in the feature map and `blocked-by` that do not exist. `done` refuses when a needed command is not in the config |
| `bugyo task lint` (in `pnpm check`) | Tasks hand-edited to `status: done` (no evidence file, not in `archive/`, evidence that does not match `evidence-tree`, `rework`, or `gate-attempts`), `active` without an assignee, one person with two `active` tasks, `blocked-by` that do not exist, features not in the feature map, unreadable frontmatter, duplicate ids. Repeated mistakes are reported as warnings |
| CI (`bugyo task recheck --base`) | Tasks closed in the PR that do not pass when re-run, whose `evidence-tree` does not match the current code, or whose recorded commands differ from the current config |
| CI (`config guard`) | PRs that change `.bugyo/config.json` without the label `bugyo-config-approved` |
| CI (`bugyo task lint --base`) | PRs that add a different task with an id that already exists on the base branch |
| CI (`bugyo task pr-check --base`) | PRs not linked to a task. A PR counts as linked if its branch name is `task/<id>` (in the ledger and not dropped), or if it changes a task file. Branches matching `pullRequests.allowBranches` pass |
| Claude Code hook (plugin) | The agent rewriting `.bugyo/config.json`, evidence files, or baseline files, rewriting the status fields of the task ledger (`status`, `assignee`, `model`, `harness`, `rework`, `gate-attempts`, `repro`, `evidence`, ...), or creating ledger files by hand. Rewrites through shell commands are stopped by looking at shapes such as redirects, `sed -i`, `rm`, and `cp` |
| Claude Code hook (plugin, `Stop`) | Runs `bugyo task lint` before the agent finishes and, if it fails, returns the reason and does not let it finish (finding hand-closed tasks without waiting for `pnpm check`). It blocks only once; a second attempt to finish is not blocked. If the ledger is fine but `active` tasks remain, it tells the person instead of blocking |
| Claude Code hook (plugin, `SessionStart`) | At the start of a session, gives the agent the active tasks, the ready tasks (`bugyo task ready`), and the commands to start and finish |

The ledger and the evidence are plain files, so hand edits themselves cannot be prevented. The plugin hooks refuse the agent's direct edits locally, but shell commands are told apart only by their shape, so not everything is stopped. The local `task lint` finds "done without an evidence file" and "evidence that disagrees with the ledger". Fake evidence files are stopped in CI, which re-collects the evidence and compares. Anyone with write access can add a label, so `config guard` only stops "the config changing without a person noticing". To make it a required check, mark it required in GitHub's branch protection.

## Recording mistakes and turning them into rules

Each kind of mistake is kept in one file, `.bugyo/mistakes/<kind>.md`. When the same kind happens twice, the gate fails until it becomes a rule.

```md
---
count: 2
rule:
---

# deep-import

- t-003 (2026-11-18): imported a feature's internals directly
- t-007 (2026-11-20): imported a feature's internals directly
```

1. When a person sends work back, they run `bugyo task rework <id> -r "<reason>" --kind <kind>`. Without `--kind`, it lists the recorded kinds and refuses, so pick a close one if there is one. Kind names use lowercase letters, digits, and hyphens
2. The task's id and the reason are appended to the mistake file, and `count` goes up by 1. A line is also added under "## Rework" in the task body, `evidence-*` is cleared, and the task goes back to `active`
3. When the same kind happens a second time, `bugyo task lint` warns and `bugyo gate` fails
4. Turn it into a rule. In order of preference: types and APIs → lint and dependency rules → tests and the feature map → `CLAUDE.md`
5. Record it with `bugyo mistake rule <kind> --at <file with the rule> [--name <rule name>]`. It refuses if the file does not exist. The count at that time is kept in `ruled-count`, and `--name` (a ban name, a rule ID, a test name, ...) in `rule-name`
6. If a ruled kind happens again (`count` goes past `ruled-count`), it is shown at the top of `mistake ls` as "the rule leaks", and the gate fails

`bugyo mistake ls` prints the count and rule per kind, followed by the number of kinds that became rules. You can count how many mistakes turned into rules as is.

```
$ bugyo mistake ls
date-now 2x  rule: clock (eslint.config.js)  1x when ruled  ← the rule leaks (it happened again after the rule)
deep-import 2x  rule: none  ← needs a rule
wrong-name 1x  rule: none
mistakes: 3 kinds  ruled 1 (rule leaks: 1)  needs a rule 1  once 1
```

`--json` prints `{ summary, mistakes }`. `summary` holds the number of kinds (`kinds`, `ruled`, `leak`, `unruled`, `once`), and `mistakes` holds `kind`, `count`, `rule`, `ruleName`, `ruledCount`, and `state` per kind.

## Gate (`bugyo gate`)

It decides whether to widen what agents may do, per group of task types, from the latest closed tasks (done and dropped; 20 by default; newest first by close time) and the mistake records. Passing any number of `chore` tasks does not count toward handing over screen work.

| Group (default) | Types |
| --- | --- |
| `ui` | `feature`, `ui-flow`, `ui-look` |
| `code` | `logic`, `bugfix`, `refactor` |
| `chore` | `chore` |

`bugyo gate --scope <group>` judges only that group; without `--scope`, it passes only if every group passes. Each group passes only when all five conditions hold.

| Condition | Calculation | Default threshold |
| --- | --- | --- |
| Enough closed tasks | the number of the latest closed tasks (done and dropped) | 20 |
| Not giving up midway | the number of those that were dropped | 2 or fewer |
| Little rework by people | the number of those with `rework` of 1 or more | 2 or fewer |
| check and verify pass on the first try | the number of those with `gate-attempts` of 1 | 16 or more |
| The same kind of mistake does not repeat | the number of kinds that happened twice or more without a rule, plus kinds that happened again after their rule | 0 |

The thresholds can be changed with `gate` in `.bugyo/config.json`. While there are not enough closed tasks, it fails for "too few tasks". Dropping tasks that did not pass does not make the record look better: they still count as closed, and the dropped count goes up. A reworked task reaches `gate-attempts` of 2 or more on its second `done`, so it does not count as "passed on the first try".

When the numbers alone should not be trusted, `bugyo gate` says so on a `warn` line (the verdict does not change).

- When the closed tasks are fewer than the gate's count (`window`)
- When the 95% interval (Wilson's method) of the first-pass rate is wider than 30%. For example, even 2/2 has an interval of 34.2%–100.0%, which is not reliable yet

```
$ bugyo gate --scope chore
gate: FAIL (judged per group of task types, from the latest closed tasks)
  [chore] FAIL (latest 20 of chore)
    NG closed tasks (done and dropped): 1 (20 or more)
    OK dropped tasks: 0 (2 or fewer)
    OK tasks that needed rework: 1 (2 or fewer)
    NG tasks that passed on the first try: 0 (16 or more)
    NG repeated mistakes without a rule: 1 kinds (0 kinds) deep-import
warn  [chore] Only 1 closed tasks, fewer than the 20 the gate needs. The verdict is not reliable yet
warn  [chore] The 95% interval of the first-pass rate 0/1 is 0.0%–79.3%. It is wide, so decide after more tasks
```

## Results (`bugyo stats`)

It prints the results of closed tasks (done and dropped) per task type, model, and harness, to compare in numbers which kinds of work can be handed to which model and harness.

```
$ bugyo stats
stats: results of closed tasks (done and dropped). First pass and rework are shares of done tasks; dropped is a share of closed tasks
  chore  model: model-a  harness: cli  closed 2  first pass 50.0% (95% interval 9.5%–90.5%)  rework 0.0%  dropped 0.0%
```

- Model and harness come from the task's `model` / `harness`. Pass `--model` / `--harness` to `start` or `done`, or set the environment variables `BUGYO_MODEL` / `BUGYO_HARNESS`. Without either, they count as `-`
- The first-pass and rework rates are counted among done tasks, and the dropped rate among closed tasks. The first-pass rate also shows its 95% interval
- `--json` prints the counts per row
