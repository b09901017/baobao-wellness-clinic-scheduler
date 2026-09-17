// 拍訂購單 → 新增客戶／加購（issue 09，ADR-0099）。
//
// **這一支有沒有任何一行，讓 AI 決定這位客人買的是哪一個方案？**
// —— 沒有：方案是名稱比對（去掉價格字頭），對不上就空著。
//
// 假抄字一律王小明、客戶A；沒有任何真的單子上的字。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  addOnChanges, addOnTarget, blockersOf, detachPhoto, extraFromRow, groupOrderForms, mergeTranscripts, orderDraftFrom,
  planForPrinted, purchaseDateOf, readAmount, readQuantity, summaryOf,
} from '../public/js/domain/orderForm.js';
import { SEED } from '../public/js/domain/seed.js';

const master = {
  plans: SEED.plans, courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts ?? [],
  clinicalFlags: [{ id: 'cf-metal', name: '體內金屬' }], partners: [{ id: 'p1', name: '自然美' }],
};

const form = (over = {}) => ({
  readable: true, unreadable: [], customerName: '王小明', formMonth: '2026年08月', handwrittenDates: ['8/27'],
  packages: [], checkupTicked: [], handwrittenRows: [], unpaid: '0', obNote: '', stickyNotes: [], ...over,
});

describe('讀數字', () => {
  test('數量：1、一、—、2、×15', () => {
    assert.equal(readQuantity('1'), 1);
    assert.equal(readQuantity('一'), 1);
    assert.equal(readQuantity('—'), 1);
    assert.equal(readQuantity('2'), 2);
    assert.equal(readQuantity('x15'), 15);
    assert.equal(readQuantity('T'), null, '讀不出來就是 null，不猜');
  });

  test('金額：8萬、80000,-、12.9万、3W、空白', () => {
    assert.equal(readAmount('8萬'), 80000);
    assert.equal(readAmount('80000,-'), 80000);
    assert.equal(readAmount('12.9万'), 129000);
    assert.equal(readAmount('3W'), 30000);
    assert.equal(readAmount(''), 0);
    assert.equal(readAmount('0'), 0);
  });
});

describe('購買日', () => {
  test('手寫日期在表頭月份前後一個月內才採用', () => {
    assert.equal(purchaseDateOf('2026年08月', ['8/27']), '2026-08-27');
    assert.equal(purchaseDateOf('2026年08月', ['0901']), '2026-09-01');
    assert.equal(purchaseDateOf('2026年08月', ['3/2']), null);
    assert.equal(purchaseDateOf('2026年12月', ['1/3']), '2027-01-03', '跨年');
    assert.equal(purchaseDateOf('', ['8/27']), null, '沒有表頭月份就不猜年份');
  });
});

describe('方案與加購', () => {
  test('印好的「8萬筋骨強身」→ 筋骨強身那一份範本；對不上 → null', () => {
    assert.equal(planForPrinted('8萬筋骨強身', master.plans)?.id, 'plan-jingu');
    assert.equal(planForPrinted('19萬健體養護', master.plans), null);
  });

  test('手寫列：任選(30) ×10 → 復能三台的擇一池 30 分', () => {
    const x = extraFromRow({ text: '任選(30)', quantity: '10' }, master);
    assert.equal(x.type, 'pool');
    assert.equal(x.totalQty, 10);
    assert.equal(x.durationMin, 30);
    assert.deepEqual([...x.optionEquipmentIds].sort(), ['eq-indiba', 'eq-laser', 'eq-sis']);
    assert.equal(x.label, '復能-三選一(30)');
  });

  test('手寫列的容錯：TLIB (60) 是 ILIB、代選(30) 是任選（2026-09-17 考試抄錯過的兩種）', () => {
    assert.equal(extraFromRow({ text: 'TLIB (60)', quantity: '5' }, master)?.courseId, 'course-iv-laser');
    assert.equal(extraFromRow({ text: '代選(30)x15' }, master)?.totalQty, 15);
  });

  test('EECP 40堂、SIS 60分 ×10、ILIB 30分 ×1', () => {
    const eecp = extraFromRow({ text: 'EECP 40堂' }, master);
    assert.equal(eecp.courseId, 'course-eecp');
    assert.equal(eecp.totalQty, 40);
    const sis = extraFromRow({ text: 'SIS 60分', quantity: '10' }, master);
    assert.deepEqual(sis.optionEquipmentIds, ['eq-sis']);
    assert.equal(sis.durationMin, 60);
    const ilib = extraFromRow({ text: 'ILIB 30分', quantity: '1' }, master);
    assert.equal(ilib.courseId, 'course-iv-laser');
    assert.equal(ilib.durationMin, 30);
  });

  test('認不出來 → null（確認卡上留原字那一列讓她選或拿掉）', () => {
    assert.equal(extraFromRow({ text: '冷凍減脂', quantity: '3' }, master), null);
  });
});

describe('一張訂購單 → 一位客戶的草稿', () => {
  test('筋骨強身 ×1 ＋ 手寫任選(30) ×10、尚欠尾款 0：方案一套、加購一筆、沒有尾款備註、通路是顧客會', () => {
    const { draft, seen, unresolved } = orderDraftFrom(form({
      packages: [{ printedName: '8萬筋骨強身', quantity: '1' }],
      handwrittenRows: [{ text: '任選(30)', quantity: '10' }],
    }), master);
    assert.equal(draft.name, '王小明');
    assert.equal(draft.planId, 'plan-jingu');
    assert.equal(draft.quantity, 1);
    assert.equal(draft.purchasedAt, '2026-08-27');
    assert.equal(draft.source, '顧客會');
    assert.equal(draft.extras.length, 1);
    assert.equal(draft.extras[0].label, '復能-三選一(30)');
    assert.equal(draft.marks.some((m) => m.text.includes('尾款')), false);
    assert.equal(draft.phone, '', '電話不抄');
    assert.deepEqual(unresolved, []);
    assert.equal(seen.plan, '8萬筋骨強身');
  });

  test('筋骨強身 ×2 ＋ 健檢 12 萬、尚欠尾款 3萬 → 兩套、健檢帶 12萬 等級、一則紅色尾款備註', () => {
    const { draft } = orderDraftFrom(form({
      packages: [{ printedName: '8萬筋骨強身', quantity: '2' }, { printedName: '功醫健檢', quantity: '1' }],
      checkupTicked: ['12萬'],
      unpaid: '3萬',
    }), master);
    assert.equal(draft.quantity, 2);
    const checkup = draft.extras.find((x) => x.courseId === 'course-checkup');
    assert.equal(checkup.tier, '12萬');
    assert.equal(checkup.totalQty, 1);
    assert.equal(draft.extras.filter((x) => x.courseId === 'course-checkup').length, 1, '功醫健檢那一列不是第二筆健檢');
    assert.deepEqual(draft.marks.filter((m) => m.color === 'red'), [{ text: '尾款 3萬', color: 'red' }]);
  });

  test('便利貼寫「自然美」→ 合作機構按下；寫「體內金屬」→ 警示按下，而且有紅卡那一句', () => {
    const { draft, hints } = orderDraftFrom(form({ stickyNotes: ['自然美 介紹', '手有體內金屬'] }), master);
    assert.deepEqual(draft.partners, ['自然美']);
    assert.deepEqual(draft.flags, ['體內金屬']);
    assert.ok(draft.marks.some((m) => m.text === '手有體內金屬' && m.color === 'grey'), '原文照樣留成備註');
    assert.ok(Array.isArray(hints));
  });

  test('印好的方案對不上 → planId 空著，列進 unresolved（附原字）', () => {
    const { draft, unresolved } = orderDraftFrom(form({ packages: [{ printedName: '19萬健體養護', quantity: '1' }] }), master);
    assert.equal(draft.planId, null);
    assert.deepEqual(unresolved.map((u) => u.text), ['19萬健體養護']);
  });

  test('沒有任何 id 從抄字直接進草稿：多吐一個 planId 也不會被讀', () => {
    const { draft } = orderDraftFrom(form({ planId: 'plan-8wan', customerId: 'c1' }), master);
    assert.equal(draft.planId, null);
  });
});

describe('一次好幾張照片怎麼分人（spec 暫定）', () => {
  const t = (name, extra = {}) => ({ transcript: form({ customerName: name, ...extra }), url: `blob:${name || 'x'}` });

  test('每張一位；名字一樣的併成一位；認不出名字的掛在前一張上', () => {
    const groups = groupOrderForms([t('王小明'), t('李小華'), t(''), t('王小明')]);
    assert.deepEqual(groups.map((g) => g.name), ['王小明', '李小華']);
    assert.equal(groups[0].photos.length, 2);
    assert.equal(groups[1].photos.length, 2);
    assert.equal(groups[1].photos[1].attached, true, '沒有名字的那張標出來，她點一下拆開');
  });

  test('第一張就認不出名字 → 自己一位，名字空著', () => {
    const groups = groupOrderForms([t(''), t('王小明')]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].name, '');
  });
});

describe('讀不出來的就空著', () => {
  test('套組數量抄成「T」→ 幾套空著、列進 unresolved，建立按不下去', () => {
    const { draft, unresolved } = orderDraftFrom(form({ packages: [{ printedName: '8萬筋骨強身', quantity: 'T' }] }), master);
    assert.equal(draft.planId, 'plan-jingu');
    assert.equal(draft.quantity, '', '不是 0，也不是 1');
    assert.deepEqual(unresolved, [{ kind: 'quantity', text: 'T' }]);
  });

  test('「功醫健檢」那一列有數量、勾選格卻沒勾 → 講出來讓她選，不猜幾萬', () => {
    const { draft, unresolved } = orderDraftFrom(form({ packages: [{ printedName: '功醫健檢', quantity: '1' }] }), master);
    assert.equal(draft.extras.length, 0);
    assert.deepEqual(unresolved.map((u) => u.text), ['功醫健檢']);
  });

  test('光禿禿的數字：SIS 60 是時長、EECP 40 是次數（看那個課程分不分時長）', () => {
    const sis = extraFromRow({ text: 'SIS 60', quantity: '5' }, master);
    assert.equal(sis.durationMin, 60);
    assert.equal(sis.totalQty, 5);
    const eecp = extraFromRow({ text: 'EECP 40' }, master);
    assert.equal(eecp.totalQty, 40);
    assert.equal(eecp.durationMin, null);
  });

  test('尾款寫了字但讀不出來 → 照樣一則紅色，原字照抄；「尾款0」→ 沒有', () => {
    assert.deepEqual(orderDraftFrom(form({ unpaid: '尾款?' }), master).draft.marks, [{ text: '尾款 ?', color: 'red' }]);
    assert.deepEqual(orderDraftFrom(form({ unpaid: '尾款0' }), master).draft.marks, []);
  });

  test('健檢勾選格旁邊寫了一長串（等級存不下）→ 講出來讓她選，不建一筆 Rules 會擋的額度', () => {
    const { draft, unresolved } = orderDraftFrom(form({ checkupTicked: ['另外加做腸胃鏡與心臟超音波的那一種全套方案'] }), master);
    assert.equal(draft.extras.length, 0);
    assert.equal(unresolved.length, 1);
  });

  test('表頭是民國年也認', () => {
    assert.equal(purchaseDateOf('115年8月', ['8/27']), '2026-08-27');
  });
});

describe('兩張照片併成一位', () => {
  test('同一個方案兩張 → 兩套，兩個原字都看得到；便利貼那張的字也進來', () => {
    const merged = mergeTranscripts([
      form({ packages: [{ printedName: '8萬筋骨強身', quantity: '1' }] }),
      form({ customerName: '', formMonth: '', handwrittenDates: [], stickyNotes: ['尾款下次補'], unpaid: '' }),
      form({ packages: [{ printedName: '8萬筋骨強身', quantity: '1' }], unpaid: '2萬' }),
    ]);
    const { draft, seen } = orderDraftFrom(merged, master);
    assert.equal(draft.name, '王小明');
    assert.equal(draft.quantity, 2);
    assert.equal(seen.quantity, '1、1');
    assert.deepEqual(draft.marks.map((m) => m.text), ['尾款 2萬', '尾款下次補']);
  });

  test('拆開：掛上去的那一張自己變成一位，排在原本那一位後面', () => {
    const t = (name) => ({ transcript: form({ customerName: name }), url: `blob:${name || 'x'}` });
    const groups = groupOrderForms([t('王小明'), t(''), t('李小華')]);
    const split = detachPhoto(groups, groups[0].key, 'blob:x');
    assert.deepEqual(split.map((g) => [g.name, g.photos.length]), [['王小明', 1], ['', 1], ['李小華', 1]]);
    assert.equal(split[1].photos[0].attached, false);
    assert.notEqual(split[1].key, split[0].key);
  });
});

describe('確認卡：建立按得下去嗎', () => {
  const card = (over = {}) => ({
    draft: orderDraftFrom(form(), master).draft, unresolved: [], nameOk: false, who: null, ...over,
  });
  const existing = [{ id: 'c1', name: '王小明' }, { id: 'c2', name: '李小華' }];

  test('沒有同名：名字要她點過「名字對」才算數', () => {
    assert.equal(blockersOf(card(), []).length, 1);
    assert.deepEqual(blockersOf(card({ nameOk: true }), []), []);
  });

  test('同名：兩顆都沒選時按不下去；選了其中一顆就可以', () => {
    assert.match(blockersOf(card({ nameOk: true }), existing)[0], /已經有 1 位「王小明」/);
    assert.deepEqual(blockersOf(card({ who: 'new' }), existing), []);
    assert.deepEqual(blockersOf(card({ who: 'c1' }), existing), []);
    assert.equal(blockersOf(card({ who: 'c2' }), existing).length, 1, '選到的那一位不叫這個名字 → 不算');
    assert.equal(addOnTarget(card({ who: 'c1' }), existing).id, 'c1');
    assert.equal(addOnTarget(card({ who: 'new' }), existing), null);
  });

  test('沒名字、幾套讀不出來、還有認不出來的 → 各講一句', () => {
    const c = card({ nameOk: true, unresolved: [{ kind: 'extra', text: '冷凍減脂' }] });
    c.draft = { ...c.draft, name: '', planId: 'plan-jingu', quantity: '' };
    assert.equal(blockersOf(c, existing).length, 3);
  });

  test('加購到既有客戶：備註接在後面、警示與機構併進去，既有的一個都不拿掉', () => {
    const customer = { id: 'c1', name: '王小明', flags: ['血管難打'], partners: [], marks: [{ text: '怕冷', color: 'blue' }], notes: '怕冷' };
    const changes = addOnChanges(customer, { marks: [{ text: '怕冷', color: 'grey' }, { text: '尾款 3萬', color: 'red' }], flags: ['體內金屬'], partners: ['自然美'] });
    assert.deepEqual(changes.marks, [{ text: '怕冷', color: 'blue' }, { text: '尾款 3萬', color: 'red' }]);
    assert.equal(changes.notes, '怕冷\n尾款 3萬');
    assert.deepEqual(changes.flags, ['血管難打', '體內金屬']);
    assert.deepEqual(changes.partners, ['自然美']);
    assert.equal(addOnChanges(customer, { marks: [], flags: ['血管難打'], partners: [] }), null);
  });

  test('摘要講得出是哪一位沒建', () => {
    const s = summaryOf([
      { draft: { name: '王小明' }, state: 'done' },
      { draft: { name: '李小華' }, state: 'failed' },
      { draft: { name: '' }, state: 'open' },
    ]);
    assert.equal(s.line, '建好了 1 位；李小華 沒建立；還有 1 位沒按建立');
  });
});
