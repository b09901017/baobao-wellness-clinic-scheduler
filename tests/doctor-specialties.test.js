// 醫師分科、課程指定要哪一科的醫師（2026-10-05，issue 04，ADR-0120）。
//
// 她的原話：
//
// > 四、醫師要分科：功能／二返、泌尿科、心臟科、復健科。物理治療師是另一種人（操作復能機器的）。
// > 每個課程都要可以自己選：…哪一科的醫師…
// > 羊膜：…選復健科醫師（只有一位）…
//
// 三件事：
//
//   1. **沒有 `doctorPick` 的課程照舊**（ADR-0058 的退回留著）
//   2. 指定一科是**排序不是限制** —— 那一科排前面、其餘收在「其他醫師」後面
//   3. 那一科剛好一位時先選好他；兩位以上一個都不預選

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validate, staffWithRole, THERAPIST_ROLE, DOCTOR_ROLE,
  picksDoctor, doctorRuleOf, doctorChoicesFor, specialtyNames,
  DEFAULT_SPECIALTIES, DOCTOR_NONE, DOCTOR_ANY,
  courseDefaultsFor,
} from '../public/js/domain/masterData.js';
import { SEED } from '../public/js/domain/seed.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import { fieldLabel } from '../public/js/domain/audit.js';

const REHAB = '復健科';
const CARDIO = '心臟科';

const STAFF = [
  { id: 't1', name: '治療師甲', role: THERAPIST_ROLE },
  { id: 'd1', name: '醫師甲', role: DOCTOR_ROLE, specialties: [REHAB] },
  { id: 'd2', name: '醫師乙', role: DOCTOR_ROLE, specialties: [CARDIO, '功能／二返'] },
  { id: 'd3', name: '醫師丙', role: DOCTOR_ROLE },
  { id: 'd4', name: '離職的醫師', role: DOCTOR_ROLE, specialties: [REHAB], active: false },
];

describe('舊資料：沒有 doctorPick 的課程照舊（ADR-0058）', () => {
  // 2026-10-05 之前 `picksDoctor()` 就是這一行
  const old = (course) => course?.category === 'A' || Boolean(course?.requiresDoctor);

  test('A 類一律選得到；非 A 沒開旗標的選不到；開了旗標的選得到', () => {
    const cases = [
      { category: 'A' }, { category: 'A', requiresDoctor: false },
      { category: 'B' }, { category: 'C' }, { category: null },
      { category: 'C', requiresDoctor: true }, { category: null, requiresDoctor: true },
      {}, null, undefined,
    ];
    for (const c of cases) {
      assert.equal(picksDoctor(c), old(c), JSON.stringify(c));
      assert.equal(doctorRuleOf(c), old(c) ? DOCTOR_ANY : DOCTOR_NONE, JSON.stringify(c));
    }
  });

  test('每一門種子課程：拿掉 doctorPick 之後選不選得到醫師一個都沒變', () => {
    for (const c of SEED.courses) {
      const { doctorPick, ...bare } = c;
      assert.equal(picksDoctor(c), old(bare), c.name);
    }
  });

  test('空白的 doctorPick 不算填過', () => {
    assert.equal(doctorRuleOf({ category: 'A', doctorPick: '' }), DOCTOR_ANY);
    assert.equal(doctorRuleOf({ category: 'C', doctorPick: '  ' }), DOCTOR_NONE);
    assert.equal(doctorRuleOf({ category: 'C', doctorPick: null }), DOCTOR_NONE);
  });
});

describe('課程上那一格（doctorPick）', () => {
  test('三種答案：不用／哪一科都可以／某一科', () => {
    assert.equal(doctorRuleOf({ doctorPick: 'none' }), DOCTOR_NONE);
    assert.equal(doctorRuleOf({ doctorPick: 'any' }), DOCTOR_ANY);
    assert.equal(doctorRuleOf({ doctorPick: REHAB }), REHAB);
    assert.equal(picksDoctor({ doctorPick: 'none' }), false);
    assert.equal(picksDoctor({ doctorPick: 'any' }), true);
    assert.equal(picksDoctor({ doctorPick: REHAB }), true);
  });

  test('填了的蓋過類別與旗標：A 類也關得掉、C 類也開得了', () => {
    assert.equal(picksDoctor({ category: 'A', requiresDoctor: true, doctorPick: 'none' }), false);
    assert.equal(picksDoctor({ category: 'C', doctorPick: CARDIO }), true);
  });

  test('驗證：字串、不空白、最多 12 字', () => {
    const ok = { name: '新課', durationMin: 30, category: 'C', assigns: 'none' };
    assert.deepEqual(validate('courses', { ...ok }), []);
    for (const doctorPick of ['none', 'any', REHAB]) {
      assert.deepEqual(validate('courses', { ...ok, doctorPick }), [], doctorPick);
    }
    assert.ok(validate('courses', { ...ok, doctorPick: 3 }).length);
    assert.ok(validate('courses', { ...ok, doctorPick: '一二三四五六七八九十一二三' }).length);
  });

  test('種子：二返是功能／二返、復健科醫師門診是復健科、心臟科評估是心臟科', () => {
    const by = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));
    assert.equal(doctorRuleOf(by['course-followup']), '功能／二返');
    assert.equal(doctorRuleOf(by['course-rehab']), REHAB);
    assert.equal(doctorRuleOf(by['course-cardio']), CARDIO);
    for (const id of ['course-recovery', 'course-checkup', 'course-iv-drip', 'course-inbody']) {
      assert.equal(doctorRuleOf(by[id]), DOCTOR_NONE, id);
    }
  });

  test('種子醫師不填科別 —— 她還沒說誰是哪一科', () => {
    for (const s of SEED.staff) assert.ok(!(s.specialties ?? []).length, s.name);
  });

  test('醫師門診那一組新增時是「哪一科都可以」', () => {
    assert.equal(courseDefaultsFor('醫師門診').doctorPick, DOCTOR_ANY);
    assert.equal(doctorRuleOf(courseDefaultsFor('復能')), DOCTOR_NONE);
  });
});

describe('醫師的科別（specialties）', () => {
  test('預設四科', () => {
    assert.deepEqual(DEFAULT_SPECIALTIES, ['功能／二返', '泌尿科', '心臟科', '復健科']);
  });

  test('可以勾不只一科；沒有這一格 = 空的', () => {
    assert.deepEqual(validate('staff', { name: '夏', role: DOCTOR_ROLE }), []);
    assert.deepEqual(validate('staff', { name: '夏', role: DOCTOR_ROLE, specialties: [REHAB, CARDIO] }), []);
  });

  test('物理治療師沒有科別 —— 硬塞一個進去存不下去', () => {
    const errors = validate('staff', { name: '騰崴', role: THERAPIST_ROLE, specialties: [REHAB] });
    assert.ok(errors.some((e) => e.includes('科別')), errors.join());
    assert.deepEqual(validate('staff', { name: '騰崴', role: THERAPIST_ROLE, specialties: [] }), []);
  });

  test('格式：要是陣列、不可空白、每一科最多 12 字', () => {
    assert.ok(validate('staff', { name: '夏', role: DOCTOR_ROLE, specialties: REHAB }).length);
    assert.ok(validate('staff', { name: '夏', role: DOCTOR_ROLE, specialties: [' '] }).length);
    assert.ok(validate('staff', { name: '夏', role: DOCTOR_ROLE, specialties: ['一二三四五六七八九十一二三'] }).length);
  });

  test('名單＝預設四科＋大家身上已經有的字（不是一份新的主檔）', () => {
    assert.deepEqual(specialtyNames([]), DEFAULT_SPECIALTIES);
    assert.deepEqual(
      specialtyNames([
        { role: DOCTOR_ROLE, specialties: ['神經內科', REHAB] },
        { role: DOCTOR_ROLE, specialties: ['神經內科', '皮膚科'] },
        { role: DOCTOR_ROLE, specialties: ['刪掉的那一科'], deletedAt: 'x' },
      ]),
      [...DEFAULT_SPECIALTIES, '神經內科', '皮膚科'],
    );
  });
});

describe('醫師那一排怎麼排（doctorChoicesFor）', () => {
  const ids = (rows) => rows.map((r) => r.id);

  test('指定復健科、只有一位：先選好他，其他醫師收在後面、點得到', () => {
    const out = doctorChoicesFor({ doctorPick: REHAB }, STAFF);
    assert.deepEqual(ids(out.first), ['d1']);
    assert.deepEqual(ids(out.others), ['d2', 'd3']);
    assert.equal(out.preselect, 'd1');
  });

  test('那一科有兩位：一個都不預選，兩位排在最前面', () => {
    const staff = [...STAFF, { id: 'd5', name: '醫師戊', role: DOCTOR_ROLE, specialties: [REHAB] }];
    const out = doctorChoicesFor({ doctorPick: REHAB }, staff);
    assert.deepEqual(ids(out.first), ['d1', 'd5']);
    assert.equal(out.preselect, null);
    assert.deepEqual(ids(out.others), ['d2', 'd3']);
  });

  test('一位醫師勾兩科：兩門不同科的課都把他排在前面', () => {
    assert.deepEqual(ids(doctorChoicesFor({ doctorPick: CARDIO }, STAFF).first), ['d2']);
    assert.deepEqual(ids(doctorChoicesFor({ doctorPick: '功能／二返' }, STAFF).first), ['d2']);
  });

  test('哪一科都可以：全部照主檔順序，不分前後、不預選', () => {
    const out = doctorChoicesFor({ doctorPick: 'any' }, STAFF);
    assert.deepEqual(ids(out.first), ['d1', 'd2', 'd3']);
    assert.deepEqual(out.others, []);
    assert.equal(out.preselect, null);
    // 舊課程（A 類、沒有 doctorPick）也是這一種
    assert.deepEqual(ids(doctorChoicesFor({ category: 'A' }, STAFF).first), ['d1', 'd2', 'd3']);
  });

  test('那一科一位都沒有（她還沒填科別）：退回全部列出來，不預選', () => {
    const out = doctorChoicesFor({ doctorPick: '泌尿科' }, STAFF);
    assert.deepEqual(ids(out.first), ['d1', 'd2', 'd3']);
    assert.deepEqual(out.others, []);
    assert.equal(out.preselect, null);
  });

  test('不用醫師的課：一位都不列', () => {
    assert.deepEqual(doctorChoicesFor({ doctorPick: 'none' }, STAFF), { first: [], others: [], preselect: null });
    assert.deepEqual(doctorChoicesFor({ category: 'C' }, STAFF), { first: [], others: [], preselect: null });
  });

  test('停用的、刪掉的、物理治療師都不在這一排（走 staffWithRole）', () => {
    const out = doctorChoicesFor({ doctorPick: REHAB }, STAFF);
    const shown = [...out.first, ...out.others];
    assert.ok(!shown.some((s) => s.role !== DOCTOR_ROLE || s.active === false));
    assert.deepEqual(ids(shown).sort(), ids(staffWithRole(STAFF, DOCTOR_ROLE)).sort());
  });

  test('它是排序不是限制：代診那天選別科的醫師，組得出那一段', () => {
    const course = { id: 'amnion', name: '羊膜', durationMin: 30, assigns: 'none', doctorPick: REHAB };
    const ent = { id: 'e1', type: 'single', courseId: 'amnion', totalQty: 3 };
    const { slot, errors } = slotFromPicks(
      { entitlementId: 'e1', startsAt: '10:00', doctorId: 'd2' },
      { courses: [course], equipment: [], entitlements: [ent], visits: [] },
    );
    assert.deepEqual(errors, []);
    assert.equal(slot.doctorId, 'd2');
  });
});

describe('三個入口都走 doctorChoicesFor()', () => {
  const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8');

  for (const rel of ['ui/views/schedule.js', 'ui/views/visitEditor.js', 'ui/components/aboveeConfirm.js']) {
    test(`${rel} 的醫師那一排`, () => {
      const src = read(rel);
      assert.match(src, /doctorChoicesFor\(/, '排法只有一支，三個入口共用');
      assert.ok(!/staffWithRole\([^)]*DOCTOR_ROLE\)/.test(src),
        '不可以自己拿全部醫師排一次 —— 那一科就排不到前面');
    });
  }

  test('物理治療師那一排一個字都不動（選錯人是實際傷害）', () => {
    for (const rel of ['ui/views/schedule.js', 'ui/views/visitEditor.js', 'ui/components/aboveeConfirm.js']) {
      assert.match(read(rel), /staffWithRole\([^)]*THERAPIST_ROLE\)/);
    }
  });
});

describe('稽核不印英文欄位名', () => {
  test('doctorPick、specialties', () => {
    assert.equal(fieldLabel('doctorPick'), '要哪一科的醫師');
    assert.equal(fieldLabel('specialties'), '科別');
  });
});
