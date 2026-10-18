// 待辦首頁的三顆數字：逾期／今天／明天（staging-polish 08，ADR-0152）。
//
// 她：「"今天，明天"的數字為甚麼沒有包含到簽療程單……在日曆綁定當天的todo，好像都沒算進去……
// 如果在日曆綁定當天的todo今天沒勾也沒關係，他不算逾期」；前幾天沒簽完的療程單「算逾期」。
// 首頁的數字與點進去那一頁的清單讀同一支 —— 不然數字跟清單會差一件。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { todoBuckets, bucketCount, taskBucket } from '../public/js/domain/todoFlow.js';

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

test('明天的來訪還簽不了：明天那一格沒有簽療程單', () => {
  const b = todoBuckets({ today: TODAY, unclosed: [openVisit('v-tom', TOMORROW)] });
  assert.equal(bucketCount(b.tomorrow), 0);
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
