# bugyo

feature map、検証、タスク台帳と門番、雛形生成の CLI です。

| コマンド | すること |
| --- | --- |
| `bugyo init <dir> [--template <名前>]` | 土台入りの新しいプロジェクトを作る。テンプレートは `react-vite`（既定）か `node-lib` |
| `bugyo new feature <id>` | feature を、テンプレートに合わせた雛形・feature map・spec つきで作る |
| `bugyo verify <id>` / `--all` | 機能を実際に動かし、合否と証拠の場所だけを出す。Playwright か、`.bugyo/config.json` に書いた任意のコマンドで確かめる |
| `bugyo task add` / `ready` / `start` / `show` / `repro` / `done` / `rework` / `drop` / `ls` / `lint` | タスク台帳。`done` だけが証拠を取って閉じる（[docs/tasks.md](../../docs/tasks.md)） |
| `bugyo mistake ls` / `rule` | ミスの種類ごとの記録と、ルール化の記録 |
| `bugyo gate` | 任せる範囲を広げてよいかを計算する |

```ts
// playwright.config.ts
import { defineBugyoConfig } from 'bugyo/playwright';

export default defineBugyoConfig({ port: 5173 });
```

```ts
// e2e/feature-map.test.ts（Vitest。node:test なら 'bugyo/node-test'）
import { registerFeatureMapTests } from 'bugyo/vitest';

registerFeatureMapTests();
```

くわしい動きと設定項目は [docs/foundation.md](../../docs/foundation.md) にあります。

`init` のテンプレートは、`react-vite` を [examples/todo-app](../../examples/todo-app) から、`node-lib` を [examples/node-lib](../../examples/node-lib) から作ります（`pnpm sync-template`。`pack` と `test` の前に自動で走ります）。`@playwright/test` と `vitest` は任意の peer 依存で、`node-lib` では入りません。
