// 拍 Abovee：「app 有、這次照片上沒有」（course-form-and-sheet-2026-10-06/09，ADR-0129）。
//
// 她 2026-10-06：「能不能同個月，如果有這次拍照沒有的來訪也列出 … 如果沒有拍到但是我app卻有紀錄的話那可能是錯的」
// 「我拍照通常有兩種，一種是一次拍某段時間內的很多人，或是一個月內的一個人」。
//
// **這一行會不會把「在下一頁」講成「Abovee 沒有」？會不會把一段本來就不壓在 Abovee 的課喊出來？** —— 都不會：
// 讀不出是第幾頁就只對照片上第一列到最後一列之間（兩頭不含），句子講「這次照片上沒有」；健檢、HRV 不列。
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  aboveeLoadRange, aboveePage, absentFromPhoto, absentSay, needsAttention, photoSpan, readAbovee, resolveItem, summarizeAbovee,
} from '../public/js/domain/aboveeImport.js';
import { SEED } from '../public/js/domain/seed.js';

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 30 };
const PEOPLE = [
  { id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] },
  { id: 'c-a', name: '客戶甲', marks: [{ text: '病歷號 2222', color: 'grey' }] },
  { id: 'c-b', name: '客戶乙', marks: [{ text: '病歷號 3333', color: 'grey' }] },
];
const CHART = { 王小明: '00001234', 客戶甲: '00002222', 客戶乙: '00003333' };

const end = (t) => `${String(Number(t.slice(0, 2)) + 1).padStart(2, '0')}:${t.slice(3)}`;
const sis = (startsAt, extra = {}) => ({
  entitlementId: 'w-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt, endsAt: startsAt ? end(startsAt) : null, status: 'confirmed', ...extra,
});
/** 一位一天一筆（ADR-0083）。`days`：{ 'c-wang': { '2026-10-02': [slot…] } } */
const ctx = (days = {}) => {
  const visitsBy = {};
  for (const [customerId, byDate] of Object.entries(days)) {
    visitsBy[customerId] = Object.entries(byDate).map(([date, slots]) => ({
      id: `v-${customerId}-${date}`, customerId, customerName: PEOPLE.find((p) => p.id === customerId)?.name ?? '', date,
      status: slots.every((s) => s.status === 'cancelled') ? 'cancelled' : 'confirmed', slots,
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
/** 照片上的一列：`['10-02', '10:00', '王小明']`（＋課程、狀態） */
const row = ([md, time, name], course = 'SIS 60', status = '確認前往') => [
  status, `2026-${md}`, `${time} - ${end(time)}`, name, CHART[name] ?? '', course,
];
const photo = (rows, extra = {}) => ({ columns: COLS, rows, ...extra });

/** 拍了、翻譯了、對過一次 —— 確認層每畫一次走的就是這一條 */
function check(transcripts, c) {
  const { items } = readAbovee(transcripts, c);
  return { items, gone: absentFromPhoto(transcripts, items, c) };
}
const goneAt = (gone) => gone.slots.map((s) => `${s.customerId} ${s.date.slice(5)} ${s.startsAt ?? '--:--'}`);

describe('頁數那一句', () => {
  test('「75筆第1/8頁」讀得出總筆數與第幾頁；讀不到的那一格是 null', () => {
    assert.deepEqual(aboveePage('75筆第1/8頁'), { total: 75, page: 1, pages: 8 });
    assert.deepEqual(aboveePage('共 3 筆 第 1 / 1 頁'), { total: 3, page: 1, pages: 1 });
    assert.deepEqual(aboveePage(''), { total: null, page: null, pages: null });
    assert.deepEqual(aboveePage('第 9/8 頁'), { total: null, page: null, pages: null });
  });
});

describe('拍一個月內的一個人', () => {
  const three = [row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明']), row(['10-16', '10:00', '王小明'])];

  test('只有一頁（「3筆第1/1頁」）、app 上月底多一段 SIS → 列出來；起訖沒讀到就用那個月', () => {
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-16': [sis('10:00')], '2026-10-30': [sis('10:00')] } });
    const { gone } = check([photo(three, { pageText: '3筆第1/1頁' })], c);
    assert.deepEqual(goneAt(gone), ['c-wang 10-30 10:00']);
    assert.equal(gone.slots[0].name, 'SIS(60)');
    assert.equal(gone.slots[0].status, 'confirmed');
    assert.equal(gone.checked.customerId, 'c-wang');
  });

  test('月底那一段是健檢（壓 Examine）→ 不列；是 HRV（不用壓）→ 不列；app 上取消了 → 不列', () => {
    const exam = { entitlementId: null, courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'confirmed' };
    const hrv = { entitlementId: null, courseId: 'course-hrv', startsAt: '13:00', endsAt: '13:30', status: 'confirmed' };
    const c = ctx({ 'c-wang': {
      '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-16': [sis('10:00')],
      '2026-10-28': [exam, hrv], '2026-10-30': [sis('10:00', { status: 'cancelled' })],
    } });
    assert.deepEqual(goneAt(check([photo(three, { pageText: '3筆第1/1頁' })], c).gone), []);
  });

  test('未到的那一段照樣算 app 有（Abovee 上失約的那一列還在）', () => {
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-16': [sis('10:00')], '2026-10-23': [sis('10:00', { status: 'no_show' })] } });
    assert.deepEqual(goneAt(check([photo(three, { pageText: '3筆第1/1頁' })], c).gone), ['c-wang 10-23 10:00']);
  });

  test('兩頁、只拍第一頁（「12筆第1/2頁」）→ 最後一列之後的一段都不列；月初到第一列之間的照樣列', () => {
    const c = ctx({ 'c-wang': {
      '2026-10-01': [sis('10:00')], '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-16': [sis('10:00')],
      '2026-10-23': [sis('10:00')], '2026-10-30': [sis('10:00')],
    } });
    const { gone } = check([photo(three, { pageText: '12筆第1/2頁' })], c);
    assert.deepEqual(goneAt(gone), ['c-wang 10-01 10:00']);
  });

  test('頁數那一句讀不出來 → 只對第一列到最後一列之間', () => {
    const c = ctx({ 'c-wang': {
      '2026-10-01': [sis('10:00')], '2026-10-02': [sis('10:00')], '2026-10-05': [sis('10:00')], '2026-10-09': [sis('10:00')],
      '2026-10-16': [sis('10:00')], '2026-10-30': [sis('10:00')],
    } });
    assert.deepEqual(goneAt(check([photo(three)], c).gone), ['c-wang 10-05 10:00']);
  });

  test('第一列與最後一列那個時間不算（翻頁常常切在同一天的中間）', () => {
    // 同一個時間有別人的一段：可能在上一頁／下一頁。那個時間之後、之前的照樣算
    const rows = [row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '客戶甲']), row(['10-16', '10:00', '王小明'])];
    const c = ctx({
      'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-16': [sis('10:00')] },
      'c-a': { '2026-10-09': [sis('10:00')] },
      'c-b': { '2026-10-02': [sis('10:00'), sis('15:00')], '2026-10-16': [sis('08:00'), sis('10:00')] },
    });
    assert.deepEqual(goneAt(check([photo(rows)], c).gone), ['c-b 10-02 15:00', 'c-b 10-16 08:00']);
  });
});

describe('照片上的列跟 app 上那一段對得上的時候', () => {
  test('Abovee 那一列標已取消、app 上活著 → 照舊是「對不上」，這裡不重複', () => {
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-16': [sis('10:00')] } });
    const rows = [row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明'], 'SIS 60', '已取消'), row(['10-16', '10:00', '王小明'])];
    const { items, gone } = check([photo(rows, { pageText: '3筆第1/1頁' })], c);
    assert.equal(items[1].kind, 'mismatch');
    assert.deepEqual(goneAt(gone), []);
  });

  test('同一天 Abovee 改了時間 → 只有「搬了時間」那一句，不再列一次', () => {
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-16': [sis('10:00')] } });
    const rows = [row(['10-02', '10:00', '王小明']), row(['10-09', '11:00', '王小明']), row(['10-16', '10:00', '王小明'])];
    const { items, gone } = check([photo(rows, { pageText: '3筆第1/1頁' })], c);
    assert.equal(items[1].movedFrom?.startsAt, '10:00');
    assert.deepEqual(goneAt(gone), []);
  });

  test('app 那一段沒有開始時間（合併檔匯進來的）：照片上那一天有同一門課 → 照片上有；那一天沒有 → 列', () => {
    const c = ctx({ 'c-wang': {
      '2026-10-02': [sis(null)], '2026-10-09': [sis('10:00')], '2026-10-12': [sis(null)], '2026-10-16': [sis('10:00')],
    } });
    const { gone } = check([photo([row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明']), row(['10-16', '10:00', '王小明'])],
      { pageText: '3筆第1/1頁' })], c);
    assert.deepEqual(goneAt(gone), ['c-wang 10-12 --:--']);
  });

  test('照片上那一列讀不出時間：那一位那一天的段都當成照片上有（看不出是哪一段）', () => {
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00'), sis('15:00')], '2026-10-16': [sis('10:00')] } });
    const rows = [row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明']), [...row(['10-09', '10:00', '王小明'])], row(['10-16', '10:00', '王小明'])];
    rows[2][2] = '';
    assert.deepEqual(goneAt(check([photo(rows, { pageText: '4筆第1/1頁' })], c).gone), []);
  });
});

describe('拍某段時間內的很多人', () => {
  // 第一頁：10/9 09:00 到 10/14 10:00，照片上只有王小明與客戶甲
  const page1 = [
    row(['10-09', '09:00', '王小明']), row(['10-09', '11:00', '客戶甲']), row(['10-11', '10:00', '王小明']),
    row(['10-14', '10:00', '客戶甲']),
  ];

  test('第一頁（「75筆第1/8頁」）：10/14 14:00 那一段不列（在下一頁）；照片上沒出現的客戶乙在範圍裡那一段 → 列', () => {
    const c = ctx({
      'c-wang': { '2026-10-09': [sis('09:00')], '2026-10-11': [sis('10:00')] },
      'c-a': { '2026-10-09': [sis('11:00')], '2026-10-14': [sis('10:00'), sis('14:00')] },
      'c-b': { '2026-10-10': [sis('15:00')] },
    });
    const { gone } = check([photo(page1, { pageText: '75筆第1/8頁' })], c);
    assert.deepEqual(goneAt(gone), ['c-b 10-10 15:00']);
    assert.equal(gone.checked.customerId, null, '很多人：對象是範圍裡每一位');
  });

  test('第一頁、「起」沒讀到：第一列之前的不列（不知道 Abovee 上的篩選從哪一天開始）；第一列那個時間算', () => {
    const c = ctx({
      'c-wang': { '2026-10-09': [sis('09:00')], '2026-10-11': [sis('10:00')] },
      'c-a': { '2026-10-09': [sis('11:00')], '2026-10-14': [sis('10:00')] },
      'c-b': { '2026-10-08': [sis('15:00')], '2026-10-09': [sis('09:00')] },
    });
    assert.deepEqual(goneAt(check([photo(page1, { pageText: '75筆第1/8頁' })], c).gone), ['c-b 10-09 09:00']);
  });

  test('第一頁讀得到「起」→ 從那一天起；最後一頁讀得到「訖」→ 到那一天', () => {
    const c = ctx({
      'c-wang': { '2026-10-09': [sis('09:00')], '2026-10-11': [sis('10:00')] },
      'c-a': { '2026-10-09': [sis('11:00')], '2026-10-14': [sis('10:00')] },
      'c-b': { '2026-09-30': [sis('09:00')], '2026-10-03': [sis('15:00')], '2026-10-20': [sis('09:00')], '2026-11-01': [sis('09:00')] },
    });
    const first = check([photo(page1, { pageText: '75筆第1/8頁', dateFromText: '2026/10/01', dateToText: '2026/10/31' })], c).gone;
    assert.deepEqual(goneAt(first), ['c-b 10-03 15:00']);
    const last = check([photo(page1, { pageText: '75筆第8/8頁', dateFromText: '2026/10/01', dateToText: '2026/10/31' })], c).gone;
    assert.deepEqual(goneAt(last), ['c-b 10-20 09:00']);
  });

  test('還沒認出是誰的那一列：同一天同一個時間的段先不列（那一列可能就是他）；她選了人之後重算', () => {
    const rows = [...page1.slice(0, 2), row(['10-10', '15:00', '某某某']), ...page1.slice(2)];
    const c = ctx({
      'c-wang': { '2026-10-09': [sis('09:00')], '2026-10-11': [sis('10:00')] },
      'c-a': { '2026-10-09': [sis('11:00')], '2026-10-14': [sis('10:00')] },
      'c-b': { '2026-10-10': [sis('15:00')], '2026-10-12': [sis('09:00')] },
    });
    const t = [photo(rows, { pageText: '75筆第1/8頁' })];
    const { items, gone } = check(t, c);
    assert.deepEqual(goneAt(gone), ['c-b 10-12 09:00']);
    // 她把那一列選成客戶乙：10/10 那一段對到了
    const picked = items.map((i) => (i.row.name === '某某某' ? resolveItem(i, 'c-b', c) : i));
    assert.deepEqual(goneAt(absentFromPhoto(t, picked, c)), ['c-b 10-12 09:00']);
    // 選成客戶甲：10/10 那一段客戶乙的就真的沒拍到
    const wrong = items.map((i) => (i.row.name === '某某某' ? resolveItem(i, 'c-a', c) : i));
    assert.deepEqual(goneAt(absentFromPhoto(t, wrong, c)), ['c-b 10-10 15:00', 'c-b 10-12 09:00']);
  });
});

describe('對不了的時候不亂喊', () => {
  test('兩格日期與頁數都讀不到、列又不是照時間排 → 不檢查，講一句為什麼', () => {
    const rows = [row(['10-16', '10:00', '王小明']), row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明'])];
    const c = ctx({ 'c-wang': { '2026-10-05': [sis('10:00')] } });
    const { gone } = check([photo(rows)], c);
    assert.deepEqual([gone.checked, gone.why, gone.slots.length], [null, 'unsorted', 0]);
    assert.match(absentSay(gone, c.customers), /不是照時間排/);
  });

  test('列不是照時間排、但只有這一頁（「3筆第1/1頁」）→ 照樣對（每一列都在這裡）', () => {
    const rows = [row(['10-16', '10:00', '王小明']), row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明'])];
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-16': [sis('10:00')], '2026-10-20': [sis('10:00')] } });
    assert.deepEqual(goneAt(check([photo(rows, { pageText: '3筆第1/1頁' })], c).gone), ['c-wang 10-20 10:00']);
  });

  test('Function 還是舊的（沒有起訖那兩格）→ 照樣對，範圍退回列的日期', () => {
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-05': [sis('10:00')], '2026-10-09': [sis('10:00')] } });
    const rows = [row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明'])];
    assert.deepEqual(goneAt(check([photo(rows)], c).gone), ['c-wang 10-05 10:00']);
  });

  test('照片上一列都沒讀到 → 什麼都不講', () => {
    const gone = absentFromPhoto([photo([])], [], ctx());
    assert.deepEqual([gone.checked, gone.why, gone.slots.length], [null, null, 0]);
    assert.equal(absentSay(gone, []), '');
  });
});

describe('畫面上的數字與句子', () => {
  test('抬頭的「要你看」把這幾段算進去', () => {
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-05': [sis('10:00')], '2026-10-09': [sis('10:00')] } });
    const rows = [row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明'])];
    const { items, gone } = check([photo(rows)], c);
    assert.equal(items.filter(needsAttention).length, 0);
    assert.equal(summarizeAbovee(items, gone.slots).attention, 1);
    assert.equal(summarizeAbovee(items).attention, 0);
  });

  test('句子講「這次照片上沒有」，不講「Abovee 沒有」；講得出對了誰、哪一段日期', () => {
    const c = ctx({ 'c-wang': { '2026-10-02': [sis('10:00')], '2026-10-09': [sis('10:00')], '2026-10-16': [sis('10:00')], '2026-10-30': [sis('10:00')] } });
    const three = [row(['10-02', '10:00', '王小明']), row(['10-09', '10:00', '王小明']), row(['10-16', '10:00', '王小明'])];
    const one = check([photo(three, { pageText: '3筆第1/1頁' })], c).gone;
    const say = absentSay(one, c.customers);
    assert.match(say, /王小明/);
    assert.match(say, /10\/1–10\/31/);
    assert.match(say, /這次照片上沒有/);
    assert.doesNotMatch(say, /Abovee (上)?沒有/);
    const many = check([photo(three)], { ...c, customers: PEOPLE }).gone;
    assert.match(absentSay(many, c.customers), /10\/2 10:00–10\/16 10:00/);
    // 對過、而且都有
    const none = check([photo(three, { pageText: '3筆第1/1頁' })], ctx({ 'c-wang': { '2026-10-02': [sis('10:00')] } })).gone;
    assert.match(absentSay(none, c.customers), /都在這次的照片上/);
  });
});

describe('打開時要多讀哪幾天的來訪', () => {
  test('照片上那幾天放寬到整個月；讀得到起訖的也算進去', () => {
    const rows = [row(['10-02', '10:00', '王小明']), row(['10-16', '10:00', '王小明'])];
    assert.deepEqual(aboveeLoadRange([photo(rows)]), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(aboveeLoadRange([photo(rows, { dateFromText: '2026/09/25', dateToText: '2026/11/02' })]),
      { from: '2026-09-01', to: '2026-11-30' });
    assert.equal(aboveeLoadRange([photo([])]), null);
  });

  test('photoSpan：兩張有姓名的、頁數接得上 → 一段；接不上 → 兩段', () => {
    const a = photo([row(['10-02', '10:00', '王小明']), row(['10-05', '10:00', '王小明'])], { pageText: '4筆第1/2頁' });
    const b = photo([row(['10-09', '10:00', '王小明']), row(['10-16', '10:00', '王小明'])], { pageText: '4筆第2/2頁' });
    const joined = photoSpan([a, b]);
    assert.equal(joined.segments.length, 1);
    assert.deepEqual([joined.segments[0].firstPage, joined.segments[0].lastPage], [true, true]);
    const gap = photoSpan([{ ...a, pageText: '30筆第1/3頁' }, { ...b, pageText: '30筆第3/3頁' }]);
    assert.equal(gap.segments.length, 2);
  });
});
