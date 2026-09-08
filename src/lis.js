// LIS結果画面・受付一覧・索引パネルの描画。
// 状態は持たず、渡されたデータからHTML文字列を作るだけにする。

import { rangeFor, formatRange, sampleStateText } from './derive.js';

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const SEX_LABEL = { M: '男', F: '女' };

/** マーク欄の記号。反転（色）だけに頼らず、記号でも分かるようにする。 */
const MARK_ON = '✓';

/* ---- 用語辞典 ----
   画面に出る言葉に下線を付け、タップで索引パネルの「言葉」タブに開く。
   索引（項目）と同じ動きにそろえてある。 */

const TERM_INDEX = new WeakMap();

/** 語と別名を長い順に並べた索引。長いものから当てないと「溶血」が「溶血（2+）」を食う。 */
function termIndex(glossary) {
  if (!glossary || !glossary.terms) return [];
  const cached = TERM_INDEX.get(glossary);
  if (cached) return cached;
  const list = [];
  for (const [id, def] of Object.entries(glossary.terms)) {
    for (const text of [def.term, ...(def.aliases || [])]) list.push({ id, text });
  }
  list.sort((a, b) => b.text.length - a.text.length);
  TERM_INDEX.set(glossary, list);
  return list;
}

/** 語ひとつぶんのリンク。索引の項目名と同じ見た目にする。 */
export function termLink(glossary, id, label = null) {
  const def = glossary && glossary.terms ? glossary.terms[id] : null;
  const text = label ?? (def ? def.term : id);
  if (!def) return esc(text);
  return `<button type="button" class="term" data-term="${esc(id)}">${esc(text)}</button>`;
}

/**
 * 本文の中の語を自動でリンクにする。エスケープもここで済ませる（戻り値はHTML）。
 * 患者情報欄（主訴・既往）には使わない——病名側の言葉に下線を付けないため。
 */
export function linkTerms(text, glossary) {
  const source = String(text ?? '');
  const index = termIndex(glossary);
  if (!index.length) return esc(source);

  let out = '';
  let i = 0;
  while (i < source.length) {
    const hit = index.find((entry) => source.startsWith(entry.text, i));
    if (hit) {
      out += `<button type="button" class="term" data-term="${esc(hit.id)}">${esc(hit.text)}</button>`;
      i += hit.text.length;
    } else {
      out += esc(source[i]);
      i += 1;
    }
  }
  return out;
}

/* view = { marks, suspects, suspectDefs, interactive }
   view を渡さない表（再採血検体）はマーク欄も疑いタブも出さない読み取り専用になる。 */
const COLS_PLAIN = 6;
const COLS_MARKED = 7;

/** 3-2. 受付一覧。ER検体は「至急」を付けて先頭に寄せる。 */
export function renderWorklist(cases, state) {
  const ordered = orderForWorklist(cases, state.interrupt);
  const rows = ordered.map((c) => {
    const status = state.status[c.id] || 'ready';
    const scored = state.results[c.id];
    const statusLabel = scored
      ? `報告済 ${state.scoreLabel[scored.score] || ''}`
      : { ready: '測定完了', current: '確認中', waiting: '再採血 待ち', recollect: '再採血' }[status] ||
        status;
    const cutIn = isCutIn(c.id, state.interrupt);
    const urgent = cutIn || c.patient.from === 'ER';
    const selected = c.id === state.currentCaseId;
    const classes = ['wl-row'];
    if (selected) classes.push('is-selected');
    if (cutIn) classes.push('is-interrupt');
    if (cutIn && state.interrupt.blink) classes.push('is-blinking');
    return `
      <li>
        <button class="${classes.join(' ')}" data-case="${esc(c.id)}" type="button">
          <span class="wl-acc">${esc(c.accession)}</span>
          <span class="wl-mark">${cutIn ? '至急⚑' : urgent ? '至急' : '　　'}</span>
          <span class="wl-pt">${esc(c.patient.id)} ${esc(c.patient.label)}</span>
          <span class="wl-from">${esc(c.patient.from)}</span>
          <span class="wl-order">${esc(c.order.join(' / '))}</span>
          <span class="wl-status">${esc(statusLabel)}</span>
          <span class="wl-title">${esc(cutIn ? `割り込み　${c.title}` : c.title)}</span>
        </button>
      </li>`;
  });
  return `<ul class="worklist">${rows.join('')}</ul>`;
}

function isCutIn(caseId, interrupt) {
  return Boolean(interrupt && interrupt.active && interrupt.caseId === caseId);
}

/** 割り込みが入っている間だけ、その検体を一覧の先頭に上げる。 */
function orderForWorklist(cases, interrupt) {
  const cutIn = cases.find((c) => isCutIn(c.id, interrupt));
  if (!cutIn) return cases;
  return [cutIn, ...cases.filter((c) => c.id !== cutIn.id)];
}

/** 3-1. LIS結果画面。 */
export function renderResults(caseDef, panel, data, view = null) {
  const glossary = data.glossary;
  const p = caseDef.patient;
  const sample = sampleStateText(panel);
  const sampleText = sample || '特記なし';

  const prevNote = caseDef.previous
    ? `${caseDef.previous.date}（${caseDef.previous.note}）`
    : 'なし';

  const v = view ? { glossary, ...view } : null;
  const tables = panel.panels.map((pn) => renderPanelTable(pn, v, glossary)).join('');

  return `
    <div class="pt-head">
      <div class="pt-line">
        <span class="pt-acc">受付 ${esc(caseDef.accession)}</span>
        <span class="pt-time">受付時刻 ${esc(caseDef.received_at)}</span>
      </div>
      <div class="pt-line">
        <span class="pt-id">${esc(p.id)}</span>
        <span class="pt-name">${esc(p.label)}</span>
        <span class="pt-demo">${esc(p.age)}歳 ${esc(SEX_LABEL[p.sex] || p.sex)}</span>
        <span class="pt-from">依頼元 ${esc(p.from)}</span>
      </div>
      <dl class="pt-meta">
        ${p.note ? `<dt>主訴</dt><dd>${esc(p.note)}</dd>` : ''}
        ${p.vitals ? `<dt>バイタル</dt><dd>脈拍 ${esc(p.vitals.pulse)} /分　血圧 ${esc(p.vitals.bp)} mmHg</dd>` : ''}
        <dt>${termLink(glossary, 'sample_state', '検体状態')}</dt>
        <dd class="${sample ? 'is-flagged' : ''}" data-region="sample_state">${linkTerms(sampleText, glossary)}</dd>
        <dt>前回検査</dt><dd>${esc(prevNote)}</dd>
      </dl>
    </div>
    ${tables}
    <p class="hint">
      項目名をタップすると索引が開きます。${
        view && view.interactive ? '行をタップするとマークが付き、その行だけが報告に載ります。' : ''
      }
    </p>
  `;
}

function renderPanelTable(pn, view = null, glossary = null) {
  const marks = new Set(view?.marks || []);
  const interactive = Boolean(view && view.interactive);

  const rows = pn.rows.map((r) => {
    const marked = marks.has(r.id);
    const flagClass = r.flag ? (r.panic ? 'flag flag-panic' : 'flag') : 'flag';
    // 色はフラグ記号の補助。記号を消して色だけにしてはいけない。
    const cellClass = r.panic ? ' class="is-panic"' : r.flag ? ' class="is-warn"' : '';
    // Δとフラグ記号は辞典に開く。記号そのものが説明への入口になる
    const deltaMark = r.delta
      ? `<span class="delta" title="前回値から規定幅を超えて変動">${termLink(glossary, 'delta', 'Δ')}</span>`
      : '';
    const flagMark = r.flag ? termLink(glossary, 'flags', r.flag) : '';

    const rowClasses = [];
    if (r.flag) rowClasses.push('is-flagged');
    if (marked) rowClasses.push('is-marked');
    // 反転は選択状態の表示。マーク欄の記号と aria-pressed を必ず併せて出す。
    const markAttrs = interactive
      ? ` data-mark="${esc(r.id)}" role="button" tabindex="0" aria-pressed="${marked}"`
      : '';
    const markCell = view
      ? `<td data-col="mark"><span class="mark-box">${marked ? MARK_ON : ''}</span></td>`
      : '';

    return `
      <tr${rowClasses.length ? ` class="${rowClasses.join(' ')}"` : ''}${markAttrs}>
        ${markCell}
        <th scope="row" data-col="name">
          <button class="test-name" type="button" data-test="${esc(r.id)}">
            <span class="t-abbr">${esc(r.abbr)}</span>
            <span class="t-name">${esc(r.name)}</span>
          </button>
        </th>
        <td data-col="value">${esc(r.display)}${deltaMark}</td>
        <td data-col="unit">${esc(r.unit)}</td>
        <td data-col="ref"><span class="lbl">${termLink(glossary, 'reference', '基準')}</span>${esc(r.referenceDisplay)}</td>
        <td data-col="flag"${cellClass} data-region="flags"><span class="${flagClass}">${flagMark}</span></td>
        <td data-col="prev" data-region="previous"><span class="lbl">${termLink(glossary, 'previous', '前回')}</span>${esc(r.previousDisplay)}</td>
      </tr>${view && marked ? renderSuspectRow(r, view) : ''}`;
  });

  return `
    <table class="lis-table${view ? ' has-mark' : ''}">
      <caption>${esc(pn.label)}</caption>
      <thead>
        <tr>
          ${view ? '<th scope="col">印</th>' : ''}
          <th scope="col">項目</th>
          <th scope="col">結果</th>
          <th scope="col">単位</th>
          <th scope="col">${termLink(glossary, 'reference', '基準範囲')}</th>
          <th scope="col">${termLink(glossary, 'flags', 'フラグ')}</th>
          <th scope="col">${termLink(glossary, 'previous', '前回値')}</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

/** マークした行の下に開く疑いタブ。病名は並べない（検体・検査室側の見立てだけ）。 */
function renderSuspectRow(row, view) {
  const chosen = new Set((view.suspects || {})[row.id] || []);
  const interactive = Boolean(view.interactive);
  const chips = (view.suspectDefs || [])
    .map((s) => {
      const on = chosen.has(s.id);
      // 疑いの語も辞典に開けるようにする。ボタンの入れ子は作れないので、
      // 選ぶボタンの隣に小さな「?」を置く（real は辞典に持たない）
      const help = view.glossary && view.glossary.terms[s.id]
        ? `<button type="button" class="term-help" data-term="${esc(s.id)}"
                   aria-label="${esc(s.label)}とは">?</button>`
        : '';
      return `
        <span class="suspect-wrap">
          <button type="button" class="suspect${on ? ' is-on' : ''}"
                  data-suspect-test="${esc(row.id)}" data-suspect="${esc(s.id)}"
                  aria-pressed="${on}" title="${esc(s.hint || '')}"${interactive ? '' : ' disabled'}>
            <span class="suspect-check">${on ? MARK_ON : ''}</span>${esc(s.label)}
          </button>${help}
        </span>`;
    })
    .join('');

  return `
    <tr class="suspect-row">
      <td colspan="${view ? COLS_MARKED : COLS_PLAIN}">
        <div class="suspects" role="group" aria-label="${esc(row.abbr)}の疑い">
          <span class="suspects-label">${esc(row.abbr)} の疑い</span>
          ${chips}
        </div>
      </td>
    </tr>`;
}

/**
 * 二本目の検体の結果。最初の検体の下に並べる。
 * 自分で依頼した再採血（`caseDef.recollect`）でも、差し戻しで届いた二本目
 * （`followup.recollect`）でも同じ見せ方をする。view を渡した表だけマークできる。
 */
export function renderRecollect(caseDef, panel, re = caseDef.recollect, view = null) {
  const sampleText = panel.sampleComment || '特記なし';
  return `
    <section class="recollect">
      <h3 class="recollect-head">再採血検体　${esc(re.accession)}　採取 ${esc(re.received_at)}</h3>
      <dl class="pt-meta">
        <dt>検体状態</dt><dd class="${panel.sampleComment ? 'is-flagged' : ''}">${esc(sampleText)}</dd>
        <dt>前回値欄</dt><dd>同じ患者の最初の検体（${esc(caseDef.accession)}）の値を並べています。</dd>
      </dl>
      ${panel.panels.map((pn) => renderPanelTable(pn, view, view ? view.glossary : null)).join('')}
      ${view && view.interactive ? '<p class="hint">報告するのはこの二本目です。行をタップしてマークしてください。</p>' : ''}
    </section>`;
}

/**
 * 索引パネル。上に「項目」「言葉」のタブを二つ持つ。
 * 項目＝検査項目の索引（5枠固定）。言葉＝画面に出る言葉の辞典（三行）。
 * view = { tab: 'tests' | 'terms', testId, termId }
 */
export function renderGlossaryPanel(data, view, sex = 'F') {
  const tab = view.tab === 'terms' ? 'terms' : 'tests';
  const tabs = [
    ['tests', '項目'],
    ['terms', '言葉'],
  ]
    .map(
      ([id, label]) => `
      <button type="button" class="gl-tab${id === tab ? ' is-selected' : ''}"
              role="tab" aria-selected="${id === tab}" data-gl-tab="${id}">${esc(label)}</button>`,
    )
    .join('');

  const body =
    tab === 'terms'
      ? renderTermPanel(data.glossary, view.termId)
      : view.testId
        ? renderGlossary(view.testId, data, sex)
        : '<p class="gl-empty">結果画面の項目名をタップすると、その項目の索引が開きます。</p>';

  return `<div class="gl-tabs" role="tablist">${tabs}</div>${body}`;
}

/** 「言葉」タブ。上に「見る順番」を固定で一枚、その下に辞典を表の順で並べる。 */
export function renderTermPanel(glossary, currentId = null) {
  const order = glossary.reading_order;
  const steps = order.steps
    .map(
      (s, i) => `
      <li><span class="ro-no">${i + 1}</span>
        <span class="ro-term">${linkTerms(s.term, glossary)}</span>
        <span class="ro-hint">${esc(s.hint)}</span></li>`,
    )
    .join('');

  const terms = Object.entries(glossary.terms)
    .map(
      ([id, def]) => `
      <section class="term-card${id === currentId ? ' is-current' : ''}" id="term-${esc(id)}">
        <h3>${esc(def.term)}${
          def.aliases && def.aliases.length
            ? `<span class="term-alias">${esc(def.aliases.join(' / '))}</span>`
            : ''
        }</h3>
        ${def.lines.map((line) => `<p>${esc(line)}</p>`).join('')}
      </section>`,
    )
    .join('');

  return `
    <section class="reading-order">
      <h2>${esc(order.title)}</h2>
      <ol>${steps}</ol>
      <p class="ro-note">${esc(order.note)}</p>
    </section>
    <div class="term-list">${terms}</div>`;
}

/** 索引（用語集）。枠は5つで固定。枠2の基準範囲は hospital.json から作る。 */
export function renderGlossary(testId, data, sex) {
  const test = data.tests.tests.find((t) => t.id === testId);
  if (!test) return '<p>項目が見つかりません。</p>';

  const ref = rangeFor(data.hospital, 'reference', testId, sex);
  const panic = rangeFor(data.hospital, 'panic', testId, sex);
  const refText = ref
    ? `${formatRange(ref, test.decimals)} ${test.unit}`
    : '当院の規定なし';
  const panicText = panic
    ? `パニック値 ${formatRange(panic, test.decimals)} ${test.unit}（この線を越えるとHH／LL）`
    : 'パニック値の設定なし';

  const slots = [
    ['1. 何を測っているか', esc(test.glossary.measures)],
    ['2. 基準範囲（当院の規定）', `${esc(refText)}<br><span class="sub">${esc(panicText)}</span>`],
    ['3. 高いと何が考えられるか', esc(test.glossary.high)],
    ['4. 低いと何が考えられるか', esc(test.glossary.low)],
    ['5. 検体トラブルで偽の値が出る条件', esc(test.glossary.artifact)],
  ];

  return `
    <h2 class="gl-title">${esc(test.abbr)}　${esc(test.name)}<span class="gl-unit">${esc(test.unit)}</span></h2>
    ${test.derived ? '<p class="gl-derived">この項目は他の測定値から計算して出しています。</p>' : ''}
    <dl class="glossary">
      ${slots.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}
    </dl>
    <p class="gl-foot">基準範囲・パニック値は${esc(data.hospital.hospital.name)}（架空）の${esc(data.hospital.hospital.policy_version)}運用規定による。</p>
  `;
}
