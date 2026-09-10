// 說明泡泡（`ui/components/tip.js`）。
//
// 她 2026-09-10：「非常占版面，一眼看下去非常雜亂，會視覺疲勞…我想要優化成
// Tooltip，小小的迷你的說明小泡泡，點了之後才會小小的在旁邊浮出說明」。
//
// 這一支釘的是**它不可以退化成另一種常駐文字**：沒話講就一個像素都不佔、
// 那段字在收起來的時候真的不在畫面上、以及它自己關得掉。
//
// 動畫與位置那幾件事沒辦法在這裡量（要有版面），那些在
// `tests-e2e/specs/26-tip.spec.js`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { tip, KINDS } from '../public/js/ui/components/tip.js';

const CSS = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
// **tokens.css 不去註解。**「淺色」那個分段標記本身就寫在註解裡 —— 去掉之後
// 找不到它，淺色那一段會切成空字串，token 寫對了照樣紅（第一版就是這樣寫壞的）。
const TOKENS = readFileSync(new URL('../public/css/tokens.css', import.meta.url), 'utf8');

describe('沒話講就不佔位置', () => {
  test('空字串、空白、undefined 一律回空字串', () => {
    for (const x of ['', '   ', '\n', undefined, null]) {
      assert.equal(tip(x), '', `${JSON.stringify(x)} 不該畫出任何東西`);
    }
  });

  test('有字才畫得出那顆', () => {
    assert.match(tip('順序是算出來的'), /<button/);
  });
});

describe('那段字收起來的時候不在畫面上', () => {
  const html = tip('取消掉的時段不畫 —— 這一頁問的是「這個月做了多少」');

  test('文字放在 data 屬性裡，不是可見的節點', () => {
    // 標籤之間不可以有任何文字內容 —— 有的話它就還是一段常駐文字
    const between = html.replace(/<[^>]*>/g, '').trim();
    assert.equal(between, '',
      '那段說明如果出現在標籤之間，收起來的時候它照樣佔著版面 —— '
      + '整個 tooltip 就白做了');
  });

  test('一開始是收起來的', () => {
    assert.match(html, /aria-expanded="false"/);
  });

  test('type="button" —— 表單裡不可以變成送出', () => {
    assert.match(html, /type="button"/);
  });
});

describe('引號與角括號逃得掉', () => {
  test('屬性裡的雙引號不會把標籤打斷', () => {
    const html = tip('她說「<b>不會擋</b>」而且用了 " 這個字');
    assert.ok(!html.includes('<b>'), '角括號要被逃掉');
    // 屬性值裡不可以出現裸的雙引號：把每一組屬性拆出來數
    const attrs = [...html.matchAll(/[\w-]+="([^"]*)"/g)];
    assert.ok(attrs.length >= 3, '屬性都讀得出來，表示沒有被打斷');
  });
});

describe('兩種泡泡', () => {
  test('KINDS 就是那兩種，不多不少', () => {
    assert.deepEqual([...KINDS].sort(), ['help', 'warn']);
  });

  test('說明那一種不畫 SVG —— 一個字形在 16px 下比線條清楚', () => {
    assert.ok(!tip('x', { kind: 'help' }).includes('<svg'));
  });

  test('提醒那一種用既有的三角形圖示', () => {
    assert.match(tip('x', { kind: 'warn' }), /<svg[\s\S]*M12 3\.5l8\.5 15\.5/);
  });

  test('認不得的種類退回說明，不要吐錯', () => {
    assert.equal(tip('x', { kind: '亂寫' }), tip('x', { kind: 'help' }));
  });
});

describe('讀得到、按得到', () => {
  const html = tip('順序是算出來的預設值');

  test('有一個講得出它是什麼的標籤', () => {
    assert.match(html, /aria-label="[^"]+"/);
  });

  test('觸控區靠 ::after 撐到 44，而且貼在自己身上', () => {
    const block = CSS.match(/^\.tip \{[^}]*\}/m);
    assert.ok(block, '`.tip` 那一條規則不見了？');
    assert.match(block[0], /position:\s*relative/,
      '撐開感應範圍的 ::after 要貼在自己身上 —— 少了這一行它會去貼上層某個盒子，'
      + '而症狀是「按到旁邊那一顆」');
    assert.match(CSS, /\.tip::after \{[^}]*inset:/);
  });
});

describe('泡泡是從那顆點裡長出來的', () => {
  test('`transform-origin` 綁在小尖角上，不是憑空淡入', () => {
    const block = CSS.match(/^\.tip__bubble \{[^}]*\}/m);
    assert.ok(block, '`.tip__bubble` 那一條規則不見了？');
    assert.match(block[0], /transform-origin:\s*var\(--tip-origin/,
      '原點要跟著小尖角走 —— 寫死 center 的話，泡泡看起來是從自己的中間'
      + '長出來的，而不是從她按的那一顆');
  });

  test('小尖角是兩層疊出來的，不是旋轉的方塊', () => {
    assert.match(CSS, /\.tip__tail::before/);
    assert.match(CSS, /\.tip__tail::after/);
  });
});

describe('顏色兩份都有', () => {
  test('新加的 token 淺色與深色各一份', () => {
    const light = TOKENS.slice(TOKENS.indexOf('---------- 淺色 ----------'),
      TOKENS.indexOf("root[data-theme='dark']"));
    const dark = TOKENS.slice(TOKENS.indexOf("root[data-theme='dark']"));
    for (const name of ['--tip-bg', '--tip-line']) {
      assert.ok(light.includes(name), `淺色少了 ${name}`);
      assert.ok(dark.includes(name), `深色少了 ${name}`);
    }
  });
});
