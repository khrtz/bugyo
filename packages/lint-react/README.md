# @bugyo/lint-react

[@bugyo/lint](../lint) に足す、React 用の部品です。`useEffect` を書いてよい場所を `shared/lib` だけにし、react-hooks の推奨ルールを入れ、feature の UI でのタイマーと、`model/` から React への依存を止めます。

```js
// eslint.config.js
import { bugyo, common, structure } from '@bugyo/lint';
import { react } from '@bugyo/lint-react';

export default bugyo({ root: import.meta.dirname, parts: [common, structure, react] });
```

dependency-cruiser は `@bugyo/lint` のものを `react: true` で使います。

```js
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config({ react: true });
```

止めるものの一覧と例外の場所は [docs/foundation.md](../../docs/foundation.md) にあります。

テストは、わざと違反した React のファイル（`test/fixture`）に対して、共通・構成・React を組み合わせた設定と dependency-cruiser の各ルールがエラーを出すことを確かめます。

```bash
pnpm test
```
