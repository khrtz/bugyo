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
  <img alt="TypeScript + React" src="https://img.shields.io/badge/TypeScript%20%2B%20React-Vite-ffd23f?style=flat-square">
</p>

---

**bugyo（奉行）** は、AI エージェントに開発を任せるためのツール群です。
注意書きを増やす代わりに、**間違った書き方は lint で止まり、確かめた結果は証拠として残る**ようにコードベースの側を作ります。TypeScript + React（Vite）のプロジェクトが対象です。

## なぜ要るのか

エージェントに任せると、次の3つが起きます。bugyo はそれぞれを、文章ではなく仕組みで止めます。

| 起きること | bugyo の止め方 |
| --- | --- |
| 置き場所や書き方がばらつき、次のエージェントがそれをまねる | フォルダ構成と lint で、正しい書き方しか通らないようにする |
| 「確かめました」という報告が当てにならない | 検証コマンドが実際に動かし、合否と証拠（動画・スクリーンショット・トレース）を残す |
| 同じ種類のミスが繰り返される | 注意書きを足す代わりに、禁止と「代わりに使うもの」を lint のルールとして足す |

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

## できること

- **構成** — `src/app`、`src/features/<id>/{ui,api,model,index.ts}`、`src/shared/{ui,lib,api}`。feature は `index.ts` からだけ使える
- **lint** — `useEffect` は `shared/lib` だけ、`fetch` は `shared/api` だけ。UI でのタイマー、`any`、型アサーション、コメント、理由のない `eslint-disable` を止める。`model/` は純粋関数だけ
- **依存ルール** — 循環依存、他の feature の内部への依存、`shared` から上の層への依存を止める
- **feature map** — 機能ごとに `docs/features/<id>.md` を1つ置き、「何があるか・どう辿り着くか・どう操作して確かめるか・よく嘘をつくところ」を書く。機能・spec・地図の対応漏れはテストが落とす
- **検証** — `bugyo verify <id>` がその機能を実際に操作し、動画・スクリーンショット・トレースを毎回残す
- **雛形** — `bugyo init` と `bugyo new feature` が、上の決まりに沿った形でプロジェクトと機能を作る

くわしくは [docs/foundation.md](docs/foundation.md) にあります。

## 入っているもの

| 場所 | 中身 |
| --- | --- |
| [packages/lint](packages/lint) — `@bugyo/lint` | ESLint flat config、dependency-cruiser のルール、厳しい tsconfig、コメント禁止ルール |
| [packages/bugyo](packages/bugyo) — `bugyo` | CLI（`init` / `new feature` / `verify`）、feature map の読み込みと整合テスト、Playwright 設定 |
| [plugin](plugin) | Claude Code プラグイン（スキル5つとレビュー用サブエージェント） |
| [examples/todo-app](examples/todo-app) | 両パッケージを使う見本。`bugyo init` のテンプレートの元 |

## 始め方

npm には公開していないので、このリポジトリから作ります。Node 24 以上と pnpm 11 が必要です。

```bash
pnpm install
```

```bash
pnpm --filter bugyo pack && pnpm --filter @bugyo/lint pack
```

```bash
node packages/bugyo/bin/bugyo.js init ../my-app
```

できた `my-app/package.json` の `bugyo` と `@bugyo/lint` を、上で作った tarball への `file:` パスに書き換えてから、次を実行します。

```bash
cd ../my-app && pnpm install && pnpm exec playwright install chromium
```

```bash
pnpm check && pnpm test && pnpm verify --all
```

機能を足すときは `pnpm exec bugyo new feature <id>` を使います。既存のプロジェクトに入れる方法と、すべての設定項目は [docs/foundation.md](docs/foundation.md) にあります。

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
- `packages/bugyo` のテストは `new feature` と `init` の生成物を確かめます
- TypeScript は 6.0 系に固定しています

## ライセンス

[MIT](LICENSE)
