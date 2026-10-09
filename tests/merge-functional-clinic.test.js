// 合併檔：功醫門診（行事曆寫 HRV 的那幾次）要進得來（2026-10-05，abovee-and-master/13）。
//
// 她的原話：
//
// > HRV 是自律神經檢查，通常直接接門診讓醫師講解報告。它自己不是一段課程，後面那一場門診才是
// > 4. 你的客人那幾次要（行事曆才對），體驗客人不要
//
// 功醫門診不算次數（ADR-0121），所以它那一段**沒有額度**。合併檔的契約跟著改：那一段沒有
// `entitlementKey`（升 `baobao-merge/v5`）；app 匯入時，課程在她主檔上是不算次數的才放行。
//
// 兩側一起測：skill 產得出來的東西 app 要收得下（各測各的話，兩邊對契約的理解會悄悄走開）。
// 名字一律假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  coursesOf, ivProductOf, reconcile, importJson, reportText,
} from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { boardItems } from '../.claude/skills/calendar-sheet-merge/scripts/board.mjs';
import {
  FORMAT, FORMATS, validateFile, planForCustomer, addExtraVisits, slotsMissingEntitlement,
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
  const dir = mkdtempSync(join(tmpdir(), 'merge-fm-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  for (const [name, spec] of Object.entries(sheets)) writeFileSync(join(sheetsDir, `${name}.tsv`), sheetTsv(name, spec));
  const icsPath = join(dir, 'cal.ics');
  const ymd = (d) => d.replace(/-/g, '');
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

/** 王小明：買了 12 次 ILIB，9/11 做了一次。 */
const WANG = { 王小明: { dates: ['9/11'], d: [0, 0, 0, 0, 0, 0, 12], checks: { 'ILIB 60mins': [true] } } };
const ILIB_DAY = ['2026-09-11', '15:00', '3.王小明IL治2'];

const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, existingCustomers: [], today: TODAY,
};
const FM = SEED.courses.find((c) => c.name === '功醫門診');

describe('產檔那一側：HRV 那一句是功醫門診，開始時間晚 30 分', () => {
  const courses = (s) => coursesOf(s).map((x) => x.course);

  test('HRV → 功醫門診，不再是心臟科評估', () => {
    assert.deepEqual(courses('2.30王小明HRV'), ['功醫門診']);
  });

  test('她直接寫「功醫」也認得', () => {
    assert.deepEqual(courses('2.30王小明功醫'), ['功醫門診']);
  });

  test('同一句還寫了 ABI：心臟科評估照舊排第一（那一句以前就是它，不猜）', () => {
    assert.equal(courses('2：30王小明HRV.ABI')[0], '心臟科評估');
    assert.equal(courses('王小明ABI&HRV')[0], '心臟科評估');
  });

  test('心臟科、心超、ABI 照舊是心臟科評估', () => {
    for (const s of ['9.王小明心臟科3檢查', '2.王小明心超', '王小明ABI']) assert.deepEqual(courses(s), ['心臟科評估'], s);
  });

  test('「功能醫學」照舊認成二返（她的行事曆與舊表上一次都沒出現過，沒有東西可以推翻它）', () => {
    assert.deepEqual(courses('2.王小明功能醫學'), ['二返']);
  });

  const r = run(WANG, [
    ILIB_DAY,
    ['2026-09-18', '14:30', '2.30王小明HRV'],
    ['2026-09-25', '14:30', '2.30王小明功醫'],
    ['2026-10-20', '09:00', '9.王小明HRV'],
    // 體驗客人：沒有舊表分頁
    ['2026-09-19', '14:00', '2.林小華HRV'],
  ]);
  const json = importJson(r);

  test('做過了、舊表沒勾的那一句：功醫門診，15:00（那一句的 14:30 是檢查，門診在後面）', () => {
    const x = json.missingFromSheet.find((m) => m.evidence === '2.30王小明HRV');
    assert.deepEqual([x.customerName, x.date, x.courseName, x.startsAt], ['王小明', '2026-09-18', '功醫門診', '15:00']);
  });

  test('她寫「功醫」的那一句時間照寫的（寫的就是門診）', () => {
    const x = json.missingFromSheet.find((m) => m.evidence === '2.30王小明功醫');
    assert.deepEqual([x.courseName, x.startsAt], ['功醫門診', '14:30']);
  });

  test('還沒發生的：以後的預約，一樣晚 30 分', () => {
    const x = json.futureVisits.find((m) => m.evidence === '9.王小明HRV');
    assert.deepEqual([x.date, x.courseName, x.startsAt], ['2026-10-20', '功醫門診', '09:30']);
  });

  test('以前產出來的心臟科評估那一段不見了', () => {
    const all = [...json.missingFromSheet, ...json.futureVisits];
    assert.deepEqual(all.filter((x) => x.courseName === '心臟科評估'), []);
  });

  test('體驗客人（沒有舊表分頁）：合併檔裡沒有他', () => {
    const text = JSON.stringify([json.customers, json.missingFromSheet, json.futureVisits]);
    assert.ok(!text.includes('林小華'));
  });

  test('報告上那一段寫的是功醫門診', () => {
    assert.match(reportText(r), /功醫門診/);
  });
});

describe('產檔那一側：她決定「有做，補這一段」—— 不算次數的課不用額度', () => {
  const decisions = {
    customers: {
      王小明: { slots: [{ date: '2026-09-18', add: { course: '功醫門診', fromEvent: '2.30王小明HRV' } }] },
    },
  };
  const r = run(WANG, [ILIB_DAY, ['2026-09-18', '14:30', '2.30王小明HRV']], { decisions });
  const json = importJson(r);
  const day = json.customers[0].visits.find((v) => v.date === '2026-09-18');

  test('那一天多一段功醫門診：沒有 entitlementKey、15:00–15:30', () => {
    assert.equal(day?.slots.length, 1, JSON.stringify(r.decisionLog));
    const [s] = day.slots;
    assert.deepEqual([s.courseName, s.entitlementKey, s.startsAt, s.endsAt], ['功醫門診', null, '15:00', '15:30']);
  });

  test('這一條決定用上了，沒有掉進「之前的決定沒對到」', () => {
    assert.deepEqual(r.decisionLog.stale, []);
  });

  test('補進去之後不再列在「行事曆有、舊表沒勾」', () => {
    assert.deepEqual(json.missingFromSheet, []);
  });

  test('要算次數的課照舊：沒有額度就加不進去，而且進 ⓪d', () => {
    const bad = {
      customers: { 王小明: { slots: [{ date: '2026-09-18', add: { course: '心臟科評估', fromEvent: '2.30王小明HRV' } }] } },
    };
    const r2 = run(WANG, [ILIB_DAY, ['2026-09-18', '14:30', '2.30王小明HRV']], { decisions: bad });
    assert.equal(r2.decisionLog.stale.length, 1);
    assert.match(r2.decisionLog.stale[0].text, /找不到要扣哪一份額度/);
  });
});

describe('決定頁：那一句照現在的形狀問，她答「有做」之後真的補得進去', () => {
  const events = [ILIB_DAY, ['2026-09-18', '14:30', '2.30王小明HRV']];
  const item = boardItems(run(WANG, events)).items.find((x) => x.kind === 'calendarOnly');

  test('是一項「行事曆有、舊表沒勾」，問的是功醫門診', () => {
    assert.match(item.title, /功醫門診/);
    assert.equal(item.date, '2026-09-18');
  });

  test('「有做」那一顆帶的決定，餵回去就是那一段（沒有額度、15:00）', () => {
    const yes = item.options.find((o) => o.id === 'yes');
    const [op] = yes.ops;
    const decisions = { customers: { [op.sheet]: { slots: [op.add] } } };
    const r = run(WANG, events, { decisions });
    assert.deepEqual(r.decisionLog.stale, []);
    const day = importJson(r).customers[0].visits.find((v) => v.date === '2026-09-18');
    assert.deepEqual(day.slots.map((s) => [s.courseName, s.entitlementKey, s.startsAt]), [['功醫門診', null, '15:00']]);
  });
});

describe('產檔那一側：新的 7 款點滴認得，而且「營養」兩個字不是營養守護', () => {
  test('寫了新品項的那一句算營養點滴', () => {
    for (const s of ['2.王小明皮蛇', '2.王小明.5元氣', '2.王小明免疫 點3', '2.王小明減脂', '2.王小明癒原', '2.王小明養心', '2.王小明營養守護']) {
      assert.ok(coursesOf(s).some((x) => x.course === '營養點滴'), s);
    }
  });

  test('品項讀得出來', () => {
    assert.equal(ivProductOf('2.王小明皮蛇', SEED.ivProducts), '皮蛇疫苗');
    assert.equal(ivProductOf('2.王小明.5元氣', SEED.ivProducts), '元氣活力');
    assert.equal(ivProductOf('2.王小明營養守護', SEED.ivProducts), '營養守護');
    assert.equal(ivProductOf('2.王小明營養守', SEED.ivProducts), '營養守護');
  });

  test('「營養點滴」「營養針」「營養師」「營養諮詢」不會被讀成營養守護', () => {
    for (const s of ['9.30王小明點滴2*營養師2點', '2.王小明營養點滴.8', '2.王小明營養針', '點滴.5 營養諮詢']) {
      assert.equal(ivProductOf(s, SEED.ivProducts), null, s);
    }
    assert.equal(ivProductOf('2.王小明營養點滴.8護肝', SEED.ivProducts), '護肝排毒');
  });

  test('養心舒眠與護心抗老分得開', () => {
    assert.equal(ivProductOf('2.王小明養心', SEED.ivProducts), '養心舒眠');
    assert.equal(ivProductOf('2.王小明護心', SEED.ivProducts), '護心抗老');
  });
});

describe('契約：baobao-merge/v6（v5 起不算次數的課沒有額度）', () => {
  test('兩側同一版', () => {
    assert.equal(FORMAT, 'baobao-merge/v6');
    assert.equal(importJson(run(WANG, [ILIB_DAY])).format, FORMAT);
  });

  test('v4 以前的照樣貼得進來；認不得的版本整份擋', () => {
    for (const v of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']) assert.ok(FORMATS.includes(`baobao-merge/${v}`), v);
    const file = importJson(run(WANG, [ILIB_DAY]));
    assert.deepEqual(validateFile({ ...file, format: 'baobao-merge/v4' }).errors, []);
    assert.equal(validateFile({ ...file, format: 'baobao-merge/v7' }).errors.length, 1);
  });
});

describe('app 那一側：沒有額度的那一段，不算次數的課才放行', () => {
  const entry = (slots) => ({
    sheetName: '王小明', name: '王小明', notes: '',
    entitlements: [{ key: 'r8', type: 'single', label: 'ILIB 60mins', totalQty: 12, courseName: 'ILIB', optionEquipmentNames: [], productName: null }],
    visits: [{ date: '2026-09-18', status: 'done', slots }],
  });
  const fm = { courseName: '功醫門診', startsAt: '15:00', endsAt: '15:30', roomName: null, therapistName: null, equipmentName: null, ivProductName: null };

  test('功醫門診沒有 entitlementKey：照樣匯進來，那一段不指任何額度', () => {
    const plan = planForCustomer(entry([{ ...fm, entitlementKey: null }]), CTX);
    assert.deepEqual(plan.problems, []);
    const [slot] = plan.visits[0].slots;
    assert.deepEqual([slot.courseId, slot.entitlementKey, slot.startsAt, slot.endsAt], [FM.id, null, '15:00', '15:30']);
    assert.equal(plan.visits[0].status, 'done');
  });

  test('整個沒有那一格（undefined）也一樣', () => {
    const plan = planForCustomer(entry([fm]), CTX);
    assert.equal(plan.visits[0].slots[0].entitlementKey, null);
  });

  test('次數一格都沒動：每一筆額度重算出來跟沒有那一段時一樣', () => {
    const ilib = { entitlementKey: 'r8', courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00', roomName: null, therapistName: null, equipmentName: null, ivProductName: null };
    const count = (slots) => {
      const plan = planForCustomer(entry(slots), CTX);
      const visits = plan.visits.map((v) => ({ ...v, slots: v.slots.map(({ entitlementKey, ...s }) => ({ ...s, entitlementId: entitlementKey })) }));
      return recount(plan.entitlements.map((e) => e.key), visits);
    };
    assert.deepEqual(count([ilib, fm]), count([ilib]));
    assert.equal(count([ilib, fm]).r8.doneCount, 1);
  });

  test('要算次數的課沒有 entitlementKey：照舊不匯、列在問題裡', () => {
    const plan = planForCustomer(entry([{ courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00' }]), CTX);
    assert.equal(plan.visits.length, 0);
    assert.match(plan.problems[0].why, /對不到任何一筆額度/);
  });

  test('entitlementKey 寫了但對不到：就算是不算次數的課也照舊擋（那是壞掉的檔案，不是沒有額度）', () => {
    const plan = planForCustomer(entry([{ ...fm, entitlementKey: 'r99' }]), CTX);
    assert.equal(plan.visits.length, 0);
    assert.match(plan.problems[0].why, /對不到任何一筆額度/);
  });

  test('她的主檔上那門課沒有勾不算次數：照舊擋', () => {
    const counted = { ...CTX, courses: SEED.courses.map((c) => (c.id === FM.id ? { ...c, uncounted: false } : c)) };
    const plan = planForCustomer(entry([fm]), counted);
    assert.equal(plan.visits.length, 0);
    assert.match(plan.problems[0].why, /對不到任何一筆額度/);
  });
});

describe('app 那一側：候選清單補的功醫門診', () => {
  const plans = () => [planForCustomer({
    sheetName: '王小明', name: '王小明', notes: '',
    entitlements: [{ key: 'r8', type: 'single', label: 'ILIB 60mins', totalQty: 12, courseName: 'ILIB', optionEquipmentNames: [], productName: null }],
    visits: [],
  }, CTX)];
  const extra = (over = {}) => ({ customerName: '王小明', date: '2026-09-18', courseName: '功醫門診', startsAt: '15:00', ...over });

  test('沒有那門課的額度：照樣補得進去，不扣任何一筆', () => {
    const p = plans();
    assert.deepEqual(addExtraVisits(p, [extra()], CTX), []);
    const [slot] = p[0].visits[0].slots;
    assert.deepEqual([slot.courseId, slot.entitlementKey, slot.startsAt, slot.endsAt], [FM.id, null, '15:00', '15:30']);
  });

  test('以後的那一筆建成已確認的預約', () => {
    const p = plans();
    addExtraVisits(p, [extra({ date: '2026-10-20', status: 'confirmed' })], CTX);
    assert.equal(p[0].visits[0].status, 'confirmed');
    assert.equal(p[0].visits[0].slots[0].attended, false);
  });

  test('她身上剛好有一筆那門課的額度：照舊扣那一筆（ADR-0121：有額度的照舊扣）', () => {
    const p = plans();
    p[0].entitlements.push({ key: 'own', doc: { type: 'single', courseId: FM.id, label: '功醫門診', totalQty: 2 } });
    addExtraVisits(p, [extra()], CTX);
    assert.equal(p[0].visits[0].slots[0].entitlementKey, 'own');
  });

  test('要算次數的課沒有額度：照舊補不進去、講得出為什麼', () => {
    const p = plans();
    const problems = addExtraVisits(p, [extra({ courseName: '心臟科評估' })], CTX);
    assert.match(problems[0].why, /沒有這個課程的額度/);
    assert.equal(p[0].visits.length, 0);
  });
});

describe('寫入之前那一道：哪幾段算「對不到額度」', () => {
  const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));
  const ILIB = SEED.courses.find((c) => c.name === 'ILIB');

  test('不算次數的課沒有額度不算；其餘沒有額度的都算', () => {
    const visits = [{ slots: [
      { courseId: FM.id, entitlementId: null },
      { courseId: ILIB.id, entitlementId: null },
      { courseId: ILIB.id, entitlementId: 'e1' },
    ] }];
    assert.deepEqual(slotsMissingEntitlement(visits, coursesById).map((s) => s.courseId), [ILIB.id]);
  });

  test('課程查不到的那一段照舊算（不放行認不得的東西）', () => {
    assert.equal(slotsMissingEntitlement([{ slots: [{ courseId: 'gone', entitlementId: null }] }], coursesById).length, 1);
  });
});
