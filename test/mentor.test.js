// 指導役の切り替え（speaker によるメッセージの出し分け）のテスト。

import { test, eq } from './harness.js';
import { filterBySpeaker, resolveMessages, messageById } from '../src/messages.js';
import { mentorById } from '../src/mentor.js';

export function suite(data) {
  const mentors = data.mentors.mentors;
  const mentorIds = mentors.map((m) => m.id);
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));

  test('mentors.json: kanae と yusuke がそろっている', () => {
    eq(mentorIds.join(','), 'kanae,yusuke');
    for (const m of mentors) {
      for (const key of ['name', 'role', 'tagline', 'style', 'greeting']) {
        eq(typeof m[key], 'string', `${m.id}.${key}`);
      }
      eq(messageById(data, m.greeting) !== null, true, `${m.id} の挨拶 ${m.greeting} がない`);
    }
  });

  test('mentorById: 知らないIDには null を返す', () => {
    eq(mentorById(data, 'kanae').name, '三嶋 かなえ');
    eq(mentorById(data, 'nobody'), null);
  });

  test('filterBySpeaker: speaker のない台詞は誰を選んでも出る', () => {
    const list = [{ id: 'a' }, { id: 'b', speaker: 'kanae' }, { id: 'c', speaker: 'yusuke' }];
    eq(filterBySpeaker(list, 'kanae').map((m) => m.id).join(','), 'a,b');
    eq(filterBySpeaker(list, 'yusuke').map((m) => m.id).join(','), 'a,c');
  });

  test('filterBySpeaker: 指導役が未選択なら speaker つきの台詞は出さない', () => {
    const list = [{ id: 'a' }, { id: 'b', speaker: 'kanae' }];
    eq(filterBySpeaker(list, null).map((m) => m.id).join(','), 'a');
  });

  test('resolveMessages: 文字列でも配列でも受ける', () => {
    eq(resolveMessages(data, 'msg_shift_start').length, 1);
    eq(resolveMessages(data, ['msg_shift_start', 'msg_n01_intro']).length, 2);
    eq(resolveMessages(data, null).length, 0);
    eq(resolveMessages(data, ['msg_shift_start', 'msg_nonexistent']).length, 1, '無い台詞は落とす');
  });

  test('症例n01: 指導役ごとにナビが1本ずつ出る', () => {
    const navs = resolveMessages(data, caseById.n01.nav);
    eq(navs.length, 2);
    for (const id of mentorIds) {
      const shown = filterBySpeaker(navs, id);
      eq(shown.length, 1, `${id} に出るナビの本数`);
      eq(shown[0].speaker, id);
    }
  });

  test('全メッセージ: speaker は実在する指導役のIDだけ', () => {
    for (const [id, msg] of Object.entries(data.messages.messages)) {
      if (!msg.speaker) continue;
      eq(mentorIds.includes(msg.speaker), true, `${id} の speaker: ${msg.speaker}`);
    }
  });

  test('全症例: どの指導役を選んでも申し送りとナビが必ず届く', () => {
    for (const c of data.cases) {
      for (const id of mentorIds) {
        eq(filterBySpeaker(resolveMessages(data, c.handover), id).length > 0, true, `${c.id} の申し送り (${id})`);
        eq(filterBySpeaker(resolveMessages(data, c.nav), id).length > 0, true, `${c.id} のナビ (${id})`);
      }
    }
  });
}
