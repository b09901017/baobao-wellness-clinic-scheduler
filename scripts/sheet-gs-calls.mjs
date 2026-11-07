// 拿測試的 Apps Script 替身（tests/helpers/appsScriptStub.js），數 sheets/readonly-report.gs 一次推送要叫 Google 幾次：
// 讀幾次、寫幾次、寫完又馬上讀（最慢的那種：Google 要先把前面的寫入做完）幾次、文件屬性幾次。
// .scratch/sheet-push-gaps 第二輪用來比改前改後。數法在 tests/helpers/countGsCalls.js（測試釘次數也用它）。
// 只印數字與 API 名稱，名字不印 —— 拿正式站那一包跑的話，那一包在 .local（有真名）。
//
//   node scripts/sheet-gs-calls.mjs <bundle.json> [另一份.gs]
//   （正式站 11/5 那一包：主資料夾的 .local/references/試算表健檢-2026-11-05/bundle-pushed.json）
//   第二個參數給了就拿那一份 .gs 來數（例：`git show 3dd2ee12:sheets/readonly-report.gs > old.gs` 數改前）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const [bundlePath, gsPath] = process.argv.slice(2);
const { loadAppsScript } = await import(pathToFileURL(resolve(repo, 'tests/helpers/appsScriptStub.js')).href);
const { callCounter, topCalls } = await import(pathToFileURL(resolve(repo, 'tests/helpers/countGsCalls.js')).href);
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

const app = loadAppsScript({ source: gsPath ? readFileSync(gsPath, 'utf8') : null });
const count = callCounter(app);

function run(label, body) {
  const stats = count(() => app.post(body));
  const reply = stats.result;
  console.log(JSON.stringify({
    label, ok: reply.ok, sheets: reply.sheets, kept: reply.kept,
    reads: stats.reads, writes: stats.writes, writeThenRead: stats.writeThenRead, props: stats.props,
  }));
  console.log('  top:', topCalls(stats));
}
run('第一次（每一頁都重畫）', { token: 'secret', bundle });
run('第二次（都沒變）', { token: 'secret', bundle });
run('整份重畫', { token: 'secret', bundle, force: true });
