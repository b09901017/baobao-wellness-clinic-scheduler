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

const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

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

// 她 2026-09-08：「關閉或收合抽屜時，常會出現『先往上微跳/閃爍一下，
// 才往下滑動收合』的視覺瑕疵。」
//
// 根因在 `dismiss()`：`goTall()` 會加上 `.drawer--tall`（面板變滿高，
// **上緣往上跑 peekY**）然後 `setY(peekY + y)` 補償回來。但 `goTall()`
// 裡面有兩次 `getBoundingClientRect()` —— 那會**強制瀏覽器算一次樣式**，
// 而那一刻 class 已經加上去了、`--sheet-y` 還是舊值。於是過場的起點被定在
// 「已經變高、還沒補位移」那個位置，比她看到的高 peekY。
//
// `expand()` 沒有這個問題，因為它多包了一層 `requestAnimationFrame()`。
// 這一支盯著 `dismiss()` 也有 —— 少了它，那個跳動會安靜地長回來，
// 而它只在真的裝置上看得到。
describe('收合抽屜不可以先往上跳一下', () => {
  /**
   * 一支巢狀函式的**本體**，切在它自己那個收合大括號。
   *
   * **不可以只切前 N 個字元**：`dismiss()` 後面緊接著 `playIn()`，
   * 而那一支本來就有 `requestAnimationFrame` —— 切太長的話這幾條斷言
   * 會讀到隔壁那一支，然後永遠是綠的。
   */
  const body = (name) => {
    const at = JS.indexOf(`function ${name}(`);
    assert.ok(at > 0, `sheet.js 裡找不到 ${name}()`);
    const end = JS.indexOf(`
  }`, at);
    assert.ok(end > at, `${name}() 的收合大括號在哪？`);
    return JS.slice(at, end);
  };

  test('dismiss() 換成滿高之後，要等下一幀才開始過場', () => {
    const src = body('dismiss');
    assert.match(src, /goTall\(\)/, 'dismiss() 還是要換成滿高');
    assert.match(
      src,
      /requestAnimationFrame\(/,
      'dismiss() 少了 requestAnimationFrame：補償那一次 setY() 不會被畫出來，'
        + '面板會先往上跳 peekY 再往下滑',
    );
  });

  test('expand() 那一支的作法沒有被改掉 —— 兩支是對照組', () => {
    assert.match(body('expand'), /requestAnimationFrame\(/);
  });

  test('灰底淡出跟面板同一幀，不要提早', () => {
    const src = body('dismiss');
    const fade = src.indexOf('--out');
    const raf = src.indexOf('requestAnimationFrame');
    assert.ok(fade > raf, '灰底要在 rAF 裡面才不會比面板早一幀開始淡');
  });
});
