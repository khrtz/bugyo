# @bugyo/lint-react

English ・ [日本語](https://github.com/khrtz/bugyo/blob/main/packages/lint-react/README.ja.md)

The React part and bans to add on top of [@bugyo/lint](https://www.npmjs.com/package/@bugyo/lint).

- Part `react`: the recommended react-hooks rules, and no React imports from `model/`
- Ban `noUseEffect`: `useEffect` / `useLayoutEffect` only in `shared/lib` (`effectHooksDir`)
- Ban `noUiTimers`: no `setTimeout`, `setInterval`, or `requestAnimationFrame` in feature UI (tests may use them)

Only the bans you list in `parts` apply.

```bash
npm install --save-dev @bugyo/lint @bugyo/lint-react eslint @eslint/js typescript dependency-cruiser
```

```js
// eslint.config.js
import { bugyo, common, structure } from '@bugyo/lint';
import { noUiTimers, noUseEffect, react } from '@bugyo/lint-react';

export default bugyo({ root: import.meta.dirname, parts: [common, structure, react, noUseEffect, noUiTimers] });
```

For dependency-cruiser, use the one from `@bugyo/lint` with `react: true`.

```js
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config({ react: true });
```

What each rule stops and where the exceptions live are in [docs/foundation.en.md](https://github.com/khrtz/bugyo/blob/main/docs/foundation.en.md).

## License

MIT
