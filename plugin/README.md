# bugyo (Claude Code plugin)

English ・ [日本語](README.ja.md)

Skills that help Claude Code pick the right way of working in a project built on bugyo (`@bugyo/lint`, the `bugyo` CLI, and the feature map in `docs/features`), and hooks that keep the work on the task ledger and protect the files that decide completion.

## What is in it

| Kind | Name | Role |
| --- | --- | --- |
| skill | `bugyo-mode` | The entry point. Tells the kind of work apart, picks the way to proceed, and finishes with evidence |
| skill | `bugyo-new-feature` | From `bugyo new feature` to wiring, the feature map, and verify |
| skill | `bugyo-rule-from-mistake` | Turns repeated mistakes into types, lint, dependency rules, and tests |
| skill | `bugyo-critique` | A critical review that looks at the evidence first |
| skill | `bugyo-explain` | Explains how something works by tracing the code |
| skill | `bugyo-map-features` | Drafts the feature map of an existing app from the real code and checks |
| skill | `bugyo-sync-feature-map` | Keeps the feature map in step with a change to what users see or do |
| agent | `slop-reviewer` | A subagent that reviews a diff with independent eyes |
| hook | `SessionStart` (`hooks/session-start.mjs`) | Shows the active and ready tasks when a session starts (see below) |
| hook | `PreToolUse` (`hooks/guard.mjs`) | Refuses direct edits to the files that decide completion (see below) |
| hook | `Stop` (`hooks/stop-check.mjs`) | Runs `bugyo task lint` before the agent stops and does not let it stop if that fails. Reports active tasks that remain (see below) |

## Hooks

Each hook looks upward from the working folder for a folder with `.bugyo/tasks` and uses `bugyo` from `node_modules`. If it finds no ledger or no `node_modules/bugyo`, it does nothing.

### Show the tasks (`SessionStart`)

When a session starts (also on resume and after `/clear`), it gives the agent the active tasks, the ready tasks (`bugyo task ready`, up to 10), and the commands to start and finish them.

### Refuse edits (`PreToolUse`)

When the agent tries to rewrite any of the following, the hook refuses before the tool runs and names the command to use instead.

- `.bugyo/config.json` (only a person changes it; the agent is told to propose the change to the user)
- Evidence files in `.bugyo/evidence/` (only `bugyo task done` writes them)
- Baselines (`.bugyo/baseline.json`, `eslint-suppressions.json`, `.dependency-cruiser-known-violations.json`)
- The status fields of the task ledger (`status`, `assignee`, `rework`, `gate-attempts`, `repro`, `evidence`, ...), and creating ledger files by hand. `feature`, `issue`, `blocked-by`, and the body can be edited

For shell commands (Bash, PowerShell), it looks at the protected file names together with redirects and shapes such as `sed -i`, `rm`, and `cp`. Since it only looks at shapes, it cannot stop every rewrite. What slips through is caught by the `Stop` hook below, by `bugyo task lint` in `pnpm check`, and by CI.

### Check the ledger before stopping (`Stop`)

When the agent tries to finish, the hook runs `bugyo task lint`. If it fails, the hook returns its output and how to fix it, and the agent keeps working.

- It blocks only once. After a fix, or if the agent tries to finish again without one, it does not block
- If the ledger is fine but `active` tasks remain, it does not block; it tells the person to use `bugyo task done` or `drop`

The hook messages follow `BUGYO_LOCALE`, then the `locale` in `.bugyo/config.json`; the default is English. The skill and subagent instructions are written in English and report back in the user's language.

All hooks need Node to run.

## Install

Add this repository as a marketplace and install the plugin.

```
/plugin marketplace add khrtz/bugyo
/plugin install bugyo@bugyo
```

## Requirements

The project has `@bugyo/lint` and `bugyo` (and `@bugyo/lint-react` if it uses React). For a new project, create one with `bugyo init <dir>` (the default `react-vite` for a React + Vite UI, or `--template node-lib` for a TypeScript library or CLI with no UI).
