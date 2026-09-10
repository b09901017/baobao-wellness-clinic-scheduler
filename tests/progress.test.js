// 進度追蹤頁的資料整理。
//
// 這一頁唯讀，所以它不會弄壞資料 —— 但它會**騙人**：漏掉一段、把狀態畫錯、
// 或是跟日曆說的不一樣，她就會照著一份錯的東西去對帳。
// 這裡盯的就是「畫出來的跟資料庫裡的是同一件事」。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildProgress, PROGRESS_STATUSES } from '../public/js/domain/progress.js';
import { slotStatus, VISIT_STATUSES, statusClass } from '../public/js/domain/visits.js';

const MONTH = '2026-08';

const cus = (id, name, over = {}) => ({ id, name, ...over });

const visit = (over = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-08-10',
  status: 'confirmed', slots: [slot()], ...over,
});

const slot = (over = {}) => ({
  entitlementId: 'e1', courseName: '復能', startsAt: '09:15', endsAt: '10:15', ...over,
});

const build = (customers, visits, month = MONTH) =>
  buildProgress({ customers, visits, month });

describe('挑出這個月的東西', () => {
  test('月份範圍算得對，前後一天都不多不少', () => {
    const { range } = build([], []);
    assert.deepEqual(range, { from: '2026-08-01', to: '2026-08-31' });
  });

  test('上個月與下個月的來訪不列進來', () => {
    const { rows, totals } = build([cus('c1', '客戶A')], [
      visit({ id: 'before', date: '2026-07-31' }),
      visit({ id: 'inside', date: '2026-08-01' }),
      visit({ id: 'after', date: '2026-09-01' }),
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].days.map((d) => d.visitId), ['inside']);
    assert.equal(totals.slots, 1);
  });

  test('壞掉的月份不會爆，回一份空的', () => {
    const out = buildProgress({ customers: [cus('c1', 'A')], visits: [visit()], month: '亂寫的' });
    assert.equal(out.range, null);
    assert.deepEqual(out.rows, []);
    assert.deepEqual(out.idle, []);
  });

  test('取消與已刪除的來訪不畫 —— 日曆也不畫，兩邊要一樣多', () => {
    const { rows, idle } = build([cus('c1', '客戶A')], [
      visit({ id: 'x', status: 'cancelled' }),
      visit({ id: 'y', deletedAt: 'x' }),
    ]);
    assert.deepEqual(rows, []);
    assert.deepEqual(idle.map((c) => c.name), ['客戶A'], '沒有東西可畫就算「這個月還沒排」');
  });

  test('日期壞掉的來訪不列，也不會把整頁弄壞', () => {
    const { rows } = build([cus('c1', '客戶A')], [visit({ date: '八月十號' })]);
    assert.deepEqual(rows, []);
  });
});

describe('一位客戶一列', () => {
  test('這個月沒排的收到另一份名單裡，不佔畫面', () => {
    const { rows, idle, totals } = build(
      [cus('c1', '客戶A'), cus('c2', '客戶B')],
      [visit({ customerId: 'c1' })],
    );
    assert.deepEqual(rows.map((r) => r.customerName), ['客戶A']);
    assert.deepEqual(idle.map((c) => c.name), ['客戶B']);
    assert.equal(totals.customers, 1);
    assert.equal(totals.idle, 1);
  });

  test('已刪除的客戶兩邊都不列', () => {
    const { rows, idle } = build([cus('c1', '客戶A', { deletedAt: 'x' })], []);
    assert.deepEqual(rows, []);
    assert.deepEqual(idle, []);
  });

  test('照姓名排，換月回來順序不會跳', () => {
    const { rows, idle } = build(
      [cus('c1', '陳一'), cus('c2', '林二'), cus('c3', '王三'), cus('c4', '李四')],
      [visit({ customerId: 'c1' }), visit({ id: 'v2', customerId: 'c2' })],
    );
    assert.deepEqual(
      rows.map((r) => r.customerName),
      ['林二', '陳一'].sort((a, b) => a.localeCompare(b, 'zh-TW')),
    );
    assert.deepEqual(idle.map((c) => c.name), ['王三', '李四'].sort((a, b) => a.localeCompare(b, 'zh-TW')));
  });

  test('同一位客戶好幾天，日期由早到晚', () => {
    const { rows } = build([cus('c1', '客戶A')], [
      visit({ id: 'b', date: '2026-08-20' }),
      visit({ id: 'a', date: '2026-08-03' }),
      visit({ id: 'c', date: '2026-08-11' }),
    ]);
    assert.deepEqual(rows[0].days.map((d) => d.date),
      ['2026-08-03', '2026-08-11', '2026-08-20']);
  });

  test('來訪指到不存在的客戶時照樣畫出來，並標成孤兒', () => {
    // 看不見的壞資料比看得見的難修。資料健檢會報，但這一頁不能把那幾段吞掉。
    const { rows } = build([], [visit({ customerId: 'ghost', customerName: '找不到的人' })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].orphan, true);
    assert.equal(rows[0].customerName, '找不到的人');
  });
});

describe('每一段自己的狀態', () => {
  test('待確認、已確認、已完成分得出來', () => {
    const { rows } = build([cus('c1', '客戶A')], [
      visit({ id: 'a', date: '2026-08-01', status: 'pending_confirm' }),
      visit({ id: 'b', date: '2026-08-02', status: 'confirmed' }),
      visit({ id: 'c', date: '2026-08-03', status: 'done' }),
    ]);
    assert.deepEqual(rows[0].days.map((d) => d.slots[0].status),
      ['pending_confirm', 'confirmed', 'done']);
  });

  test('同一天做了一半：兩段狀態不一樣', () => {
    // 這正是使用者舉的那個例子（2026-08-20）
    const { rows } = build([cus('c1', '客戶A')], [visit({
      status: 'done',
      slots: [
        slot({ courseName: '復能', startsAt: '13:30', attended: true }),
        slot({ courseName: '靜脈', startsAt: '14:45', attended: false }),
      ],
    })]);
    const [first, second] = rows[0].days[0].slots;
    assert.equal(first.status, 'done');
    assert.equal(second.status, 'no_show');
    assert.deepEqual(rows[0].tally, {
      pending_confirm: 0, confirmed: 0, done: 1, no_show: 1,
    });
  });

  test('狀態的判斷跟 domain/visits.js 是同一份，不是自己抄的', () => {
    const v = visit({ status: 'done', slots: [slot({ attended: false })] });
    const { rows } = build([cus('c1', '客戶A')], [v]);
    assert.equal(rows[0].days[0].slots[0].status, slotStatus(v, v.slots[0]));
  });

  test('沒有時間的排最後，不是排在半夜', () => {
    // 匯入的舊來訪沒記過時間（ADR-0011）
    const { rows } = build([cus('c1', '客戶A')], [visit({
      slots: [
        slot({ courseName: '沒時間', startsAt: null, endsAt: null }),
        slot({ courseName: '早上', startsAt: '09:00' }),
        slot({ courseName: '下午', startsAt: '14:00' }),
      ],
    })]);
    // 那一格印的是「那天做了什麼」（`dayFor()` 算好的 `name`），
    // 沒帶主檔時退回快照 —— 這裡看的是順序，不是名字怎麼算的
    assert.deepEqual(rows[0].days[0].slots.map((s) => s.name),
      ['早上', '下午', '沒時間']);
  });

  test('沒有時間的好幾段之間，順序照原本的先後', () => {
    const { rows } = build([cus('c1', '客戶A')], [visit({
      slots: [
        slot({ courseName: '一', startsAt: null }),
        slot({ courseName: '二', startsAt: null }),
      ],
    })]);
    assert.deepEqual(rows[0].days[0].slots.map((s) => s.name), ['一', '二']);
  });
});

describe('狀態更新的時間', () => {
  test('有 statusAt 就帶出來', () => {
    const { rows } = build([cus('c1', '客戶A')],
      [visit({ statusAt: '2026-08-09T02:00:00.000Z' })]);
    assert.equal(rows[0].days[0].statusAt, '2026-08-09T02:00:00.000Z');
  });

  test('舊來訪沒有就說沒有，不要拿建立時間硬充', () => {
    // 假裝知道比承認不知道糟：她會以為那個時間是真的
    const { rows } = build([cus('c1', '客戶A')],
      [visit({ createdAt: '2026-08-01T00:00:00.000Z' })]);
    assert.equal(rows[0].days[0].statusAt, null);
  });
});

describe('合計', () => {
  test('全部加起來等於每一列加起來', () => {
    const { rows, totals } = build([cus('c1', 'A'), cus('c2', 'B')], [
      visit({ id: 'a', customerId: 'c1', status: 'pending_confirm', slots: [slot(), slot()] }),
      visit({ id: 'b', customerId: 'c2', status: 'done' }),
    ]);
    const sum = rows.reduce((n, r) => n + r.slotCount, 0);
    assert.equal(totals.slots, sum);
    assert.equal(totals.tally.pending_confirm, 2);
    assert.equal(totals.tally.done, 1);
  });

  test('沒有資料時每一格都是 0，不是 undefined', () => {
    const { totals } = build([], []);
    assert.equal(totals.slots, 0);
    for (const s of PROGRESS_STATUSES) assert.equal(totals.tally[s], 0);
  });
});

describe('和其他畫面對得上', () => {
  test('畫得出來的每一種狀態都是合法狀態，而且都有顏色', () => {
    for (const status of PROGRESS_STATUSES) {
      assert.ok(VISIT_STATUSES.includes(status), `${status} 不是合法的來訪狀態`);
      assert.ok(statusClass(status), `${status} 沒有顏色`);
    }
  });

  test('取消不在這一頁的狀態清單裡 —— 日曆也不畫它', () => {
    assert.ok(!PROGRESS_STATUSES.includes('cancelled'));
  });
});
