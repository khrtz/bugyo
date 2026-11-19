# Foundation

English ・ [日本語](foundation.md)

Everything on this page works in the current code.

The foundation is the layer that keeps agents from picking the wrong way to write code. It has four parts: the folder structure, lint, dependency rules, and verification.

The feature map and `bugyo verify` do not care about the tech stack. How a feature is checked is set in `.bugyo/config.json` (see "Config file" below). Lint and the dependency rules assume TypeScript. The parts and bans for React live in a separate package, `@bugyo/lint-react`, which only React projects install (see "Parts and bans" below).

There are two templates (`bugyo init --template <name>`).

| Template | Example | Assumes |
| --- | --- | --- |
| `react-vite` (default) | [examples/todo-app](../examples/todo-app) | pnpm, Vite, React, Playwright, Vitest, and a path alias `@/` pointing to `src/` |
| `node-lib` | [examples/node-lib](../examples/node-lib) | pnpm, Node 24 type stripping (runs `.ts` directly), `node:test`. Imports carry the `.ts` extension. No React, Vite, or Playwright |

## Folder structure

```
src/
  app/                      assembles the screens. Uses only the features' index.ts
  features/<id>/
    ui/                     screen parts
    api/                    data fetching (useXxxQuery)
    model/                  pure functions and types. No React, no network
    index.ts                the public entry point. Others import only this
  shared/
    ui/                     shared parts
    lib/                    the only place useEffect may be written (with noUseEffect)
    api/                    the only place fetch may be called (with fetchOnlyInApi)
docs/features/<id>.md       the feature map (how to check each feature)
e2e/<id>.spec.ts            a test that really operates the feature
```

Dependencies go `app → features → shared`, and inside a feature `ui → api → model`.

`node-lib` has no screens, so a feature is only `model/` and `index.ts`. `src/app` is the command's entry point, `src/index.ts` is what the library exposes, and `checks/<id>.ts` is a script that really runs the feature to check it (the `spec` in the feature map).

## `@bugyo/lint`

### ESLint

It needs ESLint 9.24 or later (including 10), TypeScript 5.8 through 6.0, and a flat config. `@eslint/js` is a peer dependency, so install the same major version as your ESLint (9 for 9, 10 for 10). CI also runs the lint tests with ESLint 9.24 and TypeScript 5.8.

```js
// eslint.config.js (a React project; same as the react-vite template)
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';
import { noUiTimers, noUseEffect, react } from '@bugyo/lint-react';

export default bugyo({
  root: import.meta.dirname,
  parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers],
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `root` | required | Pass `import.meta.dirname` |
| `src` | `src` | Where the source lives. All `layers` folders go inside it |
| `layers` | `<src>/app`, `<src>/features`, `<src>/shared/{ui,api,lib}` | Where the layer folders are (see "Renaming the layer folders" below) |
| `effectHooksDir` | `layers.shared.lib` (all of them, if several) | The place `effects` means in a ban's `allow` (where `useEffect` may be written with `noUseEffect`) |
| `apiClientDir` | `layers.shared.api` (all of them, if several) | The place `api` means in a ban's `allow` (where `fetch` may be called with `fetchOnlyInApi`) |
| `ignores` | `[]` | Paths to leave out of lint (`dist`, `artifacts`, `node_modules`, and so on are left out from the start) |
| `severity` | `{}` | Lower bans to warn (see "Lowering a ban to warn" below) |
| `locale` | `en` | The language of ban messages: `en` or `ja` (see "Message language" below) |
| `parts` | `[common, structure]` | The parts and bans to use (see "Parts and bans" below). `common` is required |
| `explicitExtensions` | `false` | Set to `true` in projects that write extensions in imports (running `.ts` directly with Node type stripping, for example). Then `features/<id>/index.ts` can be imported with its file name |

#### Parts and bans

A config is a combination of parts and bans. A part holds type checks and layer boundaries; a ban holds one rule about how to write code. Only what you list in `parts` applies, and the order does not change the result. Bans over the same scope (`no-restricted-imports` and so on) are merged into one rule across parts and bans.

```js
// eslint.config.js (a project without React; same as the node-lib template)
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname, explicitExtensions: true, parts: [common, structure, noComments, fetchOnlyInApi] });
```

Without `parts` you get `[common, structure]`, with no bans on how to write code.

| Part | Scope | What it stops |
| --- | --- | --- |
| `common` | all files | `any`, type assertions (`as`), non-null assertions (`!`), unawaited Promises, missing `switch` cases, `eslint-disable` without a reason, `eslint-disable` that names no rule. Plus typescript-eslint's `strictTypeChecked`. Required |
| `structure` | under `src` | importing another feature's internal files (ban name `feature-internals`), `shared` depending on `features` / `app`, `features` depending on `app` |
| `structure` | `src/features/*/model` | the same feature's `ui` and `api`, `shared/ui`, `shared/api` (`model-layers`) |
| `react` (`@bugyo/lint-react`) | under `src` | the recommended react-hooks rules |
| `react` | `src/features/*/model` | `react`, `react-dom`, `@tanstack/*` (`model-react`) |

| Ban | Package | Name | What it stops | Where it is allowed |
| --- | --- | --- | --- | --- |
| `noComments` | `@bugyo/lint` | `comments` | comments under `src`. Only JSDoc on public APIs (`/** */`) and `eslint-disable` with a reason (`-- reason`) are allowed | nowhere |
| `fetchOnlyInApi` | `@bugyo/lint` | `fetch` | `fetch` | `apiClientDir`, tests |
| `noUseEffect` | `@bugyo/lint-react` | `use-effect` | importing `useEffect` / `useLayoutEffect` from `react`, and the `React.useEffect` form | `effectHooksDir` |
| `noUiTimers` | `@bugyo/lint-react` | `ui-timers` | `setTimeout`, `setInterval`, `requestAnimationFrame` in a feature's UI | tests |

Each error message says what to use instead. For imports of another feature's internal files, ESLint stops the forms whose path contains `features/` (`@/features/<id>/...` or `../features/<id>/...`), and dependency-cruiser stops them all, including relative paths that cross between features. Rules that need types are not applied to `.js` / `.cjs` / `.mjs`.

#### Lowering a ban to warn

A ban you just added and cannot fully fix yet can be lowered to warn with `severity`. It cannot be turned `off`.

```js
export default bugyo({
  root: import.meta.dirname,
  parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers],
  severity: { 'use-effect': 'warn' },
});
```

- The keys are the names of bans in `parts`: the names in the table above (`feature-internals`, `model-layers`, `model-react`, `comments`, `fetch`, `use-effect`, `ui-timers`) and the `name` of bans made with `defineBan`. With `layers`, `model-layers` covers only imports of the same feature's `ui/` and `api/` (the folders in `layers.featureParts`; see below)
- Besides names, you can pass a rule ID from the config (e.g. `@typescript-eslint/no-non-null-assertion`). That rule becomes warn in every file
- A ban lowered by name gets the rule ID `bugyo-warn/<original rule>` (e.g. `bugyo-warn/no-restricted-imports`) to keep it apart from other bans of the same rule. Use this ID in `eslint-disable` comments too. A ban written with `rules` (`comments`, for example) keeps its rule ID and becomes warn
- Unknown names, and names of bans not in `parts`, are refused
- The layer boundaries (`shared` to `features` / `app`, `features` to `app`, and with `layers`, `model/` to `shared.ui` / `shared.api`) are one rule, `import-x/no-restricted-paths`, so they cannot be lowered one by one. Lower them all at once by rule ID
- `bugyo doctor` counts bans lowered to warn separately, as "debt to fix". `bugyo baseline check` counts them too, so lowering a ban does not let its count grow
- Lowering a ban that is in ESLint's suppressions file makes the suppressions unused, and `eslint .` fails (suppressions only apply to errors). After lowering, run `bugyo baseline save` again

#### Message language

bugyo's ban messages come in English (`en`, the default) and Japanese (`ja`). The first of these that is set wins.

1. `bugyo({ locale: 'ja' })`
2. The environment variable `BUGYO_LOCALE`
3. `locale` in `.bugyo/config.json`

```
'useEffect' import from 'react' is restricted. [bugyo:use-effect] useEffect is not allowed in product code. Fetch data with useXxxQuery in features/*/api, ...
```

- The ban name at the head of the message (`[bugyo:use-effect]`) is the same in every language. `bugyo baseline` counts up to that name, so changing the language does not change the counts
- The language applies to the ban messages of `@bugyo/lint` and `@bugyo/lint-react` (including the comment ban), the errors about mistakes in the config, the descriptions of the dependency-cruiser rules, and the output of the `bugyo` CLI
- The CLI, the config errors, and the dependency-cruiser descriptions look at `BUGYO_LOCALE`, then `locale` in `.bugyo/config.json` in the current folder. The dependency-cruiser descriptions can also be chosen with `config({ locale: 'ja' })`
- Messages of bans made with `defineBan` appear as written. To vary them by language, look at `context.locale` in `build(context)`
- If `.bugyo/baseline.json` is in the format from before counting by name (no `version`), rebuild it with `bugyo baseline save` before changing the language. The old format counts by message text, so changing the language breaks the counts
- With none of these set, it is English
- Anything other than `en` and `ja` is refused

#### Renaming the layer folders

In projects whose layer folders are not `src/app`, `src/features`, and `src/shared`, pass their places with `layers`. Write the value once in `layers` of `.bugyo/config.json`; ESLint and dependency-cruiser read it from there.

```json
{
  "layers": {
    "app": "web/pages",
    "features": "web/features",
    "shared": { "ui": "web/app/ui", "api": "web/app/api", "lib": "web/app/lib" }
  }
}
```

```js
// eslint.config.js
import { readFileSync } from 'node:fs';
import { bugyo, common, fetchOnlyInApi, structure } from '@bugyo/lint';

const { layers } = JSON.parse(readFileSync(new URL('./.bugyo/config.json', import.meta.url), 'utf8'));
export default bugyo({ root: import.meta.dirname, src: 'web', layers, parts: [common, structure, fetchOnlyInApi] });
```

```js
// .dependency-cruiser.cjs
const { layers } = require('./.bugyo/config.json');
module.exports = require('@bugyo/lint/depcruise').config({ src: 'web', layers });
```

With `layers`, the defaults of `effectHooksDir` and `apiClientDir` become `layers.shared.lib` and `layers.shared.api` (in the example, `fetch` may only be called in `web/app/api`). Boundaries are judged on resolved paths, not on import aliases (`@/` and so on), so `~/app/ui/x` and `../../app/ui/x` are stopped the same way. For imports of another feature's internal files, ESLint stops the forms whose path contains the name of the `features` folder (`features` in the example). Places not written in `layers` of `.bugyo/config.json` are filled with defaults such as `src/app`. ESLint and dependency-cruiser fill them with `<src>/app` and so on, so if `src` is not `src`, write all five places. In a project that writes this, the default of `featureMap.featuresDir` becomes `layers.features`, and `bugyo new feature` refuses without creating a skeleton (skeletons only come in the `src/features` shape). `bugyo doctor` lists the files inside the folder that holds the `layers` (`web` in the example) that belong to no layer.

#### Several folders in shared

`ui`, `api`, and `lib` of `shared` can each be one folder as a string, or an array of folders. Shared folders with other roles go in `model` and `other`.

```json
{
  "layers": {
    "shared": {
      "ui": "web/app/ui",
      "api": "web/app/api",
      "lib": ["web/app/lib", "web/lib"],
      "model": "web/app/domain",
      "other": ["web/app/stores"]
    }
  }
}
```

| Key | What goes there | Rules that apply |
| --- | --- | --- |
| `ui`, `api`, `lib` | shared parts, API clients, hooks | cannot depend on features or app. `effects` in `allow` means all of `lib`, and `api` means all of `api` |
| `model` | shared pure logic | besides features and app, cannot depend on shared `ui`, `api`, or `other` either (it can use only shared `lib` and `model`). Bans with `scope: 'model'` apply (`model-react` and so on). In dependency-cruiser, `shared-model-is-pure` |
| `other` | shared folders without a role (state management, for example) | only that they cannot depend on features or app. A feature's model and shared `model` cannot use them |

A feature's model can use its own model and shared `lib` and `model`.

#### Renaming the folders inside a feature

In projects whose folders inside a feature are not `ui/`, `api/`, and `model/`, write the folder names per role in `layers.featureParts`. Roles you leave out stay `ui`, `api`, and `model`.

```json
{
  "layers": {
    "featureParts": { "ui": ["components", "hooks"], "api": ["api"], "model": ["lib"] }
  }
}
```

- Bans with `scope: 'ui'` (`noUseEffect`, `noUiTimers`, and so on) apply to the folders listed in `ui`
- Bans with `scope: 'model'` (`model-layers`, `model-react`, and so on) apply to the folders listed in `model`. `model-layers` stops imports of the folders listed in `ui` and `api` of the same feature (`../components`, `../hooks`, `../api` in the example). dependency-cruiser's `model-is-pure` looks at the same folders
- "model has tests" for `logic` tasks passes if any folder listed in `model` has tests
- Names are only folder names inside a feature (no `/`). Each name can appear under one role only

`bugyo doctor` lists the folders inside features that belong to no role, and the number of files the `ui` and `model` bans apply to. If that number is 0, the folder names do not match the roles and those bans have no effect.

#### Several sources

When one repository has several sources that the layer rules apply to (a front end and a server, for example), split the place and the parts per source. The ledger and the feature map stay single.

```json
{
  "sources": {
    "web": { "src": "web", "layers": { "featureParts": { "ui": ["components", "hooks"], "model": ["lib"] } } },
    "server": { "src": "server/src", "tsconfig": "server/tsconfig.json" }
  }
}
```

```js
// eslint.config.js
import { readFileSync } from 'node:fs';
import { bugyo, common, fetchOnlyInApi, structure } from '@bugyo/lint';
import { noUseEffect, react } from '@bugyo/lint-react';

const { sources } = JSON.parse(readFileSync(new URL('./.bugyo/config.json', import.meta.url), 'utf8'));
export default bugyo({
  root: import.meta.dirname,
  sources: [
    { ...sources.web, parts: [common, structure, react, fetchOnlyInApi, noUseEffect] },
    { ...sources.server, parts: [common, structure] },
  ],
});
```

- Each source in `sources` has `src`, `layers`, and `tsconfig` (the tsconfig used to resolve imports; default `tsconfig.json`). Places not written in `layers` are filled with `<src>/app` and so on. In `.bugyo/config.json`, `sources` and `layers` cannot be written together
- In ESLint, each source can also have `parts`, `explicitExtensions`, `effectHooksDir`, and `apiClientDir`. With `sources`, do not write these outside. `root`, `ignores`, and `severity` are one for the whole config
- Bans and layer boundaries apply only under that source's `src`. The same ban name can go into different sources. Rules of a part that also apply outside src (the type checks of `common`, for example) apply once to everything if any source has that part
- Sources' `src` cannot overlap (`web` and `web/admin`, for example)
- Feature folders with the same id are the same feature whichever source they are in. Every feature folder of every source needs a `docs/features/<id>.md`. "model has tests" for `logic` tasks passes if the model of any source has tests
- `bugyo doctor` looks for files that belong to no layer and folders inside features per source. `bugyo new feature` refuses without creating a skeleton
- An example of an HTTP server source is in "Server layers" below
- dependency-cruiser can use only one tsconfig per config, so split the config files per source and call `config({ src, layers, tsConfig })` in each. `bugyo doctor` and `bugyo baseline` count only the one `.dependency-cruiser.cjs` at the project root, and pass it only the sources without `tsconfig` (the root config resolves imports with the root tsconfig). Check the dependency violations of the other sources by running `depcruise` with their own configs

#### Server layers

An HTTP server can use the same layers and bans. Put the entry file (route mounting and global middleware) in `app`, and the places for middleware and the database in `shared.other`.

```json
{
  "sources": {
    "server": {
      "src": "server/src",
      "tsconfig": "server/tsconfig.json",
      "layers": {
        "app": "server/src/app.ts",
        "features": "server/src/features",
        "shared": { "ui": "server/src/views", "api": "server/src/http", "lib": "server/src/lib", "other": ["server/src/middleware", "server/src/db"] },
        "featureParts": { "ui": ["routes"], "api": ["services"], "model": ["model"] }
      }
    }
  }
}
```

| Rule | How to write it |
| --- | --- |
| `app.ts` uses only the features' `index.ts` | make `app` a file (the `structure` boundaries and dependency-cruiser's `app-only-via-feature-index` apply as they are) |
| `middleware` and `db` do not depend on features | put them in `shared.other` |
| Only a chosen entrance reads the request body | the `readBody` ban below |
| Only features or services import the database client directly | the `db-client` ban below |

```js
const readBody = defineBan({
  name: 'read-body',
  allow: ['server/src/http/body.ts', 'tests'],
  syntax: [
    {
      selector: "CallExpression[callee.property.name=/^(json|text|formData|parseBody)$/][callee.object.property.name='req']",
      message: 'Read the request body with readBody(c, schema) from server/src/http/body.ts',
    },
  ],
});

const dbClient = defineBan({
  name: 'db-client',
  allow: ['server/src/db', 'server/src/features', 'tests'],
  imports: { patterns: [{ group: ['**/db/client', '**/db/client.ts'], message: 'Use the database client only from features or services' }] },
});
```

`ui`, `api`, and `lib` of `shared` cannot be empty, so write one folder even for roles you do not use (it works even if the folder does not exist).

### Adding your own bans

Make your own bans with `defineBan` and pass them in `parts` next to bugyo's bans. bugyo's bans are written the same way, with the same rules for names, scope, and allowed places, and they can be lowered to warn with `severity` in the same way.

```js
import { bugyo, common, defineBan, structure } from '@bugyo/lint';

const clock = defineBan({
  name: 'clock',
  allow: ['effects', 'tests'],
  properties: [{ object: 'Date', property: 'now', message: 'Use systemClock from shared/lib' }],
  syntax: [{ selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Use systemClock from shared/lib' }],
});

const noConsoleInApi = defineBan({
  name: 'no-console-in-api',
  scope: 'src/features/*/api/**/*.ts',
  rules: { 'no-console': 'error' },
});

export default bugyo({ root: import.meta.dirname, parts: [common, structure, clock, noConsoleInApi] });
```

| Key | Shape | Meaning |
| --- | --- | --- |
| `name` | lowercase letters, digits, hyphens | The ban's name. Also the key in `severity`. Two bans cannot share a name |
| `scope` | `src` (default), `ui`, `model`. A ban with only `rules` can also use a glob from root | Where it stops things. `ui` and `model` are the `ui/` and `model/` of each feature in `layers.features` (changeable with `layers.featureParts`). `imports`, `globals`, `syntax`, and `properties` are merged into one rule with bugyo's bans, so a glob scope is refused for them (narrow with `allow` instead) |
| `allow` | `effects`, `api`, `tests`, or an array of paths or globs from root | Where it is allowed. `effects` is `effectHooksDir`, `api` is `apiClientDir`, `tests` is `*.test.ts(x)` under `src`. A path without glob characters (`*?[]{}!`) means that file or everything under that folder (the same goes for a `scope` glob) |
| `imports` | `{ paths: [{ name, importNames?, message }], patterns: [{ group, message }] }` | merged into `no-restricted-imports` |
| `globals` | `[{ name, message }]` | merged into `no-restricted-globals` |
| `properties` | `[{ object?, property?, message }]` | merged into `no-restricted-properties` |
| `syntax` | `[{ selector, message }]` | merged into `no-restricted-syntax` |
| `rules` | `{ '<rule ID>': <setting> }` | ESLint rules that are not merged. Applied inside `scope` and turned off in the `allow` places |
| `plugins` | `{ '<name>': <plugin> }` | plugins used by `rules` |

- To put places such as `effectHooksDir` into the error message, return the keys other than `name` from `build(context)` (`defineBan({ name, allow, build: (context) => ({ globals: [...] }) })`). `context` holds `src`, `effectHooksDir`, `apiClientDir`, `layers`, and `featuresLabel` (`effectHooksDir` and `apiClientDir` are strings joined by the locale's separator when there are several places; each value of `layers.shared` is an array)
- Build the "right entrance" for the banned thing in a place listed in `allow` (e.g. ban `Date.now` and use it only in `shared/lib/clock.ts`)
- Every item in `imports`, `globals`, `syntax`, and `properties` needs a `message`. Write what the stopped agent should do next (what to use instead, and where it lives). Items without `message`, with an empty `message`, or given as bare strings (`globals: ['alert']`, for example) are refused
- The error message starts with the ban's name (`[bugyo:clock] Use systemClock from shared/lib`). `bugyo doctor` and `bugyo baseline` count bans up to that name, so rewriting the explanation after it does not change the counts
- Unknown keys, bans that stop nothing, items without `message`, and bans with the same name are refused
- Writing `no-restricted-imports` and the like directly in your own config block overrides bugyo's merged bans, which then disappear. Always add bans with `defineBan`

#### Imports usable only through a chosen entrance

In the same shape as `fetchOnlyInApi`, you can make other imports usable only in a chosen place: IPC calls, database clients, OS APIs, and so on.

```js
const processOnlyInSystem = defineBan({
  name: 'child-process',
  allow: ['src/shared/system', 'tests'],
  imports: {
    paths: [
      { name: 'node:child_process', message: 'Start child processes from the client in src/shared/system' },
      { name: 'node:fs', importNames: ['writeFileSync'], message: 'Write files from src/shared/system' },
    ],
    patterns: [{ group: ['child_process'], message: 'Start child processes from the client in src/shared/system' }],
  },
});

export default bugyo({ root: import.meta.dirname, parts: [common, structure, processOnlyInSystem] });
```

If the entrance lives in `layers.shared.api`, `allow` is `['api', 'tests']`.

- When one file falls in two allowed places (a test inside `shared/lib`, for example), the rule rebuilt for the later place (in the order `effects`, `api`, `tests`, glob) overrides the one for the earlier place. If separate bans of the same kind (both `imports`, for example) are allowed one in the earlier place and the other in the later place, the ban allowed in the earlier place comes back in that file

### dependency-cruiser

```js
// .dependency-cruiser.cjs (config() without React)
module.exports = require('@bugyo/lint/depcruise').config({ react: true });
```

It takes `config({ src, tsConfig, forbidden, react, locale })`. Rules passed in `forbidden` are added at the end. With `react: true`, `model-is-pure` also stops dependencies on React and its neighbors (`react`, `react-dom`, `@tanstack/*`) (default `false`). `locale` picks the language of the rule descriptions (see "Message language" above).

| Rule | What it stops |
| --- | --- |
| `no-circular` | circular dependencies |
| `feature-internals-only-via-index` | dependencies on another feature other than its `index.ts` |
| `app-only-via-feature-index` | dependencies from `app` on a feature other than its `index.ts` |
| `shared-is-leaf` | dependencies from `shared` on `features` / `app` |
| `features-not-to-app` | dependencies from `features` on `app` |
| `model-is-pure` | dependencies from `model` on sources other than its own `model` and `shared/lib`. With `react: true`, also on `react`, `react-dom`, `@tanstack/*` |
| `not-to-unresolvable` | imports that cannot be resolved |

Boundaries are checked by both ESLint and dependency-cruiser. Only dependency-cruiser checks for circular dependencies.

### tsconfig

```jsonc
// tsconfig.json
{
  "extends": "@bugyo/lint/tsconfig.json",
  "compilerOptions": { "types": ["vite/client", "node"], "paths": { "@/*": ["./src/*"] } },
  "include": ["src", "e2e", "*.ts", "*.js", ".dependency-cruiser.cjs"]
}
```

Besides `strict`, it turns on `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `noUnusedLocals`, and `noUnusedParameters`.

## Feature map

Each feature gets one `docs/features/<id>.md`. An agent opens only the file of the feature it wants to check and can operate it without reading the source.

```md
---
id: todos
route: /
spec: e2e/todos.spec.ts
---

# todos

## What is there
## How to reach it
## How to check it
## Where it lies
```

- `id` uses lowercase letters, digits, and hyphens, and matches the feature folder's name (by default `src/features/<id>`)
- `spec` is the path, relative to the project root, of the file that checks the feature (`/`-separated; `..` and absolute paths are not allowed). Any shape works; only its existence is checked
- `route` is optional. For a feature with a screen, write the URL path that reaches it, starting with `/`
- The four headings are required. Under "Where it lies", write the spots that tend to look fine while broken
- The headings can also be written in Japanese (`## 何があるか`, `## どう辿り着くか`, `## どう操作して確かめるか`, `## よく嘘をつくところ`), and the two languages can be mixed heading by heading. Items that are only `（…）` or end with `：` count as still the template; under English headings, items that are only `(…)` or end with `:` count too
- `bugyo new feature` creates the headings in the project's language (`locale`)
- `docs/features/README.md` lists, as `[id](id.md)`, the order for checking everything

Missing matches fail in a test.

```ts
// e2e/feature-map.test.ts (Vitest)
import { registerFeatureMapTests } from 'bugyo/vitest';

registerFeatureMapTests();
```

```ts
// test/feature-map.test.ts (node:test)
import { registerFeatureMapTests } from 'bugyo/node-test';

registerFeatureMapTests();
```

The test checks these six things.

1. The file name matches `id`
2. Every feature has the four headings
3. Every feature's `spec` exists
4. Every file in the spec folder (by default `e2e/`) whose name ends with the spec suffix (by default `.spec.ts`) belongs to some feature
5. Every folder in the feature folder (by default `src/features`) is in the feature map
6. The README's order lists every feature exactly once

4 and 5 are skipped as "nothing to check" when the folder does not exist or is set to `null`. The places are decided by the arguments of `registerFeatureMapTests({ cwd, src, specDir, specSuffix, featuresDir })`, then `featureMap` in `.bugyo/config.json`, then the defaults (passing only `src` makes the feature folder `<src>/features`).

To read the map from code, use `loadFeatures(cwd)` and `loadSweepOrder(cwd)`. To use the checks without a particular test runner, `featureMapChecks(options)` returns, per check, `title`, `skip` (the reason to skip, or `null`), and `problems()` (an array of problems found).

## Verification (Playwright)

```ts
// playwright.config.ts
import { defineBugyoConfig } from 'bugyo/playwright';

export default defineBugyoConfig({ port: 5173 });
```

| Option | Default | Meaning |
| --- | --- | --- |
| `port` | `5173` | The dev server's port |
| `command` | `vite --port <port> --strictPort` | The command that starts the dev server. It uses `vite` from `node_modules/.bin`, so it works with any package manager |
| `reuseExistingServer` | `false` | Whether to reuse a server already running on the same port. By default it does not, and fails if the port is taken (so another project's server is never recorded as evidence) |
| `overrides` | none | Overrides of the Playwright config |

This config works as follows.

- It runs `e2e/**/*.spec.ts` in Chromium. Playwright starts and stops the dev server
- Every test records video, screenshots, and a trace into `artifacts/test-results`
- Screenshot baselines go in `e2e/__screenshots__/<OS>/`, separated by OS
- When a baseline is missing, it is created locally, and fails in CI (when the `CI` environment variable is set) instead of being skipped

This repository's CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs the following on Linux for every PR and every push to main.

| Job | What it runs |
| --- | --- |
| `pnpm check / test` | `pnpm check` and `pnpm test` |
| `verify（証拠つき）` | `pnpm verify` (Playwright for todo-app, per-feature commands for node-lib). Uploads `artifacts/` and posts the result and evidence links on the PR |
| `npm で入れたプロジェクト（pnpm なし）` | packs the packages, installs a `react-vite` project with npm, removes pnpm from `PATH`, and passes check, test, `verify --all`, and `task done` |

The Linux baselines are in `examples/todo-app/e2e/__screenshots__/linux/`. To rebuild them after a screen change:

1. On your branch, run the CI workflow in Actions by hand with `update_snapshots` on (`gh workflow run CI --ref <branch> -f update_snapshots=true`)
2. Download the `linux-screenshots` artifact (`gh run download <run id> -n linux-screenshots -D examples/todo-app/e2e/__screenshots__/linux`), and commit after a person has looked at the images

## CLI

| Command | What it does |
| --- | --- |
| `bugyo init <dir> [--template <name>]` | Creates a new project with the foundation. The default template is `react-vite`. Records the template name in `template` of `.bugyo/config.json`. Refuses if `<dir>` is not empty, and refuses unknown template names with a list of the valid ones. The next steps it prints match the package manager that ran it |
| `bugyo new feature <id>` | Creates a full feature. What it creates depends on `template` in `.bugyo/config.json` (`react-vite` if missing). Refuses without overwriting if a file with the same name exists. For a template without a skeleton, it refuses with the reason and creates nothing |
| `bugyo verify <id>` | Runs the feature's spec and prints only the result and where the evidence is |
| `bugyo verify --all` | Checks every feature in the feature map |
| `bugyo doctor [--dirs <a,b>] [--tsconfig <path>] [--json]` | Prints the number of violations per ban without changing anything. Also counts violations hidden by ESLint's suppressions file |
| `bugyo baseline save [--dirs <a,b>]` | Makes all current violations the baseline (`eslint-suppressions.json`, `.dependency-cruiser-known-violations.json`, `.bugyo/baseline.json`) |
| `bugyo baseline check [--dirs <a,b>]` | Checks that the count per ban equals the baseline. Fails whether it grew or shrank. Does nothing without `.bugyo/baseline.json` |
| `bugyo baseline diff --base <ref>` | Fails if any of the three baseline files grew compared to `<ref>`. For CI |

The commands for the task ledger and the gate (`bugyo task`, `bugyo mistake`, `bugyo gate`) are in [tasks.en.md](tasks.en.md), and how to use baselines is in [adopt.en.md](adopt.en.md#adding-lint-step-by-step).

`new feature <id>` creates the following. Both templates create `docs/features/<id>.md` as a template and add a line to the README's order.

| `react-vite` | `node-lib` |
| --- | --- |
| `src/features/<id>/model/<id>.ts` and its test (Vitest and fast-check) | `src/features/<id>/model/<id>.ts` and its test (`node:test`) |
| `src/features/<id>/api/use<Id>Query.ts` | — |
| `src/features/<id>/ui/<Id>View.tsx` | — |
| `src/features/<id>/index.ts` | `src/features/<id>/index.ts` |
| `public/api/<id>.json` (sample data) | — |
| `e2e/<id>.spec.ts` | `checks/<id>.ts` (follows `featureMap.specDir` and `specSuffix`) |

With `react-vite`, wiring it into the screen remains after creation (until then, knip stops it as "unused"). With `node-lib`, check, test, and verify pass right after creation; rewriting the behavior and filling the feature map remain.

`verify` works as follows, with either way of running.

- Each run starts by deleting only what verify writes in `artifacts/` (`verify.json`, `results.json`, `report`, `test-results`, `verify`, and the folder of each named check). It does not touch other files
- Prints `PASS` / `FAIL` on one line per feature, and where the evidence is on the next line. Only on failure, it adds the last 30 lines of output
- The exit code is 0 if everything passes, 1 if anything fails, and 2 if a feature name is not in the feature map
- Finally, it writes a summary of each feature's result, the commands it ran, and where the evidence is to `artifacts/verify.json` (`bugyo task done` copies it into the evidence)

The way of running is chosen with `verify.runner` in `.bugyo/config.json`.

| `runner` | Behavior | Where the evidence is |
| --- | --- | --- |
| `playwright` (default) | Passes the target specs together to `playwright test` (from `node_modules/.bin`, not through the package manager) and reads each spec's result from the JSON report | `artifacts/test-results` (video, screenshots, traces), `artifacts/report/index.html` |
| `command` | Runs `verify.command` once per spec, and counts exit code 0 as passing. `{id}` in the command is replaced by the feature id, and `{spec}` by the spec path | `artifacts/verify/<id>.log` (the command and its output; `<id>.1.log`, `<id>.2.log`, … when a feature runs twice or more) |

Both run in a shell with `node_modules/.bin` added to the front of `PATH`. They work with pnpm, npm, yarn, or bun (installs that do not create `node_modules/.bin`, such as Yarn PnP, are not covered).

### Different checks per feature

Name ways of checking in `verify.runners` to use different ones per feature or per spec. Commands and environment variables are written only in the config; the feature map picks them by name.

```json
{
  "verify": {
    "runner": "playwright",
    "runners": {
      "api": { "runner": "command", "command": "vitest run {spec}", "match": "server/tests/**" },
      "client": { "runner": "playwright", "env": { "APP_MODE": "client" } }
    }
  }
}
```

```md
---
id: invoices
spec: e2e/invoices.spec.ts, server/tests/invoices.test.ts
---
```

| Key | Meaning |
| --- | --- |
| `runner` | `playwright` or `command`. Behaves as in the table above |
| `command` | The command when `runner` is `command` (required). `{id}` and `{spec}` are replaced |
| `env` | Environment variables added only for this check |
| `match` | A glob (or an array) of the specs this check runs |
| `evidence` | When `runner` is `command`, an array of globs of evidence files the run should write. `{id}` and `{spec}` are replaced (see "Evidence files" below) |
| `requires` | With `"sandbox"`, runs only when the `verify.sandbox` command passes (see "Running only in a sandbox" below) |

- The frontmatter `spec` can list several files separated by `,`. Spec paths can use only letters, digits, and `. _ @ + / -`
- The check for each spec is decided by the frontmatter `runner` (used for all of the feature's specs), then a check whose `match` hits, then `verify.runner`. Unknown names, and specs hit by two `match`es, are refused before running (exit code 2; the feature map test in `pnpm test` reports them too)
- Playwright runs once per check. Evidence of the `verify.runner` check goes where it always does; evidence of other checks goes under `artifacts/<name>/` (`test-results`, `report`, `results.json`)
- A feature is `PASS` when all its specs pass. `artifacts/verify.json` also records each spec's check and result (`runs`)
- `playwright`, `command`, `report`, `test-results`, and `verify` cannot be used as names

#### Evidence files

A `command` check only looks at the exit code. If the run should leave files such as screenshots, write them as globs in `evidence`.

```json
{ "runners": { "desktop": { "runner": "command", "command": "node scripts/shoot.js {id}", "evidence": ["artifacts/screens/{id}/*.png"] } } }
```

- If no file matching the globs was written after the run started, it is `FAIL` even with exit code 0. Files left from an earlier run do not count (judged by file time; to allow for coarse file system timestamps, files from up to 2 seconds before the start count)
- The files found are recorded with their path and content hash (sha256) in each feature's `files` in `artifacts/verify.json`, and shown on the `evidence:` line (`証拠:` in `ja`). `bugyo task done` puts `verify.json` into the evidence as is, so the hashes stay too
- verify never deletes files that match the globs
- Not available for Playwright checks (their evidence goes to fixed places)

#### Running only in a sandbox

Checks that touch real files or outside services can be made to run only in a sandbox (a container, a throwaway VM, and so on). Write a command that tells whether this is a sandbox in `verify.sandbox`, and add `"requires": "sandbox"` to the check.

```json
{
  "verify": {
    "sandbox": "node scripts/in-sandbox.js",
    "runners": { "desktop": { "runner": "command", "command": "node scripts/shoot.js {id}", "requires": "sandbox" } }
  }
}
```

- Before running a check with `requires: "sandbox"`, `verify.sandbox` runs once. If its exit code is not 0, the check is not run and becomes `FAIL` (it is never skipped as passing). `bugyo task done` does not pass either
- Which checks run in a sandbox can only be set in the config. The feature map's frontmatter cannot change it
- `requires: "sandbox"` without `verify.sandbox` is refused when the config is read

## Config file (`.bugyo/config.json`)

The settings for how and where to check live in one file, `.bugyo/config.json` at the project root. Without the file, everything runs with the defaults. Any unknown key makes every command refuse.

```json
{
  "verify": { "runner": "command", "command": "node {spec}" },
  "featureMap": { "specDir": "checks", "specSuffix": ".ts", "featuresDir": "src/features" }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `packageManager` | decided automatically | One of `pnpm`, `npm`, `yarn`, `bun`. If not written, it is decided by `packageManager` in `package.json`, then the lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`), searching upward from the project folder (not above the git root). `pnpm` if nothing is found. This decides the default commands when `commands` is not written |
| `sarif` | none | Results of other linters to count together in `bugyo doctor` and `bugyo baseline`. `[{ command?, file }]` ([Counting results of other linters](adopt.en.md#counting-results-of-other-linters)) |
| `locale` | `en` | The language of ban messages and the CLI: `en` or `ja`. The environment variable `BUGYO_LOCALE` and `bugyo({ locale })` come first ([Message language](#message-language)) |
| `verify.runner` | `playwright` | The default check: `playwright`, `command`, or a name in `verify.runners` (see "CLI" above) |
| `verify.command` | none | Required when running with `command` |
| `verify.runners` | none | Named checks (see "Different checks per feature" above) |
| `verify.sandbox` | none | A command that tells whether this is a sandbox. Runs before checks with `requires: "sandbox"` (see "Running only in a sandbox" above) |
| `sources` | none | `src`, `layers`, and `tsconfig` per source. Cannot be written together with `layers` (see "Several sources" above) |
| `featureMap.specDir` | `e2e` | The spec folder searched for missing matches. `null` skips the check |
| `featureMap.specSuffix` | `.spec.ts` | The file name ending that marks a spec |
| `featureMap.featuresDir` | `layers.features`, else `src/features` | Where the feature folders are. `null` skips the check |
| `layers` | none | Where the layer folders are (`app`, `features`, and `ui`, `api`, `lib`, `model`, `other` of `shared`), and the folder names inside a feature (`featureParts`). See "Renaming the layer folders" above |
| `pullRequests.allowBranches` | `[]` | Globs of branches that `bugyo task pr-check` lets through without a task ([tasks.en.md](tasks.en.md#settings)) |

`commands`, `evidence`, and `gate` in the same file are the settings of the task ledger and the gate ([tasks.en.md](tasks.en.md#settings)). Only a person changes this file.

## Scripts in the project

Both examples use these three.

| Script | `react-vite` ([examples/todo-app](../examples/todo-app)) | `node-lib` ([examples/node-lib](../examples/node-lib)) | When it must pass |
| --- | --- | --- | --- |
| `pnpm check` | `tsc --noEmit && eslint . && depcruise src && knip && bugyo task lint` | the same | every change |
| `pnpm test` | `vitest run` (unit tests and the feature map checks) | `node --test "src/**/*.test.ts" "test/**/*.test.ts"` (unit tests and the feature map checks) | every change |
| `pnpm verify <id>` | `bugyo verify <id>` (Playwright) | `bugyo verify <id>` (`node checks/<id>.ts`) | before claiming done |

The `node-lib` `.bugyo/config.json` sets `verify` to the `command` way (`node {spec}`), the spec folder to `checks`, and `evidence.tree` to `src`, `checks`, and `test`. Its lint is `parts: [common, structure, noComments, fetchOnlyInApi]` with `explicitExtensions: true`, and dependency-cruiser is `config()`. `@bugyo/lint-react` is not a dependency. `react-vite` uses `parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers]` and `config({ react: true })`.

Passing `pnpm check` alone is not done. The evidence each kind of change needs is in the example's [docs/architecture.md](../examples/todo-app/docs/architecture.md).

## Claude Code plugin

Advice on how to proceed comes from the skills of the [plugin](../plugin). What must always be enforced is not written in skills but stopped by the lint, tests, and verification above, because a skill may not be invoked.
