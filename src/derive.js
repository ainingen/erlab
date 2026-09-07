// 派生値の計算と検体トラブルの適用。
// ここは DOM に触らない純粋なモジュールにしておく（test/derive.test.js から直接読むため）。
//
// 計算の順番は必ずこの順:
//   1. 病態テンプレートから「根っこの値」を組む   resolveRoots()
//   2. 検体トラブルを根っこの値に適用する         applyArtifact()
//   3. そのあとで派生値を計算する                 deriveHematology() / anionGap()
//   4. 桁数を丸める                               round()
// 希釈で RBC が下がれば Hb・Ht も自動的に下がる。派生値を先に作るとこの整合が壊れる。

/** 有効数字ではなく小数桁で丸める。表示値＝報告値なので、フラグ判定もこの結果に対して行う。 */
export function round(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = Math.pow(10, decimals);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * f + Number.EPSILON)) / f;
}

/** 病態テンプレート＋重症度＋症例個別の上書きから、根っこの値を組み立てる。 */
export function resolveRoots(conditionsData, seed = {}, sex = 'F') {
  const base = conditionsData.base_roots || {};
  const condition = (conditionsData.conditions || {})[seed.condition];
  if (!condition) throw new Error(`未定義の病態テンプレート: ${seed.condition}`);

  const severityList = condition.severity || [{}];
  const level = Math.min(Math.max(seed.severity ?? 0, 0), severityList.length - 1);

  return {
    ...(base.default || {}),
    ...(base[sex] || {}),
    ...(condition.roots || {}),
    ...(severityList[level] || {}),
    ...(seed.overrides || {}),
  };
}

/** 検体トラブルを根っこの値に適用する。戻り値は新しいオブジェクト（入力は変更しない）。 */
export function applyArtifact(roots, artifactDef) {
  const values = { ...roots };
  const unmeasurable = [];
  if (!artifactDef) return { values, unmeasurable };

  if (artifactDef.all) {
    // 希釈は「濃度」に効く。MCV・MCHのような1細胞あたりの指標は薄まらないので except で外す。
    const { op, value, except = [] } = artifactDef.all;
    for (const key of Object.keys(values)) {
      if (typeof values[key] !== 'number' || except.includes(key)) continue;
      values[key] = op === 'add' ? values[key] + value : values[key] * value;
    }
  }

  for (const effect of artifactDef.effects || []) {
    const { test, op, value } = effect;
    if (op === 'unmeasurable') {
      values[test] = null;
      unmeasurable.push(test);
      continue;
    }
    if (typeof values[test] !== 'number') continue;
    if (op === 'add') values[test] += value;
    else if (op === 'mul') values[test] *= value;
    else if (op === 'set') values[test] = value;
    else throw new Error(`未知の演算: ${op}`);
  }

  return { values, unmeasurable };
}

/** RBC・MCV・MCH から Hb・Ht・MCHC を導く。単位の都合で 10 で割る。 */
export function deriveHematology(roots) {
  const { RBC, MCV, MCH } = roots;
  if (typeof RBC !== 'number' || typeof MCV !== 'number' || typeof MCH !== 'number') {
    return {};
  }
  const Ht = (RBC * MCV) / 10; // 10^6/uL × fL → %
  const Hb = (RBC * MCH) / 10; // 10^6/uL × pg → g/dL
  const MCHC = MCV === 0 ? null : (MCH / MCV) * 100;
  return { Hb, Ht, MCHC };
}

/** アニオンギャップ。Na −（Cl ＋ HCO3）。 */
export function anionGap(roots) {
  const { Na, Cl, HCO3 } = roots;
  if (typeof Na !== 'number' || typeof Cl !== 'number' || typeof HCO3 !== 'number') return null;
  return Na - Cl - HCO3;
}

/** 根っこの値 → 検体トラブル → 派生値 → 丸め、をひと続きで行う。 */
export function computeValues({ conditions, artifacts, tests }, seed, artifactId, sex = 'F') {
  const roots = resolveRoots(conditions, seed, sex);
  const artifactDef = artifactId ? (artifacts.artifacts || {})[artifactId] : null;
  if (artifactId && !artifactDef) throw new Error(`未定義の検体トラブル: ${artifactId}`);

  const { values, unmeasurable } = applyArtifact(roots, artifactDef);
  const withDerived = { ...values, ...deriveHematology(values), AG: anionGap(values) };

  const decimals = decimalsMap(tests);
  const rounded = {};
  for (const [id, v] of Object.entries(withDerived)) {
    rounded[id] = typeof v === 'number' ? round(v, decimals[id] ?? 1) : null;
  }
  return { values: rounded, unmeasurable, artifact: artifactDef };
}

function decimalsMap(tests) {
  const map = {};
  for (const t of (tests && tests.tests) || []) map[t.id] = t.decimals;
  return map;
}

/** 基準範囲・パニック値は性差を持つことがあるので、この関数を通して取り出す。 */
export function rangeFor(hospital, kind, testId, sex = 'F') {
  const entry = (hospital[kind] || {})[testId];
  if (!entry) return null;
  if (entry.low !== undefined || entry.high !== undefined) return entry;
  return entry[sex] || null;
}

/** 異常フラグ。色を使わず H / L / HH / LL の記号で返す。範囲内・判定不能は空文字。 */
export function flagFor(hospital, testId, value, sex = 'F') {
  if (value === null || value === undefined) return '';
  const panic = rangeFor(hospital, 'panic', testId, sex);
  if (panic) {
    if (panic.high !== undefined && value >= panic.high) return 'HH';
    if (panic.low !== undefined && value <= panic.low) return 'LL';
  }
  const ref = rangeFor(hospital, 'reference', testId, sex);
  if (ref) {
    if (ref.high !== undefined && value > ref.high) return 'H';
    if (ref.low !== undefined && value < ref.low) return 'L';
  }
  return '';
}

export function isPanic(flag) {
  return flag === 'HH' || flag === 'LL';
}

/** 前回値との乖離。規定幅を超えていれば true。前回値がなければ false。 */
export function deltaCheck(hospital, testId, value, previous) {
  const rule = (hospital.delta_check || {})[testId];
  if (!rule || value === null || value === undefined) return false;
  if (previous === null || previous === undefined) return false;
  if (rule.abs !== undefined && Math.abs(value - previous) >= rule.abs) return true;
  if (rule.ratio !== undefined && previous !== 0) {
    const r = value / previous;
    if (r >= rule.ratio || r <= 1 / rule.ratio) return true;
  }
  return false;
}

export function formatValue(value, decimals) {
  if (value === null || value === undefined) return '----';
  return Number(value).toFixed(decimals ?? 1);
}

export function formatRange(range, decimals) {
  if (!range) return '';
  const lo = range.low === undefined ? '' : formatValue(range.low, decimals);
  const hi = range.high === undefined ? '' : formatValue(range.high, decimals);
  return `${lo} - ${hi}`;
}

/**
 * 症例1件ぶんの LIS 表示データを組み立てる。
 * data = { tests, hospital, conditions, artifacts }
 */
export function buildPanel(caseDef, data) {
  const sex = caseDef.patient?.sex || 'F';
  const { values, unmeasurable, artifact } = computeValues(data, caseDef.seed, caseDef.artifact, sex);
  const testById = new Map(data.tests.tests.map((t) => [t.id, t]));
  const previous = caseDef.previous?.values || null;

  const panels = (caseDef.order || []).map((panelId) => {
    const panel = data.hospital.panels[panelId];
    if (!panel) throw new Error(`未定義のパネル: ${panelId}`);
    const rows = panel.tests.map((testId) => {
      const test = testById.get(testId);
      if (!test) throw new Error(`未定義の検査項目: ${testId}`);
      const value = values[testId] ?? null;
      const prev = previous ? previous[testId] ?? null : null;
      const flag = flagFor(data.hospital, testId, value, sex);
      return {
        id: testId,
        name: test.name,
        abbr: test.abbr,
        unit: test.unit,
        decimals: test.decimals,
        derived: test.derived,
        value,
        display: formatValue(value, test.decimals),
        flag,
        panic: isPanic(flag),
        unmeasurable: unmeasurable.includes(testId),
        previous: prev,
        previousDisplay: prev === null ? '—' : formatValue(prev, test.decimals),
        delta: deltaCheck(data.hospital, testId, value, prev),
        reference: rangeFor(data.hospital, 'reference', testId, sex),
        referenceDisplay: formatRange(rangeFor(data.hospital, 'reference', testId, sex), test.decimals),
      };
    });
    return { id: panelId, label: panel.label, rows };
  });

  const rows = panels.flatMap((p) => p.rows);
  return {
    panels,
    rows,
    values,
    sampleComment: artifact ? artifact.comment : null,
    artifact,
    hasPanic: rows.some((r) => r.panic),
    hasAbnormal: rows.some((r) => r.flag !== ''),
    hasDelta: rows.some((r) => r.delta),
    hasUnmeasurable: rows.some((r) => r.unmeasurable),
  };
}
