// 設定 → 課程 → 編輯：「排班時要指派」四選一（2026-10-06，issue 06，ADR-0130）。
//
// 她的原話：
//
// > 5. 排班時要指派的分四種，診間，物理治療師，醫師，都不用
// > 然後我希望選了診間後才會顯示可用診間類型以及只能排在這幾間
// > 選了醫師才顯示來訪時選醫師
//
// 問她「有沒有一門課同時要選診間又要選醫師？」，她回「目前沒有」。
//
// **資料上照舊是兩格**（`assigns`、`doctorPick`）—— 排班那一側一個字都不改。
// 這一支盯的是那一排與兩格之間的對照（只寫在 `masterData.js`），以及
// 「舊課程打開、什麼都不改就存」時每一門種子課程讀回來的兩格一模一樣。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSIGN_KINDS, ASSIGN_KIND_LABELS, assignKindOf, assignFieldsFor, keepsDoctorBeside,
  assignSummaryOf, doctorRuleOf, picksDoctor, DOCTOR_ANY, DOCTOR_NONE, validate,
} from '../public/js/domain/masterData.js';
import { SEED } from '../public/js/domain/seed.js';

const course = (extra = {}) => ({
  id: 'c', name: 'c', durationMin: 30, category: null, assigns: 'none',
  allowedRoomTypes: [], allowedRoomIds: [], ...extra,
});

describe('那一排有哪四顆', () => {
  test('照她講的順序：診間、物理治療師、醫師、都不用', () => {
    assert.deepEqual(ASSIGN_KINDS, ['room', 'therapist', 'doctor', 'none']);
    assert.deepEqual(ASSIGN_KINDS.map((k) => ASSIGN_KIND_LABELS[k]), ['診間', '物理治療師', '醫師', '都不用']);
  });
});

describe('讀回來：一門課亮哪一顆', () => {
  test('assigns 是診間或治療師就是那一顆', () => {
    assert.equal(assignKindOf(course({ assigns: 'room' })), 'room');
    assert.equal(assignKindOf(course({ assigns: 'therapist' })), 'therapist');
  });

  test('不指派、要醫師（照 doctorRuleOf()：選過的、或門診的退路）就是醫師', () => {
    assert.equal(assignKindOf(course({ doctorPick: '復健科' })), 'doctor');
    assert.equal(assignKindOf(course({ doctorPick: DOCTOR_ANY })), 'doctor');
    assert.equal(assignKindOf(course({ category: 'A' })), 'doctor', 'ADR-0058：門診沒選過也選得到醫師');
    assert.equal(assignKindOf(course({ requiresDoctor: true })), 'doctor');
  });

  test('兩個都沒有就是都不用', () => {
    assert.equal(assignKindOf(course()), 'none');
    assert.equal(assignKindOf(course({ category: 'A', doctorPick: DOCTOR_NONE })), 'none');
  });

  test('兩個都有（舊資料存得下去）：亮 assigns 那一顆，另外標出來', () => {
    const both = course({ assigns: 'room', allowedRoomTypes: ['治療室'], doctorPick: DOCTOR_ANY });
    assert.equal(assignKindOf(both), 'room');
    assert.equal(keepsDoctorBeside(both), true);
    assert.equal(keepsDoctorBeside(course({ assigns: 'room', allowedRoomTypes: ['治療室'] })), false);
    assert.equal(keepsDoctorBeside(course({ doctorPick: DOCTOR_ANY })), false, '只有醫師不算兩個都有');
  });
});

describe('存下去：那一顆 → 兩格', () => {
  test('診間／治療師：不要醫師', () => {
    assert.deepEqual(assignFieldsFor('room', DOCTOR_ANY),
      { assigns: 'room', doctorPick: DOCTOR_NONE, requiresDoctor: false });
    assert.deepEqual(assignFieldsFor('therapist', '復健科'),
      { assigns: 'therapist', doctorPick: DOCTOR_NONE, requiresDoctor: false });
  });

  test('醫師：不指派，哪一科照醫師那一排', () => {
    assert.deepEqual(assignFieldsFor('doctor', '心臟科'),
      { assigns: 'none', doctorPick: '心臟科', requiresDoctor: true });
    assert.deepEqual(assignFieldsFor('doctor', DOCTOR_ANY),
      { assigns: 'none', doctorPick: DOCTOR_ANY, requiresDoctor: true });
  });

  test('醫師那一排還是「不用」（從都不用切過來）：存成哪一科都可以 —— 不會變成一門不要醫師的「醫師」課', () => {
    assert.deepEqual(assignFieldsFor('doctor', DOCTOR_NONE),
      { assigns: 'none', doctorPick: DOCTOR_ANY, requiresDoctor: true });
    assert.deepEqual(assignFieldsFor('doctor', ''),
      { assigns: 'none', doctorPick: DOCTOR_ANY, requiresDoctor: true });
  });

  test('都不用：兩格都沒有', () => {
    assert.deepEqual(assignFieldsFor('none', '復健科'),
      { assigns: 'none', doctorPick: DOCTOR_NONE, requiresDoctor: false });
  });

  test('兩個都有、她沒動那一排：照舊存回去', () => {
    assert.deepEqual(assignFieldsFor('room', DOCTOR_ANY, { keepDoctor: true }),
      { assigns: 'room', doctorPick: DOCTOR_ANY, requiresDoctor: true });
    // 都不用與醫師沒有「兩個都有」這件事
    assert.deepEqual(assignFieldsFor('none', DOCTOR_ANY, { keepDoctor: true }),
      { assigns: 'none', doctorPick: DOCTOR_NONE, requiresDoctor: false });
  });

  test('認不得的值：不指派也不要醫師（驗證照舊接得住）', () => {
    assert.deepEqual(assignFieldsFor(undefined, DOCTOR_ANY),
      { assigns: 'none', doctorPick: DOCTOR_NONE, requiresDoctor: false });
  });
});

describe('種子每一門課：打開、什麼都不改就存，兩格讀回來一模一樣', () => {
  for (const c of SEED.courses) {
    test(c.name, () => {
      const kind = assignKindOf(c);
      const saved = { ...c, ...assignFieldsFor(kind, doctorRuleOf(c), { keepDoctor: keepsDoctorBeside(c) }) };
      assert.equal(saved.assigns, c.assigns, 'assigns');
      assert.equal(doctorRuleOf(saved), doctorRuleOf(c), '要不要醫師、哪一科');
      assert.equal(picksDoctor(saved), picksDoctor(c));
      assert.deepEqual(validate('courses', saved, { existing: SEED.courses }), [], '存得下去');
    });
  }
});

describe('清單上那一行（跟表單亮著的那一顆講同一件事）', () => {
  test('四種', () => {
    assert.equal(assignSummaryOf(course({ assigns: 'room', allowedRoomTypes: ['治療室'] })), '選診間');
    assert.equal(assignSummaryOf(course({ assigns: 'therapist' })), '選治療師');
    assert.equal(assignSummaryOf(course({ doctorPick: DOCTOR_ANY })), '選醫師');
    assert.equal(assignSummaryOf(course()), '都不用');
  });

  test('醫師的課以前印「都不用」—— 跟表單亮著的「醫師」對不上', () => {
    const rehab = SEED.courses.find((c) => c.id === 'course-rehab');
    assert.equal(rehab.assigns, 'none');
    assert.equal(assignSummaryOf(rehab), '選醫師（復健科）');
  });

  test('兩個都有：兩個都講', () => {
    assert.equal(assignSummaryOf(course({ assigns: 'room', allowedRoomTypes: ['治療室'], doctorPick: DOCTOR_ANY })),
      '選診間＋醫師');
  });
});
