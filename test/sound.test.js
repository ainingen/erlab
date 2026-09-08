// 効果音（docs/sound.md）のテスト。実際に鳴らさずに、鳴らし方の約束だけを固定する。
//   ・AudioContext を作っていない（＝解錠していない）あいだは何も起きない
//   ・OFF にしたら何も起きず、localStorage に残る
//   ・音は出来事にだけ付いていて、値の判定（renderAll / evaluate）からは呼ばれない

import { test, eq } from './harness.js';
import { play, stop, isOn, setOn, soundNames } from '../src/sound.js';

const NAMES = ['result', 'message', 'interrupt', 'tap', 'send', 'dial', 'pickup', 'close'];

/** ソースから関数一つぶんの中身を取り出す（波括弧の対応で切る）。 */
function bodyOf(source, name) {
  const at = source.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const from = source.indexOf('{', at);
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return null;
}

export function suite(sources) {
  test('音: 一覧は8本。知らない名前は何もしない（例外にしない）', () => {
    eq(soundNames().join(','), NAMES.join(','));
    play('nope');
    play(undefined);
    stop('nope');
  });

  test('音: 解錠していないあいだは play() が何も起こさない', () => {
    // init() を呼んでいないので AudioContext は無い。テスト中は鳴らない
    const before = isOn();
    for (const name of soundNames()) play(name);
    stop('dial');
    eq(isOn(), before, '再生で ON / OFF は動かない');
  });

  test('音: OFF にすると play() は即戻り、localStorage に残る', () => {
    const saved = localStorage.getItem('erlab.sound');
    try {
      setOn(false);
      eq(isOn(), false);
      eq(localStorage.getItem('erlab.sound'), 'off');
      for (const name of soundNames()) play(name);

      setOn(true);
      eq(isOn(), true);
      eq(localStorage.getItem('erlab.sound'), 'on');
    } finally {
      // テストで遊ぶ人の設定を書き換えたままにしない
      if (saved === null) localStorage.removeItem('erlab.sound');
      else localStorage.setItem('erlab.sound', saved);
    }
  });

  test('音: 値の判定と結び付けない（描画・判定の中から呼ばない）', () => {
    const app = sources.app;
    eq(typeof app, 'string', 'app.js のソース');
    for (const name of ['renderAll', 'renderResults', 'evaluate', 'renderVerdict']) {
      const body = bodyOf(app, name);
      if (!body) continue; // app.js で定義していない関数（import しているだけ）
      eq(body.includes('play('), false, `${name} の中から play() を呼んでいる`);
    }
    // 呼んでいる名前は一覧の8本だけ
    const used = [...app.matchAll(/sound\.play\('([a-z_]+)'\)/g)].map((m) => m[1]);
    eq(used.length > 0, true, 'app.js から音を鳴らしていない');
    for (const name of used) eq(NAMES.includes(name), true, `知らない音 ${name} を鳴らしている`);
  });

  test('音: 鳴らさないものに手を出していない', () => {
    const app = sources.app;
    // フラグ・危険域・辞典・指さしの周りでは鳴らさない
    for (const fn of ['pointAt', 'pointSequence', 'openGlossary', 'showGlossary', 'renderMessagePane']) {
      const body = bodyOf(app, fn);
      if (!body) continue;
      eq(body.includes('play('), false, `${fn} の中から play() を呼んでいる`);
    }
  });
}
