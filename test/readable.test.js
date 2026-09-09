// 新人が読める画面（docs/readable.md）のテスト。
// 辞典・組み立て式コメントの画面側・指さし。値の計算は derive.test.js、判定は report.test.js。

import { test, eq } from './harness.js';
import {
  renderResults, renderGlossaryPanel, renderTermPanel, linkTerms, termLink, renderWorklist,
} from '../src/lis.js';
import { renderReportDialog, renderCommentPicker, markSummary } from '../src/report.js';
import { renderMessages } from '../src/messages.js';
import { renderTutorialPlaceholder, stepCount } from '../src/tutorial.js';
import { buildPanel, buildCommentOptions } from '../src/derive.js';

const FOCUS_IDS = [
  'reception', 'patient', 'results', 'flags', 'sample_state', 'previous', 'messages', 'report',
  // 「調べる」の行動ボタン。初出の操作なので、症例5だけ例外的に場所を教える
  'investigate',
  // 上のバー右端の「聞く」。症例0で場所を教える
  'ask',
];

/**
 * 症例4以降は結論を言わない段階なので、指さしを書かない。
 * 例外は症例5の行動ボタンだけ（初出の操作は場所を教える。マークのときと同じ扱い。
 * docs/investigate.md §3-3）。
 */
const POINTING_CASES = ['n01', 'n02', 'n03', 'n05'];

export function suite(data) {
  const glossary = data.glossary;
  const terms = glossary.terms;
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));
  const view = (extra = {}) => ({
    marks: [], suspects: {}, suspectDefs: data.suspects.suspects, glossary, interactive: true, ...extra,
  });

  // ---- 辞典 ----
  test('辞典: 31語あり、一語は三行以内', () => {
    eq(Object.keys(terms).length, 31);
    for (const [id, def] of Object.entries(terms)) {
      eq(typeof def.term, 'string', `${id} の語`);
      eq(Array.isArray(def.lines), true, `${id} の lines`);
      eq(def.lines.length > 0 && def.lines.length <= 3, true, `${id} は ${def.lines.length} 行`);
      eq(Array.isArray(def.aliases), true, `${id} の aliases`);
    }
  });

  test('辞典: 病名を書かない（検体と検査室の言葉だけ）', () => {
    // conditions.json の病態名。normal の「特記なし」は病名ではないので外す
    const names = Object.entries(data.conditions.conditions)
      .filter(([id]) => id !== 'normal')
      .map(([, c]) => c.label);
    const words = [...names, '貧血', '炎症', '血症', '出血', '感染'];
    for (const [id, def] of Object.entries(terms)) {
      const text = def.lines.join('');
      for (const word of words) {
        eq(text.includes(word), false, `${id} に病名らしき語「${word}」がある`);
      }
    }
  });

  test('辞典: 疑いタブの id が全部ある。見出しの「疑い」も引ける', () => {
    for (const s of data.suspects.suspects) {
      eq(Boolean(terms[s.id]), true, `疑い ${s.id} が辞典にない`);
    }
    eq(Boolean(terms.suspect), true, 'タブの見出しの「疑い」が辞典にない');
    // real は「採血に問題なし」。重さの話ではないことを辞典でも言う
    eq(terms.real.term, '採血に問題なし');
    eq(terms.real.lines.join('').includes('重'), false, 'real の説明で重さを言っている');
  });

  test('辞典: 別名は長いものから当てる（「溶血」が「溶血（3+）」を食わない）', () => {
    const html = linkTerms('検体状態：溶血（3+）。前回値との乖離もある。', glossary);
    eq(html.includes('>溶血（3+）</button>'), true, '溶血（3+）が一語で当たる');
    eq(html.includes('>前回値との乖離</button>'), true, '前回値との乖離が一語で当たる');
    eq(html.includes('>溶血</button>'), false, '短いほうで切られていない');
  });

  test('辞典: 語のないところは素通しでエスケープされる', () => {
    eq(linkTerms('<b>x</b>', glossary), '&lt;b&gt;x&lt;/b&gt;');
    eq(termLink(glossary, 'nothing', 'そのまま'), 'そのまま', '知らないIDはただの文字');
  });

  test('見る順番: 五行で、症例固有のことを書かない', () => {
    const order = glossary.reading_order;
    eq(order.steps.length, 5);
    eq(order.steps.map((s) => s.term).join(','), '検体状態,フラグ,前回値,バイタル,報告レベル');
    const text = JSON.stringify(order);
    for (const c of data.cases) {
      eq(text.includes(c.patient.id), false, `見る順番に ${c.id} のことが書いてある`);
    }
    const html = renderTermPanel(glossary, null);
    eq(html.includes('見る順番'), true);
    eq((html.match(/class="term-card/g) || []).length, Object.keys(terms).length, '辞典の語が全部並ぶ');
  });

  test('索引パネル: 項目と言葉のタブがあり、既存の索引は項目に入る', () => {
    const tests = renderGlossaryPanel(data, { tab: 'tests', testId: 'K' }, 'M');
    eq(tests.includes('data-gl-tab="tests"'), true);
    eq(tests.includes('data-gl-tab="terms"'), true);
    eq(tests.includes('5. 検体トラブルで偽の値が出る条件'), true, '既存の索引5枠');

    const words = renderGlossaryPanel(data, { tab: 'terms', termId: 'hemolysis' }, 'M');
    eq(words.includes('id="term-hemolysis"'), true);
    eq(words.includes('term-card is-current'), true, '開いた語が目印になる');
  });

  test('索引パネル: タブの帯に閉じるがある（本文より上＝貼り付く側）', () => {
    const cases = [
      [{ tab: 'tests', testId: 'K' }, '5. 検体トラブルで偽の値が出る条件'],
      [{ tab: 'terms', termId: 'hemolysis' }, '見る順番'],
    ];
    for (const [view, marker] of cases) {
      const html = renderGlossaryPanel(data, view, 'M');
      const bar = html.indexOf('class="gl-bar"');
      const close = html.indexOf('class="gl-close"');
      eq(bar >= 0, true, `${view.tab}: タブの帯がない`);
      eq(close > bar, true, `${view.tab}: 閉じるが帯の中にない`);
      eq(html.slice(bar, close).includes('data-gl-tab="terms"'), true, `${view.tab}: 帯にタブが入っていない`);
      eq(html.includes('data-action="close-glossary"'), true, `${view.tab}: 閉じるが押せない`);
      // 帯より下が本文。閉じるは本文より前にあるので、どこまで送っても貼り付いたまま押せる
      eq(close < html.indexOf(marker), true, `${view.tab}: 閉じるが本文より後ろにある`);
    }
  });

  // ---- 疑い「採血に問題なし」（docs/suspect-real.md）----
  test('疑いタブ: どのラベルにも「本物」を使わない', () => {
    for (const s of data.suspects.suspects) {
      eq(`${s.label}${s.hint}`.includes('本物'), false, `${s.id} のラベル・ヒント`);
    }
    const real = data.suspects.suspects.find((s) => s.id === 'real');
    eq(real.label, '採血に問題なし（値は患者由来）', '内部IDは real のまま、言い方だけ変える');
  });

  test('コメントの一覧: 「本物」も「検体に問題なし」も使わない', () => {
    // 「検体に問題なし」は「体に異常なし」と読み違える。動作の言葉「採血」で言う
    for (const t of data.commentTemplates.templates) {
      for (const word of ['本物', '検体に問題なし']) {
        eq(`${t.text}${t.speech}`.includes(word), false, `${t.id} に「${word}」がある`);
      }
    }
    const real = data.commentTemplates.templates.find((t) => t.id === 'real');
    eq(real.text, '{item}：採血に問題なし、値は患者由来と判断');
  });

  test('報告対象の並び: 疑いの札は末尾の補足を落として並べる', () => {
    const sel = { marks: ['Hb'], suspects: { Hb: ['real'] } };
    eq(markSummary(sel, data), 'Hb（採血に問題なし）', '括弧が入れ子にならない');
    eq(markSummary({ marks: ['K'], suspects: { K: ['hemolysis'] } }, data), 'K（溶血）');
    eq(markSummary({ marks: [] }, data).includes('なし'), true, 'マーク0件でも報告はできる');
  });

  test('報告対象の並び: 同じ疑いの組が続く項目はまとめる', () => {
    const same = ['Hb', 'Ht', 'MCV'];
    const real = Object.fromEntries(same.map((id) => [id, ['real']]));
    eq(markSummary({ marks: same, suspects: real }, data), 'Hb・Ht・MCV（採血に問題なし）');

    // 疑いが違えば分ける
    eq(markSummary({ marks: ['K', 'LD'], suspects: { K: ['real', 'hemolysis'], LD: ['hemolysis'] } }, data),
      'K（採血に問題なし・溶血） ／ LD（溶血）');
    // 疑いなしはまとめない
    eq(markSummary({ marks: ['Hb', 'Ht'] }, data), 'Hb ／ Ht');
    eq(markSummary({ marks: ['Hb', 'Ht', 'K'], suspects: { Hb: ['real'], Ht: ['real'] } }, data),
      'Hb・Ht（採血に問題なし） ／ K');
    // 間に別の疑いが挟まれば、続きとは見ない
    eq(markSummary({ marks: ['Hb', 'K', 'Ht'], suspects: { Hb: ['real'], K: ['hemolysis'], Ht: ['real'] } }, data),
      'Hb（採血に問題なし） ／ K（溶血） ／ Ht（採血に問題なし）');
  });

  test('ナビ: 症例2・3が「採血に問題なし」を選ぶ根拠を言う', () => {
    for (const id of ['msg_n02_nav_kanae', 'msg_n02_nav_yusuke', 'msg_n03_nav_kanae', 'msg_n03_nav_yusuke']) {
      const msg = data.messages.messages[id];
      eq(msg.focus.length, msg.body.length, `${id} の focus は本文と同じ数`);
      const said = msg.body.filter((line) => line.includes('採血に問題な'));
      eq(said.length > 0, true, `${id} が疑いの選び方に触れていない`);
      // 根拠は検体状態から見る。指さしは一文に一か所
      const at = msg.body.findIndex((line) => line.includes('採血'));
      eq(msg.focus[at], 'sample_state', `${id} は採血の話を検体状態から始めていない`);
    }
    // 症例3は三つの根拠（検体状態・関連項目・前回値）を並べる
    for (const id of ['msg_n03_nav_kanae', 'msg_n03_nav_yusuke']) {
      const text = data.messages.messages[id].body.join('');
      for (const word of ['検体状態', 'MCV', '前回']) {
        eq(text.includes(word), true, `${id} に根拠「${word}」がない`);
      }
    }
  });

  // ---- 画面のどこから引けるか ----
  test('結果画面: 検体状態欄・フラグ・Δ・列見出しから辞典に開ける', () => {
    const c = caseById.n06; // Δが点いていて、検体状態は特記なし
    const html = renderResults(c, buildPanel(c, data), data, view());
    eq(html.includes('data-term="sample_state"'), true, '検体状態');
    eq(html.includes('data-term="flags"'), true, 'フラグ');
    eq(html.includes('data-term="delta"'), true, 'Δ');
    eq(html.includes('data-term="previous"'), true, '前回値');
    eq(html.includes('data-term="reference"'), true, '基準範囲');

    const n05 = caseById.n05; // 溶血（3+）が検体状態欄に出る
    const html5 = renderResults(n05, buildPanel(n05, data), data, view());
    eq(html5.includes('data-term="hemolysis"'), true, '検体状態欄の「溶血（3+）」');
  });

  test('患者情報欄には辞典のリンクを付けない（病名側の言葉に下線を引かない）', () => {
    for (const c of data.cases) {
      const html = renderResults(c, buildPanel(c, data), data, view());
      eq(html.includes(`<dd>${c.patient.note}</dd>`), true, `${c.id} の主訴が素のまま`);
    }
    // 主訴に辞典の語が入っていても、そこはリンクにしない
    const c = { ...caseById.n01, patient: { ...caseById.n01.patient, note: '溶血の話と前回値の話' } };
    const html = renderResults(c, buildPanel(c, data), data, view());
    eq(html.includes('<dd>溶血の話と前回値の話</dd>'), true);
  });

  test('本文の自動リンク: ナビ・講評・申し送りだけ。医師の返信は触らない', () => {
    const mentor = data.mentors.mentors[0];
    const render = (id, gl = glossary) =>
      renderMessages([{ id, ...data.messages.messages[id] }], mentor, gl);
    eq(render('msg_n01_nav_kanae').includes('data-term="sample_state"'), true, 'ナビ');
    eq(render('msg_n05_ok_kanae').includes('data-term="hemolysis"'), true, '講評');
    eq(render('msg_n01_intro').includes('data-term='), true, '申し送り');
    eq(render('msg_n05_over').includes('data-term='), false, '医師の返信は触らない');
    eq(render('msg_n05_recollect').includes('data-term='), false, '受付の記録も触らない');
    eq(render('msg_n01_nav_kanae', null).includes('data-term='), false, '辞典なしでも壊れない');
  });

  // ---- 報告ダイアログ ----
  test('報告ダイアログ: 自由記述の欄がない', () => {
    const c = caseById.n03;
    const options = buildCommentOptions({ data, panel: buildPanel(c, data), marks: ['Hb'], suspects: { Hb: ['real'] } });
    const html = renderReportDialog(c, data, { marks: ['Hb'], suspects: {}, commentOptions: options, commentSelected: [] });
    eq(html.includes('<textarea'), false, 'textarea が残っている');
    // 残ってよい input はレベルのラジオと再採血のチェックだけ
    const types = [...html.matchAll(/<input[^>]*type="([a-z]+)"/g)].map((m) => m[1]);
    eq([...new Set(types)].sort().join(','), 'checkbox,radio');
    eq(html.includes('data-term="levels"'), true, '報告レベルから辞典に開ける');
    eq(html.includes('data-term="comment"'), true, 'コメントの見出しから辞典に開ける');
  });

  test('コメント欄: 候補のタップで選ぶ。上限に達したら残りは押せない', () => {
    const c = caseById.n05;
    const panel = buildPanel(c, data);
    const options = buildCommentOptions({
      data, panel, marks: ['K'], suspects: { K: ['real', 'hemolysis'] }, recheck: true,
    });
    const max = data.commentTemplates.max_lines;
    const selected = options.slice(0, max).map((o) => o.id);
    const html = renderCommentPicker(data, { commentOptions: options, commentSelected: selected });
    eq((html.match(/class="comment-opt is-on"/g) || []).length, max, '選んだ行');
    eq((html.match(/ disabled/g) || []).length, options.length - max, '残りは押せない');
    eq(html.includes(`選択 ${max} / ${max} 行`), true);
    eq(renderCommentPicker(data, { commentOptions: [], commentSelected: [] }).includes('候補がありません'), true);
  });

  test('コメント欄: 群ごとに畳む。既定で開くのは「値について」だけ', () => {
    const c = caseById.n05;
    const options = buildCommentOptions({ data, panel: buildPanel(c, data), marks: ['K'], recheck: true });
    const html = renderCommentPicker(data, { commentOptions: options, commentSelected: [] });

    for (const g of data.commentTemplates.groups) {
      eq(html.includes(`data-comment-group="${g.id}"`), true, `${g.id} の群がない`);
    }
    // 既定で open が付くのは、一覧で open: true の群だけ
    const opened = [...html.matchAll(/<details class="comment-group"( open)?>/g)].map((m) => Boolean(m[1]));
    const wanted = data.commentTemplates.groups.map((g) => Boolean(g.open));
    eq(opened.join(','), wanted.join(','), '既定の開き方');

    // 一度開いた群は開いたまま渡せる
    const all = renderCommentPicker(data, {
      commentOptions: options, commentSelected: [], commentGroupsOpen: ['value', 'sample', 'action'],
    });
    eq((all.match(/class="comment-group" open/g) || []).length, 3);
    eq(all.includes('検体について'), true, '群の見出し');
  });

  // ---- 指さし ----
  test('指さし: focus は決まった8つの領域だけ', () => {
    for (const [id, msg] of Object.entries(data.messages.messages)) {
      if (!msg.focus) continue;
      eq(Array.isArray(msg.focus), true, `${id} の focus は配列`);
      eq(msg.focus.length, msg.body.length, `${id} の focus は本文と同じ数`);
      for (const f of msg.focus) {
        if (f === null) continue;
        eq(FOCUS_IDS.includes(f), true, `${id} の focus に知らない領域 ${f}`);
      }
    }
  });

  test('指さし: 症例1〜3のナビだけに入れる（症例4以降は書かない）', () => {
    for (const c of data.cases) {
      const navs = [].concat(c.nav ?? []).map((id) => data.messages.messages[id]);
      const hasFocus = navs.some((m) => Array.isArray(m.focus) && m.focus.some(Boolean));
      eq(hasFocus, POINTING_CASES.includes(c.id), `${c.id} の指さし`);
    }
  });

  test('指さし: 一文に一か所だけ。「ここ」が本文に付く', () => {
    const nav = data.messages.messages.msg_n01_nav_kanae;
    const html = renderMessages([{ id: 'a', ...nav }], data.mentors.mentors[0], glossary);
    const points = [...html.matchAll(/data-point="([a-z_]+)"/g)].map((m) => m[1]);
    eq(points.join(','), 'flags,sample_state,previous,report');
    // 段落ごとに多くても1つ
    for (const p of html.split('</p>')) {
      eq((p.match(/data-point=/g) || []).length <= 1, true, '一文に二か所光らせている');
    }
  });

  // ---- 症例0の指さし（自動発火） ----
  test('症例0: 10ステップで、各文に指さしを持つ', () => {
    const tutorial = data.tutorial;
    eq(stepCount(tutorial), 10);
    for (const step of tutorial.steps) {
      for (const id of data.mentors.mentors.map((m) => m.id)) {
        const line = step.lines[id];
        eq(Array.isArray(line.focus), true, `${step.id} ${id} に focus がない`);
        eq(line.focus.length, line.body.length, `${step.id} ${id} の focus は本文と同じ数`);
        for (const f of line.focus) {
          if (f === null) continue;
          eq(FOCUS_IDS.includes(f), true, `${step.id} ${id} の focus に知らない領域 ${f}`);
        }
      }
    }
  });

  // 症例0の枠は次の文まで出したまま。続きの文には同じ場所を書き（枠はそのまま動かない）、
  // 指す先がない文だけ null にして消す。一度離れた場所を指し直すと線を引き直すので、点滅に見える
  test('症例0: 一度離れた場所を、同じステップで指し直さない（点滅に見えるため）', () => {
    for (const step of data.tutorial.steps) {
      for (const id of data.mentors.mentors.map((m) => m.id)) {
        const focus = step.lines[id].focus;
        const seen = [];
        for (let i = 0; i < focus.length; i += 1) {
          if (!focus[i] || focus[i] === focus[i - 1]) continue; // 続きの文はそのまま
          eq(seen.includes(focus[i]), false, `${step.id} ${id} で ${focus[i]} を指し直している`);
          seen.push(focus[i]);
        }
      }
    }
  });

  test('症例0: 見出しの pane と各文の focus は別もの', () => {
    for (const step of data.tutorial.steps) {
      eq(step.focus, undefined, `${step.id} に古い step.focus が残っている`);
      if (step.pane) {
        eq(typeof data.tutorial.focus_label[step.pane], 'string', `${step.id} の pane`);
      }
    }
  });

  test('症例0の結果画面: 骨組みに指さしの的があり、検査値は出ない', () => {
    const html = renderTutorialPlaceholder(data);
    for (const region of ['patient', 'sample_state', 'results', 'flags', 'previous', 'investigate']) {
      eq(html.includes(`data-region="${region}"`), true, `${region} の的がない`);
    }
    // 結果と前回値は「―」のまま。患者の値は一つも出さない
    eq(/<td data-col="value">―<\/td>/.test(html), true, '結果が「―」でない');
    eq(html.includes('<td data-col="value">'), true);
    eq(/<td data-col="value">(?!―)/.test(html), false, '結果に数字が入っている');
    for (const c of data.cases) {
      eq(html.includes(c.patient.id), false, `${c.id} の患者が出ている`);
    }
    // 骨組みでも指さしの先が全部そろっている（症例0で使う領域）
    const used = new Set();
    for (const step of data.tutorial.steps) {
      for (const id of data.mentors.mentors.map((m) => m.id)) {
        for (const f of step.lines[id].focus) if (f) used.add(f);
      }
    }
    for (const region of used) {
      const inPlaceholder = html.includes(`data-region="${region}"`);
      // 骨組みの外（画面の枠）にある的。上のバーの「聞く」もここ
      const inShell = ['reception', 'messages', 'report', 'ask'].includes(region);
      eq(inPlaceholder || inShell, true, `${region} を指す先がどこにもない`);
    }
  });

  // ---- 受付一覧の並び ----
  const worklist = (status = {}, interrupt = null) => {
    const html = renderWorklist(data.cases, {
      status, results: {}, scoreLabel: {}, currentCaseId: null, interrupt,
    });
    return [...html.matchAll(/data-case="([^"]+)"/g)].map((m) => m[1]);
  };

  test('受付一覧: 閉じた検体は灰色にして下へ流す。まだのものが上に残る', () => {
    const ids = data.cases.map((c) => c.id);
    eq(worklist().join(','), ids.join(','), '何も報告していなければ元の順');

    // 先頭を閉じると、その1件だけが末尾へ。残りの順番は変えない
    const done = { [ids[0]]: 'done' };
    eq(worklist(done).join(','), [...ids.slice(1), ids[0]].join(','));

    const html = renderWorklist(data.cases, {
      status: done, results: {}, scoreLabel: {}, currentCaseId: null, interrupt: null,
    });
    eq((html.match(/wl-row is-done/g) || []).length, 1, '灰色は閉じた1件だけ');
    eq(html.includes(`data-case="${ids[0]}"`), true, '閉じても一覧から消さない（開いて読み返せる）');
  });

  test('受付一覧: 割り込みは先頭のまま。灰色が下へ流れてもぶつからない', () => {
    // 症例3を未報告のまま症例4を報告した形（割り込みは閉じると解除されるので interrupt は null）
    const ids = data.cases.map((c) => c.id);
    const order = worklist({ n04: 'done' });
    eq(order[0], 'n01');
    eq(order.indexOf('n03') < order.indexOf('n04'), true, '未報告の症例3が報告済の症例4より上');
    eq(order[order.length - 1], 'n04', '閉じた症例4が末尾');

    // 割り込みが立っている間（症例4はまだ閉じていない）は、その検体が先頭
    const cutIn = worklist({ n01: 'done' }, { active: true, caseId: 'n04' });
    eq(cutIn[0], 'n04', '割り込みが先頭');
    eq(cutIn[cutIn.length - 1], 'n01', '閉じた検体は末尾のまま');
  });

  test('受付一覧: 症例7の一本目は報告しても閉じないので上に残る', () => {
    // 差し戻し待ち（waiting）と二本目待ち（recollect）はどちらも「閉じていない」
    for (const status of ['waiting', 'recollect']) {
      const order = worklist({ n07: status, n01: 'done' });
      eq(order.indexOf('n07') < order.indexOf('n01'), true, `${status} の症例7が下に流れている`);
      const html = renderWorklist(data.cases, {
        status: { n07: status }, results: {}, scoreLabel: {}, currentCaseId: null, interrupt: null,
      });
      eq(html.includes('is-done'), false, `${status} で灰色になっている`);
      eq(html.includes(status === 'waiting' ? '再採血 待ち' : '再採血'), true, '状態の札が出ていない');
    }
  });

  // ---- 危険域（パニック値）の表示 ----
  test('危険域: 結果の行に出る。行動（電話・緊急）は書かない', () => {
    const c = caseById.n04; // K 6.8 の HH がある
    const html = renderResults(c, buildPanel(c, data), data, view());
    eq(html.includes('class="danger-range">6.0以上・2.5以下は危険域'), true, 'K の危険域が出ていない');
    const notes = html.match(/<span class="danger-range">[^<]*<\/span>/g) || [];
    eq(notes.length > 0, true);
    for (const note of notes) {
      for (const word of ['電話', '緊急', '報告']) {
        eq(note.includes(word), false, `危険域に「${word}」が入っている: ${note}`);
      }
    }
  });

  test('危険域の札: HH / LL にだけ添える。H / L には付けない', () => {
    for (const c of data.cases) {
      const panel = buildPanel(c, data);
      const html = renderResults(c, panel, data, view());
      const badges = (html.match(/class="panic-note"/g) || []).length;
      eq(badges, panel.rows.filter((r) => r.panic).length, `${c.id} の札の数`);
      const flagged = panel.rows.filter((r) => r.flag && !r.panic).length;
      if (flagged && !panel.rows.some((r) => r.panic)) eq(badges, 0, `${c.id} は H / L だけなので札は出ない`);
    }
    // 札は「パニック値」まで。次にどうするかは検体状態を見てから決める
    const c = caseById.n04;
    const html = renderResults(c, buildPanel(c, data), data, view());
    const badge = html.match(/<span class="panic-note">([^<]*)<\/span>/);
    eq(badge && badge[1], 'パニック値');
  });

  test('指さし: 光らせる先が画面にある', () => {
    const c = caseById.n01;
    const html = renderResults(c, buildPanel(c, data), data, view());
    for (const region of ['patient', 'results', 'flags', 'sample_state', 'previous']) {
      eq(html.includes(`data-region="${region}"`), true, `${region} の的がない`);
    }
  });
}
