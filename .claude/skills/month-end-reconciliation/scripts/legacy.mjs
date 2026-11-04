#!/usr/bin/env node
// 舊表（她還在手勾的那份 .xlsx）與 TimeTree（.ics）讀成比對那一步吃的形狀。**只讀、不判斷** —— 哪一格算多勾、
// 哪一天算 TimeTree 沒寫，是 `reconcile.mjs` 的事（「對不對得上」只寫在一個地方）。
//
//   node legacy.mjs --snapshot <快照.json> --month 2026-10 --out <舊表與行事曆.json>
//                   [--xlsx <all_client.xlsx>] [--ics <timetree.ics>] [--aliases <aliases.json>]
//
// - 舊表：一個分頁一位（夫妻共用一個分頁也有，照分頁合起來算：`group` 是分頁名）。哪一位是哪一個分頁，看 app 客戶身上的
//   `importedFrom.sheetName`（切換那天從舊表匯進來時記的）。讀格子用 app 匯入舊表的那一支（`parseSheet()`、`rowShape()`），
//   不另寫一套。每一格勾記下「這一列接受哪幾門課」：「任選」「四選一」那一池也可以是 ILIB；營養品那一列不是來訪，不收。
//   .xlsx → TSV 借 `calendar-sheet-merge` 的 `xlsx-to-tsv.py`（它規定輸出在 repo 外面：放系統暫存、用完就刪）。
// - TimeTree：借 `calendar-sheet-merge` 的 `parseIcs()`、`nameForms()`，一筆事件寫了誰（名字、她記的暱稱）就算那一位那一天。
//   治療師與醫師的名字先排掉，免得兩個字的名字撞到。
//
// 輸出有真名，只寫進 .local/。終端機只印數字。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const mod = (rel) => import(pathToFileURL(join(REPO, rel)).href);
const { parseSheet, rowShape, SHEET_COURSE_ALIASES, parseSheetDate, readCheckbox } = await mod('public/js/domain/legacyImport.js');
const { parseIcs, nameForms, normVariant } = await mod('.claude/skills/calendar-sheet-merge/scripts/merge.mjs');

const opt = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
if (!opt.snapshot || !/^\d{4}-\d{2}$/.test(opt.month ?? '') || !opt.out) {
  console.error('用法：node legacy.mjs --snapshot <快照.json> --month YYYY-MM --out <out.json> [--xlsx <檔>] [--ics <檔>] [--aliases <檔>]');
  process.exit(2);
}
const MONTH = opt.month;
const inMonth = (d) => typeof d === 'string' && d.startsWith(`${MONTH}-`);
const snap = JSON.parse(readFileSync(opt.snapshot, 'utf8'));
const alive = (x) => x && !x.deletedAt;
const customers = snap.customers.filter(alive);
const courses = (snap.master.courses ?? []).filter(alive);
const ivProducts = (snap.master.ivProducts ?? []).filter(alive);
const byName = new Map(courses.map((c) => [c.name, c]));
const ivCourse = courses.find((c) => ivProducts.some((p) => p.courseId === c.id)) ?? byName.get('營養點滴') ?? null;
const ILIB = byName.get('ILIB') ?? null;

// ---------- 舊表 ----------

/** 舊表那一列是哪一門課（對不到回 null）。照 app 匯入舊表的對照，加上品項名與幾個她常寫的字。 */
function courseOfLabel(label) {
  const shape = rowShape(label);
  if (shape) return byName.get(shape.course) ?? null;
  const name = SHEET_COURSE_ALIASES[label] ?? label;
  if (byName.has(name)) return byName.get(name);
  if (/點滴|雪顏|護肝|腸道|亮采|亮彩/.test(label) || ivProducts.some((p) => label.startsWith(p.name.slice(0, 2)))) return ivCourse;
  if (/EECP/i.test(label)) return byName.get('EECP') ?? null;
  if (/二返/.test(label)) return courses.find((c) => /二返/.test(c.name)) ?? null;
  if (/健檢/.test(label)) return courses.find((c) => /健檢/.test(c.name)) ?? null;
  return null;
}
/** 那一列的勾接受哪幾門：「任選」「四選一」那一池也可以是 ILIB。 */
function acceptsOf(label, course) {
  const ids = new Set(course ? [course.id] : []);
  const shape = rowShape(label);
  if (ILIB && shape?.kind === 'pool' && (shape.undecided || shape.set === 'all' || /4選一|四選一|任選/.test(label))) ids.add(ILIB.id);
  return [...ids];
}
const isProductRow = (label) => /^營養品/.test(label);

const legacy = { file: null, ticks: [], groups: {}, unmappedLabels: [], unmatchedSheets: [] };
if (opt.xlsx && existsSync(opt.xlsx)) {
  legacy.file = opt.xlsx.split(/[\\/]/).pop();
  const tmp = mkdtempSync(join(tmpdir(), 'mer-legacy-'));
  try {
    execFileSync('python', [join(REPO, '.claude/skills/calendar-sheet-merge/scripts/xlsx-to-tsv.py'), resolve(opt.xlsx), tmp], { stdio: 'pipe' });
    const bySheet = new Map();
    for (const c of customers) {
      const k = c.importedFrom?.sheetName ?? null;
      if (k) bySheet.set(k, [...(bySheet.get(k) ?? []), c.id]);
    }
    const unmapped = new Set();
    for (const f of readdirSync(tmp).filter((x) => x.endsWith('.tsv') && !x.includes('模板'))) {
      const sheetName = f.replace(/\.tsv$/, '');
      const parsed = parseSheet(readFileSync(join(tmp, f), 'utf8'), { sheetName });
      const ids = bySheet.get(sheetName) ?? customers.filter((c) => c.name === parsed.customerName).map((c) => c.id);
      let any = false;
      for (const item of parsed.items) {
        if (isProductRow(item.label)) continue;
        for (const ch of item.checks) {
          if (readCheckbox(ch.value) !== true) continue;
          const { date } = parseSheetDate(ch.raw, Number(MONTH.slice(0, 4)));
          if (!inMonth(date)) continue;
          any = true;
          const course = courseOfLabel(item.label);
          if (!course) unmapped.add(item.label);
          legacy.ticks.push({ group: sheetName, date, label: item.label, courseId: course?.id ?? null, accepts: acceptsOf(item.label, course) });
        }
      }
      if (ids.length) legacy.groups[sheetName] = ids;
      else if (any) legacy.unmatchedSheets.push(sheetName);
    }
    legacy.unmappedLabels = [...unmapped];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- TimeTree ----------

const timetree = { file: null, days: [] };
if (opt.ics && existsSync(opt.ics)) {
  timetree.file = opt.ics.split(/[\\/]/).pop();
  const aliases = opt.aliases && existsSync(opt.aliases) ? JSON.parse(readFileSync(opt.aliases, 'utf8')) : {};
  const staff = (snap.master.staff ?? []).filter(alive);
  const staffWords = new Set([...(aliases.therapists ?? []), ...(aliases.doctors ?? []), ...Object.values(aliases.therapistAliases ?? {}).flat(),
    ...staff.map((s) => s.name), ...staff.map((s) => s.shortName).filter(Boolean)].map((x) => normVariant(String(x))));
  const formsOf = new Map(customers.map((c) => {
    const forms = new Set([...nameForms(c.name, aliases.nicknames ?? {}),
      ...(c.importedFrom?.sheetName ? nameForms(c.importedFrom.sheetName, aliases.nicknames ?? {}) : [])]);
    return [c.id, [...forms].filter((f) => [...f].length >= 2 && !staffWords.has(f))];
  }));
  const seen = new Set();
  for (const e of parseIcs(readFileSync(opt.ics, 'utf8')).events.filter((x) => inMonth(x.date))) {
    const s = normVariant(e.summary);
    const hits = customers.filter((c) => formsOf.get(c.id).some((f) => s.includes(f)));
    // 短的名字被長的包住（王小明 ⊃ 小明）只算長的那一位
    const keep = hits.filter((c) => !hits.some((o) => o !== c && formsOf.get(o.id).some((fo) => formsOf.get(c.id).every((fc) => fo !== fc && fo.includes(fc)))));
    for (const c of keep) {
      const k = `${c.id}|${e.date}`;
      if (seen.has(k)) continue;
      seen.add(k);
      timetree.days.push({ customerId: c.id, date: e.date });
    }
  }
}

writeFileSync(opt.out, JSON.stringify({ month: MONTH, legacy, timetree }, null, 1));
console.log(`舊表：${legacy.file ? `${legacy.ticks.length} 格勾、${Object.keys(legacy.groups).length} 個分頁${
  legacy.unmatchedSheets.length ? `、${legacy.unmatchedSheets.length} 個分頁對不到 app 的客戶` : ''}${
  legacy.unmappedLabels.length ? `、${legacy.unmappedLabels.length} 種列名認不出課程` : ''}` : '沒有給'}；TimeTree：${
  timetree.file ? `${timetree.days.length} 個「這一天有這一位」` : '沒有給'}`);
