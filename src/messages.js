// 3-3. 院内メッセージ。申し送り・新人ナビ・医師からの返信を同じ一覧に流す。

import { esc } from './lis.js';

const KIND_LABEL = {
  handover: '申し送り',
  nav: '新人ナビ',
  reply: '返信',
  log: '記録',
};

export function messageById(data, id) {
  const msg = (data.messages.messages || {})[id];
  if (!msg) return null;
  return { id, ...msg };
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
