# Asset Review

bugyo の雛形から作った、3D アセット受け入れチェックの実働例です。ファイル名、三角形数、テクスチャ容量を判定し、承認・差し戻し・追加登録をブラウザ内に保存します。3D ファイル自体の解析やチーム共有は行いません。

```bash
pnpm dev
pnpm check && pnpm test && pnpm verify asset-review
pnpm exec bugyo task audit t-001
```

`verify` は jsdom 上で画面を操作し、登録・差し戻し・再描画後の保存を確かめます。`pnpm e2e` は実ブラウザで同じ経路を確認し、スクリーンショット・動画・トレースを `artifacts/` に残します。CI は双方を実行します。手元で Playwright のブラウザを入れられない環境でも、`verify` と証拠の監査は実行できます。

機能の操作手順は [feature map](docs/features/asset-review.md) を参照してください。
