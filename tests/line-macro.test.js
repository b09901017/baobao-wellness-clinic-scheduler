// 打開 LINE 對話交給手機上的 MacroDroid（ADR-0157，line-macrodroid 02）。
//
// 判準：**這一行會不會讓上一位客人的訊息被貼進下一位的對話，或讓一台沒裝 MacroDroid 的裝置去敲本機的門？**

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  macroUrl, readLineMacro, saveLineMacro, openLineChat, testLineMacro, portOf,
  DEFAULT_PORT, LINE_CHATS_URL, LINE_MACRO_KEY, TEST_MESSAGE,
} from '../public/js/integrations/lineMacro.js';

/** 一個假的 localStorage。 */
function memoryStorage(init = {}) {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

/** 把每一步記下來的假環境。 */
function fakeDeps({ on = false, port = DEFAULT_PORT, fetch } = {}) {
  const log = [];
  const storage = memoryStorage({ [LINE_MACRO_KEY]: JSON.stringify({ on, port }) });
  return {
    log,
    deps: {
      storage,
      fetch: fetch ?? (async (url, opts) => { log.push(['fetch', url, opts.mode]); return { type: 'opaque' }; }),
      copy: (text) => { log.push(['copy', text]); return Promise.resolve(); },
      open: (url) => { log.push(['open', url]); return true; },
      timeoutMs: 50,
      againMs: 0,
    },
  };
}

/** 一個自己決定什麼時候回應的 fetch。 */
function heldFetch(log) {
  let answer;
  const fetch = (url) => {
    log.push(['fetch', url]);
    return new Promise((resolve) => { answer = () => resolve({ type: 'opaque' }); });
  };
  return { fetch, answer: () => answer() };
}

const params = (url) => Object.fromEntries(new URL(url).searchParams);

describe('網址', () => {
  test('本機、path 是 line、name 與 msg 都帶 —— 沒有訊息時 msg 是空的（巨集的變數會留著上一次的）', () => {
    const url = macroUrl({ port: 8080, name: '王小明', msg: '' });
    assert.ok(url.startsWith('http://127.0.0.1:8080/line?'));
    assert.deepEqual(params(url), { name: '王小明', msg: '' });
    assert.match(url, /&msg=$/);
  });

  test('中文、換行、空白、& 都原樣解得回來；空白編成 %20 不是 +', () => {
    const msg = '王小明你好\n明天 10:00 & 下午\n\n第三段';
    const url = macroUrl({ port: 18080, name: '王 小明', msg });
    assert.deepEqual(params(url), { name: '王 小明', msg });
    assert.match(url, /%0A/);
    assert.doesNotMatch(url, /\+/);
  });

  test('名字前後的空白拿掉（一個空白都會讓 LINE 搜尋對不上）', () => {
    assert.equal(params(macroUrl({ port: 8080, name: '  王小明 ' })).name, '王小明');
  });

  test('連接埠只收 1–65535 的整數', () => {
    assert.equal(portOf(8080), 8080);
    assert.equal(portOf('18080'), 18080);
    for (const bad of [0, 65536, 80.5, -1, '', 'abc', null, undefined]) assert.equal(portOf(bad), null, String(bad));
  });
});

describe('記在這一台裝置', () => {
  test('沒記過：沒開、8080', () => {
    assert.deepEqual(readLineMacro(memoryStorage()), { on: false, port: 8080 });
  });

  test('存了讀得回來；壞掉的 port 退回 8080', () => {
    const s = memoryStorage();
    assert.equal(saveLineMacro({ on: true, port: 18080 }, s), true);
    assert.deepEqual(readLineMacro(s), { on: true, port: 18080 });
    s.setItem(LINE_MACRO_KEY, JSON.stringify({ on: true, port: 'x' }));
    assert.deepEqual(readLineMacro(s), { on: true, port: 8080 });
    s.setItem(LINE_MACRO_KEY, '{壞掉');
    assert.deepEqual(readLineMacro(s), { on: false, port: 8080 });
  });

  test('localStorage 丟例外：當成沒開，存不進去回 false（無痕、擋掉網站資料）', () => {
    assert.deepEqual(readLineMacro(throwing), { on: false, port: 8080 });
    assert.equal(saveLineMacro({ on: true, port: 8080 }, throwing), false);
    assert.deepEqual(readLineMacro(null), { on: false, port: 8080 });
  });
});

describe('打開他的對話', () => {
  test('沒填 LINE 名字：講去哪裡填，什麼都不開、不複製、不敲門', async () => {
    const { log, deps } = fakeDeps({ on: true });
    const said = [];
    assert.equal(await openLineChat({ name: '  ', msg: '訊息', notify: (m) => said.push(m), deps }), 'no-name');
    assert.deepEqual(log, []);
    assert.match(said[0], /還沒填 LINE 名字/);
    assert.match(said[0], /編輯/);
  });

  test('這一台沒開：一次都不敲本機的門；開 LINE 的聊天清單、複製名字', async () => {
    const { log, deps } = fakeDeps({ on: false });
    const said = [];
    assert.equal(await openLineChat({ name: '王小明', notify: (m) => said.push(m), deps }), 'fallback');
    assert.deepEqual(log, [['copy', '王小明'], ['open', LINE_CHATS_URL]]);
    assert.match(said[0], /已複製「王小明」/);
  });

  test('這一台沒開、有訊息：複製的是訊息，講搜尋誰', async () => {
    const { log, deps } = fakeDeps({ on: false });
    const said = [];
    await openLineChat({ name: '王小明', msg: '明天見', notify: (m) => said.push(m), deps });
    assert.deepEqual(log, [['copy', '明天見'], ['open', LINE_CHATS_URL]]);
    assert.match(said[0], /訊息已複製/);
    assert.match(said[0], /搜尋「王小明」/);
  });

  test('開著：叫 MacroDroid（no-cors），不開 line.me；有訊息時先複製一份備份', async () => {
    const { log, deps } = fakeDeps({ on: true, port: 18080 });
    const said = [];
    assert.equal(await openLineChat({ name: '王小明', msg: '明天見', notify: (m) => said.push(m), deps }), 'macro');
    assert.equal(log.length, 2);
    assert.deepEqual(log[0], ['copy', '明天見']);
    assert.equal(log[1][0], 'fetch');
    assert.equal(log[1][2], 'no-cors');
    assert.deepEqual(params(log[1][1]), { name: '王小明', msg: '明天見' });
    assert.ok(log[1][1].startsWith('http://127.0.0.1:18080/line?'));
    assert.ok(!log.some(([k]) => k === 'open'));
  });

  test('開著、沒有訊息：不動剪貼簿（她剪貼簿裡的東西不要被名字蓋掉）', async () => {
    const { log, deps } = fakeDeps({ on: true });
    await openLineChat({ name: '王小明', notify: () => {}, deps });
    assert.deepEqual(log.map(([k]) => k), ['fetch']);
    assert.equal(params(log[0][1]).msg, '');
  });

  test('叫不到（fetch reject）：走退路，句子講叫不到 MacroDroid', async () => {
    const { log, deps } = fakeDeps({ on: true, fetch: async () => { throw new TypeError('Failed to fetch'); } });
    const said = [];
    assert.equal(await openLineChat({ name: '王小明', notify: (m) => said.push(m), deps }), 'fallback');
    assert.deepEqual(log, [['copy', '王小明'], ['open', LINE_CHATS_URL]]);
    assert.match(said[0], /叫不到 MacroDroid/);
    assert.match(said[0], /已複製「王小明」/);
    // 三個原因都講（邊界測試清單 P2）：MacroDroid 沒開、連接埠不一樣、Chrome 擋了區域網路
    assert.match(said[0], /開著/);
    assert.match(said[0], /連接埠/);
    assert.match(said[0], /區域網路/);
  });

  test('沒回應（逾時）：只講一句、不開 LINE —— Chrome 那個「區域網路」的框可能正開著等她按', async () => {
    const { log, deps } = fakeDeps({ on: true, fetch: (url, { signal }) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }) });
    const said = [];
    assert.equal(await openLineChat({ name: '王小明', notify: (m) => said.push(m), deps }), 'no-reply');
    assert.deepEqual(log, []);
    assert.match(said[0], /沒回應/);
  });

  test('退路開不了新視窗（被擋）：句子照講，不假裝開了', async () => {
    const { deps } = fakeDeps({ on: false });
    deps.open = () => false;
    const said = [];
    await openLineChat({ name: '王小明', notify: (m) => said.push(m), deps });
    assert.match(said[0], /打開 LINE/);
  });

  test('剪貼簿被擋：照樣開 LINE，句子把名字講出來', async () => {
    const { log, deps } = fakeDeps({ on: false });
    deps.copy = () => Promise.reject(new Error('NotAllowed'));
    const said = [];
    await openLineChat({ name: '王小明', notify: (m) => said.push(m), deps });
    assert.ok(log.some(([k, u]) => k === 'open' && u === LINE_CHATS_URL));
    assert.match(said.join(''), /王小明/);
  });
});

describe('按兩下（巨集跑兩次就是訊息貼兩次）', () => {
  test('還在等 MacroDroid 回應時再按：不再敲門、講一句、剪貼簿不動', async () => {
    const { log, deps } = fakeDeps({ on: true });
    const held = heldFetch(log);
    deps.fetch = held.fetch;
    const said = [];
    const first = openLineChat({ name: '王小明', msg: '明天見', notify: (m) => said.push(m), deps });
    assert.equal(await openLineChat({ name: '客戶A', msg: '後天見', notify: (m) => said.push(m), deps }), 'busy');
    assert.match(said[0], /剛剛叫過/);
    held.answer();
    assert.equal(await first, 'macro');
    assert.deepEqual(log.map(([k]) => k), ['copy', 'fetch']);
    assert.equal(log[0][1], '明天見');
  });

  test('剛叫到的那幾秒再按：照樣不敲門；過了就敲得到', async () => {
    const { log, deps } = fakeDeps({ on: true });
    deps.againMs = 30;
    assert.equal(await openLineChat({ name: '王小明', notify: () => {}, deps }), 'macro');
    assert.equal(await openLineChat({ name: '王小明', notify: () => {}, deps }), 'busy');
    await new Promise((r) => setTimeout(r, 40));
    deps.againMs = 0; // 不然這一下又鎖 30ms，鎖到下一條測試
    assert.equal(await openLineChat({ name: '王小明', notify: () => {}, deps }), 'macro');
    assert.equal(log.filter(([k]) => k === 'fetch').length, 2);
  });

  test('叫不到之後馬上再按：敲得到（她在重試，不是按兩下）', async () => {
    const { log, deps } = fakeDeps({ on: true, fetch: async (url) => { log.push(['fetch', url]); throw new TypeError('x'); } });
    deps.againMs = 10000;
    await openLineChat({ name: '王小明', notify: () => {}, deps });
    await openLineChat({ name: '王小明', notify: () => {}, deps });
    assert.equal(log.filter(([k]) => k === 'fetch').length, 2);
  });

  test('「試一次」跟打開對話是同一個巨集：一邊還在等時另一邊不敲', async () => {
    const { log, deps } = fakeDeps({ on: true });
    const held = heldFetch(log);
    deps.fetch = held.fetch;
    const said = [];
    const first = testLineMacro({ name: '王小明', notify: () => {}, deps });
    assert.equal(await openLineChat({ name: '王小明', notify: (m) => said.push(m), deps }), 'busy');
    held.answer();
    await first;
    assert.equal(log.filter(([k]) => k === 'fetch').length, 1);
  });

  test('這一台沒開（退路）不受影響：按兩下就是開兩次聊天清單，沒有巨集會跑兩次', async () => {
    const { log, deps } = fakeDeps({ on: false });
    await openLineChat({ name: '王小明', notify: () => {}, deps });
    await openLineChat({ name: '王小明', notify: () => {}, deps });
    assert.equal(log.filter(([k]) => k === 'open').length, 2);
  });
});

describe('設定頁的「試一次」', () => {
  test('沒開：講先勾上面那一格，不走退路（不然什麼都沒驗到）', async () => {
    const { log, deps } = fakeDeps({ on: false });
    const said = [];
    assert.equal(await testLineMacro({ name: '王小明', notify: (m) => said.push(m), deps }), 'off');
    assert.deepEqual(log, []);
    assert.match(said[0], /先勾/);
  });

  test('沒打名字：講先打一位好友的 LINE 名字（不是去編輯客戶）', async () => {
    const { log, deps } = fakeDeps({ on: true });
    const said = [];
    assert.equal(await testLineMacro({ name: '', notify: (m) => said.push(m), deps }), 'no-name');
    assert.deepEqual(log, []);
    assert.match(said[0], /好友/);
    assert.doesNotMatch(said[0], /編輯/);
  });

  test('送的是一則跟真的一樣長的三段訊息（驗中文、換行、長度）', async () => {
    const { log, deps } = fakeDeps({ on: true });
    await testLineMacro({ name: '王小明', notify: () => {}, deps });
    const sent = params(log.find(([k]) => k === 'fetch')[1]);
    assert.equal(sent.msg, TEST_MESSAGE);
    assert.ok(TEST_MESSAGE.length >= 150, `測試訊息只有 ${TEST_MESSAGE.length} 字`);
    assert.ok(TEST_MESSAGE.split('\n').filter(Boolean).length >= 3);
  });
});

describe('訊息框的「打開 LINE」（line-macrodroid 04）', async () => {
  const { box } = await import('../public/js/ui/components/message.js');

  test('沒給 line：跟以前一模一樣，沒有那一顆（表單收件匣、補登、邀約、試算表那幾處）', () => {
    const html = box({ id: 'c1', text: '你好', buttonLabel: '複製 LINE 確認訊息' });
    assert.doesNotMatch(html, /data-msg-line/);
    assert.match(html, /data-copy="c1"/);
  });

  test('給了 line：多一顆，帶著那一位的 LINE 名字（跳脫過）', () => {
    const html = box({ id: 'c1', text: '你好', line: { name: '王"小明' } });
    assert.match(html, /data-msg-line="c1"/);
    assert.match(html, /data-msg-line-name="王&quot;小明"/);
    assert.match(html, />打開 LINE</);
  });

  test('還沒填 LINE 名字：那一顆照樣畫（按了才講去哪裡填）', () => {
    const html = box({ id: 'c1', text: '你好', line: { name: '' } });
    assert.match(html, /data-msg-line="c1"/);
  });
});
