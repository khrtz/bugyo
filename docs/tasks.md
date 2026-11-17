# タスク台帳と門番

エージェントに任せる仕事を1件1ファイルで残し、証拠が通ったときだけ閉じられるようにする層です。完了かどうかを決めるのはエージェントの報告ではなく、台帳の判定です。

| 節 | 状態 |
| --- | --- |
| [タスクの形](#タスクの形) | 実装済み |
| [コマンド](#コマンド) | 実装済み（`tree` は未実装） |
| [証拠つきの完了](#証拠つきの完了) | 実装済み（`ui-look` の基準画像の記録と、CI での照合は未実装） |
| [設定](#設定) | 実装済み |
| [機械的に守らせる場所](#機械的に守らせる場所) | CLI と `bugyo task lint` は実装済み。CI と Claude Code のフックは未実装 |
| [ミスの記録とルールへの昇格](#ミスの記録とルールへの昇格) | 実装済み |
| [門番](#門番bugyo-gate) | 実装済み |

## タスクの形

タスクは `.bugyo/tasks/<id>.md` に1件1ファイルで置きます。複数のエージェントが同時に別のタスクを更新しても衝突せず、人もエディタでそのまま読めます。id は `t-001` から順に CLI が振ります。

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
| `blocked-by` | 先に終わっている必要があるタスクの id（カンマ区切り） |
| `assignee` | 作業中のエージェント名か人の名前 |
| `rework` | 完了後に人が手直しした回数 |
| `gate-attempts` | `done` で完了を試みた回数。手直しのあとも数え続ける |
| `created` | 作った日時 |
| `tests-hash` | `start` のときのテストファイルのハッシュ。`refactor` の完了で比べる |
| `repro` / `repro-at` | `bugfix` で、直す前に失敗したテストのコマンドと、その日時 |
| `drop-reason` | やめた理由 |
| `evidence-file` / `evidence-tree` / `evidence-at` | 完了時に CLI だけが書く。証拠ファイルの場所、そのときのコードのハッシュ、閉じた日時 |

完了したタスクとやめたタスクは `.bugyo/tasks/archive/` に移します。一覧もエージェントが読む量も増え続けません。

## コマンド

エージェントが使うのは `ready` → `start` → `show` → `done` の4つです。出力は1タスク1行で、`--json` を付けると短い JSON になります。終了コードは、成功が 0、断ったときが 1、使い方の誤りが 2 です。

| コマンド | 使う人 | すること |
| --- | --- | --- |
| `bugyo task add "<タイトル>" --type <種類> [--feature <id>] [--blocked-by <id,...>] [--body "<本文>"]` | 人・エージェント | タスクを作る。`--feature` が feature map になければ断る。`feature` `ui-flow` `ui-look` `logic` では `--feature` が必須。存在しない `--blocked-by` も断る |
| `bugyo task ready` | エージェント | 未着手で、`blocked-by` がすべて `done` のタスクを、作った順に出す |
| `bugyo task start <id> --as <名前>` | エージェント | 作業中にする。すでに誰かが作業中なら断る。同じ名前で別のタスクが作業中のときも、`blocked-by` が終わっていないときも断る |
| `bugyo task show <id>` | エージェント | 本文、読むべき feature map、完了に必要なものを出す |
| `bugyo task repro <id> -- <テストコマンド>` | エージェント | `bugfix` 用。直す前にそのコマンドが失敗することを確かめて記録する。今通るコマンドは断る |
| `bugyo task done <id>` | エージェント | 証拠を取り、通れば閉じる。通らなければ理由を出して作業中のままにする |
| `bugyo task rework <id> -r "<理由>" --kind <ミスの種類>` | 人 | 完了したタスクを作業中に戻し、手直しとミスの種類を記録する |
| `bugyo task drop <id> -r "<理由>"` | 人 | やめる。完了したタスクはやめられない |
| `bugyo task ls [--all]` | 人 | 一覧。`--all` で完了とやめたものも出す |
| `bugyo task lint` | `pnpm check` | 台帳の整合を検査する |
| `bugyo mistake ls` / `rule <種類> --at <パス>` | 人・エージェント | ミスの一覧と、ルール化したことの記録 |
| `bugyo gate` | 人 | 任せる範囲を広げてよいかを計算する。合格で 0、不合格で 1 |

親子関係を出す `bugyo task tree` は、親子関係の持ち方が決まっていないのでまだありません。

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
| `bugfix` | バグ修正 | `repro` の記録、同じコマンドが今は通ること、check、test |
| `refactor` | リファクタリング | テストファイルを `start` のときから変えていないこと、check、test |
| `chore` | 設定・文書 | check のみ |

- 「雛形のまま」は、見出しの下が空か、`（…）` だけの項目や `：` の後が空の項目が残っている状態です
- テストファイルは、`evidence.tree` のパスの下で名前が `.test.` か `.spec.` を含む JS / TS のファイルです
- `ui-look` で基準画像を更新したことをタスクに記録する仕組みは、まだありません

証拠ファイルには、実際に実行したコマンドの文字列、終了コード、かかった時間、通った条件、verify の結果（`artifacts/verify.json` の中身。機能ごとの合否と証拠の場所）、ハッシュを取ったパスとハッシュが入ります。

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
    { "name": "verify", "command": "bugyo verify todos", "status": 0, "ms": 6269, "results": { "file": "artifacts/verify.json", "runner": "playwright", "passed": true, "features": [{ "id": "todos", "ok": true }], "evidence": ["…"] } }
  ],
  "tree": { "paths": ["src", "e2e"], "hash": "sha256:…" }
}
```

証拠が古くなったことも分かるようにします。`evidence-tree` に、証拠を取ったときの `evidence.tree` のパスの下のファイルの中身のハッシュを入れます（`node_modules` は含めません）。CI で、その PR で閉じたタスクについてだけハッシュを今のコードと比べ、合わなければ証拠を取り直す予定です。過去に閉じたタスクは照合しません（後の変更で必ず合わなくなるためです）。CI での照合はまだありません。

動画やトレースは git に入れません。リポジトリに残すのは要約の JSON だけで、実物は手元の `artifacts/` と CI の成果物に置きます。

## 設定

`done` が実行するコマンド、ハッシュを取るパス、門番のしきい値は `.bugyo/config.json` で決めます。ファイルの置き場所と、確かめ方（`verify`・`featureMap`）の設定は [foundation.md](foundation.md#設定ファイルbugyoconfigjson) にあります。

```json
{
  "commands": { "check": "pnpm check", "test": "pnpm test", "verify": "bugyo verify {feature}" },
  "evidence": { "tree": ["src", "e2e"] },
  "gate": { "window": 20, "maxRework": 2, "minFirstPass": 16 }
}
```

| キー | 既定 | 意味 |
| --- | --- | --- |
| `commands.check` / `test` / `verify` | `pnpm check` / `pnpm test` / `bugyo verify {feature}` | `done` が実行するコマンド。`{feature}` はタスクの機能、`{task}` はタスクの id に置き換わる。シェルで実行し、`node_modules/.bin` を `PATH` の先頭に足す |
| `evidence.tree` | `["src", "e2e"]` | `evidence-tree` のハッシュを取るパス。テストファイルのハッシュもこの下で取る |
| `gate.window` | `20` | 門番が見る、直近の完了タスクの件数 |
| `gate.maxRework` | `2` | そのうち手直しが要ったタスクの上限 |
| `gate.minFirstPass` | `16` | そのうち1回の `done` で閉じたタスクの下限 |

- 既定値を使うのは、`commands` のキーそのものがないときだけです。`commands` があれば書かれたものだけを使い、そのタスクの種類に必要なコマンドが未定義か空なら `done` は断ります
- **`.bugyo/config.json` を変えるのは人だけです。** コマンドを変えれば `done` の判定も変わるからです。エージェントはこのファイルを書き換えません。変えた跡が残るように、証拠ファイルには実行したコマンドの文字列とハッシュを取ったパスをそのまま記録します

## 機械的に守らせる場所

必ず守らせたいことは、スキル（文章の指示）ではなく CLI・`pnpm check`・CI で止めます。スキルは呼ばれないことがある、という前提で作ります。

| どこで止めるか | 止めるもの | 状態 |
| --- | --- | --- |
| CLI | `done` だけが証拠を取って書く。`start` は二重着手と1人2件を断る。`add` は feature map にない機能と存在しない `blocked-by` を断る。`done` は必要なコマンドが設定にないときに断る | 実装済み |
| `bugyo task lint`（`pnpm check` に入れる） | 手で `status: done` に書き換えたタスク（証拠ファイルがない、`archive/` にない、証拠と `evidence-tree`・`rework`・`gate-attempts` が合わない）、担当のいない `active`、1人が2件同時に `active`、存在しない `blocked-by`、feature map にない機能、読めない frontmatter、同じ id の重複。再発したミスは警告として出す | 実装済み |
| CI | タスクに紐づかない PR（ブランチ名 `task/<id>` で判定）、`evidence-tree` が今のコードと合わないタスク。その PR で閉じたタスクの証拠は取り直して比べる | 未実装 |
| Claude Code のフック | セッション開始時に `bugyo task ready` を見せる。`active` なタスクを残したまま終わろうとしたら知らせる | 未実装 |

台帳も証拠もただのファイルなので、手で書き換えること自体は防げません。手元の `task lint` で分かるのは「証拠ファイルのない完了」と「証拠と台帳の食い違い」までです。偽の証拠ファイルまで止めるのは CI で、証拠を取り直して比べます。フックは思い出させる役で、止める役は CLI・`task lint`・CI が持ちます。

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
5. `bugyo mistake rule <種類> --at <ルールを書いたファイル>` で記録する。そのファイルが実在しなければ断る。記録したときの回数が `ruled-count` に残る
6. ルール化済みの種類がまた起きたら（`count` が `ruled-count` を超えたら）、「ルールが漏れている」として `mistake ls` の先頭に出し、門番を不合格にする

## 門番（`bugyo gate`）

エージェントに任せる範囲を広げてよいかを、直近の完了タスク（既定は20件。閉じた日時の新しい順）とミスの記録から計算します。4つの条件をすべて満たしたときだけ合格です。

| 条件 | 計算 | 既定のしきい値 |
| --- | --- | --- |
| 完了タスクが足りている | 直近の完了タスクの件数 | 20件 |
| 人の手直しがほとんど要らない | そのうち `rework` が1以上のタスクの件数 | 2件以下 |
| check と verify が1回で通っている | そのうち `gate-attempts` が1のタスクの件数 | 16件以上 |
| 同じ種類のミスが再発していない | 2回以上起きてまだルール化されていない種類と、ルール化のあとにまた起きた種類の数 | 0 |

しきい値は `.bugyo/config.json` の `gate` で変えられます。完了タスクが足りない間は「件数不足」で不合格です。手直しされたタスクは、やり直しの `done` で `gate-attempts` が2以上になるので、「1回で通った」には数えません。

複数の作業セッションの同時実行と自動マージ（[agents.md](agents.md)）は、この判定が合格でないと動かない設計です。土台が回る前に任せる範囲を広げると、質の低いコードが速く増えるだけだからです。
