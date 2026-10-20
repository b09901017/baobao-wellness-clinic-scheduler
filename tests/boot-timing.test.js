// 量開機（`ui/bootTiming.js`，after-golive 05）。
//
// 瀏覽器那一半（真的開機、設定頁那一張卡、記不住照樣開機）在 E2E `79-boot-timing`；
// 這裡盯的是：記的是時間點不是長度、哪幾次不記、沒走完的那幾次也留著、記不住的時候一行都不丟例外。

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOT_KEY, KEEP, STEPS, begin, cleanBoots, drop, mark, missedData, readBoots, secs, stepsOf, withBoot, withoutBoot,
} from '../public/js/ui/bootTiming.js';

const at = (iso) => new Date(iso).getTime();
const boot = (iso, marks = { code: 900, auth: 1700, access: 2100, shell: 2150, data: 2600 }) => ({
  at: at(iso), home: true, sw: true, marks, done: true,
});

describe('存回去的那一份', () => {
  test('新的在最前面、最多 10 筆', () => {
    let list = [];
    for (let i = 0; i < KEEP + 3; i += 1) list = withBoot(list, boot(`2026-10-21T0${i % 10}:00:00+08:00`));
    assert.equal(list.length, KEEP);
    assert.equal(list[0].at, at('2026-10-21T02:00:00+08:00'));
  });

  test('同一次開機再寫一次是換掉那一筆，不是多一筆；今天第一次照舊跟上一次開機比', () => {
    const yesterday = withBoot([], boot('2026-10-20T22:00:00+08:00'));
    const partial = withBoot(yesterday, { ...boot('2026-10-21T08:30:00+08:00', { code: 900 }), done: false });
    const full = withBoot(partial, boot('2026-10-21T08:30:00+08:00'));
    assert.equal(full.length, 2);
    assert.equal(full[0].done, true);
    assert.equal(full[0].marks.data, 2600);
    assert.equal(full[0].firstToday, true);
  });

  test('今天第一次、隔了幾分鐘（跟上一次比）', () => {
    const first = withBoot([], boot('2026-10-20T22:00:00+08:00'));
    assert.equal(first[0].firstToday, true);
    assert.equal(first[0].gapMin, null);
    const morning = withBoot(first, boot('2026-10-21T08:30:00+08:00'));
    assert.equal(morning[0].firstToday, true, '台灣的隔天，不是 UTC 的');
    assert.equal(morning[0].gapMin, 630);
    const again = withBoot(morning, boot('2026-10-21T08:35:00+08:00'));
    assert.equal(again[0].firstToday, false);
    assert.equal(again[0].gapMin, 5);
  });

  test('拿掉這一次那一筆（寫過幾步之後才知道不算）', () => {
    const list = withBoot(withBoot([], boot('2026-10-20T22:00:00+08:00')), boot('2026-10-21T08:30:00+08:00'));
    assert.deepEqual(withoutBoot(list, at('2026-10-21T08:30:00+08:00')).map((r) => r.at), [at('2026-10-20T22:00:00+08:00')]);
  });

  test('存著的那一份壞掉（不是陣列、null、少了時間或步驟）略過，不會讓設定頁畫不出來', () => {
    assert.deepEqual(cleanBoots('壞掉'), []);
    assert.deepEqual(cleanBoots([null, {}, { at: 'x', marks: {} }, { at: 1 }]), []);
    assert.equal(withBoot([null, { at: 'x' }], boot('2026-10-21T08:00:00+08:00')).length, 1);
  });
});

describe('卡上那一列', () => {
  test('照時間先後排、最後一步就是總數（之後各步會重疊，不假設照順序到）', () => {
    const { steps, total } = stepsOf({ marks: { code: 900, shell: 1000, auth: 1700, access: 2100, data: 1200 } });
    assert.deepEqual(steps.map((s) => s.id), ['code', 'shell', 'data', 'auth', 'access']);
    assert.equal(total, 2100);
  });

  test('從別頁打開的只到「畫面」；認不得的步、不是數字的略過', () => {
    const { steps, total } = stepsOf({ marks: { code: 900, auth: 1700, access: 2100, shell: 2150, extra: 9999, data: 'x' } });
    assert.deepEqual(steps.map((s) => s.label), ['程式', '登入', '權限', '畫面']);
    assert.equal(total, 2150);
  });

  test('沒等到數字：從首頁打開、沒有「資料」那一步的才算', () => {
    assert.equal(missedData({ home: true, marks: { code: 1, auth: 2 } }), true);
    assert.equal(missedData({ home: true, marks: { code: 1, data: 3 } }), false);
    assert.equal(missedData({ home: false, marks: { code: 1, shell: 2 } }), false);
  });

  test('五步的字', () => {
    assert.deepEqual(STEPS.map((s) => s.label), ['程式', '登入', '權限', '畫面', '資料']);
  });

  test('秒數一位小數', () => {
    assert.equal(secs(2834), '2.8');
    assert.equal(secs(50), '0.1');
    assert.equal(secs(0), '0.0');
  });
});

describe('這一次開機', () => {
  /**
   * 一台假的瀏覽器：只有這一支碰到的那幾樣。`fire('hashchange')` 模擬她換頁；
   * `reopen()` 模擬重新打開 —— 每一次打開的 `timeOrigin` 不一樣（同一個 node 行程裡它是同一個）。
   */
  let opened = Date.parse('2026-10-21T08:00:00+08:00');
  function reopen() {
    opened += 60_000;
    Object.defineProperty(performance, 'timeOrigin', { configurable: true, value: opened });
  }
  function fakeBrowser({ storage = new Map(), blocked = false } = {}) {
    reopen();
    const listeners = [];
    globalThis.addEventListener = (type, fn) => listeners.push({ type, fn });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        if (blocked) throw new Error('SecurityError');
        return {
          getItem: (k) => (storage.has(k) ? storage.get(k) : null),
          setItem: (k, v) => storage.set(k, String(v)),
        };
      },
    });
    return {
      storage,
      fire: (type) => listeners.filter((l) => l.type === type).forEach((l) => l.fn()),
    };
  }
  const saved = (storage) => JSON.parse(storage.get(BOOT_KEY) ?? '[]');

  beforeEach(() => { delete globalThis.addEventListener; });

  test('從首頁打開：每到一步就寫一次，走完標 done；同一步只記第一次', () => {
    const { storage } = fakeBrowser();
    begin({ home: true });
    mark('auth');
    mark('access');
    mark('shell');
    assert.deepEqual(Object.keys(saved(storage)[0].marks), ['code', 'auth', 'access', 'shell'], '還沒看到數字也先寫著');
    assert.equal(saved(storage)[0].done, false);
    mark('data');
    mark('data');
    mark('auth');
    const list = saved(storage);
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0].marks), ['code', 'auth', 'access', 'shell', 'data']);
    assert.equal(list[0].done, true);
  });

  test('從別頁打開：到「畫面」就走完，之後回首頁畫出數字不算', () => {
    const { storage } = fakeBrowser();
    begin({ home: false });
    mark('auth');
    mark('access');
    mark('shell');
    assert.equal(saved(storage)[0].done, true);
    mark('data');
    assert.equal(saved(storage)[0].marks.data, undefined);
  });

  test('還沒走完就換頁：停在換頁之前（留著、標沒等到數字），之後回首頁不算', () => {
    const { storage, fire } = fakeBrowser();
    begin({ home: true });
    mark('auth');
    fire('hashchange');
    mark('access');
    mark('shell');
    mark('data');
    const [rec] = saved(storage);
    assert.deepEqual(Object.keys(rec.marks), ['code', 'auth']);
    assert.equal(missedData(rec), true);
  });

  test('登入頁、沒有權限、連不上、首頁讀不到（drop）：已經寫的那幾步也拿掉，上一次的留著', () => {
    const { storage } = fakeBrowser();
    begin({ home: false });
    mark('auth');
    mark('access');
    mark('shell');
    reopen();
    begin({ home: true });
    mark('auth');
    drop();
    mark('access');
    mark('shell');
    mark('data');
    assert.equal(saved(storage).length, 1, '只剩上一次那一筆');
    assert.equal(saved(storage)[0].home, false);
  });

  test('localStorage 被擋掉：一行都不丟例外，設定頁讀到「記不住」', () => {
    fakeBrowser({ blocked: true });
    assert.doesNotThrow(() => {
      begin({ home: true });
      mark('auth');
      drop();
      mark('data');
    });
    assert.deepEqual(readBoots(), { ok: false, list: [] });
  });

  test('存著的內容壞掉：照樣記得下去、讀得出來', () => {
    const { storage } = fakeBrowser({ storage: new Map([[BOOT_KEY, '{壞掉']]) });
    begin({ home: false });
    mark('shell');
    assert.equal(readBoots().list.length, 1);
    storage.set(BOOT_KEY, '[null,{}]');
    assert.deepEqual(readBoots(), { ok: true, list: [] });
  });
});
