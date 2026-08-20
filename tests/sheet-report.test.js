// 試算表報表。SPEC 第 4.8 節。
//
// 這一支盯的是「報表不能騙人」：次數要跟客戶詳情頁算出來的一樣，
// 勾選格要對得上日期，而且逗號、引號、換行不可以把表格拆散 ——
// 錯位的報表比沒有報表更糟，因為她會照著它去對帳。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  customerReport, toTSV, toCSV, READONLY_NOTICE, syncBundle,
} from '../public/js/domain/sheetReport.js';
import { MARK_LEGEND } from '../public/js/domain/visits.js';

const TODAY = '2026-09-18';

const customer = (over = {}) => ({
  id: 'c1', name: '客戶一', source: '0522 顧客會-8',
  membershipExpiresAt: '2027-05-21', flags: ['體內金屬'], ...over,
});

const ent = (over = {}) => ({
  id: 'e1', label: '復能', totalQty: 12, doneCount: 0, bookedCount: 0, ...over,
});

const visit = (over = {}) => ({
  id: 'v1', customerId: 'c1', date: '2026-09-10', status: 'done',
  slots: [{ entitlementId: 'e1', courseName: '復能' }], ...over,
});

const header = (rows) => rows.find((r) => r[0] === '療程項目');
const rowOf = (rows, label) => rows.find((r) => r[0] === label);

describe('一位客戶一張表', () => {
  test('表頭有那句「請勿手動編輯」（SPEC 第 4.8 節）', () => {
    const { rows } = customerReport({ customer: customer(), entitlements: [ent()] });
    assert.equal(rows[0][0], READONLY_NOTICE);
  });

  test('基本資料、三段式次數與日期欄都在', () => {
    const { name, rows } = customerReport({
      customer: customer(),
      entitlements: [ent()],
      visits: [visit(), visit({ id: 'v2', date: '2026-09-24', status: 'confirmed' })],
      generatedAt: '2026-09-18 10:00',
    });

    assert.equal(name, '客戶一');
    assert.deepEqual(rowOf(rows, '購買通路'), ['購買通路', '0522 顧客會-8']);
    assert.deepEqual(rowOf(rows, '永久限制'), ['永久限制', '體內金屬']);

    assert.deepEqual(header(rows), [
      '療程項目', '應有', '已完成', '已排未上', '剩餘', '9/10(四)', '9/24(四)',
    ]);
    // 一次 done、一次 confirmed → 12 - 1 - 1 = 10。
    // 兩格的符號不一樣：她要看得出哪一次真的上了（2026-08-20）。
    assert.deepEqual(rowOf(rows, '復能'), ['復能', '12', '1', '1', '10', '✓', '△']);
  });

  test('同一天用兩次要看得出來，不是一個勾了事', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent()],
      visits: [visit({ slots: [{ entitlementId: 'e1' }, { entitlementId: 'e1' }] })],
    });
    assert.equal(rowOf(rows, '復能').at(-1), '✓2');
  });

  test('次數用現算的，計數欄位歪掉不會被抄進報表（ADR-0004）', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent({ doneCount: 99, bookedCount: 99 })],
      visits: [visit()],
    });
    assert.deepEqual(rowOf(rows, '復能').slice(1, 5), ['12', '1', '0', '11']);
  });

  test('取消、刪除的來訪不佔日期欄也不算次數', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent()],
      visits: [
        visit({ id: 'v1', status: 'cancelled' }),
        visit({ id: 'v2', date: '2026-09-11', deletedAt: 'x' }),
      ],
    });
    assert.deepEqual(header(rows), ['療程項目', '應有', '已完成', '已排未上', '剩餘']);
    assert.deepEqual(rowOf(rows, '復能'), ['復能', '12', '0', '0', '12']);
  });

  test('已刪除的額度不列，完全沒有額度時講一句話而不是留白', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent({ deletedAt: 'x' })],
    });
    assert.equal(rowOf(rows, '復能'), undefined);
    assert.ok(rows.some((r) => r[0] === '（還沒有額度）'));
  });

  test('別人的來訪不會被算進來（勾選格只認 entitlementId）', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent()],
      visits: [visit({ slots: [{ entitlementId: 'e-other' }] })],
    });
    assert.deepEqual(rowOf(rows, '復能').slice(1, 5), ['12', '0', '0', '12']);
    assert.equal(rowOf(rows, '復能').at(-1), '');
  });
});

describe('手動貼上那條路和自動推的長一樣', () => {
  // 同一份報表因為走哪條路而長得不同，她會以為其中一條壞了。
  test('二返註記落在健檢那一欄，TODO / FINISHED 兩塊都在', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [
        ent(),
        { id: 'e-chk', label: '健檢', courseId: 'course-checkup', totalQty: 1 },
        { id: 'e-fu', label: '二返', courseId: 'course-followup', followupForEntitlementId: 'e-chk', totalQty: 1 },
      ],
      visits: [
        visit({ id: 'v1', date: '2026-09-10', status: 'done', slots: [{ entitlementId: 'e-chk' }] }),
        visit({
          id: 'v2', date: '2026-09-24', status: 'confirmed',
          slots: [{ entitlementId: 'e-fu', doctorId: 'st-dr-xia' }],
        }),
      ],
      tasks: [
        { id: 't1', visitId: 'v2', kind: 'Abovee', dueDate: '2026-09-23', done: false },
        { id: 't2', visitId: 'v1', kind: 'Examine', dueDate: '2026-09-09', done: true, doneAt: '2026-09-08T00:00:00.000Z' },
      ],
      courses: [
        { id: 'course-checkup', name: '健檢', followupCourseId: 'course-followup' },
        { id: 'course-followup', name: '二返' },
      ],
      staff: [{ id: 'st-dr-xia', name: '夏', role: '醫師' }],
    });

    // 日期欄是 9/10 與 9/24，健檢在第一欄 → 註記要落在第 6 格（索引 5）
    // 括號裡的醫師手動貼上這條路也要印得出來（ADR-0026）
    const note = rows.find((r) => r.includes('9/24 二返(夏)'));
    assert.ok(note, `二返註記要在，實際：${JSON.stringify(rows)}`);
    assert.equal(note.indexOf('9/24 二返(夏)'), 5, '要對齊健檢被勾的那一欄');

    assert.ok(rows.some((r) => r[0] === 'TODO（還沒做的）'));
    assert.ok(rows.some((r) => r[0] === 'FINISHED（做完的）'));
    assert.ok(rows.some((r) => r[1] === 'Abovee'), '還沒做的要列出來');
    // 做完的看完成日，不是死線 —— 兩邊印同一個日期等於少講一件事
    assert.ok(rows.some((r) => r[1] === 'Examine' && r[2] === '2026-09-08'));
    assert.ok(rows.some((r) => r[1] === MARK_LEGEND), '圖例要印在表上');
  });

  test('沒有任務時兩塊都寫「沒有」，不要留白', () => {
    const { rows } = customerReport({ customer: customer(), entitlements: [ent()] });
    assert.equal(rows.filter((r) => r[0] === '（沒有）').length, 2);
  });
});

describe('貼上與下載的格式', () => {
  const report = { rows: [['a', 'b'], ['c', 'd']] };

  test('TSV 用定位分欄、換行分列', () => {
    assert.equal(toTSV(report), 'a\tb\nc\td');
  });

  test('儲存格裡的定位與換行換成空白，不然表格會錯位', () => {
    assert.equal(toTSV({ rows: [['前\t後', '上\n下']] }), '前 後\t上 下');
  });

  test('CSV 把逗號、引號、換行包起來，引號要跳脫', () => {
    assert.equal(toCSV({ rows: [['a,b', 'say "hi"', 'x\ny', 'plain']] }),
      '"a,b","say ""hi""","x\ny",plain');
  });

  test('空儲存格是空字串，不是 undefined 或 null', () => {
    assert.equal(toTSV({ rows: [[null, undefined, '']] }), '\t\t');
    assert.equal(toCSV({ rows: [[null, undefined, '']] }), ',,');
  });

  test('列數不同長也不會爆', () => {
    assert.equal(toTSV({ rows: [['a'], ['b', 'c']] }), 'a\nb\tc');
  });
});

// ---------- 推給 Apps Script 的整包資料 ----------
//
// 排版在 sheets/readonly-report.gs，但**數字一個都不在那裡算**。
// 這裡測的就是「送過去的數字是對的」—— 那支 .gs 沒有測試，
// 所以它拿到什麼就得是最終答案。

test('整包資料帶著三段式次數與勾選矩陣，一位客戶一份', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A', source: '0522 顧客會-8', flags: ['體內金屬'] }],
    entitlementsBy: {
      c1: [{ id: 'e1', label: '復能', totalQty: 12 }],
    },
    visitsBy: {
      c1: [
        { id: 'v1', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e1' }] },
        { id: 'v2', date: '2026-08-20', status: 'confirmed', slots: [{ entitlementId: 'e1' }] },
      ],
    },
    today: '2026-08-10',
    generatedAt: '2026/8/10',
  });

  assert.equal(bundle.format, 2);
  assert.equal(bundle.sheets.length, 1);

  const sheet = bundle.sheets[0];
  assert.deepEqual(sheet.dates, ['2026-08-01', '2026-08-20']);
  assert.deepEqual(sheet.rows[0].marks, ['✓', '△']);
  assert.equal(sheet.rows[0].done, 1);
  assert.equal(sheet.rows[0].booked, 1);
  assert.equal(sheet.rows[0].remaining, 10);
  assert.deepEqual(sheet.totals, { total: 12, done: 1, booked: 1, remaining: 10 });
});

test('三種狀態三個符號，同一格混在一起也分得出來', () => {
  // 她要的是「一眼看出這一格走到哪一步了」（2026-08-20）：
  // ○ 待確認、△ 已確認、✓ 已完成、✗ 未到。
  const marksOf = (visits) => syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: { c1: [{ id: 'e1', label: '復能', totalQty: 12 }] },
    visitsBy: { c1: visits },
    today: '2026-08-10',
  }).sheets[0].rows[0].marks;

  const one = (id, date, status, n = 1) => ({
    id, date, status, slots: Array.from({ length: n }, () => ({ entitlementId: 'e1' })),
  });

  assert.deepEqual(
    marksOf([
      one('v1', '2026-08-01', 'pending_confirm'),
      one('v2', '2026-08-02', 'confirmed'),
      one('v3', '2026-08-03', 'done'),
      one('v4', '2026-08-04', 'no_show'),
    ]),
    ['○', '△', '✓', '✗'],
  );

  // 同一天做了一次、另一次沒到 —— 挑一個代表會把另一次藏起來
  assert.deepEqual(
    marksOf([one('v1', '2026-08-01', 'done'), one('v2', '2026-08-01', 'no_show')]),
    ['✓✗'],
  );

  // 數量還是要帶，不然對帳會少算
  assert.deepEqual(marksOf([one('v1', '2026-08-01', 'done', 3)]), ['✓3']);
});

test('圖例跟著符號走，不是手寫的第二份', () => {
  const bundle = syncBundle({ customers: [], today: '2026-08-10' });
  for (const symbol of ['✓', '△', '○', '✗']) {
    assert.ok(bundle.legend.includes(symbol), `圖例少了 ${symbol}`);
  }
});

test('二返註記寫在那次健檢被勾起來的那一欄', () => {
  // 位置與寫法照她原本的（docs/legacy/README.md 第 6 節）。
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: {
      c1: [
        { id: 'e-chk', label: '健檢', courseId: 'course-checkup', totalQty: 2 },
        { id: 'e-fu', label: '二返', courseId: 'course-followup', followupForEntitlementId: 'e-chk', totalQty: 2 },
        { id: 'e1', label: '復能', totalQty: 12 },
      ],
    },
    visitsBy: {
      c1: [
        { id: 'v0', date: '2026-07-20', status: 'done', slots: [{ entitlementId: 'e1' }] },
        { id: 'v1', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e-chk' }] },
        { id: 'v2', date: '2026-08-08', status: 'confirmed', slots: [{ entitlementId: 'e-fu' }] },
        { id: 'v3', date: '2026-09-01', status: 'done', slots: [{ entitlementId: 'e-chk' }] },
      ],
    },
    today: '2026-08-10',
    master: {
      courses: [
        { id: 'course-checkup', name: '健檢', followupCourseId: 'course-followup' },
        { id: 'course-followup', name: '二返' },
      ],
    },
  });

  const sheet = bundle.sheets[0];
  // 日期欄：7/20、8/1、8/8、9/1 → 健檢在第 1 欄與第 3 欄
  assert.deepEqual(sheet.dates, ['2026-07-20', '2026-08-01', '2026-08-08', '2026-09-01']);
  assert.deepEqual(sheet.followupNotes, [
    { dateIndex: 1, text: '8/8 二返' },
    // 第二次健檢的二返還沒約 —— 空括號是她自己的寫法，意思是「這件事還沒做」
    { dateIndex: 3, text: '二返()' },
  ]);
});

test('約好的二返記了醫師就印進括號裡，沒記就整個括號不印（ADR-0026）', () => {
  // 舊表她手寫成 `7/13 二返(夏)`。醫師進 config/staff 之前 app 記不住那個字。
  const build = (doctorId) => syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: {
      c1: [
        { id: 'e-chk', label: '健檢', courseId: 'course-checkup', totalQty: 1 },
        { id: 'e-fu', label: '二返', courseId: 'course-followup', followupForEntitlementId: 'e-chk', totalQty: 1 },
      ],
    },
    visitsBy: {
      c1: [
        { id: 'v1', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e-chk' }] },
        { id: 'v2', date: '2026-08-08', status: 'confirmed', slots: [{ entitlementId: 'e-fu', doctorId }] },
      ],
    },
    today: '2026-08-10',
    master: {
      courses: [
        { id: 'course-checkup', name: '健檢', followupCourseId: 'course-followup' },
        { id: 'course-followup', name: '二返' },
      ],
      staff: [{ id: 'st-dr-xia', name: '夏', role: '醫師' }],
    },
  });

  assert.deepEqual(build('st-dr-xia').sheets[0].followupNotes, [
    { dateIndex: 0, text: '8/8 二返(夏)' },
  ]);

  // 沒選醫師時印 `8/8 二返`，**不是** `8/8 二返()` ——
  // 空括號在她的寫法裡是「還沒約」，印出來會反過來騙人
  assert.deepEqual(build(null).sheets[0].followupNotes, [
    { dateIndex: 0, text: '8/8 二返' },
  ]);
});

test('來訪紀錄裡醫師和治療師各印各的', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: { c1: [{ id: 'e-fu', label: '二返', courseId: 'course-followup', totalQty: 1 }] },
    visitsBy: {
      c1: [{
        id: 'v1', date: '2026-08-08', status: 'confirmed',
        slots: [{
          entitlementId: 'e-fu', courseId: 'course-followup', courseName: '二返',
          startsAt: '14:00', endsAt: '14:30', roomId: 'r-t3',
          therapistId: null, doctorId: 'st-dr-xia',
        }],
      }],
    },
    today: '2026-08-10',
    master: {
      courses: [{ id: 'course-followup', name: '二返' }],
      rooms: [{ id: 'r-t3', name: '治3' }],
      staff: [{ id: 'st-dr-xia', name: '夏', role: '醫師' }],
    },
  });

  const item = bundle.sheets[0].log[0].items[0];
  assert.equal(item.doctor, '夏');
  assert.equal(item.therapist, null, '二返沒有治療師，不要拿醫師去補那一格');
});

test('沒有配對規則就沒有二返註記，不要硬生一句出來', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: { c1: [{ id: 'e1', label: '復能', courseId: 'course-recovery', totalQty: 12 }] },
    visitsBy: { c1: [{ id: 'v1', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e1' }] }] },
    today: '2026-08-10',
    master: { courses: [{ id: 'course-recovery', name: '復能' }] },
  });
  assert.deepEqual(bundle.sheets[0].followupNotes, []);
});

test('TODO 與 FINISHED 分兩塊，日期取來訪那一天而且不黏在一起', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: { c1: [{ id: 'e1', label: '0.75萬健檢', totalQty: 2 }] },
    visitsBy: {
      c1: [{
        id: 'v1', date: '2026-08-06', status: 'confirmed',
        slots: [{ entitlementId: 'e1', courseName: '0.75萬健檢' }],
      }],
    },
    tasksBy: {
      c1: [
        { id: 't1', visitId: 'v1', kind: 'Examine', dueDate: '2026-08-05', done: false },
        { id: 't2', visitId: 'v1', kind: '打電話', dueDate: '2026-08-05', done: true, doneAt: '2026-08-04T01:00:00.000Z' },
        { id: 't3', visitId: 'v1', kind: 'Abovee', dueDate: '2026-08-05', done: false, deletedAt: 'x' },
      ],
    },
    today: '2026-08-01',
  });

  const { todo, finished } = bundle.sheets[0].tasks;
  assert.equal(todo.length, 1, '已刪除的任務不列');
  // 舊表寫成 `7/60.75萬健檢`，兩個數字黏在一起讀不出來 —— 中間要有空白
  assert.equal(todo[0].label, '8/6 0.75萬健檢');
  assert.equal(todo[0].kind, 'Examine');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].kind, '打電話');
});

test('獨立待辦沒有來訪可以查，退回用死線，不要印 undefined', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: { c1: [] },
    visitsBy: { c1: [] },
    tasksBy: { c1: [{ id: 't1', visitId: null, kind: '約二返', dueDate: '2026-08-09', done: false }] },
    today: '2026-08-01',
  });
  assert.equal(bundle.sheets[0].tasks.todo[0].label, '8/9');
});

test('來訪紀錄把 id 換成名字，匯入的來訪顯示成時間不詳', () => {
  // 匯入的來訪沒有時間、器材、診間、治療師（ADR-0011）。
  // 那些欄位在試算表上要寫「時間不詳」而不是留白 —— 留白看起來像壞掉。
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: { c1: [{ id: 'e1', label: '復能', totalQty: 2 }] },
    visitsBy: {
      c1: [{
        id: 'v1',
        date: '2026-08-01',
        status: 'done',
        slots: [
          {
            entitlementId: 'e1', courseName: '復能', startsAt: '09:15', endsAt: '10:15',
            roomId: 'room-t3', therapistId: 'staff-zn', equipmentId: 'eq-indiba',
          },
          { entitlementId: 'e1', courseName: '復能', startsAt: null, endsAt: null },
        ],
      }],
    },
    today: '2026-08-10',
    master: {
      rooms: [{ id: 'room-t3', name: '治3' }],
      staff: [{ id: 'staff-zn', name: '芝寧' }],
      equipment: [{ id: 'eq-indiba', name: 'INDIBA' }],
    },
  });

  const day = bundle.sheets[0].log[0];
  assert.equal(day.items[0].room, '治3');
  assert.equal(day.items[0].therapist, '芝寧');
  assert.equal(day.items[0].equipment, 'INDIBA');
  assert.equal(day.items[0].time, '09:15–10:15');
  assert.equal(day.items[1].time, '時間不詳');
});

test('取消與軟刪除的來訪不進整包資料', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }, { id: 'c2', name: '客戶B', deletedAt: 'x' }],
    entitlementsBy: { c1: [{ id: 'e1', label: '復能', totalQty: 5 }] },
    visitsBy: {
      c1: [
        { id: 'v1', date: '2026-08-01', status: 'cancelled', slots: [{ entitlementId: 'e1' }] },
        { id: 'v2', date: '2026-08-02', status: 'done', deletedAt: 'x', slots: [{ entitlementId: 'e1' }] },
      ],
    },
    today: '2026-08-10',
  });

  assert.equal(bundle.sheets.length, 1, '刪掉的客戶不該出現');
  assert.deepEqual(bundle.sheets[0].dates, []);
  assert.deepEqual(bundle.sheets[0].log, []);
});
