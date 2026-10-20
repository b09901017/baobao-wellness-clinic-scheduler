// 整頁高的那幾處不用「視窗高度」那個單位（`.scratch/after-golive-2026-10-20/issues/10`）。
//
// 她 2026-10-21：「只要我重新整理後，畫面就會少了最下面的導覽行，直到我把畫面往上滑到最底後，再往上滑才會又出現，
// staging main 都有這狀況，有時候導覽行甚至只有一半」。
//
// 殼（`html`、`body`）與蓋住整頁的那幾層以前寫 `height: 100dvh`。全螢幕（ADR-0147）裝在手機上的那一顆重新整理時，
// 系統的那兩條收起來又出來，Chrome 的 dvh 沒跟上（要捲一下才重算）→ 整頁比畫面高一截，最底下那一排被擠出去。
// 殼改成 `100%`（這一頁排版真的用的大小），蓋住整頁的那幾層靠 `inset: 0`。
//
// **桌機重現不出來**（桌機的 dvh 永遠等於視窗），所以這一支盯的是寫法：整頁高的那幾處一處都不准用。
// 抽屜、卡片的「最多佔幾成」（`78dvh` 那種）不算：差幾十 px 不會把東西擠出畫面。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const CSS_DIR = new URL('../public/css/', import.meta.url);
const FULL = /(^|[;{\s])(min-)?height\s*:\s*100(dvh|vh|svh|lvh)\s*[;}]/;

test('整頁高的那幾處（height／min-height: 100dvh 之類）一處都沒有', () => {
  const hits = [];
  for (const name of readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))) {
    const lines = readFileSync(new URL(name, CSS_DIR), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).split('\n');
    lines.forEach((line, i) => { if (FULL.test(line)) hits.push(`${name}:${i + 1} ${line.trim()}`); });
  }
  assert.deepEqual(hits, [], '重新整理之後這幾處會比畫面高一截、最底下的被擠出去 —— 殼用 100%，蓋住整頁的那一層用 inset: 0');
});

test('殼的高度是 100%（html、body）', () => {
  const css = readFileSync(new URL('app.css', CSS_DIR), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of ['html', 'body']) {
    const block = css.match(new RegExp(`(^|\\n)${sel} \\{([^}]*)\\}`))?.[2] ?? '';
    assert.match(block, /(^|\n)\s*height:\s*100%;/, `${sel} 的 height 要是 100%`);
  }
});
