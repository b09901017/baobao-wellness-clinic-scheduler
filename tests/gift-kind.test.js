// 一段可以是「體驗」或「送的」（2026-10-14，gift-and-trial 01）。
//
// 她的原話：
//
// > 那能不能把HRV和心臟門診都和EECP 體驗都變成不算次數，畢竟這個都是送，或是體驗的的不會需要買，
// > 就是如果有標註體驗的就直接送不算次數，就不會被沒有額度檔，畢竟是送的，但是來訪以及試算表還是要標註(送的)、(體驗)
//
// 第一段她選的：任何課都能標（健檢、二返除外）、就算身上有買那門課也不扣；四門不算次數的課預設都寫體驗。
//
// 判準（ADR-0121 那一句的延伸）：**這一行會不會讓一段送的／體驗被算進某一筆額度，或反過來？**

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  giftKindOf, canBeGift, GIFT_KINDS, GIFT_LABELS,
} from '../public/js/domain/masterData.js';
import {
  validateVisit, withGiftKinds, minuteChoicesFor, equipmentChoicesFor, slotMinutes, slotMinutesField,
  INITIAL_STATUS,
} from '../public/js/domain/visits.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import { giftPick, giftCourseIdOf, NTH_PICK } from '../public/js/domain/slotOptions.js';
import { counts } from '../public/js/domain/entitlements.js';
import { slotName } from '../public/js/domain/naming.js';
import { bookingConsequences } from '../public/js/domain/consequences.js';
import { SEED } from '../public/js/domain/seed.js';

const DAY = '2026-10-20';
const TODAY = '2026-10-14';

const COURSES = SEED.courses.map((c) => ({ ...c, active: true }));
const EQUIPMENT = SEED.equipment.map((e) => ({ ...e, active: true }));
const BY_ID = Object.fromEntries(COURSES.map((c) => [c.id, c]));
const MASTER = { courses: COURSES, equipment: EQUIPMENT, ivProducts: [] };

// 復能-三選一(30)：剩 5
const POOL30 = {
  id: 'e-pool30', customerId: 'c1', type: 'pool', label: '復能-三選一(30)', courseId: null,
  optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 5, doneCount: 0, bookedCount: 0, durationMin: 30,
};

const ctxOf = (entitlements = [POOL30], visits = []) => ({
  courses: COURSES, equipment: EQUIPMENT, ivProducts: [], entitlements, visits,
});

const visit = (slots, over = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '客戶A', date: DAY, status: 'pending_confirm', slots, ...over,
});

const check = (slots, { entitlements = [POOL30], courses = COURSES } = {}) => validateVisit(visit(slots), {
  customer: { flags: [] }, entitlements, courses, equipment: EQUIPMENT, rooms: [], staff: [],
  ivProducts: [], customerVisits: [], sameDayVisits: [],
}).errors;

describe('那一格與它的讀法', () => {
  test('三個值：體驗、送的、沒有', () => {
    assert.deepEqual([...GIFT_KINDS], ['trial', 'gift']);
    assert.equal(GIFT_LABELS.trial, '體驗');
    assert.equal(GIFT_LABELS.gift, '送的');
  });

  test('有值照值', () => {
    assert.equal(giftKindOf({ courseId: 'course-cardio', giftKind: 'gift' }, BY_ID), 'gift');
    assert.equal(giftKindOf({ courseId: 'course-recovery', giftKind: 'trial' }, BY_ID), 'trial');
    assert.equal(giftKindOf({ courseId: 'course-fm', entitlementId: null, giftKind: null }, BY_ID), null,
      '寫實成 null 的就是 null —— 不再退回去猜');
  });

  test('舊資料（沒有那一格）：沒有額度、不是 n返、課程勾了不算次數 → 體驗', () => {
    assert.equal(giftKindOf({ courseId: 'course-fm', entitlementId: null }, BY_ID), 'trial');
    assert.equal(giftKindOf({ courseId: 'course-fm', entitlementId: 'e1' }, BY_ID), null, '扣著額度的照舊扣');
    assert.equal(giftKindOf({ courseId: 'course-followup', entitlementId: null, followupNth: 3 }, BY_ID), null, 'n返 不是');
    assert.equal(giftKindOf({ courseId: 'course-recovery', entitlementId: null }, BY_ID), null, '要算次數的課不猜');
    assert.equal(giftKindOf(null, BY_ID), null);
  });

  test('兩種身分都有的壞資料照額度／n返 讀：名字、試算表、編輯器講同一件事（審查；驗證另外看那一格擋）', () => {
    assert.equal(giftKindOf({ courseId: 'course-cardio', entitlementId: 'e1', giftKind: 'trial' }, BY_ID), null);
    assert.equal(giftKindOf({ courseId: 'course-followup', followupNth: 3, giftKind: 'gift' }, BY_ID), null);
    assert.equal(slotName({ courseId: 'course-cardio', courseName: '心臟科評估', entitlementId: 'e1', giftKind: 'trial' }, MASTER, 'short'),
      '心臟科評估');
  });

  test('看不懂的值不算（驗證另外擋）', () => {
    assert.equal(giftKindOf({ courseId: 'course-fm', giftKind: 'free' }, BY_ID), null);
  });

  test('健檢與二返不可以；其餘任何課都可以', () => {
    assert.equal(canBeGift(BY_ID['course-checkup'], COURSES), false, '健檢牽著二返那條線');
    assert.equal(canBeGift(BY_ID['course-followup'], COURSES), false, '二返是某一門課的 followupCourseId');
    for (const id of ['course-recovery', 'course-cardio', 'course-fm', 'course-iv-laser', 'course-rehab', 'course-eecp-trial']) {
      assert.equal(canBeGift(BY_ID[id], COURSES), true, id);
    }
    assert.equal(canBeGift(null, COURSES), false);
  });
});

describe('組時段（slotFromPicks 的 giftCourseId ＋ giftKind）', () => {
  const pick = (over = {}, ctx = ctxOf()) => slotFromPicks({
    giftCourseId: 'course-recovery', giftKind: 'trial', equipmentId: 'eq-indiba', minutes: 30,
    startsAt: '10:00', therapistId: 't1', ...over,
  }, ctx);

  test('復能 INDIBA 30 分體驗：不扣額度、課程復能、器材 INDIBA、30 分後結束；那一筆額度還是剩 5', () => {
    const { slot, errors } = pick();
    assert.deepEqual(errors, []);
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.courseId, 'course-recovery');
    assert.equal(slot.equipmentId, 'eq-indiba');
    assert.equal(slot.endsAt, '10:30');
    assert.equal(slot.minutes, 30, '選的時長跟著那一段走（改期、只改治療師都不掉）');
    assert.equal(slot.giftKind, 'trial');
    assert.equal(slot.followupNth ?? null, null);
    assert.equal(slot.therapistId, 't1');
    assert.equal(slot.status, INITIAL_STATUS);
    assert.equal(counts(POOL30, [visit([slot])], POOL30.id).remaining, 5);
    assert.deepEqual(check([slot]), []);
  });

  test('60 分也選得到（買的時候分的那兩種，體驗的段約的時候選）', () => {
    const { slot } = pick({ minutes: 60 });
    assert.equal(slot.endsAt, '11:00');
    assert.equal(slot.minutes, 60);
  });

  test('送的就是送的；沒說就是體驗', () => {
    assert.equal(pick({ giftKind: 'gift' }).slot.giftKind, 'gift');
    assert.equal(pick({ giftKind: undefined }).slot.giftKind, 'trial');
    assert.equal(pick({ giftKind: 'nonsense' }).slot.giftKind, 'trial');
  });

  test('復能體驗配上 ILIB：課程照器材推成 ILIB、指派診間 —— 不可以存成「復能＋ILIB＋治療師」', () => {
    const { slot, assigns } = pick({ equipmentId: 'eq-ilib', minutes: null, roomId: 'r1' });
    assert.notEqual(slot?.courseId, 'course-recovery');
    assert.equal(slot.courseId, 'course-iv-laser');
    assert.equal(assigns, 'room');
    assert.equal(slot.therapistId, null);
    assert.equal(slot.roomId, 'r1');
  });

  test('復能體驗還沒選器材：要做什麼答得出來，指派還答不出來（同擇一池）', () => {
    const { slot, assigns } = pick({ equipmentId: null });
    assert.equal(assigns, null);
    assert.ok(check([slot]).some((e) => e.includes('器材')), '存之前要她選一台');
  });

  test('心臟科評估體驗：不要額度、課程照她按的那一顆；別的課身上殘留的器材不會把它換成復能', () => {
    const { slot } = pick({ giftCourseId: 'course-cardio', equipmentId: 'eq-indiba', minutes: null });
    assert.equal(slot.courseId, 'course-cardio');
    assert.equal(slot.equipmentId, null);
    assert.equal(slot.giftKind, 'trial');
    assert.deepEqual(check([slot]), []);
  });

  test('健檢、二返：組不出來', () => {
    assert.equal(pick({ giftCourseId: 'course-checkup' }).slot, null);
    assert.equal(pick({ giftCourseId: 'course-followup' }).slot, null);
  });

  test('同時給了額度：額度贏，giftKind 是 null（兩種身分只挑一種）', () => {
    const { slot } = slotFromPicks({
      entitlementId: POOL30.id, giftCourseId: 'course-cardio', giftKind: 'gift',
      equipmentId: 'eq-sis', startsAt: '10:00', therapistId: 't1',
    }, ctxOf());
    assert.equal(slot.entitlementId, POOL30.id);
    assert.equal(slot.giftKind, null);
  });

  test('扣額度的段：giftKind 寫 null，不寫 undefined（Firestore 不收）', () => {
    const { slot } = slotFromPicks({
      entitlementId: POOL30.id, equipmentId: 'eq-sis', startsAt: '10:00', therapistId: 't1',
    }, ctxOf());
    assert.ok('giftKind' in slot);
    assert.equal(slot.giftKind, null);
  });

  test('那一排上的值：giftPick() 撞不到額度的 id，也不是 n返', () => {
    assert.equal(giftCourseIdOf(giftPick('course-fm')), 'course-fm');
    assert.notEqual(giftPick('course-fm'), NTH_PICK);
    assert.equal(giftCourseIdOf('e-pool30'), null);
    assert.equal(giftCourseIdOf(NTH_PICK), null);
  });
});

describe('扣與不扣：換來換去，次數跟著走', () => {
  const sis = {
    entitlementId: POOL30.id, courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis',
    startsAt: '10:00', endsAt: '10:30', therapistId: 't1', status: 'confirmed', giftKind: null,
  };

  test('一段扣著額度的復能改成體驗：那一筆多剩一次；反過來也對', () => {
    const before = counts(POOL30, [visit([sis])], POOL30.id).remaining;
    const asTrial = { ...sis, entitlementId: null, giftKind: 'trial' };
    const after = counts(POOL30, [visit([asTrial])], POOL30.id).remaining;
    assert.equal(after, before + 1);
    assert.deepEqual(check([asTrial]), []);
    assert.equal(counts(POOL30, [visit([{ ...asTrial, entitlementId: POOL30.id, giftKind: null }])], POOL30.id).remaining, before);
  });
});

describe('驗證', () => {
  const cardio = (over = {}) => ({
    entitlementId: null, courseId: 'course-cardio', courseName: '心臟科評估',
    startsAt: '10:00', endsAt: '10:30', status: 'pending_confirm', giftKind: 'trial', ...over,
  });

  test('送的／體驗：不要額度', () => {
    assert.deepEqual(check([cardio()]), []);
    assert.deepEqual(check([cardio({ giftKind: 'gift' })]), []);
  });

  test('沒有額度、也不是送的／體驗：照舊「要選一個額度」', () => {
    const errors = check([cardio({ giftKind: null })]);
    assert.ok(errors.some((e) => e.includes('要選一個額度')), errors.join());
  });

  test('帶著 giftKind 又帶著額度：擋（兩種身分只能挑一種）', () => {
    const errors = check([cardio({ entitlementId: POOL30.id })]);
    assert.ok(errors.some((e) => e.includes('不可以同時指定額度')), errors.join());
  });

  test('帶著 giftKind 又是 n返：擋', () => {
    const errors = check([cardio({ courseId: 'course-followup', courseName: '三返', followupNth: 3, followupForVisitId: 'vx' })]);
    assert.ok(errors.some((e) => e.includes('n返')), errors.join());
  });

  test('健檢、二返帶 giftKind：擋，句子講得出為什麼', () => {
    for (const courseId of ['course-checkup', 'course-followup']) {
      const errors = check([cardio({ courseId, courseName: BY_ID[courseId].name })]);
      assert.ok(errors.some((e) => e.includes('健檢與二返沒有體驗或送的') && e.includes('n返')), errors.join());
    }
  });

  test('giftKind 不是那三個值：擋', () => {
    const errors = check([cardio({ giftKind: 'free' })]);
    assert.ok(errors.some((e) => e.includes('體驗')), errors.join());
  });
});

describe('舊資料：讀的時候退回體驗、存一次就寫實', () => {
  const old = {
    entitlementId: null, courseId: 'course-fm', courseName: '功醫門診',
    startsAt: '10:00', endsAt: '10:30', status: 'confirmed',
  };

  test('沒有那一格的功醫門診：讀成體驗、名字帶 (體驗)', () => {
    assert.equal(giftKindOf(old, BY_ID), 'trial');
    assert.equal(slotName(old, MASTER, 'short'), '功醫門診(體驗)');
  });

  test('存檔那個路口寫實：每一段都有那一格，扣額度的寫 null；再跑一次一模一樣', () => {
    const sis = { entitlementId: POOL30.id, courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '09:00', endsAt: '09:30' };
    const once = withGiftKinds(visit([old, sis]), BY_ID);
    assert.equal(once.slots[0].giftKind, 'trial');
    assert.ok('giftKind' in once.slots[1]);
    assert.equal(once.slots[1].giftKind, null);
    assert.deepEqual(withGiftKinds(once, BY_ID), once);
  });

  test('她已經寫好的那一格不動（送的不會被猜成體驗）', () => {
    const gift = { ...old, giftKind: 'gift' };
    assert.equal(withGiftKinds(visit([gift]), BY_ID).slots[0].giftKind, 'gift');
  });

  test('寫實之後把功醫門診的「不算次數」拿掉：那一段照樣存得下去', () => {
    const written = withGiftKinds(visit([old]), BY_ID).slots[0];
    const courses = COURSES.map((c) => (c.id === 'course-fm' ? { ...c, uncounted: false } : c));
    assert.deepEqual(check([written], { courses }), []);
    assert.equal(slotName(written, { ...MASTER, courses }, 'short'), '功醫門診(體驗)');
  });
});

describe('名字（slotName）', () => {
  const slot = (over) => ({
    entitlementId: null, courseId: 'course-cardio', courseName: '心臟科評估',
    startsAt: '10:00', endsAt: '10:30', giftKind: 'trial', ...over,
  });

  test('她自己看的那一種後面接 (體驗)／(送的)', () => {
    assert.equal(slotName(slot(), MASTER, 'short'), '心臟科評估(體驗)');
    assert.equal(slotName(slot({ giftKind: 'gift' }), MASTER, 'short'), '心臟科評估(送的)');
  });

  test('器材與分鐘照舊，標記接在最後', () => {
    assert.equal(slotName(slot({ courseId: 'course-recovery', equipmentId: 'eq-indiba' }), MASTER, 'short'), 'IN(30)(體驗)');
  });

  test('貼給客人的那一句不加', () => {
    assert.equal(slotName(slot(), MASTER, 'line'), '心臟科評估');
    assert.equal(slotName(slot({ courseId: 'course-recovery', equipmentId: 'eq-indiba' }), MASTER, 'line'), '復能');
  });

  test('扣額度的段一個字都沒變', () => {
    assert.equal(slotName(slot({ giftKind: null, entitlementId: 'e1' }), MASTER, 'short'), '心臟科評估');
  });
});

describe('選得到哪幾台、哪幾個分鐘', () => {
  test('體驗的復能 → 30、60；扣額度的復能 → 沒得選；二返照舊 30、60', () => {
    assert.deepEqual(minuteChoicesFor({ course: BY_ID['course-recovery'], giftKind: 'trial' }), [30, 60]);
    assert.deepEqual(minuteChoicesFor({ entitlement: POOL30, course: BY_ID['course-recovery'] }), []);
    assert.deepEqual(minuteChoicesFor({ course: BY_ID['course-followup'] }), [30, 60]);
    assert.deepEqual(minuteChoicesFor({ course: BY_ID['course-cardio'], giftKind: 'trial' }), [], '只有一種就不給選');
  });

  test('排多久：體驗的段吃她選的那個數字；扣額度的段照舊不理它', () => {
    const course = BY_ID['course-recovery'];
    assert.equal(slotMinutes({ course, giftKind: 'trial', minutes: 30 }), 30);
    assert.equal(slotMinutesField({ course, giftKind: 'trial', minutes: 30 }), 30);
    assert.equal(slotMinutes({ entitlement: POOL30, course, minutes: 60 }), 30, '復能(30) 身上帶著 60 也不可以蓋過額度');
    assert.equal(slotMinutesField({ entitlement: POOL30, course, minutes: 60 }), null);
  });

  test('器材：體驗的復能只有復能那三台（沒有 ILIB）；擇一池照池', () => {
    const names = (rows) => rows.map((e) => e.id).sort();
    assert.deepEqual(names(equipmentChoicesFor(null, BY_ID['course-recovery'], EQUIPMENT)), ['eq-indiba', 'eq-laser', 'eq-sis']);
    assert.deepEqual(names(equipmentChoicesFor(POOL30, BY_ID['course-recovery'], EQUIPMENT)), ['eq-indiba', 'eq-laser', 'eq-sis']);
    const four = { ...POOL30, optionEquipmentIds: ['eq-indiba', 'eq-ilib'] };
    assert.deepEqual(names(equipmentChoicesFor(four, BY_ID['course-recovery'], EQUIPMENT)), ['eq-ilib', 'eq-indiba']);
  });

  test('器材：這一段現在指著的那一台停用了，照樣列出來（不然一存就被清掉）', () => {
    const off = EQUIPMENT.map((e) => (e.id === 'eq-laser' ? { ...e, active: false } : e));
    assert.ok(!equipmentChoicesFor(null, BY_ID['course-recovery'], off).some((e) => e.id === 'eq-laser'));
    assert.ok(equipmentChoicesFor(null, BY_ID['course-recovery'], off, { keep: 'eq-laser' }).some((e) => e.id === 'eq-laser'));
  });
});

describe('確認框只講真的會發生的事', () => {
  test('新增一段體驗：講它是體驗、數字一個都不會變', () => {
    const v = visit([{
      entitlementId: null, courseId: 'course-cardio', courseName: '心臟科評估',
      startsAt: '10:00', endsAt: '10:30', status: 'pending_confirm', giftKind: 'trial',
    }]);
    const { lines } = bookingConsequences({ visit: v, coursesById: BY_ID, today: TODAY });
    assert.ok(lines.includes('心臟科評估(體驗) —— 客戶身上的數字一個都不會變'), lines.join('／'));
  });

  test('送的也講；扣著額度的那一段不講', () => {
    const v = visit([
      { entitlementId: null, courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '10:30', status: 'pending_confirm', giftKind: 'gift' },
      { entitlementId: POOL30.id, courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', startsAt: '11:00', endsAt: '11:30', status: 'pending_confirm', giftKind: null },
    ]);
    const { lines } = bookingConsequences({ visit: v, coursesById: BY_ID, today: TODAY });
    const said = lines.filter((l) => l.includes('一個都不會變'));
    assert.deepEqual(said, ['復能(送的) —— 客戶身上的數字一個都不會變']);
  });
});
