// 画面の組み立てとイベント処理。ロジックは derive.js / report.js 側に置く。

import { loadData } from './data.js';
import { buildPanel, buildRecollect, buildCommentOptions, toggleCommentSelection } from './derive.js';
import { renderWorklist, renderResults, renderRecollect, renderGlossaryPanel, esc } from './lis.js';
import { renderMessages, resolveMessages, filterBySpeaker } from './messages.js';
import {
  renderReportDialog, renderCommentPicker, renderPhone, evaluate, evaluateFollowup, renderVerdict,
  SCORE_LABEL,
} from './report.js';
import { renderMentorPicker, mentorById } from './mentor.js';
import { renderTutorialStep, renderTutorialPlaceholder, stepCount } from './tutorial.js';

const state = {
  data: null,
  cases: [],
  panels: new Map(),
  status: {},
  results: {},
  recollected: {},
  marks: {},
  suspects: {},
  comments: {}, // 選択キー → 選んだコメント候補のID（打つものはゼロ）
  stage: {},     // 症例ID → first / waiting / followup（差し戻しのある症例だけ動く）
  caps: {},      // 症例ID → 一本目の cap。最終評価の上限になる
  followups: {}, // 症例ID → 二本目のパネル
  messageIds: [],
  mentorId: null,
  currentCaseId: null,
  pendingChoice: null,
  phase: 'mentor', // mentor → tutorial → cases
  tutorialStep: 0,
  glossary: { tab: 'tests', testId: null, termId: null }, // 索引パネルの開き方
  interrupt: null, // { caseId, from, at } … ERからの至急が入っている間だけ立つ
  interruptDone: false, // 新人研修では1回だけ（上級モードでランダム化する）
};

let interruptTimer = null;

// 差し戻しの返信が返ってから二本目が届くまでの間。演出だけで、時間制限は入れない。
const FOLLOWUP_DELAY_MS = 4000;

const $ = (sel) => document.querySelector(sel);

async function main() {
  try {
    state.data = await loadData();
  } catch (err) {
    $('#pane-lis').innerHTML =
      `<p class="error">データを読み込めませんでした。<br>${esc(err.message)}<br>` +
      `ローカルのHTTPサーバー経由で開いてください（file:// では JSON を読めません）。</p>`;
    return;
  }

  state.cases = state.data.cases;
  for (const c of state.cases) {
    state.panels.set(c.id, buildPanel(c, state.data));
    state.status[c.id] = 'ready';
  }

  const h = state.data.hospital.hospital;
  $('#hospital-name').textContent = `${h.name}（架空）${h.lab}`;

  bindEvents();
  openMentorPicker();
}

/* ---- 指導役 ---- */

function currentMentor() {
  return mentorById(state.data, state.mentorId);
}

function openMentorPicker() {
  $('#mentor-body').innerHTML = renderMentorPicker(state.data, state.mentorId);
  $('#mentor-dialog').showModal();
}

function chooseMentor(id) {
  if (!mentorById(state.data, id)) return;
  const first = state.mentorId === null;
  state.mentorId = id;
  $('#mentor-dialog').close();

  if (first) {
    startShift();
    return;
  }
  // 出したメッセージは残したまま、選んだ人の台詞だけに差し替わる
  renderAll();
  if (state.phase === 'tutorial') renderTutorial();
}

function startShift() {
  pushMessage('msg_shift_start');
  for (const m of state.data.mentors.mentors) pushMessage(m.greeting);
  state.phase = 'tutorial';
  state.tutorialStep = 0;
  renderAll();
  setView('lis');
  renderTutorial();
  $('#tutorial-dialog').showModal();
}

/* ---- 症例0（チュートリアル） ---- */

function renderTutorial() {
  $('#tutorial-body').innerHTML = renderTutorialStep(
    state.data.tutorial,
    state.tutorialStep,
    currentMentor(),
  );
}

function advanceTutorial() {
  state.tutorialStep += 1;
  if (state.tutorialStep < stepCount(state.data.tutorial)) {
    renderTutorial();
    return;
  }
  state.phase = 'cases';
  $('#tutorial-dialog').close();
  selectCase(state.cases[0].id);
}

/* ---- メッセージ ---- */

function pushMessage(ids) {
  for (const id of [].concat(ids ?? [])) {
    if (!state.messageIds.includes(id)) state.messageIds.push(id);
  }
}

function visibleMessages() {
  return filterBySpeaker(resolveMessages(state.data, state.messageIds), state.mentorId);
}

/* ---- 症例 ---- */

function selectCase(caseId) {
  if (state.phase !== 'cases') return; // チュートリアル中は検体を開かせない
  state.currentCaseId = caseId;
  const caseDef = currentCase();
  pushMessage(caseDef.handover);
  pushMessage(caseDef.nav);
  scheduleInterrupt(caseDef);
  renderAll();
  setView('lis');
}

function currentCase() {
  return state.cases.find((c) => c.id === state.currentCaseId);
}

function currentPanel() {
  return state.panels.get(state.currentCaseId);
}

/* ---- 差し戻し（二本立ての症例） ---- */

function stageOf(caseId) {
  return state.stage[caseId] || 'first';
}

/** いま報告の対象になっている検体。差し戻し後は二本目。 */
function activePanel() {
  const id = state.currentCaseId;
  return stageOf(id) === 'followup' ? state.followups[id] : state.panels.get(id);
}

/** 報告に載る受付番号。差し戻し後は二本目のもの。 */
function activeAccession() {
  const caseDef = currentCase();
  return stageOf(caseDef.id) === 'followup'
    ? caseDef.followup.recollect.accession
    : caseDef.accession;
}

/** マークは一本目と二本目で別に持つ。一本目のマークは差し戻し後も残るが、動かせない。 */
function selectionKey(caseId, stage = stageOf(caseId)) {
  return stage === 'followup' ? `${caseId}@2` : caseId;
}

/* ---- コメントの候補 ---- */

/**
 * いまの画面から作れるコメントの候補。マーク・疑い・検体状態・再採血・操作から組む。
 * 再採血のチェックは報告ダイアログの中で変わるので、引数で受ける。
 */
function currentCommentOptions(recheck) {
  const caseDef = currentCase();
  const key = selectionKey(caseDef.id);
  return buildCommentOptions({
    data: state.data,
    panel: activePanel(),
    // 差し戻しの二本目を報告するときだけ、一本目を渡す（再採血の候補が出る）
    firstPanel: stageOf(caseDef.id) === 'followup' ? state.panels.get(caseDef.id) : null,
    ...selection(key),
    recheck,
  });
}

/** 報告ダイアログに渡す一式。選び終えた候補は、いま出ている候補だけに絞る。 */
function reportSelection(recheck = false) {
  const key = selectionKey(state.currentCaseId);
  const commentOptions = currentCommentOptions(recheck);
  const commentSelected = (state.comments[key] || []).filter((id) =>
    commentOptions.some((o) => o.id === id),
  );
  return { ...selection(key), commentOptions, commentSelected };
}

function toggleComment(optionId) {
  const key = selectionKey(state.currentCaseId);
  const max = state.data.commentTemplates.max_lines ?? 3;
  state.comments[key] = toggleCommentSelection(state.comments[key] || [], optionId, max);
  refreshCommentField();
}

/** コメント欄だけを描き直す。報告レベルの選択は触らない。 */
function refreshCommentField() {
  const field = $('#comment-field');
  if (!field) return;
  const recheck = Boolean($('#report-form input[name="recheck"]')?.checked);
  field.innerHTML = renderCommentPicker(state.data, reportSelection(recheck));
}

/* ---- マークと疑い ---- */

/** その検体のマークと疑い。報告に載るのはマークした行だけ。 */
function selection(key) {
  return { marks: state.marks[key] || [], suspects: state.suspects[key] || {} };
}

function toggleMark(testId) {
  const caseId = selectionKey(state.currentCaseId);
  if (!state.currentCaseId || !canMark()) return;
  const marks = [...(state.marks[caseId] || [])];
  const at = marks.indexOf(testId);
  if (at >= 0) {
    marks.splice(at, 1);
    // マークを外したら、その行に付けた疑いも落とす
    const suspects = { ...(state.suspects[caseId] || {}) };
    delete suspects[testId];
    state.suspects[caseId] = suspects;
  } else {
    marks.push(testId);
  }
  state.marks[caseId] = marks;
  renderAll();
}

function canMark() {
  const status = state.status[state.currentCaseId];
  return status !== 'done' && status !== 'waiting';
}

function toggleSuspect(testId, suspectId) {
  const caseId = selectionKey(state.currentCaseId);
  if (!state.currentCaseId || !canMark()) return;
  if (!(state.marks[caseId] || []).includes(testId)) return;
  const suspects = { ...(state.suspects[caseId] || {}) };
  const picked = [...(suspects[testId] || [])];
  const at = picked.indexOf(suspectId);
  if (at >= 0) picked.splice(at, 1);
  else picked.push(suspectId);
  suspects[testId] = picked;
  state.suspects[caseId] = suspects;
  renderAll();
}

/* ---- 割り込み（ERからの至急） ---- */

/** 症例側の interrupt 設定を見て、結果表示から一定時間後に割り込みを予約する。 */
function scheduleInterrupt(caseDef) {
  if (!caseDef.interrupt || state.interruptDone || interruptTimer) return;
  interruptTimer = setTimeout(() => triggerInterrupt(caseDef), caseDef.interrupt.after_ms ?? 30000);
}

/** 予約した時刻に来たか、その検体を報告する直前に呼ばれる。研修中は1回だけ起きる。 */
function triggerInterrupt(caseDef) {
  const cfg = caseDef.interrupt;
  if (!cfg || state.interruptDone) return;
  clearTimeout(interruptTimer);
  interruptTimer = null;
  state.interruptDone = true;
  if (state.status[cfg.case] === 'done') return; // 割り込む先をもう報告していたら何もしない
  state.interrupt = { caseId: cfg.case, from: caseDef.id, at: Date.now() };
  pushMessage(cfg.message);
  pushMessage(cfg.nav);
  renderAll();
}

/** 割り込み先を報告し終えたら白に戻す。前の検体を放置していたら申し送りで一言。 */
function clearInterrupt(reportedCaseId) {
  if (!state.interrupt || state.interrupt.caseId !== reportedCaseId) return;
  const source = state.cases.find((c) => c.id === state.interrupt.from);
  state.interrupt = null;
  if (source && state.status[source.id] !== 'done') pushMessage(source.interrupt.pending);
}

/** ヘッダーの赤は画面状態の合図。値の判定ではないので、文字も必ず併せて出す。 */
function renderInterruptState() {
  const on = Boolean(state.interrupt);
  document.body.dataset.state = on ? 'interrupt' : 'normal';
  const badge = $('#header-alert');
  badge.hidden = !on;
  badge.textContent = on
    ? state.currentCaseId === state.interrupt.caseId
      ? '至急対応中'
      : 'ERから至急'
    : '';
}

function renderAll() {
  renderInterruptState();
  renderWorklistPane();
  renderMessagePane();
  renderScore();

  if (state.phase !== 'cases') {
    $('#case-title').textContent = `${state.data.tutorial.title}（画面の見方）`;
    $('#pane-lis').innerHTML = renderTutorialPlaceholder();
    $('.lis-actions').hidden = true;
    return;
  }

  const caseDef = currentCase();
  if (!caseDef) return;
  $('.lis-actions').hidden = false;

  const done = state.status[caseDef.id] === 'done';
  const waiting = state.status[caseDef.id] === 'waiting';
  const stage = stageOf(caseDef.id);
  const suspectDefs = state.data.suspects.suspects;
  const glossary = state.data.glossary;

  // 一本目。差し戻しに入ったら読むだけになる（マークは残す）
  const firstView = {
    ...selection(selectionKey(caseDef.id, 'first')),
    suspectDefs,
    glossary,
    interactive: !done && stage === 'first',
  };
  let html = renderResults(caseDef, currentPanel(), state.data, firstView);

  // 差し戻しで届いた二本目。報告の対象はこちらに移る
  const followup = state.followups[caseDef.id];
  if (followup) {
    html += renderRecollect(caseDef, followup, caseDef.followup.recollect, {
      ...selection(selectionKey(caseDef.id, 'followup')),
      suspectDefs,
      glossary,
      interactive: !done,
    });
  }
  // 自分で依頼した再採血（症例5・5-b）は読むだけ
  const re = state.recollected[caseDef.id];
  if (re) html += renderRecollect(caseDef, re);
  $('#pane-lis').innerHTML = html;

  const reportBtn = $('#btn-report');
  reportBtn.disabled = done || waiting;
  reportBtn.textContent = done ? '報告済み' : waiting ? '再採血 待ち' : '報告する';

  const nextBtn = $('#btn-next');
  const idx = state.cases.findIndex((c) => c.id === caseDef.id);
  const next = state.cases[idx + 1];
  nextBtn.hidden = !(done && next);
  if (next) nextBtn.dataset.case = next.id;

  $('#case-title').textContent = caseDef.title;
}

function renderWorklistPane() {
  $('#pane-worklist').innerHTML = renderWorklist(state.cases, {
    status: state.status,
    results: state.results,
    scoreLabel: SCORE_LABEL,
    currentCaseId: state.currentCaseId,
    interrupt: state.interrupt
      ? { ...state.interrupt, active: true, blink: Date.now() - state.interrupt.at < 5000 }
      : null,
  });
}

function renderMessagePane() {
  const pane = $('#pane-messages');
  pane.innerHTML = renderMessages(visibleMessages(), currentMentor(), state.data.glossary);
  pane.scrollTop = pane.scrollHeight; // 新しい申し送り・返信が見えるところまで送る
}

function renderScore() {
  const mentor = currentMentor();
  $('#mentor-btn').textContent = `指導役 ${mentor ? mentor.name : '—'}`;

  const tally = { best: 0, ok: 0, poor: 0 };
  for (const r of Object.values(state.results)) tally[r.score] = (tally[r.score] || 0) + 1;
  const total = Object.keys(state.results).length;
  $('#score').textContent = total
    ? `報告 ${total}件 ／ 最善 ${tally.best}・許容 ${tally.ok}・要改善 ${tally.poor}`
    : '報告 0件';
}

function setView(view) {
  document.body.dataset.view = view;
  for (const btn of document.querySelectorAll('.tab')) {
    btn.setAttribute('aria-selected', String(btn.dataset.viewTarget === view));
  }
}

/* ---- イベント ---- */

function bindEvents() {
  // 最初の1人を選ぶまでは閉じさせない
  $('#mentor-dialog').addEventListener('cancel', (ev) => {
    if (!state.mentorId) ev.preventDefault();
  });
  // チュートリアルは最後まで送る
  $('#tutorial-dialog').addEventListener('cancel', (ev) => ev.preventDefault());

  document.addEventListener('click', (ev) => {
    const mentorBtn = ev.target.closest('[data-mentor]');
    if (mentorBtn) {
      chooseMentor(mentorBtn.dataset.mentor);
      return;
    }

    const caseBtn = ev.target.closest('[data-case]');
    if (caseBtn) {
      selectCase(caseBtn.dataset.case);
      return;
    }

    const termBtn = ev.target.closest('[data-term]');
    if (termBtn) {
      openTerm(termBtn.dataset.term);
      return;
    }

    const glTab = ev.target.closest('[data-gl-tab]');
    if (glTab) {
      switchGlossaryTab(glTab.dataset.glTab);
      return;
    }

    const testBtn = ev.target.closest('[data-test]');
    if (testBtn) {
      openGlossary(testBtn.dataset.test);
      return;
    }

    const commentBtn = ev.target.closest('[data-comment]');
    if (commentBtn) {
      toggleComment(commentBtn.dataset.comment);
      return;
    }

    const suspectBtn = ev.target.closest('[data-suspect]');
    if (suspectBtn) {
      toggleSuspect(suspectBtn.dataset.suspectTest, suspectBtn.dataset.suspect);
      return;
    }

    const markRow = ev.target.closest('[data-mark]');
    if (markRow) {
      toggleMark(markRow.dataset.mark);
      return;
    }

    const tab = ev.target.closest('.tab');
    if (tab) {
      setView(tab.dataset.viewTarget);
      return;
    }

    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (action === 'close-report') closeReport();
    if (action === 'close-glossary') $('#glossary-dialog').close();
    if (action === 'open-report') openReport();
    if (action === 'open-mentor') openMentorPicker();
    if (action === 'close-mentor') $('#mentor-dialog').close();
    if (action === 'tutorial-next') advanceTutorial();
    if (action === 'readback') finishReport({ ...state.pendingChoice, readback: true });
  });

  // 行は button ではないので、Enter と Space を自前で拾う
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const markRow = ev.target.closest?.('[data-mark]');
    if (!markRow) return;
    ev.preventDefault();
    const testId = markRow.dataset.mark;
    toggleMark(testId);
    $(`[data-mark="${testId}"]`)?.focus();
  });

  // 再採血のチェックで「再採血を依頼中」の候補が出入りする
  document.addEventListener('change', (ev) => {
    if (ev.target.name === 'recheck') refreshCommentField();
  });

  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'report-form') return;
    ev.preventDefault();
    const form = new FormData(ev.target);
    const recheck = form.get('recheck') === 'on';
    const sel = reportSelection(recheck);
    const choice = {
      level: form.get('level'),
      // 報告の文面は、選んだ候補そのもの。打った文字は一つもない
      comment: sel.commentOptions.filter((o) => sel.commentSelected.includes(o.id)),
      recheck,
      readback: false,
      marks: sel.marks,
      suspects: sel.suspects,
    };
    if (choice.level === 'emergency') {
      state.pendingChoice = choice;
      $('#report-body').innerHTML = renderPhone(
        currentCase(), activePanel(), choice, activeAccession(),
      );
      return;
    }
    finishReport(choice);
  });
}

/* ---- 索引パネル（項目 ／ 言葉） ---- */

function openGlossary(testId) {
  if (state.phase !== 'cases') return;
  state.glossary = { tab: 'tests', testId, termId: null };
  showGlossary();
}

/** 画面の言葉をタップしたとき。症例を開いていなくても引ける。 */
function openTerm(termId) {
  state.glossary = { ...state.glossary, tab: 'terms', termId };
  showGlossary();
}

function switchGlossaryTab(tab) {
  state.glossary = { ...state.glossary, tab };
  showGlossary();
}

function showGlossary() {
  const sex = currentCase()?.patient.sex || 'F';
  $('#glossary-body').innerHTML = renderGlossaryPanel(state.data, state.glossary, sex);
  if (!$('#glossary-dialog').open) $('#glossary-dialog').showModal();
  const current = $('#glossary-body .term-card.is-current');
  if (current) current.scrollIntoView({ block: 'center' });
}

function openReport() {
  const caseDef = currentCase();
  if (caseDef && caseDef.interrupt && !state.interruptDone) triggerInterrupt(caseDef);
  state.pendingChoice = null;
  $('#report-body').innerHTML = renderReportDialog(
    currentCase(), state.data, reportSelection(false), activeAccession(),
  );
  $('#report-dialog').showModal();
}

function closeReport() {
  state.pendingChoice = null;
  $('#report-dialog').close();
}

/** 差し戻しのあと、二本目が届く。指導役の一言と受付の記録もここで流す。 */
function deliverFollowup(caseId) {
  const caseDef = state.cases.find((c) => c.id === caseId);
  if (!caseDef || stageOf(caseId) !== 'waiting') return;
  const re = caseDef.followup.recollect;
  state.followups[caseId] = buildRecollect(caseDef, state.panels.get(caseId), state.data, re);
  state.stage[caseId] = 'followup';
  state.status[caseId] = 'recollect';
  pushMessage(caseDef.followup.handover);
  if (re.reply) pushMessage(re.reply);
  renderAll();
}

function finishReport(choice) {
  const caseDef = currentCase();
  const followupStage = stageOf(caseDef.id) === 'followup';
  const res = followupStage
    ? evaluateFollowup(caseDef, choice, state.caps[caseDef.id])
    : evaluate(caseDef, choice);

  // 差し戻し。症例は閉じず、医師の返信だけ届いて二本目を待つ
  if (res.then === 'followup' && caseDef.followup) {
    state.caps[caseDef.id] = res.cap;
    state.stage[caseDef.id] = 'waiting';
    state.status[caseDef.id] = 'waiting';
    if (res.messageId) pushMessage(res.messageId);
    if (res.doctorId) pushMessage(res.doctorId);
    state.pendingChoice = null;
    $('#report-body').innerHTML = renderVerdict(res, choice, state.data);
    renderAll();
    setTimeout(() => deliverFollowup(caseDef.id), FOLLOWUP_DELAY_MS);
    return;
  }

  state.results[caseDef.id] = res;
  state.status[caseDef.id] = 'done';
  clearInterrupt(caseDef.id);
  // 報告 → 指導役の講評 → 医師の返信、の順に届く
  if (res.messageId) pushMessage(res.messageId);
  if (res.doctorId) pushMessage(res.doctorId);

  if (choice.recheck && caseDef.recollect) {
    state.recollected[caseDef.id] = buildRecollect(caseDef, currentPanel(), state.data);
    if (caseDef.recollect.reply) pushMessage(caseDef.recollect.reply);
  }
  state.pendingChoice = null;
  $('#report-body').innerHTML = renderVerdict(res, choice, state.data);
  renderAll();
}

main();
