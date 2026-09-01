// 「今天做了什麼」。ADR-0062。
//
// 這一頁的價值全部在**歸類對不對**：她開它是為了確認「有沒有漏掉登記」，
// 而一則落錯段、或是被安靜地丟掉，正好毀掉那個用途。
//
// 素材是既有的稽核紀錄，一則都不多寫（SPEC 第 6.2 節）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { reviewOf, dayTitle } from '../public/js/domain/dayReview.js';

/** 一則稽核。`after` 是這一次寫進去的那幾欄，`before` 是寫之前。 */
const ev = (action, { before = {}, after = {}, at = 'T' } = {}) => ({
  action, before, after, at, targetPath: `${action.split('.')[0]}/x`,
});

/** 那一段裡的句子。 */
const textsOf = (review, id) =>
  review.groups.find((g) => g.stage.id === id)?.rows.map((r) => r.text) ?? [];

const idsOf = (review) => review.groups.map((g) => g.stage.id);

describe('照她的流程分段', () => {
  test('新增一筆來訪 → 壓表', () => {
    const review = reviewOf([ev('visits.create', {
      after: { customerName: '客戶A', date: '2026-09-03', status: 'pending_confirm' },
    })]);
    assert.deepEqual(idsOf(review), ['book']);
    assert.deepEqual(textsOf(review, 'book'), ['新增客戶A的來訪']);
  });

  test('狀態改成已確認 → 跟客人確認', () => {
    const review = reviewOf([ev('visits.update', {
      before: { customerName: '客戶A', status: 'pending_confirm' },
      after: { status: 'confirmed' },
    })]);
    assert.deepEqual(idsOf(review), ['confirm']);
  });

  test('「禮拜一再問問」也算在跟客人確認那一段', () => {
    const review = reviewOf([ev('visits.update', {
      before: { customerName: '客戶A', followupNote: null },
      after: { followupNote: '禮拜一再問問' },
    })]);
    assert.deepEqual(idsOf(review), ['confirm']);
  });

  test('狀態改成已完成／未到 → 簽療程單', () => {
    for (const status of ['done', 'no_show']) {
      const review = reviewOf([ev('visits.update', {
        before: { customerName: '客戶A', status: 'confirmed' },
        after: { status },
      })]);
      assert.deepEqual(idsOf(review), ['close'], status);
    }
  });

  test('狀態改成已取消 → 取消與改期', () => {
    const review = reviewOf([ev('visits.update', {
      before: { customerName: '客戶A', status: 'confirmed' },
      after: { status: 'cancelled' },
    })]);
    assert.deepEqual(idsOf(review), ['cancel']);
  });

  test('刪掉一筆來訪也算在取消那一段', () => {
    const review = reviewOf([ev('visits.softDelete', {
      before: { customerName: '客戶A' },
      after: { deletedAt: 'T' },
    })]);
    assert.deepEqual(idsOf(review), ['cancel']);
  });

  test('勾掉一張任務 → 登記掛號；**取消勾選不算**', () => {
    const ticked = reviewOf([ev('tasks.update', {
      before: { customerName: '客戶A', kind: 'Examine', done: false },
      after: { done: true },
    })]);
    assert.deepEqual(idsOf(ticked), ['register']);

    // 取消勾選是把一件事放回去，不是做完它 —— 落到「其他」，但不可以消失。
    const unticked = reviewOf([ev('tasks.update', {
      before: { customerName: '客戶A', kind: 'Examine', done: true },
      after: { done: false },
    })]);
    assert.deepEqual(idsOf(unticked), ['other']);
  });

  test('隨手記與行事備註 → 日曆與待辦', () => {
    const review = reviewOf([
      ev('notes.create', { after: { text: '幫王小明問週六' } }),
      ev('events.create', { after: { title: '宜蘭休假', category: 'leave' } }),
    ]);
    assert.deepEqual(idsOf(review), ['calendar']);
    assert.equal(textsOf(review, 'calendar').length, 2);
  });

  test('客戶與額度各自落在同一段', () => {
    const review = reviewOf([
      ev('customers.update', { before: { name: '客戶A', phone: '1' }, after: { phone: '2' } }),
      ev('customers/abc/entitlements.create', { after: { label: '8萬健檢', totalQty: 1 } }),
    ]);
    assert.deepEqual(idsOf(review), ['customer']);
  });

  test('主檔設定自己一段', () => {
    const review = reviewOf([ev('config/courses.create', { after: { name: '復能' } })]);
    assert.deepEqual(idsOf(review), ['settings']);
  });

  test('問時間那三種收在同一段', () => {
    const review = reviewOf([
      ev('formInvites.create', { after: { customerName: '客戶A' } }),
      ev('formResponses.update', { before: { customerName: '客戶A' }, after: { accepted: true } }),
      ev('customers/abc/availability.create', { after: { collectedAt: '2026-09-01' } }),
    ]);
    assert.deepEqual(idsOf(review), ['ask']);
    assert.equal(textsOf(review, 'ask').length, 3);
  });

  test('段落照流程排，不照進來的順序', () => {
    const review = reviewOf([
      ev('config/courses.create', { after: { name: '復能' } }),
      ev('visits.create', { after: { customerName: '客戶A' } }),
      ev('formInvites.create', { after: { customerName: '客戶B' } }),
    ]);
    assert.deepEqual(idsOf(review), ['ask', 'book', 'settings']);
  });
});

describe('一則都不可以被丟掉', () => {
  test('對不上的落進「其他」', () => {
    const review = reviewOf([ev('batches.update', {
      before: { cursor: 1 }, after: { cursor: 2 },
    })]);
    assert.deepEqual(idsOf(review), ['other']);
  });

  test('總數等於進去的筆數', () => {
    const rows = [
      ev('visits.create', { after: { customerName: '客戶A' } }),
      ev('batches.update', { before: { cursor: 1 }, after: { cursor: 2 } }),
      ev('notes.create', { after: { text: '一件事' } }),
      ev('config/rooms.create', { after: { name: '治3' } }),
    ];
    const review = reviewOf(rows);
    assert.equal(review.total, rows.length);
    assert.equal(review.groups.reduce((n, g) => n + g.n, 0), rows.length);
  });

  test('空的段不出現', () => {
    assert.deepEqual(reviewOf([]).groups, []);
    assert.deepEqual(reviewOf([]).tiles, []);
  });
});

describe('連著一樣的句子收成一則', () => {
  const tick = (kind = 'Examine') => ev('tasks.update', {
    before: { customerName: '客戶A', kind, done: false },
    after: { done: true },
  });

  test('連著三則收成一則，寫 ×3', () => {
    const review = reviewOf([tick(), tick(), tick()]);
    const rows = review.groups[0].rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].times, 3);
    assert.equal(review.groups[0].n, 3, '收合前的筆數要留著給摘要數字用');
  });

  test('**中間隔了別的就不收** —— 早上勾三張、下午又勾兩張是兩件事', () => {
    const other = ev('tasks.update', {
      before: { customerName: '客戶B', kind: 'Examine', done: false },
      after: { done: true },
    });
    const rows = reviewOf([tick(), other, tick()]).groups[0].rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.times === 1));
  });

  test('收成一則之後時間留最早那一下 —— 那是她開始做那件事的時間', () => {
    const rows = reviewOf([
      { ...tick(), at: '16:05' },
      { ...tick(), at: '16:03' },
      { ...tick(), at: '16:01' },
    ]).groups[0].rows;
    assert.equal(rows[0].at, '16:01');
  });
});

describe('頂端那一排數字', () => {
  test('只印有值的那幾顆', () => {
    const review = reviewOf([
      ev('visits.create', { after: { customerName: '客戶A' } }),
      ev('visits.create', { after: { customerName: '客戶B' } }),
      ev('notes.create', { after: { text: '一件事' } }),
    ]);
    assert.deepEqual(review.tiles.map((t) => [t.id, t.n]), [['book', 2], ['calendar', 1]]);
  });

  test('數的是收合前的筆數 —— 連著壓三筆就是三筆', () => {
    const one = ev('visits.create', { after: { customerName: '客戶A' } });
    assert.equal(reviewOf([one, one, one]).tiles[0].n, 3);
  });
});

describe('撈到上限要講出來', () => {
  test('不講的話她會以為那幾筆沒發生（SPEC 第 6.9 節）', () => {
    const rows = Array.from({ length: 5 }, () =>
      ev('visits.create', { after: { customerName: '客戶A' } }));
    assert.equal(reviewOf(rows, { limit: 5 }).truncated, true);
    assert.equal(reviewOf(rows, { limit: 6 }).truncated, false);
    assert.equal(reviewOf(rows).truncated, false, '沒給上限就不講');
  });
});

describe('那一天的抬頭', () => {
  test('今天寫「今天」，別天寫日期', () => {
    assert.equal(dayTitle('2026-09-01', '2026-09-01'), '今天');
    assert.equal(dayTitle('2026-08-31', '2026-09-01'), '8 月 31 日');
  });

  test('讀不出來不要編一個', () => {
    assert.equal(dayTitle(null, '2026-09-01'), '？');
  });
});
