// 療程單比對：簽了的有沒有記、記了的有沒有簽（issue 15）。`domain/treatmentSheets.js` 的 `compareSheet()`。
//
// CONTEXT「療程單」：簽了療程單和來訪的「已完成」講的是同一件事 —— 對不上的地方就是她漏記或記錯的地方。
//
// **比對區間有沒有任何一條路，會延伸到最後一次簽名之後？** —— 沒有：照片兩三個月才拍一次，
// 比到今天的話最後一次簽名之後的每一段都會變成「沒簽」，整頁假警報（區間的測試在最前面）。
// **這一頁有沒有任何一顆按鈕會改到一筆來訪？** —— 這一支是純函式，只回一份清單（ADR-0007、0056）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { compareAll, compareLine, compareSheet, issueSentence } from '../public/js/domain/treatmentSheets.js';
import { SEED } from '../public/js/domain/seed.js';

const MASTER = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts };

const row = (date, over = {}) => ({ seq: '', date, signed: true, equipmentIds: [], ...over });
const recovery = (rows, over = {}) => ({ id: 's1', customerId: 'c1', courseIds: ['course-recovery'], ivProductIds: [], rows, ...over });

let n = 0;
const slot = (over) => ({ startsAt: '09:00', endsAt: '10:00', status: 'done', ...over });
const visit = (date, slots, over = {}) => {
  n += 1;
  return { id: `v${n}`, customerId: 'c1', date, status: 'done', slots, ...over };
};
const sis = (over) => slot({ courseId: 'course-recovery', equipmentId: 'eq-sis', ...over });
const indiba = (over) => slot({ courseId: 'course-recovery', equipmentId: 'eq-indiba', ...over });
const kinds = (result) => result.issues.map((i) => `${i.kind} ${i.date}`);

describe('比對區間：第一列 ～ 最後一列有簽名的那一天', () => {
  test('單子最後一列簽名 8/25、app 在 9/3 有一段已完成 → 不出現（在區間外）', () => {
    const sheet = recovery([row('2026-08-11', { equipmentIds: ['eq-sis'] }), row('2026-08-25', { equipmentIds: ['eq-sis'] })]);
    const visits = [visit('2026-08-11', [sis()]), visit('2026-08-25', [sis()]), visit('2026-09-03', [sis()])];
    const r = compareSheet(sheet, visits, MASTER);
    assert.deepEqual(r.issues, []);
    assert.equal(r.matched, 2);
    assert.deepEqual({ from: r.from, to: r.to }, { from: '2026-08-11', to: '2026-08-25' });
  });

  test('最後一列有日期沒簽名 → 區間只到有簽的那一列；那一天 app 做完了照樣講「單子上沒有」', () => {
    const sheet = recovery([row('2026-08-11', { equipmentIds: ['eq-sis'] }), row('2026-08-20', { signed: false }), row('2026-08-25', { equipmentIds: ['eq-sis'] }), row('2026-09-01', { signed: false })]);
    const visits = [visit('2026-08-11', [sis()]), visit('2026-08-20', [sis()]), visit('2026-08-25', [sis()]), visit('2026-09-01', [sis()])];
    const r = compareSheet(sheet, visits, MASTER);
    assert.equal(r.to, '2026-08-25');
    assert.deepEqual(kinds(r), ['unsigned 2026-08-20']);
  });

  test('一列都沒有簽 → 沒有區間、什麼都不比', () => {
    const r = compareSheet(recovery([row('2026-08-11', { signed: false })]), [visit('2026-08-11', [sis()])], MASTER);
    assert.equal(r.to, null);
    assert.deepEqual(r.issues, []);
  });
});

describe('四種對不上', () => {
  test('8/13 簽兩列 SIS、app 那天只有一段 SIS → 「簽了、app 沒有」一件', () => {
    const sheet = recovery([row('2026-08-13', { equipmentIds: ['eq-sis'] }), row('2026-08-13', { equipmentIds: ['eq-sis'] })]);
    const r = compareSheet(sheet, [visit('2026-08-13', [sis()])], MASTER);
    assert.deepEqual(kinds(r), ['missing 2026-08-13']);
    assert.equal(r.matched, 1);
  });

  test('7/15 勾 Indiba、app 記 SIS 已完成 → 「勾的器材不一樣」', () => {
    const v = visit('2026-07-15', [sis()]);
    const r = compareSheet(recovery([row('2026-07-15', { equipmentIds: ['eq-indiba'] })]), [v], MASTER);
    assert.deepEqual(kinds(r), ['equipment 2026-07-15']);
    assert.equal(r.issues[0].visitId, v.id);
    assert.equal(r.issues[0].slotIndex, 0);
    assert.equal(r.issues[0].appEquipmentId, 'eq-sis');
    assert.deepEqual(r.issues[0].sheetEquipmentIds, ['eq-indiba']);
  });

  test('同一列勾兩台（SIS＋高能），app 記其中一台 → 對得上', () => {
    const r = compareSheet(recovery([row('2026-07-15', { equipmentIds: ['eq-sis', 'eq-laser'] })]), [visit('2026-07-15', [slot({ courseId: 'course-recovery', equipmentId: 'eq-laser' })])], MASTER);
    assert.deepEqual(r.issues, []);
    assert.equal(r.matched, 1);
  });

  test('簽了、app 那一段還沒結案（已確認）→ 「簽了、還沒結案」', () => {
    const r = compareSheet(recovery([row('2026-07-15', { equipmentIds: ['eq-sis'] })]), [visit('2026-07-15', [sis({ status: 'confirmed' })], { status: 'confirmed' })], MASTER);
    assert.deepEqual(kinds(r), ['notClosed 2026-07-15']);
  });

  test('app 說做完了、單子上那一天沒有 → 「單子上沒有」', () => {
    const sheet = recovery([row('2026-07-01', { equipmentIds: ['eq-sis'] }), row('2026-07-20', { equipmentIds: ['eq-sis'] })]);
    const r = compareSheet(sheet, [visit('2026-07-01', [sis()]), visit('2026-07-10', [indiba()]), visit('2026-07-20', [sis()])], MASTER);
    assert.deepEqual(kinds(r), ['unsigned 2026-07-10']);
  });

  test('先比器材一樣的：兩列（Indiba、SIS）對兩段（SIS、Indiba）→ 都對得上，不會交叉配成兩件器材不一樣', () => {
    const sheet = recovery([row('2026-07-15', { equipmentIds: ['eq-indiba'] }), row('2026-07-15', { equipmentIds: ['eq-sis'] })]);
    const r = compareSheet(sheet, [visit('2026-07-15', [sis(), indiba({ startsAt: '10:00' })])], MASTER);
    assert.deepEqual(r.issues, []);
    assert.equal(r.matched, 2);
  });
});

describe('哪幾段參與', () => {
  test('同一天一段復能、一段 ILIB，單子是復能那一張 → ILIB 那一段不參與', () => {
    const sheet = recovery([row('2026-07-15', { equipmentIds: ['eq-sis'] })]);
    const v = visit('2026-07-15', [sis(), slot({ courseId: 'course-iv-laser', startsAt: '10:00' })]);
    const r = compareSheet(sheet, [v], MASTER);
    assert.deepEqual(r.issues, []);
    assert.equal(r.matched, 1);
  });

  test('二返的段 → 不參與（不用簽療程單）', () => {
    const sheet = { id: 's2', customerId: 'c1', courseIds: ['course-followup', 'course-eecp'], rows: [row('2026-07-01'), row('2026-07-20')] };
    const visits = [visit('2026-07-01', [slot({ courseId: 'course-eecp' })]), visit('2026-07-10', [slot({ courseId: 'course-followup' })]), visit('2026-07-20', [slot({ courseId: 'course-eecp' })])];
    const r = compareSheet(sheet, visits, MASTER);
    assert.deepEqual(r.issues, []);
  });

  test('已取消的段 → 不算「app 有」（逐段取消、整天取消的舊資料都一樣）', () => {
    const sheet = recovery([row('2026-07-15', { equipmentIds: ['eq-sis'] }), row('2026-07-16', { equipmentIds: ['eq-sis'] })]);
    const visits = [
      visit('2026-07-15', [sis({ status: 'cancelled' })], { status: 'cancelled' }),
      // 2026-09-08 之前只寫整筆：時段身上沒有狀態，整筆取消
      visit('2026-07-16', [{ startsAt: '09:00', courseId: 'course-recovery', equipmentId: 'eq-sis' }], { status: 'cancelled' }),
    ];
    const r = compareSheet(sheet, visits, MASTER);
    assert.deepEqual(kinds(r), ['missing 2026-07-15', 'missing 2026-07-16']);
  });

  test('別位客戶的、已刪除的來訪 → 不參與', () => {
    const sheet = recovery([row('2026-07-15', { equipmentIds: ['eq-sis'] })]);
    const r = compareSheet(sheet, [visit('2026-07-15', [sis()], { customerId: 'c2' }), visit('2026-07-15', [sis()], { deletedAt: 'x' })], MASTER);
    assert.deepEqual(kinds(r), ['missing 2026-07-15']);
  });

  test('營養點滴一款一張：雪顏亮彩那一張不管護肝排毒那幾段', () => {
    const drip = { id: 's3', customerId: 'c1', courseIds: ['course-iv-drip'], ivProductIds: ['iv-snow'], rows: [row('2026-08-06'), row('2026-08-20')] };
    const iv = (id) => slot({ courseId: 'course-iv-drip', ivProductId: id });
    const r = compareSheet(drip, [visit('2026-08-06', [iv('iv-snow')]), visit('2026-08-13', [iv('iv-liver')]), visit('2026-08-20', [iv('iv-snow')])], MASTER);
    assert.deepEqual(r.issues, []);
    assert.equal(r.matched, 2);
  });

  test('單子上沒勾器材、單一課程的療程單（EECP）→ 直接比課程', () => {
    const sheet = { id: 's4', customerId: 'c1', courseIds: ['course-eecp'], rows: [row('2026-07-01')] };
    const r = compareSheet(sheet, [visit('2026-07-01', [slot({ courseId: 'course-eecp' })])], MASTER);
    assert.equal(r.matched, 1);
  });
});

describe('畫面上那一行與全部比對一次', () => {
  test('「比到 8/25：對得上 12 次・要你看 2 件」', () => {
    assert.equal(compareLine({ to: '2026-08-25', matched: 12, issues: [{}, {}] }), '比到 8/25(二)：對得上 12 次・要你看 2 件');
    assert.equal(compareLine({ to: '2026-08-25', matched: 3, issues: [] }), '比到 8/25(二)：對得上 3 次');
    assert.equal(compareLine({ to: null, matched: 0, issues: [] }), '還沒有簽名的列，沒得比');
  });

  test('compareAll：每一位的每一張，只留要看的那幾位', () => {
    const sheets = [
      recovery([row('2026-07-15', { equipmentIds: ['eq-sis'] })]),
      { ...recovery([row('2026-07-15', { equipmentIds: ['eq-sis'] })]), id: 's9', customerId: 'c2' },
    ];
    const visits = [visit('2026-07-15', [sis()]), visit('2026-07-15', [indiba()], { customerId: 'c2' })];
    const out = compareAll(sheets, visits, MASTER);
    assert.deepEqual(out.map((p) => [p.customerId, p.issues]), [['c2', 1]]);
    assert.deepEqual(out[0].sheets.map((s) => s.sheetId), ['s9']);
  });

  test('compareAll：印客戶本人現在的名字，照它排（改名之後不留舊名字，issues/23）', () => {
    const off = (id, customerId, customerName) => ({ ...recovery([row('2026-07-15', { equipmentIds: ['eq-sis'] })]), id, customerId, customerName });
    const sheets = [off('s1', 'c1', '客戶A'), off('s2', 'c2', '客戶B')];
    const visits = [visit('2026-07-15', [indiba()]), visit('2026-07-15', [indiba()], { customerId: 'c2' })];
    const customers = [{ id: 'c1', name: '客戶C' }, { id: 'c2', name: '客戶B' }];
    const out = compareAll(sheets, visits, MASTER, customers);
    assert.deepEqual(out.map((p) => p.customerName), ['客戶B', '客戶C']);
    assert.equal(compareAll([off('s3', 'gone', '客戶D')], [visit('2026-07-15', [indiba()], { customerId: 'gone' })], MASTER, customers)[0].customerName,
      '客戶D', '查不到本人才退回快照');
  });

  test('每一件講一句：她要做什麼一看就知道', () => {
    assert.equal(issueSentence({ kind: 'missing', date: '2026-08-13', courseId: 'course-recovery', sheetEquipmentIds: ['eq-sis'] }, MASTER),
      '8/13(四) 簽了 SIS，app 沒有這一段');
    assert.equal(issueSentence({ kind: 'notClosed', date: '2026-07-15', courseId: 'course-eecp', status: 'confirmed', sheetEquipmentIds: [] }, MASTER),
      '7/15(三) 簽了 EECP，app 上還是「已確認」');
    assert.equal(issueSentence({ kind: 'equipment', date: '2026-07-15', courseId: 'course-recovery', appEquipmentId: 'eq-sis', sheetEquipmentIds: ['eq-indiba'] }, MASTER),
      '7/15(三) 單子勾的是 INDIBA，app 記的是 SIS');
    assert.equal(issueSentence({ kind: 'unsigned', date: '2026-07-10', courseId: 'course-recovery', appEquipmentId: 'eq-indiba', sheetEquipmentIds: [] }, MASTER),
      '7/10(五) app 記 INDIBA 做完了，單子上這一天沒有簽');
  });
});
