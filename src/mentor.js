// 指導役の選択画面。
// ナビの台詞は「選んだ人のぶんだけ」出す。切り替えは描画時にやるので、
// 一度出したメッセージも、指導役を変えればもう一方の言い方に差し替わる。

import { esc } from './lis.js';

export function mentorById(data, id) {
  return (data.mentors.mentors || []).find((m) => m.id === id) || null;
}

export function renderMentorPicker(data, currentId) {
  const items = (data.mentors.mentors || [])
    .map(
      (m) => `
      <li>
        <button class="mentor${m.id === currentId ? ' is-selected' : ''}" type="button"
                data-mentor="${esc(m.id)}" aria-pressed="${m.id === currentId}">
          <span class="mentor-name">${esc(m.name)}</span>
          <span class="mentor-role">${esc(m.role)}</span>
          <span class="mentor-tagline">${esc(m.tagline)}</span>
          <span class="mentor-style">${esc(m.style)}</span>
        </button>
      </li>`,
    )
    .join('');

  return `
    <h2>指導役を選んでください</h2>
    <p class="mentor-lead">
      新人研修モードのナビは、ここで選んだ人の言葉で出ます。教える中身は同じで、言い方が変わります。
      あとから変えられます。
    </p>
    <ul class="mentor-list">${items}</ul>
    ${currentId ? '<div class="dlg-actions"><button type="button" class="btn" data-action="close-mentor">やめる</button></div>' : ''}
  `;
}
