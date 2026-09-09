// 指導役の選択画面。
// ナビの台詞は「選んだ人のぶんだけ」出す。切り替えは描画時にやるので、
// 一度出したメッセージも、指導役を変えればもう一方の言い方に差し替わる。

import { esc } from './lis.js';

export function mentorById(data, id) {
  return (data.mentors.mentors || []).find((m) => m.id === id) || null;
}

/**
 * その症例に指導役が付くか。上級モードや、症例が `mentor: false` と書いた日は付かない
 * （characters.md「今日は三嶋さん休みです」の段階）。付かない日は「聞く」を押しても
 * 答えは返らないので、評価の頭打ちもしない。
 */
export function mentorForCase(data, mentorId, caseDef = null) {
  if (caseDef && caseDef.mentor === false) return null;
  return mentorById(data, mentorId);
}

/**
 * 上のバー右端の「聞く」の見え方。**位置は症例・モードによらず固定**で、
 * 変わるのは文字と押せる・押せないだけ（docs/investigate.md §8）。
 *   mentor … その症例に付く指導役。いなければ null
 *   used   … null（まだ）／'answered'（指導役が答えた）／'absent'（指導役がいなかった）
 *   open   … いま症例を開いていて、まだ報告していないか
 * note は押す前に出す一言。聞くと許容どまりになることを隠さない。
 */
export function askButtonState({ mentor = null, used = null, open = true } = {}) {
  return {
    label: used ? '聞いた' : '聞く',
    used,
    enabled: open && !used,
    note: mentor
      ? '指導役に聞く。1症例1回。聞くと評価は許容どまりになります。'
      : '指導役に聞く。今日は指導役がいません。',
  };
}

/**
 * 指導役を選ぶ画面。`saved` に進行があるときは「最初から」を出す（docs/shift.md §5）。
 * 消すのは押したあとに一度だけ確認を取ってから（確認は app.js）。
 */
export function renderMentorPicker(data, currentId, saved = null) {
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
    ${saved && saved.night > 1 ? `
      <p class="mentor-saved">${esc(saved.night)}晩目の途中から始まります。${
        saved.cleared ? '（指導役なしの晩は通過済み）' : ''
      }</p>` : ''}
    <div class="dlg-actions">
      ${saved ? '<button type="button" class="btn" data-action="restart">最初から</button>' : ''}
      ${currentId ? '<button type="button" class="btn" data-action="close-mentor">やめる</button>' : ''}
    </div>
  `;
}
