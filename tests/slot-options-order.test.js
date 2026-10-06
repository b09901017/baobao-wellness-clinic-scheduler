// 來訪的「做什麼」那一排：照分類排（2026-10-06，issue 08）；**小標 2026-10-07 拿掉了**（issue 16）。
//
// 她的原話：
//
// > …或是新增來訪的選課程，都可以參考課程種類與項目.md去分層丸子選
//
// 問她「照分類排、加小標、不多按一下；還是跟加購一樣先按分類再按項目？」，她回：
//
// > 問題 5：我覺得先照你的建議依照分類排列並加小標，不增加點選步驟，但是要提醒我去測試和你說好不好
//
// 她在 staging 試完（2026-10-06，issue 16）：
//
// > 我覺得壓表或是新增來訪的地方就不用每一類前面有灰色小標，也就是如果是這個人有的，肯定不會很多，
// > 就和之前一樣一次呈現所有的丸子就好不需要灰色小標。加購的話也就是一次會呈現所有課程的地方，就維持你這次修改的
//
// 所以：順序照舊、二返照舊另起一行，三個入口一個小標都不畫。
//
// 順序只在 `domain/slotOptions.js` 一支算（`arrangeSlotOptions()`），三個入口都照它：
// 壓表（`slotOptionsFor()` 回的就是排好的）、來訪編輯器（自己算剩幾次，順序問同一支）、拍 Abovee。
//
// 兩條既有的規矩不可以掉：二返一律排最後（她 2026-09-24：「跟健檢並排一指就約錯」），
// 而且**健檢那一顆與二返那一顆不可以緊鄰** —— 照分類排之後健檢是最後一類，不處理的話兩顆每一次都相鄰。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  slotOptionsFor, arrangeSlotOptions, FOLLOWUP_GROUP, NTH_PICK,
} from '../public/js/domain/slotOptions.js';
import { followupsLast } from '../public/js/domain/scheduling.js';
import { coursesForEntitlement } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';

const master = { courses: SEED.courses, equipment: SEED.equipment };

const ent = (id, courseId, label, over = {}) => ({
  id, customerId: 'c1', type: 'single', courseId, label,
  totalQty: 10, doneCount: 0, bookedCount: 0, ...over,
});

/** 一位買了大方案的客戶：復能三選一、ILIB、健檢＋二返、身體組成、營養點滴、心臟科評估。 */
const BIG = [
  ent('e-pool', null, '復能-三選一(60)', {
    type: 'pool', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], durationMin: 60,
  }),
  ent('e-ilib', 'course-iv-laser', 'ILIB(60)', { durationMin: 60 }),
  ent('e-chk', 'course-checkup', '8萬健檢', { totalQty: 1 }),
  ent('e-fu', 'course-followup', '二返(8萬健檢)', { totalQty: 1, followupForEntitlementId: 'e-chk' }),
  ent('e-inbody', 'course-inbody', '身體組成分析', { totalQty: 2 }),
  ent('e-drip', 'course-iv-drip', '營養點滴 - 雪顏亮采', { totalQty: 6 }),
  ent('e-cardio', 'course-cardio', '心臟科評估', { totalQty: 1 }),
];

const options = (entitlements, visits = []) => slotOptionsFor({ entitlements, visits, ...master });
const groups = (out) => [...new Set(out.map((o) => o.group))];

describe('照分類排，一個小標都不畫', () => {
  test('大方案的客戶：照分類的順序，二返那一組在最後', () => {
    const out = options(BIG);
    assert.deepEqual(groups(out),
      ['復能', 'ILIB', '醫師門診', '運動區', '營養點滴', '健檢', FOLLOWUP_GROUP]);
    assert.deepEqual(out.map((o) => o.label), [
      '復能-三選一(60)', 'ILIB(60)',
      '心臟科評估', '功醫門診', 'HRV',
      '身體組成分析', '營養點滴 - 雪顏亮采', '8萬健檢',
      '二返(8萬健檢)',
    ]);
    assert.ok(out.every((o) => typeof o.group === 'string' && o.group));
  });

  test('每一顆都沒有小標（她：「就和之前一樣一次呈現所有的丸子就好不需要灰色小標」）', () => {
    for (const list of [options(BIG), options([BIG[0]]), options(BIG, [{
      id: 'v-chk', customerId: 'c1', date: '2026-09-01', status: 'done',
      slots: [{ entitlementId: 'e-chk', courseId: 'course-checkup', status: 'done', attended: true }],
    }])]) {
      assert.ok(list.length > 1);
      assert.ok(list.every((o) => o.lead == null), list.map((o) => o.lead).join('/'));
    }
  });

  test('不算次數的課接在它那一類的額度後面（功醫門診與 HRV 在醫師門診那一組）', () => {
    const out = options(BIG);
    const doctor = out.filter((o) => o.group === '醫師門診');
    assert.deepEqual(doctor.map((o) => [o.label, Boolean(o.isUncounted)]),
      [['心臟科評估', false], ['功醫門診', true], ['HRV', true]]);
  });

  test('只買了復能的客戶：仍然有醫師門診那一組（功醫門診、HRV）', () => {
    const out = options([BIG[0]]);
    assert.deepEqual(groups(out), ['復能', '醫師門診']);
  });

  test('整排只有一類：不另起一行', () => {
    const noFree = { ...master, courses: SEED.courses.map((c) => ({ ...c, uncounted: false })) };
    const out = slotOptionsFor({ entitlements: [BIG[0]], ...noFree });
    assert.equal(out.length, 1);
    assert.equal(out[0].breakBefore, false);
  });

  test('同一類裡的額度照名字排，不照剩幾次（兩個入口的「剩幾次」算法不一樣）', () => {
    const two = [
      ent('e-b', 'course-rehab', '復健科醫師門診', { totalQty: 10 }),
      ent('e-a', 'course-cardio', '心臟科評估', { totalQty: 1 }),
    ];
    const labels = options(two).filter((o) => !o.isUncounted).map((o) => o.label);
    const byName = ['復健科醫師門診', '心臟科評估'].sort((a, b) => a.localeCompare(b, 'zh-TW'));
    assert.deepEqual(labels, byName);
  });

  test('擇一池的額度算它推出來的第一門課那一類', () => {
    const pool = options([BIG[0]]).find((o) => o.entitlementId === 'e-pool');
    assert.equal(pool.group, '復能');
  });
});

describe('二返照舊一律排最後，而且不跟健檢緊鄰', () => {
  const done = {
    id: 'v-chk', customerId: 'c1', date: '2026-09-01', status: 'done',
    slots: [{ entitlementId: 'e-chk', courseId: 'course-checkup', status: 'done', attended: true }],
  };

  test('健檢與二返在不同組；二返那一組另起一行（breakBefore）', () => {
    const out = options(BIG);
    const exam = out.findIndex((o) => o.entitlementId === 'e-chk');
    const back = out.findIndex((o) => o.entitlementId === 'e-fu');
    assert.ok(back > exam);
    assert.notEqual(out[exam].group, out[back].group);
    assert.equal(out[back].breakBefore, true, '只隔一條線不夠 —— 實體上還是隔壁');
    assert.equal(out.filter((o) => o.breakBefore).length, 1);
  });

  test('二返在所有額度的最後；＋ n返 跟它同一組、接在後面', () => {
    const out = options(BIG, [done]);
    const tail = out.slice(-2);
    assert.deepEqual(tail.map((o) => o.entitlementId), ['e-fu', NTH_PICK]);
    assert.ok(tail.every((o) => o.group === FOLLOWUP_GROUP));
    assert.deepEqual(tail.map((o) => o.breakBefore), [true, false], '另起一行的只有那一組的第一顆');
  });

  test('只有二返那一組（沒有別的可以排）：不另起一行', () => {
    const noFree = { ...master, courses: SEED.courses.map((c) => ({ ...c, uncounted: false })) };
    const out = slotOptionsFor({ entitlements: [BIG[3]], ...noFree });
    assert.deepEqual(out.map((o) => o.breakBefore), [false]);
  });

  test('followupsLast() 一個字都沒改', () => {
    const src = readFileSync(new URL('../public/js/domain/scheduling.js', import.meta.url), 'utf8');
    assert.match(src, /export const followupsLast = \(a, b\) =>\n {2}Number\(Boolean\(a\?\.followupForEntitlementId\)\) - Number\(Boolean\(b\?\.followupForEntitlementId\)\);/);
  });
});

describe('兩個入口都有的那幾顆，相對順序一樣', () => {
  test('來訪編輯器的組法（讀回來的順序＋followupsLast、列用完的）排出來跟壓表的相對順序一樣', () => {
    const used = ent('e-used', 'course-rehab', '復健科醫師門診', { totalQty: 1, doneCount: 1 });
    const board = options([...BIG, used]);
    // 來訪編輯器：自己的那一份（全部額度、讀回來的順序）＋ 不算次數的課，交給同一支排
    const editorInput = [...BIG, used].slice().reverse().sort(followupsLast).map((e) => ({
      entitlementId: e.id, label: e.label, entitlement: e,
      course: coursesForEntitlement(e, SEED.courses, SEED.equipment)[0] ?? null,
    }));
    const free = SEED.courses.filter((c) => c.uncounted === true && c.active !== false)
      .map((c) => ({ entitlementId: `free:${c.id}`, label: c.name, course: c, entitlement: null, isUncounted: true }));
    const editor = arrangeSlotOptions([...editorInput, ...free], SEED.courses);

    const shared = (list) => list.filter((o) => board.some((b) => b.label === o.label)).map((o) => [o.label, o.group, o.breakBefore]);
    assert.deepEqual(shared(editor), shared(board));
    assert.ok(editor.some((o) => o.entitlementId === 'e-used'), '編輯器照舊列用完的');
  });
});

describe('三個入口都照同一支排', () => {
  const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8');

  test('來訪編輯器的額度那一排問 arrangeSlotOptions()', () => {
    assert.match(read('ui/views/visitEditor.js'), /arrangeSlotOptions\(/);
  });

  test('三個入口都另起一行、都不畫小標', () => {
    for (const rel of ['ui/views/schedule.js', 'ui/components/aboveeConfirm.js', 'ui/views/visitEditor.js']) {
      const src = read(rel);
      assert.match(src, /\.breakBefore\b/, `${rel} 要另起一行`);
      assert.doesNotMatch(src, /\b[oc]\.lead\b/, `${rel} 不畫小標了（issue 16）`);
      assert.doesNotMatch(src, /chips__head/, `${rel} 不畫小標了（issue 16）`);
    }
  });

  test('加購那一排的小標照舊（她：「加購的話…就維持你這次修改的」）', () => {
    assert.match(read('ui/components/buy.js'), /lead: '商品'/);
    assert.match(read('ui/components/form.js'), /chiprow__lead/);
  });
});
