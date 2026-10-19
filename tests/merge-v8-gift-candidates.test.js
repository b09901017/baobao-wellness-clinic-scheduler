// 合併檔 v8：一開始就是新的 —— 「EECP體驗」→ EECP 的體驗；候選也帶 giftKind（2026-10-18，staging-polish 11，ADR-0155）。
//
// 她的原話：
//
// > 能不能幫我去改合併檔就好，反正現在我也還沒有真的開始使用，隨時都可以清空重來，沒有舊的之分，我要匯入時是新的就好
// >
// > 不要在靠資料健檢處理，一開始匯入時就應該是好的，
//
// 「EECP體驗」那一門 2026-10-18 合成進 EECP（ADR-0154）。產檔那側以前照它的名字寫，候選（`futureVisits`／`missingFromSheet`）
// 又只帶課程 —— 改成寫 EECP 之後，app 照課程判扣不扣，一筆體驗的候選會扣掉那位唯一一筆 EECP 額度。所以候選帶 `giftKind`、升 v8。
//
// **這一行會不會讓一段體驗被算進 EECP 的額度，或反過來？** 兩側一起測：skill 產得出來的東西 app 要收得下。
// 名字一律假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reconcile, importJson, coursesOf } from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import {
  FORMAT, FORMATS, validateFile, planForCustomer, addExtraVisits, slotsMissingEntitlement,
} from '../public/js/domain/mergeImport.js';
import { SEED } from '../public/js/domain/seed.js';
import { slotName } from '../public/js/domain/naming.js';

const TODAY = '2026-10-05';
const LABELS = ['EECP', '復能(1小時)'];

/** dates：表頭的日期；checks：{ 列名: [第幾天勾了] } */
function sheetTsv(a2, { dates, labels = LABELS, d = [10, 12], checks = {} }) {
  const cellsOf = (cells = []) => dates.map((_, i) => (cells[i] === true ? 'TRUE' : 'FALSE'));
  const out = [['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t')];
  labels.forEach((label, i) => out.push([i ? '' : a2, '', label, d[i], 0, ...cellsOf(checks[label])].join('\t')));
  return out.join('\n');
}

/** events：[日期, 時間, 標題] */
function run(sheets, events, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-v8-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  for (const [name, spec] of Object.entries(sheets)) writeFileSync(join(sheetsDir, `${name}.tsv`), sheetTsv(name, spec));
  const icsPath = join(dir, 'cal.ics');
  const ymd = (x) => x.replace(/-/g, '');
  writeFileSync(icsPath, [
    'BEGIN:VCALENDAR',
    ...events.map(([date, time, title], i) => [
      'BEGIN:VEVENT', `UID:${i}`, `DTSTART;TZID=Asia/Taipei:${ymd(date)}T${time.replace(':', '')}00`,
      `SUMMARY:${title}`, 'END:VEVENT',
    ].join('\r\n')),
    'END:VCALENDAR',
  ].join('\r\n'));
  return reconcile({ sheetsDir, icsPath, year: 2026, today: TODAY, ...extra });
}

/** 王小明：10 次 EECP，9/11 勾了一次。 */
const SHEETS = { 王小明: { dates: ['9/11'], checks: { EECP: [true] } } };
const EECP_DAY = ['2026-09-11', '14:00', '2.王小明EECP治8'];
const fileOf = (r) => importJson(r, { generatedAt: 'fixed', calendar: 'fixed' });
const add = (date, a) => ({ customers: { 王小明: { slots: [{ date, add: a }] } } });
const slotsOn = (r, date) => fileOf(r).customers.find((c) => c.name === '王小明').visits.find((v) => v.date === date)?.slots ?? [];

describe('產檔那一側', () => {
  // 2026-10-20 起寫 v9（段的記一句、已取消的段、長備註，`tests/merge-v9.test.js`）—— v8 的那一格照舊在
  test('格式寫最新的那一版，跟 app 的 FORMAT 一樣', () => {
    assert.equal(fileOf(run(SHEETS, [EECP_DAY])).format, 'baobao-merge/v10');
    assert.equal(FORMAT, 'baobao-merge/v10');
  });

  test('「EECP體驗」→ EECP、體驗；「EECP」照舊是正式課（沒有第三格）', () => {
    assert.deepEqual(coursesOf('2.45王小明EECP體驗.治8'), [{ course: 'EECP', equip: null, giftKind: 'trial' }]);
    assert.deepEqual(coursesOf('2.王小明EECP治8'), [{ course: 'EECP', equip: null, giftKind: null }]);
  });

  test('過去的「EECP體驗」、舊表那一天沒勾 → 候選 courseName EECP、giftKind trial；一般的候選沒有那一格', () => {
    const r = run(SHEETS, [EECP_DAY, ['2026-09-18', '14:45', '2.45王小明EECP體驗.治8'], ['2026-09-25', '14:00', '2.王小明EECP治8']]);
    const file = fileOf(r);
    const at = (date) => file.missingFromSheet.find((x) => x.date === date);
    assert.deepEqual([at('2026-09-18').courseName, at('2026-09-18').giftKind], ['EECP', 'trial']);
    assert.equal(at('2026-09-25').courseName, 'EECP');
    assert.ok(!('giftKind' in at('2026-09-25')));
  });

  test('未來的「EECP體驗」→ futureVisits 帶 giftKind trial', () => {
    const [x] = fileOf(run(SHEETS, [EECP_DAY, ['2026-10-20', '14:45', '2.45王小明EECP體驗.治8']])).futureVisits;
    assert.deepEqual([x.courseName, x.giftKind, x.startsAt], ['EECP', 'trial', '14:45']);
  });

  // 以前是兩門課、自然配不上。合成一門之後配上的話，那一天扣額度的那一次被一段體驗吃掉（③ 也不會講）
  test('舊表那一天勾了 EECP、行事曆只寫「EECP體驗」→ 不配：舊表那一格照舊是 ③，行事曆那一筆照舊是 ②', () => {
    const r = run(SHEETS, [['2026-09-11', '14:45', '2.45王小明EECP體驗.治8']]);
    const [slot] = slotsOn(r, '2026-09-11');
    assert.equal(slot.startsAt, null, '舊表那一格沒有配到時間');
    assert.equal(r.leftover.calendarOnly.length, 1);
    assert.equal(r.leftover.calendarOnly[0].giftKind, 'trial');
  });

  test('決定檔「加一段」EECP＋體驗：14:45 → 15:05（體驗的時候排幾分）、診間照行事曆、不扣', () => {
    const r = run(SHEETS, [EECP_DAY, ['2026-09-18', '14:45', '2.45王小明EECP體驗.治8']],
      { decisions: add('2026-09-18', { course: 'EECP', free: '體驗', fromEvent: '2.45王小明EECP體驗.治8' }) });
    assert.deepEqual(r.decisionLog.stale, []);
    const [s] = slotsOn(r, '2026-09-18');
    assert.deepEqual([s.courseName, s.entitlementKey, s.giftKind, s.startsAt, s.endsAt, s.roomName],
      ['EECP', null, 'trial', '14:45', '15:05', '治8']);
  });

  test('她決定的時長照寫（體驗 60 分 → 15:45）', () => {
    const r = run(SHEETS, [EECP_DAY], { decisions: add('2026-09-18', { course: 'EECP', free: '體驗', startsAt: '14:45', durationMin: 60 }) });
    assert.equal(slotsOn(r, '2026-09-18')[0].endsAt, '15:45');
  });

  test('決定檔還寫著舊的課名「EECP體驗」→ 寫成 EECP 的體驗（不進 ⓪d）', () => {
    const r = run(SHEETS, [EECP_DAY], { decisions: add('2026-09-18', { course: 'EECP體驗', startsAt: '14:45' }) });
    assert.deepEqual(r.decisionLog.stale, []);
    const [s] = slotsOn(r, '2026-09-18');
    assert.deepEqual([s.courseName, s.entitlementKey, s.giftKind, s.endsAt], ['EECP', null, 'trial', '15:05']);
  });

  test('決定檔指名一門主檔沒有的課 → 不加、進 ⓪d、講得出是哪一門', () => {
    const r = run(SHEETS, [EECP_DAY], { decisions: add('2026-09-18', { course: '雷射美白', startsAt: '14:45' }) });
    assert.equal(r.decisionLog.stale.length, 1);
    assert.match(r.decisionLog.stale[0].text, /主檔沒有「雷射美白」/);
    assert.deepEqual(slotsOn(r, '2026-09-18'), []);
  });

  // 她的舊表 10/18 數過一列都沒有；有的話不猜（買的是 EECP 的次數？送的？），也不叫她去把那門課建回來
  test('舊表有一列叫「EECP體驗」→ 那一列不匯、⓪b 講得出它合成進 EECP 了', () => {
    const r = run({ 王小明: { dates: ['9/11'], labels: ['EECP', 'EECP體驗'], d: [10, 1], checks: { EECP體驗: [true] } } }, []);
    const [p] = r.plans;
    const said = p.problems.find((x) => x.raw === 'EECP體驗');
    assert.match(said?.why ?? '', /合成進 EECP/);
    assert.doesNotMatch(said.why, /先去主檔把課程建起來/);
    assert.ok(!p.entitlements.some((e) => /EECP體驗/.test(e.doc.label ?? '')));
  });

  test('扣額度的 EECP 照舊 60 分', () => {
    const [s] = slotsOn(run(SHEETS, [EECP_DAY]), '2026-09-11');
    assert.deepEqual([s.courseName, s.giftKind, s.startsAt, s.endsAt], ['EECP', undefined, '14:00', '15:00']);
  });
});

// ---------- app 那一側 ----------

const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, existingCustomers: [], today: TODAY,
};
const EECP_ENT = { key: 'r1', type: 'single', label: 'EECP', totalQty: 10, durationMin: 60, courseName: 'EECP', optionEquipmentNames: [], productName: null };
const entry = (over = {}) => ({ sheetName: '王小明', name: '王小明', notes: '', entitlements: [EECP_ENT], visits: [], ...over });
const master = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts };

describe('契約：baobao-merge/v8', () => {
  test('v1～v8 照收；不認得的版本整份拒收（不是安靜吃掉）', () => {
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) assert.ok(FORMATS.includes(`baobao-merge/v${v}`), `v${v}`);
    const errors = validateFile({ format: 'baobao-merge/v11', customers: [] }).errors;
    assert.equal(errors.length, 1);
    assert.match(errors[0], /格式不對/);
  });

  const file = (candidate) => ({
    format: FORMAT, customers: [{ name: '王小明', entitlements: [], visits: [] }],
    futureVisits: [{ customerName: '王小明', date: '2026-10-20', courseName: 'EECP', startsAt: '14:45', ...candidate }],
  });

  test('候選的 giftKind：trial、gift、沒有那一格都收；其餘整份拒收', () => {
    for (const k of ['trial', 'gift', undefined]) assert.deepEqual(validateFile(file({ giftKind: k })).errors, [], String(k));
    for (const k of ['free', '體驗', true]) assert.equal(validateFile(file({ giftKind: k })).errors.length, 1, String(k));
  });
});

describe('app 那一側：候選勾起來補進去', () => {
  const extra = (over = {}) => ({ customerName: '王小明', date: '2026-10-20', courseName: 'EECP', startsAt: '14:45', status: 'confirmed', ...over });
  const added = (x) => {
    const plan = planForCustomer(entry(), CTX);
    const problems = addExtraVisits([plan], [x], CTX);
    return { plan, problems, slot: plan.visits[0]?.slots.at(-1) ?? null };
  };

  test('候選是體驗、身上有一筆 EECP 額度 → 那一段是體驗、不扣那一筆（已排不會多 1）、20 分', () => {
    const { plan, problems, slot } = added(extra({ giftKind: 'trial' }));
    assert.deepEqual(problems, []);
    assert.deepEqual([slot.entitlementKey, slot.giftKind, slot.endsAt], [null, 'trial', '15:05']);
    const charged = plan.visits.flatMap((v) => v.slots).filter((s) => s.entitlementKey === 'r1');
    assert.equal(charged.length, 0);
    assert.equal(slotName({ ...slot, courseId: SEED.courses.find((c) => c.name === 'EECP').id }, master, 'short'), 'EECP(20)(體驗)');
  });

  test('候選沒寫 giftKind（一般的 EECP）→ 照舊扣那一筆、60 分', () => {
    const { problems, slot } = added(extra());
    assert.deepEqual(problems, []);
    assert.deepEqual([slot.entitlementKey, slot.giftKind ?? null, slot.endsAt], ['r1', null, '15:45']);
  });

  test('送的也一樣不扣', () => {
    const { slot } = added(extra({ giftKind: 'gift' }));
    assert.deepEqual([slot.entitlementKey, slot.giftKind], [null, 'gift']);
  });

  test('健檢、二返沒有體驗：那一筆不補、講出來', () => {
    const plan = planForCustomer(entry(), CTX);
    const problems = addExtraVisits([plan], [extra({ courseName: '健檢', giftKind: 'trial' })], CTX);
    assert.equal(problems.length, 1);
    assert.match(problems[0].why, /沒有體驗／送的/);
    assert.equal(plan.visits.length, 0);
  });

  test('寫入之前那一道：體驗的 EECP 沒有額度是對的', () => {
    const { plan } = added(extra({ giftKind: 'trial' }));
    const courseId = SEED.courses.find((c) => c.name === 'EECP').id;
    const visits = plan.visits.map((v) => ({ ...v, slots: v.slots.map((s) => ({ ...s, entitlementId: null, courseId })) }));
    const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));
    assert.deepEqual(slotsMissingEntitlement(visits, coursesById), []);
  });
});
