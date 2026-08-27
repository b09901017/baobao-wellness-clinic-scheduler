// 營養品：一次購買、一個金額、好幾種、哪天順便給。
//
// 她記的樣子：`營養品(5000) : 夜態美+速體淨+粒能康+GABA 7/6 順便給`。
// ADR-0057 那一版一筆額度只指得到一款，所以 5000 沒有地方放。
// 見 `.scratch/followup-and-products/issues/09`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  itemsOf, itemNames, productLabel, amountOf, monthsOf,
  deliveredIds, undelivered, isFullyDelivered, lastDeliveredAt,
  deliveryState, noteTextFor, withDelivery, validateProduct,
} from '../public/js/domain/products.js';

const PRODUCTS = [
  { id: 'p-ye', name: '夜態美' },
  { id: 'p-su', name: '速體淨' },
  { id: 'p-li', name: '粒能康' },
  { id: 'p-ga', name: 'GABA' },
];

const bag = (over = {}) => ({
  id: 'ent-1',
  type: 'product',
  label: '營養品',
  totalQty: 2,
  amountTwd: 5000,
  items: [
    { productId: 'p-ye', name: '夜態美' },
    { productId: 'p-su', name: '速體淨' },
    { productId: 'p-li', name: '粒能康' },
    { productId: 'p-ga', name: 'GABA' },
  ],
  deliveries: [],
  ...over,
});

describe('一筆就是一次購買', () => {
  test('好幾種讀得出來', () => {
    assert.deepEqual(itemsOf(bag()).map((x) => x.name), ['夜態美', '速體淨', '粒能康', 'GABA']);
  });

  test('舊資料只有一款也讀得出來 —— 不自動搬，讀的時候相容就好', () => {
    const old = { type: 'product', productId: 'p-ye', label: '夜態美' };
    assert.deepEqual(itemsOf(old), [{ productId: 'p-ye', name: '夜態美' }]);
  });

  test('什麼都沒有就是空的', () => {
    assert.deepEqual(itemsOf({ type: 'product' }), []);
  });

  test('名字串起來', () => {
    assert.equal(itemNames(bag()), '夜態美＋速體淨＋粒能康＋GABA');
  });

  test('顯示名稱帶金額 —— 她的舊表就是那樣寫的', () => {
    assert.equal(productLabel(bag()), '營養品 5,000（夜態美＋速體淨＋粒能康＋GABA）');
  });

  test('沒有金額就不寫括號 —— 印一個 (0) 比不印糟', () => {
    assert.equal(productLabel(bag({ amountTwd: null })), '營養品（夜態美＋速體淨＋粒能康＋GABA）');
  });

  test('金額讀不出數字就是 null，不是 0', () => {
    assert.equal(amountOf(bag({ amountTwd: 'abc' })), null);
    assert.equal(amountOf(bag({ amountTwd: 0 })), null);
    assert.equal(amountOf(bag({ amountTwd: '5000' })), 5000);
  });

  test('次數是幾個月', () => {
    assert.equal(monthsOf(bag({ totalQty: 2 })), 2);
  });
});

describe('給了哪些', () => {
  const gave = (ids, at = '2026-08-27') => bag({ deliveries: [{ at, productIds: ids }] });

  test('還沒給', () => {
    assert.equal(deliveredIds(bag()).size, 0);
    assert.equal(undelivered(bag()).length, 4);
    assert.equal(isFullyDelivered(bag()), false);
  });

  test('全部給了', () => {
    const e = gave(['p-ye', 'p-su', 'p-li', 'p-ga']);
    assert.equal(isFullyDelivered(e), true);
    assert.deepEqual(undelivered(e), []);
  });

  test('給了一部分', () => {
    const e = gave(['p-ye', 'p-su']);
    assert.equal(isFullyDelivered(e), false);
    assert.deepEqual(undelivered(e).map((x) => x.name), ['粒能康', 'GABA']);
  });

  test('分兩次給完也算給完', () => {
    const e = bag({
      deliveries: [
        { at: '2026-08-27', productIds: ['p-ye', 'p-su'] },
        { at: '2026-09-10', productIds: ['p-li', 'p-ga'] },
      ],
    });
    assert.equal(isFullyDelivered(e), true);
    assert.equal(lastDeliveredAt(e), '2026-09-10');
  });

  test('一種都沒有的那一筆不算給完 —— 沒有東西可以給', () => {
    assert.equal(isFullyDelivered({ type: 'product', items: [] }), false);
  });
});

describe('現在給到哪了', () => {
  test('還沒給', () => {
    assert.equal(deliveryState(bag()).state, 'none');
    assert.equal(deliveryState(bag()).text, '還沒給');
  });

  test('給了一部分要寫出還差什麼 —— 那正是她要回去補的', () => {
    const e = bag({ deliveries: [{ at: '2026-08-27', productIds: ['p-ye', 'p-su'] }] });
    const out = deliveryState(e);
    assert.equal(out.state, 'partial');
    assert.ok(out.text.includes('粒能康'));
    assert.ok(out.text.includes('GABA'));
    assert.equal(out.at, '2026-08-27');
  });

  test('都給了', () => {
    const e = bag({ deliveries: [{ at: '2026-08-27', productIds: ['p-ye', 'p-su', 'p-li', 'p-ga'] }] });
    assert.equal(deliveryState(e).state, 'all');
    assert.equal(deliveryState(e).at, '2026-08-27');
  });

  test('還沒選是哪幾種也講得出來', () => {
    assert.equal(deliveryState({ type: 'product' }).text, '還沒選是哪幾種');
  });
});

describe('那筆提醒她順便給的隨手記', () => {
  test('寫出人跟那幾種', () => {
    assert.equal(noteTextFor(bag(), '王小明'), '給王小明營養品：夜態美＋速體淨＋粒能康＋GABA');
  });

  test('沒掛客戶就不寫名字', () => {
    assert.ok(noteTextFor(bag(), '').startsWith('給營養品：'));
  });

  test('給了一部分之後只寫剩下的 —— 留著整串她會以為都還沒給', () => {
    const e = bag({ deliveries: [{ at: '2026-08-27', productIds: ['p-ye', 'p-su'] }] });
    const text = noteTextFor(e, '王小明');
    assert.ok(text.includes('粒能康') && text.includes('GABA'));
    assert.ok(!text.includes('夜態美'));
  });
});

describe('記一次交付', () => {
  test('記進去', () => {
    const out = withDelivery(bag(), { at: '2026-08-27', productIds: ['p-ye', 'p-su'] });
    assert.deepEqual(out.deliveries, [{ at: '2026-08-27', productIds: ['p-ye', 'p-su'] }]);
  });

  test('已經給過的不重複記', () => {
    const e = bag({ deliveries: [{ at: '2026-08-27', productIds: ['p-ye'] }] });
    const out = withDelivery(e, { at: '2026-09-01', productIds: ['p-ye', 'p-su'] });
    assert.deepEqual(out.deliveries[1], { at: '2026-09-01', productIds: ['p-su'] });
  });

  test('一個都沒給就什麼都不記', () => {
    assert.equal(withDelivery(bag(), { at: '2026-08-27', productIds: [] }), null);
    const e = bag({ deliveries: [{ at: '2026-08-27', productIds: ['p-ye'] }] });
    assert.equal(withDelivery(e, { at: '2026-09-01', productIds: ['p-ye'] }), null);
  });

  test('原本那幾次不會被蓋掉', () => {
    const e = bag({ deliveries: [{ at: '2026-08-27', productIds: ['p-ye'] }] });
    assert.equal(withDelivery(e, { at: '2026-09-01', productIds: ['p-su'] }).deliveries.length, 2);
  });
});

describe('存檔前的檢查', () => {
  const check = (over) => validateProduct(bag(over), { products: PRODUCTS });

  test('好的那一筆過得去', () => {
    assert.deepEqual(check({}), []);
  });

  test('一種都沒選要擋', () => {
    assert.ok(check({ items: [] }).some((e) => /至少一種/.test(e)));
  });

  test('指到不存在的那一款要擋', () => {
    assert.ok(check({ items: [{ productId: 'p-gone', name: '不見了' }] })
      .some((e) => /不存在或已刪除/.test(e)));
  });

  test('同一種選了兩次要擋', () => {
    assert.ok(check({ items: [{ productId: 'p-ye', name: '夜態美' }, { productId: 'p-ye', name: '夜態美' }] })
      .some((e) => /選了兩次/.test(e)));
  });

  test('金額填了就要是正整數', () => {
    assert.ok(check({ amountTwd: -5 }).some((e) => /金額/.test(e)));
    assert.ok(check({ amountTwd: 'abc' }).some((e) => /金額/.test(e)));
  });

  test('金額不填可以 —— 它是選填的', () => {
    assert.deepEqual(check({ amountTwd: null }), []);
    assert.deepEqual(check({ amountTwd: '' }), []);
  });

  test('不是營養品就不管', () => {
    assert.deepEqual(validateProduct({ type: 'single', courseId: 'c1' }, { products: PRODUCTS }), []);
  });
});
