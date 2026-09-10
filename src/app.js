// 画面の組み立てとイベント処理。ロジックは derive.js / report.js 側に置く。

import { loadData } from './data.js';
import { buildPanel, buildRecollect, buildCommentOptions, toggleCommentSelection } from './derive.js';
import {
  renderWorklist, renderResults, renderRecollect, renderGlossaryPanel, pointFitsBand, esc,
} from './lis.js';
import {
  renderMessages, newestFirst, freshGroup, resolveMessages, filterBySpeaker, askMessageIds,
  NO_MENTOR_ASK_ID,
} from './messages.js';
import {
  renderReportDialog, renderCommentPicker, renderPhone, evaluate, evaluateFollowup, renderVerdict,
  SCORE_LABEL,
} from './report.js';
import { renderMentorPicker, mentorById, mentorForCase, askButtonState } from './mentor.js';
import { fillMessage } from './review.js';
import {
  pushScore, trust, summarize, isAbsentNight, closeNight, pickNightCases, nightReceivedAt,
  summaryBody, toSave, fromSave, newShift,
} from './shift.js';
import { actionStates, runAction, renderInvestigatePanel } from './investigate.js';
import { deriveFacts } from './judge.js';
import * as sound from './sound.js';
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
  actions: {},  // 症例ID → 押した行動（調べる）。押した順に積む。取り消しはない
  ask: {},      // 症例ID → 'answered'（指導役が答えた）／'absent'（指導役がいなかった）
                // answered の症例だけ最終評価が許容どまりになる
  comments: {}, // 選択キー → 選んだコメント候補のID（打つものはゼロ）
  commentGroups: {}, // 選択キー → 開いている所見の群。既定は comment_templates.json の open
  stage: {},     // 症例ID → first / waiting / followup（差し戻しのある症例だけ動く）
  caps: {},      // 症例ID → 一本目の cap。最終評価の上限になる
  followups: {}, // 症例ID → 二本目のパネル
  reviewValues: {}, // 届いたIDごとの、共通の台詞に埋める値（生成症例だけ。docs/review-common.md §2）
  messageIds: [],   // 届いた順のID（重複を弾くためだけに持つ）
  messageGroups: [], // 届いた順の「組」。同時に届いたものを一つにまとめる
  mentorId: null,
  currentCaseId: null,
  pendingChoice: null,
  // シフト（docs/shift.md）。1周＝一晩。信頼度は直近10件の窓で、集計のときだけ見せる
  shift: newShift(),
  absentNight: false, // その晩、指導役が休みか（症例JSONは触らず、晩の状態で持つ）
  nightScores: [],    // その晩に閉じた症例の最終評価。退勤の集計に使う
  trustShown: null,   // 前の退勤で見せた信頼度。集計の「60 → 65」の左側
  saveBroken: false,  // localStorage が読み書きできない環境
  started: false,     // 一晩目（または続きの晩）を開いたか。保存から指導役を復元しても出勤はここで見る
  phase: 'mentor', // mentor → tutorial → cases → summary
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

// 調べた結果に一行足したとき、その行だけ枠と「新」の札を出す時間。演出だけで判定には効かない。
const FRESH_MS = 1100;
// 差し戻しの返信が返ってから二本目が届くまでの間。演出だけで、時間制限は入れない。
const FOLLOWUP_DELAY_MS = 4000;
// 送信・判定・返信は同じ一瞬に起きる。音だけ少しずらして、順に起きた出来事として聞かせる
const CLOSE_DELAY_MS = 150;
const MESSAGE_DELAY_MS = 400;

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

  loadSave();

  const h = state.data.hospital.hospital;
  $('#hospital-name').textContent = `${h.name}（架空）${h.lab}`;

  bindEvents();
  renderSoundButton();
  renderAskButton(); // 指導役を選ぶ前は押せない状態で出しておく（位置は最初から固定）
  openMentorPicker();
}

/* ---- シフト（docs/shift.md） ---- */

const shiftCfg = () => state.data.shift;

/** その晩に流す症例を組む。**症例JSONは触らない**——晩の状態で写しを作る（§6）。 */
function openNight() {
  const cfg = shiftCfg();
  const night = state.shift.night;
  state.absentNight = night > 1 && isAbsentNight(state.shift, cfg);
  // 一晩目は研修。既存の症例を全部、書いてある受付時刻のまま流す
  const list = night === 1
    ? state.data.cases
    : pickNightCases(night, state.data.cases, cfg)
      .map((id) => state.data.cases.find((c) => c.id === id))
      .map((c, i) => ({ ...c, received_at: nightReceivedAt(i, cfg) }));
  state.cases = list.map((c) => (state.absentNight ? { ...c, mentor: false } : c));

  state.panels = new Map();
  state.status = {};
  state.nightScores = [];
  state.currentCaseId = null;
  state.interrupt = null;
  state.interruptDone = false;
  for (const c of state.cases) {
    state.panels.set(c.id, buildPanel(c, state.data));
    state.status[c.id] = 'ready';
  }
  state.phase = night === 1 ? 'tutorial' : 'cases';
}

/** 出勤の申し送り。不在の晩は中央検査部の名義で、指導役の姓を埋める。 */
function pushNightHandover() {
  if (state.shift.night === 1) return; // 研修の申し送りは既存の msg_shift_start
  const id = state.absentNight ? 'msg_shift_absent_start' : 'msg_shift_night_start';
  const sent = pushMessage(id);
  const extra = { body: nightHandoverBody(id) };
  for (const key of sent) state.reviewValues[key] = extra;
}

/** 申し送りの本文。`{mentor}` を姓で埋め、保存できない環境では一行足す（§5）。 */
function nightHandoverBody(id) {
  const mentor = currentMentor();
  const family = mentor ? mentor.name.split(/[  ]/)[0] : '指導役';
  const body = state.data.messages.messages[id].body
    .map((line) => line.replace(/\{mentor\}/g, family));
  if (state.saveBroken) body.push('※この環境では進行が保存されません。');
  return body;
}

/** その晩の症例が全部閉じたか。差し戻し待ちは閉じていない。 */
function nightFinished() {
  return state.cases.length > 0 && state.cases.every((c) => state.status[c.id] === 'done');
}

/** 退勤。集計を院内メッセージの枡で出す（別UIを作らない）。 */
function endNight() {
  if (state.phase !== 'cases' || !nightFinished()) return;
  const cfg = shiftCfg();
  const before = state.trustShown; // 最初の晩は null（「— → 45」の形）
  const after = trust(state.shift.window, cfg);
  const closed = closeNight(state.shift, { absent: state.absentNight, scores: state.nightScores }, cfg);

  // 退勤の一行。不在の晩は症例の申し送りと同じ扱いで、中央検査部の名義に差し替える（§3-2）
  const end = pushMessage('msg_shift_night_end');
  if (state.absentNight) {
    for (const key of end) state.reviewValues[key] = { from: '中央検査部', dropSpeaker: true };
  }
  const sent = pushMessage('msg_shift_summary');
  for (const key of sent) {
    state.reviewValues[key] = { body: summaryBody(closed.tally, before, after) };
  }
  if (state.absentNight) {
    const id = closed.clearedNow ? 'msg_shift_absent_clear' : 'msg_shift_absent_fail';
    const done = pushMessage(id);
    for (const key of done) state.reviewValues[key] = { body: nightHandoverBody(id) };
  }
  state.trustShown = after;
  state.shift = closed.shift;
  state.phase = 'summary';
  saveNow();
  renderAll();
  setView('messages');
  sound.play('message');
}

/** 「次の晩へ」。集計を読んだあと、次の出勤に進む。 */
function nextNight() {
  if (state.phase !== 'summary') return;
  openNight();
  pushNightHandover();
  saveNow();
  renderAll();
  setView('lis');
  if (state.cases.length) selectCase(state.cases[0].id);
}

/* ---- 保存（§5。読み書きはこの二つだけ） ---- */

function saveNow() {
  if (state.saveBroken) return;
  try {
    window.localStorage.setItem(
      shiftCfg().save_key,
      JSON.stringify(toSave(state.shift, state.mentorId, state.trustShown)),
    );
  } catch (err) {
    state.saveBroken = true; // 塞がれている環境ではメモリだけで動く
  }
}

function loadSave() {
  const cfg = state.data.shift;
  let raw = null;
  try {
    raw = JSON.parse(window.localStorage.getItem(cfg.save_key) || 'null');
  } catch (err) {
    state.saveBroken = true;
  }
  const { shift, mentorId, trustShown } = fromSave(raw, cfg);
  state.shift = shift;
  // 前の晩に見せた信頼度。続きの晩の集計で「45 → xx」の左に入る（§5）
  state.trustShown = trustShown;
  if (mentorId && mentorById(state.data, mentorId)) state.mentorId = mentorId;
}

/** 「最初から」。確認を一度だけ取ってから消す。 */
function restart() {
  if (!window.confirm('進行を消して最初からやり直しますか。この操作は戻せません。')) return;
  clearSave();
}

function clearSave() {
  try {
    window.localStorage.removeItem(shiftCfg().save_key);
  } catch (err) {
    state.saveBroken = true;
  }
  state.shift = newShift();
  state.mentorId = null;
  state.trustShown = null;
  window.location.reload();
}

/* ---- 指導役 ---- */

function currentMentor() {
  return mentorById(state.data, state.mentorId);
}

/** 音のON/OFF。文字（🔊 / 🔇 と「音」）で出す。アイコンだけにしない。 */
function toggleSound() {
  sound.setOn(!sound.isOn());
  if (sound.isOn()) sound.init();
  renderSoundButton();
}

function renderSoundButton() {
  const btn = $('#sound-btn');
  if (!btn) return;
  const on = sound.isOn();
  btn.textContent = on ? '🔊 音 入' : '🔇 音 切';
  btn.setAttribute('aria-pressed', String(on));
}

function openMentorPicker() {
  // 保存された進行があれば「最初から」を出す（無ければ出さない）
  const saved = state.shift.night > 1 || state.shift.window.length ? state.shift : null;
  $('#mentor-body').innerHTML = renderMentorPicker(state.data, state.mentorId, saved);
  $('#mentor-dialog').showModal();
}

function chooseMentor(id) {
  if (!mentorById(state.data, id)) return;
  // スマホは最初のタップまで鳴らせない。ここで音を解錠する
  sound.init();
  state.mentorId = id;
  $('#mentor-dialog').close();

  // まだ出勤していなければ、ここで晩を開く（保存から指導役を復元した続きも同じ道）
  if (!state.started) {
    state.started = true;
    startShift();
    return;
  }
  // 出したメッセージは残したまま、選んだ人の台詞だけに差し替わる
  renderAll();
  if (state.phase === 'tutorial') renderTutorial();
}

function startShift() {
  openNight();
  if (state.shift.night === 1) {
    pushMessage('msg_shift_start');
    for (const m of state.data.mentors.mentors) pushMessage(m.greeting);
  } else {
    pushNightHandover();
  }
  saveNow();
  // 二晩目以降は研修を挟まない
  if (state.phase === 'cases') {
    renderAll();
    setView('lis');
    if (state.cases.length) selectCase(state.cases[0].id);
    return;
  }
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
  const sent = [];
  for (const id of [].concat(ids ?? [])) sent.push(...pushGroup(id));
  return sent;
}

/**
 * 同時に届くものを一つの組として積む。組の中は書いた順のまま並び、
 * 一覧では組ごと新しいものが上に来る（renderMessagePane）。
 * 講評と医師の返信は同時に届くので、この形で積んで上下が入れ替わらないようにする。
 */
function pushGroup(ids) {
  const fresh = freshGroup(ids, []).map(deliveryKey).filter((id) => !state.messageIds.includes(id));
  if (!fresh.length) return [];
  state.messageIds.push(...fresh);
  state.messageGroups.push(fresh);
  return fresh;
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
    .map((group) => filterBySpeaker(resolveMessages(state.data, group), state.mentorId)
      .map((m) => decorate(m))
      .filter(Boolean)) // 埋め残しで本文が無くなった便は出さない（docs/review-common.md §2）
    .filter((group) => group.length);
}

/**
 * 共通の台詞（生成症例）に、その症例の値を埋める。埋めるのはここ一か所だけ。
 * 医師の差出人・件名・時刻も、台詞側に書いていなければここで足す（docs/review-common.md 5-3）。
 */
function decorate(message) {
  const extra = state.reviewValues[message.id];
  if (!extra) return message;
  // 集計と申し送りは本文ごと差し替える（数字と指導役の姓を埋めたもの）
  if (extra.body) return { ...message, body: extra.body };
  if (extra.from) {
    return { ...message, from: extra.from, from_mentor: !extra.dropSpeaker && message.from_mentor };
  }
  const filled = fillMessage(message, extra.values);
  const meta = extra.doctorMeta;
  if (!filled || !meta || message.kind !== 'reply') return filled;
  return {
    ...filled,
    from: filled.from || meta.from,
    subject: filled.subject || meta.subject,
    time: filled.time && filled.time !== '—' ? filled.time : meta.time,
  };
}

/* ---- 症例 ---- */

function selectCase(caseId) {
  if (state.phase !== 'cases') return; // チュートリアル中は検体を開かせない
  clearPoint(); // 前の症例で押した「ここ」の枠を持ち越さない
  state.currentCaseId = caseId;
  const caseDef = currentCase();
  pushCaseHandover(caseDef);
  if (!state.absentNight) pushMessage(caseDef.nav);
  scheduleInterrupt(caseDef);
  renderAll();
  setView('lis');
  sound.play('result');
}

/** 症例の申し送り。不在の晩は指導役の名義を外して中央検査部から出す（§3-2）。 */
function pushCaseHandover(caseDef) {
  const sent = pushMessage(caseDef.handover);
  if (!state.absentNight) return;
  for (const key of sent) state.reviewValues[key] = { from: '中央検査部', dropSpeaker: true };
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

/* ---- 調べる（目視・ID照合・塗抹・電話） ---- */

/**
 * いま画面に出ている検体が一本目か、届いた二本目か。
 * 二本目が来たら目視だけもう一度できる（docs/investigate.md §2）。
 */
function investigateStage(caseId) {
  return state.followups[caseId] || state.recollected[caseId] ? 'recollect' : 'first';
}

function investigateEntries(caseId) {
  return state.actions[caseId] || [];
}

/** 判定に渡す形。押した行動のIDだけで、順番も時刻も見ない。 */
function takenActionIds(caseId) {
  return [...new Set(investigateEntries(caseId).map((e) => e.id))];
}

function currentActionStates() {
  const caseDef = currentCase();
  if (!caseDef) return [];
  return actionStates({
    order: caseDef.order || [],
    done: !canMark(),
    stage: investigateStage(caseDef.id),
    taken: investigateEntries(caseDef.id),
  });
}

/** 行動をひとつ押した。結果は検体状態欄ではなく「調べた結果」欄に積む。 */
function investigate(actionId) {
  const caseDef = currentCase();
  if (!caseDef) return;
  const st = currentActionStates().find((a) => a.id === actionId);
  if (!st || !st.enabled) return;

  const entries = investigateEntries(caseDef.id);
  const entry = runAction(actionId, {
    caseDef,
    data: state.data,
    panel: activePanel(),
    index: entries.length,
    stage: investigateStage(caseDef.id),
  });
  if (!entry) return;
  state.actions[caseDef.id] = [...entries, entry];
  // 電話は相手の言葉が院内メッセージにも残る。他の三つは自分で見たことなので残らない
  if (entry.messageId) pushMessage(entry.messageId);
  sound.play(entry.id === 'call' ? 'message' : 'tap');
  renderAll();
  showFreshEntry();
}

/**
 * いま足した一行を目立たせる。枠と行頭の「新」の札を一緒に出して、1秒で消す。
 * 値の判定ではなく「いま増えた」の合図なので、フラグの黄・赤は使わない。
 * 描き直しで再生されないよう、クラスは描いたあとの DOM に直接付けて、時間で外す。
 */
function showFreshEntry() {
  const rows = document.querySelectorAll('.investigate-log li');
  const row = rows[rows.length - 1];
  if (!row) return;
  row.classList.add('is-fresh');
  setTimeout(() => row.classList.remove('is-fresh'), FRESH_MS);
  // 欄が画面の外にあるときだけ寄せる。見えているなら動かさない（指さしと同じ扱い）
  const box = $('[data-region="investigate_log"]');
  if (box && !pointFitsBand(box.getBoundingClientRect(), visibleBand())) {
    box.scrollIntoView({ block: 'center' });
  }
}

/* ---- 指導役に聞く ---- */

/**
 * 上のバー右端の「聞く」。**位置は症例・モードによらず固定**で、ナビ枠が出ていなくても出る。
 * 1症例1回。指導役が答えた症例だけ、最終評価が許容どまりになる。
 */
function askState() {
  const caseDef = currentCase();
  return askButtonState({
    mentor: mentorForCase(state.data, state.mentorId, caseDef),
    used: caseDef ? state.ask[caseDef.id] || null : null,
    open: state.phase === 'cases' && Boolean(caseDef) && canMark(),
  });
}

/** ヘッダーの「聞く」を状態に合わせて描き直す。文字を必ず変える（色だけにしない）。 */
function renderAskButton() {
  const btn = $('#ask-btn');
  if (!btn) return;
  const st = askState();
  btn.textContent = st.label;
  btn.disabled = !st.enabled;
  btn.title = st.note;
  btn.setAttribute('aria-label', `${st.label}：${st.note}`);
  btn.setAttribute('aria-pressed', String(Boolean(st.used)));
}

function ask() {
  const caseDef = currentCase();
  if (!caseDef || !askState().enabled) return;
  const mentor = mentorForCase(state.data, state.mentorId, caseDef);
  if (!mentor) {
    // 聞ける相手がいない。答えは返らないので、評価の頭打ちもしない
    state.ask[caseDef.id] = 'absent';
    pushMessage(NO_MENTOR_ASK_ID);
  } else {
    state.ask[caseDef.id] = 'answered';
    // 症例が台詞を書いていなければ既定の「見る順番」が出る（生成症例でも動く）
    pushMessage(askMessageIds(caseDef));
  }
  sound.play('message');
  renderAll();
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
  sound.play('tap');
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
  sound.play('tap');
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
  sound.play('tap');
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
  sound.play('interrupt'); // 点滅と同じで一回だけ。message は重ねない
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
  renderAskButton();
  renderWorklistPane();
  renderMessagePane();
  renderScore();

  if (state.phase === 'summary') {
    // 退勤。集計は院内メッセージの枡に出してあるので、ここは次の晩への入口だけ
    $('#case-title').textContent = `${state.shift.night - 1}晩目 退勤`;
    $('#pane-lis').innerHTML =
      '<p class="hint">今晩の集計は院内メッセージに出ています。読んだら「次の晩へ」。</p>';
    $('.lis-actions').hidden = false;
    $('#btn-report').disabled = true;
    $('#btn-report').textContent = '報告する';
    const next = $('#btn-next');
    next.hidden = false;
    next.textContent = '次の晩へ';
    delete next.dataset.case;
    next.dataset.action = 'next-night';
    return;
  }

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
  // 行動ボタンは結果テーブルの下、報告ボタンの上。調べた結果はそのボタンの直下に積む
  html += renderInvestigatePanel({
    states: currentActionStates(),
    entries: investigateEntries(caseDef.id),
    glossary,
  });
  $('#pane-lis').innerHTML = html;

  const reportBtn = $('#btn-report');
  reportBtn.disabled = done || waiting;
  reportBtn.textContent = done ? '報告済み' : waiting ? '再採血 待ち' : '報告する';

  const nextBtn = $('#btn-next');
  const idx = state.cases.findIndex((c) => c.id === caseDef.id);
  const next = state.cases[idx + 1];
  const finished = nightFinished();
  nextBtn.hidden = !(done && (next || finished));
  delete nextBtn.dataset.action;
  delete nextBtn.dataset.case;
  if (finished) {
    // その晩の5件が全部閉じた。次は退勤
    nextBtn.textContent = '退勤する';
    nextBtn.dataset.action = 'end-night';
  } else if (next) {
    nextBtn.textContent = '次の検体へ';
    nextBtn.dataset.case = next.id;
  }

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
  // スマホ縦では上のバーを一段に詰めるので、名前と内訳は span で括って引っ込められるようにする
  const btn = $('#mentor-btn');
  const name = mentor ? mentor.name : '—';
  btn.innerHTML = `指導役<span class="btn-sub"> ${esc(name)}</span>`;
  btn.setAttribute('aria-label', `指導役 ${name}（変更する）`);
  btn.title = `指導役 ${name}`;

  const tally = { best: 0, ok: 0, poor: 0 };
  for (const r of Object.values(state.results)) tally[r.score] = (tally[r.score] || 0) + 1;
  const total = Object.keys(state.results).length;
  $('#score').innerHTML = total
    ? `報告 ${total}件<span class="score-detail"> ／ 最善 ${tally.best}・許容 ${tally.ok}・要改善 ${tally.poor}</span>`
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
  // 画面の外にある的は、見える位置まで寄せてから光らせる。すでに見えているものは動かさない
  // （読んでいる途中で画面が動くほうが分かりにくい）。
  // 貼り付いた上のバー・タブの中の的（「聞く」）は、どこまで送っても見えているので寄せない。
  // 症例0は下に帯があるので上へ寄せる。ナビの「ここ」は画面の真ん中に置く
  const target = targets[0];
  if ($('.topbar')?.contains(target)) return;
  if (pointFitsBand(target.getBoundingClientRect(), visibleBand())) return;
  const banded = document.documentElement.dataset.tutorial === 'open';
  target.scrollIntoView({ block: banded ? 'start' : 'center' });
}

/**
 * いま見えている帯。上は貼り付いた上のバー（スマホではタブも含む）の下、
 * 下は症例0の帯の上まで。
 */
function visibleBand() {
  const topbar = $('.topbar');
  const banner = $('#tutorial-dialog[open]');
  return {
    top: topbar ? topbar.getBoundingClientRect().bottom : 0,
    bottom: banner ? banner.getBoundingClientRect().top : window.innerHeight,
  };
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

    const investigateBtn = ev.target.closest('[data-investigate]');
    if (investigateBtn) {
      investigate(investigateBtn.dataset.investigate);
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
    if (action === 'close-report') {
      sound.stop('dial'); // 電話を切ったら呼出音も止める
      closeReport();
    }
    if (action === 'close-glossary') $('#glossary-dialog').close();
    if (action === 'open-report') openReport();
    if (action === 'open-mentor') openMentorPicker();
    if (action === 'toggle-sound') toggleSound();
    if (action === 'close-mentor') $('#mentor-dialog').close();
    if (action === 'tutorial-next') advanceTutorial();
    if (action === 'ask') ask();
    if (action === 'end-night') endNight();
    if (action === 'next-night') nextNight();
    if (action === 'restart') restart();
    if (action === 'readback') {
      sound.stop('dial');
      sound.play('pickup');
      finishReport({ ...state.pendingChoice, readback: true });
    }
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
      actions: takenActionIds(currentCase().id),
      asked: state.ask[currentCase().id] === 'answered',
    };
    if (choice.level === 'emergency') {
      state.pendingChoice = choice;
      $('#report-body').innerHTML = renderPhone(
        currentCase(), activePanel(), choice, activeAccession(),
      );
      sound.play('dial'); // 呼出音。切るか読み返し確認まで（最大3回）
      return;
    }
    sound.play('send');
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
  $('#glossary-body').innerHTML = renderGlossaryPanel(state.data, state.glossary, sex, {
    // 不在の晩は「項目」の索引を外す。「言葉」と「見る順番」は残す（調べるのが常に損にならない線）
    tests: !state.absentNight,
  });
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

/**
 * 規則で判定するとき（`choices` の無い症例）に渡す材料。
 * 手書き症例では使われない——`evaluate()` が `choices` を先に見る。
 */
function judgeContext(caseDef) {
  const panel = activePanel();
  if (!panel || (caseDef.choices || []).length) return null;
  return {
    data: state.data,
    panel,
    facts: deriveFacts(caseDef, panel, state.data, {
      stage: stageOf(caseDef.id) === 'followup' ? 'followup' : 'first',
    }),
  };
}

/** 共通の台詞に埋める値を、届いた便ごとに控える（生成症例だけ。手書きは values を持たない）。 */
function rememberReviewValues(delivered, res) {
  if (!res.values) return;
  for (const id of delivered) {
    state.reviewValues[id] = { values: res.values, doctorMeta: res.doctorMeta };
  }
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
  sound.play('message');
}

function finishReport(choice) {
  const caseDef = currentCase();
  const followupStage = stageOf(caseDef.id) === 'followup';
  const res = followupStage
    ? evaluateFollowup(caseDef, choice, state.caps[caseDef.id])
    : evaluate(caseDef, choice, judgeContext(caseDef));

  // 差し戻し。症例は閉じず、医師の返信だけ届いて二本目を待つ
  if (res.then === 'followup' && caseDef.followup) {
    state.caps[caseDef.id] = res.cap;
    state.stage[caseDef.id] = 'waiting';
    state.status[caseDef.id] = 'waiting';
    // 講評と医師の返信は同時に届く。一つの組にして、上下が入れ替わらないようにする
    rememberReviewValues(pushGroup([res.messageId, res.doctorId]), res);
    sound.play('message');
    state.pendingChoice = null;
    $('#report-body').innerHTML = renderVerdict(res, choice, state.data);
    renderAll();
    setTimeout(() => deliverFollowup(caseDef.id), FOLLOWUP_DELAY_MS);
    return;
  }

  state.results[caseDef.id] = res;
  state.status[caseDef.id] = 'done';
  // 症例が閉じた。判定の良し悪しでは音を変えない（音で答えが分かるのを避ける）
  setTimeout(() => sound.play('close'), CLOSE_DELAY_MS);
  clearInterrupt(caseDef.id);
  // 報告 → 指導役の講評 → 医師の返信、の順に届く。二本で一つの組にする
  // 不在の晩は講評を出さない（医師の返事だけ。docs/shift.md §3-2）
  rememberReviewValues(
    pushGroup([state.absentNight ? null : res.messageId, res.doctorId]), res,
  );
  // 症例が一件閉じた。最終評価を信頼度の窓に入れる（差し戻しは二本で1回）
  state.nightScores.push(res.score);
  state.shift = { ...state.shift, window: pushScore(state.shift.window, res.score, shiftCfg()) };
  saveNow();

  if (choice.recheck && caseDef.recollect) {
    state.recollected[caseDef.id] = buildRecollect(caseDef, currentPanel(), state.data);
    if (caseDef.recollect.reply) pushMessage(caseDef.recollect.reply);
  }
  state.pendingChoice = null;
  $('#report-body').innerHTML = renderVerdict(res, choice, state.data);
  renderAll();
  // 判定の音と重ならないよう、返信の音だけ少し遅らせる（別の出来事として聞かせる）
  setTimeout(() => sound.play('message'), MESSAGE_DELAY_MS);
}

main();
