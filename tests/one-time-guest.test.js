// 一次性客人與一次性的段（2026-11-05，ADR-0172，`.scratch/one-time-guests/issues/01`）：形狀、組時段、存檔驗證。
//
// 不是她客人的人（例：公司發的一次性員工券）也記得進 app。客人是一份客戶文件多一格 `oneTime: true`，
// 他約的每一段標 `oneTime: true`：不扣任何一筆額度、不是送的／體驗。她：
//
// > 唯一的區別就是不會記錄到那頁中，也沒有額度限制甚麼的，也不用記到式算表中，但日曆和代辦我還是需要看到有他
//
// 所以這一支一半在釘新的那一條路，另一半在釘**沒有標記的客人與段一個字都沒放寬**（同 ADR-0169 那一支的寫法）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fromRoot } from './helpers/paths.js';

import {
  isOneTime, oneTimeCustomer, toMyCustomer, validate as validateCustomer,
} from '../public/js/domain/customers.js';
import { isOneTimeSlot, giftKindOf } from '../public/js/domain/masterData.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import {
  validateVisit, withSlotStatuses, withGiftKinds, withSlotNotes,
} from '../public/js/domain/visits.js';
import { counts } from '../public/js/domain/entitlements.js';
import { fieldLabel } from '../public/js/domain/audit.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));

const ctx = (over = {}) => ({
  courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  entitlements: [], visits: [], ...over,
});

const picks = (over = {}) => ({
  entitlementId: null, isNth: false, equipmentId: null, ivProductId: null, startsAt: '10:00',
  roomId: null, bed: null, therapistId: null, doctorId: null, nth: null, followupForVisitId: null, note: null,
  ...over,
});

/** 一段一次性的段（照 `slotFromPicks()` 會組出來的形狀）。 */
const oneTimeSlot = (over = {}) => ({
  entitlementId: null, courseId: 'course-checkup', courseName: '健檢', equipmentId: null, ivProductId: null,
  startsAt: '09:00', endsAt: '11:00', minutes: null, roomId: null, bed: null, therapistId: null, doctorId: null,
  followupForVisitId: null, attended: null, giftKind: null, note: null, status: 'pending_confirm',
  oneTime: true, ...over,
});

const GUEST = { id: 'g1', name: '客戶A', oneTime: true, flags: [] };
const REGULAR = { id: 'c1', name: '客戶A', flags: [] };

const EXAM_VISIT = {
  id: 'v-exam', customerId: 'g1', customerName: '客戶A', date: '2026-10-03', status: 'done',
  slots: [oneTimeSlot({ status: 'done', attended: true })],
};

const visitOf = (slots, over = {}) => ({
  customerId: 'g1', customerName: '客戶A', date: '2026-11-10', status: 'pending_confirm', slots, ...over,
});

const vctx = (over = {}) => ({
  customer: GUEST, courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, entitlements: [], customerVisits: [], ...over,
});

const errorsOf = (slot, over = {}) => validateVisit(visitOf([slot]), vctx(over)).errors;

// ---------- 客人 ----------

describe('一次性客人：讀只有一支，只認 true', () => {
  test('true 才算；false、字串、1、沒有那一格都不算', () => {
    assert.equal(isOneTime({ oneTime: true }), true);
    assert.equal(isOneTime({ oneTime: false }), false);
    assert.equal(isOneTime({ oneTime: 'true' }), false);
    assert.equal(isOneTime({ oneTime: 1 }), false);
    assert.equal(isOneTime({}), false);
    assert.equal(isOneTime(null), false);
  });

  test('一般客戶身上沒有那一格 → 不是', () => {
    const regular = { name: '客戶A', phone: '0912', flags: [], active: true };
    assert.equal(isOneTime(regular), false);
  });

  test('名字卡：照新增客戶的預設、多 oneTime: true；新增客戶的驗證照樣過', () => {
    const c = oneTimeCustomer({ name: ' 客戶A ', chartNo: '1234', phone: '0912', lineId: '小A', flags: ['體內金屬'] });
    assert.equal(c.oneTime, true);
    assert.equal(isOneTime(c), true);
    assert.equal(c.name, '客戶A');
    assert.equal(c.chartNo, '1234');
    assert.equal(c.phone, '0912');
    assert.equal(c.lineId, '小A');
    assert.deepEqual(c.flags, ['體內金屬']);
    // 名字卡上沒有的那幾格照新增客戶的空白預設（沒有購買日、沒有方案）
    assert.equal(c.purchasedAt, null);
    assert.equal(c.membershipExpiresAt, null);
    assert.equal(c.priority, 0);
    assert.deepEqual(c.partners, []);
    assert.deepEqual(c.marks, []);
    assert.deepEqual(validateCustomer(c), []);
  });

  test('名字卡：選填的沒填 → null，不是空字串', () => {
    const c = oneTimeCustomer({ name: '客戶A' });
    assert.equal(c.chartNo, null);
    assert.equal(c.phone, null);
    assert.equal(c.lineId, null);
    assert.deepEqual(c.flags, []);
  });

  test('轉成我的客戶＝寫 oneTime: false（不拿掉那一格：刪除標記進不了稽核那一筆），之後就是一般客戶', () => {
    assert.deepEqual(toMyCustomer(), { oneTime: false });
    const after = { ...oneTimeCustomer({ name: '客戶A' }), ...toMyCustomer() };
    assert.equal(isOneTime(after), false);
  });

  test('稽核上那一格有中文名字', () => {
    assert.equal(fieldLabel('oneTime'), '一次性客人');
  });
});

// ---------- 段 ----------

describe('一次性的段：讀只有一支，只認 true，不從形狀推', () => {
  test('true 才算', () => {
    assert.equal(isOneTimeSlot({ oneTime: true }), true);
    assert.equal(isOneTimeSlot({ oneTime: 'true' }), false);
    assert.equal(isOneTimeSlot({ oneTime: 1 }), false);
    assert.equal(isOneTimeSlot({}), false);
    assert.equal(isOneTimeSlot(null), false);
  });

  test('舊資料裡沒有額度的段（匯進來的、額度被刪的）不會被讀成一次性', () => {
    const { oneTime, ...shape } = oneTimeSlot();
    assert.equal(oneTime, true);
    assert.equal(isOneTimeSlot(shape), false);
  });

  test('giftKindOf：一次性的段一律 null（課程勾了預設體驗、沒有 giftKind 那一格也一樣）', () => {
    assert.equal(coursesById['course-fm'].uncounted, true);
    const { giftKind, ...noField } = oneTimeSlot({ courseId: 'course-fm', courseName: '功醫門診' });
    assert.equal(giftKind, null);
    assert.equal(giftKindOf(noField, coursesById), null);
    // 對照：同一個形狀沒有標記時照舊走退路（舊資料的猜法一個字都沒改）
    const { oneTime, ...legacy } = noField;
    assert.equal(oneTime, true);
    assert.equal(giftKindOf(legacy, coursesById), 'trial');
  });

  test('withGiftKinds 存檔寫實時寫 null，不寫成體驗', () => {
    const { giftKind, ...noField } = oneTimeSlot({ courseId: 'course-fm', courseName: '功醫門診' });
    assert.equal(giftKind, null);
    const out = withGiftKinds(visitOf([noField]), coursesById);
    assert.equal(out.slots[0].giftKind, null);
    assert.equal(out.slots[0].oneTime, true);
  });

  test('counts()：任何一筆額度都不算它（健檢額度也不算）', () => {
    const ent = { id: 'ent-exam', courseId: 'course-checkup', totalQty: 1 };
    const c = counts(ent, [EXAM_VISIT, visitOf([oneTimeSlot()])], 'ent-exam');
    assert.deepEqual([c.done, c.booked, c.remaining], [0, 0, 1]);
  });

  test('存進去、讀回來、再存一次：withSlotStatuses、withGiftKinds、withSlotNotes 都跑過形狀一樣', () => {
    const visit = visitOf([oneTimeSlot(), oneTimeSlot({ courseId: 'course-followup', courseName: '二返', followupForVisitId: 'v-exam', startsAt: '11:00', endsAt: '11:30' })]);
    const once = withSlotNotes(withGiftKinds(withSlotStatuses(visit), coursesById));
    const twice = withSlotNotes(withGiftKinds(withSlotStatuses(once), coursesById));
    assert.deepEqual(once.slots, visit.slots);
    assert.deepEqual(twice, once);
  });

  test('全站只准問 isOneTime()／isOneTimeSlot()：沒有人自己讀 `.oneTime`', () => {
    const root = fromRoot('public/js');
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    };
    walk(root);
    // 註解不算（JSDoc 寫 `picks.oneTime` 是在講參數）
    const code = (p) => readFileSync(p, 'utf8').split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
    const allowed = [join('domain', 'customers.js'), join('domain', 'masterData.js')];
    const offenders = files
      .filter((p) => !allowed.some((a) => p.endsWith(a)))
      .filter((p) => /\.oneTime\b|\[['"]oneTime['"]\]/.test(code(p)))
      .map((p) => relative(root, p));
    assert.deepEqual(offenders, []);
  });
});

// ---------- 組時段 ----------

describe('slotFromPicks：一次性的路', () => {
  test('課程是她按的那一門，不扣、不是送的，最後帶 oneTime: true', () => {
    const { slot, errors } = slotFromPicks(picks({ oneTime: true, courseId: 'course-checkup', startsAt: '09:00' }), ctx());
    assert.deepEqual(errors, []);
    assert.equal(slot.courseId, 'course-checkup');
    assert.equal(slot.courseName, '健檢');
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.giftKind, null);
    assert.equal(slot.oneTime, true);
    assert.equal(slot.endsAt, '11:00');
    assert.equal(slot.status, 'pending_confirm');
  });

  test('一次性贏：同時給了額度、送的 → 那幾樣清空（課程照她按的那一門）', () => {
    const ents = [{ id: 'ent-sis', type: 'single', label: '復能-SIS(60)', courseId: 'course-recovery', totalQty: 5 }];
    const { slot, errors } = slotFromPicks(picks({
      oneTime: true, courseId: 'course-checkup', entitlementId: 'ent-sis', giftCourseId: 'course-fm', giftKind: 'gift',
    }), ctx({ entitlements: ents }));
    assert.deepEqual(errors, []);
    assert.equal(slot.courseId, 'course-checkup');
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.giftKind, null);
  });

  test('沒選課程 → 先選要做什麼', () => {
    assert.deepEqual(slotFromPicks(picks({ oneTime: true }), ctx()).errors, ['先選要做什麼']);
  });

  test('刪掉的課程 → 先選要做什麼', () => {
    const courses = COURSES.map((c) => (c.id === 'course-moti' ? { ...c, deletedAt: '2026-11-01' } : c));
    assert.deepEqual(slotFromPicks(picks({ oneTime: true, courseId: 'course-moti' }), ctx({ courses })).errors, ['先選要做什麼']);
  });

  test('要選器材的課（復能）照器材重推課程、要治療師（同送的／體驗那一條）', () => {
    const sis = SEED.equipment.find((e) => e.courseId === 'course-recovery');
    const { slot, errors, assigns } = slotFromPicks(picks({
      oneTime: true, courseId: 'course-recovery', equipmentId: sis.id, therapistId: 'staff-t1',
    }), ctx());
    assert.deepEqual(errors, []);
    assert.equal(slot.courseId, 'course-recovery');
    assert.equal(slot.equipmentId, sis.id);
    assert.equal(assigns, 'therapist');
    assert.equal(slot.therapistId, 'staff-t1');
    assert.equal(slot.oneTime, true);
  });

  test('一次性的二返沒接健檢、也不是「健檢不是我排的」 → 擋（課程與指派照樣交回去）', () => {
    const r = slotFromPicks(picks({ oneTime: true, courseId: 'course-followup' }), ctx());
    assert.equal(r.slot, null);
    assert.deepEqual(r.errors, ['先選這是哪一次健檢的，或按「健檢不是我排的」']);
    assert.equal(r.course?.id, 'course-followup');
  });

  test('一次性的二返接了健檢 → 連結留著（不走「沒有額度就清掉連結」那一行）', () => {
    const { slot, errors } = slotFromPicks(picks({
      oneTime: true, courseId: 'course-followup', followupForVisitId: 'v-exam',
    }), ctx({ visits: [EXAM_VISIT] }));
    assert.deepEqual(errors, []);
    assert.equal(slot.followupForVisitId, 'v-exam');
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.oneTime, true);
    assert.equal('followupNth' in slot, false);
  });

  test('不是二返的一次性段，帶著不相干的連結 → 清掉', () => {
    const { slot } = slotFromPicks(picks({ oneTime: true, courseId: 'course-checkup', followupForVisitId: 'v-exam' }), ctx());
    assert.equal(slot.followupForVisitId, null);
  });

  test('跟「健檢不是我排的」同時給：兩格都寫，課程與返數照那一條', () => {
    const second = slotFromPicks(picks({ oneTime: true, examNotMine: true, nth: 2 }), ctx()).slot;
    assert.equal(second.courseId, 'course-followup');
    assert.equal(second.examNotMine, true);
    assert.equal(second.oneTime, true);
    assert.equal(second.followupForVisitId, null);
    assert.equal('followupNth' in second, false);

    const third = slotFromPicks(picks({ oneTime: true, examNotMine: true, nth: 3, followupForVisitId: 'v-exam' }), ctx()).slot;
    assert.equal(third.followupNth, 3);
    assert.equal(third.courseName, '三返');
    assert.equal(third.followupForVisitId, null);
    assert.equal(third.examNotMine, true);
    assert.equal(third.oneTime, true);
  });

  for (const [name, base] of [
    ['送的／體驗', { giftCourseId: 'course-fm', giftKind: 'trial' }],
    ['健檢不是我排的', { examNotMine: true, nth: 3 }],
  ]) {
    test(`${name}：oneTime: false 跟沒給一模一樣，而且沒有那一格`, () => {
      const plain = slotFromPicks(picks(base), ctx());
      const off = slotFromPicks(picks({ ...base, oneTime: false }), ctx());
      const str = slotFromPicks(picks({ ...base, oneTime: 'true', courseId: 'course-checkup' }), ctx());
      assert.deepEqual(off, plain);
      assert.deepEqual(str.slot, plain.slot);
      assert.equal('oneTime' in plain.slot, false);
    });
  }

  test('一般的路：給了 courseId、沒給 oneTime → 照舊不認它（一般的段沒有額度就組不出來）', () => {
    assert.deepEqual(slotFromPicks(picks({ courseId: 'course-checkup' }), ctx()).errors, ['先選要做什麼']);
  });
});

// ---------- 存檔驗證 ----------

describe('validateVisit：一次性的段只放過那一種形狀', () => {
  test('一次性的健檢、復能、營養點滴…（形狀對）→ 存得下去，不講「要選一個額度」', () => {
    assert.deepEqual(errorsOf(oneTimeSlot()), []);
  });

  test('slotFromPicks 組出來的那一段直接存得下去', () => {
    const { slot } = slotFromPicks(picks({ oneTime: true, courseId: 'course-checkup', startsAt: '09:00' }), ctx());
    assert.deepEqual(errorsOf(slot), []);
  });

  test('一次性又扣了額度 → 擋，講額度', () => {
    const ents = [{ id: 'ent-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1 }];
    const errs = errorsOf(oneTimeSlot({ entitlementId: 'ent-exam' }), { entitlements: ents });
    assert.ok(errs.some((e) => /一次性客人時記的.*不扣次數.*取消這一段、另約一段/.test(e)), errs.join('\n'));
  });

  test('一次性又是送的／體驗 → 擋，講送的或體驗', () => {
    for (const kind of ['trial', 'gift']) {
      const errs = errorsOf(oneTimeSlot({ courseId: 'course-fm', courseName: '功醫門診', giftKind: kind }));
      assert.ok(errs.some((e) => /一次性.*不是送的.*體驗/.test(e)), errs.join('\n'));
    }
  });

  test('一次性的二返沒接健檢、也不是「健檢不是我排的」 → 擋', () => {
    const errs = errorsOf(oneTimeSlot({ courseId: 'course-followup', courseName: '二返', endsAt: '09:30' }));
    assert.ok(errs.some((e) => /一次性的二返.*健檢不是我排的/.test(e)), errs.join('\n'));
    assert.ok(!errs.some((e) => /要選一個額度/.test(e)), errs.join('\n'));
  });

  test('一次性的二返接了健檢 → 存得下去', () => {
    const slot = oneTimeSlot({ courseId: 'course-followup', courseName: '二返', endsAt: '09:30', followupForVisitId: 'v-exam' });
    assert.deepEqual(errorsOf(slot, { customerVisits: [EXAM_VISIT] }), []);
  });

  test('一次性的二返按了「健檢不是我排的」 → 存得下去', () => {
    const slot = oneTimeSlot({ courseId: 'course-followup', courseName: '二返', endsAt: '09:30', examNotMine: true });
    assert.deepEqual(errorsOf(slot), []);
  });

  test('一次性＋健檢不是我排的、又接了健檢 → 照 ADR-0169 那一句擋，不重複講', () => {
    const slot = oneTimeSlot({ courseId: 'course-followup', courseName: '二返', endsAt: '09:30', examNotMine: true, followupForVisitId: 'v-exam' });
    const errs = errorsOf(slot, { customerVisits: [EXAM_VISIT] });
    assert.equal(errs.length, 1, errs.join('\n'));
    assert.match(errs[0], /不接 app 裡的任何一次健檢/);
  });

  test('一次性客人身上一段沒有標記、也沒有額度 → 擋（程式的錯，不該發生）', () => {
    const { oneTime, ...plain } = oneTimeSlot();
    assert.equal(oneTime, true);
    const errs = errorsOf(plain);
    assert.ok(errs.some((e) => /一次性客人的段要標成一次性/.test(e)), errs.join('\n'));
    // 送的／體驗的段也一樣（一次性客人不走那一條）
    const gift = { ...plain, courseId: 'course-fm', courseName: '功醫門診', giftKind: 'trial' };
    assert.ok(errorsOf(gift).some((e) => /一次性客人的段要標成一次性/.test(e)));
  });

  test('句子用畫面上那一段的叫法（slotLabel）', () => {
    const errs = validateVisit(visitOf([oneTimeSlot({ giftKind: 'trial' })]), vctx({ slotLabel: () => '這一段' })).errors;
    assert.ok(errs.every((e) => e.startsWith('這一段：')), errs.join('\n'));
  });

  describe('沒有標記的一個字都不放寬', () => {
    test('一般客戶沒選額度的段 → 照舊擋「要選一個額度」', () => {
      const { oneTime, ...plain } = oneTimeSlot();
      assert.equal(oneTime, true);
      const errs = errorsOf(plain, { customer: REGULAR });
      assert.ok(errs.some((e) => /要選一個額度/.test(e)), errs.join('\n'));
      assert.ok(!errs.some((e) => /一次性/.test(e)), errs.join('\n'));
    });

    test('標記寫成字串 "true" → 不算，照一般的段擋', () => {
      const errs = errorsOf(oneTimeSlot({ oneTime: 'true' }), { customer: REGULAR });
      assert.ok(errs.some((e) => /要選一個額度/.test(e)), errs.join('\n'));
    });

    test('一般客戶的送的／體驗照舊存得下去（一次性那一道只問一次性客人）', () => {
      const { oneTime, ...gift } = oneTimeSlot({ courseId: 'course-fm', courseName: '功醫門診', giftKind: 'trial', endsAt: '09:30' });
      assert.equal(oneTime, true);
      assert.deepEqual(errorsOf(gift, { customer: REGULAR }), []);
    });

    test('轉成我的客戶之後（oneTime: false）：沒有標記的段照一般客戶擋、以前的一次性段照舊存得下去', () => {
      const converted = { ...GUEST, oneTime: false };
      const { oneTime, ...plain } = oneTimeSlot();
      assert.equal(oneTime, true);
      const errs = errorsOf(plain, { customer: converted });
      assert.ok(errs.some((e) => /要選一個額度/.test(e)), errs.join('\n'));
      assert.ok(!errs.some((e) => /一次性客人的段/.test(e)), errs.join('\n'));
      assert.deepEqual(errorsOf(oneTimeSlot(), { customer: converted }), []);
    });
  });
});

// ---------- 呼叫端 ----------

describe('validateVisit 的呼叫端傳得出 oneTime（過目 10）', () => {
  // 三個呼叫端以前只傳半個客戶（`{ flags }`）—— 「一次性客人的段要標成一次性」那一道在那幾條路上永遠不會響
  const src = (p) => readFileSync(fromRoot(p), 'utf8');

  test('壓表：拿剛讀回來的那一位（owner）', () => {
    assert.match(src('public/js/ui/views/schedule.js'), /customer: \{ \.\.\.\(owner \?\? \{\}\), flags: selected\.flags \?\? \[\] \}/);
  });

  test('另約健檢順便接二返：整份客戶', () => {
    assert.match(src('public/js/ui/relinkFollowup.js'), /customer: \{ \.\.\.customer, flags: customer\.flags \?\? \[\] \}/);
  });

  test('拍 Abovee：照片上認出的那一位整份', () => {
    assert.match(src('public/js/domain/aboveeImport.js'), /customer: \{ \.\.\.\(who \?\? \{\}\), flags: who\?\.flags \?\? \[\] \}/);
  });
});
