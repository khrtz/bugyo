# bugyo（Claude Code プラグイン）

bugyo の土台（`@bugyo/lint` と `bugyo` CLI、`docs/features` の feature map）を使うプロジェクトで、Claude Code が正しい進め方を選べるようにするスキル集です。

## 入っているもの

| 種類 | 名前 | 役目 |
| --- | --- | --- |
| skill | `bugyo-mode` | 入口。作業の種類を見分けて進め方を選び、証拠で完了させる |
| skill | `bugyo-new-feature` | `bugyo new feature` から組み込み・feature map・verify まで |
| skill | `bugyo-rule-from-mistake` | 繰り返すミスを型・lint・依存ルール・テストに変える |
| skill | `bugyo-critique` | 証拠を先に見る批判的レビュー |
| skill | `bugyo-explain` | 仕組みをコードを辿って説明する |
| agent | `slop-reviewer` | 差分を独立した目でレビューするサブエージェント |

## インストール

このリポジトリをマーケットプレイスとして追加し、プラグインを入れます。

```
/plugin marketplace add khrtz/bugyo
/plugin install bugyo@bugyo
```

## 前提

プロジェクト側に `@bugyo/lint` と `bugyo` が入っていること。新規なら `bugyo init <dir>` で作れます（React + Vite の画面なら既定の `react-vite`、画面のない TypeScript のライブラリ／CLI なら `--template node-lib`）。
