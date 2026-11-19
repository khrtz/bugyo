# タスク台帳と門番

[English](tasks.en.md) ・ 日本語

エージェントに任せる仕事を1件1ファイルで残し、証拠が通ったときだけ閉じられるようにする層です。完了かどうかを決めるのはエージェントの報告ではなく、台帳の判定です。

| 節 | 状態 |
| --- | --- |
| [タスクの形](#タスクの形) | 実装済み |
| [コマンド](#コマンド) | 実装済み |
| [証拠つきの完了](#証拠つきの完了) | 実装済み |
| [設定](#設定) | 実装済み |
| [機械的に守らせる場所](#機械的に守らせる場所) | CLI、`bugyo task lint`、CI での証拠の取り直しと設定の変更の検出、CI でタスクに紐づかない PR を見つけることは実装済み。プラグインのフックで、判定を決めるファイルの直接の書き換えを断ること、セッションの始めにタスクを見せること、終わる前に `bugyo task lint` を実行して作業中のタスクを知らせることも実装済み |
| [ミスの記録とルールへの昇格](#ミスの記録とルールへの昇格) | 実装済み |
| [門番](#門番bugyo-gate) | 実装済み |

## タスクの形

タスクは `.bugyo/tasks/<id>.md` に1件1ファイルで置きます。複数のエージェントが同時に別のタスクを更新しても衝突せず、人もエディタでそのまま読めます。id は `t-001` から順に CLI が振ります。

タスクごとに worktree を切って並行で動かしても、id と着手がぶつからないようにしています。

- git のリポジトリの中では、`add` が id を、`start` が着手を、git の ref（`refs/bugyo/<プロジェクトのパス>/ids/<id>` と `.../claims/<id>`）に「まだ無いときだけ作る」形で記録します。同じリポジトリの worktree は ref を共有するので、2つの worktree で同時に `add` しても別々の id になり、別の worktree で着手したタスクは `start` が断り、`ready` にも出ません
- 別のマシン（別のクローン）とも共有するときは、`.bugyo/config.json` の `claims.remote` にリモートの名前を書きます。予約と着手の前にリモートの ref を取ってきて、作ったあとに push します
- 着手の記録は、`drop` で消え、`rework --as` で担当が書き換わります。止まったエージェントの記録は、人が `bugyo task release <id>` で消します
- 力ずくの push で ref が上書きされたときの最後の網として、CI で `bugyo task lint --base <ref>` を実行し、ベースのブランチにすでにある id と同じ id の別のタスクを、マージする前に落とします
- git のリポジトリでなければ、手元のファイルだけで決めます（今までどおり）

```md
---
status: active
type: bugfix
feature: todos
blocked-by:
assignee: worker-1
rework: 0
gate-attempts: 1
created: 2026-11-18T09:00:00.000Z
tests-hash: sha256:…
repro: pnpm exec vitest run src/features/todos/model/todo.test.ts
repro-at: 2026-11-18T09:10:00.000Z
---

# 絞り込みを切り替えると残り件数がずれる

（何が起きているか、どうなれば終わりか）
```

frontmatter は `key: value` の1段だけで、feature map と同じ読み方をします。知らない項目があると `bugyo task lint` が落ちます。

| 項目 | 意味 |
| --- | --- |
| `status` | `open`（未着手）→ `active`（作業中）→ `done`（証拠つきで完了）。やめたものは `dropped` |
| `type` | 変更の種類。完了に必要な証拠がこれで決まる |
| `feature` | `docs/features/<id>.md` の `id`。どの機能を verify するかがこれで決まる |
| `issue` | 任意。外の課題管理の参照（`123`、`PROJ-45`、課題の URL など）。CI で証拠を取り直して通ったとき、`notify.verified` のコマンドでここに知らせる |
| `blocked-by` | 先に終わっている必要があるタスクの id（カンマ区切り） |
| `assignee` | 作業中のエージェント名か人の名前 |
| `cost-tokens` / `cost-usd` | 任意。閉じるまでにかかったコスト（トークン数と USD）。`done` の `--tokens` / `--usd`（なければ環境変数 `BUGYO_TOKENS` / `BUGYO_USD`）で、閉じたときだけ CLI が足す。手直しのあとにまた閉じれば、その分も足す |
| `model` / `harness` | 任意。作業したモデルとハーネスの名前。`start` と `done` の `--model` / `--harness`（なければ環境変数 `BUGYO_MODEL` / `BUGYO_HARNESS`）で CLI が書く。`bugyo stats` がこれで実績を分ける |
| `rework` | 完了後に人が手直しした回数 |
| `gate-attempts` | `done` で完了を試みた回数。手直しのあとも数え続ける |
| `created` | 作った日時 |
| `tests-hash` | `start` のときのテストファイルのハッシュ。`refactor` の完了で比べる |
| `repro` / `repro-at` | `bugfix` で、直す前に失敗したテストのコマンドと、その日時 |
| `repro-status` / `repro-log` / `repro-tests-hash` / `repro-expect` | `repro` のときの終了コード、出力の末尾を書いたファイル（`.bugyo/evidence/<id>.repro.log`）、テストファイルのハッシュ、`--expect` の文言 |
| `drop-reason` / `dropped-at` | やめた理由と、その日時 |
| `evidence-file` / `evidence-tree` / `evidence-at` | 完了時に CLI だけが書く。証拠ファイルの場所、そのときのコードのハッシュ、閉じた日時 |

完了したタスクとやめたタスクは `.bugyo/tasks/archive/` に移します。一覧もエージェントが読む量も増え続けません。

## コマンド

エージェントが使うのは `ready` → `start` → `show` → `done` の4つです。出力は1タスク1行で、`--json` を付けると短い JSON になります。終了コードは、成功が 0、断ったときが 1、使い方の誤りが 2 です。

| コマンド | 使う人 | すること |
| --- | --- | --- |
| `bugyo task add "<タイトル>" --type <種類> [--feature <id>] [--issue <参照>] [--blocked-by <id,...>] [--body "<本文>"]` | 人・エージェント | タスクを作る。`--feature` が feature map になければ断る。`feature` `ui-flow` `ui-look` `logic` では `--feature` が必須。機能のフォルダがない（`featureMap.featuresDir` が `null`）プロジェクトでは、`logic` は閉じられないので断る。存在しない `--blocked-by` も断る。`--issue` は英数字で始め、英数字と `# . _ : / -` だけ（先頭の `#` はシェルでコメントになるので、`#123` ではなく `123`） |
| `bugyo task ready` | エージェント | 未着手で、`blocked-by` がすべて `done` のタスクを、作った順に出す |
| `bugyo task start <id> --as <名前> [--model <モデル>] [--harness <ハーネス>]` | エージェント | 作業中にする。すでに誰かが作業中なら断る。同じ名前で別のタスクが作業中のときも、`blocked-by` が終わっていないときも断る |
| `bugyo task show <id>` | エージェント | 本文、読むべき feature map、完了に必要なものを出す |
| `bugyo task repro <id> [--expect "<文言>"] -- <テストコマンド>` | エージェント | `bugfix` 用。直す前にそのコマンドが失敗することを確かめ、終了コード・出力の末尾・テストファイルのハッシュを記録する。今通るコマンド、最初のコマンドが見つからないもの（終了コード 127 / 9009 も）、テストを1件も実行していないもの、`--expect` の文言が出力にないものは断る |
| `bugyo task done <id> [--model <モデル>] [--harness <ハーネス>] [--tokens <数>] [--usd <金額>]` | エージェント | 証拠を取り、通れば閉じる。通らなければ理由を出して作業中のままにする。`--tokens` / `--usd` には、着手か前の手直しから閉じるまでにかかったコストを渡す（通ったときだけ記録する） |
| `bugyo task rework <id> -r "<理由>" --kind <ミスの種類> [--as <名前>]` | 人 | 完了したタスクを作業中に戻し、手直しとミスの種類を記録する。担当は元の担当のままで、その人が別のタスクを作業中なら断るので、`--as` で別の担当を指定する |
| `bugyo task drop <id> -r "<理由>"` | 人 | やめる。完了したタスクはやめられない。着手の記録も消す |
| `bugyo task release <id>` | 人 | 止まったエージェントの着手の記録を消す。台帳のファイルは変えない |
| `bugyo task ls [--all]` | 人 | 一覧。`--all` で完了とやめたものも出す |
| `bugyo task lint [--base <ref>]` | `pnpm check`・CI | 台帳の整合を検査する。`--base` なら、`<ref>...HEAD` で足したタスクのうち、`<ref>` にすでにある id の別のタスク（作った日時が違うもの）も見つける |
| `bugyo task recheck [<id>...] [--base <ref>] [--notify]` | CI | 完了タスクの証拠を取り直して照合する。`--base` なら `<ref>...HEAD` で `archive/` に追加・変更されたタスクが対象。証拠ファイルは書き換えない。`--notify` なら、照合に通った `issue` つきのタスクを `notify.verified` のコマンドで知らせる |
| `bugyo task pr-check [--branch <名前>] [--base <ref>]` | CI | PR の作業がタスクに紐づいているかを確かめる。ブランチ名が `task/<id>`（`task/t-001-login` のように後ろに説明を付けてよい）でそのタスクが台帳にあるか、`--base` からの差分でタスクのファイルが変わっていれば通る。ブランチ名は `--branch`、`GITHUB_HEAD_REF`、今のブランチの順に見る |
| `bugyo mistake ls` / `rule <種類> --at <パス> [--name <ルールの名前>]` | 人・エージェント | ミスの一覧とルール化済みの種類の数と、ルール化したことの記録 |
| `bugyo gate` | 人 | 任せる範囲を広げてよいかを計算する。合格で 0、不合格で 1 |
| `bugyo stats [--export <ファイル>]` / `--compare <ファイル>...` | 人 | 閉じたタスクの実績を、作業の種類・モデル・ハーネスごとに出す。書き出しと、プロジェクトをまたいだ比較もする |

`show` は、エージェントがこれだけで「どこを読み、何を出せば終わりか」が分かる出力にします。コマンドは設定の文字列を置き換えたあとの形で出ます。

```
t-014 [active/bugfix] 絞り込みを切り替えると残り件数がずれる  (機能: todos, 担当: worker-1)
読む: docs/features/todos.md
完了に必要: repro の記録 → 同じテストが通る → pnpm check → pnpm test
```

## 証拠つきの完了

タスクを `done` にできるのは `bugyo task done <id>` だけで、このコマンドが自分で証拠を取ります。エージェントの「確かめました」という報告は使いません。

1. タスクの `type` から、必要なものを決める（下の表）。必要なコマンドが設定にない（未定義か空）ときは、何も実行せずに断る
2. `gate-attempts` を1増やす
3. 表の順に確かめる。コマンドは設定の文字列をそのままシェルで実行する
4. すべて通れば、結果の要約を `.bugyo/evidence/<id>.json` に書き、`evidence-*` を埋めて `done` にし、`archive/` に移す
5. どれかが落ちたら、落ちたものと理由、コマンドの出力の末尾30行だけを出し、`active` のままにする

| `type` | 変更の種類 | 完了に必要なもの（この順に確かめる） |
| --- | --- | --- |
| `feature` | 新しい機能 | feature map の4見出しが空でも雛形のままでもないこと、check、test、verify |
| `ui-flow` | UI の操作 | check、test、verify |
| `ui-look` | UI の見た目 | check、verify |
| `logic` | `model/` のロジック | その機能の `model/` にテスト（`*.test.*`）があること、check、test |
| `bugfix` | バグ修正 | `repro` の記録、同じコマンドが今は通ること、check、test。`repro` のあとにテストファイルが変わっていたら、閉じたうえで警告し、証拠の `warnings` に残す |
| `refactor` | リファクタリング | テストファイルを `start` のときから変えていないこと、check、test |
| `chore` | 設定・文書 | check のみ |

- 「雛形のまま」は、見出しの下が空か、`（…）` だけの項目や `：` の後が空の項目が残っている状態です
- テストファイルは、`evidence.tree` のパスの下で名前が `.test.` か `.spec.` を含む JS / TS のファイルです
- スクリーンショットの基準画像（既定は `e2e/__screenshots__`）は `evidence.tree` の下にあるので、`ui-look` で基準画像を更新すると、その中身が `evidence-tree` のハッシュに入ります

証拠ファイルには、実際に実行したコマンドの文字列、終了コード、かかった時間、通った条件、verify の結果（`artifacts/verify.json` の中身。機能ごとの合否、verify が中で実行したコマンド、証拠の場所）、ハッシュを取ったパスとハッシュが入ります。

```json
{
  "task": "t-001",
  "type": "ui-flow",
  "feature": "todos",
  "closedAt": "2026-11-18T09:30:00.000Z",
  "attempt": 2,
  "rework": 0,
  "conditions": [],
  "steps": [
    { "name": "check", "command": "pnpm check", "status": 0, "ms": 11557 },
    { "name": "test", "command": "pnpm test", "status": 0, "ms": 1952 },
    { "name": "verify", "command": "bugyo verify todos", "status": 0, "ms": 6269, "results": { "file": "artifacts/verify.json", "runner": "playwright", "passed": true, "features": [{ "id": "todos", "ok": true, "command": "playwright test \"e2e/todos.spec.ts\" --reporter=line,json,html" }], "evidence": ["…"] } }
  ],
  "tree": { "paths": ["src", "e2e"], "hash": "sha256:…" }
}
```

証拠が古くなったことも分かるようにします。`evidence-tree` に、証拠を取ったときの `evidence.tree` のパスの下のファイルの中身のハッシュを入れます（`node_modules` は含めません）。ハッシュを取るとき、テキストファイルの改行は LF にそろえます（Windows の改行変換で手元と CI の値が変わらないようにするためです）。

CI は、その PR で閉じたタスク（`archive/` に追加・変更されたファイル）について `bugyo task recheck` を実行し、次のどれかなら落ちます。過去に閉じたタスクは照合しません（後の変更で必ず合わなくなるためです）。

- 証拠に記録されたコマンドが、今の設定でそのタスクの種類に必要なコマンドと違う
- `done` と同じ手順（条件とコマンド）を取り直すと通らない
- 今のコードのハッシュが `evidence-tree` と違う

照合するのは「同じ手順を CI で実行して通るか」で、「エージェントが手元で本当に実行したか」ではありません。

1つの PR で閉じるタスクは1件にしてください。同じ PR で続けて複数のタスクを閉じると、先に閉じたタスクの `evidence-tree` は、あとのタスクの変更が入った今のコードと合わないので、照合で落ちます。

動画やトレースは git に入れません。リポジトリに残すのは要約の JSON だけで、実物は手元の `artifacts/` と CI の成果物に置きます。

### 課題に知らせる

`issue` を付けたタスクは、CI で証拠を取り直して通ったときに、外の課題管理へ知らせられます。知らせるのは `bugyo task recheck --notify` だけで、手元の `done` では知らせません（手元の証拠は、CI で取り直すまで確かではないためです）。

```json
{ "notify": { "verified": "gh issue comment {issue} --body \"{task} の証拠を CI で取り直して確かめました（{evidence}）\"" } }
```

PR のたびに `--notify` を付けると、push するたびに同じ課題へ知らせてしまいます。知らせるのは main に入ったときの1回にします。

```yaml
on:
  push:
    branches: [main]
permissions:
  contents: read
  issues: write
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - run: npm ci
      - run: npx bugyo task recheck --base HEAD^ --notify
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`--base HEAD^` で、main に入ったコミット（マージかスカッシュ）で閉じたタスクだけを照合します。

- コマンドはシェルで実行します。`{issue}`・`{task}`・`{evidence}`（証拠ファイルの場所）が置き換わり、同じ値とタスクのタイトルが環境変数 `BUGYO_ISSUE`・`BUGYO_TASK`・`BUGYO_EVIDENCE`・`BUGYO_TITLE` にも入ります。タイトルはコマンドに埋め込まないので、環境変数から読みます
- 知らせるのは照合に通ったタスクだけです。コマンドが失敗しても警告を出すだけで、`recheck` の合否は変わりません
- 課題を閉じるかどうかは、このコマンドで決めます（コメントだけにするか、閉じるところまでするか）

## 設定

`done` が実行するコマンド、ハッシュを取るパス、門番のしきい値は `.bugyo/config.json` で決めます。ファイルの置き場所と、確かめ方（`verify`・`featureMap`）の設定は [foundation.md](foundation.md#設定ファイルbugyoconfigjson) にあります。

```json
{
  "commands": { "check": "pnpm check", "test": "pnpm test", "verify": "bugyo verify {feature}" },
  "evidence": { "tree": ["src", "e2e"] },
  "gate": { "window": 20, "maxRework": 2, "minFirstPass": 16, "maxDropped": 2 }
}
```

| キー | 既定 | 意味 |
| --- | --- | --- |
| `commands.check` / `test` / `verify` | パッケージマネージャーに合わせる（pnpm: `pnpm check` / `pnpm test`、npm: `npm run check` / `npm test`、yarn: `yarn run check` / `yarn test`、bun: `bun run check` / `bun run test`。`verify` はどれも `bugyo verify {feature}`） | `done` が実行するコマンド。パッケージマネージャーの決め方は [foundation.md](foundation.md#設定ファイルbugyoconfigjson) の `packageManager`。`{feature}` はタスクの機能、`{task}` はタスクの id に置き換わる。シェルで実行し、`node_modules/.bin` を `PATH` の先頭に足す |
| `evidence.tree` | `["src", "e2e"]` | `evidence-tree` のハッシュを取るパス。テストファイルのハッシュもこの下で取る |
| `gate.window` | `20` | 門番が見る、直近の閉じたタスク（完了と中止）の件数 |
| `gate.maxRework` | `2` | そのうち手直しが要ったタスクの上限 |
| `gate.minFirstPass` | `16` | そのうち1回の `done` で閉じたタスクの下限 |
| `gate.maxDropped` | `2` | そのうち中止したタスクの上限 |
| `gate.scopes` | 下の3つ | 作業の種類のまとまりごとの判定。`{ "<名前>": { "types": [...], "window"?: …, "maxRework"?: …, "minFirstPass"?: …, "maxDropped"?: … } }`。しきい値を省いたまとまりは上の値を使う |
| `claims.remote` | なし | id の予約と着手の記録を共有するリモートの名前（例: `origin`）。書かなければ、同じマシンの worktree の間だけで共有する |
| `pullRequests.allowBranches` | `[]` | `bugyo task pr-check` が、タスクに紐づかなくても通すブランチ名の glob（例: `["dependabot/**", "release/*"]`） |
| `notify.verified` | なし | `bugyo task recheck --notify` が、照合に通った `issue` つきのタスクごとに実行するコマンド（上の「課題に知らせる」） |

- 既定値を使うのは、`commands` のキーそのものがないときだけです。`commands` があれば書かれたものだけを使い、そのタスクの種類に必要なコマンドが未定義か空なら `done` は断ります
- **`.bugyo/config.json` を変えるのは人だけです。** コマンドを変えれば `done` の判定も変わるからです。エージェントはこのファイルを書き換えません。変えた跡が残るように、証拠ファイルには実行したコマンドの文字列（verify が中で実行したコマンドも）とハッシュを取ったパスをそのまま記録します

## 機械的に守らせる場所

必ず守らせたいことは、スキル（文章の指示）ではなく CLI・`pnpm check`・CI で止めます。スキルは呼ばれないことがある、という前提で作ります。

| どこで止めるか | 止めるもの | 状態 |
| --- | --- | --- |
| CLI | `done` だけが証拠を取って書く。`start` は二重着手（別の worktree・`claims.remote` を書いたときは別のクローンのものも）と1人2件を断る。`add` は別の worktree と同じ id を振らない。`add` は feature map にない機能と存在しない `blocked-by` を断る。`done` は必要なコマンドが設定にないときに断る | 実装済み |
| `bugyo task lint`（`pnpm check` に入れる） | 手で `status: done` に書き換えたタスク（証拠ファイルがない、`archive/` にない、証拠と `evidence-tree`・`rework`・`gate-attempts` が合わない）、担当のいない `active`、1人が2件同時に `active`、存在しない `blocked-by`、feature map にない機能、読めない frontmatter、同じ id の重複。再発したミスは警告として出す | 実装済み |
| CI（`bugyo task recheck --base`） | その PR で閉じたタスクのうち、取り直すと通らないもの、`evidence-tree` が今のコードと合わないもの、記録されたコマンドが今の設定と違うもの | 実装済み |
| CI（`config guard`） | `.bugyo/config.json` を変えた PR で、ラベル `bugyo-config-approved` が付いていないもの | 実装済み |
| CI（`bugyo task lint --base`） | ベースのブランチにすでにある id と同じ id の別のタスクを足した PR | 実装済み |
| CI（`bugyo task pr-check --base`） | タスクに紐づかない PR。ブランチ名が `task/<id>`（台帳にあり、中止されていない）か、PR でタスクのファイルが変わっていれば紐づいているとみなす。`pullRequests.allowBranches` に合うブランチは通す | 実装済み |
| Claude Code のフック（プラグイン） | エージェントが、`.bugyo/config.json`・証拠ファイル・ベースラインのファイルを書き換えること、タスク台帳の状態の項目（`status`・`assignee`・`model`・`harness`・`rework`・`gate-attempts`・`repro`・`evidence` など）を書き換えること、台帳のファイルを手で作ること。シェルのコマンドでの書き換えは、リダイレクトや `sed -i`・`rm`・`cp` などの形を見て止める | 実装済み |
| Claude Code のフック（プラグイン、`Stop`） | エージェントが作業を終える前に `bugyo task lint` を実行し、落ちたら理由を返して終わらせない（手で閉じたタスクを `pnpm check` を待たずに見つける）。止めるのは1回だけで、続けて終わろうとしたときは止めない。台帳が正しくても `active` なタスクが残っていれば、止めずに人へ知らせる | 実装済み |
| Claude Code のフック（プラグイン、`SessionStart`） | セッションの始めに、作業中のタスクと着手できるタスク（`bugyo task ready`）と、着手・完了のコマンドをエージェントに渡す | 実装済み |

台帳も証拠もただのファイルなので、手で書き換えること自体は防げません。プラグインのフックはエージェントの直接の書き換えを手元で断りますが、シェルのコマンドの見分けは形を見るだけなので、すべては止められません。手元の `task lint` で分かるのは「証拠ファイルのない完了」と「証拠と台帳の食い違い」までです。偽の証拠ファイルまで止めるのは CI で、証拠を取り直して比べます。ラベルは書き込み権限があれば誰でも付けられるので、`config guard` が止めるのは「人が気づかないまま設定が変わること」までです。必須のチェックにするには、GitHub のブランチ保護で必須に指定します。

## ミスの記録とルールへの昇格

ミスは種類ごとに `.bugyo/mistakes/<種類>.md` へ1ファイルで残し、同じ種類が2回起きたら、ルールに変えるまで門番を不合格にします。

```md
---
count: 2
rule:
---

# deep-import

- t-003（2026-11-18）: feature の内部を直接 import した
- t-007（2026-11-20）: feature の内部を直接 import した
```

1. 人が手直しするときに `bugyo task rework <id> -r "<理由>" --kind <種類>` を実行する。`--kind` を省くと記録済みの種類の一覧を出して断るので、近いものがあればそれを選ぶ。種類の名前は小文字・数字・ハイフン
2. ミスのファイルに、起きたタスクの id と理由が追記され、`count` が1増える。タスクの本文の「## 手直し」にも1行足し、`evidence-*` を消して `active` に戻す
3. 同じ種類が2回目になると、`bugyo task lint` が警告し、`bugyo gate` が不合格になる
4. ルールに変える。優先する順は、型・API → lint・依存ルール → テスト・feature map → `CLAUDE.md`
5. `bugyo mistake rule <種類> --at <ルールを書いたファイル> [--name <ルールの名前>]` で記録する。そのファイルが実在しなければ断る。記録したときの回数が `ruled-count` に、`--name`（禁止の名前、ルール ID、テストの名前など）が `rule-name` に残る
6. ルール化済みの種類がまた起きたら（`count` が `ruled-count` を超えたら）、「ルールが漏れている」として `mistake ls` の先頭に出し、門番を不合格にする

`bugyo mistake ls` は、種類ごとの回数と対応するルールに続けて、ルール化済みの種類の数を出します。ミスがルールに変わった数を、そのまま数えられます。

```
$ bugyo mistake ls
date-now 2回  ルール: clock（eslint.config.js）  ルール化のとき 1回  ← ルールが漏れている（ルール化のあとにまた起きた）
deep-import 2回  ルール: なし  ← ルール化が必要
wrong-name 1回  ルール: なし
ミス 3種類  ルール化済み 1種類（うちルールが漏れている 1種類）  ルール化が必要 1種類  1回だけ 1種類
```

`--json` では `{ summary, mistakes }` を出します。`summary` は種類の数（`kinds`・`ruled`・`leak`・`unruled`・`once`）、`mistakes` は種類ごとの `kind`・`count`・`rule`・`ruleName`・`ruledCount`・`state` です。

## 門番（`bugyo gate`）

エージェントに任せる範囲を広げてよいかを、作業の種類のまとまりごとに、直近の閉じたタスク（完了と中止。既定は20件。閉じた日時の新しい順）とミスの記録から計算します。`chore` をいくら通しても、画面の作業を任せる判定には数えません。

| まとまり（既定） | 種類 |
| --- | --- |
| `ui` | `feature`、`ui-flow`、`ui-look` |
| `code` | `logic`、`bugfix`、`refactor` |
| `chore` | `chore` |

`bugyo gate --scope <まとまり>` でそのまとまりだけを判定し、`--scope` がなければすべてのまとまりが合格のときだけ合格です。まとまりごとに、次の5つの条件をすべて満たしたときだけ合格です。

| 条件 | 計算 | 既定のしきい値 |
| --- | --- | --- |
| 閉じたタスクが足りている | 直近の閉じたタスク（完了と中止）の件数 | 20件 |
| 途中でやめていない | そのうち中止したタスクの件数 | 2件以下 |
| 人の手直しがほとんど要らない | そのうち `rework` が1以上のタスクの件数 | 2件以下 |
| check と verify が1回で通っている | そのうち `gate-attempts` が1のタスクの件数 | 16件以上 |
| 同じ種類のミスが再発していない | 2回以上起きてまだルール化されていない種類と、ルール化のあとにまた起きた種類の数 | 0 |

しきい値は `.bugyo/config.json` の `gate` で変えられます。閉じたタスクが足りない間は「件数不足」で不合格です。通らなかったタスクを中止にしても、閉じたタスクに数えたうえで中止の件数が増えるので、実績はよく見えません。手直しされたタスクは、やり直しの `done` で `gate-attempts` が2以上になるので、「1回で通った」には数えません。

数字だけで判断しないほうがよいときは、`bugyo gate` が `warn` の行で知らせます（合否は変えません）。

- 閉じたタスクが、判定の件数（`window`）に足りないとき
- 1回で通った割合の 95% 区間（Wilson の方法）の幅が 30% を超えるとき。たとえば 2/2 でも区間は 34.2%〜100.0% で、まだ当てになりません

## 実績（`bugyo stats`）

閉じたタスク（完了と中止）の実績を、作業の種類・モデル・ハーネスごとに出します。どのモデルとハーネスにどの種類の作業を任せられるかを、数字で比べるためです。

```
$ bugyo stats
stats: 閉じたタスク（完了と中止）の実績。1回で通った・手直しは完了の中の割合、中止は閉じたタスクの中の割合
  chore  モデル: model-a  ハーネス: cli  閉じた 2件  1回で通った 50.0%（95% 区間 9.5%〜90.5%）  手直し 0.0%  中止 0.0%
```

- モデルとハーネスは、タスクの `model` / `harness` で分けます。`start` か `done` で `--model` / `--harness` を渡すか、環境変数 `BUGYO_MODEL` / `BUGYO_HARNESS` を設定しておきます。どちらもなければ `-` に数えます
- 1回で通った割合と手直しの割合は完了したタスクの中で、中止の割合は閉じたタスクの中で数えます。1回で通った割合には 95% 区間も出します
- コストを記録したタスクがあれば、その行の下にコストの行を出します。完了1件あたりは、記録のある完了したタスクの平均です。1回で通った1件あたりは、記録のある完了したタスクのコストの合計を、そのうち1回で通った件数で割ったものです（手直しや失敗の分も、通った1件に乗せて数えます）
- コストはハーネスから取る方法がハーネスごとに違うので、bugyo は渡された値を記録するだけです。記録のないタスクは、コストの計算に入れません
- `--json` で、行ごとの件数を出します

```
  chore  モデル: model-a  ハーネス: cli  閉じた 3件  1回で通った 33.3%（95% 区間 6.1%〜79.2%）  手直し 33.3%  中止 0.0%
    コスト（トークン）: 完了1件あたり 2,250、1回で通った1件あたり -（記録のある完了 2/3件）
```

### 書き出して比べる

`bugyo stats --export <ファイル>` は、実績を JSON に書き出します。プロジェクトの名前（`package.json` の `name`、なければフォルダ名）、書き出した日時、完了に要るコマンド（`commands`）、行ごとの実績が入ります。

`bugyo stats --compare <ファイル>...` は、いくつものプロジェクトから書き出したものを、作業の種類ごとに並べます。

```
$ bugyo stats --compare web.json api.json
stats: 2つのプロジェクトを比べます: web, api
chore
  [web] chore  モデル: model-a  ハーネス: cli  閉じた 4件  1回で通った 75.0%（95% 区間 30.1%〜95.4%）  手直し 0.0%  中止 0.0%
  [api] chore  モデル: model-a  ハーネス: cli  閉じた 2件  1回で通った 50.0%（95% 区間 9.5%〜90.5%）  手直し 50.0%  中止 0.0%
warn  commands.test がプロジェクトで違います（web: pnpm test、api: pnpm test:all）。同じ種類でも確かめる中身が違うので、比べるときは気をつけてください
```

- 作業の種類の名前はどのプロジェクトでも同じですが、完了に要るコマンドはプロジェクトごとに違います。`commands` の `check`・`test`・`verify` が違えば、`warn` で知らせます
- 書き出しの形には版（`version`）があり、読めない版や、`--export` で書いたものでないファイルは断ります
