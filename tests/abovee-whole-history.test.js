// 拍 Abovee：算「還剩幾次」、預選、提醒一律拿那位客戶的**全部**來訪（prelaunch-fixes-2026-10-08/09）。
//
// 確認層以前拿壓表那一頁讀進來的來訪（最近 180 天）算 —— 半年前打完的那一筆看起來還有剩，
// 於是預選它、那一列預設打勾、也不講「排完會超過」。壓表那一頁自己存檔前會重讀全部，確認層在打開時沒有。
//
// **這一支有沒有任何一條路，讓確認層安靜地拿一份不完整的來訪去算次數？** —— 沒有：
// 照片上認得的每一位打開時各讀一次全部；她換到一位還沒讀過的，那一下再讀；
// 讀不到的那一位不預設打勾、那一列講一句。例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { customersOnPhoto, partialSay, planAbovee, readAbovee, resolveItem } from '../public/js/domain/aboveeImport.js';
import { validateVisit } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';

const master = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [
  { id: 'c-wang', name: '王小明', marks: chart('1234') },
  { id: 'c-lee', name: '李小華', marks: chart('5678') },
];
// A：護肝排毒 6 次，200 多天前打完。B：腸道修復 6 次，還沒用
const A = { id: 'A', type: 'single', label: '營養點滴-護肝排毒', courseId: 'course-iv-drip', ivProductId: 'iv-liver', totalQty: 6, doneCount: 6, bookedCount: 0 };
const B = { id: 'B', type: 'single', label: '營養點滴-腸道修復', courseId: 'course-iv-drip', ivProductId: 'iv-gut', totalQty: 6, doneCount: 0, bookedCount: 0 };
const OLD = ['2026-01-06', '2026-01-20', '2026-02-03', '2026-02-17', '2026-03-03', '2026-03-17'].map((date, i) => ({
  id: `old${i}`, customerId: 'c-wang', date, status: 'done',
  slots: [{ entitlementId: 'A', courseId: 'course-iv-drip', ivProductId: 'iv-liver', startsAt: '10:00', endsAt: '11:30', roomId: 'room-iv5', status: 'done' }],
}));
const TODAY = '2026-10-08';
/** 壓表那一頁讀的範圍：今天往回 180 天起 */
const RECENT = OLD.filter((v) => v.date >= '2026-04-11');

const COLUMNS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間'];
const photo = (rows) => ({ readable: true, columns: COLUMNS, rows });
const LIVER = ['確認前往', '2026-10-20', '10:00 - 11:15', '王小明', '00001234', '護肝排毒', '點滴室5'];

const ctx = (ents, visits, over = {}) => ({
  customers: CUSTOMERS, entitlementsBy: { 'c-wang': ents }, visitsBy: { 'c-wang': visits }, master, today: TODAY, ...over,
});

/** 那一列存下去之前會講的提醒（跟確認層 `plan()` 同一支 `validateVisit()`）。 */
function warningsOf(item, c) {
  const { groups } = planAbovee([{ ...item, checked: true }], c);
  if (!groups.length) return [];
  return validateVisit(groups[0].visit, {
    customer: { flags: [] }, entitlements: c.entitlementsBy['c-wang'],
    courses: master.courses, equipment: master.equipment, rooms: master.rooms, staff: master.staff, ivProducts: master.ivProducts,
    customerVisits: c.visitsBy['c-wang'], sameDayVisits: [],
  }).warnings;
}

describe('給全部來訪：次數是對的', () => {
  test('兩筆營養點滴、一筆半年前打完：預選還沒用的那一筆，而且講品項跟買的不一樣', () => {
    const c = ctx([A, B], OLD);
    const [item] = readAbovee([photo([LIVER])], c).items;
    assert.equal(item.entitlementId, 'B');
    assert.ok(warningsOf(item, c).some((w) => w.includes('品項跟買的不一樣')));
  });

  test('只有打完的那一筆：照樣選它（Abovee 上已經約了），但「會超過總次數」打開時就算得出來', () => {
    const c = ctx([A], OLD);
    const [item] = readAbovee([photo([LIVER])], c).items;
    assert.equal(item.entitlementId, 'A');
    assert.ok(warningsOf(item, c).some((w) => w.includes('超過總次數')));
  });

  test('對照：只給 180 天那一份，預選的是打完的那一筆、一句提醒都沒有 —— 所以不可以拿那一份算', () => {
    const c = ctx([A, B], RECENT);
    const [item] = readAbovee([photo([LIVER])], c).items;
    assert.equal(item.entitlementId, 'A');
    assert.deepEqual(warningsOf(item, c).filter((w) => /超過總次數|品項/.test(w)), []);
  });

  test('半年前同一個時間的段不會被當成這一次的（「已經記了」比的是同一天）', () => {
    const [item] = readAbovee([photo([LIVER])], ctx([A, B], OLD)).items;
    assert.equal(item.kind, 'new');
  });
});

describe('照片上認得哪幾位（customersOnPhoto）', () => {
  test('認得的每一位一次；認不得的不算', () => {
    const rows = [
      LIVER,
      ['確認前往', '2026-10-21', '10:00 - 11:15', '王小明', '00001234', '護肝排毒', '點滴室5'],
      ['確認前往', '2026-10-21', '14:00 - 15:15', '李小華', '00005678', 'EECP60', '治療室5'],
      ['確認前往', '2026-10-22', '14:00 - 15:15', '陳大文', '00009999', 'EECP60', '治療室5'],
    ];
    assert.deepEqual(customersOnPhoto([photo(rows)], CUSTOMERS).sort(), ['c-lee', 'c-wang']);
  });

  test('沒有姓名那一欄的照片：一位都沒有', () => {
    assert.deepEqual(customersOnPhoto([{ columns: ['診間', '服務資源'], rows: [['點滴室5', '']] }], CUSTOMERS), []);
  });
});

describe('讀不到全部的那一位：不安靜地照算', () => {
  test('那一列不預設打勾、講一句；別位照舊', () => {
    const c = ctx([A, B], RECENT, { partial: new Set(['c-wang']) });
    const [item] = readAbovee([photo([LIVER])], c).items;
    assert.equal(item.kind, 'new');
    assert.equal(item.checked, false);
    assert.match(partialSay(item), /沒有讀到全部/);

    const whole = readAbovee([photo([LIVER])], ctx([A, B], OLD)).items[0];
    assert.equal(whole.checked, true);
    assert.equal(partialSay(whole), '');
  });

  test('之後讀到了（她再選一次同一位）：那一句不見、照全部重算', () => {
    const before = readAbovee([photo([LIVER])], ctx([A, B], RECENT, { partial: new Set(['c-wang']) })).items[0];
    const after = resolveItem(before, 'c-wang', ctx([A, B], OLD));
    assert.equal(partialSay(after), '');
    assert.equal(after.entitlementId, 'B');
  });

  test('已經記了／對不上的列不講那一句（比的是同一天，那幾天的來訪另外讀了）', () => {
    const there = { id: 'v1', customerId: 'c-wang', date: '2026-10-20', status: 'confirmed',
      slots: [{ entitlementId: 'B', courseId: 'course-iv-drip', ivProductId: 'iv-liver', startsAt: '10:00', endsAt: '11:30', status: 'confirmed' }] };
    const [item] = readAbovee([photo([LIVER])], ctx([A, B], [there], { partial: new Set(['c-wang']) })).items;
    assert.equal(item.kind, 'recorded');
    assert.equal(partialSay(item), '');
  });
});

describe('確認層餵給翻譯的來訪（掃原始碼）', () => {
  const src = readFileSync(new URL('../public/js/ui/components/aboveeConfirm.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  test('全部來訪只有一支在讀：loadHistory() → listByCustomer()，讀不到的記進 partial', () => {
    const body = src.slice(src.indexOf('async function loadHistory('), src.indexOf('// ---------- 畫 ----------'));
    assert.match(body, /visitsData\.listByCustomer\(/);
    assert.match(body, /partial/);
    assert.match(body, /isOffline\(\)/, '離線時 Firestore 回的是快取裡剛好有的那幾筆，不算讀到全部');
  });

  test('打開時：先替照片上認得的每一位讀全部，才翻譯', () => {
    const start = src.slice(src.indexOf('async function start()'), src.indexOf('async function loadHistory('));
    const load = start.indexOf('loadHistory(customersOnPhoto(');
    const read = start.indexOf('readAbovee(transcripts, ctx)');
    assert.ok(load > 0 && read > load, 'loadHistory() 要排在 readAbovee() 前面');
    // 撞期要的那一份（那幾天全部客戶的來訪）照舊
    assert.match(start, /visitsData\.listBetween\(/);
  });

  test('「換一位」：先讀那一位的全部，才重算那一列', () => {
    const at = src.indexOf('t.dataset.ablWho');
    const block = src.slice(at, src.indexOf('t.dataset.ablOpt', at));
    assert.match(block, /pickWho\(/);
    const pick = src.slice(src.indexOf('async function pickWho('));
    const load = pick.indexOf('await loadHistory(');
    const resolve = pick.indexOf('resolveItem(');
    assert.ok(load > 0 && resolve > load, '先 loadHistory() 再 resolveItem()');
  });

  test('存檔前那一次重讀還在（打開到存檔之間別台裝置可能動過）', () => {
    const write = src.slice(src.indexOf('const write = async () =>'));
    assert.match(write, /const fresh = await visitsData\.listByCustomer\(d\.customerId\)/);
  });

  test('整支檔案叫 readAbovee() 的只有打開那一次（別的地方重翻就會繞過 loadHistory()）', () => {
    // 註解裡寫的是 `readAbovee()`（空括號）；真的呼叫帶著參數
    assert.equal((src.match(/readAbovee\((?!\))/g) ?? []).length, 1);
  });
});
