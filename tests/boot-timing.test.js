// 量開機（`ui/bootTiming.js`，after-golive 05）。
//
// 瀏覽器那一半（真的開機、設定頁那一張卡、localStorage 被擋掉照樣開機）在 E2E `79-boot-timing`；
// 這裡盯的是：記的是時間點不是長度、哪幾次不記、記不住的時候一行都不丟例外。

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOT_KEY, KEEP, STEPS, begin, drop, isHomeHash, mark, readBoots, secs, stepsOf, withBoot,
} from '../public/js/ui/bootTiming.js';

const at = (iso) => new Date(iso).getTime();
const boot = (iso, marks = { code: 900, auth: 1700, access: 2100, shell: 2150, data: 2600 }) => ({
  at: at(iso), home: true, sw: true, marks,
});

describe('存回去的那一份', () => {
  test('新的在最前面、最多 10 筆', () => {
    let list = [];
    for (let i = 0; i < KEEP + 3; i += 1) list = withBoot(list, boot(`2026-10-21T0${i % 10}:00:00+08:00`));
    assert.equal(list.length, KEEP);
    assert.equal(list[0].at, at('2026-10-21T02:00:00+08:00'));
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

  test('存著的那一份壞掉（不是陣列、少了時間）不會讓這一次記不下去', () => {
    assert.equal(withBoot('壞掉', boot('2026-10-21T08:00:00+08:00')).length, 1);
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

  test('五步的字', () => {
    assert.deepEqual(STEPS.map((s) => s.label), ['程式', '登入', '權限', '畫面', '資料']);
  });

  test('秒數一位小數', () => {
    assert.equal(secs(2834), '2.8');
    assert.equal(secs(50), '0.1');
    assert.equal(secs(0), '0.0');
  });

  test('從首頁打開＝`#/` 或沒有 hash', () => {
    assert.equal(isHomeHash(''), true);
    assert.equal(isHomeHash('#/'), true);
    assert.equal(isHomeHash('#/customers'), false);
  });
});

describe('這一次開機', () => {
  /** 一台假的瀏覽器：只有這一支碰到的那幾樣。 */
  function fakeBrowser({ hash = '#/', storage = new Map(), blocked = false } = {}) {
    globalThis.location = { hash };
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
    return storage;
  }
  const saved = (storage) => JSON.parse(storage.get(BOOT_KEY) ?? '[]');

  beforeEach(() => { delete globalThis.location; });

  test('從首頁打開：五步都到了才記一筆；同一步只記第一次', () => {
    const storage = fakeBrowser();
    begin();
    mark('auth');
    mark('access');
    mark('shell');
    assert.equal(saved(storage).length, 0, '還沒看到數字，不記');
    mark('data');
    mark('data');
    mark('auth');
    const [rec] = saved(storage);
    assert.deepEqual(Object.keys(rec.marks), ['code', 'auth', 'access', 'shell', 'data']);
    assert.equal(rec.home, true);
    assert.equal(saved(storage).length, 1);
  });

  test('從別頁打開：到「畫面」就記好，之後回到首頁畫出數字不算', () => {
    const storage = fakeBrowser({ hash: '#/customers' });
    begin();
    mark('auth');
    mark('access');
    mark('shell');
    assert.deepEqual(Object.keys(saved(storage)[0].marks), ['code', 'auth', 'access', 'shell']);
    mark('data');
    assert.equal(saved(storage).length, 1);
    assert.equal(saved(storage)[0].marks.data, undefined);
  });

  test('登入頁、沒有權限、連不上（drop）：整筆不記', () => {
    const storage = fakeBrowser();
    begin();
    mark('auth');
    drop();
    mark('access');
    mark('shell');
    mark('data');
    assert.equal(saved(storage).length, 0);
  });

  test('localStorage 被擋掉：一行都不丟例外，設定頁讀到「記不住」', () => {
    fakeBrowser({ blocked: true });
    assert.doesNotThrow(() => {
      begin();
      mark('auth');
      mark('access');
      mark('shell');
      mark('data');
    });
    assert.deepEqual(readBoots(), { ok: false, list: [] });
  });

  test('連 location 都沒有（不是瀏覽器）：不丟例外、什麼都不記', () => {
    const storage = fakeBrowser();
    delete globalThis.location;
    assert.doesNotThrow(() => { begin(); mark('data'); });
    assert.equal(saved(storage).length, 0);
  });
});
