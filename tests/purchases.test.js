// 「買過什麼」那一頁的算法（`domain/purchases.js`）。
//
// 這一支盯的第一件事是**一筆都不可以被丟掉**：分組有三層退路，而舊資料與
// 匯進來的那幾筆身上什麼都沒有。同 `domain/dayReview.js` 的 `STAGES`：
// 最後一段永遠收得下剩下的。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupKey, groupPurchases, productsOf, isTweaked,
  dateChangePatch, describeDateChange, SINGLE_LABEL, UNKNOWN_LABEL,
} from '../public/js/domain/purchases.js';

const e = (over) => ({ id: 'x', label: 'x', totalQty: 1, ...over });

describe('這一筆屬於哪一組', () => {
  test('有購買 id 就照它 —— 同一天買兩套一樣的方案也分得開', () => {
    const a = e({ purchaseId: 'P1', sourcePlanName: '8萬方案', purchasedAt: '2026-03-12' });
    const b = e({ purchaseId: 'P2', sourcePlanName: '8萬方案', purchasedAt: '2026-03-12' });
    assert.notEqual(groupKey(a), groupKey(b));
  });

  test('沒有購買 id 就退回「方案名 + 購買日」', () => {
    const a = e({ sourcePlanName: '8萬方案', purchasedAt: '2026-03-12' });
    const b = e({ sourcePlanName: '8萬方案', purchasedAt: '2026-03-12' });
    assert.equal(groupKey(a), groupKey(b));
    assert.notEqual(groupKey(a), groupKey(e({ sourcePlanName: '8萬方案', purchasedAt: '2025-01-01' })));
  });

  test('連方案名都沒有就退回購買日', () => {
    assert.equal(groupKey(e({ purchasedAt: '2026-06-01' })), groupKey(e({ purchasedAt: '2026-06-01' })));
  });

  test('三個都沒有就回 null —— 由呼叫端收進最後一組', () => {
    assert.equal(groupKey(e({})), null);
    assert.equal(groupKey(null), null);
  });
});

describe('收成幾組', () => {
  const rows = [
    e({ id: '1', purchaseId: 'P1', sourcePlanName: '8萬方案', purchasedAt: '2026-03-12', label: '健檢', totalQty: 2, sourcePlanQty: 2 }),
    e({ id: '2', purchaseId: 'P1', sourcePlanName: '8萬方案', purchasedAt: '2026-03-12', label: '復能三選一(60)', totalQty: 15, sourcePlanQty: 20 }),
    e({ id: '3', purchaseId: 'P2', purchasedAt: '2026-06-01', label: 'INDIBA(30)', totalQty: 5 }),
    e({ id: '4', sourcePlanName: '筋骨強身', purchasedAt: '2025-01-05', label: 'ILIB(60)', totalQty: 20 }),
    e({ id: '5', label: '匯進來的', totalQty: 3 }),
    e({ id: '6', type: 'product', label: '營養品(5000)', totalQty: 2 }),
    e({ id: '7', label: '刪掉的', deletedAt: 'x' }),
  ];

  test('購買日新的在前面，沒有日期的排最後', () => {
    assert.deepEqual(
      groupPurchases(rows).map((g) => g.purchasedAt),
      ['2026-06-01', '2026-03-12', '2025-01-05', null],
    );
  });

  test('沒有方案名的那一組叫「單項加購」', () => {
    assert.equal(groupPurchases(rows)[0].label, SINGLE_LABEL);
  });

  test('什麼都對不上的收進最後一組，一筆都不會掉', () => {
    const last = groupPurchases(rows).at(-1);
    assert.equal(last.label, UNKNOWN_LABEL);
    assert.equal(last.unknown, true);
    assert.deepEqual(last.rows.map((r) => r.id), ['5']);

    const kept = groupPurchases(rows).flatMap((g) => g.rows).map((r) => r.id);
    assert.deepEqual(kept.sort(), ['1', '2', '3', '4', '5']);
  });

  test('營養品不進來 —— 它不是額度那一排的東西（ADR-0057）', () => {
    assert.ok(!groupPurchases(rows).some((g) => g.rows.some((r) => r.id === '6')));
    assert.deepEqual(productsOf(rows).map((r) => r.id), ['6']);
  });

  test('刪掉的不進來，也不進營養品那一段', () => {
    assert.ok(!groupPurchases(rows).some((g) => g.rows.some((r) => r.id === '7')));
    assert.ok(!productsOf(rows).some((r) => r.id === '7'));
  });

  test('那一組有任何一筆跟方案不一樣就標「微調過」', () => {
    const [, plan] = groupPurchases(rows);
    assert.equal(plan.label, '8萬方案');
    assert.equal(plan.tweaked, true);
    assert.equal(groupPurchases(rows)[2].tweaked, false, '筋骨強身那一組沒動過');
  });

  test('只有 purchaseId 的那幾組才給改日期', () => {
    const [single, plan, old_] = groupPurchases(rows);
    assert.ok(single.purchaseId);
    assert.ok(plan.purchaseId);
    assert.equal(old_.purchaseId, null, '2026-09-06 之前的那幾筆沒有 id，不給改');
  });

  test('空的就是空的', () => {
    assert.deepEqual(groupPurchases([]), []);
    assert.deepEqual(groupPurchases(), []);
  });
});

describe('哪幾筆算微調過', () => {
  test('跟方案本來寫的不一樣', () => {
    assert.equal(isTweaked(e({ totalQty: 15, sourcePlanQty: 20 })), true);
    assert.equal(isTweaked(e({ totalQty: 20, sourcePlanQty: 20 })), false);
  });

  test('沒有那一欄的一律不算 —— 單項加購本來就沒有「本來幾次」', () => {
    assert.equal(isTweaked(e({ totalQty: 5 })), false);
    assert.equal(isTweaked(null), false);
  });
});

describe('改購買日', () => {
  const rows = [
    e({ id: 'a', purchasedAt: '2026-03-12', expiresAt: '2027-03-12' }),
    e({ id: 'b', purchasedAt: '2026-03-12', expiresAt: null }),
  ];

  test('整組一起改', () => {
    const out = dateChangePatch(rows, '2026-01-01');
    assert.deepEqual(out.map((p) => p.id), ['a', 'b']);
    assert.ok(out.every((p) => p.changes.purchasedAt === '2026-01-01'));
  });

  test('有到期日的跟著移同樣的天數 —— 不是重算月數', () => {
    // 舊資料的到期日不見得是「購買日 + 整數個月」，重算會把她手填的日期改掉
    const [withExpiry, without] = dateChangePatch(rows, '2026-01-01');
    assert.equal(withExpiry.changes.expiresAt, '2027-01-01');
    assert.ok(!('expiresAt' in without.changes), '沒有到期日的什麼都不動');
  });

  test('往後移也對', () => {
    assert.equal(dateChangePatch(rows, '2026-04-12')[0].changes.expiresAt, '2027-04-12');
  });

  test('日期不合法就什麼都不做', () => {
    assert.deepEqual(dateChangePatch(rows, ''), []);
    assert.deepEqual(dateChangePatch(rows, '亂打'), []);
  });

  test('原本沒有購買日的那幾筆，到期日不敢亂移', () => {
    const out = dateChangePatch([e({ id: 'c', expiresAt: '2027-03-12' })], '2026-01-01');
    assert.ok(!('expiresAt' in out[0].changes));
  });

  test('按下去之前那一句話只在真的有到期日時出現', () => {
    assert.equal(describeDateChange([rows[1]], '2026-01-01'), '');
    assert.match(describeDateChange([rows[0]], '2026-01-01'), /2027-01-01/);
    assert.match(
      describeDateChange([rows[0], { ...rows[0], id: 'c' }], '2026-01-01'),
      /2 筆/,
    );
  });
});

// ---------------------------------------------------------------------------
// 一行「買了什麼」（`.scratch/asks-2026-09-13/issues/04`）。
//
// 她 2026-09-13：「我希望可以呈現像是"0723 顧客會 新8萬方案x2+12萬健檢+EECPx40+sis(60)x5+ILIB(60)x5
// ……就是那個小標題只要呈現日期，顧客會/H2U導客(等等) 方案(沒有的話就不用)，加購的」
// 以及「就寫sis(60)x5這個簡寫就好……營養品不用進抬頭」。

import { purchaseHeadline, shortItemName, setsOf, purchaseDays } from '../public/js/domain/purchases.js';
import { SEED } from '../public/js/domain/seed.js';
import { expandPlan } from '../public/js/domain/entitlements.js';

const MASTER = {
  plans: SEED.plans, equipment: SEED.equipment, courses: SEED.courses, ivProducts: SEED.ivProducts,
};
const NEW8 = { ...SEED.plans.find((p) => p.id === 'plan-8wan'), id: 'plan-new8', name: '新8萬方案' };
const M = { ...MASTER, plans: [...MASTER.plans, NEW8] };

const planRows = (plan, sets, at = '2026-07-23', purchaseId = 'P1') =>
  expandPlan(plan, sets, { purchasedAt: at, purchaseId }).map((r, i) => ({ ...r, id: `${purchaseId}-${i}` }));

const extra = (over) => ({
  id: over.id ?? `x-${over.label}`, type: 'single', totalQty: 1, purchasedAt: '2026-07-23', purchaseId: `X-${over.label}`,
  sourcePlanName: null, ...over,
});

const SIS5 = extra({ label: '復能-SIS(60)', type: 'pool', optionEquipmentIds: ['eq-sis'], durationMin: 60, totalQty: 5 });
const ILIB5 = extra({ label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 5 });
const EECP40 = extra({ label: 'EECP', courseId: 'course-eecp', totalQty: 40 });
const EXAM12 = extra({ label: '12萬健檢', courseId: 'course-checkup', tier: '12萬', totalQty: 1 });

describe('一行「買了什麼」（purchaseHeadline）', () => {
  test('她舉的那一個例子', () => {
    const ents = [...planRows(NEW8, 2), EXAM12, EECP40, SIS5, ILIB5];
    assert.equal(
      purchaseHeadline({ source: '顧客會' }, ents, M),
      '0723 顧客會 新8萬方案x2+12萬健檢+EECPx40+SIS(60)x5+ILIB(60)x5',
    );
  });

  test('expandPlan() 把套數存成快照', () => {
    assert.ok(planRows(NEW8, 2).every((r) => r.sourcePlanSets === 2));
  });

  test('方案被微調過 → 抬頭一個字都不變', () => {
    const rows = planRows(NEW8, 1).map((r) => (r.label === '復能-三選一(60)' ? { ...r, totalQty: 23 } : r));
    assert.equal(purchaseHeadline({ source: '顧客會' }, rows, M), '0723 顧客會 新8萬方案');
  });

  test('配出來的二返、營養品、刪掉的都不出現', () => {
    const ents = [
      EXAM12,
      extra({ label: '二返（12萬健檢）', courseId: 'course-followup', followupForEntitlementId: EXAM12.id }),
      extra({ label: '營養品(5000)', type: 'product', totalQty: 1 }),
      extra({ label: 'EECP', courseId: 'course-eecp', totalQty: 10, deletedAt: 'x' }),
    ];
    assert.equal(purchaseHeadline({ source: 'H2U導客' }, ents, M), '0723 H2U導客 12萬健檢');
  });

  test('沒有方案 → 日期是最早那一筆的，加購照買的先後排', () => {
    const ents = [{ ...SIS5, purchasedAt: '2026-09-01' }, { ...ILIB5, purchasedAt: '2026-08-20' }];
    assert.equal(purchaseHeadline({ source: '顧客會' }, ents, M), '0820 顧客會 ILIB(60)x5+SIS(60)x5');
  });

  test('有方案 → 日期是方案那一次的，不是更早的加購', () => {
    const ents = [{ ...EECP40, purchasedAt: '2026-06-01' }, ...planRows(NEW8, 1, '2026-07-23')];
    assert.equal(purchaseHeadline({ source: '顧客會' }, ents, M), '0723 顧客會 新8萬方案+EECPx40');
  });

  test('什麼都沒有 → 空字串', () => {
    assert.equal(purchaseHeadline({ source: '顧客會' }, [], M), '');
  });

  test('缺日期、缺通路就不留空格', () => {
    assert.equal(purchaseHeadline({}, [{ ...EECP40, purchasedAt: null }], M), 'EECPx40');
  });

  test('同一個加購買兩次 → 次數加起來', () => {
    const ents = [SIS5, { ...SIS5, id: 'sis-2', purchaseId: 'X-2', purchasedAt: '2026-09-01' }];
    assert.equal(purchaseHeadline({}, ents, M), '0723 SIS(60)x10');
  });

  test('營養點滴兩款 → 各寫品項名', () => {
    const drip = (iv, n) => extra({ label: `營養點滴 - ${iv}`, courseId: 'course-iv-drip', ivProductId: iv === '雪顏亮彩' ? 'iv-snow' : 'iv-liver', totalQty: n });
    assert.equal(purchaseHeadline({}, [drip('雪顏亮彩', 22), drip('護肝排毒', 11)], M), '0723 雪顏亮彩x22+護肝排毒x11');
  });

  test('沒有套數快照的舊資料：範本除得整才寫 xN', () => {
    const rows = planRows(NEW8, 2).map(({ sourcePlanSets, ...r }) => r);
    assert.equal(purchaseHeadline({}, rows, M), '0723 新8萬方案x2');
  });

  test('沒有套數快照、範本不見了 → 只寫方案名，不猜', () => {
    const rows = planRows(NEW8, 2).map(({ sourcePlanSets, ...r }) => r);
    assert.equal(purchaseHeadline({}, rows, MASTER), '0723 新8萬方案');
  });
});

describe('簡寫（shortItemName）', () => {
  test('擇一池拿掉課程那一半', () => {
    assert.equal(shortItemName(SIS5, M), 'SIS(60)');
    assert.equal(shortItemName(
      extra({ label: '復能-三選一(30)', type: 'pool', optionEquipmentIds: ['eq-sis', 'eq-indiba', 'eq-laser'], durationMin: 30 }), M,
    ), '三選一(30)');
  });

  test('其他的就是額度名本身', () => {
    assert.equal(shortItemName(ILIB5, M), 'ILIB(60)');
    assert.equal(shortItemName(EXAM12, M), '12萬健檢');
  });

  test('器材主檔對不到 → 退回額度名', () => {
    assert.equal(shortItemName(extra({ label: '復能-某台(60)', type: 'pool', optionEquipmentIds: ['gone'] }), M), '復能-某台(60)');
  });
});

describe('套數的退路（setsOf）', () => {
  test('每一項都除得整、商一樣 → 那個數', () => {
    assert.equal(setsOf(planRows(NEW8, 3).map(({ sourcePlanSets, ...r }) => r), M.plans), 3);
  });

  test('有一項除不整 → null', () => {
    const rows = planRows(NEW8, 2).map(({ sourcePlanSets, ...r }, i) => (i === 0 ? { ...r, sourcePlanQty: 7 } : r));
    assert.equal(setsOf(rows, M.plans), null);
  });
});

// 「買過什麼」一天一張（`.scratch/asks-2026-09-13/issues/06`）。
describe('一天一張（purchaseDays）', () => {
  test('同一天的方案與加購收成一張，摘要不帶通路', () => {
    const [day] = purchaseDays([...planRows(NEW8, 2), EECP40, SIS5], M);
    assert.equal(day.date, '2026-07-23');
    assert.equal(day.summary, '新8萬方案x2+EECPx40+SIS(60)x5');
    assert.equal(day.rows.length, 7 + 2);
  });

  test('不同天分開，新的在上面', () => {
    const days = purchaseDays([...planRows(NEW8, 1), { ...SIS5, purchasedAt: '2026-09-01' }], M);
    assert.deepEqual(days.map((d) => d.date), ['2026-09-01', '2026-07-23']);
    assert.equal(days[0].summary, 'SIS(60)x5');
  });

  test('微調過的才列出來：本來幾次、現在幾次', () => {
    const rows = planRows(NEW8, 1).map((r) => (r.label === '復能-三選一(60)' ? { ...r, totalQty: 23 } : r));
    const [day] = purchaseDays(rows, M);
    assert.deepEqual(day.tweaks, [{ name: '三選一(60)', from: 20, to: 23 }]);
  });

  test('沒有購買日的收在最後一張，一筆都不丟', () => {
    const days = purchaseDays([EECP40, { ...SIS5, purchasedAt: null }], M);
    assert.equal(days.at(-1).unknown, true);
    assert.equal(days.at(-1).rows.length, 1);
  });

  test('營養品不進來（它自己一段）', () => {
    const days = purchaseDays([extra({ label: '營養品(5000)', type: 'product' })], M);
    assert.deepEqual(days, []);
  });
});
