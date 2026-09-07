// 判定構造（症例JSONの choices）のテスト。

import { test, eq } from './harness.js';
import { evaluate, SCORE_LABEL } from '../src/report.js';

const SCORES = ['best', 'ok', 'poor'];

/** 報告ダイアログが作るのと同じ形の選択を組み立てる。 */
function pick(level, opts = {}) {
  return { level, comment: '', recheck: false, readback: level === 'emergency', ...opts };
}

export function suite(data) {
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));
  const messageIds = new Set(Object.keys(data.messages.messages));

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
    eq(evaluate(caseById.n01, pick('urgent')).score, 'poor');
    eq(evaluate(caseById.n01, pick('emergency')).score, 'poor');
    eq(evaluate(caseById.n01, pick('routine', { recheck: true })).score, 'poor');
  });

  test('症例n02: 軽度のHは通常報告が最善', () => {
    eq(evaluate(caseById.n02, pick('routine')).score, 'best');
    eq(evaluate(caseById.n02, pick('routine')).messageId, 'msg_n02_ok');
    eq(evaluate(caseById.n02, pick('emergency')).score, 'poor');
  });

  test('症例n03: コメントの有無で best と ok が分かれる', () => {
    eq(evaluate(caseById.n03, pick('routine', { comment: '小球性低色素性。' })).score, 'best');
    const thin = evaluate(caseById.n03, pick('routine'));
    eq(thin.score, 'ok');
    eq(thin.messageId, 'msg_n03_ok_nocomment');
    eq(evaluate(caseById.n03, pick('urgent')).score, 'poor');
  });

  test('症例n04: 緊急報告が最善、至急どまりと不要な再検は許容、通常報告は要改善', () => {
    const best = evaluate(caseById.n04, pick('emergency'));
    eq(best.score, 'best');
    eq(best.messageId, 'msg_n04_ok');
    eq(evaluate(caseById.n04, pick('emergency', { recheck: true })).score, 'ok');
    eq(evaluate(caseById.n04, pick('emergency', { recheck: true })).messageId, 'msg_n04_recheck');
    eq(evaluate(caseById.n04, pick('urgent')).score, 'ok');
    eq(evaluate(caseById.n04, pick('routine')).score, 'poor');
    eq(evaluate(caseById.n04, pick('routine', { recheck: true })).score, 'poor');
  });

  test('症例n05: 再採血が最善、溶血した値での電話は要改善', () => {
    const best = evaluate(caseById.n05, pick('routine', { recheck: true }));
    eq(best.score, 'best');
    eq(best.messageId, 'msg_n05_ok');
    eq(evaluate(caseById.n05, pick('emergency', { recheck: true })).score, 'ok');
    eq(evaluate(caseById.n05, pick('urgent', { comment: '溶血3+のため参考値' })).score, 'ok');
    eq(evaluate(caseById.n05, pick('emergency')).score, 'poor');
    eq(evaluate(caseById.n05, pick('routine')).score, 'poor');
    eq(evaluate(caseById.n05, pick('urgent')).score, 'poor', '溶血に触れない至急報告');
  });

  test('症例n05b: 再採血＋一報が最善、溶血を理由に流すのだけが要改善', () => {
    const best = evaluate(caseById.n05b, pick('urgent', { recheck: true }));
    eq(best.score, 'best');
    eq(best.messageId, 'msg_n05b_ok');
    eq(evaluate(caseById.n05b, pick('emergency', { recheck: true })).score, 'ok');
    eq(evaluate(caseById.n05b, pick('routine', { recheck: true })).score, 'ok');
    eq(evaluate(caseById.n05b, pick('emergency')).score, 'ok', '値そのものは本物だった');
    eq(evaluate(caseById.n05b, pick('urgent', { comment: '溶血2+。前回5.8。' })).score, 'ok');
    eq(evaluate(caseById.n05b, pick('routine')).score, 'poor');
    eq(evaluate(caseById.n05b, pick('routine')).messageId, 'msg_n05b_missed');
  });

  test('症例5と5-b: 同じ「溶血」でも最善の手が変わる', () => {
    const recheckOnly = pick('routine', { recheck: true });
    eq(evaluate(caseById.n05, recheckOnly).score, 'best', 'n05は再採血だけで足りる');
    eq(evaluate(caseById.n05b, recheckOnly).score, 'ok', 'n05bは黙って待たせない');
  });

  // ---- 症例JSONの形 ----
  test('全症例: choices の最後は when が空の受け皿になっている', () => {
    for (const c of data.cases) {
      eq(Array.isArray(c.choices), true, `${c.id} に choices がない`);
      const last = c.choices[c.choices.length - 1];
      eq(Object.keys(last.when || {}).length, 0, `${c.id} の最後の枝が受け皿になっていない`);
    }
  });

  test('全症例: score・headline・返信IDがそろっている', () => {
    for (const c of data.cases) {
      for (const branch of c.choices) {
        eq(SCORES.includes(branch.score), true, `${c.id} の score: ${branch.score}`);
        eq(typeof branch.headline, 'string', `${c.id} の headline`);
        eq(messageIds.has(branch.reply), true, `${c.id} の返信 ${branch.reply} が messages にない`);
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

  test('全症例: どの操作を選んでも必ず判定と返信が返る', () => {
    for (const c of data.cases) {
      for (const level of ['routine', 'urgent', 'emergency']) {
        for (const recheck of [false, true]) {
          for (const comment of ['', 'コメント']) {
            const res = evaluate(c, pick(level, { recheck, comment }));
            eq(SCORES.includes(res.score), true, `${c.id} ${level} recheck=${recheck}`);
            eq(messageIds.has(res.messageId), true, `${c.id} ${level} recheck=${recheck} の返信`);
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
