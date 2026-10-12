// 回報由程式寫進決定檔（`.claude/skills/calendar-sheet-merge/scripts/record.mjs`）。
//
// 她 2026-09-28：「用程式完成這件事而不是用語言模型紀錄，讓每次結果都可以穩定」。
// 9/28：「我希望每一題都可以讓我回答完後，可以選擇要不要保留」。名字全部是假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyAnswers } from '../.claude/skills/calendar-sheet-merge/scripts/record.mjs';
import { reconcile } from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { boardItems } from '../.claude/skills/calendar-sheet-merge/scripts/board.mjs';

const skipOp = { sheet: '王小明', section: 'skipEvents', add: { date: '2026-09-15', title: '4.王小明SIS' } };
const slotOp = { sheet: '王小明', section: 'slots', add: { date: '2026-09-15', add: { course: '復能', fromEvent: '4.王小明SIS' } } };
const answer = (over = {}) => ({
  key: 'calendarOnly|王小明|2026-09-15|4.王小明SIS', choice: 'no', label: '沒做，不匯', note: null, hold: false,
  ops: [skipOp], snapshot: { kind: 'calendarOnly', date: '2026-09-15', who: '王小明', title: '9/15 這一段復能有做嗎？' }, ...over,
});
const report = (...answers) => ({ form: '決定頁-測試', exportedAt: '2026-09-28T10:00:00Z', answers });
const apply = (decisions, ...answers) => applyAnswers(decisions, report(...answers), { at: '2026-09-28' }).decisions;

describe('寫進決定檔', () => {
  test('選項帶的那一條寫進去，答案記在 answers 底下', () => {
    const d = apply({}, answer());
    assert.deepEqual(d.customers.王小明.skipEvents, [{ date: '2026-09-15', title: '4.王小明SIS' }]);
    const a = d.answers['calendarOnly|王小明|2026-09-15|4.王小明SIS'];
    assert.equal(a.choice, 'no');
    assert.equal(a.label, '沒做，不匯');
    assert.equal(a.at, '2026-09-28');
    assert.equal(a.form, '決定頁-測試');
    assert.equal(a.snapshot.title, '9/15 這一段復能有做嗎？');
  });

  test('同一份回報套兩次，決定檔一模一樣', () => {
    const once = apply({}, answer());
    const twice = apply(once, answer());
    assert.deepEqual(twice, once);
  });

  test('先選「沒做」再改「有做」：只剩「有做」那一條', () => {
    const first = apply({}, answer());
    const second = apply(first, answer({ choice: 'yes', label: '有做', ops: [slotOp] }));
    assert.equal(second.customers.王小明.skipEvents, undefined, '退回之後空的那一格收掉');
    assert.deepEqual(second.customers.王小明.slots, [slotOp.add]);
  });

  test('保留：照她的答案先寫進去，而且記著 hold', () => {
    const d = apply({}, answer({ hold: true }));
    assert.equal(d.customers.王小明.skipEvents.length, 1);
    assert.equal(d.answers[answer().key].hold, true);
  });

  test('「其他（寫在備註）」不算答完：什麼都不寫，記成待翻譯', () => {
    const d = apply({}, answer({ choice: 'other', label: '其他', free: true, ops: undefined, note: '其實是隔天' }));
    assert.equal(d.customers?.王小明, undefined);
    const a = d.answers[answer().key];
    assert.equal(a.needsTranslation, true);
    assert.equal(a.note, '其實是隔天');
  });

  test('原本就有的那幾條（沒有鑰匙的舊決定）一個字都不動', () => {
    const before = { customers: { 王小明: { skipEvents: [{ date: '2026-07-01', title: '舊的', _why: 'D2' }] } } };
    const d = apply(before, answer());
    assert.deepEqual(d.customers.王小明.skipEvents[0], { date: '2026-07-01', title: '舊的', _why: 'D2' });
    assert.equal(d.customers.王小明.skipEvents.length, 2);
  });

  test('不會改到傳進來的那一份', () => {
    const before = {};
    apply(before, answer());
    assert.deepEqual(before, {});
  });
});

describe('拿掉舊的那一條（⓪d 換成這一次讀到的）', () => {
  const old = { date: '2026-09-23', course: '營養點滴', set: { fromEvent: '10.王小明.8（躺）' }, _why: 'D18' };
  const ops = [
    { sheet: '王小明', section: 'slots', remove: { date: '2026-09-23', course: '營養點滴', set: { fromEvent: '10.王小明.8（躺）' } } },
    { sheet: '王小明', section: 'slots', add: { date: '2026-09-23', course: '營養點滴', set: { fromEvent: '10.王小明.2（椅）' } } },
  ];
  const stale = answer({ key: 'stale|王小明|slots|x', choice: 'new', label: '照新的那一句', ops });

  test('比對內容時不看 `_` 開頭的欄位', () => {
    const d = apply({ customers: { 王小明: { slots: [old] } } }, stale);
    assert.deepEqual(d.customers.王小明.slots, [ops[1].add]);
  });

  test('改主意：拿掉的那一條放回去', () => {
    const first = apply({ customers: { 王小明: { slots: [old] } } }, stale);
    const back = apply(first, answer({ key: stale.key, choice: 'keep', label: '維持', ops: [] }));
    assert.equal(back.customers.王小明.slots.length, 1);
    assert.equal(back.customers.王小明.slots[0].set.fromEvent, '10.王小明.8（躺）');
  });
});

describe('字串那幾種、整份那一層', () => {
  test('notes.drop 與 dropProblems', () => {
    const d = apply({}, answer({
      key: 'k1', ops: [
        { sheet: '王小明', section: 'notes.drop', add: '9/7 欠30' },
        { sheet: '王小明', section: 'dropProblems', add: '「13健檢」應有 2 次' },
      ],
    }));
    assert.deepEqual(d.customers.王小明.notes.drop, ['9/7 欠30']);
    assert.deepEqual(d.customers.王小明.dropProblems, ['「13健檢」應有 2 次']);
  });

  test('雜事（events，沒有分頁）', () => {
    const d = apply({}, answer({ key: 'k2', ops: [{ sheet: null, section: 'events', add: { date: '2026-11-02', title: '必須請假', kind: 'note' } }] }));
    assert.deepEqual(d.events, [{ date: '2026-11-02', title: '必須請假', kind: 'note' }]);
  });
});

describe('從決定頁到下一次：答過的不再問', () => {
  const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];
  const dir = mkdtempSync(join(tmpdir(), 'merge-record-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  const dates = ['9/11'];
  writeFileSync(join(sheetsDir, '王小明.tsv'), [
    ['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t'),
    // 實際次數（E 欄）跟勾的數目一樣 —— 不然那一格本身就是一題（⓪b），跟這一條要驗的無關
    ...LABELS.map((l, i) => [i ? '' : '王小明', '', l, 1, l === 'ILIB 60mins' ? 1 : 0, l === 'ILIB 60mins' ? 'TRUE' : 'FALSE'].join('\t')),
  ].join('\n'));
  const icsPath = join(dir, 'cal.ics');
  writeFileSync(icsPath, ['BEGIN:VCALENDAR',
    ...[['20260911T150000', '3.王小明IL治2'], ['20260915T160000', '4.王小明SIS']].map(([t, s], i) => `BEGIN:VEVENT\r\nUID:${i}\r\nDTSTART;TZID=Asia/Taipei:${t}\r\nSUMMARY:${s}\r\nEND:VEVENT`),
    'END:VCALENDAR'].join('\r\n'));
  const run = (decisions) => reconcile({ sheetsDir, icsPath, year: 2026, today: '2026-09-28', decisions });

  test('選「沒做」之後重跑：那一筆不在 ② 了，也沒有一項要她再決定', () => {
    const first = boardItems(run(null));
    const item = first.items.find((i) => i.kind === 'calendarOnly');
    const opt = item.options.find((o) => o.id === 'no');
    const decisions = apply({}, { key: item.key, choice: opt.id, label: opt.label, hold: false, ops: opt.ops, snapshot: { kind: item.kind, title: item.title } });

    const r = run(decisions);
    assert.equal(r.leftover.calendarOnly.length, 0);
    const again = boardItems(r, { decisions });
    assert.equal(again.items.filter((i) => i.required && ['open', 'held'].includes(i.state)).length, 0,
      JSON.stringify(again.items.filter((i) => i.required && i.state === 'open').map((i) => i.key)));
    assert.equal(again.items.find((i) => i.key === item.key)?.state, 'record');
  });
});

describe('要拿掉的那一條找不到：不可以安靜地記成決定了', () => {
  test('記成 unmatched、印得出來，決定頁上是「等我處理」', () => {
    const op = { sheet: '王小明', section: 'skipEvents', remove: { date: '2026-09-01', title: '找不到的那一句' } };
    const { decisions, summary } = applyAnswers({}, report(answer({ key: 'stale|x', choice: 'drop', label: '這一條不用了', ops: [op] })), { at: '2026-09-28' });
    assert.deepEqual(decisions.answers['stale|x'].unmatched, [op]);
    assert.equal(summary.unmatched.length, 1);
    const board = boardItems(reconcile({ sheetsDir: mkdtempSync(join(tmpdir(), 'merge-unm-')), icsPath: (() => { const f = join(mkdtempSync(join(tmpdir(), 'merge-unm-ics-')), 'c.ics'); writeFileSync(f, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'); return f; })(), year: 2026, today: '2026-09-28' }), { decisions });
    assert.equal(board.items.find((i) => i.key === 'stale|x').state, 'translate');
  });
});
