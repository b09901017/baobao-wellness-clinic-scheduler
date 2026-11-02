// 「做什麼」那一排的「健檢不是我排的」那一顆（exam-not-mine 05，ADR-0169）。
//
// 她 11/2：
//
// > 1. 日曆新增時，沒有健檢的客人那顆「＋ n返」要直接出現，還是收起來點開才看得到
// > ans : 收起來點開才看得到
//
// 收合那一顆的字「送的／體驗／其他…」；「健檢不是我排的」在收合裡再收一層「其他 ▸」（她回「可以」）。
// 那一顆只從 `notMineOption()` 一支來（壓表與拍 Abovee 經 `slotOptionsFor()`，來訪編輯器自己組那一排時叫它）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  slotOptionsFor, arrangeSlotOptions, giftOptions, notMineOption, foldOpen, defaultGiftCourse, trialFromMinutes,
  giftCourseIdOf, giftPick, NTH_PICK, NOT_MINE_PICK, EXTRA_GROUP,
} from '../public/js/domain/slotOptions.js';
import { EXAM_NOT_MINE_LABEL } from '../public/js/domain/masterData.js';
import { SEED } from '../public/js/domain/seed.js';
import * as giftFold from '../public/js/ui/components/giftFold.js';

const COURSES = SEED.courses;
const master = { courses: COURSES, equipment: SEED.equipment };

const ent = (id, courseId, label, over = {}) => ({
  id, customerId: 'c1', type: 'single', courseId, label, totalQty: 10, doneCount: 0, bookedCount: 0, ...over,
});
const THREE = [
  ent('e-pool', null, '復能-三選一(60)', { type: 'pool', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], durationMin: 60 }),
  ent('e-ilib', 'course-iv-laser', 'ILIB(60)', { durationMin: 60 }),
];
const options = (entitlements = []) => slotOptionsFor({ entitlements, ...master });

describe('那一顆（notMineOption）', () => {
  test('值、字、旗標：不是額度、不是 n返、不是送的；收在最後一層', () => {
    const o = notMineOption(COURSES);
    assert.equal(o.entitlementId, NOT_MINE_PICK);
    assert.equal(o.label, EXAM_NOT_MINE_LABEL);
    assert.equal(o.label, '健檢不是我排的');
    assert.equal(o.course.id, 'course-followup', '二返那門課');
    assert.equal(o.entitlement, null);
    assert.equal(o.remaining, '—');
    assert.equal(o.isNotMine, true);
    assert.equal(o.folded, true);
    assert.equal(o.extra, true);
    assert.equal(o.isNth, undefined);
    assert.equal(o.isGift, undefined);
  });

  test('值撞不到額度 id、n返、送的／體驗那一種', () => {
    assert.notEqual(NOT_MINE_PICK, NTH_PICK);
    assert.equal(giftCourseIdOf(NOT_MINE_PICK), null);
    assert.match(NOT_MINE_PICK, /^__/, 'Firestore 的自動 id 沒有底線開頭');
  });

  test('二返那門課一門都沒有、或兩門以上：不畫', () => {
    const none = COURSES.map((c) => ({ ...c, followupCourseId: null }));
    assert.equal(notMineOption(none), null);
    assert.ok(!slotOptionsFor({ entitlements: THREE, courses: none, equipment: SEED.equipment }).some((o) => o.isNotMine));

    const two = [...COURSES, { id: 'f2', name: '二返B', category: 'A' }, { id: 'x2', name: '健檢B', followupCourseId: 'f2', category: 'A' }];
    assert.equal(notMineOption(two), null);
  });

  test('二返那門課停用了：不畫', () => {
    const off = COURSES.map((c) => (c.id === 'course-followup' ? { ...c, active: false } : c));
    assert.equal(notMineOption(off), null);
  });

  test('這一段現在就是它（keep）：二返那門課停用了照樣列，那一排才有一顆按著（來訪編輯器，06）', () => {
    const off = COURSES.map((c) => (c.id === 'course-followup' ? { ...c, active: false } : c));
    const kept = notMineOption(off, { keep: off.find((c) => c.id === 'course-followup') });
    assert.equal(kept.entitlementId, NOT_MINE_PICK);
    assert.equal(kept.course.id, 'course-followup');
  });
});

describe('那一排（slotOptionsFor／arrangeSlotOptions）', () => {
  test('一般的客人：上面那一排一顆都沒多，「健檢不是我排的」是收合裡的最後一顆', () => {
    const out = options(THREE);
    assert.ok(out.filter((o) => !o.folded).every((o) => !o.isNotMine));
    assert.equal(out.at(-1).isNotMine, true);
    assert.equal(out.at(-1).group, EXTRA_GROUP);
    assert.equal(out.filter((o) => o.isNotMine).length, 1);
  });

  test('沒有任何額度與健檢的客人（她真的要用的那種）：照樣只在收合裡', () => {
    const out = options([]);
    assert.ok(out.every((o) => o.folded), '上面那一排是空的');
    assert.equal(out.at(-1).isNotMine, true);
    assert.ok(!out.some((o) => o.isNth), '沒有健檢 → 沒有「＋ n返」');
  });

  test('來訪編輯器的組法（額度＋giftOptions()＋notMineOption()）跟壓表排出來一樣，不管主檔的順序', () => {
    const board = options(THREE);
    const editor = arrangeSlotOptions([
      notMineOption(COURSES.slice().reverse()),
      ...giftOptions(COURSES.slice().reverse()),
      ...THREE.map((e) => ({ entitlementId: e.id, label: e.label, entitlement: e, remaining: 10,
        course: board.find((o) => o.entitlementId === e.id).course })),
    ], COURSES);
    assert.deepEqual(editor.map((o) => o.entitlementId), board.map((o) => o.entitlementId));
  });

  test('不被當成送的／體驗：defaultGiftCourse() 照舊功醫門診', () => {
    assert.equal(defaultGiftCourse(COURSES).id, 'course-fm');
  });
});

describe('foldOpen()：既有的判斷不動，多認那一顆', () => {
  test('有剩的額度、沒選：照舊收著', () => {
    assert.equal(foldOpen(options(THREE), null), false);
    assert.equal(foldOpen(options(THREE), 'e-pool'), false);
  });

  test('什麼都沒買：照舊展開', () => {
    assert.equal(foldOpen(options([]), null), true);
  });

  test('這一段選著「健檢不是我排的」：展開', () => {
    assert.equal(foldOpen(options(THREE), NOT_MINE_PICK), true);
  });
});

describe('「排多久」按了不會換成體驗（trialFromMinutes）', () => {
  test('選著那一顆：不換', () => {
    const course = COURSES.find((c) => c.id === 'course-followup');
    assert.equal(trialFromMinutes({ value: NOT_MINE_PICK, course, minutes: 20, courses: COURSES }), null);
  });
});

describe('畫法：收合裡再收一層「其他 ▸」', () => {
  const chip = (o) => `<button data-x="${o.entitlementId}">${o.label}</button>`;
  const html = (opts, value, open = true) => giftFold.html({ options: opts, value, open, chip });

  test('「其他」是一顆分類鈕（data-giftfold-group），那一顆在它的那一層裡、預設藏著', () => {
    const out = html(options(THREE), null);
    assert.match(out, /data-giftfold-group="extra"[^>]*>其他<span class="chip__note">▸<\/span>/);
    const at = out.indexOf(`data-x="${NOT_MINE_PICK}"`);
    const box = out.lastIndexOf('<div data-giftfold-in=', at);
    assert.match(out.slice(box, box + 60), /^<div data-giftfold-in="extra" hidden>/);
  });

  test('不會被併進「醫師門診 ▾」（二返那門課的分類）', () => {
    const out = html(options(THREE), null);
    const at = out.indexOf(`data-x="${NOT_MINE_PICK}"`);
    const box = out.lastIndexOf('<div data-giftfold-in=', at);
    assert.doesNotMatch(out.slice(box, at), /data-giftfold-in="\d+"/);
  });

  test('這一段選著它：那一層一打開就是開的、「其他」是按下去的樣子', () => {
    const out = html(options(THREE), NOT_MINE_PICK);
    assert.match(out, /data-giftfold-group="extra"\s+aria-pressed="true"/);
    assert.match(out, /<div data-giftfold-in="extra">/);
  });

  test('收著而且選著它：開關寫「健檢不是我排的」、按下去的樣子', () => {
    const out = html(options(THREE), NOT_MINE_PICK, false);
    const btn = out.match(/<button[^>]*data-giftfold-more[\s\S]*?<\/button>/)[0];
    assert.match(btn, /健檢不是我排的<span class="chip__note">送的／體驗／其他 ▸<\/span>/);
    assert.match(btn, /aria-pressed="true"/);
  });

  test('選著別的課當體驗：「其他」那一層照舊藏著', () => {
    const out = html(options(THREE), giftPick('course-rehab'));
    assert.match(out, /<div data-giftfold-in="extra" hidden>/);
  });

  test('二返那門課不是剛好一門：沒有「其他」那一顆', () => {
    const none = COURSES.map((c) => ({ ...c, followupCourseId: null }));
    const out = html(slotOptionsFor({ entitlements: THREE, courses: none, equipment: SEED.equipment }), null);
    assert.doesNotMatch(out, /data-giftfold-group="extra"/);
  });
});
