// 合併檔：病歷號名單補齊、行事曆寫了床位的診間（course-form-and-sheet-2026-10-06/11 第一、二節）。
//
// 她 10/5 給了一份「預約來源以及病歷號」的名單（有真名，只在她機器的 `.local/`）。舊表 A2 有寫病歷號的客戶
// 早就帶著了；名單補得上舊表沒寫的那幾位 —— 拍 Abovee 與療程單的「病歷號對上、名字差一個字」（ADR-0128）靠它。
//
// **這一行會不會讓決定檔裡的某一個決定安靜失效？會不會改掉舊表上寫的病歷號？** —— 不會：
// 名單只補空的；跟舊表不一樣的不改、進報告 ⓪b（決定頁照舊是一項）。沒帶名單時輸出一個位元都不變。
// 名字一律假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  reconcile, importJson, reportText, roomOf,
} from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { boardItems } from '../.claude/skills/calendar-sheet-merge/scripts/board.mjs';

const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];
const TODAY = '2026-10-06';

function sheetTsv(a2, { d = [0, 0, 0, 0, 0, 0, 12], dates = ['9/11'], checks = { 'ILIB 60mins': [true] } } = {}) {
  const cellsOf = (cells = []) => dates.map((_, i) => (cells[i] === true ? 'TRUE' : 'FALSE'));
  const out = [['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t')];
  LABELS.forEach((label, i) => out.push([i ? '' : a2, '', label, d[i], 0, ...cellsOf(checks[label])].join('\t')));
  return out.join('\n');
}

/** sheets：{ 分頁名: A2 那一格 } */
function run(sheets, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-chart-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  for (const [name, a2] of Object.entries(sheets)) writeFileSync(join(sheetsDir, `${name}.tsv`), sheetTsv(a2));
  const icsPath = join(dir, 'cal.ics');
  writeFileSync(icsPath, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  return reconcile({ sheetsDir, icsPath, year: 2026, today: TODAY, ...extra });
}

const SHEETS = { 王小明: '王小明1234', 李小華: '李小華', 陳大文: '陳大文' };
const fileOf = (r) => JSON.stringify(importJson(r, { generatedAt: 'fixed', calendar: 'fixed' }));
const marksOf = (r, name) => importJson(r).customers.find((c) => c.name === name)?.marks.map((m) => m.text) ?? [];

describe('病歷號名單（--chart-numbers）', () => {
  test('沒帶名單、或名單上沒有這幾位 → 合併檔一個位元都不變', () => {
    const base = fileOf(run(SHEETS));
    assert.equal(fileOf(run(SHEETS, { chartNumbers: null })), base);
    assert.equal(fileOf(run(SHEETS, { chartNumbers: { 某某某: '7777' } })), base);
  });

  test('舊表沒寫、名單上有 → 備註多一則「病歷號 N」（notes 跟著）', () => {
    const r = run(SHEETS, { chartNumbers: { 李小華: '00005678' } });
    assert.ok(marksOf(r, '李小華').includes('病歷號 00005678'));
    assert.match(importJson(r).customers.find((c) => c.name === '李小華').notes, /病歷號 00005678/);
    assert.deepEqual(marksOf(r, '陳大文').filter((t) => t.startsWith('病歷號')), []);
  });

  test('名單上的名字有空白、全形 → 照樣對得上', () => {
    const r = run(SHEETS, { chartNumbers: { '李 小華': '5678' } });
    assert.ok(marksOf(r, '李小華').includes('病歷號 5678'));
  });

  test('舊表寫的跟名單一樣（補零不算不一樣）→ 不動、不報', () => {
    const r = run(SHEETS, { chartNumbers: { 王小明: '00001234' } });
    assert.deepEqual(marksOf(r, '王小明').filter((t) => t.startsWith('病歷號')), ['病歷號 1234']);
    assert.doesNotMatch(reportText(r), /病歷號名單上寫的是/);
    assert.match(reportText(r), /病歷號名單：補了 0 位、跟舊表不一樣 0 位/);
  });

  test('舊表寫的跟名單不一樣 → 不改，進報告 ⓪b，決定頁照舊是一項', () => {
    const r = run(SHEETS, { chartNumbers: { 王小明: '9999' } });
    assert.deepEqual(marksOf(r, '王小明').filter((t) => t.startsWith('病歷號')), ['病歷號 1234']);
    const report = reportText(r);
    assert.match(report, /⓪b 舊表本身讀到的問題/);
    assert.match(report, /病歷號名單上寫的是 9999/);
    const items = boardItems(r).items.filter((i) => i.kind === 'sheet' && i.sheet === '王小明' && /病歷號名單/.test(i.title));
    assert.equal(items.length, 1);
  });

  // 審查查到的：兩張分頁的名字清完一樣（`王小明`、`王小明(2)` 的 A2 都寫王小明）→ 以前兩位都補上同一個號碼，
  // 而「病歷號對上、名字差一個字」（ADR-0128）就是靠這個號碼認人
  test('名單上的名字對到兩位同名的 → 一位都不補，進 ⓪b 講是同名', () => {
    const r = run({ 王小明: '王小明', '王小明(2)': '王小明' }, { chartNumbers: { 王小明: '1234' } });
    const file = importJson(r);
    assert.deepEqual(file.customers.map((c) => c.marks.filter((m) => m.text.startsWith('病歷號')).length), [0, 0]);
    assert.match(reportText(r), /同名的有 2 位/);
    assert.match(reportText(r), /病歷號名單：補了 0 位、跟舊表不一樣 0 位、同名沒補 2 位/);
  });

  test('報告最上面一行講補了幾位、不一樣幾位（只有帶了名單才有）', () => {
    const r = run(SHEETS, { chartNumbers: { 李小華: '5678', 王小明: '9999' } });
    assert.match(reportText(r), /病歷號名單：補了 1 位、跟舊表不一樣 1 位/);
    assert.doesNotMatch(reportText(run(SHEETS)), /病歷號名單/);
  });
});

describe('行事曆寫了床位（11 第二節，ADR-0127）', () => {
  test('.8A、點滴8床B、IL.8b → 點滴8A／點滴8B', () => {
    assert.equal(roomOf('10.客戶A.8A給35'), '點滴8A');
    assert.equal(roomOf('10.客戶A點滴8床B'), '點滴8B');
    assert.equal(roomOf('10.客戶A IL.8b'), '點滴8B');
  });

  test('只寫 .8 → 照舊點滴8（沒選床位的那一間，她：「不要留空」）', () => {
    assert.equal(roomOf('10.客戶A.8（躺）給35'), '點滴8');
  });

  test('主檔沒有那一床的（.5A）→ 只認房間；字母後面還接著字母的不是床位', () => {
    assert.equal(roomOf('10.客戶A.5A'), '點滴5');
    assert.equal(roomOf('10.客戶A.8BIL'), '點滴8');
  });
});

// ---------- 人員名單（--staff-names，prelaunch-fixes 20，ADR-0141） ----------
//
// 名單有真名、只放 `.local/`；這裡是假名。**沒帶名單時除了 `format` 那一行，合併檔跟以前逐位元一樣**：
// 連 `staff` 這個鍵都沒有。

describe('人員名單（--staff-names）', () => {
  const NAMES = { 小芳: '某小芳', 王: '王某某' };

  test('沒帶名單 → 沒有 `staff` 那一段；帶了只多那一段，其餘一個位元都不變', () => {
    const r = run(SHEETS);
    const plain = importJson(r, { generatedAt: 'fixed', calendar: 'fixed' });
    const withStaff = importJson(r, { generatedAt: 'fixed', calendar: 'fixed', staffNames: NAMES });
    assert.equal(plain.format, 'baobao-merge/v6');
    assert.ok(!('staff' in plain));
    const { staff, ...rest } = withStaff;
    assert.equal(JSON.stringify(rest), JSON.stringify(plain));
    assert.deepEqual(staff, [
      { match: '小芳', name: '某小芳', shortName: '小芳' },
      { match: '王', name: '王某某', shortName: '王' },
    ]);
  });

  test('名單上可以另外指定簡寫（種子用了異體字的那一位）', () => {
    const file = importJson(run(SHEETS), { staffNames: { 甲乙: { name: '某甲丙', shortName: '甲丙' } } });
    assert.deepEqual(file.staff, [{ match: '甲乙', name: '某甲丙', shortName: '甲丙' }]);
  });
});
