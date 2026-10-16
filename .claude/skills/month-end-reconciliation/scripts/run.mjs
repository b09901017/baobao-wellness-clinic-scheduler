#!/usr/bin/env node
// 抄完字之後的整條流程，一個指令：快照 → 合成 → 候選字 → 逐像素 → 再合成 → 比對 → 那一頁。
//
//   node run.mjs --month 2026-10 [--project prod|staging|<id>] [--today YYYY-MM-DD] [--root <月底對帳資料夾>]
//                [--from YYYY-MM-DD --to YYYY-MM-DD]   只截了月中一段、截圖上又沒拍到「預約日期(起)／(訖)」時給
//                [--complete yes]   截圖上沒拍到「共 N 筆」、但她說第一張是第一頁、最後一張是最後一頁
//                                   （沒給的話只信第一列到最後一列之間，頭尾那兩天不算次數）
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node run.mjs --month 2026-10 --project demo-scheduler-w5   # 對模擬器
//
// 前提：`<root>/<月>/過程/抄字/*.tsv` 已經抄好（SKILL.md 第 2 步，subagent 做）。每一步的結果都是一個檔，
// 哪一步斷了修好再跑一次就好（快照每次重拍 —— 要的是現在的 app）。逐像素的校正存在 `<root>/校正/`，
// 對不上這一批截圖（縮放換了）會自己重新校正一次。
// 終端機只印數字與檔名；有真名的東西只寫在 `<root>`（.local/ 底下）。
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
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
const pv = ['--shots', shots, '--abovee', join(P, 'abovee-抄的.json'), '--work', join(P, 'pxx'), '--shared', shared];
let rc = py(['verify', ...pv, '--vocab', join(P, '候選字.json'), '--out', join(P, '逐像素.json')]);
if (rc === 3) {
  step('3/6 校正不合這一批截圖 → 重新校正一次');
  if (py(['calibrate', ...pv]) !== 0) process.exit(1);
  rc = py(['verify', ...pv, '--vocab', join(P, '候選字.json'), '--out', join(P, '逐像素.json')]);
}
if (rc !== 0) process.exit(rc);

step('4/6 套上逐像素的結果');
node('assemble.mjs', [tsv, '--month', M, '--out', join(P, 'abovee.json'), '--verify', join(P, '逐像素.json'), ...range]);

step('5/6 比對');
node('reconcile.mjs', ['--abovee', join(P, 'abovee.json'), '--snapshot', join(P, 'app-快照.json'), '--month', M,
  '--out', join(P, '比對.json'), ...(opt.today ? ['--today', opt.today] : [])]);

step('6/6 那一頁');
const out = join(D, '結果', `對帳結果-${M}.html`);
node('report.mjs', [join(P, '比對.json'), out]);
node('look.mjs', [out, join(P, '看一眼')]);
// 她看的說明：資料夾裡還沒有就放一份範本
if (!existsSync(join(opt.root, 'README.md'))) copyFileSync(join(HERE, '..', 'references', 'her-readme.md'), join(opt.root, 'README.md'));
console.log(`\n打開這個檔：${resolve(out)}`);
