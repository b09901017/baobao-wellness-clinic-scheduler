// 「同名兩份、後面那份安靜地贏」的守衛。
//
// 2026-09-10 抓到的那一次：`.seg` 在 `app.css` 裡被寫了兩遍。703 行那一份是
// `display: flex`（給 `.seg__item` 那一版，等寬填滿整行），6639 行那一份是
// `display: inline-flex`（給 `.seg__btn` 那一版，縮到內容寬）。**同權重，後面贏**，
// 於是 `.seg__item` 那一版跟著縮到內容寬 —— 而 `.seg__item` 是 `flex: 1 1 0`、
// `min-width: auto`，**中文的 min-content 是一個字**，所以它樂於被壓成一個字寬然後折行。
//
// 她看到的是「依客戶這三個字都被迫換行了」。
//
// 這種 bug 從畫面上看不出是誰造成的：兩條規則都長得很合理，而且第一條的註解還在，
// 讀 CSS 的人會以為它還算數。它的形狀是機器認得出來的，所以交給機器。
//
// **只掃頂層的裸 class 規則**（`.foo { }`，不在 `@media` 裡、沒有組合器、沒有偽類）。
// 有組合器或偽類的那幾種是刻意的階層或狀態，重複很正常。
//
// 這一支不執行任何程式碼，只讀 CSS，跟 `tokens.css.test` 與 `module-names.test.js`
// 同一個路數。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

/**
 * 一份 CSS 裡的每一條規則：選擇器、內文、以及它是不是包在 `@media` 之類裡面。
 *
 * 自己掃而不是拉一個 CSS parser 進來：這個 repo 一個 runtime 相依都沒有，
 * 為了一支測試多一個是不划算的。要認的東西也就是大括號配對。
 */
function rulesIn(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  let atDepth = 0;
  let sel = '';

  while (i < clean.length) {
    const ch = clean[i];

    if (ch === '{') {
      const s = sel.trim();
      sel = '';
      // `@media` / `@supports` / `@keyframes`：進去一層，裡面的規則照樣收，
      // 但標記成 inAt —— 那幾條是刻意的覆寫。
      if (s.startsWith('@')) { atDepth += 1; i += 1; continue; }

      let depth = 1;
      let body = '';
      i += 1;
      while (i < clean.length && depth > 0) {
        if (clean[i] === '{') depth += 1;
        else if (clean[i] === '}') { depth -= 1; if (!depth) break; }
        body += clean[i];
        i += 1;
      }
      out.push({ sel: s, body, inAt: atDepth > 0 });
      i += 1;
      continue;
    }

    if (ch === '}') { if (atDepth > 0) atDepth -= 1; sel = ''; i += 1; continue; }
    sel += ch;
    i += 1;
  }
  return out;
}

/** 一段規則內文裡宣告了哪幾個屬性。 */
const propsOf = (body) =>
  new Set([...body.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]));

/** 只有一個裸 class、沒有組合器也沒有偽類的那種選擇器。 */
const isBareClass = (sel) => /^\.[a-zA-Z][\w-]*$/.test(sel);

describe('app.css 裡沒有同名兩份的裸 class 規則', () => {
  const rules = rulesIn(read('css/app.css')).filter((r) => !r.inAt && isBareClass(r.sel));

  test('掃到的規則數量是合理的（掃壞了會靜悄悄地全綠）', () => {
    assert.ok(rules.length > 400, `只掃到 ${rules.length} 條頂層裸 class 規則，掃壞了？`);
  });

  test('同一個 class 沒有被寫兩遍而且宣告到同一個屬性', () => {
    const byClass = new Map();
    for (const r of rules) {
      if (!byClass.has(r.sel)) byClass.set(r.sel, []);
      byClass.get(r.sel).push(propsOf(r.body));
    }

    const clashes = [];
    for (const [sel, list] of byClass) {
      if (list.length < 2) continue;
      const overlap = new Set();
      for (let a = 0; a < list.length; a += 1) {
        for (let b = a + 1; b < list.length; b += 1) {
          for (const p of list[a]) if (list[b].has(p)) overlap.add(p);
        }
      }
      if (overlap.size) clashes.push(`${sel}（${list.length} 份，兩份都宣告了：${[...overlap].join('、')}）`);
    }

    assert.deepEqual(clashes, [],
      `這幾個 class 被寫了不只一次，而且後面那一份會安靜地蓋掉前面那一份：\n  ${
        clashes.join('\n  ')}\n\n`
      + '同一個名字要長成兩種東西的話，第二種給它一個修飾詞（`.foo--bar`）'
      + '或另一個名字 —— 不要靠出現的先後順序。');
  });
});
