# bugyo

feature map、検証、タスク台帳と門番、雛形生成の CLI です。

| コマンド | すること |
| --- | --- |
| `bugyo init <dir>` | 土台入りの新しいプロジェクトを作る |
| `bugyo new feature <id>` | feature を ui / model / api・feature map・spec つきで作る |
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
// e2e/feature-map.test.ts
import { registerFeatureMapTests } from 'bugyo/vitest';

registerFeatureMapTests();
```

くわしい動きと設定項目は [docs/foundation.md](../../docs/foundation.md) にあります。

`init` のテンプレートは [examples/todo-app](../../examples/todo-app) から作ります（`pnpm sync-template`。`pack` と `test` の前に自動で走ります）。
