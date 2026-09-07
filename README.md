# ERLAB ―その数値を見逃すな―

臨床検査室を舞台にした HTML5 ゲーム。プレイヤーは臨床検査技師として、
LIS の画面に出た数字を読み、異常が本物かを見極め、報告レベルを選ぶ。

設計は [docs/design.md](docs/design.md)、数値の出典は [docs/sources.md](docs/sources.md) にある。

## 動かす

ES modules と JSON の fetch を使っているので、`file://` で直接開くと動かない。
ローカルの HTTP サーバー経由で開く。

```bash
python -m http.server 5173
```

- 本体: <http://localhost:5173/index.html>
- テスト: <http://localhost:5173/test/> （`src/derive.js` と判定構造のテスト。ブラウザで開くと結果が出る）

依存ライブラリはなし。ビルド手順もなし。

## 構成

```
index.html          エントリ。画面のCSSもここに入れている
src/
  app.js            画面の組み立てとイベント処理
  data.js           JSONの読み込み
  derive.js         派生値の計算・検体トラブルの適用・フラグ判定（DOMに触らない）
  lis.js            LIS結果画面／受付一覧／索引の描画
  messages.js       院内メッセージの描画と指導役による出し分け
  mentor.js         指導役の選択画面
  tutorial.js       症例0（チュートリアル）の描画
  report.js         報告ダイアログと判定
data/
  tests.json        検査項目マスタ（索引5枠つき）
  hospital.json     架空病院の運用規定（基準範囲・パニック値・報告ルール・TAT）
  conditions.json   病態テンプレート（根っこの値だけ）
  artifacts.json    検体トラブル
  mentors.json      指導役（ナビの話し手）
  tutorial.json     症例0の8ステップ（指導役2人ぶん）
  cases/            症例（新人モードは手書きで固定）
  messages/         申し送り・ナビ・医師からの返信の文面
docs/
  design.md         設計メモ
  characters.md     登場人物・立ち絵の使い分け・引き継ぎメモ
  dialogue.md       症例0〜6の台詞（かなえ版・悠介版）
  roadmap.md        進め方の順番と、この先の設計方針
  sources.md        数値の出典と確認状況
test/
  index.html        テストを開くページ
  harness.js        テスト用の最小の道具
  derive.test.js    derive.js のテスト
  report.test.js    判定構造（症例の choices）のテスト
  mentor.test.js    指導役の出し分けのテスト
```

## 決めごと

- 基準範囲・パニック値は `data/hospital.json` の1セットのみ。ほかの場所に数値を書かない
- 派生値（Hb・Ht・MCHC・AG）は `src/derive.js` が計算する。症例JSONに直書きしない
- 異常表示の主はフラグ記号（H, L, HH, LL）。色を塗ってよいのはフラグ欄のセルと、コメントがあるときの検体状態欄だけ
- 症例に単一の正解は置かない。`choices` に選択肢ごとの評価（最善／許容／要改善）と医師返信を並べる
- ナビは指導役ごとに言い方を変えてよいが、教える中身は変えない
- 溶血などの検体トラブルの影響量は固定。見せたい値は症例側の素の値で合わせる（`docs/sources.md`）
- 索引は5枠固定
- 医師パート・病名確定・治療選択は作らない

詳しくは [CLAUDE.md](CLAUDE.md) と [docs/design.md](docs/design.md) を参照。
