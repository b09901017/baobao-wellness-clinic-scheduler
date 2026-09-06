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

import { readFileSync } from 'node:fs';

import * as buy from '../public/js/ui/components/buy.js';
import { fromRoot } from './helpers/paths.js';

const MASTER = {
  courses: [
    { id: 'c-rehab', name: '復健科醫師門診' },
    { id: 'c-checkup', name: '健檢', followupCourseId: 'c-followup' },
    { id: 'c-drip', name: '營養點滴', requiresIvProduct: true },
    { id: 'c-recovery', name: '復能', requiresEquipment: true, durationMin: 60, durationChoices: [30, 60] },
    { id: 'c-ilib', name: 'ILIB', durationMin: 60, durationChoices: [30, 60] },
  ],
  // 器材帶課程（ADR-0075）：前兩台是復能的，ILIB 那一台自己一個課程 ——
  // 所以「三選一」是前兩台（這份主檔只有兩台），「四選一」是全部三台。
  equipment: [
    { id: 'eq-indiba', name: 'INDIBA', courseId: 'c-recovery' },
    { id: 'eq-sis', name: '超磁場', courseId: 'c-recovery' },
    { id: 'eq-ilib', name: 'ILIB', courseId: 'c-ilib' },
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
    const e = from('c-rehab');
    assert.equal(e.type, 'single');
    assert.equal(e.courseId, 'c-rehab');
    assert.equal(e.label, '復健科醫師門診');
  });

  test('點了「復能」預設就是整組那一顆，不是全部器材', () => {
    // 方案裡的那一項就是三選一，她最常買的先幫她按好。
    const e = from(buy.POOL_PICK);
    assert.equal(e.type, 'pool');
    assert.equal(e.courseId, null);
    assert.deepEqual(e.optionEquipmentIds, ['eq-indiba', 'eq-sis']);
    assert.equal(e.durationMin, 60, '預設時長也要幫她帶進來');
    assert.equal(e.label, '復能二選一(60)');
  });

  test('營養品是第三種型態，沒有課程也沒有器材', () => {
    const e = from(buy.PRODUCT_PICK);
    assert.equal(e.type, 'product');
    assert.equal(e.courseId, null);
    assert.deepEqual(e.optionEquipmentIds, []);
  });

  test('選了營養品再選課程，型態與名稱都跟著回去', () => {
    const e = from(buy.PRODUCT_PICK, 'c-rehab');
    assert.equal(e.type, 'single');
    assert.equal(e.label, '復健科醫師門診', '「夜態美」不可以留在課程的名字上');
  });

  test('換到不配二返的課程就把等級丟掉 —— 「8萬復健科醫師門診」是一句沒有意義的話', () => {
    const checkup = { ...from('c-checkup'), tier: '8萬', label: '8萬健檢' };
    const next = { ...checkup, ...buy.pick('c-rehab', checkup, MASTER) };
    assert.equal(next.tier, null);
    assert.equal(next.label, '復健科醫師門診');
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
    const other = { ...drip, ...buy.pick('c-rehab', drip, MASTER) };
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
    const next = { ...mine, ...buy.pick('c-rehab', mine, MASTER) };
    assert.equal(next.label, '客戶A的健檢');
  });

  test('app 自己填的那一個不算「她改過」', () => {
    assert.equal(buy.keptLabel(from('c-rehab'), MASTER), null);
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
    const next = buy.afterPick('c-rehab', draft, { tier: '8萬', label: '8萬健檢' }, MASTER);
    assert.equal(next.label, '復健科醫師門診');
    assert.equal(next.tier, null);
  });

  test('選了一顆課程：她自己打的名稱不覆蓋', () => {
    const draft = { ...from('c-checkup'), label: '客戶A的健檢' };
    const next = buy.afterPick('c-rehab', draft, { label: '客戶A的健檢' }, MASTER);
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

  test('**在「多少錢」打字，金額要進名稱** —— 她的舊表就是那樣寫的', () => {
    // 她的原話：「加購營養品時，輸入的價格沒有正確被加入到名稱顯示中」。
    // 症狀的根因在接線（`amountTwd` 不在那一排會觸發重算的欄位裡），
    // 但規則本身要先是對的（`issues/09`）。
    let draft = { ...from('__product__'), items: [{ productId: 'prod-gaba', name: 'GABA' }] };
    draft = buy.afterDetail(draft, { productIds: 'prod-gaba', amountTwd: 5050 }, MASTER);
    assert.equal(draft.amountTwd, 5050);
    assert.equal(draft.label, '營養品 5,050（GABA）');
  });

  test('連著打第二個字，金額的名稱一樣要跟', () => {
    let draft = { ...from('__product__'), items: [{ productId: 'prod-gaba', name: 'GABA' }] };
    for (const typed of [5, 50, 505, 5050]) {
      draft = buy.afterDetail(draft, { productIds: 'prod-gaba', amountTwd: typed }, MASTER);
    }
    assert.equal(draft.label, '營養品 5,050（GABA）');
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
    const doc = buy.toEntitlement(from('c-rehab'), { purchasedAt: '2026-08-25' });
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
    assert.ok(lead > html.indexOf('復能'), '線要在課程那一組後面');
    assert.ok(lead < html.lastIndexOf('營養品'), '線要在營養品那一顆前面');
  });

  test('營養品那一顆一直在，而且排在最後', () => {
    const html = buy.fields(buy.blank(), MASTER);
    // 順序照主檔（`courseChips()` 不重排）—— 復能留在它自己的位置上，
    // 因為這一排橫著捲，而她最常買的接在最後面等於每一次都要滑到底。
    const order = ['健檢', '營養點滴', '復能', 'ILIB', '營養品'];
    let at = -1;
    for (const label of order) {
      const found = html.indexOf(label);
      assert.ok(found > at, `「${label}」的順序不對`);
      at = found;
    }
  });

  // 要選器材的課程不可以買成 single —— 那一筆額度排班時沒有池可以選器材。
  test('「復能」只有一顆，而且是擇一池那一顆', () => {
    const html = buy.fields(buy.blank(), MASTER);
    assert.equal(html.split('復能').length - 1, 1, '復能不可以同時是課程與擇一池');
    assert.ok(html.includes(`data-chip-value="${buy.POOL_PICK}"`));
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
    assert.ok(buy.fields(from('c-rehab'), MASTER).includes('幾次'));
    assert.equal(
      buy.summaryLine({ label: '營養品 5,000（夜態美）', totalQty: 2, type: 'product' }),
      '營養品 5,000（夜態美） 2 個月',
    );
    assert.equal(buy.summaryLine({ label: '超磁場(60)', totalQty: 5, type: 'pool' }), '超磁場(60) 5 次');
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

  test('沒有要新增就不寫主檔，一次 IO 都不會發生', async () => {
    let called = 0;
    const d = draft({ newProduct: false, items: [{ productId: 'p-1', name: '夜態美' }] });
    const out = await buy.commitNewProduct(d, master(), async () => { called += 1; return 'x'; });
    assert.equal(called, 0);
    assert.deepEqual(out, d);
  });

  // 這一支是**存檔前的最後一站**，所以名字要在這裡補齊 ——
  // `read()` 從表單讀回來的 items 一律是 `name: ''`（表單只送得回 id），
  // 而那一份會蓋掉 `afterDetail()` 補好的。名字沒了之後顯示名稱、
  // 提醒那一句與交付面板會一起變空白（`issues/08`）。
  test('沒有要新增也要把名字從主檔補齊', async () => {
    const out = await buy.commitNewProduct(
      draft({ newProduct: false, items: [{ productId: 'p-1', name: '' }] }),
      master(),
      async () => 'x',
    );
    assert.deepEqual(out.items, [{ productId: 'p-1', name: '夜態美' }]);
  });

  test('主檔認不出來的那一筆留著 id，名字不變 —— 不要弄成 undefined', async () => {
    const out = await buy.commitNewProduct(
      draft({ newProduct: false, items: [{ productId: 'gone', name: '' }] }),
      master(),
      async () => 'x',
    );
    assert.deepEqual(out.items, [{ productId: 'gone', name: '' }]);
  });

  test('名字留白也不新增', async () => {
    let called = 0;
    await buy.commitNewProduct(draft({ newProductName: '   ' }), master(), async () => { called += 1; return 'x'; });
    assert.equal(called, 0);
  });
});

// 底下兩條讀的是原始碼。`wire()` 那一段碰 DOM，測不到 —— 但它擋掉的
// 那兩個 bug 都是「一個常數寫錯」，而那種東西讀得出來。
describe('原始碼守衛：兩個一個字就會壞掉的地方', () => {
  const SRC = readFileSync(fromRoot('public/js/ui/components/buy.js'), 'utf8');

  test('「多少錢」不可以有倍數限制 —— 5050 會被瀏覽器擋在 submit 之前', () => {
    // step="100" 讓瀏覽器的內建驗證跳「最接近的有效值為 5000 和 5100」，
    // 而那一下表單連 submit 都不會觸發（`issues/09`）。
    const field = SRC.slice(SRC.indexOf("name: 'amountTwd'"));
    const step = field.slice(0, field.indexOf('})')).match(/step:\s*(\d+)/);
    assert.ok(step, '找不到「多少錢」那一格的 step');
    assert.equal(step[1], '1');
  });

  test('在「多少錢」打字要重算顯示名稱', () => {
    const typed = SRC.match(/const TYPED_FIELDS = '([^']+)'/);
    assert.ok(typed, '找不到 TYPED_FIELDS');
    assert.ok(typed[1].includes('amountTwd'), '金額不在會重算名稱的那幾格裡');
  });
});


// ADR-0075 + 她 2026-09-06 的原話：
//
// > 課程加購那邊可以只有復能，然後點了之後可以接者選選是三選一，四選一，
// > 或是單一的哪一項，然後接者選幾分鐘30或60，都是可以用丸子呈現
//
// 這一份主檔只有三台器材（兩台復能的、一台 ILIB），所以整組那兩顆叫
// 「二選一」與「三選一」—— **數字是算出來的**，她多加一台就自己會變。
describe('加購復能：哪一種 → 幾分鐘', () => {
  test('哪一種：整組排前面，單買一台接在後面並且隔一條線', () => {
    const { sets, singles } = buy.poolChoices(MASTER);
    assert.deepEqual(sets.map((x) => x.label), ['二選一', '三選一']);
    assert.deepEqual(sets[0].ids, ['eq-indiba', 'eq-sis']);
    assert.deepEqual(sets[1].ids, ['eq-indiba', 'eq-sis', 'eq-ilib']);
    assert.deepEqual(singles.map((x) => x.label), ['INDIBA', '超磁場', 'ILIB']);

    const html = buy.fields(from(buy.POOL_PICK), MASTER);
    assert.ok(html.includes('哪一種'));
    assert.ok(html.includes('<span class="chiprow__lead">單買一台</span>'));
    assert.ok(html.indexOf('二選一') < html.indexOf('單買一台'));
  });

  test('沒有第二組時只出一顆整組 —— 兩顆一模一樣的丸子沒有答案', () => {
    const onlyRecovery = {
      ...MASTER,
      equipment: MASTER.equipment.filter((e) => e.courseId === 'c-recovery'),
    };
    assert.deepEqual(buy.poolChoices(onlyRecovery).sets.map((x) => x.label), ['二選一']);
  });

  test('一台器材都沒有指到課程（舊資料）時，整組就是全部', () => {
    const old = { ...MASTER, equipment: MASTER.equipment.map(({ courseId, ...r }) => r) };
    const { sets } = buy.poolChoices(old);
    assert.equal(sets.length, 1);
    assert.deepEqual(sets[0].ids, ['eq-indiba', 'eq-sis', 'eq-ilib']);
  });

  test('按著的是哪一顆，比的是那一串 id 不是她按過什麼', () => {
    // 從方案展開出來的額度身上只有 ids，點進去調整時那一排也要按對
    assert.equal(buy.poolPickOf({ optionEquipmentIds: ['eq-sis', 'eq-indiba'] }, MASTER),
      buy.POOL_SET_HOME);
    assert.equal(buy.poolPickOf({ optionEquipmentIds: ['eq-sis'] }, MASTER), 'eq-sis');
    assert.equal(buy.poolPickOf({ optionEquipmentIds: [] }, MASTER), null);
    // 她在進階設定裡自己勾了一個怪組合 → 一顆都不按，而不是亂按一顆
    assert.equal(buy.poolPickOf({ optionEquipmentIds: ['eq-sis', 'eq-ilib'] }, MASTER), null);
  });

  test('換一種：名字跟著變', () => {
    const pool = from(buy.POOL_PICK);
    const single = buy.afterDetail(pool, { optionEquipmentIds: ['eq-sis'] }, MASTER);
    assert.equal(single.label, '超磁場(60)');

    const four = buy.afterDetail(single, {
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-ilib'],
    }, MASTER);
    assert.equal(four.label, '復能三選一(60)');
  });

  test('換幾分鐘：名字跟著變', () => {
    const pool = from(buy.POOL_PICK);
    const half = buy.afterDetail(pool, { durationMin: 30 }, MASTER);
    assert.equal(half.label, '復能二選一(30)');
  });

  test('她自己打過的名字照樣不被覆蓋', () => {
    const mine = { ...from(buy.POOL_PICK), label: '客戶A談的那五次' };
    const next = buy.afterDetail(mine, { durationMin: 30 }, MASTER);
    assert.equal(next.label, '客戶A談的那五次');
  });

  test('ILIB 是一個課程，選了它才有「幾分鐘」', () => {
    const ilib = from('c-ilib');
    assert.equal(ilib.type, 'single');
    assert.equal(ilib.durationMin, 60, '預設帶課程的時長');
    assert.equal(ilib.label, 'ILIB(60)');

    const html = buy.fields(ilib, MASTER);
    assert.ok(html.includes('幾分鐘'));
    assert.ok(html.includes('30 分鐘') && html.includes('60 分鐘'));

    // 健檢沒有可選時長 → 那一排不出現（永遠不會被按的丸子只是噪音）
    assert.ok(!buy.fields(from('c-checkup'), MASTER).includes('幾分鐘'));
  });

  test('只點了「復能」沒選種類就存不下去，而且話要講在她看得懂的層次', () => {
    const empty = { ...from(buy.POOL_PICK), optionEquipmentIds: [] };
    assert.deepEqual(buy.validate(empty, MASTER), ['還要選一種復能']);
  });

  test('讀表單：那一顆的值換回真正要存的那一串 id', () => {
    const form = { elements: { poolKind: {}, durationMin: {} } };
    const out = buy.read(form, { poolKind: buy.POOL_SET_ALL, durationMin: '30' }, MASTER);
    assert.deepEqual(out.optionEquipmentIds, ['eq-indiba', 'eq-sis', 'eq-ilib']);
    assert.equal(out.durationMin, 30);

    // 那兩排不在畫面上時一個欄位都不回報 —— 少帶一個等於把它清成 null
    assert.deepEqual(buy.read({ elements: {} }, { poolKind: 'x', durationMin: '30' }, MASTER), {});
  });

  test('存下去的形狀：時長帶著，器材那一串也帶著', () => {
    const doc = buy.toEntitlement(
      { ...from(buy.POOL_PICK), optionEquipmentIds: ['eq-sis'], durationMin: 30, totalQty: 5 },
    );
    assert.equal(doc.type, 'pool');
    assert.equal(doc.durationMin, 30);
    assert.deepEqual(doc.optionEquipmentIds, ['eq-sis']);
    assert.equal(doc.courseId, null, '擇一池沒有 courseId —— 課程由器材推（ADR-0075）');
  });
});
