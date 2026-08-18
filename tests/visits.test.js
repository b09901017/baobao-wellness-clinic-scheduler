// 來訪的狀態機與檢查。
//
// 這裡的分界線很重要：errors 會擋下儲存，warnings 不會。
// 除了醫療禁忌與「欄位根本沒填」之外都必須是 warnings（ADR-0002）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  VISIT_STATUSES, INITIAL_STATUS, describeStatus, nextStatuses, canTransition,
  isLocked, isActive, coursesForEntitlement, validateVisit,
  touchedEntitlementIds, recount,
} from '../public/js/domain/visits.js';

const COURSES = [
  { id: 'c-rehab', name: '復健科醫師門診', durationMin: 30, assigns: 'room',
    allowedRoomTypes: ['治療室'], allowedRoomIds: [], requiresEquipment: false, category: 'A' },
  { id: 'c-recovery', name: '復能', durationMin: 60, assigns: 'therapist',
    allowedRoomTypes: [], allowedRoomIds: [], requiresEquipment: true, category: 'C' },
  { id: 'c-iv', name: '營養點滴', durationMin: 60, assigns: 'room',
    allowedRoomTypes: ['點滴室'], allowedRoomIds: [], requiresIvProduct: true, category: 'C' },
  { id: 'c-inbody', name: '身體組成分析', durationMin: 20, assigns: 'room',
    allowedRoomTypes: ['治療室'], allowedRoomIds: [], frequencyRule: '每季一次', category: null },
];

const EQUIPMENT = [
  { id: 'eq-indiba', name: 'INDIBA', contraindications: [] },
  { id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] },
];

const ROOMS = [
  { id: 'r-t3', name: '治3', type: '治療室', beds: [] },
  { id: 'r-iv8', name: '點滴8', type: '點滴室', beds: ['A', 'B'] },
];

const STAFF = [{ id: 'st-tw', name: '騰崴', role: '物理治療師' }];
const IV = [{ id: 'iv-liver', name: '護肝排毒' }];

const ENTS = [
  { id: 'e-rehab', type: 'single', label: '復健科醫師門診', courseId: 'c-rehab',
    totalQty: 6, durationMin: 30, doneCount: 0, bookedCount: 0 },
  { id: 'e-pool', type: 'pool', label: '復能', optionEquipmentIds: ['eq-indiba', 'eq-sis'],
    totalQty: 2, durationMin: 60, doneCount: 0, bookedCount: 0 },
  { id: 'e-inbody', type: 'single', label: '身體組成分析', courseId: 'c-inbody',
    totalQty: 4, durationMin: 20, frequencyRule: '每季一次', doneCount: 0, bookedCount: 0 },
];

const CUSTOMER = { id: 'cust-1', name: '客戶甲', flags: [] };

const ctx = (over = {}) => ({
  customer: CUSTOMER,
  courses: COURSES,
  equipment: EQUIPMENT,
  entitlements: ENTS,
  rooms: ROOMS,
  staff: STAFF,
  ivProducts: IV,
  sameDayVisits: [],
  customerVisits: [],
  ...over,
});

const visit = (over = {}) => ({
  id: 'v-new',
  customerId: 'cust-1',
  customerName: '客戶甲',
  date: '2026-09-03',
  status: 'pending_confirm',
  slots: [{
    entitlementId: 'e-rehab', courseId: 'c-rehab', courseName: '復健科醫師門診',
    startsAt: '14:00', endsAt: '14:30', roomId: 'r-t3', bed: null,
    equipmentId: null, ivProductId: null, therapistId: null, attended: null,
  }],
  ...over,
});

describe('來訪狀態機', () => {
  test('起點是「已壓表，等客戶回覆」—— app 裡沒有還沒壓表的來訪', () => {
    assert.equal(INITIAL_STATUS, 'pending_confirm');
    assert.ok(!VISIT_STATUSES.includes('draft'));
  });

  test('已完成是終點而且鎖定，要改必須走更正流程', () => {
    assert.deepEqual(nextStatuses('done'), []);
    assert.ok(isLocked('done'));
    assert.ok(!isLocked('confirmed'));
  });

  test('取消是終點 —— 改期是取消後重新排一筆，不是改日期', () => {
    assert.deepEqual(nextStatuses('cancelled'), []);
    assert.ok(!canTransition('cancelled', 'confirmed'));
  });

  test('未到可以改回已確認 —— 只有已完成是鎖死的', () => {
    assert.ok(canTransition('no_show', 'confirmed'));
  });

  test('取消的來訪不再佔著次數', () => {
    assert.ok(isActive({ status: 'confirmed' }));
    assert.ok(!isActive({ status: 'cancelled' }));
    assert.ok(!isActive({ status: 'confirmed', deletedAt: 'x' }));
  });

  test('不認得的狀態原樣顯示，不要吞掉', () => {
    assert.equal(describeStatus('pending_confirm'), '已壓表，等客戶回覆');
    assert.equal(describeStatus('weird'), 'weird');
  });
});

describe('額度對應到哪些課程', () => {
  test('single 的額度一對一', () => {
    const out = coursesForEntitlement(ENTS[0], COURSES);
    assert.deepEqual(out.map((c) => c.id), ['c-rehab']);
  });

  test('擇一池沒有 courseId，用「需要選器材」接回去（ADR-0005）', () => {
    const out = coursesForEntitlement(ENTS[1], COURSES);
    assert.deepEqual(out.map((c) => c.id), ['c-recovery']);
  });
});

describe('會擋下儲存的（errors）', () => {
  test('一次來訪至少要有一個時段', () => {
    const { errors } = validateVisit(visit({ slots: [] }), ctx());
    assert.ok(errors.some((e) => e.includes('至少要有一個時段')));
  });

  test('結束時間要晚於開始時間', () => {
    const v = visit();
    v.slots[0].endsAt = '13:00';
    assert.ok(validateVisit(v, ctx()).errors.some((e) => e.includes('結束時間')));
  });

  test('需要選器材的課程沒選器材就存不了 —— 那是每次都不同的東西', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery',
                roomId: null, therapistId: 'st-tw', endsAt: '15:00' }],
    });
    assert.ok(validateVisit(v, ctx()).errors.some((e) => e.includes('器材')));
  });

  test('營養點滴沒選品項也存不了', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], courseId: 'c-iv', roomId: 'r-iv8', bed: 'A', endsAt: '15:00' }],
    });
    assert.ok(validateVisit(v, ctx()).errors.some((e) => e.includes('品項')));
  });

  test('醫療禁忌是硬性阻擋，不是提醒', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery',
                equipmentId: 'eq-sis', roomId: null, therapistId: 'st-tw', endsAt: '15:00' }],
    });
    const withMetal = ctx({ customer: { ...CUSTOMER, flags: ['體內金屬'] } });
    const { errors, warnings } = validateVisit(v, withMetal);
    assert.ok(errors.some((e) => e.includes('超磁場')), '禁忌必須進 errors');
    assert.ok(!warnings.some((w) => w.includes('超磁場')), '禁忌不可以只是提醒');
  });

  test('選了擇一池以外的器材會扣到不屬於它的次數，所以擋下來', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery',
                equipmentId: 'eq-other', roomId: null, therapistId: 'st-tw', endsAt: '15:00' }],
    });
    const withExtra = ctx({ equipment: [...EQUIPMENT, { id: 'eq-other', name: '別台', contraindications: [] }] });
    assert.ok(validateVisit(v, withExtra).errors.some((e) => e.includes('擇一池')));
  });

  test('填好的一筆不該有任何 error', () => {
    assert.deepEqual(validateVisit(visit(), ctx()).errors, []);
  });
});

describe('只提醒不阻擋的（warnings）', () => {
  test('同一次來訪裡自己跟自己重疊', () => {
    const v = visit();
    v.slots.push({ ...v.slots[0], startsAt: '14:15', endsAt: '14:45' });
    const { errors, warnings } = validateVisit(v, ctx());
    assert.deepEqual(errors, [], '重疊只是提醒');
    assert.ok(warnings.some((w) => w.includes('重疊')));
  });

  test('同一間診間同一時段已經排了別人', () => {
    const other = {
      id: 'v-other', customerName: '客戶乙', status: 'confirmed',
      slots: [{ startsAt: '13:45', endsAt: '14:15', roomId: 'r-t3', bed: null }],
    };
    const { errors, warnings } = validateVisit(visit(), ctx({ sameDayVisits: [other] }));
    assert.deepEqual(errors, [], 'app 看不到同事壓的東西，不能擋');
    assert.ok(warnings.some((w) => w.includes('客戶乙') && w.includes('治3')));
  });

  test('已經取消的來訪不算佔用', () => {
    const other = {
      id: 'v-other', customerName: '客戶乙', status: 'cancelled',
      slots: [{ startsAt: '13:45', endsAt: '14:15', roomId: 'r-t3', bed: null }],
    };
    assert.deepEqual(validateVisit(visit(), ctx({ sameDayVisits: [other] })).warnings, []);
  });

  test('同一間但不同床位不算撞 —— 床位才是最小單位', () => {
    const mine = visit({
      slots: [{ ...visit().slots[0], courseId: 'c-iv', ivProductId: 'iv-liver',
                roomId: 'r-iv8', bed: 'A', endsAt: '15:00' }],
    });
    const other = {
      id: 'v-other', customerName: '客戶乙', status: 'confirmed',
      slots: [{ startsAt: '14:00', endsAt: '15:00', roomId: 'r-iv8', bed: 'B' }],
    };
    assert.deepEqual(validateVisit(mine, ctx({ sameDayVisits: [other] })).warnings, []);
  });

  test('同一位治療師同一時段已經排了別人', () => {
    const mine = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery',
                equipmentId: 'eq-indiba', roomId: null, therapistId: 'st-tw', endsAt: '15:00' }],
    });
    const other = {
      id: 'v-other', customerName: '客戶乙', status: 'pending_confirm',
      slots: [{ startsAt: '14:30', endsAt: '15:30', therapistId: 'st-tw' }],
    };
    const { warnings } = validateVisit(mine, ctx({ sameDayVisits: [other] }));
    assert.ok(warnings.some((w) => w.includes('騰崴')));
  });

  test('排在課程不常用的診間只是提醒', () => {
    const v = visit();
    v.slots[0].roomId = 'r-iv8';
    const { errors, warnings } = validateVisit(v, ctx());
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('治3')));
  });

  test('該選診間沒選、該選治療師沒選都要說', () => {
    const v = visit();
    v.slots[0].roomId = null;
    assert.ok(validateVisit(v, ctx()).warnings.some((w) => w.includes('還沒選診間')));
  });

  test('排下去會超過總次數', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery',
                equipmentId: 'eq-indiba', roomId: null, therapistId: 'st-tw', endsAt: '15:00' }],
    });
    const past = [
      { id: 'v1', status: 'done', slots: [{ entitlementId: 'e-pool' }] },
      { id: 'v2', status: 'confirmed', slots: [{ entitlementId: 'e-pool' }] },
    ];
    const { errors, warnings } = validateVisit(v, ctx({ customerVisits: past }));
    assert.deepEqual(errors, [], '超用只提醒，她可能就是要加賣');
    assert.ok(warnings.some((w) => w.includes('超過總次數')));
  });

  test('排在額度到期日之後', () => {
    const withExpiry = ctx({
      entitlements: ENTS.map((e) => (e.id === 'e-rehab' ? { ...e, expiresAt: '2026-08-31' } : e)),
    });
    assert.ok(validateVisit(visit(), withExpiry).warnings.some((w) => w.includes('到期')));
  });

  test('每季一次的課程要說上次是什麼時候、距今幾天', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-inbody', courseId: 'c-inbody',
                endsAt: '14:20' }],
    });
    const past = [{
      id: 'v-old', status: 'done', date: '2026-08-04',
      slots: [{ entitlementId: 'e-inbody', courseId: 'c-inbody' }],
    }];
    const { errors, warnings } = validateVisit(v, ctx({ customerVisits: past }));
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('每季一次') && w.includes('2026-08-04') && w.includes('30 天')));
  });

  test('沒有上一次就不用提頻率', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-inbody', courseId: 'c-inbody', endsAt: '14:20' }],
    });
    assert.deepEqual(validateVisit(v, ctx()).warnings, []);
  });
});

describe('計數欄位重算', () => {
  const visits = [
    { id: 'v1', status: 'done', slots: [{ entitlementId: 'e1' }, { entitlementId: 'e2' }] },
    { id: 'v2', status: 'confirmed', slots: [{ entitlementId: 'e1' }] },
    { id: 'v3', status: 'cancelled', slots: [{ entitlementId: 'e1' }] },
    { id: 'v4', status: 'done', slots: [{ entitlementId: 'e1' }], deletedAt: 'x' },
  ];

  test('動到的額度要含舊版本與新版本，不然舊的那筆會少還次數', () => {
    const before = { slots: [{ entitlementId: 'e1' }] };
    const after = { slots: [{ entitlementId: 'e2' }] };
    assert.deepEqual(touchedEntitlementIds(before, after).sort(), ['e1', 'e2']);
  });

  test('重算只認未取消、未刪除的來訪', () => {
    assert.deepEqual(recount(['e1', 'e2'], visits), {
      e1: { doneCount: 1, bookedCount: 1 },
      e2: { doneCount: 1, bookedCount: 0 },
    });
  });
});
