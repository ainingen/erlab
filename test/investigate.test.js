// 「調べる」（docs/investigate.md）のテスト。
// 行動の押せる・押せないと、返る三行、調べた結果欄の作り。判定側は report.test.js。

import { test, eq } from './harness.js';
import {
  ACTIONS, actionStates, runAction, addMinutes, actionTime, callMessageId,
  idCheckLines, sampleLines, renderActionBar, renderInvestigateLog,
} from '../src/investigate.js';
import { renderResults } from '../src/lis.js';
import { renderMessages, askMessageIds, DEFAULT_ASK_IDS } from '../src/messages.js';
import { renderVerdict } from '../src/report.js';
import { buildPanel } from '../src/derive.js';

const ids = (states) => states.map((s) => s.id).join(',');
const enabled = (states) => states.filter((s) => s.enabled).map((s) => s.id).join(',');
const noteOf = (states, id) => states.find((s) => s.id === id).note;

export function suite(data) {
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));
  const CBC = ['CBC', 'CHEM_BASIC'];

  // ---- 行動の一覧 ----
  test('調べる: 行動は目視・ID照合・塗抹・電話の四つ', () => {
    eq(ids(actionStates({ order: CBC })), 'look,idcheck,smear,call');
    eq(ACTIONS.map((a) => a.label).join(','), '目視,ID,塗抹,電話');
  });

  test('調べる: 何も押していなければ四つとも押せる', () => {
    eq(enabled(actionStates({ order: CBC })), 'look,idcheck,smear,call');
  });

  test('調べる: 各行動は1症例1回。押したら「済」で押せなくなる', () => {
    const taken = [{ id: 'look', stage: 'first' }, { id: 'call', stage: 'first' }];
    const states = actionStates({ order: CBC, taken });
    eq(enabled(states), 'idcheck,smear');
    eq(noteOf(states, 'look'), '済');
    eq(noteOf(states, 'call'), '済');
  });

  test('調べる: 塗抹は order に CBC がないと押せない', () => {
    const withCbc = actionStates({ order: CBC });
    eq(withCbc.find((s) => s.id === 'smear').enabled, true, '血算があれば押せる');
    eq(noteOf(withCbc, 'smear'), '');

    const without = actionStates({ order: ['CHEM_BASIC'] });
    eq(without.find((s) => s.id === 'smear').enabled, false, '血算がないのに押せる');
    eq(noteOf(without, 'smear'), '血算の依頼なし');
    // 他の三つは血算がなくても押せる
    eq(enabled(without), 'look,idcheck,call');
  });

  test('調べる: 目視だけ検体ごとに1回。再採血検体が届いたらもう一度できる', () => {
    const taken = ACTIONS.map((a) => ({ id: a.id, stage: 'first' }));
    // 一本目で四つとも押し切った状態から、二本目が届く
    eq(enabled(actionStates({ order: CBC, stage: 'first', taken })), '');
    const second = actionStates({ order: CBC, stage: 'recollect', taken });
    eq(enabled(second), 'look', '二本目で押せるのは目視だけ');
    eq(noteOf(second, 'look'), '', '目視は二本目ぶんがまだ');
    // 済んだ行動は検体が変わっても再度はできない
    eq(noteOf(second, 'idcheck'), '済');
    eq(noteOf(second, 'smear'), '済');
    eq(noteOf(second, 'call'), '済');

    // 二本目で目視を押すと、二本目ぶんが済になる
    const done = actionStates({
      order: CBC, stage: 'recollect', taken: [...taken, { id: 'look', stage: 'recollect' }],
    });
    eq(enabled(done), '');
    eq(noteOf(done, 'look'), '済');
  });

  test('調べる: 一本目で押していない行動は、再採血検体が届いたあとでも押せる（§2）', () => {
    // 何も押さずに二本目が届いた
    const none = actionStates({ order: CBC, stage: 'recollect', taken: [] });
    eq(enabled(none), 'look,idcheck,smear,call', '未実行なのに押せなくなっている');
    for (const a of ACTIONS) eq(noteOf(none, a.id), '', `${a.id} に余計な札が付いている`);

    // 一本目で電話だけ押していた場合。済んだ電話は再度できず、残りは押せる
    const called = actionStates({
      order: CBC, stage: 'recollect', taken: [{ id: 'call', stage: 'first' }],
    });
    eq(enabled(called), 'look,idcheck,smear');
    eq(noteOf(called, 'call'), '済');
  });

  test('調べる: 押せない札は「済」と「血算の依頼なし」だけ', () => {
    const notes = new Set();
    for (const stage of ['first', 'recollect']) {
      for (const taken of [[], ACTIONS.map((a) => ({ id: a.id, stage: 'first' }))]) {
        for (const order of [CBC, ['CHEM_BASIC']]) {
          for (const s of actionStates({ order, stage, taken })) notes.add(s.note);
        }
      }
    }
    eq([...notes].sort().join(','), ',済,血算の依頼なし');
  });

  test('調べる: 報告して閉じた検体では押せない', () => {
    eq(enabled(actionStates({ order: CBC, done: true })), '');
  });

  // ---- 返る三行 ----
  test('目視: 検体トラブルごとの三行。トラブルがなければ defaults', () => {
    const hemo = buildPanel(caseById.n05b, data); // 溶血（2+）
    eq(sampleLines('look', data, hemo).join('／'), '血漿は淡赤／凝血・フィブリンなし／量は十分');
    const clean = buildPanel(caseById.n06, data); // 検体トラブルなし
    eq(sampleLines('look', data, clean).join('／'), '淡黄色／凝血・フィブリンなし／量は十分');
    // 正常検体でも空振りにしない。これが「採血に問題なし」を選ぶ根拠になる（§1）
    eq(sampleLines('look', data, clean).length, 3);
  });

  test('塗抹: 血小板・凝集に加えて赤血球の形まで返る', () => {
    for (const [id, def] of Object.entries(data.artifacts.artifacts)) {
      eq(def.look.length, 3, `${id} の目視は三行`);
      eq(def.smear.length, 3, `${id} の塗抹は三行`);
    }
    eq(data.artifacts.defaults.smear[2], '赤血球の形に異常なし');
    eq(data.artifacts.artifacts.platelet_clump_edta.smear[0], '凝集塊あり（多数）');
  });

  test('塗抹: 病名に繋がる読みを返さない（§12）', () => {
    const all = [
      ...data.artifacts.defaults.smear,
      ...Object.values(data.artifacts.artifacts).flatMap((a) => a.smear),
    ].join('');
    for (const word of ['芽球', '異型', '白血病', '貧血']) {
      eq(all.includes(word), false, `塗抹の三行に「${word}」がある`);
    }
  });

  test('ID照合: 既定は一致。ラベルと依頼の両方を並べる', () => {
    const lines = idCheckLines(caseById.n06);
    eq(lines[0], 'ラベル P-0007 患者G');
    eq(lines[1], '依頼 P-0007 患者G');
    eq(lines[2], '一致');
  });

  test('ID照合: match:false ならラベル側が別人になり、三行目が不一致', () => {
    const caseDef = {
      ...caseById.n06,
      investigate: { idcheck: { match: false, label: { id: 'P-0009', name: '患者J' } } },
    };
    const lines = idCheckLines(caseDef);
    eq(lines[0], 'ラベル P-0009 患者J');
    eq(lines[1], '依頼 P-0007 患者G');
    eq(lines[2], '不一致');
  });

  test('電話: 依頼元ごとの既定が実在し、症例側の上書きが勝つ', () => {
    eq(callMessageId(caseById.n05), 'msg_call_default_er');
    eq(callMessageId(caseById.n06).startsWith('msg_'), true);
    for (const c of data.cases) {
      const id = callMessageId(c);
      const msg = data.messages.messages[id];
      eq(Boolean(msg), true, `${c.id} の電話メッセージ ${id} がない`);
      eq(msg.lines.length, 3, `${id} は三行`);
      eq(msg.body.length, 3, `${id} の電話口の言葉は三行`);
      eq(typeof msg.caller, 'string', `${id} の相手先`);
    }
    const overridden = { ...caseById.n05, investigate: { call: 'msg_call_default_ward' } };
    eq(callMessageId(overridden), 'msg_call_default_ward');
  });

  test('電話: 病名・身体所見の示唆を返さない（横の連絡として当然のところまで）', () => {
    for (const c of data.cases) {
      const msg = data.messages.messages[callMessageId(c)];
      const text = [...msg.lines, ...msg.body].join('');
      for (const word of ['貧血', '出血', '腎不全', '心不全', '感染', '疑い', '診断']) {
        eq(text.includes(word), false, `${msg.subject} に「${word}」がある`);
      }
    }
  });

  // ---- 積み方 ----
  test('調べた結果: 時刻は受付から3分・以降2分ずつ（見た目だけ）', () => {
    eq(addMinutes('10:41', 3), '10:44');
    eq(addMinutes('23:58', 5), '00:03');
    eq(actionTime('10:41', 0), '10:44');
    eq(actionTime('10:41', 1), '10:46');
    eq(actionTime('10:41', 2), '10:48');
  });

  test('調べた結果: 三行は ／ で繋いで一行に収める。電話だけ相手先が頭に付く', () => {
    const caseDef = caseById.n05b;
    const panel = buildPanel(caseDef, data);
    const look = runAction('look', { caseDef, data, panel, index: 0 });
    eq(look.time, '10:44');
    eq(look.name, '目視');
    eq(look.text, '血漿は淡赤／凝血・フィブリンなし／量は十分');

    const call = runAction('call', { caseDef, data, panel, index: 1 });
    eq(call.time, '10:46');
    eq(call.text.includes('：'), true, '相手先が頭に付いていない');
    eq(call.lines.length, 3);
    eq(Boolean(call.messageId), true, '電話は院内メッセージにも残る');
    // 目視・ID照合・塗抹は自分で見たことなので、メッセージには残さない
    eq(runAction('look', { caseDef, data, panel }).messageId, null);
  });

  test('調べた結果: 症例が investigate に書いた三行が既定より勝つ', () => {
    const caseDef = { ...caseById.n06, investigate: { smear: ['凝集塊なし', '血小板は散在・十分', '大小不同あり'] } };
    const panel = buildPanel(caseDef, data);
    eq(runAction('smear', { caseDef, data, panel }).text.endsWith('大小不同あり'), true);
  });

  test('調べた結果欄: 何も調べていなければ欄ごと出さない', () => {
    eq(renderInvestigateLog([]), '');
    eq(renderInvestigateLog(null), '');
    const caseDef = caseById.n06;
    const view = {
      marks: [], suspects: {}, suspectDefs: data.suspects.suspects,
      glossary: data.glossary, interactive: true, investigateHtml: '',
    };
    const html = renderResults(caseDef, buildPanel(caseDef, data), data, view);
    eq(html.includes('調べた結果'), false, '空の欄が出ている');
    eq(html.includes('data-region="sample_state"'), true, '検体状態欄は出る');
  });

  test('調べた結果欄: 検体状態欄に追記せず、その下の別欄に出る', () => {
    const caseDef = caseById.n05b;
    const panel = buildPanel(caseDef, data);
    const entry = runAction('look', { caseDef, data, panel, index: 0 });
    const view = {
      marks: [], suspects: {}, suspectDefs: data.suspects.suspects,
      glossary: data.glossary, interactive: true,
      investigateHtml: renderInvestigateLog([entry], data.glossary),
    };
    const html = renderResults(caseDef, panel, data, view);
    eq(html.includes('data-region="investigate_log"'), true, '調べた結果欄がない');
    // 検体状態欄（装置の言い分）には混ざらない
    const sample = html.split('data-region="sample_state"')[1].split('</dd>')[0];
    eq(sample.includes('血漿は淡赤'), false, '検体状態欄に追記している');
    // 欄の並びは 検体状態 → 調べた結果 → 前回検査
    eq(html.indexOf('data-region="sample_state"') < html.indexOf('data-region="investigate_log"'), true);
    eq(html.indexOf('data-region="investigate_log"') < html.indexOf('前回検査'), true);
  });

  test('調べた結果: 結果の語は下線で辞典に飛ぶ', () => {
    const entry = { time: '10:44', name: '目視', text: '血漿は淡赤／凝血・フィブリンなし／量は十分' };
    const html = renderInvestigateLog([entry], data.glossary);
    eq(html.includes('data-term="hemolysis_color"'), true, '溶血の色に飛べない');
    eq(html.includes('data-term="clot_lump"'), true, '凝血塊に飛べない');
    eq(html.includes('data-term="fibrin"'), true, 'フィブリンに飛べない');
    eq(renderInvestigateLog([entry], null).includes('data-term='), false, '辞典なしでも壊れない');
  });

  test('調べた結果: 目視・塗抹に出る語がすべて辞典で引ける', () => {
    const wanted = ['淡黄色', '淡赤', '凝血', 'フィブリン', '凝集塊', '散在', '大小不同', '破砕赤血球',
      '点滴側', '塗抹', '鏡検', '折り返し', 'ID照合'];
    const known = new Set();
    for (const def of Object.values(data.glossary.terms)) {
      known.add(def.term);
      for (const a of def.aliases) known.add(a);
    }
    for (const w of wanted) eq(known.has(w), true, `「${w}」が辞典にない`);
  });

  test('調べた結果: 実際に返る三行から、辞典に飛べる語が拾える', () => {
    const sets = [
      ['既定', data.artifacts.defaults.look, data.artifacts.defaults.smear],
      ...Object.entries(data.artifacts.artifacts).map(([id, a]) => [id, a.look, a.smear]),
    ];
    for (const [id, look, smear] of sets) {
      for (const [what, lines] of [['目視', look], ['塗抹', smear]]) {
        const html = renderInvestigateLog(
          [{ time: '10:00', name: what, text: lines.join('／') }], data.glossary,
        );
        eq(html.includes('data-term='), true, `${id} の${what}から辞典に飛べない`);
      }
    }
  });

  // ---- ボタン ----
  test('行動ボタン: 四つとも出て、押せないものは disabled になる', () => {
    const html = renderActionBar(actionStates({ order: ['CHEM_BASIC'] }));
    for (const a of ACTIONS) eq(html.includes(`data-investigate="${a.id}"`), true, `${a.id} のボタン`);
    eq((html.match(/disabled/g) || []).length, 1, '押せないのは塗抹だけ');
    eq(html.includes('血算の依頼なし'), true);
    // 指さしの的（症例5のナビが指す）
    eq(html.includes('data-region="investigate"'), true);
  });

  // ---- 指導役に聞く（§8） ----
  test('聞く: 手書き症例は自前の台詞、書いていない症例は既定の「見る順番」', () => {
    eq(askMessageIds(caseById.n05).join(','), 'msg_n05_ask_kanae,msg_n05_ask_yusuke');
    // 書いていない症例（生成症例もここに落ちる）
    eq(askMessageIds(caseById.n01).join(','), DEFAULT_ASK_IDS.join(','));
    eq(askMessageIds({}).join(','), DEFAULT_ASK_IDS.join(','));
    for (const id of [...DEFAULT_ASK_IDS, 'msg_n05_ask_kanae', 'msg_n05_ask_yusuke']) {
      eq(Boolean(data.messages.messages[id]), true, `${id} がない`);
    }
  });

  test('聞く: 既定の台詞は「見る順番」の五行そのままで、答えを言わない', () => {
    const steps = data.glossary.reading_order.steps;
    for (const id of DEFAULT_ASK_IDS) {
      const msg = data.messages.messages[id];
      eq(msg.kind, 'nav');
      eq(msg.repeat, true, `${id} は症例をまたいで届くので repeat が要る`);
      const text = msg.body.join('');
      for (const s of steps) {
        eq(text.includes(s.term), true, `${id} に「${s.term}」がない`);
        eq(text.includes(s.hint), true, `${id} に「${s.hint}」がない`);
      }
      // 見どころを指すだけ。報告レベルの結論は言わない
      eq(/通常報告|至急報告|緊急報告|再採血して/.test(text), false, `${id} が結論を言っている`);
    }
  });

  test('聞く: ナビ枠の末尾に出る。押したら「聞いた」になる', () => {
    const mentor = data.mentors.mentors[0];
    const nav = { id: 'msg_n05_nav_kanae', ...data.messages.messages.msg_n05_nav_kanae };
    const ask = { navIds: ['msg_n05_nav_kanae'], asked: false, enabled: true };
    const html = renderMessages([nav], mentor, data.glossary, ask);
    eq(html.includes('data-action="ask"'), true, '「聞く」が出ていない');
    eq(html.includes('許容どまり'), true, '押す前に評価に出ることを言っていない');
    eq(html.indexOf('msg-ask') > html.indexOf('msg-main'), true, 'ナビ枠の末尾でない');

    const done = renderMessages([nav], mentor, data.glossary, { ...ask, asked: true });
    eq(done.includes('data-action="ask"'), false, '二度押せる');
    eq(done.includes('聞いた'), true);

    // 他の症例のナビや、ナビ以外の枠には出さない
    eq(renderMessages([nav], mentor, data.glossary, { ...ask, navIds: ['msg_n06_nav_kanae'] })
      .includes('data-action="ask"'), false);
    eq(renderMessages([nav], mentor, data.glossary).includes('data-action="ask"'), false);
  });

  test('聞く: 判定画面の見出しの下に一行出る', () => {
    const res = { score: 'ok', headline: 'x' };
    const choice = { level: 'urgent', marks: [], suspects: {}, comment: [], asked: true };
    const html = renderVerdict(res, choice, data);
    eq(html.includes('指導役に聞いたため、許容どまりです'), true);
    eq(html.indexOf('</h2>') < html.indexOf('verdict-ask'), true, '見出しより上に出ている');
    eq(renderVerdict(res, { ...choice, asked: false }, data).includes('verdict-ask'), false);
  });

  test('行動ボタン: 表記は一段に収まる短いもの。色で状態を伝えない', () => {
    const html = renderActionBar(actionStates({ order: ['CBC'] }));
    for (const a of ACTIONS) eq(a.label.length <= 2, true, `${a.id} の表記が長い`);
    eq(/style=|class="[^"]*is-(warn|panic)/.test(html), false, 'ボタンに色を付けている');
  });
}
