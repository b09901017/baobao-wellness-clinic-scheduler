// `public/js/ui/swUpdate.js`（ADR-0167，after-golive 06）：拿假的 `navigator.serviceWorker` 跑它。
//
// E2E `81` 的 P2 量「第一次安裝不會自己重新載入」只能等一段時間看有沒有 `load`（證明「沒發生」要有個上限），
// 慢一拍的機器上那一條會假綠。這裡把那幾個時機一個一個叫出來：
// 第一次安裝（沒有 controller）時 `clients.claim()` 來的那一下 `controllerchange` 不重新載入、也不跳「有新版本」；
// 有舊的在管時新的一版裝好才跳；她按了更新才重新載入。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { fromRoot } from './helpers/paths.js';

const SRC = pathToFileURL(fromRoot('public/js/ui/swUpdate.js')).href;

class FakeWorker extends EventTarget {
  constructor() {
    super();
    this.state = 'installing';
    this.messages = [];
  }

  postMessage(m) { this.messages.push(m); }

  become(state) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

const tick = () => new Promise((r) => { setTimeout(r, 0); });

/**
 * 每一次一份新的 swUpdate（模組上有狀態：等著的那一個、按了更新沒）。
 * @param {{controller?: boolean, waiting?: boolean}} o 開機時這一頁有沒有人管、有沒有一個已經在等的
 */
let n = 0;
async function boot({ controller = false, waiting = false } = {}) {
  const reg = new EventTarget();
  reg.installing = null;
  reg.waiting = waiting ? new FakeWorker() : null;
  reg.update = async () => {};
  const container = new EventTarget();
  container.controller = controller ? new FakeWorker() : null;
  container.register = async () => reg;

  const reloads = [];
  const docListeners = new EventTarget();
  globalThis.document = {
    readyState: 'complete',
    visibilityState: 'visible',
    addEventListener: (...a) => docListeners.addEventListener(...a),
  };
  globalThis.location = { reload: () => reloads.push(1) };
  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: container }, configurable: true, writable: true,
  });

  n += 1;
  const mod = await import(`${SRC}?boot=${n}`);
  const bars = [];
  mod.onUpdateReady(() => bars.push(1));
  mod.register();
  await tick();

  /** 瀏覽器發現新的一份、裝好了。 */
  const install = () => {
    const next = new FakeWorker();
    reg.installing = next;
    reg.dispatchEvent(new Event('updatefound'));
    next.become('installed');
    reg.installing = null;
    return next;
  };
  /** 新的那一份接手（第一次安裝的 `clients.claim()`、或她按了更新之後的 `skipWaiting()`）。 */
  const takeOver = () => {
    container.controller = new FakeWorker();
    container.dispatchEvent(new Event('controllerchange'));
  };
  return { mod, reg, bars, reloads, install, takeOver };
}

test('第一次安裝（沒有人管這一頁）：裝好不跳「有新版本」、接手那一下不重新載入', async () => {
  const s = await boot({ controller: false });
  s.install();
  s.takeOver(); // clients.claim()
  assert.equal(s.bars.length, 0, '不是新版本，是第一次裝');
  assert.equal(s.reloads.length, 0, '第一次打開不會自己重新整理一次');
});

test('有舊的在管、新的一版裝好 → 跳；她沒按之前接手也不重新載入', async () => {
  const s = await boot({ controller: true });
  const next = s.install();
  assert.equal(s.bars.length, 1);
  assert.deepEqual(next.messages, [], '她沒按之前不叫它接手');
  s.takeOver(); // 別的分頁按了更新
  assert.equal(s.reloads.length, 0, '只有按了的那一頁重新載入');
});

test('她按了更新 → 叫等著的那一個接手 → 接手之後重新載入一次', async () => {
  const s = await boot({ controller: true });
  const next = s.install();
  s.mod.applyUpdate();
  assert.deepEqual(next.messages, [{ type: 'skipWaiting' }]);
  assert.equal(s.reloads.length, 0, '接手之前不重新載入（不然載回來的還是舊的那一份）');
  s.takeOver();
  assert.equal(s.reloads.length, 1);
});

test('上一次就裝好在等（她收掉了那一條、app 沒關乾淨）→ 一打開就跳', async () => {
  const s = await boot({ controller: true, waiting: true });
  assert.equal(s.bars.length, 1);
});

test('有一個在等、但這一頁沒有人管（清過資料之後那一下）→ 不跳', async () => {
  const s = await boot({ controller: false, waiting: true });
  assert.equal(s.bars.length, 0);
});
