# 土台（実装済み）

状態: 実装済み。このページの内容はすべて今のコードで動きます。

土台は、エージェントが間違った書き方を選べないようにする層です。フォルダ構成、lint、依存ルール、検証の4つでできています。

feature map と `bugyo verify` は技術を問いません。確かめ方は `.bugyo/config.json` で決めます（下の「設定ファイル」）。lint と依存ルールは TypeScript が前提です。React 用の禁止は別のパッケージ `@bugyo/lint-react` に分かれていて、React を使うプロジェクトだけが入れます（下の「部品」）。

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
    lib/                    useEffect を書いてよい唯一の場所
    api/                    fetch を呼んでよい唯一の場所
docs/features/<id>.md       feature map（機能ごとの確かめ方）
e2e/<id>.spec.ts            その機能を実際に操作するテスト
```

依存の向きは `app → features → shared`、feature の中では `ui → api → model` です。

`node-lib` では画面がないので、feature は `model/` と `index.ts` だけです。`src/app` はコマンドの入口、`src/index.ts` はライブラリとして公開するもの、`checks/<id>.ts` はその機能を実際に動かして確かめるスクリプト（feature map の `spec`）です。

## `@bugyo/lint`

### ESLint

ESLint は 9.24 以上（10 を含む）、TypeScript は 5.8 以上 6.0 まで、flat config が前提です。`@eslint/js` は peer 依存なので、使う ESLint と同じ大きな版（9 なら 9、10 なら 10）をプロジェクトに入れます。CI は ESLint 9.24・TypeScript 5.8 の組み合わせでも lint のテストを回しています。

```js
// eslint.config.js（React を使うプロジェクト）
import { bugyo, common, structure } from '@bugyo/lint';
import { react } from '@bugyo/lint-react';

export default bugyo({ root: import.meta.dirname, parts: [common, structure, react] });
```

| 項目 | 既定 | 意味 |
| --- | --- | --- |
| `root` | 必須 | `import.meta.dirname` を渡す |
| `src` | `src` | ソースの場所。`layers` のフォルダはすべてこの中に置く |
| `layers` | `<src>/app`・`<src>/features`・`<src>/shared/{ui,api,lib}` | 層のフォルダの場所（下の「層のフォルダ名を変える」） |
| `effectHooksDir` | `layers.shared.lib` | `useEffect` を書いてよい場所 |
| `apiClientDir` | `layers.shared.api` | `fetch` を呼んでよい場所 |
| `ignores` | `[]` | lint から外すパス（`dist`、`artifacts`、`node_modules` などは最初から外れている） |
| `severity` | `{}` | 禁止を warn に下げる（下の「禁止を warn に下げる」） |
| `extra` | `{}` | 独自の禁止を足す（下の「独自の禁止を足す」） |
| `parts` | `[common, structure]` | 使う部品（下の「部品」）。`common` は必須 |
| `explicitExtensions` | `false` | import に拡張子を書くプロジェクト（Node の型除去で `.ts` を直接動かすなど）で `true` にする。`features/<id>/index.ts` をファイル名つきで import できるようになる |

#### 部品

設定は部品の組み合わせです。`common` と `structure` は `@bugyo/lint` に、`react` は `@bugyo/lint-react` にあります。React を使わないプロジェクトは `@bugyo/lint-react` を入れず、`common` と `structure` だけを使います（`parts` を省いたときと同じ）。同じ範囲の禁止（`no-restricted-imports` など）は、部品をまたいで1つのルールに合成されます。部品の順番は結果に影響しません。

```js
// eslint.config.js（React を使わないプロジェクト）
import { bugyo } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname, explicitExtensions: true });
```

| 部品 | 範囲 | 止めるもの |
| --- | --- | --- |
| `common` | すべてのファイル | `any`、型アサーション（`as`）、非 null アサーション（`!`）、待っていない Promise、`switch` の分岐漏れ、理由のない `eslint-disable`、対象を絞らない `eslint-disable`。加えて typescript-eslint の `strictTypeChecked` |
| `common` | `src` の下 | コメント。`extra` で足した禁止 |
| `structure` | `src` の下 | 他の feature の内部ファイルの import、`shared` から `features` / `app` への依存、`features` から `app` への依存、`fetch` |
| `structure` | `src/features/*/model` | 同じ feature の `ui` と `api`、`shared/ui`、`shared/api` |
| `react`（`@bugyo/lint-react`） | `src` の下 | `react` からの `useEffect` / `useLayoutEffect` の import と `React.useEffect` の形。加えて react-hooks の推奨ルール |
| `react` | `src/features/*/ui` | `setTimeout`、`setInterval`、`requestAnimationFrame` |
| `react` | `src/features/*/model` | `react`、`react-dom`、`@tanstack/*` |

エラー文には、代わりに何を使うかが入っています。他の feature の内部ファイルの import は、パスに `features/` を含む書き方（`@/features/<id>/...` や `../features/<id>/...`）を ESLint が止め、相対パスで feature の間をまたぐ書き方も含めて dependency-cruiser が止めます。

場所による例外は次の3つだけです。

| 場所 | 許されること | 例外を持つ部品 |
| --- | --- | --- |
| `effectHooksDir` | `useEffect` / `useLayoutEffect`、`extra` の `restrictedProperties` / `restrictedSyntax` | `common`・`react` |
| `apiClientDir` | `fetch` | `structure` |
| `src` の下の `*.test.ts(x)` | `fetch`、`setTimeout` などのタイマー、`React.useEffect` の形、`extra` の `restrictedProperties` / `restrictedSyntax` | `common`・`structure`・`react` |

コメントは、公開 API の JSDoc（`/** */`）と、理由つきの `eslint-disable`（`-- 理由`）だけ書けます。`.js` / `.cjs` / `.mjs` には型を使うルールを当てません。

#### 禁止を warn に下げる

入れたばかりで直しきれない禁止は、`severity` で warn に下げられます。`off` にはできません。

```js
export default bugyo({ root: import.meta.dirname, parts: [common, structure, react], severity: { 'use-effect': 'warn' } });
```

| 名前 | 禁止 | 部品 |
| --- | --- | --- |
| `feature-internals` | 他の feature の内部ファイルの import | `structure` |
| `fetch` | `fetch` | `structure` |
| `model-layers` | `model/` から `ui/`・`api/`・`shared/ui`・`shared/api` への import | `structure` |
| `use-effect` | `useEffect` / `useLayoutEffect` | `react` |
| `ui-timers` | feature の UI での `setTimeout` などのタイマー | `react` |
| `model-react` | `model/` から React とその周辺への import | `react` |

- 名前のほかに、設定にあるルール ID（例: `@typescript-eslint/no-non-null-assertion`）も渡せます。そのルールがどのファイルでも warn になります
- 名前で下げた禁止は、同じルールの他の禁止と分けるために、ルール ID が `bugyo-warn/<元のルール>`（例: `bugyo-warn/no-restricted-imports`）になります。`eslint-disable` のコメントで止めるときも、この ID を書きます
- 知らない名前と、組み合わせた部品にない禁止の名前は断ります
- `bugyo doctor` は、warn に下げた禁止を「直す借り」として別に数えます。`bugyo baseline check` は warn に下げた禁止も数えるので、下げても件数は増やせません
- ESLint の抑制ファイルに入っている禁止を下げると、抑制が使われなくなって `eslint .` が落ちます（抑制は error だけに効くため）。下げたら `bugyo baseline save` を実行し直します

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
import { bugyo } from '@bugyo/lint';

const { layers } = JSON.parse(readFileSync(new URL('./.bugyo/config.json', import.meta.url), 'utf8'));
export default bugyo({ root: import.meta.dirname, src: 'web', layers });
```

```js
// .dependency-cruiser.cjs
const { layers } = require('./.bugyo/config.json');
module.exports = require('@bugyo/lint/depcruise').config({ src: 'web', layers });
```

`layers` を渡すと、境界の判定は import の別名（`@/` など）に頼らず、解決したパスで行います（`~/app/ui/x` と `../../app/ui/x` のどちらで書いても同じに止まる）。他の feature の内部ファイルの import は、パスに `features` のフォルダ名（例では `features`）を含む書き方を ESLint が止めます。`.bugyo/config.json` の `layers` には5つの場所をすべて書きます。これを書いたプロジェクトでは、`featureMap.featuresDir` の既定が `layers.features` になり、`bugyo new feature` は雛形を作らずに断ります（雛形は `src/features` の形でしか作れないため）。`bugyo doctor` は、`layers` をまとめたフォルダ（例では `web`）の中で、どの層にも入っていないファイルを出します。

### 独自の禁止を足す

`no-restricted-imports` などを自分の設定ブロックで書くと、bugyo の禁止が上書きされて消えます。足すときは `extra` に渡してください。bugyo の禁止と合成されます。

```js
export default bugyo({
  root: import.meta.dirname,
  extra: {
    restrictedProperties: [{ object: 'Date', property: 'now', message: 'shared/lib の systemClock を使ってください' }],
    restrictedSyntax: [
      { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'shared/lib の systemClock を使ってください' },
    ],
    restrictedGlobals: [{ name: 'localStorage', message: 'shared/lib の storage を使ってください' }],
  },
});
```

| 項目 | 形 | 効かない場所 |
| --- | --- | --- |
| `restrictedImports` | `{ paths: [{ name, importNames?, message }], patterns: [{ group, message }] }` | なし |
| `restrictedGlobals` | `[{ name, message }]` | なし |
| `restrictedProperties` | `[{ object?, property?, message }]` | `effectHooksDir` とテスト |
| `restrictedSyntax` | `[{ selector, message }]` | `effectHooksDir` とテスト |

`restrictedProperties` と `restrictedSyntax` で禁止したものの「正しい入口」は `effectHooksDir` に作ります（例: `Date.now` を禁止し、`shared/lib/clock.ts` だけで使う）。

### dependency-cruiser

```js
// .dependency-cruiser.cjs（React を使わないなら config()）
module.exports = require('@bugyo/lint/depcruise').config({ react: true });
```

`config({ src, tsConfig, forbidden, react })` を受け取ります。`forbidden` に渡したルールは後ろに足されます。`react: true` にすると、`model-is-pure` は React とその周辺（`react`、`react-dom`、`@tanstack/*`）への依存も止めます（既定は `false`）。

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
| `bugyo init <dir> [--template <名前>]` | 土台入りの新しいプロジェクトを作る。既定のテンプレートは `react-vite`。使ったテンプレートの名前を `.bugyo/config.json` の `template` に残す。`<dir>` が空でなければ断り、存在しないテンプレート名は使える名前の一覧を出して断る |
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

- 実行のたびに `artifacts/` を消してから始める
- 機能ごとに `PASS` / `FAIL` を1行で出し、次の行に証拠の場所を出す。失敗したときだけ、出力の末尾30行を付ける
- 終了コードは、すべて通れば 0、1つでも落ちれば 1、機能名が feature map になければ 2
- 最後に、機能ごとの合否・中で実行したコマンド・証拠の場所の要約を `artifacts/verify.json` に書く（`bugyo task done` が証拠に写す）

実行方法は `.bugyo/config.json` の `verify.runner` で選びます。

| `runner` | 動き | 証拠の場所 |
| --- | --- | --- |
| `playwright`（既定） | 対象の spec をまとめて `playwright test`（`node_modules/.bin` のもの。パッケージマネージャーは通さない）に渡し、JSON レポートから spec ごとの合否を読む | `artifacts/test-results`（動画・スクリーンショット・トレース）、`artifacts/report/index.html` |
| `command` | `verify.command` を機能ごとに1回ずつ実行し、終了コードが 0 なら通ったとする。コマンドの中の `{id}` は機能の id に、`{spec}` は frontmatter の `spec` に置き換わる | `artifacts/verify/<id>.log`（実行したコマンドと出力） |

どちらもシェルで実行し、`node_modules/.bin` を `PATH` の先頭に足します。pnpm・npm・yarn・bun のどれで入れても動きます（Yarn の PnP のように `node_modules/.bin` を作らない入れ方は対象外です）。

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
| `verify.runner` | `playwright` | `playwright` か `command`（上の「CLI」） |
| `verify.command` | なし | `runner` が `command` のときは必須 |
| `featureMap.specDir` | `e2e` | 対応漏れを探す spec のフォルダ。`null` で検査を飛ばす |
| `featureMap.specSuffix` | `.spec.ts` | spec とみなすファイル名の末尾 |
| `featureMap.featuresDir` | `layers.features`、なければ `src/features` | 機能のフォルダを並べる場所。`null` で検査を飛ばす |
| `layers` | なし | 層のフォルダの場所（`app`・`features`・`shared.ui`・`shared.api`・`shared.lib`）。上の「層のフォルダ名を変える」 |

同じファイルの `commands`・`evidence`・`gate` は、タスク台帳と門番の設定です（[tasks.md](tasks.md#設定)）。このファイルを変えるのは人だけです。

## プロジェクトに置くスクリプト

見本はどちらも次の3つを使います。

| スクリプト | `react-vite`（[examples/todo-app](../examples/todo-app)） | `node-lib`（[examples/node-lib](../examples/node-lib)） | いつ通すか |
| --- | --- | --- | --- |
| `pnpm check` | `tsc --noEmit && eslint . && depcruise src && knip && bugyo task lint` | 同じ | 変更のたび |
| `pnpm test` | `vitest run`（ユニットテストと feature map の整合） | `node --test "src/**/*.test.ts" "test/**/*.test.ts"`（ユニットテストと feature map の整合） | 変更のたび |
| `pnpm verify <id>` | `bugyo verify <id>`（Playwright） | `bugyo verify <id>`（`node checks/<id>.ts`） | 完了を名乗る前 |

`node-lib` の `.bugyo/config.json` は、`verify` を `command` 方式（`node {spec}`）にし、spec のフォルダを `checks`、`evidence.tree` を `src`・`checks`・`test` にしています。lint は `parts` を省いた既定（`common` と `structure`）と `explicitExtensions: true`、dependency-cruiser は `config()` です。`@bugyo/lint-react` は依存に入れません。`react-vite` は `parts: [common, structure, react]` と `config({ react: true })` です。

`pnpm check` が通るだけでは完了ではありません。変更の種類ごとに必要な証拠は、見本の [docs/土台設計.md](../examples/todo-app/docs/土台設計.md) にあります。

## Claude Code プラグイン

進め方の助言は [plugin](../plugin) のスキルが受け持ちます。必ず守らせたいことはスキルに書かず、上の lint・テスト・検証で止めます。スキルは呼ばれないことがあるからです。
