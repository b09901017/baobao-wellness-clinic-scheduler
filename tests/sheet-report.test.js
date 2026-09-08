// 試算表報表。SPEC 第 4.8 節。
//
// 這一支盯的是「報表不能騙人」：次數要跟客戶詳情頁算出來的一樣，
// 勾選格要對得上日期，而且逗號、引號、換行不可以把表格拆散 ——
// 錯位的報表比沒有報表更糟，因為她會照著它去對帳。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  customerReport, toTSV, toCSV, READONLY_NOTICE, syncBundle, describeSync,
  equipmentCells,
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

  assert.equal(bundle.format, 4);
  assert.equal(bundle.sheets.length, 1);

  const sheet = bundle.sheets[0];
  assert.deepEqual(sheet.dates, ['2026-08-01', '2026-08-20']);
  assert.deepEqual(sheet.rows[0].marks, ['✓', '△']);
  assert.equal(sheet.rows[0].done, 1);
  assert.equal(sheet.rows[0].booked, 1);
  assert.equal(sheet.rows[0].remaining, 10);
  assert.deepEqual(sheet.totals, { total: 12, done: 1, booked: 1, remaining: 10 });
});

// ADR-0057 + 格式 3：營養品自己一區，不進矩陣也不進合計。
// 留在矩陣裡的話那四個數字欄印的是月數，而「應有 2 已完成 0 已排未上 0 剩餘 2」
// 沒有一個看得懂 —— 2026-08-27 她選了「排版乾淨」那一條。
test('營養品自己一區，不進矩陣也不進合計', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: {
      c1: [
        { id: 'e1', label: '復能', totalQty: 12 },
        {
          id: 'p1', type: 'product', label: '營養品 5,000（夜態美＋GABA）', totalQty: 2,
          amountTwd: 5000,
          items: [{ productId: 'prod-1', name: '夜態美' }, { productId: 'prod-2', name: 'GABA' }],
          deliveries: [{ at: '2026-08-05', productIds: ['prod-1', 'prod-2'] }],
        },
      ],
    },
    visitsBy: { c1: [] },
    today: '2026-08-10',
    generatedAt: '2026/8/10',
  });

  const sheet = bundle.sheets[0];
  assert.deepEqual(sheet.rows.map((r) => r.label), ['復能'], '矩陣裡沒有營養品');
  assert.deepEqual(sheet.totals, { total: 12, done: 0, booked: 0, remaining: 12 });

  assert.equal(sheet.products.length, 1);
  assert.equal(sheet.products[0].amount, 5000);
  assert.equal(sheet.products[0].months, 2);
  assert.deepEqual(sheet.products[0].items, ['夜態美', 'GABA']);
  assert.equal(sheet.products[0].done, true);
  // 送過去的已經是她舊表上那種寫法（`docs/legacy/README.md` 第 6 節），
  // 不是 ISO —— 貼上那條路印的也是這個，兩條路必須長一樣。
  assert.equal(sheet.products[0].deliveredAt, '8/5');
});

test('還沒給的營養品講得出「還沒給」', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: {
      c1: [{
        id: 'p1', type: 'product', label: '營養品（夜態美）', totalQty: 1,
        items: [{ productId: 'prod-1', name: '夜態美' }],
      }],
    },
    visitsBy: { c1: [] },
    today: '2026-08-10',
  });

  const p = bundle.sheets[0].products[0];
  assert.equal(p.done, false);
  assert.equal(p.delivery, '還沒給');
  assert.equal(p.deliveredAt, null);
  assert.equal(p.amount, null, '沒填金額就是 null，不是 0');
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

// ---------- 自動同步的狀態（.scratch/first-real-import/issues/02） ----------
//
// 2026-08-21 第一次真的部署 `.gs`：每一次推送都在丟例外，而畫面上一個字都沒說。
// 她唯一發現的方法是手動按「立刻推一次」—— 因為只有那條路會把錯誤顯示出來。

describe('自動同步現在該說哪一句', () => {
  test('沒設定就說沒開，不要講成失敗', () => {
    const { tone, lines } = describeSync({ configured: false });
    assert.equal(tone, 'off');
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes('失敗'));
  });

  test('「還沒推」和「推了但被拒絕」不可以講成同一句', () => {
    const waiting = describeSync({ configured: true, lastAtLabel: '8/21 10:00', dirty: true });
    const failed = describeSync({
      configured: true, lastAtLabel: '8/21 10:00', dirty: true,
      error: '很抱歉，你無法凍結僅包含部分合併儲存格的欄。', errorAtLabel: '8/21 10:05',
    });

    assert.equal(waiting.tone, 'waiting');
    assert.equal(failed.tone, 'failed');
    assert.ok(failed.lines.some((l) => l.includes('被拒絕')));
    assert.ok(failed.lines.some((l) => l.includes('無法凍結')), '原文要看得到，不然她修不了');
    // 有錯誤時就不要再說「安靜幾秒會自己再推一次」—— 那是騙人的，它推了，被擋了
    assert.ok(!failed.lines.some((l) => l.includes('自己再推')));
  });

  test('推失敗要說清楚資料本身沒事（ADR-0013）', () => {
    const { lines } = describeSync({ configured: true, error: '密鑰不對' });
    assert.ok(lines.some((l) => l.includes('app 裡是安全的')));
  });

  test('`.gs` 說有幾張沒更新，就要講出是哪幾張', () => {
    const { tone, lines } = describeSync({
      configured: true, lastAtLabel: '8/21 10:00', skipped: ['客戶A', '王小明'],
    });
    // 推成功了，但那兩位的次數是舊的 —— 跟「全部推好了」不是同一件事
    assert.equal(tone, 'partial');
    assert.ok(lines.some((l) => l.includes('客戶A') && l.includes('王小明')));
  });

  test('一切正常就只說上次同步是什麼時候', () => {
    const { tone, lines } = describeSync({ configured: true, lastAtLabel: '8/21 10:00' });
    assert.equal(tone, 'ok');
    assert.deepEqual(lines, ['上次同步 8/21 10:00']);
  });

  test('沒推過也要有一句話，不要留空白', () => {
    const { lines } = describeSync({ configured: true });
    assert.ok(lines[0].includes('還沒推過'));
  });
});

// ---------- 加約的三返、四返 ----------
//
// 她的原話：「試算表紀錄的部分就是，和二返一樣紀錄在健檢預約的下面，
// 有二返(...) 三返(...)」。
//
// 收攏在同一格是**刻意的**，而且它決定了「要不要動 SYNC_FORMAT」：
// 形狀不變（`{dateIndex, text}`）→ `.gs` 不用重貼、她不用重新部署。

const NL = String.fromCharCode(10);

const nthWorld = (extra = []) => syncBundle({
  customers: [{ id: 'c1', name: '客戶A' }],
  entitlementsBy: {
    c1: [
      { id: 'e-chk', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1 },
      { id: 'e-fu', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'e-chk', totalQty: 1 },
    ],
  },
  visitsBy: {
    c1: [
      { id: 'v-exam', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e-chk' }] },
      {
        id: 'v-2nd', date: '2026-08-08', status: 'confirmed',
        slots: [{ entitlementId: 'e-fu', doctorId: 'st-xia', followupForVisitId: 'v-exam' }],
      },
      ...extra,
    ],
  },
  today: '2026-08-10',
  master: {
    courses: [
      { id: 'course-checkup', name: '健檢', followupCourseId: 'course-followup' },
      { id: 'course-followup', name: '二返' },
    ],
    staff: [{ id: 'st-xia', name: '夏', role: '醫師' }, { id: 'st-li', name: '李', role: '醫師' }],
  },
});

test('三返接在二返底下，**同一格**、照返數由小到大', () => {
  const bundle = nthWorld([
    {
      id: 'v-4th', date: '2026-10-08', status: 'confirmed',
      slots: [{ entitlementId: null, followupNth: 4, doctorId: 'st-li', followupForVisitId: 'v-exam' }],
    },
    {
      id: 'v-3rd', date: '2026-09-20', status: 'confirmed',
      slots: [{ entitlementId: null, followupNth: 3, doctorId: 'st-xia', followupForVisitId: 'v-exam' }],
    },
  ]);

  const notes = bundle.sheets[0].followupNotes;
  assert.equal(notes.length, 1, '**一欄只能有一筆** —— 手動貼上那條路是直接寫進格子，第二筆會蓋掉第一筆');
  assert.equal(notes[0].dateIndex, 0, '對齊健檢那一欄');
  assert.equal(notes[0].text, ['8/8 二返(夏)', '9/20 三返(夏)', '10/8 四返(李)'].join(NL));
});

test('**還沒約的 n返 不會出現**（二返的空括號留著，理由不一樣）', () => {
  const notes = nthWorld().sheets[0].followupNotes;
  assert.equal(notes[0].text, '8/8 二返(夏)');
  assert.equal(notes[0].text.includes('三返'), false,
    '「沒有三返」是常態不是待辦 —— 印一個空的三返() 等於每張表都多一行永遠做不完的事');
});

test('約了但醫師還沒定的 n返 印空括號 —— 那一種空括號是有意義的', () => {
  const notes = nthWorld([{
    id: 'v-3rd', date: '2026-09-20', status: 'confirmed',
    slots: [{ entitlementId: null, followupNth: 3, doctorId: null, followupForVisitId: 'v-exam' }],
  }]).sheets[0].followupNotes;

  assert.equal(notes[0].text, ['8/8 二返(夏)', '9/20 三返()'].join(NL));
});

test('取消掉的 n返 不印 —— 那一場沒發生', () => {
  const notes = nthWorld([{
    id: 'v-3rd', date: '2026-09-20', status: 'cancelled',
    slots: [{ entitlementId: null, followupNth: 3, doctorId: 'st-li', followupForVisitId: 'v-exam' }],
  }]).sheets[0].followupNotes;

  assert.equal(notes[0].text, '8/8 二返(夏)');
});

test('**n返 不進矩陣**：它沒有額度，所以那幾個數字欄一個都不會動', () => {
  const sheet = nthWorld([{
    id: 'v-3rd', date: '2026-09-20', status: 'confirmed',
    slots: [{ entitlementId: null, followupNth: 3, doctorId: 'st-li', followupForVisitId: 'v-exam' }],
  }]).sheets[0];

  const second = sheet.rows.find((r) => r.label.startsWith('二返'));
  assert.deepEqual(
    { total: second.total, done: second.done, booked: second.booked, remaining: second.remaining },
    { total: 1, done: 0, booked: 1, remaining: 0 },
    '三返不可以被算進二返那一筆額度',
  );
  assert.equal(sheet.rows.length, 2, '三返不會自己多一列 —— 她要的是「記在健檢預約的下面」');
});

test('手動貼上那條路要跟自動推送長一樣（同一格、同一組換行）', () => {
  const { rows } = customerReport({
    customer: { id: 'c1', name: '客戶A' },
    entitlements: [
      { id: 'e-chk', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1 },
      { id: 'e-fu', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'e-chk', totalQty: 1 },
    ],
    visits: [
      { id: 'v-exam', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e-chk' }] },
      {
        id: 'v-2nd', date: '2026-08-08', status: 'confirmed',
        slots: [{ entitlementId: 'e-fu', doctorId: 'st-xia', followupForVisitId: 'v-exam' }],
      },
      {
        id: 'v-3rd', date: '2026-09-20', status: 'confirmed',
        slots: [{ entitlementId: null, followupNth: 3, doctorId: 'st-li', followupForVisitId: 'v-exam' }],
      },
    ],
    courses: [
      { id: 'course-checkup', name: '健檢', followupCourseId: 'course-followup' },
      { id: 'course-followup', name: '二返' },
    ],
    staff: [{ id: 'st-xia', name: '夏', role: '醫師' }, { id: 'st-li', name: '李', role: '醫師' }],
  });

  // 這一條路的產物會經過 toTSV()，而它把換行換成空白 —— 所以**一返一列**，
  // 同一欄往下疊。自動推送那條路是一格兩行，看起來是一樣的東西。
  const second = rows.find((r) => r.some((cell) => String(cell).includes('二返(夏)')));
  const third = rows.find((r) => r.some((cell) => String(cell).includes('三返(李)')));
  assert.ok(second && third, `兩列都要在，實際：${JSON.stringify(rows)}`);
  assert.equal(second[5], '8/8 二返(夏)', '對齊健檢那一欄');
  assert.equal(third[5], '9/20 三返(李)', '接在正下方，同一欄');
  assert.equal(rows.indexOf(third), rows.indexOf(second) + 1, '三返緊接在二返底下');
});


// 她 2026-09-06：「如果是選四選一那筆，那他一樣是扣四選一，但是我希望能像二返
// 那些註記一樣，就是在當天的那一列下面，可以註記是 ILIB sis indiba 等等，
// 如果是直接選 ILIB 或是直接選 sis indiba 那就扣那個，然後不用註記」。
describe('這一天用了哪一台', () => {
  const EQUIPMENT = [
    { id: 'eq-sis', name: '超磁場', shortName: 'SIS', courseId: 'c-recovery' },
    { id: 'eq-indiba', name: 'INDIBA', courseId: 'c-recovery' },
    { id: 'eq-ilib', name: 'ILIB', courseId: 'c-ilib' },
  ];
  const four = {
    id: 'e-four', type: 'pool', label: '復能四選一(60)', totalQty: 10,
    optionEquipmentIds: ['eq-sis', 'eq-indiba', 'eq-ilib'],
  };
  const one = {
    id: 'e-one', type: 'pool', label: '超磁場(60)', totalQty: 5,
    optionEquipmentIds: ['eq-sis'],
  };
  const visit = (id, date, entitlementId, equipmentId) => ({
    id, date, status: 'done', slots: [{ entitlementId, equipmentId }],
  });
  const dates = ['2026-09-01', '2026-09-08'];
  const visits = [
    visit('v1', '2026-09-01', 'e-four', 'eq-sis'),
    visit('v2', '2026-09-08', 'e-four', 'eq-ilib'),
    visit('v3', '2026-09-08', 'e-one', 'eq-sis'),
  ];

  test('得選的池才註記，寫的是別稱', () => {
    assert.deepEqual(equipmentCells(four, visits, dates, EQUIPMENT), [
      { dateIndex: 0, text: 'SIS' },
      { dateIndex: 1, text: 'ILIB' },
    ]);
  });

  test('單台的池不註記 —— 那一列的名字已經講了是哪一台', () => {
    assert.deepEqual(equipmentCells(one, visits, dates, EQUIPMENT), []);
  });

  test('single 型態也不註記', () => {
    const single = { id: 'e-s', type: 'single', label: '健檢', courseId: 'c-checkup' };
    assert.deepEqual(equipmentCells(single, visits, dates, EQUIPMENT), []);
  });

  test('同一天兩段用頓號接，不要蓋掉一個', () => {
    const two = [{
      id: 'v9', date: '2026-09-01', status: 'done',
      slots: [
        { entitlementId: 'e-four', equipmentId: 'eq-sis' },
        { entitlementId: 'e-four', equipmentId: 'eq-indiba' },
      ],
    }];
    assert.deepEqual(equipmentCells(four, two, dates, EQUIPMENT), [
      { dateIndex: 0, text: 'SIS、INDIBA' },
    ]);
  });

  test('器材對不到主檔就不亂印一個 id', () => {
    const gone = [visit('v1', '2026-09-01', 'e-four', 'eq-gone')];
    assert.deepEqual(equipmentCells(four, gone, dates, EQUIPMENT), []);
  });

  test('貼上那條路：註記接在那一筆額度的正下方', () => {
    const out = customerReport({
      customer: { name: '客戶A' },
      entitlements: [four, one],
      visits,
      equipment: EQUIPMENT,
    });
    const at = out.rows.findIndex((r) => r[0] === '復能四選一(60)');
    assert.ok(at > 0);
    // 前五欄留白，日期欄放別稱
    assert.deepEqual(out.rows[at + 1].slice(0, 5), ['', '', '', '', '']);
    assert.deepEqual(out.rows[at + 1].slice(5), ['SIS', 'ILIB']);
    // 單台那一筆底下不接
    const single = out.rows.findIndex((r) => r[0] === '超磁場(60)');
    assert.notEqual(out.rows[single + 1]?.[5], 'SIS');
  });

  test('推送那條路：帶得出是第幾列 —— 兩筆同名的額度也分得開', () => {
    const bundle = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: { c1: [four, one] },
      visitsBy: { c1: visits },
      today: '2026-09-10',
      master: { equipment: EQUIPMENT },
    });
    const notes = bundle.sheets[0].equipmentNotes;
    assert.equal(notes.length, 1, '只有得選的那一筆');
    assert.equal(notes[0].rowIndex, 0);
    assert.equal(notes[0].label, '復能四選一(60)');
    assert.deepEqual(notes[0].cells.map((c) => c.text), ['SIS', 'ILIB']);
  });
});


describe('版本對不上要講出她該做什麼', () => {
  test('提到版本就多一句「重新貼一次並重新部署」', () => {
    const { tone, lines } = describeSync({
      configured: true,
      error: '資料格式版本是 4，這份指令碼只認得 3。請更新試算表這一側的指令碼。',
    });
    assert.equal(tone, 'failed');
    assert.ok(lines.some((l) => l.includes('重新貼一次')));
    assert.ok(lines.some((l) => l.includes('重新部署')));
  });

  test('別的失敗不講那一句 —— 那會把她帶去做一件沒有用的事', () => {
    const { lines } = describeSync({ configured: true, error: '試算表回了 500' });
    assert.ok(!lines.some((l) => l.includes('重新貼一次')));
  });
});

describe('那一天的符號逐段算（ADR-0081）', () => {
  const build = (slots, status) => customerReport({
    customer: customer(),
    entitlements: [ent()],
    visits: [visit({ status, slots })],
  });

  test('一筆已完成、其中一段沒來 → 那一格看得出兩種結果', () => {
    // 2026-09-08 之前這裡讀的是**整筆**的狀態，所以兩段都印 ✓ ——
    // `mark()` 自己的註解寫著這件事還沒做。
    const { rows } = build([
      { entitlementId: 'e1', attended: true, status: 'done' },
      { entitlementId: 'e1', attended: false, status: 'no_show' },
    ], 'done');
    assert.equal(rowOf(rows, '復能').at(-1), '✓✗');
  });

  test('取消掉的那一段不印符號', () => {
    const { rows } = build([
      { entitlementId: 'e1', status: 'confirmed' },
      { entitlementId: 'e1', status: 'cancelled' },
    ], 'confirmed');
    assert.equal(rowOf(rows, '復能').at(-1), '△', '只剩活著的那一段');
  });

  test('舊資料（沒有 slot.status）印出來的字一個都沒變', () => {
    const { rows } = build([{ entitlementId: 'e1' }, { entitlementId: 'e1' }], 'done');
    assert.equal(rowOf(rows, '復能').at(-1), '✓2');
  });
});
