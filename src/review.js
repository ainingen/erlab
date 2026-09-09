// 講評の共通化（docs/review-common.md。judge-rules.md §4 の続き）。
// `choices` の無い症例（生成症例）で、報告のあとに届く三つ——
// 見出し → 指導役の講評 → 医師の返事——を、症例ごとに書かずに組む。
//
// **手書き症例（`choices` を持つ症例）はここを通らない。** 台詞は rookie.json のまま。
// ここは DOM に触らない純関数だけにする。

import { correctOperation, commentFits } from './judge.js';

const LEVEL_JA = { routine: '通常', urgent: '至急', emergency: '緊急' };
const ACTION_NAME = { look: '目視', idcheck: 'ID照合', smear: '塗抹', call: '電話' };

/** 正解の型 → 医師の返事の行（docs/review-common.md 5-1）。 */
const DOCTOR_ROW = {
  T1: 'routine', T2: 'routine',
  T6: 'urgent', T5b: 'urgent',
  T3: 'emergency', T5: 'emergency', T8: 'emergency',
  T4: 'hold_sample',
  T7: 'hold_mismatch',
};

/**
 * 台詞の中の置き場所を埋める。使えるのは5つだけ（§2）。
 * 手書きの見出しに残っている `{行動名}` は `{action}` と同じに読む。
 * **値の無い置き場所は埋めない**——埋め残しはテストで落とす（§7-3・§7-5）。
 */
export function fillPlaceholders(text, values = {}) {
  const table = { ...values, 行動名: values.action };
  return String(text ?? '').replace(/\{(key|value|prev|action|level|行動名)\}/g, (whole, name) => {
    const v = table[name];
    return v === undefined || v === null || v === '' ? whole : String(v);
  });
}

/**
 * 台詞ひとつぶんを埋めた写し。本文だけ差し替えて、ほかはそのまま渡す。
 * **埋め残しの残った行は落とす**（§2「埋め残しは表示しない」）。全部落ちたら null を返し、
 * その便は出さない。いまこれに当たるのは「フラグが一つも点いていない検体の best」だけで、
 * 鍵の項目が無いので `{key}` を名指せない（docs/review-common.md §8 に記録）。
 */
export function fillMessage(message, values = null) {
  if (!message || !values || !Array.isArray(message.body)) return message;
  const body = message.body
    .map((line) => fillPlaceholders(line, values))
    .filter((line) => !hasPlaceholder(line));
  return body.length ? { ...message, body } : null;
}

/** 埋まらなかった置き場所が残っているか。 */
export function hasPlaceholder(text) {
  return /\{(key|value|prev|action|level|行動名)\}/.test(String(text ?? ''));
}

/**
 * 報告のあとに届く三つを組む。
 *   judged   … judge() の戻り（score / deviation / headline / key / correct）
 *   caseDef  … 症例JSON（patient と accession・received_at を見る）
 *   operation… 報告ダイアログの選択
 *   context  … { facts, panel, data }
 * 戻り値の reply / doctor はメッセージID。埋め込みに使う値は values に入れて返す。
 */
export function buildReview(judged, caseDef, operation, context = {}) {
  const { facts = {}, panel = null, data = null } = context;
  const values = reviewValues(judged, facts, panel, operation);
  // ずれが無いときの講評は、鍵の項目があるかどうかで二本に分かれる。
  // フラグが一つも点いていない検体には名指せる項目が無いので `{key}` を含まない側を引く
  const dev = judged.deviation || (values.key ? 'best' : 'best_nokey');
  const doctor = doctorMessage(judged, caseDef, operation, facts, data, values);
  return {
    headline: fillPlaceholders(judged.headline, values),
    reply: [`msg_rv_${dev}_kanae`, `msg_rv_${dev}_yusuke`],
    doctor: doctor.id,
    doctorMeta: doctor.meta,
    values,
  };
}

/** 台詞に埋める5つ。取れないものは入れない（入れなければ置き場所のまま残り、テストで落ちる）。 */
function reviewValues(judged, facts, panel, operation) {
  const values = {};
  const key = judged.key || facts.key || null;
  if (key) values.key = key;
  const row = key && panel ? panel.rows.find((r) => r.id === key) : null;
  if (row) {
    if (row.display) values.value = row.display;
    if (row.previousDisplay && row.previousDisplay !== '—') values.prev = row.previousDisplay;
  }
  if (operation && LEVEL_JA[operation.level]) values.level = LEVEL_JA[operation.level];
  const missing = missingAction(judged, operation);
  if (missing) values.action = missing;
  return values;
}

/** O4 で欠けている行動の名前。二つ欠けていれば「と」で繋ぐ（見出しと同じ言い方）。 */
function missingAction(judged, operation) {
  const want = (judged.correct && judged.correct.actions) || [];
  const taken = [].concat((operation && operation.actions) || []);
  const missing = want.filter((a) => !taken.includes(a)).map((a) => ACTION_NAME[a] || a);
  return missing.length ? missing.join('と') : null;
}

/* ---- 医師の返事（§5） ---- */

/** その報告に、検体トラブルか取り違えの旨が添えられているか（`note`）。 */
export function hasSampleNote(operation, data) {
  const rules = (data && data.judge && data.judge.comment_rules) || {};
  const noteIds = Object.entries(rules)
    .filter(([id, rule]) => !id.startsWith('_') && rule && Array.isArray(rule.facts)
      && (rule.facts.includes('A') || rule.facts.includes('M')))
    .map(([id]) => id);
  const picked = new Set(commentTemplateIds(operation));
  return noteIds.some((id) => picked.has(id));
}

function commentTemplateIds(operation) {
  const c = (operation && operation.comment) || [];
  if (!Array.isArray(c)) return [];
  return c.map((line) => (typeof line === 'string' ? line : (line && line.templateId) || ''))
    .filter(Boolean).map((id) => String(id).split(':')[0]);
}

/** 値を止める型（T4・T7）の列。docs/review-common.md 5-1 の条件表。 */
export function holdColumn(operation, note) {
  const recheck = Boolean(operation && operation.recheck);
  const routine = !operation || operation.level === 'routine';
  if (recheck && (routine || note)) return 'stopped';
  if (note && !recheck) return 'note_only';
  if (recheck) return 'leak_recheck';
  return routine ? 'leak_silent' : 'leak_loud';
}

/** 値を出す型（T1〜T3・T5b）の列。通常＋再採血は「値が出ていない」ので recheck。 */
function levelColumn(operation) {
  const level = (operation && operation.level) || 'routine';
  if (level === 'routine' && operation && operation.recheck) return 'recheck';
  return level;
}

function doctorMessage(judged, caseDef, operation, facts, data, values) {
  // O1（事実に合わないコメント）のときだけ、既存の共通返信で上書きする（§5-2）
  if (judged.deviation === 'O1') {
    const id = operation && operation.level === 'emergency'
      ? 'msg_comment_off_emergency' : 'msg_comment_off';
    return { id, meta: null };
  }
  const row = DOCTOR_ROW[facts.type] || 'routine';
  const hold = row === 'hold_sample' || row === 'hold_mismatch';
  const col = hold ? holdColumn(operation, hasSampleNote(operation, data)) : levelColumn(operation);
  return {
    id: `msg_dr_${row}_${col}`,
    meta: doctorMeta(caseDef, operation, row, col, data),
  };
}

/**
 * 医師の差出人・件名・時刻（§5-3）。JSON に書かず、症例と操作から組む。
 * 台詞側に `from` / `subject` / `time` が書いてあれば、そちらを優先する（描画側で上書きしない）。
 */
export function doctorMeta(caseDef, operation, row, col, data) {
  const times = (data && data.messages && data.messages._doctor_time) || {};
  const sentOnly = col === 'recheck' || col === 'stopped';
  const level = (operation && operation.level) || 'routine';
  return {
    from: doctorFrom(caseDef.patient && caseDef.patient.from),
    subject: `Re: ${sentOnly ? '再採血の依頼' : SUBJECT[level] || '検査結果'}（${caseDef.patient.id}）`,
    time: doctorTime(caseDef, row, col, level, times),
  };
}

const SUBJECT = { routine: '検査結果', urgent: '至急連絡', emergency: '緊急報告' };

/** 「消化器内科病棟」→「消化器内科 担当医」。ER だけ当直医。 */
export function doctorFrom(from) {
  const text = String(from || '');
  if (text.includes('ER')) return 'ER 当直医';
  return `${text.replace(/(病棟|外来)$/, '')} 担当医`.trim();
}

/** 受付時刻からの経過。遅れて気づいた列だけ長い（§5-3 の表）。 */
function doctorTime(caseDef, row, col, level, times) {
  const lateRows = row !== 'routine';
  if (col === 'leak_silent') {
    if (row === 'hold_mismatch') return times.next_day || '翌 09:10';
    return addMinutes(caseDef.received_at, times.late ?? 75);
  }
  if (col === 'recheck' || col === 'stopped') return addMinutes(caseDef.received_at, times.recheck ?? 12);
  if (col === 'routine' && lateRows) return addMinutes(caseDef.received_at, times.late ?? 75);
  return addMinutes(caseDef.received_at, times[level] ?? times.routine ?? 30);
}

/** 「13:20」＋n分 → 「13:32」。日をまたぐ症例は無いので24時で丸めるだけ。 */
export function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm ?? '0:00').split(':').map((x) => Number(x) || 0);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** その事実で「ずれの無い操作」に添えるコメント。生成症例の見本づくりに使う。 */
export function fittingComments(facts, data) {
  const ids = Object.keys((data && data.judge && data.judge.comment_rules) || {})
    .filter((id) => !id.startsWith('_'));
  return ids.filter((id) => commentFits(facts, id, { comment: [{ id, templateId: id }] }));
}

/** 正解の操作（judge.js）を、この症例の表に合わせて読み直すときの入口。 */
export { correctOperation };
