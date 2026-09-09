// 講評の共通化（docs/review-common.md）のテスト。
// 共通の台詞がそろっているか、置き場所が埋まるか、医師の返事の行と列が表どおりか。

import { test, eq } from './harness.js';
import {
  buildReview, fillPlaceholders, fillMessage, holdColumn, doctorFrom, hasSampleNote, addMinutes,
} from '../src/review.js';
import { deriveFacts, judge, bestOperation, correctOperation } from '../src/judge.js';
import { buildPanel } from '../src/derive.js';

const DEVIATIONS = [
  'best',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8',
  'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'O9', 'O10', 'O11',
];
const MENTORS = ['kanae', 'yusuke'];
const DOCTOR_ROWS = {
  routine: ['routine', 'urgent', 'emergency', 'recheck'],
  urgent: ['routine', 'urgent', 'emergency', 'recheck'],
  emergency: ['routine', 'urgent', 'emergency', 'recheck'],
  hold_sample: ['stopped', 'note_only', 'leak_recheck', 'leak_silent', 'leak_loud'],
  hold_mismatch: ['stopped', 'note_only', 'leak_recheck', 'leak_silent', 'leak_loud'],
};

/** §3 の表情の対応。危ない向きは serious / alert、呆れ・言いにくい向きは deadpan / troubled。 */
const EMOTION = {
  best: ['praise', 'praise'],
  P1: ['serious', 'serious'], P3: ['serious', 'serious'], P7: ['serious', 'serious'],
  P4: ['alert', 'alert'],
  P2: ['deadpan', 'troubled'], P5: ['deadpan', 'troubled'],
  P6: ['deadpan', 'troubled'], P8: ['deadpan', 'troubled'],
};

const cmt = (id) => ({ id, templateId: id, text: id });
const op = (extra = {}) => ({
  level: 'routine', recheck: false, comment: [], marks: [], suspects: {}, actions: [],
  readback: false, ...extra,
});

/** テスト用の事実。src/judge.js の deriveFacts が返すのと同じ形を手で作る。 */
function makeFacts(partial, data) {
  const base = {
    P: false, A: false, A1: false, A2: false, D: false, M: false, X: false, R: false, N: false,
    key: null, artifactId: null, artifactSuspect: null, flagOf: {},
    commentRules: data.judge.comment_rules,
    panicItems: [], deltaItems: [], flagged: [], moderate: false, firstLevel: null,
  };
  const f = { ...base, ...partial };
  f.type = partial.type || typeOf(f);
  return f;
}
function typeOf(f) {
  if (f.R) return 'T8';
  if (f.M) return 'T7';
  if (f.A2) return f.X ? 'T5' : 'T4';
  if (f.P) return f.A1 ? (f.X ? 'T5' : 'T5b') : 'T3';
  if (f.D) return 'T6';
  if (f.A1) return 'T2';
  return f.moderate ? 'T2' : 'T1';
}

/** judge-rules.md §6 の代表10通り＋手書きに無い6行（§7-5）。 */
function shapes(data) {
  return [
    ['T1', { N: true }],
    ['T2', { moderate: true, flagged: ['Hb'], key: 'Hb', flagOf: { Hb: 'L' } }],
    ['T3', { P: true, panicItems: ['K'], flagged: ['K'], key: 'K', flagOf: { K: 'HH' } }],
    ['T4', { P: true, A: true, A2: true, artifactSuspect: 'hemolysis', flagged: ['K'], key: 'K', flagOf: { K: 'HH' } }],
    ['T5', { P: true, A: true, A1: true, X: true, artifactSuspect: 'hemolysis', panicItems: ['K'], flagged: ['K'], key: 'K', flagOf: { K: 'HH' } }],
    ['T5b', { P: true, A: true, A1: true, artifactSuspect: 'hemolysis', panicItems: ['K'], flagged: ['K'], key: 'K', flagOf: { K: 'HH' } }],
    ['T6', { D: true, deltaItems: ['Hb'], flagged: ['Hb'], key: 'Hb', flagOf: { Hb: 'L' } }],
    ['T7', { M: true, D: true, deltaItems: ['Hb'], flagged: ['Hb'], key: 'MCV', flagOf: { Hb: 'L' } }],
    ['T8', { R: true, P: true, panicItems: ['K'], flagged: ['K'], key: 'K', firstLevel: 'emergency', flagOf: { K: 'HH' } }],
    ['A₁とH/L', { A: true, A1: true, artifactSuspect: 'hemolysis', flagged: ['K'], key: 'K', moderate: true, flagOf: { K: 'H' } }],
    ['A₂とD', { A: true, A2: true, D: true, deltaItems: ['K'], artifactSuspect: 'clot', flagged: ['PLT'], key: 'PLT', flagOf: { PLT: 'L' } }],
    ['DとA₁', { D: true, A: true, A1: true, artifactSuspect: 'dilution', deltaItems: ['Hb'], flagged: ['Hb'], key: 'Hb', flagOf: { Hb: 'L' } }],
    ['DかつP', { P: true, D: true, panicItems: ['K'], deltaItems: ['K'], flagged: ['K'], key: 'K', flagOf: { K: 'HH' } }],
    ['Pが二項目', { P: true, panicItems: ['K', 'Na'], flagged: ['K', 'Na'], key: 'K', flagOf: { K: 'HH', Na: 'LL' } }],
  ].map(([label, partial]) => [label, makeFacts(partial, data)]);
}

/** 置き場所が残っていないか。`{` が本文に出たら埋め残し。 */
function unfilled(text) {
  return /\{(key|value|prev|action|level|行動名)\}/.test(String(text ?? ''));
}

export function suite(data) {
  const messages = data.messages.messages;
  const caseById = Object.fromEntries(data.cases.map((c) => [c.id, c]));
  const g01 = caseById.g01;
  const g01Panel = buildPanel(g01, data);
  const g01Facts = deriveFacts(g01, g01Panel, data);
  const ctx = { facts: g01Facts, panel: g01Panel, data };
  const review = (operation) => buildReview(judge(g01Facts, operation), g01, operation, ctx);

  // ---- 1. 講評40本 ----
  test('共通の講評: ずれ20種 × 指導役2人 ＝ 40本ある', () => {
    let count = 0;
    for (const dev of DEVIATIONS) {
      for (const who of MENTORS) {
        const m = messages[`msg_rv_${dev}_${who}`];
        eq(Boolean(m), true, `msg_rv_${dev}_${who} がない`);
        eq(m.kind, 'nav', `${dev} ${who} の kind`);
        eq(m.speaker, who);
        eq(m.subject, '報告のあとで');
        eq(m.time, '—');
        eq(m.repeat, true, `${dev} ${who} は症例をまたいで届く`);
        eq(m.body.length >= 1 && m.body.length <= 3, true, `${dev} ${who} は ${m.body.length} 行`);
        count += 1;
      }
    }
    eq(count, 40);
  });

  test('共通の講評: 表情は §3 の対応どおり。ok は normal', () => {
    for (const dev of DEVIATIONS) {
      const want = EMOTION[dev] || ['normal', 'normal'];
      MENTORS.forEach((who, i) => {
        eq(messages[`msg_rv_${dev}_${who}`].emotion, want[i], `msg_rv_${dev}_${who} の表情`);
      });
    }
  });

  // ---- 2. 医師の返事22本 ----
  test('共通の医師返事: 行×列で22本ある。from・subject・time は書かない', () => {
    let count = 0;
    for (const [row, cols] of Object.entries(DOCTOR_ROWS)) {
      for (const col of cols) {
        const m = messages[`msg_dr_${row}_${col}`];
        eq(Boolean(m), true, `msg_dr_${row}_${col} がない`);
        eq(m.kind, 'reply');
        eq(m.speaker, undefined, `${row}_${col} に speaker がある`);
        eq(m.repeat, true);
        eq(m.from, undefined, `${row}_${col} の from はエンジンが組む`);
        eq(m.subject, undefined, `${row}_${col} の subject はエンジンが組む`);
        eq(m.time, undefined, `${row}_${col} の time はエンジンが組む`);
        count += 1;
      }
    }
    eq(count, 22);
  });

  // ---- 3. 置き場所 ----
  test('共通の台詞: 置き場所は5つだけ。{prev} を含むのは P7・P8 だけ', () => {
    const allowed = new Set(['key', 'value', 'prev', 'action', 'level']);
    const withPrev = [];
    for (const [id, m] of Object.entries(messages)) {
      if (!id.startsWith('msg_rv_') && !id.startsWith('msg_dr_')) continue;
      const text = m.body.join('');
      for (const found of text.match(/\{[^}]*\}/g) || []) {
        const name = found.slice(1, -1);
        eq(allowed.has(name), true, `${id} に知らない置き場所 ${found}`);
      }
      if (text.includes('{prev}')) withPrev.push(id.replace(/_(kanae|yusuke)$/, ''));
    }
    eq([...new Set(withPrev)].sort().join(','), 'msg_rv_P7', '{prev} を使うのは P7 だけ');
  });

  test('fillPlaceholders: 値のあるものだけ埋める。無いものは残す（埋め残しはテストで落とす）', () => {
    eq(fillPlaceholders('{key} {value}', { key: 'K', value: '6.8' }), 'K 6.8');
    eq(fillPlaceholders('前回{prev}が{value}', { prev: '4.6', value: '6.4' }), '前回4.6が6.4');
    eq(fillPlaceholders('{key} {prev}', { key: 'K' }), 'K {prev}', '値が無ければ埋めない');
    // 手書きの見出しに残っている {行動名} は {action} と同じに読む
    eq(fillPlaceholders('ただし{行動名}で裏を取っていません', { action: '電話' }),
       'ただし電話で裏を取っていません');
    eq(fillPlaceholders('{level}報告', { level: '至急' }), '至急報告');
  });

  // ---- 4. 書いてはいけない語 ----
  test('共通の台詞: 病名・患者名・症例番号を書かない', () => {
    const names = Object.entries(data.conditions.conditions)
      .filter(([id]) => id !== 'normal').map(([, c]) => c.label);
    const banned = [...names, '貧血', '炎症', '血症', '感染', '腎不全', '心不全'];
    for (const [id, m] of Object.entries(messages)) {
      if (!id.startsWith('msg_rv_') && !id.startsWith('msg_dr_')) continue;
      const text = m.body.join('');
      for (const word of banned) eq(text.includes(word), false, `${id} に「${word}」がある`);
      eq(/患者[A-Z]|症例[0-9]/.test(text), false, `${id} に患者名か症例番号がある`);
    }
  });

  // ---- 5. 代表の型を全部通す ----
  test('buildReview: §6 の代表の型で、見出し・講評・医師返事が全部埋まる', () => {
    for (const [label, facts] of shapes(data)) {
      const panel = { rows: [{ id: facts.key, display: '9.9', previousDisplay: '1.1' }] };
      const context = { facts, panel, data };
      const cases = [
        ['best', bestOperation(facts)],
        ['poor', op({ level: 'routine', recheck: true })],
        ['ok', { ...bestOperation(facts), actions: [], comment: [] }],
      ];
      for (const [kind, operation] of cases) {
        const res = buildReview(judge(facts, operation), g01, operation, context);
        eq(unfilled(res.headline), false, `${label}/${kind} の見出しに埋め残し: ${res.headline}`);
        eq(res.reply.length, 2, `${label}/${kind} の講評が2本でない`);
        for (const id of res.reply) {
          eq(Boolean(messages[id]), true, `${label}/${kind} の ${id} がない`);
          // 出す本文に埋め残しは残らない（残る行は落ちる）
          const shown = fillMessage(messages[id], res.values);
          if (shown) for (const line of shown.body) {
            eq(unfilled(line), false, `${label}/${kind} の ${id} に埋め残し: ${line}`);
          }
        }
        eq(Boolean(messages[res.doctor]), true, `${label}/${kind} の医師返事 ${res.doctor} がない`);
        const doctorShown = fillMessage(messages[res.doctor], res.values);
        eq(Boolean(doctorShown), true, `${label}/${kind} の医師返事が丸ごと落ちている`);
        for (const line of doctorShown.body) {
          eq(unfilled(line), false, `${label}/${kind} の ${res.doctor} に埋め残し: ${line}`);
        }
      }
    }
  });

  test('埋め残しの残った行は出さない（フラグが一つも無い検体の best だけ当たる）', () => {
    const normal = makeFacts({ N: true }, data); // 鍵の項目が無い
    eq(normal.key, null);
    const res = buildReview(judge(normal, bestOperation(normal)), g01, bestOperation(normal),
      { facts: normal, panel: { rows: [] }, data });
    eq(res.reply.join(','), 'msg_rv_best_kanae,msg_rv_best_yusuke', 'IDは返る');
    eq(fillMessage(messages.msg_rv_best_kanae, res.values), null, '{key} を名指せないので出さない');
    // 鍵の項目があるときは、そのまま出る
    const withKey = makeFacts({ N: true, key: 'CRP', flagged: ['CRP'], flagOf: { CRP: 'H' } }, data);
    const ok = buildReview(judge(withKey, bestOperation(withKey)), g01, bestOperation(withKey),
      { facts: withKey, panel: { rows: [{ id: 'CRP', display: '0.42', previousDisplay: '—' }] }, data });
    eq(fillMessage(messages.msg_rv_best_kanae, ok.values).body[0], 'ん、いいね。CRP、ちゃんと見えてた。');
  });

  // ---- 6. hold_* の列 ----
  test('医師の返事: 値を止める型の5列が、5-1 の条件表どおりに分かれる', () => {
    eq(holdColumn(op({ level: 'routine', recheck: true }), false), 'stopped');
    eq(holdColumn(op({ level: 'urgent', recheck: true }), true), 'stopped', '至急でも note があれば止まった');
    eq(holdColumn(op({ level: 'urgent' }), true), 'note_only');
    eq(holdColumn(op({ level: 'urgent', recheck: true }), false), 'leak_recheck');
    eq(holdColumn(op({ level: 'routine' }), false), 'leak_silent');
    eq(holdColumn(op({ level: 'emergency' }), false), 'leak_loud');
  });

  test('医師の返事: note は検体トラブルか取り違えのコメント（judge.json の comment_rules から引く）', () => {
    eq(hasSampleNote(op({ comment: [cmt('hemolysis')] }), data), true);
    eq(hasSampleNote(op({ comment: [cmt('sample_state')] }), data), true);
    eq(hasSampleNote(op({ comment: [cmt('mismatch')] }), data), true);
    eq(hasSampleNote(op({ comment: [cmt('microcytic')] }), data), false);
    eq(hasSampleNote(op({ comment: [] }), data), false);
    // 項目付きのID（`hemolysis:K`）でも引ける
    eq(hasSampleNote(op({ comment: [{ id: 'hemolysis:K', templateId: 'hemolysis' }] }), data), true);
  });

  // ---- 7. O1 の上書き ----
  test('医師の返事: O1 のときだけ既存の共通返信を使う', () => {
    const off = review(op({ level: 'urgent', comment: [cmt('mismatch')], marks: ['WBC'], suspects: { WBC: ['delta'] }, actions: ['idcheck'] }));
    eq(off.doctor, 'msg_comment_off', 'O1 で表を引いている');
    const offEmergency = review(op({ level: 'emergency', comment: [cmt('mismatch')] }));
    eq(offEmergency.doctor, 'msg_comment_off_emergency');
    for (const id of ['msg_comment_off', 'msg_comment_off_emergency']) {
      eq(messages[id].repeat, true, `${id} は症例をまたいで届く`);
    }
  });

  // ---- 8. 差出人 ----
  test('医師の返事: 差出人は依頼元から組む', () => {
    eq(doctorFrom('ER'), 'ER 当直医');
    eq(doctorFrom('消化器内科病棟'), '消化器内科 担当医');
    eq(doctorFrom('内科外来'), '内科 担当医');
    eq(doctorFrom('整形外科病棟'), '整形外科 担当医');
    eq(doctorFrom('呼吸器内科病棟'), '呼吸器内科 担当医');
  });

  test('医師の返事: 件名と時刻は受付から組む。数字は common.json の _doctor_time', () => {
    const times = data.messages._doctor_time;
    eq(typeof times.emergency, 'number');
    eq(typeof times.late, 'number');
    eq(typeof times.next_day, 'string');
    eq(addMinutes('15:10', times.urgent), '15:25');
    const best = review(bestOperation(g01Facts));
    eq(best.doctorMeta.from, '呼吸器内科 担当医');
    eq(best.doctorMeta.subject, 'Re: 至急連絡（P-0011）');
    eq(best.doctorMeta.time, addMinutes('15:10', times.urgent));
    // 再採血の依頼だけが届いた形は件名も時刻も別
    const only = review(op({ level: 'routine', recheck: true, marks: ['WBC'], suspects: { WBC: ['delta'] } }));
    eq(only.doctorMeta.subject, 'Re: 再採血の依頼（P-0011）');
    eq(only.doctorMeta.time, addMinutes('15:10', times.recheck));
  });

  // ---- 9. g01 ----
  test('g01: choices を持たず、事実は D あり・M なし・A なし', () => {
    eq(g01.choices, undefined, 'g01 に choices が書いてある');
    eq(g01Facts.D, true);
    eq(g01Facts.M, false);
    eq(g01Facts.A, false);
    eq(g01Facts.P, false);
    eq(g01Facts.type, 'T6');
    eq(g01Facts.key, 'WBC', 'Δ の項目が鍵');
    eq(g01Facts.deltaItems.join(','), 'WBC', 'Δ は一項目だけ（二項目あると向きで M が立つ）');
    const correct = correctOperation(g01Facts);
    eq(correct.level, 'urgent');
    eq(correct.recheck, false);
    eq(correct.comment, true);
    eq(correct.marks.join(','), 'WBC');
    eq(correct.suspects.WBC.join(','), 'delta');
    eq(correct.actions.join(','), 'idcheck');
    eq(judge(g01Facts, bestOperation(g01Facts)).score, 'best', 'best の操作が一意に決まる');
  });

  test('g01: 報告のあとに届く三つが、症例に台詞を書かずに組める', () => {
    const best = review(bestOperation(g01Facts));
    eq(best.reply.join(','), 'msg_rv_best_kanae,msg_rv_best_yusuke');
    eq(best.doctor, 'msg_dr_urgent_urgent');
    eq(best.values.key, 'WBC');
    eq(best.values.value, '12.9');
    eq(best.values.prev, '6.2');
    eq(best.values.level, '至急');

    // 行動が欠けた（O4）ときだけ {action} が入る
    const noAction = review({ ...bestOperation(g01Facts), actions: [] });
    eq(noAction.reply[0], 'msg_rv_O4_kanae');
    eq(noAction.values.action, 'ID照合');
    eq(noAction.headline, '判断は適切。ただしID照合で裏を取っていません');

    // 通常報告で流したら P7。医師は遅れて気づく列
    const missed = review(op({ level: 'routine' }));
    eq(missed.reply[0], 'msg_rv_P7_kanae');
    eq(missed.doctor, 'msg_dr_urgent_routine');
    eq(missed.doctorMeta.time, addMinutes('15:10', data.messages._doctor_time.late));
  });

  // ---- 10. 手書きは触っていない ----
  test('手書き症例は共通の台詞を使わない（choices の reply / doctor のまま）', () => {
    for (const c of data.cases.filter((x) => (x.choices || []).length)) {
      for (const branch of [...c.choices, ...((c.followup && c.followup.choices) || [])]) {
        for (const id of [].concat(branch.reply ?? [])) {
          eq(id.startsWith('msg_rv_'), false, `${c.id} が共通の講評を使っている`);
        }
        eq(String(branch.doctor).startsWith('msg_dr_'), false, `${c.id} が共通の医師返事を使っている`);
      }
    }
  });

  test('共通の台詞は common.json にあり、rookie.json には無い', () => {
    eq(Object.keys(data.messagesRookie || {}).length, 0, '（読み込みの形が変わったら直す）');
    for (const dev of DEVIATIONS) {
      eq(Boolean(messages[`msg_rv_${dev}_kanae`]), true);
    }
  });
}
