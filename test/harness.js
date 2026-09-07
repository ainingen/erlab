// テスト用の最小の道具。依存ライブラリを増やしたくないので自前で持つ。

export const results = [];

export function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}

export function eq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label || '値'}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  }
}

export function close(actual, expected, tol, label = '') {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > tol) {
    throw new Error(`${label || '値'}: 期待 ${expected}±${tol} / 実際 ${actual}`);
  }
}
