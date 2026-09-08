// 新人が読める画面（docs/readable.md）のテスト。
// 辞典・組み立て式コメントの画面側・指さし。値の計算は derive.test.js、判定は report.test.js。

import { test, eq } from './harness.js';
import { renderResults, renderGlossaryPanel, renderTermPanel, linkTerms, termLink } from '../src/lis.js';
import { renderReportDialog, renderCommentPicker } from '../src/report.js';
import { renderMessages } from '../src/messages.js';
import { buildPanel, buildCommentOptions } from '../src/derive.js';

const FOCUS_IDS = [
  'reception', 'patient', 'results', 'flags', 'sample_state', 'previous', 'messages', 'report',
];

/** 症例4以降は結論を言わない段階なので、指さしを書かない。 */
const POINTING_CASES = ['n01', 'n02', 'n03'];

export function suite(data) {
  const glossary = data.glossary;
  const terms = glossary.terms;
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));
  const view = (extra = {}) => ({
    marks: [], suspects: {}, suspectDefs: data.suspects.suspects, glossary, interactive: true, ...extra,
  });

  // ---- 辞典 ----
  test('辞典: 16語あり、一語は三行以内', () => {
    eq(Object.keys(terms).length, 16);
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

  test('辞典: 疑いタブの id（real 以外）が全部ある', () => {
    for (const s of data.suspects.suspects) {
      if (s.id === 'real') continue;
      eq(Boolean(terms[s.id]), true, `疑い ${s.id} が辞典にない`);
    }
    eq(Boolean(terms.real), false, 'real は辞典に持たない');
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
    eq((html.match(/class="term-card/g) || []).length, 16, '辞典の語が全部並ぶ');
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

  test('指さし: 光らせる先が画面にある', () => {
    const c = caseById.n01;
    const html = renderResults(c, buildPanel(c, data), data, view());
    for (const region of ['patient', 'results', 'flags', 'sample_state', 'previous']) {
      eq(html.includes(`data-region="${region}"`), true, `${region} の的がない`);
    }
  });
}
