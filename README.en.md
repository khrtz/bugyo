<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="bugyo" width="320">
  </picture>
</p>

<h3 align="center">Lint and verification for agent-written code.</h3>

<p align="center">
  <a href="README.md">日本語</a> ・ English
</p>

<p align="center">
  <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-f0314f?style=flat-square">
  <img alt="node 24 or later" src="https://img.shields.io/badge/node-%E2%89%A5%2024-35e0c2?style=flat-square">
  <img alt="TypeScript + React" src="https://img.shields.io/badge/TypeScript%20%2B%20React-Vite-ffd23f?style=flat-square">
  <img alt="status: early" src="https://img.shields.io/badge/status-early-8b7cf6?style=flat-square">
</p>

---

**bugyo** is a toolkit for handing development work to AI agents.
Instead of piling up written instructions, it shapes the codebase so that **the wrong way does not pass, and "done" without evidence is not accepted**. It targets TypeScript + React (Vite) projects.

## Why

Three things happen when you delegate to agents. bugyo stops each of them with tooling, not prose.

| What happens | How bugyo stops it |
| --- | --- |
| Code lands in random places and styles, and the next agent copies it | Folder structure and lint rules that only let the right way through |
| "I verified it" cannot be trusted | Completion is decided by evidence a command collects itself, not by the agent's report |
| The same kind of mistake keeps coming back | Mistakes are recorded by kind, and the second occurrence blocks progress until it becomes a rule |

## See it

**Every block comes with what to use instead.** When an agent writes `useEffect` and `fetch`, it gets this back (rule messages are in Japanese for now):

```
 1:17  error  'useEffect' import from 'react' is restricted. 製品コードでuseEffectは使えません。データ取得は features/*/api の useXxxQuery、購読やタイマーは src/shared/lib の専用フックを使ってください。該当するフックがなければ src/shared/lib に追加してください。  no-restricted-imports
10:3   error  Unexpected use of 'fetch'. fetchを直接呼ばないでください。src/shared/api のクライアントを使い、スキーマで応答を検証してください。  no-restricted-globals
```

(Two entries taken from the output for the deliberately broken test file `packages/lint/test/fixture/src/features/a/ui/Bad.tsx`.)

In English: *"`useEffect` is not allowed in product code. Fetch data through `useXxxQuery` in `features/*/api`; put subscriptions and timers in a dedicated hook under `src/shared/lib`."* and *"Do not call `fetch` directly. Use the client in `src/shared/api` and validate the response with a schema."*

**Verification returns pass/fail and where the evidence is, nothing more.** No long logs eating the agent's context.

```
$ pnpm verify todos
PASS todos  確認手順: docs/features/todos.md
証拠: artifacts/test-results（動画・スクリーンショット・トレース）, artifacts/report/index.html
```

The two lines say: the steps to check are in `docs/features/todos.md`, and the evidence (video, screenshots, trace, HTML report) is under `artifacts/`.

## Three layers, and what exists today

Built bottom-up. **Layers 1 and 2 work today.** Layer 3 is designed, and its commands do not exist yet.

| Layer | What it does | Status | Docs (Japanese) |
| --- | --- | --- | --- |
| **1. Foundation** | Enforces how code is written and checked: structure, lint, dependency rules, verification | Implemented | [docs/foundation.md](docs/foundation.md) |
| **2. Task ledger and gate** | One file per task; a task cannot be closed unless its evidence passes | Implemented (CI and hooks not yet) | [docs/tasks.md](docs/tasks.md) |
| **3. Resident agents** | Agents with a role patrol, delegate work, and bring results back to a human | Design only | [docs/agents.md](docs/agents.md) |

"An agent cannot claim done without evidence" is handled by `bugyo task done` in layer 2. It is the only way to close a task: it runs check, test, and verify itself, and writes an evidence file only when they pass. A task flipped to done by hand fails `bugyo task lint` inside `pnpm check`. The build order and the exit criteria for each stage are in [docs/roadmap.md](docs/roadmap.md).

### Layer 1 in short

- **Structure** — `src/app`, `src/features/<id>/{ui,api,model,index.ts}`, `src/shared/{ui,lib,api}`. Other code may import a feature only through its `index.ts`.
- **Lint** — `useEffect` only in `shared/lib`, `fetch` only in `shared/api`, no timers in feature UI, no `any`, no type assertions, no comments, no unexplained `eslint-disable`. `model/` stays pure.
- **Dependency rules** — no cycles, no reaching into another feature's internals, `shared` depends on nothing above it.
- **Feature map** — one `docs/features/<id>.md` per feature with four required sections: what exists, how to get there, how to operate and check it, and where it tends to lie. Tests fail when a feature, its spec, or its map entry is missing.
- **Verification** — `bugyo verify <id>` runs the feature's check and reports pass/fail plus where the evidence is. By default it runs the Playwright spec and keeps video, screenshots, and a trace; with `"runner": "command"` in `.bugyo/config.json` it runs any command per feature and keeps its output.

## What is in the box

| Path | Contents |
| --- | --- |
| [packages/lint](packages/lint) — `@bugyo/lint` | ESLint flat config, dependency-cruiser rules, a strict tsconfig, a no-comments rule |
| [packages/bugyo](packages/bugyo) — `bugyo` | CLI (`init` / `new feature` / `verify` / `task` / `mistake` / `gate`), feature map loader and consistency tests, Playwright config |
| [plugin](plugin) | Claude Code plugin (five skills and a review subagent) |
| [examples/todo-app](examples/todo-app) | A sample app using both packages; also the source of the `bugyo init` template |

## Getting started

bugyo is not on npm yet, so build it from this repository. You need Node 24 or later and pnpm 11.

```bash
pnpm install
```

```bash
pnpm --filter bugyo pack && pnpm --filter @bugyo/lint pack
```

```bash
node packages/bugyo/bin/bugyo.js init ../my-app
```

In the generated `my-app/package.json`, point `bugyo` and `@bugyo/lint` at the tarballs you just built using `file:` paths. Then run:

```bash
cd ../my-app && pnpm install && pnpm exec playwright install chromium
```

```bash
pnpm check && pnpm test && pnpm verify --all
```

To add a feature, run `pnpm exec bugyo new feature <id>`. Adding bugyo to an existing project and every option are covered in [docs/foundation.md](docs/foundation.md).

## Language

The detailed docs, the CLI output, the rule messages, and the plugin skills are written in Japanese. This page is the English entry point.

## Developing this repository

```bash
pnpm install
```

```bash
pnpm check && pnpm test && pnpm verify
```

```bash
pnpm validate-plugin
```

- The `packages/lint` tests run every rule against deliberately broken files in `test/fixture` and check that each one reports an error
- The `packages/bugyo` tests check what `new feature` and `init` generate, and how `verify` and the task ledger behave (including that what should be refused is refused) on a fixture that uses neither React nor Playwright (`test/fixtures/plain`)
- TypeScript is pinned to 6.0

## License

[MIT](LICENSE)
