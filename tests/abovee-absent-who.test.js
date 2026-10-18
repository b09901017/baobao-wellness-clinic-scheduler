// 拍 Abovee「app 有、這次照片上沒有」對誰（staging-polish-2026-10-18/12，ADR-0153）。
//
// 她 2026-10-18：「有時候我會只拍某個人的整個月，所以照片當然不會有當月其他人的 但這不是錯誤 …
// 如果這張照片中只有一個人的話 … 就看這段時間 這個人有沒有app有但abovee 沒有的就好不用看大家」。
// 以前判準是「每一列都認出來、而且是同一位」—— 一列名字抄錯一個字就退回對大家，列出 104 段。
//
// **對誰**看照片上的字（病歷號、名字，差一個字算同一位）：1～2 位只對那幾位、3 位以上對大家。
// **範圍放不放寬**照舊（`photoBounds()` 一個字都不變，`flagMoved()` 讀同一份）。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  absentFromPhoto, absentSay, photoBounds, photoPeople, photoWho, readAbovee, resolveItem, summarizeAbovee,
} from '../public/js/domain/aboveeImport.js';
import { SEED } from '../public/js/domain/seed.js';

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 30 };
const PEOPLE = [
  { id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] },
  { id: 'c-a', name: '客戶甲', marks: [{ text: '病歷號 2222', color: 'grey' }] },
  { id: 'c-b', name: '客戶乙', marks: [{ text: '病歷號 3333', color: 'grey' }] },
  { id: 'c-c', name: '客戶丙', marks: [{ text: '病歷號 4444', color: 'grey' }] },
];
const CHART = { 王小明: '00001234', 客戶甲: '00002222', 客戶乙: '00003333', 客戶丙: '00004444' };

const end = (t) => `${String(Number(t.slice(0, 2)) + 1).padStart(2, '0')}:${t.slice(3)}`;
const sis = (startsAt) => ({
  entitlementId: 'w-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt, endsAt: end(startsAt), status: 'confirmed',
});
const ctx = (days = {}) => {
  const visitsBy = {};
  for (const [customerId, byDate] of Object.entries(days)) {
    visitsBy[customerId] = Object.entries(byDate).map(([date, slots]) => ({
      id: `v-${customerId}-${date}`, customerId, customerName: PEOPLE.find((p) => p.id === customerId)?.name ?? '', date, status: 'confirmed', slots,
    }));
  }
  return {
    customers: PEOPLE,
    entitlementsBy: Object.fromEntries(PEOPLE.map((p) => [p.id, [POOL]])),
    visitsBy,
    master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
    today: '2026-09-01',
  };
};
/** 照片上的一列：`['10-02', '10:00', '王小明']`；`chartNo` 給 null 就照 CHART、給 '' 就是空的 */
const row = ([md, time, name], chartNo = null) => ['確認前往', `2026-${md}`, `${time} - ${end(time)}`, name, chartNo ?? CHART[name] ?? '', 'SIS 60'];
const photo = (rows, extra = {}) => ({ columns: COLS, rows, ...extra });
/** 只有這一頁、起訖讀得到：範圍是 10/2–10/31（不管對誰） */
const month = (rows) => photo(rows, { pageText: `${rows.length}筆第1/1頁`, dateFromText: '2026/10/02', dateToText: '2026/10/31' });

function check(transcripts, c, opts) {
  const { items } = readAbovee(transcripts, c);
  return { items, gone: absentFromPhoto(transcripts, items, c, opts) };
}
const goneAt = (gone) => gone.slots.map((s) => `${s.customerId} ${s.date.slice(5)} ${s.startsAt}`);

// 王小明 10 月四段在照片上、10/30 那一段沒有；別人 10 月也各有一段（「對大家」才會列出來）
const OCTOBER = {
  'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-06': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-13': [sis('10:00')],
    '2026-10-16': [sis('10:00')], '2026-10-30': [sis('10:00')] },
  'c-a': { '2026-10-07': [sis('14:00')] },
  'c-b': { '2026-10-08': [sis('15:00')] },
  'c-c': { '2026-10-20': [sis('09:00')] },
};
const WANG_DAYS = ['10-02', '10-06', '10-09', '10-13', '10-16'];

describe('照片上有幾位：看照片上的字，不看認不認得出來（photoPeople）', () => {
  const item = (name, chartNo = '') => ({ row: { name, chartNo } });

  test('先照病歷號分組（補零、空白都一樣）；沒有病歷號的那一列名字一樣或差一個字 → 併進那一組', () => {
    const people = photoPeople([
      item('王小明', '00001234'), item('王小名', '1234'), item('王小明'), item('王曉明'), item('客戶甲', '2222'),
    ]);
    assert.deepEqual(people.map((p) => p.items.length), [4, 1]);
    assert.equal(people[0].label, '王小明');
  });

  test('只有名字、跟每一組都差兩個字以上 → 自己一組（寧可多算一位）；名字與病歷號都空的那一列不算', () => {
    const people = photoPeople([item('王小明', '1234'), item('某某某'), item('', ''), item('某某某')]);
    assert.deepEqual(people.map((p) => [p.label, p.items.length]), [['王小明', 1], ['某某某', 2]]);
  });

  test('只有病歷號的那一組，講的時候用病歷號', () => {
    assert.deepEqual(photoPeople([item('', '00005678')]).map((p) => p.label), ['病歷號 5678']);
  });

  test('兩個字的名字不放寬（oneCharOff 那一條）', () => {
    assert.equal(photoPeople([item('小明'), item('小名')]).length, 2);
  });
});

describe('照片上 1～2 位 → 只對那幾位', () => {
  test('五列都是王小明、其中一列名字抄錯一個字（病歷號在）、起訖 10/2–10/31 → 只對王小明，別人 10 月的段一段都不列', () => {
    const rows = WANG_DAYS.map((d) => row([d, '10:00', '王小明']));
    rows[2][3] = '王小名';
    const { items, gone } = check([month(rows)], ctx(OCTOBER));
    assert.deepEqual(goneAt(gone), ['c-wang 10-30 10:00']);
    assert.deepEqual(gone.checked.customerIds, ['c-wang']);
    assert.equal(summarizeAbovee(items, gone.slots).attention - summarizeAbovee(items).attention, 1, '抬頭「要你看」跟那一塊同一份');
  });

  test('同上、但每一列都沒有病歷號（抄錯的那一列認不出來）→ 照樣只對王小明', () => {
    const rows = WANG_DAYS.map((d) => row([d, '10:00', '王小明'], ''));
    rows[2][3] = '王小名';
    const { items, gone } = check([month(rows)], ctx(OCTOBER));
    assert.equal(items[2].customerId, null, '前提：那一列真的沒認出來');
    assert.deepEqual(goneAt(gone), ['c-wang 10-30 10:00']);
    assert.deepEqual(gone.checked.unknown, []);
  });

  test('一列完全認不出來、原字跟王小明差兩個字以上 → 算兩位：王小明照對、那一位講一句；別人的段一段都不列', () => {
    const rows = [...WANG_DAYS.slice(0, 4).map((d) => row([d, '10:00', '王小明'])), row(['10-16', '10:00', '某某某'], '')];
    const c = ctx(OCTOBER);
    const { gone } = check([month(rows)], c);
    assert.deepEqual(goneAt(gone), ['c-wang 10-30 10:00'], '10/16 那一段：同一天同一個時間有一列還沒認出 → 先不列');
    assert.deepEqual(gone.checked.unknown, ['某某某']);
    const say = absentSay(gone, c.customers);
    assert.match(say, /對過 王小明 10\/2–10\/31 在 app 上的段/);
    assert.match(say, /照片上的 某某某 還沒認出是誰，先沒對/);
  });

  test('照片上只有一位、一列都沒認出來 → 誰都不對，講一句（不退回對大家）', () => {
    const rows = WANG_DAYS.map((d) => row([d, '10:00', '某某某'], ''));
    const c = ctx(OCTOBER);
    const { gone } = check([month(rows)], c);
    assert.deepEqual([gone.checked.customerIds, gone.slots.length], [[], 0]);
    assert.match(absentSay(gone, c.customers), /照片上的 某某某 還沒認出是誰/);
    assert.doesNotMatch(absentSay(gone, c.customers), /每一位/);
  });

  test('王小明 3 列、客戶甲 2 列 → 只對這兩位（客戶乙、丙的不列）', () => {
    const rows = [
      row(['10-02', '10:00', '王小明']), row(['10-06', '10:00', '王小明']), row(['10-07', '14:00', '客戶甲']),
      row(['10-09', '10:00', '王小明']), row(['10-13', '10:00', '客戶甲']),
    ];
    const c = ctx({ ...OCTOBER, 'c-a': { '2026-10-07': [sis('14:00')], '2026-10-21': [sis('14:00')] } });
    const { gone } = check([month(rows)], c);
    // 10/13 10:00 照片上是客戶甲 → 王小明那一段沒拍到
    assert.deepEqual(goneAt(gone), ['c-wang 10-13 10:00', 'c-wang 10-16 10:00', 'c-a 10-21 14:00', 'c-wang 10-30 10:00']);
    assert.match(absentSay(gone, c.customers), /對過 王小明、客戶甲 10\/2–10\/31 在 app 上的段/);
  });

  test('她「換一位」把一列從王小明換成客戶乙 → 對王小明、客戶乙（認出來的人為準）', () => {
    const rows = WANG_DAYS.map((d) => row([d, '10:00', '王小明']));
    const c = ctx(OCTOBER);
    const t = [month(rows)];
    const { items } = readAbovee(t, c);
    const picked = items.map((i, k) => (k === 4 ? resolveItem(i, 'c-b', c) : i));
    const gone = absentFromPhoto(t, picked, c);
    assert.deepEqual(gone.checked.customerIds, ['c-wang', 'c-b']);
    // 10/16 那一段：照片上那一列現在是客戶乙的 → 王小明的 10/16 沒拍到
    assert.deepEqual(goneAt(gone), ['c-b 10-08 15:00', 'c-wang 10-16 10:00', 'c-wang 10-30 10:00']);
  });
});

describe('照片上 3 位以上 → 照舊對大家', () => {
  test('三位各一兩列（一天的列表）→ 範圍裡每一位，照片上沒有的客戶丙也列', () => {
    const rows = [
      row(['10-02', '10:00', '王小明']), row(['10-07', '14:00', '客戶甲']), row(['10-08', '15:00', '客戶乙']), row(['10-30', '10:00', '王小明']),
    ];
    const c = ctx(OCTOBER);
    const { gone } = check([month(rows)], c);
    assert.equal(gone.checked.customerIds, null);
    assert.deepEqual(goneAt(gone), ['c-wang 10-06 10:00', 'c-wang 10-09 10:00', 'c-wang 10-13 10:00', 'c-wang 10-16 10:00', 'c-c 10-20 09:00']);
    assert.match(absentSay(gone, c.customers), /每一位/);
  });

  test('photoWho：0 位（名字病歷號都空）也照舊對大家', () => {
    assert.deepEqual(photoWho([{ row: { name: '', chartNo: '' }, customerId: null }]), { customerIds: null, unknown: [] });
  });
});

describe('月底對帳：明說對每一位（不靠照片上的人數猜）', () => {
  test('{ everyone: true } → 照片上只有王小明也對每一位', () => {
    const rows = WANG_DAYS.map((d) => row([d, '10:00', '王小明']));
    const { gone } = check([month(rows)], ctx(OCTOBER), { everyone: true });
    assert.equal(gone.checked.customerIds, null);
    assert.deepEqual(goneAt(gone), ['c-a 10-07 14:00', 'c-b 10-08 15:00', 'c-c 10-20 09:00', 'c-wang 10-30 10:00']);
  });
});

describe('範圍放不放寬一個字都不變（flagMoved() 讀同一份）', () => {
  test('五列王小明＋一列認不出來、只有一頁、讀不到起訖 → 範圍照舊是第一列到最後一列（不放寬到整個月），只對王小明', () => {
    const rows = [...WANG_DAYS.map((d) => row([d, '10:00', '王小明'])), row(['10-16', '15:00', '某某某'], '')];
    const t = [photo(rows, { pageText: '6筆第1/1頁' })];
    const c = ctx({ ...OCTOBER, 'c-wang': { ...OCTOBER['c-wang'], '2026-10-01': [sis('10:00')], '2026-10-14': [sis('10:00')] } });
    const { items, gone } = check(t, c);
    const bounds = photoBounds(t, items);
    assert.equal(bounds.customerId, null, '放寬那一條照舊要每一列都認出來');
    assert.deepEqual(bounds.ranges.map(({ lo, hi }) => [lo.date, hi.date]), [['2026-10-02', '2026-10-16']]);
    assert.deepEqual(goneAt(gone), ['c-wang 10-14 10:00']);
  });
});
