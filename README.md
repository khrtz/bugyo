# bugyo（奉行）

エージェントが「正しいやり方しか選べない」コードベースを作るためのライブラリです。
「構造とツールで止める」「証拠で検証する」「ミスをルールに変える」という考え方を、TypeScript + React（Vite SPA）向けに実装しています。

## 中身

| 場所 | 役目 |
| --- | --- |
| [packages/lint](packages/lint) — `@bugyo/lint` | ESLint flat config のファクトリ、dependency-cruiser のルール、最も厳しい tsconfig、コメント禁止ルール |
| [packages/bugyo](packages/bugyo) — `bugyo` | feature map（`docs/features/*.md`）の読み込みと整合テスト、Playwright 設定、CLI（`init` / `new feature` / `verify`） |
| [plugin](plugin) | Claude Code プラグイン（スキル5つとレビュー用サブエージェント） |
| [examples/todo-app](examples/todo-app) | 両パッケージを使う見本。`bugyo init` のテンプレートもここから作る |

## 4つの層と、それを担うもの

1. **コードベース設計** — `src/app` / `src/features/<id>/{ui,model,api,index.ts}` / `src/shared/{ui,lib,api}`。`bugyo new feature` が必ずこの形で作る
2. **静的解析** — `@bugyo/lint`。`useEffect`・`fetch`・タイミング合わせ・feature 内部への import・`any`・型アサーション・コメントなどを、「代わりに何を使うか」つきのエラーで止める
3. **検証** — `bugyo verify <id>|--all`。合否と証拠（動画・スクリーンショット・トレース）の場所だけを出す。feature map と spec・`src/features` の対応漏れは `registerFeatureMapTests()` が落とす
4. **文章の指示** — `CLAUDE.md` は最小限。進め方は Claude Code プラグインのスキルが受け持つ

## 使い方（新しいプロジェクト）

> npm に公開するまでは `npx bugyo` は使えません。それまではこのリポジトリを clone して、次の順で作ってください。
>
> 1. `pnpm install`
> 2. `pnpm --filter bugyo pack` と `pnpm --filter @bugyo/lint pack`（リポジトリの直下に `bugyo-0.1.0.tgz` と `bugyo-lint-0.1.0.tgz` ができます）
> 3. `node packages/bugyo/bin/bugyo.js init ../my-app`
> 4. できた `my-app/package.json` の `bugyo` と `@bugyo/lint` を、2 の tarball への `file:` パスに書き換える

npm に公開したあとは次のとおりです。

```bash
npx bugyo init my-app
```

```bash
cd my-app && pnpm install && pnpm exec playwright install chromium
```

```bash
pnpm check && pnpm test && pnpm verify --all
```

機能を足すとき:

```bash
pnpm exec bugyo new feature user-settings
```

## 既存のプロジェクトに入れる

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
{ "extends": "@bugyo/lint/tsconfig.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "include": ["src", "e2e"] }
```

```ts
// playwright.config.ts
import { defineBugyoConfig } from 'bugyo/playwright';
export default defineBugyoConfig({ port: 5173 });
```

```ts
// e2e/feature-map.test.ts
import { registerFeatureMapTests } from 'bugyo/vitest';
registerFeatureMapTests();
```

独自の禁止を足すときは、`no-restricted-imports` を自分のブロックで上書きせず `bugyo({ extra: { restrictedImports, restrictedGlobals, restrictedProperties, restrictedSyntax } })` に渡してください（上書きすると bugyo の禁止が消えます）。

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

- `packages/lint` のテストは、わざと違反したフィクスチャ（`test/fixture`）に対して各ルールが本当にエラーを出すことを確かめます
- `packages/bugyo` のテストは `new feature` と `init` の生成物を確かめます
- 前提: Node 24 以上、pnpm 11、TypeScript 6.0
