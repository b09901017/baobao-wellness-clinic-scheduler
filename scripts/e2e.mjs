// E2E 的入口。**分級**與**跨平台**兩件事都在這裡。
//
// 為什麼不直接在 package.json 裡寫 `HEADLESS=1 playwright test`：
// Windows 的 npm script 走 cmd.exe，那個前綴設不了環境變數（會直接
// 「'HEADLESS' 不是內部或外部命令」）。所以由 node 來 spawn。
//
//   node scripts/e2e.mjs                 全部，無頭
//   node scripts/e2e.mjs --related       只跑上一次全綠之後動過、而且跟 develop 不一樣的那幾支
//   node scripts/e2e.mjs --related --base develop   整條分支重驗一次（不看上一次全綠）
//   node scripts/e2e.mjs --smoke         只跑 00-smoke
//   node scripts/e2e.mjs --watch         headed + slowMo（要親眼看的時候）
//   node scripts/e2e.mjs 05 20           自己指定（Playwright 的檔名 filter）
//   node scripts/e2e.mjs --related --dry 只印出會跑哪幾支，不真的跑
//
// 「上一次全綠」怎麼記、為什麼可以只看那之後動過的，見 `scripts/e2e-changes.mjs` 的檔頭。
//
// **模擬器要先跑起來**（`npm run emulators`），這支不會幫你開。

import { spawn } from 'node:child_process';

import { pick } from '../tests-e2e/related.js';
import {
  changedFiles, combine, filesBetween, greenSide, mergeBase, readStamp, recordsGreen, repoRoot, snapshotTree,
  stampTime, withViewsNarrowed, writeStamp,
} from './e2e-changes.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f, fallback) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const WATCH = has('--watch');
const DRY = has('--dry');
const RELATED = has('--related');
const SMOKE = has('--smoke');
const EXPLICIT_BASE = has('--base') ? valueOf('--base', null) : null;
const BASE = EXPLICIT_BASE ?? 'develop';

/** 把 flag 與它們的值剝掉，剩下的當成 Playwright 的 filter。 */
const passthrough = (() => {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') { i += 1; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
})();

const ROOT = repoRoot();

const STAMPS = recordsGreen({ related: RELATED, smoke: SMOKE, named: passthrough });
// 現在的工作區，**跑之前**拍。跑到一半才改的檔案不算在這一次裡，下一次會被挑到。
const tree = STAMPS ? snapshotTree(ROOT) : null;

let filters = passthrough;

if (SMOKE) {
  filters = ['00-smoke'];
} else if (RELATED) {
  const { ref, files } = changedFiles(BASE, ROOT);
  if (ref !== BASE) console.log(`⚠  找不到 ${BASE}，改跟 ${ref} 比。`);
  // `views.js` 只多了一頁的登記 → 換成那一頁（`e2e-changes.mjs` 的 `narrowViews()`）
  const from = mergeBase(ref, ROOT);
  const base = pick(from ? withViewsNarrowed(files, ROOT, from) : files);

  const stamp = EXPLICIT_BASE ? null : readStamp(ROOT);
  const sinceGreen = stamp && tree ? filesBetween(ROOT, stamp.tree, tree) : null;
  const side = greenSide({ explicitBase: EXPLICIT_BASE, stamp, sinceGreen });
  const green = side.files ? pick(withViewsNarrowed(side.files, ROOT, stamp.tree, tree)) : null;
  const { specs, all, why } = combine(base, green);
  const { rules } = base;

  const count = (r) => (r.all ? '全部' : `${r.specs.length} 支`);
  console.log(`\n跟 ${ref} 相比動了 ${files.length} 個檔案 → ${count(base)}。`);
  if (green) {
    console.log(`上一次全綠（${stampTime(stamp.at)}）之後動了 ${side.files.length} 個檔案 → ${count(green)}。`);
    console.log('兩邊都要跑的才跑。');
  } else {
    console.log(`（${side.note}）`);
  }
  for (const line of why) console.log(`   ${line}`);

  if (all) {
    console.log('→ 全跑（共用底座或沒登記的檔案）。\n');
    filters = [];
  } else {
    console.log(`→ ${specs.length} 支：${specs.join('、')}\n`);
    filters = specs;
  }
  if (rules) {
    console.log('⚠  firestore.rules／storage.rules／indexes 動過了 —— 記得另外跑 `npm run test:rules`。\n');
  }
  if (!all && specs.length === 1) {
    console.log('（只有 00-smoke —— 這次的改動沒有 E2E 摸得到的東西。）\n');
  }
}

if (DRY) {
  console.log(`（--dry）不跑。會下的 filter：${filters.length ? filters.join(' ') : '(沒有 filter ＝ 全部)'}`);
  process.exit(0);
}

// `--forbid-only`：要記「全綠」的那一次，誰留了一個 `test.only` 就只跑了那一條 ——
// 綠的，而且記下來之後下一次就不會再跑其他的。讓它大聲地紅。
const args = ['playwright', 'test', '--project=phone', ...(STAMPS ? ['--forbid-only'] : []), ...filters];
const env = { ...process.env };
if (WATCH) delete env.HEADLESS; else env.HEADLESS = '1';

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
child.on('exit', (code) => {
  if (code === 0 && STAMPS && tree) {
    writeStamp(ROOT, { tree, at: new Date().toISOString(), ran: filters.length ? filters : 'all' });
    console.log('\n✓ 記下這一次全綠：下一次 --related 只看這之後動過的檔案。');
  }
  process.exit(code ?? 1);
});
