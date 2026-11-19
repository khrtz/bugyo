# 土台（実装済み）

[English](foundation.en.md) ・ 日本語

状態: 実装済み。このページの内容はすべて今のコードで動きます。

土台は、エージェントが間違った書き方を選べないようにする層です。フォルダ構成、lint、依存ルール、検証の4つでできています。

feature map と `bugyo verify` は技術を問いません。確かめ方は `.bugyo/config.json` で決めます（下の「設定ファイル」）。lint と依存ルールは TypeScript が前提です。React 用の部品と禁止は別のパッケージ `@bugyo/lint-react` に分かれていて、React を使うプロジェクトだけが入れます（下の「部品と禁止」）。

雛形（`bugyo init --template <名前>`）は2つです。

| テンプレート | 見本 | 前提 |
| --- | --- | --- |
| `react-vite`（既定） | [examples/todo-app](../examples/todo-app) | pnpm、Vite、React、Playwright、Vitest、`@/` を `src/` に向けたパスの別名 |
| `node-lib` | [examples/node-lib](../examples/node-lib) | pnpm、Node 24 の型除去（`.ts` をそのまま実行する）、`node:test`。import に拡張子 `.ts` を書く。React・Vite・Playwright は使わない |

## フォルダ構成

```
src/
  app/                      画面の組み立て。features の index.ts だけを使う
  features/<id>/
    ui/                     画面の部品
    api/                    データの取得（useXxxQuery）
    model/                  純粋関数と型。React も通信も使わない
    index.ts                外に見せる窓口。外からはここだけを import する
  shared/
    ui/                     共通の部品
    lib/                    useEffect を書いてよい唯一の場所（noUseEffect を入れたとき）
    api/                    fetch を呼んでよい唯一の場所（fetchOnlyInApi を入れたとき）
docs/features/<id>.md       feature map（機能ごとの確かめ方）
e2e/<id>.spec.ts            その機能を実際に操作するテスト
```

依存の向きは `app → features → shared`、feature の中では `ui → api → model` です。

`node-lib` では画面がないので、feature は `model/` と `index.ts` だけです。`src/app` はコマンドの入口、`src/index.ts` はライブラリとして公開するもの、`checks/<id>.ts` はその機能を実際に動かして確かめるスクリプト（feature map の `spec`）です。

## `@bugyo/lint`

### ESLint

ESLint は 9.24 以上（10 を含む）、TypeScript は 5.8 以上 6.0 まで、flat config が前提です。`@eslint/js` は peer 依存なので、使う ESLint と同じ大きな版（9 なら 9、10 なら 10）をプロジェクトに入れます。CI は ESLint 9.24・TypeScript 5.8 の組み合わせでも lint のテストを回しています。

```js
// eslint.config.js（React を使うプロジェクト。react-vite のテンプレートと同じ）
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';
import { noUiTimers, noUseEffect, react } from '@bugyo/lint-react';

export default bugyo({
  root: import.meta.dirname,
  parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers],
});
```

| 項目 | 既定 | 意味 |
| --- | --- | --- |
| `root` | 必須 | `import.meta.dirname` を渡す |
| `src` | `src` | ソースの場所。`layers` のフォルダはすべてこの中に置く |
| `layers` | `<src>/app`・`<src>/features`・`<src>/shared/{ui,api,lib}` | 層のフォルダの場所（下の「層のフォルダ名を変える」） |
| `effectHooksDir` | `layers.shared.lib`（いくつもあればそのすべて） | 禁止の `allow` に書く `effects` の場所（`noUseEffect` を入れたときに `useEffect` を書いてよい場所） |
| `apiClientDir` | `layers.shared.api`（いくつもあればそのすべて） | 禁止の `allow` に書く `api` の場所（`fetchOnlyInApi` を入れたときに `fetch` を呼んでよい場所） |
| `ignores` | `[]` | lint から外すパス（`dist`、`artifacts`、`node_modules` などは最初から外れている） |
| `severity` | `{}` | 禁止を warn に下げる（下の「禁止を warn に下げる」） |
| `locale` | `en` | 禁止のメッセージの言語。`en` か `ja`（下の「メッセージの言語」） |
| `parts` | `[common, structure]` | 使う部品と禁止（下の「部品と禁止」）。`common` は必須 |
| `explicitExtensions` | `false` | import に拡張子を書くプロジェクト（Node の型除去で `.ts` を直接動かすなど）で `true` にする。`features/<id>/index.ts` をファイル名つきで import できるようになる |

#### 部品と禁止

設定は、部品と禁止の組み合わせです。部品は型の検査と層の境界を、禁止は書き方の決まりを1つずつ持ちます。`parts` に並べたものだけが当たり、順番は結果に影響しません。同じ範囲の禁止（`no-restricted-imports` など）は、部品と禁止をまたいで1つのルールに合成されます。

```js
// eslint.config.js（React を使わないプロジェクト。node-lib のテンプレートと同じ）
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname, explicitExtensions: true, parts: [common, structure, noComments, fetchOnlyInApi] });
```

`parts` を省くと `[common, structure]` で、書き方の禁止は1つも入りません。

| 部品 | 範囲 | 止めるもの |
| --- | --- | --- |
| `common` | すべてのファイル | `any`、型アサーション（`as`）、非 null アサーション（`!`）、待っていない Promise、`switch` の分岐漏れ、理由のない `eslint-disable`、対象を絞らない `eslint-disable`。加えて typescript-eslint の `strictTypeChecked`。必須 |
| `structure` | `src` の下 | 他の feature の内部ファイルの import（禁止の名前は `feature-internals`）、`shared` から `features` / `app` への依存、`features` から `app` への依存 |
| `structure` | `src/features/*/model` | 同じ feature の `ui` と `api`、`shared/ui`、`shared/api`（`model-layers`） |
| `react`（`@bugyo/lint-react`） | `src` の下 | react-hooks の推奨ルール |
| `react` | `src/features/*/model` | `react`、`react-dom`、`@tanstack/*`（`model-react`） |

| 禁止 | パッケージ | 名前 | 止めるもの | 許す場所 |
| --- | --- | --- | --- | --- |
| `noComments` | `@bugyo/lint` | `comments` | `src` の下のコメント。公開 API の JSDoc（`/** */`）と、理由つきの `eslint-disable`（`-- 理由`）だけ書ける | なし |
| `fetchOnlyInApi` | `@bugyo/lint` | `fetch` | `fetch` | `apiClientDir`、テスト |
| `noUseEffect` | `@bugyo/lint-react` | `use-effect` | `react` からの `useEffect` / `useLayoutEffect` の import と `React.useEffect` の形 | `effectHooksDir` |
| `noUiTimers` | `@bugyo/lint-react` | `ui-timers` | feature の UI での `setTimeout`、`setInterval`、`requestAnimationFrame` | テスト |

エラー文には、代わりに何を使うかが入っています。他の feature の内部ファイルの import は、パスに `features/` を含む書き方（`@/features/<id>/...` や `../features/<id>/...`）を ESLint が止め、相対パスで feature の間をまたぐ書き方も含めて dependency-cruiser が止めます。`.js` / `.cjs` / `.mjs` には型を使うルールを当てません。

#### 禁止を warn に下げる

入れたばかりで直しきれない禁止は、`severity` で warn に下げられます。`off` にはできません。

```js
export default bugyo({
  root: import.meta.dirname,
  parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers],
  severity: { 'use-effect': 'warn' },
});
```

- キーは、`parts` に入れた禁止の名前です。上の表の名前（`feature-internals`・`model-layers`・`model-react`・`comments`・`fetch`・`use-effect`・`ui-timers`）と、`defineBan` で作った禁止の `name` が使えます。`model-layers` は、`layers` を渡したときは同じ feature の `ui/`・`api/`（`layers.featureParts` に書いたフォルダ）への import だけです（下を参照）
- 名前のほかに、設定にあるルール ID（例: `@typescript-eslint/no-non-null-assertion`）も渡せます。そのルールがどのファイルでも warn になります
- 名前で下げた禁止は、同じルールの他の禁止と分けるために、ルール ID が `bugyo-warn/<元のルール>`（例: `bugyo-warn/no-restricted-imports`）になります。`eslint-disable` のコメントで止めるときも、この ID を書きます。`rules` で書いた禁止（`comments` など）は、ルール ID はそのままで warn になります
- 知らない名前と、`parts` に入れていない禁止の名前は断ります
- 層の境界（`shared` から `features` / `app`、`features` から `app`、`layers` を渡したときの `model/` から `shared.ui` / `shared.api`）は1つのルール `import-x/no-restricted-paths` なので、1つずつは下げられません。下げるときはルール ID で、境界をまとめて下げます
- `bugyo doctor` は、warn に下げた禁止を「直す借り」として別に数えます。`bugyo baseline check` は warn に下げた禁止も数えるので、下げても件数は増やせません
- ESLint の抑制ファイルに入っている禁止を下げると、抑制が使われなくなって `eslint .` が落ちます（抑制は error だけに効くため）。下げたら `bugyo baseline save` を実行し直します

#### メッセージの言語

bugyo の禁止のメッセージは、英語（`en`、既定）と日本語（`ja`）があります。次の順に見て、最初に見つかったものを使います。

1. `bugyo({ locale: 'ja' })`
2. 環境変数 `BUGYO_LOCALE`
3. `.bugyo/config.json` の `locale`

```
'useEffect' import from 'react' is restricted. [bugyo:use-effect] 製品コードでuseEffectは使えません。データ取得は features/*/api の useXxxQuery、...
```

- メッセージの頭の禁止の名前（`[bugyo:use-effect]`）は、言語によらず同じです。`bugyo baseline` はこの名前までで数えるので、言語を変えても件数は変わりません
- 言語が変わるのは、`@bugyo/lint` と `@bugyo/lint-react` の禁止のメッセージ（コメントの禁止を含む）、設定の書き方の誤りを知らせるエラー、dependency-cruiser のルールの説明、`bugyo` CLI の出力です
- CLI と、設定の誤りのエラーと、dependency-cruiser の説明は、`BUGYO_LOCALE`、今のフォルダの `.bugyo/config.json` の `locale` の順に見ます。dependency-cruiser の説明は `config({ locale: 'ja' })` でも選べます
- `defineBan` で作った禁止のメッセージは書いたとおりに出ます。言語ごとに変えたいときは、`build(context)` で `context.locale` を見ます
- `.bugyo/baseline.json` が名前で数える前の形式（`version` のないもの）なら、言語を変える前に `bugyo baseline save` で作り直します。古い形式はメッセージの文で数えるので、言語を変えると件数が合わなくなります
- どれもなければ英語です
- `en` と `ja` のほかを渡すと断ります

#### 層のフォルダ名を変える

層のフォルダが `src/app`・`src/features`・`src/shared` でないプロジェクトでは、`layers` で場所を渡します。値は `.bugyo/config.json` の `layers` に1回だけ書き、ESLint と dependency-cruiser はそこから読みます。

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

`layers` を渡すと、`effectHooksDir` と `apiClientDir` の既定も `layers.shared.lib` と `layers.shared.api` になります（例では `fetch` は `web/app/api` でだけ呼べる）。境界の判定は import の別名（`@/` など）に頼らず、解決したパスで行います（`~/app/ui/x` と `../../app/ui/x` のどちらで書いても同じに止まる）。他の feature の内部ファイルの import は、パスに `features` のフォルダ名（例では `features`）を含む書き方を ESLint が止めます。`.bugyo/config.json` の `layers` で書かなかった場所は `src/app` などの既定で埋まります。ESLint と dependency-cruiser では `<src>/app` などで埋まるので、`src` が `src` でなければ5つの場所をすべて書きます。これを書いたプロジェクトでは、`featureMap.featuresDir` の既定が `layers.features` になり、`bugyo new feature` は雛形を作らずに断ります（雛形は `src/features` の形でしか作れないため）。`bugyo doctor` は、`layers` をまとめたフォルダ（例では `web`）の中で、どの層にも入っていないファイルを出します。

#### shared にフォルダをいくつも置く

`shared` の `ui`・`api`・`lib` は、フォルダ1つの文字列か、フォルダの配列で書けます。役割の違う共有のフォルダは、`model` と `other` に書きます。

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

| キー | 置くもの | 当たるルール |
| --- | --- | --- |
| `ui`・`api`・`lib` | 共有の部品・API のクライアント・フック | features と app に依存できない。`allow` の `effects` は `lib` のすべて、`api` は `api` のすべて |
| `model` | 共有の純粋なロジック | features と app に加えて、shared の `ui`・`api`・`other` にも依存できない（使えるのは shared の `lib` と `model` だけ）。`scope: 'model'` の禁止が当たる（`model-react` など）。dependency-cruiser では `shared-model-is-pure` |
| `other` | 役割を持たない共有のフォルダ（状態管理など） | features と app に依存できないことだけ。feature の model と shared の `model` からは使えない |

feature の model が使えるのは、自分の model と、shared の `lib` と `model` です。

#### feature の中のフォルダ名を変える

feature の中のフォルダが `ui/`・`api/`・`model/` でないプロジェクトでは、`layers.featureParts` に役割ごとのフォルダ名を書きます。書かなかった役割は `ui`・`api`・`model` のままです。

```json
{
  "layers": {
    "featureParts": { "ui": ["components", "hooks"], "api": ["api"], "model": ["lib"] }
  }
}
```

- `ui` に書いたフォルダには、`scope: 'ui'` の禁止（`noUseEffect`・`noUiTimers` など）が当たります
- `model` に書いたフォルダには、`scope: 'model'` の禁止（`model-layers`・`model-react` など）が当たります。`model-layers` は、同じ feature の `ui` と `api` に書いたフォルダへの import を止めます（例では `../components`・`../hooks`・`../api`）。dependency-cruiser の `model-is-pure` も同じフォルダを見ます
- `logic` タスクの「model にテストがある」は、`model` に書いたフォルダのどれかにテストがあれば通ります
- 名前は feature の中のフォルダ名だけです（`/` を含まない）。1つの名前は1つの役割にだけ書けます

`bugyo doctor` は、feature の中のどの役割にも入っていないフォルダと、`ui` と `model` の禁止が当たるファイルの数を出します。数が0なら、フォルダ名が役割と合っておらず、その禁止は何にも効いていません。

#### ソースをいくつも置く

1つのリポジトリに、層の決まりを当てるソースがいくつもあるとき（フロントとサーバーなど）は、ソースごとに場所と部品を分けます。台帳と feature map は1つのままです。

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

- `sources` の各ソースには `src`・`layers`・`tsconfig`（import の解決に使う tsconfig。既定は `tsconfig.json`）を書きます。`layers` で書かなかった場所は `<src>/app` などで埋まります。`.bugyo/config.json` では、`sources` と `layers` は一緒に書けません
- ESLint では、ソースごとに `parts`・`explicitExtensions`・`effectHooksDir`・`apiClientDir` も書けます。`sources` を使うときは、これらを外に書きません。`root`・`ignores`・`severity` は全体に1つです
- 禁止と層の境界は、そのソースの `src` の下にだけ当たります。同じ名前の禁止を、別々のソースに入れられます。部品の、src の外にも当てるルール（`common` の型の検査など）は、どれかのソースに入っていれば全体に1回だけ当てます
- ソースの `src` は重ねられません（`web` と `web/admin` など）
- 同じ id の機能のフォルダは、どのソースにあっても同じ機能です。どのソースの機能のフォルダにも `docs/features/<id>.md` が要ります。`logic` タスクの「model にテストがある」は、どれかのソースの model にテストがあれば通ります
- `bugyo doctor` は、どの層にも入っていないファイルと feature の中のフォルダを、ソースごとに見ます。`bugyo new feature` は雛形を作らずに断ります
- HTTP サーバーのソースの例は、下の「サーバーの層」です
- dependency-cruiser は1つの設定で1つの tsconfig しか使えないので、ソースごとに設定ファイルを分けて `config({ src, layers, tsConfig })` を呼びます。`bugyo doctor` と `bugyo baseline` が数えるのは、プロジェクトのルートの `.dependency-cruiser.cjs` の1つだけで、渡すのは `tsconfig` を書いていないソースだけです（ルートの設定はルートの tsconfig で import を解決するため）。ほかのソースの依存の違反は、そのソースの設定で `depcruise` を実行して確かめます

#### サーバーの層

HTTP サーバーも、同じ層と禁止で書けます。入口のファイル（ルートのマウントと全体にかかるミドルウェア）を `app` に、ミドルウェアやデータベースの置き場を `shared.other` に置きます。

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

| 決まり | 書き方 |
| --- | --- |
| `app.ts` からは feature の `index.ts` だけを使う | `app` をファイルにする（`structure` の境界と、dependency-cruiser の `app-only-via-feature-index` がそのまま当たる） |
| `middleware` と `db` は features に依存しない | `shared.other` に置く |
| リクエストの本文を読むのは、決めた入口だけ | 下の `readBody` の禁止 |
| データベースのクライアントを直接 import するのは、features か services だけ | 下の `db-client` の禁止 |

```js
const readBody = defineBan({
  name: 'read-body',
  allow: ['server/src/http/body.ts', 'tests'],
  syntax: [
    {
      selector: "CallExpression[callee.property.name=/^(json|text|formData|parseBody)$/][callee.object.property.name='req']",
      message: 'リクエストの本文は server/src/http/body.ts の readBody(c, schema) で読んでください',
    },
  ],
});

const dbClient = defineBan({
  name: 'db-client',
  allow: ['server/src/db', 'server/src/features', 'tests'],
  imports: { patterns: [{ group: ['**/db/client', '**/db/client.ts'], message: 'データベースのクライアントは features か services からだけ使ってください' }] },
});
```

`shared` の `ui`・`api`・`lib` は空にできないので、使わない役割にも、フォルダを1つ書きます（なくても動きます）。

### 独自の禁止を足す

独自の禁止は `defineBan` で作り、`parts` に bugyo の禁止と並べて渡します。bugyo の禁止も同じ形で書かれていて、名前・止める範囲・許す場所の決まりも、`severity` で warn に下げられることも同じです。

```js
import { bugyo, common, defineBan, structure } from '@bugyo/lint';

const clock = defineBan({
  name: 'clock',
  allow: ['effects', 'tests'],
  properties: [{ object: 'Date', property: 'now', message: 'shared/lib の systemClock を使ってください' }],
  syntax: [{ selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'shared/lib の systemClock を使ってください' }],
});

const noConsoleInApi = defineBan({
  name: 'no-console-in-api',
  scope: 'src/features/*/api/**/*.ts',
  rules: { 'no-console': 'error' },
});

export default bugyo({ root: import.meta.dirname, parts: [common, structure, clock, noConsoleInApi] });
```

| 項目 | 形 | 意味 |
| --- | --- | --- |
| `name` | 小文字・数字・ハイフン | 禁止の名前。`severity` のキーにもなる。同じ名前の禁止は2つ置けない |
| `scope` | `src`（既定）・`ui`・`model`。`rules` だけの禁止は root からの glob も使える | どこで止めるか。`ui` と `model` は、`layers.features` の各 feature の `ui/` と `model/`（`layers.featureParts` で変えられる）。`imports`・`globals`・`syntax`・`properties` は bugyo の禁止と1つのルールに合成するので、glob の範囲にすると断る（範囲を絞るなら `allow` で除く） |
| `allow` | `effects`・`api`・`tests`、または root からのパスか glob の配列 | どこでは許すか。`effects` は `effectHooksDir`、`api` は `apiClientDir`、`tests` は `src` の下の `*.test.ts(x)`。glob の記号（`*?[]{}!`）のないパスは、そのファイルか、そのフォルダの下のすべて（`scope` の glob も同じ） |
| `imports` | `{ paths: [{ name, importNames?, message }], patterns: [{ group, message }] }` | `no-restricted-imports` に合成する |
| `globals` | `[{ name, message }]` | `no-restricted-globals` に合成する |
| `properties` | `[{ object?, property?, message }]` | `no-restricted-properties` に合成する |
| `syntax` | `[{ selector, message }]` | `no-restricted-syntax` に合成する |
| `rules` | `{ '<ルール ID>': <設定> }` | 合成しない ESLint のルール。`scope` の中で当て、`allow` の場所では off にする |
| `plugins` | `{ '<名前>': <プラグイン> }` | `rules` で使うプラグイン |

- エラー文に `effectHooksDir` などの場所を入れたいときは、`build(context)` で `name` 以外の項目を返します（`defineBan({ name, allow, build: (context) => ({ globals: [...] }) })`）。`context` には `src`・`effectHooksDir`・`apiClientDir`・`layers`・`featuresLabel` が入っています（`effectHooksDir` と `apiClientDir` は、場所がいくつもあれば `・` でつないだ文字列。`layers.shared` の各値は配列）
- 禁止したものの「正しい入口」は、`allow` に書いた場所に作ります（例: `Date.now` を禁止し、`shared/lib/clock.ts` だけで使う）
- `imports`・`globals`・`syntax`・`properties` の項目には、どれも `message` が要ります。止めた相手が次に何をすればよいか（代わりに使うものと置き場所）を書きます。`message` のない項目、空の `message`、文字列だけの項目（`globals: ['alert']` など）は断ります
- エラー文の頭には禁止の名前が付きます（`[bugyo:clock] shared/lib の systemClock を使ってください`）。`bugyo doctor` と `bugyo baseline` は、この名前までで禁止を数えるので、後ろの説明の文を書き換えても件数は変わりません
- 知らない項目、何も止めていない禁止、`message` のない項目、同じ名前の禁止は断ります
- `no-restricted-imports` などを自分の設定ブロックで直接書くと、合成した bugyo の禁止が上書きされて消えます。必ず `defineBan` で足します

#### 決めた入口だけで使える import

`fetchOnlyInApi` と同じ形で、ほかの import も決めた場所でだけ使えるようにできます。IPC の呼び出し、データベースのクライアント、OS の API などです。

```js
const processOnlyInSystem = defineBan({
  name: 'child-process',
  allow: ['src/shared/system', 'tests'],
  imports: {
    paths: [
      { name: 'node:child_process', message: '子プロセスは src/shared/system のクライアントから起動してください' },
      { name: 'node:fs', importNames: ['writeFileSync'], message: 'ファイルの書き込みは src/shared/system から行ってください' },
    ],
    patterns: [{ group: ['child_process'], message: '子プロセスは src/shared/system のクライアントから起動してください' }],
  },
});

export default bugyo({ root: import.meta.dirname, parts: [common, structure, processOnlyInSystem] });
```

入口を `layers.shared.api` に置くなら、`allow` は `['api', 'tests']` です。
- 1つのファイルが2つの許す場所に当たるとき（例: `shared/lib` の中のテスト）は、後ろの場所（`effects`・`api`・`tests`・glob の順）で作り直したルールが前の場所の分を上書きします。同じ種類（`imports` 同士など）の別々の禁止を、片方は前の場所で、もう片方は後ろの場所で許していると、前の場所で許した禁止がそのファイルでは戻ります

### dependency-cruiser

```js
// .dependency-cruiser.cjs（React を使わないなら config()）
module.exports = require('@bugyo/lint/depcruise').config({ react: true });
```

`config({ src, tsConfig, forbidden, react, locale })` を受け取ります。`forbidden` に渡したルールは後ろに足されます。`react: true` にすると、`model-is-pure` は React とその周辺（`react`、`react-dom`、`@tanstack/*`）への依存も止めます（既定は `false`）。`locale` はルールの説明の言語です（上の「メッセージの言語」）。

| ルール | 止めるもの |
| --- | --- |
| `no-circular` | 循環依存 |
| `feature-internals-only-via-index` | 他の feature の `index.ts` 以外への依存 |
| `app-only-via-feature-index` | `app` から feature の `index.ts` 以外への依存 |
| `shared-is-leaf` | `shared` から `features` / `app` への依存 |
| `features-not-to-app` | `features` から `app` への依存 |
| `model-is-pure` | `model` から、自分の `model` と `shared/lib` 以外のソースへの依存。`react: true` なら `react`、`react-dom`、`@tanstack/*` への依存も |
| `not-to-unresolvable` | 解決できない import |

境界は ESLint と dependency-cruiser の両方で見ます。循環依存を見るのは dependency-cruiser だけです。

### tsconfig

```jsonc
// tsconfig.json
{
  "extends": "@bugyo/lint/tsconfig.json",
  "compilerOptions": { "types": ["vite/client", "node"], "paths": { "@/*": ["./src/*"] } },
  "include": ["src", "e2e", "*.ts", "*.js", ".dependency-cruiser.cjs"]
}
```

`strict` に加えて、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`noFallthroughCasesInSwitch`、`verbatimModuleSyntax`、`noUnusedLocals`、`noUnusedParameters` を有効にしています。

## feature map

機能ごとに `docs/features/<id>.md` を1つ置きます。エージェントは、確かめたい機能のファイルを1つだけ開けば、ソースを読まなくても操作できます。

```md
---
id: todos
route: /
spec: e2e/todos.spec.ts
---

# todos

## 何があるか
## どう辿り着くか
## どう操作して確かめるか
## よく嘘をつくところ
```

- `id` は小文字・数字・ハイフンで、機能のフォルダ（既定は `src/features/<id>`）と同じ名前にします
- `spec` は、その機能を確かめるファイルへの、プロジェクトのルートからの相対パスです（`/` 区切り。`..` と絶対パスは使えません）。形は問わず、実在だけを確かめます
- `route` は任意です。画面のある機能で、辿り着く URL のパスを `/` から書きます
- 4つの見出しは必須です。「よく嘘をつくところ」には、見た目は通るのに壊れていることが起きやすい点を書きます
- 見出しは英語でも書けます（`## What is there`・`## How to reach it`・`## How to check it`・`## Where it lies`）。見出しごとに日本語と英語を混ぜてもかまいません。雛形のままかどうかは、`（…）` だけの項目と `：` で終わる項目で見ます。英語の見出しの下では、`(…)` だけの項目と `:` で終わる項目も雛形のままとして扱います
- `bugyo new feature` は、プロジェクトの言語（`locale`）の見出しで作ります
- `docs/features/README.md` に、全体を確かめるときの順番を `[id](id.md)` の形で並べます

対応漏れはテストで落とします。

```ts
// e2e/feature-map.test.ts（Vitest）
import { registerFeatureMapTests } from 'bugyo/vitest';

registerFeatureMapTests();
```

```ts
// test/feature-map.test.ts（node:test）
import { registerFeatureMapTests } from 'bugyo/node-test';

registerFeatureMapTests();
```

このテストが確かめることは次の6つです。

1. ファイル名と `id` が一致している
2. すべての機能に4つの見出しがある
3. すべての機能の `spec` が実在する
4. spec のフォルダ（既定は `e2e/`）の、名前が spec の末尾（既定は `.spec.ts`）で終わるすべてのファイルが、どれかの機能に対応している
5. 機能のフォルダ（既定は `src/features`）のすべてのフォルダが feature map に載っている
6. README の順番に、すべての機能がちょうど1回ずつ載っている

4と5は、該当するフォルダがないときや設定で `null` にしたとき「対象なし」として飛ばします。場所は `registerFeatureMapTests({ cwd, src, specDir, specSuffix, featuresDir })` の引数、`.bugyo/config.json` の `featureMap`、既定値の順に決まります（`src` だけを渡すと、機能のフォルダは `<src>/features`）。

コードから読むときは `loadFeatures(cwd)` と `loadSweepOrder(cwd)` を使います。テストランナーを問わずに検査を使うときは `featureMapChecks(options)` が、検査ごとに `title`、`skip`（飛ばす理由か `null`）、`problems()`（見つかった問題の配列）を返します。

## 検証（Playwright）

```ts
// playwright.config.ts
import { defineBugyoConfig } from 'bugyo/playwright';

export default defineBugyoConfig({ port: 5173 });
```

| 項目 | 既定 | 意味 |
| --- | --- | --- |
| `port` | `5173` | dev サーバーのポート |
| `command` | `vite --port <port> --strictPort` | dev サーバーを起動するコマンド。`node_modules/.bin` の `vite` を使うので、パッケージマネージャーを問わない |
| `reuseExistingServer` | `false` | 同じポートですでに動いているサーバーを使い回すか。既定では使い回さず、ポートが使われていれば失敗する（別のプロジェクトのサーバーを撮って証拠にしないため） |
| `overrides` | なし | Playwright の設定を上書きする |

この設定は次のように動きます。

- `e2e/**/*.spec.ts` を Chromium で実行する。dev サーバーの起動と停止は Playwright に任せる
- すべてのテストで動画・スクリーンショット・トレースを取り、`artifacts/test-results` に置く
- スクリーンショットの基準画像は `e2e/__screenshots__/<OS>/` に OS ごとに分けて置く
- 基準画像がないとき、手元では新しく作り、CI（環境変数 `CI` があるとき）では失敗にする（飛ばさない）

このリポジトリの CI（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）は、PR と main への push のたびに Linux で次を実行します。

| ジョブ | 実行するもの |
| --- | --- |
| `pnpm check / test` | `pnpm check` と `pnpm test` |
| `verify（証拠つき）` | `pnpm verify`（todo-app は Playwright、node-lib は機能ごとのコマンド）。`artifacts/` を成果物として上げ、PR に合否と証拠のリンクを載せる |
| `npm で入れたプロジェクト（pnpm なし）` | パッケージを作り、`react-vite` のプロジェクトを npm で入れ、pnpm を `PATH` から外して、check・test・`verify --all`・`task done` を通す |

Linux の基準画像は `examples/todo-app/e2e/__screenshots__/linux/` にあります。画面を変えて作り直すときは次の手順です。

1. 作業中のブランチで、Actions の CI を `update_snapshots` を有効にして手動で実行する（`gh workflow run CI --ref <ブランチ> -f update_snapshots=true`）
2. できた成果物 `linux-screenshots` を取り出し（`gh run download <run id> -n linux-screenshots -D examples/todo-app/e2e/__screenshots__/linux`）、人が画像を見てからコミットする

## CLI

| コマンド | すること |
| --- | --- |
| `bugyo init <dir> [--template <名前>]` | 土台入りの新しいプロジェクトを作る。既定のテンプレートは `react-vite`。使ったテンプレートの名前を `.bugyo/config.json` の `template` に残す。`<dir>` が空でなければ断り、存在しないテンプレート名は使える名前の一覧を出して断る。最後に出す次の手順は、実行したパッケージマネージャーに合わせる |
| `bugyo new feature <id>` | feature を一式作る。何を作るかは `.bugyo/config.json` の `template` で決まる（ないときは `react-vite`）。同じ名前のファイルがあれば上書きせずに断る。雛形のないテンプレートでは理由を出して断り、何も作らない |
| `bugyo verify <id>` | その機能の spec を実行し、合否と証拠の場所だけを出す |
| `bugyo verify --all` | feature map にあるすべての機能を確かめる |
| `bugyo doctor [--dirs <a,b>] [--tsconfig <path>] [--json]` | 何も書き換えずに、禁止ごとの違反の件数を出す。ESLint の抑制ファイルで隠れている違反も数える |
| `bugyo baseline save [--dirs <a,b>]` | 今の違反をすべてベースラインにする（`eslint-suppressions.json`・`.dependency-cruiser-known-violations.json`・`.bugyo/baseline.json`） |
| `bugyo baseline check [--dirs <a,b>]` | 禁止ごとの件数がベースラインと同じか確かめる。増えても減っても落ちる。`.bugyo/baseline.json` がなければ何もしない |
| `bugyo baseline diff --base <ref>` | ベースラインの3つのファイルが `<ref>` より増えていれば落ちる。CI 用 |

タスク台帳と門番のコマンド（`bugyo task`・`bugyo mistake`・`bugyo gate`）は [tasks.md](tasks.md) に、ベースラインの使い方は [adopt.md](adopt.md#lint-を段階的に入れる) にあります。

`new feature <id>` が作るものは次のとおりです。どちらも `docs/features/<id>.md` を雛形のまま作り、README の順番に1行足します。

| `react-vite` | `node-lib` |
| --- | --- |
| `src/features/<id>/model/<id>.ts` と、そのテスト（Vitest と fast-check） | `src/features/<id>/model/<id>.ts` と、そのテスト（`node:test`） |
| `src/features/<id>/api/use<Id>Query.ts` | — |
| `src/features/<id>/ui/<Id>View.tsx` | — |
| `src/features/<id>/index.ts` | `src/features/<id>/index.ts` |
| `public/api/<id>.json`（サンプルデータ） | — |
| `e2e/<id>.spec.ts` | `checks/<id>.ts`（`featureMap.specDir` と `specSuffix` に従う） |

`react-vite` では、作ったあとに画面への組み込みが残ります（組み込むまで knip が「未使用」として止めます）。`node-lib` では、作った直後から check・test・verify が通り、振る舞いの書き換えと feature map の記入が残ります。

`verify` は次のように動きます。どちらの実行方法でも同じです。

- 実行のたびに、`artifacts/` の中で verify が書くもの（`verify.json`・`results.json`・`report`・`test-results`・`verify`、確かめ方ごとのフォルダ）だけを消してから始める。ほかのファイルには触らない
- 機能ごとに `PASS` / `FAIL` を1行で出し、次の行に証拠の場所を出す。失敗したときだけ、出力の末尾30行を付ける
- 終了コードは、すべて通れば 0、1つでも落ちれば 1、機能名が feature map になければ 2
- 最後に、機能ごとの合否・中で実行したコマンド・証拠の場所の要約を `artifacts/verify.json` に書く（`bugyo task done` が証拠に写す）

実行方法は `.bugyo/config.json` の `verify.runner` で選びます。

| `runner` | 動き | 証拠の場所 |
| --- | --- | --- |
| `playwright`（既定） | 対象の spec をまとめて `playwright test`（`node_modules/.bin` のもの。パッケージマネージャーは通さない）に渡し、JSON レポートから spec ごとの合否を読む | `artifacts/test-results`（動画・スクリーンショット・トレース）、`artifacts/report/index.html` |
| `command` | `verify.command` を spec ごとに1回ずつ実行し、終了コードが 0 なら通ったとする。コマンドの中の `{id}` は機能の id に、`{spec}` は spec のパスに置き換わる | `artifacts/verify/<id>.log`（実行したコマンドと出力。1つの機能で2回以上実行したときは `<id>.1.log`・`<id>.2.log`…） |

どちらもシェルで実行し、`node_modules/.bin` を `PATH` の先頭に足します。pnpm・npm・yarn・bun のどれで入れても動きます（Yarn の PnP のように `node_modules/.bin` を作らない入れ方は対象外です）。

### 機能ごとに確かめ方を変える

確かめ方に名前を付けて `verify.runners` に書くと、機能ごと、spec ごとに使い分けられます。コマンドと環境変数は設定にだけ書き、feature map からは名前で選びます。

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

| 項目 | 意味 |
| --- | --- |
| `runner` | `playwright` か `command`。動き方は上の表と同じ |
| `command` | `runner` が `command` のときのコマンド（必須）。`{id}` と `{spec}` が置き換わる |
| `env` | そのときだけ足す環境変数 |
| `match` | この確かめ方で動かす spec の glob（1つか配列） |
| `evidence` | `runner` が `command` のとき、実行が書くはずの証拠のファイルの glob の配列。`{id}` と `{spec}` が置き換わる（下の「証拠のファイル」） |
| `requires` | `"sandbox"` なら、`verify.sandbox` のコマンドが通るときだけ動かす（下の「隔離環境でだけ動かす」） |

- frontmatter の `spec` には、確かめるファイルを `,` で区切っていくつも書けます。spec のパスに使えるのは英数字と `. _ @ + / -` だけです
- spec ごとの確かめ方は、frontmatter の `runner`（その機能のすべての spec に使う）、`match` に当たる確かめ方、`verify.runner` の順に決まります。知らない名前、2つの `match` に当たる spec は、動かす前に断ります（終了コード 2。`pnpm test` の feature map の検査でも出ます）
- Playwright は確かめ方ごとに1回実行します。`verify.runner` の確かめ方の証拠は今までの場所に、ほかの確かめ方の証拠は `artifacts/<名前>/` の下（`test-results`・`report`・`results.json`）に置きます
- 機能は、そのすべての spec が通ったときに `PASS` です。`artifacts/verify.json` には、spec ごとの確かめ方と合否（`runs`）も書きます
- `playwright`・`command`・`report`・`test-results`・`verify` は名前に使えません

#### 証拠のファイル

`command` の確かめ方は、終了コードしか見ません。スクリーンショットなど、実行が残すはずのファイルがあるなら、`evidence` に glob で書きます。

```json
{ "runners": { "desktop": { "runner": "command", "command": "node scripts/shoot.js {id}", "evidence": ["artifacts/screens/{id}/*.png"] } } }
```

- 実行が始まってから書かれた、glob に当たるファイルが1つもなければ、終了コードが 0 でも `FAIL` です。前の実行で残ったファイルは数えません（ファイルの時刻で見ます。時刻の粗いファイルシステムのぶん、始まる2秒前までは数えます）
- 見つかったファイルは、パスと中身のハッシュ（sha256）を `artifacts/verify.json` の機能ごとの `files` に書き、`evidence:`（`ja` では `証拠:`）の行にも出します。`bugyo task done` の証拠には `verify.json` がそのまま入るので、ハッシュも残ります
- glob に当たるファイルを verify が消すことはありません
- Playwright の確かめ方には書けません（証拠を決まった場所に残すため）

#### 隔離環境でだけ動かす

実際のファイルや外のサービスに触る確かめ方は、隔離環境（コンテナや使い捨ての VM など）でだけ動かせます。隔離環境かどうかを確かめるコマンドを `verify.sandbox` に書き、確かめ方に `"requires": "sandbox"` を付けます。

```json
{
  "verify": {
    "sandbox": "node scripts/in-sandbox.js",
    "runners": { "desktop": { "runner": "command", "command": "node scripts/shoot.js {id}", "requires": "sandbox" } }
  }
}
```

- `requires: "sandbox"` の確かめ方を動かす前に、`verify.sandbox` を1回だけ実行します。終了コードが 0 でなければ、その確かめ方は動かさずに `FAIL` にします（飛ばして通すことはしません）。`bugyo task done` も通りません
- どれを隔離環境で動かすかは設定にだけ書けます。feature map の frontmatter では変えられません
- `requires: "sandbox"` があるのに `verify.sandbox` がなければ、設定を読むときに断ります

## 設定ファイル（`.bugyo/config.json`）

確かめ方と場所の設定は、プロジェクトのルートの `.bugyo/config.json` の1つにまとめます。ファイルがなければ、すべて既定値で動きます。知らないキーがあると、どのコマンドも断ります。

```json
{
  "verify": { "runner": "command", "command": "node {spec}" },
  "featureMap": { "specDir": "checks", "specSuffix": ".ts", "featuresDir": "src/features" }
}
```

| キー | 既定 | 意味 |
| --- | --- | --- |
| `packageManager` | 自動で決める | `pnpm`・`npm`・`yarn`・`bun` のどれか。書かなければ、`package.json` の `packageManager`、lockfile（`pnpm-lock.yaml`・`package-lock.json`・`yarn.lock`・`bun.lock`）の順に、プロジェクトのフォルダから上へ探して決める（git のルートより上は見ない）。見つからなければ `pnpm`。`commands` を書かないときの既定のコマンドがこれで決まる |
| `sarif` | なし | `bugyo doctor` と `bugyo baseline` で一緒に数える、外の lint の結果。`[{ command?, file }]`（[外の lint の結果も数える](adopt.md#外の-lint-の結果も数える)） |
| `locale` | `en` | 禁止のメッセージと CLI の出力の言語。`en` か `ja`。環境変数 `BUGYO_LOCALE` と `bugyo({ locale })` のほうが先（[メッセージの言語](#メッセージの言語)） |
| `verify.runner` | `playwright` | 既定の確かめ方。`playwright`・`command` か `verify.runners` の名前（上の「CLI」） |
| `verify.command` | なし | `command` で動かすときは必須 |
| `verify.runners` | なし | 名前を付けた確かめ方（上の「機能ごとに確かめ方を変える」） |
| `verify.sandbox` | なし | 隔離環境かどうかを確かめるコマンド。`requires: "sandbox"` の確かめ方の前に実行する（上の「隔離環境でだけ動かす」） |
| `sources` | なし | ソースごとの `src`・`layers`・`tsconfig`。`layers` とは一緒に書けない（上の「ソースをいくつも置く」） |
| `featureMap.specDir` | `e2e` | 対応漏れを探す spec のフォルダ。`null` で検査を飛ばす |
| `featureMap.specSuffix` | `.spec.ts` | spec とみなすファイル名の末尾 |
| `featureMap.featuresDir` | `layers.features`、なければ `src/features` | 機能のフォルダを並べる場所。`null` で検査を飛ばす |
| `layers` | なし | 層のフォルダの場所（`app`・`features`・`shared` の `ui`・`api`・`lib`・`model`・`other`）と、feature の中のフォルダ名（`featureParts`）。上の「層のフォルダ名を変える」 |
| `pullRequests.allowBranches` | `[]` | `bugyo task pr-check` がタスクなしで通すブランチの glob（[tasks.md](tasks.md#設定)） |

同じファイルの `commands`・`evidence`・`gate` は、タスク台帳と門番の設定です（[tasks.md](tasks.md#設定)）。このファイルを変えるのは人だけです。

## プロジェクトに置くスクリプト

見本はどちらも次の3つを使います。

| スクリプト | `react-vite`（[examples/todo-app](../examples/todo-app)） | `node-lib`（[examples/node-lib](../examples/node-lib)） | いつ通すか |
| --- | --- | --- | --- |
| `pnpm check` | `tsc --noEmit && eslint . && depcruise src && knip && bugyo task lint` | 同じ | 変更のたび |
| `pnpm test` | `vitest run`（ユニットテストと feature map の整合） | `node --test "src/**/*.test.ts" "test/**/*.test.ts"`（ユニットテストと feature map の整合） | 変更のたび |
| `pnpm verify <id>` | `bugyo verify <id>`（Playwright） | `bugyo verify <id>`（`node checks/<id>.ts`） | 完了を名乗る前 |

`node-lib` の `.bugyo/config.json` は、`verify` を `command` 方式（`node {spec}`）にし、spec のフォルダを `checks`、`evidence.tree` を `src`・`checks`・`test` にしています。lint は `parts: [common, structure, noComments, fetchOnlyInApi]` と `explicitExtensions: true`、dependency-cruiser は `config()` です。`@bugyo/lint-react` は依存に入れません。`react-vite` は `parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers]` と `config({ react: true })` です。

`pnpm check` が通るだけでは完了ではありません。変更の種類ごとに必要な証拠は、見本の [docs/architecture.md](../examples/todo-app/docs/architecture.md) にあります。

## Claude Code プラグイン

進め方の助言は [plugin](../plugin/README.ja.md) のスキルが受け持ちます。必ず守らせたいことはスキルに書かず、上の lint・テスト・検証で止めます。スキルは呼ばれないことがあるからです。
