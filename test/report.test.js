// 判定構造（症例JSONの choices）のテスト。

import { test, eq } from './harness.js';
import {
  evaluate, evaluateFollowup, worseScore, commentTemplateIds, hasComment, SCORE_LABEL,
} from '../src/report.js';
import { resolveMessages, filterBySpeaker } from '../src/messages.js';

const SCORES = ['best', 'ok', 'poor'];

/** 報告ダイアログが作るのと同じ形の選択を組み立てる。 */
function pick(level, opts = {}) {
  return {
    level,
    comment: '',
    recheck: false,
    readback: level === 'emergency',
    marks: [],
    suspects: {},
    ...opts,
  };
}

const ids = (reply) => [].concat(reply ?? []);

/** 一本目と二本目、両方の枝。二本立てでない症例では choices だけ。 */
function allBranches(caseDef) {
  return [...caseDef.choices, ...((caseDef.followup && caseDef.followup.choices) || [])];
}

/**
 * その症例で試すマークの組み合わせ。
 * 「何もマークしない」「症例が名指ししている項目だけ」「そこに関係ない項目を足したもの」の3通り。
 */
function markSetsFor(caseDef) {
  const named = new Set();
  for (const branch of allBranches(caseDef)) {
    const when = branch.when || {};
    for (const id of [].concat(when.marks?.must || [], when.marks?.forbid || [])) named.add(id);
    for (const testId of Object.keys(when.suspects || {})) {
      if (testId !== 'exact') named.add(testId);
    }
  }
  const key = [...named];
  const noise = ['WBC', 'Na', 'Cl'].filter((id) => !named.has(id));
  const sets = [[], key, [...key, ...noise]];
  return [...new Map(sets.map((m) => [m.join(','), m])).values()];
}

/**
 * コメントの選び方。候補のタップで組むので、中身は候補オブジェクトの配列。
 * 文字列は旧い自由記述ぶんの互換確認。
 */
const COMMENT_CHOICES = [
  '',
  'コメント',
  [],
  [{ id: 'real:K', templateId: 'real', text: 'K：本物の異常と判断' }],
  [
    { id: 'real:K', templateId: 'real', text: 'K：本物の異常と判断' },
    { id: 'recollect_same:K', templateId: 'recollect_same', text: 'K：再採血で同値（6.2）' },
  ],
];

/** その症例で試す操作の総当たり。報告レベル × 再検 × コメントの選び方 × マーク × 疑い。 */
function combosFor(caseDef, suspectIds, comments = COMMENT_CHOICES) {
  const list = [];
  for (const marks of markSetsFor(caseDef)) {
    for (const suspects of suspectSetsFor(marks, suspectIds)) {
      for (const level of ['routine', 'urgent', 'emergency']) {
        for (const recheck of [false, true]) {
          for (const comment of comments) {
            list.push(pick(level, { recheck, comment, marks, suspects }));
          }
        }
      }
    }
  }
  return list;
}

function labelOf(caseId, choice, tag = '') {
  return (
    `${caseId}${tag} ${choice.level} recheck=${choice.recheck} ` +
    `comment=${JSON.stringify(commentTemplateIds(choice))} marks=[${choice.marks}] ` +
    `suspects=${JSON.stringify(choice.suspects)}`
  );
}

/** マークした項目に付ける疑いの組み合わせ。1つずつと、本物＋溶血の重ね付け。 */
function suspectSetsFor(marks, suspectIds) {
  if (!marks.length) return [{}];
  const patterns = [[], ...suspectIds.map((id) => [id]), ['real', 'hemolysis']];
  return patterns.map((picked) =>
    Object.fromEntries(marks.map((testId) => [testId, picked])),
  );
}

export function suite(data) {
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));
  const messageIds = new Set(Object.keys(data.messages.messages));
  const mentorIds = data.mentors.mentors.map((m) => m.id);

  // ---- 仕組み ----
  test('evaluate: choices を上から見て最初に当たった枝を返す', () => {
    const caseDef = {
      choices: [
        { when: { report: 'routine' }, score: 'best', headline: '上', reply: 'a' },
        { when: { report: 'routine' }, score: 'poor', headline: '下', reply: 'b' },
      ],
    };
    const res = evaluate(caseDef, pick('routine'));
    eq(res.headline, '上');
    eq(res.messageId, 'a');
  });

  test('evaluate: when に書かれていない項目は不問', () => {
    const caseDef = {
      choices: [{ when: { report: 'urgent' }, score: 'ok', headline: 'x', reply: 'm' }],
    };
    eq(evaluate(caseDef, pick('urgent', { recheck: true })).score, 'ok');
    eq(evaluate(caseDef, pick('urgent', { comment: 'なにか' })).score, 'ok');
  });

  test('evaluate: 空の when はすべてに当たる', () => {
    const caseDef = { choices: [{ when: {}, score: 'poor', headline: 'x', reply: 'm' }] };
    for (const level of ['routine', 'urgent', 'emergency']) {
      eq(evaluate(caseDef, pick(level)).score, 'poor', level);
    }
  });

  test('evaluate: コメントは有無だけを見る（空白だけは「なし」）', () => {
    const caseDef = {
      choices: [
        { when: { comment: true }, score: 'best', headline: 'あり', reply: 'a' },
        { when: {}, score: 'ok', headline: 'なし', reply: 'b' },
      ],
    };
    eq(evaluate(caseDef, pick('routine', { comment: '溶血あり' })).headline, 'あり');
    eq(evaluate(caseDef, pick('routine', { comment: '   ' })).headline, 'なし');
    eq(evaluate(caseDef, pick('routine')).headline, 'なし');
  });

  test('evaluate: marks は must / max / forbid だけを見る', () => {
    const caseDef = {
      choices: [
        { when: { marks: { must: ['K'], max: 1 } }, score: 'best', headline: 'Kだけ', reply: 'a' },
        { when: { marks: { must: ['K'] } }, score: 'ok', headline: 'Kと他', reply: 'b' },
        { when: { marks: { forbid: ['CRP'] } }, score: 'ok', headline: 'CRPなし', reply: 'c' },
        { when: {}, score: 'poor', headline: '受け皿', reply: 'd' },
      ],
    };
    eq(evaluate(caseDef, pick('routine', { marks: ['K'] })).headline, 'Kだけ');
    eq(evaluate(caseDef, pick('routine', { marks: ['K', 'Cre'] })).headline, 'Kと他');
    eq(evaluate(caseDef, pick('routine', { marks: [] })).headline, 'CRPなし');
    eq(evaluate(caseDef, pick('routine', { marks: ['CRP'] })).headline, '受け皿');
  });

  test('evaluate: marks を書かない枝はマークを不問にする（既存の枝がそのまま動く）', () => {
    const caseDef = { choices: [{ when: { report: 'routine' }, score: 'best', headline: 'x' }] };
    eq(evaluate(caseDef, pick('routine')).score, 'best');
    eq(evaluate(caseDef, pick('routine', { marks: ['K', 'Hb', 'CRP'] })).score, 'best');
  });

  test('evaluate: suspects は指定した疑いが付いていれば一致、指定外は不問', () => {
    const caseDef = {
      choices: [
        { when: { suspects: { K: ['hemolysis'] } }, score: 'best', headline: '溶血', reply: 'a' },
        { when: {}, score: 'poor', headline: '受け皿', reply: 'b' },
      ],
    };
    eq(evaluate(caseDef, pick('routine', { suspects: { K: ['hemolysis'] } })).headline, '溶血');
    eq(evaluate(caseDef, pick('routine', { suspects: { K: ['real', 'hemolysis'] } })).headline, '溶血');
    eq(evaluate(caseDef, pick('routine', { suspects: { K: ['real'] } })).headline, '受け皿');
    eq(evaluate(caseDef, pick('routine')).headline, '受け皿');
  });

  test('evaluate: suspects の exact:true は厳密一致にする', () => {
    const caseDef = {
      choices: [
        { when: { suspects: { K: ['hemolysis'], exact: true } }, score: 'best', headline: '溶血だけ' },
        { when: {}, score: 'poor', headline: '受け皿' },
      ],
    };
    eq(evaluate(caseDef, pick('routine', { suspects: { K: ['hemolysis'] } })).headline, '溶血だけ');
    eq(evaluate(caseDef, pick('routine', { suspects: { K: ['hemolysis', 'real'] } })).headline, '受け皿');
  });

  test('evaluate: comment は true/false なら「一行以上あるか」だけを見る', () => {
    const caseDef = {
      choices: [
        { when: { comment: true }, score: 'best', headline: 'あり' },
        { when: {}, score: 'ok', headline: 'なし' },
      ],
    };
    const line = { id: 'real:K', templateId: 'real', text: 'K：本物の異常と判断' };
    eq(evaluate(caseDef, pick('routine', { comment: [line] })).headline, 'あり', '候補を選んだ');
    eq(evaluate(caseDef, pick('routine', { comment: [] })).headline, 'なし', '一つも選んでいない');
    eq(evaluate(caseDef, pick('routine', { comment: '自由記述' })).headline, 'あり', '旧い文字列');
    eq(evaluate(caseDef, pick('routine', { comment: '   ' })).headline, 'なし', '空白だけ');
    eq(hasComment(pick('routine', { comment: [line] })), true);
    eq(hasComment(pick('routine')), false);
  });

  test('evaluate: comment を配列で書くと、指定の候補が全部選ばれたときだけ一致', () => {
    const caseDef = {
      choices: [
        { when: { comment: ['recollect_same'] }, score: 'best', headline: '同値を書いた' },
        { when: { comment: true }, score: 'ok', headline: '何か書いた' },
        { when: {}, score: 'poor', headline: 'なし' },
      ],
    };
    const same = { templateId: 'recollect_same', text: 'K：再採血で同値（6.2）' };
    const real = { templateId: 'real', text: 'K：本物の異常と判断' };
    eq(evaluate(caseDef, pick('routine', { comment: [same] })).headline, '同値を書いた');
    eq(evaluate(caseDef, pick('routine', { comment: [real, same] })).headline, '同値を書いた', '他が混ざっても可');
    eq(evaluate(caseDef, pick('routine', { comment: [real] })).headline, '何か書いた', '指定のものがない');
    eq(evaluate(caseDef, pick('routine', { comment: ['recollect_same'] })).headline, '同値を書いた', 'IDの配列でも可');
    eq(commentTemplateIds(pick('routine', { comment: [real, same] })).join(','), 'real,recollect_same');
  });

  test('evaluate: 二つ以上を指定した配列は、全部そろって初めて一致', () => {
    const caseDef = {
      choices: [
        { when: { comment: ['real', 'recollect_same'] }, score: 'best', headline: '両方' },
        { when: {}, score: 'ok', headline: '片方以下' },
      ],
    };
    const same = { templateId: 'recollect_same' };
    const real = { templateId: 'real' };
    eq(evaluate(caseDef, pick('routine', { comment: [real, same] })).headline, '両方');
    eq(evaluate(caseDef, pick('routine', { comment: [real] })).headline, '片方以下');
    eq(evaluate(caseDef, pick('routine', { comment: [same] })).headline, '片方以下');
  });

  test('evaluate: comment の { must, any, forbid }', () => {
    const caseDef = {
      choices: [
        { when: { comment: { must: ['hemolysis'], forbid: ['real'] } }, score: 'ok', headline: '溶血だけ' },
        { when: { comment: { any: ['clot', 'dilution'] } }, score: 'ok', headline: '検体側のどれか' },
        { when: {}, score: 'best', headline: '受け皿' },
      ],
    };
    const opt = (templateId, testId) => ({ id: `${templateId}:${testId}`, templateId, text: templateId });
    const hemo = opt('hemolysis', 'K');
    const real = opt('real', 'K');
    eq(evaluate(caseDef, pick('routine', { comment: [hemo] })).headline, '溶血だけ');
    eq(evaluate(caseDef, pick('routine', { comment: [hemo, real] })).headline, '受け皿', 'forbid に当たる');
    eq(evaluate(caseDef, pick('routine', { comment: [real] })).headline, '受け皿', 'must がない');
    eq(evaluate(caseDef, pick('routine', { comment: [opt('clot', 'PLT')] })).headline, '検体側のどれか');
    eq(evaluate(caseDef, pick('routine', { comment: [opt('dilution', 'Na')] })).headline, '検体側のどれか');
    eq(evaluate(caseDef, pick('routine', { comment: [] })).headline, '受け皿', 'any が一つもない');
  });

  test('evaluate: 素のIDは「どの項目でも」、項目付きのIDは「その項目で」', () => {
    const caseDef = {
      choices: [
        { when: { comment: { must: ['continued:Hb'] } }, score: 'ok', headline: 'Hbで継続' },
        { when: { comment: { must: ['continued'] } }, score: 'ok', headline: 'どれかで継続' },
        { when: {}, score: 'best', headline: '受け皿' },
      ],
    };
    const line = (testId) => ({ id: `continued:${testId}`, templateId: 'continued', text: testId });
    eq(evaluate(caseDef, pick('routine', { comment: [line('Hb')] })).headline, 'Hbで継続');
    eq(evaluate(caseDef, pick('routine', { comment: [line('K')] })).headline, 'どれかで継続');
    eq(evaluate(caseDef, pick('routine', { comment: [] })).headline, '受け皿');
  });

  test('evaluate: どれにも当たらなければ poor で落とす', () => {
    const res = evaluate({ choices: [{ when: { report: 'urgent' }, score: 'best', headline: 'x' }] }, pick('routine'));
    eq(res.score, 'poor');
    eq(res.messageId, null);
  });

  // ---- 症例ごとの判定（mechanics.md 3 の表） ----
  test('症例n01: 通常報告＋マーク0が最善。何かマークすると許容に落ちる', () => {
    eq(evaluate(caseById.n01, pick('routine')).score, 'best');
    eq(ids(evaluate(caseById.n01, pick('routine')).messageId).join(','),
       'msg_n01_ok_kanae,msg_n01_ok_yusuke');
    const marked = evaluate(caseById.n01, pick('routine', { marks: ['CRP'] }));
    eq(marked.score, 'ok', '異常のない項目をマークした通常報告');
    eq(marked.messageId, null, '講評は付けず医師の返信だけで閉じる');
    eq(evaluate(caseById.n01, pick('urgent')).score, 'poor');
    eq(evaluate(caseById.n01, pick('emergency')).score, 'poor');
    eq(evaluate(caseById.n01, pick('routine', { recheck: true })).score, 'poor');
  });

  test('症例n02: マーク0でもCRPだけでも最善。CRPに本物の異常を付けてもよい', () => {
    const c = caseById.n02;
    eq(evaluate(c, pick('routine')).score, 'best', 'マーク0');
    eq(evaluate(c, pick('routine', { marks: ['CRP'] })).score, 'best', 'CRPのみ');
    eq(evaluate(c, pick('routine', { marks: ['CRP'], suspects: { CRP: ['real'] } })).score,
       'best', 'CRPに本物の異常');
    eq(evaluate(c, pick('routine', { marks: ['CRP', 'WBC'] })).score, 'ok', '基準内まで拾った');
    eq(evaluate(c, pick('emergency')).score, 'poor');
    eq(ids(evaluate(c, pick('emergency')).messageId).join(','),
       'msg_n02_over_kanae,msg_n02_over_yusuke');
  });

  test('症例n03: Hbをマークして本物の異常を付け、コメント付きで通常報告が最善', () => {
    const c = caseById.n03;
    const full = { comment: '小球性低色素性。', marks: ['Hb'], suspects: { Hb: ['real'] } };
    eq(evaluate(c, pick('routine', full)).score, 'best');
    eq(ids(evaluate(c, pick('routine', full)).messageId).join(','),
       'msg_n03_ok_kanae,msg_n03_ok_yusuke');
    // 小球性は一項目では言えない。何本まとめてマークしても最善のまま
    eq(evaluate(c, pick('routine', { ...full, marks: ['Hb', 'MCV', 'MCH'] })).score,
       'best', 'MCV・MCHも一緒にマークしてよい');
    eq(evaluate(c, pick('routine', { ...full, marks: ['Hb', 'MCV', 'MCH', 'RBC', 'Ht'] })).score,
       'best', 'マークの本数では減点しない');

    // コメントは付けたが、どこを見たのかが残っていない二つの形
    const noMark = evaluate(c, pick('routine', { comment: '小球性低色素性。' }));
    eq(noMark.score, 'ok');
    eq(noMark.headline, 'Hbに印がありません');
    const noSuspect = evaluate(c, pick('routine', { comment: '小球性低色素性。', marks: ['Hb'] }));
    eq(noSuspect.score, 'ok');
    eq(noSuspect.headline, 'Hbに疑いが付いていません');
    const otherMark = evaluate(c, pick('routine', { comment: '小球性低色素性。', marks: ['MCV'] }));
    eq(otherMark.headline, 'Hbに印がありません', 'Hb以外だけをマークした場合');
    // 台詞は増やしていない（この二本は医師の返信だけ）
    for (const res of [noMark, noSuspect, otherMark]) eq(res.messageId, null);

    const thin = evaluate(c, pick('routine', { marks: ['Hb'], suspects: { Hb: ['real'] } }));
    eq(thin.score, 'ok');
    eq(ids(thin.messageId).join(','), 'msg_n03_ok_nocomment_kanae,msg_n03_ok_nocomment_yusuke');
    eq(evaluate(c, pick('urgent')).score, 'poor');
  });

  test('症例n04: Kだけをマークして本物の異常を付け、緊急報告が最善', () => {
    const c = caseById.n04;
    const best = evaluate(c, pick('emergency', { marks: ['K'], suspects: { K: ['real'] } }));
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n04_ok_kanae,msg_n04_ok_yusuke');

    const many = evaluate(c, pick('emergency', {
      marks: ['K', 'BUN', 'Cre', 'HCO3', 'Hb'],
      suspects: { K: ['real'] },
    }));
    eq(many.score, 'ok', 'K以外も一緒にマークした緊急報告');
    eq(ids(many.messageId).join(','), 'msg_n04_many_kanae,msg_n04_many_yusuke');

    eq(evaluate(c, pick('emergency', { marks: ['K'] })).score, 'ok', '疑いを選んでいない');
    eq(evaluate(c, pick('emergency')).score, 'ok', 'マークなしの緊急報告');
    eq(evaluate(c, pick('emergency', { recheck: true, marks: ['K'], suspects: { K: ['real'] } })).score,
       'ok', '不要な再検');
    eq(evaluate(c, pick('urgent', { marks: ['K'], suspects: { K: ['real'] } })).score, 'ok');
    eq(evaluate(c, pick('routine', { marks: ['K'], suspects: { K: ['real'] } })).score, 'poor');
  });

  test('症例n05: Kをマークして溶血を疑い、再採血を出すのが最善', () => {
    const c = caseById.n05;
    const hemolysis = { marks: ['K'], suspects: { K: ['hemolysis'] } };
    const best = evaluate(c, pick('routine', { recheck: true, ...hemolysis }));
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n05_ok_kanae,msg_n05_ok_yusuke');

    eq(evaluate(c, pick('routine', { recheck: true })).score, 'ok', '疑いを選ばない再採血');
    eq(evaluate(c, pick('emergency', { recheck: true, ...hemolysis })).score, 'ok');
    eq(evaluate(c, pick('urgent', { comment: '溶血3+のため参考値', ...hemolysis })).score, 'ok');

    const real = evaluate(c, pick('emergency', { marks: ['K'], suspects: { K: ['real'] } }));
    eq(real.score, 'poor', '本物の異常と決めて電話をかけた');
    eq(ids(real.messageId).join(','), 'msg_n05_over_kanae,msg_n05_over_yusuke');
    eq(evaluate(c, pick('routine')).score, 'poor');
    eq(evaluate(c, pick('urgent')).score, 'poor', '溶血に触れない至急報告');
  });

  test('症例n05b: 最善は「緊急報告＋コメント＋再採血＋Kに本物の異常と溶血」の一本だけ', () => {
    const c = caseById.n05b;
    const note = '溶血2+。前回K 5.8、Cre 3.2。';
    const both = { marks: ['K'], suspects: { K: ['real', 'hemolysis'] } };
    eq(c.choices.filter((b) => b.score === 'best').length, 1, '最善の枝の数');

    const best = evaluate(c, pick('emergency', { recheck: true, comment: note, ...both }));
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n05b_ok_kanae,msg_n05b_ok_yusuke');

    eq(evaluate(c, pick('emergency', { recheck: true, comment: note })).score,
       'ok', '見立てを残していない');
    eq(evaluate(c, pick('emergency', {
      recheck: true, comment: note, marks: ['K'], suspects: { K: ['hemolysis'] },
    })).score, 'ok', '溶血だけで本物を選んでいない');

    eq(evaluate(c, pick('urgent', { recheck: true, comment: note, ...both })).score,
       'ok', 'HHを至急に落とした');
    eq(evaluate(c, pick('emergency', both)).score, 'ok', '緊急報告のみ');
    eq(evaluate(c, pick('routine', { recheck: true, ...both })).score, 'poor', '再採血のみで報告なし');
    eq(evaluate(c, pick('routine')).score, 'poor');
  });

  test('症例n05b: 溶血だけを疑って再採血で止めると要改善', () => {
    const res = evaluate(caseById.n05b, pick('routine', {
      recheck: true, marks: ['K'], suspects: { K: ['hemolysis'] },
    }));
    eq(res.score, 'poor');
    eq(ids(res.messageId).join(','),
       'msg_n05b_recheck_only_kanae,msg_n05b_recheck_only_yusuke');
  });

  test('症例n05b: 至急＋再採血の講評は症例4の至急報告ぶんを流用する', () => {
    const res = evaluate(caseById.n05b, pick('urgent', {
      recheck: true, comment: '溶血2+', marks: ['K'], suspects: { K: ['real', 'hemolysis'] },
    }));
    eq(ids(res.messageId).join(','), 'msg_n04_urgent_kanae,msg_n04_urgent_yusuke');
    eq(res.doctorId, 'msg_n05b_urgent_only');
  });

  test('症例n06: Hbをマークして乖離を疑い、コメント付きの至急報告が最善', () => {
    const c = caseById.n06;
    const note = '前回13.5から急激な低下、黒色便あり';
    const delta = { marks: ['Hb'], suspects: { Hb: ['delta'] } };
    const best = evaluate(c, pick('urgent', { comment: note, ...delta }));
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n06_ok_kanae,msg_n06_ok_yusuke');
    eq(best.doctorId, 'msg_n06_doctor_ok');

    eq(evaluate(c, pick('urgent', {
      comment: note, marks: ['Hb'], suspects: { Hb: ['real', 'delta'] },
    })).score, 'best', '本物の異常を一緒に付けてもよい');
    eq(evaluate(c, pick('urgent', { comment: note })).score, 'ok', 'マークなし');
    eq(evaluate(c, pick('emergency', { comment: note, ...delta })).score, 'ok', 'HHでない値に緊急回線');

    const mismatch = evaluate(c, pick('routine', {
      recheck: true, marks: ['Hb'], suspects: { Hb: ['mismatch'] },
    }));
    eq(mismatch.score, 'ok', '取り違えを疑って再採血');
    eq(ids(mismatch.messageId).join(','), 'msg_n06_recheck_kanae,msg_n06_recheck_yusuke');

    const bad = evaluate(c, pick('routine', delta));
    eq(bad.score, 'poor');
    eq(ids(bad.messageId).join(','), 'msg_n06_routine_kanae,msg_n06_routine_yusuke');
    eq(bad.doctorId, 'msg_n06_doctor_poor');
  });

  test('症例n07: 一本目の緊急報告は症例を閉じず、医師の差し戻しだけが返る', () => {
    const c = caseById.n07;
    const res = evaluate(c, pick('emergency', { marks: ['K'], suspects: { K: ['real'] } }));
    eq(res.then, 'followup');
    eq(res.cap, 'best');
    eq(res.score, null, '差し戻しの枝は score を持たない');
    eq(res.messageId, null, '講評は二本目まで出さない');
    eq(res.doctorId, 'msg_n07_doctor_pushback');
  });

  test('症例n07: 一本目の判断の甘さが cap になる', () => {
    const c = caseById.n07;
    eq(evaluate(c, pick('emergency', { marks: ['K'], suspects: { K: ['real'] } })).cap, 'best');
    eq(evaluate(c, pick('emergency', { marks: ['K'] })).cap, 'ok', '疑いを選んでいない');
    eq(evaluate(c, pick('emergency', { marks: ['K', 'BUN', 'Cre'], suspects: { K: ['real'] } })).cap,
       'ok', 'K以外も並べた');
    eq(evaluate(c, pick('urgent')).cap, 'ok', 'HHを至急に落とした');
  });

  test('症例n07: 報告しなかった一本目は差し戻しに届かず、その場で閉じる', () => {
    const c = caseById.n07;
    const recheckOnly = evaluate(c, pick('routine', { recheck: true }));
    eq(recheckOnly.then, null);
    eq(recheckOnly.score, 'poor');
    eq(recheckOnly.doctorId, 'msg_n07_doctor_late_recheck');

    const routine = evaluate(c, pick('routine'));
    eq(routine.then, null);
    eq(routine.score, 'poor');
    eq(routine.doctorId, 'msg_n07_doctor_late_routine');
  });

  test('症例n07: 二本目はKをマークして本物の異常、コメント付きの緊急報告が最善', () => {
    const c = caseById.n07;
    // 二本目の最善は「再採血で同値」を選んだところまで見る（docs/comment-list.md）
    const same = { id: 'recollect_same:K', templateId: 'recollect_same', text: 'K：再採血で同値（6.2）' };
    const again = { comment: [same], marks: ['K'], suspects: { K: ['real'] } };
    const best = evaluateFollowup(c, pick('emergency', again), 'best');
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n07_ok_kanae,msg_n07_ok_yusuke');
    eq(best.doctorId, 'msg_n07_doctor_ok');

    const thin = evaluateFollowup(c, pick('emergency', { marks: ['K'], suspects: { K: ['real'] } }), 'best');
    eq(thin.score, 'ok', 'コメントなし');
    eq(thin.messageId, null);

    const other = [{ id: 'real:K', templateId: 'real', text: 'K：本物の異常と判断' }];
    const off = evaluateFollowup(c, pick('emergency', { ...again, comment: other }), 'best');
    eq(off.score, 'ok', '何か書いただけでは足りない（同値と書いたかを見る）');

    const down = evaluateFollowup(c, pick('urgent', again), 'best');
    eq(down.score, 'poor', '医師に否定されてレベルを下げた');
    eq(ids(down.messageId).join(','), 'msg_n07_down_kanae,msg_n07_down_yusuke');
    eq(down.doctorId, 'msg_n07_doctor_poor_down');

    const wait = evaluateFollowup(c, pick('routine', { recheck: true }), 'best');
    eq(wait.score, 'poor', '三本目を採らせた');
    eq(ids(wait.messageId).join(','), 'msg_n07_wait_kanae,msg_n07_wait_yusuke');
    eq(wait.doctorId, 'msg_n07_doctor_poor_wait');
  });

  test('症例n07: 最終評価は min（二本目の score、一本目の cap）', () => {
    const c = caseById.n07;
    const bestFirst = { marks: ['K'], suspects: { K: ['real'] } };
    const many = { marks: ['K', 'Na', 'BUN', 'Cre', 'CRP'], suspects: { K: ['real'] } };
    const bestSecond = {
      comment: [{ id: 'recollect_same:K', templateId: 'recollect_same', text: 'K：再採血で同値（6.2）' }],
      marks: ['K'],
      suspects: { K: ['real'] },
    };

    // docs/case07.md 4-3 の表をそのまま
    const table = [
      [pick('emergency', bestFirst), pick('emergency', bestSecond), 'best'],
      [pick('emergency', bestFirst), pick('emergency', bestFirst), 'ok'],
      [pick('urgent'), pick('emergency', bestSecond), 'ok'],
      [pick('emergency', many), pick('emergency', bestSecond), 'ok'],
      [pick('emergency', bestFirst), pick('urgent', bestSecond), 'poor'],
      [pick('urgent'), pick('urgent', bestSecond), 'poor'],
    ];
    for (const [first, second, expected] of table) {
      const r1 = evaluate(c, first);
      eq(r1.then, 'followup', `${first.level} が差し戻しに入らない`);
      const r2 = evaluateFollowup(c, second, r1.cap);
      eq(r2.score, expected, `一本目 ${first.level}/cap ${r1.cap} → 二本目 ${second.level}`);
    }
    // 通常報告は差し戻しに届かないまま poor で閉じる
    eq(evaluate(c, pick('routine')).score, 'poor');
  });

  test('worseScore: 悪いほうを採る', () => {
    eq(worseScore('best', 'best'), 'best');
    eq(worseScore('best', 'ok'), 'ok');
    eq(worseScore('ok', 'best'), 'ok');
    eq(worseScore('poor', 'best'), 'poor');
    eq(worseScore('best', 'poor'), 'poor');
    eq(worseScore('ok', null), 'ok', 'cap がなければそのまま');
  });

  test('症例5と5-b: 同じ「溶血」でも最善の手が変わる', () => {
    const hemolysis = { recheck: true, marks: ['K'], suspects: { K: ['hemolysis'] } };
    eq(evaluate(caseById.n05, pick('routine', hemolysis)).score, 'best', 'n05は再採血だけで足りる');
    eq(evaluate(caseById.n05b, pick('routine', hemolysis)).score, 'poor', 'n05bは黙って待たせない');
  });

  // ---- 症例JSONの形 ----
  test('全症例: choices の最後は when が空の受け皿になっている', () => {
    for (const c of data.cases) {
      eq(Array.isArray(c.choices), true, `${c.id} に choices がない`);
      const last = c.choices[c.choices.length - 1];
      eq(Object.keys(last.when || {}).length, 0, `${c.id} の最後の枝が受け皿になっていない`);
    }
  });

  test('全症例: score・headline・医師の返信がそろっている', () => {
    for (const c of data.cases) {
      for (const branch of allBranches(c)) {
        // then を持つ枝は症例を閉じないので score を持たない（判定は二本目でする）
        eq(branch.then ? branch.score === undefined : SCORES.includes(branch.score), true,
           `${c.id} の score: ${branch.score}`);
        eq(typeof branch.headline, 'string', `${c.id} の headline`);
        eq(messageIds.has(branch.doctor), true, `${c.id} の医師返信 ${branch.doctor} が messages にない`);
        for (const id of ids(branch.reply)) {
          eq(messageIds.has(id), true, `${c.id} の講評 ${id} が messages にない`);
        }
      }
    }
  });

  test('全症例: 医師の返信は speaker なしの共通文', () => {
    for (const c of data.cases) {
      for (const branch of allBranches(c)) {
        const doctor = data.messages.messages[branch.doctor];
        eq(doctor.speaker, undefined, `${c.id} の ${branch.doctor} に speaker がある`);
        eq(doctor.kind, 'reply', `${c.id} の ${branch.doctor} の kind`);
      }
    }
  });

  test('全症例: recollect の到着メッセージが実在する', () => {
    for (const c of data.cases) {
      if (!c.recollect) continue;
      eq(typeof c.recollect.accession, 'string', `${c.id} の再採血受付番号`);
      eq(messageIds.has(c.recollect.reply), true, `${c.id} の ${c.recollect.reply} が messages にない`);
    }
  });

  test('全症例: best の枝が必ずある（二本立ての症例は二本目に）', () => {
    for (const c of data.cases) {
      eq(allBranches(c).some((b) => b.score === 'best'), true, `${c.id} に best がない`);
    }
  });

  test('全症例: choices の最後の受け皿は followup 側にもある', () => {
    for (const c of data.cases) {
      if (!c.followup) continue;
      const last = c.followup.choices[c.followup.choices.length - 1];
      eq(Object.keys(last.when || {}).length, 0, `${c.id} の followup の最後が受け皿になっていない`);
    }
  });

  test('全症例: followup の枝に then を書かない（入れ子にしない）', () => {
    for (const c of data.cases) {
      for (const branch of (c.followup && c.followup.choices) || []) {
        eq(branch.then, undefined, `${c.id} の followup に then が書かれている`);
      }
    }
  });

  test('全症例: then を持つ枝は followup を持つ症例にだけあり、cap が正しい', () => {
    for (const c of data.cases) {
      for (const branch of c.choices) {
        if (!branch.then) continue;
        eq(branch.then, 'followup', `${c.id} の then`);
        eq(Boolean(c.followup), true, `${c.id} に followup がない`);
        eq(SCORES.includes(branch.cap), true, `${c.id} の cap: ${branch.cap}`);
        eq(branch.reply, null, `${c.id} の then の枝に講評が付いている（講評は最後に一度だけ）`);
      }
    }
  });

  test('全症例: followup の文面（指導役の一言・受付の記録）が実在する', () => {
    for (const c of data.cases) {
      if (!c.followup) continue;
      for (const mentorId of mentorIds) {
        const shown = filterBySpeaker(resolveMessages(data, c.followup.handover), mentorId);
        eq(shown.length, 1, `${c.id} の差し戻し後の一言 (${mentorId})`);
      }
      const re = c.followup.recollect;
      eq(typeof re.accession, 'string', `${c.id} の二本目の受付番号`);
      eq(typeof re.received_at, 'string', `${c.id} の二本目の採取時刻`);
      if (re.reply) eq(messageIds.has(re.reply), true, `${c.id} の ${re.reply} が messages にない`);
    }
  });

  test('全症例: マークと疑いを含めた全操作で、医師の返信が必ず届く', () => {
    const suspectIds = data.suspects.suspects.map((s) => s.id);
    const seen = new Set();
    let combos = 0;
    for (const c of data.cases) {
      for (const choice of combosFor(c, suspectIds)) {
        combos += 1;
        const res = evaluate(c, choice);
        const label = () => labelOf(c.id, choice);

        if (res.then) {
          // 差し戻し。症例は閉じないので score を持たず、講評も出さない
          eq(res.score, null, `${label()} の score`);
          eq(res.messageId, null, `${label()} に講評が付いている`);
          eq(messageIds.has(res.doctorId), true, `${label()} の医師返信`);
          continue;
        }
        eq(SCORES.includes(res.score), true, label());
        eq(messageIds.has(res.doctorId), true, `${label()} の医師返信`);
        if (!res.messageId || seen.has(res.matched)) continue;
        seen.add(res.matched);
        for (const mentorId of mentorIds) {
          const shown = filterBySpeaker(resolveMessages(data, res.messageId), mentorId);
          eq(shown.length, 1, `${label()} の講評 (${mentorId})`);
        }
      }
    }
    eq(combos > 1000, true, `組み合わせ数が少なすぎる: ${combos}`);
  });

  test('二本立ての症例: 一本目 × 二本目 の総当たりで最終評価が min になる', () => {
    const suspectIds = data.suspects.suspects.map((s) => s.id);
    const seen = new Set();
    let combos = 0;
    for (const c of data.cases) {
      if (!c.followup) continue;
      const firsts = combosFor(c, suspectIds);
      const seconds = combosFor(c, suspectIds);
      for (const first of firsts) {
        const r1 = evaluate(c, first);
        if (!r1.then) continue;
        for (const second of seconds) {
          combos += 1;
          const res = evaluateFollowup(c, second, r1.cap);
          if (SCORES.includes(res.score) && res.score === worseScore(res.branchScore, r1.cap)) {
            if (!res.messageId || seen.has(res.matched)) continue;
            seen.add(res.matched);
            for (const mentorId of mentorIds) {
              const shown = filterBySpeaker(resolveMessages(data, res.messageId), mentorId);
              eq(shown.length, 1, `${labelOf(c.id, second, '(二本目)')} の講評 (${mentorId})`);
            }
            eq(messageIds.has(res.doctorId), true, `${labelOf(c.id, second, '(二本目)')} の医師返信`);
            continue;
          }
          // ここに来たら失敗。ラベルはこのときだけ組み立てる
          eq(SCORES.includes(res.score), true, labelOf(c.id, second, '(二本目)'));
          eq(res.score, worseScore(res.branchScore, r1.cap),
             `${labelOf(c.id, first, '(一本目)')} → ${labelOf(c.id, second, '(二本目)')} の最終評価`);
        }
      }
    }
    eq(combos > 10000, true, `一本目 × 二本目 の組み合わせが少なすぎる: ${combos}`);
  });

  test('全症例: comment: true の判定は、自由記述でも候補でも同じ枝に落ちる', () => {
    const line = { id: 'real:K', templateId: 'real', text: 'K：本物の異常と判断' };
    for (const c of data.cases) {
      const marks = markSetsFor(c)[1] || [];
      const suspects = Object.fromEntries(marks.map((m) => [m, ['real', 'hemolysis', 'delta']]));
      for (const level of ['routine', 'urgent', 'emergency']) {
        for (const recheck of [false, true]) {
          const base = { recheck, marks, suspects };
          const text = evaluate(c, pick(level, { ...base, comment: 'コメント' }));
          const picked = evaluate(c, pick(level, { ...base, comment: [line] }));
          const label = `${c.id} ${level} recheck=${recheck}`;
          eq(picked.headline, text.headline, `${label} の枝`);
          eq(picked.score, text.score, `${label} の評価`);
          if (!c.followup) continue;
          const capText = evaluateFollowup(c, pick(level, { ...base, comment: 'コメント' }), 'best');
          const capPick = evaluateFollowup(c, pick(level, { ...base, comment: [line] }), 'best');
          eq(capPick.headline, capText.headline, `${label} の二本目`);
        }
      }
    }
  });

  test('外れの所見: 症例3〜6の枝は best より上にあり、外れを選ぶと当たる', () => {
    const opt = (templateId, testId) => ({ id: `${templateId}:${testId}`, templateId, text: templateId });
    const table = [
      ['n03', 'routine', { comment: [opt('delta', 'Hb')], marks: ['Hb'], suspects: { Hb: ['real'] } },
        '急な変化ではありません', 'msg_comment_off'],
      ['n04', 'emergency', { comment: [opt('hemolysis', 'K')], marks: ['K'], suspects: { K: ['real'] } },
        '検体に問題はありません', 'msg_comment_off_emergency'],
      ['n06', 'urgent', { comment: [opt('continued', 'Hb')], marks: ['Hb'], suspects: { Hb: ['delta'] } },
        '継続ではなく変化です', 'msg_comment_off'],
    ];
    for (const [caseId, level, choice, headline, doctor] of table) {
      const c = caseById[caseId];
      const at = c.choices.findIndex((b) => b.headline === headline);
      const best = c.choices.findIndex((b) => b.score === 'best');
      eq(at >= 0 && at < best, true, `${caseId} の外れの枝が best より上にない`);
      const res = evaluate(c, pick(level, choice));
      eq(res.headline, headline, `${caseId} で外れの枝に当たらない`);
      eq(res.score, 'ok', `${caseId} は減点しすぎない`);
      eq(res.doctorId, doctor, `${caseId} の医師の返信`);
      eq(ids(res.messageId).length, 2, `${caseId} の講評が指導役ぶんそろっていない`);
    }
  });

  test('外れの所見: 症例5-bは「溶血だけ書いて本物を書かない」を拾う', () => {
    const c = caseById.n05b;
    const opt = (templateId) => ({ id: `${templateId}:K`, templateId, text: templateId });
    const both = { marks: ['K'], suspects: { K: ['real', 'hemolysis'] }, recheck: true };
    const at = c.choices.findIndex((b) => b.headline === '溶血だけでは説明がつきません');
    eq(at >= 0 && at < c.choices.findIndex((b) => b.score === 'best'), true, 'best より上にない');

    const only = evaluate(c, pick('emergency', { ...both, comment: [opt('hemolysis')] }));
    eq(only.headline, '溶血だけでは説明がつきません');
    eq(only.score, 'ok');
    eq(only.doctorId, 'msg_n05b_emergency_recheck', '値は伝わっているので医師の返信は best と同じ');

    const written = evaluate(c, pick('emergency', { ...both, comment: [opt('hemolysis'), opt('real')] }));
    eq(written.score, 'best', '両方書けば最善のまま');
  });

  test('全症例: comment の条件は真偽値・配列・{must, any, forbid} のどれか。IDは一覧に実在する', () => {
    const templateIds = new Set(data.commentTemplates.templates.map((t) => t.id));
    const testIds = new Set(data.tests.tests.map((t) => t.id));
    const okId = (id) => {
      const [templateId, testId] = String(id).split(':');
      return templateIds.has(templateId) && (testId === undefined || testIds.has(testId));
    };
    for (const c of data.cases) {
      for (const branch of allBranches(c)) {
        const expected = (branch.when || {}).comment;
        if (expected === undefined) continue;
        if (typeof expected === 'boolean') continue;
        const rule = Array.isArray(expected) ? { must: expected } : expected;
        eq(typeof rule, 'object', `${c.id} の comment 条件`);
        for (const key of Object.keys(rule)) {
          eq(['must', 'any', 'forbid'].includes(key), true, `${c.id} の comment に知らない条件 ${key}`);
          for (const id of rule[key]) eq(okId(id), true, `${c.id} の comment に知らない候補ID ${id}`);
        }
      }
    }
  });

  test('全症例: choices が参照する項目IDと疑いIDが実在する', () => {
    const testIds = new Set(data.tests.tests.map((t) => t.id));
    const suspectIds = new Set(data.suspects.suspects.map((s) => s.id));
    for (const c of data.cases) {
      for (const branch of c.choices) {
        const marks = (branch.when || {}).marks || {};
        for (const id of [].concat(marks.must || [], marks.forbid || [])) {
          eq(testIds.has(id), true, `${c.id} の marks に未定義の項目 ${id}`);
        }
        for (const [testId, wanted] of Object.entries((branch.when || {}).suspects || {})) {
          if (testId === 'exact') continue;
          eq(testIds.has(testId), true, `${c.id} の suspects に未定義の項目 ${testId}`);
          for (const s of [].concat(wanted)) {
            eq(suspectIds.has(s), true, `${c.id} の suspects に未定義の疑い ${s}`);
          }
        }
      }
    }
  });

  test('疑いのIDと表示名がそろっている（mechanics.md の6つ）', () => {
    const ids2 = data.suspects.suspects.map((s) => s.id).join(',');
    eq(ids2, 'real,hemolysis,clot,dilution,mismatch,delta');
    for (const s of data.suspects.suspects) {
      eq(typeof s.label, 'string', `${s.id} の表示名`);
      eq(typeof s.hint, 'string', `${s.id} の説明`);
    }
  });

  test('割り込み: 参照先の症例と文面がすべて実在する', () => {
    const caseIds = new Set(data.cases.map((c) => c.id));
    for (const c of data.cases) {
      const cut = c.interrupt;
      if (!cut) continue;
      eq(caseIds.has(cut.case), true, `${c.id} の割り込み先 ${cut.case} がない`);
      eq(cut.case !== c.id, true, `${c.id} が自分自身に割り込んでいる`);
      eq(typeof cut.after_ms, 'number', `${c.id} の割り込みまでの時間`);
      for (const id of [].concat(cut.message, cut.nav, cut.pending)) {
        eq(messageIds.has(id), true, `${c.id} の割り込み文面 ${id} が messages にない`);
      }
      // 指導役つきの台詞は、どちらを選んでも1本だけ出ること
      for (const key of ['nav', 'pending']) {
        for (const mentorId of mentorIds) {
          const shown = filterBySpeaker(resolveMessages(data, cut[key]), mentorId);
          eq(shown.length, 1, `${c.id} の割り込み ${key} (${mentorId})`);
        }
      }
    }
  });

  test('割り込み: 新人研修では症例3の1回だけ', () => {
    const withCutIn = data.cases.filter((c) => c.interrupt).map((c) => c.id);
    eq(withCutIn.join(','), 'n03');
  });

  test('全症例: 旧構造（correct / outcome）が残っていない', () => {
    for (const c of data.cases) {
      eq(c.correct, undefined, `${c.id} に correct が残っている`);
      eq(c.outcome, undefined, `${c.id} に outcome が残っている`);
    }
  });

  test('SCORE_LABEL: 3段階すべてに表示名がある', () => {
    for (const s of SCORES) eq(typeof SCORE_LABEL[s], 'string', s);
  });
}
