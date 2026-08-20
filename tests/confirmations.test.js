// 「跟客人確認時間」那一列的推導狀態。
//
// 最重要的一條：問過了之後，「已等 N 天」要從問的那天重新算。
// 不然她禮拜五才問過的人禮拜六就是紅的，紅字一直掛著，然後她就不看它了。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { followupNoteOf, waitedDays, waitState } from '../public/js/domain/confirmations.js';

const TODAY = '2026-08-20';

/** createdAt 是伺服器寫的 Timestamp，替身要長得像它。 */
const stamp = (iso) => ({ toDate: () => new Date(iso) });

const visit = (over = {}) => ({
  id: 'v1',
  customerId: 'c1',
  customerName: '客戶甲',
  date: '2026-09-03',
  status: 'pending_confirm',
  createdAt: stamp('2026-08-14T02:00:00'),
  followupNote: null,
  followupAt: null,
  ...over,
});

describe('那一句話', () => {
  test('一位客戶好幾天的來訪帶的是同一句', () => {
    const rows = [
      visit({ id: 'a', followupNote: '禮拜一再問問' }),
      visit({ id: 'b', followupNote: '禮拜一再問問' }),
    ];
    assert.equal(followupNoteOf(rows), '禮拜一再問問');
  });

  test('沒寫過就是 null，不是空字串', () => {
    assert.equal(followupNoteOf([visit()]), null);
    assert.equal(followupNoteOf([]), null);
  });

  test('只有其中一筆有字時也拿得到 —— 不要因為第一筆是空的就當作沒寫過', () => {
    assert.equal(
      followupNoteOf([visit({ id: 'a' }), visit({ id: 'b', followupNote: '她說再看看' })]),
      '她說再看看',
    );
  });
});

describe('等了幾天', () => {
  test('沒問過就從壓表那天算', () => {
    assert.equal(waitedDays(visit(), TODAY), 6);
  });

  test('問過了就從問的那天算，不是壓表那天', () => {
    const asked = visit({ followupNote: '禮拜一再問問', followupAt: '2026-08-19T09:00:00' });
    assert.equal(waitedDays(asked, TODAY), 1, '從 8/19 算是 1 天，從 8/14 算會變成 6 天');
  });

  test('createdAt 還沒回來時是 null，不要假裝是 0 天', () => {
    assert.equal(waitedDays(visit({ createdAt: null }), TODAY), null);
    assert.equal(waitedDays(visit({ createdAt: { toDate: () => new Date('x') } }), TODAY), null);
  });

  test('ISO 字串與 Timestamp 都吃得下 —— 兩種形狀混在同一個判斷裡', () => {
    assert.equal(waitedDays(visit({ createdAt: '2026-08-18T02:00:00' }), TODAY), 2);
    assert.equal(waitedDays(visit({ createdAt: stamp('2026-08-18T02:00:00') }), TODAY), 2);
  });
});

describe('這一列現在是什麼樣子', () => {
  test('等太久要說「久了」', () => {
    const state = waitState([visit()], TODAY, 3);
    assert.equal(state.asked, false);
    assert.equal(state.late, true);
    assert.match(state.label, /已等 6 天・久了/);
  });

  test('問過了就不算久 —— 她已經做了該做的事，剩下的是客人的回合', () => {
    const asked = visit({ followupNote: '禮拜一再問問', followupAt: '2026-08-19T09:00:00' });
    const state = waitState([asked], TODAY, 3);
    assert.equal(state.asked, true);
    assert.equal(state.late, false, '問過了不該是紅的');
    assert.equal(state.note, '禮拜一再問問');
    assert.match(state.label, /問過了・1 天前/);
  });

  test('問了很久沒回也不會變回「久了」，但天數看得出來', () => {
    const asked = visit({ followupNote: '她說再看看', followupAt: '2026-08-10T09:00:00' });
    const state = waitState([asked], TODAY, 3);
    assert.equal(state.late, false);
    assert.match(state.label, /問過了・10 天前/);
  });

  test('最久的那一筆代表這一列', () => {
    const state = waitState(
      [visit({ id: 'a', createdAt: stamp('2026-08-18T02:00:00') }),
       visit({ id: 'b', createdAt: stamp('2026-08-12T02:00:00') })],
      TODAY, 3,
    );
    assert.equal(state.waited, 8);
  });

  test('時間戳還沒回來時說「剛壓」，不要顯示已等 0 天', () => {
    const state = waitState([visit({ createdAt: null })], TODAY, 3);
    assert.equal(state.waited, null);
    assert.equal(state.late, false);
    assert.equal(state.label, '剛壓');
  });

  test('今天壓的就說今天壓的', () => {
    const state = waitState([visit({ createdAt: stamp(`${TODAY}T02:00:00`) })], TODAY, 3);
    assert.equal(state.waited, 0);
    assert.equal(state.label, '今天壓的');
  });

  test('幾天算久是設定頁調的，不要寫死', () => {
    assert.equal(waitState([visit()], TODAY, 3).late, true);
    assert.equal(waitState([visit()], TODAY, 10).late, false);
  });
});
