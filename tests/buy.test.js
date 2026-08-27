// 「買了什麼」那一張表的規則（`ui/components/buy.js`）。
//
// 那一支的**上半段沒有一行碰 DOM** —— 產生 HTML 字串、算顯示名稱、
// 把草稿翻成一筆額度，全部是純函式。這裡測的就是那一段。
// 下半段的 `wire()` 是接線（會碰 DOM），測不到，所以它刻意薄到只剩
// 「讀表單 → 叫上半段 → 交給呼叫端重畫」。
//
// 這張表被**三個入口**共用（客戶詳情的「加購」、新增客戶那一頁、
// 批次建立那一頁的「微調」），所以「動了一下之後草稿變成什麼」錯掉的話，
// 三個畫面會同時錯。
//
// 讀值那一段收一個 `form`，測試餵的是 `{ elements: {...} }` ——
// 它只問「這個欄位在不在畫面上」，不問 DOM 的任何其他事。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import * as buy from '../public/js/ui/components/buy.js';

const MASTER = {
  courses: [
    { id: 'c-checkup', name: '健檢', followupCourseId: 'c-followup' },
    { id: 'c-drip', name: '營養點滴', requiresIvProduct: true },
    { id: 'c-recovery', name: '復能', requiresEquipment: true },
  ],
  equipment: [
    { id: 'eq-indiba', name: 'INDIBA' },
    { id: 'eq-sis', name: '超磁場' },
  ],
  ivProducts: [
    { id: 'iv-snow', name: '雪顏亮彩' },
    { id: 'iv-liver', name: '護肝排毒' },
  ],
  products: [
    { id: 'prod-yetaimei', name: '夜態美' },
    { id: 'prod-gaba', name: 'GABA' },
  ],
};

/** 從一張空白草稿選一顆丸子。 */
const from = (...values) =>
  values.reduce((e, v) => ({ ...e, ...buy.pick(v, e, MASTER) }), buy.blank());

describe('買了什麼：選了之後草稿變成什麼', () => {
  test('選一個課程就把名稱帶進來 —— 她一個字都不用打', () => {
    const e = from('c-recovery');
    assert.equal(e.type, 'single');
    assert.equal(e.courseId, 'c-recovery');
    assert.equal(e.label, '復能');
  });

  test('擇一池預設帶上全部器材', () => {
    const e = from(buy.POOL_PICK);
    assert.equal(e.type, 'pool');
    assert.equal(e.courseId, null);
    assert.deepEqual(e.optionEquipmentIds, ['eq-indiba', 'eq-sis']);
  });

  test('營養品是第三種型態，沒有課程也沒有器材', () => {
    const e = from(buy.PRODUCT_PICK);
    assert.equal(e.type, 'product');
    assert.equal(e.courseId, null);
    assert.deepEqual(e.optionEquipmentIds, []);
  });

  test('選了營養品再選課程，型態與名稱都跟著回去', () => {
    const e = from(buy.PRODUCT_PICK, 'c-recovery');
    assert.equal(e.type, 'single');
    assert.equal(e.label, '復能', '「夜態美」不可以留在課程的名字上');
  });

  test('換到不配二返的課程就把等級丟掉 —— 「8萬復能」是一句沒有意義的話', () => {
    const checkup = { ...from('c-checkup'), tier: '8萬', label: '8萬健檢' };
    const next = { ...checkup, ...buy.pick('c-recovery', checkup, MASTER) };
    assert.equal(next.tier, null);
    assert.equal(next.label, '復能');
  });

  test('換去別的課程再換回健檢，她挑過的等級留著', () => {
    const checkup = { ...from('c-checkup'), tier: '8萬', label: '8萬健檢' };
    const drip = { ...checkup, ...buy.pick('c-drip', checkup, MASTER) };
    const back = { ...drip, ...buy.pick('c-checkup', drip, MASTER) };
    assert.equal(back.tier, null, '中間換過就是換過了，不要偷偷記著');
    assert.equal(back.label, '健檢');
  });

  test('換到別的課程再換回營養點滴，她挑過的品項留著', () => {
    const drip = { ...from('c-drip'), ivProductId: 'iv-snow' };
    const other = { ...drip, ...buy.pick('c-recovery', drip, MASTER) };
    assert.equal(other.ivProductId, null);
  });
});

describe('顯示名稱：三種接法', () => {
  test('健檢是等級加課程名（ADR-0054）', () => {
    assert.equal(buy.autoLabel({ type: 'single', courseId: 'c-checkup', tier: '8萬' }, MASTER), '8萬健檢');
    assert.equal(buy.autoLabel({ type: 'single', courseId: 'c-checkup' }, MASTER), '健檢');
  });

  test('營養點滴是課程名接品項，跟匯進來的那幾筆一模一樣', () => {
    assert.equal(
      buy.autoLabel({ type: 'single', courseId: 'c-drip', ivProductId: 'iv-snow' }, MASTER),
      '營養點滴 - 雪顏亮彩',
    );
    assert.equal(buy.autoLabel({ type: 'single', courseId: 'c-drip' }, MASTER), '營養點滴');
  });

  test('營養品是金額加那幾款 —— 一次購買一筆', () => {
    // 她記的是 `營養品(5000) : 夜態美+速體淨+粒能康+GABA`，那是一筆不是四筆
    assert.equal(
      buy.autoLabel({
        type: 'product',
        amountTwd: 5000,
        items: [{ productId: 'prod-gaba', name: 'GABA' }, { productId: 'prod-yetaimei', name: '夜態美' }],
      }, MASTER),
      '營養品 5,000（GABA＋夜態美）',
    );
  });

  test('舊資料（單數的 productId）照樣讀得出來', () => {
    assert.equal(
      buy.autoLabel({ type: 'product', productId: 'prod-gaba', label: 'GABA' }, MASTER),
      '營養品（GABA）',
    );
  });

  test('一款都還沒選就不給名字 —— 那是在講一件還沒發生的事', () => {
    assert.equal(buy.autoLabel({ type: 'product', items: [] }, MASTER), '');
  });

  test('她自己打過的名字不會被下一次點擊蓋掉', () => {
    const mine = { ...from('c-checkup'), label: '客戶A的健檢' };
    assert.equal(buy.keptLabel(mine, MASTER), '客戶A的健檢');
    const next = { ...mine, ...buy.pick('c-recovery', mine, MASTER) };
    assert.equal(next.label, '客戶A的健檢');
  });

  test('app 自己填的那一個不算「她改過」', () => {
    assert.equal(buy.keptLabel(from('c-recovery'), MASTER), null);
  });

  test('換等級時的改名也走同一個判斷', () => {
    const before = from('c-checkup');
    const after = { ...before, tier: '12萬' };
    assert.equal(buy.retitle(before, after, MASTER), '12萬健檢');

    const mine = { ...before, label: '客戶A的健檢' };
    assert.equal(buy.retitle(mine, { ...mine, tier: '12萬' }, MASTER), '客戶A的健檢');
  });
});

describe('動了一下之後的整張草稿', () => {
  // 這一段以前散在三個呼叫端各寫一次，於是「其他…」那一格漏了兩次
  // （`.scratch/buying-in-bulk/issues/02`）。

  test('選了一顆課程：她還沒送出去的字也要留著', () => {
    const draft = from('c-checkup');
    const next = buy.afterPick('c-drip', draft, { totalQty: 7, tier: null }, MASTER);

    assert.equal(next.courseId, 'c-drip');
    assert.equal(next.totalQty, 7, '她打在「幾次」那一格的數字不可以被丟掉');
    assert.equal(next.tier, null, '營養點滴沒有「幾萬的」');
    assert.equal(next.label, '營養點滴');
  });

  test('選了一顆課程：等級拿草稿上的那一版去問，不是表單上的', () => {
    // 兩邊在畫面上永遠一致（換了等級就改名），混著問會得出「她改過名稱」——
    // 然後「8萬健檢」就會跟著她換到復能去。
    const draft = { ...from('c-checkup'), tier: '8萬', label: '8萬健檢' };
    const next = buy.afterPick('c-recovery', draft, { tier: '8萬', label: '8萬健檢' }, MASTER);
    assert.equal(next.label, '復能');
    assert.equal(next.tier, null);
  });

  test('選了一顆課程：她自己打的名稱不覆蓋', () => {
    const draft = { ...from('c-checkup'), label: '客戶A的健檢' };
    const next = buy.afterPick('c-recovery', draft, { label: '客戶A的健檢' }, MASTER);
    assert.equal(next.label, '客戶A的健檢');
  });

  test('換了「幾萬的」，名稱跟著換', () => {
    const draft = from('c-checkup');
    const next = buy.afterDetail(draft, { tier: '8萬', tierOther: false }, MASTER);
    assert.equal(next.label, '8萬健檢');
  });

  test('換了「哪一種」，名稱跟著換', () => {
    const next = buy.afterDetail(from('c-drip'), { ivProductId: 'iv-liver' }, MASTER);
    assert.equal(next.label, '營養點滴 - 護肝排毒');
  });

  test('「其他…」那一格打字，名稱也要跟著換', () => {
    // 她的原話：「如果是幾萬建檢選其他，名稱不會自動改?」
    const draft = { ...from('c-checkup'), tierOther: true };
    const next = buy.afterDetail(draft, { tier: '5萬', tierOther: true }, MASTER);
    assert.equal(next.tier, '5萬');
    assert.equal(next.label, '5萬健檢');
  });

  test('**連著打第二個字也要跟** —— 拿上一版去問，不是拿更早那一版', () => {
    // 打字不重畫，所以呼叫端每一下都要把回傳的草稿收起來。沒收的話
    // 第二個字開始，app 自己填的「5萬健檢」會被誤判成「她改過的名稱」。
    let draft = { ...from('c-checkup'), tierOther: true };
    for (const typed of ['5', '5萬', '5萬(', '5萬(心臟)']) {
      draft = buy.afterDetail(draft, { tier: typed, tierOther: true }, MASTER);
    }
    assert.equal(draft.label, '5萬(心臟)健檢');
  });

  test('打字時她自己打過的名稱一樣不覆蓋', () => {
    let draft = { ...from('c-checkup'), tierOther: true, label: '客戶A的健檢' };
    draft = buy.afterDetail(draft, { tier: '5萬', label: '客戶A的健檢' }, MASTER);
    assert.equal(draft.label, '客戶A的健檢');
    assert.equal(draft.tier, '5萬', '名稱不改，等級還是要存下去');
  });
});

describe('讀值：沒在畫面上的欄位不回報', () => {
  // 少帶一個欄位就等於把它清成 null（ADR-0054 的 Consequences），
  // 而「調整」那一張表沒有這幾排。
  const formWith = (...names) => ({ elements: Object.fromEntries(names.map((n) => [n, {}])) });

  test('調整那一張表沒有這幾排，就一個都不回報', () => {
    assert.deepEqual(buy.read(formWith(), { tier: '8萬', productId: 'x' }), {});
  });

  test('「其他…」讀的是那一格打的字', () => {
    const out = buy.read(formWith('tier'), { tier: buy.TIER_OTHER, tierText: ' 5萬(心臟) ' });
    assert.deepEqual(out, { tier: '5萬(心臟)', tierOther: true });
  });

  test('等級沒選就是 null，不要留空字串', () => {
    assert.deepEqual(buy.read(formWith('tier'), { tier: null }), { tier: null, tierOther: false });
  });

  test('品項那兩排各自獨立', () => {
    assert.deepEqual(buy.read(formWith('ivProductId'), { ivProductId: 'iv-liver' }), { ivProductId: 'iv-liver' });
  });

  test('營養品讀回好幾款與金額', () => {
    const out = buy.read(formWith('productIds'), {
      productIds: 'prod-gaba\nprod-yetaimei', amountTwd: '5000',
    });
    assert.deepEqual(out.items.map((x) => x.productId), ['prod-gaba', 'prod-yetaimei']);
    assert.equal(out.amountTwd, 5000);
    assert.equal(out.newProduct, false);
  });

  test('金額留白是 null 不是 0 —— 那是兩件事', () => {
    assert.equal(buy.read(formWith('productIds'), { productIds: 'prod-gaba', amountTwd: '' }).amountTwd, null);
  });

  test('「＋ 新增…」不是一款，是一顆展開輸入框的鈕', () => {
    const out = buy.read(formWith('productIds'), {
      productIds: `prod-gaba\n${buy.PRODUCT_NEW}`, newProductName: '  Q10  ',
    });
    assert.deepEqual(out.items.map((x) => x.productId), ['prod-gaba']);
    assert.equal(out.newProduct, true);
    assert.equal(out.newProductName, 'Q10');
  });
});

describe('存得下去嗎', () => {
  test('一張什麼都還沒點的表，只講一句話', () => {
    assert.deepEqual(buy.validate(buy.blank(), MASTER), ['先選一個「買了什麼」']);
  });

  test('選了才輪到欄位的驗證', () => {
    const drip = { ...from('c-drip'), ivProductId: 'iv-snow' };
    assert.deepEqual(buy.validate(drip, MASTER), []);
    assert.deepEqual(
      buy.validate({ ...from(buy.PRODUCT_PICK), label: 'x' }, MASTER),
      ['要選至少一種營養品'],
    );
  });
});

describe('草稿翻成一筆額度', () => {
  test('營養品不帶課程、器材、時長與頻率', () => {
    const e = {
      ...from(buy.PRODUCT_PICK),
      items: [{ productId: 'prod-gaba', name: 'GABA' }],
      amountTwd: 5000, label: '營養品 5,000（GABA）', totalQty: 2,
    };
    const doc = buy.payload(e);
    assert.equal(doc.type, 'product');
    assert.deepEqual(doc.items, [{ productId: 'prod-gaba', name: 'GABA' }]);
    assert.equal(doc.amountTwd, 5000);
    // 新的一律寫進 items —— 單數的 productId 只留著讀得懂舊資料
    assert.equal(doc.productId, null);
    assert.equal(doc.courseId, null);
    assert.equal(doc.optionEquipmentIds, null);
    assert.equal(doc.durationMin, null);
    assert.equal(doc.frequencyRule, null);
    assert.equal(doc.ivProductId, null);
  });

  test('營養點滴帶著品項，營養品的那個欄位是空的', () => {
    const doc = buy.payload({ ...from('c-drip'), ivProductId: 'iv-snow', totalQty: 5 });
    assert.equal(doc.ivProductId, 'iv-snow');
    assert.equal(doc.productId, null);
    assert.equal(doc.courseId, 'c-drip');
  });

  test('擇一池帶器材不帶課程', () => {
    const doc = buy.payload(from(buy.POOL_PICK));
    assert.equal(doc.courseId, null);
    assert.deepEqual(doc.optionEquipmentIds, ['eq-indiba', 'eq-sis']);
  });

  test('單項加購不指回任何範本（ADR-0003）', () => {
    const doc = buy.toEntitlement(from('c-recovery'), { purchasedAt: '2026-08-25' });
    assert.equal(doc.sourcePlanName, null);
    assert.equal(doc.purchasedAt, '2026-08-25');
    assert.equal(doc.doneCount, 0);
    assert.equal(doc.bookedCount, 0);
    assert.equal(doc.lastReconciledAt, null);
  });
});

describe('畫出來的那幾排', () => {
  test('營養品那一顆前面隔一條線 —— 它不是課程', () => {
    const html = buy.fields(buy.blank(), MASTER);
    const lead = html.indexOf('chiprow__lead');
    assert.ok(html.includes('<span class="chiprow__lead">商品</span>'));
    assert.ok(lead > html.indexOf('復能（三選一池）'), '線要在課程那一組後面');
    assert.ok(lead < html.lastIndexOf('營養品'), '線要在營養品那一顆前面');
  });

  test('營養品那一顆一直在，而且排在最後', () => {
    const html = buy.fields(buy.blank(), MASTER);
    const order = ['健檢', '營養點滴', '復能', '復能（三選一池）', '營養品'];
    let at = -1;
    for (const label of order) {
      const found = html.indexOf(label);
      assert.ok(found > at, `「${label}」的順序不對`);
      at = found;
    }
  });

  test('選了健檢才有「幾萬的」，選了營養點滴才有「哪一種」', () => {
    assert.ok(!buy.fields(buy.blank(), MASTER).includes('幾萬的'));
    assert.ok(buy.fields(from('c-checkup'), MASTER).includes('幾萬的'));
    assert.ok(!buy.fields(from('c-checkup'), MASTER).includes('哪一種'));
    assert.ok(buy.fields(from('c-drip'), MASTER).includes('哪一種'));
    assert.ok(buy.fields(from(buy.PRODUCT_PICK), MASTER).includes('哪幾種'));
  });

  test('營養品論個月，其餘論次', () => {
    // 她的原話：「次數1就是一個月2就是兩個月的」。以前寫「份」是猜的 ——
    // 一次購買裡有四款，「2 份」那個數字對不上任何東西。
    assert.ok(buy.fields(from(buy.PRODUCT_PICK), MASTER).includes('幾個月'));
    assert.ok(buy.fields(from('c-recovery'), MASTER).includes('幾次'));
    assert.equal(
      buy.summaryLine({ label: '營養品 5,000（夜態美）', totalQty: 2, type: 'product' }),
      '營養品 5,000（夜態美） 2 個月',
    );
    assert.equal(buy.summaryLine({ label: '復能', totalQty: 5, type: 'single' }), '復能 5 次');
  });

  test('還沒選品項就不預告名字 —— 那是在講一件還沒發生的事', () => {
    assert.ok(!buy.fields(from('c-drip'), MASTER).includes('會變成'));
    const picked = { ...from('c-drip'), ivProductId: 'iv-snow' };
    assert.ok(buy.fields(picked, MASTER).includes('會變成「營養點滴 - 雪顏亮彩」'));
  });

  test('一個下拉選單都沒有', () => {
    for (const e of [buy.blank(), from('c-checkup'), from('c-drip'), from(buy.PRODUCT_PICK)]) {
      assert.ok(!buy.fields(e, MASTER).includes('<select'), '她說過不要下拉選單');
    }
  });
});

describe('「＋ 新增…」那一款', () => {
  const master = () => ({ products: [{ id: 'p-1', name: '夜態美' }] });
  const draft = (over = {}) => ({
    type: 'product', items: [], newProduct: true, newProductName: 'Q10', label: '', ...over,
  });

  test('寫進主檔並且選起來', async () => {
    const m = master();
    const created = [];
    const out = await buy.commitNewProduct(draft(), m, async (row) => {
      created.push(row);
      return 'p-new';
    });

    assert.deepEqual(created, [{ name: 'Q10' }]);
    assert.deepEqual(out.items, [{ productId: 'p-new', name: 'Q10' }]);
    assert.equal(out.newProduct, false, '那一格要收起來');
    assert.equal(out.newProductName, '');
    assert.ok(m.products.some((p) => p.id === 'p-new'), '呼叫端手上的主檔要跟著補一筆');
  });

  test('原本選好的那幾款留著', async () => {
    const d = draft({ items: [{ productId: 'p-1', name: '夜態美' }] });
    const out = await buy.commitNewProduct(d, master(), async () => 'p-new');
    assert.deepEqual(out.items.map((x) => x.productId), ['p-1', 'p-new']);
  });

  test('同名的已經有了就用既有那一筆 —— 不要長出第二個「夜態美」', async () => {
    let called = 0;
    const out = await buy.commitNewProduct(
      draft({ newProductName: ' 夜態美 ' }), master(), async () => { called += 1; return 'x'; },
    );
    assert.equal(called, 0);
    assert.deepEqual(out.items, [{ productId: 'p-1', name: '夜態美' }]);
  });

  test('沒有要新增就原樣回去，一次 IO 都不會發生', async () => {
    let called = 0;
    const d = draft({ newProduct: false });
    const out = await buy.commitNewProduct(d, master(), async () => { called += 1; return 'x'; });
    assert.equal(called, 0);
    assert.equal(out, d);
  });

  test('名字留白也不新增', async () => {
    let called = 0;
    await buy.commitNewProduct(draft({ newProductName: '   ' }), master(), async () => { called += 1; return 'x'; });
    assert.equal(called, 0);
  });
});
