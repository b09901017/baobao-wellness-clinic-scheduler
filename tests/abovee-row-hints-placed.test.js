// 拍 Abovee：列底下那幾行提示（`aboveeConfirm.js` 的 `hintsHtml()`），每一行在「發現問題」那一頁都有位置（審查 R7）。
//
// ADR-0170：收著的列不畫那幾行，整句在「發現問題」那一頁。哪幾列進那一頁只問 domain（`problemsPage()` →
// `hasRowNote()`、`rowTag()`、`needsAttention()`、`offersChange()`）。`hasRowNote()` 是一行一行照抄 `hintsHtml()` 的判斷 ——
// 在 `hintsHtml()` 加一行、而那幾支都沒看那一個東西，那一句就只剩點開才看得到，而「發現問題 0」灰掉講的是「沒事」。
//
// 盯的是：`hintsHtml()` 裡叫到的每一支 domain 函式、讀到的每一格 `item.X`，都要出現在 `problemsPage()` 會問的那幾支裡
// （或寫在下面的名單裡、附理由）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync(new URL('../public/js/ui/components/aboveeConfirm.js', import.meta.url), 'utf8');
const DOMAIN = readFileSync(new URL('../public/js/domain/aboveeImport.js', import.meta.url), 'utf8');

/** 從 `function name(` 起到下一個在同一層縮排、開頭是 `}` 的那一行 */
function body(src, head) {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `找不到 ${head}`);
  const indent = src.slice(src.lastIndexOf('\n', at) + 1, at);
  const end = src.indexOf(`\n${indent}}`, at);
  return src.slice(at, end);
}

/** `needsAttention` 是箭頭函式：取到下一個空行 */
function arrow(src, head) {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `找不到 ${head}`);
  return src.slice(at, src.indexOf('\n\n', at));
}

const PLACES = [
  body(DOMAIN, 'export function problemsPage('),
  body(DOMAIN, 'export function hasRowNote('),
  body(DOMAIN, 'export function rowTag('),
  arrow(DOMAIN, 'export const needsAttention ='),
  arrow(DOMAIN, 'export const offersChange ='),
].join('\n');

// 不用另外找位置的，附理由
const ALLOWED = {
  briefWarnings: '`must`（`mustSeeBy`）的整句；辨識結果上的標記是 `tagBy`，兩邊一一對上由 tests/abovee-warning-tags.test.js 盯著，`rowTag()` 讀它',
  diffSay: '只是把 `item.diffs` 寫成句子；那一行的條件（`diffs`、`locked`、`offersChange()`）在下面一格一格比',
  wantsWrite: '那一行反過來用（會寫進去的列不畫）；`hasRowNote()` 也是同一個條件',
  adopt: '只決定那一句寫「照 Abovee 改」還是「沒勾」，不決定有沒有那一句',
  key: '只拿來問 `savedKeys`（記好了的列不在那一頁）',
};

function domainNames() {
  const imp = UI.match(/import \{([^}]*)\} from '\.\.\/\.\.\/domain\/aboveeImport\.js'/);
  return imp[1].split(',').map((s) => s.trim()).filter(Boolean);
}

function unplaced(hints, places = PLACES) {
  const calls = domainNames().filter((n) => new RegExp(`\\b${n}\\(`).test(hints));
  const props = [...new Set([...hints.matchAll(/\bitem\.(\w+)/g)].map((m) => m[1]))];
  return [...calls, ...props].filter((n) => !ALLOWED[n] && !new RegExp(`\\b${n}\\b`).test(places));
}

test('hintsHtml() 每一行用到的，problemsPage() 會問的那幾支裡都看得到', () => {
  const hints = body(UI, 'function hintsHtml(');
  assert.ok(domainNames().length > 20, '讀得到 import 那一串');
  assert.match(hints, /newRowSay\(/, '取到的是 hintsHtml() 本身');
  assert.deepEqual(unplaced(hints), []);
});

test('這支測試抓得到：hintsHtml() 多一行叫一支那幾支都沒看的函式，就紅', () => {
  const hints = `${body(UI, 'function hintsHtml(')}\n\${mismatchSay(item) ? 'x' : ''}\${item.someNewFlag ? 'y' : ''}`;
  assert.deepEqual(unplaced(hints), ['mismatchSay', 'someNewFlag']);
});
