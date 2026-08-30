// 名字守衛：用了但沒有這個名字的東西，要在這裡紅掉。
//
// 2026-08-25 同一天出現兩個一模一樣的 bug：`schedule.js` 的小日曆用 `WD`、
// `health.js` 用 `rememberRun()`，而那兩個名字在前一輪各自被刪掉了 ——
// 一個把「不能的時間」搬進 `components/ban.js`，一個照 ADR-0049 拿掉背景掃描。
// 呼叫端留在原地，938 個測試全綠，她點進去才看到「WD is not defined」。
//
// 沒有紅掉是因為**整個測試套件不曾載入任何一支 UI 檔案**：domain 是純函式測得動，
// 而 views 要 DOM 與 firebase。這一支不執行任何程式碼，只讀原始碼問兩件事：
//
// 1. 這個名字有沒有在這一支檔案裡宣告過、或 import 進來過？
// 2. import 進來的名字，對面那一支真的有 export 嗎？
//
// 兩個都是「開了才知道」的錯：第一種在事件處理器裡是靜悄悄的（畫面停在半路，
// 主控台才有紅字），第二種整支模組載不進來，畫面直接空白。
//
// ## 它刻意寧可漏抓也不要誤報
//
// 這不是一個 JS 剖析器（專案刻意沒有相依套件）。宣告那一側抓得很寬 ——
// 只要一個名字**看起來像**在某處被綁定，就當它有宣告。代價是漏掉一些真的錯，
// 換來的是不會有人為了消掉假警報而把這支測試關掉。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';

const JS_ROOT = fromRoot('public/js/');

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

// ---------- 把註解與字串挖空 ----------

const REGEX_KEYWORD = /\b(return|typeof|instanceof|case|in|of|do|else|yield|await|new|delete|void|throw)$/;

/**
 * 註解、字串、正規表示式一律換成空白（換行留著，行號才對得上），
 * **但樣板字串的 `${}` 裡面照抄** —— 這裡的 HTML 是拼出來的，
 * 該檢查的名字有一大半住在那裡面（`WD` 就是）。
 */
function stripLiterals(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  // 巢狀狀態。'tmpl' = 在樣板字串的字面段裡；數字 = 在 ${} 裡面，值是還沒關的 { 有幾層
  const stack = [];
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) out += src[k] === '\n' ? '\n' : ' ';
  };

  while (i < n) {
    if (stack[stack.length - 1] === 'tmpl') {
      if (src[i] === '\\') { blank(i, i + 2); i += 2; continue; }
      if (src.slice(i, i + 2) === '${') { stack.push(0); blank(i, i + 2); i += 2; continue; }
      if (src[i] === '`') { stack.pop(); blank(i, i + 1); i += 1; continue; }
      blank(i, i + 1);
      i += 1;
      continue;
    }

    const c = src[i];
    const two = src.slice(i, i + 2);

    if (two === '//') {
      let j = i;
      while (j < n && src[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      blank(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (c === '`') { stack.push('tmpl'); blank(i, i + 1); i += 1; continue; }

    // `/` 是除號還是正規表示式，看前一個有意義的字元（`return /re/` 要算正規表示式）
    if (c === '/') {
      const before = out.replace(/\s+$/, '');
      const prev = before.slice(-1);
      if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev) || REGEX_KEYWORD.test(before)) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n) {
          const ch = src[j];
          if (ch === '\\') { j += 2; continue; }
          if (ch === '\n') break;
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) { closed = true; break; }
          j += 1;
        }
        if (closed) {
          let k = j + 1;
          while (k < n && /[a-z]/.test(src[k])) k += 1; // 後面的 gimsuy
          blank(i, k);
          i = k;
          continue;
        }
      }
    }

    if (c === '{' && typeof stack[stack.length - 1] === 'number') stack[stack.length - 1] += 1;
    else if (c === '}' && typeof stack[stack.length - 1] === 'number') {
      if (stack[stack.length - 1] === 0) { stack.pop(); blank(i, i + 1); i += 1; continue; }
      stack[stack.length - 1] -= 1;
    }

    out += c;
    i += 1;
  }
  return out;
}

// ---------- 誰是宣告、誰是使用 ----------

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const identsIn = (text) => text.match(IDENT) ?? [];

const KEYWORDS = new Set(`await break case catch class const continue debugger default delete do else
enum export extends false finally for function if implements import in instanceof interface let new null
of package private protected public return static super switch this throw true try typeof undefined var
void while with yield async get set from as arguments NaN Infinity globalThis`.split(/\s+/));

// 瀏覽器與 service worker 的全域。Node 的內建全域（Object、JSON、Promise…）
// 直接跟 globalThis 要，不必手寫一份會過期的清單。
const BROWSER_GLOBALS = new Set(`document window navigator location history localStorage sessionStorage
alert confirm prompt fetch Headers Request Response FormData Blob File FileReader URL URLSearchParams
setTimeout clearTimeout setInterval clearInterval queueMicrotask requestAnimationFrame cancelAnimationFrame
getComputedStyle matchMedia DOMParser XMLHttpRequest AbortController Event CustomEvent EventTarget
Node Element HTMLElement HTMLInputElement Image Audio Option Text CSS
IntersectionObserver ResizeObserver MutationObserver PerformanceObserver performance
caches indexedDB crypto self structuredClone reportError atob btoa TextEncoder TextDecoder
clients skipWaiting registration importScripts`.split(/\s+/));

const NODE_GLOBALS = new Set(
  Object.getOwnPropertyNames(globalThis).filter((name) => /^[A-Za-z_$]/.test(name)),
);

/** 從 `open` 那一格起的一段平衡括號（含首尾）。 */
function balanced(code, start, open, close) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === open) depth += 1;
    else if (code[i] === close) {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return '';
}

/**
 * 這一支檔案裡「像是被綁定過」的名字。**刻意抓得寬**（見檔頭）：
 * 解構的鍵、物件的方法名這種其實不是繫結的東西也收進來，
 * 收進來只會少報，不會誤報。
 */
function boundNames(code) {
  const bound = new Set();
  const add = (names) => names.forEach((name) => { if (!KEYWORDS.has(name)) bound.add(name); });

  for (const m of code.matchAll(/\bimport\s+([^;]*?)\s+from\b/g)) add(identsIn(m[1]));

  for (const m of code.matchAll(/\b(?:const|let|var)\s+/g)) {
    const at = m.index + m[0].length;
    if (code[at] === '{') add(identsIn(balanced(code, at, '{', '}')));
    else if (code[at] === '[') add(identsIn(balanced(code, at, '[', ']')));
    else {
      const name = code.slice(at).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
      if (name) add([name[0]]);
    }
  }

  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\(/g)) {
    if (m[1]) add([m[1]]);
    add(identsIn(balanced(code, code.indexOf('(', m.index), '(', ')')));
  }
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) add([m[1]]);
  for (const m of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) add(identsIn(m[1]));

  // 物件與類別的簡寫方法 `foo(a, b) {`：名字是屬性、參數是繫結，兩邊都不是「用到別人」
  for (const m of code.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^()]*)\)\s*\{/g)) {
    if (!KEYWORDS.has(m[1])) add([m[1], ...identsIn(m[2])]);
  }

  // 箭頭函式的參數：從 => 往回看
  for (const m of code.matchAll(/=>/g)) {
    const before = code.slice(0, m.index).trimEnd();
    if (before.endsWith(')')) {
      let depth = 0;
      let i = before.length - 1;
      for (; i >= 0; i -= 1) {
        if (before[i] === ')') depth += 1;
        else if (before[i] === '(') { depth -= 1; if (depth === 0) break; }
      }
      if (i >= 0) add(identsIn(before.slice(i)));
    } else {
      const name = before.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
      if (name) add([name[0]]);
    }
  }

  return bound;
}

/** 這一支檔案「當成值在用」的名字 → 第一次出現在第幾行。 */
function usedNames(code) {
  const used = new Map();
  let line = 1;
  let cursor = 0;
  for (const m of code.matchAll(IDENT)) {
    line += (code.slice(cursor, m.index).match(/\n/g) ?? []).length;
    cursor = m.index;
    const name = m[0];
    if (KEYWORDS.has(name)) continue;
    const before = code.slice(Math.max(0, m.index - 2), m.index);
    if (/[.#]$/.test(before)) continue;          // a.foo：屬性，不是名字
    if (/[0-9A-Za-z_$]$/.test(before)) continue; // 1_000 的 _000 不是名字
    const after = code.slice(m.index + name.length);
    if (/^\s*:/.test(after)) continue;           // 物件的鍵、label、三元的另一半
    if (/^\s*=>/.test(after)) continue;          // 單一參數的箭頭函式
    if (!used.has(name)) used.set(name, line);
  }
  return used;
}

test('沒有用到不存在的名字', () => {
  const offenders = [];
  for (const file of filesUnder(JS_ROOT)) {
    const code = stripLiterals(readFileSync(file, 'utf8'));
    const bound = boundNames(code);
    for (const [name, line] of usedNames(code)) {
      if (bound.has(name) || BROWSER_GLOBALS.has(name) || NODE_GLOBALS.has(name)) continue;
      offenders.push(`${toPosix(file.slice(JS_ROOT.length))}:${line} 用了 ${name}，但它沒有宣告也沒有 import`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `這幾個名字在瀏覽器裡會是 ReferenceError：\n${offenders.join('\n')}`,
  );
});

// ---------- import 的名字對面真的有嗎 ----------

function exportedNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export const { a, b } = …
  for (const m of code.matchAll(/\bexport\s+(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim();
      if (name) names.add(name);
    }
  }
  // export { a, b as c }
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const bits = part.split(/\s+as\s+/);
      const name = (bits[1] ?? bits[0]).trim();
      if (name) names.add(name);
    }
  }
  if (/\bexport\s+default\b/.test(code)) names.add('default');
  return names;
}

test('import 進來的名字，對面那一支有 export', () => {
  const offenders = [];
  for (const file of filesUnder(JS_ROOT)) {
    const rel = toPosix(file.slice(JS_ROOT.length));
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const [, clause, path] = m;
      if (!path.startsWith('.')) continue; // CDN 上的 firebase 不在這裡管
      const target = resolve(dirname(file), path);
      if (!existsSync(target)) {
        offenders.push(`${rel} import 的檔案不存在：${path}`);
        continue;
      }
      const has = exportedNames(stripLiterals(readFileSync(target, 'utf8')));
      const braces = clause.match(/\{([\s\S]*)\}/);
      const wanted = braces
        ? braces[1].split(',').map((part) => part.split(/\s+as\s+/)[0].trim()).filter(Boolean)
        : [];
      if (/^\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(clause.replace(/\{[\s\S]*\}/, ''))) wanted.push('default');
      for (const name of wanted) {
        if (!has.has(name)) offenders.push(`${rel} 從 ${path} import 了 ${name}，但那一支沒有 export 它`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `對不起來的 import 會讓整支模組載不進來，畫面空白：\n${offenders.join('\n')}`,
  );
});
