// 舊資料匯入只跑得了一趟（prelaunch-fixes-2026-10-08/issues/01、02）。
//
// 合併檔只匯這一次。重複的客戶刪得掉，他身上的來訪不會跟著刪，app 也沒有刪來訪的路（ADR-0089）——
// 所以「按兩次」「失敗後重按」在這一頁的代價跟別頁不一樣。
// fixture 全部是編出來的（客戶A、客戶B）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMAT, canRun, looseDocs, looseLeft, eventKind, importCaveats, planForCustomer, extraPicksLeft,
} from '../public/js/domain/mergeImport.js';
import { SEED } from '../public/js/domain/seed.js';

describe('「開始匯入」現在按不按得下去', () => {
  test('有人要建、沒有在跑 → 按得下去', () => {
    assert.equal(canRun({ running: false, customers: 2 }), true);
  });

  test('正在跑（確認框開著也算）→ 按不下去', () => {
    assert.equal(canRun({ running: true, customers: 2 }), false);
  });

  test('跑完、每一位都匯好了（重算之後一位都不用建）→ 按不下去', () => {
    assert.equal(canRun({ running: false, customers: 0 }), false);
  });

  test('有人失敗（重算之後剩那幾位）→ 還重試得了', () => {
    assert.equal(canRun({ running: false, customers: 1 }), true);
  });
});

// ---------------------------------------------------------------------------
// 02：失敗之後重按，雜事不可以多一份；確認框要講「對不到主檔幾處、同名跳過幾位」
// ---------------------------------------------------------------------------

const CTX = (over = {}) => ({
  courses: SEED.courses,
  equipment: SEED.equipment,
  ivProducts: SEED.ivProducts,
  rooms: SEED.rooms,
  staff: SEED.staff,
  existingCustomers: [],
  today: '2026-10-12',
  ...over,
});

const person = (name) => ({
  sheetName: name,
  name,
  entitlements: [{ key: 'r8', type: 'single', label: 'ILIB 60mins', totalQty: 12, courseName: 'ILIB', optionEquipmentNames: [] }],
  visits: [{ date: '2026-09-01', status: 'done', slots: [{ entitlementKey: 'r8', courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00' }] }],
});

const EVENTS = [
  { title: '休', startDate: '2026-10-20', endDate: '2026-10-20', allDay: true, kind: 'leave' },
  { title: '交收據', startDate: '2026-10-21', endDate: '2026-10-21', allDay: true, kind: 'note' },
  { title: '尾牙', startDate: '2026-10-22', endDate: '2026-10-22', allDay: true, kind: 'personal' },
];
const kindOf = (i) => eventKind(EVENTS[i]);

describe('雜事寫完就不再寫第二次', () => {
  test('looseDocs() 講得出每一筆是檔案裡的第幾列（寫完才清得掉那幾個勾）', () => {
    const loose = looseDocs(EVENTS, kindOf, [0, 1, 2]);
    assert.deepEqual(loose.eventIndexes, [0, 2]);
    assert.deepEqual(loose.noteIndexes, [1]);
    assert.equal(loose.events.length, loose.eventIndexes.length);
    assert.equal(loose.notes.length, loose.noteIndexes.length);
  });

  test('一位失敗 → 重按：兩類都寫完了，重試時一筆雜事都沒有', () => {
    const first = looseDocs(EVENTS, kindOf, [0, 1, 2]);
    const left = looseLeft([0, 1, 2], [...first.eventIndexes, ...first.noteIndexes]);
    const again = looseDocs(EVENTS, kindOf, left);
    assert.equal(again.events.length + again.notes.length, 0);
  });

  test('行事備註寫完、待辦那一批失敗 → 重按：只剩待辦，行事備註不會多一份', () => {
    const first = looseDocs(EVENTS, kindOf, [0, 1, 2]);
    // 只清已經寫的那一類。整個清掉的話待辦就安靜地少匯了
    const left = looseLeft([0, 1, 2], first.eventIndexes);
    const again = looseDocs(EVENTS, kindOf, left);
    assert.equal(again.events.length, 0);
    assert.equal(again.notes.length, 1);
    assert.equal(again.notes[0].text, '交收據');
  });

  test('一批寫到一半（前 1 筆進去了）→ 只清進去的那 1 筆', () => {
    const first = looseDocs(EVENTS, kindOf, [0, 1, 2]);
    const left = looseLeft([0, 1, 2], first.eventIndexes.slice(0, 1));
    assert.deepEqual(left, [1, 2]);
  });
});

describe('客戶都寫完、只剩雜事沒寫進去：還重試得了', () => {
  test('這一趟匯過了、還有雜事沒寫 → 按得下去', () => {
    assert.equal(canRun({ running: false, customers: 0, loose: 2, resumed: true }), true);
  });

  test('重新整理再貼一次（沒有匯過的記號）、每一位都同名跳過 → 照舊按不下去', () => {
    // 那一份檔案的雜事預設又全部勾著。按得下去的話整份雜事多一份
    assert.equal(canRun({ running: false, customers: 0, loose: 2, resumed: false }), false);
  });

  test('正在跑 → 怎樣都按不下去', () => {
    assert.equal(canRun({ running: true, customers: 0, loose: 2, resumed: true }), false);
  });
});

describe('確認框與完成提示：對不到主檔幾處、同名跳過幾位', () => {
  /** 一位買了單一台 SIS 的復能，一位買四選一。 */
  const FILE = {
    format: FORMAT,
    customers: [
      {
        sheetName: '客戶A',
        name: '客戶A',
        entitlements: [{ key: 'r7', type: 'pool', label: 'SIS(60)', totalQty: 10, courseName: null, optionEquipmentNames: ['SIS'] }],
        visits: [{ date: '2026-09-01', status: 'done', slots: [{ entitlementKey: 'r7', courseName: '復能', equipmentName: 'SIS', startsAt: '10:00', endsAt: '11:00' }] }],
      },
      person('客戶B'),
    ],
  };
  const plansWith = (ctx) => FILE.customers.map((c) => planForCustomer(c, ctx, FILE));

  test('每一樣都對得到、沒有人同名：一個字都不多', () => {
    const c = importCaveats(plansWith(CTX()));
    assert.deepEqual(c.lines, []);
    assert.equal(c.problems.length, 0);
    assert.equal(c.skipped.length, 0);
  });

  test('器材還叫舊名：講幾處、講後果（匯完補不回來）', () => {
    const equipment = SEED.equipment.map((e) => (e.id === 'eq-sis' ? { ...e, name: '超磁場' } : e));
    const plans = plansWith(CTX({ equipment }));
    const c = importCaveats(plans);
    // 那一筆額度整筆沒進來，它底下那一段也跟著沒進來
    assert.ok(c.problems.length >= 2, `對不到的有 ${c.problems.length} 處`);
    assert.equal(c.lines.length, 1);
    assert.match(c.lines[0], new RegExp(`${c.problems.length} 處對不到主檔`));
    assert.match(c.lines[0], /補不回來/);
    assert.match(c.lines[0], /資料健檢/);
  });

  test('勾起來要補的那幾筆對不到的也算進同一個數字', () => {
    const plans = plansWith(CTX());
    const extra = [{ where: '2026-09-03 客戶A', raw: '沒有這門課', why: '主檔裡沒有這個課程，這一筆沒有補進去' }];
    assert.equal(importCaveats(plans, extra).problems.length, 1);
  });

  test('系統裡已經有客戶A：講跳過 1 位', () => {
    const c = importCaveats(plansWith(CTX({ existingCustomers: [{ name: '客戶A' }] })));
    assert.equal(c.skipped.length, 1);
    assert.equal(c.lines.length, 1);
    assert.match(c.lines[0], /1 位.*同名.*跳過/);
  });

  test('句子裡沒有函式名、沒有英文識別字', () => {
    const equipment = SEED.equipment.map((e) => (e.id === 'eq-sis' ? { ...e, name: '超磁場' } : e));
    const c = importCaveats(plansWith(CTX({ equipment, existingCustomers: [{ name: '客戶B' }] })));
    assert.equal(c.lines.length, 2);
    for (const line of c.lines) assert.doesNotMatch(line, /[A-Za-z_]{3,}\(|planFor|byName/);
  });
});

describe('勾起來要補的來訪：那位客戶進去了就不用再勾著', () => {
  const EXTRAS = [
    { customerName: '客戶A', date: '2026-09-03', courseName: 'ILIB' },
    { customerName: '客戶B', date: '2026-09-04', courseName: 'ILIB' },
    { customerName: ' 客戶A ', date: '2026-09-05', courseName: 'ILIB' },
  ];

  test('客戶A 進去了、客戶B 失敗：只剩客戶B 的那一筆', () => {
    assert.deepEqual(extraPicksLeft(EXTRAS, [0, 1, 2], ['客戶A']), [1]);
  });

  test('一位都沒進去：照舊全部勾著', () => {
    assert.deepEqual(extraPicksLeft(EXTRAS, [0, 1], []), [0, 1]);
  });
});
