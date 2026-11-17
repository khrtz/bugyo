---
name: bugyo-rule-from-mistake
description: エージェント（自分や他のエージェント）や人が同じ種類のミスをしたとき、注意書きを足す代わりに lint・型・API・依存ルール・テストに変えて、二度と起きないようにする手順。「またこれ」「前も同じミス」「CLAUDE.md に書いておいて」「ルールにして」と言われたとき、またはレビューで同じ指摘が2回目になったときに使うこと。CLAUDE.md に1行足す前に必ずこれを通す。
---

# bugyo-rule-from-mistake

文章の注意書きは読み飛ばされ、古くなります。機械が止めるルールは止め続けます。
上から順に試し、**止められた最初の層で終わり**にします。

## 1. また起きそうか

一度きりの事故なら、直して終わり。ルールは増やすほど重くなる。
同じ形のミスが2回目、または既存コードにまねられそうな形で残っているなら次へ。

## 2. 型か API で起こせなくする

いちばん強い。ミスを書けない形にする。

- ありえない状態 → 判別共用体にする
- 取り違えやすい値 → Zod の `.brand()` で専用の型にする
- 誤用しやすい関数 → 正しい使い方しかできない専用フックや関数に包み、元の呼び方を lint で禁止する

## 3. lint か依存ルールで止める

何を止めたいかで、`eslint.config.js` の `bugyo({ extra: { ... } })` のどこに足すかが決まる。

| 止めたいもの | 足す場所 | 例 |
| --- | --- | --- |
| モジュールの import | `restrictedImports: { paths, patterns }` | `import moment from 'moment'` |
| グローバル変数 | `restrictedGlobals` | `localStorage`、`alert` |
| オブジェクトのプロパティ参照 | `restrictedProperties: [{ object, property, message }]` | `Date.now`、`Math.random`、`console.log` |
| 構文の形 | `restrictedSyntax: [{ selector, message }]` | 引数なしの `new Date()` は `"NewExpression[callee.name='Date'][arguments.length=0]"` |
| 層や feature をまたぐ依存 | `.dependency-cruiser.cjs` の `config({ forbidden: [...] })` | — |

`restrictedProperties` と `restrictedSyntax` は、副作用を包む場所（`src/shared/lib`）とテストでは効かない。だから禁止したものの「正しい入口」は `shared/lib` に作る（例: `shared/lib/clock.ts` の `systemClock`）。

`no-restricted-imports`・`no-restricted-globals`・`no-restricted-properties`・`no-restricted-syntax` を自分のブロックで直接設定しないこと。bugyo の禁止が上書きされて黙って消える。必ず `extra` に足す。
`extra` で表せない禁止が必要なら、それは bugyo 側に拡張口が足りないということなので、ユーザーにそう伝える（自分のブロックで回避しない）。

**エラー文には「代わりに何を使うか」まで書く。** エージェントはエラー文を読んで直すので、禁止だけだと抜け道を探される。

良い例: `'製品コードで Date.now() は使えません。shared/lib の useClock() を使ってください。テストでは fakeClock を渡せます。'`
悪い例: `'Date.now() は禁止です'`

## 4. 既存の違反をその場で全部直す

ルールを足したら `pnpm check` を通し、出てきた既存の違反をその変更の中ですべて直す。
例外リストや `eslint-disable` で残さない。残すと、次のエージェントがそれをお手本にする。

## 5. 止められなければ検証で捕まえる

型でも lint でも止められない（挙動の問題など）なら、テストか feature map で捕まえる。

- 再現するテストを足す（先に失敗することを確かめる）
- `docs/features/<id>.md` の「よく嘘をつくところ」に1行足す

## 6. どれも無理なときだけ CLAUDE.md

1〜5 のどれでも止められないときだけ、CLAUDE.md に1行足す。
その行が後でルール化できたら、昇格させて文章から消す。

## 報告

どの層で止めたか、追加したルールのエラー文、直した既存違反の数を書く。わざと違反するコードを一度書いてルールが実際にエラーを出すことを確かめ、その結果も載せる（確かめたら消す）。
