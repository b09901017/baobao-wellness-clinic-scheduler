// 兩份 sheets/readonly-report.gs 拿同一包、同一串推送跑一次（測試的替身），比畫出來的每一樣：
// 值、底色、字級、粗體、字色、字型、對齊、換行、合併、框線、欄寬、列高、凍結、鎖、文件屬性。
// .scratch/sheet-push-gaps 第二輪：批次化之後「畫出來一模一樣」用它比正式站那一包。
// **只印數字**（哪一種不一樣、幾格）—— 那一包有真名。
//
//   git show 3dd2ee12:sheets/readonly-report.gs > old.gs
//   node scripts/sheet-gs-compare.mjs old.gs <bundle.json> [--api]
//   `--api`：新的那一份開著假的 Google Sheets API（issues/07），舊的照舊不開 —— 比「開了 API 畫出來一樣」
//
// 排版版號（LAYOUT_VERSION）兩份不一樣是預期的：比文件屬性時把指紋後面那一段版號拿掉。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const [oldPath, bundlePath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const API = process.argv.includes('--api') ? 'on' : 'off';
const { loadAppsScript, snapshotOf } = await import(pathToFileURL(resolve(repo, 'tests/helpers/appsScriptStub.js')).href);
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

/** 同一串推送：第一次（全部畫）→ 都沒變 → 改一頁的指紋（那一頁重畫）→ 整份重畫。每一步之後拍一張。 */
function shots(source, sheetsApi = 'off') {
  const app = loadAppsScript({ source, sheetsApi });
  const out = [];
  const step = (body) => {
    const reply = app.post(body);
    const props = Object.fromEntries([...app.docProps].map(([k, v]) => [k, v.replace(/\|\d+$/, '')]));
    out.push({ reply, snap: snapshotOf(app.ss), props });
  };
  step({ token: 'secret', bundle });
  step({ token: 'secret', bundle: { ...bundle, generatedAt: `${bundle.generatedAt}（2）` } });
  const changed = structuredClone(bundle);
  if (changed.sheets[0]) changed.sheets[0].fingerprint = `${changed.sheets[0].fingerprint}x`;
  step({ token: 'secret', bundle: changed });
  step({ token: 'secret', bundle, force: true });
  return out;
}

const before = shots(readFileSync(oldPath, 'utf8'));
const after = shots(null, API);
let bad = 0;
before.forEach((b, i) => {
  const a = after[i];
  const diffs = {};
  const add = (k, n) => { if (n) diffs[k] = (diffs[k] ?? 0) + n; };
  add('reply', JSON.stringify(b.reply) === JSON.stringify(a.reply) ? 0 : 1);
  add('props', JSON.stringify(b.props) === JSON.stringify(a.props) ? 0 : 1);
  add('sheetCount', b.snap.length === a.snap.length ? 0 : 1);
  b.snap.forEach((bs, j) => {
    const as = a.snap[j];
    if (!as || as.name !== bs.name) { add('sheetOrder', 1); return; }
    for (const key of Object.keys(bs)) {
      if (key === 'formats') {
        for (const f of Object.keys(bs.formats)) {
          const x = new Map(bs.formats[f].map(([c, v]) => [c, JSON.stringify(v)]));
          const y = new Map(as.formats[f].map(([c, v]) => [c, JSON.stringify(v)]));
          let n = 0;
          for (const c of new Set([...x.keys(), ...y.keys()])) if (x.get(c) !== y.get(c)) n += 1;
          add(`format.${f}`, n);
        }
      } else if (Array.isArray(bs[key])) {
        const x = new Set(bs[key].map((e) => JSON.stringify(e)));
        const y = new Set(as[key].map((e) => JSON.stringify(e)));
        let n = 0;
        for (const e of new Set([...x, ...y])) if (!x.has(e) || !y.has(e)) n += 1;
        add(key, n);
      } else {
        add(key, JSON.stringify(bs[key]) === JSON.stringify(as[key]) ? 0 : 1);
      }
    }
  });
  const sheets = b.snap.length;
  const cells = b.snap.reduce((s, x) => s + x.values.length, 0);
  console.log(JSON.stringify({ step: i + 1, sheets, cells, diffs }));
  if (Object.keys(diffs).length) bad += 1;
});
console.log(bad ? `有 ${bad} 步不一樣` : '每一步都一模一樣');
process.exitCode = bad ? 1 : 0;
