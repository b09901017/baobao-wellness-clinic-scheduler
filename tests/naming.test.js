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
import { poolName, timedLabel, legacyPoolNames } from '../public/js/domain/entitlements.js';
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

  test('器材沒有第三種寫法 —— LINE 草稿一個器材字都不寫（ADR-0077）', () => {
    // 貼給客人的那一句只講課程，所以器材主檔上的 `lineName` 畫不出來。
    // 問到 `line` 時退回別稱，跟另外兩種一樣 —— 呼叫端不必先判斷是哪一種。
    for (const c of NAME_CONTEXTS) {
      assert.equal(nameOf(MASTER.equipment[0], c, { as: 'equipment' }), 'SIS');
      assert.equal(nameOf(MASTER.equipment[3], c, { as: 'equipment' }), '別');
      assert.equal(nameOf(MASTER.equipment[1], c, { as: 'equipment' }), 'INDIBA');
    }
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

  test('LINE 草稿只有課程那一半 —— 客戶看的那一句不寫器材（ADR-0077）', () => {
    // 她 2026-09-07：「我和客人的草稿只會有復能或靜脈雷射」
    assert.equal(slotName(slot({ equipmentId: 'eq-sis' }), MASTER, 'line'), '復能');
    assert.equal(slotName(slot({ equipmentId: 'eq-indiba' }), MASTER, 'line'), '復能');
    // 器材主檔上設了 LINE 名也一樣畫不出來
    assert.equal(slotName(slot({ equipmentId: 'eq-line' }), MASTER, 'line'), '復能');
    // 課程自己那一格照樣用得到
    assert.equal(
      slotName({ courseId: 'c-long', courseName: '高能量雷射門診' }, MASTER, 'line'),
      '雷射門診',
    );
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

  test('四選一選到 ILIB 那一段：月檢視 IL、一般 ILIB、LINE 靜脈雷射', () => {
    // 她 2026-09-07：「靜脈我希望他一般就叫做 ILIB 然後自己記叫做 IL
    // 然後 line 草稿是叫做 靜脈雷射」
    const master = { courses: SEED.courses, equipment: SEED.equipment };
    const s = { courseId: 'course-iv-laser', courseName: 'ILIB', equipmentId: 'eq-ilib' };
    assert.equal(slotName(s, master, 'short'), 'IL');
    // **不可以是 `ILIB(IL)`** —— 器材與課程是同一件事
    assert.equal(slotName(s, master, 'full'), 'ILIB');
    assert.equal(slotName(s, master, 'line'), '靜脈雷射');
  });

  test('單買 ILIB（沒有器材）唸出來跟四選一選到 ILIB 一模一樣', () => {
    const master = { courses: SEED.courses, equipment: SEED.equipment };
    const s = { courseId: 'course-iv-laser', courseName: 'ILIB' };
    assert.equal(slotName(s, master, 'short'), 'IL');
    assert.equal(slotName(s, master, 'full'), 'ILIB');
    assert.equal(slotName(s, master, 'line'), '靜脈雷射');
  });

  test('種子上的復能 + 超磁場：月檢視 SIS、一般 復能(SIS)、LINE 復能', () => {
    const master = { courses: SEED.courses, equipment: SEED.equipment };
    const s = { courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis' };
    assert.equal(slotName(s, master, 'short'), 'SIS');
    assert.equal(slotName(s, master, 'full'), '復能(SIS)');
    assert.equal(slotName(s, master, 'line'), '復能');
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

// 額度叫什麼（`domain/entitlements.js` 的 `poolName()` / `timedLabel()`）。
//
// 它跟 `slotName()` 是兩件事：額度是「當初買了什麼」，時段是「那天做了什麼」。
// 放在同一支測試裡是因為兩邊都吃**別稱**，而她 2026-09-07 指名的兩個格式
// （`復能 - SIS（60）` 與月檢視的 `SIS`）必須用同一個字。
describe('一筆額度叫什麼', () => {
  const master = { equipment: SEED.equipment, courses: SEED.courses };
  const name = (ids, min) =>
    timedLabel(poolName(ids, master.equipment, master.courses), min);

  test('整組：復能 - 三選一（60）', () => {
    assert.equal(name(['eq-laser', 'eq-sis', 'eq-indiba'], 60), '復能 - 三選一（60）');
  });

  test('四選一多的那一台是 ILIB，前半仍然是復能', () => {
    assert.equal(
      name(['eq-laser', 'eq-sis', 'eq-indiba', 'eq-ilib'], 30),
      '復能 - 四選一（30）',
    );
  });

  test('單買一台：帶著分類，而且用別稱不是全名', () => {
    assert.equal(name(['eq-sis'], 60), '復能 - SIS（60）');
    assert.equal(name(['eq-indiba'], 30), '復能 - INDIBA（30）');
    assert.equal(name(['eq-laser'], 60), '復能 - 高能量雷射（60）');
  });

  test('沒有時長就不加括號 —— 不要補一個猜的', () => {
    assert.equal(name(['eq-sis'], null), '復能 - SIS');
  });

  test('器材與課程同名就不接兩次（ILIB - ILIB 很怪）', () => {
    assert.equal(poolName(['eq-ilib'], master.equipment, master.courses), 'ILIB');
  });

  test('器材全被刪了就回空字串，不猜一個名字', () => {
    assert.equal(poolName(['gone'], master.equipment, master.courses), '');
  });

  test('歷代自動名字認得出來 —— 資料健檢要靠它分辨「她自己打的」', () => {
    const three = legacyPoolNames(
      ['eq-laser', 'eq-sis', 'eq-indiba'], master.equipment, master.courses,
    );
    assert.deepEqual(three, ['復能', '復能三選一']);

    const one = legacyPoolNames(['eq-sis'], master.equipment, master.courses);
    assert.deepEqual(one, ['復能', '超磁場', 'SIS'], '2026-09-06 那一版叫器材全名');

    assert.deepEqual(legacyPoolNames([], master.equipment, master.courses), []);
  });
});

describe('種子上的方案', () => {
  test('復能那一項預設就是三選一 60 分（她 2026-09-07 指名的）', () => {
    for (const plan of SEED.plans) {
      const pool = plan.items.find((i) => i.type === 'pool');
      assert.ok(pool, `${plan.name} 少了復能那一項`);
      assert.equal(pool.label, '復能 - 三選一（60）', plan.name);
      assert.equal(pool.durationMin, 60);
      assert.deepEqual(pool.optionEquipmentIds, ['eq-laser', 'eq-sis', 'eq-indiba']);
    }
  });

  test('方案裡的名字就是算出來的那一個 —— 兩邊各寫一次遲早會歪', () => {
    for (const plan of SEED.plans) {
      for (const item of plan.items) {
        if (item.type !== 'pool') continue;
        assert.equal(
          item.label,
          timedLabel(
            poolName(item.optionEquipmentIds, SEED.equipment, SEED.courses),
            item.durationMin,
          ),
        );
      }
    }
  });
});

// 她 2026-09-07：「希望可以在月檢視能看出來，分的出來，不用記復能(SIS)
// 而是記 SIS(60)」—— 同一台機器有 30 與 60 兩種，而那是兩筆不同的額度。
describe('月檢視接上幾分鐘', () => {
  const master = { courses: SEED.courses, equipment: SEED.equipment };
  const at = (over) => ({
    courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis',
    startsAt: '14:00', endsAt: '15:00', ...over,
  });

  test('復能：SIS(60) 與 SIS(30) 分得出來', () => {
    assert.equal(slotName(at({}), master, 'short'), 'SIS(60)');
    assert.equal(slotName(at({ endsAt: '14:30' }), master, 'short'), 'SIS(30)');
  });

  test('ILIB 也有兩種規格，所以它也接', () => {
    const s = at({ courseId: 'course-iv-laser', courseName: 'ILIB', equipmentId: 'eq-ilib' });
    assert.equal(slotName(s, master, 'short'), 'IL(60)');
  });

  test('只有一種規格的課程不接 —— 那個數字什麼都沒講，而那一格很貴', () => {
    const s = { courseId: 'course-checkup', courseName: '健檢', startsAt: '09:00', endsAt: '11:00' };
    assert.equal(slotName(s, master, 'short'), '健檢');
  });

  test('沒有時間就不接（匯進來的舊來訪，ADR-0011）', () => {
    assert.equal(slotName(at({ startsAt: null, endsAt: null }), master, 'short'), 'SIS');
    assert.equal(slotName(at({ endsAt: null }), master, 'short'), 'SIS');
  });

  test('時間壞掉也不會炸 —— `toMinutes()` 收到 null 會 throw', () => {
    assert.equal(slotName(at({ startsAt: '25:99' }), master, 'short'), 'SIS');
    assert.equal(slotName(at({ endsAt: '14:00' }), master, 'short'), 'SIS', '零分鐘不接');
  });

  test('另外兩種寫法一個字都不變', () => {
    assert.equal(slotName(at({}), master, 'full'), '復能(SIS)');
    assert.equal(slotName(at({}), master, 'line'), '復能');
  });
});
