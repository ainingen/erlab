// LIS結果画面・受付一覧・索引パネルの描画。
// 状態は持たず、渡されたデータからHTML文字列を作るだけにする。

import { rangeFor, formatRange } from './derive.js';

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const SEX_LABEL = { M: '男', F: '女' };

/** 3-2. 受付一覧。ER検体は「至急」を付けて先頭に寄せる。 */
export function renderWorklist(cases, state) {
  const rows = cases.map((c) => {
    const status = state.status[c.id] || 'ready';
    const statusLabel = { ready: '測定完了', done: '報告済', current: '確認中' }[status] || status;
    const urgent = c.patient.from === 'ER';
    const selected = c.id === state.currentCaseId;
    return `
      <li>
        <button class="wl-row${selected ? ' is-selected' : ''}" data-case="${esc(c.id)}" type="button">
          <span class="wl-acc">${esc(c.accession)}</span>
          <span class="wl-mark">${urgent ? '至急' : '　　'}</span>
          <span class="wl-pt">${esc(c.patient.id)} ${esc(c.patient.label)}</span>
          <span class="wl-from">${esc(c.patient.from)}</span>
          <span class="wl-order">${esc(c.order.join(' / '))}</span>
          <span class="wl-status">${esc(statusLabel)}</span>
          <span class="wl-title">${esc(c.title)}</span>
        </button>
      </li>`;
  });
  return `<ul class="worklist">${rows.join('')}</ul>`;
}

/** 3-1. LIS結果画面。 */
export function renderResults(caseDef, panel, data) {
  const p = caseDef.patient;
  const sampleLines = [];
  if (panel.sampleComment) sampleLines.push(panel.sampleComment);
  if (panel.hasUnmeasurable) sampleLines.push('一部項目 測定不可');
  const sampleText = sampleLines.length ? sampleLines.join(' ／ ') : '特記なし';

  const prevNote = caseDef.previous
    ? `${caseDef.previous.date}（${caseDef.previous.note}）`
    : 'なし';

  const tables = panel.panels.map((pn) => renderPanelTable(pn)).join('');

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
        <dt>検体状態</dt><dd class="${sampleLines.length ? 'is-flagged' : ''}">${esc(sampleText)}</dd>
        <dt>前回検査</dt><dd>${esc(prevNote)}</dd>
      </dl>
    </div>
    ${tables}
    <p class="hint">項目名をタップすると索引が開きます。</p>
  `;
}

function renderPanelTable(pn) {
  const rows = pn.rows.map((r) => {
    const flagClass = r.flag ? (r.panic ? 'flag flag-panic' : 'flag') : 'flag';
    const deltaMark = r.delta ? '<span class="delta" title="前回値から規定幅を超えて変動">Δ</span>' : '';
    return `
      <tr${r.flag ? ' class="is-flagged"' : ''}>
        <th scope="row" data-col="name">
          <button class="test-name" type="button" data-test="${esc(r.id)}">
            <span class="t-abbr">${esc(r.abbr)}</span>
            <span class="t-name">${esc(r.name)}</span>
          </button>
        </th>
        <td data-col="value">${esc(r.display)}${deltaMark}</td>
        <td data-col="unit">${esc(r.unit)}</td>
        <td data-col="ref"><span class="lbl">基準</span>${esc(r.referenceDisplay)}</td>
        <td data-col="flag"><span class="${flagClass}">${esc(r.flag)}</span></td>
        <td data-col="prev"><span class="lbl">前回</span>${esc(r.previousDisplay)}</td>
      </tr>`;
  });

  return `
    <table class="lis-table">
      <caption>${esc(pn.label)}</caption>
      <thead>
        <tr>
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
