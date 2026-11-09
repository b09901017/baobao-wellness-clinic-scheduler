#!/usr/bin/env node
// 抄完字之後的整條流程，一個指令：快照 → 合成 → 候選字 → 逐像素 → 再合成 → 比對 → 那一頁。
//
//   node run.mjs --month 2026-10 [--project prod|staging|<id>] [--today YYYY-MM-DD] [--root <月底對帳資料夾>]
//                [--from YYYY-MM-DD --to YYYY-MM-DD]   只截了月中一段、截圖上又沒拍到「預約日期(起)／(訖)」時給
//                [--complete yes]   截圖上沒拍到「共 N 筆」、但她說第一張是第一頁、最後一張是最後一頁
//                                   （沒給的話只信第一列到最後一列之間，頭尾那兩天不算次數）
//                [--xlsx <檔>|none] [--ics <檔>|none]   舊表與 TimeTree（預設 .local/references/xlsx/all_client.xlsx、ics/timetree.ics，
//                                   有那個檔才對；none＝這個月不對）
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node run.mjs --month 2026-10 --project demo-scheduler-w5   # 對模擬器
//
// 前提：`<root>/<月>/過程/抄字/*.tsv` 已經抄好（SKILL.md 第 2 步，subagent 做）。每一步的結果都是一個檔，
// 哪一步斷了修好再跑一次就好（快照每次重拍 —— 要的是現在的 app）。逐像素的校正存在 `<root>/校正/`，
// 對不上這一批截圖（縮放換了）會自己重新校正一次。
// 終端機只印數字與檔名；有真名的東西只寫在 `<root>`（.local/ 底下）。
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

const opt = { project: 'prod', root: join(REPO, '.local', 'references', '月底對帳') };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
if (!/^\d{4}-\d{2}$/.test(opt.month ?? '')) {
  console.error('用法：node run.mjs --month YYYY-MM [--project prod|staging|<id>] [--today YYYY-MM-DD]');
  process.exit(2);
}

opt.root = resolve(REPO, opt.root);
const M = opt.month;
const D = join(opt.root, M);
const P = join(D, '過程');
const shots = join(D, '截圖');
const tsv = join(P, '抄字');
const shared = join(opt.root, '校正');
const tidy = join(P, '整理過的截圖');
const refs = join(REPO, '.local', 'references');
const pickFile = (given, fallback) => (given === 'none' ? null : given ? resolve(REPO, given) : existsSync(fallback) ? fallback : null);
const xlsx = pickFile(opt.xlsx, join(refs, 'xlsx', 'all_client.xlsx'));
const ics = pickFile(opt.ics, join(refs, 'ics', 'timetree.ics'));
if (!existsSync(tsv) || !readdirSync(tsv).some((f) => f.endsWith('.tsv'))) {
  console.error(`${tsv} 裡沒有抄本 —— 先照 SKILL.md 第 2 步抄字`);
  process.exit(2);
}

// 開始之前確定整個資料夾不進版控（擋沒擋住從畫面上看不出來）
try {
  execFileSync('git', ['check-ignore', '-q', join(D, '過程', 'x.json')], { cwd: REPO });
} catch {
  console.error(`${D} 沒有被 .gitignore 擋住 —— 截圖與結果有真名，不能放這裡`);
  process.exit(2);
}

const node = (script, args) => execFileSync(process.execPath, [join(HERE, script), ...args], { cwd: REPO, stdio: 'inherit' });
const py = (args) => {
  try {
    execFileSync('python', [join(HERE, 'pixel_verify.py'), ...args], { cwd: REPO, stdio: 'inherit' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
};
const step = (s) => console.log(`\n== ${s}`);

step('1/6 拍 app 的快照（只讀）');
node('snapshot.mjs', ['--project', opt.project, '--out', join(P, 'app-快照.json')]);

step('2/6 合成抄本');
const range = [
  ...(opt.from ? ['--from', opt.from] : []), ...(opt.to ? ['--to', opt.to] : []), ...(opt.complete === 'yes' ? ['--complete', 'yes'] : []),
];
node('assemble.mjs', [tsv, '--month', M, '--out', join(P, 'abovee-抄的.json'), ...range]);
node('vocab.mjs', [join(P, 'app-快照.json'), join(P, '候選字.json')]);

step('3/6 逐像素驗證每一格');
// 先整理圖（裁掉鉛筆與捲軸、塗掉名字後面的按鈕，`tidy.mjs`）—— 原始截圖不動，驗證讀整理過的那一份。
// pxx 的圖片快取只認檔名（換了一批同名的圖會讀到舊的），所以每次先清掉
node('tidy.mjs', [shots, tidy]);
/** 驗證一組截圖；校正不合就重新校正一次（成功才存回 `sharedDir`）。回傳 pixel_verify 的結束碼 */
const verifyGroup = (aboveeJson, workDir, sharedDir, outJson, label) => {
  rmSync(join(workDir, 'raw'), { recursive: true, force: true });
  const pv = ['--shots', tidy, '--abovee', aboveeJson, '--work', workDir, '--shared', sharedDir];
  let rc = py(['verify', ...pv, '--vocab', join(P, '候選字.json'), '--out', outJson]);
  if (rc === 3) {
    step(`3/6 校正不合${label} → 重新校正一次`);
    if (py(['calibrate', ...pv]) !== 0) return 1;
    rc = py(['verify', ...pv, '--vocab', join(P, '候選字.json'), '--out', outJson]);
  }
  return rc;
};
const rc = verifyGroup(join(P, 'abovee-抄的.json'), join(P, 'pxx'), shared, join(P, '逐像素.json'), '這一批截圖');
if (rc !== 0) process.exit(rc);

// 同一批裡混了另一種字型（2026-11-09：10 月補截的那幾張跟 11/4 那一批字型不一樣）：校正只照第一張，
// 所以那幾張的日期一格都對不上。日期那一欄不到一半吻合的那幾張拆成第二組，另外校正（存在 `校正/第二組/`，
// 不蓋掉共用的那一份）、另外驗證，結果合回 `逐像素.json`。
{
  const result = JSON.parse(readFileSync(join(P, '逐像素.json'), 'utf8'));
  const byShot = new Map();
  for (const r of result.rows) {
    const d = r.cells?.date;
    if (!d) continue;
    const s = byShot.get(r.src) ?? { n: 0, ok: 0 };
    s.n += 1;
    if (d.ok) s.ok += 1;
    byShot.set(r.src, s);
  }
  const off = [...byShot].filter(([, s]) => s.ok < 0.5 * s.n).map(([src]) => src);
  if (off.length && off.length < byShot.size) {
    step(`3/6 有 ${off.length} 張的字型跟其他張不一樣 → 那幾張另外校正、驗證`);
    const all = JSON.parse(readFileSync(join(P, 'abovee-抄的.json'), 'utf8'));
    const sub = { ...all, meta: { ...all.meta, rowsPerShot: Object.fromEntries(off.map((s) => [s, all.meta.rowsPerShot[s]])) },
      rows: all.rows.filter((r) => off.includes(r.src)) };
    const subJson = join(P, 'abovee-抄的-第二組.json');
    writeFileSync(subJson, JSON.stringify(sub, null, 1));
    const out2 = join(P, '逐像素-第二組.json');
    const rc2 = verifyGroup(subJson, join(P, 'pxx-第二組'), join(shared, '第二組'), out2, '那幾張');
    if (rc2 !== 0) process.exit(rc2);
    const second = JSON.parse(readFileSync(out2, 'utf8'));
    result.rows = [...result.rows.filter((r) => !off.includes(r.src)), ...second.rows];
    const cells = result.rows.flatMap((r) => Object.values(r.cells ?? {}));
    Object.assign(result.meta, { cells: cells.length, ok: cells.filter((c) => c.ok).length,
      fixed: cells.filter((c) => c.fixedFrom != null).length, secondGroup: { shots: off, profile: second.meta?.profile ?? null } });
    writeFileSync(join(P, '逐像素.json'), JSON.stringify(result, null, 1));
    console.log(`合起來：逐像素 ${result.meta.ok}/${result.meta.cells} 格吻合`);
  }
}

step('4/6 套上逐像素的結果');
node('assemble.mjs', [tsv, '--month', M, '--out', join(P, 'abovee.json'), '--verify', join(P, '逐像素.json'), ...range]);

step('5/6 比對（舊表與 TimeTree 一起）');
node('legacy.mjs', ['--snapshot', join(P, 'app-快照.json'), '--month', M, '--out', join(P, '舊表與行事曆.json'),
  ...(xlsx ? ['--xlsx', xlsx] : []), ...(ics ? ['--ics', ics] : []), '--aliases', join(refs, 'aliases.json')]);
node('reconcile.mjs', ['--abovee', join(P, 'abovee.json'), '--snapshot', join(P, 'app-快照.json'), '--month', M,
  '--legacy', join(P, '舊表與行事曆.json'), '--out', join(P, '比對.json'), ...(opt.today ? ['--today', opt.today] : [])]);

step('6/6 那一頁');
const out = join(D, '結果', `對帳結果-${M}.html`);
node('report.mjs', [join(P, '比對.json'), out]);
node('look.mjs', [out, join(P, '看一眼')]);
// 她看的說明：資料夾裡還沒有就放一份範本
if (!existsSync(join(opt.root, 'README.md'))) copyFileSync(join(HERE, '..', 'references', 'her-readme.md'), join(opt.root, 'README.md'));
console.log(`\n打開這個檔：${resolve(out)}`);
