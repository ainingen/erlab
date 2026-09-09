// JSONの読み込みだけを担当する。パス解決は import.meta.url 基準にして、
// 置き場所が変わっても壊れないようにする。

const ROOT = new URL('../', import.meta.url);

async function readJson(relativePath) {
  const url = new URL(relativePath, ROOT);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`読み込み失敗: ${relativePath} (${res.status})`);
  return res.json();
}

import { buildDefaultAskMessages } from './messages.js';

export async function loadData() {
  const [
    tests, hospital, conditions, artifacts, caseIndex, messages, mentors, tutorial, suspects,
    glossary, commentTemplates,
  ] = await Promise.all([
      readJson('data/tests.json'),
      readJson('data/hospital.json'),
      readJson('data/conditions.json'),
      readJson('data/artifacts.json'),
      readJson('data/cases/index.json'),
      readJson('data/messages/rookie.json'),
      readJson('data/mentors.json'),
      readJson('data/tutorial.json'),
      readJson('data/suspects.json'),
      readJson('data/glossary.json'),
      readJson('data/comment_templates.json'),
    ]);

  const cases = await Promise.all(
    caseIndex.rookie.map((id) => readJson(`data/cases/${id}.json`)),
  );

  // 「聞く」の既定の台詞は索引の「見る順番」から組む。症例に書かなくても出せるようにして、
  // 生成症例に台詞を持たせない（docs/investigate.md §8）
  Object.assign(messages.messages, buildDefaultAskMessages(glossary));

  return {
    tests, hospital, conditions, artifacts, messages, mentors, tutorial, suspects, glossary,
    commentTemplates, cases,
  };
}
