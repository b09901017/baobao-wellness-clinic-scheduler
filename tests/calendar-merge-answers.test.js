// 2026-09-14 那一批行事曆比對的洞，以及她逐筆回答過的決定（`.scratch/merge-answers-2026-09-14/issues/03`）。
//
// 名字全部是假名。規則跟姓氏有關，所以用「王小華」「王陳小美」這種看得出結構的假名
// （CLAUDE.md：規則跟名字的字數有關時用假名）。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  roomOf, coursesOf, ivProductOf, classifyEvent, reconcile, importJson, reportText,
} from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { SEED } from '../public/js/domain/seed.js';
import { FORMAT } from '../public/js/domain/mergeImport.js';

const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];

function sheetTsv(a2, { b2 = '', d = [0, 0, 0, 0, 0, 0, 0], dates, checks = {}, rows = [] }) {
  const cellsOf = (cells = []) => dates.map((_, i) => (cells[i] === true ? 'TRUE' : 'FALSE'));
  const out = [['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t')];
  LABELS.forEach((label, i) => out.push([i ? '' : a2, i ? '' : b2, label, d[i], 0, ...cellsOf(checks[label])].join('\t')));
  for (const r of rows) out.push(['', '', r.label, r.qty, 0, ...cellsOf(r.cells)].join('\t'));
  return out.join('\n');
}

/** sheets：{ 分頁名: { a2?, ...sheetTsv 的參數 } }；events：[日期, 時間, 標題] */
function run(sheets, events, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-answers-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  for (const [name, spec] of Object.entries(sheets)) writeFileSync(join(sheetsDir, `${name}.tsv`), sheetTsv(spec.a2 ?? name, spec));
  const icsPath = join(dir, 'cal.ics');
  writeFileSync(icsPath, [
    'BEGIN:VCALENDAR',
    ...events.map(([date, time, title], i) => [
      'BEGIN:VEVENT', `UID:${i}`, `DTSTART;TZID=Asia/Taipei:${date.replace(/-/g, '')}T${time.replace(':', '')}00`,
      `SUMMARY:${title}`, 'END:VEVENT',
    ].join('\r\n')),
    'END:VCALENDAR',
  ].join('\r\n'));
  return reconcile({ sheetsDir, icsPath, year: 2026, today: '2026-09-15', ...extra });
}

const slotsOf = (r, sheet) => r.plans.find((x) => x.sheetName === sheet).days
  .flatMap((d) => d.filled.map((f) => ({ date: d.date, course: f.slot.courseName, ...(f.match ?? {}) })));

describe('點滴室：`.N` 就是點滴 N（她 9/15）', () => {
  test('前面不是數字的 `.N`', () => {
    assert.equal(roomOf('3.30客戶A  .5雪'), '點滴5');
    assert.equal(roomOf('10.客戶A.8（躺）給35'), '點滴8');
    assert.equal(roomOf('2.客戶A.雪顏.2'), '點滴2');
    assert.equal(roomOf('2：30客戶A IL(.10)'), '點滴10');
  });

  test('時間裡的點不算，太大的數字不算', () => {
    assert.equal(roomOf('3.30客戶A'), null);
    assert.equal(roomOf('27改客戶A.20這週約復健'), null);
  });

  test('IL 後面最多讀兩位（IL.10100元 不是點滴 10100）', () => {
    assert.equal(roomOf('9.客戶A IL.10100元*3萬'), '點滴10');
  });
});

describe('簡寫表補的幾種', () => {
  const courses = (s) => coursesOf(s).map((x) => x.course);

  test('`.N雪／肝／腸` 是營養點滴', () => {
    assert.ok(courses('3.30客戶A  .5雪').includes('營養點滴'));
    assert.ok(courses('3.15客戶A  .5肝').includes('營養點滴'));
    assert.ok(!courses('王小明外院腸胃鏡').includes('營養點滴'), '腸胃鏡不是點滴');
  });

  test('名字後面接 13 是 13健檢；13：30 那種是時間', () => {
    assert.ok(courses('8.15王小明13').includes('健檢'));
    assert.ok(courses('8：50王小明13+Line').includes('健檢'));
    assert.ok(!courses('13：30王小明營養諮詢').includes('健檢'));
  });

  test('一個字的品項認得出來', () => {
    assert.equal(ivProductOf('2.客戶A  .5雪*看會延後多久', SEED.ivProducts), '雪顏亮彩');
    assert.equal(ivProductOf('3.15客戶A  .5肝', SEED.ivProducts), '護肝排毒');
  });

  test('待辦的字補了幾個（她 9/15）', () => {
    for (const title of ['王小明回電', '包王小明營養素', '澆水', '倩姐退款', '單子給某某', '更新王小明']) {
      assert.equal(classifyEvent(title).kind, 'note', title);
    }
    assert.equal(classifyEvent('2.王小明回電').kind, 'personal', '寫了時間照舊不是待辦');
  });
});

describe('只寫一個姓的事件', () => {
  const aliases = { 王陳小美: ['王陳'] };

  test('句子裡寫的是別位客戶的兩個字：那一位拿到，只沾到姓的不拿', () => {
    const r = run({
      王小華: { dates: ['6/18'], d: [0, 0, 0, 0, 0, 0, 1], checks: { 'ILIB 60mins': [true] } },
      王陳小美: { dates: ['6/18'], d: [0, 0, 0, 0, 0, 0, 1], checks: { 'ILIB 60mins': [true] } },
    }, [
      ['2026-06-18', '09:30', '9：30IL.10'],
      ['2026-06-18', '14:30', '2：30王陳IL(.10)'],
    ], { aliases });
    const [mei] = slotsOf(r, '王陳小美');
    const [hua] = slotsOf(r, '王小華');
    assert.equal(mei.startsAt, '14:30');
    assert.notEqual(hua.startsAt, '14:30', '「王陳」寫的不是她');
    assert.equal(hua.startsAt, '09:30', '那天剩下沒寫名字的那一筆才是她的（推測）');
    assert.equal(hua.confidence, 'low');
  });

  test('兩位同姓、同一天、同課程都只沾到姓：兩邊都不補，列出來問', () => {
    const r = run({
      王小華: { dates: ['7/20'], d: [0, 0, 0, 0, 0, 0, 1], checks: { 'ILIB 60mins': [true] } },
      王大同: { dates: ['7/20'], d: [0, 0, 0, 0, 0, 0, 1], checks: { 'ILIB 60mins': [true] } },
    }, [['2026-07-20', '15:45', '3.45王IL治2']]);
    assert.equal(slotsOf(r, '王小華')[0].startsAt, undefined);
    assert.equal(slotsOf(r, '王大同')[0].startsAt, undefined);
    assert.ok(r.ambiguous.some((a) => a.evidence === '3.45王IL治2' && a.who.length === 2), JSON.stringify(r.ambiguous));
  });

  test('只有一位姓王的勾了：照舊補得上', () => {
    const r = run({ 王小華: { dates: ['7/20'], d: [0, 0, 0, 0, 0, 0, 1], checks: { 'ILIB 60mins': [true] } } },
      [['2026-07-20', '15:45', '3.45王IL治2']]);
    assert.equal(slotsOf(r, '王小華')[0].startsAt, '15:45');
  });
});

describe('X光 是復健科門診的一部分（她 9/15）', () => {
  test('不拿來補沒配到的 ILIB，也不留在對不到的清單裡', () => {
    const r = run({
      王小明: { dates: ['8/27'], d: [0, 1, 0, 0, 0, 0, 1], checks: { 復健門診: [true], 'ILIB 60mins': [true] } },
    }, [
      ['2026-08-27', '16:15', '4.15王小明X光'],
      ['2026-08-27', '16:30', '4.30王小明復健門診'],
    ]);
    const slots = slotsOf(r, '王小明');
    assert.equal(slots.find((s) => s.course === '復健科醫師門診').startsAt, '16:30');
    assert.equal(slots.find((s) => s.course === 'ILIB').startsAt, undefined);
    assert.ok(!r.leftover.personal.some((e) => e.summary.includes('X光')));
  });
});

describe('取消、預約、改、紀錄的句子一律不是來訪（她 9/15）', () => {
  test('不進「行事曆有、舊表沒勾」，退回對不到客戶的清單', () => {
    const r = run({
      王小明: { dates: ['7/17'], rows: [{ label: '3.6萬健檢', qty: 1, cells: [true] }] },
    }, [
      ['2026-07-01', '08:30', '8:30王小明健檢取消'],
      ['2026-08-11', '04:00', '王小明二返預約'],
      ['2026-07-25', '09:00', '紀錄王小明復能'],
    ]);
    assert.deepEqual(r.leftover.calendarOnly, []);
    assert.equal(r.leftover.personal.length, 3);
  });
});

describe('合併檔', () => {
  test('產出的版本跟 app 一樣（v3）', () => {
    const r = run({ 王小明: { dates: ['7/17'] } }, []);
    assert.equal(importJson(r).format, FORMAT);
  });
});

// ---------------------------------------------------------------------------
// 決定檔：她逐筆回答過的事，下一批自動套用，不用再問一次。

describe('決定檔', () => {
  const sheets = {
    客戶A: {
      a2: '客戶A9001', b2: '0603 顧客會-8', dates: ['7/15', '9/7', '9/16'],
      d: [4, 2, 4, 4, 4, 23, 12], checks: { '復能(1小時)': [false, true, true] },
      rows: [{ label: 'x萬健檢', qty: 1, cells: [true, false, false] }],
    },
    客戶B: {
      b2: '0604 顧客會-8', dates: ['6/30'],
      d: [0, 0, 0, 0, 0, 29, 1], checks: { '復能(1小時)': [true], 'ILIB 60mins': [true] },
    },
  };
  const events = [
    ['2026-08-05', '09:00', '9.客戶A二返（夏）'],
    ['2026-09-10', '14:45', '2.45客戶A SIS'],
    ['2026-06-12', '09:00', '😀請假'],
    ['2026-09-13', '23:00', '休'],
    ['2026-09-23', '05:00', '9／22生理假'],
  ];
  const decisions = {
    customers: {
      客戶A: {
        entitlements: [
          { row: 9, label: '1.2萬健檢' },
          { row: 7, split: [{ qty: 20 }, { qty: 3, set: '三選一', plan: false }] },
          { add: { key: 'gift-cardio', course: '心臟科評估', qty: 1 } },
        ],
        slots: [
          { date: '2026-09-07', course: '復能', set: { startsAt: '09:30', durationMin: 30, equipment: 'SIS' } },
          { date: '2026-09-16', course: '復能', clear: true },
          { date: '2026-08-05', add: { course: '二返', fromEvent: '9.客戶A二返（夏）' } },
          { date: '2026-08-11', add: { course: '心臟科評估', startsAt: '14:00', entitlement: 'gift-cardio' } },
          { date: '2026-09-30', course: 'EECP', set: { startsAt: '10:00' } },
        ],
        skipEvents: [{ date: '2026-09-10', title: '2.45客戶A SIS' }],
        notes: { add: [{ text: '尾款沒繳先不算', color: 'red' }], drop: ['病歷號 9001'] },
        flags: ['血管難打'],
        partners: ['自然美'],
      },
      客戶B: {
        noPlan: '尾款沒繳，先不算方案',
        entitlements: [{ rows: [7, 8], merge: { qty: 30, set: '四選一', durationMin: 60 } }],
      },
    },
    events: [
      { date: '2026-06-12', title: '😀請假', kind: 'personal' },
      { date: '2026-09-13', title: '休', startDate: '2026-09-14', endDate: '2026-09-14' },
      { date: '2026-09-23', title: '9／22生理假', skip: '跟 9/22 的休是同一件事' },
    ],
  };
  const r = run(sheets, events, { decisions });
  const json = importJson(r);
  const A = json.customers.find((c) => c.sheetName === '客戶A');
  const B = json.customers.find((c) => c.sheetName === '客戶B');
  const visit = (c, date) => c.visits.find((v) => v.date === date);

  test('額度：改名、拆成兩筆、加一筆送的', () => {
    assert.ok(A.entitlements.some((e) => e.key === 'r9' && e.label === '1.2萬健檢'));
    const plan = A.entitlements.find((e) => e.key === 'r7');
    const extra = A.entitlements.find((e) => e.key === 'r7:2');
    assert.equal(plan.totalQty, 20);
    assert.equal(plan.sourcePlanName, '8萬方案');
    assert.equal(extra.totalQty, 3);
    assert.equal(extra.sourcePlanName, null);
    assert.equal(extra.purchaseKey, 'extras');
    assert.equal(extra.optionEquipmentNames.length, 3);
    assert.ok(A.entitlements.some((e) => e.key === 'gift-cardio' && e.courseName === '心臟科評估' && e.totalQty === 1));
    assert.ok(!A.purchaseProblems.some((x) => x.includes('23')), '拆完之後「微調過」那一條不用再問');
  });

  test('時段：改時間與時長、清成不詳、從事件加一段、明寫加一段', () => {
    const [sep7] = visit(A, '2026-09-07').slots;
    assert.equal(sep7.startsAt, '09:30');
    assert.equal(sep7.endsAt, '10:00');
    assert.equal(sep7.equipmentName, 'SIS');
    assert.equal(sep7.confidence, 'high');
    assert.equal(visit(A, '2026-09-16').slots[0].startsAt, null);
    const [followup] = visit(A, '2026-08-05').slots;
    assert.equal(followup.courseName, '二返');
    assert.equal(followup.startsAt, '09:00');
    assert.equal(followup.entitlementKey, 'r9-followup');
    const [cardio] = visit(A, '2026-08-11').slots;
    assert.equal(cardio.entitlementKey, 'gift-cardio');
    assert.equal(cardio.startsAt, '14:00');
    assert.deepEqual(A.visits.map((v) => v.date), [...A.visits.map((v) => v.date)].sort(), '照日期排');
  });

  test('用掉的事件不再出現在候選清單；說不算的退回雜事清單', () => {
    assert.ok(!json.missingFromSheet.some((x) => x.evidence === '9.客戶A二返（夏）'));
    assert.ok(!json.missingFromSheet.some((x) => x.evidence === '2.45客戶A SIS'));
    assert.ok(json.eventCandidates.some((x) => x.title === '2.45客戶A SIS'));
  });

  test('備註加與刪、警示、合作機構', () => {
    assert.ok(A.marks.some((m) => m.text === '尾款沒繳先不算' && m.color === 'red'));
    assert.ok(!A.marks.some((m) => m.text === '病歷號 9001'));
    assert.equal(A.notes, A.marks.map((m) => m.text).join('\n'));
    assert.deepEqual(A.flags, ['血管難打']);
    assert.deepEqual(A.partners, ['自然美']);
  });

  test('方案不算；兩列併成一池（四選一），ILIB 那一段記成選了 ILIB', () => {
    assert.ok(!B.purchaseProblems.some((x) => x.includes('8 萬方案')), JSON.stringify(B.purchaseProblems));
    assert.ok(!B.entitlements.some((e) => e.key === 'r8'));
    const pool = B.entitlements.find((e) => e.key === 'r7');
    assert.equal(pool.totalQty, 30);
    assert.equal(pool.durationMin, 60);
    assert.equal(pool.optionEquipmentNames.length, 4);
    const slots = visit(B, '2026-06-30').slots;
    assert.ok(slots.every((s) => s.entitlementKey === 'r7'));
    const ilib = slots.find((s) => s.courseName === 'ILIB');
    assert.equal(ilib.equipmentName, 'ILIB');
  });

  test('事件：改分類、改起訖、整筆不匯', () => {
    assert.equal(json.eventCandidates.find((x) => x.title === '😀請假').kind, 'personal');
    const rest = json.eventCandidates.find((x) => x.title === '休');
    assert.equal(rest.startDate, '2026-09-14');
    assert.equal(rest.endDate, '2026-09-14');
    assert.ok(!json.eventCandidates.some((x) => x.title === '9／22生理假'));
  });

  test('對不到對象的決定要列在報告上，不能安靜地失效', () => {
    assert.ok(r.decisionLog.misses.some((m) => m.includes('2026-09-30') && m.includes('EECP')), JSON.stringify(r.decisionLog));
    assert.match(reportText(r), /找不到/);
  });
});
