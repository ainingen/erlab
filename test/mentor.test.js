// 指導役の切り替え（speaker によるメッセージの出し分け）と、院内メッセージの並び順と、症例0のテスト。

import { test, eq } from './harness.js';
import {
  filterBySpeaker, resolveMessages, messageById, portraitUrl, renderMessages,
  newestFirst, freshGroup,
} from '../src/messages.js';
import { mentorById } from '../src/mentor.js';
import { renderTutorialStep, stepCount } from '../src/tutorial.js';

export function suite(data) {
  const mentors = data.mentors.mentors;
  const mentorIds = mentors.map((m) => m.id);
  const emotionsOf = Object.fromEntries(mentors.map((m) => [m.id, m.emotions]));
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));

  test('mentors.json: kanae と yusuke がそろっている', () => {
    eq(mentorIds.join(','), 'kanae,yusuke');
    for (const m of mentors) {
      for (const key of ['name', 'role', 'tagline', 'style', 'greeting']) {
        eq(typeof m[key], 'string', `${m.id}.${key}`);
      }
      eq(Array.isArray(m.emotions), true, `${m.id}.emotions`);
      eq(messageById(data, m.greeting) !== null, true, `${m.id} の挨拶 ${m.greeting} がない`);
    }
  });

  test('mentors.json: かなえは deadpan、悠介は troubled を持つ', () => {
    eq(emotionsOf.kanae.includes('deadpan'), true);
    eq(emotionsOf.kanae.includes('troubled'), false);
    eq(emotionsOf.yusuke.includes('troubled'), true);
    eq(emotionsOf.yusuke.includes('deadpan'), false);
  });

  test('mentorById: 知らないIDには null を返す', () => {
    eq(mentorById(data, 'kanae').name, '三嶋 かなえ');
    eq(mentorById(data, 'nobody'), null);
  });

  test('portraitUrl: {speaker}_{emotion}.png を指す', () => {
    eq(portraitUrl('kanae', 'deadpan').endsWith('/assets/portraits/kanae_deadpan.png'), true);
    eq(portraitUrl('yusuke', 'troubled').endsWith('/assets/portraits/yusuke_troubled.png'), true);
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

  test('全メッセージ: speaker と emotion は実在する指導役と表情だけ', () => {
    for (const [id, msg] of Object.entries(data.messages.messages)) {
      if (!msg.speaker) {
        if (msg.from_mentor) {
          // 申し送りは指導役が誰であっても同じ表情で出るので、両方が持つ表情に限る
          for (const mid of mentorIds) {
            eq(emotionsOf[mid].includes(msg.emotion), true, `${id} の emotion ${msg.emotion} は ${mid} にない`);
          }
          continue;
        }
        eq(msg.emotion, undefined, `${id} に speaker なしで emotion がある`);
        continue;
      }
      eq(mentorIds.includes(msg.speaker), true, `${id} の speaker: ${msg.speaker}`);
      eq(typeof msg.emotion, 'string', `${id} に emotion がない`);
      eq(emotionsOf[msg.speaker].includes(msg.emotion), true,
         `${id} の emotion ${msg.emotion} は ${msg.speaker} にない`);
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

  test('症例1〜5b: ナビは指導役ごとに1本ずつ、立ち絵つきで出る', () => {
    for (const c of data.cases) {
      const navs = resolveMessages(data, c.nav);
      eq(navs.length, mentorIds.length, `${c.id} のナビの本数`);
      for (const id of mentorIds) {
        const shown = filterBySpeaker(navs, id);
        eq(shown.length, 1, `${c.id} で ${id} に出るナビ`);
        eq(shown[0].speaker, id);
        eq(typeof shown[0].emotion, 'string', `${c.id} ${id} のナビに emotion がない`);
      }
    }
  });

  test('症例4以降のナビは結論を言わない（段階設計）', () => {
    // 症例4〜5bのナビは、症例1〜3より短く、報告レベルを名指ししない
    for (const cid of ['n04', 'n05', 'n05b', 'n06']) {
      for (const m of resolveMessages(data, caseById[cid].nav)) {
        const text = m.body.join('');
        eq(/通常報告|至急報告|緊急報告|再採血して/.test(text), false,
           `${cid} の ${m.speaker} のナビが結論を言っている`);
      }
    }
  });

  test('申し送りは選択中の指導役の名義で出る', () => {
    for (const c of data.cases) {
      const intro = messageById(data, c.handover);
      eq(intro.from_mentor, true, `${c.id} の申し送りが from_mentor でない`);
      eq(intro.from, undefined, `${c.id} の申し送りに固定の送信者名が残っている`);
      eq(intro.speaker, undefined, `${c.id} の申し送りは speaker を持たない（両方に出す）`);
      eq(intro.emotion, 'normal', `${c.id} の申し送りの表情`);
    }
    const intro = messageById(data, 'msg_n01_intro');
    for (const m of mentors) {
      const html = renderMessages([intro], m);
      eq(html.includes(`${m.name} / ${m.role}`), true, `${m.id} 名義になっていない`);
      eq(html.includes(`${m.id}_normal.png`), true, `${m.id} の立ち絵が出ていない`);
    }
  });

  test('「教育担当 / 中央検査部」名義のメッセージは残っていない', () => {
    for (const [id, msg] of Object.entries(data.messages.messages)) {
      eq((msg.from || '').includes('教育担当 / 中央検査部'), false, `${id} に旧名義が残っている`);
    }
  });

  // ---- 症例0 ----
  test('症例0: 10ステップあり、両方の指導役ぶんの台詞がそろっている', () => {
    eq(stepCount(data.tutorial), 10);
    for (const step of data.tutorial.steps) {
      for (const id of mentorIds) {
        const line = step.lines[id];
        eq(Boolean(line), true, `${step.id} に ${id} の台詞がない`);
        eq(Array.isArray(line.body) && line.body.length > 0, true, `${step.id} ${id} の本文`);
        eq(emotionsOf[id].includes(line.emotion), true,
           `${step.id} ${id} の emotion ${line.emotion} は ${id} にない`);
      }
      if (step.pane) {
        eq(typeof data.tutorial.focus_label[step.pane], 'string', `${step.id} の pane 表記`);
      }
    }
  });

  /* ---- 院内メッセージの並び順 ---- */

  // app.js の pushGroup / visibleMessageGroups と同じ組み立て。
  // 同時に届くIDを一つの組にして、選んでいる指導役のぶんだけ残す。
  const groupFor = (ids, mentorId) =>
    filterBySpeaker(resolveMessages(data, freshGroup(ids)), mentorId);

  const allBranches = data.cases.flatMap((c) => [
    ...(c.choices || []),
    ...((c.followup && c.followup.choices) || []),
  ]);

  test('院内メッセージ: 新しい組が上、組の中は届いた順のまま', () => {
    const groups = [[{ id: 'a' }], [{ id: 'b' }, { id: 'c' }], [{ id: 'd' }]];
    eq(newestFirst(groups).map((m) => m.id).join(','), 'd,b,c,a');
    eq(groups.map((g) => g.map((m) => m.id).join('')).join(','), 'a,bc,d', '元の組を壊さない');
  });

  test('院内メッセージ: 講評と医師の返信は一つの組で、講評が上・返信が下', () => {
    let checked = 0;
    for (const branch of allBranches) {
      if (!branch.reply) continue;
      for (const id of mentorIds) {
        const group = groupFor([branch.reply, branch.doctor], id);
        const where = `${branch.headline} / ${id}`;
        eq(group.length, 2, `${where} の組は講評と医師の返信の二本`);
        eq(group[0].kind, 'nav', `${where} は講評が先`);
        eq(group[1].kind, 'reply', `${where} は医師の返信が後`);
        eq(group[0].speaker, id, `${where} の講評は選んだ指導役のもの`);
        checked += 1;
      }
    }
    eq(checked > 0, true, '講評つきの枝が一つもない');
  });

  test('院内メッセージ: 組は入れ子のIDを平らにして、届き済みを落とす', () => {
    // 講評は指導役ぶんの配列で書かれる。app.js は [reply, doctor] の形で渡す
    eq(freshGroup([['a', 'b'], 'c']).join(','), 'a,b,c');
    eq(freshGroup([null, 'c']).join(','), 'c', '空の講評は組に入れない');
    eq(freshGroup([['a', 'b'], 'c'], ['a']).join(','), 'b,c', '届き済みは積み直さない');
    eq(freshGroup(['a', 'a']).join(','), 'a', '同じ便の中の重複も落とす');
  });

  test('院内メッセージ: 汎用の返信は症例をまたいでもう一度届く', () => {
    const repeatable = Object.entries(data.messages.messages).filter(([, m]) => m.repeat);
    eq(repeatable.length > 0, true, 'repeat のメッセージがない');
    for (const [id, def] of repeatable) {
      // 二度目は id#2 の形で積む。中身は同じものを引く
      const again = messageById(data, `${id}#2`);
      eq(again.subject, def.subject, `${id}#2 が引けない`);
      eq(again.id, `${id}#2`, '通し番号は控えとして残す');
      eq(messageById(data, id).subject, def.subject);
    }
    eq(messageById(data, 'msg_nope#2'), null, '無いIDは無いまま');
  });

  test('院内メッセージ: 講評のない枝は医師の返信だけが届く', () => {
    const branch = allBranches.find((b) => !b.reply && b.doctor);
    eq(Boolean(branch), true, '講評のない枝がない');
    for (const id of mentorIds) {
      const group = groupFor([branch.reply, branch.doctor], id);
      eq(group.length, 1, `${branch.headline} / ${id} は返信一本だけ`);
      eq(group[0].kind, 'reply', `${branch.headline} / ${id} は医師の返信`);
    }
  });

  test('院内メッセージ: 描画も「新しい組が上／組の中は講評→返信」', () => {
    const mentor = mentors[0];
    const caseDef = caseById.n04;
    const branch = caseDef.choices.find((c) => c.reply);
    const groups = [
      groupFor(caseDef.handover, mentor.id), // 申し送り（先に届く）
      groupFor(caseDef.nav, mentor.id), // ナビ
      groupFor([branch.reply, branch.doctor], mentor.id), // 講評＋返信（最後）
    ].filter((g) => g.length);
    const list = newestFirst(groups);
    eq(list.map((m) => m.kind).join(','), 'nav,reply,nav,handover');

    const html = renderMessages(list, mentor, data.glossary);
    const praise = html.indexOf(list[0].subject);
    const reply = html.indexOf(list[1].subject);
    eq(list[0].subject === list[1].subject, false, '見出しが同じで位置を比べられない');
    eq(praise >= 0 && reply > praise, true, '講評が医師の返信より上に描かれていない');
  });

  test('症例0: 検査値を出さない（台詞に数値を入れない）', () => {
    for (const step of data.tutorial.steps) {
      for (const id of mentorIds) {
        const text = step.lines[id].body.join('');
        eq(/[0-9]+\.[0-9]/.test(text), false, `${step.id} ${id} の台詞に検査値らしき数字がある`);
      }
    }
  });

  test('症例0: 各ステップが立ち絵つきで描ける', () => {
    for (const mentor of mentors) {
      for (let i = 0; i < stepCount(data.tutorial); i += 1) {
        const html = renderTutorialStep(data.tutorial, i, mentor);
        eq(html.includes('tut-portrait'), true, `${mentor.id} step${i + 1} に立ち絵がない`);
        eq(html.includes(`${mentor.id}_`), true, `${mentor.id} step${i + 1} の立ち絵のID`);
        eq(html.includes('data-action="tutorial-next"'), true, `${mentor.id} step${i + 1} の次へ`);
      }
    }
  });

  test('症例0: 最後のステップだけボタンが「一件目へ」になる', () => {
    const mentor = mentors[0];
    const last = stepCount(data.tutorial) - 1;
    eq(renderTutorialStep(data.tutorial, 0, mentor).includes('次へ'), true);
    eq(renderTutorialStep(data.tutorial, last, mentor).includes('一件目へ'), true);
  });
}
