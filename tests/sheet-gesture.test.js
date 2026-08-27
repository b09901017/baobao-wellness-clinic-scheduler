// 抽屜手勢的守衛。
//
// 「抽屜裡的丸子左右滑不動」是**兩邊各壞一半**造成的，所以修的時候也要兩邊一起：
//
//   1. `app.css` 的 `.drawer__body` 宣告 `touch-action: pan-y`。那句話的意思是
//      「這一塊只准直著滑」，而它會蓋到底下每一排丸子 —— 瀏覽器連試都不會試著
//      橫向捲。所以那幾排要自己把橫向那一軸要回去（`pan-x pan-y`）。
//   2. `sheet.js` 的 `wireDrag()` 判斷接不接手時只看 Y。橫著滑的時候手指不可能
//      只動 X，於是它會把手勢判成「拖面板」再 `preventDefault()`，把剛剛要回來
//      的那一軸當場又取消掉。
//
// 只修一邊等於沒修，而**兩邊各有一份選擇器**。這一支盯著它們一樣 ——
// 之後多一種橫捲的列時，改了一邊忘了另一邊的症狀是「這一排就是滑不動」，
// 而那要真的拿手機去滑才看得到。
//
// 這一支不執行任何程式碼，只讀原始碼，跟 `tokens.test.js` 同一個路數。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url).pathname, 'utf8');

const JS = read('js/ui/components/sheet.js');
const CSS = read('css/app.css');

/** 一段選擇器裡的 class，排序過 —— 兩邊的寫法順序不必一樣。 */
const classesIn = (text) => [...text.matchAll(/\.[a-z][a-z0-9_-]*/g)].map((m) => m[0]).sort();

describe('橫著捲的那幾排，CSS 與 JS 認的是同一組', () => {
  const js = JS.match(/const SIDEWAYS = '([^']+)'/);
  const css = CSS.match(/\.drawer__body :is\(([^)]+)\)\s*\{\s*touch-action: pan-x pan-y/);

  test('兩邊的名單都還在', () => {
    assert.ok(js, 'sheet.js 的 SIDEWAYS 不見了？');
    assert.ok(css, 'app.css 裡 .drawer__body 底下那條 touch-action 不見了？');
  });

  test('名單一樣', () => {
    assert.deepEqual(
      classesIn(js[1]),
      classesIn(css[1]),
      '改了一邊忘了另一邊。兩邊都要改，只改一邊那一排還是滑不動。',
    );
  });
});

describe('接手的判斷', () => {
  test('橫向手勢在那幾排上面要還給瀏覽器', () => {
    assert.match(
      JS,
      /if \(sideways && Math\.abs\(dx\) > Math\.abs\(dy\)\) \{\s*mode = 'scroll';/,
      '橫的那一道守衛不見了 —— 丸子會再度滑不動',
    );
  });

  test('那一道要排在只看 Y 的那三條前面', () => {
    const sideways = JS.indexOf("if (sideways && Math.abs(dx)");
    const firstY = JS.indexOf('if (!scroller) mode = ');
    assert.ok(sideways > 0 && firstY > 0, '找不到那兩段');
    assert.ok(
      sideways < firstY,
      '排在後面等於沒有：只看 Y 的那三條會先把橫向手勢判成「拖面板」',
    );
  });

  test('X 有從事件上接進來', () => {
    for (const line of [
      'onStart(e.touches[0].clientY, e.target, e.touches[0].clientX)',
      'onMove(e.touches[0].clientY, e.touches[0].clientX)',
      'onStart(e.clientY, e.target, e.clientX)',
    ]) {
      assert.ok(JS.includes(line), `沒接 X 進來：${line}`);
    }
  });

  test('捲不動的那幾排不算 —— 不然它們會變成拖不動的死區', () => {
    assert.match(
      JS,
      /box\.scrollWidth > box\.clientWidth \+ 1 \? box : null/,
      'sidewaysUnder() 要先問「這一排真的捲得動嗎」',
    );
  });
});
