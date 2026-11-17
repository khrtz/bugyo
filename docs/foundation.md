# 土台（実装済み）

状態: 実装済み。このページの内容はすべて今のコードで動きます。

土台は、エージェントが間違った書き方を選べないようにする層です。フォルダ構成、lint、依存ルール、検証の4つでできています。前提は pnpm、Vite、React、TypeScript、そして `@/` を `src/` に向けたパスの別名です。

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

## `@bugyo/lint`

### ESLint

```js
// eslint.config.js
import { bugyo } from '@bugyo/lint';

export default bugyo({ root: import.meta.dirname });
```

| 項目 | 既定 | 意味 |
| --- | --- | --- |
| `root` | 必須 | `import.meta.dirname` を渡す |
| `src` | `src` | ソースの場所 |
| `effectHooksDir` | `<src>/shared/lib` | `useEffect` を書いてよい場所 |
| `apiClientDir` | `<src>/shared/api` | `fetch` を呼んでよい場所 |
| `ignores` | `[]` | lint から外すパス（`dist`、`artifacts`、`node_modules` などは最初から外れている） |
| `extra` | `{}` | 独自の禁止を足す（下の「独自の禁止を足す」） |

どこで何が止まるかは次のとおりです。エラー文には、代わりに何を使うかが入っています。

| 範囲 | 止めるもの |
| --- | --- |
| すべてのファイル | `any`、型アサーション（`as`）、非 null アサーション（`!`）、待っていない Promise、`switch` の分岐漏れ、理由のない `eslint-disable`、対象を絞らない `eslint-disable`。加えて typescript-eslint の `strictTypeChecked` |
| `src` の下 | `react` からの `useEffect` / `useLayoutEffect` の import と `React.useEffect` の形、`fetch`、他の feature の内部ファイルの import、コメント、`shared` から `features` / `app` への依存、`features` から `app` への依存。加えて react-hooks の推奨ルール |
| `src/features/*/ui` | 上に加えて `setTimeout`、`setInterval`、`requestAnimationFrame` |
| `src/features/*/model` | 上に加えて `react`、`react-dom`、`@tanstack/*`、同じ feature の `ui` と `api`、`shared/ui`、`shared/api` |

場所による例外は次の3つだけです。

| 場所 | 許されること |
| --- | --- |
| `effectHooksDir` | `useEffect` / `useLayoutEffect` |
| `apiClientDir` | `fetch` |
| `src` の下の `*.test.ts(x)` | `fetch`、`setTimeout` などのタイマー、`React.useEffect` の形 |

コメントは、公開 API の JSDoc（`/** */`）と、理由つきの `eslint-disable`（`-- 理由`）だけ書けます。`.js` / `.cjs` / `.mjs` には型を使うルールを当てません。

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
// .dependency-cruiser.cjs
module.exports = require('@bugyo/lint/depcruise').config();
```

`config({ src, tsConfig, forbidden })` を受け取ります。`forbidden` に渡したルールは後ろに足されます。

| ルール | 止めるもの |
| --- | --- |
| `no-circular` | 循環依存 |
| `feature-internals-only-via-index` | 他の feature の `index.ts` 以外への依存 |
| `app-only-via-feature-index` | `app` から feature の `index.ts` 以外への依存 |
| `shared-is-leaf` | `shared` から `features` / `app` への依存 |
| `features-not-to-app` | `features` から `app` への依存 |
| `model-is-pure` | `model` から、自分の `model` と `shared/lib` 以外のソース、`react`、`react-dom`、`@tanstack/*` への依存 |
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

- `id` は小文字・数字・ハイフンで、`src/features/<id>` と同じ名前にします
- `route` は `/` で始めます。`spec` は `e2e/` の下の `*.spec.ts` です
- 4つの見出しは必須です。「よく嘘をつくところ」には、見た目は通るのに壊れていることが起きやすい点を書きます
- `docs/features/README.md` に、全体を確かめるときの順番を `[id](id.md)` の形で並べます

対応漏れはテストで落とします。

```ts
// e2e/feature-map.test.ts
import { registerFeatureMapTests } from 'bugyo/vitest';

registerFeatureMapTests();
```

このテストが確かめることは次の6つです。

1. ファイル名と `id` が一致している
2. すべての機能に4つの見出しがある
3. すべての機能の `spec` が実在する
4. `e2e/` のすべての `*.spec.ts` が、どれかの機能に対応している
5. `src/features` のすべてのフォルダが feature map に載っている
6. README の順番に、すべての機能がちょうど1回ずつ載っている

`registerFeatureMapTests({ cwd, src })` で場所を変えられます。コードから読むときは `loadFeatures(cwd)` と `loadSweepOrder(cwd)` を使います。

## 検証（Playwright）

```ts
// playwright.config.ts
import { defineBugyoConfig } from 'bugyo/playwright';

export default defineBugyoConfig({ port: 5173 });
```

| 項目 | 既定 | 意味 |
| --- | --- | --- |
| `port` | `5173` | dev サーバーのポート |
| `command` | `pnpm exec vite --port <port> --strictPort` | dev サーバーを起動するコマンド |
| `overrides` | なし | Playwright の設定を上書きする |

この設定は次のように動きます。

- `e2e/**/*.spec.ts` を Chromium で実行する。dev サーバーの起動と停止は Playwright に任せる
- すべてのテストで動画・スクリーンショット・トレースを取り、`artifacts/test-results` に置く
- スクリーンショットの基準画像は `e2e/__screenshots__/<OS>/` に OS ごとに分けて置く
- 基準画像がないとき、手元では新しく作り、CI（環境変数 `CI` があるとき）では失敗にする

## CLI

| コマンド | すること |
| --- | --- |
| `bugyo init <dir>` | 土台入りの新しいプロジェクトを作る。`<dir>` が空でなければ断る |
| `bugyo new feature <id>` | feature を一式作る。同じ名前のファイルがあれば上書きせずに断る |
| `bugyo verify <id>` | その機能の spec を実行し、合否と証拠の場所だけを出す |
| `bugyo verify --all` | feature map にあるすべての機能を確かめる |

`new feature <id>` が作るものは次のとおりです。作ったあと、画面への組み込みと feature map の記入が残ります（組み込むまで knip が「未使用」として止めます）。

- `src/features/<id>/model/<id>.ts` と、そのテスト
- `src/features/<id>/api/use<Id>Query.ts`
- `src/features/<id>/ui/<Id>View.tsx`
- `src/features/<id>/index.ts`
- `public/api/<id>.json`（サンプルデータ）
- `e2e/<id>.spec.ts`
- `docs/features/<id>.md`（README の順番にも1行足す）

`verify` は次のように動きます。

- 実行のたびに `artifacts/` を消してから始める
- 機能ごとに `PASS` / `FAIL` を1行で出す。失敗したときだけ、出力の末尾30行を付ける
- 証拠は `artifacts/test-results`（動画・スクリーンショット・トレース）と `artifacts/report/index.html` に残る
- 終了コードは、すべて通れば 0、1つでも落ちれば 1、機能名が feature map になければ 2
- 内部で `pnpm exec playwright test` を呼ぶ

## プロジェクトに置くスクリプト

見本（[examples/todo-app](../examples/todo-app)）は次の3つを使います。

| スクリプト | 中身 | いつ通すか |
| --- | --- | --- |
| `pnpm check` | `tsc --noEmit && eslint . && depcruise src && knip` | 変更のたび |
| `pnpm test` | `vitest run`（ユニットテストと feature map の整合） | 変更のたび |
| `pnpm verify <id>` | `bugyo verify <id>` | 完了を名乗る前 |

`pnpm check` が通るだけでは完了ではありません。変更の種類ごとに必要な証拠は、見本の [docs/土台設計.md](../examples/todo-app/docs/土台設計.md) にあります。

## Claude Code プラグイン

進め方の助言は [plugin](../plugin) のスキルが受け持ちます。必ず守らせたいことはスキルに書かず、上の lint・テスト・検証で止めます。スキルは呼ばれないことがあるからです。
