# @bugyo/lint

English ・ [日本語](https://github.com/khrtz/bugyo/blob/main/packages/lint/README.ja.md)

ESLint, dependency-cruiser, and tsconfig presets that leave agents only the right way to write code. No React dependency. The React part and bans live in [@bugyo/lint-react](https://www.npmjs.com/package/@bugyo/lint-react).

Works with ESLint 9.24 or later (including 10) and TypeScript 5.8–6.0. Install `eslint` and `@eslint/js` (same major version), `typescript`, and `dependency-cruiser` in your project.

```bash
npm install --save-dev @bugyo/lint eslint @eslint/js typescript dependency-cruiser
```

```js
// eslint.config.js
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname, parts: [common, structure, noComments, fetchOnlyInApi] });
```

The config is a combination of parts and bans. Only what you list in `parts` applies.

- Part `common` (required): strict type checking; no `any`, type assertions, non-null assertions, floating promises, non-exhaustive `switch`, or `eslint-disable` without a reason
- Part `structure`: boundaries between `app` / `features` / `shared`, only `index.ts` from outside a feature, no imports from `model/` into `ui/` or `api/`
- Ban `noComments`: comments only as JSDoc on public APIs and `eslint-disable` with a reason
- Ban `fetchOnlyInApi`: `fetch` only in `shared/api` (`apiClientDir`) and tests

Without `parts`, you get `[common, structure]` and no style bans. React projects also add the part and bans from [@bugyo/lint-react](https://www.npmjs.com/package/@bugyo/lint-react). Write your own bans with `defineBan` and add them to `parts` the same way.

```js
// eslint.config.js (with your own ban)
import { bugyo, common, defineBan, structure } from '@bugyo/lint';

const clock = defineBan({
  name: 'clock',
  allow: ['effects', 'tests'],
  properties: [{ object: 'Date', property: 'now', message: 'Use systemClock from shared/lib.' }],
});

export default bugyo({ root: import.meta.dirname, parts: [common, structure, clock] });
```

Every entry in `imports`, `globals`, `syntax`, and `properties` needs a `message` that tells the reader what to use instead. `defineBan` refuses entries without one.

```js
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config(); // config({ react: true }) for React
```

```jsonc
// tsconfig.json
{ "extends": "@bugyo/lint/tsconfig.json" }
```

Rule messages are in English by default. Set `"locale": "ja"` in `.bugyo/config.json`, set `BUGYO_LOCALE=ja`, or pass `bugyo({ locale: 'ja' })` for Japanese.

If your layer folders are not `src/app`, `src/features`, and `src/shared`, pass their locations to `bugyo({ root, src, layers })` and `config({ src, layers })`. If the folders inside a feature are not `ui/`, `api/`, and `model/`, list the folder names per role in `layers.featureParts`.

What each part and ban stops, every option, and how to write `defineBan` are in [docs/foundation.en.md](https://github.com/khrtz/bugyo/blob/main/docs/foundation.en.md).

## License

MIT
