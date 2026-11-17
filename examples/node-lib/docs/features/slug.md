---
id: slug
spec: checks/slug.ts
---

# slug

## 何があるか
- 見出しの文字列を、URL に使える小文字・数字・ハイフンだけの名前に変える `toSlug`
- 同じ変換を1行で出力するコマンド

## どう辿り着くか
- ライブラリとして: `src/index.ts` の `toSlug`
- コマンドとして: `node src/app/cli.ts "Hello, World!"`

## どう操作して確かめるか
- `pnpm verify slug`（`checks/slug.ts` がコマンドを実際に動かす。出力は `artifacts/verify/slug.log` に残る）
- 成功：`Hello, World!` を渡すと `hello-world` を出し、終了コード 0
- エラー：引数がないと使い方を標準エラーに出し、終了コード 2
- 空：英数字が1つもない文字列（例: `見出し`）は空文字になる

## よく嘘をつくところ
- 空白や記号が続いてもハイフンは1つにまとめる。`hello--world` になっていたら壊れている
- 先頭と末尾のハイフンは残さない
- 英数字以外は取り除くので、日本語だけの見出しは空になる。これが今の正しい挙動
