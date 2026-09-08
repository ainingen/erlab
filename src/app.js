// 画面の組み立てとイベント処理。ロジックは derive.js / report.js 側に置く。

import { loadData } from './data.js';
import { buildPanel, buildRecollect, buildCommentOptions, toggleCommentSelection } from './derive.js';
import { renderWorklist, renderResults, renderRecollect, renderGlossaryPanel, esc } from './lis.js';
import {
  renderMessages, newestFirst, freshGroup, resolveMessages, filterBySpeaker,
} from './messages.js';
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
  commentGroups: {}, // 選択キー → 開いている所見の群。既定は comment_templates.json の open
  stage: {},     // 症例ID → first / waiting / followup（差し戻しのある症例だけ動く）
  caps: {},      // 症例ID → 一本目の cap。最終評価の上限になる
  followups: {}, // 症例ID → 二本目のパネル
  messageIds: [],   // 届いた順のID（重複を弾くためだけに持つ）
  messageGroups: [], // 届いた順の「組」。同時に届いたものを一つにまとめる
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
let pointSeqTimer = null;
let heldRegion = null; // いま出したままにしている枠

// 指さし。枠は時間で消さない（症例0は次の文へ移るまで、症例1〜3は次に「ここ」を押すまで）。
// 演出だけで、判定には一切効かない
// 症例0が自動で次の一文へ移る間隔
const POINT_STEP_MS = 2400;
const POINT_VIEW = { reception: 'worklist', messages: 'messages' };

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
  // 帯の下に隠れないよう、光らせる先を上寄りに送る
  document.documentElement.dataset.tutorial = 'open';
  $('#tutorial-dialog').showModal();
  renderTutorial();
}

/* ---- 症例0（チュートリアル） ---- */

function renderTutorial() {
  $('#tutorial-body').innerHTML = renderTutorialStep(
    state.data.tutorial,
    state.tutorialStep,
    currentMentor(),
  );
  // 症例0は自動。「次へ」で進むたび、その文の該当箇所が順に光る
  pointSequence(stepFocuses(state.data.tutorial, state.tutorialStep, state.mentorId));
}

/** そのステップの各文の指さし先。null は「指す先がない」で、そこで枠を消す。 */
function stepFocuses(tutorial, index, mentorId) {
  const line = tutorial.steps[index]?.lines?.[mentorId];
  return line && Array.isArray(line.focus) ? line.focus : [];
}

function advanceTutorial() {
  state.tutorialStep += 1;
  if (state.tutorialStep < stepCount(state.data.tutorial)) {
    renderTutorial();
    return;
  }
  state.phase = 'cases';
  clearPoint();
  delete document.documentElement.dataset.tutorial;
  $('#tutorial-dialog').close();
  selectCase(state.cases[0].id);
}

/* ---- メッセージ ---- */

/** 別々の便として積む。ひとつずつ独立した組になる。 */
function pushMessage(ids) {
  for (const id of [].concat(ids ?? [])) pushGroup(id);
}

/**
 * 同時に届くものを一つの組として積む。組の中は書いた順のまま並び、
 * 一覧では組ごと新しいものが上に来る（renderMessagePane）。
 * 講評と医師の返信は同時に届くので、この形で積んで上下が入れ替わらないようにする。
 */
function pushGroup(ids) {
  const fresh = freshGroup(ids, []).map(deliveryKey).filter((id) => !state.messageIds.includes(id));
  if (!fresh.length) return;
  state.messageIds.push(...fresh);
  state.messageGroups.push(fresh);
}

/**
 * 届いたときの控え。ふつうはメッセージIDそのもので、一度届いたものは二度積まない。
 * 汎用の返信（`repeat: true`）だけは症例をまたいで何度でも届くので、通し番号を付けて別の便にする。
 */
function deliveryKey(id) {
  const msg = (state.data.messages.messages || {})[id];
  if (!msg || !msg.repeat) return id;
  const sent = state.messageIds.filter((x) => x === id || x.startsWith(`${id}#`)).length;
  return sent ? `${id}#${sent + 1}` : id;
}

/** 選んでいる指導役に出すものだけ残した、組の配列（古い順）。 */
function visibleMessageGroups() {
  return state.messageGroups
    .map((group) => filterBySpeaker(resolveMessages(state.data, group), state.mentorId))
    .filter((group) => group.length);
}

/* ---- 症例 ---- */

function selectCase(caseId) {
  if (state.phase !== 'cases') return; // チュートリアル中は検体を開かせない
  clearPoint(); // 前の症例で押した「ここ」の枠を持ち越さない
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
  return {
    ...selection(key),
    commentOptions,
    commentSelected,
    commentGroupsOpen: openCommentGroups(key),
  };
}

/** 開いている所見の群。一度開いた群は、その症例の間は開いたまま。 */
function openCommentGroups(key) {
  if (!state.commentGroups[key]) {
    state.commentGroups[key] = (state.data.commentTemplates.groups || [])
      .filter((g) => g.open)
      .map((g) => g.id);
  }
  return state.commentGroups[key];
}

function toggleCommentGroup(groupId, open) {
  const key = selectionKey(state.currentCaseId);
  const list = openCommentGroups(key).filter((id) => id !== groupId);
  state.commentGroups[key] = open ? [...list, groupId] : list;
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
    // 帯の後ろに骨組みの結果画面を出す。指さしの的になり、欄の位置が覚えられる
    $('#case-title').textContent = `${state.data.tutorial.title}（画面の見方）`;
    $('#pane-lis').innerHTML = renderTutorialPlaceholder(state.data);
    $('.lis-actions').hidden = false;
    $('#btn-report').disabled = true;
    $('#btn-report').textContent = '報告する';
    $('#btn-next').hidden = true;
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
  // 新しいものを上に積む。届いたばかりの返信が、スクロールなしで目に入る位置に来る。
  // state.messageIds は届いた順のまま持ち、描くときだけ逆にする。
  const pane = $('#pane-messages');
  pane.innerHTML = renderMessages(
    newestFirst(visibleMessageGroups()),
    currentMentor(),
    state.data.glossary,
  );
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

/* ---- 指さし ---- */

/** 光っているものを消して、予約も取り消す。症例を移るときにも呼ぶ（枠を持ち越さない）。 */
function clearPoint() {
  clearTimeout(pointSeqTimer);
  heldRegion = null;
  for (const el of document.querySelectorAll('.is-pointed')) el.classList.remove('is-pointed');
}

/**
 * 症例0の指さし。一文ずつ順に、その文の場所を出したままにする。押させない
 * （まだ何を押せばいいか分からない段階）。一度に一か所だけ。
 * 枠は時間で消さない。次の文が来るまで、最後の文なら「次へ」を押すまで出したまま。
 */
function pointSequence(regions) {
  clearTimeout(pointSeqTimer);
  if (!regions.length) return;
  let i = 0;
  const next = () => {
    pointAt(regions[i]);
    i += 1;
    if (i < regions.length) pointSeqTimer = setTimeout(next, POINT_STEP_MS);
  };
  next();
}

/**
 * 画面のその場所に枠を出す。一度に一か所だけ。
 * 症例0は次の文が来るまで、症例1〜3は次の「ここ」を押すまで、出したままにする。
 * null（症例0の指す先がない文）では消す。
 * 同じ場所を続けて指したときは何もしない——付け直すと線を引く動きが再生され、点滅に見えるため。
 */
function pointAt(region) {
  const stillThere = document.querySelector('.is-pointed');
  if (region && region === heldRegion && stillThere) return;
  for (const el of document.querySelectorAll('.is-pointed')) el.classList.remove('is-pointed');
  heldRegion = region || null;
  if (!region) return;
  setView(POINT_VIEW[region] || 'lis');
  const targets = [...document.querySelectorAll(`[data-region="${region}"]`)];
  if (!targets.length) return;
  for (const el of targets) el.classList.add('is-pointed');
  // 症例0は下に帯があるので上へ寄せる。ナビの「ここ」は画面の真ん中に置く
  const banded = document.documentElement.dataset.tutorial === 'open';
  targets[0].scrollIntoView({ block: banded ? 'start' : 'center' });
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

    const pointBtn = ev.target.closest('[data-point]');
    if (pointBtn) {
      pointAt(pointBtn.dataset.point);
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

    // 所見の群の開閉。details の既定動作は止めず、開いた状態だけ覚えておく
    const groupSummary = ev.target.closest('[data-comment-group]');
    if (groupSummary) {
      const details = groupSummary.closest('details');
      toggleCommentGroup(groupSummary.dataset.commentGroup, !(details && details.open));
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
    // 講評と医師の返信は同時に届く。一つの組にして、上下が入れ替わらないようにする
    pushGroup([res.messageId, res.doctorId]);
    state.pendingChoice = null;
    $('#report-body').innerHTML = renderVerdict(res, choice, state.data);
    renderAll();
    setTimeout(() => deliverFollowup(caseDef.id), FOLLOWUP_DELAY_MS);
    return;
  }

  state.results[caseDef.id] = res;
  state.status[caseDef.id] = 'done';
  clearInterrupt(caseDef.id);
  // 報告 → 指導役の講評 → 医師の返信、の順に届く。二本で一つの組にする
  pushGroup([res.messageId, res.doctorId]);

  if (choice.recheck && caseDef.recollect) {
    state.recollected[caseDef.id] = buildRecollect(caseDef, currentPanel(), state.data);
    if (caseDef.recollect.reply) pushMessage(caseDef.recollect.reply);
  }
  state.pendingChoice = null;
  $('#report-body').innerHTML = renderVerdict(res, choice, state.data);
  renderAll();
}

main();
