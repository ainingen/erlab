// 報告ダイアログと判定。
// 「必要十分な判断で正解に到達したか」を見るので、過剰報告も減点にする。

import { esc } from './lis.js';

export const SCORE_LABEL = { best: '最善', ok: '許容', poor: '要改善' };

export function renderReportDialog(caseDef, data) {
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
export function renderPhone(caseDef, panel) {
  const panicRows = panel.rows.filter((r) => r.panic);
  const readback = panicRows.length
    ? panicRows.map((r) => `${r.abbr} ${r.display} ${r.unit}`).join(' ／ ')
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
 * choice = { level, comment, recheck, readback }
 * when に書かれた項目だけを見る（書かれていない項目は不問）。
 *   report   … 報告レベル（routine / urgent / emergency）
 *   recheck  … 再検・再採血を依頼したか
 *   comment  … コメントを書いたか（真偽値。中身は見ない）
 *   readback … 読み返し確認をとったか
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
    return Boolean(choice[key]) === expected;
  });
}

export function renderVerdict(res, choice, data) {
  const level = data.hospital.report_levels.find((l) => l.id === choice.level);
  const bits = [`報告レベル：${level ? level.label : choice.level}`];
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
