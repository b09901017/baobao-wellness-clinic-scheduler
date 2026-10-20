// `public/sw.js` 本身（ADR-0167，after-golive 06）：拿假的 `caches`／`fetch` 跑它的 install、activate、fetch。
//
// E2E `81` 走得到「新的一版裝好在等 → 點更新」，但**換一個 VERSION 走不到**（Playwright 攔不到瀏覽器去比對
// `sw.js` 的那一下）。換版時清掉哪幾格、留哪幾格、少一支是不是整份不換，在這裡跑。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { fromRoot } from './helpers/paths.js';

const SRC = readFileSync(fromRoot('public/sw.js'), 'utf8');
const VERSION = SRC.match(/const VERSION = '(v\d+)';/)[1];
const ORIGIN = 'https://app.test';
const SDK = 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';

/** 跑一份 sw.js：回 handlers 與那幾個假的東西。 */
function boot({ caches: seeded = {}, failOn = null } = {}) {
  const store = new Map(Object.entries(seeded).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const abs = (u) => new URL(typeof u === 'string' ? u : u.url, ORIGIN).href;
  const cacheOf = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      match: async (u) => m.get(abs(u)),
      put: async (u, res) => { m.set(abs(u), res); },
      keys: async () => [...m.keys()].map((url) => ({ url })),
      addAll: async (reqs) => {
        const got = [];
        for (const r of reqs) {
          // eslint-disable-next-line no-await-in-loop
          got.push([abs(r), await fetched(r)]);
        }
        got.forEach(([k, v]) => m.set(k, v));
      },
    };
  };
  const network = [];
  async function fetched(r) {
    const url = abs(r);
    network.push({ url, cache: r.cache });
    if (failOn && url.endsWith(failOn)) throw new TypeError('network');
    return { ok: true, type: 'basic', url, clone() { return this; } };
  }
  const handlers = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { calls.skipWaiting += 1; },
    clients: { claim: async () => { calls.claim += 1; } },
  };
  const caches = {
    open: async (name) => cacheOf(name),
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
  };
  class Req {
    constructor(u, o = {}) { this.url = abs(u); this.cache = o.cache; }
  }
  vm.runInNewContext(SRC, { self, caches, fetch: fetched, Request: Req, URL, Promise, Set });
  return { handlers, store, network, calls };
}

/** 叫一個 extendable 事件，等它 waitUntil 的那一個。 */
async function fire(sw, type, data = {}) {
  let wait = Promise.resolve();
  let response = null;
  sw.handlers[type]({ ...data, waitUntil: (p) => { wait = p; }, respondWith: (p) => { response = p; } });
  await wait;
  return response;
}

const navigate = (path) => ({ request: { method: 'GET', url: `${ORIGIN}${path}`, mode: 'navigate' } });
const get = (url) => ({ request: { method: 'GET', url, mode: 'cors' } });

test('install：整份裝進這一版那一格、不拿瀏覽器的 HTTP 快取、**不自己接管**', async () => {
  const sw = boot();
  await fire(sw, 'install');
  const shell = sw.store.get(`shell-${VERSION}`);
  assert.ok(shell.has(`${ORIGIN}/index.html`));
  assert.ok(shell.has(`${ORIGIN}/js/app.js`));
  assert.ok(sw.network.every((n) => n.cache === 'reload'), '每一支都 cache: reload');
  assert.equal(sw.calls.skipWaiting, 0, '裝好就等著，她點了更新才換');
});

test('install：少一支沒下載到 → 這一版不算裝好（不會新舊混著）', async () => {
  const sw = boot({ failOn: '/js/app.js' });
  await assert.rejects(fire(sw, 'install'));
  assert.equal(sw.store.get(`shell-${VERSION}`)?.has(`${ORIGIN}/index.html`) ?? false, false);
});

test('換版：舊版的程式檔清掉；SDK 從舊的那一格搬過來、而且不跟著清', async () => {
  const sw = boot({
    caches: {
      'shell-v1': { [SDK]: { ok: true }, [`${ORIGIN}/js/app.js`]: { ok: true, old: true } },
    },
  });
  await fire(sw, 'install');
  await fire(sw, 'activate');
  assert.deepEqual([...sw.store.keys()].sort(), ['external-v1', `shell-${VERSION}`].sort());
  assert.ok(sw.store.get('external-v1').has(SDK), 'SDK 留著，換版後第一次離線照樣打得開');
  assert.equal(sw.calls.claim, 1);
});

test('她點了更新 → skipWaiting', async () => {
  const sw = boot();
  sw.handlers.message({ data: { type: 'skipWaiting' } });
  sw.handlers.message({ data: { type: 'other' } });
  assert.equal(sw.calls.skipWaiting, 1);
});

test('打開 app：回手機裡的 index.html，一次都不問網路', async () => {
  const sw = boot();
  await fire(sw, 'install');
  sw.network.length = 0;
  for (const path of ['/', '/index.html']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await (await fire(sw, 'fetch', navigate(path)));
    assert.equal(res.url, `${ORIGIN}/index.html`, path);
  }
  const js = await (await fire(sw, 'fetch', get(`${ORIGIN}/js/app.js`)));
  assert.equal(js.url, `${ORIGIN}/js/app.js`);
  assert.deepEqual(sw.network, [], '程式檔一支都不打到網路');
});

test('客戶填表那一頁、Google 登入轉回來那一頁、跨網域的 API：不碰', async () => {
  const sw = boot();
  await fire(sw, 'install');
  for (const ev of [
    navigate('/form.html'),
    navigate('/__/auth/handler?x=1'),
    // 登入那一頁自己載的程式、Firebase 保留的網址（authDomain 哪天改成同一個網域也不凍在手機裡）
    get(`${ORIGIN}/__/auth/handler.js`),
    get(`${ORIGIN}/__/firebase/init.json`),
    get('https://firestore.googleapis.com/v1/x'),
    { request: { method: 'POST', url: `${ORIGIN}/js/app.js`, mode: 'cors' } },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await fire(sw, 'fetch', ev), null, ev.request.url);
  }
});

test('SDK：手機裡有就用、沒有才抓而且收進自己那一格', async () => {
  const sw = boot();
  const first = await (await fire(sw, 'fetch', get(SDK)));
  assert.equal(first.url, SDK);
  assert.ok(sw.store.get('external-v1').has(SDK));
  sw.network.length = 0;
  await (await fire(sw, 'fetch', get(SDK)));
  assert.deepEqual(sw.network, []);
});
