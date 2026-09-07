// JSONの読み込みだけを担当する。パス解決は import.meta.url 基準にして、
// 置き場所が変わっても壊れないようにする。

const ROOT = new URL('../', import.meta.url);

async function readJson(relativePath) {
  const url = new URL(relativePath, ROOT);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`読み込み失敗: ${relativePath} (${res.status})`);
  return res.json();
}

export async function loadData() {
  const [tests, hospital, conditions, artifacts, caseIndex, messages] = await Promise.all([
    readJson('data/tests.json'),
    readJson('data/hospital.json'),
    readJson('data/conditions.json'),
    readJson('data/artifacts.json'),
    readJson('data/cases/index.json'),
    readJson('data/messages/rookie.json'),
  ]);

  const cases = await Promise.all(
    caseIndex.rookie.map((id) => readJson(`data/cases/${id}.json`)),
  );

  return { tests, hospital, conditions, artifacts, messages, cases };
}
