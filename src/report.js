// 報告ダイアログと判定。
// 「必要十分な判断で正解に到達したか」を見るので、過剰報告も減点にする。

import { esc } from './lis.js';

export const SCORE_LABEL = { best: '最善', ok: '許容', poor: '要改善' };

/** マークした項目を「K（本物の異常）／Cre」の形に並べる。0件でも報告はできる。 */
export function markSummary(selection, data) {
  const marks = (selection && selection.marks) || [];
  if (!marks.length) return 'なし（異常なしとして報告します）';
  const labelById = new Map((data?.suspects?.suspects || []).map((s) => [s.id, s.label]));
  const abbrById = new Map((data?.tests?.tests || []).map((t) => [t.id, t.abbr]));
  return marks
    .map((id) => {
      const picked = ((selection.suspects || {})[id] || []).map((s) => labelById.get(s) || s);
      const abbr = abbrById.get(id) || id;
      return picked.length ? `${abbr}（${picked.join('・')}）` : abbr;
    })
    .join(' ／ ');
}

export function renderReportDialog(caseDef, data, selection = null) {
  const levels = data.hospital.report_levels
    .map(
      (lv, i) => `
      <label class="lv">
        <input type="radio" name="level" value="${esc(lv.id)}"${i === 0 ? ' checked' : ''}>
        <span class="lv-body">
          <span class="lv-label">${esc(lv.label)}</span>
          <span class="lv-action">${esc(lv.action)}</span>
          <span class="lv-when">${esc(lv.use_when)}</span>
        </span>
      </label>`,
    )
    .join('');

  return `
    <h2>報告：${esc(caseDef.accession)}　${esc(caseDef.patient.id)}</h2>
    <p class="report-marks"><span class="report-marks-label">報告対象</span>${esc(markSummary(selection, data))}</p>
    <form id="report-form">
      <fieldset>
        <legend>報告レベル</legend>
        ${levels}
      </fieldset>
      <label class="field">
        <span>検査室コメント（任意）</span>
        <textarea name="comment" rows="3" placeholder="例）小球性低色素性。前回値と比べゆるやかに低下。"></textarea>
      </label>
      <label class="check">
        <input type="checkbox" name="recheck">
        <span>再検・再採血を依頼する</span>
      </label>
      <div class="dlg-actions">
        <button type="button" class="btn" data-action="close-report">やめる</button>
        <button type="submit" class="btn btn-primary">送信する</button>
      </div>
    </form>`;
}

/** 緊急報告は電話画面を挟み、読み返し確認をタップして初めて完了とする。 */
export function renderPhone(caseDef, panel, selection = null) {
  const marks = (selection && selection.marks) || [];
  // 読み返すのは報告に載せた行。マークがなければパニック値を読み上げる。
  const target = marks.length
    ? panel.rows.filter((r) => marks.includes(r.id))
    : panel.rows.filter((r) => r.panic);
  const readback = target.length
    ? target.map((r) => `${r.abbr} ${r.display} ${r.unit}`).join(' ／ ')
    : '報告対象の値';
  return `
    <h2>緊急報告：電話</h2>
    <p class="phone-dial">救急外来 内線 2201 … 呼出中</p>
    <div class="phone-script">
      <p>「中央検査部です。${esc(caseDef.patient.id)}、受付${esc(caseDef.accession)}のパニック値をご報告します。」</p>
      <p class="phone-value">${esc(readback)}</p>
      <p>「復唱をお願いします。」</p>
    </div>
    <div class="dlg-actions">
      <button type="button" class="btn" data-action="close-report">切る</button>
      <button type="button" class="btn btn-primary" data-action="readback">読み返し確認をとった</button>
    </div>`;
}

/**
 * 判定。単一の正解を置かず、症例の choices を上から順に見て、
 * 最初に条件の合った枝の score（best / ok / poor）と医師返信を返す。
 *
 * choice = { level, comment, recheck, readback, marks, suspects }
 * when に書かれた項目だけを見る（書かれていない項目は不問）。
 *   report   … 報告レベル（routine / urgent / emergency）
 *   recheck  … 再検・再採血を依頼したか
 *   comment  … コメントを書いたか（真偽値。中身は見ない）
 *   readback … 読み返し確認をとったか
 *   marks    … マークした項目 { must: [...], max: n, forbid: [...] }
 *   suspects … マーク行に付けた疑い { K: ["hemolysis"], exact: true }
 * 最後の枝は when を空にして、必ずどれかに当たるようにしておく。
 *
 * reply  … 指導役の講評（無い枝もある。その症例で教えたい判断に関わる分岐だけ付ける）
 * doctor … 医師からの返信。どの枝にも必ずある。報告 → 講評 → 医師の返信、の順で流す
 */
export function evaluate(caseDef, choice) {
  const branch = (caseDef.choices || []).find((c) => matches(c.when || {}, choice));
  if (!branch) {
    return {
      score: 'poor',
      headline: '判定できませんでした',
      messageId: null,
      doctorId: null,
      matched: null,
    };
  }
  return {
    score: branch.score,
    headline: branch.headline,
    messageId: branch.reply || null,
    doctorId: branch.doctor || null,
    matched: branch,
  };
}

function matches(when, choice) {
  return Object.entries(when).every(([key, expected]) => {
    if (key === 'report') return choice.level === expected;
    if (key === 'comment') return Boolean(choice.comment && choice.comment.trim()) === expected;
    if (key === 'marks') return matchesMarks(expected, choice.marks || []);
    if (key === 'suspects') return matchesSuspects(expected, choice.suspects || {});
    return Boolean(choice[key]) === expected;
  });
}

/**
 * マークの条件。書いた項目だけを見る。
 *   must   … 含まれていなければ不一致
 *   max    … マーク数の上限（超えたら不一致）
 *   forbid … 含まれていたら不一致
 */
function matchesMarks(rule, marks) {
  const list = [].concat(marks || []);
  if (rule.must && !rule.must.every((id) => list.includes(id))) return false;
  if (rule.forbid && rule.forbid.some((id) => list.includes(id))) return false;
  if (rule.max !== undefined && list.length > rule.max) return false;
  return true;
}

/**
 * 疑いの条件。指定した項目に、指定した疑いがすべて付いていれば一致。
 * 指定外の疑いが付いていても不問。`exact: true` を書いたときだけ厳密一致にする。
 */
function matchesSuspects(rule, suspects) {
  const exact = rule.exact === true;
  return Object.entries(rule).every(([testId, wanted]) => {
    if (testId === 'exact') return true;
    const picked = [].concat(suspects[testId] || []);
    const want = [].concat(wanted || []);
    if (!want.every((s) => picked.includes(s))) return false;
    if (exact && picked.length !== want.length) return false;
    return true;
  });
}

export function renderVerdict(res, choice, data) {
  const level = data.hospital.report_levels.find((l) => l.id === choice.level);
  const bits = [`報告レベル：${level ? level.label : choice.level}`];
  bits.push(`報告対象：${markSummary(choice, data)}`);
  if (choice.recheck) bits.push('再検・再採血を依頼');
  if (choice.comment && choice.comment.trim()) bits.push('コメントあり');
  if (choice.readback) bits.push('読み返し確認あり');

  return `
    <h2 class="verdict">
      <span class="score-badge score-${esc(res.score)}">${esc(SCORE_LABEL[res.score] || res.score)}</span>
      ${esc(res.headline)}
    </h2>
    <p class="verdict-choice">${esc(bits.join(' ／ '))}</p>
    <p class="verdict-note">院内メッセージに返信が届いています。</p>
    <div class="dlg-actions">
      <button type="button" class="btn btn-primary" data-action="close-report">閉じる</button>
    </div>`;
}
