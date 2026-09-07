// LIS結果画面・受付一覧・索引パネルの描画。
// 状態は持たず、渡されたデータからHTML文字列を作るだけにする。

import { rangeFor, formatRange } from './derive.js';

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const SEX_LABEL = { M: '男', F: '女' };

/** マーク欄の記号。反転（色）だけに頼らず、記号でも分かるようにする。 */
const MARK_ON = '✓';

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
      : { ready: '測定完了', current: '確認中' }[status] || status;
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
  const p = caseDef.patient;
  const sampleLines = [];
  if (panel.sampleComment) sampleLines.push(panel.sampleComment);
  if (panel.hasUnmeasurable) sampleLines.push('一部項目 測定不可');
  const sampleText = sampleLines.length ? sampleLines.join(' ／ ') : '特記なし';

  const prevNote = caseDef.previous
    ? `${caseDef.previous.date}（${caseDef.previous.note}）`
    : 'なし';

  const tables = panel.panels.map((pn) => renderPanelTable(pn, view)).join('');

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
        <dt>検体状態</dt><dd class="${sampleLines.length ? 'is-flagged' : ''}">${esc(sampleText)}</dd>
        <dt>前回検査</dt><dd>${esc(prevNote)}</dd>
      </dl>
    </div>
    ${tables}
    <p class="hint">
      項目名をタップすると索引が開きます。${view ? '行をタップするとマークが付き、その行だけが報告に載ります。' : ''}
    </p>
  `;
}

function renderPanelTable(pn, view = null) {
  const marks = new Set(view?.marks || []);
  const interactive = Boolean(view && view.interactive);

  const rows = pn.rows.map((r) => {
    const marked = marks.has(r.id);
    const flagClass = r.flag ? (r.panic ? 'flag flag-panic' : 'flag') : 'flag';
    // 色はフラグ記号の補助。記号を消して色だけにしてはいけない。
    const cellClass = r.panic ? ' class="is-panic"' : r.flag ? ' class="is-warn"' : '';
    const deltaMark = r.delta ? '<span class="delta" title="前回値から規定幅を超えて変動">Δ</span>' : '';

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
        <td data-col="ref"><span class="lbl">基準</span>${esc(r.referenceDisplay)}</td>
        <td data-col="flag"${cellClass}><span class="${flagClass}">${esc(r.flag)}</span></td>
        <td data-col="prev"><span class="lbl">前回</span>${esc(r.previousDisplay)}</td>
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
          <th scope="col">基準範囲</th>
          <th scope="col">フラグ</th>
          <th scope="col">前回値</th>
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
      return `
        <button type="button" class="suspect${on ? ' is-on' : ''}"
                data-suspect-test="${esc(row.id)}" data-suspect="${esc(s.id)}"
                aria-pressed="${on}" title="${esc(s.hint || '')}"${interactive ? '' : ' disabled'}>
          <span class="suspect-check">${on ? MARK_ON : ''}</span>${esc(s.label)}
        </button>`;
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

/** 再採血した検体の結果。再採血を依頼したときだけ、最初の検体の下に並べる。 */
export function renderRecollect(caseDef, panel) {
  const re = caseDef.recollect;
  const sampleText = panel.sampleComment || '特記なし';
  return `
    <section class="recollect">
      <h3 class="recollect-head">再採血検体　${esc(re.accession)}　採取 ${esc(re.received_at)}</h3>
      <dl class="pt-meta">
        <dt>検体状態</dt><dd class="${panel.sampleComment ? 'is-flagged' : ''}">${esc(sampleText)}</dd>
        <dt>前回値欄</dt><dd>同じ患者の最初の検体（${esc(caseDef.accession)}）の値を並べています。</dd>
      </dl>
      ${panel.panels.map((pn) => renderPanelTable(pn)).join('')}
    </section>`;
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
