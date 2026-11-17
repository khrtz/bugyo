# @bugyo/lint

エージェントが正しい書き方しか選べないようにする、ESLint・dependency-cruiser・tsconfig のプリセットです。React に依存しません。React 用の禁止は [@bugyo/lint-react](../lint-react) にあります。

```js
// eslint.config.js
import { bugyo } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname });
```

既定では、共通（`common`）と構成（`structure`）の部品を使います。React を使うプロジェクトは `@bugyo/lint-react` も入れ、`react` の部品を足します。

```js
// eslint.config.js（React を使うプロジェクト）
import { bugyo, common, structure } from '@bugyo/lint';
import { react } from '@bugyo/lint-react';

export default bugyo({ root: import.meta.dirname, parts: [common, structure, react] });
```

```js
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config(); // React を使うなら config({ react: true })
```

```jsonc
// tsconfig.json
{ "extends": "@bugyo/lint/tsconfig.json" }
```

部品ごとに止めるものの一覧、設定項目、独自の禁止の足し方は [docs/foundation.md](../../docs/foundation.md) にあります。

テストは、わざと違反した `.ts` だけのファイル（`test/fixture-node`）に対して共通と構成のルールがエラーを出すことと、既定の組み合わせに React 用のルールが入らないことを確かめます。

```bash
pnpm test
```
