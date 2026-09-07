// src/derive.js のテスト。実行環境に Node が要らないよう、ブラウザで開く形にしてある。
//   test/index.html をローカルサーバー経由で開くと結果が出る。

import { loadData } from '../src/data.js';
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
} from '../src/derive.js';

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}

function eq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label || '値'}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  }
}

function close(actual, expected, tol, label = '') {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > tol) {
    throw new Error(`${label || '値'}: 期待 ${expected}±${tol} / 実際 ${actual}`);
  }
}

export async function run() {
  const data = await loadData();
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

  test('症例n03: 手書きした前回値が derive.js の計算と矛盾しない', () => {
    const prev = caseById.n03.previous.values;
    const d = deriveHematology(prev);
    eq(round(d.Hb, 1), prev.Hb, 'Hb');
    eq(round(d.Ht, 1), prev.Ht, 'Ht');
    eq(round(d.MCHC, 1), prev.MCHC, 'MCHC');
    eq(round(anionGap(prev), 1), prev.AG, 'AG');
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

  test('全症例: 索引の5枠と桁数が全項目そろっている', () => {
    for (const t of data.tests.tests) {
      for (const key of ['measures', 'high', 'low', 'artifact']) {
        eq(typeof t.glossary[key], 'string', `${t.id}.${key}`);
      }
      eq(typeof t.decimals, 'number', `${t.id}.decimals`);
      eq(data.hospital.reference[t.id] !== undefined, true, `${t.id} の基準範囲`);
    }
  });

  return results;
}
