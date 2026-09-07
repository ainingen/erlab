// 3-3. 院内メッセージ。申し送り・ナビ・報告後の講評・医師からの返信を同じ一覧に流す。

import { esc } from './lis.js';

const KIND_LABEL = {
  handover: '申し送り',
  nav: 'ナビ',
  reply: '返信',
  log: '記録',
};

const PORTRAIT_DIR = new URL('../assets/portraits/', import.meta.url);

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

export function renderMessages(list, mentor = null) {
  if (!list.length) return '<p class="empty">メッセージはありません。</p>';
  return list.map((m) => renderMessage(m, mentor)).join('');
}

function renderMessage(m, mentor) {
  // 指導役の台詞には立ち絵を左に置く。申し送りや医師からの返信には付けない。
  const portrait =
    m.speaker && m.emotion
      ? `<img class="msg-portrait" src="${esc(portraitUrl(m.speaker, m.emotion))}"
              width="928" height="1232" alt="${esc(mentor ? mentor.name : '')}">`
      : '';

  return `
    <article class="msg msg-${esc(m.kind)}${portrait ? ' has-portrait' : ''}">
      ${portrait}
      <div class="msg-main">
        <header>
          <span class="msg-kind">${esc(KIND_LABEL[m.kind] || m.kind)}</span>
          <span class="msg-time">${esc(m.time)}</span>
          <h3 class="msg-subject">${esc(m.subject)}</h3>
          <p class="msg-from">${esc(m.from)}</p>
        </header>
        ${m.body.map((p) => `<p>${esc(p)}</p>`).join('')}
      </div>
    </article>`;
}
