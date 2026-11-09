// 拍 Abovee 讀「實際扣課病歷號／關係」：家人用別人的額度，記在被扣的那一位身上、自動填「誰來的」
// （family-merge-round 03，ADR-0183、ADR-0184）。
//
// 她 2026-11-09：
//
// > 實際扣課病歷號：是扣誰的就扣誰的，可以標註。
//
// kickoff 照建議：多抄那兩欄，跟病歷號不一樣時認被扣的那一位、預選她的額度、「誰來的」自動填照片上的名字＋關係，
// 那一列講一句「扣客戶A 的（夫妻）」。
//
// Abovee 上這兩欄平常是空的（5～10 月 1,488 列裡只有 9 列有字，全是夫妻）。來的那一位多半不在 app 的名單上 ——
// 10/29 那一件就是這樣沒記進去（照名字認人、認不得）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ABOVEE_KEYS, absentFromPhoto, adoptAbovee, customersOnPhoto, mergeAboveePhotos, nearSay, needsAttention, photoChartNos, picksOf,
  planAbovee, readAbovee, recordedSay, resolveItem,
} from '../public/js/domain/aboveeImport.js';
import { ABOVEE_COLUMNS } from '../public/js/domain/transcripts.js';
import { ABOVEE_COLUMNS as FN_COLUMNS } from '../functions/transcripts/aboveeList.js';
import { SEED } from '../public/js/domain/seed.js';
import { counts } from '../public/js/domain/entitlements.js';
import { validateVisit } from '../public/js/domain/visits.js';

const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
// 客戶A（太太）在名單上；來的那一位（王大明，先生）不在 —— 5～10 月那 9 列都長這樣
const CUSTOMERS = [
  { id: 'c-a', name: '客戶A', marks: chart('5678') },
  { id: 'c-b', name: '客戶B', marks: chart('2468') },
];
const REHAB = { id: 'w-rehab', type: 'single', label: '復健科醫師門診', courseId: 'course-rehab', durationMin: 30, totalQty: 6 };
const POOL30 = {
  id: 'w-pool', type: 'pool', label: '復能-三選一(30)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'],
  durationMin: 30, totalQty: 5,
};
const MASTER = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const ctx = (over = {}) => ({
  customers: CUSTOMERS, entitlementsBy: { 'c-a': [REHAB, POOL30], 'c-b': [REHAB] }, visitsBy: {}, master: MASTER,
  today: '2026-11-01', ...over,
});

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '合併扣課', '實際扣課病歷號', '關係', '預約來源'];
const row = ({
  status = '課程完成', date = '2026-10-29', time = '14:30 - 15:00', name = '王大明', chartNo = '00009999',
  course = '復健門診', merged = '', actual = '00005678', relation = '夫妻',
} = {}) => [status, date, time, name, chartNo, course, merged, actual, relation, '正式課'];
const self = (o = {}) => row({ name: '客戶A', chartNo: '00005678', actual: '', relation: '', ...o });
const read = (rows, c = ctx()) => readAbovee([{ columns: COLS, rows }], c).items;

const visitOf = (slots, o = {}) => ({
  id: 'v1', customerId: 'c-a', customerName: '客戶A', date: '2026-10-29', status: 'done', slots, ...o,
});
const slot = (o = {}) => ({
  entitlementId: 'w-rehab', courseId: 'course-rehab', courseName: '復健科醫師門診', startsAt: '14:30', endsAt: '15:00',
  status: 'done', ...o,
});

describe('抄字多兩欄（兩份一樣）', () => {
  test('實際扣課病歷號、關係 → actualChartNo、relation；排在合併扣課與預約來源之間', () => {
    assert.deepEqual([...FN_COLUMNS], [...ABOVEE_COLUMNS]);
    const at = ABOVEE_COLUMNS.indexOf('實際扣課病歷號');
    assert.equal(ABOVEE_COLUMNS[at - 1], '合併扣課');
    assert.equal(ABOVEE_COLUMNS[at + 1], '關係');
    assert.equal(ABOVEE_COLUMNS[at + 2], '預約來源');
    assert.equal(ABOVEE_KEYS.實際扣課病歷號, 'actualChartNo');
    assert.equal(ABOVEE_KEYS.關係, 'relation');
  });

  test('左右兩張：那兩格只在右半時從右半補進來', () => {
    const left = { columns: ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'], rows: [row().slice(0, 6)] };
    const right = { columns: ['實際扣課病歷號', '關係', '預約來源'], rows: [['00005678', '夫妻', '正式課']] };
    const { rows } = mergeAboveePhotos([left, right]);
    assert.equal(rows[0].actualChartNo, '00005678');
    assert.equal(rows[0].relation, '夫妻');
  });
});

describe('10/29 那一種：來的人不在名單上、實際扣課病歷號是客戶A 的', () => {
  test('認成客戶A、預選她的復健門診、先勾好、「誰來的」寫照片上的名字＋關係', () => {
    const [item] = read([row()]);
    assert.equal(item.kind, 'new');
    assert.equal(item.customerId, 'c-a');
    assert.equal(item.entitlementId, 'w-rehab');
    assert.equal(item.checked, true, '號碼是 Abovee 系統帶出來的，剛好對到一位就算認得（ADR-0184）');
    assert.equal(item.attendee, '王大明（夫妻）');
    assert.equal(picksOf(item).attendee, '王大明（夫妻）');
  });

  test('記下去：那一段在客戶A 身上、誰來的有字、次數少一次', () => {
    const [item] = read([row()]);
    const { groups, problems } = planAbovee([item], ctx());
    assert.deepEqual(problems, {});
    assert.equal(groups[0].customerId, 'c-a');
    const s = groups[0].visit.slots[0];
    assert.equal(s.attendee, '王大明（夫妻）');
    assert.equal(s.entitlementId, 'w-rehab');
    assert.equal(counts(REHAB, [groups[0].visit], 'w-rehab').remaining, 5);
  });

  test('那一列講一句「扣客戶A 的（夫妻）」', () => {
    const [item] = read([row()]);
    assert.match(nearSay(item), /扣客戶A 的（夫妻）/);
    assert.equal(needsAttention(item), false, '認得的家人那一列不排進要你看（照片怎麼寫就怎麼記）');
  });

  test('確認層打開時要讀被扣的那一位的全部來訪（算次數）', () => {
    assert.deepEqual(customersOnPhoto([{ columns: COLS, rows: [row()] }], CUSTOMERS), ['c-a']);
  });

  test('來的那一位也在名單上（沒有號碼、名字對上）：照樣扣客戶A 的，照片上的號碼不記到客戶A 身上', () => {
    const customers = [...CUSTOMERS, { id: 'c-wdm', name: '王大明' }];
    const [item] = read([row()], ctx({ customers }));
    assert.equal(item.who.how, 'nameNoChart', '前提：照片上那一位照名字認得出來');
    assert.equal(item.customerId, 'c-a');
    assert.equal(item.checked, true);
    assert.deepEqual(photoChartNos([item], customers), [], '00009999 是先生的號碼');
  });

  test('已取消的家人列：不勾、不扣', () => {
    const [item] = read([row({ status: '已取消' })]);
    assert.equal(item.customerId, 'c-a');
    assert.equal(item.checked, false);
  });
});

describe('客戶A 自己同一天也來了', () => {
  test('同一個時間兩列：兩段都記得進去、同一筆裡不報重疊', () => {
    const items = read([self(), row()]);
    assert.deepEqual(items.map((i) => [i.kind, i.customerId, i.checked]), [['new', 'c-a', true], ['new', 'c-a', true]]);
    const { groups } = planAbovee(items, ctx());
    assert.equal(groups.length, 1);
    const v = groups[0].visit;
    assert.deepEqual(v.slots.map((s) => s.attendee ?? ''), ['', '王大明（夫妻）']);
    const { warnings } = validateVisit(v, {
      customer: { id: 'c-a', flags: [] }, entitlements: [REHAB, POOL30], courses: SEED.courses, equipment: SEED.equipment,
      rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts, customerVisits: [], sameDayVisits: [],
    });
    assert.ok(!warnings.some((w) => w.includes('重疊')), warnings.join('｜'));
  });

  test('app 上已經有先生那一段（有誰來的）：先生那一列「已經記了」、客戶A 那一列不搶它、是新的', () => {
    const c = ctx({ visitsBy: { 'c-a': [visitOf([slot({ attendee: '王大明（夫妻）' })])] } });
    const [mine, his] = read([self(), row()], c);
    assert.equal(his.kind, 'recorded');
    assert.equal(his.existing.slotIndex, 0);
    assert.equal(mine.kind, 'new', '客戶A 本人那一段 app 上還沒有');
  });

  test('app 上只有客戶A 本人那一段：先生那一列不搶它（不然漏記一次），兩種順序都一樣', () => {
    const c = ctx({ visitsBy: { 'c-a': [visitOf([slot()])] } });
    for (const rows of [[self(), row()], [row(), self()]]) {
      const items = read(rows, c);
      const mine = items.find((i) => !i.attendee);
      const his = items.find((i) => i.attendee);
      assert.equal(mine.kind, 'recorded');
      assert.equal(his.kind, 'new');
      assert.equal(his.checked, true);
    }
  });

  test('8/27 那一種（舊資料：兩段都記在客戶A 身上、誰來的空著）：兩列都「已經記了」、不多記一段', () => {
    const c = ctx({ visitsBy: { 'c-a': [visitOf([slot(), slot()])] } });
    const items = read([self(), row()], c);
    assert.deepEqual(items.map((i) => i.kind), ['recorded', 'recorded']);
    assert.notEqual(items[0].existing.slotIndex, items[1].existing.slotIndex, '各認領一段');
    assert.match(recordedSay(items[1]), /沒寫誰來的/);
  });

  test('換一位再選回客戶A：照樣認得舊的那一段（拿整張其他列認領過的那一份）', () => {
    const c = ctx({ visitsBy: { 'c-a': [visitOf([slot(), slot()])] } });
    const items = read([self(), row()], c);
    const back = resolveItem(resolveItem(items[1], 'c-b', c, items), 'c-a', c, items);
    assert.equal(back.kind, 'recorded');
    assert.notEqual(back.existing.slotIndex, items[0].existing.slotIndex);
  });

  test('客戶A 10:00 有一段 SIS，照片上只有先生 11:00 的 SIS：不是「Abovee 改了時間」', () => {
    const c = ctx({ visitsBy: { 'c-a': [visitOf([slot({ entitlementId: 'w-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '10:30', status: 'pending_confirm' })], { status: 'pending_confirm', date: '2026-11-05' })] } });
    const [his] = read([row({ status: '確認前往', date: '2026-11-05', time: '11:00 - 11:30', course: 'SIS 30' })], c);
    assert.equal(his.kind, 'new');
    assert.equal(his.movedFrom, null);
  });

  test('合併扣課：客戶A 14:00 一列＋先生 14:30 一列都勾了，不合成一段', () => {
    const items = read([
      self({ time: '14:00 - 14:30', course: 'SIS 30', merged: '是' }),
      row({ time: '14:30 - 15:00', course: 'IN 30', merged: '是' }),
    ]);
    assert.equal(items.length, 2);
    assert.ok(items.every((i) => !i.merged));
  });

  test('app 有、照片上沒有：先生那一段（有誰來的）照片上只有客戶A 本人同一個時間那一列 → 先生那一段要列出來', () => {
    const v = visitOf([slot(), slot({ attendee: '王大明（夫妻）' })], { status: 'pending_confirm', date: '2026-11-05' });
    v.slots.forEach((s) => { s.status = 'pending_confirm'; });
    const c = ctx({ visitsBy: { 'c-a': [v] } });
    const t = [{ columns: COLS, rows: [self({ status: '確認前往', date: '2026-11-05', time: '14:00 - 14:30' }), self({ status: '確認前往', date: '2026-11-05' }), self({ status: '確認前往', date: '2026-11-05', time: '15:00 - 15:30' })] }];
    const items = readAbovee(t, c).items;
    const absent = absentFromPhoto(t, items, c);
    assert.deepEqual(absent.slots.map((s) => s.slotIndex), [1]);
  });
});

describe('改成 Abovee 的（治療師／診間）：改的是認領的那一段', () => {
  test('客戶A 本人與先生同一個時間同一門課：照片上先生那一列的治療師不一樣 → 只改先生那一段', () => {
    const v = visitOf([slot({ status: 'pending_confirm', therapistId: 'staff-a' }), slot({ status: 'pending_confirm', therapistId: 'staff-a', attendee: '王大明（夫妻）' })],
      { status: 'pending_confirm', date: '2026-11-05' });
    const item = {
      key: 'x', diffs: [{ field: 'therapistId', app: 'staff-a', abovee: 'staff-b' }],
      existing: { visitId: 'v1', date: '2026-11-05', slotIndex: 1, startsAt: '14:30', courseId: 'course-rehab' },
    };
    const { visit, missed } = adoptAbovee(v, [item]);
    assert.deepEqual(missed, []);
    assert.deepEqual(visit.slots.map((s) => s.therapistId), ['staff-a', 'staff-b']);
  });
});

describe('認不得被扣的那一位：不猜、不勾、講一句', () => {
  test('號碼 app 裡沒有', () => {
    const [item] = read([row({ actual: '00001111' })]);
    assert.equal(item.customerId, null);
    assert.equal(item.checked, false);
    assert.equal(item.attendee ?? null, null);
    assert.match(nearSay(item), /認不出/);
    assert.equal(needsAttention(item), true);
  });

  test('號碼對到好幾位', () => {
    const customers = [...CUSTOMERS, { id: 'c-a2', name: '客戶C', marks: chart('5678') }];
    const [item] = read([row()], ctx({ customers }));
    assert.equal(item.customerId, null);
    assert.equal(item.checked, false);
    assert.match(nearSay(item), /好幾位/);
  });

  test('來的那一位在名單上、被扣的認不得：不扣他自己的、不勾', () => {
    const customers = [...CUSTOMERS, { id: 'c-wdm', name: '王大明', marks: chart('9999') }];
    const [item] = read([row({ actual: '00001111' })], ctx({ customers, entitlementsBy: { 'c-wdm': [REHAB] } }));
    assert.equal(item.checked, false);
    assert.equal(item.attendee ?? null, null, '還不知道扣誰的，不寫誰來的');
  });

  test('她「換一位」選了被扣的那一位：照她選的扣、誰來的照片上的、人是她選的不先勾', () => {
    const [item] = read([row({ actual: '00001111' })]);
    const picked = resolveItem(item, 'c-a', ctx(), [item]);
    assert.equal(picked.kind, 'new');
    assert.equal(picked.attendee, '王大明（夫妻）');
    assert.equal(picked.checked, false);
  });
});

describe('換一位', () => {
  test('換成別人：那一列不再講「扣客戶A 的」、也不再是客戶A 的額度', () => {
    const [item] = read([row()]);
    const other = resolveItem(item, 'c-b', ctx(), [item]);
    assert.equal(other.customerId, 'c-b');
    assert.doesNotMatch(nearSay(other), /扣客戶A 的/);
    assert.equal(other.checked, false);
  });

  test('換成來的那一位本人（他其實用自己的）：誰來的清掉', () => {
    const customers = [...CUSTOMERS, { id: 'c-wdm', name: '王大明', marks: chart('9999') }];
    const c = ctx({ customers, entitlementsBy: { 'c-a': [REHAB], 'c-wdm': [REHAB] } });
    const [item] = read([row()], c);
    assert.equal(item.customerId, 'c-a');
    const himself = resolveItem(item, 'c-wdm', c, [item]);
    assert.equal(himself.attendee ?? null, null);
    assert.equal(picksOf(himself).attendee ?? null, null);
  });
});

describe('舊照片／Function 沒部署（兩欄空）：一列的結果都不變', () => {
  test('沒有那兩欄：照名字認人、誰來的空著、組出來的一段沒有 attendee 這一格', () => {
    const cols = COLS.filter((c) => c !== '實際扣課病歷號' && c !== '關係');
    const rows = [self().filter((_, i) => i !== 7 && i !== 8)];
    const [item] = readAbovee([{ columns: cols, rows }], ctx()).items;
    assert.equal(item.customerId, 'c-a');
    assert.equal(item.attendee ?? null, null);
    const { groups } = planAbovee([item], ctx());
    assert.equal('attendee' in groups[0].visit.slots[0], false);
  });

  test('那一欄有字、跟病歷號一樣：當成本人', () => {
    const [item] = read([self({ actual: '00005678', relation: '本人' })]);
    assert.equal(item.attendee ?? null, null);
    assert.equal(item.checked, true);
  });
});
