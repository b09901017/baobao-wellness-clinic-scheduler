// 合併檔 v7：客戶帶電話、每一段帶送的／體驗（2026-10-14，gift-and-trial 08）。
//
// 她的原話：
//
// > 我先還沒匯，等全部調整修正優化完後我在匯，像是能夠讀取電話號碼
//
// 兩側一起測：skill 產得出來的東西 app 要收得下（各測各的話，兩邊對契約的理解會悄悄走開）。
// 名字一律假名、電話一律假的（0900 開頭）。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reconcile, importJson, reportText, applyPhones } from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { boardItems } from '../.claude/skills/calendar-sheet-merge/scripts/board.mjs';
import {
  FORMAT, FORMATS, validateFile, planForCustomer, addExtraVisits, slotsMissingEntitlement, summarize,
} from '../public/js/domain/mergeImport.js';
import { SEED } from '../public/js/domain/seed.js';
import { recount } from '../public/js/domain/visits.js';

const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];
const TODAY = '2026-10-05';

function sheetTsv(a2, { d = [0, 0, 0, 0, 0, 0, 0], dates, checks = {} }) {
  const cellsOf = (cells = []) => dates.map((_, i) => (cells[i] === true ? 'TRUE' : 'FALSE'));
  const out = [['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t')];
  LABELS.forEach((label, i) => out.push([i ? '' : a2, '', label, d[i], 0, ...cellsOf(checks[label])].join('\t')));
  return out.join('\n');
}

/** events：[日期, 時間, 標題] */
function run(sheets, events, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-v7-'));
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

/** 王小明：12 次 ILIB（9/11 做了一次）。李小華：12 次復能（三選一）。 */
const SHEETS = {
  王小明: { dates: ['9/11'], d: [0, 0, 0, 0, 0, 0, 12], checks: { 'ILIB 60mins': [true] } },
  李小華: { dates: ['9/12'], d: [0, 0, 0, 0, 0, 12, 0], checks: { '復能(1小時)': [true] } },
};
const EVENTS = [['2026-09-11', '15:00', '3.王小明IL治2'], ['2026-09-12', '10:00', '10.李小華IN']];
const CHARTS = { 王小明: '00001234' };

// ---------- 產檔那一側 ----------

describe('產檔那一側：--phones', () => {
  test('沒帶名單：每一位都沒有 phone 這個鍵；格式寫 v7', () => {
    const file = importJson(run(SHEETS, EVENTS), { generatedAt: 'fixed', calendar: 'fixed' });
    assert.equal(file.format, 'baobao-merge/v7');
    assert.ok(file.customers.every((c) => !('phone' in c)));
  });

  test('帶了名單：只多 phone 那一格，其餘一個位元都不變', () => {
    const plain = importJson(run(SHEETS, EVENTS, { chartNumbers: CHARTS }), { generatedAt: 'fixed', calendar: 'fixed' });
    const r = run(SHEETS, EVENTS, { chartNumbers: CHARTS, phones: { 1234: '0900-000-001', 李小華: '0900000002' } });
    const withPhones = importJson(r, { generatedAt: 'fixed', calendar: 'fixed' });
    assert.deepEqual(withPhones.customers.map((c) => [c.name, c.phone]).sort(), [['李小華', '0900000002'], ['王小明', '0900-000-001']]);
    const strip = (f) => JSON.stringify({ ...f, customers: f.customers.map(({ phone, ...c }) => c) });
    assert.equal(strip(withPhones), strip(plain));
    assert.deepEqual(r.phoneLog, { added: 2, missing: 0, differ: 0 });
  });

  test('先照病歷號對；病歷號對不到才比名字', () => {
    const r = run(SHEETS, EVENTS, { chartNumbers: CHARTS, phones: { '0001234': '0900-000-001', 王小明: '0900-999-999' } });
    assert.equal(r.plans.find((p) => p.customerName === '王小明').phone, '0900-000-001');
  });

  test('同一位兩支不一樣的：不寫、進 ⓪b、決定頁多一項；寫法不同的同一支不算不一樣', () => {
    const r = run(SHEETS, EVENTS, { chartNumbers: CHARTS, phones: { 1234: ['0900-000-001', '0900000001', '0900-000-003'], 李小華: ['0900 000 002', '0900000002'] } });
    const wang = r.plans.find((p) => p.customerName === '王小明');
    assert.equal(wang.phone, null);
    assert.ok(wang.problems.some((x) => x.where === '電話' && /不只一支/.test(x.why)), JSON.stringify(wang.problems));
    assert.equal(r.plans.find((p) => p.customerName === '李小華').phone, '0900 000 002');
    assert.deepEqual(r.phoneLog, { added: 1, missing: 0, differ: 1 });
    assert.ok(boardItems(r).items.some((x) => x.kind === 'sheet' && /電話/.test(x.title)));
    assert.match(reportText(r), /電話名單：寫了 1 位、名單上沒有 0 位、不只一支沒寫 1 位/);
  });

  test('名單上沒有的那一位：phone 是 null（帶了名單才有那一格）', () => {
    const file = importJson(run(SHEETS, EVENTS, { phones: { 李小華: '0900000002' } }));
    assert.equal(file.customers.find((c) => c.name === '王小明').phone, null);
  });

  test('applyPhones：舊表上同名兩位、照名字對 → 一位都不寫（寫錯一位比沒寫糟）', () => {
    const plan = (sheetName) => ({ sheetName, customerName: '客戶A', customer: { name: '客戶A', marks: [] }, problems: [] });
    const plans = [plan('客戶A'), plan('客戶A (2)')];
    const log = applyPhones(plans, { 客戶A: '0900000009' });
    assert.deepEqual(plans.map((p) => p.phone), [null, null]);
    assert.equal(log.differ, 2);
  });
});

describe('產檔那一側：送的／體驗', () => {
  const add = (date, a) => ({ customers: { 王小明: { slots: [{ date, add: a }] } } });
  const slotOn = (r, date) => importJson(r).customers.find((c) => c.name === '王小明').visits.find((v) => v.date === date)?.slots ?? [];

  test('不算次數的課（沒有額度）那一段寫 giftKind: trial', () => {
    const r = run(SHEETS, [...EVENTS, ['2026-09-18', '14:30', '2.30王小明HRV']], { decisions: add('2026-09-18', { course: '功醫門診', fromEvent: '2.30王小明HRV' }) });
    assert.deepEqual(slotOn(r, '2026-09-18').map((s) => [s.courseName, s.entitlementKey, s.giftKind]), [['功醫門診', null, 'trial']]);
  });

  test('一般的段沒有 giftKind 這個鍵', () => {
    assert.ok(slotOn(run(SHEETS, EVENTS), '2026-09-11').every((s) => !('giftKind' in s)));
  });

  test('決定檔「加一段」帶 free：任何課都可以（復能體驗、30 分）', () => {
    const r = run(SHEETS, EVENTS, { decisions: add('2026-09-20', { course: '復能', startsAt: '10:00', equipment: 'INDIBA', durationMin: 30, free: '體驗' }) });
    assert.deepEqual(r.decisionLog.stale, []);
    assert.deepEqual(slotOn(r, '2026-09-20').map((s) => [s.courseName, s.entitlementKey, s.giftKind, s.equipmentName, s.endsAt]),
      [['復能', null, 'trial', 'INDIBA', '10:30']]);
  });

  test('「送的」→ gift；身上有那門課的額度也不扣（ILIB 送的）', () => {
    const r = run(SHEETS, EVENTS, { decisions: add('2026-09-21', { course: 'ILIB', startsAt: '10:00', free: '送的' }) });
    assert.deepEqual(slotOn(r, '2026-09-21').map((s) => [s.entitlementKey, s.giftKind]), [[null, 'gift']]);
  });

  test('她決定的時長照寫，跟扣額度的段一樣（審查：以前照課程，她決定「功醫門診 60 分」會變回 30 分）', () => {
    const r = run(SHEETS, EVENTS, { decisions: add('2026-09-20', { course: '復能', startsAt: '10:00', durationMin: 45, free: '體驗' }) });
    assert.equal(slotOn(r, '2026-09-20')[0].endsAt, '10:45');
    const fm = run(SHEETS, EVENTS, { decisions: add('2026-09-20', { course: '功醫門診', startsAt: '10:00', durationMin: 60 }) });
    assert.deepEqual(slotOn(fm, '2026-09-20').map((s) => [s.giftKind, s.endsAt]), [['trial', '11:00']]);
  });

  test('健檢、二返沒有體驗：那一段不加，進 ⓪d', () => {
    for (const course of ['健檢', '二返']) {
      const r = run(SHEETS, EVENTS, { decisions: add('2026-09-22', { course, startsAt: '10:00', free: '體驗' }) });
      assert.equal(r.decisionLog.stale.length, 1, course);
      assert.match(r.decisionLog.stale[0].text, /沒有體驗／送的/);
      assert.deepEqual(slotOn(r, '2026-09-22'), []);
    }
  });

  test('free 寫了看不懂的字 → 不加、進 ⓪d', () => {
    const r = run(SHEETS, EVENTS, { decisions: add('2026-09-22', { course: '復能', free: '贈送' }) });
    assert.match(r.decisionLog.stale[0].text, /看不懂/);
  });
});

// ---------- app 那一側 ----------

const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, existingCustomers: [], today: TODAY,
};
const POOL = { key: 'r6', type: 'pool', label: '復能(1小時)', totalQty: 12, durationMin: 60, courseName: null, optionEquipmentNames: ['INDIBA', 'SIS', '高能量雷射'], productName: null };
const entry = (slots, over = {}) => ({
  sheetName: '王小明', name: '王小明', notes: '', entitlements: [POOL],
  visits: [{ date: '2026-09-18', status: 'done', slots }], ...over,
});
const blank = { startsAt: '10:00', endsAt: '10:30', roomName: null, therapistName: null, equipmentName: null, ivProductName: null };
const FM = SEED.courses.find((c) => c.name === '功醫門診');

describe('契約：baobao-merge/v7', () => {
  test('兩側同一版；v1～v6 照收', () => {
    assert.equal(FORMAT, 'baobao-merge/v7');
    for (const v of [1, 2, 3, 4, 5, 6, 7]) assert.ok(FORMATS.includes(`baobao-merge/v${v}`), `v${v}`);
    assert.equal(importJson(run(SHEETS, EVENTS)).format, FORMAT);
  });

  const file = (customer) => ({ format: FORMAT, customers: [{ name: '王小明', entitlements: [], visits: [], ...customer }] });
  const slotFile = (giftKind) => file({ visits: [{ date: '2026-09-18', slots: [{ courseName: '復能', ...blank, giftKind }] }] });

  test('phone：字串、null、沒有那一格都收；其餘形狀整份拒收', () => {
    for (const phone of ['0900000001', null, undefined]) assert.deepEqual(validateFile(file({ phone })).errors, [], String(phone));
    for (const phone of [900000001, ['0900000001'], {}]) assert.equal(validateFile(file({ phone })).errors.length, 1, JSON.stringify(phone));
  });

  test('giftKind：trial、gift、null、沒有那一格都收；其餘（free）整份拒收', () => {
    for (const k of ['trial', 'gift', null, undefined]) assert.deepEqual(validateFile(slotFile(k)).errors, [], String(k));
    for (const k of ['free', '體驗', true]) assert.equal(validateFile(slotFile(k)).errors.length, 1, String(k));
  });
});

describe('app 那一側：匯進來', () => {
  test('電話寫進客戶；沒有那一格是 null', () => {
    assert.equal(planForCustomer(entry([], { phone: ' 0900-000-001 ' }), CTX).customer.phone, '0900-000-001');
    assert.equal(planForCustomer(entry([]), CTX).customer.phone, null);
  });

  test('一段 IN 30 體驗：不扣那一池、寫 giftKind、時段照檔案（30 分）', () => {
    const plan = planForCustomer(entry([{ ...blank, courseName: '復能', equipmentName: 'INDIBA', entitlementKey: null, giftKind: 'trial' }]), CTX);
    assert.deepEqual(plan.problems, []);
    const [s] = plan.visits[0].slots;
    assert.deepEqual([s.entitlementKey, s.giftKind, s.endsAt], [null, 'trial', '10:30']);
    const visits = plan.visits.map((v) => ({ ...v, slots: v.slots.map(({ entitlementKey, ...x }) => ({ ...x, entitlementId: entitlementKey })) }));
    assert.equal(recount(['r6'], visits).r6.doneCount, 0, '那一池一次都沒扣');
  });

  test('giftKind 有值就不扣（檔案上就算寫了 entitlementKey）', () => {
    const plan = planForCustomer(entry([{ ...blank, courseName: '復能', entitlementKey: 'r6', giftKind: 'gift' }]), CTX);
    assert.deepEqual([plan.visits[0].slots[0].entitlementKey, plan.visits[0].slots[0].giftKind], [null, 'gift']);
  });

  test('健檢帶 giftKind：那一段不匯，problem 講得出為什麼', () => {
    const plan = planForCustomer(entry([{ ...blank, courseName: '健檢', entitlementKey: null, giftKind: 'trial' }]), CTX);
    assert.deepEqual(plan.visits, []);
    assert.match(plan.problems[0].why, /健檢與二返沒有體驗／送的/);
  });

  test('v5、v6 的功醫門診（沒有額度、沒有 giftKind）→ 照舊放行、寫實成 trial', () => {
    const plan = planForCustomer(entry([{ ...blank, courseName: '功醫門診', entitlementKey: null }]), CTX);
    assert.deepEqual([plan.visits[0].slots[0].courseId, plan.visits[0].slots[0].giftKind], [FM.id, 'trial']);
  });

  test('扣額度的段：giftKind 是 null（寫實）', () => {
    const plan = planForCustomer(entry([{ ...blank, courseName: '復能', equipmentName: 'SIS', entitlementKey: 'r6' }]), CTX);
    assert.deepEqual([plan.visits[0].slots[0].entitlementKey, plan.visits[0].slots[0].giftKind], ['r6', null]);
  });

  test('補的候選（addExtraVisits）：不算次數的課沒有額度 → trial；扣額度的 → null', () => {
    const plans = [planForCustomer(entry([]), CTX)];
    const problems = addExtraVisits(plans, [
      { customerName: '王小明', date: '2026-09-25', courseName: '功醫門診', startsAt: '15:00', status: 'done' },
      { customerName: '王小明', date: '2026-09-26', courseName: '復能', startsAt: '10:00', status: 'done' },
    ], CTX);
    assert.deepEqual(problems, []);
    const slots = plans[0].visits.flatMap((v) => v.slots);
    assert.deepEqual(slots.map((s) => [s.courseId, s.entitlementKey, s.giftKind]), [[FM.id, null, 'trial'], ['course-recovery', 'r6', null]]);
  });

  test('寫入前那一道：體驗的復能不算「少了額度」；沒有額度又不是體驗的照舊擋', () => {
    const byId = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));
    const ok = { courseId: 'course-recovery', entitlementId: null, giftKind: 'trial' };
    const bad = { courseId: 'course-recovery', entitlementId: null, giftKind: null };
    assert.deepEqual(slotsMissingEntitlement([{ slots: [ok] }], byId), []);
    assert.deepEqual(slotsMissingEntitlement([{ slots: [bad] }], byId), [bad]);
  });

  test('摘要卡：幾位帶電話', () => {
    const plans = [planForCustomer(entry([], { phone: '0900000001' }), CTX), planForCustomer(entry([], { name: '李小華', sheetName: '李小華' }), CTX)];
    assert.equal(summarize(plans).phones, 1);
  });
});

describe('電話名單從 Abovee 擷取結果建（phones.mjs）', () => {
  test('有病歷號照病歷號收、沒有的照名字；同一支只留一次；不只一支整串留著', async () => {
    const { phoneList } = await import('../.claude/skills/calendar-sheet-merge/scripts/phones.mjs');
    assert.deepEqual(phoneList([
      { chartNo: '00001234', name: '王小明', phone: '0900-000-001' },
      { chartNo: '00001234', name: '王小明', phone: '0900000001' },
      { chartNo: '', name: '李小華', phone: '0900000002' },
      { chartNo: '', name: '李小華', phone: '0900000003' },
      { chartNo: '5678', name: '客戶A', phone: '' },
    ]), { '00001234': '0900-000-001', 李小華: ['0900000002', '0900000003'] });
  });
});
