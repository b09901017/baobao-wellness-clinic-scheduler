// 日曆。SPEC 第 8.6 節。
//
// 這一支盯的是「格子不能錯位」與「那天的事不能漏」：
// 月檢視少補一列、或是週的起點算錯一天，畫面上看起來都很正常，
// 但她會照著一個錯的日子去壓表。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  weekStart, weekDays, monthWeeks, rangeOf, moveBy, titleOf,
  agendaFor, summaryByDate, WEEKDAY_HEADERS, VIEWS,
} from '../public/js/domain/calendar.js';

const visit = (over = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '客戶一', date: '2026-09-18',
  status: 'confirmed',
  slots: [{ startsAt: '10:30', endsAt: '11:30', courseName: '復能', therapistId: 's1' }],
  ...over,
});

const CTX = {
  roomsById: { 'r-3': { name: '治3' } },
  staffById: { s1: { name: '治療師甲' }, s2: { name: '治療師乙' } },
};

describe('週與月的格子', () => {
  test('一週從禮拜日開始', () => {
    // 2026-09-18 是禮拜五
    assert.equal(weekStart('2026-09-18'), '2026-09-13');
    assert.equal(weekStart('2026-09-13'), '2026-09-13');
    assert.deepEqual(weekDays('2026-09-18')[6], '2026-09-19');
    assert.equal(weekDays('2026-09-18').length, 7);
  });

  test('表頭是日一二三四五六', () => {
    assert.deepEqual(WEEKDAY_HEADERS, ['日', '一', '二', '三', '四', '五', '六']);
  });

  test('月的格子補滿前後兩端，每一列都是七格', () => {
    const weeks = monthWeeks('2026-09');
    assert.ok(weeks.every((w) => w.length === 7));
    assert.equal(weeks[0][0].date, '2026-08-30'); // 9/1 是禮拜二，前面補兩天
    assert.equal(weeks[0][0].inMonth, false);
    assert.equal(weeks[0][2].date, '2026-09-01');
    assert.equal(weeks[0][2].inMonth, true);

    const last = weeks[weeks.length - 1];
    assert.ok(last.some((d) => d.date === '2026-09-30'));
    assert.ok(last.some((d) => !d.inMonth), '月底之後也要補到週末');
  });

  test('整月剛好塞滿幾週時不會多補一列空的', () => {
    // 2026-02 的 1 號是禮拜日、28 號是禮拜六，剛好四週
    const weeks = monthWeeks('2026-02');
    assert.equal(weeks.length, 4);
    assert.equal(weeks[0][0].date, '2026-02-01');
    assert.equal(weeks[3][6].date, '2026-02-28');
  });

  test('亂寫的月份回空陣列，不要湊出一個月曆', () => {
    for (const bad of ['', null, '2026-13', 'x']) assert.deepEqual(monthWeeks(bad), []);
  });
});

describe('每個檢視要讀哪一段', () => {
  test('日只讀那一天，週讀七天，月連補的日子一起讀', () => {
    assert.deepEqual(rangeOf('day', '2026-09-18'), { from: '2026-09-18', to: '2026-09-18' });
    assert.deepEqual(rangeOf('week', '2026-09-18'), { from: '2026-09-13', to: '2026-09-19' });
    assert.deepEqual(rangeOf('month', '2026-09-18'), { from: '2026-08-30', to: '2026-10-03' });
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
    assert.equal(titleOf('day', '2026-09-18'), '2026 年 9/18(五)');
    assert.equal(titleOf('week', '2026-09-18'), '9/13(日) – 9/19(六)');
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

  test('別天的、取消的、刪除的都不出現', () => {
    const rows = agendaFor([
      visit({ id: 'v1', date: '2026-09-17' }),
      visit({ id: 'v2', status: 'cancelled' }),
      visit({ id: 'v3', deletedAt: 'x' }),
    ], '2026-09-18', CTX);
    assert.equal(rows.length, 0);
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

describe('每天的摘要', () => {
  test('數來訪、數時段，等回覆的另外數', () => {
    const summary = summaryByDate([
      visit(),
      visit({ id: 'v2', customerName: '客戶二', status: 'pending_confirm',
        slots: [{ startsAt: '14:00' }, { startsAt: '15:15' }] }),
      visit({ id: 'v3', date: '2026-09-19' }),
    ]);

    assert.equal(summary['2026-09-18'].visits, 2);
    assert.equal(summary['2026-09-18'].slots, 3);
    assert.equal(summary['2026-09-18'].pending, 1);
    assert.deepEqual(summary['2026-09-18'].names, ['客戶一', '客戶二']);
    assert.equal(summary['2026-09-19'].visits, 1);
  });

  test('取消與刪除的不算，沒有那天就是沒有那個鍵', () => {
    const summary = summaryByDate([
      visit({ status: 'cancelled' }),
      visit({ id: 'v2', deletedAt: 'x' }),
    ]);
    assert.deepEqual(summary, {});
  });
});
