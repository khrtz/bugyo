# @bugyo/lint-react

[@bugyo/lint](../lint) に足す、React 用の部品と禁止です。

- 部品 `react`: react-hooks の推奨ルールと、`model/` から React への依存の禁止
- 禁止 `noUseEffect`: `useEffect` / `useLayoutEffect` は `shared/lib`（`effectHooksDir`）でだけ書ける
- 禁止 `noUiTimers`: feature の UI で `setTimeout`・`setInterval`・`requestAnimationFrame` を使えない（テストでは書ける）

禁止は、`parts` に並べたものだけが当たります。

```js
// eslint.config.js
import { bugyo, common, structure } from '@bugyo/lint';
import { noUiTimers, noUseEffect, react } from '@bugyo/lint-react';

export default bugyo({ root: import.meta.dirname, parts: [common, structure, react, noUseEffect, noUiTimers] });
```

dependency-cruiser は `@bugyo/lint` のものを `react: true` で使います。

```js
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config({ react: true });
```

止めるものの一覧と例外の場所は [docs/foundation.md](../../docs/foundation.md) にあります。

テストは、わざと違反した React のファイル（`test/fixture`）に対して、部品と禁止を組み合わせた設定と dependency-cruiser の各ルールがエラーを出すことと、`react` だけでは `useEffect` と UI のタイマーを止めないことを確かめます。

```bash
pnpm test
```
