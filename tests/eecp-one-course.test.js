// EECP 只有一門（staging-polish 09，ADR-0154）。
//
// 她 10/18 的原話：
//
// > 5. 如圖5，EECP只有一個EECP 不用EECP 體驗
// > 應該要是這樣，EECP可以選60 20，以及可以選體驗/送的
// > 所以只要留一個EECP就好，預設是60分鐘 ，不選體驗/送的，然後如果選20就預設是體驗這樣可以嗎
//
// 課程多一格「體驗的時候排幾分」（`trialMinutes`）：EECP 約的時候 20／60、預設 60、體驗 20。
// 按 20 → 那一段換成體驗（三個入口同一支 `trialFromMinutes()`）；拍 Abovee 的 `EECP20` → EECP、20 分、體驗。
//
// 判準：**這一行會不會讓一段體驗被算進 EECP 的額度，或反過來？** 三個入口（壓表、來訪編輯器、拍 Abovee）、
// 拍 Abovee 對上既有的段、候選與時段反查各一條。壓表與來訪編輯器是畫面（node 裡 import 不了）：
// 規則在 domain、這裡叫那一支並掃它們有沒有叫；按下去的樣子由 E2E `72` 盯。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validate, trialMinutesOf, isTrialMinutes, canBeGift } from '../public/js/domain/masterData.js';
import { slotMinutes, slotMinutesField, minuteChoicesFor, rebookSlot } from '../public/js/domain/visits.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import {
  trialFromMinutes, giftOptions, giftPick, arrangeSlotOptions, defaultGiftCourse, slotOptionsFor, NTH_PICK,
} from '../public/js/domain/slotOptions.js';
import {
  readAbovee, planAbovee, photoDayPlan, changeLines, offersChange, needsAttention, wantsWrite, pickMinutes, recordedSay,
} from '../public/js/domain/aboveeImport.js';
import { aboveeConsequences, chargeSwitchConsequences } from '../public/js/domain/consequences.js';
import { counts } from '../public/js/domain/entitlements.js';
import { slotName } from '../public/js/domain/naming.js';
import { addExtraVisits } from '../public/js/domain/mergeImport.js';
import { courseFrom } from '../public/js/domain/abovee.js';
import { runHealthCheck, CHECKS } from '../public/js/domain/health.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses.map((c) => ({ ...c, active: true }));
const BY_ID = Object.fromEntries(COURSES.map((c) => [c.id, c]));
const EECP = BY_ID['course-eecp'];
const MASTER = { courses: COURSES, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };

const EECP_ENT = { id: 'w-eecp', customerId: 'c-wang', type: 'single', label: 'EECP', courseId: 'course-eecp', totalQty: 10, durationMin: 60 };
const slotCtx = (entitlements = [EECP_ENT], visits = []) => ({
  courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts, entitlements, visits,
});
const read = (src) => readFileSync(new URL(src, import.meta.url), 'utf8');

describe('種子：只有一門 EECP', () => {
  test('沒有 course-eecp-trial（她：「直接不要」）', () => {
    assert.equal(SEED.courses.some((c) => c.id === 'course-eecp-trial'), false);
    assert.equal(SEED.courses.some((c) => c.name === 'EECP體驗'), false);
  });

  test('EECP：約的時候 20／60、預設 60、體驗 20、不是預設體驗、Abovee 寫法只有 EECP', () => {
    assert.deepEqual(EECP.bookingMinutes, [20, 60]);
    assert.equal(EECP.durationMin, 60);
    assert.equal(EECP.trialMinutes, 20);
    assert.notEqual(EECP.uncounted, true);
    assert.deepEqual(EECP.aboveeNames, ['EECP']);
    assert.deepEqual(validate('courses', EECP, { existing: SEED.courses }), []);
  });

  test('public/js 裡只剩資料健檢認舊資料庫那一處寫著 course-eecp-trial', () => {
    const files = ['domain/slotOptions.js', 'ui/components/buy.js', 'domain/entitlements.js', 'domain/treatmentSheets.js',
      'data/health.js', 'domain/seed.js', 'domain/abovee.js'];
    for (const f of files) assert.ok(!read(`../public/js/${f}`).includes('course-eecp-trial'), f);
  });
});

describe('課程上那一格：體驗的時候排幾分', () => {
  const at = (over) => validate('courses', { ...EECP, ...over }, { existing: SEED.courses });

  test('沒填就是沒有（體驗照那門課自己的時長，跟以前一樣）', () => {
    assert.equal(trialMinutesOf({ ...EECP, trialMinutes: null }), null);
    assert.equal(trialMinutesOf({ ...EECP, trialMinutes: '' }), null);
    assert.equal(trialMinutesOf(EECP), 20);
    assert.deepEqual(at({ trialMinutes: null }), []);
  });

  test('填成預設時長（60）存不下去：按一下預選好的那一顆就把扣額度的變成體驗', () => {
    const errors = at({ trialMinutes: 60 });
    assert.ok(errors.some((e) => e.includes('不可以跟預設時長一樣')), errors.join('；'));
  });

  test('要在「約的時候可選」裡 —— 那一排才按得到它', () => {
    const errors = at({ trialMinutes: 30 });
    assert.ok(errors.some((e) => e.includes('約的時候可選')), errors.join('；'));
  });

  test('整數、大於 0', () => {
    assert.ok(at({ trialMinutes: 0 }).some((e) => e.includes('體驗的時候排幾分')));
    assert.ok(at({ trialMinutes: 12.5 }).some((e) => e.includes('體驗的時候排幾分')));
  });

  test('健檢與二返沒有體驗：填了存不下去', () => {
    const followup = SEED.courses.find((c) => c.id === 'course-followup');
    const errors = validate('courses', { ...followup, trialMinutes: 60, durationMin: 30 }, { existing: SEED.courses });
    assert.ok(errors.some((e) => e.includes('健檢與二返沒有體驗')), errors.join('；'));
    assert.equal(canBeGift(followup, SEED.courses), false);
  });

  test('錯誤字眼打得開設定頁收起來的那一段（MORE_WORDS）', () => {
    const src = read('../public/js/ui/views/masterList.js');
    assert.match(src, /MORE_WORDS = \[[^\]]*'排幾分'/);
    assert.match(src, /name: 'trialMinutes'/);
  });

  test('稽核印中文', async () => {
    const { fieldLabel } = await import('../public/js/domain/audit.js');
    assert.equal(fieldLabel('trialMinutes'), '體驗的時候排幾分');
  });

  test('isTrialMinutes：只有那個數字、只有可以當體驗的課', () => {
    assert.equal(isTrialMinutes(EECP, 20, COURSES), true);
    assert.equal(isTrialMinutes(EECP, '20', COURSES), true);
    assert.equal(isTrialMinutes(EECP, 60, COURSES), false);
    assert.equal(isTrialMinutes(EECP, null, COURSES), false);
    assert.equal(isTrialMinutes(BY_ID['course-cardio'], 20, COURSES), false, '沒填那一格的課不會');
  });
});

describe('要排多久：送的／體驗的段多一層「體驗的時候排幾分」', () => {
  test('體驗的 EECP → 20；扣額度的 → 60；體驗她按了 60 → 60', () => {
    assert.equal(slotMinutes({ course: EECP, giftKind: 'trial' }), 20);
    assert.equal(slotMinutes({ course: EECP, giftKind: 'gift' }), 20);
    assert.equal(slotMinutes({ entitlement: EECP_ENT, course: EECP }), 60);
    assert.equal(slotMinutes({ course: EECP, giftKind: 'trial', minutes: 60 }), 60);
  });

  test('帶著額度的段不是體驗：giftKind 給了也照額度（兩種身分只挑一種）', () => {
    assert.equal(slotMinutes({ entitlement: EECP_ENT, course: EECP, giftKind: 'trial' }), 60);
  });

  test('排多久那一排：扣額度與體驗都選得到 20、60', () => {
    assert.deepEqual(minuteChoicesFor({ entitlement: EECP_ENT, course: EECP }), [20, 60]);
    assert.deepEqual(minuteChoicesFor({ course: EECP, giftKind: 'trial' }), [20, 60]);
    assert.equal(slotMinutesField({ course: EECP, giftKind: 'trial' }), 20);
    assert.equal(slotMinutesField({ entitlement: EECP_ENT, course: EECP }), 60);
  });

  test('存下去的段：結束時間是開始＋20、名字 EECP(20)(體驗)；扣額度的 EECP(60)', () => {
    const { slot: trial } = slotFromPicks({ giftCourseId: 'course-eecp', startsAt: '10:00', roomId: 'room-t5' }, slotCtx([]));
    assert.deepEqual([trial.entitlementId, trial.giftKind, trial.minutes, trial.endsAt], [null, 'trial', 20, '10:20']);
    assert.equal(slotName(trial, MASTER, 'short'), 'EECP(20)(體驗)');
    const { slot: paid } = slotFromPicks({ entitlementId: 'w-eecp', startsAt: '10:00', roomId: 'room-t5' }, slotCtx());
    assert.deepEqual([paid.entitlementId, paid.giftKind, paid.minutes, paid.endsAt], ['w-eecp', null, 60, '11:00']);
    assert.equal(slotName(paid, MASTER, 'short'), 'EECP(60)');
    assert.equal(slotName(trial, MASTER, 'line'), slotName(paid, MASTER, 'line'), '貼給客人的那一句不接分鐘也不接(體驗)');
  });

  test('改期（rebookSlot）：新的那一段照舊是體驗 20', () => {
    const { slot } = slotFromPicks({ giftCourseId: 'course-eecp', startsAt: '10:00', roomId: 'room-t5' }, slotCtx([]));
    const v = { id: 'v1', customerId: 'c-wang', date: '2026-10-20', status: 'confirmed', slots: [{ ...slot, status: 'confirmed' }] };
    const moved = rebookSlot(v, 0, { ...v.slots[0], startsAt: '14:00', endsAt: '14:20' });
    const fresh = moved.slots[moved.slots.length - 1];
    assert.deepEqual([fresh.giftKind, fresh.entitlementId, fresh.minutes], ['trial', null, 20]);
  });
});

describe('按 20 → 體驗：三個入口同一支（trialFromMinutes）', () => {
  test('扣著 EECP 額度的那一段按 20 → 換成 EECP 的體驗', () => {
    assert.deepEqual(trialFromMinutes({ value: 'w-eecp', course: EECP, minutes: 20, courses: COURSES }),
      { value: giftPick('course-eecp'), giftKind: 'trial' });
    assert.deepEqual(trialFromMinutes({ value: 'w-eecp', course: EECP, minutes: '20', courses: COURSES }),
      { value: giftPick('course-eecp'), giftKind: 'trial' }, '畫面上讀回來的是字串');
  });

  test('按 60（預設）不換；已經是體驗／送的不換（反過來不自動，她說的是「選 20 就預設是體驗」）', () => {
    assert.equal(trialFromMinutes({ value: 'w-eecp', course: EECP, minutes: 60, courses: COURSES }), null);
    assert.equal(trialFromMinutes({ value: giftPick('course-eecp'), course: EECP, minutes: 20, courses: COURSES }), null);
    assert.equal(trialFromMinutes({ value: giftPick('course-eecp'), course: EECP, minutes: 60, courses: COURSES }), null);
  });

  test('n返、還沒選、沒有那一格的課、停用的課：不換', () => {
    const followup = BY_ID['course-followup'];
    assert.equal(trialFromMinutes({ value: NTH_PICK, course: followup, minutes: 30, courses: COURSES }), null);
    assert.equal(trialFromMinutes({ value: null, course: EECP, minutes: 20, courses: COURSES }), null);
    assert.equal(trialFromMinutes({ value: 'w-x', course: BY_ID['course-iv-laser'], minutes: 30, courses: COURSES }), null);
    assert.equal(trialFromMinutes({ value: 'w-eecp', course: { ...EECP, active: false }, minutes: 20, courses: COURSES }), null);
  });

  test('判準：換過去之後組出來的那一段不扣額度、額度的已排沒有多 1', () => {
    const pick = trialFromMinutes({ value: 'w-eecp', course: EECP, minutes: 20, courses: COURSES });
    const { slot } = slotFromPicks({ giftCourseId: 'course-eecp', giftKind: pick.giftKind, startsAt: '10:00', roomId: 'room-t5' }, slotCtx());
    const v = { id: 'v1', customerId: 'c-wang', date: '2026-10-20', status: 'pending_confirm', slots: [slot] };
    assert.equal(slot.entitlementId, null);
    assert.equal(counts(EECP_ENT, [v], 'w-eecp').booked, 0);
  });

  test('三個入口都叫它（壓表、來訪編輯器、拍 Abovee 的確認層）', () => {
    assert.match(read('../public/js/ui/views/schedule.js'), /trialFromMinutes\(/);
    assert.match(read('../public/js/ui/views/visitEditor.js'), /trialFromMinutes\(/);
    assert.match(read('../public/js/domain/aboveeImport.js'), /trialFromMinutes\(/);
    assert.match(read('../public/js/ui/components/aboveeConfirm.js'), /pickMinutes\(/);
  });
});

describe('「送的／體驗…」裡 EECP 排在第一排', () => {
  test('第一排：功醫門診 → HRV → 心臟科評估 → EECP；那一顆的時長是 20', () => {
    const first = arrangeSlotOptions(giftOptions(COURSES), COURSES).filter((o) => !o.other);
    assert.deepEqual(first.map((o) => o.label), ['功醫門診', 'HRV', '心臟科評估', 'EECP']);
    assert.equal(first.find((o) => o.course.id === 'course-eecp').durationMin, 20);
  });

  test('沒有額度的新的一段照舊預設功醫門診', () => {
    assert.equal(defaultGiftCourse(COURSES)?.id, 'course-fm');
  });

  test('有 EECP 額度：上面那一排有 EECP（扣額度），收起來的那一組也有 EECP（體驗）', () => {
    const options = slotOptionsFor({ entitlements: [EECP_ENT], courses: COURSES, equipment: SEED.equipment });
    assert.ok(options.some((o) => o.entitlementId === 'w-eecp' && !o.folded));
    assert.ok(options.some((o) => o.entitlementId === giftPick('course-eecp') && o.folded && !o.other));
  });
});

// ---------- 拍 Abovee ----------

const TODAY = '2026-10-18';
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const COLS_SRC = [...COLS, '預約來源'];
const PEOPLE = [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }];
const actx = (visits = [], ents = [EECP_ENT], today = TODAY) => ({
  customers: PEOPLE, entitlementsBy: { 'c-wang': ents }, visitsBy: { 'c-wang': visits }, master: MASTER, today,
});
const prow = (status, date, time, course, src = null) => [status, date, time, '王小明', '00001234', course, ...(src == null ? [] : [src])];
const items = (rows, c, cols = COLS) => readAbovee([{ columns: cols, rows, pageText: `${rows.length}筆第1/1頁` }], c).items;
const eecpSlot = (over = {}) => ({
  entitlementId: 'w-eecp', courseId: 'course-eecp', courseName: 'EECP', roomId: 'room-t5', bed: null,
  startsAt: '10:00', endsAt: '11:00', minutes: 60, giftKind: null, status: 'confirmed', attended: null, ...over,
});
const visitOf = (slots, over = {}) => ({
  id: 'v1', customerId: 'c-wang', customerName: '王小明', date: '2026-10-20', status: 'confirmed', slots, ...over,
});

describe('拍 Abovee：EECP20 是 EECP、20 分、體驗', () => {
  test('courseFrom：EECP20 → EECP＋20 分（拆分鐘，不再是另一門課）；EECP60 → EECP＋60', () => {
    assert.deepEqual([courseFrom('EECP20', MASTER).courseId, courseFrom('EECP20', MASTER).durationMin], ['course-eecp', 20]);
    assert.deepEqual([courseFrom('EECP60', MASTER).courseId, courseFrom('EECP60', MASTER).durationMin], ['course-eecp', 60]);
  });

  test('照片 EECP20、預約來源「正式課」→ 體驗、20 分、預設勾，不扣額度', () => {
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 10:20', 'EECP20', '正式課')], actx(), COLS_SRC);
    assert.deepEqual([item.kind, item.giftCourseId, item.giftKind, item.entitlementId, item.checked],
      ['new', 'course-eecp', 'trial', null, true]);
    const { groups, problems } = planAbovee([{ ...item, roomId: 'room-t5' }], actx());
    assert.deepEqual(problems, {});
    const [slot] = groups[0].visit.slots;
    assert.deepEqual([slot.entitlementId, slot.giftKind, slot.minutes, slot.endsAt], [null, 'trial', 20, '10:20']);
  });

  test('照片 EECP60 或只寫 EECP → 正式課 60、扣額度', () => {
    for (const course of ['EECP60', 'EECP']) {
      const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 11:00', course)], actx());
      assert.deepEqual([item.giftCourseId, item.entitlementId], [null, 'w-eecp'], course);
      const { groups } = planAbovee([{ ...item, roomId: 'room-t5' }], actx());
      assert.equal(groups[0].visit.slots[0].endsAt, '11:00', course);
    }
  });

  test('只寫 EECP、預約來源寫體驗 → 體驗、20 分（體驗的時候排幾分）', () => {
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 10:20', 'EECP', '體驗')], actx(), COLS_SRC);
    const { groups } = planAbovee([{ ...item, roomId: 'room-t5' }], actx());
    assert.deepEqual([groups[0].visit.slots[0].giftKind, groups[0].visit.slots[0].endsAt], ['trial', '10:20']);
  });

  test('沒有 EECP 額度的人照樣認成體驗', () => {
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 10:20', 'EECP20')], actx([], []));
    assert.deepEqual([item.giftCourseId, item.giftKind, item.checked], ['course-eecp', 'trial', true]);
  });

  test('確認層按「排多久」20 → 跟壓表同一支：換成體驗', () => {
    const c = actx();
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 11:00', 'EECP60')], c);
    const next = pickMinutes(item, 20, c, [item]);
    assert.deepEqual([next.giftCourseId, next.giftKind, next.entitlementId, next.minutes], ['course-eecp', 'trial', null, 20]);
    const same = pickMinutes(item, 60, c, [item]);
    assert.deepEqual([same.giftCourseId, same.entitlementId, same.minutes], [null, 'w-eecp', 60]);
  });

  test('她自己把一列 EECP20 換回扣額度：那一列多一句「Abovee 上是體驗」（收著也看得到）', () => {
    const c = actx();
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 10:20', 'EECP20')], c);
    const paid = { ...item, giftCourseId: null, giftKind: null, entitlementId: 'w-eecp', roomId: 'room-t5' };
    const p = photoDayPlan([paid], c);
    assert.ok((p.mustSeeBy[item.key] ?? []).some((t) => t.includes('體驗')), JSON.stringify(p.mustSeeBy));
  });
});

describe('拍 Abovee：app 上已經有那一段、扣法不一樣 → 要改的（照片為準，ADR-0149）', () => {
  const said = (lines) => lines.reduce((sum, l) => {
    for (const m of l.matchAll(/（(扣|還) (\d+) 次）/g)) sum += (m[1] === '扣' ? 1 : -1) * Number(m[2]);
    return sum;
  }, 0);

  test('app 10:00 EECP 60 扣額度、照片 10:00 EECP20 → 不是安安靜靜的「已經記了」，是要改的一行、預設勾', () => {
    const v1 = visitOf([eecpSlot()]);
    const c = actx([v1]);
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 10:20', 'EECP20')], c);
    assert.equal(item.kind, 'recorded');
    assert.deepEqual(item.chargeChange, { to: 'trial', entitlementId: null, minutes: 20 });
    assert.equal(item.adoptCharge, true);
    assert.equal(offersChange(item), true);
    assert.equal(wantsWrite(item), true);
    assert.match(recordedSay(item), /體驗/);

    const p = photoDayPlan([item], c);
    const { lines } = changeLines([item], p, c);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].field, 'adoptCharge');
    assert.match(lines[0].text, /改成體驗 20 分，不扣（還 1 次）/);
  });

  test('套上去之後那一段是體驗 20、額度的已排少 1；確認框的括號＝前後的差', () => {
    const v1 = visitOf([eecpSlot()]);
    const c = actx([v1]);
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 10:20', 'EECP20')], c);
    const p = photoDayPlan([item], c);
    assert.deepEqual(p.missed, []);
    const [w] = p.writes;
    const s = w.visit.slots[0];
    assert.deepEqual([s.entitlementId, s.giftKind, s.minutes, s.startsAt, s.endsAt, s.status, s.roomId],
      [null, 'trial', 20, '10:00', '10:20', 'confirmed', 'room-t5']);
    assert.equal(counts(EECP_ENT, [v1], 'w-eecp').booked - counts(EECP_ENT, [w.visit], 'w-eecp').booked, 1);
    assert.deepEqual(p.rows.filter((r) => r.kind === 'charge').map((r) => r.charge), [-1]);
    const { lines } = aboveeConsequences({ plan: p, coursesById: BY_ID, today: TODAY });
    assert.ok(lines.some((l) => l.includes('照 Abovee 改成體驗')), lines.join('\n'));
    assert.equal(said(lines), -1, lines.join('\n'));
  });

  test('她拿掉那一個勾 → 不改、計畫裡沒有那一列', () => {
    const v1 = visitOf([eecpSlot()]);
    const c = actx([v1]);
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 10:20', 'EECP20')], c);
    const off = { ...item, adoptCharge: false };
    assert.equal(wantsWrite(off), false);
    assert.deepEqual(photoDayPlan([off], c).writes, []);
  });

  test('反過來：app 上是體驗 20、照片 EECP60 → 改成扣那一筆 EECP（扣 1 次）、60 分', () => {
    const v1 = visitOf([eecpSlot({ entitlementId: null, giftKind: 'trial', minutes: 20, endsAt: '10:20' })]);
    const c = actx([v1]);
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 11:00', 'EECP60')], c);
    assert.deepEqual(item.chargeChange, { to: 'counted', entitlementId: 'w-eecp', minutes: 60 });
    assert.equal(item.adoptCharge, true);
    const p = photoDayPlan([item], c);
    const s = p.writes[0].visit.slots[0];
    assert.deepEqual([s.entitlementId, s.giftKind, s.minutes, s.endsAt], ['w-eecp', null, 60, '11:00']);
    assert.deepEqual(p.rows.filter((r) => r.kind === 'charge').map((r) => r.charge), [1]);
    assert.match(changeLines([item], p, c).lines[0].text, /扣 1 次/);
  });

  test('反過來、身上沒有 EECP 額度 → 列出來不先勾、講為什麼', () => {
    const v1 = visitOf([eecpSlot({ entitlementId: null, giftKind: 'trial', minutes: 20, endsAt: '10:20' })]);
    const c = actx([v1], []);
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 11:00', 'EECP60')], c);
    assert.deepEqual(item.chargeChange, { to: 'counted', entitlementId: null, minutes: 60 });
    assert.equal(item.adoptCharge, false);
    const { lines } = changeLines([item], photoDayPlan([item], c), c);
    assert.match(lines[0].text, /不改 —— .*額度/);
  });

  test('已完成的那一段鎖著：只提醒（要你看），不在「要改的」', () => {
    const v1 = visitOf([eecpSlot({ status: 'done', attended: true })], { date: '2026-10-10', status: 'done' });
    const c = actx([v1]);
    const [item] = items([prow('課程完成', '2026-10-10', '10:00 - 10:20', 'EECP20')], c);
    assert.ok(item.chargeChange);
    assert.equal(item.chargeLocked, true);
    assert.equal(item.adoptCharge, false);
    assert.equal(offersChange(item), false);
    assert.equal(needsAttention(item), true);
    assert.deepEqual(photoDayPlan([item], c).writes, []);
  });

  test('照片與 app 都是體驗、或都是正式課 → 照舊安安靜靜的「已經記了」', () => {
    const trial = visitOf([eecpSlot({ entitlementId: null, giftKind: 'trial', minutes: 20, endsAt: '10:20' })]);
    const [a] = items([prow('確認前往', '2026-10-20', '10:00 - 10:20', 'EECP20')], actx([trial]));
    assert.deepEqual([a.kind, a.chargeChange ?? null, offersChange(a)], ['recorded', null, false]);
    const paid = visitOf([eecpSlot()]);
    const [b] = items([prow('確認前往', '2026-10-20', '10:00 - 11:00', 'EECP60')], actx([paid]));
    assert.deepEqual([b.kind, b.chargeChange ?? null, offersChange(b)], ['recorded', null, false]);
  });

  test('別的課沒拍到預約來源：照舊不比（看不出是不是體驗，ADR-0148 那一條）', () => {
    const fm = visitOf([{ entitlementId: null, courseId: 'course-fm', courseName: '功醫門診', giftKind: 'trial',
      startsAt: '10:00', endsAt: '10:30', status: 'confirmed', doctorId: null }]);
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 10:30', '功醫門診')], actx([fm], []));
    assert.equal(item.chargeChange ?? null, null);
  });

  test('預約來源寫體驗、app 那一段扣著額度（不限 EECP）→ 要改的', () => {
    const v1 = visitOf([eecpSlot()]);
    const c = actx([v1]);
    const [item] = items([prow('確認前往', '2026-10-20', '10:00 - 11:00', 'EECP60', '體驗')], c, COLS_SRC);
    assert.equal(item.chargeChange?.to, 'trial');
  });
});

// ---------- 來訪編輯器把一段既有的改了扣法：原地改、確認框講（她 10/18：照建議，原地改）----------

describe('來訪編輯器：改了既有那一段的扣法 → 原地改、確認框講', () => {
  const before = visitOf([eecpSlot()]);
  const after = visitOf([eecpSlot({ entitlementId: null, giftKind: 'trial', minutes: 20, endsAt: '10:20' })]);

  test('扣額度 → 體驗：講不扣、還 1 次、Abovee 上記得改成 EECP20', () => {
    const said = chargeSwitchConsequences({ before, after, coursesById: BY_ID, entitlements: [EECP_ENT], customerVisits: [before] });
    assert.ok(said);
    assert.match(said.title, /體驗/);
    const text = said.lines.join('\n');
    assert.match(text, /EECP\(20\)\(體驗\)/);
    assert.match(text, /不扣/);
    assert.match(text, /還 1 次/);
    assert.match(text, /Abovee 上記得改成 EECP20/);
  });

  test('體驗 → 扣額度：講扣 1 次、Abovee 上記得改成 EECP60', () => {
    const said = chargeSwitchConsequences({ before: after, after: before, coursesById: BY_ID, entitlements: [EECP_ENT], customerVisits: [after] });
    const text = said.lines.join('\n');
    assert.match(text, /扣 1 次/);
    assert.match(text, /Abovee 上記得改成 EECP60/);
  });

  test('扣法沒變（只改時長、治療師）→ 不跳這一道', () => {
    const same = visitOf([eecpSlot({ roomId: 'room-t8' })]);
    assert.equal(chargeSwitchConsequences({ before, after: same, coursesById: BY_ID, entitlements: [EECP_ENT], customerVisits: [before] }), null);
  });

  test('原地改：不走 rebookSlot()（開始時間與課程都沒變）', () => {
    assert.equal(rebookSlot(before, 0, after.slots[0]), null);
  });

  test('來訪編輯器存檔前叫它', () => {
    assert.match(read('../public/js/ui/views/visitEditor.js'), /chargeSwitchConsequences\(/);
  });
});

// ---------- 候選與時段反查 ----------

describe('候選補的、時段反查：每一個呼叫端都把 giftKind 交給 slotMinutes()', () => {
  // 候選清單補的那一段：不扣的那一段（不算次數的課，身上沒有額度）寫實成體驗 —— 時長照「體驗的時候排幾分」
  const TRIALISH = { id: 'course-x', name: '某一門', durationMin: 60, bookingMinutes: [30, 60], trialMinutes: 30,
    uncounted: true, assigns: 'none', systems: ['Abovee'], category: 'C' };
  test('候選補一段不扣的：結束時間是開始＋體驗的時候排幾分', () => {
    const plans = [{ customerName: '王小明', skip: null, customer: { importedFrom: 'x' }, entitlements: [], visits: [],
      counts: { visits: 0, future: 0, slots: 0, timed: 0 } }];
    const problems = addExtraVisits(plans, [{ customerName: '王小明', date: '2026-10-20', courseName: '某一門', startsAt: '10:00' }],
      { courses: [TRIALISH], today: TODAY });
    assert.deepEqual(problems, []);
    const [slot] = plans[0].visits[0].slots;
    assert.deepEqual([slot.giftKind, slot.endsAt], ['trial', '10:30']);
  });

  test('每一個 slotMinutes() 的呼叫都帶著 giftKind（不帶的話體驗照額度或課程排）', () => {
    for (const f of ['domain/mergeImport.js', 'ui/views/backfill.js', 'domain/health.js']) {
      const calls = [...read(`../public/js/${f}`).matchAll(/slotMinutes\(\{([^}]*)\}\)/g)].map((m) => m[1]);
      assert.ok(calls.length, f);
      for (const c of calls) assert.match(c, /giftKind/, `${f}：slotMinutes({${c}})`);
    }
  });
});

// ---------- 資料健檢：還留著「EECP體驗」那一門的資料庫（保險）----------

describe('資料健檢：「EECP體驗」那一門還在', () => {
  const OLD = { id: 'course-eecp-trial', name: 'EECP體驗', group: 'EECP', category: 'C', systems: ['Abovee'], durationMin: 20,
    aboveeNames: ['EECP20'], assigns: 'room', allowedRoomTypes: [], allowedRoomIds: ['room-t5', 'room-t7', 'room-t8'], uncounted: true };
  const master = (eecp = EECP, extra = [OLD]) => ({
    ...MASTER, courses: [...COURSES.filter((c) => c.id !== 'course-eecp'), eecp, ...extra],
  });
  const trialSlot = (over = {}) => ({ entitlementId: null, courseId: 'course-eecp-trial', courseName: 'EECP體驗', roomId: 'room-t5',
    startsAt: '10:00', endsAt: '10:30', status: 'confirmed', attended: null, ...over });
  const snap = (over = {}) => ({
    customers: [{ id: 'c-wang', name: '王小明', active: true }, { id: 'c-a', name: '客戶A', active: true }],
    entitlements: [], visits: [], tasks: [], availability: [], master: master(), ...over,
  });
  const rows = (s) => runHealthCheck(s, TODAY).checks.find((c) => c.id === 'eecpTrialCourse').findings;

  test('接在 CHECKS 最後面', () => {
    assert.equal(CHECKS[CHECKS.length - 1].id, 'eecpTrialCourse');
  });

  test('沒扣額度的兩段 → 一列；按了之後是 EECP、體驗、20 分、狀態不動，那一門刪掉', () => {
    const v1 = { id: 'v1', customerId: 'c-wang', customerName: '王小明', date: '2026-10-20', status: 'confirmed', slots: [trialSlot()] };
    const v2 = { id: 'v2', customerId: 'c-a', customerName: '客戶A', date: '2026-10-08', status: 'done',
      slots: [trialSlot({ status: 'done', attended: true, startsAt: '14:00', endsAt: '14:20' })] };
    const found = rows(snap({ visits: [v1, v2] }));
    assert.equal(found.length, 1);
    const { fix } = found[0];
    assert.equal(fix.kind, 'retireTrialCourse');
    assert.equal(fix.courseId, 'course-eecp-trial');
    const byVisit = Object.fromEntries(fix.visits.map((x) => [x.visitId, x.slots[0]]));
    assert.deepEqual(['courseId', 'courseName', 'giftKind', 'minutes', 'startsAt', 'endsAt', 'status', 'entitlementId'].map((k) => byVisit.v1[k]),
      ['course-eecp', 'EECP', 'trial', 20, '10:00', '10:20', 'confirmed', null]);
    assert.deepEqual([byVisit.v2.status, byVisit.v2.endsAt, byVisit.v2.attended], ['done', '14:20', true]);

    // 再掃一次（那一門刪了、那兩段改好了）→ 這一列消失
    const fixed = [v1, v2].map((v) => ({ ...v, slots: fix.visits.find((x) => x.visitId === v.id).slots }));
    assert.deepEqual(rows(snap({ visits: fixed, master: master(EECP, [{ ...OLD, deletedAt: '2026-10-18T00:00:00Z' }]) })), []);
  });

  test('那門課身上有一筆額度 → 只列、不刪那一門；沒扣額度的段照樣改得了（一位一列）', () => {
    const ent = { id: 'e-old', customerId: 'c-a', type: 'single', label: 'EECP體驗', courseId: 'course-eecp-trial', totalQty: 1 };
    const v1 = { id: 'v1', customerId: 'c-wang', customerName: '王小明', date: '2026-10-20', status: 'confirmed', slots: [trialSlot()] };
    const v2 = { id: 'v2', customerId: 'c-a', customerName: '客戶A', date: '2026-10-21', status: 'confirmed',
      slots: [trialSlot({ entitlementId: 'e-old' })] };
    const found = rows(snap({ visits: [v1, v2], entitlements: [ent] }));
    const blocked = found.filter((f) => !f.fix);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].whoId, 'c-a');
    assert.match(blocked[0].detail, /1 筆額度/);
    const fixable = found.filter((f) => f.fix);
    assert.deepEqual(fixable.map((f) => [f.whoId, f.fix.kind]), [['c-wang', 'trialSlotsToCourse']]);
    assert.ok(!found.some((f) => f.fix?.kind === 'retireTrialCourse'), '那一門不刪');
  });

  test('一段都沒有、也沒有額度 → 一列，只刪那一門', () => {
    const found = rows(snap());
    assert.equal(found.length, 1);
    assert.deepEqual([found[0].fix.kind, found[0].fix.visits], ['retireTrialCourse', []]);
  });

  test('主檔上的 EECP 還沒有「體驗的時候排幾分」→ 只列、先叫她去補那一格', () => {
    const bare = { ...EECP, bookingMinutes: [], trialMinutes: null };
    const v1 = { id: 'v1', customerId: 'c-wang', customerName: '王小明', date: '2026-10-20', status: 'confirmed', slots: [trialSlot()] };
    const found = rows(snap({ visits: [v1], master: master(bare) }));
    assert.equal(found.length, 1);
    assert.equal(found[0].fix, null);
    assert.match(found[0].detail, /主檔有幾格還沒跟上/);
    // 那一格由「主檔有幾格還沒跟上」補：約的時候選時長與體驗排幾分**同一列一起補**（分開按的話課程存不回去）
    const blanks = runHealthCheck(snap({ visits: [v1], master: master(bare) }), TODAY).checks.find((c) => c.id === 'seedBlanks').findings;
    const eecpRow = blanks.find((f) => f.fix?.id === 'course-eecp' && f.fix.changes.bookingMinutes);
    assert.deepEqual(eecpRow.fix.changes, { bookingMinutes: [20, 60], trialMinutes: 20 });
    assert.deepEqual(validate('courses', { ...bare, ...eecpRow.fix.changes }, { existing: SEED.courses }), []);
  });

  test('沒有那一門的資料庫這一列不念', () => {
    assert.deepEqual(rows(snap({ master: MASTER })), []);
  });
});
