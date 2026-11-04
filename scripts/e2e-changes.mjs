// `--related` 要拿哪一份「動了哪些檔案」去挑 spec。`scripts/e2e.mjs` 用它。
//
// 以前只有一種：**跟 develop 比**（整條分支的差異；沒帶 `--base` 時是 GitHub 上那一份，見 `defaultBase()`）。一輪做到後段，那份差異
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
//   - 自己帶了 `--base`（要整條分支重驗一次：`--base origin/develop`）
//
// **記錄只在「每一支該跑的都跑了而且全綠」時寫**：`--related` 與不帶 filter 的全跑。
// 自己點名的（`node scripts/e2e.mjs 05 20`）與 `--smoke` 不寫 —— 它們沒跑到的那幾支
// 不知道是不是綠的。

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { CSS_SCOPES } from '../tests-e2e/related.js';

export const STAMP = '.artifacts/verify-green.json';
const MAPPING = 'tests-e2e/related.js';

/**
 * **`-c core.quotepath=false` 一定要帶。** 預設 git 會把非 ASCII 的路徑
 * 轉成 `"docs/\345\270\270..."` 那種八進位跳脫，而這個 repo 的 `docs/`
 * 底下幾乎都是中文檔名 —— 對不上任何一條規則，於是每次都退回全跑，
 * 而畫面上只會寫「沒有登記在 related.js」，看起來像對照表漏了。
 */
const git = (args, { cwd, env, timeout } = {}) => spawnSync(
  // maxBuffer：`git show` 整份 app.css（30 萬字元，預設的 1MB 再長一點就裝不下）
  'git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', cwd, env, timeout, maxBuffer: 64 * 1024 * 1024 },
);
const lines = (r) => (r.status === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : null);

export function repoRoot(cwd = process.cwd()) {
  const r = git(['rev-parse', '--show-toplevel'], { cwd });
  return r.status === 0 ? r.stdout.trim() : cwd;
}

/**
 * 沒帶 `--base` 時拿哪一份 develop 比。**不是本機的 `develop`**：`git fetch` 只移動 `origin/develop`，
 * 一直待在功能分支上的話本機那一份停在開分支那一格，每一次都拿整輪的差異在挑（lessons 十二）。
 * 先抓一次 GitHub 上的（限時、不問帳密 —— 抓不到不擋，照用手上那一份），有 `origin/develop` 就比它，
 * 連它都沒有才退回本機的 `develop`。`fetched` 給畫面講「這一份是不是剛抓的」。
 */
export function defaultBase(root, { timeoutMs = 8000 } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const fetch = git(['fetch', '-q', 'origin', 'develop'], { cwd: root, env, timeout: timeoutMs });
  const remote = git(['rev-parse', '--verify', '--quiet', 'origin/develop'], { cwd: root });
  if (remote.status === 0) return { ref: 'origin/develop', fetched: fetch.status === 0 };
  return { ref: 'develop', fetched: false };
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

// ---------------------------------------------------------------------------
// `app.css` 只動到某一個元件的那幾組 class
// ---------------------------------------------------------------------------
//
// 整份 `app.css` 有二十幾支 spec 看它（2026-11-03 拍 Abovee 那一輪只改確認層的樣子，verify 挑到 21 支）。
// 這一層比新舊兩份，**每一條動到的規則**都只指著 `related.js` 的 `CSS_SCOPES` 裡的某一組 class，
// 就把 `app.css` 換成 `app.css#那一組`（`pick()` 再挑整份的名單 ∩ 摸得到那個元件的）。
//
// 比的是**規則**不是 diff 的行：一行 `  gap: 0;` 看不出是哪一條規則的，註解記號拿掉一對
// 也會讓一條規則活過來而 diff 上只有那兩行。所以兩份各拆成一串「規則」（外層的 @media 等、
// 選擇器、去掉註解與多餘空白的內容），照先後比 —— 多了、少了、**搬了位置**（同樣權重後面的贏）
// 都算動到。
//
// 一條動到的規則要算「那一組的」：選擇器用逗號分開的**每一段**，在括號、中括號外面都要有一個
// 那一組的 class（`.abl-row .btn` 算；`.abl__x, .btn`、`body:has(.abl) .toast` 不算）。
// 其餘一律 null（照舊整份）：`@keyframes`、`@import` 那種、巢狀的規則、沒收尾的註解或大括號。

export const APP_CSS = 'public/css/app.css';

/** 會把裡面的規則一條一條往下拆的 at-rule；其餘（`@keyframes`、`@font-face`…）整塊當一條。 */
const CSS_GROUPS = /^@(media|supports|container|layer)\b/i;

const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** 從字串的開頭引號算到收尾引號的下一格。 */
const afterString = (text, i) => {
  const q = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== q) j += text[j] === '\\' ? 2 : 1;
  return j + 1;
};

/** 註解換成一個空白（字串裡的 `/*` 不算）。沒有收尾的註解回 null。 */
const withoutComments = (src) => {
  let out = '';
  let from = 0;
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '"' || c === "'") { i = afterString(src, i); continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return null;
      out += `${src.slice(from, i)} `;
      i = end + 2;
      from = i;
      continue;
    }
    i += 1;
  }
  return out + src.slice(from);
};

/** 從 `{` 的下一格算到對應的 `}` 的下一格；對不上回 -1。 */
const afterBlock = (text, i) => {
  let depth = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { i = afterString(text, i); continue; }
    i += 1;
    if (c === '{') depth += 1;
    else if (c === '}' && (depth -= 1) === 0) return i;
  }
  return -1;
};

/**
 * 一份 CSS 拆成照先後的一串規則：`{ kind: 'rule'|'at'|'stmt', chain, prelude, body }`。
 * 拆不開（大括號對不上、註解沒收尾）回 null。
 */
export function cssRules(src) {
  const text = withoutComments(String(src).replace(/\r\n/g, '\n'));
  if (text == null) return null;
  const items = [];
  let i = 0;
  const stmt = (chain, from, to) => {
    const s = squash(text.slice(from, to));
    if (s) items.push({ kind: 'stmt', chain, prelude: s, body: '' });
  };
  // 回 'close'（碰到這一層的 `}`）、'eof'、或 null（壞掉）
  const group = (chain) => {
    let from = i;
    while (i < text.length) {
      const c = text[i];
      if (c === '"' || c === "'") { i = afterString(text, i); continue; }
      if (c === ';') { stmt(chain, from, i); i += 1; from = i; continue; }
      if (c === '}') { stmt(chain, from, i); i += 1; return 'close'; }
      if (c !== '{') { i += 1; continue; }
      const prelude = squash(text.slice(from, i));
      i += 1;
      if (CSS_GROUPS.test(prelude)) {
        if (group([...chain, prelude]) !== 'close') return null;
      } else {
        const start = i;
        i = afterBlock(text, i);
        if (i < 0) return null;
        const kind = prelude.startsWith('@') ? 'at' : 'rule';
        items.push({ kind, chain, prelude, body: squash(text.slice(start, i - 1)) });
      }
      from = i;
    }
    stmt(chain, from, i);
    return 'eof';
  };
  return group([]) === 'eof' ? items : null;
}

const ruleKey = (r) => `${r.chain.join(' » ')} » ${r.kind} ${r.prelude} {${r.body}}`;

/** 兩串規則照先後比，回兩邊對不上的那幾條（舊的少掉的＋新的多出來的）。 */
function changedRules(a, b) {
  const ka = a.map(ruleKey);
  const kb = b.map(ruleKey);
  let head = 0;
  while (head < ka.length && head < kb.length && ka[head] === kb[head]) head += 1;
  let tail = 0;
  while (tail < ka.length - head && tail < kb.length - head
    && ka[ka.length - 1 - tail] === kb[kb.length - 1 - tail]) tail += 1;
  const x = ka.slice(head, ka.length - tail);
  const y = kb.slice(head, kb.length - tail);
  const xs = a.slice(head, a.length - tail);
  const ys = b.slice(head, b.length - tail);
  const n = x.length;
  const m = y.length;
  // 中間那一段太大就不配對了：全部當成動到（多檢查幾條只會更容易退回整份）
  if ((n + 1) * (m + 1) > 4e7) return [...xs, ...ys];
  // 最長共同子序列：配得上的就是沒動的
  const w = m + 1;
  const len = new Uint32Array((n + 1) * w);
  for (let p = n - 1; p >= 0; p -= 1) {
    for (let q = m - 1; q >= 0; q -= 1) {
      len[p * w + q] = x[p] === y[q] ? len[(p + 1) * w + q + 1] + 1
        : Math.max(len[(p + 1) * w + q], len[p * w + q + 1]);
    }
  }
  const out = [];
  let p = 0;
  let q = 0;
  while (p < n && q < m) {
    if (x[p] === y[q]) { p += 1; q += 1; } else if (len[(p + 1) * w + q] >= len[p * w + q + 1]) out.push(xs[p++]);
    else out.push(ys[q++]);
  }
  return [...out, ...xs.slice(p), ...ys.slice(q)];
}

/** 括號、中括號裡面的換成空白（`:has(.abl)`、`[class*=abl]` 不算指著它）。 */
const outsideBrackets = (sel) => {
  let depth = 0;
  let out = '';
  for (const c of sel) {
    if (c === '(' || c === '[') depth += 1;
    if (depth === 0) out += c;
    if ((c === ')' || c === ']') && depth > 0) depth -= 1;
  }
  return out;
};

/** 用括號外的逗號切開一串選擇器。 */
const selectorList = (prelude) => {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < prelude.length; i += 1) {
    const c = prelude[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) { out.push(prelude.slice(from, i)); from = i + 1; }
  }
  return [...out, prelude.slice(from)];
};

const scopeOfClass = (cls, scopes) => Object.entries(scopes).find(([, { classes }]) => classes
  .some((c) => cls === c || cls.startsWith(`${c}-`) || cls.startsWith(`${c}_`)))?.[0] ?? null;

/** 一條規則屬於哪幾組；不屬於任何一組（或看不懂）回 null。 */
function scopesOfRule(rule, scopes) {
  if (rule.kind !== 'rule' || rule.body.includes('{')) return null;
  const found = new Set();
  for (const sel of selectorList(rule.prelude)) {
    const mine = [...outsideBrackets(sel).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)]
      .map((m) => scopeOfClass(m[1], scopes)).filter(Boolean);
    if (!mine.length) return null;
    for (const s of mine) found.add(s);
  }
  return [...found];
}

/**
 * @param {string} before 改之前的 `app.css`
 * @param {string} after 現在的 `app.css`
 * @param {Record<string, { classes: string[] }>} [scopes] 預設是 `related.js` 的 `CSS_SCOPES`
 * @returns {string[] | null} 動到的那幾組（空的＝只動了註解或空白）；null ＝ 認不出來，照舊整份
 */
export function narrowCss(before, after, scopes = CSS_SCOPES) {
  const a = cssRules(before);
  const b = cssRules(after);
  if (!a || !b) return null;
  const found = new Set();
  for (const rule of changedRules(a, b)) {
    const mine = scopesOfRule(rule, scopes);
    if (!mine) return null;
    for (const s of mine) found.add(s);
  }
  return [...found].sort();
}

/**
 * 交給 `pick()` 之前：`files` 裡有 `app.css`、而且從 `from` 到現在只動到某幾組 → 換成 `app.css#那一組`。
 * `from` 是 tree 或 commit；`to` 省略＝工作區。git 讀不到就原樣回（照舊整份）。
 */
export function withCssNarrowed(files, root, from, to = null) {
  if (!files?.includes(APP_CSS)) return files;
  const before = git(['show', `${from}:${APP_CSS}`], { cwd: root });
  if (before.status !== 0) return files;
  let after;
  if (to) {
    const r = git(['show', `${to}:${APP_CSS}`], { cwd: root });
    if (r.status !== 0) return files;
    after = r.stdout;
  } else {
    try {
      after = readFileSync(join(root, APP_CSS), 'utf8');
    } catch {
      return files;
    }
  }
  const scopes = narrowCss(before.stdout, after);
  if (!scopes) return files;
  return [...files.filter((f) => f !== APP_CSS), ...scopes.map((s) => `${APP_CSS}#${s}`)];
}

/** 兩種縮小都套上（`views.js` 只多了登記、`app.css` 只動到某幾組）。 */
export const withNarrowed = (files, root, from, to = null) => withCssNarrowed(
  withViewsNarrowed(files, root, from, to), root, from, to,
);

/** `changedFiles()` 比的那一邊從哪裡開始（`ref...HEAD` 的 merge-base）。 */
export function mergeBase(ref, root) {
  const r = git(['merge-base', ref, 'HEAD'], { cwd: root });
  return r.status === 0 ? r.stdout.trim() : null;
}
