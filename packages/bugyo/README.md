# bugyo

feature map、検証、雛形生成の CLI です。

| コマンド | すること |
| --- | --- |
| `bugyo init <dir>` | 土台入りの新しいプロジェクトを作る |
| `bugyo new feature <id>` | feature を ui / model / api・feature map・spec つきで作る |
| `bugyo verify <id>` / `--all` | 機能を実際に動かし、合否と証拠の場所だけを出す。Playwright か、`.bugyo/config.json` に書いた任意のコマンドで確かめる |

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
