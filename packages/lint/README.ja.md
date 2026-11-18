# @bugyo/lint

[English](README.md) ・ 日本語

エージェントが正しい書き方しか選べないようにする、ESLint・dependency-cruiser・tsconfig のプリセットです。React に依存しません。React 用の部品と禁止は [@bugyo/lint-react](../lint-react) にあります。

ESLint 9.24 以上（10 を含む）と TypeScript 5.8〜6.0 で動きます。`eslint` と `@eslint/js`（同じ大きな版）、`typescript`、`dependency-cruiser` はプロジェクトの側に入れます。

```js
// eslint.config.js
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname, parts: [common, structure, noComments, fetchOnlyInApi] });
```

設定は、部品と禁止の組み合わせです。`parts` に並べたものだけが当たります。

- 部品 `common`（必須）: 厳しい型検査、`any`・型アサーション・非 null アサーション・待っていない Promise・`switch` の漏れ、理由のない `eslint-disable`
- 部品 `structure`: `app` / `features` / `shared` の境界、feature の外からは `index.ts` だけ、`model/` から `ui/`・`api/` への依存の禁止
- 禁止 `noComments`: コメントは公開 API の JSDoc と理由つきの `eslint-disable` だけ
- 禁止 `fetchOnlyInApi`: `fetch` は `shared/api`（`apiClientDir`）とテストでだけ呼べる

`parts` を省くと `[common, structure]` で、書き方の禁止は入りません。React を使うプロジェクトは [@bugyo/lint-react](../lint-react) の部品と禁止も足します。独自の禁止は `defineBan` で作り、同じように `parts` に足します。

```js
// eslint.config.js（独自の禁止を足す）
import { bugyo, common, defineBan, structure } from '@bugyo/lint';

const clock = defineBan({
  name: 'clock',
  allow: ['effects', 'tests'],
  properties: [{ object: 'Date', property: 'now', message: 'shared/lib の systemClock を使ってください' }],
});

export default bugyo({ root: import.meta.dirname, parts: [common, structure, clock] });
```

```js
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config(); // React を使うなら config({ react: true })
```

```jsonc
// tsconfig.json
{ "extends": "@bugyo/lint/tsconfig.json" }
```

層のフォルダが `src/app`・`src/features`・`src/shared` でないプロジェクトは、`bugyo({ root, src, layers })` と `config({ src, layers })` に場所を渡します（[層のフォルダ名を変える](../../docs/foundation.md#層のフォルダ名を変える)）。feature の中のフォルダが `ui/`・`api/`・`model/` でなければ、`layers.featureParts` に役割ごとのフォルダ名を書きます。

部品と禁止ごとに止めるものの一覧、設定項目、`defineBan` の書き方は [docs/foundation.md](../../docs/foundation.md) にあります。

テストは、わざと違反した `.ts` だけのファイル（`test/fixture-node`）に対して共通と構成のルールと禁止がエラーを出すこと、既定の組み合わせに書き方の禁止と React 用のルールが入らないこと、`defineBan` の禁止が bugyo の禁止と同じ決まりで当たることを確かめます。`test/fixture-layers` は、層のフォルダ名、feature の中のフォルダ名、import の別名が既定と違うプロジェクトです。`test/fixture-sources` は、フロントとサーバーの2つのソースを、それぞれの tsconfig と部品で1つの設定にまとめたプロジェクトです。

```bash
pnpm test
```
