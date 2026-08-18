import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  validate, roomSlots, roomsForCourse, MASTER_TYPES, ROOM_TYPES,
  planItem, BLANK_PLAN_ITEM,
  copyPlan,
} from '../public/js/domain/masterData.js';
import { SEED, DEFAULT_SETTINGS } from '../public/js/domain/seed.js';
import { describeCategory, tasksForCategory, CATEGORY_OPTIONS } from '../public/js/domain/taskRules.js';

describe('主檔驗證', () => {
  test('名稱空白一律擋下', () => {
    for (const type of MASTER_TYPES) {
      const errors = validate(type, { name: '  ' });
      assert.ok(errors.length > 0, `${type} 應該要擋空白名稱`);
    }
  });

  test('同一份清單不可以有兩個同名的', () => {
    const existing = [{ id: 'a', name: '治3' }];
    const errors = validate('rooms', { id: 'b', name: '治3', type: '治療室' }, { existing });
    assert.match(errors[0], /已經有一個叫/);
  });

  test('已刪除的不算重複', () => {
    const existing = [{ id: 'a', name: '治3', deletedAt: 'x' }];
    assert.deepEqual(validate('rooms', { id: 'b', name: '治3', type: '治療室' }, { existing }), []);
  });

  test('改自己的時候不會說自己跟自己重複', () => {
    const existing = [{ id: 'a', name: '治3' }];
    assert.deepEqual(validate('rooms', { id: 'a', name: '治3', type: '治療室' }, { existing }), []);
  });

  test('床位不可重複或空白', () => {
    assert.ok(validate('rooms', { name: '點滴8', type: '點滴室', beds: ['A', 'A'] }).length);
    assert.ok(validate('rooms', { name: '點滴8', type: '點滴室', beds: ['A', ''] }).length);
    assert.deepEqual(validate('rooms', { name: '點滴8', type: '點滴室', beds: ['A', 'B'] }), []);
  });
});

describe('課程驗證', () => {
  const base = {
    name: 'x', category: 'C', durationMin: 60, assigns: 'room',
    allowedRoomTypes: ['治療室'], allowedRoomIds: [], requiresEquipment: false,
  };

  test('選診間的課程一定要指定範圍，否則新增診間時會漏', () => {
    const errors = validate('courses', { ...base, allowedRoomTypes: [], allowedRoomIds: [] });
    assert.ok(errors.some((e) => e.includes('診間類型')));
  });

  test('直接指定幾間也算指定了範圍', () => {
    assert.deepEqual(
      validate('courses', { ...base, allowedRoomTypes: [], allowedRoomIds: ['room-t5'] }),
      [],
    );
  });

  test('不選診間的課程不該有診間限制', () => {
    const errors = validate('courses', { ...base, assigns: 'none', allowedRoomTypes: ['治療室'] });
    assert.ok(errors.some((e) => e.includes('不該設定診間限制')));
  });

  test('要選器材就必須指派治療師', () => {
    const errors = validate('courses', { ...base, requiresEquipment: true });
    assert.ok(errors.some((e) => e.includes('指派治療師')));
  });

  test('時長必須是正整數', () => {
    for (const bad of [0, -30, 1.5, 'abc', null]) {
      assert.ok(validate('courses', { ...base, durationMin: bad }).length, `${bad} 應該被擋`);
    }
  });

  test('category 為 null 是合法的「不產生任務」，不是漏填', () => {
    assert.deepEqual(validate('courses', { ...base, category: null }), []);
  });
});

describe('方案驗證', () => {
  const courses = [{ id: 'c1' }];
  const equipment = [{ id: 'e1' }, { id: 'e2' }];

  test('至少要有一個項目', () => {
    const errors = validate('plans', { name: 'p', items: [] }, { courses, equipment });
    assert.ok(errors.some((e) => e.includes('至少要有一個項目')));
  });

  test('指向不存在的課程要被抓到', () => {
    const errors = validate('plans', {
      name: 'p', items: [{ type: 'single', label: 'x', qty: 1, courseId: 'ghost' }],
    }, { courses, equipment });
    assert.ok(errors.some((e) => e.includes('不存在')));
  });

  test('擇一池至少兩種器材，否則不叫擇一', () => {
    const one = validate('plans', {
      name: 'p', items: [{ type: 'pool', label: 'x', qty: 1, optionEquipmentIds: ['e1'] }],
    }, { courses, equipment });
    assert.ok(one.some((e) => e.includes('至少要有兩種')));
  });

  test('錯誤訊息要說是第幾個項目', () => {
    const errors = validate('plans', {
      name: 'p',
      items: [
        { type: 'single', label: 'ok', qty: 1, courseId: 'c1' },
        { type: 'single', label: '', qty: 1, courseId: 'c1' },
      ],
    }, { courses, equipment });
    assert.ok(errors.some((e) => e.startsWith('第 2 個項目')));
  });
});

describe('診間與床位', () => {
  const rooms = [
    { id: 'r1', name: '治3', type: '治療室', beds: [] },
    { id: 'r2', name: '點滴8', type: '點滴室', beds: ['A', 'B'] },
    { id: 'r3', name: '治9', type: '治療室', beds: [], deletedAt: 'x' },
  ];

  test('有床位的診間攤成多個資源，沒床位的就一個', () => {
    assert.deepEqual(roomSlots(rooms), [
      { roomId: 'r1', bed: null, label: '治3' },
      { roomId: 'r2', bed: 'A', label: '點滴8A' },
      { roomId: 'r2', bed: 'B', label: '點滴8B' },
    ]);
  });

  test('已刪除的診間不會出現', () => {
    assert.ok(!roomSlots(rooms).some((s) => s.roomId === 'r3'));
  });

  test('指定的診間 id 蓋過類型規則', () => {
    const course = { assigns: 'room', allowedRoomTypes: ['點滴室'], allowedRoomIds: ['r1'] };
    assert.deepEqual(roomsForCourse(course, rooms).map((r) => r.id), ['r1']);
  });

  test('不選診間的課程回空陣列', () => {
    assert.deepEqual(roomsForCourse({ assigns: 'therapist' }, rooms), []);
  });
});

describe('種子資料', () => {
  const ctx = { courses: SEED.courses, equipment: SEED.equipment };

  test('每一筆種子資料都通得過自己的驗證', () => {
    for (const type of MASTER_TYPES) {
      const list = SEED[type] ?? [];
      for (const record of list) {
        const errors = validate(type, record, { existing: list, ...ctx });
        assert.deepEqual(errors, [], `${type} / ${record.name}：${errors.join('；')}`);
      }
    }
  });

  test('ID 全域唯一', () => {
    const ids = MASTER_TYPES.flatMap((t) => (SEED[t] ?? []).map((r) => r.id));
    assert.equal(new Set(ids).size, ids.length, 'ID 重複了');
  });

  test('方案項目指到的課程與器材都真的存在', () => {
    const courseIds = new Set(SEED.courses.map((c) => c.id));
    const equipIds = new Set(SEED.equipment.map((e) => e.id));
    for (const plan of SEED.plans) {
      for (const item of plan.items) {
        if (item.type === 'single') {
          assert.ok(courseIds.has(item.courseId), `${plan.name}：找不到課程 ${item.courseId}`);
        } else {
          for (const id of item.optionEquipmentIds) {
            assert.ok(equipIds.has(id), `${plan.name}：找不到器材 ${id}`);
          }
        }
      }
    }
  });

  test('EECP 只能在治5、治8', () => {
    const eecp = SEED.courses.find((c) => c.name === 'EECP');
    assert.deepEqual(eecp.allowedRoomIds, ['room-t5', 'room-t8']);
    const rooms = roomsForCourse(eecp, SEED.rooms).map((r) => r.name);
    assert.deepEqual(rooms, ['治5', '治8']);
  });

  test('心臟科評估不佔診間', () => {
    const cardio = SEED.courses.find((c) => c.name === '心臟科評估');
    assert.equal(cardio.assigns, 'none');
    assert.deepEqual(roomsForCourse(cardio, SEED.rooms), []);
  });

  test('復能選治療師且要選器材，靜脈選診間且不用器材', () => {
    const recovery = SEED.courses.find((c) => c.name === '復能');
    assert.equal(recovery.assigns, 'therapist');
    assert.equal(recovery.requiresEquipment, true);

    const ivLaser = SEED.courses.find((c) => c.name === '靜脈');
    assert.equal(ivLaser.assigns, 'room');
    assert.equal(ivLaser.requiresEquipment, false);
  });

  test('體內金屬只擋超磁場與高能量雷射', () => {
    const blocked = SEED.equipment
      .filter((e) => e.contraindications.includes('體內金屬'))
      .map((e) => e.name);
    assert.deepEqual(blocked.sort(), ['超磁場', '高能量雷射'].sort());
  });

  test('兩個方案的復能與靜脈次數相反，這是正常的', () => {
    const qty = (planName, label) =>
      SEED.plans.find((p) => p.name === planName).items.find((i) => i.label === label).qty;
    assert.equal(qty('筋骨強身', '復能'), 12);
    assert.equal(qty('筋骨強身', '靜脈'), 20);
    assert.equal(qty('8萬方案', '復能'), 20);
    assert.equal(qty('8萬方案', '靜脈'), 12);
  });

  test('那五項不產生任務的課程確實是 null 類別', () => {
    const noTask = SEED.courses.filter((c) => c.category === null).map((c) => c.name);
    assert.deepEqual(
      noTask.sort(),
      ['身體組成分析', '體適能檢查分析', '物理治療師諮詢', '營養師諮詢'].sort(),
    );
    for (const name of noTask) {
      const c = SEED.courses.find((x) => x.name === name);
      assert.deepEqual(tasksForCategory(c.category), []);
    }
  });

  test('C 類課程只產生 Abovee', () => {
    const cCourses = SEED.courses.filter((c) => c.category === 'C');
    assert.ok(cCourses.length >= 4);
    for (const c of cCourses) {
      assert.deepEqual(tasksForCategory(c.category), ['Abovee'], `${c.name} 不該有打電話`);
    }
  });

  test('預設排序權重與 SPEC 第 9 節一致', () => {
    assert.deepEqual(DEFAULT_SETTINGS.sortWeights, { w1: 1.0, w2: 0.8, w3: 0.6, w4: 0.3 });
    assert.equal(DEFAULT_SETTINGS.slotGapMin, 15);
  });
});

describe('類別說明', () => {
  test('每個類別都說得出會產生哪些任務', () => {
    assert.match(describeCategory('A'), /打電話.*Abovee.*Examine.*耀聖/);
    assert.match(describeCategory('C'), /Abovee/);
    assert.ok(!describeCategory('C').includes('打電話'));
  });

  test('不產生任務要明講，不是空白', () => {
    assert.equal(describeCategory(null), '不產生任務');
    assert.equal(describeCategory(undefined), '不產生任務');
  });

  test('四個選項涵蓋所有合法類別', () => {
    assert.deepEqual(CATEGORY_OPTIONS.map((o) => o.value), ['A', 'B', 'C', null]);
  });
});

describe('方案項目的形狀', () => {
  test('single 沒有 optionEquipmentIds，pool 沒有 courseId', () => {
    const single = planItem({ type: 'single', label: '靜脈', qty: 20, durationMin: 60, courseId: 'c1' });
    assert.deepEqual(single, {
      type: 'single', label: '靜脈', qty: 20, durationMin: 60, courseId: 'c1',
    });
    assert.ok(!('optionEquipmentIds' in single));

    const pool = planItem({
      type: 'pool', label: '復能', qty: 12, durationMin: 60,
      optionEquipmentIds: ['eq-a', 'eq-b'], courseId: 'c1',
    });
    assert.deepEqual(pool, {
      type: 'pool', label: '復能', qty: 12, durationMin: 60,
      optionEquipmentIds: ['eq-a', 'eq-b'],
    });
    assert.ok(!('courseId' in pool), '擇一池換的是器材，不是課程');
  });

  test('頻率限制留空就整個欄位不要出現，不要塞 null', () => {
    const withRule = planItem({ type: 'single', label: 'Inbody', qty: 4, frequencyRule: ' 每季一次 ' });
    assert.equal(withRule.frequencyRule, '每季一次');

    for (const blank of ['', '   ', null, undefined]) {
      assert.ok(!('frequencyRule' in planItem({ type: 'single', label: 'x', qty: 1, frequencyRule: blank })));
    }
  });

  test('認不得的型態當成 single，不要讓壞資料原樣存進去', () => {
    assert.equal(planItem({ type: 'weird', label: 'x', qty: 1 }).type, 'single');
  });

  test('用表單值重建種子方案，逐欄與 seed.js 那份相同', () => {
    // 驗收條件：用 UI 從零重建「筋骨強身」，存下來的 items 要與種子完全一樣
    for (const plan of SEED.plans) {
      const rebuilt = plan.items.map((it) => planItem(it));
      assert.deepEqual(rebuilt, plan.items, `${plan.name} 重建後與種子不同`);
    }
  });

  test('新項目的起點是合法的 single', () => {
    const item = planItem({ ...BLANK_PLAN_ITEM });
    assert.equal(item.type, 'single');
    assert.equal(item.courseId, null);
    assert.ok(!('optionEquipmentIds' in item));
  });

  test('項目全刪光仍然擋得下來，而且錯誤指得出是第幾個', () => {
    assert.ok(validate('plans', { name: '新方案', items: [] }).includes('方案至少要有一個項目'));

    const errors = validate(
      'plans',
      {
        name: '新方案',
        items: [
          planItem({ type: 'single', label: '復健', qty: 6, courseId: 'course-rehab' }),
          planItem({ type: 'pool', label: '復能', qty: 12, optionEquipmentIds: ['eq-indiba'] }),
        ],
      },
      { courses: [{ id: 'course-rehab' }], equipment: [{ id: 'eq-indiba' }] },
    );
    assert.ok(errors.some((e) => e.startsWith('第 2 個項目')), errors.join(' / '));
    assert.ok(!errors.some((e) => e.startsWith('第 1 個項目')), errors.join(' / '));
  });
});

// ---------- 方案範本的複製 ----------
//
// ADR-0003 的立論是「不做版本、改用複製」，所以複製沒做等於那支 ADR 只實現了一半。
// 驗收條件見 .scratch/plan-template-copy/issues/01。

const SOURCE_PLAN = {
  id: 'plan-jingu',
  name: '筋骨強身',
  membershipMonths: 12,
  note: '總價 288,000，限本人',
  active: false,
  createdAt: 'x',
  createdBy: 'me',
  updatedAt: 'y',
  deletedAt: null,
  items: [
    { type: 'single', courseId: 'course-rehab', label: '復健科醫師門診', qty: 6, durationMin: 30 },
    {
      type: 'pool', label: '復能', qty: 12, durationMin: 60,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'],
    },
  ],
};

test('複製出來的名字有後綴，否則同名檢查會擋下來而她不知道為什麼', () => {
  assert.equal(copyPlan(SOURCE_PLAN).name, '筋骨強身（複本）');
});

test('複製帶過去會籍、備註與全部項目', () => {
  const copy = copyPlan(SOURCE_PLAN);
  assert.equal(copy.membershipMonths, 12);
  assert.equal(copy.note, '總價 288,000，限本人');
  assert.equal(copy.items.length, 2);
  assert.deepEqual(copy.items[1].optionEquipmentIds, ['eq-laser', 'eq-sis', 'eq-indiba']);
});

test('項目是深拷貝，改了新的不會連原本那張一起變', () => {
  // 淺拷貝的災難要等到某位客戶的額度展開錯了才會被發現，那時已經來不及。
  const copy = copyPlan(SOURCE_PLAN);
  copy.items[1].qty = 99;
  copy.items[1].optionEquipmentIds.push('eq-new');

  assert.equal(SOURCE_PLAN.items[1].qty, 12);
  assert.deepEqual(SOURCE_PLAN.items[1].optionEquipmentIds, ['eq-laser', 'eq-sis', 'eq-indiba']);
});

test('從停用的範本複製，新的那張是啟用的', () => {
  assert.equal(SOURCE_PLAN.active, false);
  assert.equal(copyPlan(SOURCE_PLAN).active, true);
});

test('複製出來的不帶 id 與任何指回原本那張的欄位', () => {
  // ADR-0003：範本沒有版本。「5 月的範本」與「8 月的範本」是兩個各自有名字的範本，
  // 不是同一個範本的兩個版本 —— 留一個 copiedFromId 就等於偷偷做了版本。
  const keys = Object.keys(copyPlan(SOURCE_PLAN));
  for (const forbidden of [
    'id', 'version', 'copiedFromId', 'sourcePlanId',
    'createdAt', 'createdBy', 'updatedAt', 'deletedAt',
  ]) {
    assert.equal(keys.includes(forbidden), false, `不可以帶 ${forbidden}`);
  }
});

test('複製出來的內容通得過既有的驗證', () => {
  const copy = copyPlan(SOURCE_PLAN);
  const errors = validate('plans', copy, {
    existing: [SOURCE_PLAN],
    courses: SEED.courses,
    equipment: SEED.equipment,
  });
  assert.deepEqual(errors, []);
});

test('沒改名就儲存會被同名檢查擋下來，不會無聲蓋掉', () => {
  const copy = { ...copyPlan(SOURCE_PLAN), name: SOURCE_PLAN.name };
  const errors = validate('plans', copy, {
    existing: [SOURCE_PLAN],
    courses: SEED.courses,
    equipment: SEED.equipment,
  });
  assert.ok(errors.length > 0);
});
