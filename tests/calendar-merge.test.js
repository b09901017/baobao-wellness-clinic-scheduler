// `.claude/skills/calendar-sheet-merge` 的行事曆解析。
//
// 為什麼 app 的測試要管 skill 的腳本：**那條路上的東西不見了，app 這一側
// 看不出來。** 跨天的事件從 2026-08-19 那份檔案裡整個消失（198 筆 eventCandidates，
// 跨天 0 筆），而 app 從 domain/events.js 到 firestore.rules 一路都支援跨天 ——
// 少的那一段在 parseIcs()，它從頭到尾沒有讀過 DTEND。
// 見 .scratch/first-real-import/issues/06。
//
// fixture 全部是編出來的：行事備註本來就不綁客戶，所以這裡連假名都不需要。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIcs, timeOf, importJson, reportText,
} from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';

const ics = (...events) => ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n');
const vevent = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

const byTitle = (events, title) => events.find((e) => e.summary === title);

describe('parseIcs() 讀得懂跨天與整天', () => {
  const { events, unreadable } = parseIcs(ics(
    vevent('UID:1', 'DTSTART;VALUE=DATE:20260810', 'DTEND;VALUE=DATE:20260815', 'SUMMARY:出國'),
    vevent('UID:2', 'DTSTART;VALUE=DATE:20260901', 'DTEND;VALUE=DATE:20260902', 'SUMMARY:休假'),
    vevent('UID:3', 'DTSTART:20260812T143000', 'DTEND:20260812T160000', 'SUMMARY:公出'),
    vevent('UID:4', 'DTSTART:20260813T230000', 'DTEND:20260814T010000', 'SUMMARY:值班'),
    vevent('UID:5', 'DTSTART:20260815T090000', 'SUMMARY:沒寫結束'),
  ));

  test('跨天的整天事件不會塌成一天', () => {
    const e = byTitle(events, '出國');
    assert.equal(e.date, '2026-08-10');
    // 整天事件的 DTEND 不含端點（iCalendar 規格），8/10–8/14 寫成 20260815
    assert.equal(e.endDate, '2026-08-14');
    assert.equal(e.allDay, true);
  });

  test('單天的整天事件還是單天', () => {
    const e = byTitle(events, '休假');
    assert.equal(e.date, '2026-09-01');
    assert.equal(e.endDate, '2026-09-01');
    assert.equal(e.allDay, true);
  });

  test('有時間的事件不是整天，結束日照 DTEND', () => {
    const e = byTitle(events, '公出');
    assert.equal(e.allDay, false);
    assert.equal(e.clock, '14:30');
    assert.equal(e.endDate, '2026-08-12');
  });

  test('跨午夜的事件結束日是隔天', () => {
    assert.equal(byTitle(events, '值班').endDate, '2026-08-14');
  });

  test('沒有 DTEND 就當單天，不要變成 undefined', () => {
    assert.equal(byTitle(events, '沒寫結束').endDate, '2026-08-15');
  });

  test('讀不出 DTSTART 的不會安靜消失，會進 unreadable', () => {
    const r = parseIcs(ics(
      vevent('UID:6', 'SUMMARY:沒有開始時間的東西'),
      vevent('UID:7', 'DTSTART:壞掉的值', 'SUMMARY:讀不出來的東西'),
      vevent('UID:8', 'DTSTART:20260820T100000', 'SUMMARY:正常的'),
    ));
    assert.equal(r.events.length, 1, '讀得出來的照樣進得去');
    assert.deepEqual(r.unreadable.map((x) => x.summary).sort(),
      ['沒有開始時間的東西', '讀不出來的東西']);
    assert.ok(r.unreadable.every((x) => x.why));
  });

  test('DTEND 比 DTSTART 早的整天事件當成單天', () => {
    // 有的匯出器把整天事件的 DTEND 寫成跟 DTSTART 同一天。減完會比開始早，
    // 而 firestore.rules 的 validEvent() 擋 endDate < startDate。
    const { events: bad } = parseIcs(ics(
      vevent('UID:9', 'DTSTART;VALUE=DATE:20260810', 'DTEND;VALUE=DATE:20260810', 'SUMMARY:怪的'),
    ));
    assert.equal(bad[0].endDate, '2026-08-10');
  });

  test('只寫 DURATION、沒寫 DTEND 的匯出器也算得出跨天', () => {
    const { events: dur } = parseIcs(ics(
      vevent('UID:1', 'DTSTART;VALUE=DATE:20260810', 'DURATION:P5D', 'SUMMARY:整天的'),
      vevent('UID:2', 'DTSTART:20260810T090000', 'DURATION:P2D', 'SUMMARY:有時間的'),
      vevent('UID:3', 'DTSTART:20260810T090000', 'DURATION:PT2H', 'SUMMARY:兩小時'),
    ));
    // 整天的不含端點，跟 DTEND 一樣：8/10 起算 P5D 是 8/10–8/14
    assert.equal(byTitle(dur, '整天的').endDate, '2026-08-14');
    assert.equal(byTitle(dur, '有時間的').endDate, '2026-08-12');
    // 只有時分的認不出來就當同一天 —— 寧可少算一天也不要多算一天
    assert.equal(byTitle(dur, '兩小時').endDate, '2026-08-10');
  });

  test('未展開的行摺疊（RFC 5545 的續行）照樣讀得到', () => {
    const { events: folded } = parseIcs(
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:10\r\nDTSTART;VALUE=DATE:20260810\r\n'
      + 'SUMMARY:很長的名\r\n 稱\r\nEND:VEVENT\r\nEND:VCALENDAR',
    );
    assert.equal(folded[0].summary, '很長的名稱');
  });
});

describe('整天事件的時間不用猜', () => {
  test('標題裡有數字也不會被安上一個假的時間', () => {
    // timeInSummary() 是從標題文字認時間的（她寫「2.30」「9：15」），
    // 所以一筆整天事件只要標題裡有數字就會被安上時間，匯進來變成一筆有時有分的行程
    const { events } = parseIcs(ics(
      vevent('UID:1', 'DTSTART;VALUE=DATE:20260810', 'DTEND;VALUE=DATE:20260811', 'SUMMARY:2.30 開會'),
    ));
    assert.equal(timeOf(events[0]), null);
  });

  test('有時間的事件以標題為準，時間欄只當備援', () => {
    const { events } = parseIcs(ics(
      vevent('UID:1', 'DTSTART:20260810T180000', 'SUMMARY:3.45 開會'),
      vevent('UID:2', 'DTSTART:20260811T090000', 'SUMMARY:開會'),
    ));
    assert.equal(timeOf(events[0]), '15:45', '標題比時間欄準 —— 時間欄會歪');
    assert.equal(timeOf(events[1]), '09:00', '標題沒寫就退回時間欄');
  });
});

describe('合併檔帶得出跨天與整天', () => {
  const base = (over = {}) => ({
    plans: [], events: [], unreadable: [], span: ['2026-06-01', '2026-09-30'],
    leftover: { calendarOnly: [], future: [], personal: [] },
    ambiguous: [], renames: {}, year: 2026, ...over,
  });

  const { events } = parseIcs(ics(
    vevent('UID:1', 'DTSTART;VALUE=DATE:20260810', 'DTEND;VALUE=DATE:20260815', 'SUMMARY:出國'),
    vevent('UID:2', 'DTSTART:20260812T143000', 'DTEND:20260812T160000', 'SUMMARY:公出'),
  ));

  test('eventCandidates 的 endDate 是真的結束日', () => {
    const json = importJson(base({
      events,
      leftover: { calendarOnly: [], future: [], personal: events },
    }));
    const [away, out] = json.eventCandidates;

    assert.equal(away.startDate, '2026-08-10');
    assert.equal(away.endDate, '2026-08-14');
    assert.equal(away.allDay, true);
    assert.equal(away.startTime, null);

    assert.equal(out.endDate, '2026-08-12');
    assert.equal(out.allDay, false);
    assert.equal(out.startTime, '14:30');
  });

  test('讀不出來的那幾筆也帶進 JSON', () => {
    const json = importJson(base({
      unreadable: [{ summary: '讀不出來的東西', raw: '壞掉的值', why: 'DTSTART 讀不出日期' }],
    }));
    assert.equal(json.unreadable.length, 1);
    assert.equal(json.unreadable[0].title, '讀不出來的東西');
  });

  test('報告會講出讀不出來的那幾筆', () => {
    const text = reportText(base({
      unreadable: [{ summary: '讀不出來的東西', raw: '壞掉的值', why: 'DTSTART 讀不出日期' }],
    }));
    assert.ok(text.includes('讀不出來的東西'));
    assert.ok(text.includes('1 筆讀不出來'));
  });

  test('報告上跨天的事件看得出來是跨天', () => {
    const text = reportText(base({ events, leftover: { calendarOnly: [], future: [], personal: events } }));
    assert.ok(text.includes('到 2026-08-14'), '要看得到它跨到哪一天');
    assert.ok(text.includes('共 5 天'));
  });
});
