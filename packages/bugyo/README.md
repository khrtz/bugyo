# bugyo

English ・ [日本語](https://github.com/khrtz/bugyo/blob/main/packages/bugyo/README.ja.md)

A CLI for the feature map, verification, the task ledger and gate, and scaffolding. Needs Node 24 or later.

```bash
npx bugyo init my-app                     # React + Vite (default)
npx bugyo init my-lib --template node-lib # TypeScript library / CLI with no UI
```

| Command | What it does |
| --- | --- |
| `bugyo init <dir> [--template <name>]` | Create a new project with the foundation in place. Templates: `react-vite` (default) or `node-lib` |
| `bugyo new feature <id>` | Create a feature with the template's scaffold, a feature map entry, and a spec |
| `bugyo verify <id>` / `--all` | Run the feature for real and print only pass/fail and where the evidence is. Checks with Playwright or with any command set in `.bugyo/config.json` |
| `bugyo task add` / `ready` / `start` / `show` / `repro` / `done` / `rework` / `drop` / `ls` / `lint` | The task ledger. Only `done` collects evidence and closes a task ([docs/tasks.en.md](https://github.com/khrtz/bugyo/blob/main/docs/tasks.en.md)) |
| `bugyo mistake ls` / `rule` | Mistakes per kind, and which rule each became |
| `bugyo gate` | Decide whether to widen what agents may do |
| `bugyo stats` | Results of closed tasks per task type, model, and harness |
| `bugyo doctor` / `baseline` | Count violations per ban before adopting the rules, and keep a baseline that can only shrink |

```ts
// playwright.config.ts
import { defineBugyoConfig } from 'bugyo/playwright';

export default defineBugyoConfig({ port: 5173 });
```

```ts
// e2e/feature-map.test.ts (Vitest; use 'bugyo/node-test' for node:test)
import { registerFeatureMapTests } from 'bugyo/vitest';

registerFeatureMapTests();
```

`@playwright/test` and `vitest` are optional peer dependencies; `node-lib` installs neither. The CLI output is in English by default; set `"locale": "ja"` in `.bugyo/config.json` or `BUGYO_LOCALE=ja` for Japanese.

How it all works and every option are in [docs/foundation.en.md](https://github.com/khrtz/bugyo/blob/main/docs/foundation.en.md); adding bugyo to an existing project is in [docs/adopt.en.md](https://github.com/khrtz/bugyo/blob/main/docs/adopt.en.md).

## License

MIT
