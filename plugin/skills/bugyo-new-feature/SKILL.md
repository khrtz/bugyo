---
name: bugyo-new-feature
description: bugyo の土台を使うプロジェクトに、新しい機能（画面・一覧・フォームなど利用者から見えるまとまり）を足すときの手順。bugyo new feature で ui/model/api・feature map・E2E spec を作り、画面に組み込み、証拠つきで完了させる。「〜の画面を作って」「〜機能を追加して」と言われたら、src/features にフォルダを手で作る前にこれを使うこと。
---

# bugyo-new-feature

## 手順

1. **名前を決める。** 小文字とハイフン（例: `user-settings`）。既存の `src/features/` と重ならないこと
2. **雛形を作る。** `pnpm exec bugyo new feature <id>`
   - 作られるもの（`.bugyo/config.json` の `template` で変わる）
     - `react-vite`（既定）: `src/features/<id>/{ui,model,api}/`、`index.ts`、model のプロパティテスト、`e2e/<id>.spec.ts`、`docs/features/<id>.md`、`public/api/<id>.json`、README の回帰順への追記
     - `node-lib`: `src/features/<id>/model/` とそのテスト、`index.ts`、`checks/<id>.ts`（実際に動かして確かめるスクリプト）、`docs/features/<id>.md`、README の回帰順への追記。画面がないので下の 3・4 の UI の項目は飛ばし、`checks/<id>.ts` を本当の振る舞いに合わせ、外に見せるなら `src/index.ts` から、コマンドなら `src/app` から `index.ts` を使う
   - 雛形のないテンプレートでは `bugyo new feature` が理由を言って断る。そのときは手で作らず、ユーザーに伝える
   - 手でフォルダを作らない。作ると feature map との対応が漏れ、`pnpm test` が落ちる
3. **形を合わせる。** 雛形の `Item` スキーマ、表示、spec を本当の要件に書き換える
   - ドメインの計算は `model/` に純粋関数で書く（React を import できない）
   - 通信は `api/` の `useXxxQuery` だけ。`fetch` は `shared/api` の `getJson` を通す
   - 状態は判別共用体で表す。ID や金額は Zod の `.brand()` で専用の型にする
4. **画面に組み込む。** `src/app` から `@/features/<id>` の公開窓口だけを import する。組み込むまで knip が「未使用」と止めるのは正しい挙動
5. **feature map を埋める。** `docs/features/<id>.md` の4つの見出しに答える。特に「どう操作して確かめるか」には成功・エラー・空・永続化の経路を、「よく嘘をつくところ」には見た目は通るのに壊れやすい点を書く。挙動のレベルで短く
6. **確かめる。** `pnpm check && pnpm test && pnpm verify <id>`。PASS と `artifacts/` の証拠を報告に載せる

## うまくいかないとき

- `bugyo new feature` が「すでにあります」と言う → 同じ名前の機能がある。別名にするか、既存の機能を拡張する
- 他の feature の中身を使いたい → その feature の `index.ts` に公開を足す。内部ファイルを直接 import しない（lint と dependency-cruiser が止める）
