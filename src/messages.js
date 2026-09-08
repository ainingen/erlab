// 3-3. 院内メッセージ。申し送り・ナビ・報告後の講評・医師からの返信を同じ一覧に流す。

import { esc, linkTerms } from './lis.js';

const KIND_LABEL = {
  handover: '申し送り',
  nav: 'ナビ',
  reply: '返信',
  log: '記録',
};

const PORTRAIT_DIR = new URL('../assets/portraits/', import.meta.url);

/** 本文。ナビと申し送りだけ、辞典の語を自動でリンクにする。 */
function renderBody(m, glossary) {
  const link = glossary && LINKED_KINDS.has(m.kind);
  return m.body.map((p) => `<p>${link ? linkTerms(p, glossary) : esc(p)}</p>`).join('');
}

/** 立ち絵のURL。ファイル名は {speaker}_{emotion}.png で固定。 */
export function portraitUrl(speaker, emotion) {
  return new URL(`${speaker}_${emotion}.png`, PORTRAIT_DIR).href;
}

export function messageById(data, id) {
  const msg = (data.messages.messages || {})[id];
  if (!msg) return null;
  return { id, ...msg };
}

/** 指導役つきの台詞は、選ばれている人のぶんだけ残す。speaker のないものは全員に出す。 */
export function filterBySpeaker(list, mentorId) {
  return list.filter((m) => !m.speaker || m.speaker === mentorId);
}

/** id（文字列でも配列でも可）を messages の中身に解決する。見つからないものは落とす。 */
export function resolveMessages(data, ids) {
  return [].concat(ids ?? []).map((id) => messageById(data, id)).filter(Boolean);
}

export function renderMessages(list, mentor = null, glossary = null) {
  if (!list.length) return '<p class="empty">メッセージはありません。</p>';
  return list.map((m) => renderMessage(m, mentor, glossary)).join('');
}

// 本文に辞典のリンクを入れるのは、ナビ・講評（nav）と申し送り（handover）だけ。
// 医師の返信と記録は相手の言葉なので触らない。
const LINKED_KINDS = new Set(['nav', 'handover']);

function renderMessage(m, mentor, glossary = null) {
  // from_mentor の申し送りは、選択中の指導役の名義と立ち絵で出す
  const speaker = m.speaker || (m.from_mentor && mentor ? mentor.id : null);
  const from = m.from_mentor && mentor ? `${mentor.name} / ${mentor.role}` : m.from;

  // 指導役が喋るものには立ち絵を左に置く。医師からの返信や記録には付けない。
  const portrait =
    speaker && m.emotion
      ? `<img class="msg-portrait" src="${esc(portraitUrl(speaker, m.emotion))}"
              alt="${esc(mentor ? mentor.name : '')}">`
      : '';

  return `
    <article class="msg msg-${esc(m.kind)}${portrait ? ' has-portrait' : ''}">
      ${portrait}
      <div class="msg-main">
        <header>
          <span class="msg-kind">${esc(KIND_LABEL[m.kind] || m.kind)}</span>
          <span class="msg-time">${esc(m.time)}</span>
          <h3 class="msg-subject">${esc(m.subject)}</h3>
          <p class="msg-from">${esc(from)}</p>
        </header>
        ${renderBody(m, glossary)}
      </div>
    </article>`;
}
