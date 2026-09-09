# ERLAB 判定の枝の一覧（`choices` 全数）

roadmap §6-4「手書き症例から判定ルールを言語化する」の材料。
**`data/cases/*.json` から機械的に写した表で、解釈も提案も書いていない。**
型を取り出すのは読む側の仕事。

- 対象は新人研修の手書き症例 `n01`・`n02`・`n03`・`n04`・`n05`・`n05b`・`n06`・`n07b`・`n07`（症例0＝チュートリアルは `choices` を持たないので入っていない）
- 枝の並びは JSON のとおり。判定は**上から順に見て最初に当たった枝**を採る
- 「落ちる操作の例」は `src/report.js` の `evaluate()` に総当たりを通し、その枝に当たった**最小の操作**を1つ選んだもの
  （報告レベル・再採血・コメント・マーク・疑い・行動の組み合わせを、操作の少ない順に試して最初に当たったもの）
- 総当たりの範囲でどの操作もその枝に届かなかったときは「（総当たりでは当たらなかった）」と書いた
- `then` を持つ枝は症例を閉じないので `score` を持たない。`cap` を併記した
- 生成元: `main` の `data/cases/`。作り直すときは `evaluate()` を通し直すこと（手で書き足さない）

---

## a. 症例ごとの全枝

### n01 — 1. 全部そろって正常

教える型：フラグの見方と結果送信の操作を覚える

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | recheck=true | poor | 再検の理由がありません | 通常 ／ 再採血 |
| 2 | report=routine, marks.max=0 | best | 適切な報告です | 通常 |
| 3 | report=routine | ok | 報告レベルは適切。ただし異常のない項目をマークしています | 通常 ／ マーク WBC |
| 4 | （なし・受け皿） | poor | 過剰報告です | 至急 |

### n02 — 2. Hがひとつだけ点く

教える型：軽度のHは通常報告でよい、と判断できるようになる

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | recheck=true | poor | 再検の理由がありません | 通常 ／ 再採血 |
| 2 | report=routine, marks.max=0 | best | 適切な報告です | 通常 |
| 3 | report=routine, marks.must=[CRP], marks.max=1 | best | 適切な報告です | 通常 ／ マーク CRP |
| 4 | report=routine | ok | 報告レベルは適切。ただし基準範囲内の項目までマークしています | 通常 ／ マーク WBC |
| 5 | （なし・受け皿） | poor | 過剰報告です | 至急 |

### n03 — 3. 急がないが、黙って送らない

教える型：中等度の異常に、検査室からのコメントを添えて報告する

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | recheck=true | poor | 再検の理由がありません | 通常 ／ 再採血 |
| 2 | report=routine, comment.must=[delta] | ok | 急な変化ではありません | 通常 ／ コメント[delta] |
| 3 | report=routine, comment=true, marks.must=[Hb], suspects.Hb=[real] | best | 適切な報告です | 通常 ／ コメント[microcytic] ／ マーク Hb(real) |
| 4 | report=routine, comment=true, marks.forbid=[Hb] | ok | Hbに印がありません | 通常 ／ コメント[microcytic] |
| 5 | report=routine, comment=true, marks.must=[Hb] | ok | Hbに疑いが付いていません | 通常 ／ コメント[microcytic] ／ マーク Hb |
| 6 | report=routine, comment=false | ok | 報告レベルは適切。ただしコメントを付けたい場面でした | 通常 |
| 7 | （なし・受け皿） | poor | 過剰報告です | 至急 |

### n04 — 4. はじめてのパニック値

教える型：HHを見つけたら、電話をかけて読み返しを取るところまでやる

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | report=emergency, recheck=true | ok | 報告は正しい。ただしこの検体に再検の理由はありません | 緊急 ／ 再採血 |
| 2 | report=emergency, comment.any=[hemolysis, clot, dilution] | ok | 検体に問題はありません | 緊急 ／ コメント[hemolysis] |
| 3 | report=emergency, marks.must=[K], marks.max=1, suspects.K=[real] | best | 適切な報告です | 緊急 ／ マーク K(real) |
| 4 | report=emergency, marks.must=[K], marks.max=1 | ok | Kを抜き出せています。ただし採血に問題がないかの見立てが残っていません | 緊急 ／ マーク K |
| 5 | report=emergency, marks.must=[K] | ok | 緊急報告に項目を並べすぎです | 緊急 ／ マーク K, WBC |
| 6 | report=emergency | ok | 緊急報告は正しい。ただしどれが急ぎなのかが残っていません | 緊急 |
| 7 | report=urgent | ok | 届いてはいます。ただしパニック値は電話で読み返しまで取る決まりです | 至急 |
| 8 | （なし・受け皿） | poor | パニック値を通常報告にしています | 通常 |

### n05 — 5. 同じ6.8、ただし検体が壊れている

教える型：即報告が正解とはかぎらない。まず検体を疑えるようになる

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | report=emergency, recheck=true | ok | 再採血の判断は正しい。ただし信用していない値で電話はかけません | 緊急 ／ 再採血 |
| 2 | recheck=true, marks.must=[K], suspects.K=[hemolysis] | best | 再採血の依頼が最善です | 通常 ／ 再採血 ／ マーク K(hemolysis) |
| 3 | recheck=true | ok | 再採血の判断は正しい。ただし何を疑ったのかが残っていません | 通常 ／ 再採血 |
| 4 | report=urgent, comment=true | ok | 溶血を伝えたのは正しい判断です。ただし3+では値そのものが使えません | 至急 ／ コメント[microcytic] |
| 5 | report=emergency | poor | 溶血した検体の値で電話をかけています | 緊急 |
| 6 | （なし・受け皿） | poor | 検体状態に触れないまま報告しています | 通常 |

### n05b — 5-b. 溶血していても、高いものは高い

教える型：検体を疑うことと、異常を否定することは違うと知る

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | report=emergency, comment.must=[hemolysis], comment.forbid=[real], recheck=true | ok | 溶血だけでは説明がつきません | 緊急 ／ 再採血 ／ コメント[hemolysis] |
| 2 | report=emergency, comment=true, recheck=true, marks.must=[K], suspects.K=[real, hemolysis], actions.must=[call] | best | 溶血を付記したうえで緊急報告し、再採血まで出せています | 緊急 ／ 再採血 ／ コメント[microcytic] ／ マーク K(real+hemolysis) ／ 行動[call] |
| 3 | report=emergency, comment=true, recheck=true, marks.must=[K], suspects.K=[real, hemolysis] | ok | 判断は適切。ただし点滴側でないことを確かめていません | 緊急 ／ 再採血 ／ コメント[microcytic] ／ マーク K(real+hemolysis) |
| 4 | report=emergency, comment=true, recheck=true | ok | 手順は合っています。ただし採血に問題なしか溶血かの見立てが残っていません | 緊急 ／ 再採血 ／ コメント[microcytic] |
| 5 | report=urgent, comment=true, recheck=true | ok | 至急どまりです。HHは電話で読み返しまで取ります | 至急 ／ 再採血 ／ コメント[microcytic] |
| 6 | report=routine, recheck=true | poor | 再採血だけで、報告が伴っていません | 通常 ／ 再採血 |
| 7 | report=emergency | ok | 緊急報告は妥当。ただし溶血の付記がありません | 緊急 |
| 8 | report=urgent, comment=true | ok | 溶血を伝えたのは正しい。あと一歩、再採血まで出しておきたい場面です | 至急 ／ コメント[microcytic] |
| 9 | （なし・受け皿） | poor | 溶血を理由に、患者由来のパニック値を流しています | 通常 |

### n06 — 6. 数字は動いた、検体は正しい

教える型：前回値との乖離が検体のせいか患者の変化かを切り分ける

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | report=urgent, comment.must=[continued] | ok | 継続ではなく変化です | 至急 ／ コメント[continued] |
| 2 | report=urgent, comment=true, marks.must=[Hb], suspects.Hb=[delta], actions.must=[idcheck] | best | 変化の速さを理由に至急報告できています | 至急 ／ コメント[microcytic] ／ マーク Hb(delta) ／ 行動[idcheck] |
| 3 | report=urgent, comment=true, marks.must=[Hb], suspects.Hb=[delta] | ok | Δの指摘は適切。ただし同一患者の検体か照合していません | 至急 ／ コメント[microcytic] ／ マーク Hb(delta) |
| 4 | report=urgent, comment=true | ok | 至急報告は適切。ただし何が変わったのかが残っていません | 至急 ／ コメント[microcytic] |
| 5 | report=emergency, comment=true | ok | 向きは正しい。ただしHHでない値に緊急回線を使っています | 緊急 ／ コメント[microcytic] |
| 6 | recheck=true, suspects.Hb=[mismatch] | ok | 取り違えを疑う姿勢は正しい。ただし報告が先です | 通常 ／ 再採血 ／ マーク Hb(mismatch) |
| 7 | recheck=true | ok | 再採血の判断は分かります。ただし報告が先です | 通常 ／ 再採血 |
| 8 | report=urgent | ok | 至急報告は適切。ただしコメントがありません | 至急 |
| 9 | report=emergency | ok | 急いだ判断は妥当。ただしHHではなく、コメントもありません | 緊急 |
| 10 | （なし・受け皿） | poor | Lだけを見てΔを見落としています | 通常 |

### n07b — 7-b. IDは合っている、中身が違う

教える型：前回値との乖離が「患者の変化」か「別人の値」かを、MCVと横の連絡で見分ける

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | report=urgent, comment.must=[mismatch], recheck=true, marks.must=[MCV], suspects.MCV=[mismatch], actions.must=[idcheck, call] | best | 別人の値を止め、病棟に伝えて再採血まで出せています | 至急 ／ 再採血 ／ コメント[mismatch] ／ マーク MCV(mismatch) ／ 行動[idcheck, call] |
| 2 | report=urgent, comment.must=[mismatch], recheck=true, marks.must=[MCV], suspects.MCV=[mismatch] | ok | 見立ては正しい。ただし照合と電話で裏を取っていません | 至急 ／ 再採血 ／ コメント[mismatch] ／ マーク MCV(mismatch) |
| 3 | report=emergency, comment.must=[mismatch], recheck=true | ok | 止めたのは正しい。ただしHHでない場面に緊急回線を使っています | 緊急 ／ 再採血 ／ コメント[mismatch] |
| 4 | comment.must=[mismatch], recheck=true | ok | 取り違えを疑って止めたのは正しい。ただし病棟へは至急で伝えます | 通常 ／ 再採血 ／ コメント[mismatch] |
| 5 | recheck=true, suspects.MCV=[mismatch] | ok | 疑いは正しい。ただし理由がコメントに残っていません | 通常 ／ 再採血 ／ マーク MCV(mismatch) |
| 6 | report=[urgent, emergency], suspects.Hb=[delta] | poor | 別人の値を、出血として報告しています | 至急 ／ マーク Hb(delta) |
| 7 | report=[urgent, emergency], comment=true | poor | 急いだのは分かります。ただし報告した値は別人のものです | 至急 ／ コメント[microcytic] |
| 8 | recheck=true | ok | 再採血は正しい。ただし理由が伴っていません | 通常 ／ 再採血 |
| 9 | （なし・受け皿） | poor | 別人の値をそのまま流しています | 通常 |

### n07 — 7. 否定されても、数字は残る

教える型：医師に差し戻されても、値が残れば同じ強さでもう一度報告する

**一本目（`choices`）**

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | report=emergency, marks.must=[K], marks.max=1, suspects.K=[real] | —（then: followup, cap=best） | 緊急報告は適切。医師から差し戻しが返ります | 緊急 ／ マーク K(real) |
| 2 | report=emergency, marks.must=[K], marks.max=1 | —（then: followup, cap=ok） | 緊急報告は適切。ただし採血に問題がないかの見立てが残っていません | 緊急 ／ マーク K |
| 3 | report=emergency, marks.must=[K] | —（then: followup, cap=ok） | 緊急報告は適切。ただし報告に並べる項目が多い | 緊急 ／ マーク K, WBC |
| 4 | report=emergency | —（then: followup, cap=ok） | 緊急報告は適切。ただしどれが急ぎなのかが残っていません | 緊急 |
| 5 | report=urgent | —（then: followup, cap=ok） | 向きは正しい。ただしパニック値を至急に落としています | 至急 |
| 6 | report=routine, recheck=true | poor | パニック値を報告せずに採り直しています | 通常 ／ 再採血 |
| 7 | report=routine | poor | HHを通常報告で流しています | 通常 |
| 8 | （なし・受け皿） | poor | 溶血のないパニック値です。まず報告 | （総当たりでは当たらなかった） |

**二本目（`followup.choices`）**

| # | when | score | headline | 落ちる操作の例 |
|---|---|---|---|---|
| 1 | report=emergency, comment.must=[recollect_same], marks.must=[K], suspects.K=[real] | best | 差し戻されても同じ強さで報告できています | 緊急 ／ コメント[recollect_same] ／ マーク K(real) |
| 2 | report=emergency | ok | 再報告は適切。ただし二本とも同じ値だったことが残っていません | 緊急 |
| 3 | recheck=true | poor | 二本同じなら検体の話ではありません | 通常 ／ 再採血 |
| 4 | （なし・受け皿） | poor | 医師に否定されて報告レベルを下げています | 通常 |

---

## b. `when` に使われているキー

枝の総数 70（一本目 66 ／ 二本目 4）。

| キー | 使っている症例 | 症例数 | 枝数 | 書かれている値の種類 |
|---|---|---|---|---|
| `report` | n01・n02・n03・n04・n05・n05b・n06・n07b・n07 | 9 | 49 | 4 |
| `comment` | n03・n04・n05・n05b・n06・n07b・n07 | 7 | 24 | 8 |
| `recheck` | n01・n02・n03・n04・n05・n05b・n06・n07b・n07 | 9 | 23 | 1 |
| `marks` | n01・n02・n03・n04・n05・n05b・n06・n07b・n07 | 9 | 20 | 7 |
| `suspects` | n03・n04・n05・n05b・n06・n07b・n07 | 7 | 14 | 7 |
| `actions` | n05b・n06・n07b | 3 | 3 | 3 |

値の種類の内訳（JSON に書いてあるまま。並べ替えていない）：

- `report`：`"emergency"` ／ `"routine"` ／ `"urgent"` ／ `["urgent","emergency"]`
- `comment`：`["recollect_same"]` ／ `false` ／ `true` ／ `{"any":["hemolysis","clot","dilution"]}` ／ `{"must":["continued"]}` ／ `{"must":["delta"]}` ／ `{"must":["hemolysis"],"forbid":["real"]}` ／ `{"must":["mismatch"]}`
- `recheck`：`true`
- `marks`：`{"forbid":["Hb"]}` ／ `{"max":0}` ／ `{"must":["CRP"],"max":1}` ／ `{"must":["Hb"]}` ／ `{"must":["K"],"max":1}` ／ `{"must":["K"]}` ／ `{"must":["MCV"]}`
- `suspects`：`{"Hb":["delta"]}` ／ `{"Hb":["mismatch"]}` ／ `{"Hb":["real"]}` ／ `{"K":["hemolysis"]}` ／ `{"K":["real","hemolysis"]}` ／ `{"K":["real"]}` ／ `{"MCV":["mismatch"]}`
- `actions`：`{"must":["call"]}` ／ `{"must":["idcheck","call"]}` ／ `{"must":["idcheck"]}`

---

## c. 同じ形の `when` で `score` が割れているもの

`when` のキーと値をそろえて（キー順・配列順を正規化して）文字列にし、同じものが複数の枝にあって
`score` が一致しないものを全部並べた。**正当な差か揺れかの判断は書いていない。**

`then` を持つ枝（n07 の一本目）は `score` を持たないので `—` になる。`cap` は a の表にある。
見出しの文字列は正規化した形で、a の表の書き方（JSON のまま）とは並び順が違うことがある。

### `{"recheck":true}`

| 症例 | 段 | # | score | headline |
|---|---|---|---|---|
| n01 | 一本目 | 1 | poor | 再検の理由がありません |
| n02 | 一本目 | 1 | poor | 再検の理由がありません |
| n03 | 一本目 | 1 | poor | 再検の理由がありません |
| n05 | 一本目 | 3 | ok | 再採血の判断は正しい。ただし何を疑ったのかが残っていません |
| n06 | 一本目 | 7 | ok | 再採血の判断は分かります。ただし報告が先です |
| n07b | 一本目 | 8 | ok | 再採血は正しい。ただし理由が伴っていません |
| n07 | 二本目 | 3 | poor | 二本同じなら検体の話ではありません |

### `{"report":"routine"}`

| 症例 | 段 | # | score | headline |
|---|---|---|---|---|
| n01 | 一本目 | 3 | ok | 報告レベルは適切。ただし異常のない項目をマークしています |
| n02 | 一本目 | 4 | ok | 報告レベルは適切。ただし基準範囲内の項目までマークしています |
| n07 | 一本目 | 7 | poor | HHを通常報告で流しています |

### `{"marks":{"max":1,"must":["K"]},"report":"emergency","suspects":{"K":["real"]}}`

| 症例 | 段 | # | score | headline |
|---|---|---|---|---|
| n04 | 一本目 | 3 | best | 適切な報告です |
| n07 | 一本目 | 1 | — | 緊急報告は適切。医師から差し戻しが返ります |

### `{"marks":{"max":1,"must":["K"]},"report":"emergency"}`

| 症例 | 段 | # | score | headline |
|---|---|---|---|---|
| n04 | 一本目 | 4 | ok | Kを抜き出せています。ただし採血に問題がないかの見立てが残っていません |
| n07 | 一本目 | 2 | — | 緊急報告は適切。ただし採血に問題がないかの見立てが残っていません |

### `{"marks":{"must":["K"]},"report":"emergency"}`

| 症例 | 段 | # | score | headline |
|---|---|---|---|---|
| n04 | 一本目 | 5 | ok | 緊急報告に項目を並べすぎです |
| n07 | 一本目 | 3 | — | 緊急報告は適切。ただし報告に並べる項目が多い |

### `{"report":"emergency"}`

| 症例 | 段 | # | score | headline |
|---|---|---|---|---|
| n04 | 一本目 | 6 | ok | 緊急報告は正しい。ただしどれが急ぎなのかが残っていません |
| n05 | 一本目 | 5 | poor | 溶血した検体の値で電話をかけています |
| n05b | 一本目 | 7 | ok | 緊急報告は妥当。ただし溶血の付記がありません |
| n06 | 一本目 | 9 | ok | 急いだ判断は妥当。ただしHHではなく、コメントもありません |
| n07 | 一本目 | 4 | — | 緊急報告は適切。ただしどれが急ぎなのかが残っていません |
| n07 | 二本目 | 2 | ok | 再報告は適切。ただし二本とも同じ値だったことが残っていません |

### `{"report":"urgent"}`

| 症例 | 段 | # | score | headline |
|---|---|---|---|---|
| n04 | 一本目 | 7 | ok | 届いてはいます。ただしパニック値は電話で読み返しまで取る決まりです |
| n06 | 一本目 | 8 | ok | 至急報告は適切。ただしコメントがありません |
| n07 | 一本目 | 5 | — | 向きは正しい。ただしパニック値を至急に落としています |

---

## d. 症例ごとの枝数と評価の内訳

| 症例 | 段 | 枝数 | best | ok | poor | score なし（`then`） |
|---|---|---|---|---|---|---|
| n01 | 一本目 | 4 | 1 | 1 | 2 | 0 |
| n02 | 一本目 | 5 | 2 | 1 | 2 | 0 |
| n03 | 一本目 | 7 | 1 | 4 | 2 | 0 |
| n04 | 一本目 | 8 | 1 | 6 | 1 | 0 |
| n05 | 一本目 | 6 | 1 | 3 | 2 | 0 |
| n05b | 一本目 | 9 | 1 | 6 | 2 | 0 |
| n06 | 一本目 | 10 | 1 | 8 | 1 | 0 |
| n07b | 一本目 | 9 | 1 | 5 | 3 | 0 |
| n07 | 一本目 | 8 | 0 | 0 | 3 | 5 |
| n07 | 二本目 | 4 | 1 | 1 | 2 | 0 |
| **合計** | | **70** | **10** | **35** | **20** | **5** |

