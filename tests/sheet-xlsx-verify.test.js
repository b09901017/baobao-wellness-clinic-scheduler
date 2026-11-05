// 拿匯出的 .xlsx 驗真的 Google 畫得對不對的那支工具（`scripts/sheet-xlsx-verify.mjs`，.scratch/sheet-push-gaps/issues/13）。
//
// 判準：**一樣的要說一樣、改一格就剛好說一格，而且說得出是哪一種**（值、Google 把字認成日期、框線、列高…）。
//
// 怎麼造「Google 匯出的樣子」：替身畫一次，照 11/5 對過的匯出慣例（欄寬 像素/8+0.125、列高 點、顏色 FFRRGGBB、置中寫 center、
// 框線相鄰兩格各寫一次、備註變 comment）攤成 `xlsx-dump.py` 會吐出來的那一份（`dumpLike()`）。
// 這台有 python ＋ openpyxl 的話，再把那一份真的寫成 .xlsx、整支工具跑一次（CI 上沒有 openpyxl → 那兩條跳過）。
// 例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadAppsScript, snapshotOf } from './helpers/appsScriptStub.js';
import {
  a1, boundsOf, bundleFromDump, compareBook, frozenOf, pxOfHeight, pxOfWidth, stubModel,
} from '../scripts/lib/sheetXlsxCompare.mjs';

const repo = resolve(import.meta.dirname, '..');

function page(name) {
  return {
    name,
    fingerprint: `fp-${name}`,
    chartNo: '1234',
    source: '8萬方案',
    dateLabels: ['9/1(二)', '9/8(二)', '9/15(二)'],
    rows: [
      { label: '健檢', total: 2, done: 1, booked: 0, remaining: 1, marks: ['', '✓', ''] },
      { label: '復能-三選一(60)', total: 10, done: 3, booked: 1, remaining: 6, marks: ['✓', '△', '✓'] },
      { label: '三返（不算次數）', total: '—', done: 1, booked: 0, remaining: '—', marks: ['', '', '✓'], extra: true },
    ],
    equipmentNotes: [{ rowIndex: 1, label: '器材', cells: [{ dateIndex: 0, text: 'IN' }] }],
    slotNotes: [{ rowIndex: 1, label: '記一句', cells: [{ dateIndex: 2, text: '左肩比較緊\n下次早一點' }] }],
    followupNotes: [{ dateIndex: 1, text: '9/15 二返(某明)' }],
    purchases: ['2026-08-01　8萬方案 ×1'],
    products: [{ label: '營養品A', amount: 12000, months: 3, items: ['魚油'], deliveredAt: '2026-09-01', delivery: '給了 1／3', done: false }],
    flags: ['體內金屬'],
    notes: '住附近\n偏好早上',
    noteLines: [{ text: '住附近', color: 'green' }, { text: '偏好早上', color: 'blue' }],
    log: [{ label: '9/1(二)', items: [{ status: '✓', time: '10:00', course: '復能', equipment: 'IN', room: '治3', therapist: '某明' }] }],
    tasks: {
      todo: [{ label: '9/8 健檢', kind: '追蹤健檢報告', dueDate: '2026-09-15' }],
      finished: [{ label: '9/1 復能', kind: '寫紀錄', doneAt: '2026-09-01T10:00:00Z' }],
    },
    totals: { total: 12, done: 5, booked: 1, remaining: 7 },
  };
}

const BUNDLE = {
  format: 8,
  generatedAt: '2026/11/05 上午10:00:00',
  legend: '✓ 做完　△ 排了還沒做　○ 待確認　✗ 沒來',
  notice: '⚠ 這張表由系統自動產生，請不要在這裡改資料 —— 改了也不會回到 app',
  sheets: [page('王小明'), page('客戶A')],
};

function drawn(bundle = BUNDLE) {
  const app = loadAppsScript();
  const reply = app.post({ token: 'secret', bundle });
  assert.equal(reply.ok, true, reply.error);
  return snapshotOf(app.ss);
}

const argb = (hex) => `FF${hex}`;
const pick = (v, dflt) => (v === undefined ? dflt : v);

/** 替身畫的那一份 → `xlsx-dump.py` 會從 Google 匯出檔吐出來的樣子（照 11/5 staging 那一份對過的慣例）。 */
function dumpLike(snapshot) {
  return {
    sheets: snapshot.map((snap) => {
      const m = stubModel(snap);
      const cells = new Map();
      const at = (ref) => {
        if (!cells.has(ref)) cells.set(ref, {});
        return cells.get(ref);
      };
      for (const [ref, c] of m.cells) {
        const out = at(ref);
        if (c.value != null) out.v = c.value;
        if (c.background) out.fill = argb(c.background);
        out.font = { name: pick(c.fontFamily, 'Arial'), sz: pick(c.fontSize, 10) };
        if (c.bold) out.font.b = true;
        if (c.fontColor && c.fontColor !== '000000') out.font.color = argb(c.fontColor);
        if (c.hAlign) out.h = c.hAlign;
        if (c.vAlign) out.vt = c.vAlign;
        if (c.wrap) out.wrap = true;
        if (c.numberFormat && c.numberFormat !== 'General') out.fmt = c.numberFormat;
        if (c.note) out.note = c.note;
      }
      for (const [key, value] of m.edges) {
        const [kind, r, c] = key.split(':');
        const [style, hex] = value.split(':');
        const side = [style, argb(hex)];
        const row = Number(r);
        const col = Number(c);
        const put = (rr, cc, k) => {
          if (rr < 1 || cc < 1) return;
          const cell = at(a1(rr, cc));
          cell.border = { ...(cell.border || {}), [k]: side };
        };
        if (kind === 'h') { put(row, col, 't'); put(row - 1, col, 'b'); } else { put(row, col, 'l'); put(row, col - 1, 'r'); }
      }
      return {
        name: snap.name,
        state: snap.hidden ? 'hidden' : 'visible',
        freeze: snap.frozenRows || snap.frozenCols ? a1(snap.frozenRows + 1, snap.frozenCols + 1) : null,
        gridlines: !snap.gridlinesHidden,
        merges: [...snap.merges],
        widths: snap.widths.map(([c, px]) => [c, c, px / 8 + 0.125]),
        defaultColWidth: 12.63,
        baseColWidth: 8,
        defaultRowHeight: 15.75,
        heights: snap.rowHeights.map(([r, px]) => [r, (px * 3) / 4]),
        cells: [...cells.entries()],
      };
    }),
  };
}

const total = (bucket) => Object.values(bucket).reduce((a, b) => a + b, 0);
const sheetOf = (dump, name) => dump.sheets.find((s) => s.name === name);
const cellOf = (sheet, ref) => {
  const hit = sheet.cells.find(([r]) => r === ref);
  if (hit) return hit[1];
  const made = {};
  sheet.cells.push([ref, made]);
  return made;
};

describe('Google 匯出的單位（11/5 staging 那一份對過）', () => {
  test('欄寬：190／62／58／預設 100 像素匯出成 23.88／7.88／7.38／12.63', () => {
    assert.deepEqual([23.88, 7.88, 7.38, 12.63].map(pxOfWidth), [190, 62, 58, 100]);
  });

  test('列高：26 像素匯出成 19.5 點、預設 21 像素是 15.75 點', () => {
    assert.deepEqual([19.5, 15.75, 30].map(pxOfHeight), [26, 21, 40]);
  });

  test('凍結：F6 是五列五欄、A6 是只凍五列、沒有是 0', () => {
    assert.deepEqual(frozenOf('F6'), { rows: 5, cols: 5 });
    assert.deepEqual(frozenOf('A6'), { rows: 5, cols: 0 });
    assert.deepEqual(frozenOf(null), { rows: 0, cols: 0 });
    assert.deepEqual(boundsOf('B3:D5'), { top: 3, left: 2, bottom: 5, right: 4 });
  });
});

describe('一樣的說一樣、改一格說一格', () => {
  const snapshot = drawn();

  test('照替身畫的匯出：每一頁每一格都一樣（`_data` 也比，B1 計時不比）', () => {
    const out = compareBook(dumpLike(snapshot), snapshot);
    assert.deepEqual(out.totals.diffs, {});
    assert.deepEqual(out.totals.info, {});
    assert.equal(out.compared, 3);
    assert.ok(out.cells > 200, `比了 ${out.cells} 格`);
  });

  test('改一格的字 → 剛好 1 個不一樣（value）', () => {
    const dump = dumpLike(snapshot);
    cellOf(sheetOf(dump, '客戶A'), 'A2').v = '別人';
    const out = compareBook(dump, snapshot);
    assert.deepEqual(out.totals.diffs, { value: 1 });
    const hit = out.sheets.find((s) => s.name === '客戶A');
    assert.deepEqual(hit.details.map((d) => [d.kind, d.where]), [['value', 'A2']]);
  });

  test('Google 把待辦的日期認成日期 → value.date（＋那一格的日期格式）', () => {
    const dump = dumpLike(snapshot);
    const sheet = sheetOf(dump, '客戶A');
    const [ref] = sheet.cells.find(([, c]) => c.v === '2026-09-15');
    Object.assign(cellOf(sheet, ref), { v: { $date: '2026-09-15T00:00:00' }, fmt: 'yyyy-mm-dd' });
    const out = compareBook(dump, snapshot);
    assert.deepEqual(out.totals.diffs, { 'value.date': 1, numberFormat: 1 });
  });

  test('一段短備註被 Google 認成數字 → value.number', () => {
    const bundle = structuredClone(BUNDLE);
    bundle.sheets[1].noteLines = [{ text: '0912345678', color: 'grey' }];
    const snap = drawn(bundle);
    const dump = dumpLike(snap);
    const sheet = sheetOf(dump, '客戶A');
    const [ref] = sheet.cells.find(([, c]) => c.v === '0912345678');
    cellOf(sheet, ref).v = 912345678;
    assert.deepEqual(compareBook(dump, snap).totals.diffs, { 'value.number': 1 });
  });

  test('框線：剩餘右邊那條粗線變細 → border 1；格線藏起來沒套到 → sheet.gridlines 1', () => {
    const dump = dumpLike(snapshot);
    const sheet = sheetOf(dump, '王小明');
    for (const [, c] of sheet.cells) {
      if (c.border?.r?.[0] === 'medium') { c.border.r = ['thin', 'FFB0BEC5']; break; }
    }
    // 相鄰那一格（F 欄）的左邊也寫著粗線：一起改細，才是「那一條邊細了」
    for (const [, c] of sheet.cells) {
      if (c.border?.l?.[0] === 'medium') { c.border.l = ['thin', 'FFB0BEC5']; break; }
    }
    sheet.gridlines = true;
    assert.deepEqual(compareBook(dump, snapshot).totals.diffs, { border: 1, 'sheet.gridlines': 1 });
  });

  test('列高：矮了是要查的、高了是 Google 自己長高（已知）', () => {
    const dump = dumpLike(snapshot);
    const sheet = sheetOf(dump, '王小明');
    sheet.heights = sheet.heights.map(([r, pt]) => {
      if (r === 3) return [r, pt - 6];
      if (r === 6) return [r, pt + 15];
      return [r, pt];
    });
    const out = compareBook(dump, snapshot);
    assert.deepEqual(out.totals.diffs, { rowHeight: 1 });
    assert.deepEqual(out.totals.info, { 'rowHeight.grew': 1 });
  });

  test('凍結欄、合併、記一句的備註不見了 → 各算一個', () => {
    const dump = dumpLike(snapshot);
    const sheet = sheetOf(dump, '王小明');
    sheet.freeze = 'A6';
    sheet.merges = sheet.merges.filter((r) => r !== 'A2:E2');
    for (const [, c] of sheet.cells) if (c.note) delete c.note;
    const out = compareBook(dump, snapshot);
    assert.deepEqual(out.totals.diffs, { 'sheet.frozenCols': 1, merge: 1, note: 1 });
  });

  test('備註前面多了作者 → 已知；產生時間不一樣 → 已知；她自己開的分頁 → 已知；替身有、匯出檔沒有 → 要查', () => {
    const dump = dumpLike(snapshot);
    const sheet = sheetOf(dump, '王小明');
    const noted = sheet.cells.find(([, c]) => c.note)[1];
    noted.note = `某人:\n${noted.note}`;
    const stamped = sheet.cells.find(([, c]) => typeof c.v === 'string' && c.v.startsWith('產生時間 '))[1];
    stamped.v = stamped.v.replace('上午10:00:00', '上午10:05:00');
    dump.sheets.push({ name: '工作表1', state: 'visible', freeze: null, gridlines: true, merges: [], widths: [], heights: [], cells: [] });
    dump.sheets = dump.sheets.filter((s) => s.name !== '客戶A');
    const out = compareBook(dump, snapshot);
    assert.deepEqual(out.totals.diffs, { missingSheet: 1 });
    assert.deepEqual(out.totals.info, { 'note.prefixed': 1, stamp: 1, extraSheet: 1 });
  });

  test('`_data` 的 B1（計時）不一樣不算；A 欄的原始資料不一樣算', () => {
    const dump = dumpLike(snapshot);
    const data = sheetOf(dump, '_data');
    cellOf(data, 'B1').v = '計時 {"ms":{"總共":5400}}';
    assert.equal(total(compareBook(dump, snapshot).totals.diffs), 0);
    cellOf(data, 'A1').v = '改過';
    assert.deepEqual(compareBook(dump, snapshot).totals.diffs, { value: 1 });
  });

  test('`_data` 從 A2 起照列接回整包（不管匯出檔裡的先後）', () => {
    const dump = dumpLike(snapshot);
    const data = sheetOf(dump, '_data');
    data.cells.reverse();
    assert.deepEqual(bundleFromDump(dump), BUNDLE);
  });
});

// ---- 整支工具（python ＋ openpyxl）：真的寫一份 .xlsx、真的跑那支腳本 ----

const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const hasOpenpyxl = spawnSync(PYTHON, ['-I', '-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
const SKIP = hasOpenpyxl ? false : '這台沒有 python ＋ openpyxl（CI）';

/** 把 `dumpLike()` 那一份寫成真的 .xlsx（openpyxl）。只是照抄，不判斷。 */
const WRITER = String.raw`
import json, sys, datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.comments import Comment
spec = json.load(open(sys.argv[1], encoding='utf-8'))
wb = openpyxl.Workbook()
wb.remove(wb.active)
for s in spec['sheets']:
    ws = wb.create_sheet(s['name'])
    ws.sheet_state = s['state']
    ws.sheet_view.showGridLines = s['gridlines']
    for (mn, mx, w) in s['widths']:
        ws.column_dimensions[openpyxl.utils.get_column_letter(mn)].width = w
    for (r, pt) in s['heights']:
        ws.row_dimensions[r].height = pt
    for ref, c in s['cells']:
        cell = ws[ref]
        v = c.get('v')
        if isinstance(v, dict):
            v = datetime.datetime.fromisoformat(v['$date'])
        if v is not None:
            cell.value = v
        if 'fill' in c:
            cell.fill = PatternFill('solid', fgColor=c['fill'])
        f = c.get('font')
        if f:
            cell.font = Font(name=f.get('name'), sz=f.get('sz'), b=f.get('b', False), color=f.get('color'))
        if 'h' in c or 'vt' in c or 'wrap' in c:
            cell.alignment = Alignment(horizontal=c.get('h'), vertical=c.get('vt'), wrap_text=c.get('wrap'))
        if 'fmt' in c:
            cell.number_format = c['fmt']
        if 'note' in c:
            cell.comment = Comment(c['note'], 'x')
        b = c.get('border')
        if b:
            side = lambda k: Side(style=b[k][0], color=b[k][1]) if k in b else Side()
            cell.border = Border(left=side('l'), right=side('r'), top=side('t'), bottom=side('b'))
    for ref in s['merges']:
        ws.merge_cells(ref)
    if s['freeze']:
        ws.freeze_panes = s['freeze']
wb.save(sys.argv[2])
`;

describe('整支工具（真的 .xlsx）', () => {
  function writeXlsx(dump, dir, name) {
    const spec = join(dir, `${name}.json`);
    const writer = join(dir, 'writer.py');
    const xlsx = join(dir, `${name}.xlsx`);
    writeFileSync(spec, JSON.stringify(dump));
    writeFileSync(writer, WRITER);
    execFileSync(PYTHON, ['-I', writer, spec, xlsx]);
    return xlsx;
  }

  function verify(xlsx, dir) {
    const out = join(dir, 'detail.json');
    const run = spawnSync(process.execPath, [resolve(repo, 'scripts/sheet-xlsx-verify.mjs'), xlsx, '--out', out], { encoding: 'utf8' });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, detail: run.status === 2 ? null : JSON.parse(readFileSync(out, 'utf8')) };
  }

  test('一樣 → 印「每一頁每一格都一樣」、exit 0；畫面上沒有分頁名', { skip: SKIP }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'xlsx-verify-'));
    try {
      const run = verify(writeXlsx(dumpLike(drawn()), dir, 'same'), dir);
      const where = (run.detail?.sheets || []).flatMap((s) => s.details.map((d) => `${s.index} ${d.kind} ${d.where} ${JSON.stringify(d.real)} ${JSON.stringify(d.stub)}`));
      assert.equal(run.status, 0, run.stdout + run.stderr + where.join('\n'));
      assert.match(run.stdout, /每一頁每一格都一樣/);
      assert.doesNotMatch(run.stdout, /王小明|客戶A/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('改一格 → 有 1 處不一樣、exit 1；哪一格寫在細節檔', { skip: SKIP }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'xlsx-verify-'));
    try {
      const dump = dumpLike(drawn());
      const sheet = sheetOf(dump, '王小明');
      const [ref] = sheet.cells.find(([, c]) => c.v === '2026-09-15');
      Object.assign(cellOf(sheet, ref), { v: { $date: '2026-09-15T00:00:00' }, fmt: 'yyyy-mm-dd' });
      const run = verify(writeXlsx(dump, dir, 'one'), dir);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      assert.match(run.stdout, /有 2 處不一樣/);
      assert.doesNotMatch(run.stdout, /王小明|客戶A/);
      const hit = run.detail.sheets.find((s) => s.name === '王小明');
      assert.deepEqual(hit.details.map((d) => [d.kind, d.where]).sort(), [['numberFormat', ref], ['value.date', ref]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
