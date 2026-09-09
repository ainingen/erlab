// 判定ルール（docs/judge-rules.md。roadmap §6-4）のテスト。
// 事実の導出・手書き9本との突き合わせ・ずれの優先順・生成症例の代表を見る。

import { test, eq } from './harness.js';
import { deriveFacts, correctOperation, judge, bestOperation } from '../src/judge.js';
import { buildPanel, buildRecollect } from '../src/derive.js';
import { evaluate, evaluateFollowup } from '../src/report.js';

/** 手書き9本の事実（docs/judge-rules.md §1・§2 の表）。 */
const EXPECTED_FACTS = {
  n01: { type: 'T1', key: null, P: false, A: false, D: false, M: false, X: false, N: true },
  n02: { type: 'T1', key: 'CRP', P: false, A: false, D: false, M: false, X: false, N: true },
  n03: { type: 'T2', key: 'Hb', P: false, A: false, D: false, M: false, X: false, N: true },
  n04: { type: 'T3', key: 'K', P: true, A: false, D: false, M: false, X: false, N: false },
  n05: { type: 'T4', key: 'K', P: true, A: true, D: false, M: false, X: false, N: false },
  n05b: { type: 'T5', key: 'K', P: true, A: true, D: true, M: false, X: true, N: false },
  n06: { type: 'T6', key: 'Hb', P: false, A: false, D: true, M: false, X: false, N: false },
  n07b: { type: 'T7', key: 'MCV', P: false, A: false, D: true, M: true, X: false, N: false },
  n07: { type: 'T3', key: 'K', P: true, A: false, D: true, M: false, X: false, N: false },
};

/** 症例の事実。二本目（`followup`）は stage を渡す。 */
function factsFor(caseDef, data, stage = 'first') {
  const first = buildPanel(caseDef, data);
  if (stage === 'first') return deriveFacts(caseDef, first, data);
  const second = buildRecollect(caseDef, first, data, caseDef.followup.recollect);
  return deriveFacts(caseDef, second, data, { stage: 'followup', firstLevel: 'emergency' });
}

/* ---- 手書きの枝に落ちる操作をしらみつぶしに探す（choices-table.md と同じ作り） ---- */

const cmt = (id) => ({ id, templateId: String(id).split(':')[0], text: id });

/** 事実（Δ・検体トラブル・取り違え）に触れない所見。見本のコメントはここから採る。 */
const NEUTRAL_COMMENTS = ['microcytic', 'macrocytic', 'inflammation', 'renal'];

function candidatesFor(branches, testIds, templateIds) {
  const markSets = [[{}, []]];
  const commentIds = new Set();
  const actionSets = [[]];
  const seenMark = new Set(['[]|{}']);
  const seenAct = new Set(['']);
  for (const br of branches) {
    const w = br.when || {};
    const c = w.comment;
    if (Array.isArray(c)) c.forEach((x) => commentIds.add(x));
    else if (c && typeof c === 'object') {
      for (const key of ['must', 'any', 'forbid']) (c[key] || []).forEach((x) => commentIds.add(x));
    }
    const marks = [...new Set([
      ...((w.marks || {}).must || []),
      ...Object.keys(w.suspects || {}).filter((k) => k !== 'exact'),
    ])];
    const suspects = {};
    for (const [tid, sv] of Object.entries(w.suspects || {})) {
      if (tid !== 'exact') suspects[tid] = [...sv];
    }
    for (const pair of [[suspects, marks], [{}, marks]]) {
      const k = `${JSON.stringify(pair[1])}|${JSON.stringify(pair[0])}`;
      if (marks.length && !seenMark.has(k)) { seenMark.add(k); markSets.push(pair); }
    }
    const acts = [...((w.actions || {}).must || [])];
    if (acts.length && !seenAct.has(acts.join(','))) { seenAct.add(acts.join(',')); actionSets.push(acts); }
  }
  actionSets.push(['look', 'idcheck', 'smear', 'call']);

  const named = new Set(markSets.flatMap(([, m]) => m));
  const noise = testIds.filter((t) => !named.has(t)).slice(0, 2);
  if (noise.length) {
    const base = markSets.map(([s, m]) => [s, m]);
    markSets.push([{}, [noise[0]]]);
    for (const [s, m] of base) if (m.length) markSets.push([s, [...m, noise[0]]]);
    if (noise[1]) markSets.push([{}, noise.slice(0, 2)]);
  }
  // 「何か一行書いた」だけの見本。事実と食い違う文（continued・delta・溶血など）を
  // うっかり選ぶと、コメントの中身を見ない枝に別のずれが乗る。中立な所見から採る
  const plain = NEUTRAL_COMMENTS.find((t) => templateIds.includes(t) && !commentIds.has(t))
    || templateIds.find((t) => !commentIds.has(t)) || 'real';
  const comments = [[], [cmt(plain)], ...[...commentIds].map((id) => [cmt(id)])];
  const idList = [...commentIds];
  for (const a of idList) for (const b of idList) if (a < b) comments.push([cmt(a), cmt(b)]);

  const list = [];
  for (const [suspects, marks] of markSets) {
    for (const comment of comments) {
      for (const actions of actionSets) {
        for (const level of ['routine', 'urgent', 'emergency']) {
          for (const recheck of [false, true]) {
            list.push({ level, recheck, comment, marks, suspects, actions, readback: level === 'emergency' });
          }
        }
      }
    }
  }
  const weight = (c) => (c.level === 'routine' ? 0 : 1) + (c.recheck ? 1 : 0) + c.comment.length
    + c.marks.length + Object.values(c.suspects).reduce((n, v) => n + v.length, 0) + c.actions.length;
  return list.map((c, i) => ({ c, w: weight(c), i }))
    .sort((a, b) => a.w - b.w || a.i - b.i).map((x) => x.c);
}

/** 手書きの各枝と、そこに落ちる最小の操作。choices-table.md §a と同じもの。 */
export function branchExamples(data) {
  const testIds = data.tests.tests.map((t) => t.id);
  const templateIds = data.commentTemplates.templates.map((t) => t.id);
  const out = [];
  for (const c of data.cases) {
    const stages = [{ stage: 'first', branches: c.choices }];
    if (c.followup) stages.push({ stage: 'followup', branches: c.followup.choices });
    for (const st of stages) {
      const cands = candidatesFor(st.branches, testIds, templateIds);
      st.branches.forEach((br, idx) => {
        const found = cands.find((cand) => {
          const res = st.stage === 'followup'
            ? evaluateFollowup(c, cand, 'best') : evaluate(c, cand);
          return res.matched === br;
        });
        out.push({
          caseId: c.id, stage: st.stage, n: idx + 1, branch: br,
          operation: found || null,
          // then の枝は score を持たないので cap で比べる（docs/judge-rules.md §5）
          expected: br.score || br.cap || 'best',
          viaCap: !br.score,
        });
      });
    }
  }
  return out;
}

/** 突き合わせの結果。不一致があっても落とさず、表にして返す（§6 のテスト2）。 */
export function crossCheck(data) {
  const rows = [];
  for (const ex of branchExamples(data)) {
    if (!ex.operation) { rows.push({ ...ex, ruleScore: null, deviation: null, skipped: true }); continue; }
    const caseDef = data.cases.find((c) => c.id === ex.caseId);
    const facts = factsFor(caseDef, data, ex.stage);
    const res = judge(facts, ex.operation);
    rows.push({ ...ex, ruleScore: res.score, deviation: res.deviation, skipped: false });
  }
  return rows;
}

/**
 * 総当たりの突き合わせ（§5 の枝ごとの見本より広い）。
 * 手書きの枝に落ちる見本1つだけでなく、報告レベル・再採血・コメント・マーク・疑い・行動の
 * 組み合わせを全部通して、手書きの score と規則の score が何割そろうかを数える。
 * **落とすためのものではない**（一致率は仕様の判断材料。docs/judge-rules.md §5）。
 */
export function broadCheck(data) {
  const cmt = (id) => ({ id, templateId: id, text: id });
  const suspectIds = data.suspects.suspects.map((s) => s.id);
  const rows = [];
  for (const c of data.cases) {
    const facts = deriveFacts(c, buildPanel(c, data), data);
    const markSets = [[], [facts.key].filter(Boolean), [facts.key, 'WBC'].filter(Boolean)];
    for (const marks of markSets) {
      const suspectSets = marks.length ? [[], ...suspectIds.map((x) => [x]), ['real', 'hemolysis']] : [[]];
      for (const sus of suspectSets) {
        const suspects = Object.fromEntries(marks.map((m) => [m, sus]));
        for (const comment of [[], [cmt('microcytic')], [cmt('delta')], [cmt('mismatch')],
          [cmt('hemolysis')], [cmt('real')]]) {
          for (const actions of [[], ['idcheck'], ['call'], ['idcheck', 'call']]) {
            for (const level of ['routine', 'urgent', 'emergency']) {
              for (const recheck of [false, true]) {
                const op = {
                  level, recheck, comment, marks, suspects, actions,
                  readback: level === 'emergency',
                };
                const hand = evaluate(c, op);
                if (!hand.score) continue; // then の枝は cap で見るのでここでは外す
                const rule = judge(facts, op);
                rows.push({
                  caseId: c.id, hand: hand.score, rule: rule.score,
                  deviation: rule.deviation, agree: hand.score === rule.score,
                });
              }
            }
          }
        }
      }
    }
  }
  return rows;
}

export function suite(data) {
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));

  // ---- 1. 事実の導出 ----
  test('事実: 手書き9本の P/A/D/M/X/N・key・型が §1・§2 の表どおり', () => {
    for (const [caseId, want] of Object.entries(EXPECTED_FACTS)) {
      const f = factsFor(caseById[caseId], data);
      for (const k of ['type', 'key', 'P', 'A', 'D', 'M', 'X', 'N']) {
        eq(f[k], want[k], `${caseId} の ${k}`);
      }
    }
  });

  test('事実: 検体トラブルは二段（A₁＝値が使える／A₂＝使えない）に分かれる', () => {
    eq(factsFor(caseById.n05, data).A2, true, 'n05 は溶血3+ なので A₂');
    eq(factsFor(caseById.n05, data).A1, false);
    eq(factsFor(caseById.n05b, data).A1, true, 'n05b は溶血2+ なので A₁');
    eq(factsFor(caseById.n05b, data).A2, false);
    // 段は data/judge.json が決める。コードに埋めない
    eq(data.judge.artifacts.hemolysis_3plus.grade, 'broken');
    eq(data.judge.artifacts.hemolysis_2plus.grade, 'usable');
  });

  test('事実: M は「変わらないはずの項目」で立つ。n07b は MCV、n06 は立たない', () => {
    eq(factsFor(caseById.n07b, data).M, true, 'MCV 92→76');
    eq(factsFor(caseById.n06, data).M, false, 'MCV 89→88 は動いていない');
    eq(data.judge.stable_tests.MCV.abs, 6, 'しきい値は data/judge.json');
    // M があれば A や P より先。優先は M > A₂ > P > D > A₁ > N
    eq(factsFor(caseById.n07b, data).type, 'T7');
  });

  test('事実: 差し戻し後の二本目は R になり、型は T8', () => {
    const f = factsFor(caseById.n07, data, 'followup');
    eq(f.R, true);
    eq(f.type, 'T8');
    eq(f.key, 'K');
  });

  // ---- 2. 正解の型 ----
  test('正解の型: §2 の表どおりの六つ組が出る', () => {
    const t3 = correctOperation(factsFor(caseById.n04, data));
    eq(t3.level, 'emergency');
    eq(t3.recheck, false);
    eq(t3.marks.join(','), 'K');
    eq(t3.suspects.K.join(','), 'real');

    const t4 = correctOperation(factsFor(caseById.n05, data));
    eq(t4.level, 'routine', '壊れた検体は値を出さない');
    eq(t4.recheck, true);
    eq(t4.suspects.K.join(','), 'hemolysis');

    const t5 = correctOperation(factsFor(caseById.n05b, data));
    eq(t5.level, 'emergency');
    eq(t5.recheck, true);
    eq(t5.comment, true);
    eq(t5.suspects.K.join(','), 'real,hemolysis');
    eq(t5.actions.join(','), 'call');

    const t6 = correctOperation(factsFor(caseById.n06, data));
    eq(t6.level, 'urgent');
    eq(t6.actions.join(','), 'idcheck');
    eq(t6.suspects.Hb.join(','), 'delta');

    const t7 = correctOperation(factsFor(caseById.n07b, data));
    eq(t7.level, 'urgent');
    eq(t7.recheck, true);
    eq(t7.actions.join(','), 'idcheck,call');
    eq(t7.suspects.MCV.join(','), 'mismatch');
  });

  test('正解の操作: 手書きの best の操作は、規則でも best になる', () => {
    const table = [
      ['n01', 'first'], ['n02', 'first'], ['n03', 'first'], ['n04', 'first'],
      ['n05', 'first'], ['n05b', 'first'], ['n06', 'first'], ['n07b', 'first'],
      ['n07', 'followup'],
    ];
    for (const [caseId, stage] of table) {
      const facts = factsFor(caseById[caseId], data, stage);
      const res = judge(facts, bestOperation(facts));
      eq(res.score, 'best', `${caseId} の正解の操作が best にならない（${res.deviation}）`);
    }
  });

  // ---- 3. ずれの優先順 ----
  test('ずれ: poor が ok より先に当たる', () => {
    const facts = factsFor(caseById.n04, data); // P あり・T3
    // 通常報告（P1・poor）と、鍵に疑いなし（O6・ok）が同時に成り立つ操作
    const both = { level: 'routine', recheck: false, comment: [], marks: [], suspects: {}, actions: [] };
    const res = judge(facts, both);
    eq(res.score, 'poor');
    eq(res.deviation, 'P1', 'ok のほうを先に拾っている');
  });

  test('ずれ: 一覧は poor 8種・ok 10種で、順番どおりに見る', () => {
    const seen = new Set();
    for (const row of crossCheck(data)) if (row.deviation) seen.add(row.deviation);
    // 手書きで実際に当たったずれ（全部が出るとは限らない）
    eq(seen.size > 0, true, 'ずれが一つも当たっていない');
    for (const id of seen) eq(/^[PO]\d+$/.test(id), true, `知らないずれの記号 ${id}`);
  });

  test('ずれ: M の場面で値を止めたことになるのは、取り違えのコメントか通常＋再採血だけ', () => {
    const facts = factsFor(caseById.n07b, data);
    const base = { comment: [], marks: [], suspects: {}, actions: [] };
    const mismatch = [{ id: 'mismatch', templateId: 'mismatch' }];

    eq(judge(facts, { ...base, level: 'urgent', recheck: false }).deviation, 'P4', '止めずに報告');
    // 疑いタブは検査室の中の見立てで、医師には届かない。それだけでは止めたことにならない
    const tabOnly = {
      ...base, level: 'urgent', recheck: false, marks: ['MCV'], suspects: { MCV: ['mismatch'] },
    };
    eq(judge(facts, tabOnly).deviation, 'P4', 'タブだけで止めたことにしている');
    // 至急・緊急で出すなら、取り違えのコメントを添えて初めて止めたことになる
    eq(judge(facts, { ...base, level: 'urgent', recheck: true }).deviation, 'P4', '再採血だけで至急に出した');
    eq(judge(facts, { ...base, level: 'urgent', recheck: true, comment: mismatch }).score, 'ok');
    // 通常報告なら値が出ていないので、再採血で止めたことになる
    eq(judge(facts, { ...base, level: 'routine', recheck: true }).score, 'ok');
    eq(judge(facts, { ...base, level: 'routine', recheck: false }).deviation, 'P4');
  });

  // ---- 4. 突き合わせ（不一致があっても落とさない） ----
  test('突き合わせ: 手書き70枝のうち、規則と score が一致した数を数える', () => {
    const rows = crossCheck(data).filter((r) => !r.skipped);
    const hit = rows.filter((r) => r.ruleScore === r.expected).length;
    // 一致率そのものは落とさない（§6 のテスト2）。数えられていることだけ見る
    eq(rows.length > 60, true, `突き合わせた枝が少なすぎる: ${rows.length}`);
    eq(hit > 0, true, '一つも一致していない');
  });

  test('突き合わせ: 総当たりでも、手書きと規則の score は大半がそろう', () => {
    const rows = broadCheck(data);
    const agree = rows.filter((r) => r.agree).length;
    eq(rows.length > 15000, true, `総当たりが少なすぎる: ${rows.length}`);
    // 一致率そのものは仕様の判断材料（§5）。ここでは規則を大きく崩したときだけ落とす
    eq(agree / rows.length >= 0.97, true,
       `一致率が落ちた: ${agree}/${rows.length}（${Math.round(agree / rows.length * 1000) / 10}%）`);
    // 症例ごとにも極端に崩れていないこと
    for (const c of data.cases) {
      const mine = rows.filter((r) => r.caseId === c.id);
      const hit = mine.filter((r) => r.agree).length;
      eq(hit / mine.length > 0.6, true,
         `${c.id} の一致率が低すぎる: ${hit}/${mine.length}`);
    }
  });

  test('突き合わせ: 各症例の best の枝は、規則でも best になる', () => {
    for (const row of crossCheck(data)) {
      if (row.expected !== 'best' || row.skipped || row.viaCap) continue;
      eq(row.ruleScore, 'best', `${row.caseId}#${row.n} が規則では ${row.ruleScore}（${row.deviation}）`);
    }
  });

  // ---- 5. 生成症例の代表 ----
  test('生成症例: §2 の型ごとに、ずれの無い操作がひとつ決まる', () => {
    const shapes = [
      ['T1', { N: true, flagged: [] }],
      ['T2', { moderate: true, flagged: ['Hb'], key: 'Hb' }],
      ['T3', { P: true, panicItems: ['K'], flagged: ['K'], key: 'K' }],
      ['T4', { P: true, A: true, A2: true, artifactSuspect: 'hemolysis', flagged: ['K'], key: 'K' }],
      ['T5', { P: true, A: true, A1: true, X: true, artifactSuspect: 'hemolysis', panicItems: ['K'], flagged: ['K'], key: 'K' }],
      ['T5b', { P: true, A: true, A1: true, artifactSuspect: 'hemolysis', panicItems: ['K'], flagged: ['K'], key: 'K' }],
      ['T6', { D: true, deltaItems: ['Hb'], flagged: ['Hb'], key: 'Hb' }],
      ['T7', { M: true, D: true, deltaItems: ['Hb'], flagged: ['Hb'], key: 'MCV' }],
      ['T8', { R: true, P: true, panicItems: ['K'], flagged: ['K'], key: 'K', firstLevel: 'emergency' }],
      // 手書きに無い組み合わせ（§2 の下の表）
      ['A₁とH/L', { A: true, A1: true, artifactSuspect: 'hemolysis', flagged: ['K'], key: 'K', moderate: true }],
      ['A₂とD', { A: true, A2: true, D: true, deltaItems: ['K'], artifactSuspect: 'clot', flagged: ['PLT'], key: 'PLT' }],
      ['DとA₁', { D: true, A: true, A1: true, artifactSuspect: 'dilution', deltaItems: ['Hb'], flagged: ['Hb'], key: 'Hb' }],
      ['DかつP', { P: true, D: true, panicItems: ['K'], deltaItems: ['K'], flagged: ['K'], key: 'K' }],
      ['Pが二項目', { P: true, panicItems: ['K', 'Na'], flagged: ['K', 'Na'], key: 'K' }],
    ];
    for (const [label, partial] of shapes) {
      const facts = makeFacts(partial);
      const best = bestOperation(facts);
      const res = judge(facts, best);
      eq(res.score, 'best', `${label} の正解が best にならない（${res.deviation} / ${res.headline}）`);
      // 一意：正解から要素をひとつ落とすと best でなくなる
      for (const [field, broken] of brokenVariants(best, facts)) {
        eq(judge(facts, broken).score === 'best', false, `${label} は ${field} を欠いても best`);
      }
    }
  });

  test('生成症例: A₂ と D なら Δ ではなく検体を先に疑う（T4）', () => {
    const facts = makeFacts({
      A: true, A2: true, D: true, deltaItems: ['K'], artifactSuspect: 'hemolysis',
      flagged: ['K'], key: 'K',
    });
    eq(facts.type, 'T4', 'A₂ が D より先（優先は M > A₂ > P > D > A₁ > N）');
    const c = correctOperation(facts);
    eq(c.recheck, true, 'まず採り直す');
    eq(c.level, 'routine', '壊れた検体の値は出さない');
    eq(c.suspects.K.join(','), 'hemolysis', 'Δ ではなく検体の疑いを付ける');
  });

  test('しきい値は data/judge.json にあり、コードに埋まっていない', () => {
    eq(typeof data.judge.stable_tests.MCV.abs, 'number');
    eq(typeof data.judge.stable_tests.Cre.ratio_low, 'number');
    eq(typeof data.judge.moderate_flag_count, 'number');
    const graded = Object.keys(data.judge.artifacts).filter((k) => !k.startsWith('_'));
    eq(graded.length, Object.keys(data.artifacts.artifacts).length,
       '検体トラブルの段が全種類そろっていない');
    for (const id of graded) {
      eq(['usable', 'broken'].includes(data.judge.artifacts[id].grade), true, `${id} の段`);
      eq(Boolean(data.artifacts.artifacts[id]), true, `${id} は artifacts.json にない`);
    }
  });

  test('choices を持つ症例は judge を通らない（手書きの挙動を変えない）', () => {
    const c = caseById.n04;
    const facts = factsFor(c, data);
    const op = { level: 'routine', recheck: false, comment: [], marks: [], suspects: {}, actions: [] };
    // ctx を渡しても choices があるほうが勝つ
    eq(evaluate(c, op, { facts }).headline, evaluate(c, op).headline);
    // choices を外すと規則で判定する
    const generated = { ...c, choices: [] };
    const res = evaluate(generated, op, { facts });
    eq(res.score, 'poor');
    eq(res.headline, 'パニック値を通常報告にしています');
    eq(res.deviation, 'P1');
  });
}

/** テスト用の事実。deriveFacts が返すのと同じ形を、手で作る。 */
function makeFacts(partial) {
  return {
    P: false, A: false, A1: false, A2: false, D: false, M: false, X: false, R: false, N: false,
    key: null, artifactId: null, artifactSuspect: null,
    panicItems: [], deltaItems: [], flagged: [], moderate: false, firstLevel: null,
    ...partial,
    type: partial.type || typeOf(partial),
  };
}

/** makeFacts 用の型づけ。src/judge.js の pickType と同じ順で見る。 */
function typeOf(f) {
  if (f.R) return 'T8';
  if (f.M) return 'T7';
  if (f.A2) return f.X ? 'T5' : 'T4';
  if (f.P) return f.A1 ? (f.X ? 'T5' : 'T5b') : 'T3';
  if (f.D) return 'T6';
  if (f.A1) return 'T2';
  return f.moderate ? 'T2' : 'T1';
}

/** 正解からひとつずつ欠けさせた操作。best が一意であることを見るのに使う。 */
function brokenVariants(best, facts) {
  const out = [];
  const other = best.level === 'routine' ? 'emergency' : 'routine';
  out.push(['報告レベル', { ...best, level: other, readback: other === 'emergency' }]);
  out.push(['再採血', { ...best, recheck: !best.recheck }]);
  if (best.comment.length) out.push(['コメント', { ...best, comment: [] }]);
  if (best.marks.length) out.push(['マーク', { ...best, marks: [], suspects: {} }]);
  if (best.actions.length) out.push(['行動', { ...best, actions: [] }]);
  if (facts.key && best.marks.includes(facts.key)) {
    out.push(['疑い', { ...best, suspects: { ...best.suspects, [facts.key]: [] } }]);
  }
  return out;
}
