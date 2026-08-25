// 行事備註。ADR-0015：它是唯一可以跨天的資料，所以跨天的排版是這裡的重點。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  blockedDates,
  countByDate,
  coversDate,
  dayEvents,
  describeCategory,
  inRange,
  isLeave,
  kindClass,
  colorClass,
  paintClass,
  EVENT_COLORS,
  layoutMonth,
  lengthInDays,
  normalize,
  overlapsRange,
  spanLabel,
  validateEvent,
} from '../public/js/domain/events.js';
import { monthWeeks } from '../public/js/domain/calendar.js';

const ev = (over = {}) => ({
  id: 'e1',
  title: '公出',
  category: 'personal',
  startDate: '2026-08-03',
  endDate: '2026-08-03',
  allDay: true,
  startTime: null,
  endTime: null,
  deletedAt: null,
  ...over,
});

// ---------- 檢查 ----------

test('沒有名稱存不下去', () => {
  assert.ok(validateEvent(ev({ title: '   ' })).errors.some((e) => e.includes('名稱')));
});

test('類別必須是認得的那兩種', () => {
  assert.equal(validateEvent(ev()).errors.length, 0);
  assert.ok(validateEvent(ev({ category: 'meeting' })).errors.some((e) => e.includes('選一種')));
});

test('結束日期比開始早會被擋下來', () => {
  const { errors } = validateEvent(ev({ startDate: '2026-08-10', endDate: '2026-08-03' }));
  assert.ok(errors.some((e) => e.includes('結束日期比開始日期早')));
});

test('整天的不看時間，非整天的要有合法時間', () => {
  assert.equal(validateEvent(ev({ allDay: true, startTime: null, endTime: null })).errors.length, 0);

  const bad = validateEvent(ev({ allDay: false, startTime: '25:00', endTime: '11:00' }));
  assert.ok(bad.errors.some((e) => e.includes('開始時間')));
});

test('同一天的結束時間不比開始晚會被擋，跨天的不擋', () => {
  const sameDay = validateEvent(
    ev({ allDay: false, startTime: '14:00', endTime: '14:00' }),
  );
  assert.ok(sameDay.errors.some((e) => e.includes('結束時間不比開始時間晚')));

  // 「22:00 到隔天 06:00」是合理的，不能拿同一天的規則去擋
  const overnight = validateEvent(
    ev({ allDay: false, startDate: '2026-08-03', endDate: '2026-08-04', startTime: '22:00', endTime: '06:00' }),
  );
  assert.equal(overnight.errors.length, 0);
});

// ---------- 範圍 ----------

test('跨天的中間每一天都算蓋到', () => {
  const e = ev({ startDate: '2026-08-03', endDate: '2026-08-06' });
  assert.equal(coversDate(e, '2026-08-02'), false);
  assert.equal(coversDate(e, '2026-08-03'), true);
  assert.equal(coversDate(e, '2026-08-05'), true);
  assert.equal(coversDate(e, '2026-08-06'), true);
  assert.equal(coversDate(e, '2026-08-07'), false);
});

test('已刪除的不算數', () => {
  const e = ev({ deletedAt: '2026-08-01T00:00:00Z' });
  assert.equal(coversDate(e, '2026-08-03'), false);
  assert.equal(overlapsRange(e, '2026-08-01', '2026-08-31'), false);
  assert.deepEqual(inRange([e], '2026-08-01', '2026-08-31'), []);
});

test('只有一端落在範圍內也算重疊', () => {
  const e = ev({ startDate: '2026-07-28', endDate: '2026-08-02' });
  assert.equal(overlapsRange(e, '2026-08-01', '2026-08-31'), true);
  assert.equal(overlapsRange(e, '2026-09-01', '2026-09-30'), false);
});

test('橫跨幾天', () => {
  assert.equal(lengthInDays(ev()), 1);
  assert.equal(lengthInDays(ev({ startDate: '2026-08-03', endDate: '2026-08-06' })), 4);
});

// ---------- 休假擋日子 ----------

test('休假蓋掉的日子會被列出來，行事備註不會', () => {
  const leave = ev({ id: 'l', category: 'leave', startDate: '2026-08-03', endDate: '2026-08-06' });
  const personal = ev({ id: 'p', category: 'personal', startDate: '2026-08-10', endDate: '2026-08-10' });

  const blocked = blockedDates([leave, personal], '2026-08-01', '2026-08-31');
  assert.deepEqual(
    [...blocked].sort(),
    ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'],
  );
  assert.equal(blocked.has('2026-08-10'), false);
});

test('休假被範圍夾住，不會外溢到查詢範圍之外', () => {
  const leave = ev({ category: 'leave', startDate: '2026-07-28', endDate: '2026-08-04' });
  const blocked = blockedDates([leave], '2026-08-01', '2026-08-31');
  assert.deepEqual([...blocked].sort(), ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']);
});

test('isLeave 認得休假', () => {
  assert.equal(isLeave(ev({ category: 'leave' })), true);
  assert.equal(isLeave(ev({ category: 'personal' })), false);
});

// ---------- 月檢視排版 ----------

// 一週從禮拜一開始（2026-08-25 起，`.scratch/asks-2026-08-25/issues/12`）。
// 2026 年 8 月 1 日是禮拜六，所以第一列是 7/27–8/2、第二列是 8/3–8/9。
const WEEKS = monthWeeks('2026-08');

test('同一週的跨天行程變成一條橫跨的色條', () => {
  const leave = ev({ category: 'leave', startDate: '2026-08-03', endDate: '2026-08-06' });
  const rows = layoutMonth([leave], WEEKS);

  const week2 = rows[1];
  assert.equal(week2.bars.length, 1);
  assert.equal(week2.bars[0].col, 1, '8/3 是禮拜一，那一列的第一格');
  assert.equal(week2.bars[0].span, 4, '8/3 到 8/6 共四天');
  assert.equal(week2.bars[0].lane, 0);
  assert.equal(week2.bars[0].kind, 'kind-leave');
});

test('跨週的行程在每一週各得到一段，並標出前後還有', () => {
  const e = ev({ startDate: '2026-08-07', endDate: '2026-08-10' });
  const rows = layoutMonth([e], WEEKS);

  const week2 = rows[1].bars[0];
  assert.equal(week2.col, 5, '8/7 是禮拜五');
  assert.equal(week2.span, 3, '8/7、8/8、8/9');
  assert.equal(week2.continuesBefore, false);
  assert.equal(week2.continuesAfter, true);

  const week3 = rows[2].bars[0];
  assert.equal(week3.col, 1);
  assert.equal(week3.span, 1, '8/10');
  assert.equal(week3.continuesBefore, true);
  assert.equal(week3.continuesAfter, false);
});

test('同一天重疊的行程疊成不同層', () => {
  const a = ev({ id: 'a', title: 'A', startDate: '2026-08-03', endDate: '2026-08-05' });
  const b = ev({ id: 'b', title: 'B', startDate: '2026-08-04', endDate: '2026-08-06' });
  const rows = layoutMonth([a, b], WEEKS);

  const lanes = rows[1].bars.map((x) => x.lane).sort();
  assert.deepEqual(lanes, [0, 1]);
});

test('不重疊的行程可以共用同一層', () => {
  const a = ev({ id: 'a', title: 'A', startDate: '2026-08-03', endDate: '2026-08-03' });
  const b = ev({ id: 'b', title: 'B', startDate: '2026-08-06', endDate: '2026-08-06' });
  const rows = layoutMonth([a, b], WEEKS);

  assert.deepEqual(rows[1].bars.map((x) => x.lane), [0, 0]);
});

test('放不下的用 +N 表示，不把格子撐爛', () => {
  const many = ['a', 'b', 'c', 'd'].map((id) =>
    ev({ id, title: id, startDate: '2026-08-04', endDate: '2026-08-04' }),
  );
  const rows = layoutMonth(many, WEEKS, { maxLanes: 3 });

  assert.equal(rows[1].bars.length, 3);
  assert.equal(rows[1].more[1], 1, '8/4 是禮拜二，那一列的第二格，被擠掉一筆');
  assert.equal(rows[1].more[0], 0);
});

test('呼叫端可以自己指定顏色組 —— 來訪要跟行事備註排在同一組 lane 裡', () => {
  const visitish = ev({ id: 'v', title: '王小姐 復能', category: 'visit', kind: 'kind-visit' });
  const rows = layoutMonth([visitish], WEEKS);
  assert.equal(rows[1].bars[0].kind, 'kind-visit');
});

test('排版順序固定 —— 換裝置回來看到的要一樣', () => {
  const a = ev({ id: 'a', title: '甲', startDate: '2026-08-03', endDate: '2026-08-03' });
  const b = ev({ id: 'b', title: '乙', startDate: '2026-08-03', endDate: '2026-08-05' });

  const one = layoutMonth([a, b], WEEKS)[1].bars.map((x) => x.id);
  const two = layoutMonth([b, a], WEEKS)[1].bars.map((x) => x.id);
  assert.deepEqual(one, two);
  assert.equal(one[0], 'b', '長的排上面');
});

// ---------- 日檢視 ----------

test('整天的釘在上面，有時間的照時間排', () => {
  const allDay = ev({ id: 'x', title: '休假', category: 'leave', allDay: true });
  const late = ev({
    id: 'l', title: '演講', allDay: false, startTime: '15:00', endTime: '16:00',
  });
  const early = ev({
    id: 'e', title: '會議', allDay: false, startTime: '09:00', endTime: '10:00',
  });

  const { allDay: pinned, timed } = dayEvents([late, allDay, early], '2026-08-03');
  assert.deepEqual(pinned.map((x) => x.id), ['x']);
  assert.deepEqual(timed.map((x) => x.id), ['e', 'l']);
});

test('跨天行程的中間那幾天當成整天 —— 那天她整天都有事', () => {
  const e = ev({
    id: 'trip', title: '出差', allDay: false,
    startDate: '2026-08-03', endDate: '2026-08-05',
    startTime: '08:00', endTime: '18:00',
  });

  assert.deepEqual(dayEvents([e], '2026-08-04').allDay.map((x) => x.id), ['trip']);
  assert.deepEqual(dayEvents([e], '2026-08-04').timed, []);
});

test('跨天的顯示成日期區間，單天整天的顯示成整天', () => {
  const span = ev({ startDate: '2026-08-03', endDate: '2026-08-06' });
  assert.match(dayEvents([span], '2026-08-03').allDay[0].spanLabel, /8\/3.*8\/6/);

  const one = ev();
  assert.equal(dayEvents([one], '2026-08-03').allDay[0].spanLabel, '整天');
});

test('資訊卡片與日曆格子講的是同一句「什麼時候」', () => {
  // 兩邊各寫一份的話，同一筆行程會在兩個地方顯示得不一樣，而她會以為那是兩筆
  const span = ev({ startDate: '2026-08-03', endDate: '2026-08-06' });
  assert.equal(spanLabel(span), dayEvents([span], '2026-08-03').allDay[0].spanLabel);

  const timed = ev({ allDay: false, startTime: '15:00', endTime: '17:00' });
  assert.equal(spanLabel(timed), '15:00–17:00');
  assert.equal(spanLabel(timed), dayEvents([timed], '2026-08-03').timed[0].spanLabel);

  assert.equal(spanLabel(ev()), '整天');
});

test('第一天與最後一天標得出來', () => {
  const e = ev({ startDate: '2026-08-03', endDate: '2026-08-05' });
  assert.equal(dayEvents([e], '2026-08-03').allDay[0].isFirstDay, true);
  assert.equal(dayEvents([e], '2026-08-04').allDay[0].isFirstDay, false);
  assert.equal(dayEvents([e], '2026-08-05').allDay[0].isLastDay, true);
});

// ---------- 週檢視 ----------

test('每天幾筆，跨天的每一天都算一筆', () => {
  const e = ev({ startDate: '2026-08-03', endDate: '2026-08-05' });
  const counts = countByDate([e], '2026-08-01', '2026-08-31');
  assert.deepEqual(counts, { '2026-08-03': 1, '2026-08-04': 1, '2026-08-05': 1 });
});

// ---------- 標籤 ----------

test('認不得的類別原樣顯示，不要吞掉', () => {
  assert.equal(describeCategory('leave'), '休假');
  // 2026-08-23 從「個人行程」改名。**id 沒有跟著改** —— Firestore 裡已經有的
  // 資料不必搬，所以這一條同時盯住兩件事：字改了、值沒改（ADR-0045）。
  assert.equal(describeCategory('personal'), '行事備註');
  assert.match(describeCategory('nope'), /未知類別/);
  assert.equal(kindClass('nope'), 'kind-personal');
});

test('類別清單只有兩種，而且是實質的分別', () => {
  // 2026-08-23 「個人行程」改名成「行事備註」，**id 沒有跟著改** ——
  // Firestore 裡已經有的資料不必搬（ADR-0045）。這一條盯住那件事。
  assert.deepEqual(CATEGORIES.map((c) => c.id), ['personal', 'leave']);
});

// ---------- 她自己挑的顏色（ADR-0040） ----------

test('挑過顏色就用挑的，沒挑就用那一類本來的', () => {
  assert.equal(paintClass(ev({ color: 'violet' })), 'evcolor-violet');
  assert.equal(paintClass(ev({ color: null })), 'kind-personal');
  assert.equal(paintClass(ev({ category: 'leave' })), 'kind-leave');
});

test('認不得的顏色不讓畫面壞掉，落回那一類的預設色', () => {
  // 顯示端的寬容是為了已經存在的資料 —— 2026-08 以前建的行程身上
  // 根本沒有這個欄位，那些不是壞資料。
  assert.equal(colorClass(ev({ color: 'chartreuse' })), '');
  assert.equal(colorClass(ev({})), '');
  assert.equal(colorClass(null), '');
  assert.equal(paintClass(ev({ color: 'chartreuse' })), 'kind-personal');
});

test('休假挑了顏色，斜線紋還在 —— 那條紋路講的是「她不在」，不是配色', () => {
  const painted = paintClass(ev({ category: 'leave', color: 'red' }));
  assert.ok(painted.includes('evcolor-red'), '顏色要換成她挑的');
  assert.ok(painted.includes('kind-leave'), '.kind-leave 要留著，斜線紋掛在它身上');
});

test('存檔時不寬容：挑了就要是認得的那六個之一', () => {
  const base = { title: '公出', category: 'personal', startDate: '2026-09-01',
    endDate: '2026-09-01', allDay: true };

  assert.deepEqual(validateEvent({ ...base, color: 'violet' }).errors, []);
  assert.deepEqual(validateEvent({ ...base, color: null }).errors, [], '不挑是合法的');
  assert.deepEqual(validateEvent({ ...base }).errors, [], '沒有這個欄位也是合法的');
  assert.ok(validateEvent({ ...base, color: 'chartreuse' }).errors.includes('不認得的顏色'));
});

// ---------- 存進去之前的形狀 ----------
//
// 這一組是 2026-08-24 補的。`normalize()` 原本叫 `shape()` 而且住在
// `data/events.js` 裡，於是沒有任何測試看得到它 —— 它漏掉了 `color`，
// 讓她挑的顏色過了畫面、過了 validateEvent()、過了 Rules，
// 在寫進 Firestore 前一刻被丟掉。這一組在的意義是那種漏不會再發生一次。

test('挑好的顏色要活著送進去 —— 這是那個 bug 本人', () => {
  const out = normalize({
    title: '宜蘭休假', category: 'leave',
    startDate: '2026-09-01', endDate: '2026-09-03', allDay: true, color: 'red',
  });
  assert.equal(out.color, 'red');
});

test('沒挑顏色存 null，不是 undefined', () => {
  // Firestore 會把 undefined 的欄位整個省略，而 update() 時「省略」的意思是
  // 「不要動它」—— 那會讓「把顏色改回跟著類別」變成一個做不到的動作。
  const out = normalize({ title: '公出', startDate: '2026-09-01' });
  assert.equal(out.color, null);
  assert.ok('color' in out, '欄位本身要在，值才可以是 null');
});

test('認不得的顏色在最後一道被擋下來，不會寫進資料庫', () => {
  assert.equal(normalize({ title: '公出', startDate: '2026-09-01', color: 'chartreuse' }).color, null);
});

test('整天的把時間清成 null —— 不要留一個她從來沒選過的舊值', () => {
  const out = normalize({
    title: '公出', startDate: '2026-09-01', allDay: true,
    startTime: '09:00', endTime: '10:00',
  });
  assert.equal(out.startTime, null);
  assert.equal(out.endTime, null);
});

test('不是整天的把時間留著', () => {
  const out = normalize({
    title: '演講', startDate: '2026-09-01', allDay: false,
    startTime: '14:00', endTime: '16:00',
  });
  assert.equal(out.startTime, '14:00');
  assert.equal(out.endTime, '16:00');
});

test('沒填結束日期就跟開始同一天，備註空白存 null', () => {
  const out = normalize({ title: '  公出  ', startDate: '2026-09-01', note: '   ' });
  assert.equal(out.endDate, '2026-09-01');
  assert.equal(out.title, '公出');
  assert.equal(out.note, null);
});

test('顏色存的是名字不是色碼 —— 存色碼的話深色模式那一份沒有人換得掉', () => {
  for (const id of EVENT_COLORS) {
    assert.ok(/^[a-z]+$/.test(id), `${id} 應該是名字，不是 #rrggbb`);
  }
});

test('日曆的月檢視與日檢視讀的是同一組顏色', () => {
  const weeks = monthWeeks('2026-09');
  const leave = ev({ id: 'L', category: 'leave', color: 'red',
    startDate: '2026-09-02', endDate: '2026-09-02' });

  const bar = layoutMonth([leave], weeks).flatMap((r) => r.bars).find((b) => b.id === 'L');
  const { allDay } = dayEvents([leave], '2026-09-02');

  assert.equal(bar.kind, paintClass(leave));
  assert.equal(allDay[0].kind, paintClass(leave));
});
