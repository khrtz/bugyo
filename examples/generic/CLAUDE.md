# 開発ルール

## コマンド
- pnpm check — タスク台帳の検査。変更のたびに必ず通す
- pnpm test — feature mapの整合チェック
- pnpm verify <feature> — 機能を実際に確かめ、出力を artifacts/verify/ に残す

## 構成
- site/ — 製品（このテンプレートでは静的なページ）。言語は問わない
- checks/<名前>.mjs — その機能を実際に動かして確かめるスクリプト（feature map の spec）。終了コード 0 で通ったとみなす
- 別の言語のテストで確かめるなら、.bugyo/config.json の verify.command（例: `pytest {spec}`）と featureMap の specSuffix を人が変える

## 完了の定義
- pnpm check が通るだけでは完了ではない
- 機能を変えたら pnpm verify <feature> を通す
- バグ修正は、先に失敗する確かめ方で再現する
- 新しい機能は bugyo new feature <名前> で作る

## 迷ったら
- どの機能をどう確かめるか: docs/features/README.md から該当する機能のファイルを1つだけ開く
- 振る舞いを変えたら、同じ変更で docs/features/<id>.md も直す
- .bugyo/config.json は変えない（変えるのは人だけ）
