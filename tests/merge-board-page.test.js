// 決定頁的畫面（`.claude/skills/calendar-sheet-merge/scripts/board-page.mjs`）。
//
// 那一頁有真名，所以兩件事比好不好看更要緊：**一個外部資源都沒有**（離線打得開、不會把東西送出去），
// 以及**不可以寫進 repo**。畫面本身 2026-09-28 拿 9/28 那一批用瀏覽器走過（日曆、點一天、看人、
// 看種類、深色、手機寬度、選一項＋保留＋複製回報）。名字全部是假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderBoard } from '../.claude/skills/calendar-sheet-merge/scripts/board-page.mjs';
import { fromRoot } from './helpers/paths.js';

const item = (over = {}) => ({
  key: 'calendarOnly|王小明|2026-09-15|4.王小明SIS', kind: 'calendarOnly', date: '2026-09-15', who: '王小明', sheet: '王小明',
  title: '9/15 這一段復能有做嗎？', facts: [['行事曆', '16:00 「4.王小明SIS」']], now: '沒匯', required: true, urgent: false, state: 'open',
  options: [{ id: 'no', label: '沒做，不匯', ops: [] }, { id: 'other', label: '其他', free: true }], ...over,
});
const board = (items) => ({ items, today: '2026-09-28', customers: [{ sheet: '王小明', name: '王小明' }], context: { visits: [] } });
const page = (items) => renderBoard(board(items), { form: '合併的決定-測試', span: ['2026-06-08', '2027-07-27'] });
const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1]);

describe('決定頁：不連外、每一項都在', () => {
  const html = page([item(), item({ key: 'k2', title: '寫了</script><img src=x onerror=alert(1)>的一句', date: null })]);

  test('一個外部資源都沒有', () => {
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /<link\b/i);
    assert.doesNotMatch(html, /<(script|img|iframe)[^>]*\ssrc=/i);
  });

  test('每一項都帶進頁面裡', () => {
    assert.deepEqual(dataOf(html).items.map((i) => i.key), ['calendarOnly|王小明|2026-09-15|4.王小明SIS', 'k2']);
  });

  test('原文裡的 </script> 不會把頁面切斷', () => {
    assert.equal((html.match(/<\/script>/g) ?? []).length, 2, '只有頁面自己那兩個');
    assert.equal(dataOf(html).items[1].title, '寫了</script><img src=x onerror=alert(1)>的一句');
  });

  test('頁面上那一段程式讀得懂（語法）', () => {
    const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new Function(js));
  });

  test('回報、保留、三種看法都在', () => {
    for (const s of ['複製回報', '保留（下次再問我）', "'日曆'", "'看人'", "'看種類'"]) assert.ok(html.includes(s), s);
  });
});

describe('決定頁不可以寫進 repo（有真名）', () => {
  test('--board 指到 repo 裡、不是 .local/ 的地方：擋下來', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merge-page-'));
    mkdirSync(join(dir, 'sheets'));
    const ics = join(dir, 'cal.ics');
    writeFileSync(ics, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const res = spawnSync(process.execPath, [
      fromRoot('.claude/skills/calendar-sheet-merge/scripts/merge.mjs'),
      '--sheets', join(dir, 'sheets'), '--ics', ics, '--year', '2026', '--today', '2026-09-28',
      '--board', fromRoot('docs/不可以寫在這裡.html'),
    ], { encoding: 'utf8' });
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /不可以寫進 repo/);
  });

  test('暫存區可以', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merge-page-'));
    mkdirSync(join(dir, 'sheets'));
    const ics = join(dir, 'cal.ics');
    writeFileSync(ics, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const res = spawnSync(process.execPath, [
      fromRoot('.claude/skills/calendar-sheet-merge/scripts/merge.mjs'),
      '--sheets', join(dir, 'sheets'), '--ics', ics, '--year', '2026', '--today', '2026-09-28',
      '--board', join(dir, 'board.html'), '--form', '合併的決定-測試',
    ], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
  });
});

// ---------------------------------------------------------------------------
// 回報怎麼組：頁面上跑的就是這一份（REPORT_SRC）

import { REPORT_SRC } from '../.claude/skills/calendar-sheet-merge/scripts/board-page.mjs';

describe('回報：每一種都寫得出 record.mjs 看得懂的那幾條', () => {
  const buildReport = new Function(`${REPORT_SRC}; return buildReport;`)();
  const evItem = (prev = null, kind = 'personal') => ({
    key: `event|2026-10-05|9.顧客會`, kind: 'event', date: '2026-10-05', title: '9.顧客會', state: prev ? 'decided' : 'open',
    event: { title: '9.顧客會', kind: prev?.kind ?? kind, autoKind: 'personal', prev },
  });
  const one = (it, a) => buildReport({ form: 'f', items: [it] }, { [it.key]: a }, 'now').answers[0];

  test('一般的一項：照選項帶的那幾條；「其他」標成要翻譯', () => {
    const it = item();
    assert.deepEqual(one(it, { choice: 'no' }).ops, []);
    const free = one(it, { choice: 'other', note: '隔天' });
    assert.equal(free.free, true);
    assert.equal(free.note, '隔天');
    assert.equal(free.snapshot.title, it.title);
  });

  test('雜事：照預設留著、分類沒改 → 什麼都不寫', () => {
    assert.deepEqual(one(evItem(), { choice: 'keep', kind: 'personal' }).ops, []);
  });

  test('雜事：不要 → 寫一條 skip', () => {
    assert.deepEqual(one(evItem(), { choice: 'drop' }).ops, [{ sheet: null, section: 'events', add: { date: '2026-10-05', title: '9.顧客會', skip: '她在決定頁說不要' } }]);
  });

  test('雜事：以前說不要、現在要 → 拿掉以前那一條', () => {
    const prev = { date: '2026-10-05', title: '9.顧客會', skip: '她說不要', _why: 'X' };
    assert.deepEqual(one(evItem(prev), { choice: 'keep', kind: 'personal' }).ops, [{ sheet: null, section: 'events', remove: prev }]);
  });

  test('雜事：改分類 → 以前那一條的起訖帶過去', () => {
    const prev = { date: '2026-10-05', title: '9.顧客會', kind: 'leave', startDate: '2026-10-05', endDate: '2026-10-07' };
    const ops = one(evItem(prev), { choice: 'keep', kind: 'personal' }).ops;
    assert.deepEqual(ops[0], { sheet: null, section: 'events', remove: prev });
    assert.deepEqual(ops[1].add, { ...prev, kind: 'personal' });
  });

  test('雜事：以前說要留（今天以前的）、現在不要 → 拿掉那一條、寫 skip', () => {
    const prev = { date: '2026-10-05', title: '9.顧客會', kind: 'note', include: true };
    const ops = one(evItem(prev), { choice: 'drop' }).ops;
    assert.deepEqual(ops.map((o) => (o.remove ? 'remove' : 'add')), ['remove', 'add']);
    assert.equal(ops[1].add.skip, '她在決定頁說不要');
  });
});
