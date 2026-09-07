// 症例0。検査値を出さず、画面の見方だけを1画面ずつ説明する。
// 判断も報告もさせない。「次へ」で進むだけ。

import { esc } from './lis.js';
import { portraitUrl } from './messages.js';

export function stepCount(tutorial) {
  return tutorial.steps.length;
}

export function renderTutorialStep(tutorial, index, mentor) {
  const step = tutorial.steps[index];
  const line = step.lines[mentor.id];
  if (!line) return `<p class="error">${esc(mentor.id)} の台詞がありません（${esc(step.id)}）。</p>`;

  const total = tutorial.steps.length;
  const last = index === total - 1;
  const focus = step.focus ? tutorial.focus_label[step.focus] : '';

  return `
    <h2 class="tut-title">
      <span class="tut-step">${index + 1} / ${total}</span>${esc(step.title)}
    </h2>
    ${focus ? `<p class="tut-focus">${esc(focus)}</p>` : ''}
    <div class="tut-body">
      <img class="tut-portrait" src="${esc(portraitUrl(mentor.id, line.emotion))}"
           width="928" height="1232" alt="${esc(mentor.name)}">
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

/** チュートリアル中の結果画面。数字は出さない。 */
export function renderTutorialPlaceholder() {
  return `
    <p class="tut-placeholder">
      検体を選ぶと、ここに結果が並びます。<br>
      今日はまだ数字を出しません。画面の場所だけ覚えてください。
    </p>`;
}
