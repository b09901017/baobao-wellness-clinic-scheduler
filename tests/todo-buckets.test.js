// 待辦首頁的三顆數字：逾期／今天／明天（staging-polish 08，ADR-0152）。
//
// 她：「"今天，明天"的數字為甚麼沒有包含到簽療程單……在日曆綁定當天的todo，好像都沒算進去……
// 如果在日曆綁定當天的todo今天沒勾也沒關係，他不算逾期」；前幾天沒簽完的療程單「算逾期」。
// 首頁的數字與點進去那一頁的清單讀同一支 —— 不然數字跟清單會差一件。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { todoBuckets, bucketCount, taskBucket } from '../public/js/domain/todoFlow.js';
import { visitsToClose } from '../public/js/domain/visits.js';

const TODAY = '2026-10-18';
const YESTERDAY = '2026-10-17';
const TOMORROW = '2026-10-19';

const openVisit = (id, date) => ({
  id, date, customerId: id, customerName: id, status: 'confirmed',
  slots: [{ courseId: 'c', status: 'confirmed', startsAt: '10:00', endsAt: '11:00' }],
});
const note = (id, date, extra = {}) => ({ id, text: id, date, done: false, ...extra });

const judged = () => todoBuckets({
  today: TODAY,
  tasks: [{ id: 't-ex', kind: 'Examine', dueDate: TODAY }],
  unclosed: [openVisit('v-today', TODAY), openVisit('v-yday', YESTERDAY)],
  notes: [
    note('n-today', TODAY),
    note('n-today-done', TODAY, { done: true }),
    note('n-tomorrow', TOMORROW),
    note('n-yday', YESTERDAY),
    note('n-nodate', null),
    note('n-deleted', TODAY, { deletedAt: '2026-10-18T01:00:00Z' }),
  ],
});

test('issue 08 的判準：逾期 1、今天 3、明天 1', () => {
  const b = judged();
  assert.equal(bucketCount(b.overdue), 1);
  assert.equal(bucketCount(b.today), 3);
  assert.equal(bucketCount(b.tomorrow), 1);
  assert.deepEqual(b.overdue.close.map((v) => v.id), ['v-yday']);
  assert.deepEqual(b.today.close.map((v) => v.id), ['v-today']);
  assert.deepEqual(b.today.tasks.map((t) => t.id), ['t-ex']);
  assert.deepEqual(b.today.notes.map((n) => n.id), ['n-today']);
  assert.deepEqual(b.tomorrow.notes.map((n) => n.id), ['n-tomorrow']);
});

test('掛昨天、沒勾的隨手記哪一格都不在（她：「他不算逾期」）', () => {
  const b = judged();
  for (const k of ['overdue', 'today', 'tomorrow']) {
    assert.ok(!b[k].notes.some((n) => n.id === 'n-yday'), k);
  }
});

// issue 11（ADR-0162，推翻 ADR-0152 那一格）：她：「但我想要今天和明天是一樣的誒，就是納入簽療程單」。
// 明天的那幾天另外放一格（`coming`）—— 點下去開讀取卡片，**不開簽單抽屜**（人還沒來）。
test('明天那一格也算明天要簽的療程單，一位一天一件；但不進 close（不能簽）', () => {
  const twoSlots = {
    ...openVisit('v-tom-b', TOMORROW),
    slots: [
      { courseId: 'c', status: 'pending_confirm', startsAt: '10:00', endsAt: '11:00' },
      { courseId: 'c', status: 'confirmed', startsAt: '13:00', endsAt: '14:00' },
    ],
  };
  const b = todoBuckets({ today: TODAY, unclosed: [openVisit('v-tom-a', TOMORROW), twoSlots] });
  assert.equal(bucketCount(b.tomorrow), 2);
  assert.deepEqual(b.tomorrow.coming.map((v) => v.id), ['v-tom-a', 'v-tom-b']);
  for (const k of ['overdue', 'today', 'tomorrow']) assert.equal(b[k].close.length, 0, k);
});

test('明天整天取消、或每一段都取消了 → 不算；後天的也不算', () => {
  const cancelled = { ...openVisit('v-c', TOMORROW), status: 'cancelled',
    slots: [{ courseId: 'c', status: 'cancelled' }] };
  const later = openVisit('v-later', '2026-10-20');
  const b = todoBuckets({ today: TODAY, unclosed: [cancelled, later] });
  assert.equal(bucketCount(b.tomorrow), 0);
});

test('加了明天那幾天，今天與逾期的數字一個都不變', () => {
  const before = judged();
  const after = todoBuckets({
    today: TODAY,
    tasks: [{ id: 't-ex', kind: 'Examine', dueDate: TODAY }],
    unclosed: [openVisit('v-today', TODAY), openVisit('v-yday', YESTERDAY), openVisit('v-tom', TOMORROW)],
    notes: [note('n-today', TODAY), note('n-tomorrow', TOMORROW)],
  });
  assert.equal(bucketCount(after.overdue), bucketCount(before.overdue));
  assert.equal(bucketCount(after.today), bucketCount(before.today));
  assert.equal(bucketCount(after.tomorrow), 2);
});

test('簽療程單那一列與抽屜照舊只到今天：visitsToClose() 不收明天的', () => {
  assert.equal(visitsToClose([openVisit('v-tom', TOMORROW)], TODAY).length, 0);
});

test('簽療程單照 visitsToClose()：已經結案的那一天不算', () => {
  const done = { ...openVisit('v-done', TODAY), status: 'done', slots: [{ courseId: 'c', status: 'done' }] };
  assert.equal(bucketCount(todoBuckets({ today: TODAY, unclosed: [done] }).today), 0);
});

test('任務照舊：死線過了逾期、今天、明天；更後面的哪一格都不在', () => {
  assert.equal(taskBucket(YESTERDAY, TODAY), 'overdue');
  assert.equal(taskBucket(TODAY, TODAY), 'today');
  assert.equal(taskBucket(TOMORROW, TODAY), 'tomorrow');
  assert.equal(taskBucket('2026-10-25', TODAY), null);
});

test('首頁與點進去那一頁讀同一支：home.js 不再自己照 dueDate 切', () => {
  const src = readFileSync(new URL('../public/js/ui/views/home.js', import.meta.url), 'utf8');
  assert.match(src, /todoBuckets\(/);
  assert.doesNotMatch(src, /t\.dueDate === today/);
  assert.doesNotMatch(src, /daysBetween\(today, t\.dueDate\) === 1/);
  // 點進去那一頁勾隨手記也走 `prepareToggle()`（營養品的提醒要問「給了哪些」）
  assert.match(src, /note\.prepareToggle\(/);
});
