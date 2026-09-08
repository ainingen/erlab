// 症例0。検査値を出さず、画面の見方だけを1画面ずつ説明する。
// 判断も報告もさせない。「次へ」で進むだけ。

import { esc } from './lis.js';
import { portraitUrl } from './messages.js';
import { rangeFor, formatRange } from './derive.js';

// 骨組みに並べる項目。性差のない項目だけにして、患者を決めなくても基準範囲が出せるようにする
const SKELETON = [
  { label: '血算', tests: ['WBC', 'MCV', 'PLT'] },
  { label: '生化学（基本）', tests: ['Na', 'K', 'CRP'] },
];

export function stepCount(tutorial) {
  return tutorial.steps.length;
}

export function renderTutorialStep(tutorial, index, mentor) {
  const step = tutorial.steps[index];
  const line = step.lines[mentor.id];
  if (!line) return `<p class="error">${esc(mentor.id)} の台詞がありません（${esc(step.id)}）。</p>`;

  const total = tutorial.steps.length;
  const last = index === total - 1;
  // pane はそのステップがどの欄の話かの見出し。各文の指さし（line.focus）とは別
  const pane = step.pane ? tutorial.focus_label[step.pane] : '';

  return `
    <h2 class="tut-title">
      <span class="tut-step">${index + 1} / ${total}</span>${esc(step.title)}
    </h2>
    ${pane ? `<p class="tut-focus">${esc(pane)}</p>` : ''}
    <div class="tut-body">
      <img class="tut-portrait" src="${esc(portraitUrl(mentor.id, line.emotion))}"
           alt="${esc(mentor.name)}">
      <div class="tut-lines">
        <p class="tut-from">${esc(mentor.name)} / ${esc(mentor.role)}</p>
        ${line.body.map((p) => `<p>${esc(p)}</p>`).join('')}
      </div>
    </div>
    <div class="dlg-actions">
      <button type="button" class="btn btn-primary" data-action="tutorial-next">
        ${last ? '一件目へ' : '次へ'}
      </button>
    </div>`;
}

/**
 * チュートリアル中の結果画面。**検査値は出さない**（結果と前回値は「―」のまま）。
 * 欄の位置だけ本物と同じに置いて、指さし（focus）の的にする。
 * 基準範囲は患者の値ではなく当院の規定なので、そのまま出して列の意味を見せる。
 */
export function renderTutorialPlaceholder(data = null) {
  const tables = data ? SKELETON.map((panel) => skeletonTable(panel, data)).join('') : '';
  return `
    <div class="pt-head is-skeleton" data-region="patient">
      <div class="pt-line">
        <span class="pt-acc">受付 ―</span><span class="pt-time">受付時刻 ―</span>
      </div>
      <div class="pt-line">
        <span class="pt-id">―</span><span class="pt-name">検体を選ぶとここに出ます</span>
      </div>
      <dl class="pt-meta">
        <dt>主訴</dt><dd>―</dd>
        <dt>バイタル</dt><dd>―</dd>
        <dt>検体状態</dt><dd data-region="sample_state">特記なし</dd>
        <dt>前回検査</dt><dd>―</dd>
      </dl>
    </div>
    <div data-region="results">${tables}</div>
    <p class="tut-placeholder">
      今日はまだ数字を出しません。画面の場所だけ覚えてください。
    </p>`;
}

function skeletonTable(panel, data) {
  const testById = new Map(data.tests.tests.map((t) => [t.id, t]));
  const rows = panel.tests
    .map((id) => {
      const test = testById.get(id);
      if (!test) return '';
      const ref = formatRange(rangeFor(data.hospital, 'reference', id), test.decimals);
      return `
        <tr>
          <th scope="row" data-col="name">
            <span class="t-abbr">${esc(test.abbr)}</span>
            <span class="t-name">${esc(test.name)}</span>
          </th>
          <td data-col="value">―</td>
          <td data-col="unit">${esc(test.unit)}</td>
          <td data-col="ref"><span class="lbl">基準</span>${esc(ref)}</td>
          <td data-col="flag" data-region="flags">―</td>
          <td data-col="prev" data-region="previous"><span class="lbl">前回</span>―</td>
        </tr>`;
    })
    .join('');

  return `
    <table class="lis-table is-skeleton">
      <caption>${esc(panel.label)}</caption>
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
      <tbody>${rows}</tbody>
    </table>`;
}
