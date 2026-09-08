// 報告ダイアログと判定。
// 「必要十分な判断で正解に到達したか」を見るので、過剰報告も減点にする。

import { esc, termLink } from './lis.js';

export const SCORE_LABEL = { best: '最善', ok: '許容', poor: '要改善' };

const SCORE_RANK = { best: 0, ok: 1, poor: 2 };

/**
 * 二段の症例（差し戻し）の最終評価。悪いほうを採る。
 * 一本目の cap で頭打ちにするので、一本目が甘いと二本目で挽回しきれない。
 */
export function worseScore(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return SCORE_RANK[a] >= SCORE_RANK[b] ? a : b;
}

/**
 * 選んだコメント。候補のタップで組み立てるので、中身は候補オブジェクトの配列。
 * 文字列（旧い自由記述）も受けられるようにしてある——判定は「一行以上あるか」だけを見る。
 */
export function commentLines(choice) {
  const c = choice && choice.comment;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? { templateId: x, text: x } : x));
  if (typeof c === 'string' && c.trim()) return [{ templateId: null, text: c.trim() }];
  return [];
}

/** その報告に付いているコメントの候補ID（`when.comment` と突き合わせる）。 */
export function commentTemplateIds(choice) {
  return commentLines(choice).map((line) => line.templateId).filter(Boolean);
}

/**
 * 突き合わせに使うID全部。素のID（`continued`＝どの項目でも）と、
 * 項目付きのID（`continued:Hb`＝その項目で）の両方を入れる。
 */
export function commentIdSet(choice) {
  const ids = new Set();
  for (const line of commentLines(choice)) {
    if (line.templateId) ids.add(line.templateId);
    if (line.id) ids.add(line.id);
  }
  return ids;
}

export function hasComment(choice) {
  return commentLines(choice).length > 0;
}

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

export function renderReportDialog(caseDef, data, selection = null, accession = caseDef.accession) {
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
    <h2>報告：${esc(accession)}　${esc(caseDef.patient.id)}</h2>
    <p class="report-marks"><span class="report-marks-label">報告対象</span>${esc(markSummary(selection, data))}</p>
    <form id="report-form">
      <fieldset>
        <legend>${termLink(data.glossary, 'levels', '報告レベル')}</legend>
        ${levels}
      </fieldset>
      <div class="field" id="comment-field">
        ${renderCommentPicker(data, selection)}
      </div>
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

/**
 * コメントは打つものをゼロにする。所見の一覧をタップで一〜三行選ぶだけ。
 * 一覧は全症例で同じで、常に全部出す。自由記述の欄は置かない。
 * スマホで縦に長くなるので群ごとに畳む。既定で開くのは「値について」だけ。
 * selection = { commentOptions, commentSelected, commentGroupsOpen }
 */
export function renderCommentPicker(data, selection = null) {
  const options = (selection && selection.commentOptions) || [];
  const selected = (selection && selection.commentSelected) || [];
  const opened = (selection && selection.commentGroupsOpen) || null;
  const max = data.commentTemplates.max_lines ?? 3;

  if (!options.length) {
    return `
      <span>${termLink(data.glossary, 'comment', '検査室コメント')}</span>
      <p class="comment-empty">添えられる候補がありません。</p>`;
  }

  const full = (o) => !selected.includes(o.id) && selected.length >= max;
  const item = (o) => {
    const on = selected.includes(o.id);
    return `
      <li>
        <button type="button" class="comment-opt${on ? ' is-on' : ''}" data-comment="${esc(o.id)}"
                aria-pressed="${on}"${full(o) ? ' disabled' : ''}>
          <span class="comment-check">${on ? '✓' : ''}</span>${esc(o.text)}
        </button>
      </li>`;
  };

  const groups = (data.commentTemplates.groups || [])
    .map((g) => {
      const items = options.filter((o) => o.group === g.id);
      if (!items.length) return '';
      const picked = items.filter((o) => selected.includes(o.id)).length;
      const open = opened ? opened.includes(g.id) : Boolean(g.open);
      return `
        <details class="comment-group"${open ? ' open' : ''}>
          <summary data-comment-group="${esc(g.id)}">
            <span class="comment-group-label">${esc(g.label)}</span>
            <span class="comment-group-count">${picked ? `${picked}行選択` : `${items.length}件`}</span>
          </summary>
          <ul class="comment-options">${items.map(item).join('')}</ul>
        </details>`;
    })
    .join('');

  // 群に入らない候補（古いデータ）は畳まずそのまま出す
  const loose = options.filter((o) => !(data.commentTemplates.groups || []).some((g) => g.id === o.group));

  return `
    <span>${termLink(data.glossary, 'comment', '検査室コメント')}（任意・最大${max}行）</span>
    ${groups}
    ${loose.length ? `<ul class="comment-options">${loose.map(item).join('')}</ul>` : ''}
    <p class="comment-count">選択 ${selected.length} / ${max} 行${
      selected.length >= max ? '（上限です。外すと選び直せます）' : ''
    }</p>`;
}

/** 緊急報告は電話画面を挟み、読み返し確認をタップして初めて完了とする。 */
export function renderPhone(caseDef, panel, selection = null, accession = caseDef.accession) {
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
      <p>「中央検査部です。${esc(caseDef.patient.id)}、受付${esc(accession)}のパニック値をご報告します。」</p>
      <p class="phone-value">${esc(readback)}</p>
      ${commentLines(selection)
        .map((line) => `<p>「${esc(line.speech || line.text)}」</p>`)
        .join('')}
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
  return pickBranch(caseDef.choices, choice);
}

/**
 * 差し戻しのあとに届いた二本目の判定（`followup.choices`）。
 * 最終評価は min（この枝の score、一本目の cap）。順序は best > ok > poor。
 * followup の枝に then は書けない（入れ子にしない）。
 */
export function evaluateFollowup(caseDef, choice, cap = 'best') {
  const res = pickBranch(caseDef.followup && caseDef.followup.choices, choice);
  return { ...res, branchScore: res.score, score: worseScore(res.score, cap), then: null, cap };
}

function pickBranch(choices, choice) {
  const branch = (choices || []).find((c) => matches(c.when || {}, choice));
  if (!branch) {
    return {
      score: 'poor',
      headline: '判定できませんでした',
      messageId: null,
      doctorId: null,
      matched: null,
      then: null,
      cap: 'best',
    };
  }
  return {
    // then を持つ枝は症例を閉じないので score を持たない（判定は二本目でする）
    score: branch.score || null,
    headline: branch.headline,
    messageId: branch.reply || null,
    doctorId: branch.doctor || null,
    matched: branch,
    then: branch.then || null,
    cap: branch.cap || 'best',
  };
}

function matches(when, choice) {
  return Object.entries(when).every(([key, expected]) => {
    if (key === 'report') return choice.level === expected;
    if (key === 'comment') return matchesComment(expected, choice);
    if (key === 'marks') return matchesMarks(expected, choice.marks || []);
    if (key === 'suspects') return matchesSuspects(expected, choice.suspects || {});
    return Boolean(choice[key]) === expected;
  });
}

/**
 * コメントの条件。
 *   true / false … 一行以上選んだか（中身は見ない）
 *   ["recollect_same", ...] … 配列は { must: [...] } の略記
 *   { must, any, forbid } … must は全部・any は一つでも選ばれていれば一致、
 *                           forbid は一つでも選ばれていれば不一致
 * IDは `continued` と素で書けば「どの項目でも」、`continued:Hb` と書けば「その項目で」。
 */
function matchesComment(expected, choice) {
  if (Array.isArray(expected)) return matchesCommentRule({ must: expected }, choice);
  if (expected && typeof expected === 'object') return matchesCommentRule(expected, choice);
  return hasComment(choice) === expected;
}

function matchesCommentRule(rule, choice) {
  const picked = commentIdSet(choice);
  if (rule.must && !rule.must.every((id) => picked.has(id))) return false;
  if (rule.any && !rule.any.some((id) => picked.has(id))) return false;
  if (rule.forbid && rule.forbid.some((id) => picked.has(id))) return false;
  return true;
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
  const pending = !res.score; // 差し戻し。まだ症例を閉じない
  const bits = [`報告レベル：${level ? level.label : choice.level}`];
  bits.push(`報告対象：${markSummary(choice, data)}`);
  if (choice.recheck) bits.push('再検・再採血を依頼');
  const lines = commentLines(choice);
  if (lines.length) bits.push(`コメント ${lines.length}行`);
  if (choice.readback) bits.push('読み返し確認あり');

  return `
    <h2 class="verdict">
      <span class="score-badge ${pending ? 'score-pending' : `score-${esc(res.score)}`}">${
        pending ? '差し戻し' : esc(SCORE_LABEL[res.score] || res.score)
      }</span>
      ${esc(res.headline)}
    </h2>
    <p class="verdict-choice">${esc(bits.join(' ／ '))}</p>
    ${lines.length ? `<ul class="verdict-comment">${lines.map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul>` : ''}
    <p class="verdict-note">${
      pending
        ? '院内メッセージに返信が届いています。再採血の結果が届いたら、もう一度報告します。'
        : '院内メッセージに返信が届いています。'
    }</p>
    <div class="dlg-actions">
      <button type="button" class="btn btn-primary" data-action="close-report">閉じる</button>
    </div>`;
}
