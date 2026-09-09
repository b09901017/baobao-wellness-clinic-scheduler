// E2E 的入口。**分級**與**跨平台**兩件事都在這裡。
//
// 為什麼不直接在 package.json 裡寫 `HEADLESS=1 playwright test`：
// Windows 的 npm script 走 cmd.exe，那個前綴設不了環境變數（會直接
// 「'HEADLESS' 不是內部或外部命令」）。所以由 node 來 spawn。
//
//   node scripts/e2e.mjs                 全部，無頭
//   node scripts/e2e.mjs --related       只跑跟 develop 的差異相關的那幾支
//   node scripts/e2e.mjs --related --base HEAD~1
//   node scripts/e2e.mjs --smoke         只跑 00-smoke
//   node scripts/e2e.mjs --watch         headed + slowMo（要親眼看的時候）
//   node scripts/e2e.mjs 05 20           自己指定（Playwright 的檔名 filter）
//   node scripts/e2e.mjs --related --dry 只印出會跑哪幾支，不真的跑
//
// **模擬器要先跑起來**（`npm run emulators`），這支不會幫你開。

import { spawn, spawnSync } from 'node:child_process';

import { pick } from '../tests-e2e/related.js';

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
const BASE = valueOf('--base', 'develop');

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

/** 跟 base 比出來的變更檔案清單。base 不存在時退回「跟上一個 commit 比」。 */
function changedFiles(base) {
  // **`-c core.quotepath=false` 一定要帶。** 預設 git 會把非 ASCII 的路徑
  // 轉成 `"docs/\345\270\270..."` 那種八進位跳脫，而這個 repo 的 `docs/`
  // 底下幾乎都是中文檔名 —— 對不上任何一條規則，於是每次都退回全跑，
  // 而畫面上只會寫「沒有登記在 related.js」，看起來像對照表漏了。
  const tryDiff = (args) => {
    const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
  };
  const known = spawnSync('git', ['rev-parse', '--verify', '--quiet', base], { encoding: 'utf8' });
  const ref = known.status === 0 ? base : 'HEAD~1';
  if (ref !== base) {
    console.log(`⚠  找不到 ${base}，改跟 ${ref} 比。`);
  }
  // 已 commit 的 + 還沒 commit 的（工作區）都算 —— 只看 commit 的話
  // 剛改完還沒 commit 的那幾個檔案不會被挑到，而那正是日常最常見的狀態。
  const committed = tryDiff(['diff', '--name-only', `${ref}...HEAD`]) ?? [];
  const working = tryDiff(['diff', '--name-only', 'HEAD']) ?? [];
  const untracked = tryDiff(['ls-files', '--others', '--exclude-standard']) ?? [];
  return [...new Set([...committed, ...working, ...untracked])];
}

let filters = passthrough;

if (SMOKE) {
  filters = ['00-smoke'];
} else if (RELATED) {
  const files = changedFiles(BASE);
  const { specs, all, rules, why } = pick(files);

  console.log(`\n跟 ${BASE} 相比動了 ${files.length} 個檔案。`);
  for (const line of why) console.log(`   ${line}`);

  if (all) {
    console.log('→ 全跑（共用底座或沒登記的檔案）。\n');
    filters = [];
  } else {
    console.log(`→ ${specs.length} 支：${specs.join('、')}\n`);
    filters = specs;
  }
  if (rules) {
    console.log('⚠  firestore.rules／indexes 動過了 —— 記得另外跑 `npm run test:rules`。\n');
  }
  if (!all && specs.length === 1) {
    console.log('（只有 00-smoke —— 這次的改動沒有 E2E 摸得到的東西。）\n');
  }
}

if (DRY) {
  console.log(`（--dry）不跑。會下的 filter：${filters.length ? filters.join(' ') : '(沒有 filter ＝ 全部)'}`);
  process.exit(0);
}

const args = ['playwright', 'test', '--project=phone', ...filters];
const env = { ...process.env };
if (WATCH) delete env.HEADLESS; else env.HEADLESS = '1';

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 1));
