// 拿她從 Google 試算表匯出的 .xlsx 驗「真的 Google 畫出來的」跟替身一不一樣（.scratch/sheet-push-gaps/issues/13）。
//
// 試算表裡藏著的 `_data` 分頁就是那一次推過去的整包：拿它餵給 `.gs`（測試的替身）畫一次，跟匯出檔逐頁逐格比
// （值、底色、字級、粗體、字色、字型、對齊、換行、數字格式、備註、框線、合併、欄寬、列高、凍結、格線）。
// 不一樣的就是「真的 Google 跟替身不一樣」或「推過去之後被人動過」。
//
//   檔案 → 下載 → Microsoft Excel (.xlsx)，放進 .local/references/（她自己的檔案放那裡）
//   node scripts/sheet-xlsx-verify.mjs <匯出的.xlsx> [--gs <另一份.gs>] [--bundle <整包.json>] [--out <細節.json>]
//
//   `--gs`：拿另一份 `.gs` 畫（預設是這個 repo 現在的 `sheets/readonly-report.gs`）—— 試算表上貼的是哪一版就拿哪一版，
//           例如 `git show origin/develop:sheets/readonly-report.gs > gs.txt`
//   `--bundle`：不用 `_data` 那一份、改用這一包（`_data` 讀不出來的時候）
//   `--out`：細節寫到哪裡（預設 `.local/references/試算表驗證/<檔名>-<時間>.json`）
//
// **畫面上只印數字**（哪一種不一樣、幾格、第幾頁）—— 分頁名就是客戶的名字。哪一格、兩邊各是什麼寫進細節檔（有真名，放 `.local/`）。
// 讀 xlsx 用 python ＋ openpyxl（`scripts/lib/xlsx-dump.py`）；比法與 Google 的預設值在 `scripts/lib/sheetXlsxCompare.mjs`。
//
// 已知、不算錯的（另外一行 `known`）：產生時間那一格、Google 自己把折行的列長高、她自己開的分頁、備註前面多了作者。
// `_data` 的 B1（計時，替身的時鐘固定在 0）不比。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { bundleFromDump, compareBook } from './lib/sheetXlsxCompare.mjs';

const repo = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const flagged = new Set(['--gs', '--bundle', '--out'].flatMap((f) => {
  const i = args.indexOf(f);
  return i === -1 ? [] : [i, i + 1];
}));
const xlsx = args.find((a, i) => !flagged.has(i) && !a.startsWith('--'));
if (!xlsx) {
  console.error('用法：node scripts/sheet-xlsx-verify.mjs <匯出的.xlsx> [--gs <另一份.gs>] [--bundle <整包.json>] [--out <細節.json>]');
  process.exit(2);
}

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
let dump;
try {
  dump = JSON.parse(execFileSync(python, ['-I', resolve(repo, 'scripts/lib/xlsx-dump.py'), resolve(xlsx)], {
    maxBuffer: 512 * 1024 * 1024,
    encoding: 'utf8',
  }));
} catch (err) {
  console.error(`讀不出那份 .xlsx（要 python ＋ openpyxl）：${String(err.stderr || err.message).split('\n')[0]}`);
  process.exit(2);
}

let bundle;
try {
  bundle = flag('--bundle') ? JSON.parse(readFileSync(flag('--bundle'), 'utf8')) : bundleFromDump(dump);
} catch (err) {
  console.error('`_data` 那一頁接不回整包（JSON 壞了）—— 用 --bundle 指一包');
  process.exit(2);
}
if (!bundle) {
  console.error('匯出檔裡沒有 `_data` 那一頁 —— 用 --bundle 指一包');
  process.exit(2);
}

const { loadAppsScript, snapshotOf } = await import(pathToFileURL(resolve(repo, 'tests/helpers/appsScriptStub.js')).href);
const source = flag('--gs') ? readFileSync(flag('--gs'), 'utf8') : null;
const app = loadAppsScript({ source });
const reply = app.post({ token: 'secret', bundle });
// 回報與錯誤裡可能有分頁名（客戶的名字）：只印數字與「哪一種錯」
const names = (bundle.sheets || []).map((s) => s.name).filter(Boolean);
const scrub = (text) => names.reduce((t, n) => t.split(n).join('（某一頁）'), String(text));
if (!reply.ok) {
  console.error(`替身畫不出來：${scrub(reply.error).slice(0, 200)}`);
  process.exit(1);
}

const result = compareBook(dump, snapshotOf(app.ss));
const known = result.totals.info;
const diffs = result.totals.diffs;
console.log(JSON.stringify({
  realSheets: dump.sheets.length,
  compared: result.compared,
  drawn: reply.sheets,
  skipped: (reply.skipped || []).length,
  cells: result.cells,
  diffs,
  known,
}));
for (const s of result.sheets) {
  if (Object.keys(s.diffs).length) console.log(`第 ${s.index ?? '?'} 頁（照試算表的順序）：${JSON.stringify(s.diffs)}`);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
const out = flag('--out')
  ?? (existsSync(resolve(repo, '.local'))
    ? resolve(repo, '.local/references/試算表驗證', `${basename(xlsx).replace(/\.xlsx$/i, '')}-${stamp}.json`)
    : null);
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    xlsx: resolve(xlsx),
    gs: flag('--gs') ? resolve(flag('--gs')) : 'sheets/readonly-report.gs',
    reply,
    totals: result.totals,
    sheets: result.sheets.filter((s) => s.details.length).map((s) => ({ name: s.name, index: s.index, diffs: s.diffs, info: s.info, details: s.details })),
  }, null, 1)}\n`);
  // 只印資料夾：檔名是她的匯出檔的名字
  console.log(`哪一格、兩邊各是什麼：寫在細節檔（${flag('--out') ? '--out 那一份' : '.local/references/試算表驗證/ 最新那一份'}；有真名，讀的時候接 redact.mjs）`);
} else {
  console.log('沒有 .local/、也沒給 --out：細節沒寫');
}
const bad = Object.values(diffs).reduce((a, b) => a + b, 0);
console.log(bad ? `有 ${bad} 處不一樣` : '每一頁每一格都一樣');
process.exitCode = bad ? 1 : 0;
