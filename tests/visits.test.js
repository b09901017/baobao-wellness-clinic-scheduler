// 來訪的狀態機與檢查。
//
// 這裡的分界線很重要：errors 會擋下儲存，warnings 不會。
// **只有「欄位根本沒填」與「指到一筆不存在的東西」是 errors**（ADR-0002、0074）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import {
  VISIT_STATUSES, INITIAL_STATUS, describeStatus, nextStatuses, canTransition,
  isLocked, isActive, isImported, coursesForEntitlement, validateVisit,
  touchedEntitlementIds, recount,
  statusClass, shortStatus, markFor, MARK_ORDER, MARK_LEGEND, STATUS_VIEW_ORDER,
  visitsToClose, visitsToConfirm, closeVisit, slotStatus, needsForm, formSlotIndexes,
  visitCourseLabel, describeConfirmed, applyStatus, visitActions,
  courseForEquipment, picksEquipment, slotsToShow,
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
  // 二返：同時要診間和醫師，所以 assigns 是 room 而醫師走 requiresDoctor（ADR-0026）
  { id: 'c-followup', name: '二返', durationMin: 30, assigns: 'room',
    allowedRoomTypes: ['治療室'], allowedRoomIds: [], requiresDoctor: true, category: 'A' },
];

const EQUIPMENT = [
  { id: 'eq-indiba', name: 'INDIBA', contraindications: [] },
  { id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] },
];

const ROOMS = [
  { id: 'r-t3', name: '治3', type: '治療室', beds: [] },
  { id: 'r-iv8', name: '點滴8', type: '點滴室', beds: ['A', 'B'] },
];

const STAFF = [
  { id: 'st-tw', name: '騰崴', role: '物理治療師' },
  { id: 'st-dr-xia', name: '夏', role: '醫師' },
];
const IV = [
  { id: 'iv-liver', name: '護肝排毒' },
  { id: 'iv-bright', name: '美白' },
];

const ENTS = [
  { id: 'e-rehab', type: 'single', label: '復健科醫師門診', courseId: 'c-rehab',
    totalQty: 6, durationMin: 30, doneCount: 0, bookedCount: 0 },
  { id: 'e-pool', type: 'pool', label: '復能', optionEquipmentIds: ['eq-indiba', 'eq-sis'],
    totalQty: 2, durationMin: 60, doneCount: 0, bookedCount: 0 },
  { id: 'e-inbody', type: 'single', label: '身體組成分析', courseId: 'c-inbody',
    totalQty: 4, durationMin: 20, frequencyRule: '每季一次', doneCount: 0, bookedCount: 0 },
  { id: 'e-followup', type: 'single', label: '二返', courseId: 'c-followup',
    totalQty: 1, durationMin: 30, doneCount: 0, bookedCount: 0 },
  // 買的時候就把品項定下來了（`ui/components/buy.js` 的 ivRow()）
  { id: 'e-iv', type: 'single', label: '營養點滴・護肝排毒', courseId: 'c-iv',
    totalQty: 3, durationMin: 60, ivProductId: 'iv-liver', doneCount: 0, bookedCount: 0 },
  // 舊資料：買的時候還沒有這個欄位
  { id: 'e-iv-old', type: 'single', label: '營養點滴', courseId: 'c-iv',
    totalQty: 3, durationMin: 60, doneCount: 0, bookedCount: 0 },
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

describe('一段在畫面上顯示成哪一個狀態', () => {
  // 和 slotOutcome() 差在：那一支是計數用的，待確認與已確認都收斂成 booked；
  // 這一支是顯示用的，那兩種必須分得出來 —— 她要看的正是「哪幾段還沒問客人」。
  const on = { entitlementId: 'e1' };

  test('待確認與已確認分得出來（slotOutcome 分不出來）', () => {
    assert.equal(slotStatus({ status: 'pending_confirm' }, on), 'pending_confirm');
    assert.equal(slotStatus({ status: 'confirmed' }, on), 'confirmed');
  });

  test('已完成的來訪逐段看結果', () => {
    assert.equal(slotStatus({ status: 'done' }, on), 'done');
    assert.equal(slotStatus({ status: 'done' }, { ...on, attended: false }), 'no_show');
  });

  test('整筆未到時每一段都是未到', () => {
    assert.equal(slotStatus({ status: 'no_show' }, { ...on, attended: true }), 'no_show');
  });

  test('還沒發生的來訪不看 attended', () => {
    // 匯入器會在 confirmed 上寫 attended: false，那是「還沒發生」不是「沒做」
    assert.equal(slotStatus({ status: 'confirmed' }, { ...on, attended: false }), 'confirmed');
  });

  test('取消的照樣答得出來 —— 要不要畫是呼叫端決定的', () => {
    assert.equal(slotStatus({ status: 'cancelled' }, on), 'cancelled');
  });

  test('已刪除的沒有狀態', () => {
    assert.equal(slotStatus({ status: 'done', deletedAt: 'x' }, on), null);
    assert.equal(slotStatus(null, on), null);
  });

  test('回傳的一定是合法狀態或 null，不會冒出第三種東西', () => {
    for (const status of VISIT_STATUSES) {
      const got = slotStatus({ status }, on);
      assert.ok(VISIT_STATUSES.includes(got), `${status} → ${got}`);
    }
  });
});

describe('收尾：簽療程單', () => {
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

  describe('要問客人的與要收尾的，一筆不會同時卡在兩邊', () => {
    test('日子過了就不再問客人 —— 那時只做得到收尾', () => {
      // 「8/3 那個時間可以嗎」在 8/20 問是沒有意義的
      const old = visit({ id: 'old', date: '2026-08-03', status: 'pending_confirm' });
      assert.deepEqual(visitsToConfirm([old], TODAY), []);
      assert.deepEqual(visitsToClose([old], TODAY).map((v) => v.id), ['old']);
    });

    test('未來的只在「問客人」那一邊', () => {
      const soon = visit({ id: 'soon', date: '2026-08-25', status: 'pending_confirm' });
      assert.deepEqual(visitsToConfirm([soon], TODAY).map((v) => v.id), ['soon']);
      assert.deepEqual(visitsToClose([soon], TODAY), []);
    });

    test('當天兩邊都列 —— 早上問得到、下午收得掉', () => {
      const now = visit({ id: 'now', date: TODAY, status: 'pending_confirm' });
      assert.equal(visitsToConfirm([now], TODAY).length, 1);
      assert.equal(visitsToClose([now], TODAY).length, 1);
    });

    test('已確認的不會跑到「問客人」那一列', () => {
      const ok = visit({ date: '2026-08-25', status: 'confirmed' });
      assert.deepEqual(visitsToConfirm([ok], TODAY), []);
    });

    test('日期壞掉的留在「問客人」，不要從兩邊一起消失', () => {
      const broken = visit({ id: 'broken', date: '亂寫的', status: 'pending_confirm' });
      assert.deepEqual(visitsToConfirm([broken], TODAY).map((v) => v.id), ['broken']);
      assert.deepEqual(visitsToClose([broken], TODAY), []);
    });

    test('已刪除的兩邊都不列', () => {
      const gone = visit({ deletedAt: 'x', status: 'pending_confirm' });
      assert.deepEqual(visitsToConfirm([gone], TODAY), []);
      assert.deepEqual(visitsToClose([gone], TODAY), []);
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

describe('哪幾段要簽療程單', () => {
  const COURSES = {
    'course-followup': { needsTreatmentForm: false },
    'course-recovery': { needsTreatmentForm: true },
    'course-rehab': {},          // 舊資料沒有這個欄位
  };

  test('沒有欄位就是要簽 —— 少簽一張是實際損失', () => {
    assert.equal(needsForm({}), true);
    assert.equal(needsForm(undefined), true, '認不得的課程也當成要簽');
    assert.equal(needsForm({ needsTreatmentForm: true }), true);
  });

  test('只有明確關掉的那一個不用簽', () => {
    assert.equal(needsForm({ needsTreatmentForm: false }), false);
  });

  test('回的是時段的索引，不是時段本身', () => {
    const visit = {
      slots: [
        { courseId: 'course-followup' },
        { courseId: 'course-recovery' },
        { courseId: 'ghost' },
      ],
    };
    assert.deepEqual(formSlotIndexes(visit, COURSES), [1, 2]);
  });

  test('整筆都是二返就是空的 —— 但那一筆照樣要結案', () => {
    const visit = { slots: [{ courseId: 'course-followup' }] };
    assert.deepEqual(formSlotIndexes(visit, COURSES), []);
    // 「不用簽單」跟「不用收尾」是兩件事：次數是在結案時扣的（SPEC 4.2）
    assert.equal(visitsToClose([{ ...visit, status: 'confirmed', date: '2026-08-19' }], '2026-08-20').length, 1);
  });

  test('沒有時段、沒有課程主檔都不會炸', () => {
    assert.deepEqual(formSlotIndexes({}, COURSES), []);
    assert.deepEqual(formSlotIndexes({ slots: [{ courseId: 'x' }] }), [0]);
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
  // ADR-0074：2026-09-06 之前這一條在 errors 裡，而且是全站唯一會擋下儲存的
  // 業務規則。她那天說「只要儀器不要在金屬的上方或附近」就做得了 ——
  // 而儀器擺在哪裡 app 看不到（ADR-0002 的主體）。
  test('選到要提醒的器材存得下去，只多一句提醒', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery',
                equipmentId: 'eq-sis', roomId: null, therapistId: 'st-tw', endsAt: '15:00' }],
    });
    const withMetal = ctx({ customer: { ...CUSTOMER, flags: ['體內金屬'] } });
    const { errors, warnings } = validateVisit(v, withMetal);
    assert.deepEqual(errors, [], '不可以再擋下儲存');
    assert.ok(warnings.some((w) => w.includes('超磁場') && w.includes('體內金屬')));
  });

  test('客戶身上沒有那個字就什麼都不講', () => {
    const v = visit({
      slots: [{ ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery',
                equipmentId: 'eq-sis', roomId: null, therapistId: 'st-tw', endsAt: '15:00' }],
    });
    assert.ok(!validateVisit(v, ctx()).warnings.some((w) => w.includes('超磁場')));
  });

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
    // 只問自撞那一條。這一筆是 A 類而且沒填醫師，所以另外還有一句「還沒選醫師」
    // （`picksDoctor()`，ADR-0058）—— 那跟這個測試要問的事無關。
    const { warnings } = validateVisit(visit(), ctx({ sameDayVisits: [other] }));
    assert.ok(!warnings.some((w) => w.includes('客戶乙')));
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

  // 2026-09-04 她問的：「我營養點滴如果一開始加購的是 A，但是我排來訪的時候，
  // 選營養點滴還能排到其他 BCD？」**只提醒不擋**（她選的）——「今天 A 剛好用完，
  // 先打了 B」是真的會發生的事。見 .scratch/asks-2026-09-04/issues/04。
  describe('營養點滴的品項跟買的不一樣', () => {
    const ivSlot = (over = {}) => visit({
      slots: [{
        ...visit().slots[0], entitlementId: 'e-iv', courseId: 'c-iv',
        courseName: '營養點滴', roomId: 'r-iv8', endsAt: '15:00',
        ivProductId: 'iv-liver', ...over,
      }],
    });

    test('換了一款 → 一句提醒，話裡有買的那一款的名字', () => {
      const { errors, warnings } = validateVisit(ivSlot({ ivProductId: 'iv-bright' }), ctx());
      assert.deepEqual(errors, [], '不可以擋下來 —— 那一筆就記不進系統了');
      assert.ok(warnings.some((w) => w.includes('跟買的不一樣') && w.includes('護肝排毒')));
    });

    test('排的就是買的那一款 → 什麼都不講', () => {
      const { warnings } = validateVisit(ivSlot(), ctx());
      assert.ok(!warnings.some((w) => w.includes('跟買的不一樣')));
    });

    test('額度上沒有品項（舊資料）→ 什麼都不講', () => {
      const v = ivSlot({ entitlementId: 'e-iv-old', ivProductId: 'iv-bright' });
      const { warnings } = validateVisit(v, ctx());
      assert.ok(!warnings.some((w) => w.includes('跟買的不一樣')));
    });

    test('n返 沒有額度可以比 → 什麼都不講', () => {
      const v = visit({
        slots: [{
          ...visit().slots[0], entitlementId: null, courseId: 'c-followup',
          followupNth: 3, followupForVisitId: 'v-exam',
          roomId: 'r-t3', doctorId: 'st-dr-xia', ivProductId: 'iv-bright',
        }],
      });
      const { warnings } = validateVisit(v, ctx());
      assert.ok(!warnings.some((w) => w.includes('跟買的不一樣')));
    });
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

describe('醫師（ADR-0026）', () => {
  const followup = (over = {}) => visit({
    slots: [{
      entitlementId: 'e-followup', courseId: 'c-followup', courseName: '二返',
      startsAt: '14:00', endsAt: '14:30', roomId: 'r-t3', bed: null,
      equipmentId: null, ivProductId: null, therapistId: null, doctorId: null,
      attended: null,
      ...(over.slot ?? {}),
    }],
  });

  test('沒選醫師只提醒，不擋 —— 她的舊表寫過「二返(8/5)」，日期定了醫師還沒定', () => {
    const { errors, warnings } = validateVisit(followup(), ctx());
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => /二返 還沒選醫師/.test(w)));
  });

  test('選了醫師就不再提醒', () => {
    const out = validateVisit(followup({ slot: { doctorId: 'st-dr-xia' } }), ctx());
    assert.deepEqual(out.errors, []);
    assert.ok(!out.warnings.some((w) => /還沒選醫師/.test(w)));
  });

  test('指到不存在的人要擋 —— 那是資料壞了，不是還沒決定', () => {
    const { errors } = validateVisit(followup({ slot: { doctorId: 'st-nobody' } }), ctx());
    assert.ok(errors.some((e) => /指定的醫師不存在或已刪除/.test(e)));
  });

  test('把物理治療師填進醫師欄要擋 —— 兩種人不可以混用', () => {
    const { errors } = validateVisit(followup({ slot: { doctorId: 'st-tw' } }), ctx());
    assert.ok(errors.some((e) => /騰崴 不是醫師/.test(e)));
  });

  test('不需要醫師的課程填了醫師只提醒，和「不需要診間」那條一樣', () => {
    // 復能是 C 類而且沒開旗標，所以它選不到醫師（`picksDoctor()`）。
    // 拿 A 類的來測是問錯問題 —— A 類現在一律選得到。
    const v = visit({
      slots: [{
        ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery', courseName: '復能',
        roomId: null, bed: null, therapistId: 'st-tw', equipmentId: 'eq-indiba',
        doctorId: 'st-dr-xia',
      }],
    });
    const { errors, warnings } = validateVisit(v, ctx());
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => /不需要指定醫師/.test(w)));
  });

  test('A 類一律選得到醫師，主檔上不用逐課程再勾一次', () => {
    // 她的原話：「A類的門診都要選醫生」。復健科醫師門診身上沒有 requiresDoctor，
    // 但它是門診 —— 要她回主檔補勾一次，是把一條已經知道的規則交給她記得。
    const { errors, warnings } = validateVisit(visit(), ctx());
    assert.deepEqual(errors, [], '不強制 —— 沒選也存得下去');
    assert.ok(warnings.some((w) => /復健科醫師門診 還沒選醫師/.test(w)));
  });

  test('非 A 類要選醫師的，主檔上的旗標照樣管用', () => {
    // 之後真的有一個 C 類要記醫師時，主檔勾一下就有，不用改程式。
    const courses = COURSES.map((c) => (
      c.id === 'c-recovery' ? { ...c, requiresDoctor: true } : c));
    const v = visit({
      slots: [{
        ...visit().slots[0], entitlementId: 'e-pool', courseId: 'c-recovery', courseName: '復能',
        roomId: null, bed: null, therapistId: 'st-tw', equipmentId: 'eq-indiba',
      }],
    });
    const { warnings } = validateVisit(v, ctx({ courses }));
    assert.ok(warnings.some((w) => /復能 還沒選醫師/.test(w)));
  });

  test('醫師不納入自撞提示 —— 她看不到醫師的班表（ADR-0002）', () => {
    const mine = followup({ slot: { doctorId: 'st-dr-xia' } });
    const hers = {
      id: 'v-other', customerId: 'cust-2', customerName: '客戶乙',
      date: '2026-09-03', status: 'confirmed',
      slots: [{
        entitlementId: 'e-x', courseId: 'c-followup', courseName: '二返',
        startsAt: '14:00', endsAt: '14:30', roomId: 'r-iv8', bed: null,
        doctorId: 'st-dr-xia', therapistId: null,
      }],
    };
    const { warnings } = validateVisit(mine, ctx({ sameDayVisits: [hers] }));
    assert.ok(!warnings.some((w) => /夏/.test(w)));
  });

  test('匯入的舊來訪沒有醫師是常態，不要當成漏填而擋下來', () => {
    const v = followup({ });
    v.importedFrom = { source: 'legacy-sheet' };
    const { errors } = validateVisit(v, ctx());
    assert.deepEqual(errors, []);
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

  test('器材上的提醒在匯入的來訪上也是提醒，不是阻擋', () => {
    const v = noTime();
    v.slots[0].equipmentId = 'eq-sis';
    const { errors, warnings } = validateVisit(v, ctx({ customer: { ...CUSTOMER, flags: ['體內金屬'] } }));
    assert.ok(!errors.some((e) => e.includes('體內金屬')));
    assert.ok(warnings.some((w) => w.includes('體內金屬')));
  });

  test('匯入的來訪是已完成，所以落在唯讀鎖定區', () => {
    assert.equal(isLocked(noTime().status), true);
  });
});

// 「跟客人確認時間」那一排丸子上要看得到課程，不只日期 ——
// 她的原話是「9/14(一)復能、營養針」。客戶詳情的來訪列共用同一支。
describe('那天做什麼', () => {
  test('同一個課程只印一次', () => {
    assert.equal(
      visitCourseLabel({ slots: [{ courseName: '復能' }, { courseName: '復能' }, { courseName: '營養點滴' }] }),
      '復能、營養點滴',
    );
  });

  test('認不出課程名時退回「N 段」，不要回空白', () => {
    assert.equal(visitCourseLabel({ slots: [{}, {}] }), '2 段');
    assert.equal(visitCourseLabel({}), '0 段');
    assert.equal(visitCourseLabel(null), '0 段');
  });
});

// 加進日曆之後那張置中的卡片要講出「最後成立的是哪幾段」——
// 那是這條動線唯一一次不可逆的寫入（`.scratch/asks-2026-08-25/issues/05`）。
describe('確認之後成立的是哪幾段', () => {
  const visits = [
    {
      id: 'v2', customerName: '王小明', date: '2026-09-23',
      slots: [{ startsAt: '14:00', endsAt: '15:00', courseName: '復能' }],
    },
    {
      id: 'v1', customerName: '王小明', date: '2026-09-14',
      slots: [
        { startsAt: '11:30', endsAt: '12:30', courseName: '營養點滴' },
        { startsAt: '10:30', endsAt: '11:30', courseName: '復能' },
      ],
    },
  ];

  test('照日期與時間排，不照來訪進來的順序', () => {
    const { rows, name, rejected } = describeConfirmed(visits, new Set());
    assert.equal(name, '王小明');
    assert.equal(rejected, 0);
    assert.deepEqual(rows.map((r) => `${r.date} ${r.slot.startsAt}`), [
      '2026-09-14 10:30', '2026-09-14 11:30', '2026-09-23 14:00',
    ]);
  });

  test('被退掉的那幾段不列，但要數出來', () => {
    const { rows, rejected } = describeConfirmed(visits, new Set(['v1:0', 'v2:0']));
    assert.deepEqual(rows.map((r) => r.slot.courseName), ['復能']);
    assert.equal(rejected, 2);
  });

  test('整批都退掉時 rows 是空的 —— 畫面靠它決定不畫那張卡片', () => {
    const { rows, rejected } = describeConfirmed(visits, new Set(['v1:0', 'v1:1', 'v2:0']));
    assert.deepEqual(rows, []);
    assert.equal(rejected, 3);
  });
});

// 長按一列的快捷選單（ADR-0060）。狀態轉換抽成 applyStatus() 之後，
// 來訪編輯器的狀態卡與日曆的快捷選單共用同一份 —— 兩邊各寫一次的話，
// 遲早有一邊忘了補 cancelledAt。
describe('換一個狀態（applyStatus）', () => {
  const v = () => ({
    id: 'v1', status: 'confirmed', date: '2026-09-01',
    slots: [{ startsAt: '10:30' }, { startsAt: '11:30' }],
  });

  test('不動到原本那一份', () => {
    const before = v();
    applyStatus(before, 'cancelled', { at: 'T', reason: '客人要改時間' });
    assert.equal(before.status, 'confirmed');
    assert.ok(!('cancelledAt' in before));
  });

  test('取消會補上時間、理由與「還沒釋出遞補」', () => {
    const next = applyStatus(v(), 'cancelled', { at: 'T', reason: '客人要改時間' });
    assert.equal(next.status, 'cancelled');
    assert.equal(next.cancelledAt, 'T');
    assert.equal(next.cancelReason, '客人要改時間');
    assert.equal(next.released, false);
  });

  test('確認會補上 confirmedAt', () => {
    const next = applyStatus(v(), 'confirmed', { at: 'T' });
    assert.equal(next.status, 'confirmed');
    assert.equal(next.confirmedAt, 'T');
  });

  test('收尾走 closeVisit() —— 跟整筆標成已完成一模一樣', () => {
    const mine = applyStatus(v(), 'done', { at: 'T' });
    const theirs = closeVisit(v(), [true, true], 'T');
    assert.deepEqual(mine, theirs);
  });

  test('整筆標成未到 = 每一段都沒做', () => {
    const next = applyStatus(v(), 'no_show', { at: 'T' });
    assert.equal(next.status, 'no_show');
    assert.ok(next.slots.every((sl) => sl.attended === false));
  });
});

describe('長按一筆來訪有哪幾顆（visitActions）', () => {
  const ids = (visit, today = '2026-09-05') =>
    visitActions(visit, { today }).map((a) => a.id);

  test('待確認、日子還沒到：確認、改、取消', () => {
    assert.deepEqual(
      ids({ status: 'pending_confirm', date: '2026-09-20' }),
      ['confirmed', 'edit', 'cancelled'],
    );
  });

  test('日子到了才有「去簽療程單」', () => {
    assert.ok(ids({ status: 'confirmed', date: '2026-09-05' }).includes('close'));
    assert.ok(!ids({ status: 'confirmed', date: '2026-09-06' }).includes('close'));
  });

  test('**沒有「已完成」與「未到」** —— 那兩個是逐段的結果（ADR-0025）', () => {
    const all = ids({ status: 'confirmed', date: '2026-09-01' });
    assert.ok(!all.includes('done'));
    assert.ok(!all.includes('no_show'));
  });

  test('終點沒有東西可做', () => {
    assert.deepEqual(ids({ status: 'done', date: '2026-09-01' }), []);
    assert.deepEqual(ids({ status: 'cancelled', date: '2026-09-01' }), []);
  });

  test('只給 TRANSITIONS 准的轉移 —— Rules 不擋狀態機（ADR-0006）', () => {
    for (const status of VISIT_STATUSES) {
      const allowed = new Set(nextStatuses(status));
      for (const a of visitActions({ status, date: '2026-09-01' }, { today: '2026-09-05' })) {
        if (VISIT_STATUSES.includes(a.id)) assert.ok(allowed.has(a.id), `${status} → ${a.id}`);
      }
    }
  });

  test('最多五顆 —— 加上選單自己的「先不要」剛好是六顆的上限', () => {
    for (const status of VISIT_STATUSES) {
      const n = visitActions({ status, date: '2026-09-01' }, { today: '2026-09-05' }).length;
      assert.ok(n <= 5, `${status} 有 ${n} 顆`);
    }
  });
});


// ADR-0075：擇一池的時段課程由選到的那台器材決定。四選一是一筆額度、四台器材，
// 而 ILIB 那一台要診間、其餘三台要治療師 —— 指派跟著課程走，所以課程要由器材推。
describe('器材決定那一段算哪一個課程', () => {
  const COURSES2 = [
    { id: 'c-recovery', name: '復能', assigns: 'therapist', requiresEquipment: true, durationMin: 60 },
    { id: 'c-ilib', name: 'ILIB', assigns: 'room', requiresEquipment: false, durationMin: 60 },
    { id: 'c-checkup', name: '健檢', assigns: 'room', durationMin: 120 },
  ];
  const EQ = [
    { id: 'eq-laser', name: '高能量雷射', courseId: 'c-recovery' },
    { id: 'eq-sis', name: '超磁場', courseId: 'c-recovery' },
    { id: 'eq-indiba', name: 'INDIBA', courseId: 'c-recovery' },
    { id: 'eq-ilib', name: 'ILIB', courseId: 'c-ilib' },
  ];
  const pool = (ids) => ({ type: 'pool', optionEquipmentIds: ids });

  describe('這一筆額度排得出哪幾個課程', () => {
    test('三選一只推得出復能', () => {
      const out = coursesForEntitlement(pool(['eq-laser', 'eq-sis', 'eq-indiba']), COURSES2, EQ);
      assert.deepEqual(out.map((c) => c.name), ['復能']);
    });

    test('四選一推得出兩個，順序照池上的順序', () => {
      const out = coursesForEntitlement(
        pool(['eq-laser', 'eq-sis', 'eq-indiba', 'eq-ilib']), COURSES2, EQ,
      );
      assert.deepEqual(out.map((c) => c.name), ['復能', 'ILIB']);
    });

    test('單買一台就是那一台的課程', () => {
      assert.deepEqual(
        coursesForEntitlement(pool(['eq-ilib']), COURSES2, EQ).map((c) => c.name), ['ILIB'],
      );
    });

    test('器材身上沒有 courseId 就退回舊行為（ADR-0005）', () => {
      const oldEq = EQ.map(({ courseId, ...rest }) => rest);
      assert.deepEqual(
        coursesForEntitlement(pool(['eq-sis']), COURSES2, oldEq).map((c) => c.name), ['復能'],
      );
    });

    test('single 一律照 courseId，不看器材', () => {
      assert.deepEqual(
        coursesForEntitlement({ type: 'single', courseId: 'c-checkup' }, COURSES2, EQ)
          .map((c) => c.name),
        ['健檢'],
      );
    });

    test('已刪除的課程不會被推出來', () => {
      const gone = COURSES2.map((c) => (c.id === 'c-ilib' ? { ...c, deletedAt: 'x' } : c));
      assert.deepEqual(
        coursesForEntitlement(pool(['eq-ilib', 'eq-sis']), gone, EQ).map((c) => c.name), ['復能'],
      );
    });
  });

  describe('選了這一台就算這個課程', () => {
    test('ILIB 那一台換成 ILIB 課程', () => {
      assert.equal(courseForEquipment('eq-ilib', EQ, 'c-recovery'), 'c-ilib');
    });

    test('三台之一維持復能', () => {
      assert.equal(courseForEquipment('eq-sis', EQ, 'c-recovery'), 'c-recovery');
    });

    test('還沒選器材就維持原來的 —— 清成 null 的話那一段存不下去', () => {
      assert.equal(courseForEquipment(null, EQ, 'c-recovery'), 'c-recovery');
      assert.equal(courseForEquipment('eq-gone', EQ, 'c-recovery'), 'c-recovery');
    });

    test('器材身上沒有 courseId 也維持原來的', () => {
      assert.equal(courseForEquipment('eq-sis', [{ id: 'eq-sis' }], 'c-recovery'), 'c-recovery');
    });
  });

  describe('這一段要不要記器材', () => {
    test('擇一池一定要 —— 四選一選到 ILIB 那一段也要記', () => {
      const ilib = COURSES2.find((c) => c.id === 'c-ilib');
      assert.equal(picksEquipment(pool(['eq-ilib']), ilib), true);
    });

    test('不是池的看課程', () => {
      assert.equal(picksEquipment({ type: 'single' }, COURSES2[0]), true);
      assert.equal(picksEquipment({ type: 'single' }, COURSES2[1]), false);
      assert.equal(picksEquipment(null, null), false);
    });
  });
});

// 她 2026-09-08：
//
// > 我在日曆點開詳情的時候，為甚麼我點的是復能(INDIBA)，
// > 但是卻會一次呈現三個復能(INDIBA)、復能(超磁場)、靜脈(IL)？
//
// 排班的原子單位是來訪（SPEC 第 4.4 節），所以同一位客戶同一天壓三次
// 是**一筆來訪三個時段**。日／週檢視那一份清單是一段一列的，
// 但點下去給的是整筆 —— 那一下把「我點的是哪一段」丟掉了。
describe('讀取卡片要畫哪幾段', () => {
  const v = {
    id: 'v1',
    slots: [
      { startsAt: '09:00', endsAt: '09:30', courseName: '復能' },
      { startsAt: '10:00', endsAt: '10:30', courseName: '復能' },
      { startsAt: '11:00', endsAt: '12:00', courseName: 'ILIB' },
    ],
  };

  test('沒指定就是全部 —— 另外三頁列的本來就是整筆來訪', () => {
    const out = slotsToShow(v);
    assert.deepEqual(out.slots.map((s) => s.index), [0, 1, 2]);
    assert.equal(out.hidden, 0);
    assert.equal(out.focused, false);
  });

  test('指定了就只有那一段，其餘算成「還有幾段」', () => {
    const out = slotsToShow(v, 1);
    assert.deepEqual(out.slots.map((s) => s.index), [1]);
    assert.equal(out.slots[0].slot.startsAt, '10:00');
    assert.equal(out.hidden, 2);
    assert.equal(out.focused, true);
  });

  test('第 0 段也算數 —— 0 是一個合法的 index，不是「沒指定」', () => {
    const out = slotsToShow(v, 0);
    assert.deepEqual(out.slots.map((s) => s.index), [0]);
    assert.equal(out.hidden, 2);
  });

  // 這一條是這一支存在的第二個理由：指到一個不存在的段落時**退回全部**。
  // 畫成空白的話她會以為那一筆壞了，而畫太多只是回到修好之前的樣子。
  test('指到一個不存在的段落就退回全部，不要畫成空的', () => {
    for (const bad of [9, -1, 1.5, '1', NaN, null, undefined]) {
      const out = slotsToShow(v, bad);
      assert.equal(out.slots.length, 3, `focusSlot=${String(bad)} 應該退回全部`);
      assert.equal(out.hidden, 0);
    }
  });

  test('只有一段的來訪指定第 0 段：畫得出來，而且沒有「還有幾段」', () => {
    const one = { id: 'v2', slots: [v.slots[0]] };
    const out = slotsToShow(one, 0);
    assert.equal(out.slots.length, 1);
    assert.equal(out.hidden, 0);
    assert.equal(out.focused, true);
  });

  test('一段都沒有的來訪不會炸', () => {
    assert.deepEqual(slotsToShow({ id: 'v3', slots: [] }, 0),
      { slots: [], hidden: 0, focused: false });
    assert.deepEqual(slotsToShow(null), { slots: [], hidden: 0, focused: false });
  });
});
