// 一段來訪在畫面上要唸成什麼（`domain/naming.js`）。
//
// 她 2026-09-06：「日曆以及要通知客戶的 line 草稿等等，就是要寫特定哪一項，
// 而不是說甚麼三選一四選一，而是特定什麼可以寫復能(sis) 或是 ILIB 這樣」。
//
// 額度叫什麼是「當初買了什麼」（`復能四選一(60)`），一段叫什麼是
// **「那天真的做了什麼」**（`復能(SIS)`）。兩件事。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nameOf, slotName, visitNames, NAME_CONTEXTS } from '../public/js/domain/naming.js';
import { SEED } from '../public/js/domain/seed.js';
import { validate } from '../public/js/domain/masterData.js';

const MASTER = {
  courses: [
    { id: 'c-recovery', name: '復能' },
    { id: 'c-ilib', name: 'ILIB' },
    { id: 'c-checkup', name: '健檢' },
    { id: 'c-long', name: '高能量雷射門診', shortName: '高能門診', lineName: '雷射門診' },
  ],
  equipment: [
    { id: 'eq-sis', name: '超磁場', shortName: 'SIS', courseId: 'c-recovery' },
    { id: 'eq-indiba', name: 'INDIBA', courseId: 'c-recovery' },
    { id: 'eq-ilib', name: 'ILIB', courseId: 'c-ilib' },
    { id: 'eq-line', name: '別台', shortName: '別', lineName: '那一台', courseId: 'c-recovery' },
  ],
};

const slot = (over) => ({ courseId: 'c-recovery', courseName: '復能', ...over });

describe('一筆主檔在某個情境叫什麼', () => {
  test('課程：全名那一格永遠是全名，別稱與 LINE 名空的就退回全名', () => {
    const plain = { name: '復能' };
    assert.equal(nameOf(plain, 'full'), '復能');
    assert.equal(nameOf(plain, 'short'), '復能');
    assert.equal(nameOf(plain, 'line'), '復能');
  });

  test('課程：填了就用她填的', () => {
    const c = MASTER.courses[3];
    assert.equal(nameOf(c, 'full'), '高能量雷射門診', '全名那一格不受別稱影響');
    assert.equal(nameOf(c, 'short'), '高能門診');
    assert.equal(nameOf(c, 'line'), '雷射門診');
  });

  test('器材：一般那一格用的是**別稱**不是全名 —— 她要的是「復能(SIS)」', () => {
    const eq = MASTER.equipment[0];
    assert.equal(nameOf(eq, 'full', { as: 'equipment' }), 'SIS');
    assert.equal(nameOf(eq, 'short', { as: 'equipment' }), 'SIS');
  });

  test('器材的 LINE 名退回**別稱**再退回全名 —— 預設要跟畫面上一樣', () => {
    // 退回全名的話，她什麼都沒設定時 LINE 會寫「復能(超磁場)」，
    // 跟畫面上的「復能(SIS)」不一樣。
    assert.equal(nameOf(MASTER.equipment[0], 'line', { as: 'equipment' }), 'SIS');
    assert.equal(nameOf(MASTER.equipment[3], 'line', { as: 'equipment' }), '那一台');
    assert.equal(nameOf(MASTER.equipment[1], 'line', { as: 'equipment' }), 'INDIBA');
  });
});

describe('一段要唸成什麼', () => {
  test('月檢視只印器材 —— 一格放不下五六個字', () => {
    assert.equal(slotName(slot({ equipmentId: 'eq-sis' }), MASTER, 'short'), 'SIS');
  });

  test('一般是「課程全名(器材別稱)」', () => {
    assert.equal(slotName(slot({ equipmentId: 'eq-sis' }), MASTER, 'full'), '復能(SIS)');
    assert.equal(slotName(slot({ equipmentId: 'eq-indiba' }), MASTER, 'full'), '復能(INDIBA)');
  });

  test('LINE 預設跟一般一樣', () => {
    assert.equal(slotName(slot({ equipmentId: 'eq-sis' }), MASTER, 'line'), '復能(SIS)');
  });

  test('沒有器材就只有課程那一半 —— 健檢一個字都不會變', () => {
    for (const c of NAME_CONTEXTS) {
      assert.equal(slotName({ courseId: 'c-checkup', courseName: '健檢' }, MASTER, c), '健檢');
    }
  });

  test('兩半一樣就不加括號 —— ILIB 不可以變成 ILIB(ILIB)', () => {
    const s = slot({ courseId: 'c-ilib', courseName: 'ILIB', equipmentId: 'eq-ilib' });
    for (const c of NAME_CONTEXTS) assert.equal(slotName(s, MASTER, c), 'ILIB');
  });

  test('課程查不到就退回時段上的快照 —— 匯進來的舊來訪還印得出名字', () => {
    const s = { courseId: 'gone', courseName: '舊課程' };
    assert.equal(slotName(s, MASTER, 'full'), '舊課程');
    assert.equal(slotName(s, {}, 'full'), '舊課程');
  });

  test('器材查不到就當作沒有器材', () => {
    assert.equal(slotName(slot({ equipmentId: 'gone' }), MASTER, 'full'), '復能');
  });

  test('什麼都沒有就是空字串，不要吐 undefined', () => {
    assert.equal(slotName({}, MASTER, 'full'), '');
    assert.equal(slotName(null, MASTER, 'full'), '');
  });
});

describe('一筆來訪唸成什麼', () => {
  test('同一個名字只印一次 —— 同一天兩段點滴不該印兩次', () => {
    const visit = {
      slots: [
        slot({ equipmentId: 'eq-sis' }),
        slot({ equipmentId: 'eq-sis' }),
        { courseId: 'c-checkup', courseName: '健檢' },
      ],
    };
    assert.deepEqual(visitNames(visit, MASTER, 'full'), ['復能(SIS)', '健檢']);
    assert.deepEqual(visitNames(visit, MASTER, 'short'), ['SIS', '健檢']);
  });

  test('沒有時段就是空的', () => {
    assert.deepEqual(visitNames({ slots: [] }, MASTER), []);
    assert.deepEqual(visitNames(null, MASTER), []);
  });
});

describe('種子與驗證', () => {
  test('超磁場的別稱是 SIS —— 她指名的那一個', () => {
    assert.equal(SEED.equipment.find((e) => e.name === '超磁場').shortName, 'SIS');
  });

  test('四選一選到 ILIB 那一段，在種子上唸出來就是 ILIB', () => {
    const master = { courses: SEED.courses, equipment: SEED.equipment };
    const s = { courseId: 'course-iv-laser', courseName: 'ILIB', equipmentId: 'eq-ilib' };
    for (const c of NAME_CONTEXTS) assert.equal(slotName(s, master, c), 'ILIB');
  });

  test('種子上的復能 + 超磁場：月檢視 SIS、一般 復能(SIS)', () => {
    const master = { courses: SEED.courses, equipment: SEED.equipment };
    const s = { courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis' };
    assert.equal(slotName(s, master, 'short'), 'SIS');
    assert.equal(slotName(s, master, 'full'), '復能(SIS)');
    assert.equal(slotName(s, master, 'line'), '復能(SIS)');
  });

  test('別稱與 LINE 名選填，但填了就有長度上限', () => {
    const base = {
      name: '復能', durationMin: 60, category: 'C', assigns: 'therapist',
      allowedRoomTypes: [], allowedRoomIds: [],
    };
    assert.deepEqual(validate('courses', base, { existing: [] }), []);
    assert.deepEqual(validate('courses', { ...base, shortName: '復' }, { existing: [] }), []);
    assert.ok(validate('courses', { ...base, shortName: '一二三四五六七八九十一二三' }, { existing: [] })
      .some((e) => e.includes('別稱')));
    assert.ok(validate('equipment', { name: 'X', lineName: '一二三四五六七八九十一二三' }, { existing: [] })
      .some((e) => e.includes('LINE 名')));
  });
});
