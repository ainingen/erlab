// 3-3. 院内メッセージ。申し送り・ナビ・報告後の講評・医師からの返信を同じ一覧に流す。

import { esc, linkTerms } from './lis.js';

const KIND_LABEL = {
  handover: '申し送り',
  nav: 'ナビ',
  reply: '返信',
  log: '記録',
};

const PORTRAIT_DIR = new URL('../assets/portraits/', import.meta.url);

/**
 * 本文。ナビと申し送りだけ、辞典の語を自動でリンクにする。
 * focus のある文には「ここ」を付ける。押すと画面のその場所が光る（一文に一つだけ）。
 */
function renderBody(m, glossary) {
  const link = glossary && LINKED_KINDS.has(m.kind);
  const focus = Array.isArray(m.focus) ? m.focus : [];
  return m.body
    .map((p, i) => {
      const point = focus[i]
        ? `<button type="button" class="point" data-point="${esc(focus[i])}">ここ</button>`
        : '';
      return `<p>${link ? linkTerms(p, glossary) : esc(p)}${point}</p>`;
    })
    .join('');
}

/** 立ち絵のURL。ファイル名は {speaker}_{emotion}.png で固定。 */
export function portraitUrl(speaker, emotion) {
  return new URL(`${speaker}_${emotion}.png`, PORTRAIT_DIR).href;
}

/* ---- 指導役に聞く（docs/investigate.md §8） ---- */

/** 症例が ask を書いていないとき（生成症例を含む）に出す、既定の台詞のID。 */
export const DEFAULT_ASK_IDS = ['msg_ask_default_kanae', 'msg_ask_default_yusuke'];

/** 指導役がいない日に「聞く」を押したときの一文。答えは返らないので評価も落とさない。 */
export const NO_MENTOR_ASK_ID = 'msg_ask_no_mentor';

/**
 * 既定の「見る順番」を指導役の言い方で組む。索引の五行から作るので、
 * 順番を直せばここも一緒に直る。**生成症例に台詞を書かない**方針はこれで守れる。
 * 逆引き辞典（roadmap §4）ができたら、ここを一項目の逆引きに差し替える。
 */
export function buildDefaultAskMessages(glossary) {
  const steps = ((glossary && glossary.reading_order) || {}).steps || [];
  return {
    msg_ask_default_kanae: {
      kind: 'nav',
      speaker: 'kanae',
      emotion: 'normal',
      from: '三嶋 かなえ / 主任臨床検査技師',
      subject: '聞かれたので',
      time: '—',
      repeat: true,
      body: [
        '答えは言わない。見る順番を上から。',
        ...steps.map((s) => `${s.term}。${s.hint}。`),
        'そこまで見れば、だいたい着く。',
      ],
    },
    msg_ask_default_yusuke: {
      kind: 'nav',
      speaker: 'yusuke',
      emotion: 'normal',
      from: '羽鳥 悠介 / 臨床検査技師（教育担当）',
      subject: '聞かれたので',
      time: '—',
      repeat: true,
      body: [
        'まず見る順番を上から確認してください。答えは言いません。',
        ...steps.map((s) => `${s.term}——${s.hint}。`),
        'この五つを順に見れば、判断の材料はそろいます。',
      ],
    },
  };
}

/** その症例で「聞く」を押したときに届くID。書いていなければ既定を出す。 */
export function askMessageIds(caseDef) {
  const own = [].concat((caseDef && caseDef.ask) ?? []);
  return own.length ? own : DEFAULT_ASK_IDS;
}

export function messageById(data, id) {
  // 同じ文面を症例をまたいでもう一度届けたものは `id#2` の形で持つ（repeat のメッセージ）
  const [baseId] = String(id).split('#');
  const msg = (data.messages.messages || {})[baseId];
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

/**
 * 同時に届いたIDを平らにして、まだ届いていないものだけ、書いた順に返す。
 * 講評は指導役ぶんの配列で書かれている（症例JSONの reply）ので、入れ子を許す。
 * seen … すでに届いているID。同じ便の中の重複も落とす。
 */
export function freshGroup(ids, seen = []) {
  return [ids]
    .flat(Infinity)
    .filter((id, i, all) => id && !seen.includes(id) && all.indexOf(id) === i);
}

/**
 * 一覧の並び順。新しく届いた組が上に来る。組の中は届いた順のまま置く。
 * 指導役の講評と医師の返信は同時に届く一つの組なので、組の中では
 * 設計どおり講評が上・返信が下のまま、組そのものが上に積み上がる。
 * groups … 届いた順（古い順）の組の配列。組は1本でもよい。
 */
export function newestFirst(groups) {
  return [...groups].reverse().flat();
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
