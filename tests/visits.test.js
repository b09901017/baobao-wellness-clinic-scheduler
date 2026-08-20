// 來訪的狀態機與檢查。
//
// 這裡的分界線很重要：errors 會擋下儲存，warnings 不會。
// 除了醫療禁忌與「欄位根本沒填」之外都必須是 warnings（ADR-0002）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import {
  VISIT_STATUSES, INITIAL_STATUS, describeStatus, nextStatuses, canTransition,
  isLocked, isActive, isImported, coursesForEntitlement, validateVisit,
  touchedEntitlementIds, recount,
  statusClass, shortStatus, markFor, MARK_ORDER, MARK_LEGEND, STATUS_VIEW_ORDER,
  visitsToClose, closeVisit,
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

describe('一個狀態長什麼樣（只有這一份）', () => {
  // 日曆、進度追蹤頁、試算表全部讀 STATUS_VIEW。她的原話是
  // 「前面說的流程，寫程式的時候都要記得同步，這很重要」。

  test('每一個狀態都有符號、class 與短名，不會漏掉某一種', () => {
    for (const status of VISIT_STATUSES) {
      assert.ok(statusClass(status), `${status} 沒有 class`);
      assert.ok(shortStatus(status), `${status} 沒有短名`);
      assert.ok(describeStatus(status), `${status} 沒有完整說明`);
      // 取消是唯一沒有符號的：時段已經還回去了，那一格本來就不該有東西
      if (status !== 'cancelled') assert.ok(markFor(status), `${status} 沒有符號`);
    }
    assert.equal(markFor('cancelled'), '');
  });

  test('使用者選的三個符號沒有被改掉（2026-08-20）', () => {
    assert.equal(markFor('pending_confirm'), '○');
    assert.equal(markFor('confirmed'), '△');
    assert.equal(markFor('done'), '✓');
  });

  test('同一格混在一起時做完的排前面、未到排最後', () => {
    assert.deepEqual(MARK_ORDER, ['✓', '△', '○', '✗']);
  });

  test('圖例跟著符號走，不是手寫的第二份', () => {
    for (const mark of MARK_ORDER) {
      assert.ok(MARK_LEGEND.includes(mark), `圖例少了 ${mark}`);
    }
  });

  test('認不得的狀態不猜：沒有 class、沒有符號，說明原樣顯示', () => {
    // 畫成某一種正常狀態最糟 —— 資料壞了要看得出來
    assert.equal(statusClass('亂寫的'), '');
    assert.equal(markFor('亂寫的'), '');
    assert.equal(describeStatus('亂寫的'), '亂寫的');
    assert.equal(describeStatus(null), '（沒有狀態）');
  });

  test('圖例的順序是流程的順序，不是字母序', () => {
    assert.deepEqual(STATUS_VIEW_ORDER,
      ['pending_confirm', 'confirmed', 'done', 'no_show']);
  });
});

describe('狀態的 class 在 CSS 裡真的存在', () => {
  // JS 說 status-confirmed、CSS 只寫了 status-confirm，畫面上就是「沒有顏色」——
  // 那不會讓任何測試變紅，但她會看到一片灰。這一條就是那個守門員。
  const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../public/css/tokens.css', import.meta.url), 'utf8');

  test('每一個狀態的 class 都有對應的 CSS 規則', () => {
    for (const status of VISIT_STATUSES) {
      const cls = statusClass(status);
      assert.ok(css.includes(`.${cls} {`), `app.css 少了 .${cls}`);
    }
  });

  test('每一個 class 都設了 --kind-fg 與 --kind-bg', () => {
    for (const status of VISIT_STATUSES) {
      const block = css.split(`.${statusClass(status)} {`)[1]?.split('}')[0] ?? '';
      assert.match(block, /--kind-fg:/, `${statusClass(status)} 沒設 --kind-fg`);
      assert.match(block, /--kind-bg:/, `${statusClass(status)} 沒設 --kind-bg`);
    }
  });

  test('用到的 --visit-* 色票都在 tokens.css 定義過', () => {
    const used = [...css.matchAll(/var\((--visit-[a-z-]+)\)/g)].map((m) => m[1]);
    assert.ok(used.length >= 8, `應該有四種狀態各兩個色票，實際找到 ${used.length}`);
    for (const name of new Set(used)) {
      assert.ok(tokens.includes(`${name}:`), `tokens.css 少了 ${name}`);
    }
  });
});

describe('收尾：客人來了嗎', () => {
  const TODAY = '2026-08-20';
  const visit = (over = {}) => ({
    id: 'v1', customerName: '客戶A', date: '2026-08-19', status: 'confirmed',
    slots: [
      { entitlementId: 'e1', courseName: '復能' },
      { entitlementId: 'e2', courseName: '靜脈' },
    ],
    ...over,
  });

  describe('哪幾筆要收尾', () => {
    test('日子過了、還沒結案的才列，未來的不列', () => {
      const rows = visitsToClose([
        visit({ id: 'past', date: '2026-08-18' }),
        visit({ id: 'today', date: TODAY }),
        visit({ id: 'future', date: '2026-08-25' }),
      ], TODAY);
      assert.deepEqual(rows.map((v) => v.id), ['past', 'today']);
    });

    test('還沒問過客人的也要列 —— 那天過了更需要收尾', () => {
      const rows = visitsToClose([visit({ status: 'pending_confirm' })], TODAY);
      assert.equal(rows.length, 1);
    });

    test('已完成、未到、取消、已刪除的都不列', () => {
      const rows = visitsToClose([
        visit({ id: 'a', status: 'done' }),
        visit({ id: 'b', status: 'no_show' }),
        visit({ id: 'c', status: 'cancelled' }),
        visit({ id: 'd', deletedAt: 'x' }),
      ], TODAY);
      assert.deepEqual(rows, []);
    });

    test('拖最久的排最上面', () => {
      const rows = visitsToClose([
        visit({ id: 'b', date: '2026-08-19' }),
        visit({ id: 'a', date: '2026-08-10' }),
      ], TODAY);
      assert.deepEqual(rows.map((v) => v.id), ['a', 'b']);
    });

    test('日期壞掉的不列，也不會爆', () => {
      assert.deepEqual(visitsToClose([visit({ date: '亂寫的' })], TODAY), []);
      assert.deepEqual(visitsToClose(undefined, TODAY), []);
    });
  });

  describe('結案', () => {
    test('全部做了 → 已完成，每一段都標成有做', () => {
      const next = closeVisit(visit(), [true, true], 'T');
      assert.equal(next.status, 'done');
      assert.deepEqual(next.slots.map((s) => s.attended), [true, true]);
      assert.equal(next.statusAt, 'T');
    });

    test('做了一半 → 還是已完成，沒做的那一段標成 false', () => {
      // 次數只扣做了的那一段，見 domain/entitlements.js 的 slotOutcome()
      const next = closeVisit(visit(), [true, false], 'T');
      assert.equal(next.status, 'done');
      assert.deepEqual(next.slots.map((s) => s.attended), [true, false]);
    });

    test('一段都沒做 → 整筆未到', () => {
      // 「來了但什麼都沒做」不存在，那就是沒來
      const next = closeVisit(visit(), [false, false], 'T');
      assert.equal(next.status, 'no_show');
    });

    test('少傳的那幾段當成有做，不要無聲扣掉她的次數', () => {
      const next = closeVisit(visit(), [], 'T');
      assert.equal(next.status, 'done');
      assert.deepEqual(next.slots.map((s) => s.attended), [true, true]);
    });

    test('其餘欄位原封不動，時段的內容也不動', () => {
      const before = visit({ note: '她說下午比較好' });
      const next = closeVisit(before, [true, false], 'T');
      assert.equal(next.note, '她說下午比較好');
      assert.equal(next.customerName, '客戶A');
      assert.equal(next.slots[0].courseName, '復能');
      assert.equal(next.slots[1].entitlementId, 'e2');
      assert.notEqual(next, before, '要回傳新的，不要就地改');
      assert.equal(before.slots[0].attended, undefined, '原本那筆不可以被動到');
    });
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


describe('匯入的舊來訪（ADR-0011）', () => {
  const IMPORTED = { source: 'legacy-sheet', sheetName: '客戶甲', importedAt: '2026-08-18' };
  const noTime = (over = {}) => visit({
    status: 'done',
    importedFrom: IMPORTED,
    slots: [{
      entitlementId: 'e-pool', courseId: 'c-recovery', courseName: '復能',
      equipmentId: null, ivProductId: null,
      startsAt: null, endsAt: null, roomId: null, bed: null, therapistId: null, attended: true,
    }],
    ...over,
  });

  test('認得出哪一筆是匯進來的', () => {
    assert.equal(isImported(noTime()), true);
    assert.equal(isImported(visit()), false);
  });

  test('時間、器材、診間、治療師都不詳也存得起來 —— 舊表就是沒有那些', () => {
    assert.deepEqual(validateVisit(noTime(), ctx()).errors, []);
  });

  test('營養點滴的品項不詳也放行', () => {
    const v = noTime({
      slots: [{
        entitlementId: 'e-pool', courseId: 'c-iv', courseName: '營養點滴',
        ivProductId: null, startsAt: null, endsAt: null, attended: true,
      }],
    });
    assert.deepEqual(validateVisit(v, ctx()).errors, []);
  });

  test('時間只填一半仍然是錯的 —— 那是打到一半，不是舊表沒有', () => {
    const v = noTime();
    v.slots[0].startsAt = '09:00';
    assert.ok(validateVisit(v, ctx()).errors.some((e) => e.includes('時間格式不對')));
  });

  test('放寬的只有那幾個欄位，客戶、日期、額度、課程照樣要有', () => {
    const v = noTime({ date: '不是日期' });
    v.slots[0].entitlementId = '';
    const { errors } = validateVisit(v, ctx());
    assert.ok(errors.some((e) => e.includes('日期不合法')));
    assert.ok(errors.some((e) => e.includes('要選一個額度')));
  });

  test('醫療禁忌照樣硬性阻擋，匯入不是例外', () => {
    const v = noTime();
    v.slots[0].equipmentId = 'eq-sis';
    const { errors } = validateVisit(v, ctx({ customer: { ...CUSTOMER, flags: ['體內金屬'] } }));
    assert.ok(errors.some((e) => e.includes('體內金屬')));
  });

  test('匯入的來訪是已完成，所以落在唯讀鎖定區', () => {
    assert.equal(isLocked(noTime().status), true);
  });
});
