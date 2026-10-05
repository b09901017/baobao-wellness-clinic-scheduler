// 她 2026-09-28 答的三條規則，與「今天以前的雜事不匯」（`.scratch/merge-decision-board/issues/01`）。
//
// 名字全部是假名（王小明）。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  coursesOf, classifyEvent, reconcile, importJson, reportText,
} from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';

const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];

function sheetTsv(a2, { d = [0, 0, 0, 0, 0, 0, 0], dates, checks = {} }) {
  const cellsOf = (cells = []) => dates.map((_, i) => (cells[i] === true ? 'TRUE' : 'FALSE'));
  const out = [['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t')];
  LABELS.forEach((label, i) => out.push([i ? '' : a2, '', label, d[i], 0, ...cellsOf(checks[label])].join('\t')));
  return out.join('\n');
}

/** events：[起, 迄或 null, 時間或 null, 標題] */
function run(sheets, events, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-0928-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  for (const [name, spec] of Object.entries(sheets)) writeFileSync(join(sheetsDir, `${name}.tsv`), sheetTsv(name, spec));
  const icsPath = join(dir, 'cal.ics');
  const ymd = (d) => d.replace(/-/g, '');
  writeFileSync(icsPath, [
    'BEGIN:VCALENDAR',
    ...events.map(([from, to, time, title], i) => [
      'BEGIN:VEVENT', `UID:${i}`,
      time ? `DTSTART;TZID=Asia/Taipei:${ymd(from)}T${time.replace(':', '')}00` : `DTSTART;VALUE=DATE:${ymd(from)}`,
      // 整天事件的 DTEND 不含端點（iCalendar 規格）
      ...(to ? [`DTEND;VALUE=DATE:${ymd(to)}`] : []),
      `SUMMARY:${title}`, 'END:VEVENT',
    ].join('\r\n')),
    'END:VCALENDAR',
  ].join('\r\n'));
  return reconcile({ sheetsDir, icsPath, year: 2026, today: '2026-09-28', ...extra });
}

describe('「耀聖／曜聖」的句子一律不是來訪（她 9/28）', () => {
  const r = run(
    { 王小明: { dates: ['9/11'], d: [0, 0, 0, 0, 0, 0, 1], checks: { 'ILIB 60mins': [true] } } },
    [
      ['2026-09-11', null, '15:00', '3.王小明IL治2'],
      ['2026-09-18', null, '20:00', '王小明二返曜聖×整理給line'],
      ['2026-09-19', null, '20:00', '王小明二返耀聖'],
    ],
  );

  test('也不拿它的時間去補那天沒配到的一段', () => {
    const r2 = run(
      { 王小明: { dates: ['9/18'], d: [0, 0, 0, 0, 0, 0, 1], checks: { 'ILIB 60mins': [true] } } },
      [['2026-09-18', null, '20:00', '8.王小明曜聖整理給line']],
    );
    const [slot] = r2.plans.find((p) => p.sheetName === '王小明').days[0].filled;
    assert.equal(slot.match, null, JSON.stringify(slot.match));
  });

  test('不進「行事曆有、舊表沒勾」', () => {
    const titles = r.leftover.calendarOnly.map((x) => x.event.summary);
    assert.ok(!titles.includes('王小明二返曜聖×整理給line'), titles.join('、'));
    assert.ok(!titles.includes('王小明二返耀聖'), titles.join('、'));
  });
});

describe('「心臟科」＝心臟科評估（她 9/28）', () => {
  const courses = (s) => coursesOf(s).map((x) => x.course);

  test('9.王小明心臟科3檢查', () => {
    assert.ok(courses('9.王小明心臟科3檢查').includes('心臟科評估'));
  });

  test('「心臟科評估」四個字寫全的也認得', () => {
    assert.ok(courses('9.30心臟科評估*功醫5萬結帳').includes('心臟科評估'));
  });

  // HRV 2026-10-05 從這一條拿掉了：它是功醫門診（`tests/merge-functional-clinic.test.js`）
  test('以前認得的照舊', () => {
    for (const s of ['心臟評估', '心臟門診', '心超', 'ABI']) assert.ok(courses(`2.王小明${s}`).includes('心臟科評估'), s);
  });
});

describe('「必須請假」是提醒她去請假（她 9/28）', () => {
  test('是待辦，不是別人的假', () => {
    const c = classifyEvent('必須請假');
    assert.equal(c.kind, 'note');
    assert.doesNotMatch(c.why, /「必須」的假/);
  });

  test('她自己的「休」照舊是休假', () => {
    assert.equal(classifyEvent('休').kind, 'leave');
  });
});

describe('今天以前的雜事不匯（她 9/28：「當天以前的都不用了預設丟掉」）', () => {
  const r = run({}, [
    ['2026-09-10', null, '10:00', '10.公出'],
    ['2026-09-27', null, null, '寄資料給廠商'],
    ['2026-09-11', '2026-10-01', null, '家人出國'],
    ['2026-09-28', null, '14:00', '2.開會'],
    ['2026-10-05', null, '09:00', '9.顧客會'],
  ]);
  const titles = importJson(r).eventCandidates.map((e) => e.title);

  test('結束日在今天以前的一筆都不進合併檔', () => {
    assert.ok(!titles.includes('10.公出'));
    assert.ok(!titles.includes('寄資料給廠商'));
  });

  test('跨到今天以後的、今天的、以後的照舊在', () => {
    assert.ok(titles.includes('家人出國'), '9/11～9/30 還在進行中');
    assert.ok(titles.includes('2.開會'), '今天的');
    assert.ok(titles.includes('9.顧客會'));
  });

  test('報告上照樣列得出來（丟掉不是消失）', () => {
    const text = reportText(r);
    assert.match(text, /10\.公出/);
    assert.match(text, /寄資料給廠商/);
  });

  test('她決定過要留的那一筆照樣進去', () => {
    const kept = run({}, [['2026-09-27', null, null, '寄資料給廠商']], {
      decisions: { events: [{ date: '2026-09-27', title: '寄資料給廠商', include: true }] },
    });
    assert.ok(importJson(kept).eventCandidates.some((e) => e.title === '寄資料給廠商'));
  });

  test('沒給今天就不丟（舊的呼叫端照舊）', () => {
    const noToday = run({}, [['2026-09-10', null, '10:00', '10.公出']], { today: null });
    assert.ok(importJson(noToday).eventCandidates.some((e) => e.title === '10.公出'));
  });
});
