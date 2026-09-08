// 効果音。音声ファイルは置かず、すべてここで合成する（仕様は docs/sound.md）。
// 依存なし。AudioContext のない環境（テスト・古い端末）では全部 no-op。
//
// 音は合図であって情報ではない。色ルールと同じで、切っても同じ判断ができる状態を保つ。
// 鳴らすのは出来事（結果が届いた・メッセージが来た・電話をかけた）だけ。
// 値の重さ（HH / LL・危険域・Δ）にも、判定の良し悪しにも付けない。

const STORAGE_KEY = 'erlab.sound';
const MASTER = 0.3;
// クリックノイズを出さないための立ち上がり・立ち下がり
const ATTACK = 0.005;
const RELEASE = 0.03;

let ctx = null; // 指導役を選ぶタップまで作らない（スマホは最初のタップまで鳴らせない）
let master = null;
let on = readStored();
const live = new Map(); // name → 鳴っている音源。stop() で止める

/* ---- 音の一覧（8本。これ以外の name は no-op） ---- */

const SOUNDS = {
  // 装置の電子音。結果が出た合図
  result: (t) => [
    tone({ type: 'square', freq: 1760, at: t, dur: 0.06 }),
    tone({ type: 'square', freq: 1760, at: t + 0.12, dur: 0.06 }),
  ],
  // 院内メッセージが届いた。二音を上がる形で
  message: (t) => [
    tone({ freq: 880, at: t, dur: 0.08 }),
    tone({ freq: 1320, at: t + 0.08, dur: 0.08 }),
  ],
  // ERの割り込み。message より強いが、点滅と同じで一回だけ。繰り返さない
  interrupt: (t) => [0, 1, 2].map((i) => tone({ type: 'triangle', freq: 1320, at: t + i * 0.2, dur: 0.12 })),
  // マーク・疑い・コメントのタップ。いちばん小さい
  tap: (t) => [tone({ freq: 2000, at: t, dur: 0.015, gain: 0.15 })],
  // 通常・至急の送信。上がる
  send: (t) => [tone({ freq: 660, to: 990, at: t, dur: 0.09 })],
  // 呼出音。1.0秒鳴らして0.5秒休み、最大3回
  dial: (t) => [0, 1, 2].flatMap((i) => {
    const at = t + i * 1.5;
    return [
      tone({ freq: 440, at, dur: 1.0, gain: 0.5 }),
      tone({ freq: 480, at, dur: 1.0, gain: 0.5 }),
    ];
  }),
  // 相手が出た（読み返し確認）。dial を止めてから鳴らす
  pickup: (t) => [tone({ freq: 990, at: t, dur: 0.06 })],
  // 症例が閉じた。send の逆で下がる
  close: (t) => [tone({ freq: 990, to: 660, at: t, dur: 0.09 })],
};

/** 音の名前の一覧。テストと画面から見えるように出しておく。 */
export function soundNames() {
  return Object.keys(SOUNDS);
}

/* ---- ON / OFF ---- */

export function isOn() {
  return on;
}

/**
 * ON / OFF。OFF にしたら鳴っているものを止め、AudioContext も作らない。
 * 覚えておくのは localStorage の erlab.sound（既定は ON）。
 */
export function setOn(value) {
  on = Boolean(value);
  if (!on) stopAll();
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // プライベートモードなどで書けなくてもよい。その場では効いている
  }
  return on;
}

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/* ---- 解錠 ---- */

/**
 * 最初のタップ（指導役を選ぶところ）で呼ぶ。ここで初めて AudioContext を作る。
 * それ以前の play() は黙って捨てる。OFF のときは作らない。
 */
export function init() {
  if (!on || ctx) return Boolean(ctx);
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return false; // AudioContext のない環境。以降も no-op のまま
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    return false;
  }
  return true;
}

/* ---- 鳴らす・止める ---- */

/** 出来事の名前で鳴らす。知らない名前・未解錠・OFF は何もしない（例外にしない）。 */
export function play(name) {
  const build = SOUNDS[name];
  if (!on || !ctx || !build) return;
  if (ctx.state === 'suspended') ctx.resume();
  stop(name);
  const at = ctx.currentTime + 0.01;
  const nodes = build(at).filter(Boolean);
  live.set(name, nodes);
}

/** 鳴らしっぱなしのもの（dial）を止める。鳴っていなければ何もしない。 */
export function stop(name) {
  const nodes = live.get(name) || [];
  for (const node of nodes) {
    try {
      node.stop();
    } catch {
      // すでに終わっている音源。止め直す必要はない
    }
  }
  live.delete(name);
}

function stopAll() {
  for (const name of [...live.keys()]) stop(name);
}

/**
 * 単音。freq から to へ動かすこともできる。
 * gain は master（0.3）に対する割合。エンベロープはアタック5ms・リリース30ms。
 * 15ms の tap だけは音より長いリリースにならないよう、長さで頭打ちにする。
 */
function tone({ type = 'sine', freq, to = null, at, dur, gain = 1 }) {
  if (!ctx) return null;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== null) osc.frequency.linearRampToValueAtTime(to, at + dur);

  const release = Math.min(RELEASE, dur);
  const attack = Math.min(ATTACK, dur / 2);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + attack);
  env.gain.setValueAtTime(gain, at + dur);
  env.gain.linearRampToValueAtTime(0, at + dur + release);

  osc.connect(env);
  env.connect(master);
  osc.start(at);
  osc.stop(at + dur + release + 0.01);
  return osc;
}
