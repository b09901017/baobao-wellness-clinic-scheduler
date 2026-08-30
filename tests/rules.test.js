// Firestore Rules 的靜態守衛。
//
// Rules 沒辦法在這裡真的執行（那要 Emulator），但「忘記幫新的集合開洞」
// 這一類錯誤是靜態就看得出來的，而且它的症狀特別糟：程式碼完全正確、
// 測試全綠，只有在真的裝置上才會看到「Missing or insufficient permissions」，
// 而那句話還會讓人以為是帳號沒進白名單。
//
// CLAUDE.md 的「容易漏掉的連動」列了這一條，這裡把它變成會紅的測試。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENTITLEMENT_TYPES } from '../public/js/domain/entitlements.js';
import { fromRoot } from './helpers/paths.js';

const ROOT = fromRoot();
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const DATA_DIR = join(ROOT, 'public/js/data');

const dataSources = () =>
  readdirSync(DATA_DIR)
    .filter((n) => n.endsWith('.js'))
    .map((n) => [n, readFileSync(join(DATA_DIR, n), 'utf8')]);

test('每個頂層集合都在 Rules 裡有 match', () => {
  const missing = [];
  for (const [name, src] of dataSources()) {
    for (const m of src.matchAll(/^const (?:TASK_)?PATH = '([^'/]+)';/gm)) {
      const collection = m[1];
      if (!RULES.includes(`match /${collection}/`)) missing.push(`${name} → ${collection}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `這些集合沒有 Rules，預設全拒會讓整頁讀不到：\n${missing.join('\n')}`,
  );
});

test('collection group 查詢要用遞迴萬用路徑另外開一條', () => {
  // 具體路徑的 match（例如 /customers/{id}/entitlements/{id}）不會授權
  // collectionGroup 查詢，這是 Firestore 的規定，不是這個專案的選擇。
  const missing = [];
  for (const [name, src] of dataSources()) {
    for (const m of src.matchAll(/listGroup\(\s*'([^']+)'/g)) {
      const group = m[1];
      const pattern = new RegExp(`match /\\{[A-Za-z]+=\\*\\*\\}/${group}/`);
      if (!pattern.test(RULES)) missing.push(`${name} → ${group}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `這些 collection group 查詢會被 Rules 擋下來：\n${missing.join('\n')}`,
  );
});

test('額度的型態白名單要跟 domain 那一份對得上', () => {
  // 兩份白名單（domain 的 validateEntitlement() 與 Rules 的 validEntitlement()）
  // 漏掉一種的症狀是：程式完全正確、測試全綠，只有在真的裝置上按下「加購」
  // 才會看到「Missing or insufficient permissions」。見 ADR-0057。
  const m = RULES.match(/d\.type in \[([^\]]+)\]/);
  assert.ok(m, 'firestore.rules 裡找不到額度型態的白名單');

  const allowed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(
    [...allowed].sort(),
    [...ENTITLEMENT_TYPES].sort(),
    `Rules 收的是 ${allowed.join('、')}，domain 寫的是 ${ENTITLEMENT_TYPES.join('、')}`,
  );
});
