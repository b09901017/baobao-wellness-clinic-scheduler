// 返回鍵的層堆疊。`ui/nav.js`。
//
// 這一支盯的是**手上那個 handle 還算不算數**。
//
// `pushLayer()` 回一個 handle，而畫面常常把它存在模組層的變數裡
// （壓表的 `monthLayer`、日曆的 `deckLayer`），下次要推之前先看
// 「已經有一層了嗎」。問題是**換頁會把整個 stack 清掉**（`hashchange`
// 那一段，它必須那樣做：那幾筆紀錄現在在新頁面的下面，退掉會把換頁一起退掉），
// 而那個變數不會知道。
//
// 症狀：離開壓表 → 回壓表 → 返回鍵直接跳出整頁，不是退回選月份。
// 中間什麼錯誤訊息都沒有。
//
// 所以 handle 要答得出 `active`，而**作廢由 nav 自己標**：畫面那側
// 沒有辦法知道 stack 什麼時候被清掉的。

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

const listeners = {};
const pushed = [];

globalThis.window = {
  addEventListener(type, fn) {
    (listeners[type] ??= []).push(fn);
  },
  history: {
    state: null,
    pushState(state) { this.state = state; pushed.push(state.__layer); },
    go() {},
    back() {},
  },
  location: { hash: '#/schedule', pathname: '/', replace() {} },
};

const fire = (type) => (listeners[type] ?? []).forEach((fn) => fn());
const tick = () => new Promise((r) => { queueMicrotask(() => queueMicrotask(r)); });

const { pushLayer, pushScreen, popScreens } = await import('../public/js/ui/nav.js');

describe('pushLayer 的 handle 知道自己還在不在', () => {
  beforeEach(async () => {
    // 每一條測試從乾淨的堆疊開始：換頁就是清乾淨的那條路
    window.history.state = null;
    fire('hashchange');
    pushed.length = 0;
    await tick();
  });

  test('剛推上去的是 active，而且真的推了一筆紀錄', async () => {
    const layer = pushLayer(() => {});
    await tick();
    assert.equal(layer.active, true);
    assert.deepEqual(pushed, [1]);
  });

  test('自己 pop 掉之後不再 active', async () => {
    const layer = pushLayer(() => {});
    await tick();
    layer.pop();
    assert.equal(layer.active, false);
  });

  test('換頁把還開著的層作廢 —— 這就是那個 bug', async () => {
    const layer = pushLayer(() => {});
    await tick();

    window.history.state = null;
    fire('hashchange');

    assert.equal(layer.active, false,
      '換頁清掉了 stack，手上那個 handle 一定要跟著失效');
  });

  test('作廢之後再推一層，紀錄要真的多一筆', async () => {
    const first = pushLayer(() => {});
    await tick();
    window.history.state = null;
    fire('hashchange');
    pushed.length = 0;

    // 畫面那側的樣板：`if (!layer?.active) layer = pushLayer(...)`
    const again = first.active ? first : pushLayer(() => {});
    await tick();

    assert.notEqual(again, first);
    assert.equal(again.active, true);
    assert.deepEqual(pushed, [1], '換頁之後紀錄是從頭數的');
  });

  test('按返回鍵收掉那一層之後也不再 active', async () => {
    const layer = pushLayer(() => {});
    await tick();

    window.history.state = { __layer: 0 };
    fire('popstate');
    await tick();

    assert.equal(layer.active, false);
  });

  test('popScreens() 收掉的那幾層也要作廢', async () => {
    pushScreen('customer-edit', () => {});
    const plain = pushLayer(() => {});
    await tick();

    popScreens();

    assert.equal(plain.active, true, '它不是 screen，不該被收掉');
  });
});

// ---------------------------------------------------------------------------

/**
 * 存起來的 handle **一律問 `.active`，不問它是不是 null**。
 *
 * 這是原始碼掃描，因為那個 bug 從畫面上看不出來 —— 返回鍵跳走一整頁，
 * 沒有錯誤訊息，而且只在「離開這一頁再回來」之後才會發生。
 * 三個畫面存著 handle（壓表兩個、本輪可用性一個），每多一個就多一次機會。
 */
describe('沒有人拿 layer handle 當布林值用', () => {
  // `nav.js` 自己是實作，它當然摸得到那個旗標
  const FILES = execFileSync('git', ['ls-files', 'public/js/ui'], { encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('.js') && !f.endsWith('ui/nav.js'));

  test('存起來的 handle 只出現在賦值、.pop() 與 .active 上', () => {
    const offenders = [];

    for (const rel of FILES) {
      const src = readFileSync(fromRoot() + rel, 'utf8');
      // `xxxLayer = pushLayer(` —— 存起來的才有這個問題，就地用掉的沒有
      const names = [...src.matchAll(/(\w+)\s*=\s*pushLayer\(/g)].map((m) => m[1]);
      if (!names.length) continue;

      src.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        for (const name of new Set(names)) {
          // 後面接 `=`（賦值）、`?`（`?.active` / `?.pop()`）、`.`（`.pop()`）
          // 以外的用法，就是把它當布林值在用
          const re = new RegExp(`[!&|(\\s]${name}(?!\\s*[=?.\\w])`);
          if (re.test(line)) offenders.push(`${rel}:${i + 1}　${line.trim()}`);
        }
      });
    }

    assert.deepEqual(offenders, [], '換頁會清掉 stack 但不會清掉這個變數 ——'
      + `改問 ${'`'}?.active${'`'}：\n${offenders.join('\n')}`);
  });
});
