// src/derive.js のテスト。実行環境に Node が要らないよう、ブラウザで開く形にしてある。
//   test/index.html をローカルサーバー経由で開くと結果が出る。

import { test, eq, close } from './harness.js';
import {
  round,
  resolveRoots,
  applyArtifact,
  deriveHematology,
  anionGap,
  computeValues,
  flagFor,
  deltaCheck,
  buildPanel,
  buildRecollect,
  buildCommentOptions,
  toggleCommentSelection,
  withinHalfDelta,
  sampleStateText,
  formatPanic,
} from '../src/derive.js';

export function suite(data) {
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));

  // ---- 丸め ----
  test('round: 小数桁で丸める', () => {
    eq(round(9.408, 1), 9.4);
    eq(round(31.578, 1), 31.6);
    eq(round(178.0 * 2.8, 0), 498);
    eq(round(2.5, 0), 3, '.5 は切り上げ');
    eq(round(null, 1), null);
  });

  // ---- 派生値 ----
  test('deriveHematology: Ht = RBC × MCV / 10、Hb = RBC × MCH / 10', () => {
    const d = deriveHematology({ RBC: 4.42, MCV: 90.0, MCH: 30.4 });
    close(d.Ht, 39.78, 0.001, 'Ht');
    close(d.Hb, 13.4368, 0.001, 'Hb');
    close(d.MCHC, 33.777, 0.01, 'MCHC');
  });

  test('deriveHematology: 根っこが欠けたら派生値を作らない', () => {
    eq(Object.keys(deriveHematology({ RBC: 4.4, MCV: 90 })).length, 0);
  });

  test('anionGap: Na −（Cl ＋ HCO3）', () => {
    close(anionGap({ Na: 140, Cl: 104, HCO3: 24 }), 12, 0.0001);
    eq(anionGap({ Na: 140, Cl: 104 }), null);
  });

  // ---- 病態テンプレート ----
  test('resolveRoots: 重症度と症例個別の上書きが重なる', () => {
    const roots = resolveRoots(data.conditions, { condition: 'iron_deficiency_anemia', severity: 2 }, 'F');
    eq(roots.RBC, 3.92);
    eq(roots.MCV, 76.0);
    const overridden = resolveRoots(
      data.conditions,
      { condition: 'normal', severity: 0, overrides: { K: 3.1 } },
      'F',
    );
    eq(overridden.K, 3.1);
  });

  test('resolveRoots: 性別で根っこの値が変わる', () => {
    const f = resolveRoots(data.conditions, { condition: 'normal', severity: 0 }, 'F');
    const m = resolveRoots(data.conditions, { condition: 'normal', severity: 0 }, 'M');
    eq(f.RBC, 4.42);
    eq(m.RBC, 4.9);
  });

  test('resolveRoots: 未定義の病態テンプレートはエラーにする', () => {
    let threw = false;
    try {
      resolveRoots(data.conditions, { condition: 'nope' }, 'F');
    } catch {
      threw = true;
    }
    eq(threw, true);
  });

  // ---- 検体トラブル ----
  test('applyArtifact: 溶血はK・LD・ASTだけを動かす', () => {
    const base = { K: 4.1, LD: 178, AST: 21, ALT: 16 };
    const { values } = applyArtifact(base, data.artifacts.artifacts.hemolysis_2plus);
    close(values.K, 5.0, 0.0001, 'K');
    close(values.LD, 498.4, 0.0001, 'LD');
    close(values.AST, 46, 0.0001, 'AST');
    eq(values.ALT, 16, 'ALTは動かない');
    eq(base.K, 4.1, '入力を書き換えない');
  });

  test('applyArtifact: 希釈は全項目を下げるが、Gluだけ上がる', () => {
    const base = { Na: 140, Glu: 92, MCV: 90, MCH: 30.4, RBC: 4.42 };
    const { values } = applyArtifact(base, data.artifacts.artifacts.iv_line_dilution);
    close(values.Na, 105, 0.0001, 'Na');
    close(values.RBC, 3.315, 0.0001, 'RBC');
    close(values.Glu, 92 * 0.75 * 5.4, 0.0001, 'Glu');
    eq(values.MCV, 90, 'MCVは薄まらない');
    eq(values.MCH, 30.4, 'MCHは薄まらない');
  });

  test('applyArtifact: 量不足は測定不可として値をnullにする', () => {
    const { values, unmeasurable } = applyArtifact(
      { LD: 178, CRP: 0.05, Ca: 9.3, K: 4.1 },
      data.artifacts.artifacts.short_sample,
    );
    eq(values.LD, null);
    eq(values.K, 4.1);
    eq(unmeasurable.includes('CRP'), true);
    eq(unmeasurable.length, 3);
  });

  test('applyArtifact: EDTA混入はK高値とCa低値を同時に作る', () => {
    const { values } = applyArtifact({ K: 4.1, Ca: 9.3 }, data.artifacts.artifacts.edta_contamination);
    close(values.K, 10.1, 0.0001, 'K');
    close(values.Ca, 2.325, 0.0001, 'Ca');
  });

  // ---- 計算の順番 ----
  test('computeValues: 希釈はRBC経由でHb・Htに伝わり、MCHCは動かない', () => {
    const plain = computeValues(data, { condition: 'normal', severity: 0 }, null, 'F');
    const diluted = computeValues(data, { condition: 'normal', severity: 0 }, 'iv_line_dilution', 'F');
    eq(plain.values.Hb, 13.4);
    eq(plain.values.MCHC, 33.8);
    eq(diluted.values.Hb, 10.1, '4.42×0.75×30.4/10');
    eq(diluted.values.Ht, 29.8);
    eq(diluted.values.MCHC, 33.8, '1細胞あたりの指標は希釈で動かない');
  });

  test('computeValues: 桁数は tests.json のとおりに丸める', () => {
    const { values } = computeValues(data, { condition: 'iron_deficiency_anemia', severity: 2 }, null, 'F');
    eq(values.Hb, 9.4);
    eq(values.Ht, 29.8);
    eq(values.MCHC, 31.6);
    eq(values.PLT, 336);
  });

  // ---- フラグ ----
  test('flagFor: パニック値は基準範囲より優先してHH／LLになる', () => {
    eq(flagFor(data.hospital, 'K', 6.8), 'HH');
    eq(flagFor(data.hospital, 'K', 5.2), 'H');
    eq(flagFor(data.hospital, 'K', 4.1), '');
    eq(flagFor(data.hospital, 'K', 3.1), 'L');
    eq(flagFor(data.hospital, 'K', 2.4), 'LL');
  });

  test('flagFor: パニック値の境界は「以上・以下」で取る', () => {
    eq(flagFor(data.hospital, 'K', 6.0), 'HH');
    eq(flagFor(data.hospital, 'K', 5.9), 'H');
  });

  test('flagFor: 性差のある項目は性別で判定が変わる', () => {
    eq(flagFor(data.hospital, 'Hb', 13.4, 'F'), '');
    eq(flagFor(data.hospital, 'Hb', 13.4, 'M'), 'L');
  });

  test('flagFor: パニック値の設定がない項目はHまで', () => {
    eq(flagFor(data.hospital, 'CRP', 2.5), 'H');
    eq(flagFor(data.hospital, 'CRP', 28.0), 'H');
  });

  test('flagFor: 測定不可はフラグを付けない', () => {
    eq(flagFor(data.hospital, 'LD', null), '');
  });

  // ---- デルタチェック ----
  test('deltaCheck: 規定幅を超えた変動だけ拾う', () => {
    eq(deltaCheck(data.hospital, 'Hb', 9.4, 10.1), false);
    eq(deltaCheck(data.hospital, 'Hb', 9.8, 13.5), true);
    eq(deltaCheck(data.hospital, 'Hb', 9.4, null), false, '前回値なしでは判定しない');
    eq(deltaCheck(data.hospital, 'Cre', 1.62, 0.9), true, '比でも拾う');
    eq(deltaCheck(data.hospital, 'MCV', 76, 98), false, '規定のない項目は判定しない');
  });

  // ---- 症例 ----
  test('症例n01: フラグがひとつも点かない', () => {
    const panel = buildPanel(caseById.n01, data);
    const flagged = panel.rows.filter((r) => r.flag !== '');
    eq(flagged.map((r) => `${r.id}:${r.flag}`).join(','), '', 'フラグの点いた項目');
    eq(panel.hasPanic, false);
    eq(panel.sampleComment, null);
  });

  test('症例n02: CRPだけがHになる', () => {
    const panel = buildPanel(caseById.n02, data);
    const flagged = panel.rows.filter((r) => r.flag !== '');
    eq(flagged.length, 1);
    eq(flagged[0].id, 'CRP');
    eq(flagged[0].flag, 'H');
    eq(flagged[0].display, '2.50');
    eq(panel.hasPanic, false);
  });

  test('症例n03: 小球性低色素性のパターンが出る', () => {
    const panel = buildPanel(caseById.n03, data);
    const byId = Object.fromEntries(panel.rows.map((r) => [r.id, r]));
    eq(byId.Hb.display, '9.4');
    eq(byId.Hb.flag, 'L');
    eq(byId.Ht.flag, 'L');
    eq(byId.MCV.flag, 'L');
    eq(byId.MCH.flag, 'L');
    eq(byId.MCHC.flag, 'L');
    eq(byId.RBC.flag, '', 'RBCは基準範囲内');
    eq(panel.hasPanic, false, 'パニック値には届かない');
    eq(byId.Hb.delta, false, 'デルタチェックの幅は超えない');
    eq(byId.Hb.previousDisplay, '10.1');
  });

  test('症例n04: Kだけがパニック値になり、電話の対象がひとつに絞れる', () => {
    const panel = buildPanel(caseById.n04, data);
    const byId = Object.fromEntries(panel.rows.map((r) => [r.id, r]));
    eq(byId.K.display, '6.8');
    eq(byId.K.flag, 'HH');
    eq(panel.rows.filter((r) => r.panic).map((r) => r.id).join(','), 'K', 'パニック値の項目');
    eq(panel.sampleComment, null, '検体トラブルなし');
    eq(byId.BUN.flag, 'H');
    eq(byId.Cre.flag, 'H');
    eq(byId.HCO3.flag, 'L');
    eq(byId.AG.flag, 'H');
    eq(byId.Hb.flag, 'L', '腎性貧血');
    eq(byId.MCV.flag, '', '正球性');
    eq(byId.K.delta, false, 'デルタチェックは鳴らさない');
  });

  test('症例n05: 溶血だけでKがパニック値に見え、ALTは動かない', () => {
    const panel = buildPanel(caseById.n05, data);
    const byId = Object.fromEntries(panel.rows.map((r) => [r.id, r]));
    eq(byId.K.display, '6.8', '研修4と同じ数字に見せる');
    eq(byId.K.flag, 'HH');
    eq(byId.LD.flag, 'H');
    eq(byId.AST.flag, 'H');
    eq(byId.ALT.flag, '', 'ALTは動かない＝赤血球由来の目印');
    eq(panel.sampleComment, '溶血（3+）');
  });

  test('症例n05: 再採血すると溶血の上乗せが消え、Kは基準範囲に戻る', () => {
    const first = buildPanel(caseById.n05, data);
    const re = buildRecollect(caseById.n05, first, data);
    const byId = Object.fromEntries(re.rows.map((r) => [r.id, r]));
    eq(byId.K.display, '4.6');
    eq(byId.K.flag, '', '基準範囲内');
    eq(byId.LD.flag, '');
    eq(byId.AST.flag, '');
    eq(re.hasPanic, false, 'パニック値は残らない');
    eq(re.sampleComment, null, '再採血検体に検体トラブルはない');
    eq(byId.K.previousDisplay, '6.8', '前回値欄に最初の検体が並ぶ');
    eq(byId.K.delta, true, '最初の検体から規定幅を超えて動く');
  });

  test('症例n05b: 溶血していても、上乗せを外したKはパニック値のまま残る', () => {
    const first = buildPanel(caseById.n05b, data);
    const firstById = Object.fromEntries(first.rows.map((r) => [r.id, r]));
    eq(firstById.K.display, '6.9');
    eq(firstById.K.flag, 'HH');
    eq(firstById.ALT.flag, '', '溶血の目印はn05と同じ');
    eq(first.sampleComment, '溶血（2+）');

    const re = buildRecollect(caseById.n05b, first, data);
    const reById = Object.fromEntries(re.rows.map((r) => [r.id, r]));
    eq(reById.K.display, '6.0', '再採血後も高値が残る');
    eq(reById.K.flag, 'HH', 'パニック値の線ちょうどでもHH');
    eq(re.hasPanic, true);
    eq(reById.LD.flag, '', 'LDは基準範囲に戻る');
    eq(reById.AST.flag, '', 'ASTは基準範囲に戻る');
    eq(reById.Cre.display, '3.20');
    eq(reById.Cre.flag, 'H', '腎機能低下は検体を替えても残る');
  });

  test('症例n05b: 前回値5.8と比べたΔは、溶血の上乗せを含んだ値で鳴っている', () => {
    const first = buildPanel(caseById.n05b, data);
    const byId = Object.fromEntries(first.rows.map((r) => [r.id, r]));
    eq(byId.K.previousDisplay, '5.8');
    eq(byId.K.delta, true);
    const re = buildRecollect(caseById.n05b, first, data);
    eq(Object.fromEntries(re.rows.map((r) => [r.id, r])).K.delta, false, '取り直すとΔは鳴らない');
  });

  test('症例n06: Δが点き、正球性正色素性のまま Hb だけ落ちている', () => {
    const panel = buildPanel(caseById.n06, data);
    const byId = Object.fromEntries(panel.rows.map((r) => [r.id, r]));
    eq(byId.Hb.display, '9.8');
    eq(byId.Hb.flag, 'L');
    eq(byId.Hb.previousDisplay, '13.5');
    eq(byId.Hb.delta, true, 'デルタチェックが鳴る');
    eq(byId.MCV.flag, '', '正球性');
    eq(byId.MCH.flag, '', '正色素性');
    eq(byId.MCHC.flag, '');
    eq(byId.PLT.display, '210');
    eq(byId.PLT.flag, '', '血小板は基準内');
    eq(panel.sampleComment, null, '検体は正しい');
    eq(panel.hasPanic, false);
  });

  test('症例n07: 一本目は溶血の指紋がないパニック値。Kだけが動いている', () => {
    const panel = buildPanel(caseById.n07, data);
    const byId = Object.fromEntries(panel.rows.map((r) => [r.id, r]));
    eq(byId.K.display, '6.4');
    eq(byId.K.flag, 'HH');
    eq(byId.K.delta, true, '前回4.6から規定幅を超えて動く');
    eq(panel.sampleComment, null, '検体トラブルなし');
    eq(byId.LD.flag, '', '溶血なら上がるはずのLDが基準内');
    eq(byId.AST.flag, '', '同じくAST');
    eq(byId.Hb.flag, '', 'Hbは伏せない（気を散らす異常を増やさない）');
    for (const id of ['WBC', 'RBC', 'Ht', 'MCV', 'MCH', 'MCHC', 'PLT']) {
      eq(byId[id].flag, '', `血算の ${id}`);
    }
    eq([byId.Na.flag, byId.BUN.flag, byId.Cre.flag, byId.CRP.flag].join(','), 'L,H,H,H');
  });

  test('症例n07: 二本目は followup.recollect の上書き値から作られる', () => {
    const caseDef = caseById.n07;
    const first = buildPanel(caseDef, data);
    const re = buildRecollect(caseDef, first, data, caseDef.followup.recollect);
    const byId = Object.fromEntries(re.rows.map((r) => [r.id, r]));

    eq(byId.K.display, '6.2', '上書きした値');
    eq(byId.K.flag, 'HH', '二本目もパニック値のまま');
    eq(byId.K.delta, false, '一本目から動いたことにはしない');
    eq(byId.K.previousDisplay, '6.4', '前回値欄が一本目の値になる');
    eq(byId.Na.display, '137', '書かなかった項目は一本目と同じ根っこから作り直す');
    eq(byId.Na.previousDisplay, '137');
    eq(re.sampleComment, null, '二本目にも検体トラブルはない');
    eq(byId.LD.flag, '', '二本目もLD・ASTは基準内');
    eq(byId.AST.flag, '');
  });

  // ---- コメントの候補（組み立て式コメント） ----
  const optionIds = (opts) => opts.map((o) => o.id).join(',');
  const templateIds = (opts) => opts.map((o) => o.templateId);

  test('候補: マーク × 疑いの組み合わせすべてで候補が出る', () => {
    const c = caseById.n06; // 前回値があるので delta の候補も出せる
    const panel = buildPanel(c, data);
    for (const s of data.suspects.suspects) {
      const opts = buildCommentOptions({ data, panel, marks: ['Hb'], suspects: { Hb: [s.id] } });
      eq(templateIds(opts).includes(s.id), true, `疑い ${s.id} の候補が出ない`);
      for (const o of opts) {
        eq(o.text.includes('{'), false, `${o.id} に埋め残しがある: ${o.text}`);
        eq(o.speech.includes('{'), false, `${o.id} の読み上げに埋め残しがある: ${o.speech}`);
      }
    }
    // 疑いを全部付ければ、その項目のぶんが全部並ぶ
    const all = data.suspects.suspects.map((s) => s.id);
    const opts = buildCommentOptions({ data, panel, marks: ['Hb'], suspects: { Hb: all } });
    eq(templateIds(opts).slice(0, all.length).join(','), all.join(','), '疑いの並び順');
  });

  test('候補: 溶血の段階と前回値が文面に入る', () => {
    const n05 = caseById.n05;
    const hemo = buildCommentOptions({
      data, panel: buildPanel(n05, data), marks: ['K'], suspects: { K: ['hemolysis'] },
    });
    eq(hemo[0].text, 'K：溶血（3+）の影響を疑う');
    eq(hemo[0].speech, 'K 6.8、溶血（3+）の影響を疑います');

    const n06 = caseById.n06;
    const delta = buildCommentOptions({
      data, panel: buildPanel(n06, data), marks: ['Hb'], suspects: { Hb: ['delta'] },
    });
    eq(delta[0].text, 'Hb：前回値から急な変化（13.5→9.8）');

    // 溶血のない検体では段階を書かない
    const n07 = caseById.n07;
    const noGrade = buildCommentOptions({
      data, panel: buildPanel(n07, data), marks: ['K'], suspects: { K: ['hemolysis'] },
    });
    eq(noGrade[0].text, 'K：溶血の影響を疑う');
  });

  test('候補: 前回値のない項目に「前回値から急な変化」は出さない', () => {
    const c = caseById.n01; // 前回値なし
    const opts = buildCommentOptions({
      data, panel: buildPanel(c, data), marks: ['K'], suspects: { K: ['delta'] },
    });
    eq(templateIds(opts).includes('delta'), false);
  });

  test('候補: マーク0件でも検体状態の候補は出る', () => {
    const withComment = buildCommentOptions({ data, panel: buildPanel(caseById.n05, data), marks: [] });
    eq(optionIds(withComment), 'sample_state');
    eq(withComment[0].text, '検体状態：溶血（3+）');

    const clear = buildCommentOptions({ data, panel: buildPanel(caseById.n01, data), marks: [] });
    eq(optionIds(clear), 'sample_state_clear');
    eq(clear[0].text, '検体状態に特記なし');
  });

  test('候補: 並びはマークした項目の順 → 検体状態 → 再採血 → 操作', () => {
    const c = caseById.n04;
    const opts = buildCommentOptions({
      data,
      panel: buildPanel(c, data),
      marks: ['K', 'Cre'],
      suspects: { K: ['real'], Cre: ['real'] },
      recheck: true,
    });
    eq(optionIds(opts), 'real:K,real:Cre,sample_state_clear,recheck');
  });

  test('候補: 再採血の候補は二本目があるときだけ出る', () => {
    const c = caseById.n07;
    const first = buildPanel(c, data);
    const second = buildRecollect(c, first, data, c.followup.recollect);
    const ctx = { data, panel: second, marks: ['K'], suspects: {} };

    eq(templateIds(buildCommentOptions(ctx)).includes('recollect_same'), false, '一本目だけでは出ない');
    const withFirst = buildCommentOptions({ ...ctx, firstPanel: first });
    eq(templateIds(withFirst).includes('recollect_same'), true);
    eq(withFirst.find((o) => o.templateId === 'recollect_same').text, 'K：再採血で同値（6.2）');

    // 症例5は再採血で基準範囲に戻るので、こちらの候補になる
    const n05 = caseById.n05;
    const f5 = buildPanel(n05, data);
    const s5 = buildRecollect(n05, f5, data);
    const opts5 = buildCommentOptions({ data, panel: s5, firstPanel: f5, marks: ['K'], suspects: {} });
    eq(opts5.find((o) => o.templateId === 'recollect_normal').text, 'K：再採血で基準範囲内（4.6）');
  });

  test('候補の選択: 四行目は選べない', () => {
    let picked = [];
    for (const id of ['a', 'b', 'c', 'd']) picked = toggleCommentSelection(picked, id, 3);
    eq(picked.join(','), 'a,b,c', '四行目は入らない');
    picked = toggleCommentSelection(picked, 'b', 3);
    eq(picked.join(','), 'a,c', '外せる');
    picked = toggleCommentSelection(picked, 'd', 3);
    eq(picked.join(','), 'a,c,d', '外した分は入れ直せる');
  });

  test('withinHalfDelta: デルタ幅の半分に収まっているか', () => {
    const h = data.hospital;
    eq(withinHalfDelta(h, 'K', 6.2, 6.4), true, '差0.2は幅1.0の半分以内');
    eq(withinHalfDelta(h, 'K', 6.4, 4.6), false, '差1.8は超える');
    eq(withinHalfDelta(h, 'Na', 137, null), false, '前回値がなければ偽');
  });

  test('sampleStateText: コメントがなければ null', () => {
    eq(sampleStateText(buildPanel(caseById.n05, data)), '溶血（3+）');
    eq(sampleStateText(buildPanel(caseById.n01, data)), null);
  });

  test('全症例: 患者情報にバイタルと主訴がある', () => {
    for (const c of data.cases) {
      eq(typeof c.patient.note, 'string', `${c.id} の主訴`);
      eq(typeof c.patient.vitals.pulse, 'number', `${c.id} の脈拍`);
      eq(/^[0-9]{2,3}\/[0-9]{2,3}$/.test(c.patient.vitals.bp), true, `${c.id} の血圧: ${c.patient.vitals.bp}`);
    }
  });

  test('全症例: recollect を持つ症例は検体トラブルなしで組み直せる', () => {
    for (const c of data.cases) {
      if (!c.recollect) continue;
      const re = buildRecollect(c, buildPanel(c, data), data);
      eq(re.sampleComment, null, `${c.id} の再採血検体`);
      eq(re.hasUnmeasurable, false, `${c.id} の再採血検体に測定不可がある`);
      for (const row of re.rows) eq(row.value === null, false, `${c.id} ${row.id} に値がない`);
    }
  });

  test('全症例: 手書きした前回値が derive.js の計算と矛盾しない', () => {
    for (const c of data.cases) {
      if (!c.previous) continue;
      const prev = c.previous.values;
      const d = deriveHematology(prev);
      eq(round(d.Hb, 1), prev.Hb, `${c.id} Hb`);
      eq(round(d.Ht, 1), prev.Ht, `${c.id} Ht`);
      eq(round(d.MCHC, 1), prev.MCHC, `${c.id} MCHC`);
      eq(round(anionGap(prev), 1), prev.AG, `${c.id} AG`);
    }
  });

  test('全症例: 依頼された項目がすべて表示される', () => {
    for (const c of data.cases) {
      const panel = buildPanel(c, data);
      const expected = c.order.reduce((n, id) => n + data.hospital.panels[id].tests.length, 0);
      eq(panel.rows.length, expected, `${c.id} の行数`);
      for (const row of panel.rows) {
        if (!row.unmeasurable) eq(row.value === null, false, `${c.id} ${row.id} に値がない`);
      }
    }
  });

  test('危険域: 値の境目だけを言い、どうするかは書かない', () => {
    eq(formatPanic({ low: 2.5, high: 6.0 }, 1), '6.0以上・2.5以下は危険域');
    eq(formatPanic({ high: 500 }, 0), '500以上は危険域');
    eq(formatPanic({ low: 20 }, 0), '20以下は危険域');
    eq(formatPanic(null, 1), '', 'パニック値の設定がなければ空');
    // 同じ HH でも検体状態しだいで再採血にも電話にもなる（症例5と症例7）。行動は画面に書かない
    for (const id of Object.keys(data.hospital.panic)) {
      const text = formatPanic(data.hospital.panic[id], 1);
      for (const word of ['電話', '緊急', '報告', '再採血']) {
        eq(text.includes(word), false, `${id} の危険域に「${word}」が入っている`);
      }
    }
  });

  test('危険域: パニック値の設定がある項目にだけ出る', () => {
    const withPanic = new Set(Object.keys(data.hospital.panic));
    for (const c of data.cases) {
      for (const row of buildPanel(c, data).rows) {
        eq(Boolean(row.panicDisplay), withPanic.has(row.id), `${c.id} ${row.id} の危険域`);
      }
    }
  });

  test('全症例: 索引の5枠と桁数が全項目そろっている', () => {
    for (const t of data.tests.tests) {
      for (const key of ['measures', 'high', 'low', 'artifact']) {
        eq(typeof t.glossary[key], 'string', `${t.id}.${key}`);
      }
      eq(typeof t.decimals, 'number', `${t.id}.decimals`);
      eq(data.hospital.reference[t.id] !== undefined, true, `${t.id} の基準範囲`);
    }
  });
}
