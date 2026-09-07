// 3-3. 院内メッセージ。申し送り・ナビ・医師からの返信を同じ一覧に流す。

import { esc } from './lis.js';

const KIND_LABEL = {
  handover: '申し送り',
  nav: 'ナビ',
  reply: '返信',
  log: '記録',
};

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

export function renderMessages(list) {
  if (!list.length) return '<p class="empty">メッセージはありません。</p>';
  return list
    .map(
      (m) => `
      <article class="msg msg-${esc(m.kind)}">
        <header>
          <span class="msg-kind">${esc(KIND_LABEL[m.kind] || m.kind)}</span>
          <span class="msg-time">${esc(m.time)}</span>
          <h3 class="msg-subject">${esc(m.subject)}</h3>
          <p class="msg-from">${esc(m.from)}</p>
        </header>
        ${m.body.map((p) => `<p>${esc(p)}</p>`).join('')}
      </article>`,
    )
    .join('');
}
