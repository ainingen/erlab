// 画面の組み立てとイベント処理。ロジックは derive.js / report.js 側に置く。

import { loadData } from './data.js';
import { buildPanel, buildRecollect } from './derive.js';
import { renderWorklist, renderResults, renderRecollect, renderGlossary, esc } from './lis.js';
import { renderMessages, resolveMessages, filterBySpeaker } from './messages.js';
import { renderReportDialog, renderPhone, evaluate, renderVerdict, SCORE_LABEL } from './report.js';
import { renderMentorPicker, mentorById } from './mentor.js';
import { renderTutorialStep, renderTutorialPlaceholder, stepCount } from './tutorial.js';

const state = {
  data: null,
  cases: [],
  panels: new Map(),
  status: {},
  results: {},
  recollected: {},
  messageIds: [],
  mentorId: null,
  currentCaseId: null,
  pendingChoice: null,
  phase: 'mentor', // mentor → tutorial → cases
  tutorialStep: 0,
};

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
  renderAll();
  setView('lis');
}

function currentCase() {
  return state.cases.find((c) => c.id === state.currentCaseId);
}

function currentPanel() {
  return state.panels.get(state.currentCaseId);
}

function renderAll() {
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

  const re = state.recollected[caseDef.id];
  $('#pane-lis').innerHTML =
    renderResults(caseDef, currentPanel(), state.data) + (re ? renderRecollect(caseDef, re) : '');

  const done = state.status[caseDef.id] === 'done';
  const reportBtn = $('#btn-report');
  reportBtn.disabled = done;
  reportBtn.textContent = done ? '報告済み' : '報告する';

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
  });
}

function renderMessagePane() {
  const pane = $('#pane-messages');
  pane.innerHTML = renderMessages(visibleMessages(), currentMentor());
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

    const testBtn = ev.target.closest('[data-test]');
    if (testBtn) {
      openGlossary(testBtn.dataset.test);
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

  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'report-form') return;
    ev.preventDefault();
    const form = new FormData(ev.target);
    const choice = {
      level: form.get('level'),
      comment: form.get('comment') || '',
      recheck: form.get('recheck') === 'on',
      readback: false,
    };
    if (choice.level === 'emergency') {
      state.pendingChoice = choice;
      $('#report-body').innerHTML = renderPhone(currentCase(), currentPanel());
      return;
    }
    finishReport(choice);
  });
}

function openGlossary(testId) {
  if (state.phase !== 'cases') return;
  const sex = currentCase().patient.sex;
  $('#glossary-body').innerHTML = renderGlossary(testId, state.data, sex);
  $('#glossary-dialog').showModal();
}

function openReport() {
  state.pendingChoice = null;
  $('#report-body').innerHTML = renderReportDialog(currentCase(), state.data);
  $('#report-dialog').showModal();
}

function closeReport() {
  state.pendingChoice = null;
  $('#report-dialog').close();
}

function finishReport(choice) {
  const caseDef = currentCase();
  const res = evaluate(caseDef, choice);
  state.results[caseDef.id] = res;
  state.status[caseDef.id] = 'done';
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
