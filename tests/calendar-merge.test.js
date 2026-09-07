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
  parseIcs, timeOf, importJson, reportText, classifyEvent, roomOf, TOKENS,
} from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { SEED } from '../public/js/domain/seed.js';

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

describe('classifyEvent() 分出休假、待辦、行事備註', () => {
  const kindOf = (title) => classifyEvent(title).kind;

  test('她自己的假是休假，不管假別怎麼寫', () => {
    for (const title of ['休', '請假', '請生理假', '請公假', '特休', '排休', '😀請假']) {
      assert.equal(kindOf(title), 'leave', title);
    }
  });

  // 使用者點名的那一條。判錯的代價不對稱：那幾天會整片變成排不進去的休假，
  // 而她其實在上班。所以寫了別人名字的一律退回行事備註。
  test('別人的假不是她的假', () => {
    for (const title of ['陳小美休假', '林小華請假', '12.陳小美請假']) {
      assert.equal(kindOf(title), 'personal', title);
    }
    assert.match(classifyEvent('陳小美休假').why, /陳小美/);
  });

  // residualNames() 會扣掉治療師名單（配對來訪時那是雜訊），這裡不能共用它 ——
  // 治療師正是那個「誰」。
  test('治療師請假也不是她的假', () => {
    assert.equal(kindOf('王小婷休假'), 'personal');
  });

  test('假別黏著動詞的那幾種不會被讀成人名', () => {
    // `請生理假` 扣掉假別剩一個 `請`、`開會補休` 剩 `開會`，
    // 兩個都曾經被當成別人的名字。
    assert.equal(kindOf('請生理假'), 'leave');
    assert.equal(kindOf('6／17開會補休'), 'leave');
  });

  test('沒寫時間又是做完可以勾掉的事就是待辦', () => {
    for (const title of ['H2U電話', '記復能行事曆', '蒐集客人復能時間', '取消王小明', '壓表']) {
      assert.equal(kindOf(title), 'note', title);
    }
  });

  // 隨手記存得下日期、存不下時間（domain/notes.js）。她特地把時間打進標題，
  // 就表示那個時間有意義，改成待辦會把它弄丟。
  test('標題裡寫了時間就不是待辦', () => {
    assert.equal(kindOf('3.王小明聯絡'), 'personal');
    assert.match(classifyEvent('3.王小明聯絡').why, /時間/);
  });

  test('那天會發生的事不是待辦', () => {
    for (const title of ['公出', '顧客會', '高齡博覽會', 'AI課']) {
      assert.equal(kindOf(title), 'personal', title);
    }
  });

  test('importJson() 把分類帶進合併檔，並且鏡射成舊版讀得懂的 category', () => {
    const { events } = parseIcs(ics(
      vevent('UID:1', 'DTSTART:20260905T090000', 'SUMMARY:休'),
      vevent('UID:2', 'DTSTART:20260906T090000', 'SUMMARY:H2U電話'),
      vevent('UID:3', 'DTSTART:20260907T090000', 'SUMMARY:顧客會'),
    ));
    const out = importJson({
      plans: [], events, unreadable: [], span: ['2026-09-05', '2026-09-07'],
      leftover: { calendarOnly: [], future: [], personal: events }, ambiguous: [], renames: {},
    });
    assert.deepEqual(out.eventCandidates.map((c) => c.kind), ['leave', 'note', 'personal']);
    // 舊版 app 只認得 leave 與 personal，待辦在那裡退回行事備註 ——
    // 少一個分類，不是多一筆讀不懂的資料。
    assert.deepEqual(out.eventCandidates.map((c) => c.category), ['leave', 'personal', 'personal']);
    assert.ok(out.eventCandidates.every((c) => c.why));
  });
});

test('休假一律是整天 —— 行事曆的時間欄會歪，而休假本來就不需要時間', () => {
  const { events } = parseIcs(ics(
    // 時間欄歪掉的那種：標題沒寫時間，DTSTART 卻是深夜
    vevent('UID:1', 'DTSTART:20260905T230000', 'SUMMARY:休'),
    // 標題開頭是日期不是時間，認時間那一支會把 6／17 讀成 18:00
    vevent('UID:2', 'DTSTART:20260624T180000', 'SUMMARY:6／17開會補休'),
    // 對照組：行事備註照樣留著時間
    vevent('UID:3', 'DTSTART:20260907T140000', 'SUMMARY:2.顧客會'),
  ));
  const out = importJson({
    plans: [], events, unreadable: [], span: ['2026-06-24', '2026-09-07'],
    leftover: { calendarOnly: [], future: [], personal: events }, ambiguous: [], renames: {},
  });
  const [leave, comp, personal] = out.eventCandidates;

  assert.equal(leave.allDay, true);
  assert.equal(leave.startTime, null);
  assert.equal(comp.allDay, true, '補休也是休假，一樣整天');
  assert.equal(comp.startTime, null);
  assert.equal(personal.allDay, false, '行事備註不受影響');
  assert.equal(personal.startTime, '14:00');
});

// 2026-08-27 那一批真檔跑出來的三個修正。三個都是「她真的那樣寫」，
// 不是想像出來的寫法，理由見 references/findings.md 的同一次紀錄。
describe('2026-08-27 那一批補上的寫法', () => {
  const kindOf = (title) => classifyEvent(title).kind;

  test('「提醒」是待辦動詞', () => {
    assert.equal(kindOf('提醒王小明外檢'), 'note');
  });

  // `20這週約王小明` 的 20 是日期不是晚上八點。認時間那一支會把它讀成 20:00，
  // 於是一件「20 號那一週要約人」的待辦變成一筆晚上的行程。
  test('開頭是 13 以上的裸數字算日期，不算時間', () => {
    assert.equal(kindOf('20這週約王小明'), 'note');
    assert.equal(kindOf('27改王小明.20這週約復健'), 'note');
  });

  // 放寬只到「沒接分鐘」為止 —— 她真的要寫下午一點半就會寫成 13.30。
  test('接了分鐘的還是時間，照樣不是待辦', () => {
    assert.equal(kindOf('13.30王小明身體組成'), 'personal');
    assert.equal(kindOf('8：50王小明健檢'), 'personal');
  });

  // 她也會直接把點滴室寫出來（`腸道點滴.9`、`IL（點3`），而原本只認得 `治N` 與 `IL.N`。
  test('直接寫出來的點滴室也算數，但裸數字不算', () => {
    assert.equal(roomOf('2.客戶A腸道點滴.9+問日期'), '點滴9');
    assert.equal(roomOf('13：30IL（點3'), '點滴3');
    assert.equal(roomOf('IL治2'), '治2', '治療室優先，不要被後面的字搶走');
    assert.equal(roomOf('2.客戶A.雪顏.2'), null, '裸數字意思不明，留空');
    assert.equal(roomOf('不能排點滴，沒有醫生'), null);
  });

  // 一句「跟假有關的雜事」不是「誰放假」。落到行事備註的話，理由那一句
  // 會變成「寫的是「壓」的假」—— 她看了只會更困惑。
  test('跟休假有關的雜事是待辦，不是誰的假', () => {
    assert.equal(kindOf('休假壓outlook'), 'note');
    assert.match(classifyEvent('休假壓outlook').why, /勾掉/);
    // 對照組：真的寫了別人名字的假照樣退回行事備註
    assert.equal(kindOf('陳小美休假'), 'personal');
    assert.equal(kindOf('請假'), 'leave');
  });

  // 配出來的二返額度不能寫進檔案：app 那一側匯入時會再配一次，而它認「已經配過了」
  // 靠的是 `followupForEntitlementKey`，那個欄位不在合併檔的契約裡。
  // 兩筆的下場是「對到不只一份額度」—— ② 勾起來的每一筆二返都補不進去。
  test('健檢配出來的二返額度不寫進合併檔', () => {
    const plans = [{
      sheetName: '客戶A',
      customerName: '客戶A',
      customer: { name: '客戶A', source: null, notes: '' },
      skip: null,
      entitlements: [
        { key: 'r9', productName: null, doc: { type: 'single', label: '5萬健檢', totalQty: 1, courseId: 'course-checkup' } },
        {
          key: 'r9-followup',
          productName: null,
          doc: {
            type: 'single', label: '二返（5萬健檢）', totalQty: 1,
            courseId: 'course-followup', followupForEntitlementKey: 'r9',
          },
        },
      ],
      days: [],
    }];
    const out = importJson({
      plans, events: [], unreadable: [], span: [null, null],
      leftover: { calendarOnly: [], future: [], personal: [] }, ambiguous: [], renames: {},
    });
    assert.deepEqual(out.customers[0].entitlements.map((e) => e.key), ['r9']);
  });

  // 舊表那一列寫著每一次用的品項簡寫，而行事曆上她常常只寫「點滴」。
  // 額度已經照品項拆好了，退回用它不是猜。
  test('行事曆沒寫品項時，退回用額度上的品項', () => {
    const plans = [{
      sheetName: '客戶A',
      customerName: '客戶A',
      customer: { name: '客戶A', source: null, notes: '' },
      skip: null,
      entitlements: [{
        key: 'r11:護肝排毒',
        productName: '護肝排毒',
        doc: { type: 'single', label: '營養點滴 - 護肝排毒', totalQty: 3, courseId: 'course-iv-drip' },
      }],
      days: [{
        date: '2026-07-06',
        filled: [
          { slot: { entitlementKey: 'r11:護肝排毒', courseName: '營養點滴' }, match: null },
          {
            slot: { entitlementKey: 'r11:護肝排毒', courseName: '營養點滴' },
            // 行事曆寫了品項的那一筆以行事曆為準
            match: { confidence: 'high', startsAt: '14:00', ivProductName: '雪顏亮彩', evidence: '2.客戶A雪顏點滴' },
          },
        ],
      }],
    }];
    const out = importJson({
      plans, events: [], unreadable: [], span: ['2026-07-06', '2026-07-06'],
      leftover: { calendarOnly: [], future: [], personal: [] }, ambiguous: [], renames: {},
    });
    const [noEvidence, fromCalendar] = out.customers[0].visits[0].slots;
    assert.equal(noEvidence.ivProductName, '護肝排毒');
    assert.equal(noEvidence.startsAt, null, '退回品項不代表也編一個時間出來（ADR-0011）');
    assert.equal(fromCalendar.ivProductName, '雪顏亮彩');
  });
});


// 產檔那一側吐出來的課程名與器材名，**要跟主檔上的全名一字不差**。
//
// `domain/mergeImport.js` 的 `byName()` 是精確比對、不做模糊。對不上的時候：
//
//   課程對不上 → **整筆額度與它底下的每一段都匯不進去**
//   器材對不上 → 那一格留空
//
// 而畫面上只寫「N 處對不到主檔」—— 看起來像資料本來就不齊，不像改名的後遺症。
// 這一條踩過兩次：課程 2026-09-06 從「靜脈」正名成 ILIB（那一次的症狀是
// 「1 位客戶 0 筆額度 0 筆來訪」，而且是 E2E 抓到的，不是這裡）、
// 器材 2026-09-08 從「超磁場」改名成 SIS。
describe('簡寫表吐出來的名字對得上主檔', () => {
  const courseNames = new Set(SEED.courses.map((c) => c.name));
  const equipNames = new Set(SEED.equipment.map((e) => e.name));

  test('每一條的課程名都在課程主檔上', () => {
    const bad = TOKENS.map(([, course]) => course).filter((c) => !courseNames.has(c));
    assert.deepEqual([...new Set(bad)], [],
      '這幾個課程名主檔上沒有 —— 匯進去的時候整筆額度會被丟掉');
  });

  test('每一條的器材名都在器材主檔上', () => {
    const bad = TOKENS.map(([, , equip]) => equip).filter((e) => e && !equipNames.has(e));
    assert.deepEqual([...new Set(bad)], [],
      '這幾個器材名主檔上沒有 —— 匯進去的時候那一格會留空');
  });

  test('ILIB 那一條認得舊寫法，但吐出來的是新名字', () => {
    const [re, course] = TOKENS.find(([, c]) => c === 'ILIB');
    assert.equal(course, 'ILIB');
    for (const raw of ['ILIB 60mins', 'IL', '靜脈雷射']) {
      assert.ok(re.test(raw), `舊表上的「${raw}」要認得出來`);
    }
  });
});
