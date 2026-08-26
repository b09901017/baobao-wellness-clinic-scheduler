// 一次建立一群客戶。`.scratch/bulk-customer-create/issues/01`。
//
// 這一支的形狀是「共用的填一次，不一樣的才微調」，所以測試盯的也是那兩半：
// 預設真的跟大家一樣，微調過的真的只影響那一位。
//
// 加購那一半 2026-08-26 改成跟另外兩個入口共用同一張表
//（`ui/components/buy.js`，`.scratch/buying-in-bulk/issues/01`），所以這裡的
// `extras` 也是那張表吐出來的形狀，不是這一支自己接的。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ROWS,
  parseNames,
  newRow,
  isAdjusted,
  duplicatesOf,
  quantityFor,
  entitlementsFor,
  extrasFor,
  customerFor,
  summarizeRoster,
  validateRoster,
  rosterWarnings,
} from '../public/js/domain/bulkCustomers.js';
import * as buy from '../public/js/ui/components/buy.js';

const PLAN = {
  name: '筋骨強身',
  items: [
    { type: 'single', courseId: 'course-rehab', label: '復健科醫師門診', qty: 6, durationMin: 30 },
    { type: 'pool', label: '復能', qty: 12, durationMin: 60,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'] },
  ],
};

const COURSES = {
  'course-rehab': { id: 'course-rehab', name: '復健科醫師門診', durationMin: 30 },
  'course-checkup': {
    id: 'course-checkup', name: '健檢', durationMin: 120, followupCourseId: 'course-followup',
  },
  'course-eecp': { id: 'course-eecp', name: 'EECP', durationMin: 30 },
};

const EQUIP = [{ id: 'eq-laser' }, { id: 'eq-sis' }, { id: 'eq-indiba' }];
const PRODUCTS = [{ id: 'prod-yetaimei', name: '夜態美' }];
const CTX = { plan: PLAN, coursesById: COURSES, equipment: EQUIP, products: PRODUCTS };
const SHARED = { source: '0522 顧客會-8', purchasedAt: '2026-08-23', quantity: 1 };

const rowsOf = (...names) => names.map((n, i) => newRow(n, `k${i}`));

// 加購那幾筆是**畫面上那張表吐出來的整理好的額度**（`ui/components/buy.js`），
// 不是這一支自己接的 —— 三個加購入口共用同一張表。測試照著同一條路走，
// 才不會在那張表換了形狀的那天還是綠的。
const MASTER = {
  courses: Object.values(COURSES), equipment: EQUIP, ivProducts: [], products: PRODUCTS,
};
const bought = (...picks) =>
  buy.toEntitlement(picks.reduce(
    (e, p) => (typeof p === 'string'
      ? buy.afterPick(p, e, {}, MASTER)
      : buy.afterDetail(e, p, MASTER)),
    buy.blank(),
  ));

describe('把貼進來的一串字拆成名單', () => {
  test('換行、逗號、頓號、分號都算分隔', () => {
    assert.deepEqual(
      parseNames('王小明\n李美，陳大文、張三;歐陽小美'),
      ['王小明', '李美', '陳大文', '張三', '歐陽小美'],
    );
  });

  test('**空白不算分隔** —— 中文姓名裡會有空白', () => {
    // 用空白切會把一位客戶切成兩位，而那兩位都會被建出來
    assert.deepEqual(parseNames('王 小明'), ['王 小明']);
  });

  test('前後的空白去掉，空的那幾段丟掉', () => {
    assert.deepEqual(parseNames('  王小明  ,, \n\n 李美 ,'), ['王小明', '李美']);
  });

  test('空字串不會爆掉', () => {
    for (const empty of ['', '   ', null, undefined]) {
      assert.deepEqual(parseNames(empty), []);
    }
  });
});

describe('預設就是跟大家一樣', () => {
  test('新的一列什麼都沒動', () => {
    const row = newRow('王小明');
    assert.equal(row.quantity, null, 'null 代表用整批的');
    assert.equal(row.usePlan, true);
    assert.deepEqual(row.extras, []);
    assert.equal(isAdjusted(row), false);
  });

  test('動過的三種都算微調', () => {
    assert.equal(isAdjusted({ ...newRow('王小明'), quantity: 2 }), true);
    assert.equal(isAdjusted({ ...newRow('王小明'), usePlan: false }), true);
    assert.equal(isAdjusted({ ...newRow('王小明'), extras: [bought('course-checkup')] }), true);
  });

  test('沒填數量就用整批的，填了才是自己的', () => {
    assert.equal(quantityFor(newRow('王小明'), { quantity: 3 }), 3);
    assert.equal(quantityFor({ ...newRow('王小明'), quantity: 2 }, { quantity: 3 }), 2);
  });

  test('兩處都沒有合法數字時回 1 —— 不要讓一個空欄位變成零額度', () => {
    assert.equal(quantityFor(newRow('王小明'), {}), 1);
    assert.equal(quantityFor(newRow('王小明'), { quantity: 0 }), 1);
    assert.equal(quantityFor({ ...newRow('王小明'), quantity: -2 }, { quantity: 'x' }), 1);
  });
});

describe('這一位身上會長出哪幾筆額度', () => {
  test('預設就是整批的方案', () => {
    const ents = entitlementsFor(newRow('王小明'), SHARED, CTX);
    assert.deepEqual(ents.map((e) => e.label), ['復健科醫師門診', '復能']);
    assert.deepEqual(ents.map((e) => e.totalQty), [6, 12]);
    assert.equal(ents[0].sourcePlanName, '筋骨強身', '展開後留的是名字快照，不是連結');
  });

  test('數量只影響那一位', () => {
    const rows = rowsOf('王小明', '李美');
    rows[1].quantity = 2;

    assert.deepEqual(entitlementsFor(rows[0], SHARED, CTX).map((e) => e.totalQty), [6, 12]);
    assert.deepEqual(entitlementsFor(rows[1], SHARED, CTX).map((e) => e.totalQty), [12, 24]);
  });

  test('方案 ＋ 8萬健檢', () => {
    // 「幾萬的」以前在這一頁選不到，加出來的兩筆都叫「健檢」（ADR-0054）
    const row = {
      ...newRow('王小明'),
      extras: [bought('course-checkup', { tier: '8萬' }, { totalQty: 3 })],
    };
    const ents = entitlementsFor(row, SHARED, CTX);

    assert.deepEqual(ents.map((e) => e.label), ['復健科醫師門診', '復能', '8萬健檢']);
    assert.equal(ents[2].totalQty, 3);
    assert.equal(ents[2].tier, '8萬');
    assert.equal(ents[2].sourcePlanName, null, '加購不是從範本展開的');
  });

  test('營養品也加得進來，而且它論份不論次（ADR-0057）', () => {
    const row = {
      ...newRow('王小明'),
      usePlan: false,
      extras: [bought(buy.PRODUCT_PICK, { productId: 'prod-yetaimei' }, { totalQty: 2 })],
    };
    const ents = entitlementsFor(row, SHARED, CTX);

    assert.deepEqual(ents.map((e) => e.label), ['夜態美']);
    assert.equal(ents[0].type, 'product');
    assert.equal(ents[0].productId, 'prod-yetaimei');
    assert.equal(ents[0].courseId, null);
    assert.deepEqual(validateRoster([row], SHARED, CTX), [], '營養品主檔要進得了驗證');
  });

  test('沒有方案，單買 EECP', () => {
    const row = {
      ...newRow('王小明'),
      usePlan: false,
      extras: [bought('course-eecp', { totalQty: 10 })],
    };
    const ents = entitlementsFor(row, SHARED, CTX);

    assert.deepEqual(ents.map((e) => e.label), ['EECP']);
    assert.equal(ents[0].totalQty, 10);
    // 時長留空 = 「用課程主檔的」（`visitEditor.js` 與 `schedule.js` 兩邊都是
    // `ent.durationMin ?? course.durationMin ?? 60`）。跟另外兩個加購入口一樣，
    // 而且課程之後改了時長它會跟著改。
    assert.equal(ents[0].durationMin, null);
  });

  test('整批就沒選方案時，沒微調的那幾位身上是空的', () => {
    const ents = entitlementsFor(newRow('王小明'), SHARED, { ...CTX, plan: null });
    assert.deepEqual(ents, []);
  });

  test('加購指到不存在的課程要擋下來，不要安靜地少建一筆', () => {
    // 她加完之後那個課程才被刪掉。**不可以默默丟掉** —— 她明明賣掉了東西。
    const row = { ...newRow('王小明'), extras: [{ ...bought('course-eecp'), courseId: 'nope' }] };
    assert.ok(validateRoster([row], SHARED, CTX).some((e) => e.includes('王小明')));
  });

  test('購買日跟著整批走，加購是在最後一刻才蓋上去的', () => {
    // 她可能先加了三筆加購才回頭去改整批的購買日
    const row = { ...newRow('王小明'), extras: [bought('course-checkup')] };
    assert.equal(row.extras[0].purchasedAt, null, '加進名單的時候還不知道是哪一天');

    for (const e of entitlementsFor(row, SHARED, CTX)) {
      assert.equal(e.purchasedAt, '2026-08-23');
    }
    assert.equal(extrasFor(row, { purchasedAt: '不是日期' })[0].purchasedAt, null);
  });
});

describe('客戶主檔的欄位', () => {
  test('這一頁只填姓名，其餘跟著整批或留空', () => {
    const c = customerFor(newRow('王小明'), SHARED);

    assert.equal(c.name, '王小明');
    assert.equal(c.source, '0522 顧客會-8');
    assert.equal(c.purchasedAt, '2026-08-23');
    assert.equal(c.phone, null);
    assert.equal(c.lineId, null);
    assert.equal(c.priority, 0);
    assert.deepEqual(c.flags, []);
  });

  test('會籍到期日不在這裡（ADR-0019）', () => {
    assert.equal(customerFor(newRow('王小明'), SHARED).membershipExpiresAt, null);
  });

  test('marks 與 notes 一起寫，notes 是 null 不是空字串', () => {
    const c = customerFor(newRow('王小明'), SHARED);
    assert.deepEqual(c.marks, []);
    assert.equal(c.notes, null, 'Firestore 上「沒有這件事」與「有一個空字串」是兩回事');
  });
});

describe('重複的名字只提示不阻擋', () => {
  test('這張名單裡自己重複', () => {
    const dup = duplicatesOf(rowsOf('王小明', '李美', '王小明'), []);
    assert.equal(dup.get('k0').inList, 1);
    assert.equal(dup.get('k2').inList, 1);
    assert.equal(dup.has('k1'), false);
  });

  test('跟現有客戶同名', () => {
    const dup = duplicatesOf(rowsOf('王小明'), [{ name: '王小明' }]);
    assert.equal(dup.get('k0').existing, 1);
  });

  test('已經刪掉的客戶不算', () => {
    const dup = duplicatesOf(rowsOf('王小明'), [{ name: '王小明', deletedAt: '2026-01-01' }]);
    assert.equal(dup.size, 0);
  });

  test('重複不會讓 validateRoster 擋下來 —— 真的有兩位王小明是會發生的', () => {
    const errors = validateRoster(rowsOf('王小明', '王小明'), SHARED, CTX);
    assert.deepEqual(errors, []);
  });
});

describe('會建立什麼的摘要', () => {
  test('人數與額度筆數', () => {
    const rows = rowsOf('王小明', '李美', '陳大文');
    rows[1].extras = [bought('course-checkup')];

    const s = summarizeRoster(rows, SHARED, CTX);
    assert.equal(s.people, 3);
    assert.equal(s.entitlements, 7, '2 + 3 + 2');
    assert.deepEqual(s.rows.map((r) => r.adjusted), [false, true, false]);
  });

  test('每一列的總次數算得出來', () => {
    const s = summarizeRoster(rowsOf('王小明'), SHARED, CTX);
    assert.equal(s.rows[0].total, 18, '6 + 12');
    assert.equal(s.rows[0].products, 0);
  });

  test('**份數不加進次數裡**（ADR-0057）—— 兩罐夜態美不是兩次', () => {
    const rows = rowsOf('王小明');
    rows[0].extras = [bought(buy.PRODUCT_PICK, { productId: 'prod-yetaimei' }, { totalQty: 2 })];

    const s = summarizeRoster(rows, SHARED, CTX);
    assert.equal(s.rows[0].total, 18, '還是 6 + 12');
    assert.equal(s.rows[0].products, 2);
    assert.equal(s.entitlements, 3, '筆數照算 —— 她確實多買了一樣東西');
  });
});

describe('存檔前的檢查', () => {
  test('乾淨的名單過關', () => {
    assert.deepEqual(validateRoster(rowsOf('王小明', '李美'), SHARED, CTX), []);
  });

  test('空名單擋下來', () => {
    assert.equal(validateRoster([], SHARED, CTX).length, 1);
  });

  test('沒有名字的列擋下來', () => {
    const errors = validateRoster(rowsOf('王小明', ''), SHARED, CTX);
    assert.ok(errors.some((e) => e.includes('沒有名字')));
  });

  test('太多位擋下來 —— 那通常是貼錯東西了', () => {
    const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => newRow(`客戶${i}`, `k${i}`));
    assert.ok(validateRoster(many, SHARED, CTX).some((e) => e.includes(`${MAX_ROWS}`)));
  });

  test('個別的數量不合法擋下來', () => {
    const rows = rowsOf('王小明');
    rows[0].quantity = 0;
    assert.ok(validateRoster(rows, SHARED, CTX).some((e) => e.includes('王小明')));
  });

  test('日期格式不對擋下來', () => {
    const errors = validateRoster(rowsOf('王小明'), { ...SHARED, purchasedAt: '8/23' }, CTX);
    assert.ok(errors.some((e) => e.includes('購買日')));
  });
});

describe('只提示不阻擋的那幾件事', () => {
  test('身上不會有任何額度要講出來，但不擋', () => {
    const rows = rowsOf('王小明');
    rows[0].usePlan = false;

    assert.deepEqual(validateRoster(rows, SHARED, CTX), [], '不擋');
    assert.ok(rosterWarnings(rows, SHARED, CTX).some((w) => w.includes('王小明')));
  });

  test('沒填購買通路要講出來', () => {
    const warnings = rosterWarnings(rowsOf('王小明'), { ...SHARED, source: '' }, CTX);
    assert.ok(warnings.some((w) => w.includes('購買通路')));
  });

  test('一切正常時不要唸', () => {
    assert.deepEqual(rosterWarnings(rowsOf('王小明'), SHARED, CTX), []);
  });
});
