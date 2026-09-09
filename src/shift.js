// シフト制と信頼度（docs/shift.md。roadmap 1章・進め方 5）。
// 1周＝一晩。5件流して退勤、集計。信頼度は累積ではなく直近10件の窓。
//
// ここは DOM にも localStorage にも触らない純関数だけにする（test/shift.test.js から直接読むため）。
// 数字は全部 data/shift.json。この中に書かない。

const SCORES = ['best', 'ok', 'poor'];

/* ---- 信頼度（§2-1） ---- */

/**
 * 窓に一件足す。11件目で先頭が落ちる。
 * 入れるのは**最終評価**（差し戻しの min も、聞いた症例の cap も通したあとの値）。
 */
export function pushScore(window, score, cfg) {
  if (!SCORES.includes(score)) return [...(window || [])];
  const size = cfg.window;
  const next = [...(window || []), score];
  return next.length > size ? next.slice(next.length - size) : next;
}

/** 窓の素点。0 未満と、満点（窓の件数 × best点）超は切る。 */
export function windowPoints(window, cfg) {
  const raw = (window || []).reduce((sum, s) => sum + (cfg.points[s] ?? 0), 0);
  const max = cfg.window * cfg.points.best;
  return Math.min(Math.max(raw, 0), max);
}

/** 画面に出す信頼度（0〜100）。集計のときだけ見せる（§2-3）。 */
export function trust(window, cfg) {
  return windowPoints(window, cfg) * cfg.display_scale;
}

/** その晩の集計。roadmap 1章の形（本日の報告／適切／許容／要改善）。 */
export function summarize(scores) {
  const list = [].concat(scores || []);
  return {
    total: list.length,
    best: list.filter((s) => s === 'best').length,
    ok: list.filter((s) => s === 'ok').length,
    poor: list.filter((s) => s === 'poor').length,
  };
}

/* ---- 指導役不在の晩（§3） ---- */

/**
 * 次の晩は指導役が休みか。
 *   shift = { window, forceMentorNight }
 * `forceMentorNight` は「不在の晩で要改善が出た」ときに立つ。
 * その翌晩は信頼度が閾値以上でも指導役の晩にする（最低1晩は隣にいる。§3-3）。
 */
export function isAbsentNight(shift, cfg) {
  if (shift && shift.forceMentorNight) return false;
  return trust((shift && shift.window) || [], cfg) >= cfg.absent_threshold;
}

/**
 * 一晩終わったときの、次の晩に向けた状態の更新。窓はここでは動かさない
 * （症例を閉じるたびに `pushScore` で入っている。二重に下げない。§3-3）。
 */
export function closeNight(shift, { absent = false, scores = [] } = {}, cfg) {
  const tally = summarize(scores);
  const clearedNow = absent && tally.total > 0 && tally.poor === 0;
  const next = {
    ...shift,
    night: (shift.night || 1) + 1,
    cleared: Boolean(shift.cleared) || clearedNow,
    // 不在の晩で要改善が出たら、次の晩は指導役を戻す
    forceMentorNight: absent && tally.poor > 0,
  };
  return { shift: next, tally, clearedNow, absentFailed: absent && tally.poor > 0, cfg };
}

/* ---- 症例の供給（§4） ---- */

/** 晩の番号を種にした乱数。同じ晩は同じ5件（再現できるように）。 */
export function rngFrom(seed) {
  let x = (Number(seed) || 0) * 2654435761 % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

/**
 * その晩に流す症例のID。生成症例（`choices` の無いもの）を必ず1件、残りは手書きから重複なしで。
 *   pool … 症例の配列（`data.cases` そのまま）
 * プールが厚くなったら（進め方 6）、ここの中身だけ替える。
 */
export function pickNightCases(night, pool, cfg) {
  const size = cfg.cases_per_night;
  const generated = pool.filter((c) => !(c.choices || []).length).map((c) => c.id);
  const written = pool.filter((c) => (c.choices || []).length).map((c) => c.id);
  const rng = rngFrom(night);
  const picked = [];
  if (generated.length) picked.push(generated[Math.floor(rng() * generated.length)]);
  const rest = shuffle(written.filter((id) => !picked.includes(id)), rng);
  for (const id of rest) {
    if (picked.length >= size) break;
    picked.push(id);
  }
  // 手書きが足りなければ生成でうめる（プールが薄い間の保険）
  for (const id of shuffle(generated, rng)) {
    if (picked.length >= size) break;
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}

function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** シフトの受付時刻。出勤から一定間隔で引き直して見せる（症例JSONは触らない）。 */
export function nightReceivedAt(index, cfg) {
  return addMinutes(cfg.night_start, cfg.case_interval_min * index);
}

function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm ?? '0:00').split(':').map((x) => Number(x) || 0);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/* ---- 集計の見た目（§1） ---- */

const SCORE_ROW = [['best', '適切'], ['ok', '許容'], ['poor', '要改善']];

/**
 * 集計の本文。等幅の枡にそのまま流す（別UIを作らない。design.md）。
 * before が null（最初の晩）なら「— → 45」の形。
 */
export function summaryBody(tally, before, after) {
  return [
    `本日の報告  ${tally.total}件`,
    ...SCORE_ROW.map(([id, label]) => `　　${label}　　${String(tally[id]).padStart(2, ' ')}件`),
    `医師からの信頼度  ${before === null || before === undefined ? '—' : before} → ${after}`,
  ];
}

/* ---- 保存（§5。読み書きの入口だけ。実際の localStorage は app.js） ---- */

/** 保存する形。窓と晩の番号と、クリア済みの印と、選んだ指導役だけ。 */
export function toSave(shift, mentorId) {
  return {
    night: shift.night || 1,
    window: [...(shift.window || [])],
    cleared: Boolean(shift.cleared),
    forceMentorNight: Boolean(shift.forceMentorNight),
    mentor: mentorId || null,
  };
}

/** 読んだものを整える。壊れていたら最初から（例外は投げない）。 */
export function fromSave(raw, cfg) {
  const save = raw && typeof raw === 'object' ? raw : {};
  const window = Array.isArray(save.window)
    ? save.window.filter((s) => SCORES.includes(s)).slice(-cfg.window) : [];
  return {
    shift: {
      night: Number.isInteger(save.night) && save.night > 0 ? save.night : 1,
      window,
      cleared: Boolean(save.cleared),
      forceMentorNight: Boolean(save.forceMentorNight),
    },
    mentorId: typeof save.mentor === 'string' ? save.mentor : null,
  };
}

/** 何も無いところから始める形。 */
export function newShift() {
  return { night: 1, window: [], cleared: false, forceMentorNight: false };
}
