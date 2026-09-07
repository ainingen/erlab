// 判定構造（症例JSONの choices）のテスト。

import { test, eq } from './harness.js';
import { evaluate, SCORE_LABEL } from '../src/report.js';
import { resolveMessages, filterBySpeaker } from '../src/messages.js';

const SCORES = ['best', 'ok', 'poor'];

/** 報告ダイアログが作るのと同じ形の選択を組み立てる。 */
function pick(level, opts = {}) {
  return { level, comment: '', recheck: false, readback: level === 'emergency', ...opts };
}

const ids = (reply) => [].concat(reply ?? []);

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

  test('evaluate: どれにも当たらなければ poor で落とす', () => {
    const res = evaluate({ choices: [{ when: { report: 'urgent' }, score: 'best', headline: 'x' }] }, pick('routine'));
    eq(res.score, 'poor');
    eq(res.messageId, null);
  });

  // ---- 症例ごとの判定 ----
  test('症例n01: 通常報告が最善、上げすぎも再検も要改善', () => {
    eq(evaluate(caseById.n01, pick('routine')).score, 'best');
    eq(ids(evaluate(caseById.n01, pick('routine')).messageId).join(','),
       'msg_n01_ok_kanae,msg_n01_ok_yusuke');
    eq(evaluate(caseById.n01, pick('urgent')).score, 'poor');
    eq(evaluate(caseById.n01, pick('emergency')).score, 'poor');
    eq(evaluate(caseById.n01, pick('routine', { recheck: true })).score, 'poor');
  });

  test('症例n02: 軽度のHは通常報告が最善、電話すると要改善', () => {
    eq(evaluate(caseById.n02, pick('routine')).score, 'best');
    eq(evaluate(caseById.n02, pick('emergency')).score, 'poor');
    eq(ids(evaluate(caseById.n02, pick('emergency')).messageId).join(','),
       'msg_n02_over_kanae,msg_n02_over_yusuke');
  });

  test('症例n03: コメントの有無で best と ok が分かれる', () => {
    eq(evaluate(caseById.n03, pick('routine', { comment: '小球性低色素性。' })).score, 'best');
    const thin = evaluate(caseById.n03, pick('routine'));
    eq(thin.score, 'ok');
    eq(ids(thin.messageId).join(','), 'msg_n03_ok_nocomment_kanae,msg_n03_ok_nocomment_yusuke');
    eq(evaluate(caseById.n03, pick('urgent')).score, 'poor');
  });

  test('症例n04: 緊急報告が最善、至急どまりと不要な再検は許容、通常報告は要改善', () => {
    const best = evaluate(caseById.n04, pick('emergency'));
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n04_ok_kanae,msg_n04_ok_yusuke');
    eq(evaluate(caseById.n04, pick('emergency', { recheck: true })).score, 'ok');
    eq(evaluate(caseById.n04, pick('urgent')).score, 'ok');
    eq(evaluate(caseById.n04, pick('routine')).score, 'poor');
  });

  test('症例n05: 再採血が最善、溶血した値での電話は要改善', () => {
    const best = evaluate(caseById.n05, pick('routine', { recheck: true }));
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n05_ok_kanae,msg_n05_ok_yusuke');
    eq(evaluate(caseById.n05, pick('emergency', { recheck: true })).score, 'ok');
    eq(evaluate(caseById.n05, pick('urgent', { comment: '溶血3+のため参考値' })).score, 'ok');
    eq(evaluate(caseById.n05, pick('emergency')).score, 'poor');
    eq(evaluate(caseById.n05, pick('routine')).score, 'poor');
    eq(evaluate(caseById.n05, pick('urgent')).score, 'poor', '溶血に触れない至急報告');
  });

  test('症例n05b: 最善は「緊急報告＋コメント＋再採血」の一本だけ', () => {
    const c = caseById.n05b;
    const note = '溶血2+。前回K 5.8、Cre 3.2。';
    eq(c.choices.filter((b) => b.score === 'best').length, 1, '最善の枝の数');

    const best = evaluate(c, pick('emergency', { recheck: true, comment: note }));
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n05b_ok_kanae,msg_n05b_ok_yusuke');

    eq(evaluate(c, pick('urgent', { recheck: true, comment: note })).score, 'ok', 'HHを至急に落とした');
    eq(evaluate(c, pick('emergency')).score, 'ok', '緊急報告のみ');
    eq(evaluate(c, pick('routine', { recheck: true })).score, 'poor', '再採血のみで報告なし');
    eq(evaluate(c, pick('routine')).score, 'poor');
  });

  test('症例n05b: 至急＋再採血の講評は症例4の至急報告ぶんを流用する', () => {
    const res = evaluate(caseById.n05b, pick('urgent', { recheck: true, comment: '溶血2+' }));
    eq(ids(res.messageId).join(','), 'msg_n04_urgent_kanae,msg_n04_urgent_yusuke');
    eq(res.doctorId, 'msg_n05b_urgent_only');
  });

  test('症例n06: 至急＋コメントが最善、Δを見落とした通常報告は要改善', () => {
    const c = caseById.n06;
    const note = '前回13.5から急激な低下、黒色便あり';
    const best = evaluate(c, pick('urgent', { comment: note }));
    eq(best.score, 'best');
    eq(ids(best.messageId).join(','), 'msg_n06_ok_kanae,msg_n06_ok_yusuke');
    eq(best.doctorId, 'msg_n06_doctor_ok');

    eq(evaluate(c, pick('emergency', { comment: note })).score, 'ok', 'HHでない値に緊急回線');
    eq(evaluate(c, pick('routine', { recheck: true })).score, 'ok', '再採血のみ');

    const bad = evaluate(c, pick('routine'));
    eq(bad.score, 'poor');
    eq(ids(bad.messageId).join(','), 'msg_n06_routine_kanae,msg_n06_routine_yusuke');
    eq(bad.doctorId, 'msg_n06_doctor_poor');
  });

  test('症例5と5-b: 同じ「溶血」でも最善の手が変わる', () => {
    const recheckOnly = pick('routine', { recheck: true });
    eq(evaluate(caseById.n05, recheckOnly).score, 'best', 'n05は再採血だけで足りる');
    eq(evaluate(caseById.n05b, recheckOnly).score, 'poor', 'n05bは黙って待たせない');
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
      for (const branch of c.choices) {
        eq(SCORES.includes(branch.score), true, `${c.id} の score: ${branch.score}`);
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
      for (const branch of c.choices) {
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

  test('全症例: best の枝が必ずある', () => {
    for (const c of data.cases) {
      eq(c.choices.some((b) => b.score === 'best'), true, `${c.id} に best がない`);
    }
  });

  test('全症例: どの操作でも医師の返信が必ず届く。講評は付く枝だけ、指導役ごとに1本', () => {
    for (const c of data.cases) {
      for (const level of ['routine', 'urgent', 'emergency']) {
        for (const recheck of [false, true]) {
          for (const comment of ['', 'コメント']) {
            const label = `${c.id} ${level} recheck=${recheck} comment=${Boolean(comment)}`;
            const res = evaluate(c, pick(level, { recheck, comment }));
            eq(SCORES.includes(res.score), true, label);
            eq(messageIds.has(res.doctorId), true, `${label} の医師返信`);
            if (!res.messageId) continue;
            for (const mentorId of mentorIds) {
              const shown = filterBySpeaker(resolveMessages(data, res.messageId), mentorId);
              eq(shown.length, 1, `${label} の講評 (${mentorId})`);
            }
          }
        }
      }
    }
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
