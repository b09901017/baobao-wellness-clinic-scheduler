// 拍方案文宣 → 方案範本（issue 07，ADR-0099）。
//
// **這一支有沒有任何一行，讓 AI 決定一個項目是擇一池還是單一課程？**
// 抄字格式裡沒有那一格；這裡盯的是 domain 自己讀字讀得對：
// 「高能量雷射 或 超磁場 或 INDIBA 共計60min」是三台的擇一池、叫 `復能-三選一(60)`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { planDraftFrom, membershipMonthsOf, quantityOf } from '../public/js/domain/photoPlan.js';
import { SEED } from '../public/js/domain/seed.js';
import { validate } from '../public/js/domain/masterData.js';

const master = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts ?? [] };

// 文宣上的版面（沒有個資）
const flyer = {
  readable: true,
  unreadable: [],
  title: '筋骨強身',
  priceText: '$288,000',
  membershipText: '會籍 1 年(限本人)',
  items: [
    { category: '醫療專業諮詢', text: '復健科醫師門診', detailText: '30min', quantityText: '6' },
    { category: '醫療專業諮詢', text: '物理治療師諮詢', detailText: '20min', quantityText: '4' },
    { category: '醫療專業諮詢', text: '營養師諮詢', detailText: '20min', quantityText: '4' },
    { category: '健康檢測', text: '身體組成分析', detailText: '每季一次', quantityText: '4' },
    { category: '健康檢測', text: '體適能檢查分析', detailText: '每季一次', quantityText: '4' },
    { category: '物理賦能課程', text: '高能量雷射 或 超磁場 或 INDIBA', detailText: '共計60min', quantityText: '12' },
    { category: '物理賦能課程', text: '經皮靜脈雷射', detailText: '60min (不可更換項目)', quantityText: '20' },
  ],
};

describe('筋骨強身那一張', () => {
  const { plan, seen } = planDraftFrom(flyer, master);

  test('七個項目，次數 6／4／4／4／4／12／20', () => {
    assert.equal(plan.items.length, 7);
    assert.deepEqual(plan.items.map((it) => it.qty), [6, 4, 4, 4, 4, 12, 20]);
  });

  test('復能那一項是三台的擇一池、60 分，名字是算出來的 復能-三選一(60)', () => {
    const pool = plan.items[5];
    assert.equal(pool.type, 'pool');
    assert.deepEqual([...pool.optionEquipmentIds].sort(), ['eq-indiba', 'eq-laser', 'eq-sis']);
    assert.equal(pool.durationMin, 60);
    assert.equal(pool.label, '復能-三選一(60)');
    assert.notEqual(pool.label, '高能量雷射 或 超磁場 或 INDIBA 共計60min');
  });

  test('ILIB 是 single、60 分（文宣寫「經皮靜脈雷射」）', () => {
    const ilib = plan.items[6];
    assert.equal(ilib.type, 'single');
    assert.equal(ilib.courseId, 'course-iv-laser');
    assert.equal(ilib.durationMin, 60);
    assert.equal(ilib.label, 'ILIB(60)');
  });

  test('方案名、會籍、備註', () => {
    assert.equal(plan.name, '筋骨強身');
    assert.equal(plan.membershipMonths, 12);
    assert.equal(plan.note, '總價 288,000，限本人');
  });

  test('每季一次 → 頻率限制；時長照文宣', () => {
    assert.equal(plan.items[3].frequencyRule, '每季一次');
    assert.equal(plan.items[0].durationMin, 30);
    assert.equal(plan.items[1].durationMin, 20);
  });

  test('跟種子裡手打的那一份一樣（項目欄位沒有多出「來自照片」之類的東西）', () => {
    const seed = SEED.plans.find((p) => p.id === 'plan-jingu');
    const strip = (it) => Object.fromEntries(Object.entries(it).sort(([a], [b]) => a.localeCompare(b)));
    const want = seed.items.map((it) => strip({ ...it, optionEquipmentIds: it.optionEquipmentIds && [...it.optionEquipmentIds].sort() }));
    const got = plan.items.map((it) => strip({ ...it, optionEquipmentIds: it.optionEquipmentIds && [...it.optionEquipmentIds].sort() }));
    // 身體組成分析的時長文宣沒寫 → 帶課程預設（種子是 20）
    assert.deepEqual(got, want);
    assert.deepEqual(Object.keys(plan).sort(), ['items', 'membershipMonths', 'name', 'note']);
  });

  test('照片上的原字跟著每一項（給「照片上寫的是」那顆小丸子），不在方案本身', () => {
    assert.equal(seen.items[5].text, '高能量雷射 或 超磁場 或 INDIBA');
    assert.equal(seen.items[5].quantityText, '12');
    assert.equal(seen.items.length, plan.items.length);
  });

  test('驗證照原本的 validators.plans() 過得了', () => {
    assert.deepEqual(validate('plans', plan, master), []);
  });
});

describe('認不出來就空著', () => {
  test('主檔沒有的課程 → 那一項 courseId 是 null、標成認不出、存不下去', () => {
    const { plan, seen } = planDraftFrom({
      ...flyer, items: [{ text: '冷凍減脂', detailText: '45min', quantityText: '3' }],
    }, master);
    assert.equal(plan.items[0].type, 'single');
    assert.equal(plan.items[0].courseId, null);
    assert.equal(plan.items[0].qty, 3);
    assert.equal(seen.items[0].unresolved, true);
    assert.equal(seen.items[0].text, '冷凍減脂');
    assert.ok(validate('plans', plan, master).some((e) => /要選一個課程/.test(e)));
  });

  test('或 的其中一台認不出 → 不猜，整項空著', () => {
    const { plan, seen } = planDraftFrom({
      ...flyer, items: [{ text: '高能量雷射 或 震波', detailText: '共計60min', quantityText: '10' }],
    }, master);
    assert.equal(seen.items[0].unresolved, true);
    assert.equal(plan.items[0].courseId, null);
  });

  test('次數讀不出來 → null（驗證會擋），不是 1', () => {
    assert.equal(quantityOf('約十'), null);
    assert.equal(quantityOf('12次'), 12);
  });
});

describe('會籍', () => {
  test('1 年 → 12；6 個月 → 6；沒寫 → 12（新增方案的預設）', () => {
    assert.equal(membershipMonthsOf('會籍 1 年(限本人)'), 12);
    assert.equal(membershipMonthsOf('會籍6個月'), 6);
    assert.equal(membershipMonthsOf(''), 12);
  });
});
