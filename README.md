<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="bugyo" width="320">
  </picture>
</p>

<h3 align="center">AI エージェントのための lint と検証ツール。</h3>

<p align="center">
  日本語 ・ <a href="README.en.md">English</a>
</p>

<p align="center">
  <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-f0314f?style=flat-square">
  <img alt="node 24 以上" src="https://img.shields.io/badge/node-%E2%89%A5%2024-35e0c2?style=flat-square">
  <img alt="TypeScript（雛形: React / Vite と Node）" src="https://img.shields.io/badge/TypeScript-React%20%2F%20Vite%20%7C%20Node-ffd23f?style=flat-square">
</p>

---

**bugyo（奉行）** は、AI エージェントに開発を任せるためのツール群です。
注意書きを増やす代わりに、**間違った書き方は lint で止まり、確かめた結果は証拠として残る**ようにコードベースの側を作ります。

本体（feature map・検証・タスク台帳・門番）は技術を問いません。lint と依存ルールは TypeScript が前提です。雛形は、React（Vite）の画面と、画面のない Node のライブラリ／CLI の2つがあります。

## なぜ要るのか

エージェントに任せると、次の3つが起きます。bugyo はそれぞれを、文章ではなく仕組みで止めます。

| 起きること | bugyo の止め方 |
| --- | --- |
| 置き場所や書き方がばらつき、次のエージェントがそれをまねる | フォルダ構成と lint で、正しい書き方しか通らないようにする |
| 「確かめました」という報告が当てにならない | 検証コマンドが実際に動かし、合否と証拠を残す。タスクを完了にできるのは、check・test・verify を自分で実行して通った `bugyo task done` だけ |
| 同じ種類のミスが繰り返される | 注意書きを足す代わりに、禁止と「代わりに使うもの」を lint のルールとして足す。手直しを種類ごとに記録し、同じ種類が2回起きると、ルールにするまで `bugyo gate` が不合格になる |

## 見てわかる例

**止めるときは、代わりに何を使うかまで言います。** `useEffect` と `fetch` の禁止を入れたプロジェクト（`react-vite` のテンプレートは入れています）でエージェントがそれを書くと、こう返ります。

```
 1:17  error  'useEffect' import from 'react' is restricted. 製品コードでuseEffectは使えません。データ取得は features/*/api の useXxxQuery、購読やタイマーは src/shared/lib の専用フックを使ってください。該当するフックがなければ src/shared/lib に追加してください。  no-restricted-imports
10:3   error  Unexpected use of 'fetch'. fetchを直接呼ばないでください。src/shared/api のクライアントを使い、スキーマで応答を検証してください。  no-restricted-globals
```

（テスト用の違反ファイル `packages/lint-react/test/fixture/src/features/a/ui/Bad.tsx` に対する出力から2件を抜き出したものです）

**確かめた結果は、合否と証拠の場所だけを返します。** 長いログでエージェントの文脈を埋めません。

```
$ pnpm verify todos
PASS todos  確認手順: docs/features/todos.md
証拠: artifacts/test-results（動画・スクリーンショット・トレース）, artifacts/report/index.html
```

## できること

- **構成** — `src/app`、`src/features/<id>/{ui,api,model,index.ts}`、`src/shared/{ui,lib,api}`。feature は `index.ts` からだけ使える。画面のない `node-lib` では、feature は `model/` と `index.ts` だけ
- **lint** — 部品と禁止を選んで組み合わせる。部品は共通（`any`、型アサーション、理由のない `eslint-disable` を止める）と構成（feature の境界、`model/` は純粋関数だけ）で、禁止はコメント・`fetch` は `shared/api` だけ・`useEffect` は `shared/lib` だけ・UI でのタイマー、のように1つずつ入れる。独自の禁止も `defineBan` で同じ形に書ける。React 用の部品と禁止は別のパッケージ `@bugyo/lint-react` にあり、React を使わないプロジェクトは `@bugyo/lint` だけを入れる
- **依存ルール** — 循環依存、他の feature の内部への依存、`shared` から上の層への依存を止める
- **feature map** — 機能ごとに `docs/features/<id>.md` を1つ置き、「何があるか・どう辿り着くか・どう操作して確かめるか・よく嘘をつくところ」を書く。機能・spec・地図の対応漏れはテストが落とす
- **検証** — `bugyo verify <id>` がその機能を実際に動かし、合否と証拠を毎回残す。既定は Playwright（動画・スクリーンショット・トレース）。`.bugyo/config.json` で、機能ごとに任意のコマンドを実行する方式にもできる
- **タスク台帳と門番** — 仕事を `.bugyo/tasks/<id>.md` に1件1ファイルで残す。`bugyo task done` が種類ごとに必要な証拠を自分で取り、通ったときだけ閉じる。手で完了に書き換えたタスクは `pnpm check` の `bugyo task lint` が落とす。`bugyo gate` が、手直しの少なさ・1回で通った件数・ミスの再発から、任せる範囲を広げてよいかを計算する
- **雛形** — `bugyo init --template <名前>` と `bugyo new feature` が、上の決まりに沿った形でプロジェクトと機能を作る
- **段階的な導入** — `bugyo doctor` が入れる前に禁止ごとの違反を数え、`bugyo baseline save` が今の違反をベースラインにする。`bugyo baseline check` は禁止ごとの件数が増えても減っても落ちるので、ベースラインは減る方向にだけ動く

くわしくは [docs/foundation.md](docs/foundation.md) と [docs/tasks.md](docs/tasks.md) にあります。

## 入っているもの

| 場所 | 中身 |
| --- | --- |
| [packages/lint](packages/lint) — `@bugyo/lint` | ESLint flat config（共通と構成の部品、コメントと `fetch` の禁止、独自の禁止を作る `defineBan`）、dependency-cruiser のルール、厳しい tsconfig。React に依存しない |
| [packages/lint-react](packages/lint-react) — `@bugyo/lint-react` | `@bugyo/lint` に足す React 用の部品（react-hooks）と禁止（`useEffect` の置き場所、UI でのタイマー） |
| [packages/bugyo](packages/bugyo) — `bugyo` | CLI（`init` / `new feature` / `verify` / `task` / `mistake` / `gate`）、feature map の読み込みと整合テスト、Playwright 設定 |
| [plugin](plugin) | Claude Code プラグイン（スキル5つとレビュー用サブエージェント） |
| [examples/todo-app](examples/todo-app) | React（Vite）の見本。`bugyo init --template react-vite`（既定）のテンプレートの元 |
| [examples/node-lib](examples/node-lib) | 画面のない TypeScript のライブラリ／CLI の見本。React・Vite・Playwright を使わない。`bugyo init --template node-lib` のテンプレートの元 |

## 始め方

npm には公開していないので、このリポジトリから作ります。Node 24 以上と pnpm 11 が必要です。

```bash
pnpm install
```

```bash
pnpm --filter bugyo pack && pnpm --filter @bugyo/lint pack && pnpm --filter @bugyo/lint-react pack
```

テンプレートを選んでプロジェクトを作ります。省略すると `react-vite` です。

| テンプレート | 中身 | verify |
| --- | --- | --- |
| `react-vite` | React + Vite の画面。lint は共通・構成・React（`@bugyo/lint-react`）の部品と、コメント・`fetch`・`useEffect`・UI のタイマーの禁止 | Playwright で画面を操作し、動画・スクリーンショット・トレースを残す |
| `node-lib` | 画面のない TypeScript のライブラリ／CLI。Node の型除去で `.ts` をそのまま動かす。lint は共通と構成の部品と、コメント・`fetch` の禁止だけで、`@bugyo/lint-react` は入らない | 機能ごとの確かめるスクリプトを `node` で実行し、出力を残す |

```bash
node packages/bugyo/bin/bugyo.js init ../my-app --template node-lib
```

できた `my-app/package.json` の `bugyo`・`@bugyo/lint`（`react-vite` なら `@bugyo/lint-react` も）を、上で作った tarball への `file:` パスに書き換えてから、次を実行します（`react-vite` のときは、続けて `pnpm exec playwright install chromium` も実行します）。

```bash
cd ../my-app && pnpm install
```

```bash
pnpm check && pnpm test && pnpm verify --all
```

機能を足すときは `pnpm exec bugyo new feature <id>` を使います。作るものはテンプレートに合わせて変わります。既存のプロジェクトに入れる方法は [docs/adopt.md](docs/adopt.md)、すべての設定項目は [docs/foundation.md](docs/foundation.md) にあります。

## このリポジトリでの開発

```bash
pnpm install
```

```bash
pnpm check && pnpm test && pnpm verify
```

```bash
pnpm validate-plugin
```

- `packages/lint` と `packages/lint-react` のテストは、わざと違反したファイル（`.ts` だけの `packages/lint/test/fixture-node`、React の `packages/lint-react/test/fixture`）に対して各ルールがエラーを出すことを確かめます
- `packages/bugyo` のテストは、両方のテンプレートでの `new feature` と `init` の生成物と、React も Playwright も使わないフィクスチャ（`test/fixtures/plain`）での `verify` とタスク台帳の動き（断られるべきものが断られること）を確かめます
- TypeScript は 6.0 系に固定しています

## ライセンス

[MIT](LICENSE)
