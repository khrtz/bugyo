# @bugyo/lint

エージェントが正しい書き方しか選べないようにする、ESLint・dependency-cruiser・tsconfig のプリセットです。

```js
// eslint.config.js
import { bugyo } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname });
```

React を使わないプロジェクトは、共通と構成の部品だけを使います。

```js
// eslint.config.js
import { bugyo, common, structure } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname, parts: [common, structure] });
```

```js
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config(); // React を使わないなら config({ react: false })
```

```jsonc
// tsconfig.json
{ "extends": "@bugyo/lint/tsconfig.json" }
```

部品ごとに止めるものの一覧、設定項目、独自の禁止の足し方は [docs/foundation.md](../../docs/foundation.md) にあります。

テストは、わざと違反したファイル（React の見本は `test/fixture`、`.ts` だけのものは `test/fixture-node`）に対して各ルールがエラーを出すことと、React を使わない組み合わせに React 用のルールが入らないことを確かめます。

```bash
pnpm test
```
