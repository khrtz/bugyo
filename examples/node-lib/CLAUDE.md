# 開発ルール

## コマンド
- pnpm check — 型・lint・依存関係・不要コード・タスク台帳。変更のたびに必ず通す
- pnpm test — ユニットテストとfeature mapの整合チェック
- pnpm verify <feature> — 機能を実際に動かし、出力を artifacts/verify/ に残す

## 構成
- src/app — コマンドの入口だけ。features の index.ts だけを使う
- src/features/<名前>/{model,index.ts} — 外からは index.ts だけ。model は純粋関数
- src/index.ts — ライブラリとして公開するもの
- checks/<名前>.ts — その機能を実際に動かして確かめるスクリプト（feature map の spec）
- import には拡張子（.ts）を書く。Node がそのまま実行するため

## 完了の定義
- pnpm check が通るだけでは完了ではない
- 機能を変えたら pnpm verify <feature> を通す
- バグ修正は、先に失敗するテストで再現する
- 新しい機能は bugyo new feature <名前> で作る

## 迷ったら
- どの機能をどう確かめるか: docs/features/README.md から該当する機能のファイルを1つだけ開く
- 振る舞いを変えたら、同じ変更で docs/features/<id>.md も直す
- lintに止められたら、エラー文の指示に従う。無効化しない
- .bugyo/config.json は変えない（変えるのは人だけ）
