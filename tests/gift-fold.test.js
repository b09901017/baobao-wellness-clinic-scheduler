// 「做什麼」那一排：送的／體驗收進最後一顆，按了才展開（gift-and-trial 04）。
//
// 她的原話：
//
// > 然後我希望這種不算次數的，在壓表或是新增來訪那邊可以先預設不出現先收合或是擺到底下，畢竟不常用
//
// 「這一排有哪幾顆、哪幾顆收起來、什麼順序、要不要一打開就展開」只在 `domain/slotOptions.js`，
// 三個入口（壓表、來訪編輯器、拍 Abovee）不各自判斷；畫法只在 `ui/components/giftFold.js`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  slotOptionsFor, arrangeSlotOptions, giftOptions, foldOpen, defaultGiftCourse, giftPick, NTH_PICK, FOLLOWUP_GROUP,
} from '../public/js/domain/slotOptions.js';
import { SEED } from '../public/js/domain/seed.js';
import * as giftFold from '../public/js/ui/components/giftFold.js';

// 05 之後的種子：心臟科評估、EECP體驗 也不算次數。這一支先自己勾，05 之前就驗得到順序
const COURSES = SEED.courses.map((c) => (['course-cardio', 'course-eecp-trial'].includes(c.id) ? { ...c, uncounted: true } : c));
const master = { courses: COURSES, equipment: SEED.equipment };

const ent = (id, courseId, label, over = {}) => ({
  id, customerId: 'c1', type: 'single', courseId, label,
  totalQty: 10, doneCount: 0, bookedCount: 0, ...over,
});

const THREE = [
  ent('e-pool', null, '復能-三選一(60)', {
    type: 'pool', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], durationMin: 60,
  }),
  ent('e-ilib', 'course-iv-laser', 'ILIB(60)', { durationMin: 60 }),
  ent('e-inbody', 'course-inbody', '身體組成分析', { totalQty: 2 }),
];

const options = (entitlements = [], o) => slotOptionsFor({ entitlements, ...master }, o);
const shuffled = (list) => list.slice().reverse();

describe('收起來的是哪幾顆', () => {
  test('三筆額度的客戶：沒收起來的只有那三顆；送的／體驗全部在最後', () => {
    const out = options(THREE);
    const shown = out.filter((o) => !o.folded);
    assert.deepEqual(shown.map((o) => o.label), ['復能-三選一(60)', 'ILIB(60)', '身體組成分析']);
    const firstFolded = out.findIndex((o) => o.folded);
    assert.equal(firstFolded, 3);
    assert.ok(out.slice(firstFolded).every((o) => o.folded && o.isGift && o.entitlement === null));
  });

  test('展開之後第一排：功醫門診 → HRV → 心臟科評估 → EECP體驗（她最常按的那幾門）', () => {
    const first = options(THREE).filter((o) => o.folded && !o.other);
    assert.deepEqual(first.map((o) => o.label), ['功醫門診', 'HRV', '心臟科評估', 'EECP體驗']);
  });

  test('「別的課當體驗」：每一門還在用的課，健檢與二返不列、不算次數的那幾門不重複', () => {
    const others = options(THREE).filter((o) => o.other);
    const ids = others.map((o) => o.course.id);
    assert.ok(ids.includes('course-recovery'));
    assert.ok(ids.includes('course-rehab'));
    assert.ok(!ids.includes('course-checkup'), '健檢牽著二返那條線');
    assert.ok(!ids.includes('course-followup'), '二返也是');
    assert.ok(!ids.includes('course-fm'), '功醫門診在第一排了');
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(others.every((o) => o.entitlementId === giftPick(o.course.id)));
  });

  test('「別的課當體驗」照分類排（加購那一排的順序）', () => {
    const groups = [...new Set(options(THREE).filter((o) => o.other).map((o) => o.group))];
    assert.deepEqual(groups, ['復能', 'ILIB', '醫師門診', 'EECP', '運動區', '營養點滴', '其他']);
  });

  test('停用的課不列；這一段現在指著的那一門停用了照樣列（keep）', () => {
    const off = COURSES.map((c) => (c.id === 'course-rehab' ? { ...c, active: false } : c));
    assert.ok(!giftOptions(off).some((o) => o.course.id === 'course-rehab'));
    const rehab = off.find((c) => c.id === 'course-rehab');
    assert.ok(giftOptions(off, { keep: rehab }).some((o) => o.course.id === 'course-rehab'));
  });

  test('二返那一組照舊另起一行、排在收起來的那幾顆前面', () => {
    const out = options([
      ...THREE,
      ent('e-chk', 'course-checkup', '8萬健檢', { totalQty: 1 }),
      ent('e-fu', 'course-followup', '二返(8萬健檢)', { totalQty: 1, followupForEntitlementId: 'e-chk' }),
    ]);
    const shown = out.filter((o) => !o.folded);
    assert.equal(shown.at(-1).group, FOLLOWUP_GROUP);
    assert.equal(shown.at(-1).breakBefore, true);
    assert.ok(out.filter((o) => o.folded).every((o) => o.breakBefore === false));
  });
});

describe('順序跟主檔讀回來的順序無關', () => {
  test('主檔倒過來排：三個入口拿到的順序一模一樣', () => {
    const a = slotOptionsFor({ entitlements: THREE, ...master }).map((o) => o.entitlementId);
    const b = slotOptionsFor({ entitlements: THREE, courses: shuffled(COURSES), equipment: SEED.equipment })
      .map((o) => o.entitlementId);
    assert.deepEqual(b, a);
  });

  test('沒有額度的客戶新的一段預設功醫門診 —— 主檔照文件 id 排時心臟科評估在前面也一樣', () => {
    const byDocId = COURSES.slice().sort((x, y) => x.id.localeCompare(y.id));
    assert.equal(byDocId.findIndex((c) => c.id === 'course-cardio') < byDocId.findIndex((c) => c.id === 'course-fm'), true);
    assert.equal(defaultGiftCourse(byDocId).id, 'course-fm');
    assert.equal(defaultGiftCourse(COURSES).id, 'course-fm');
  });

  test('一門不算次數的課都沒有：沒有預設', () => {
    assert.equal(defaultGiftCourse(COURSES.map((c) => ({ ...c, uncounted: false }))), null);
  });

  test('來訪編輯器的組法（自己的額度＋giftOptions()）排出來跟壓表一樣', () => {
    const board = options(THREE);
    const editor = arrangeSlotOptions([
      ...THREE.slice().reverse().map((e) => ({
        entitlementId: e.id, label: e.label, entitlement: e, remaining: 10,
        course: board.find((o) => o.entitlementId === e.id).course,
      })),
      ...giftOptions(shuffled(COURSES)),
    ], COURSES);
    assert.deepEqual(editor.map((o) => o.entitlementId), board.map((o) => o.entitlementId));
  });
});

describe('一打開就展開嗎（foldOpen）', () => {
  test('有一筆還有剩的額度：收著', () => {
    assert.equal(foldOpen(options(THREE), 'e-pool'), false);
    assert.equal(foldOpen(options(THREE), null), false);
  });

  test('什麼都沒買：展開（不然上面那一排是空的）', () => {
    assert.equal(foldOpen(options([]), null), true);
  });

  test('拍 Abovee 列的用完那幾顆不算「有剩」', () => {
    const used = [ent('e-used', 'course-rehab', '復健科醫師門診', { totalQty: 1, doneCount: 1 })];
    const out = options(used, { includeUsedUp: true });
    assert.ok(out.some((o) => o.entitlementId === 'e-used'));
    assert.equal(foldOpen(out, 'e-used'), true);
  });

  test('只剩 n返 那一顆：展開（n返 不是額度）', () => {
    assert.equal(foldOpen([{ entitlementId: NTH_PICK, entitlement: null, remaining: '—', isNth: true }], null), true);
  });

  test('這一段現在就是送的／體驗：展開', () => {
    assert.equal(foldOpen(options(THREE), giftPick('course-fm')), true);
    assert.equal(foldOpen(options(THREE), giftPick('course-recovery')), true);
  });
});

describe('畫法（ui/components/giftFold.js）', () => {
  const chip = (o) => `<button data-x="${o.entitlementId}">${o.label}</button>`;
  const html = (opts, value, open = foldOpen(opts, value)) => giftFold.html({ options: opts, value, open, chip });

  test('收著：最後一顆「送的／體驗…」，那一組帶 closed', () => {
    const out = html(options(THREE), null);
    assert.match(out, /data-giftfold="closed"/);
    assert.match(out, /data-giftfold-more[^>]*>送的／體驗…/);
  });

  test('展開：帶 open；第一排不算次數的課、底下「別的課當體驗」', () => {
    const out = html(options([]), null);
    assert.match(out, /data-giftfold="open"/);
    assert.ok(out.indexOf('功醫門診') < out.indexOf('別的課當體驗'));
  });

  test('「別的課當體驗」：一類只有一門的直接是那一門；兩門以上是一顆分類，按了才露出那幾門', () => {
    const out = html(options([]), null);
    assert.match(out, /data-x="__course__:course-recovery"/, '復能那一類只有一門 → 直接是那一門');
    assert.match(out, /data-giftfold-group="[^"]+"[^>]*>\s*醫師門診/);
    assert.match(out, /<div data-giftfold-in="[^"]+" hidden>/);
  });

  test('選著「別的課當體驗」裡的一門：它那一類一打開就是露出來的', () => {
    const value = giftPick('course-rehab');
    const out = html(options(THREE), value);
    const at = out.indexOf('data-x="__course__:course-rehab"');
    const box = out.lastIndexOf('data-giftfold-in', at);
    assert.ok(box > 0);
    assert.doesNotMatch(out.slice(box, at), /hidden/);
  });

  test('沒有任何送的／體驗那一顆時（主檔一門課都沒有）只畫上面那一排', () => {
    const out = giftFold.html({ options: options(THREE).filter((o) => !o.folded), value: null, open: false, chip });
    assert.doesNotMatch(out, /data-giftfold/);
  });
});

describe('三個入口都畫同一支', () => {
  const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8');

  test('壓表、來訪編輯器、拍 Abovee 都走 giftFold.html() 與 foldOpen()', () => {
    for (const rel of ['ui/views/schedule.js', 'ui/views/visitEditor.js', 'ui/components/aboveeConfirm.js']) {
      const src = read(rel);
      assert.match(src, /giftFold\.html\(/, `${rel} 要畫同一支`);
      assert.match(src, /foldOpen\(/, `${rel} 要問同一支要不要展開`);
      assert.match(src, /giftFold\.toggle/, `${rel} 要接展開那一顆`);
    }
  });

  test('來訪編輯器的送的／體驗那幾顆來自 giftOptions()，不自己列', () => {
    const src = read('ui/views/visitEditor.js');
    assert.match(src, /giftOptions\(/);
    assert.doesNotMatch(src, /uncountedCourses\(/);
  });

  test('三個入口都畫得出「體驗｜送的」那一排', () => {
    assert.match(read('ui/views/schedule.js'), /data-giftkind/);
    assert.match(read('ui/views/visitEditor.js'), /-gift`/);
    assert.match(read('ui/components/aboveeConfirm.js'), /data-abl-gift/);
  });

  test('新檔進了 sw.js 的 SHELL', () => {
    assert.match(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), /components\/giftFold\.js/);
  });
});
