// 拍 Abovee：一次送兩張都有「姓名」的照片（兩頁、同一頁拍兩次）怎麼接（prelaunch-fixes-2026-10-08/10）。
//
// 以前接起來之後用「名字原字＋病歷號＋日期＋開始時間」去重：
// - 同一張照片裡本來就不同的兩列（同人同時兩門課、取消之後同一格重約）鑰匙一樣 → 少記一段
// - 名字被抄錯一個字鑰匙就不一樣 → 同一段記兩次
//
// **這一支有沒有任何一條路，讓同一張照片裡的兩列被去掉一列？** —— 沒有：只拿不同張的列比，一列只配一次。
// **有沒有任何一條路，讓同一段預設勾兩次？** —— 鑰匙擋得住的併成一列（有病歷號用病歷號）；
// 擋不住的那一列不預設打勾、講一句。例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  markRepeat, mergeAboveePhotos, needsAttention, photoSpan, readAbovee, repeatSay, resolveItem, summarizeAbovee,
} from '../public/js/domain/aboveeImport.js';
import { SEED } from '../public/js/domain/seed.js';

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const master = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [
  { id: 'c-wang', name: '王小明', marks: chart('1234') },
  { id: 'c-lee', name: '李小華', marks: chart('5678') },
  { id: 'c-a', name: '陳大文', marks: [] },
];
const pool3 = (id) => ({ id, type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 });
const ilib = (id) => ({ id, type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 20 });
const ENTS = { 'c-wang': [pool3('w-pool'), ilib('w-ilib')], 'c-lee': [ilib('l-ilib')], 'c-a': [pool3('a-pool')] };
const ctx = (visitsBy = {}, today = '2026-07-01') => ({ customers: CUSTOMERS, entitlementsBy: ENTS, visitsBy, master, today });
const photo = (rows, over = {}) => ({ readable: true, columns: COLS, rows, ...over });

// 353 筆裡真的有的兩組形狀：同一位同一天同一個開始時間兩列
const ILIB_AND_CLINIC = [
  ['確認前往', '2026-07-02', '15:45 - 17:00', '王小明', '00001234', 'ILIB 60'],
  ['確認前往', '2026-07-02', '15:45 - 16:15', '王小明', '00001234', '復健門診'],
];
const CANCEL_THEN_REBOOK = [
  ['已取消', '2026-07-15', '14:00 - 15:15', '李小華', '00005678', 'ILIB 60'],
  ['課程完成', '2026-07-15', '14:00 - 15:15', '李小華', '00005678', 'ILIB 60'],
];
const NEXT_PAGE = [['確認前往', '2026-07-20', '09:00 - 10:15', '王小明', '00001234', 'SIS 60']];

describe('同一張照片裡的列永遠不互相去掉', () => {
  const page1 = photo([...ILIB_AND_CLINIC, ...CANCEL_THEN_REBOOK]);
  const page2 = photo(NEXT_PAGE);

  test('兩頁一起送：5 列都在（以前剩 3 列 —— 復健門診與重約的那一列不見）', () => {
    const { rows, pairing } = mergeAboveePhotos([page1, page2]);
    assert.equal(pairing, 'pages');
    assert.deepEqual(rows.map((r) => `${r.status} ${r.course}`), [
      '確認前往 ILIB 60', '確認前往 復健門診', '已取消 ILIB 60', '課程完成 ILIB 60', '確認前往 SIS 60',
    ]);
  });

  test('同人同時兩門課：兩列都在，各自的預設跟只送那一張時一樣', () => {
    const pick = (items) => items.filter((i) => i.date === '2026-07-02')
      .map((i) => [i.row.course, i.kind, i.checked, i.entitlementId, i.uncountedCourseId, repeatSay(i)]);
    const alone = pick(readAbovee([page1], ctx()).items);
    const both = pick(readAbovee([page1, page2], ctx()).items);
    assert.equal(both.length, 2);
    assert.deepEqual(both, alone);
  });

  test('同一張裡兩列一模一樣（只送一張）：兩列都在、照舊都預設打勾、不講「看起來是同一段」', () => {
    const twice = photo([NEXT_PAGE[0], NEXT_PAGE[0]]);
    const { items, pairing } = readAbovee([twice], ctx());
    assert.equal(pairing, 'single');
    assert.deepEqual(items.map((i) => [i.kind, i.checked, repeatSay(i)]), [['new', true, ''], ['new', true, '']]);
  });
});

describe('取消之後在同一格重約', () => {
  // app 上 7/15 14:00 那一段是已完成（重約的那一次）
  const done = { id: 'v1', customerId: 'c-lee', date: '2026-07-15', status: 'done',
    slots: [{ entitlementId: 'l-ilib', courseId: 'course-iv-laser', startsAt: '14:00', endsAt: '15:00', status: 'done' }] };

  for (const [label, transcripts] of [
    ['只送一張', [photo(CANCEL_THEN_REBOOK)]],
    ['兩頁一起送', [photo(CANCEL_THEN_REBOOK), photo(NEXT_PAGE)]],
  ]) {
    test(`${label}：兩列都在；取消的那一列不喊「Abovee 上取消了」，照新的、已取消走`, () => {
      const lee = readAbovee(transcripts, ctx({ 'c-lee': [done] }, '2026-10-08')).items.filter((i) => i.customerId === 'c-lee');
      assert.equal(lee.length, 2);
      const [gone, live] = lee;
      assert.deepEqual([gone.kind, gone.cancelled, gone.checked, gone.reason ?? null], ['new', true, false, null]);
      assert.equal(needsAttention(gone), false, '不進要你看');
      assert.equal(live.kind, 'recorded');
    });
  }

  test('照片上只有取消的那一列（沒有重約）：照舊喊對不上', () => {
    const [only] = readAbovee([photo([CANCEL_THEN_REBOOK[0]])], ctx({ 'c-lee': [done] }, '2026-10-08')).items;
    assert.deepEqual([only.kind, only.reason], ['mismatch', 'aboveeCancelled']);
  });

  test('重約的是別的課（同一格）：取消的那一列照舊喊對不上 —— 那不是它的重約', () => {
    const rows = [CANCEL_THEN_REBOOK[0], ['確認前往', '2026-07-15', '14:00 - 15:15', '李小華', '00005678', 'EECP60']];
    const [gone] = readAbovee([photo(rows)], ctx({ 'c-lee': [done] }, '2026-10-08')).items;
    assert.deepEqual([gone.kind, gone.reason], ['mismatch', 'aboveeCancelled']);
  });

  test('她把取消的那一列換成別人：不再當成重約（那是另一位的事）', () => {
    const [gone] = readAbovee([photo(CANCEL_THEN_REBOOK)], ctx({ 'c-lee': [done] }, '2026-10-08')).items;
    const other = { id: 'v2', customerId: 'c-wang', date: '2026-07-15', status: 'done',
      slots: [{ entitlementId: 'w-ilib', courseId: 'course-iv-laser', startsAt: '14:00', endsAt: '15:00', status: 'done' }] };
    const moved = resolveItem(gone, 'c-wang', ctx({ 'c-lee': [done], 'c-wang': [other] }, '2026-10-08'));
    assert.deepEqual([moved.kind, moved.reason], ['mismatch', 'aboveeCancelled']);
  });
});

describe('同一頁拍了兩次', () => {
  const ROW = ['確認前往', '2026-07-20', '09:00 - 10:15', '王小明', '00001234', 'SIS 60'];
  const with_ = (over) => ROW.map((cell, i) => (i in over ? over[i] : cell));

  test('兩張抄得一模一樣：一份，記著兩張都有它', () => {
    const { rows } = mergeAboveePhotos([photo([ROW, ...ILIB_AND_CLINIC]), photo([ROW, ...ILIB_AND_CLINIC])]);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0].photos, [0, 1]);
  });

  test('第二張名字抄錯一個字、有病歷號：一份（鑰匙是病歷號）', () => {
    const { items } = readAbovee([photo([ROW]), photo([with_({ 3: '王小朋' })])], ctx());
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].customerId, items[0].checked], ['c-wang', true]);
  });

  test('第二張名字抄錯一個字、沒有病歷號：兩列都在，第二列沒打勾、講一句', () => {
    const a = ['確認前往', '2026-07-20', '09:00 - 10:15', '陳大文', '', 'SIS 60'];
    const b = ['確認前往', '2026-07-20', '09:00 - 10:15', '陳大又', '', 'SIS 60'];
    const { items } = readAbovee([photo([a]), photo([b])], ctx());
    assert.equal(items.length, 2);
    assert.deepEqual([items[0].customerId, items[0].checked, repeatSay(items[0])], ['c-a', true, '']);
    assert.equal(items[1].checked, false);
    assert.match(repeatSay(items[1]), /看起來是同一段/);
    // 她替那一列選了同一位：照樣不打勾、那一句還在
    const picked = markRepeat(resolveItem(items[1], 'c-a', ctx()), items);
    assert.equal(picked.checked, false);
    assert.match(repeatSay(picked), /看起來是同一段/);
  });

  test('病歷號被抄錯一位、名字一樣（鑰匙擋不住、兩列都認成同一位）：第二列不預設打勾、講一句', () => {
    const a = ['確認前往', '2026-07-20', '09:00 - 10:15', '陳大文', '', 'SIS 60'];
    const { items } = readAbovee([photo([a]), photo([a.map((c, i) => (i === 4 ? '00007777' : c))])], ctx());
    // 第一張沒有號碼、第二張有 → 用名字比，是同一列
    assert.equal(items.length, 1);

    const { items: two } = readAbovee([
      photo([['確認前往', '2026-07-20', '09:00 - 10:15', '陳大文', '00001111', 'SIS 60']]),
      photo([['確認前往', '2026-07-20', '09:00 - 10:15', '陳大文', '00001112', 'SIS 60']]),
    ], ctx());
    assert.equal(two.length, 2, '兩張都有號碼、號碼不一樣 → 鑰匙認成兩列');
    assert.deepEqual(two.map((i) => i.customerId), ['c-a', 'c-a']);
    assert.deepEqual(two.map((i) => i.checked), [true, false]);
    assert.match(repeatSay(two[1]), /看起來是同一段/);
  });

  test('同一個時間、不同課的兩列（各在一張）不算同一段', () => {
    const { items } = readAbovee([photo([ILIB_AND_CLINIC[0]]), photo([ILIB_AND_CLINIC[1]])], ctx());
    assert.equal(items.length, 2);
    assert.deepEqual(items.map(repeatSay), ['', '']);
  });

  test('取消的與沒取消的不是同一列（翻頁切在重約的那一格中間）', () => {
    const { rows } = mergeAboveePhotos([photo([CANCEL_THEN_REBOOK[0]]), photo([CANCEL_THEN_REBOOK[1]])]);
    assert.equal(rows.length, 2);
  });
});

describe('兩張都有姓名、第二張少幾欄：那一格不參加比較，獨有的那幾格補回來', () => {
  const ROW = ['確認前往', '2026-07-20', '14:00 - 15:15', '李小華', '00005678', 'EECP60'];

  test('第二張沒有課程欄、多了診間與服務資源：一份，診間補上', () => {
    const second = { readable: true, columns: ['預約日期', '預約時段', '姓名', '病歷號', '診間', '服務資源'],
      rows: [['2026-07-20', '14:00 - 15:15', '李小華', '00005678', '治療室5', 'EECP1']] };
    const { rows } = mergeAboveePhotos([photo([ROW]), second]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].course, rows[0].room, rows[0].resource, rows[0].status], ['EECP60', '治療室5', 'EECP1', '確認前往']);
  });

  test('第二張沒有預約狀態欄：取消＋重約的兩列各配各的，還是兩列', () => {
    const second = { readable: true, columns: COLS.slice(1), rows: CANCEL_THEN_REBOOK.map((r) => r.slice(1)) };
    const { rows } = mergeAboveePhotos([photo(CANCEL_THEN_REBOOK), second]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.status), ['已取消', '課程完成']);
  });

  test('課程那一格兩張都有字、寫法只差空白與大小寫：同一列', () => {
    const { rows } = mergeAboveePhotos([photo([ROW]), photo([ROW.map((c, i) => (i === 5 ? 'eecp 60' : c))])]);
    assert.equal(rows.length, 1);
  });
});

describe('列少了或多了之後，別的地方數的是同一份列', () => {
  test('抬頭的數字＝畫面上的列', () => {
    const { items } = readAbovee([photo([...ILIB_AND_CLINIC, ...CANCEL_THEN_REBOOK]), photo(NEXT_PAGE)], ctx());
    const s = summarizeAbovee(items);
    assert.equal(s.total, 5);
    assert.equal(s.new + s.recorded + s.cancelled + items.filter((i) => !i.cancelled && !['new', 'recorded'].includes(i.kind)).length, 5);
  });

  test('photoSpan：同一張裡同時間的兩列各算一列（4 筆的那一頁讀得出「每一列都在這裡」）', () => {
    const page = photo([...ILIB_AND_CLINIC, ...CANCEL_THEN_REBOOK], { pageText: '4筆第1/1頁' });
    assert.equal(photoSpan([page]).segments[0].all, true);
  });

  test('photoSpan：同一頁拍兩次不會被算成兩倍的列（15 筆的第一頁不是「每一列都在這裡」）', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ['確認前往', `2026-07-${String(i + 1).padStart(2, '0')}`, '09:00 - 10:15', '王小明', '00001234', 'SIS 60']);
    const page = photo(ten, { pageText: '15筆第1/2頁' });
    const span = photoSpan([page, page]);
    assert.equal(span.segments.length, 1);
    assert.equal(span.segments[0].all, false);
  });
});

describe('左右兩半、只送一張照舊', () => {
  test('左右兩半照列的順序配，一列都不合併、不去掉', () => {
    const left = photo([...ILIB_AND_CLINIC, ...CANCEL_THEN_REBOOK]);
    const right = { readable: true, columns: ['診間', '服務資源'], rows: [['點滴室2', ''], ['', ''], ['點滴室3', ''], ['點滴室3', '']] };
    const { rows, pairing } = mergeAboveePhotos([left, right]);
    assert.equal(pairing, 'halves');
    assert.deepEqual(rows.map((r) => r.room ?? ''), ['點滴室2', '', '點滴室3', '點滴室3']);
  });

  test('只送一張：照片上有幾列就幾列', () => {
    const { rows, pairing } = mergeAboveePhotos([photo([...ILIB_AND_CLINIC, ...CANCEL_THEN_REBOOK])]);
    assert.equal(pairing, 'single');
    assert.equal(rows.length, 4);
  });
});
