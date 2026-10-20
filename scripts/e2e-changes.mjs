// `--related` 要拿哪一份「動了哪些檔案」去挑 spec。`scripts/e2e.mjs` 用它。
//
// 以前只有一種：**跟 develop 比**（整條分支的差異）。一輪做到後段，那份差異
// 幾乎碰遍了壓表、日曆、來訪編輯器、`visits.js` —— 2026-10-16 拿最近 14 輪的 merge
// 重播，收尾時選到的是 50～69／69 支，等於每一次 verify 都在全跑（本機半小時以上）。
//
// 現在多一種：**跟上一次全綠比**。全綠的那一刻把整個工作區（含還沒 commit、
// 還沒 add 的）寫成一個 git tree，記在 `.artifacts/verify-green.json`；下一次
// 拿現在的工作區跟那個 tree 比，只看那之後動過的檔案。
//
// **兩邊都算，取交集。** 一支 spec 可以不跑，只要它摸得到的檔案（照 `related.js`）
// 跟 develop 一樣 —— 靠的是「develop 是綠的」，一直以來的前提 —— 或跟上一次全綠
// 一樣 —— 靠的是「那一次真的是綠的」。哪一邊成立它都還是綠的，所以兩邊都說要跑
// 的才跑。為什麼那一次「真的是綠的」：第一次沒有紀錄，照 develop 比（跟以前一模一樣）；
// 之後每一次全綠，「摸得到的檔案在上一次全綠之後動過」的每一支都剛跑過，
// 其餘的跟上一次全綠時一個字都沒變。
//
// 退回只看 develop 的三種情況（畫面上都會講）：
//   - 沒有紀錄、或那個 tree 已經被 `git gc` 收掉了（沒被參照的物件兩週後才收）
//   - `tests-e2e/related.js` 在上一次全綠之後改過 —— 對照表改了，就代表上一次
//     「這一支摸不到那個檔案」的判斷可能不準
//   - 自己帶了 `--base`（要整條分支重驗一次：`--base develop`）
//
// **記錄只在「每一支該跑的都跑了而且全綠」時寫**：`--related` 與不帶 filter 的全跑。
// 自己點名的（`node scripts/e2e.mjs 05 20`）與 `--smoke` 不寫 —— 它們沒跑到的那幾支
// 不知道是不是綠的。

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const STAMP = '.artifacts/verify-green.json';
const MAPPING = 'tests-e2e/related.js';

/**
 * **`-c core.quotepath=false` 一定要帶。** 預設 git 會把非 ASCII 的路徑
 * 轉成 `"docs/\345\270\270..."` 那種八進位跳脫，而這個 repo 的 `docs/`
 * 底下幾乎都是中文檔名 —— 對不上任何一條規則，於是每次都退回全跑，
 * 而畫面上只會寫「沒有登記在 related.js」，看起來像對照表漏了。
 */
const git = (args, { cwd, env } = {}) => spawnSync(
  'git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', cwd, env },
);
const lines = (r) => (r.status === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : null);

export function repoRoot(cwd = process.cwd()) {
  const r = git(['rev-parse', '--show-toplevel'], { cwd });
  return r.status === 0 ? r.stdout.trim() : cwd;
}

/**
 * 跟 base 比出來的變更檔案清單。base 不存在時退回「跟上一個 commit 比」。
 * 已 commit 的 + 還沒 commit 的（工作區）+ 還沒 add 的都算 —— 只看 commit 的話
 * 剛改完還沒 commit 的那幾個檔案不會被挑到，而那正是日常最常見的狀態。
 */
export function changedFiles(base, cwd) {
  const known = git(['rev-parse', '--verify', '--quiet', base], { cwd });
  const ref = known.status === 0 ? base : 'HEAD~1';
  const committed = lines(git(['diff', '--name-only', `${ref}...HEAD`], { cwd })) ?? [];
  const working = lines(git(['diff', '--name-only', 'HEAD'], { cwd })) ?? [];
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard'], { cwd })) ?? [];
  return { ref, files: [...new Set([...committed, ...working, ...untracked])] };
}

/**
 * 整個工作區現在的樣子（含還沒 commit、還沒 add 的；`.gitignore` 擋掉的不算）
 * 寫成一個 tree，回它的 sha。寫不出來回 null。
 *
 * **不碰真的 index。** 抄一份到暫存檔、`GIT_INDEX_FILE` 指過去才 `add -A` ——
 * 她 stage 好的東西一個都不能被這一步改掉。抄而不是從空的開始，是為了沿用
 * 裡面的 stat 快取：沒動過的檔案不用重新 hash。
 */
export function snapshotTree(root) {
  const where = git(['rev-parse', '--git-path', 'index'], { cwd: root });
  if (where.status !== 0) return null;
  const index = resolve(root, where.stdout.trim());
  const dir = mkdtempSync(join(tmpdir(), 'e2e-snapshot-'));
  try {
    const tmpIndex = join(dir, 'index');
    if (existsSync(index)) copyFileSync(index, tmpIndex);
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    if (git(['add', '-A'], { cwd: root, env }).status !== 0) return null;
    const tree = git(['write-tree'], { cwd: root, env });
    return tree.status === 0 ? tree.stdout.trim() : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 兩個 tree 之間動過的檔案。`from` 已經不在了（被 gc 收掉）回 null。
 * `--no-renames`：搬家的檔案新舊兩個路徑都要算，不然搬走的那一邊沒人看。
 */
export function filesBetween(root, from, to) {
  if (git(['cat-file', '-e', `${from}^{tree}`], { cwd: root }).status !== 0) return null;
  return lines(git(['diff', '--name-only', '--no-renames', from, to], { cwd: root }));
}

/**
 * 這一次跑完全綠要不要記下來。**只有每一支該跑的都會跑的那兩種**：`--related`、
 * 什麼都沒點名的全跑。點名的（`05 20`）與 `--smoke` 沒跑到的那幾支不知道是不是綠的 ——
 * 記下來的話，下一次 `--related` 會以為它們都過了。
 */
export function recordsGreen({ related, smoke, named }) {
  if (related) return true;
  return !smoke && named.length === 0;
}

export function readStamp(root) {
  try {
    const s = JSON.parse(readFileSync(join(root, STAMP), 'utf8'));
    return typeof s?.tree === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function writeStamp(root, stamp) {
  mkdirSync(join(root, '.artifacts'), { recursive: true });
  writeFileSync(join(root, STAMP), `${JSON.stringify(stamp, null, 2)}\n`);
}

/**
 * 「上一次全綠之後動了什麼」這一邊能不能用。
 * @returns {{ files: string[] | null, note: string | null }} `files` 是 null 就只看 develop，`note` 講為什麼
 */
export function greenSide({ explicitBase, stamp, sinceGreen }) {
  if (explicitBase) return { files: null, note: `帶了 --base，只跟 ${explicitBase} 比。` };
  if (!stamp) return { files: null, note: '還沒有上一次全綠的紀錄，只跟 develop 比。' };
  if (!sinceGreen) {
    return { files: null, note: '上一次全綠的紀錄比不起來（git 收掉了那個 tree，或這一次拍不到工作區），只跟 develop 比。' };
  }
  if (sinceGreen.includes(MAPPING)) {
    return { files: null, note: 'related.js 在上一次全綠之後改過，這一次只跟 develop 比。' };
  }
  return { files: sinceGreen, note: null };
}

/**
 * 兩邊各自 `pick()` 出來的結果取交集（見檔頭為什麼可以）。
 * `all` 的那一邊等於「每一支」，所以交集就是另一邊。
 *
 * @param {ReturnType<import('../tests-e2e/related.js').pick>} base 跟 develop 比
 * @param {ReturnType<import('../tests-e2e/related.js').pick> | null} green 跟上一次全綠比；null ＝ 不能用
 */
export function combine(base, green) {
  if (!green) return { specs: base.specs, all: base.all, why: base.why };
  if (base.all && green.all) return { specs: [], all: true, why: green.why };
  if (base.all) return { specs: green.specs, all: false, why: [] };
  if (green.all) return { specs: base.specs, all: false, why: [] };
  const keep = new Set(green.specs);
  return { specs: base.specs.filter((s) => keep.has(s)), all: false, why: [] };
}

/** 給畫面看的時間（台北時間，`10/16 14:05`）。 */
export function stampTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

// ---------------------------------------------------------------------------
// `ui/views.js` 只多了一頁的登記
// ---------------------------------------------------------------------------
//
// 它是共用底座（`related.js` 的 GLOBAL），改一個字就全跑。但一輪裡新增一頁只是多一行
// import、一兩條 `register()`（staging-polish 中途發現「段二 2」：段二之後每一段的 verify 都全跑）。
// `pick()` 只拿得到檔名，所以這一層在交給它之前**看 diff**，認得出來就把 `views.js` 換成那幾頁。
//
// 認得的只有一種形狀：**一行都沒刪**，加的每一行是空白、註解、`import * as X from './views/Y.js'`、
// 或一條完整的 `register('…', { … });`（裡面點到的名字都要是 views 底下的 import）。
// 其餘一律 null（照舊全跑）—— 寧可多跑、不可安靜地少跑。
//
// 新的網址撞得到既有的哪一條（`router.js` 照登記的順序比、先比到的贏），那一條的頁面也算進去：
// `/customers/notes` 會搶走 id 剛好是 notes 的客戶詳情 —— 要跑的是客戶詳情那幾支。

export const VIEWS = 'public/js/ui/views.js';

const IMPORT_RE = /^\s*import \* as (\w+) from '\.\/views\/(\w+)\.js';\s*/;
const REGISTER_RE = /^\s*register\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\}\s*\);\s*/;

/** `import * as X from './views/Y.js'` → X → 檔案。 */
const viewImports = (src) => new Map(
  [...src.matchAll(/^import \* as (\w+) from '\.\/views\/(\w+)\.js';/gm)]
    .map(([, name, file]) => [name, `public/js/ui/views/${file}.js`]),
);

/** 一段 `{ … }` 裡點到的名字（`longNotes.render` → longNotes）。 */
const dotted = (body) => [...new Set([...body.matchAll(/\b([A-Za-z_]\w*)\.\w+/g)].map((m) => m[1]))];

/** 兩條網址有沒有同一個路徑兩條都比得上。 */
const overlaps = (a, b) => {
  const x = a.split('/').filter(Boolean);
  const y = b.split('/').filter(Boolean);
  return x.length === y.length
    && x.every((s, i) => s === y[i] || s.startsWith(':') || y[i].startsWith(':'));
};

/**
 * @param {string} diff `git diff -U0` 在 `views.js` 上的結果（空字串＝沒動）
 * @param {string} source 現在的 `views.js`
 * @returns {string[] | null} 換成這幾個檔案；null ＝ 認不出來，照舊當成 `views.js` 動了
 */
export function narrowViews(diff, source) {
  const added = [];
  for (const line of String(diff ?? '').split('\n')) {
    // `\ No newline at end of file` 那一行也略過
    if (/^(diff |index |--- |\+\+\+ |@@|\\)/.test(line) || line === '') continue;
    if (line.startsWith('-')) return null;
    if (line.startsWith('+')) added.push(line.slice(1));
    else return null; // -U0 不會有上下文行；有的話是別的形狀，不猜
  }
  let code = added.filter((l) => l.trim() && !l.trim().startsWith('//')).join('\n');

  const imports = viewImports(source);
  const files = new Set();
  const newPaths = [];
  while (code.trim()) {
    const imp = code.match(IMPORT_RE);
    if (imp) {
      files.add(`public/js/ui/views/${imp[2]}.js`);
      code = code.slice(imp[0].length);
      continue;
    }
    const reg = code.match(REGISTER_RE);
    // 物件裡只准是屬性：有 `;` 或 `{` 就是一段程式，不猜它做了什麼
    if (!reg || /[;{]/.test(reg[2])) return null;
    for (const name of dotted(reg[2])) {
      if (!imports.has(name)) return null;
      files.add(imports.get(name));
    }
    newPaths.push(reg[1]);
    code = code.slice(reg[0].length);
  }

  // 既有的那幾條：誰撞得到新的
  const fresh = new Set(newPaths);
  for (const [, path, body] of source.matchAll(/^register\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\}\s*\);/gm)) {
    if (fresh.has(path)) { fresh.delete(path); continue; } // 新的那一條自己（同一條只略過一次）
    if (!newPaths.some((p) => overlaps(p, path))) continue;
    const mine = dotted(body).filter((n) => imports.has(n));
    if (!mine.length) return null; // 撞到一條看不出是哪一頁的 → 不猜
    for (const n of mine) files.add(imports.get(n));
  }
  return [...files].sort();
}

/**
 * 交給 `pick()` 之前：`files` 裡有 `views.js`、而且從 `from` 到現在只多了登記 → 換成那幾頁。
 * `from` 是 tree 或 commit；`to` 省略＝工作區。git 讀不到就原樣回（照舊全跑）。
 */
export function withViewsNarrowed(files, root, from, to = null) {
  if (!files?.includes(VIEWS)) return files;
  const args = ['diff', '-U0', '--no-renames', from, ...(to ? [to] : []), '--', VIEWS];
  const r = git(args, { cwd: root });
  if (r.status !== 0) return files;
  let source;
  try {
    source = readFileSync(join(root, VIEWS), 'utf8');
  } catch {
    return files;
  }
  const narrowed = narrowViews(r.stdout, source);
  if (!narrowed) return files;
  return [...new Set([...files.filter((f) => f !== VIEWS), ...narrowed])];
}

/** `changedFiles()` 比的那一邊從哪裡開始（`ref...HEAD` 的 merge-base）。 */
export function mergeBase(ref, root) {
  const r = git(['merge-base', ref, 'HEAD'], { cwd: root });
  return r.status === 0 ? r.stdout.trim() : null;
}
