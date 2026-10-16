#!/usr/bin/env node
// 把每張截圖的抄本（`抄字/*.tsv`，格式見 references/transcribe.md）合成一份 abovee.json，順便做「免費的檢查」。
//
//   node assemble.mjs <抄字資料夾> --month 2026-10 --out <abovee.json> [--verify <逐像素結果.json>]
//
// - 截圖的順序＝檔名排序（她照時間截，檔名是日期）。順序有意義：兩張重疊的那幾列靠它對齊。
// - **兩張重疊的列**：上一張最後 k 列跟下一張最前 k 列每一格都一樣 → 下一張那 k 列不要（印出來）。
//   只認「頭尾相接」那一種，不去重別的 —— 同一個人同一個時間兩門課是兩列，長得很像但都是真的。
// - 檢查：日期由早到晚、時段的格式、同一個病歷號只對一個名字、還有沒有 `??`。檢查只講、不改 —— 改是看了截圖之後的事。
// - 有 `--verify`（pixel_verify.py 的結果）就把每一列每一格的驗證結果接上去。
//
// 終端機只印數字與第幾張第幾列，不印格子的內容。
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLUMNS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '合併扣課', '實際扣課病歷號', '關係', '預約來源', '診間', '服務資源', '取消原因'];
export const KEYS = ['status', 'date', 'time', 'name', 'chartNo', 'course', 'merged', 'actualChartNo', 'relation', 'source', 'room', 'resource', 'cancelReason'];

/** 一個 TSV 檔 → { shot, meta, rows, notes } */
export function parseTsv(text, file) {
  const out = { shot: null, meta: {}, rows: [], notes: [], problems: [] };
  let header = null;
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((line, n) => {
    if (!line.trim()) return;
    if (line.startsWith('#')) {
      const [tag, ...rest] = line.slice(1).trim().split('\t');
      const value = rest.join('\t').trim();
      if (tag === '截圖') out.shot = value;
      else if (tag === '起') out.meta.from = value;
      else if (tag === '訖') out.meta.to = value;
      else if (tag === '頁') out.meta.page = value;
      else out.notes.push(line.slice(1).trim());
      return;
    }
    const cells = line.split('\t');
    if (!header) {
      header = cells.map((c) => c.trim());
      const bad = COLUMNS.filter((c, i) => header[i] !== c);
      if (bad.length) out.problems.push(`${file}：表頭不是那 13 欄（${bad.join('、')}）`);
      return;
    }
    if (cells.length !== COLUMNS.length) out.problems.push(`${file} 第 ${n + 1} 行：${cells.length} 欄，應該是 ${COLUMNS.length}`);
    const row = Object.fromEntries(KEYS.map((k, i) => [k, (cells[i] ?? '').trim()]));
    out.rows.push(row);
  });
  if (!header) out.problems.push(`${file}：沒有表頭那一行`);
  return out;
}

/** `2026/10/1`、`2026-10-01`、`115-10-01`（民國）→ `2026-10-01`；讀不懂回 null。 */
export function isoDate(text) {
  const m = String(text ?? '').replace(/\?\?/g, '').match(/(\d{3,4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]) < 1911 ? Number(m[1]) + 1911 : Number(m[1]);
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

const sameRow = (a, b) => KEYS.every((k) => a[k] === b[k]);

/** 上一張的尾巴跟這一張的頭一樣的那幾列（最多 5 列） */
export function overlap(prev, next) {
  for (let k = Math.min(5, prev.length, next.length); k >= 1; k -= 1) {
    if (prev.slice(-k).every((r, i) => sameRow(r, next[i]))) return k;
  }
  return 0;
}

export function assemble(files, { month, verify = null, from = null, to = null, complete: said = null } = {}) {
  const problems = [];
  const notes = [];
  const shots = [];
  const rowsPerShot = {};
  const rows = [];
  const meta = { from: null, to: null, page: null };
  let prev = [];
  for (const { file, text } of files) {
    const t = parseTsv(text, file);
    problems.push(...t.problems);
    const shot = t.shot || basename(file).replace(/\.tsv$/, '.png');
    shots.push(shot);
    // 這張抄了幾列（去掉重疊之前）—— 逐像素驗證照它切列
    rowsPerShot[shot] = t.rows.length;
    for (const k of ['from', 'to', 'page']) meta[k] ??= isoDate(t.meta[k]) ?? t.meta[k] ?? null;
    notes.push(...t.notes.map((x) => `${shot}：${x}`));
    const skip = overlap(prev, t.rows);
    if (skip) notes.push(`${shot}：最前面 ${skip} 列跟上一張最後 ${skip} 列一樣（重疊），沒有重複算`);
    t.rows.forEach((r, i) => {
      if (i < skip) return;
      rows.push({ id: `A${String(rows.length + 1).padStart(3, '0')}`, src: shot, row: i + 1, ...r, date: isoDate(r.date) ?? r.date });
    });
    prev = t.rows;
  }

  // ---------- 逐像素驗證的結果 ----------
  let pixel = null;
  if (verify) {
    const byId = new Map((verify.rows ?? []).map((v) => [`${v.src}#${v.row}`, v]));
    let cells = 0;
    let ok = 0;
    for (const r of rows) {
      const v = byId.get(`${r.src}#${r.row}`);
      if (!v) { r.verify = { ok: false, bad: ['沒有驗證'] }; continue; }
      const bad = Object.entries(v.cells ?? {}).filter(([, c]) => !c.ok).map(([k]) => k);
      if (v.deductInk) bad.push('合併扣課那幾欄有字沒抄到');
      cells += Object.keys(v.cells ?? {}).length;
      ok += Object.values(v.cells ?? {}).filter((c) => c.ok).length;
      // 像素說了算：吻合的那一格一律換成像素認的字 —— 抄錯的換掉（`fixedFrom`），打了 ?? 而其實抄對的把 ?? 拿掉
      const fixed = [];
      for (const [k, c] of Object.entries(v.cells ?? {})) {
        if (!c.ok || !KEYS.includes(k) || typeof c.value !== 'string') continue;
        if (c.fixedFrom != null) fixed.push({ field: k, from: c.fixedFrom, to: c.value });
        r[k] = c.value;
      }
      r.verify = { ok: bad.length === 0, bad, fixed };
    }
    pixel = {
      cells, ok, rowsOk: rows.filter((r) => r.verify?.ok).length, rows: rows.length,
      fixed: rows.reduce((n, r) => n + (r.verify?.fixed?.length ?? 0), 0),
      badgeColors: verify.meta?.badgeColors ?? null,
    };
  }

  // ---------- 免費的檢查 ----------
  const where = (r) => `${r.src} 第 ${r.row} 列`;
  for (let i = 1; i < rows.length; i += 1) {
    const [a, b] = [rows[i - 1], rows[i]];
    const ta = String(a.time).slice(0, 5);
    const tb = String(b.time).slice(0, 5);
    if (b.date < a.date || (b.date === a.date && tb < ta)) problems.push(`${where(b)}：比上一列早（日期或時間抄錯，或截圖順序不對）`);
  }
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) problems.push(`${where(r)}：日期讀不懂`);
    else if (month && !r.date.startsWith(`${month}-`)) notes.push(`${where(r)}：不是 ${month} 的（比對時不算）`);
    const m = String(r.time).match(/^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
    if (!m) problems.push(`${where(r)}：時段的格式不是 HH:MM - HH:MM`);
    else if (Number(m[2]) % 5 || Number(m[4]) % 5) notes.push(`${where(r)}：時段不在 5 分鐘的格子上（抄錯的機會高）`);
    // 逐像素驗證過的格子已經沒有 ??（上面換掉了）—— 這裡只剩還沒驗證、或驗證不過的
    const unsure = KEYS.filter((k) => String(r[k]).includes('??'));
    if (unsure.length) notes.push(`${where(r)}：${unsure.map((k) => COLUMNS[KEYS.indexOf(k)]).join('、')} 打了 ??`);
  }
  const names = new Map();
  for (const r of rows) {
    if (!r.chartNo || r.chartNo.includes('??')) continue;
    const set = names.get(r.chartNo) ?? new Map();
    set.set(r.name, [...(set.get(r.name) ?? []), where(r)]);
    names.set(r.chartNo, set);
  }
  for (const [no, set] of names) {
    if (set.size <= 1) continue;
    const at = [...set.values()].map((w) => w[0]).join('、');
    const sure = rows.filter((r) => r.chartNo === no).every((r) => r.verify && !r.verify.bad.includes('name') && !r.verify.bad.includes('沒有驗證'));
    if (sure) notes.push(`同一個病歷號有 ${set.size} 種名字（${at}）—— 逐像素確認過，Abovee 上真的這樣寫`);
    else problems.push(`同一個病歷號有 ${set.size} 種名字：${at} —— ${verify ? '回截圖看（可能是抄錯，也可能 Abovee 上真的那樣）' : '逐像素那一步會確認是抄錯還是 Abovee 上真的那樣'}`);
  }

  // 她說了只截了哪一段（`--from`／`--to`）就照她說的，蓋過截圖上讀到的
  if (from) meta.from = from;
  if (to) meta.to = to;
  const total = Number(String(meta.page ?? '').match(/(\d+)\s*筆/)?.[1] ?? NaN);
  // 拍齊了沒：截圖上的「共 N 筆」跟抄出來的列數一樣，或她說了整個月都截了（`--complete yes`）。拿不準就是 null（＝沒拍齊）
  const complete = Number.isFinite(total) ? total === rows.length : said === true ? true : null;
  if (complete === false) problems.push(`Abovee 上寫共 ${total} 筆，抄出來 ${rows.length} 列 —— 少截了或重複了`);

  return {
    meta: { month, shots, rowsPerShot, from: meta.from, to: meta.to, page: meta.page, total: Number.isFinite(total) ? total : null, complete, pixel },
    problems, notes, rows,
  };
}

// ---------- 指令列 ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = { dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
    else opt.dir = argv[i];
  }
  if (!opt.dir || !opt.out) {
    console.error('用法：node assemble.mjs <抄字資料夾> --month YYYY-MM --out <abovee.json> [--verify <逐像素結果.json>] [--from YYYY-MM-DD --to YYYY-MM-DD] [--complete yes]');
    process.exit(2);
  }
  const files = readdirSync(opt.dir).filter((f) => f.endsWith('.tsv')).sort()
    .map((f) => ({ file: f, text: readFileSync(join(opt.dir, f), 'utf8') }));
  const verify = opt.verify && existsSync(opt.verify) ? JSON.parse(readFileSync(opt.verify, 'utf8')) : null;
  const out = assemble(files, { month: opt.month, verify, from: opt.from ?? null, to: opt.to ?? null, complete: opt.complete === 'yes' });
  mkdirSync(dirname(resolve(opt.out)), { recursive: true });
  writeFileSync(opt.out, JSON.stringify(out, null, 1));
  console.log(`${out.meta.shots.length} 張、${out.rows.length} 列；Abovee 上的總筆數：${out.meta.total ?? '沒拍到'}${
    out.meta.complete ? (out.meta.total ? '（拍齊了）' : '（她說整個月都截了）') : '（沒拍齊：只信第一列到最後一列之間，頭尾那兩天不算次數）'}`);
  if (out.meta.pixel) console.log(`逐像素：${out.meta.pixel.ok}/${out.meta.pixel.cells} 格吻合，${out.meta.pixel.rowsOk}/${out.meta.pixel.rows} 列全部吻合`);
  console.log(`要看的 ${out.problems.length} 件、備註 ${out.notes.length} 件`);
  for (const p of out.problems) console.log(`  ! ${p}`);
}
