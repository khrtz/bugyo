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
  <img alt="状態: 開発初期" src="https://img.shields.io/badge/status-early-8b7cf6?style=flat-square">
</p>

---

**bugyo（奉行）** は、AI エージェントに開発を任せるためのツール群です。
注意書きを増やす代わりに、**間違った書き方は通らず、証拠のない完了は認められない**ようにコードベースの側を作ります。

本体（feature map・検証・タスク台帳・門番）は技術を問いません。lint と依存ルールは TypeScript が前提です。雛形は、React（Vite）の画面と、画面のない Node のライブラリ／CLI の2つがあります。

## なぜ要るのか

エージェントに任せると、次の3つが起きます。bugyo はそれぞれを、文章ではなく仕組みで止めます。

| 起きること | bugyo の止め方 |
| --- | --- |
| 置き場所や書き方がばらつき、次のエージェントがそれをまねる | フォルダ構成と lint で、正しい書き方しか通らないようにする |
| 「確かめました」という報告が当てにならない | 完了を決めるのは報告ではなく、コマンドが自分で取った証拠にする |
| 同じ種類のミスが繰り返される | ミスを種類ごとに記録し、2回目でルールに変えるまで先へ進めない |

## 見てわかる例

**止めるときは、代わりに何を使うかまで言います。** エージェントが `useEffect` と `fetch` を書くと、こう返ります。

```
 1:17  error  'useEffect' import from 'react' is restricted. 製品コードでuseEffectは使えません。データ取得は features/*/api の useXxxQuery、購読やタイマーは src/shared/lib の専用フックを使ってください。該当するフックがなければ src/shared/lib に追加してください。  no-restricted-imports
10:3   error  Unexpected use of 'fetch'. fetchを直接呼ばないでください。src/shared/api のクライアントを使い、スキーマで応答を検証してください。  no-restricted-globals
```

（テスト用の違反ファイル `packages/lint/test/fixture/src/features/a/ui/Bad.tsx` に対する出力から2件を抜き出したものです）

**確かめた結果は、合否と証拠の場所だけを返します。** 長いログでエージェントの文脈を埋めません。

```
$ pnpm verify todos
PASS todos  確認手順: docs/features/todos.md
証拠: artifacts/test-results（動画・スクリーンショット・トレース）, artifacts/report/index.html
```

## 3つの層と、今できていること

下から順に作ります。**今動くのは層1と層2です。** 層3は設計が済んだ段階で、コマンドはまだありません。

| 層 | すること | 状態 | 文書 |
| --- | --- | --- | --- |
| **1. 土台** | 構造・lint・依存ルール・検証で、書き方と確かめ方を強制する | 実装済み | [docs/foundation.md](docs/foundation.md) |
| **2. タスク台帳と門番** | 仕事を1件1ファイルで残し、証拠が通らないと閉じられないようにする | 実装済み（CI とフックは未実装） | [docs/tasks.md](docs/tasks.md) |
| **3. 常駐エージェント** | 担当を持つエージェントが見回り、仕事を任せ、結果を人に持ってくる | 設計のみ | [docs/agents.md](docs/agents.md) |

「証拠なしに完了を名乗れない」は、層2の `bugyo task done` が受け持ちます。完了にできるのはこのコマンドだけで、自分で check・test・verify を実行し、通ったときだけ証拠ファイルを書いて閉じます。手で完了に書き換えたタスクは `pnpm check` の `bugyo task lint` が落とします。作る順番と各段階の完了条件は [docs/roadmap.md](docs/roadmap.md) にあります。

## 入っているもの

| 場所 | 中身 |
| --- | --- |
| [packages/lint](packages/lint) — `@bugyo/lint` | ESLint flat config（共通・構成・React の3つの部品を組み合わせる）、dependency-cruiser のルール、厳しい tsconfig、コメント禁止ルール |
| [packages/bugyo](packages/bugyo) — `bugyo` | CLI（`init` / `new feature` / `verify` / `task` / `mistake` / `gate`）、feature map の読み込みと整合テスト、Playwright 設定 |
| [plugin](plugin) | Claude Code プラグイン（スキル5つとレビュー用サブエージェント） |
| [examples/todo-app](examples/todo-app) | React（Vite）の見本。`bugyo init --template react-vite`（既定）のテンプレートの元 |
| [examples/node-lib](examples/node-lib) | 画面のない TypeScript のライブラリ／CLI の見本。React・Vite・Playwright を使わない。`bugyo init --template node-lib` のテンプレートの元 |

## 始め方

npm にはまだ公開していないので、このリポジトリから作ります。Node 24 以上と pnpm 11 が必要です。

```bash
pnpm install
```

```bash
pnpm --filter bugyo pack && pnpm --filter @bugyo/lint pack
```

テンプレートを選んでプロジェクトを作ります。省略すると `react-vite` です。

| テンプレート | 中身 | verify |
| --- | --- | --- |
| `react-vite` | React + Vite の画面。lint は3つの部品すべて | Playwright で画面を操作し、動画・スクリーンショット・トレースを残す |
| `node-lib` | 画面のない TypeScript のライブラリ／CLI。Node の型除去で `.ts` をそのまま動かす。lint は共通と構成の部品 | 機能ごとの確かめるスクリプトを `node` で実行し、出力を残す |

```bash
node packages/bugyo/bin/bugyo.js init ../my-app --template node-lib
```

できた `my-app/package.json` の `bugyo` と `@bugyo/lint` を、上で作った tarball への `file:` パスに書き換えてから、次を実行します（`react-vite` のときは、続けて `pnpm exec playwright install chromium` も実行します）。

```bash
cd ../my-app && pnpm install
```

```bash
pnpm check && pnpm test && pnpm verify --all
```

機能を足すときは `pnpm exec bugyo new feature <id>` を使います。作るものはテンプレートに合わせて変わります。既存のプロジェクトに入れる方法と、すべての設定項目は [docs/foundation.md](docs/foundation.md) にあります。

## 文書

| 文書 | 内容 |
| --- | --- |
| [docs/foundation.md](docs/foundation.md) | 土台のすべて。止めるものの一覧、設定項目、feature map、CLI |
| [docs/tasks.md](docs/tasks.md) | タスク台帳、証拠つきの完了、ミスのルール化、門番 |
| [docs/agents.md](docs/agents.md) | 常駐エージェント、ルール、役、作業セッション（設計） |
| [docs/roadmap.md](docs/roadmap.md) | 作る順番、決まっていないこと、確かめていないこと |

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

- `packages/lint` のテストは、わざと違反したファイル（`test/fixture`）に対して各ルールがエラーを出すことを確かめます
- `packages/bugyo` のテストは、両方のテンプレートでの `new feature` と `init` の生成物と、React も Playwright も使わないフィクスチャ（`test/fixtures/plain`）での `verify` とタスク台帳の動き（断られるべきものが断られること）を確かめます
- TypeScript は 6.0 系に固定しています

## ライセンス

[MIT](LICENSE)
