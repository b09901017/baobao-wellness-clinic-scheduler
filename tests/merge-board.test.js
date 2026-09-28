// 決定頁的資料（`.claude/skills/calendar-sheet-merge/scripts/board.mjs`）。
//
// 她 2026-09-28：「必須一樣完整不能遺漏或簡化各種問題」「之前我做過的決定就不要再問了」。
// 這一支盯兩件事：報告上印的每一個數字，決定頁上都有那麼多項；答過的鑰匙不再算成要決定的。
// 名字全部是假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reconcile, reportText } from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { boardItems, reportCounts, KINDS } from '../.claude/skills/calendar-sheet-merge/scripts/board.mjs';

const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];

function sheetTsv(a2, { d = [0, 0, 0, 0, 0, 1, 1], dates, checks = {} }) {
  const cellsOf = (cells = []) => dates.map((_, i) => (cells[i] === true ? 'TRUE' : 'FALSE'));
  const out = [['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t')];
  LABELS.forEach((label, i) => out.push([i ? '' : a2, '', label, d[i], 0, ...cellsOf(checks[label])].join('\t')));
  return out.join('\n');
}

function run(sheets, events, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-board-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  for (const [name, spec] of Object.entries(sheets)) writeFileSync(join(sheetsDir, `${name}.tsv`), sheetTsv(name, spec));
  const icsPath = join(dir, 'cal.ics');
  writeFileSync(icsPath, [
    'BEGIN:VCALENDAR',
    ...events.map(([date, time, title], i) => [
      'BEGIN:VEVENT', `UID:${i}`, `DTSTART;TZID=Asia/Taipei:${date.replace(/-/g, '')}T${time.replace(':', '')}00`,
      `SUMMARY:${title}`, 'END:VEVENT',
    ].join('\r\n')),
    'END:VCALENDAR',
  ].join('\r\n'));
  return reconcile({ sheetsDir, icsPath, year: 2026, today: '2026-09-28', ...extra });
}

// 每一段都至少有一筆的一份資料
const SHEETS = {
  王小明: { dates: ['9/11', '9/21'], checks: { 'ILIB 60mins': [true, false], '復能(1小時)': [false, true] } },
  陳美美: { dates: ['9/12', '9/13'], checks: { 'ILIB 60mins': [true, true] } },
  林大華: { dates: ['9/12'], checks: { 'ILIB 60mins': [true] } },
};
const EVENTS = [
  ['2026-09-11', '15:00', '3.王小明IL治2'],          // 三方對得上
  ['2026-09-15', '16:00', '4.王小明SIS'],            // ② 行事曆有、舊表沒勾
  ['2026-09-21', '14:00', '2.後課程全取消'],          // ③ 那天舊表勾了復能、行事曆沒寫她
  ['2026-09-30', '10:00', '10.王小明心臟科'],         // ⑤ 以後的預約
  ['2026-09-12', '09:00', '9.IL治3'],                // ④b 兩位都勾了 ILIB、沒寫名字
  ['2026-09-13', '10:00', '10.IL治5'],               // ④ 只有陳美美勾了 → 推測
  ['2026-09-20', '09:00', '寄資料給廠商'],            // 最近兩週的待辦
  ['2026-09-01', '10:00', '10.公出'],                // 今天以前的雜事 → 不匯
  ['2026-09-02', '09:00', '回電廠商'],               // 兩週以前的待辦 → 不匯
  ['2026-09-25', '09:00', '澆水'],                   // 同一天兩筆一模一樣的
  ['2026-09-25', '09:00', '澆水'],
  ['2026-10-05', '09:00', '9.顧客會'],               // 以後的雜事
];

const tally = (items) => items.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {});
const n = (t, k) => t[k] ?? 0;

/** 報告最上面那一塊印的數字（她讀的是這一份） */
function printed(text) {
  const num = (re) => Number((text.match(re) ?? [])[1] ?? 0);
  return {
    conflict: num(/① 兩邊講的不是同一件事\s*(\d+)/),
    calendarOnly: num(/② 行事曆有、試算表沒勾\s*(\d+)/),
    orphans: num(/③ 試算表有、行事曆沒有\s*(\d+)/),
    who: num(/④b 兩個人都可能\s*(\d+)/),
    future: num(/⑤ 未來的預約\s*(\d+)/),
    personal: num(/⑥ 對不到客戶的\s*(\d+)/),
    sheet: num(/⓪b 舊表本身讀到的問題\s*(\d+)/),
    purchase: num(/⓪c 購買名稱對不上的\s*(\d+)/),
    stale: num(/⓪d 找不到對象的決定\s*(\d+)/),
    low: num(/要你確認（只寫了一半）\s*(\d+)/),
  };
}

function assertComplete(r, board) {
  const t = tally(board.items.filter((i) => !i.fromRecord));
  const want = printed(reportText(r));
  const counts = reportCounts(r);
  const got = {
    conflict: n(t, 'conflict'),
    calendarOnly: n(t, 'calendarOnly'),
    orphans: n(t, 'wrongPerson') + n(t, 'sheetOnly'),
    who: n(t, 'who'),
    future: n(t, 'future'),
    personal: n(t, 'event') + n(t, 'pastTodo') + n(t, 'dropped'),
    sheet: n(t, 'sheet') + n(t, 'sheetInfo'),
    purchase: n(t, 'purchase'),
    stale: n(t, 'stale'),
    low: n(t, 'guess') + board.folded,
  };
  assert.deepEqual(got, want, '決定頁的項數要跟報告上印的一樣');
  assert.equal(n(t, 'unreadable'), counts.unreadable);
}

describe('報告上的每一筆都在決定頁上（不能遺漏）', () => {
  const r = run(SHEETS, EVENTS);
  const board = boardItems(r);

  test('每一段的項數＝報告上印的數字', () => assertComplete(r, board));

  test('這一份資料每一種都有（不然上面那一條只是 0＝0）', () => {
    const t = tally(board.items);
    for (const kind of ['calendarOnly', 'sheetOnly', 'who', 'guess', 'future', 'pastTodo', 'dropped', 'event', 'sheetInfo']) {
      assert.ok(n(t, kind) > 0, `${kind} 一筆都沒有`);
    }
  });

  test('每一種都有樣子（KINDS 裡找得到）', () => {
    for (const i of board.items) assert.ok(KINDS[i.kind], i.kind);
  });

  test('鑰匙不重複；同一天一模一樣的兩筆各有自己的鑰匙', () => {
    const keys = board.items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(board.items.filter((i) => i.title.includes('澆水')).length, 2);
  });

  test('同樣的輸入再跑一次，鑰匙一模一樣', () => {
    const again = boardItems(run(SHEETS, EVENTS));
    assert.deepEqual(again.items.map((i) => i.key), board.items.map((i) => i.key));
  });

  test('要她決定的每一項都有選項，而且每一個選項不是帶著要寫的東西、就是標成要翻譯', () => {
    for (const i of board.items.filter((x) => x.required)) {
      assert.ok(i.options.length >= 2, `${i.key} 沒有選項`);
      for (const o of i.options) assert.ok(Array.isArray(o.ops) || o.free, `${i.key} 的「${o.label}」`);
    }
  });
});

describe('雜事：今天以前的不匯，最近兩週的待辦拿出來問', () => {
  const board = boardItems(run(SHEETS, EVENTS));
  const of = (title) => board.items.filter((i) => i.title.includes(title)).map((i) => i.kind);

  test('最近兩週的待辦要問、預設建議不要', () => {
    assert.deepEqual(of('寄資料給廠商'), ['pastTodo']);
    const item = board.items.find((i) => i.kind === 'pastTodo');
    assert.equal(item.options.find((o) => o.rec).id, 'drop');
  });

  test('更早的、不是待辦的：列出來但不用決定', () => {
    assert.deepEqual(of('10.公出'), ['dropped']);
    assert.deepEqual(of('回電廠商'), ['dropped']);
    assert.equal(KINDS.dropped.required, false);
  });

  test('以後的：看一眼就好', () => {
    assert.deepEqual(of('9.顧客會'), ['event']);
    assert.equal(KINDS.event.required, false);
  });
});

describe('②：舊表那天寫了原因、或行事曆那天寫了取消，建議「沒做」', () => {
  test('那天行事曆寫了「全取消」', () => {
    const board = boardItems(run(
      { 王小明: { dates: ['9/11'], checks: { 'ILIB 60mins': [true] } } },
      [['2026-09-11', '15:00', '3.王小明IL治2'], ['2026-09-21', '16:00', '4.王小明SIS'], ['2026-09-21', '14:00', '2.後課程全取消']],
    ));
    const item = board.items.find((i) => i.kind === 'calendarOnly');
    assert.equal(item.options.find((o) => o.rec)?.id, 'no');
    assert.ok(item.facts[0][1].some((l) => l.includes('全取消')), '證據要列出那一句');
  });

  test('沒有任何線索時不替她建議', () => {
    const board = boardItems(run(SHEETS, EVENTS));
    const item = board.items.find((i) => i.kind === 'calendarOnly');
    assert.equal(item.options.filter((o) => o.rec).length, 0);
  });
});

describe('答過的不再問', () => {
  const r = run(SHEETS, EVENTS);
  const first = boardItems(r);
  const pick = (kind) => first.items.find((i) => i.kind === kind);

  test('答過（沒保留）→ 已決定，不算在要決定的裡面', () => {
    const it = pick('calendarOnly');
    const board = boardItems(r, { decisions: { answers: { [it.key]: { choice: 'no', label: '沒做，不匯' } } } });
    const same = board.items.find((i) => i.key === it.key);
    assert.equal(same.state, 'decided');
    assert.equal(same.prev.choice, 'no');
  });

  test('保留的 → 保留中，帶著她上次的答案', () => {
    const it = pick('who');
    const board = boardItems(r, { decisions: { answers: { [it.key]: { choice: 'none', label: '不確定', hold: true } } } });
    const same = board.items.find((i) => i.key === it.key);
    assert.equal(same.state, 'held');
    assert.equal(same.prev.label, '不確定');
  });

  test('寫了備註、程式翻不了的 → 待翻譯', () => {
    const it = pick('future');
    const board = boardItems(r, { decisions: { answers: { [it.key]: { choice: 'other', label: '其他', needsTranslation: true } } } });
    assert.equal(board.items.find((i) => i.key === it.key).state, 'translate');
  });

  test('保留中、但這一次報告上沒有那一筆的，照存下來的題目再出現', () => {
    const snapshot = { kind: 'question', date: '2026-07-08', who: '王小明', title: '7/8 那一天都有做嗎？', facts: [['行事曆', '「9：30二返」']], options: [{ id: 'keep', label: '維持', ops: [] }] };
    const board = boardItems(r, { decisions: { answers: { 'legacy:D1': { choice: 'keep', label: '維持', hold: true, snapshot } } } });
    const held = board.items.find((i) => i.key === 'legacy:D1');
    assert.equal(held.state, 'held');
    assert.equal(held.required, true);
    assert.equal(held.title, '7/8 那一天都有做嗎？');
  });

  test('答過、這一次也沒有的 → 留在以前的決定裡，不算要決定的', () => {
    const board = boardItems(r, { decisions: { answers: { 'legacy:A1': { choice: null, label: '對，全部是 2026 年', snapshot: { title: '年份' } } } } });
    const it = board.items.find((i) => i.key === 'legacy:A1');
    assert.equal(it.state, 'record');
    assert.equal(it.required, false);
  });
});

describe('⓪d 之前的決定沒對到：行事曆那一句改過字', () => {
  const decisions = {
    customers: { 陳美美: { slots: [{ date: '2026-09-13', course: 'ILIB', set: { fromEvent: '10.陳美美IL治8' } }] } },
  };
  const r = run(SHEETS, EVENTS, { decisions });
  const board = boardItems(r, { decisions });
  const stale = board.items.find((i) => i.kind === 'stale');

  test('列成一項，選項寫得出「照新的那一句」', () => {
    assert.ok(stale, JSON.stringify(board.items.map((i) => i.kind)));
    const next = stale.options.find((o) => o.id === 'new');
    assert.ok(next, '沒有「照新的那一句」');
    assert.deepEqual(next.ops[0], { sheet: '陳美美', section: 'slots', remove: decisions.customers.陳美美.slots[0] });
    assert.equal(next.ops[1].add.set.fromEvent, '10.IL治5');
  });

  test('同一段的「時間是推測的」不另外再問一次，而且還是算得進完整', () => {
    assert.equal(board.items.filter((i) => i.kind === 'guess').length, 0);
    assertComplete(r, board);
  });
});

// ---------------------------------------------------------------------------
// 審查（2026-09-28）補的：上面那一份資料沒有的幾種、決定頁講的跟合併檔一不一樣

import { importJson } from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { applyAnswers } from '../.claude/skills/calendar-sheet-merge/scripts/record.mjs';

/** 跟 run() 一樣，只是行事曆整份自己給（要放一筆讀不出日期的） */
function runRaw(sheets, icsLines, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-board-raw-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  for (const [name, spec] of Object.entries(sheets)) writeFileSync(join(sheetsDir, `${name}.tsv`), sheetTsv(name, spec));
  const icsPath = join(dir, 'cal.ics');
  writeFileSync(icsPath, ['BEGIN:VCALENDAR', ...icsLines, 'END:VCALENDAR'].join('\r\n'));
  return reconcile({ sheetsDir, icsPath, year: 2026, today: '2026-09-28', ...extra });
}
const ev = (i, dt, title) => ['BEGIN:VEVENT', `UID:${i}`, `DTSTART;TZID=Asia/Taipei:${dt}`, `SUMMARY:${title}`, 'END:VEVENT'].join('\r\n');

describe('上一份沒有的幾種：兩邊不一樣、勾錯人、舊表的問題、讀不到、叫法', () => {
  const r = runRaw({
    王小明: { dates: ['9/11'], checks: { '復能(1小時)': [true] } },
    陳美美: { dates: ['9/12'], checks: { 'ILIB 60mins': [true] } },
    林大華: { dates: ['9/01'], checks: { 'ILIB 60mins': [true] } },
    張大同: { dates: ['9/03', '9/04'], checks: { 'ILIB 60mins': [true, true] } },
  }, [
    ev(1, '20260911T150000', '3.王小明EECP治5'),     // 舊表勾復能、行事曆寫 EECP
    ev(2, '20260912T090000', '9.林大華IL治3'),       // 那天林大華沒勾、陳美美勾了 ILIB → 勾錯人？
    ev(3, '20260901T100000', '10.林大華IL治2'),
    ['BEGIN:VEVENT', 'UID:4', 'DTSTART:不是日期', 'SUMMARY:讀不出來的一筆', 'END:VEVENT'].join('\r\n'),
  ]);
  const board = boardItems(r);
  const t = tally(board.items);

  test('每一種都有', () => {
    for (const kind of ['conflict', 'wrongPerson', 'sheet', 'unreadable', 'alias']) assert.ok(n(t, kind) > 0, `${kind} 一筆都沒有：${JSON.stringify(t)}`);
  });

  test('項數＝報告上印的數字', () => assertComplete(r, board));

  test('⓪ 行事曆上從來沒寫過她：一項，數得跟報告一樣', () => {
    assert.equal(n(t, 'alias'), reportCounts(r).blind);
    assert.match(reportText(r), /先補別名/);
  });

  test('勾錯人：照舊表匯進去的是一段已完成的 —— 標「上線前要定」', () => {
    assert.ok(board.items.filter((i) => i.kind === 'wrongPerson').every((i) => i.urgent));
  });
});

describe('決定頁上寫「匯」的，就是合併檔裡會被勾起來的', () => {
  /** 決定頁那一項講的：這一筆雜事會不會進 app */
  const saysImport = (it) => it.kind === 'event' && !/不匯/.test(it.now ?? '');
  /** 合併檔那一份：寫進去、而且帶著 decided/include（app 照它勾，ADR-0117） */
  const fileImports = (json, it) => json.eventCandidates.some((c) => c.title === it.title && c.startDate === it.date && c.decided && c.include);
  const check = (r, decisions = null) => {
    const board = boardItems(r, { decisions });
    const json = importJson(r);
    for (const it of board.items.filter((i) => ['event', 'pastTodo', 'dropped'].includes(i.kind) && !i.fromRecord)) {
      assert.equal(fileImports(json, it), saysImport(it), `${it.kind}「${it.title}」決定頁說${saysImport(it) ? '匯' : '不匯'}`);
    }
  };

  test('今天的、跨過今天的、以後的、今天以前的', () => {
    check(runRaw({}, [
      ev(1, '20260928T140000', '2.今天開會'),
      ['BEGIN:VEVENT', 'UID:2', 'DTSTART;VALUE=DATE:20260920', 'DTEND;VALUE=DATE:20261002', 'SUMMARY:家人出國', 'END:VEVENT'].join('\r\n'),
      ev(3, '20261005T090000', '9.顧客會'),
      ev(4, '20260910T100000', '10.公出'),
      ev(5, '20260925T090000', '寄資料給廠商'),
    ]));
  });

  test('最近的待辦她說要留：三週後照樣是「匯」，兩邊講的一樣', () => {
    const lines = [ev(1, '20260925T090000', '寄資料給廠商')];
    const first = boardItems(runRaw({}, lines));
    const todo = first.items.find((i) => i.kind === 'pastTodo');
    const keep = todo.options.find((o) => o.id === 'keep');
    const decisions = applyAnswers({}, { answers: [{ key: todo.key, choice: keep.id, label: keep.label, ops: keep.ops }] }).decisions;
    const later = runRaw({}, lines, { decisions, today: '2026-10-20' });
    check(later, decisions);
    assert.ok(importJson(later).eventCandidates.some((c) => c.title === '寄資料給廠商'));
  });
});

describe('以後的預約選「不要」：下一輪不會變成雜事又被勾起來', () => {
  test('那一句不在合併檔裡，決定頁上也不是要決定的', () => {
    const sheets = { 王小明: { dates: ['9/11'], checks: { 'ILIB 60mins': [true] } } };
    const events = [['2026-09-11', '15:00', '3.王小明IL治2'], ['2026-10-05', '10:00', '10.王小明心臟科']];
    const first = boardItems(run(sheets, events));
    const future = first.items.find((i) => i.kind === 'future');
    const no = future.options.find((o) => o.id === 'no');
    const decisions = applyAnswers({}, { answers: [{ key: future.key, choice: no.id, label: no.label, ops: no.ops }] }).decisions;

    const r = run(sheets, events, { decisions });
    assert.ok(!importJson(r).eventCandidates.some((c) => c.title === '10.王小明心臟科'), '合併檔裡不可以有它');
    assert.ok(!importJson(r).futureVisits.some((c) => c.evidence === '10.王小明心臟科'));
    const again = boardItems(r, { decisions });
    const aboutIt = again.items.filter((i) => i.title.includes('心臟科') || String(i.key).includes('心臟科'));
    assert.ok(aboutIt.every((i) => i.state !== 'open'), JSON.stringify(aboutIt.map((i) => [i.kind, i.state, i.now])));
    assert.ok(aboutIt.filter((i) => i.kind === 'event').every((i) => /不匯/.test(i.now)), '雜事那一列要寫「不匯」');
  });
});

describe('⓪d：舊表上那一則備註改過字', () => {
  test('選項寫得出「刪掉現在那一則」，而且畫得出來（不會丟錯）', () => {
    const LABELS2 = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];
    const dir = mkdtempSync(join(tmpdir(), 'merge-board-note-'));
    const sheetsDir = join(dir, 'sheets');
    mkdirSync(sheetsDir);
    writeFileSync(join(sheetsDir, '王小明.tsv'), [
      ['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', '9月7日'].join('\t'),
      ...LABELS2.map((l, i) => [i ? '' : '王小明', '', l, 0, 0, 'FALSE'].join('\t')),
      ['', '', '', '', '', '欠30治療師A'].join('\t'),
    ].join('\n'));
    const icsPath = join(dir, 'cal.ics');
    writeFileSync(icsPath, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const decisions = { customers: { 王小明: { notes: { drop: ['9/7 欠30'] } } } };
    const r = reconcile({ sheetsDir, icsPath, year: 2026, today: '2026-09-28', decisions });
    const item = boardItems(r, { decisions }).items.find((i) => i.kind === 'stale');
    assert.ok(item, '要列成一項');
    const next = item.options.find((o) => o.id === 'new');
    assert.ok(next, JSON.stringify(item));
    assert.deepEqual(next.ops.map((o) => o.remove ?? o.add), ['9/7 欠30', '9/7 欠30治療師A']);
  });
});
