// シフト制と信頼度（docs/shift.md）のテスト。
// 窓の出入り・切り詰め・不在の晩の判定・症例の供給・保存の読み書き。

import { test, eq } from './harness.js';
import {
  pushScore, windowPoints, trust, summarize, isAbsentNight, closeNight,
  pickNightCases, nightReceivedAt, summaryBody, toSave, fromSave, newShift, rngFrom,
} from '../src/shift.js';
import { renderGlossaryPanel } from '../src/lis.js';
import { renderMessages } from '../src/messages.js';
import { mentorForCase, askButtonState } from '../src/mentor.js';

export function suite(data, sources = {}) {
  const cfg = data.shift;
  const fill = (score, n) => Array.from({ length: n }, () => score);

  // ---- 1. 窓 ----
  test('窓: 11件入れると先頭が落ちる。件数は shift.json のとおり', () => {
    eq(cfg.window, 10);
    let w = [];
    for (let i = 0; i < cfg.window; i += 1) w = pushScore(w, 'ok', cfg);
    eq(w.length, cfg.window);
    w = pushScore(w, 'poor', cfg);
    eq(w.length, cfg.window, '窓が伸びている');
    eq(w[w.length - 1], 'poor', '末尾に入る');
    eq(w[0], 'ok');
    // 11件目で先頭が落ちたぶん、ok が一つ減っている
    eq(w.filter((s) => s === 'ok').length, cfg.window - 1);
  });

  test('窓: 点は shift.json のとおり（best +2／ok +1／poor −3）', () => {
    eq(cfg.points.best, 2);
    eq(cfg.points.ok, 1);
    eq(cfg.points.poor, -3);
    eq(windowPoints(['best', 'ok'], cfg), 3);
    eq(windowPoints(['best', 'best', 'poor'], cfg), 1);
  });

  test('窓: 評価でないものは入れない（差し戻しの一本目は score を持たない）', () => {
    const w = ['ok'];
    eq(pushScore(w, null, cfg).join(','), 'ok', 'null で窓が動いた');
    eq(pushScore(w, undefined, cfg).join(','), 'ok');
    eq(pushScore(w, 'unknown', cfg).join(','), 'ok');
    // 差し戻しは二本で1件。一本目（then）は score が null なので窓に入らない
    const app = sources.app || '';
    const branch = app.indexOf("res.then === 'followup'");
    const push = app.indexOf('state.nightScores.push');
    eq(branch >= 0 && push > branch, true, '差し戻しの枝より先に窓へ入れている');
    eq(app.slice(branch, push).includes('return;'), true, '差し戻しの枝で抜けていない');
  });

  // ---- 2. 切り詰めと表示 ----
  test('信頼度: 0 未満と満点超に振り切らない。表示は ×5 で 0〜100', () => {
    eq(trust(fill('poor', cfg.window), cfg), 0, '要改善だらけでも 0 で止まる');
    eq(trust(fill('best', cfg.window), cfg), 100, '満点は 100');
    eq(trust([], cfg), 0);
    eq(trust(fill('ok', cfg.window), cfg), cfg.window * cfg.points.ok * cfg.display_scale);
    // 素点は 0〜（窓 × best点）
    eq(windowPoints(fill('poor', cfg.window), cfg), 0);
    eq(windowPoints(fill('best', cfg.window), cfg), cfg.window * cfg.points.best);
  });

  test('集計: 適切・許容・要改善の数を数える', () => {
    const t = summarize(['best', 'ok', 'poor', 'best']);
    eq(t.total, 4); eq(t.best, 2); eq(t.ok, 1); eq(t.poor, 1);
    eq(summarize([]).total, 0);
  });

  test('集計の本文: 最初の晩は「— → 45」の形', () => {
    const body = summaryBody(summarize(['best', 'ok']), null, 45);
    eq(body[0], '本日の報告  2件');
    eq(body[body.length - 1], '医師からの信頼度  — → 45');
    eq(summaryBody(summarize([]), 60, 65).pop(), '医師からの信頼度  60 → 65');
    // 途中では出さない（集計の本文にしか信頼度が出てこない）
    eq(body.filter((line) => line.includes('信頼度')).length, 1);
  });

  // ---- 3. 不在の晩 ----
  test('不在の晩: 閾値以上で翌晩は指導役が休み', () => {
    eq(cfg.absent_threshold, 80);
    const high = { window: fill('best', cfg.window) };   // 100
    const mid = { window: fill('ok', cfg.window) };      // 50
    eq(isAbsentNight(high, cfg), true);
    eq(isAbsentNight(mid, cfg), false);
    // ちょうど閾値でも不在（80 以上）
    const just = { window: [...fill('best', 8), 'ok', 'ok'] }; // 18点 → 90
    eq(trust(just.window, cfg) >= cfg.absent_threshold, true);
    eq(isAbsentNight(just, cfg), true);
  });

  test('不在の晩: 要改善が出たら翌晩は指導役。その次は改めて閾値で見る', () => {
    const shift = { night: 3, window: fill('best', cfg.window), cleared: false };
    // 不在の晩に要改善が1件
    const failed = closeNight(shift, { absent: true, scores: ['best', 'best', 'best', 'best', 'poor'] }, cfg);
    eq(failed.absentFailed, true);
    eq(failed.clearedNow, false);
    eq(failed.shift.forceMentorNight, true);
    eq(isAbsentNight(failed.shift, cfg), false, '翌晩も不在にしている');
    // 窓はここでは動かさない（要改善の −3 は閉じたときに入っている。二重に下げない）
    eq(failed.shift.window.join(','), shift.window.join(','));
    // 指導役の晩を一つ挟めば、次はまた閾値で見る
    const back = closeNight(failed.shift, { absent: false, scores: ['ok'] }, cfg);
    eq(back.shift.forceMentorNight, false);
    eq(isAbsentNight(back.shift, cfg), true);
  });

  test('クリア: 不在の晩を要改善ゼロで終えたら印が立つ', () => {
    const shift = { night: 4, window: fill('best', cfg.window), cleared: false };
    const cleared = closeNight(shift, { absent: true, scores: ['best', 'best', 'ok', 'best', 'ok'] }, cfg);
    eq(cleared.clearedNow, true);
    eq(cleared.shift.cleared, true);
    eq(cleared.shift.forceMentorNight, false);
    // クリアしても枠は続く。閾値を割れば指導役が戻る
    eq(isAbsentNight(cleared.shift, cfg), true);
    const dropped = closeNight({ ...cleared.shift, window: fill('ok', cfg.window) }, { absent: true, scores: ['ok'] }, cfg);
    eq(dropped.shift.cleared, true, 'クリアの印は消えない');
    eq(isAbsentNight(dropped.shift, cfg), false);
    // 指導役の晩ではクリアしない
    eq(closeNight(shift, { absent: false, scores: ['best', 'best'] }, cfg).clearedNow, false);
  });

  test('クリアと失敗の文面が common.json にある', () => {
    for (const id of ['msg_shift_night_start', 'msg_shift_night_end', 'msg_shift_summary',
      'msg_shift_absent_start', 'msg_shift_absent_clear', 'msg_shift_absent_fail']) {
      const m = data.messages.messages[id];
      eq(Boolean(m), true, `${id} がない`);
      eq(m.repeat, true, `${id} は晩をまたいで届く`);
    }
    // 不在の晩の文は指導役の名義で出さない
    for (const id of ['msg_shift_absent_start', 'msg_shift_absent_clear', 'msg_shift_absent_fail']) {
      const m = data.messages.messages[id];
      eq(m.from, '中央検査部', `${id} の名義`);
      eq(m.from_mentor, undefined, `${id} が指導役の名義になっている`);
      eq(m.speaker, undefined, `${id} に speaker がある`);
    }
    // {mentor} は姓を埋める場所。指導役が2人いるので固定文にしない
    eq(data.messages.messages.msg_shift_absent_start.body.join('').includes('{mentor}'), true);
    eq(data.messages.messages.msg_shift_absent_fail.body.join('').includes('{mentor}'), true);
    eq(data.messages.messages.msg_shift_absent_start.body.join('').includes('三嶋'), false,
       '姓を固定で書いている');
  });

  // ---- 4. 症例の供給 ----
  test('供給: 同じ晩の番号なら同じ5件。生成症例が必ず入り、重複しない', () => {
    const first = pickNightCases(7, data.cases, cfg);
    eq(first.length, cfg.cases_per_night);
    eq(first.join(','), pickNightCases(7, data.cases, cfg).join(','), '同じ晩で違う組み合わせ');
    eq(new Set(first).size, first.length, '同じ症例が二度出ている');
    const generated = data.cases.filter((c) => !(c.choices || []).length).map((c) => c.id);
    eq(first.some((id) => generated.includes(id)), true, '生成症例が入っていない');
    for (const id of first) eq(data.cases.some((c) => c.id === id), true, `${id} が一覧にない`);
    // 晩が変われば並びも変わる（同じ5件が続かない）
    const nights = [2, 3, 4, 5].map((n) => pickNightCases(n, data.cases, cfg).join(','));
    eq(new Set(nights).size > 1, true, 'どの晩も同じ5件になっている');
  });

  test('供給: 受付時刻は出勤から一定間隔で引き直す（症例JSONは触らない）', () => {
    eq(nightReceivedAt(0, cfg), cfg.night_start);
    eq(nightReceivedAt(1, cfg), '20:30');
    eq(nightReceivedAt(4, cfg), '22:00');
    // 症例側の received_at はそのまま残っている（研修で使う）
    eq(data.cases.find((c) => c.id === 'n01').received_at, '08:12');
  });

  test('rngFrom: 同じ種なら同じ並び', () => {
    const a = rngFrom(3); const b = rngFrom(3);
    eq(a(), b());
    eq(rngFrom(3)() === rngFrom(4)(), false, '種が違っても同じ値');
  });

  // ---- 5. 不在の晩の画面 ----
  test('不在の晩: 索引の「項目」タブが出ず、「言葉」と見る順番は残る', () => {
    const view = { tab: 'tests', testId: 'K', termId: null };
    const normal = renderGlossaryPanel(data, view, 'M');
    eq(normal.includes('data-gl-tab="tests"'), true, '通常の晩に項目タブが無い');

    const absent = renderGlossaryPanel(data, view, 'M', { tests: false });
    eq(absent.includes('data-gl-tab="tests"'), false, '不在の晩に項目タブが出ている');
    eq(absent.includes('data-gl-tab="terms"'), true, '言葉タブまで消している');
    eq(absent.includes('見る順番'), true, '見る順番が消えている');
    eq(absent.includes('5. 検体トラブルで偽の値が出る条件'), false, '項目の索引が出ている');
  });

  test('不在の晩: 症例に mentor:false を持たせるだけで、聞くの扱いは既存のまま', () => {
    const c = data.cases[0];
    eq(Boolean(mentorForCase(data, 'kanae', c)), true);
    eq(mentorForCase(data, 'kanae', { ...c, mentor: false }), null);
    // 押せる位置は変わらない。文だけ変わる（investigate.md §8）
    const absent = askButtonState({ mentor: null, used: null, open: true });
    eq(absent.enabled, true);
    eq(absent.note.includes('今日は指導役がいません'), true);
    // 指導役がいない日は上限を落とさない（既存）
    eq(askButtonState({ mentor: null, used: 'absent', open: true }).label, '聞いた');
  });

  test('不在の晩: 講評を出さず、医師の返事だけ届く', () => {
    const app = sources.app || '';
    eq(/state\.absentNight \? null : res\.messageId/.test(app), true,
       '不在の晩に講評を出している');
    eq(/if \(!state\.absentNight\) pushMessage\(caseDef\.nav\)/.test(app), true,
       '不在の晩にナビを出している');
  });

  test('不在の晩: 退勤の一行が中央検査部の名義で出る（文面は変えない）', () => {
    const mentor = data.mentors.mentors[0];
    const end = data.messages.messages.msg_shift_night_end;
    eq(end.from_mentor, true, '通常の晩は指導役の名義で出す');
    const text = end.body.join('');

    // 通常の晩は指導役の名前と立ち絵
    const normal = renderMessages([{ id: 'a', ...end }], mentor, data.glossary);
    eq(normal.includes(mentor.name), true, '通常の晩に指導役の名前が出ていない');
    eq(normal.includes('msg-portrait'), true, '通常の晩に立ち絵が出ていない');

    // 不在の晩は症例の申し送りと同じ差し替え（from を中央検査部に、speaker を落とす）
    const absent = renderMessages(
      [{ id: 'a', ...end, from: '中央検査部', from_mentor: false }], mentor, data.glossary,
    );
    eq(absent.includes('中央検査部'), true, '不在の晩に中央検査部の名義で出ていない');
    eq(absent.includes(mentor.name), false, '不在の晩に指導役の名前が混ざっている');
    eq(absent.includes('msg-portrait'), false, '不在の晩に立ち絵が出ている');
    eq(absent.includes(text), true, '文面が変わっている');

    // 差し替えは app.js の退勤で、症例の申し送りと同じ形で入れる
    const app = sources.app || '';
    eq(/const end = pushMessage\('msg_shift_night_end'\);/.test(app), true,
       '退勤の便を掴んでいない');
    eq(/if \(state\.absentNight\) \{[\s\S]{0,200}from: '中央検査部', dropSpeaker: true/.test(app), true,
       '不在の晩に退勤の名義を差し替えていない');
  });

  // ---- 6. 保存 ----
  test('保存: 書いた形をそのまま読み戻せる', () => {
    const shift = { night: 4, window: ['best', 'ok', 'poor'], cleared: true, forceMentorNight: true };
    const saved = toSave(shift, 'yusuke');
    eq(saved.night, 4);
    eq(saved.window.join(','), 'best,ok,poor');
    eq(saved.cleared, true);
    eq(saved.mentor, 'yusuke');
    const back = fromSave(saved, cfg);
    eq(back.shift.night, 4);
    eq(back.shift.window.join(','), 'best,ok,poor');
    eq(back.shift.cleared, true);
    eq(back.shift.forceMentorNight, true);
    eq(back.mentorId, 'yusuke');
  });

  test('保存: 前の晩に見せた信頼度（trustShown）も持ち越す', () => {
    const shift = { night: 3, window: ['best', 'best'], cleared: false, forceMentorNight: false };
    const saved = toSave(shift, 'kanae', 45);
    eq(saved.trustShown, 45, '保存に信頼度が入っていない');
    eq(fromSave(saved, cfg).trustShown, 45, '読み戻せていない');

    // 読み込み直後の最初の退勤で、前の晩の数字が左に出る
    const tally = summarize(['best', 'ok', 'poor', 'best', 'ok']);
    const line = summaryBody(tally, fromSave(saved, cfg).trustShown, 60).at(-1);
    eq(line, '医師からの信頼度  45 → 60');

    // まだ一度も退勤していない保存と、壊れている保存は null（「— → 45」のまま）
    eq(toSave(shift, 'kanae').trustShown, null);
    for (const raw of [{}, { trustShown: 'x' }, { trustShown: null }, null]) {
      eq(fromSave(raw, cfg).trustShown, null, `${JSON.stringify(raw)} で null にならない`);
    }
    eq(summaryBody(tally, fromSave({}, cfg).trustShown, 45).at(-1), '医師からの信頼度  — → 45');
  });

  test('保存: 読めない・壊れていても最初から始められる（例外を投げない）', () => {
    for (const raw of [null, undefined, 'こわれた', 42, {}, { night: -1, window: 'x' }]) {
      const back = fromSave(raw, cfg);
      eq(back.shift.night, 1, `${JSON.stringify(raw)} で晩が 1 でない`);
      eq(back.shift.window.length, 0);
      eq(back.shift.cleared, false);
      eq(back.mentorId, null);
    }
    // 知らない評価は落とす。窓の長さも切る
    const messy = fromSave({ night: 2, window: [...fill('best', 20), 'x'], mentor: 7 }, cfg);
    eq(messy.shift.window.length, cfg.window);
    eq(messy.shift.window.every((s) => s === 'best'), true);
    eq(messy.mentorId, null);
    eq(newShift().night, 1);
  });

  test('保存: localStorage が投げる環境でも出勤まで進む', () => {
    const app = sources.app || '';
    // 読み書きは一か所ずつ。どちらも try で囲って、駄目ならメモリだけで動く
    eq((app.match(/localStorage\.setItem/g) || []).length, 1, '書き込みが散っている');
    eq((app.match(/localStorage\.getItem/g) || []).length, 1, '読み込みが散っている');
    eq(/state\.saveBroken = true/.test(app), true, '読み書きできないときの印がない');
    eq(/この環境では進行が保存されません/.test(app), true, '保存できない旨を出していない');
  });

  test('数字はコードに埋めず data/shift.json から引く', () => {
    for (const key of ['cases_per_night', 'window', 'display_scale', 'absent_threshold']) {
      eq(typeof cfg[key], 'number', `${key} がない`);
    }
    eq(typeof cfg.night_start, 'string');
    eq(typeof cfg.save_key, 'string');
    const shift = sources.shift || '';
    if (shift) {
      eq(/=\s*10\b|=\s*80\b/.test(shift.replace(/\/\/.*$/gm, '')), false,
         'src/shift.js に数字が埋まっている');
    }
  });
}
