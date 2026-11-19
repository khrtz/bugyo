# bugyo（Claude Code プラグイン）

bugyo の土台（`@bugyo/lint` と `bugyo` CLI、`docs/features` の feature map）を使うプロジェクトで、Claude Code が正しい進め方を選べるようにするスキル集と、タスク台帳に沿って作業させ、完了の判定を決めるファイルを守るフックです。

## 入っているもの

| 種類 | 名前 | 役目 |
| --- | --- | --- |
| skill | `bugyo-mode` | 入口。作業の種類を見分けて進め方を選び、証拠で完了させる |
| skill | `bugyo-new-feature` | `bugyo new feature` から組み込み・feature map・verify まで |
| skill | `bugyo-rule-from-mistake` | 繰り返すミスを型・lint・依存ルール・テストに変える |
| skill | `bugyo-critique` | 証拠を先に見る批判的レビュー |
| skill | `bugyo-explain` | 仕組みをコードを辿って説明する |
| agent | `slop-reviewer` | 差分を独立した目でレビューするサブエージェント |
| hook | `SessionStart`（`hooks/session-start.mjs`） | セッションの始めに、作業中と着手できるタスクを見せる（下を参照） |
| hook | `PreToolUse`（`hooks/guard.mjs`） | 完了の判定を決めるファイルの直接の書き換えを断る（下を参照） |
| hook | `Stop`（`hooks/stop-check.mjs`） | 作業を終える前に `bugyo task lint` を実行し、落ちたら終わらせない。作業中のタスクが残っていれば知らせる（下を参照） |

## フック

どのフックも、`.bugyo/tasks` のあるフォルダを作業中のフォルダから上へ探し、`node_modules` の `bugyo` を使います。台帳か `node_modules/bugyo` が見つからなければ何もしません。

### タスクを見せる（`SessionStart`）

セッションの始め（再開と `/clear` のあとも）に、作業中のタスク、着手できるタスク（`bugyo task ready`。10件まで）、着手と完了のコマンドをエージェントに渡します。

### 書き換えを断る（`PreToolUse`）

エージェントが次のものを書き換えようとすると、ツールの実行前に断り、代わりに使うコマンドを伝えます。

- `.bugyo/config.json`（変えるのは人だけ。変更案をユーザーに伝えるよう返す）
- `.bugyo/evidence/` の証拠ファイル（`bugyo task done` だけが書く）
- ベースライン（`.bugyo/baseline.json`・`eslint-suppressions.json`・`.dependency-cruiser-known-violations.json`）
- タスク台帳の状態の項目（`status`・`assignee`・`rework`・`gate-attempts`・`repro`・`evidence` など）と、台帳のファイルを手で作ること。`feature`・`issue`・`blocked-by`・本文は直せる

シェルのコマンド（Bash・PowerShell）は、守るファイルの名前とリダイレクトや `sed -i`・`rm`・`cp` などの形を見て断ります。形を見るだけなので、すべての書き換えは止められません。止めきれなかったものは、下の `Stop` のフック、`pnpm check` の `bugyo task lint`、CI が見つけます。

### 終わる前に台帳を確かめる（`Stop`）

エージェントが作業を終えようとすると、`bugyo task lint` を実行します。落ちたら、その出力と直し方を返して作業を続けさせます。

- 止めるのは1回だけです。直したあと、または直せないまま続けて終わろうとしたときは止めません
- 台帳が正しくても `active` なタスクが残っていれば、止めずに、`bugyo task done` か `drop` を使うよう人へ知らせます

どのフックも、動かすには Node が要ります。

## インストール

このリポジトリをマーケットプレイスとして追加し、プラグインを入れます。

```
/plugin marketplace add khrtz/bugyo
/plugin install bugyo@bugyo
```

## 前提

プロジェクト側に `@bugyo/lint` と `bugyo`（React を使うなら `@bugyo/lint-react` も）が入っていること。新規なら `bugyo init <dir>` で作れます（React + Vite の画面なら既定の `react-vite`、画面のない TypeScript のライブラリ／CLI なら `--template node-lib`）。
