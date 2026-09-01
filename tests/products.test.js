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
  deliveryChoices, UNKNOWN_ITEM, productActions, existingReminder, givableBags,
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

// 2026-08 到 09 之間存進去的那幾筆 `items[].name` 是空字串（表單只送得回 id，
// 而存檔那一下把補好的名字蓋掉了）。既有的**不回頭改**（ADR-0011、0059），
// 所以認回來的責任在讀的這一側。
describe('舊資料的空名字（issues/10）', () => {
  const blank = () => bag({
    items: [{ productId: 'p-ye', name: '' }, { productId: 'p-su', name: '' }],
  });

  test('沒給主檔就照舊 —— 空的還是空的，不要假裝知道', () => {
    assert.deepEqual(itemsOf(blank()).map((x) => x.name), ['', '']);
  });

  test('給了主檔就認回來', () => {
    assert.deepEqual(
      itemsOf(blank(), { products: PRODUCTS }).map((x) => x.name),
      ['夜態美', '速體淨'],
    );
  });

  test('主檔裡也沒有（那一款被刪了）就講出來，不要留一列空白', () => {
    const gone = bag({ items: [{ productId: 'p-gone', name: '' }] });
    assert.deepEqual(itemsOf(gone, { products: PRODUCTS }).map((x) => x.name), [UNKNOWN_ITEM]);
  });

  test('她自己存下來的名字優先 —— 主檔改了名不會蓋掉舊紀錄', () => {
    const own = bag({ items: [{ productId: 'p-ye', name: '夜態美（舊包裝）' }] });
    assert.equal(itemsOf(own, { products: PRODUCTS })[0].name, '夜態美（舊包裝）');
  });

  test('顯示名稱與提醒那一句都跟著認回來', () => {
    assert.equal(productLabel(blank(), '營養品', { products: PRODUCTS }),
      '營養品 5,000（夜態美＋速體淨）');
    assert.equal(noteTextFor(blank(), '客戶A', { products: PRODUCTS }),
      '給客戶A營養品：夜態美＋速體淨');
  });
});

// 「給了什麼？」那張面板在 ui/components/note.js（碰 DOM，測不到），
// 但「有沒有東西可以列」是規則，抽到這裡才測得到。
describe('交付面板要列什麼（deliveryChoices）', () => {
  test('還沒給就全部列出來', () => {
    const out = deliveryChoices(bag());
    assert.equal(out.left.length, 4);
    assert.equal(out.nothingLeft, false);
  });

  test('給了一部分就只列剩下的', () => {
    const out = deliveryChoices(bag({ deliveries: [{ at: '2026-07-06', productIds: ['p-ye', 'p-su'] }] }));
    assert.deepEqual(out.left.map((x) => x.productId), ['p-li', 'p-ga']);
  });

  test('**每一款都給過了 → nothingLeft**，那時不可以開一張按不下去的面板', () => {
    const out = deliveryChoices(bag({
      deliveries: [{ at: '2026-07-06', productIds: ['p-ye', 'p-su', 'p-li', 'p-ga'] }],
    }));
    assert.equal(out.nothingLeft, true);
    assert.equal(out.everGave, true, '分得出「給完了」與「本來就沒選過」');
  });

  test('**一款都沒選的舊資料也是 nothingLeft**，但講的話不一樣', () => {
    const out = deliveryChoices(bag({ items: [] }));
    assert.equal(out.nothingLeft, true);
    assert.equal(out.everGave, false);
  });
});

// 客戶詳情那一列以前直接落進「調整」那一張表。她點它十次有九次要問的是
// 「這一包給了沒、什麼時候給」，不是「改幾個月」（issue 11、ADR-0060）。
describe('客戶詳情那一列有哪幾顆（productActions）', () => {
  const ids = (e, note) => productActions(e, note).map((a) => a.id);

  test('三顆：約時間、已經給了、編輯', () => {
    assert.deepEqual(ids(bag(), null), ['when', 'gave', 'edit']);
  });

  test('還沒約就寫「約時間」，約了就寫「改時間」並帶出是哪一天', () => {
    assert.equal(productActions(bag(), null)[0].label, '約時間');
    const dated = productActions(bag(), { date: '2026-09-03' })[0];
    assert.equal(dated.label, '改時間');
    assert.match(dated.note, /2026-09-03/);
  });

  test('都給完了就沒有「已經給了」 —— 那一顆按下去只會跳一張空的', () => {
    const done = bag({ deliveries: [{ at: '7/6', productIds: ['p-ye', 'p-su', 'p-li', 'p-ga'] }] });
    assert.deepEqual(ids(done, null), ['when', 'edit']);
  });
});

describe('這一包配的是哪一筆提醒（existingReminder）', () => {
  const notes = [
    { id: 'n1', entitlementId: 'ent-1', done: false },
    { id: 'n2', entitlementId: 'ent-2', done: false },
  ];

  test('靠 entitlementId 連著', () => {
    assert.equal(existingReminder(notes, 'ent-1').id, 'n1');
  });

  test('已經勾掉的不算 —— 那一筆講的是上一次的交付', () => {
    assert.equal(existingReminder([{ id: 'n1', entitlementId: 'ent-1', done: true }], 'ent-1'), null);
  });

  test('刪掉的不算', () => {
    assert.equal(
      existingReminder([{ id: 'n1', entitlementId: 'ent-1', done: false, deletedAt: 'x' }], 'ent-1'),
      null,
    );
  });

  test('找不到回 null，不是 undefined', () => {
    assert.equal(existingReminder(notes, 'ent-9'), null);
    assert.equal(existingReminder([], null), null);
  });
});

// 記隨手記時那顆「給營養品」（issue 12）。她要記的那件事本來就有專門的形狀
// （一筆掛了 entitlementId 的隨手記），所以那一顆是捷徑不是新欄位。
describe('誰現在有東西可以給（givableBags）', () => {
  const customers = [
    { id: 'c1', name: '客戶A' },
    { id: 'c2', name: '客戶B' },
    { id: 'c3', name: '客戶C', active: false },
  ];

  test('只列還沒給完的那幾包', () => {
    const out = givableBags({
      customers,
      entitlementsBy: {
        c1: [bag({ id: 'e1' })],
        c2: [bag({ id: 'e2', deliveries: [{ at: '7/6', productIds: ['p-ye', 'p-su', 'p-li', 'p-ga'] }] })],
      },
    });
    assert.deepEqual(out.map((r) => r.customerId), ['c1']);
    assert.deepEqual(out[0].bags.map((b) => b.entitlementId), ['e1']);
  });

  test('一包都不剩的客戶整位不出現', () => {
    const out = givableBags({ customers, entitlementsBy: { c1: [] } });
    assert.deepEqual(out, []);
  });

  test('停用的客戶不出現', () => {
    const out = givableBags({ customers, entitlementsBy: { c3: [bag({ id: 'e3' })] } });
    assert.deepEqual(out, []);
  });

  test('不是營養品的額度不算', () => {
    const out = givableBags({
      customers,
      entitlementsBy: { c1: [{ id: 'x', type: 'single', courseId: 'c-checkup' }] },
    });
    assert.deepEqual(out, []);
  });

  test('已經約了的那幾包照樣列，只是標出來 —— 她可能就是要改成今天給', () => {
    const out = givableBags({
      customers,
      entitlementsBy: { c1: [bag({ id: 'e1' })] },
      notes: [{ id: 'n1', entitlementId: 'e1', done: false, date: '2026-09-03' }],
    });
    assert.match(out[0].bags[0].hint, /2026-09-03 已經約了/);
  });

  test('還差哪幾款要寫出來 —— 「還差什麼」正是她要回去補的東西', () => {
    const out = givableBags({
      customers,
      entitlementsBy: { c1: [bag({ id: 'e1', deliveries: [{ at: '7/6', productIds: ['p-ye', 'p-su'] }] })] },
    });
    assert.match(out[0].bags[0].hint, /粒能康＋GABA/);
  });

  test('舊資料的空名字也認得回來', () => {
    const out = givableBags({
      customers,
      entitlementsBy: { c1: [bag({ id: 'e1', items: [{ productId: 'p-ye', name: '' }] })] },
      master: { products: PRODUCTS },
    });
    assert.match(out[0].bags[0].hint, /夜態美/);
  });
});
