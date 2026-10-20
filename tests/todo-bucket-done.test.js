// 逾期／今天／明天那三頁的「已完成」各算哪幾件（after-golive-2026-10-20 issue 03，ADR-0166，推翻 ADR-0152 決定 4）。
//
// 她 10/20：「待辦首頁，的今天，他的已完成是不是裝飾啊 ? 我勾起來的怎麼沒有跑到已完成……就是我想要今天份的點進去後
// 可以看到已完成和未完成，包含重其他地方點的完成也是放已完成」、「到了明天後……已完成就會清空，但只是這邊呈現清空」。
// 以前已完成那一格只有任務（`listDone()` 最近 200 筆、照死線切）：隨手記與簽療程單勾掉了哪裡都不在，
// 逾期的已完成是「所有死線過了、做完的任務」，永遠積著。

// `dayOf()`／`startOfDayISO()` 用的是裝置的時區 —— CI 上是 UTC，這裡釘成台灣（同 download-date.test.js）
process.env.TZ = 'Asia/Taipei';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { doneBuckets, todoBuckets, bucketCount, BUCKETS } from '../public/js/domain/todoFlow.js';
import { daySignedOff } from '../public/js/domain/visits.js';
import { startOfDayISO, msOf } from '../public/js/domain/dates.js';

const TODAY = '2026-10-21';
const YESTERDAY = '2026-10-20';
const TOMORROW = '2026-10-22';
const LAST_WEEK = '2026-10-14';

// 台灣的時間 → 存進去的樣子（`toISOString()`，UTC）
const at = (local) => new Date(`${local}+08:00`).toISOString();
// 一般的資料：建立之後又被寫過一次（她勾的那一下）。一出生就做完的另外給 `born`
const CREATED = at('2026-10-01T09:00:00');
const stamps = (updated) => ({ createdAt: CREATED, updatedAt: updated });

const task = (id, dueDate, doneAt, extra = {}) => ({
  id, kind: 'Examine', customerName: '客戶A', dueDate, done: true, doneAt, ...stamps(doneAt), ...extra,
});
const note = (id, date, extra = {}) => ({
  id, text: id, date, done: true, doneAt: at(`${TODAY}T10:00:00`), ...stamps(at(`${TODAY}T10:00:00`)), ...extra,
});
const slot = (status, startsAt = '10:00') => ({ courseId: 'c', status, startsAt, endsAt: '11:00' });
const visit = (id, date, slots, statusAt, extra = {}) => ({
  id, date, customerId: id, customerName: '客戶A', status: 'done', slots, statusAt, ...stamps(statusAt), ...extra,
});

const only = (b) => ({
  tasks: b.tasks.map((t) => t.id), close: b.close.map((v) => v.id), notes: b.notes.map((n) => n.id),
});

// ---------------------------------------------------------------------------
// 今天
// ---------------------------------------------------------------------------

test('今天：死線今天勾掉的任務、掛今天勾掉的隨手記、今天兩段都簽了的那一天 —— 三塊各一件', () => {
  const b = doneBuckets({
    today: TODAY,
    tasks: [task('t-today', TODAY, at(`${TODAY}T09:30:00`))],
    notes: [note('n-today', TODAY)],
    visits: [visit('v-today', TODAY, [slot('done'), slot('no_show', '13:00')], at(`${TODAY}T15:00:00`))],
  });
  assert.deepEqual(only(b.today), { tasks: ['t-today'], close: ['v-today'], notes: ['n-today'] });
  assert.equal(bucketCount(b.today), 3);
});

test('今天：一段簽了、一段還開著 → 不在已完成（它還在未完成）；整天取消 → 也不在', () => {
  const half = visit('v-half', TODAY, [slot('done'), slot('confirmed', '13:00')], at(`${TODAY}T11:00:00`), { status: 'confirmed' });
  const gone = visit('v-gone', TODAY, [slot('cancelled')], at(`${TODAY}T08:00:00`), { status: 'cancelled' });
  const b = doneBuckets({ today: TODAY, visits: [half, gone] });
  assert.equal(bucketCount(b.today), 0);
  // 還開著的那一天在未完成那一側 —— 一筆來訪不會同時在兩邊
  assert.deepEqual(todoBuckets({ today: TODAY, unclosed: [half] }).today.close.map((v) => v.id), ['v-half']);
});

test('今天：死線今天、三週前就勾掉的也在（以前靠 listDone() 的最近 200 筆，會漏）', () => {
  const b = doneBuckets({ today: TODAY, tasks: [task('t-early', TODAY, at('2026-09-30T10:00:00'))] });
  assert.deepEqual(b.today.tasks.map((t) => t.id), ['t-early']);
});

test('還沒勾的任務、還沒勾的隨手記、刪掉的 —— 已完成那一格一件都不收', () => {
  const b = doneBuckets({
    today: TODAY,
    tasks: [
      task('t-open', TODAY, null, { done: false }),
      task('t-del', TODAY, at(`${TODAY}T09:00:00`), { deletedAt: at(`${TODAY}T09:05:00`) }),
    ],
    notes: [note('n-open', TODAY, { done: false, doneAt: null }), note('n-del', TODAY, { deletedAt: CREATED }), note('n-nodate', null)],
    visits: [visit('v-del', TODAY, [slot('done')], at(`${TODAY}T15:00:00`), { deletedAt: CREATED })],
  });
  for (const k of BUCKETS) assert.equal(bucketCount(b[k]), 0, k);
});

// ---------------------------------------------------------------------------
// 明天
// ---------------------------------------------------------------------------

test('明天：死線明天、提早勾掉的任務與掛明天勾掉的隨手記在明天；今天那一格沒有它們', () => {
  const b = doneBuckets({
    today: TODAY,
    tasks: [task('t-tom', TOMORROW, at(`${TODAY}T16:00:00`))],
    notes: [note('n-tom', TOMORROW)],
  });
  assert.deepEqual(only(b.tomorrow), { tasks: ['t-tom'], close: [], notes: ['n-tom'] });
  assert.equal(bucketCount(b.today), 0);
});

test('明天沒有簽療程單那一塊：明天的還簽不了', () => {
  const b = doneBuckets({ today: TODAY, visits: [visit('v-tom', TOMORROW, [slot('done')], at(`${TODAY}T16:00:00`))] });
  assert.equal(b.tomorrow.close.length, 0);
});

// ---------------------------------------------------------------------------
// 逾期：今天才做完的
// ---------------------------------------------------------------------------

test('逾期：死線昨天、今天勾的 → 有；死線上週、昨天勾的 → 沒有（不然會永遠積著）', () => {
  const b = doneBuckets({
    today: TODAY,
    tasks: [
      task('t-late-today', YESTERDAY, at(`${TODAY}T10:00:00`)),
      task('t-late-yday', LAST_WEEK, at(`${YESTERDAY}T10:00:00`)),
    ],
  });
  assert.deepEqual(b.overdue.tasks.map((t) => t.id), ['t-late-today']);
});

test('逾期：昨天的療程單今天才簽 → 有；昨天就簽好的 → 沒有', () => {
  const b = doneBuckets({
    today: TODAY,
    visits: [
      visit('v-signed-today', YESTERDAY, [slot('done')], at(`${TODAY}T09:00:00`)),
      visit('v-signed-yday', YESTERDAY, [slot('done')], at(`${YESTERDAY}T18:00:00`)),
    ],
  });
  assert.deepEqual(b.overdue.close.map((v) => v.id), ['v-signed-today']);
});

test('逾期沒有隨手記那一塊：掛昨天、今天才勾的隨手記哪一格都不在（隨手記不會逾期，ADR-0152 決定 2）', () => {
  const b = doneBuckets({ today: TODAY, notes: [note('n-yday', YESTERDAY)] });
  for (const k of BUCKETS) assert.equal(b[k].notes.length, 0, k);
});

test('台灣早上 7 點勾的（存的是前一天 23:00Z）算今天，不算昨天', () => {
  const early = at(`${TODAY}T07:00:00`);
  assert.equal(early, '2026-10-20T23:00:00.000Z');
  const b = doneBuckets({ today: TODAY, tasks: [task('t-dawn', YESTERDAY, early)] });
  assert.deepEqual(b.overdue.tasks.map((t) => t.id), ['t-dawn']);
});

// ---------------------------------------------------------------------------
// 隔天：已完成那一格自己空了
// ---------------------------------------------------------------------------

test('隔天拿同一份資料跑：昨天那幾件一件都不在今天的已完成', () => {
  const data = {
    tasks: [task('t-today', TODAY, at(`${TODAY}T09:30:00`)), task('t-late', YESTERDAY, at(`${TODAY}T10:00:00`))],
    notes: [note('n-today', TODAY)],
    visits: [visit('v-today', TODAY, [slot('done')], at(`${TODAY}T15:00:00`)), visit('v-late', YESTERDAY, [slot('done')], at(`${TODAY}T09:00:00`))],
  };
  const b = doneBuckets({ ...data, today: TOMORROW });
  for (const k of BUCKETS) assert.equal(bucketCount(b[k]), 0, k);
  // 資料一個字都沒變 —— 只是不再是「今天的」
  assert.equal(data.tasks.length, 2);
});

test('提早勾掉的明天那一張，到了明天就在今天的已完成', () => {
  const t = task('t-tom', TOMORROW, at(`${TODAY}T16:00:00`));
  assert.deepEqual(doneBuckets({ today: TOMORROW, tasks: [t] }).today.tasks.map((x) => x.id), ['t-tom']);
});

// ---------------------------------------------------------------------------
// 一出生就做完的：逾期那一格不收（它從來沒逾期過）；今天、明天照收（她 10/21：「好，那就順手幫我修」）
// ---------------------------------------------------------------------------

test('拍 Abovee 今天記進來、今天就已完成的那一天 → 在今天的已完成（是今天的事）', () => {
  const now = at(`${TODAY}T18:00:00`);
  const born = visit('v-photo-today', TODAY, [slot('done')], now, { createdAt: now, updatedAt: now });
  assert.deepEqual(doneBuckets({ today: TODAY, visits: [born] }).today.close.map((v) => v.id), ['v-photo-today']);
});

test('拍 Abovee 今天新記一筆上週已完成的 → 不在逾期的已完成；之後她改過那一天 → 算', () => {
  const now = at(`${TODAY}T11:00:00`);
  const born = visit('v-photo', LAST_WEEK, [slot('done')], now, { createdAt: now, updatedAt: now });
  assert.equal(doneBuckets({ today: TODAY, visits: [born] }).overdue.close.length, 0);
  const touched = { ...born, updatedAt: at(`${TODAY}T11:20:00`) };
  assert.deepEqual(doneBuckets({ today: TODAY, visits: [touched] }).overdue.close.map((v) => v.id), ['v-photo']);
});

test('一出生就勾好的任務（照片放掉的「取消 Abovee」）：死線過了的不在逾期；她拿回來再勾 → 在。死線今天的照收', () => {
  const now = at(`${TODAY}T11:00:00`);
  const born = task('t-freed', YESTERDAY, now, { kind: '取消 Abovee', createdAt: now, updatedAt: now });
  assert.equal(doneBuckets({ today: TODAY, tasks: [born] }).overdue.tasks.length, 0);
  const reticked = { ...born, doneAt: at(`${TODAY}T12:00:00`), updatedAt: at(`${TODAY}T12:00:00`) };
  assert.deepEqual(doneBuckets({ today: TODAY, tasks: [reticked] }).overdue.tasks.map((t) => t.id), ['t-freed']);
  const dueToday = { ...born, id: 't-freed-today', dueDate: TODAY };
  assert.deepEqual(doneBuckets({ today: TODAY, tasks: [dueToday] }).today.tasks.map((t) => t.id), ['t-freed-today']);
});

test('Firestore 的 Timestamp 也認得：createdAt 與 updatedAt 同一刻 → 一出生就做完的（逾期不收）', () => {
  const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
  const ms = Date.parse(at(`${TODAY}T11:00:00`));
  const born = task('t-ts', YESTERDAY, at(`${TODAY}T11:00:00`), { createdAt: ts(ms), updatedAt: ts(ms) });
  const ticked = { ...born, id: 't-ts2', updatedAt: ts(ms + 60_000) };
  assert.deepEqual(doneBuckets({ today: TODAY, tasks: [born, ticked] }).overdue.tasks.map((t) => t.id), ['t-ts2']);
});

test('讀不出建立時間的（舊資料、還沒寫到伺服器的那一份）照樣算 —— 寧可多列一件，不藏她勾的', () => {
  const b = doneBuckets({ today: TODAY, tasks: [task('t-old', YESTERDAY, at(`${TODAY}T09:00:00`), { createdAt: null, updatedAt: null })] });
  assert.equal(b.overdue.tasks.length, 1);
});

// ---------------------------------------------------------------------------
// 形狀
// ---------------------------------------------------------------------------

test('兩個查詢撈到同一張（死線今天、今天勾的）—— 只算一次', () => {
  const t = task('t-dup', TODAY, at(`${TODAY}T09:00:00`));
  const v = visit('v-dup', TODAY, [slot('done')], at(`${TODAY}T15:00:00`));
  const b = doneBuckets({ today: TODAY, tasks: [t, { ...t }], visits: [v, { ...v }] });
  assert.equal(b.today.tasks.length, 1);
  assert.equal(b.today.close.length, 1);
});

test('每一塊新做完的在前（她 2026-09-05：「最上面的應該是我剛勾掉的」）', () => {
  const b = doneBuckets({
    today: TODAY,
    tasks: [task('t-9', TODAY, at(`${TODAY}T09:00:00`)), task('t-14', TODAY, at(`${TODAY}T14:00:00`))],
    notes: [
      note('n-9', TODAY, { doneAt: at(`${TODAY}T09:00:00`) }),
      note('n-14', TODAY, { doneAt: at(`${TODAY}T14:00:00`) }),
    ],
    visits: [
      visit('v-9', TODAY, [slot('done')], at(`${TODAY}T09:00:00`), { customerId: 'a' }),
      visit('v-14', TODAY, [slot('done')], at(`${TODAY}T14:00:00`), { customerId: 'b' }),
    ],
  });
  assert.deepEqual(only(b.today), { tasks: ['t-14', 't-9'], close: ['v-14', 'v-9'], notes: ['n-14', 'n-9'] });
});

test('未完成那一側一個字都沒變：同一份資料丟進 todoBuckets()，勾掉的照舊不算', () => {
  const tasks = [task('t-done', TODAY, at(`${TODAY}T09:00:00`)), task('t-open', TODAY, null, { done: false })];
  const b = todoBuckets({ today: TODAY, tasks, notes: [note('n-done', TODAY)] });
  assert.deepEqual(b.today.tasks.map((t) => t.id), ['t-open']);
  assert.equal(b.today.notes.length, 0);
});

test('daySignedOff()：每一段都結了、至少一段已完成或未到', () => {
  assert.equal(daySignedOff(visit('a', TODAY, [slot('done'), slot('cancelled')], null)), true);
  assert.equal(daySignedOff(visit('b', TODAY, [slot('no_show')], null)), true);
  assert.equal(daySignedOff(visit('c', TODAY, [slot('cancelled')], null)), false);
  assert.equal(daySignedOff(visit('d', TODAY, [slot('done'), slot('pending_confirm')], null)), false);
  assert.equal(daySignedOff(visit('e', TODAY, [], null)), false);
  // 沒有 slot.status 的舊資料：每一段退回整筆那一個
  assert.equal(daySignedOff({ id: 'f', date: TODAY, status: 'done', slots: [{ courseId: 'c' }] }), true);
});

test('startOfDayISO()：台灣 10/21 00:00 ＝ 10/20 16:00Z（拿去比 doneAt／statusAt）', () => {
  assert.equal(startOfDayISO(TODAY), '2026-10-20T16:00:00.000Z');
  assert.equal(startOfDayISO('不是日期'), null);
});

test('msOf()：ISO、Date、Timestamp 都吃得下；認不出來回 null', () => {
  const ms = Date.parse('2026-10-21T01:00:00.000Z');
  assert.equal(msOf('2026-10-21T01:00:00.000Z'), ms);
  assert.equal(msOf(new Date(ms)), ms);
  assert.equal(msOf({ toMillis: () => ms }), ms);
  assert.equal(msOf({ toDate: () => new Date(ms) }), ms);
  assert.equal(msOf(null), null);
  assert.equal(msOf('xx'), null);
});

// ---------------------------------------------------------------------------
// 畫面（issue 04）：三頁的已完成只給看與拿回來；讀不到時未完成照畫
// ---------------------------------------------------------------------------

const HOME = readFileSync(new URL('../public/js/ui/views/home.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => {
  const at = HOME.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `找不到 ${name}()`);
  return HOME.slice(at, HOME.indexOf('\n}\n', at));
};

test('三頁的已完成沒有任何一顆會刪東西：沒有「清掉這 N 筆」、沒有垃圾桶、隨手記不接長按', () => {
  const list = body('bucketDoneList');
  assert.doesNotMatch(list, /data-clear-done|data-drop|data-note-del/);
  assert.match(list, /doneRow\(t, \{ trash: false \}\)/);
  // 隨手記那一塊的容器不是 `[data-notes]` —— `wireNoteLongPress()` 只接那一個（長按選單對勾掉的有「刪掉」）
  assert.doesNotMatch(list, /data-notes[ >"]/);
  assert.match(list, /data-done-notes/);
  // 「已完成 N」＝三塊加起來
  assert.match(body('paintTasks'), /bucketCount\(ctx\.finished\)/);
});

test('已完成那一側讀不到時回 null、不丟 —— renderGroup() 的 Promise.all 照樣畫未完成', () => {
  const load = body('loadBucketDone');
  assert.match(load, /try \{/);
  assert.match(load, /catch \{\s*return null;/);
  assert.match(load, /doneBuckets\(/);
  // 不靠最近 200 張
  assert.doesNotMatch(load, /listDone\(\)/);
});

// ---------------------------------------------------------------------------
// 讀的那一側
// ---------------------------------------------------------------------------

test('「今天才」查詢的起點走 startOfDayISO()，不拿 YYYY-MM-DD 直接比 doneAt／statusAt', () => {
  const tasksSrc = readFileSync(new URL('../public/js/data/tasks.js', import.meta.url), 'utf8');
  const visitsSrc = readFileSync(new URL('../public/js/data/visits.js', import.meta.url), 'utf8');
  assert.match(tasksSrc, /export function listDoneDue\(/);
  assert.match(tasksSrc, /export function listDoneSince\(/);
  assert.match(visitsSrc, /export function listStatusChangedSince\(/);
  // (deletedAt, statusAt) 的複合索引要在 —— repo.list() 一律加 deletedAt == null
  const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes;
  assert.ok(indexes.some((i) => i.collectionGroup === 'visits'
    && i.fields.map((f) => f.fieldPath).join(',') === 'deletedAt,statusAt'), '少了 visits (deletedAt, statusAt)');
});
