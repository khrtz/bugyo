# @bugyo/lint

エージェントが正しい書き方しか選べないようにする、ESLint・dependency-cruiser・tsconfig のプリセットです。React に依存しません。React 用の禁止は [@bugyo/lint-react](../lint-react) にあります。

ESLint 9.24 以上（10 を含む）と TypeScript 5.8〜6.0 で動きます。`eslint` と `@eslint/js`（同じ大きな版）、`typescript`、`dependency-cruiser` はプロジェクトの側に入れます。

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

層のフォルダが `src/app`・`src/features`・`src/shared` でないプロジェクトは、`bugyo({ root, src, layers })` と `config({ src, layers })` に場所を渡します（[層のフォルダ名を変える](../../docs/foundation.md#層のフォルダ名を変える)）。

部品ごとに止めるものの一覧、設定項目、独自の禁止の足し方は [docs/foundation.md](../../docs/foundation.md) にあります。

テストは、わざと違反した `.ts` だけのファイル（`test/fixture-node`）に対して共通と構成のルールがエラーを出すことと、既定の組み合わせに React 用のルールが入らないことを確かめます。`test/fixture-layers` は、層のフォルダ名と import の別名が既定と違うプロジェクトです。

```bash
pnpm test
```
