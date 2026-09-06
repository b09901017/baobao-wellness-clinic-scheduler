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
