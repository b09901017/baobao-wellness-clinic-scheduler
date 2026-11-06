// 一次性客人：「做什麼」那一排、日曆新增、讀取卡片、「約二返」去日曆排（2026-11-05，ADR-0172，`.scratch/one-time-guests/issues/06`）。
//
// 第 4 題：「做什麼」那一排列全部的課（先分類再項目），不扣任何東西；送的／體驗不列；「其他 ▸」留「健檢不是我排的」與「＋ n返」。
// 第 5 題：讀取卡片的名字旁邊標「一次性」；找人的框也標。過目 5：「約二返」的「去壓表」對一次性客人是死路 → 「去日曆排」。
// 畫面那幾條在 E2E `95-one-time-guest-booking`；這裡釘 domain 那一支與各入口接對了沒。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';
import {
  guestOptions, guestPick, guestCourseIdOf, NTH_PICK, NOT_MINE_PICK, giftCourseIdOf, trialFromMinutes, arrangeSlotOptions,
} from '../public/js/domain/slotOptions.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');
const body = (src, start, end = '\n}\n') => {
  const at = src.indexOf(start);
  assert.ok(at >= 0, `找不到 ${start}`);
  return src.slice(at, src.indexOf(end, at));
};

describe('guestOptions()：一次性客人的「做什麼」那一排', () => {
  const alive = COURSES.filter((c) => !c.deletedAt && c.active !== false);

  test('每一門還在用的課一顆（健檢、二返都在），沒有送的／體驗', () => {
    const opts = guestOptions(COURSES).filter((o) => !o.extra);
    assert.deepEqual(new Set(opts.map((o) => o.course.id)), new Set(alive.map((c) => c.id)));
    assert.ok(opts.every((o) => o.isGuest && !o.isGift && o.entitlement === null));
    assert.ok(opts.some((o) => o.course.id === 'course-checkup'));
    assert.ok(opts.some((o) => o.course.id === 'course-followup'));
  });

  test('照分類排（一類的課連在一起），每一顆帶分類', () => {
    const opts = guestOptions(COURSES).filter((o) => !o.extra);
    const groups = opts.map((o) => o.group);
    const seen = [];
    for (const g of groups) if (seen[seen.length - 1] !== g) seen.push(g);
    assert.equal(new Set(seen).size, seen.length, `一類只出現一段：${seen.join(',')}`);
    assert.ok(opts.every((o) => typeof o.group === 'string' && o.group));
  });

  test('「其他 ▸」：健檢不是我排的一定有；＋ n返 只在有接得上的健檢時', () => {
    const none = guestOptions(COURSES).filter((o) => o.extra);
    assert.deepEqual(none.map((o) => o.entitlementId), [NOT_MINE_PICK]);
    const some = guestOptions(COURSES, { nthExams: [{ visitId: 'v1', pickable: true }] }).filter((o) => o.extra);
    assert.deepEqual(some.map((o) => o.entitlementId), [NTH_PICK, NOT_MINE_PICK]);
    const blocked = guestOptions(COURSES, { nthExams: [{ visitId: 'v1', pickable: false }] }).filter((o) => o.extra);
    assert.deepEqual(blocked.map((o) => o.entitlementId), [NOT_MINE_PICK]);
  });

  test('停用的那一門只有這一段現在指著它時列（keep）', () => {
    const courses = COURSES.map((c) => (c.id === 'course-checkup' ? { ...c, active: false } : c));
    assert.ok(!guestOptions(courses).some((o) => o.course?.id === 'course-checkup'));
    const kept = courses.find((c) => c.id === 'course-checkup');
    assert.ok(guestOptions(courses, { keep: kept }).some((o) => o.course?.id === 'course-checkup'));
  });

  test('那一排上的值：guestPick ↔ guestCourseIdOf，跟送的／n返／健檢不是我排的分得開', () => {
    assert.equal(guestCourseIdOf(guestPick('course-checkup')), 'course-checkup');
    for (const v of [NTH_PICK, NOT_MINE_PICK, 'ent-1', null, undefined, '']) assert.equal(guestCourseIdOf(v), null);
    assert.equal(giftCourseIdOf(guestPick('course-checkup')), null, '不會被當成送的／體驗');
    assert.equal(trialFromMinutes({ value: guestPick('course-eecp'), course: COURSES.find((c) => c.id === 'course-eecp') ?? null, minutes: 20, courses: COURSES }), null,
      '按 20 不會把一次性的段換成體驗');
  });

  test('照 guestOptions() 的值組出來的段：一次性、不扣、不是送的／體驗', () => {
    const value = guestPick('course-checkup');
    const { slot } = slotFromPicks({ oneTime: true, courseId: guestCourseIdOf(value), startsAt: '09:00' }, { courses: COURSES });
    assert.equal(slot.oneTime, true);
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.giftKind, null);
  });

  test('一般客戶的那一排（arrangeSlotOptions 的輸入）沒有任何一顆一次性的', () => {
    const arranged = arrangeSlotOptions([], COURSES);
    assert.ok(!arranged.some((o) => o.isGuest));
  });
});

describe('入口接對了沒（掃原始碼）', () => {
  const editor = read('public/js/ui/views/visitEditor.js');
  const calendar = read('public/js/ui/views/calendar.js');
  const home = read('public/js/ui/views/home.js');
  const schedule = read('public/js/ui/views/schedule.js');

  test('來訪編輯器：一次性客人不走「沒有額度 → 預設送的／體驗」（ADR-0121），第一段是還沒選課的一次性的段', () => {
    const fn = body(editor, 'function blankVisit(');
    assert.match(fn, /const guest = isOneTime\(customer\)/);
    assert.match(fn, /const free = first \|\| guest \? null : freeCourseOf\(all\)/);
    assert.match(body(editor, 'function withNewSlot('), /const free = first \|\| guest \? null : freeCourseOf\(all\)/);
  });

  test('來訪編輯器：一次性客人的那一排是 guestOptions()、一次性的段組時段走 slotFromPicks({ oneTime: true })', () => {
    assert.match(body(editor, 'function guestRow('), /guestOptions\(/);
    assert.match(body(editor, 'function readGuestSlot('), /slotFromPicks\(\{\s*oneTime: true,/);
    // 一次性客人的「健檢不是我排的」也標一次性；接在一次性健檢上的 n返 也是
    assert.match(body(editor, 'function readNotMineSlot('), /oneTime: guest,/);
    assert.match(body(editor, 'function readNthSlot('), /isOneTimeExamVisit\(exam, entitlements, coursesById\) \? \{ oneTime: true \}/);
  });

  test('日曆新增：找不到人時那一顆、名字卡走共用的表單、建名字卡是 oneTimeCustomer()（有 key 擋連點）', () => {
    assert.match(body(calendar, 'function pickCustomer('), /data-new-guest/);
    const fn = body(calendar, 'function newGuest(');
    assert.match(fn, /mountGuestForm\(/);
    assert.match(fn, /quick: true/);
    assert.match(fn, /createWithPlan\(oneTimeCustomer\(card\)/);
    assert.match(fn, /key: 'customer:create-guest'/);
  });

  test('讀取卡片：「一次性」畫在 visitReadHtml() 裡（四頁共用），問的是 isOneTime(data.customer)', () => {
    assert.match(body(calendar, 'export function visitReadHtml('), /isOneTime\(data\?\.customer\)/);
  });

  test('找人的框標一次性：要幫誰排？、批次取消、隨手記掛給誰', () => {
    assert.match(body(calendar, 'function pickCustomer('), /isOneTime\(c\)/);
    assert.match(read('public/js/ui/views/bulkCancel.js'), /isOneTime\(c\) \? ' <span class="guestmark">一次性<\/span>'/);
    const note = read('public/js/ui/components/note.js');
    // 掛給誰那一排、長按的「改掛給誰」、打名字跳出客戶那一排（notes-widget 03）
    assert.equal((note.match(/\$\{guestTag\(c\)\}/g) ?? []).length, 3);
  });

  test('「約二返」：一次性客人去日曆新增（leaveFor），日曆那一頁接（takeFor）', () => {
    const fn = body(home, 'async function bookFollowup(');
    assert.ok(fn.indexOf("leaveFor('calendar/new'") > 0 && fn.indexOf("leaveFor('calendar/new'") < fn.indexOf('scheduleView.openFor('));
    assert.match(fn, /isOneTime\(owner\)/);
    assert.match(calendar, /takeFor\('calendar\/new'\)/);
    assert.match(body(home, 'async function labelGuestBookings('), /'去日曆排'/);
  });

  test('壓表：「二返（一次性那一次）」接的健檢問 oneTimeExamChoices()、組時段帶 oneTime', () => {
    assert.match(body(schedule, 'function examChoicesOf('), /picked\?\.isOneTimeSecond[\s\S]*oneTimeExamChoices\(/);
    assert.match(body(schedule, 'async function addSlot('), /oneTime: Boolean\(picked\?\.isOneTimeSecond\)/);
  });
});
