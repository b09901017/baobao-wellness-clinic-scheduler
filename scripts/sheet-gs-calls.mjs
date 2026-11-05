// 拿測試的 Apps Script 替身（tests/helpers/appsScriptStub.js），數 sheets/readonly-report.gs 一次推送要叫 Google 幾次：
// 讀幾次、寫幾次、寫完又馬上讀（最慢的那種：Google 要先把前面的寫入做完）幾次。.scratch/sheet-push-gaps 第二輪用來比改前改後。
// 只印數字，名字不印 —— 拿正式站那一包跑的話，那一包在 .local（有真名）。
//
//   node scripts/sheet-gs-calls.mjs <bundle.json>
//   （正式站 11/5 那一包：主資料夾的 .local/references/試算表健檢-2026-11-05/bundle-pushed.json）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const [bundlePath] = process.argv.slice(2);
const { loadAppsScript } = await import(pathToFileURL(resolve(repo, 'tests/helpers/appsScriptStub.js')).href);
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

const app = loadAppsScript();
const stats = { reads: 0, writes: 0, switches: 0, byName: {} };
let pending = false;
const READ = /^(get|can|is)/;
function wrap(proto, label) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (typeof d.value !== 'function') continue;
    // 替身自己用的（at／set／get／addMerge）不是 Apps Script 的 API
    if (['at', 'set', 'get', 'addMerge'].includes(name) && label === 'Sheet') continue;
    const orig = d.value;
    proto[name] = function (...args) {
      if (!wrap.on) return orig.apply(this, args);
      const key = `${label}.${name}`;
      stats.byName[key] = (stats.byName[key] ?? 0) + 1;
      // getRange 只是拿一個參考，不打 Google；getSheetByName／getSheets 要
      if (key === 'Sheet.getRange') return orig.apply(this, args);
      if (READ.test(name)) {
        stats.reads += 1;
        if (pending) { stats.switches += 1; pending = false; }
      } else {
        stats.writes += 1;
        pending = true;
      }
      return orig.apply(this, args);
    };
  }
}
const sheet = app.ss.insertSheet('__probe');
wrap(Object.getPrototypeOf(app.ss), 'Spreadsheet');
wrap(Object.getPrototypeOf(sheet), 'Sheet');
wrap(Object.getPrototypeOf(sheet.getRange(1, 1)), 'Range');
wrap(Object.getPrototypeOf(sheet.protect()), 'Protection');
app.ss.deleteSheet(sheet);

function run(label, body) {
  Object.assign(stats, { reads: 0, writes: 0, switches: 0, byName: {} });
  pending = false;
  wrap.on = true;
  const reply = app.post(body);
  wrap.on = false;
  const top = Object.entries(stats.byName).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(JSON.stringify({ label, ok: reply.ok, sheets: reply.sheets, kept: reply.kept, reads: stats.reads, writes: stats.writes, writeThenRead: stats.switches }));
  console.log('  top:', top.map(([k, n]) => `${k}=${n}`).join(' '));
}
run('第一次（每一頁都重畫）', { token: 'secret', bundle });
run('第二次（都沒變）', { token: 'secret', bundle });
run('整份重畫', { token: 'secret', bundle, force: true });
