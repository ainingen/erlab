// 判定ルール（docs/judge-rules.md。roadmap §6-4）。
// 症例の事実から「正解の操作」を導き、操作のずれ方で評価を決める。
//
// ここは DOM に触らない純関数だけにする（test/judge.test.js から直接読むため）。
// **手書き症例（`choices` を持つ症例）はここを通らない。** 通るのは choices の無い
// 生成症例だけで、手書きの挙動は変えない（src/report.js の evaluate()）。
//
// しきい値は data/judge.json。ここに数字を書かない。

const LEVELS = ['routine', 'urgent', 'emergency'];
const levelRank = (id) => Math.max(0, LEVELS.indexOf(id));

const ACTION_NAME = { look: '目視', idcheck: 'ID照合', smear: '塗抹', call: '電話' };

/* ---- 操作の読み取り（report.js と同じ形の choice を受ける） ---- */

/** 選んだコメントの候補ID。素のID（`delta`）と項目付きのID（`delta:Hb`）の両方を入れる。 */
export function commentIds(operation) {
  const c = operation && operation.comment;
  const ids = new Set();
  if (Array.isArray(c)) {
    for (const line of c) {
      if (typeof line === 'string') { ids.add(line); continue; }
      if (line && line.templateId) ids.add(line.templateId);
      if (line && line.id) ids.add(line.id);
    }
  }
  return ids;
}

/** 一行でもコメントを選んだか。自由記述（文字列）だった頃の形も受ける。 */
function commented(operation) {
  const c = operation && operation.comment;
  if (Array.isArray(c)) return c.length > 0;
  return typeof c === 'string' && c.trim().length > 0;
}

const marksOf = (op) => [].concat((op && op.marks) || []);
const actionsOf = (op) => [].concat((op && op.actions) || []);
const suspectsOn = (op, testId) => [].concat(((op && op.suspects) || {})[testId] || []);

/* ---- 1. 症例の事実 ---- */

/**
 * 症例の事実（docs/judge-rules.md §1）を、結果テーブルから導く。
 *
 *   caseDef … 症例JSON。artifact と patient を見る
 *   panel   … buildPanel() / buildRecollect() の結果。前回値は行が持っている
 *   data    … loadData() の結果。judge（data/judge.json）を使う
 *   context … { stage: 'first' | 'followup', firstLevel } 差し戻し後の二本目のときだけ渡す
 *
 * 戻り値の type が §2 の正解の型。優先は M > A₂ > P > D > A₁ > N。
 */
export function deriveFacts(caseDef, panel, data, context = {}) {
  const rules = data.judge;
  const rows = panel.rows;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const flagged = rows.filter((r) => r.flag).map((r) => r.id);
  const panicItems = rows.filter((r) => r.panic).map((r) => r.id);
  const deltaItems = rows.filter((r) => r.delta).map((r) => r.id);

  const artifactId = caseDef.artifact || null;
  const artifact = artifactId ? (rules.artifacts || {})[artifactId] || null : null;
  const A = Boolean(artifactId);
  const A2 = Boolean(artifact && artifact.grade === 'broken');
  const A1 = A && !A2;

  const P = panicItems.length > 0;
  const D = deltaItems.length > 0;
  const M = looksLikeMismatch(rows, byId, deltaItems, rules);

  // X … 検体トラブルがあっても値は患者由来。前回値が同じ向きにすでに異常だった
  const X = P && A && panicItems.some((id) => alreadyAbnormal(byId.get(id)));

  const R = context.stage === 'followup';
  const N = !P && !D && !M && !A;

  const key = pickKey({ rows, byId, M, A2, A1, artifact, P, D, panicItems, deltaItems, flagged });

  const facts = {
    P, A, A1, A2, D, M, X, R, N,
    key,
    artifactId,
    artifactSuspect: artifact ? artifact.suspect : null,
    panicItems, deltaItems, flagged,
    moderate: !P && !D && !M && flagged.length >= (rules.moderate_flag_count ?? 2),
    firstLevel: context.firstLevel || null,
  };
  facts.type = pickType(facts);
  return facts;
}

/** M（別人の疑い）。「変わらないはずの項目」が動いているか、Δの向きがそろっていないか。 */
function looksLikeMismatch(rows, byId, deltaItems, rules) {
  for (const [testId, rule] of Object.entries(rules.stable_tests || {})) {
    const row = byId.get(testId);
    if (!row || row.value === null || row.previous === null || row.previous === undefined) continue;
    if (rule.abs !== undefined && Math.abs(row.value - row.previous) >= rule.abs) return true;
    if (row.previous !== 0) {
      const ratio = row.value / row.previous;
      if (rule.ratio_low !== undefined && ratio <= rule.ratio_low) return true;
      if (rule.ratio_high !== undefined && ratio >= rule.ratio_high) return true;
    }
  }
  // Δ のある項目が2つ以上あって、上がるものと下がるものが混ざっている
  if (rules.mixed_delta_directions && deltaItems.length >= 2) {
    const dirs = new Set(deltaItems.map((id) => {
      const r = byId.get(id);
      return r.value > r.previous ? 'up' : 'down';
    }));
    if (dirs.size > 1) return true;
  }
  return false;
}

/** 前回値がすでに、いまと同じ向きに基準範囲の外だったか。 */
function alreadyAbnormal(row) {
  if (!row || row.previous === null || row.previous === undefined || !row.reference) return false;
  const { low, high } = row.reference;
  if (high !== undefined && row.value > high) return row.previous > high;
  if (low !== undefined && row.value < low) return row.previous < low;
  return false;
}

/** 鍵の項目。判断を決めている項目にマークと疑いを付けさせる（§1）。 */
function pickKey({ rows, byId, M, A2, A1, artifact, P, D, panicItems, deltaItems, flagged }) {
  if (M) {
    // 指紋の項目。動いているほうを採る
    const mcv = byId.get('MCV');
    if (mcv && mcv.previous !== null && mcv.previous !== undefined) return 'MCV';
  }
  if ((A2 || A1) && artifact && artifact.key && byId.has(artifact.key)) return artifact.key;
  if (P) return panicItems[0];
  if (D) return deltaItems[0];
  return strongestFlag(rows);
}

/** 最も強いフラグの項目。HH / LL を H / L より先に採る。無ければ null。 */
function strongestFlag(rows) {
  const panic = rows.find((r) => r.panic);
  if (panic) return panic.id;
  const flagged = rows.find((r) => r.flag);
  return flagged ? flagged.id : null;
}

/** 事実 → 正解の型（§2）。優先は M > A₂ > P > D > A₁ > N。 */
function pickType(f) {
  if (f.R) return 'T8';
  if (f.M) return 'T7';
  if (f.A2) return f.X ? 'T5' : 'T4';
  if (f.P) {
    if (f.A1) return f.X ? 'T5' : 'T5b';
    return 'T3';
  }
  if (f.D) return 'T6';
  if (f.A1) return 'T2';
  return f.moderate ? 'T2' : 'T1';
}

/* ---- 2. 正解の操作 ---- */

/**
 * 事実から正解の六つ組を組む（§2）。
 *   level / recheck / comment（要るか） / marks（要る項目） / suspects（key に付ける疑い） / actions
 *   marksAllowed … ここに無い項目をマークすると O7。null なら不問
 */
export function correctOperation(facts) {
  const key = facts.key;
  const withKey = (suspects) => (key ? { [key]: suspects } : {});
  const artifactSuspect = facts.artifactSuspect;
  const base = {
    type: facts.type, key,
    level: 'routine', recheck: false, comment: false, commentMust: [],
    marks: key ? [key] : [], suspects: {}, actions: [],
    marksAllowed: null,
  };

  switch (facts.type) {
    case 'T1':
      // 異常なし、または軽いH/Lが一行。マークするならフラグの点いた行まで
      return { ...base, marks: [], marksAllowed: facts.flagged };
    case 'T2':
      return {
        ...base, comment: true,
        suspects: withKey(artifactSuspect ? ['real', artifactSuspect] : ['real']),
        marksAllowed: facts.flagged,
      };
    case 'T3':
      // 緊急報告に並べるのはパニック値の項目だけ
      return {
        ...base, level: 'emergency',
        suspects: withKey(['real']), marksAllowed: facts.panicItems,
      };
    case 'T4':
      // 値は出さない。まず採り直す
      return {
        ...base, recheck: true,
        suspects: withKey(artifactSuspect ? [artifactSuspect] : []),
        marksAllowed: facts.flagged,
      };
    case 'T5':
      return {
        ...base, level: 'emergency', recheck: true, comment: true,
        suspects: withKey(artifactSuspect ? ['real', artifactSuspect] : ['real']),
        actions: ['call'], marksAllowed: facts.panicItems,
      };
    case 'T5b':
      // P と A₁ だが X が無い（値が患者由来だと裏が取れていない）。
      // hospital.json の「検体不良が疑われる値はそのまま緊急報告しない」に合わせて至急＋再採血
      return {
        ...base, level: 'urgent', recheck: true, comment: true,
        suspects: withKey(artifactSuspect ? [artifactSuspect] : []),
        actions: ['call'], marksAllowed: facts.panicItems,
      };
    case 'T6':
      return {
        ...base, level: 'urgent', comment: true,
        suspects: withKey(['delta']),
        actions: facts.A1 ? ['idcheck', 'call'] : ['idcheck'],
        marksAllowed: facts.flagged,
      };
    case 'T7':
      // 取り違えのコメントが要る。疑いタブは検査室の中の見立てで、医師には届かない
      return {
        ...base, level: 'urgent', recheck: true, comment: true, commentMust: ['mismatch'],
        suspects: withKey(['mismatch']), actions: ['idcheck', 'call'],
        marksAllowed: null,
      };
    case 'T8':
      return {
        ...base, level: facts.firstLevel || 'emergency', comment: true,
        commentMust: ['recollect_same'],
        suspects: withKey(['real']), marksAllowed: facts.flagged,
      };
    default:
      return base;
  }
}

/* ---- 3. ずれの種類と評価 ---- */

/**
 * ずれの一覧（§3）。**上から順に見て最初に当たったもの**で評価する。
 * poor（患者に害が及ぶ向き）が先、ok（向きは合っていて何かが欠けた）が後。
 * どれにも当たらなければ best。
 */
const DEVIATIONS = [
  // ---- poor ----
  {
    id: 'P1', score: 'poor',
    headline: () => 'パニック値を通常報告にしています',
    hit: (f, op, c) => f.P && c.level !== 'routine' && op.level === 'routine',
  },
  {
    id: 'P2', score: 'poor',
    headline: () => '壊れた検体の値で電話をかけています',
    hit: (f, op) => f.A2 && !f.X && op.level === 'emergency' && !op.recheck,
  },
  {
    id: 'P3', score: 'poor',
    headline: () => '検体状態に触れないまま報告しています',
    // 壊れた検体を採り直しもせず通常報告で流した。コメントの有無は問わない
    // （何か書いてあっても、値はそのまま医師に届いている）。
    // 至急・緊急で出したものは O10（再採血まで出したい）で受ける
    hit: (f, op) => f.A2 && !op.recheck && op.level === 'routine',
  },
  {
    id: 'P4', score: 'poor',
    headline: () => '別人の値を、患者の変化として報告しています',
    // 値を止めたことになるのは「取り違えのコメントを添えた」ときだけ。
    // 疑いタブは検査室の中の見立てで、医師には届かない。
    // 通常報告なら再採血で止めたことになる（値を出していないため）
    hit: (f, op) => f.M && !commentIds(op).has('mismatch')
      && (op.level !== 'routine' || !op.recheck),
  },
  {
    id: 'P5', score: 'poor',
    headline: () => '再検の理由がありません',
    hit: (f, op) => !f.A && !f.D && !f.M && !f.P && op.recheck,
  },
  {
    id: 'P6', score: 'poor',
    headline: () => '過剰報告です',
    hit: (f, op) => !f.P && !f.D && !f.M && !f.A && op.level !== 'routine',
  },
  {
    id: 'P7', score: 'poor',
    headline: () => 'Δを見落としています',
    // コメントを添えても、Δ のある値を通常報告で流したことは変わらない。
    // 再採血で止めた操作は O8（報告が先）で受ける
    hit: (f, op) => f.D && !f.M && op.level === 'routine' && !op.recheck,
  },
  {
    id: 'P8', score: 'poor',
    headline: () => '否定されて報告レベルを下げています',
    hit: (f, op) => f.R && levelRank(op.level) < levelRank(f.firstLevel || 'emergency'),
  },
  // ---- ok ----
  {
    id: 'O1', score: 'ok',
    headline: () => 'そのコメントは事実に合いません',
    hit: (f, op) => contradictingComment(f, op),
  },
  {
    id: 'O2', score: 'ok',
    headline: () => '届いてはいます。ただしパニック値は電話で読み返しまで取ります',
    hit: (f, op, c) => f.P && c.level === 'emergency' && op.level === 'urgent',
  },
  {
    // 再採血が要る型（T4・T5・T5b・T7）で再採血が欠けた。
    // 報告レベルのずれ（O3）より先に見る——採り直していれば値は止まるので、
    // 「一段上の回線を使った」より「止めていない」ほうが重い
    id: 'O10', score: 'ok',
    headline: () => 'あと一歩、再採血まで出しておきたい場面です',
    hit: (f, op, c) => c.recheck && !op.recheck,
  },
  {
    id: 'O3', score: 'ok',
    headline: () => '向きは正しい。ただしHHでない値に緊急回線を使っています',
    hit: (f, op, c) => levelRank(op.level) > levelRank(c.level),
  },
  {
    id: 'O4', score: 'ok',
    headline: (f, op, c) => {
      const missing = c.actions.filter((a) => !actionsOf(op).includes(a));
      return `判断は適切。ただし${missing.map((a) => ACTION_NAME[a] || a).join('と')}で裏を取っていません`;
    },
    hit: (f, op, c) => c.actions.some((a) => !actionsOf(op).includes(a)),
  },
  {
    id: 'O5', score: 'ok',
    headline: () => '報告は適切。ただし理由がコメントに残っていません',
    hit: (f, op, c) => c.comment && !commented(op),
  },
  {
    id: 'O6', score: 'ok',
    headline: (f) => `${f.key || '鍵の項目'}に疑いが付いていません`,
    hit: (f, op, c) => missesKey(op, c),
  },
  {
    id: 'O7', score: 'ok',
    headline: (f, op, c) => (c.level === 'emergency'
      ? '緊急報告に項目を並べすぎです'
      : '異常のない項目をマークしています'),
    hit: (f, op, c) => c.marksAllowed !== null
      && marksOf(op).some((id) => !c.marksAllowed.includes(id)),
  },
  {
    id: 'O8', score: 'ok',
    headline: () => '再採血の判断は分かります。ただし報告が先です',
    hit: (f, op, c) => c.level !== 'routine' && op.level === 'routine' && op.recheck,
  },
  {
    id: 'O9', score: 'ok',
    headline: () => '報告は正しい。ただしこの検体に再検の理由はありません',
    hit: (f, op, c) => op.recheck && !c.recheck,
  },
];

/** コメントの種類が事実と食い違っているか（O1）。 */
function contradictingComment(facts, op) {
  const picked = commentIds(op);
  const has = (id) => [...picked].some((x) => x === id || String(x).startsWith(`${id}:`));
  if (has('delta') && !facts.D) return true;
  if (has('continued') && facts.D) return true;
  if (has('mismatch') && !facts.M) return true;
  for (const id of ['hemolysis', 'clot', 'dilution']) {
    if (has(id) && !facts.A) return true;
  }
  // 検体トラブルがあっても値は患者由来（X）のときは、トラブルだけ書いて終わらせない
  if (facts.X && ['hemolysis', 'clot', 'dilution'].some(has) && !has('real')) return true;
  return false;
}

/** 鍵の項目にマークと疑いが付いているか（O6）。 */
function missesKey(op, correct) {
  if (!correct.marks.length) return false;
  const marks = marksOf(op);
  for (const testId of correct.marks) {
    if (!marks.includes(testId)) return true;
    const want = correct.suspects[testId] || [];
    const picked = suspectsOn(op, testId);
    if (!want.length) { if (!picked.length) return true; continue; }
    if (!want.every((s) => picked.includes(s))) return true;
  }
  return false;
}

/**
 * 判定（§3）。事実と操作から評価・ずれの記号・見出しを返す。
 * `choices` を持たない症例（生成症例）だけがここを通る。
 */
export function judge(facts, operation) {
  const correct = correctOperation(facts);
  const op = operation || {};
  for (const dev of DEVIATIONS) {
    if (!dev.hit(facts, op, correct)) continue;
    return {
      score: dev.score,
      deviation: dev.id,
      headline: dev.headline(facts, op, correct),
      key: facts.key,
      correct,
    };
  }
  return {
    score: 'best', deviation: null, headline: '適切な報告です', key: facts.key, correct,
  };
}

/** その事実に対する「ずれの無い操作」。テストと、生成症例の見本づくりに使う。 */
export function bestOperation(facts) {
  const c = correctOperation(facts);
  return {
    level: c.level,
    recheck: c.recheck,
    comment: c.comment
      ? (c.commentMust.length ? c.commentMust : ['sample_state_clear'])
        .map((id) => ({ id, templateId: id }))
      : [],
    marks: [...c.marks],
    suspects: JSON.parse(JSON.stringify(c.suspects)),
    actions: [...c.actions],
    readback: c.level === 'emergency',
  };
}
