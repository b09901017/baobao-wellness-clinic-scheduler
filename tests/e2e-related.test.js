// `tests-e2e/related.js` 那份對照表的兩道守衛。
//
// 那份表是「哪些原始碼對應哪一支 E2E」的第二個記錄點，而它爛掉的症狀
// 最壞的一種是安靜的：**新增一支 spec 忘了登記**，於是它在日常驗收裡
// 從來沒被挑到過，只有 CI 全跑時才會跑到 —— 而她本機看到的是綠的。
//
// 所以這裡盯兩件事：每一支都登記了、每一條路徑都還在。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { COVERAGE, CORE, GLOBAL, pick } from '../tests-e2e/related.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPEC_DIR = new URL('../tests-e2e/specs/', import.meta.url);

const specNames = readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith('.spec.js'))
  .map((f) => f.replace(/\.(wide\.)?spec\.js$/, ''));

test('每一支 spec 都在對照表裡（或屬於 CORE）', () => {
  const known = new Set([...CORE, ...Object.keys(COVERAGE)]);
  const missing = specNames.filter((n) => !known.has(n));
  assert.deepEqual(
    missing, [],
    `這幾支沒有登記在 tests-e2e/related.js：${missing.join('、')}\n`
    + '沒登記的 spec 在 `npm run test:e2e:related` 裡永遠不會被挑到。',
  );
});

test('對照表裡沒有已經不存在的 spec', () => {
  const actual = new Set(specNames);
  const ghosts = Object.keys(COVERAGE).filter((n) => !actual.has(n));
  assert.deepEqual(ghosts, [], `這幾支已經不在 specs/ 裡了：${ghosts.join('、')}`);
});

test('對照表裡每一條路徑都真的存在', () => {
  const bad = [];
  for (const [spec, paths] of Object.entries(COVERAGE)) {
    for (const p of paths) {
      if (!existsSync(new URL(p, `file://${ROOT.replace(/\\/g, '/')}`))) bad.push(`${spec} → ${p}`);
    }
  }
  assert.deepEqual(
    bad, [],
    `這幾條路徑指到不存在的東西（檔案搬走或改名了）：\n  ${bad.join('\n  ')}`,
  );
});

test('GLOBAL 那幾條也都存在', () => {
  const bad = GLOBAL.filter(
    (p) => !existsSync(new URL(p, `file://${ROOT.replace(/\\/g, '/')}`)),
  );
  assert.deepEqual(bad, [], `GLOBAL 指到不存在的東西：${bad.join('、')}`);
});

test('認不出來的原始碼退回全跑', () => {
  const r = pick(['public/js/domain/一個還沒登記的東西.js']);
  assert.equal(r.all, true);
  assert.equal(r.specs.length, 0);
  assert.match(r.why.join(''), /沒有登記/);
});

test('共用底座退回全跑', () => {
  assert.equal(pick(['tests-e2e/fixtures/app.js']).all, true);
  assert.equal(pick(['public/js/ui/router.js']).all, true);
});

test('文件與單元測試不會觸發任何 E2E（只留 CORE）', () => {
  const r = pick(['docs/adr/0085-editing-a-visit-means-editing-that-slot.md', 'SPEC.md', 'tests/visits.test.js']);
  assert.equal(r.all, false);
  assert.deepEqual(r.specs, [...CORE]);
});

test('firestore.rules 不觸發 E2E，但要提醒跑 rules 測試', () => {
  const r = pick(['firestore.rules']);
  assert.equal(r.all, false);
  assert.equal(r.rules, true);
  assert.deepEqual(r.specs, [...CORE]);
});

test('CORE 永遠在挑出來的名單裡', () => {
  const r = pick(['public/js/domain/naming.js']);
  assert.equal(r.all, false);
  for (const c of CORE) assert.ok(r.specs.includes(c), `${c} 應該永遠在名單裡`);
  assert.ok(r.specs.includes('23-naming-read-first'));
});

test('改到 spec 自己就跑它自己', () => {
  const r = pick(['tests-e2e/specs/22-bulk-cancel.spec.js']);
  assert.equal(r.all, false);
  assert.ok(r.specs.includes('22-bulk-cancel'));
});

// 這兩支以前沒登記，改一行就全跑二十幾分鐘（2026-09-18 審查時補上）
test('「今天做了什麼」的分段與抄字格式那一份有登記，不會退回全跑', () => {
  for (const file of ['public/js/domain/dayReview.js', 'public/js/domain/transcripts.js']) {
    const r = pick([file]);
    assert.equal(r.all, false, r.why.join('、'));
  }
});
