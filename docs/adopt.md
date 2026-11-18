# 既存のプロジェクトに入れる

`bugyo init` を使わず、今あるプロジェクトに bugyo をあとから入れる手順です。pnpm・npm・yarn・bun のどれで入れても動きます。

## 検証と台帳だけを入れる

lint は入れず、`bugyo verify`（機能を実際に動かして証拠を残す）と、タスク台帳（`bugyo task done` だけが証拠を取って閉じる）だけを使う形です。フォルダの構成や既存のコードは変えません。`bugyo` の依存は zod だけで、`@bugyo/lint` は要りません。

### 1. 入れる

npm には公開していないので、このリポジトリでパッケージを作り、そのファイルを入れます。

```bash
pnpm install && pnpm --filter bugyo pack
```

```bash
npm install --save-dev ../bugyo/packages/bugyo/bugyo-0.1.0.tgz
```

### 2. `.bugyo/config.json` を書く

確かめ方は2つから選びます。

**機能ごとのコマンドで確かめる**（画面のないもの、または画面の確認を自前のスクリプトで行うもの）:

```json
{
  "verify": { "runner": "command", "command": "node {spec}" },
  "featureMap": { "specDir": "checks", "specSuffix": ".mjs", "featuresDir": null },
  "evidence": { "tree": ["src", "checks"] }
}
```

**Playwright で画面を操作して確かめる**:

```json
{
  "featureMap": { "specDir": "e2e", "specSuffix": ".spec.ts", "featuresDir": null },
  "evidence": { "tree": ["src", "e2e"] }
}
```

Playwright の設定は自前のものをそのまま使えます。動画・スクリーンショット・トレースを `artifacts/` に残したいときは、`bugyo/playwright` の `defineBugyoConfig` を使います（[foundation.md](foundation.md#検証playwright)）。

| キー | 決め方 |
| --- | --- |
| `featureMap.featuresDir` | 機能ごとのフォルダがあればその場所（例: `web/features`）。なければ `null`（機能のフォルダとの対応の検査を飛ばす） |
| `evidence.tree` | 証拠のハッシュを取るパス。製品コードと、確かめるスクリプトのフォルダ |
| `commands` | 書かなければ、パッケージマネージャーに合わせた既定（npm なら `npm run check` / `npm test` / `bugyo verify {feature}`）を使う。`package.json` の `check` と `test` のスクリプトが要る |

このファイルを変えるのは人だけです（`done` の判定が変わるため）。

### 3. 機能を1つずつ地図に載せる

機能ごとに `docs/features/<id>.md` を1つ置きます。全部を一度に載せる必要はありません。よく壊れる機能から始めます。

```md
---
id: billing
spec: checks/billing.mjs
---

# billing

## 何があるか
- 請求書の一覧と、PDF の出力

## どう辿り着くか
- 画面の「請求」から。API は `/api/invoices`

## どう操作して確かめるか
- `npx bugyo verify billing`
- 成功：一覧に今月の請求書が出る
- エラー：API が 500 を返すと、再読み込みのボタンが出る
- 空：請求書がなければ「まだありません」と出る

## よく嘘をつくところ
- 一覧は出るのに、PDF の出力だけ壊れていることがある
```

`spec` には、その機能を実際に動かして確かめるファイルを書きます。終了コードが 0 なら通ったとみなします。

```bash
npx bugyo verify billing
```

### 4. `check` に台帳の検査を足す

`package.json` の `check` スクリプトの最後に `bugyo task lint` を足します。手で `status: done` に書き換えたタスクが、ここで落ちます。

```json
{ "scripts": { "check": "tsc --noEmit && eslint . && bugyo task lint" } }
```

`artifacts/` は `.gitignore` に足します。

### 5. タスクを証拠つきで閉じる

```bash
npx bugyo task add "請求書の PDF が文字化けする" --type bugfix --feature billing
```

```bash
npx bugyo task start t-001 --as worker-1
```

```bash
npx bugyo task done t-001
```

`done` は、タスクの種類ごとに必要なもの（check・test・verify など）を自分で実行し、通ったときだけ閉じて `.bugyo/evidence/t-001.json` に証拠を残します。種類ごとの条件は [tasks.md](tasks.md#証拠つきの完了) にあります。

### 6. CI で証拠を取り直す

手元の `task lint` で分かるのは「証拠のない完了」までです。偽の証拠まで止めるには、PR で閉じたタスクの証拠を CI で取り直します。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: npm ci
- run: npx bugyo task recheck --base "origin/${{ github.base_ref }}"
```

`.bugyo/config.json` を変えた PR に人の確認を求める仕組みは、このリポジトリの [config guard](../.github/workflows/config-guard.yml) を写して使えます。

## lint を段階的に入れる

`@bugyo/lint` を入れると、既存のコードの違反がまとめて出ます。今ある違反はベースラインとして止めずに残し、新しい違反だけを止め、ベースラインは減らす方向にだけ動かします。

### 1. 入れる前に数える

```bash
npx bugyo doctor --tsconfig tsconfig.json
```

何も書き換えずに、禁止ごとの違反の件数を多い順に出します。ESLint の設定に `@bugyo/lint` を足してから実行すると、入れたあとの件数の見積もりになります。`--tsconfig` を付けると、その tsconfig での `tsc` のエラーの件数も出します（`@bugyo/lint/tsconfig` の厳しさを足したときの見積もり）。dependency-cruiser の設定があれば、依存のルールの違反も数えます。数えるフォルダは `--dirs web,server` で変えられます（既定は `src`）。理由を書いた `eslint-disable` のコメントで止めた違反は数えません。

### 2. 今の違反をベースラインにする

```bash
npx bugyo baseline save
```

3つのファイルを書きます。

| ファイル | 中身 |
| --- | --- |
| `eslint-suppressions.json` | ESLint の抑制（ファイルとルールごとの件数）。ESLint 9.24 からの機能で、ここにある違反は `eslint .` で出ない |
| `.dependency-cruiser-known-violations.json` | dependency-cruiser の既知の違反。dependency-cruiser の設定があるときだけ |
| `.bugyo/baseline.json` | 禁止ごとの件数 |

ESLint の抑制はファイルとルールごとの件数なので、同じファイルで `useEffect` を `useLayoutEffect` に替えるような、同じルールの中の入れ替えは `eslint .` を通ってしまいます。`.bugyo/baseline.json` は `no-restricted-imports` などをメッセージごとに数えるので、この入れ替えも見つけます。

### 3. `check` で件数を確かめる

```json
{ "scripts": { "check": "tsc --noEmit && eslint . && depcruise src --ignore-known && bugyo baseline check && bugyo task lint" } }
```

`bugyo baseline check` は、禁止ごとの件数がベースラインと同じでなければ落ちます。

- 増えたとき: 新しい違反です。ベースラインに足さずに直します
- 減ったとき: 直した違反がベースラインに残っています。`bugyo baseline save` で縮めて、一緒にコミットします

### 4. CI でベースラインが増えていないか確かめる

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: npm ci
- run: npx bugyo baseline diff --base "origin/${{ github.base_ref }}"
```

`baseline diff` は、3つのファイルのどれかが base より増えていれば落ちます。減らすのと、ファイルを消すのは通ります。どうしても増やすときは、人が差分を確かめてから通す仕組みにします。このリポジトリの [config guard](../.github/workflows/config-guard.yml) は、ラベル `bugyo-baseline-approved` が付いた PR だけを通します。

## 確かめられないこと

`bugyo verify` が確かめるのは、spec に書いた手順が今の環境で通るかだけです。外の環境の状態（本番のデータ、別のサービスの設定など）についての「確認しました」は止められません。
