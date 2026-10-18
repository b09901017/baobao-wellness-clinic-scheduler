// `ui/views.js` 只多了一頁的登記（import ＋ register）時，`--related` 不要退回全跑
// （staging-polish 中途發現「段二 2」）。
//
// `views.js` 是共用底座（`related.js` 的 GLOBAL）：它壞了每一頁都進不去。但一輪裡新增一頁
// 只是多兩三行，以前每一段的 verify 都因為那兩三行全跑 47 支、30 分鐘以上。
//
// 判準照舊是**寧可多跑、不可安靜地少跑**：刪掉或改到既有的任何一行、加了認不得的東西 → 照舊全跑。
// 新的那一條網址撞得到既有的哪一條（同段數、每一格都相等或其中一邊是參數），那一條的頁面也要跑 ——
// 新的那一條先比到就會搶走它的網址。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { narrowViews, VIEWS } from '../scripts/e2e-changes.mjs';
import { pick } from '../tests-e2e/related.js';
import { fromRoot } from './helpers/paths.js';

const SOURCE = readFileSync(fromRoot(VIEWS), 'utf8');

/** 一份 `git diff -U0` 的樣子。 */
const diffOf = (...hunks) => [
  `diff --git a/${VIEWS} b/${VIEWS}`,
  'index 3eb5bba..4a1e3c5 100644',
  `--- a/${VIEWS}`,
  `+++ b/${VIEWS}`,
  ...hunks.flatMap(([at, lines]) => [`@@ ${at} @@`, ...lines]),
].join('\n');

// 這一輪（staging-polish）真的長出來的那一份：兩頁、一條帶參數的網址、夾著註解
const THIS_ROUND = diffOf(
  ['-8,0 +9 ', ["+import * as todoRows from './views/todoRows.js';"]],
  ['-26,0 +28 ', ["+import * as longNotes from './views/longNotes.js';"]],
  ['-54,0 +57,6 ', [
    '+// 長備註：全部的人的，一疊左右滑的卡（ADR-0156）。',
    "+register('/customers/notes', { title: '長備註', nav: false, render: longNotes.render });",
    "+register('/customers/notes/:key', {",
    "+  title: '長備註', nav: false,",
    '+  render: (el, key) => longNotes.render(el, key),',
    '+});',
  ]],
  ['-111,0 +120 ', ["+register('/settings/todo-rows', { title: '待辦首頁', nav: false, render: todoRows.render });"]],
);

test('只多了 import 與 register：換成那幾頁，加上網址撞得到的既有那幾頁', () => {
  const files = narrowViews(THIS_ROUND, SOURCE);
  assert.ok(files, '應該認得出來');
  for (const f of ['public/js/ui/views/longNotes.js', 'public/js/ui/views/todoRows.js']) {
    assert.ok(files.includes(f), `少了 ${f}`);
  }
  // `/customers/notes` 撞得到 `/customers/:id`；`/customers/notes/:key` 撞得到 `/customers/:id/bought`
  assert.ok(files.includes('public/js/ui/views/customerDetail.js'));
  assert.ok(files.includes('public/js/ui/views/bought.js'));
  // `/settings/todo-rows` 撞得到 `/settings/:type`（設定的主檔清單）
  assert.ok(files.includes('public/js/ui/views/masterList.js'));
  // 撞不到的不跑
  assert.ok(!files.includes('public/js/ui/views/calendar.js'));
  assert.ok(!files.includes(VIEWS));
});

test('拿那一份去問 pick()：不是全跑，而且有那兩頁的 spec', () => {
  const r = pick(narrowViews(THIS_ROUND, SOURCE));
  assert.equal(r.all, false, r.why.join('、'));
  assert.ok(r.specs.includes('74-long-notes'));
  assert.ok(r.specs.includes('70-todo-home'));
});

test('刪掉或改到既有的一行 → 認不出來（照舊全跑）', () => {
  const changed = diffOf(['-33 +33 ', [
    "-register('/', { title: '待辦', icon: 'todo', render: home.render });",
    "+register('/', { title: '今天', icon: 'todo', render: home.render });",
  ]]);
  assert.equal(narrowViews(changed, SOURCE), null);
});

test('多了 register 以外的程式 → 認不出來', () => {
  for (const line of [
    "+const extra = 1;",
    "+import { foo } from '../domain/masterData.js';",
    "+register('/x', { title: 'x', render: (el) => { el.innerHTML = ''; } });",
  ]) {
    assert.equal(narrowViews(diffOf(['-1,0 +2 ', [line]]), SOURCE), null, line);
  }
});

test('register 裡用到一個認不得的名字 → 認不出來', () => {
  const d = diffOf(['-1,0 +2 ', ["+register('/x', { title: 'x', render: somewhere.render });"]]);
  assert.equal(narrowViews(d, SOURCE), null);
});

test('只多了註解 → 一頁都不用多跑', () => {
  assert.deepEqual(narrowViews(diffOf(['-1,0 +2 ', ['+// 一行註解', '+']]), SOURCE), []);
});

test('空的 diff（沒動）→ 一頁都不用多跑', () => {
  assert.deepEqual(narrowViews('', SOURCE), []);
});

test('register 的物件裡有一段程式（有 ; 或 {）→ 認不出來', () => {
  const d = diffOf(['-1,0 +2 ', ["+register('/x', { title: 'x', render: () => { home.render(); } });"]]);
  assert.equal(narrowViews(d, SOURCE), null);
});
