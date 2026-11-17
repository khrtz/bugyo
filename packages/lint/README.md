# @bugyo/lint

エージェントが正しい書き方しか選べないようにする、ESLint・dependency-cruiser・tsconfig のプリセットです。

```js
// eslint.config.js
import { bugyo } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname });
```

```js
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config();
```

```jsonc
// tsconfig.json
{ "extends": "@bugyo/lint/tsconfig.json" }
```

止めるものの一覧、設定項目、独自の禁止の足し方は [docs/foundation.md](../../docs/foundation.md) にあります。

テストは、わざと違反したファイル（`test/fixture`）に対して各ルールがエラーを出すことを確かめます。

```bash
pnpm test
```
