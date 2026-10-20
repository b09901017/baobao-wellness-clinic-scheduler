// CSS 的註解每一段都有關起來（after-golive 10 改的時候踩到的）。
//
// 少一個 `*/`，瀏覽器就把底下的規則當成註解的一部分，**一路吃到下一段註解的結尾** —— 不報錯、畫面上也沒有任何訊息，
// 只是那幾條規則不見了。2026-10-21 改手機橫放那一條的說明時弄丟了結尾，`@media` 的開頭、`.cam`、`.cam__stage` 整段被吃掉；
// 那一次是 `css-shadowing.test.js` 剛好撞到（被吃掉之後剩下的規則看起來像頂層寫了兩份）才發現的。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const CSS_DIR = new URL('../public/css/', import.meta.url);

// **少了 `*/` 的那一段照樣「成對」**：它一路延伸到下一段註解的 `*/`，算起來開關數一樣。
// 露出馬腳的是那一段裡面又出現一個 `/*`（下一段註解的開頭被吞進來了）—— 這一條盯的是那個
test('沒有一段註解裡面又出現 /*（前一段少了 */，把底下的規則吞掉了）', () => {
  const swallowed = [];
  for (const name of readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(new URL(name, CSS_DIR), 'utf8');
    for (const m of css.matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (m[0].slice(2).includes('/*')) {
        const line = css.slice(0, m.index).split('\n').length;
        swallowed.push(`${name}:${line} 這一段沒有關起來：${m[0].slice(2, 40).trim()}…`);
      }
    }
  }
  assert.deepEqual(swallowed, []);
});

test('拿掉每一段完整的註解之後，沒有落單的 /* 或 */', () => {
  const left = [];
  for (const name of readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))) {
    const rest = readFileSync(new URL(name, CSS_DIR), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const mark of ['/*', '*/']) if (rest.includes(mark)) left.push(`${name}：多一個 ${mark}`);
  }
  assert.deepEqual(left, []);
});

test('大括號配得起來（不會在中途掉到負的）', () => {
  for (const name of readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))) {
    let depth = 0;
    for (const ch of readFileSync(new URL(name, CSS_DIR), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      assert.ok(depth >= 0, `${name}：多一個 }`);
    }
    assert.equal(depth, 0, `${name}：少 ${depth} 個 }`);
  }
});
