// 日曆。SPEC 第 8.6 節。
//
// 這一支盯的是「格子不能錯位」與「那天的事不能漏」：
// 月檢視少補一列、或是週的起點算錯一天，畫面上看起來都很正常，
// 但她會照著一個錯的日子去壓表。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { statusClass } from '../public/js/domain/visits.js';

import {
  weekStart, weekDays, monthWeeks, rangeOf, moveBy, titleOf,
  agendaFor, summaryByDate, monthBars, WEEKDAY_HEADERS, VIEWS,
} from '../public/js/domain/calendar.js';

const visit = (over = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '客戶一', date: '2026-09-18',
  status: 'confirmed',
  slots: [{ startsAt: '10:30', endsAt: '11:30', courseName: '復能', therapistId: 's1' }],
  ...over,
});

const CTX = {
  roomsById: { 'r-3': { name: '治3' }, 'r-iv2': { name: '點滴2', shortName: '.2' } },
  staffById: { s1: { name: '治療師甲' }, s2: { name: '治療師乙' } },
};

describe('週與月的格子', () => {
  // 2026-08-25：全站改成週一起算。以前這裡是週日，而她自己記時間的那一頁與
  // 客戶填的表單一直是週一 —— 同一個產品裡兩種排法（`.scratch/asks-2026-08-25/issues/12`）。
  test('一週從禮拜一開始', () => {
    // 2026-09-18 是禮拜五
    assert.equal(weekStart('2026-09-18'), '2026-09-14');
    assert.equal(weekStart('2026-09-14'), '2026-09-14');
    // 禮拜日是一週的最後一天，不是第一天 —— 這一顆是週日起算最容易錯的地方
    assert.equal(weekStart('2026-09-20'), '2026-09-14');
    assert.deepEqual(weekDays('2026-09-18')[6], '2026-09-20');
    assert.equal(weekDays('2026-09-18').length, 7);
  });

  test('表頭是一二三四五六日', () => {
    assert.deepEqual(WEEKDAY_HEADERS, ['一', '二', '三', '四', '五', '六', '日']);
  });

  test('月的格子補滿前後兩端，每一列都是七格', () => {
    const weeks = monthWeeks('2026-09');
    assert.ok(weeks.every((w) => w.length === 7));
    assert.equal(weeks[0][0].date, '2026-08-31'); // 9/1 是禮拜二，前面補一天
    assert.equal(weeks[0][0].inMonth, false);
    assert.equal(weeks[0][1].date, '2026-09-01');
    assert.equal(weeks[0][1].inMonth, true);

    const last = weeks[weeks.length - 1];
    assert.ok(last.some((d) => d.date === '2026-09-30'));
    assert.ok(last.some((d) => !d.inMonth), '月底之後也要補到週末');
  });

  test('整月剛好塞滿幾週時不會多補一列空的', () => {
    // 2027-02 的 1 號是禮拜一、28 號是禮拜日，剛好四週
    const weeks = monthWeeks('2027-02');
    assert.equal(weeks.length, 4);
    assert.equal(weeks[0][0].date, '2027-02-01');
    assert.equal(weeks[3][6].date, '2027-02-28');
  });

  test('亂寫的月份回空陣列，不要湊出一個月曆', () => {
    for (const bad of ['', null, '2026-13', 'x']) assert.deepEqual(monthWeeks(bad), []);
  });
});

describe('每個檢視要讀哪一段', () => {
  test('日只讀那一天，週讀七天，月連補的日子一起讀', () => {
    assert.deepEqual(rangeOf('day', '2026-09-18'), { from: '2026-09-18', to: '2026-09-18' });
    assert.deepEqual(rangeOf('week', '2026-09-18'), { from: '2026-09-14', to: '2026-09-20' });
    assert.deepEqual(rangeOf('month', '2026-09-18'), { from: '2026-08-31', to: '2026-10-04' });
  });

  test('補進來的鄰月日子也要有資料 —— 留白會讓人以為那天沒事', () => {
    const { from, to } = rangeOf('month', '2026-09-18');
    assert.ok(from < '2026-09-01');
    assert.ok(to > '2026-09-30');
  });

  test('壞日期回 null', () => {
    for (const view of VIEWS) assert.equal(rangeOf(view, 'x'), null);
  });
});

describe('翻頁', () => {
  test('日翻一天、週翻七天、月翻一個月', () => {
    assert.equal(moveBy('day', '2026-09-18', 1), '2026-09-19');
    assert.equal(moveBy('week', '2026-09-18', -1), '2026-09-11');
    assert.equal(moveBy('month', '2026-09-18', 1), '2026-10-18');
  });

  test('月底翻月不會跳過月份', () => {
    assert.equal(moveBy('month', '2026-01-31', 1), '2026-02-28');
  });
});

describe('標題', () => {
  test('三種檢視各自講得清楚是哪一段', () => {
    // 日檢視不放年份：390px 上會斷成兩行，而年份是最不需要確認的一項
    assert.equal(titleOf('day', '2026-09-18'), '9/18(五)');
    assert.equal(titleOf('week', '2026-09-18'), '9/14(一) – 9/20(日)');
    assert.equal(titleOf('month', '2026-09-18'), '2026 年 9 月');
  });
});

describe('一整天的時段', () => {
  test('照開始時間排，一次來訪的每個時段各自一列', () => {
    const rows = agendaFor([visit({
      slots: [
        { startsAt: '14:00', endsAt: '15:00', courseName: '靜脈' },
        { startsAt: '10:30', endsAt: '11:30', courseName: '復能' },
      ],
    })], '2026-09-18', CTX);

    assert.deepEqual(rows.map((r) => r.startsAt), ['10:30', '14:00']);
    assert.deepEqual(rows.map((r) => r.courseName), ['復能', '靜脈']);
    assert.ok(rows.every((r) => r.visitId === 'v1'));
  });

  test('匯入的舊來訪沒有時間，排在當天最後並標「時間不詳」', () => {
    const rows = agendaFor([
      visit({ id: 'v1', slots: [{ startsAt: null, endsAt: null, courseName: '復能' }] }),
      visit({ id: 'v2', slots: [{ startsAt: '14:00', endsAt: '15:00', courseName: '靜脈' }] }),
    ], '2026-09-18', CTX);

    assert.deepEqual(rows.map((r) => r.courseName), ['靜脈', '復能']);
    assert.deepEqual(rows.map((r) => r.timeLabel), ['14:00–15:00', '時間不詳']);
    // 不知道時間就談不上時間衝突
    assert.ok(rows.every((r) => r.clashes.length === 0));
  });

  test('別天的、取消的、刪除的都不出現', () => {
    const rows = agendaFor([
      visit({ id: 'v1', date: '2026-09-17' }),
      visit({ id: 'v2', status: 'cancelled' }),
      visit({ id: 'v3', deletedAt: 'x' }),
    ], '2026-09-18', CTX);
    assert.equal(rows.length, 0);
  });

  test('這一筆底下有沒有「記的話」，那一列自己講得出來', () => {
    // 抽屜上要畫一顆小記事本，不然她得逐一點開才知道哪一筆寫了字。
    // **帶的是有沒有，不是那段字** —— 那一列不印它。
    const [withNote] = agendaFor([visit({ note: '客人說要換床' })], '2026-09-18', CTX);
    assert.equal(withNote.hasNote, true);

    const [without] = agendaFor([visit({ note: null })], '2026-09-18', CTX);
    assert.equal(without.hasNote, false);

    // 空字串與只有空白是「沒有」，不是「有一段空的」
    const [blank] = agendaFor([visit({ note: '   ' })], '2026-09-18', CTX);
    assert.equal(blank.hasNote, false);
  });

  test('診間與治療師換成名字，沒指派就是 null', () => {
    const [row] = agendaFor([visit({
      slots: [{ startsAt: '10:30', endsAt: '11:30', roomId: 'r-3', bed: 'A' }],
    })], '2026-09-18', CTX);
    assert.equal(row.room, '治3');
    assert.equal(row.bed, 'A');
    assert.equal(row.therapist, null);
  });

  test('同治療師撞在一起，兩邊都標', () => {
    const rows = agendaFor([
      visit(),
      visit({ id: 'v2', customerName: '客戶二',
        slots: [{ startsAt: '11:00', endsAt: '12:00', therapistId: 's1' }] }),
    ], '2026-09-18', CTX);

    assert.equal(rows[0].clashes.length, 1);
    assert.equal(rows[0].clashes[0].with, '客戶二');
    assert.equal(rows[0].clashes[0].what, '治療師甲');
    assert.equal(rows[1].clashes.length, 1);
  });

  test('同診間要連床位一起看，不同床不算撞', () => {
    const slots = (bed) => [{ startsAt: '10:30', endsAt: '11:30', roomId: 'r-3', bed }];
    const same = agendaFor([
      visit({ slots: slots('A') }),
      visit({ id: 'v2', customerName: '客戶二', slots: slots('A') }),
    ], '2026-09-18', CTX);
    assert.equal(same[0].clashes.length, 1);

    const other = agendaFor([
      visit({ slots: slots('A') }),
      visit({ id: 'v2', customerName: '客戶二', slots: slots('B') }),
    ], '2026-09-18', CTX);
    assert.equal(other[0].clashes.length, 0);
  });

  test('同一筆來訪自己的時段重疊不算資源衝突', () => {
    const rows = agendaFor([visit({
      slots: [
        { startsAt: '10:30', endsAt: '11:30', therapistId: 's1' },
        { startsAt: '11:00', endsAt: '12:00', therapistId: 's1' },
      ],
    })], '2026-09-18', CTX);
    assert.ok(rows.every((r) => r.clashes.length === 0));
  });

  test('時間重疊但沒共用資源就不算撞', () => {
    const rows = agendaFor([
      visit(),
      visit({ id: 'v2', customerName: '客戶二',
        slots: [{ startsAt: '11:00', endsAt: '12:00', therapistId: 's2' }] }),
    ], '2026-09-18', CTX);
    assert.ok(rows.every((r) => r.clashes.length === 0));
  });
});

// 取消的來訪在日曆上畫得出來但暗掉（ADR-0061）。以前這裡整筆濾掉，
// 於是月檢視有一條灰色色條、點下去那一天卻是空的 —— 同一份資料兩種畫法。
describe('取消的來訪（ADR-0061）', () => {
  const cancelled = () => visit({ id: 'v9', customerName: '客戶九', status: 'cancelled' });

  test('預設不收 —— 壓表與進度追蹤問的是「還排得下嗎」', () => {
    const rows = agendaFor([cancelled()], '2026-09-18', CTX);
    assert.deepEqual(rows, []);
  });

  test('帶 includeCancelled 才收，而且狀態原樣帶著', () => {
    const rows = agendaFor([cancelled()], '2026-09-18', { ...CTX, includeCancelled: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'cancelled');
    assert.equal(rows[0].customerName, '客戶九');
  });

  test('軟刪除的照樣不收 —— 刪掉不是一種狀態，是那一筆不存在', () => {
    const rows = agendaFor(
      [visit({ id: 'v8', deletedAt: '2026-09-01T00:00:00Z' })],
      '2026-09-18',
      { ...CTX, includeCancelled: true },
    );
    assert.deepEqual(rows, []);
  });

  test('取消的不撞期，也不讓別人多一筆撞期', () => {
    const rows = agendaFor([
      visit(),
      cancelled(),
    ], '2026-09-18', { ...CTX, includeCancelled: true });

    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.clashes.length === 0));
  });

  test('summaryByDate() 不算它 —— 頂端那一行與週檢視講同一句話', () => {
    const summary = summaryByDate([visit(), cancelled()]);
    assert.equal(summary['2026-09-18'].visits, 1);
  });
});

describe('每天的摘要', () => {
  // **`pending` 數的是段數不是筆數**（2026-09-09，ADR-0085）。狀態本來就
  // 逐段（ADR-0081），而月檢視底下畫的也是一段一條色條 —— 兩個數字用不同
  // 的單位算，頂端寫「1 待確認」底下卻有兩條琥珀色。
  test('數來訪、數時段，等回覆的逐段數', () => {
    const summary = summaryByDate([
      visit(),
      visit({ id: 'v2', customerName: '客戶二', status: 'pending_confirm',
        slots: [{ startsAt: '14:00' }, { startsAt: '15:15' }] }),
      visit({ id: 'v3', date: '2026-09-19' }),
    ]);

    assert.equal(summary['2026-09-18'].visits, 2);
    assert.equal(summary['2026-09-18'].slots, 3);
    assert.equal(summary['2026-09-18'].pending, 2, '那一筆的兩段都還沒問過');
    assert.deepEqual(summary['2026-09-18'].names, ['客戶一', '客戶二']);
    assert.equal(summary['2026-09-19'].visits, 1);
  });

  test('同一筆裡只有一段沒問過時，數的是 1 不是 2', () => {
    const summary = summaryByDate([
      visit({ id: 'v9', status: 'pending_confirm', slots: [
        { startsAt: '09:00', status: 'confirmed' },
        { startsAt: '10:30', status: 'pending_confirm' },
      ] }),
    ]);
    assert.equal(summary['2026-09-18'].pending, 1);
  });

  test('取消與刪除的不算，沒有那天就是沒有那個鍵', () => {
    const summary = summaryByDate([
      visit({ status: 'cancelled' }),
      visit({ id: 'v2', deletedAt: 'x' }),
    ]);
    assert.deepEqual(summary, {});
  });
});

// 四個畫著格子的地方要用同一個起點。
//
// 2026-08-25 之前它們是兩派：日曆與壓表的小日曆週日起算，她自己記時間的那一頁
// 與客戶填的表單週一起算 —— 而後兩支的註解都寫著「跟她的日曆一樣」。
// 她在收件匣核對客戶填了什麼的時候，兩邊的格子位置是錯開的。
//
// 這一支不執行程式碼，只讀原始碼（同 `module-names.test.js` 的路數）——
// 那兩個 WEEK_ORDER 是畫面自己列的常數，測不到，但看得到。
describe('一週的起點只有一個', () => {
  const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

  test('日曆的表頭從禮拜一起算', () => {
    assert.equal(WEEKDAY_HEADERS[0], '一');
    assert.equal(WEEKDAY_HEADERS[6], '日');
  });

  test('自己列順序的那兩頁跟表頭一致', () => {
    for (const rel of ['js/ui/views/availability.js', 'js/form/page.js']) {
      const m = /const WEEK_ORDER = \[([^\]]+)\]/.exec(read(rel));
      assert.ok(m, `${rel} 找不到 WEEK_ORDER`);
      const order = m[1].split(',').map((x) => Number(x.trim()));
      assert.deepEqual(order, [1, 2, 3, 4, 5, 6, 0], `${rel} 的一週起點跟日曆不一樣`);
    }
  });

  test('自己算月初空幾格的那兩支也是', () => {
    // `(weekday + 6) % 7`：週日是 0，往回退 6 天才回到那一週的禮拜一。
    for (const rel of ['js/domain/availabilityForm.js', 'js/ui/views/schedule.js']) {
      assert.match(
        read(rel),
        /const lead = \(.*\+ 6\) % 7/,
        `${rel} 的 lead 沒有跟著週一起算 —— 月初那幾格會整排錯開`,
      );
    }
  });
});

// 她 2026-09-08：
//
// > 我在日曆點開詳情的時候，為甚麼我點的是復能(INDIBA)，但是卻會一次呈現三個
//
// 日／週檢視那一份清單是**一段一列**的，而 `agendaFor()` 一路算出了 `slotIndex`。
// 這個 bug 的全部內容就是：畫成按鈕的那一下把它丟掉了。
//
// 這一支盯兩件事：算出來的那個 index 是對的，以及**四個接線的地方都走同一支
// `parseOpen()`**。四份 `split(':')` 遲早有一份忘了取第三格。
describe('點一列＝點那一段', () => {
  const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

  test('一筆三段就是三列，index 照時段的順序', () => {
    const rows = agendaFor([visit({
      slots: [
        { startsAt: '09:00', endsAt: '09:30', courseName: '復能' },
        { startsAt: '11:00', endsAt: '12:00', courseName: 'ILIB' },
        { startsAt: '10:00', endsAt: '10:30', courseName: '復能' },
      ],
    })], '2026-09-18', CTX);

    assert.equal(rows.length, 3);
    // 列照時間排，但 index 記的是它在 `slots` 裡的位置 —— 兩者不一樣，
    // 而拿排序後的名次當 index 會讓她點到別段。
    assert.deepEqual(rows.map((r) => r.startsAt), ['09:00', '10:00', '11:00']);
    assert.deepEqual(rows.map((r) => r.slotIndex), [0, 2, 1]);
  });

  test('日／週那一列的 data-open 帶得出是哪一段', () => {
    assert.match(
      read('js/ui/views/calendar.js'),
      /open: `visit:\$\{r\.visitId\}:\$\{r\.slotIndex\}`/,
      'visitRow() 的 data-open 少了第三格 —— 點一段會看到整筆',
    );
  });

  // 2026-09-10 多了第五個：讀取卡片上那幾列（`wireReadSlots()`）。
  // 另外三頁列的是整筆來訪，所以那一支把每一段畫成可以點的一列 ——
  // 接線走的是**同一支** `parseOpen()`，見 `tests/read-card-one-slot.test.js`。
  test('五個接線的地方都走 parseOpen()，沒有人自己 split', () => {
    const src = read('js/ui/views/calendar.js');
    const parsed = src.match(/parseOpen\(btn\.dataset\.open\)/g) ?? [];
    assert.equal(parsed.length, 5,
      '抽屜點一下／抽屜長按／週日點一下／週日長按／讀取卡片那幾列，'
      + '五個都要走 parseOpen()');
    assert.equal(
      (src.match(/dataset\.open\.split\(/g) ?? []).length, 0,
      '有人自己 split data-open —— 那一份遲早會忘了取第三格',
    );
  });

  // **這一條 2026-09-10 反過來了。**
  //
  // 以前它釘的是「另外三頁列的是整筆來訪，不該帶 focusSlot」—— 那句話在
  // 2026-09-08 是對的，但她 2026-09-10 說「我還是希望大部分都先改成呈現
  // 這一段的詳情而不是這一整天的」。三頁現在都帶得出來（沒帶＝那一天全部，
  // 而每一段自己是一列），細節在 `tests/read-card-one-slot.test.js`。
  test('讀取卡片收得到 focusSlot，而且沒帶就是全部', () => {
    const src = read('js/ui/views/calendar.js');
    assert.match(src, /slotsToShow\(visit, data\?\.focusSlot \?\? null\)/);
    assert.match(src, /const tappable = !focused && slots\.length > 1;/,
      '沒指定哪一段的時候，每一段要是可以點的一列');
  });
});


// 2026-09-08，她主動要的：
//
// > 同一位客戶同一天三段，月檢視上只畫一條色條、而且只印第一段的名字
//
// 一段一條。id 要唯一（`layoutMonth()` 拿它當 key），順序照時間（`sortKey`）。
describe('月檢視一段一條', () => {
  const MASTER = {
    courses: [
      { id: 'c-recovery', name: '復能', durationChoices: [30, 60] },
      { id: 'c-ilib', name: 'ILIB', shortName: 'IL', durationChoices: [30, 60] },
    ],
    equipment: [
      { id: 'eq-sis', name: '超磁場', shortName: 'SIS', courseId: 'c-recovery' },
      { id: 'eq-indiba', name: 'INDIBA', shortName: 'IN', courseId: 'c-recovery' },
      { id: 'eq-ilib', name: 'ILIB', shortName: 'IL', courseId: 'c-ilib' },
    ],
  };

  const threeSlots = visit({
    slots: [
      { startsAt: '09:00', endsAt: '09:30', courseId: 'c-recovery', equipmentId: 'eq-indiba' },
      { startsAt: '10:00', endsAt: '10:30', courseId: 'c-recovery', equipmentId: 'eq-sis' },
      { startsAt: '11:00', endsAt: '12:00', courseId: 'c-ilib' },
    ],
  });

  test('三段畫三條，每一條印那一段用的那一台', () => {
    const bars = monthBars(threeSlots, MASTER);
    assert.equal(bars.length, 3);
    assert.equal(bars[0].title, '客戶一·IN(30)');
    assert.equal(bars[1].title, '客戶一·SIS(30)');
    // 第三段身上沒有器材（單買 ILIB 那種），所以只比開頭 ——
    // 後面那個 `(60)` 是 `01` 那一支的事（`withMinutes()` 現在只在有器材時才接）。
    assert.match(bars[2].title, /^客戶一·IL/);
  });

  test('id 一段一個 —— 三條同 id 會在排版時互相蓋掉', () => {
    assert.deepEqual(monthBars(threeSlots, MASTER).map((b) => b.id),
      ['v1:0', 'v1:1', 'v1:2']);
  });

  test('sortKey 是那一段的開始時間', () => {
    assert.deepEqual(monthBars(threeSlots, MASTER).map((b) => b.sortKey),
      ['09:00', '10:00', '11:00']);
  });

  // 同一天兩段點滴以前只印一次（`visitNames()` 會去重）。改成一段一條之後
  // 兩段就是兩條 —— 那正是她要看到的。
  test('同一天做兩次同樣的就是兩條，不去重', () => {
    const twice = visit({
      slots: [
        { startsAt: '09:00', endsAt: '10:00', courseId: 'c-ilib' },
        { startsAt: '14:00', endsAt: '15:00', courseId: 'c-ilib' },
      ],
    });
    assert.equal(monthBars(twice, MASTER).length, 2);
  });

  test('一段都沒有的來訪仍然畫得出來 —— 不然那一天整個不見', () => {
    const bars = monthBars(visit({ slots: [] }), MASTER);
    assert.equal(bars.length, 1);
    assert.equal(bars[0].title, '客戶一');
    assert.equal(bars[0].id, 'v1');
    assert.equal(bars[0].sortKey, null);
  });

  test('狀態的顏色與已刪除的旗標每一條都帶著', () => {
    const gone = visit({ status: 'cancelled', deletedAt: 'x' });
    for (const bar of monthBars(gone, MASTER)) {
      assert.equal(bar.kind, 'status-cancelled');
      assert.equal(bar.deletedAt, 'x');
      assert.equal(bar.category, 'visit');
      assert.equal(bar.startDate, '2026-09-18');
      assert.equal(bar.endDate, '2026-09-18');
    }
  });

  test('沒有名字的客戶印一個問號，不是 undefined', () => {
    assert.equal(monthBars(visit({ customerName: null }), MASTER)[0].title.startsWith('?'), true);
  });
});


// 2026-09-08：診間也有兩格名字了。日／週那一列跟月曆一樣是「她自己看」的
// 地方，一格只放得下幾個字，所以印簡寫；設定頁與試算表印全名。
describe('那一列的診間印簡寫', () => {
  test('有簡寫就印簡寫', () => {
    const [row] = agendaFor([visit({
      slots: [{ startsAt: '10:00', endsAt: '11:00', courseName: '營養點滴', roomId: 'r-iv2' }],
    })], '2026-09-18', CTX);
    assert.equal(row.room, '.2');
  });

  // ADR-0079：健檢那六個課程改成「都不用」之後，既有來訪身上的 `roomId`
  // 留著不動 —— 不畫這件事只能發生在畫的時候（`showsRoom()`）。
  test('不要診間的課程一律不印，資料上那個 id 一個字都不動', () => {
    const master = {
      courses: [{ id: 'c-checkup', name: '健檢', assigns: 'none' }],
      equipment: [],
    };
    const [row] = agendaFor([visit({
      slots: [{ startsAt: '09:00', endsAt: '11:00', courseId: 'c-checkup', roomId: 'r-3' }],
    })], '2026-09-18', { ...CTX, master });
    assert.equal(row.room, null, '健檢不該印診間');
    assert.equal(row.roomId, 'r-3', '資料上那個 id 照樣帶出來');
  });

  test('沒給 master 就照印 —— 認不出課程時少印比多印糟', () => {
    const [row] = agendaFor([visit({
      slots: [{ startsAt: '09:00', endsAt: '11:00', courseId: 'c-checkup', roomId: 'r-3' }],
    })], '2026-09-18', CTX);
    assert.equal(row.room, '治3');
  });

  test('沒設簡寫就退回全名 —— 治療室本來就夠短', () => {
    const [row] = agendaFor([visit({
      slots: [{ startsAt: '10:00', endsAt: '11:00', courseName: '健檢', roomId: 'r-3' }],
    })], '2026-09-18', CTX);
    assert.equal(row.room, '治3');
  });

  test('診間被刪掉了就是 null，不要印一個猜的', () => {
    const [row] = agendaFor([visit({
      slots: [{ startsAt: '10:00', endsAt: '11:00', courseName: '健檢', roomId: 'gone' }],
    })], '2026-09-18', CTX);
    assert.equal(row.room, null);
  });
});

describe('日曆逐段上色（ADR-0081）', () => {
  const v = {
    id: 'v1', customerId: 'c1', customerName: '王小明', date: '2026-09-20',
    status: 'confirmed',
    slots: [
      { startsAt: '10:30', endsAt: '11:30', courseName: '復能', status: 'confirmed' },
      { startsAt: '11:30', endsAt: '12:00', courseName: '復能', status: 'cancelled' },
    ],
  };

  test('月檢視：取消掉的那一條自己暗掉，其餘不動', () => {
    const bars = monthBars(v, {});
    assert.equal(bars.length, 2);
    assert.notEqual(bars[0].kind, bars[1].kind, '兩條的顏色要分得出來');
    assert.equal(bars[1].kind, statusClass('cancelled'));
  });

  test('日／週那一列：每一列帶自己那一段的狀態', () => {
    const rows = agendaFor([v], '2026-09-20', { includeCancelled: true });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'confirmed');
    assert.equal(rows[1].status, 'cancelled');
  });

  test('舊來訪（沒有 slot.status）每一列還是整筆那一個', () => {
    const legacy = { ...v, slots: [{ startsAt: '10:30', courseName: '復能' }] };
    assert.equal(agendaFor([legacy], '2026-09-20')[0].status, 'confirmed');
    assert.equal(monthBars(legacy, {})[0].kind, statusClass('confirmed'));
  });
});

// 她 2026-09-08：「我修改課程設定的，例如要不要簽療程單或是寫記錄，
// 這個提醒不會更新誒？」
//
// 集中派生本身沒問題（`domain/consequences.js` 全部是純函式、全部現算），
// 壞的是**三個畫面漏傳 `coursesById`**：待辦中心兩處、進度追蹤一處。
//
// 沒傳的話 `formSlotIndexes(visit, {})` 拿不到課程，而 `needsForm(undefined)`
// 回 `true`（沒有欄位就是要簽）—— 於是那三頁**一律**寫「簽療程單」，
// 就算她已經把那個課程的開關關掉了。
//
// **展開（`...data`）算數**：日曆與客戶詳情把整包 ctx 攤進去，而那一包裡
// 本來就有。所以那一種呼叫端改成要求「這個檔案裡真的有組過那一份」——
// 進度追蹤壞掉時整支檔案一次都沒出現過 `coursesById`，這一條抓得到它。
test('每一個開讀取卡片的畫面都帶著 coursesById 與 master', () => {
  const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
  const PAGES = [
    'js/ui/views/calendar.js',
    'js/ui/views/customerDetail.js',
    'js/ui/views/home.js',
    'js/ui/views/progress.js',
  ];

  const CALL = 'visitReadHtml(';

  for (const rel of PAGES) {
    const src = read(rel);
    let at = src.indexOf(CALL);
    let found = 0;

    while (at >= 0) {
      // 那一支自己的定義（`export function visitReadHtml(`）不算，
      // 註解裡提到的 `visitReadHtml()` 也不算（那一種括號裡是空的）
      const isDefinition = src.slice(Math.max(0, at - 20), at).includes('function');
      const isProse = src[at + CALL.length] === ')';
      if (!isDefinition && !isProse) {
        const args = src.slice(at, at + 700);
        const spreads = args.includes('...');
        found += 1;

        for (const key of ['coursesById', 'master']) {
          const ok = args.includes(key) || (spreads && src.includes(`${key}:`));
          assert.ok(ok, `${rel} 有一處 visitReadHtml() 拿不到 ${key}`
            + (key === 'coursesById'
              ? ' —— 那一頁會一律說「簽療程單」，不管她把那個勾關掉了沒有'
              : ' —— 那一頁會寫「復能」而日曆上寫「SIS(60)」'));
        }
      }
      at = src.indexOf(CALL, at + 1);
    }

    // 這一支測試最危險的失敗方式是「一個呼叫端都沒找到、於是永遠綠」
    assert.ok(found > 0, `${rel} 找不到任何 visitReadHtml() 呼叫端 —— 這支測試失效了`);
  }
});
