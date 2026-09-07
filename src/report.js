// 報告ダイアログと判定。
// 「必要十分な判断で正解に到達したか」を見るので、過剰報告も減点にする。

import { esc } from './lis.js';

const LEVEL_ORDER = { routine: 0, urgent: 1, emergency: 2 };

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
 * 判定。choice = { level, comment, recheck, readback }
 * 戻り値の messageId を院内メッセージに流す。
 */
export function evaluate(caseDef, choice) {
  const correct = caseDef.correct;
  const outcome = caseDef.outcome || {};
  const commentGiven = Boolean(choice.comment && choice.comment.trim());

  if (choice.recheck && !correct.recheck) {
    return result('recheck_unneeded', '再検は不要でした', outcome.recheck || outcome[choice.level]);
  }
  if (!choice.recheck && correct.recheck) {
    return result('recheck_missing', '再検・再採血が必要な検体でした', outcome[choice.level]);
  }

  const diff = LEVEL_ORDER[choice.level] - LEVEL_ORDER[correct.report];
  if (diff > 0) {
    return result('over', '過剰報告です', outcome[choice.level]);
  }
  if (diff < 0) {
    return result('under', '報告レベルが足りません', outcome[choice.level]);
  }

  if (!commentGiven && (correct.comment === 'required' || correct.comment === 'recommended')) {
    const key = `${choice.level}_nocomment`;
    return result(
      'ok_thin',
      '報告レベルは適切。ただしコメントを付けたい場面でした',
      outcome[key] || outcome[choice.level],
    );
  }

  return result('ok', '適切な報告です', outcome[choice.level]);
}

function result(verdict, headline, messageId) {
  return { verdict, headline, messageId: messageId || null, ok: verdict === 'ok' };
}

export function renderVerdict(res, choice, data) {
  const level = data.hospital.report_levels.find((l) => l.id === choice.level);
  const bits = [`報告レベル：${level ? level.label : choice.level}`];
  if (choice.recheck) bits.push('再検・再採血を依頼');
  if (choice.comment && choice.comment.trim()) bits.push('コメントあり');
  if (choice.readback) bits.push('読み返し確認あり');

  return `
    <h2 class="verdict-${esc(res.verdict)}">${esc(res.headline)}</h2>
    <p class="verdict-choice">${esc(bits.join(' ／ '))}</p>
    <p class="verdict-note">院内メッセージに返信が届いています。</p>
    <div class="dlg-actions">
      <button type="button" class="btn btn-primary" data-action="close-report">閉じる</button>
    </div>`;
}
