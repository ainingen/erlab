// 操作四段階の三段目「調べる」。装置と受付が勝手に言ってくること（検体状態欄）とは別に、
// 自分で確かめたことを積む欄を持つ。仕様は docs/investigate.md。
//
// ここは DOM に触らない。返すのは文字列か、描画用のHTML文字列だけ。
// 判定に効くのは「どの行動を押したか」だけで、順番も時刻も評価しない。

import { esc, linkTerms } from './lis.js';

/**
 * 四つの行動。ボタン表記はスマホ縦390pxで一段に収まる短いものにする。
 *   needs … その行動に要る依頼。無ければボタンは押せない（塗抹は血算がないと作れない）
 */
export const ACTIONS = [
  { id: 'look', label: '目視', name: '目視', needs: null },
  { id: 'idcheck', label: 'ID', name: 'ID照合', needs: null },
  { id: 'smear', label: '塗抹', name: '塗抹', needs: 'CBC' },
  { id: 'call', label: '電話', name: '電話', needs: null },
];

const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** 依頼元 → 既定の電話メッセージ。ER・病棟・外来のどれでもなければ病棟の言い方にする。 */
const CALL_DEFAULTS = [
  { match: /ER|救急/, id: 'msg_call_default_er' },
  { match: /外来/, id: 'msg_call_default_opd' },
  { match: /病棟/, id: 'msg_call_default_ward' },
];
const CALL_FALLBACK = 'msg_call_default_ward';

// 調べた結果欄に出す時刻。受付から最初の行動まで3分、以降ひとつごとに2分進める。
// **見た目だけ**で、新人モードでは時間の意味を持たせない（時間コストは上級の話。§7）。
const FIRST_STEP_MIN = 3;
const NEXT_STEP_MIN = 2;

/** 「10:41」＋n分 → 「10:44」。日をまたぐ症例は無いので24時で丸めるだけにする。 */
export function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm ?? '0:00').split(':').map((x) => Number(x) || 0);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 何番目の行動か（0始まり）から、その行動の時刻を出す。 */
export function actionTime(receivedAt, index) {
  return addMinutes(receivedAt, FIRST_STEP_MIN + NEXT_STEP_MIN * index);
}

/** その症例で電話をかけたときに届くメッセージのID。症例が書いていれば症例のものが勝つ。 */
export function callMessageId(caseDef) {
  const own = caseDef.investigate && caseDef.investigate.call;
  if (own) return own;
  const from = caseDef.patient?.from || '';
  return (CALL_DEFAULTS.find((d) => d.match.test(from)) || {}).id || CALL_FALLBACK;
}

/**
 * 押せる・押せないと、ボタンに添える一言。
 * ctx = { order, done, stage, taken }
 *   stage … 'first'（最初の検体）／'recollect'（再採血検体が届いたあと）
 *   taken … [{ id, stage }] 押した順
 *
 * 各行動は1症例1回。押したら「済」で、検体が変わっても再度はできない（§2・§12）。
 * `look` だけは**検体ごとに1回**で、再採血検体が来たらもう一度できる。
 * まだ押していない行動は、再採血検体が届いたあとでも押せる（潰すのは再実行だけ）。
 */
export function actionStates({ order = [], done = false, stage = 'first', taken = [] } = {}) {
  return ACTIONS.map((a) => {
    const spent = a.id === 'look'
      ? taken.some((t) => t.id === a.id && t.stage === stage)
      : taken.some((t) => t.id === a.id);
    const noOrder = Boolean(a.needs) && !order.includes(a.needs);
    let note = '';
    if (spent) note = '済';
    else if (noOrder) note = '血算の依頼なし';
    return {
      ...a,
      spent,
      note,
      enabled: !done && !spent && !noOrder,
    };
  });
}

/** その行動で押したときに積む一件。lines は三行固定、text は欄に出す一行。 */
export function runAction(actionId, ctx) {
  const { caseDef, data, panel, index = 0, stage = 'first' } = ctx;
  const action = ACTION_BY_ID.get(actionId);
  if (!action) return null;
  const built = buildLines(actionId, caseDef, data, panel);
  if (!built) return null;
  return {
    id: actionId,
    name: action.name,
    stage,
    time: actionTime(caseDef.received_at, index),
    caller: built.caller || null,
    lines: built.lines,
    messageId: built.messageId || null,
    text: built.caller ? `${built.caller}：${built.lines.join('／')}` : built.lines.join('／'),
  };
}

function buildLines(actionId, caseDef, data, panel) {
  const own = caseDef.investigate || {};
  if (actionId === 'look' || actionId === 'smear') {
    if (Array.isArray(own[actionId])) return { lines: own[actionId] };
    return { lines: sampleLines(actionId, data, panel) };
  }
  if (actionId === 'idcheck') return { lines: idCheckLines(caseDef) };
  if (actionId === 'call') return callLines(caseDef, data);
  return null;
}

/**
 * 検体そのものを見たときの三行。検体トラブルごとに artifacts.json が持ち、
 * トラブルのない検体は defaults を使う。正常検体でも空振りにしない——
 * 「淡黄色・凝血なし・量十分」が `real` を選ぶ根拠になる（§1）。
 */
export function sampleLines(actionId, data, panel) {
  const def = panel && panel.artifact ? panel.artifact : null;
  const lines = def && Array.isArray(def[actionId]) ? def[actionId] : null;
  return lines || data.artifacts.defaults[actionId] || [];
}

/** ラベルと依頼の照合。既定は一致。症例が `idcheck.match: false` を書いたときだけ食い違う。 */
export function idCheckLines(caseDef) {
  const rule = (caseDef.investigate || {}).idcheck || {};
  const p = caseDef.patient;
  const label = rule.match === false
    ? { id: rule.label?.id ?? p.id, name: rule.label?.name ?? p.label }
    : { id: p.id, name: p.label };
  return [
    `ラベル ${label.id} ${label.name}`,
    `依頼 ${p.id} ${p.label}`,
    rule.match === false ? '不一致' : '一致',
  ];
}

/** 依頼元への電話。文面はメッセージ側に持つので、ここでは引くだけ。 */
function callLines(caseDef, data) {
  const id = callMessageId(caseDef);
  const msg = (data.messages.messages || {})[id];
  if (!msg) return null;
  return { caller: msg.caller || msg.from, lines: msg.lines || msg.body || [], messageId: id };
}

/* ---- 描画 ---- */

/**
 * 3-1. 行動ボタン。結果テーブルの下、報告ボタンの上に四つ横並び。
 * 押せないものは薄くする（色ではなく濃さと、添える一言で分かるようにする）。
 */
export function renderActionBar(states) {
  const buttons = states
    .map(
      (s) => `
      <button type="button" class="ia-btn" data-investigate="${esc(s.id)}"
              ${s.enabled ? '' : 'disabled '}aria-label="${esc(s.name)}${s.note ? `（${s.note}）` : ''}">
        <span class="ia-label">${esc(s.label)}</span>
        <span class="ia-note">${esc(s.note || '　')}</span>
      </button>`,
    )
    .join('');
  return `
    <div class="investigate" data-region="investigate">
      <p class="investigate-lead">調べる：装置が言わないことを自分で確かめます。</p>
      <div class="investigate-actions" role="group" aria-label="調べる">${buttons}</div>
    </div>`;
}

/**
 * 3-2. 調べた結果欄。検体状態欄の下に置く別欄で、**何も調べていないときは欄ごと出さない**。
 * LIS の記録らしく、時刻と行動名を頭に付けて一行ずつ積む。三行は ／ で繋いで一行に収める。
 */
export function renderInvestigateLog(entries, glossary = null) {
  if (!entries || !entries.length) return '';
  const rows = entries
    .map(
      (e) => `
      <li>
        <span class="ia-time">${esc(e.time)}</span>
        <span class="ia-name">${esc(e.name)}</span>
        <span class="ia-text">${glossary ? linkTerms(e.text, glossary) : esc(e.text)}</span>
      </li>`,
    )
    .join('');
  return `<ul class="investigate-log">${rows}</ul>`;
}
