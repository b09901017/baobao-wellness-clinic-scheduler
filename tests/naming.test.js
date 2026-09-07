// 一段來訪在畫面上要唸成什麼（`domain/naming.js`）。
//
// 她 2026-09-08：
//
// > app 中只會出現 在額度那邊寫復能-三選一(30)，月曆寫SIS(30)，草稿寫復能
//
// **只有三種字**，而且它們回答三個不同的問題：
//
//   額度   當初買了什麼    `復能-三選一(30)`   `poolName()` + `timedLabel()`
//   月曆   那天做了什麼    `SIS(30)`           `slotName(…, 'short')`
//   草稿   要跟客人說什麼  `復能`              `slotName(…, 'line')`
//
// 2026-09-07 那一版還有第四種（「一般」，印 `復能(SIS)`），只活在日／週檢視
// 那一列、讀取卡片與來訪編輯器的抬頭上。她 2026-09-08 說那三個地方也印月曆
// 那一種，所以它整個拿掉了。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { nameOf, slotName, visitNames, NAME_CONTEXTS } from '../public/js/domain/naming.js';
import { SEED } from '../public/js/domain/seed.js';
import { poolName, timedLabel, legacyPoolNames } from '../public/js/domain/entitlements.js';
import { validate } from '../public/js/domain/masterData.js';

const MASTER = {
  courses: [
    { id: 'c-recovery', name: '復能' },
    { id: 'c-ilib', name: 'ILIB', shortName: 'IL', lineName: '靜脈雷射' },
    { id: 'c-checkup', name: '健檢' },
    { id: 'c-long', name: '高能量雷射門診', shortName: '高能門診', lineName: '雷射門診' },
  ],
  equipment: [
    { id: 'eq-sis', name: '超磁場', shortName: 'SIS', courseId: 'c-recovery' },
    { id: 'eq-indiba', name: 'INDIBA', shortName: 'IN', courseId: 'c-recovery' },
    { id: 'eq-ilib', name: 'ILIB', shortName: 'IL', courseId: 'c-ilib' },
    { id: 'eq-plain', name: '高能量雷射', courseId: 'c-recovery' },
  ],
};

const slot = (over) => ({ courseId: 'c-recovery', courseName: '復能', ...over });

describe('只有兩種寫法', () => {
  test('NAME_CONTEXTS 是月曆與 LINE 草稿 —— 「一般」那一種已經沒有了', () => {
    assert.deepEqual(NAME_CONTEXTS, ['short', 'line']);
  });

  // 三個呼叫端一次改完了，但**認不得的情境要退回月曆那一種**，
  // 不要吐空字串 —— 漏改一處的症狀會是「那一列整個沒有名字」。
  test('認不得的情境退回月曆那一種', () => {
    assert.equal(slotName(slot({ equipmentId: 'eq-sis' }), MASTER, 'full'), 'SIS');
    assert.equal(slotName(slot({ equipmentId: 'eq-sis' }), MASTER), 'SIS');
  });
});

describe('一筆主檔在某個情境叫什麼', () => {
  test('課程：別稱空的就退回全名', () => {
    const plain = { name: '復能' };
    assert.equal(nameOf(plain, 'short'), '復能');
    assert.equal(nameOf(plain, 'line'), '復能');
  });

  test('課程：填了就用她填的', () => {
    const c = MASTER.courses[3];
    assert.equal(nameOf(c, 'short'), '高能門診');
    assert.equal(nameOf(c, 'line'), '雷射門診');
  });

  test('器材一律用別稱，沒設就退回全名', () => {
    assert.equal(nameOf(MASTER.equipment[0], 'short', { as: 'equipment' }), 'SIS');
    assert.equal(nameOf(MASTER.equipment[3], 'short', { as: 'equipment' }), '高能量雷射');
  });

  test('器材沒有第二種寫法 —— LINE 草稿一個器材字都不寫（ADR-0077）', () => {
    for (const c of NAME_CONTEXTS) {
      assert.equal(nameOf(MASTER.equipment[0], c, { as: 'equipment' }), 'SIS');
      assert.equal(nameOf(MASTER.equipment[1], c, { as: 'equipment' }), 'IN');
    }
  });
});

describe('一段要唸成什麼', () => {
  test('月曆印的是那天用的那一台', () => {
    assert.equal(slotName(slot({ equipmentId: 'eq-sis' }), MASTER, 'short'), 'SIS');
    assert.equal(slotName(slot({ equipmentId: 'eq-indiba' }), MASTER, 'short'), 'IN');
    assert.equal(slotName(slot({ equipmentId: 'eq-plain' }), MASTER, 'short'), '高能量雷射');
  });

  test('沒有器材就印課程的別稱', () => {
    assert.equal(slotName({ courseId: 'c-ilib', courseName: 'ILIB' }, MASTER, 'short'), 'IL');
    assert.equal(slotName({ courseId: 'c-checkup', courseName: '健檢' }, MASTER, 'short'), '健檢');
  });

  // 她 2026-09-08 明確不要這一種：「我不希望出現復能(器材)」
  test('一個「復能(SIS)」都不可以再畫得出來', () => {
    for (const c of [...NAME_CONTEXTS, 'full', 'whatever']) {
      const out = slotName(slot({ equipmentId: 'eq-sis' }), MASTER, c);
      assert.ok(!out.includes('('), `${c} 印出了 ${out}`);
    }
  });

  test('LINE 草稿只有課程那一半', () => {
    assert.equal(slotName(slot({ equipmentId: 'eq-sis' }), MASTER, 'line'), '復能');
    assert.equal(slotName(slot({ equipmentId: 'eq-indiba' }), MASTER, 'line'), '復能');
    assert.equal(
      slotName({ courseId: 'c-ilib', courseName: 'ILIB' }, MASTER, 'line'), '靜脈雷射',
    );
  });

  test('課程查不到就退回時段上的快照 —— 匯進來的舊來訪還印得出名字', () => {
    const s = { courseId: 'gone', courseName: '舊課程' };
    assert.equal(slotName(s, MASTER, 'short'), '舊課程');
    assert.equal(slotName(s, MASTER, 'line'), '舊課程');
    assert.equal(slotName(s, {}, 'short'), '舊課程');
  });

  test('器材查不到就當作沒有器材', () => {
    assert.equal(slotName(slot({ equipmentId: 'gone' }), MASTER, 'short'), '復能');
  });

  test('什麼都沒有就是空字串，不要吐 undefined', () => {
    assert.equal(slotName({}, MASTER, 'short'), '');
    assert.equal(slotName(null, MASTER, 'short'), '');
    assert.equal(slotName(null, MASTER, 'line'), '');
  });
});

describe('一筆來訪唸成什麼', () => {
  test('同一個名字只印一次 —— LINE 草稿上同一天兩段點滴不該說兩次', () => {
    const visit = {
      slots: [
        slot({ equipmentId: 'eq-sis' }),
        slot({ equipmentId: 'eq-sis' }),
        { courseId: 'c-checkup', courseName: '健檢' },
      ],
    };
    assert.deepEqual(visitNames(visit, MASTER, 'line'), ['復能', '健檢']);
    assert.deepEqual(visitNames(visit, MASTER, 'short'), ['SIS', '健檢']);
  });

  test('沒有時段就是空的', () => {
    assert.deepEqual(visitNames({ slots: [] }, MASTER), []);
    assert.deepEqual(visitNames(null, MASTER), []);
  });
});

// 她 2026-09-08 列的那六種，三個欄位一次比完。**這一張表就是那件事本身。**
describe('六種標準項目 × 三種寫法', () => {
  const master = { courses: SEED.courses, equipment: SEED.equipment };
  const at = (over) => ({ startsAt: '14:00', endsAt: '15:00', ...over });
  const pool = (ids, min) => timedLabel(poolName(ids, SEED.equipment, SEED.courses), min);

  const THREE = ['eq-laser', 'eq-sis', 'eq-indiba'];
  const FOUR = [...THREE, 'eq-ilib'];

  test('一、復能-三選一(60)：那天壓 SIS 就寫 SIS(60)，草稿寫復能', () => {
    assert.equal(pool(THREE, 60), '復能-三選一(60)');
    const s = at({ courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis' });
    assert.equal(slotName(s, master, 'short'), 'SIS(60)');
    assert.equal(slotName(s, master, 'line'), '復能');
  });

  test('二、復能-四選一(30)：壓到 ILIB 那一段月曆 IL(30)、草稿靜脈雷射', () => {
    assert.equal(pool(FOUR, 30), '復能-四選一(30)');
    const s = at({
      courseId: 'course-iv-laser', courseName: 'ILIB', equipmentId: 'eq-ilib', endsAt: '14:30',
    });
    assert.equal(slotName(s, master, 'short'), 'IL(30)');
    assert.equal(slotName(s, master, 'line'), '靜脈雷射');
  });

  test('三、復能-INDIBA(60) → IN(60) → 復能', () => {
    assert.equal(pool(['eq-indiba'], 60), '復能-INDIBA(60)');
    const s = at({ courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-indiba' });
    assert.equal(slotName(s, master, 'short'), 'IN(60)');
    assert.equal(slotName(s, master, 'line'), '復能');
  });

  test('四、復能-SIS(30) → SIS(30) → 復能', () => {
    assert.equal(pool(['eq-sis'], 30), '復能-SIS(30)');
    const s = at({
      courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', endsAt: '14:30',
    });
    assert.equal(slotName(s, master, 'short'), 'SIS(30)');
  });

  test('五、復能-高能量雷射(60) → 高能量雷射(60) → 復能', () => {
    assert.equal(pool(['eq-laser'], 60), '復能-高能量雷射(60)');
    const s = at({ courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-laser' });
    assert.equal(slotName(s, master, 'short'), '高能量雷射(60)');
    assert.equal(slotName(s, master, 'line'), '復能');
  });

  // 這一條是 2026-09-07 那一輪留下來的洞：單買 ILIB 那一段身上**沒有器材**
  // （ILIB 課程的 `requiresEquipment` 是 false），而分鐘以前只在有器材時才接。
  test('六、ILIB(60) → IL(60) → 靜脈雷射，而且沒有器材也接得上分鐘', () => {
    const ilib = SEED.courses.find((c) => c.id === 'course-iv-laser');
    assert.equal(timedLabel(ilib.name, 60), 'ILIB(60)');
    const s = at({ courseId: 'course-iv-laser', courseName: 'ILIB' });
    assert.equal(slotName(s, master, 'short'), 'IL(60)');
    assert.equal(slotName(s, master, 'line'), '靜脈雷射');
  });

  test('INDIBA 的別稱是 IN —— 沒有它月曆上會印成 INDIBA(60)，那一格塞不下', () => {
    assert.equal(SEED.equipment.find((e) => e.name === 'INDIBA').shortName, 'IN');
  });

  test('六種名字裡一個「復能(」都沒有，也沒有全形括號與空格', () => {
    for (const ids of [THREE, FOUR, ['eq-sis'], ['eq-indiba'], ['eq-laser'], ['eq-ilib']]) {
      const label = pool(ids, 60);
      assert.ok(!label.includes('復能('), label);
      assert.ok(!label.includes('（'), `${label} 還在用全形括號`);
      assert.ok(!label.includes(' - '), `${label} 的破折號兩邊還有空格`);
    }
  });
});

describe('月曆接上幾分鐘', () => {
  const master = { courses: SEED.courses, equipment: SEED.equipment };
  const at = (over) => ({
    courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis',
    startsAt: '14:00', endsAt: '15:00', ...over,
  });

  test('復能：SIS(60) 與 SIS(30) 分得出來', () => {
    assert.equal(slotName(at({}), master, 'short'), 'SIS(60)');
    assert.equal(slotName(at({ endsAt: '14:30' }), master, 'short'), 'SIS(30)');
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

  test('LINE 草稿一個數字都不接', () => {
    assert.equal(slotName(at({}), master, 'line'), '復能');
  });
});

describe('一筆額度叫什麼', () => {
  const master = { equipment: SEED.equipment, courses: SEED.courses };
  const name = (ids, min) =>
    timedLabel(poolName(ids, master.equipment, master.courses), min);

  test('沒有時長就不加括號 —— 不要補一個猜的', () => {
    assert.equal(name(['eq-sis'], null), '復能-SIS');
  });

  test('器材與課程同名就不接兩次（ILIB-ILIB 很怪）', () => {
    assert.equal(poolName(['eq-ilib'], master.equipment, master.courses), 'ILIB');
  });

  test('器材全被刪了就回空字串，不猜一個名字', () => {
    assert.equal(poolName(['gone'], master.equipment, master.courses), '');
  });

  // 額度的名字是購買當下的快照（ADR-0003），改了格式之後既有的那幾筆不會
  // 自己跟上。資料健檢那一列靠這一支分辨「這是自動帶的」與「她自己打的」——
  // **她自己打的一個字都不可以被一顆按鈕改掉。**
  test('歷代自動名字認得出來，包含上一代那個全形又有空格的', () => {
    const three = legacyPoolNames(
      ['eq-laser', 'eq-sis', 'eq-indiba'], master.equipment, master.courses,
    );
    assert.deepEqual(three, ['復能', '復能三選一', '復能 - 三選一']);

    const one = legacyPoolNames(['eq-sis'], master.equipment, master.courses);
    assert.deepEqual(one, ['復能', 'SIS', '復能 - SIS']);

    assert.deepEqual(legacyPoolNames([], master.equipment, master.courses), []);
  });
});

describe('種子上的方案', () => {
  test('復能那一項預設就是三選一 60 分', () => {
    for (const plan of SEED.plans) {
      const pool = plan.items.find((i) => i.type === 'pool');
      assert.ok(pool, `${plan.name} 少了復能那一項`);
      assert.equal(pool.label, '復能-三選一(60)', plan.name);
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

  test('ILIB 那一項也是新格式', () => {
    for (const plan of SEED.plans) {
      const ilib = plan.items.find((i) => i.courseId === 'course-iv-laser');
      assert.equal(ilib.label, 'ILIB(60)', plan.name);
    }
  });
});

describe('驗證', () => {
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

// 設定 →「名稱怎麼寫」那一頁。她 2026-09-08：
//
// > 設定就不用管復能或靜脈的課程命名，這兩個就固定用上面那六種
//
// 這一頁不執行程式碼，只讀原始碼（同 `module-names.test.js` 的路數）。
describe('設定頁那六列', () => {
  const src = readFileSync(
    new URL('../public/js/ui/views/naming.js', import.meta.url), 'utf8',
  );

  test('那六列是從主檔推出來的，一列都沒有寫死', () => {
    for (const word of ['三選一', '四選一', 'INDIBA', 'SIS', 'ILIB', '高能量雷射']) {
      assert.ok(
        !new RegExp(`title: '${word}`).test(src),
        `那六列不可以寫死「${word}」—— 她多接一台器材時這一頁要自己跟上`,
      );
    }
    // 判準跟加購那一排問的是同一句話（ADR-0075）
    assert.match(src, /poolChoices\(/);
    assert.match(src, /poolSiblingCourseIds\(/);
  });

  test('器材那幾列沒有 LINE 那一格（ADR-0077）', () => {
    assert.match(src, /hasLine: false/, '器材那幾列要明確關掉 LINE');
    assert.match(src, /type: 'equipment'/);
  });

  test('預覽走 domain 的 slotName()，不自己接字串', () => {
    assert.match(src, /slotName\(slot, master, 'short'\)/);
    assert.match(src, /slotName\(slot, master, 'line'\)/);
  });
});

// n返（三返、四返…）**不在主檔上**：它借二返那個課程，而畫面上要印的是返數
//（`domain/nthFollowup.js` 的 `nthSlotFields()` 把它寫進 `courseName` 快照）。
//
// 這一條是 2026-09-08 補的。在那之前日曆上一段三返印的是「二返」——
// 同一位客戶同一天有二返又有三返時，兩列長得一模一樣。
// E2E 的 N4 從寫下來就一直是紅的，而它盯的正是這件事。
describe('n返 印的是返數不是課程', () => {
  const master = { courses: SEED.courses, equipment: SEED.equipment };
  const nth = (over = {}) => ({
    courseId: 'course-followup', courseName: '三返', followupNth: 3,
    entitlementId: null, startsAt: '15:00', endsAt: '15:30', ...over,
  });

  test('月曆與 LINE 草稿都印「三返」', () => {
    assert.equal(slotName(nth(), master, 'short'), '三返');
    assert.equal(slotName(nth(), master, 'line'), '三返');
  });

  test('四返也一樣', () => {
    assert.equal(slotName(nth({ courseName: '四返', followupNth: 4 }), master, 'short'), '四返');
  });

  // 二返走的是額度那條路（`followupNth` 是 null），它照舊讀主檔 ——
  // 主檔改名之後，已經排出去的二返要跟著改名。
  test('二返不受影響，照舊讀主檔', () => {
    const second = { courseId: 'course-followup', courseName: '舊名字', entitlementId: 'e1' };
    assert.equal(slotName(second, master, 'short'), '二返');
  });

  test('返數填了但快照是空的 → 退回主檔，不要印成空白', () => {
    assert.equal(slotName(nth({ courseName: '' }), master, 'short'), '二返');
  });

  test('返數那一格是空字串就不算 n返（同 `isNthSlot()` 的判斷）', () => {
    const blank = { courseId: 'course-followup', courseName: '舊名字', followupNth: '' };
    assert.equal(slotName(blank, master, 'short'), '二返');
  });
});
