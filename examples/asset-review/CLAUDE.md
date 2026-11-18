# 開発ルール

## コマンド
- pnpm check — 型・lint・依存関係・不要コード。変更のたびに必ず通す
- pnpm test — ユニットテストとfeature mapの整合チェック
- pnpm verify <feature> — 実際に動かして証拠を artifacts/ に残す

## 完了の定義
- pnpm check が通るだけでは完了ではない
- 変更の種類に応じた証拠（docs/土台設計.md の表）を出すまで終わらない
- バグ修正は、先に失敗するテストで再現する

## 迷ったら
- どの機能をどう確かめるか: docs/features/README.md から該当する機能のファイルを1つだけ開く
- UIを変えたら、同じ変更で docs/features/<id>.md も直す
- lintに止められたら、エラー文の指示に従う。無効化しない
