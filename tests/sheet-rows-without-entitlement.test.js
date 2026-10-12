// 試算表：沒有額度的段在矩陣裡有自己一列（2026-10-06）。
//
// 她的原話：
//
// > 我發現如果我寫功醫門診，會出現在來訪清單那邊沒錯但是不會出現在表格裡，當天的日期會全是空的 ?
// > 能不能如果我有選到功醫門診或是那些不算次數的，可以有標註或是直接表格的療程項目多一個他
//
// 成因：日期欄從這位客戶所有還算數的來訪來，列只從額度來 —— 一段沒有額度的來訪
// （不算次數的課，ADR-0121）有日期欄、沒有任何一列可以打符號。額度後來被刪掉的那幾段也是。
//
// **n返 2026-10-07 起也在這裡**（issue 14，ADR-0131）。01 刻意沒收：ADR-0063 那張表寫著它不進矩陣
// （她 9 月要的是「記在健檢預約的下面」）。問她要不要也自己一列，她回「好自己一列」；
// 健檢底下那一行「要留」、三返與四返「各自一列」。所以同一場三返在表上出現兩次，那是她要的。
//
// 最下面那一組是不變量 —— 她說「試算表的正確與否對我來說很重要」，而這個洞正是
// 「每一段都該落在某一格」這件事從來沒有人釘過。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { syncBundle, customerReport } from '../public/js/domain/sheetReport.js';
import { MARK_ORDER } from '../public/js/domain/visits.js';
import { loadAppsScript } from './helpers/appsScriptStub.js';

const TODAY = '2026-10-06';

const COURSES = [
  { id: 'fm', name: '功醫門診', uncounted: true },
  { id: 'hrv', name: 'HRV', uncounted: true },
  { id: 'nc', name: '營養師諮詢', uncounted: true },
  { id: 'rc', name: '復能', requiresEquipment: true },
  { id: 'il', name: 'ILIB' },
  { id: 'exam', name: '健檢', followupCourseId: 'fu' },
  { id: 'fu', name: '二返' },
];
const MASTER = {
  courses: COURSES,
  equipment: [{ id: 'eq-a', name: 'SIS', courseId: 'rc' }, { id: 'eq-b', name: 'INDIBA', shortName: 'IN', courseId: 'rc' }],
  staff: [{ id: 'd1', name: '夏', role: '醫師' }],
  rooms: [], ivProducts: [],
};

const E_POOL = { id: 'e-pool', type: 'pool', label: '復能-二選一(60)', totalQty: 12, optionEquipmentIds: ['eq-a', 'eq-b'] };
const E_EXAM = { id: 'e-exam', label: '健檢', courseId: 'exam', totalQty: 1 };
const E_FU = { id: 'e-fu', label: '二返', courseId: 'fu', totalQty: 1, followupForEntitlementId: 'e-exam' };
const E_NC = { id: 'e-nc', label: '營養師諮詢', courseId: 'nc', totalQty: 4 };

const free = (courseId, over = {}) => ({
  entitlementId: null, courseId, courseName: COURSES.find((c) => c.id === courseId)?.name,
  startsAt: '15:00', endsAt: '15:30', status: 'done', ...over,
});
const pool = (over = {}) => ({
  entitlementId: 'e-pool', courseId: 'rc', courseName: '復能', equipmentId: 'eq-a',
  startsAt: '10:00', endsAt: '11:00', status: 'done', ...over,
});
const day = (date, slots, over = {}) => ({
  id: `v-${date}`, customerId: 'c1', date, status: over.status ?? 'done', slots, ...over,
});

const build = (visits, entitlements = [E_POOL]) => syncBundle({
  customers: [{ id: 'c1', name: '客戶A' }],
  entitlementsBy: { c1: entitlements },
  visitsBy: { c1: visits },
  today: TODAY,
  master: MASTER,
}).sheets[0];

const rowOf = (sheet, label) => sheet.rows.find((r) => r.label === label);
const markOn = (sheet, label, date) => rowOf(sheet, label)?.marks[sheet.dates.indexOf(date)];

describe('不算次數的課：自己一列', () => {
  test('那一天只做功醫門診：那一欄在「功醫門診（不算次數）」那一列有 ✓', () => {
    const sheet = build([day('2026-10-01', [free('fm')])]);
    assert.equal(markOn(sheet, '功醫門診（不算次數）', '2026-10-01'), '✓');
  });

  test('「應有」「剩餘」是一槓、「已完成」「已排未上」是實際的次數', () => {
    const sheet = build([
      day('2026-10-01', [free('fm')]),
      day('2026-10-08', [free('fm', { status: 'confirmed' })], { status: 'confirmed' }),
      day('2026-10-15', [free('fm', { status: 'pending_confirm' })], { status: 'pending_confirm' }),
    ]);
    const row = rowOf(sheet, '功醫門診（不算次數）');
    assert.deepEqual(
      { total: row.total, done: row.done, booked: row.booked, remaining: row.remaining },
      { total: '—', done: 1, booked: 2, remaining: '—' },
    );
    assert.deepEqual(row.marks, ['✓', '△', '○']);
  });

  test('合計那四個數字一個都不變（它不是一筆額度）', () => {
    const base = [day('2026-09-30', [pool()])];
    const before = build(base);
    const after = build([...base, day('2026-10-01', [free('fm')]), day('2026-10-02', [free('hrv')])]);
    assert.deepEqual(after.totals, before.totals);
    assert.deepEqual(after.totals, { total: 12, done: 1, booked: 0, remaining: 11 });
  });

  test('同一天 SIS（有額度）＋功醫門診：兩個符號各在各的列、各一次', () => {
    const sheet = build([day('2026-10-01', [pool(), free('fm')])]);
    assert.equal(markOn(sheet, '復能-二選一(60)', '2026-10-01'), '✓');
    assert.equal(markOn(sheet, '功醫門診（不算次數）', '2026-10-01'), '✓');
  });

  test('一門課一列：HRV 與功醫門診各自一列，接在所有額度列的後面（照名字排，跟那一天誰先做無關）', () => {
    const sheet = build([day('2026-10-01', [free('hrv', { startsAt: '14:30' }), free('fm')])]);
    assert.deepEqual(sheet.rows.map((r) => r.label), ['復能-二選一(60)', '功醫門診（不算次數）', 'HRV（不算次數）']);
    assert.deepEqual(sheet.rows.map((r) => Boolean(r.extra)), [false, true, true]);
  });

  test('一筆額度都沒有的客戶（邀來體驗的）：矩陣只有那兩列、合計四個 0', () => {
    const sheet = build([day('2026-10-01', [free('hrv'), free('fm')])], []);
    assert.deepEqual(sheet.rows.map((r) => r.label), ['功醫門診（不算次數）', 'HRV（不算次數）']);
    assert.deepEqual(sheet.totals, { total: 0, done: 0, booked: 0, remaining: 0 });
  });

  test('取消的段不出現；一門課只剩取消的段時整列不長', () => {
    const sheet = build([
      day('2026-10-01', [pool(), free('fm', { status: 'cancelled' })]),
    ]);
    assert.deepEqual(sheet.rows.map((r) => r.label), ['復能-二選一(60)']);
  });

  test('未到的那一段印 ✗，不算已完成也不算已排未上', () => {
    const sheet = build([day('2026-10-01', [free('fm', { status: 'no_show' })], { status: 'no_show' })]);
    const row = rowOf(sheet, '功醫門診（不算次數）');
    assert.deepEqual(row.marks, ['✗']);
    assert.deepEqual([row.done, row.booked], [0, 0]);
  });

  test('名字讀主檔：她之後把那門課改名，還是一列', () => {
    const sheet = build([
      day('2026-10-01', [free('fm', { courseName: '功能醫學門診' })]),
      day('2026-10-08', [free('fm')]),
    ]);
    assert.deepEqual(sheet.rows.filter((r) => r.extra).map((r) => r.label), ['功醫門診（不算次數）']);
    assert.equal(rowOf(sheet, '功醫門診（不算次數）').done, 2);
  });

  test('主檔找不到那門課：退回那一段身上的快照', () => {
    const sheet = build([day('2026-10-01', [free('gone-course', { courseName: '舊的課' })])]);
    assert.ok(rowOf(sheet, '舊的課（不算次數）'));
  });
});

describe('這一行會不會讓一段不算次數的被算進某一筆額度，或反過來', () => {
  // 她之後會自己勾營養師諮詢「不算次數」，而既有客戶身上有那門課的額度（ADR-0121）：
  // 選那一筆額度排的照舊扣，選「不扣次數」那一顆排的不扣。
  const viaEnt = { entitlementId: 'e-nc', courseId: 'nc', courseName: '營養師諮詢', startsAt: '09:00', status: 'done' };

  test('選額度排的在額度那一列（照扣）、選不扣那一顆排的在「（不算次數）」那一列', () => {
    const sheet = build([
      day('2026-10-01', [viaEnt]),
      day('2026-10-08', [free('nc')]),
    ], [E_NC]);

    const counted = rowOf(sheet, '營養師諮詢');
    assert.deepEqual([counted.total, counted.done, counted.remaining], [4, 1, 3]);
    assert.deepEqual(counted.marks, ['✓', '']);

    const uncounted = rowOf(sheet, '營養師諮詢（不算次數）');
    assert.deepEqual([uncounted.total, uncounted.done, uncounted.remaining], ['—', 1, '—']);
    assert.deepEqual(uncounted.marks, ['', '✓']);
  });
});

describe('額度被刪掉的那幾段', () => {
  test('指著一筆對不到的額度：照課程收成一列「（額度已刪除）」', () => {
    const orphan = { entitlementId: 'e-deleted', courseId: 'il', courseName: 'ILIB', startsAt: '11:00', status: 'done' };
    const sheet = build([day('2026-10-01', [orphan]), day('2026-10-08', [{ ...orphan, entitlementId: 'e-deleted-2' }])]);
    const row = rowOf(sheet, 'ILIB（額度已刪除）');
    assert.deepEqual(row.marks, ['✓', '✓']);
    assert.deepEqual([row.total, row.done, row.remaining], ['—', 2, '—']);
    assert.deepEqual(sheet.totals, { total: 12, done: 0, booked: 0, remaining: 12 }, '不進合計');
  });

  test('不算次數的那幾列排在額度被刪的那幾列前面', () => {
    const orphan = { entitlementId: 'e-deleted', courseId: 'il', courseName: 'ILIB', status: 'done' };
    const sheet = build([day('2026-10-01', [orphan, free('fm')])]);
    assert.deepEqual(sheet.rows.filter((r) => r.extra).map((r) => r.label), ['功醫門診（不算次數）', 'ILIB（額度已刪除）']);
  });
});

describe('n返 也自己一列（issue 14，ADR-0131；健檢底下那一行照舊）', () => {
  const exam = day('2026-09-01', [{ entitlementId: 'e-exam', courseId: 'exam', courseName: '健檢', status: 'done' }]);
  const second = day('2026-09-08', [{
    entitlementId: 'e-fu', courseId: 'fu', courseName: '二返', followupForVisitId: exam.id, doctorId: 'd1', status: 'done',
  }]);
  const nth = (date, n, over = {}) => day(date, [{
    entitlementId: null, courseId: 'fu', courseName: `${n === 3 ? '三' : '四'}返`, followupNth: n,
    followupForVisitId: exam.id, doctorId: 'd1', status: 'confirmed', ...over,
  }], { status: over.status ?? 'confirmed' });

  test('那一天只做三返：那一欄在「三返（不算次數）」那一列有符號；健檢底下那一行照舊', () => {
    const sheet = build([exam, nth('2026-09-20', 3)], [E_EXAM, E_FU]);
    assert.deepEqual(sheet.rows.map((r) => r.label), ['健檢', '二返', '三返（不算次數）']);
    assert.equal(markOn(sheet, '三返（不算次數）', '2026-09-20'), '△');
    assert.ok(sheet.followupNotes[0].text.includes('9/20 三返(夏)'), '照舊寫在健檢那一欄底下');
  });

  test('「應有」「剩餘」是一槓、「已完成」「已排未上」是實際的次數；合計不變', () => {
    const before = build([exam, second], [E_EXAM, E_FU]);
    const sheet = build([exam, second, nth('2026-09-20', 3, { status: 'done' }), nth('2026-10-20', 3)], [E_EXAM, E_FU]);
    const row = rowOf(sheet, '三返（不算次數）');
    assert.deepEqual([row.total, row.done, row.booked, row.remaining, row.extra], ['—', 1, 1, '—', true]);
    assert.deepEqual(sheet.totals, before.totals);
  });

  test('三返、四返各自一列，照返數排，各自的符號在各自那一天', () => {
    const sheet = build([exam, nth('2026-10-20', 4), nth('2026-09-20', 3, { status: 'done' })], [E_EXAM, E_FU]);
    assert.deepEqual(sheet.rows.map((r) => r.label), ['健檢', '二返', '三返（不算次數）', '四返（不算次數）']);
    assert.equal(markOn(sheet, '三返（不算次數）', '2026-09-20'), '✓');
    assert.equal(markOn(sheet, '三返（不算次數）', '2026-10-20'), '');
    assert.equal(markOn(sheet, '四返（不算次數）', '2026-10-20'), '△');
  });

  test('這一行會不會讓一段 n返 被算進二返那一筆額度，或反過來：二返那一列的數字一個都不變', () => {
    const numbers = (sheet) => { const r = rowOf(sheet, '二返'); return [r.total, r.done, r.booked, r.remaining, r.marks.join('|')]; };
    const before = build([exam, second], [E_EXAM, E_FU]);
    const after = build([exam, second, nth('2026-09-20', 3, { status: 'done' })], [E_EXAM, E_FU]);
    assert.deepEqual(numbers(after).slice(0, 4), numbers(before).slice(0, 4));
    assert.equal(markOn(after, '二返', '2026-09-20'), '', '三返那一天，二返那一列是空的');
  });

  test('取消的三返不出現；只剩取消的三返時整列不長', () => {
    const sheet = build([exam, nth('2026-09-20', 3, { status: 'cancelled' })], [E_EXAM, E_FU]);
    assert.deepEqual(sheet.rows.map((r) => r.label), ['健檢', '二返']);
  });

  test('n返 那幾列排在不算次數的課前面、額度被刪的那幾列最後', () => {
    const sheet = build([
      exam, nth('2026-09-20', 3),
      day('2026-09-21', [free('fm')]),
      day('2026-09-22', [{ entitlementId: 'e-deleted', courseId: 'il', courseName: 'ILIB', status: 'done' }]),
    ], [E_EXAM, E_FU]);
    assert.deepEqual(sheet.rows.map((r) => r.label),
      ['健檢', '二返', '三返（不算次數）', '功醫門診（不算次數）', 'ILIB（額度已刪除）']);
  });

  test('手動貼上那條路：同一列，接在額度列後面', () => {
    const { rows } = customerReport({
      customer: { id: 'c1', name: '客戶A' }, entitlements: [E_EXAM, E_FU],
      visits: [exam, nth('2026-09-20', 3)], courses: COURSES, staff: MASTER.staff,
    });
    const at = rows.findIndex((r) => r[0] === '三返（不算次數）');
    assert.deepEqual(rows[at], ['三返（不算次數）', '—', '0', '1', '—', '', '△']);
    assert.equal(rows[at - 1][0], '二返');
  });
});

describe('註記列的位置不受影響', () => {
  test('「這一天用了哪一台」與「記了什麼」的 rowIndex 指的還是額度那幾列', () => {
    const sheet = build([day('2026-10-01', [pool({ note: '她說下午比較好' }), free('fm')])]);
    assert.deepEqual(sheet.equipmentNotes.map((n) => n.rowIndex), [0]);
    assert.deepEqual(sheet.slotNotes.map((n) => n.rowIndex), [0]);
  });
});

describe('手動貼上那條路長得一樣', () => {
  test('多的那一列接在額度列後面，四個數字欄是 一槓／次數／次數／一槓', () => {
    const { rows } = customerReport({
      customer: { id: 'c1', name: '客戶A' },
      entitlements: [E_POOL],
      visits: [day('2026-10-01', [pool(), free('fm')])],
      courses: COURSES, equipment: MASTER.equipment,
    });
    const at = rows.findIndex((r) => r[0] === '功醫門診（不算次數）');
    assert.deepEqual(rows[at], ['功醫門診（不算次數）', '—', '1', '0', '—', '✓']);
    assert.ok(at > rows.findIndex((r) => r[0] === '復能-二選一(60)'));
  });

  test('一筆額度都沒有：「（還沒有額度）」那一列照舊在，底下接那幾列', () => {
    const { rows } = customerReport({
      customer: { id: 'c1', name: '客戶A' }, entitlements: [],
      visits: [day('2026-10-01', [free('fm')])], courses: COURSES,
    });
    const none = rows.findIndex((r) => r[0] === '（還沒有額度）');
    assert.ok(none > 0);
    assert.equal(rows[none + 1][0], '功醫門診（不算次數）');
  });
});

describe('現在那一份 .gs 直接畫得出來（不升 SYNC_FORMAT、她不用重貼）', () => {
  const render = (bundle) => {
    const app = loadAppsScript();
    const reply = app.post({ token: 'secret', bundle });
    assert.equal(reply.ok, true, reply.error);
    return app.ss.getSheetByName('客戶A');
  };
  const bundleOf = (visits, entitlements = [E_POOL]) => syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: { c1: entitlements }, visitsBy: { c1: visits },
    today: TODAY, generatedAt: '2026/10/6', master: MASTER,
  });

  test('那一列畫在額度列底下，一槓照寫、✓ 在那一天那一欄', () => {
    const sheet = render(bundleOf([day('2026-10-01', [free('fm')])]));
    // 第 5 列是表頭、第 6 列是那一筆額度、第 7 列是多的那一列
    assert.deepEqual(
      ['A7', 'B7', 'C7', 'D7', 'E7', 'F7'].map((a) => sheet.at(a)),
      ['功醫門診（不算次數）', '—', 1, 0, '—', '✓'],
    );
  });

  test('「剩餘」那一格不會被當成 0 塗成紅的；「已完成」照樣有底色', () => {
    const sheet = render(bundleOf([day('2026-10-01', [free('fm')])]));
    // 顏色照 `.gs` 的 COLOR：剩餘 0 是 #FFCDD2、已完成是 #C8E6C9。隔列的底色不算
    assert.notEqual(sheet.backgrounds.get('E7'), '#FFCDD2', '一槓不是 0');
    assert.equal(sheet.backgrounds.get('C7'), '#C8E6C9', '做過一次：已完成那一格照樣上色');
    assert.equal(sheet.backgrounds.get('F7'), '#C8E6C9', '那一天那一格是 ✓ 的顏色');
  });

  test('第二列那句合計不把它算進去', () => {
    const sheet = render(bundleOf([day('2026-10-01', [free('fm')])]));
    assert.match(String(sheet.at('C2')), /合計　應有 12　已完成 0　已排未上 0　剩餘 12/);
  });

  test('一筆額度都沒有的客戶：畫得出來，不出錯', () => {
    const sheet = render(bundleOf([day('2026-10-01', [free('hrv'), free('fm')])], []));
    assert.equal(sheet.at('A6'), '功醫門診（不算次數）');
    assert.equal(sheet.at('A7'), 'HRV（不算次數）');
  });

  // n返 那一列（issue 14）：同一種列，同一份 `.gs` 畫
  test('三返那一列畫在額度列底下：一槓照寫、那一天那一欄有符號、「剩餘」沒有被塗紅；健檢底下那一行還在', () => {
    const exam = day('2026-09-01', [{ entitlementId: 'e-exam', courseId: 'exam', courseName: '健檢', status: 'done' }]);
    const third = day('2026-09-20', [{
      entitlementId: null, courseId: 'fu', courseName: '三返', followupNth: 3,
      followupForVisitId: exam.id, doctorId: 'd1', status: 'done',
    }]);
    const sheet = render(bundleOf([exam, third], [E_EXAM, E_FU]));
    // 第 5 列是表頭、第 6、7 列是健檢與二返、第 8 列是三返；F 是 9/1、G 是 9/20
    assert.deepEqual(
      ['A8', 'B8', 'C8', 'D8', 'E8', 'F8', 'G8'].map((a) => sheet.at(a)),
      ['三返（不算次數）', '—', 1, 0, '—', '', '✓'],
    );
    assert.notEqual(sheet.backgrounds.get('E8'), '#FFCDD2', '一槓不是 0');
    assert.equal(sheet.backgrounds.get('G8'), '#C8E6C9', '那一天那一格是 ✓ 的顏色');
    assert.match(String(sheet.at('C2')), /合計　應有 2　已完成 1　已排未上 0　剩餘 1/);
    const under = [...sheet.cells.entries()].filter(([a1, v]) => a1.startsWith('F') && String(v).includes('9/20 三返(夏)'));
    assert.equal(under.length, 1, '健檢那一欄底下那一行照舊');
  });
});

// ---------- 不變量 ----------
//
// 夾具裡每一種段都有：有額度的、擇一池、健檢與二返、n返、不算次數、取消（一段／整天）、未到、額度被刪。

describe('不變量：每一段都落在某一格', () => {
  const exam = day('2026-09-10', [{ entitlementId: 'e-exam', courseId: 'exam', courseName: '健檢', status: 'done' }]);
  const VISITS = [
    day('2026-09-01', [pool(), free('fm')]),
    day('2026-09-03', [free('fm', { status: 'confirmed' })], { status: 'confirmed' }),
    day('2026-09-05', [pool({ status: 'cancelled' }), free('hrv')]),
    day('2026-09-08', [{ entitlementId: 'e-deleted', courseId: 'il', courseName: 'ILIB', status: 'done' }]),
    exam,
    day('2026-09-12', [{
      entitlementId: 'e-fu', courseId: 'fu', courseName: '二返', followupForVisitId: exam.id, doctorId: 'd1', status: 'done',
    }]),
    day('2026-09-20', [{
      entitlementId: null, courseId: 'fu', courseName: '三返', followupNth: 3,
      followupForVisitId: exam.id, status: 'confirmed',
    }], { status: 'confirmed' }),
    day('2026-09-22', [free('fm', { status: 'no_show' })], { status: 'no_show' }),
    day('2026-09-25', [free('fm', { status: 'cancelled' })], { status: 'cancelled' }),
    day('2026-09-26', [pool({ status: 'done', startsAt: '09:00' }), pool({ status: 'done', startsAt: '14:00', equipmentId: 'eq-b' })]),
    day('2026-09-28', [pool({ status: 'pending_confirm' }), free('fm', { status: 'pending_confirm' }), free('hrv', { status: 'cancelled' })],
      { status: 'pending_confirm' }),
  ];
  const sheet = build(VISITS, [E_POOL, E_EXAM, E_FU]);

  const SYMBOLS = new RegExp(`([${MARK_ORDER.join('')}])(\\d*)`, 'g');
  const countIn = (mark, only = null) => [...String(mark ?? '').matchAll(SYMBOLS)]
    .filter(([, symbol]) => !only || symbol === only)
    .reduce((n, [, , times]) => n + (times ? Number(times) : 1), 0);

  const isNth = (s) => Number.isInteger(Number(s.followupNth)) && Number(s.followupNth) >= 3;
  const liveSlots = VISITS
    .filter((v) => v.status !== 'cancelled')
    .flatMap((v) => v.slots.filter((s) => s.status !== 'cancelled').map((s) => ({ date: v.date, slot: s })));

  test('每一個日期欄至少有一格有符號 —— 沒有除外（n返 2026-10-07 起也有自己一列）', () => {
    const empty = sheet.dates.filter((_, i) => sheet.rows.every((r) => !r.marks[i]));
    assert.deepEqual(empty, []);
    const nthOnly = sheet.dates.filter((d) => liveSlots.filter((x) => x.date === d).every((x) => isNth(x.slot)));
    assert.deepEqual(nthOnly, ['2026-09-20'], '夾具裡真的有只做 n返 的一天');
  });

  test('每一段還算數的時段剛好落在一格（n返 也是）', () => {
    const marked = sheet.rows.reduce((n, r) => n + r.marks.reduce((m, mark) => m + countIn(mark), 0), 0);
    assert.equal(marked, liveSlots.length);
  });

  test('每一列 ✓ 的總數＝那一列的「已完成」', () => {
    for (const row of sheet.rows) {
      const ticks = row.marks.reduce((n, mark) => n + countIn(mark, '✓'), 0);
      assert.equal(ticks, row.done, row.label);
    }
  });

  test('來訪紀錄的行數＝還算數的段數（n返 也在裡面）', () => {
    const lines = sheet.log.reduce((n, d) => n + d.items.length, 0);
    assert.equal(lines, liveSlots.length);
  });

  test('整天取消的那一天不佔一欄', () => {
    assert.ok(!sheet.dates.includes('2026-09-25'));
  });
});
