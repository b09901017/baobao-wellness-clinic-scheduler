// 資料健檢的修正：連按、重試都只建一筆（2026-11-05 第一輪小修 02，11/4 全庫健檢 #2）。
//
// 以前「補上二返額度」的 id 在 `opFor()` 裡每跑一次鑄一個新的、「補警示詞」不給 id（自動），
// `applyAndReload()` 的 `withSaveState()` 也沒有 `key` —— 寫入期間再按一次、或 toast 按重試，就多一筆一樣的。
// 而且 `repo.commit()` 的 create 是 `batch.set`：id 一樣也不夠，已經存在就整份覆蓋（createdAt 重設、軟刪除的被救活）。
//
// 判準：同一顆修正按兩次（第二次在第一次還沒寫完、或寫完了還沒重畫）、或第一次寫完了 toast 卻說失敗按重試 ——
// 會不會多一筆、或把第一次那一筆整份蓋掉？確認框講的鏈與寫進去的，是不是同一個 id？
//
// `data/` 那一層 import Firebase，node 跑不起來，所以掃原始碼（同 `health-slot-rewrites.test.js`）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');

/** `function name(` 或 `export async function name(` 到下一個頂層的 `}` */
function bodyOf(src, name) {
  const at = src.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.ok(at >= 0, `找不到 ${name}`);
  return src.slice(at, src.indexOf('\n}\n', at));
}

const DATA = 'public/js/data/health.js';

test('opFor()：不在寫入那一刻鑄 id —— 確認框與寫入、第一次與重試，都是同一個 id', () => {
  const body = bodyOf(read(DATA), 'opFor');
  assert.doesNotMatch(body, /newId\(/);
  for (const kind of ['addFollowup', 'addAlert']) {
    const start = body.indexOf(`if (fix?.kind === '${kind}')`);
    assert.ok(start >= 0, kind);
    assert.match(body.slice(start, body.indexOf('\n  }\n', start)), /id: fix\.id,/, kind);
  }
});

test('id 在掃描時鑄好（run()），applyFixes／確認框沒拿到的才補、補在 fix 身上（重試拿得到同一個）', () => {
  const src = read(DATA);
  assert.match(bodyOf(src, 'run'), /withFixIds\(/);
  assert.match(bodyOf(src, 'applyFixes'), /withFixIds\(fixes\)/);
  assert.match(bodyOf(src, 'previewFollowupChains'), /withFixIds\(fixes\)/);
  const mint = bodyOf(src, 'withFixIds');
  assert.match(mint, /newId\(/);
  // 已經有 id 的不換（不然重試又是一個新的）
  assert.match(mint, /fix\.id/);
});

test('applyFixes()：create 之前先讀那個 id，已經在了就不寫（create 是 batch.set，會整份蓋掉）', () => {
  const body = bodyOf(read(DATA), 'applyFixes');
  const read1 = body.indexOf('notYetWritten(');
  assert.ok(read1 > 0, '要先問 notYetWritten()');
  assert.ok(read1 < body.indexOf('repo.commit('), '讀要在寫之前');
  // 連軟刪除的一起讀：她刪掉的那一筆不可以被重試救活
  assert.match(bodyOf(read(DATA), 'notYetWritten'), /repo\.listWithDeleted\(/);
});

test('健檢那條鏈：補完之後的額度照 id 去重（重試時同一筆不可以算兩份）', () => {
  const src = read(DATA);
  assert.doesNotMatch(src, /\(list\) => \[\.\.\.list, \.\.\.added\]/);
  for (const name of ['applyFixes', 'previewFollowupChains']) {
    assert.match(bodyOf(src, name), /withAdded\(/, name);
  }
});

test('畫面：applyAndReload() 的 withSaveState 帶 key（寫入期間再按一次接到同一趟）', () => {
  const body = bodyOf(read('public/js/ui/views/health.js'), 'applyAndReload');
  assert.match(body, /withSaveState\(\(\) => healthData\.applyFixes\(fixes\), \{[\s\S]*?key:/);
});

test('save-guards 認得 applyFixes（下一個沒帶 key 的會紅）', () => {
  assert.match(read('tests/save-guards.test.js'), /const CREATES = .*applyFixes/);
});
