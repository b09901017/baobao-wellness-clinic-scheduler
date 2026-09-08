import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validate, roomSlots, roomsForCourse, orderedRoomsForCourse, orderedRoomSlots,
  MASTER_TYPES, ROOM_TYPES, ASSIGNS,
  planItem, BLANK_PLAN_ITEM,
  copyPlan,
  staffWithRole, THERAPIST_ROLE, DOCTOR_ROLE, STAFF_ROLES, clinicalTerms, ivChoicesFor,
  picksDoctor,
  partnerNames, MASTER_LABELS,
} from '../public/js/domain/masterData.js';
import { SEED, DEFAULT_SETTINGS } from '../public/js/domain/seed.js';
import {
  describeCategory, tasksForCategory, CATEGORY_OPTIONS, bookingSystemFor,
} from '../public/js/domain/taskRules.js';
import { needsForm } from '../public/js/domain/visits.js';

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

  // 2026-09-08：「取消任何床位區分」。舊資料上那一格還在（只有點滴8 有
  // A／B），所以驗證**不擋** —— 擋下來的話她一進設定頁改個名字就存不回去。
  test('床位那一格不再驗', () => {
    assert.deepEqual(validate('rooms', { name: '點滴8', type: '點滴室', beds: ['A', 'A'] }), []);
    assert.deepEqual(validate('rooms', { name: '點滴8', type: '點滴室', beds: ['A', ''] }), []);
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

  // ADR-0075：這一條 2026-09-06 拿掉了。復能四選一裡的 ILIB 要的是診間，
  // 而指派已經由「這一段選了哪一台器材」推出來 —— 留著這一條會把那件事擋掉。
  test('要選器材的課程不必指派治療師 —— 那是器材決定的', () => {
    assert.deepEqual(validate('courses', { ...base, requiresEquipment: true }), []);
  });

  // 她 2026-09-06：「要能選 30 分鐘或是 60 分鐘的」。名單記在課程主檔上，
  // 不寫死課程名字 —— 這個 repo 為字串比對付過帳。
  describe('可選時長', () => {
    const with_ = (durationChoices, over = {}) =>
      validate('courses', { ...base, durationChoices, ...over });

    test('選填 —— 留空就是只有一個時長', () => {
      assert.deepEqual(with_([]), []);
      assert.deepEqual(validate('courses', base), []);
    });

    test('填了就要都是正整數、不重複、含得下預設那一個', () => {
      assert.deepEqual(with_([30, 60], { durationMin: 60 }), []);
      assert.ok(with_([30, 0]).some((e) => e.includes('大於 0')));
      assert.ok(with_([30, 30, 60]).some((e) => e.includes('重複')));
      assert.ok(with_([10, 20, 30, 40, 50, 60, 70]).some((e) => e.includes('最多六個')));
    });

    test('預設時長不在名單上要擋 —— 那一排會一顆都沒按著', () => {
      assert.ok(with_([30, 45], { durationMin: 60 }).some((e) => e.includes('包含')));
    });
  });

  test('時長必須是正整數', () => {
    for (const bad of [0, -30, 1.5, 'abc', null]) {
      assert.ok(validate('courses', { ...base, durationMin: bad }).length, `${bad} 應該被擋`);
    }
  });

  test('category 為 null 是合法的「不產生任務」，不是漏填', () => {
    assert.deepEqual(validate('courses', { ...base, category: null }), []);
  });

  // 健檢 → 二返（ADR-0022）。指歪了不會有任何畫面提示 ——
  // 額度就是配不出來，而那長得跟「這位客戶沒買健檢」一模一樣。
  test('後續課程要指到真的存在的課程', () => {
    const existing = [{ id: 'c-followup', name: '二返' }];
    assert.deepEqual(
      validate('courses', { ...base, id: 'c-checkup', followupCourseId: 'c-followup' }, { existing }),
      [],
    );
    assert.ok(
      validate('courses', { ...base, id: 'c-checkup', followupCourseId: 'nope' }, { existing })
        .some((e) => e.includes('後續課程不存在')),
    );
  });

  test('後續課程不可以是它自己', () => {
    const errors = validate(
      'courses',
      { ...base, id: 'c-checkup', followupCourseId: 'c-checkup' },
      { existing: [{ id: 'c-checkup', name: 'x' }] },
    );
    assert.ok(errors.some((e) => e.includes('它自己')));
  });

  test('已刪除的課程不能當後續課程', () => {
    const existing = [{ id: 'c-followup', name: '二返', deletedAt: '2026-08-01' }];
    assert.ok(
      validate('courses', { ...base, id: 'c-checkup', followupCourseId: 'c-followup' }, { existing })
        .some((e) => e.includes('後續課程不存在')),
    );
  });

  test('沒設後續課程是常態，不是漏填', () => {
    assert.deepEqual(validate('courses', { ...base, followupCourseId: null }), []);
    assert.deepEqual(validate('courses', { ...base }), []);
  });
});

// ADR-0064：臨床提醒是自己一份主檔，不是從器材推出來的 ——
// 它沒有東西要「對得上」，因為它什麼都不擋。
describe('臨床提醒主檔（ADR-0064）', () => {
  test('名單只收還在用的，維持主檔上的順序', () => {
    const rows = [
      { name: '血管難打' },
      { name: '第一針', active: false },
      { name: '已刪的', deletedAt: 'x' },
      { name: '怕痛' },
    ];
    assert.deepEqual(clinicalTerms(rows), ['血管難打', '怕痛']);
  });

  test('空的、沒傳的都回空陣列 —— 不要憑空生一個字', () => {
    assert.deepEqual(clinicalTerms([]), []);
    assert.deepEqual(clinicalTerms(), []);
    assert.deepEqual(clinicalTerms([{ name: '   ' }]), []);
  });

  test('名稱太長擋下來 —— 卡片牆上那一排要掃得完', () => {
    assert.deepEqual(validate('clinicalFlags', { name: '血管難打' }), []);
    assert.ok(validate('clinicalFlags', { name: '一二三四五六七八九十一二三' }).length);
  });

  test('同名只講一次，不要兩句在講同一件事', () => {
    const existing = [{ id: 'a', name: '血管難打' }];
    const errors = validate('clinicalFlags', { id: 'b', name: '血管難打' }, { existing });
    assert.equal(errors.length, 1);
  });
});

describe('治療師與醫師（ADR-0026）', () => {
  const STAFF = [
    { id: 'a', name: '騰崴', role: THERAPIST_ROLE },
    { id: 'b', name: '夏', role: DOCTOR_ROLE },
    { id: 'c', name: '許', role: DOCTOR_ROLE },
    { id: 'd', name: '離職的', role: THERAPIST_ROLE, active: false },
    { id: 'e', name: '刪掉的', role: DOCTOR_ROLE, deletedAt: 'x' },
  ];

  test('兩種角色都收得下', () => {
    assert.deepEqual(validate('staff', { name: '夏', role: '醫師' }), []);
    assert.deepEqual(validate('staff', { name: '騰崴', role: '物理治療師' }), []);
    assert.ok(validate('staff', { name: '某人', role: '護理師' }).length);
  });

  test('治療師的選單不會跑出醫師來 —— 選錯人是實際傷害', () => {
    assert.deepEqual(staffWithRole(STAFF, THERAPIST_ROLE).map((s) => s.name), ['騰崴']);
  });

  test('醫師的選單只有醫師', () => {
    assert.deepEqual(staffWithRole(STAFF, DOCTOR_ROLE).map((s) => s.name), ['夏', '許']);
  });

  test('停用與刪除的都不出現在選單裡', () => {
    const all = STAFF_ROLES.flatMap((role) => staffWithRole(STAFF, role));
    assert.ok(!all.some((s) => s.active === false || s.deletedAt));
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

  // ADR-0075：一台也算數（單買一台超磁場就是「這一池裡只有一台」）。
  // 零台仍然擋 —— 那一筆額度排班時沒有器材可以選。
  test('擇一池一台也算數，零台才擋', () => {
    assert.deepEqual(validate('plans', {
      name: 'p', items: [{ type: 'pool', label: 'x', qty: 1, optionEquipmentIds: ['e1'] }],
    }, { courses, equipment }), []);

    const none = validate('plans', {
      name: 'p', items: [{ type: 'pool', label: 'x', qty: 1, optionEquipmentIds: [] }],
    }, { courses, equipment });
    assert.ok(none.some((e) => e.includes('至少要挑一種')));
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

// 2026-09-08 她要的：「取消任何床位區分」。一間就是一個資源。
describe('診間', () => {
  const rooms = [
    { id: 'r1', name: '治3', type: '治療室' },
    { id: 'r2', name: '點滴8', type: '點滴室', shortName: '.8' },
    { id: 'r3', name: '治9', type: '治療室', deletedAt: 'x' },
  ];

  test('一間就是一個資源 —— 床位那一層拿掉了', () => {
    assert.deepEqual(roomSlots(rooms), [
      { roomId: 'r1', bed: null, label: '治3' },
      { roomId: 'r2', bed: null, label: '點滴8' },
    ]);
  });

  // 舊資料上還留著 `beds`，它一個字都不該影響排班時的選項 ——
  // 留著的話「點滴8A」與「點滴8B」還是會冒出來。
  test('舊資料上的 beds 不再攤開', () => {
    const old = [{ id: 'r2', name: '點滴8', type: '點滴室', beds: ['A', 'B'] }];
    assert.deepEqual(roomSlots(old), [{ roomId: 'r2', bed: null, label: '點滴8' }]);
  });

  test('已刪除的診間不會出現', () => {
    assert.ok(!roomSlots(rooms).some((s) => s.roomId === 'r3'));
  });

  test('三種類型，ILIB 室沒有了（那一間有個 4）', () => {
    assert.deepEqual(ROOM_TYPES, ['治療室', '點滴室', 'VIP室']);
  });

  test('簡寫選填，填了有長度上限', () => {
    const base = { name: '點滴2', type: '點滴室' };
    assert.deepEqual(validate('rooms', base, { existing: [] }), []);
    assert.deepEqual(validate('rooms', { ...base, shortName: '.2' }, { existing: [] }), []);
    assert.ok(validate('rooms', { ...base, shortName: '一二三四五六七八九十一二三' },
      { existing: [] }).some((e) => e.includes('別稱')));
  });

  test('床位那一格不再驗 —— 舊資料帶著它也存得下去', () => {
    assert.deepEqual(
      validate('rooms', { name: '點滴8', type: '點滴室', beds: ['A', 'A'] }, { existing: [] }),
      [],
    );
  });

  test('指定的診間 id 蓋過類型規則', () => {
    const course = { assigns: 'room', allowedRoomTypes: ['點滴室'], allowedRoomIds: ['r1'] };
    assert.deepEqual(roomsForCourse(course, rooms).map((r) => r.id), ['r1']);
  });

  test('不選診間的課程回空陣列', () => {
    assert.deepEqual(roomsForCourse({ assigns: 'therapist' }, rooms), []);
  });
});

// 她 2026-09-08：「預約 EECP 時 → 下拉選單優先置頂顯示：治5、治8」。
//
// **這是排序不是限制。** `allowedRoomIds` 是硬的（EECP 只能在治5、治8，
// SPEC 第 7 節規則 2），`preferredRoomIds` 只決定誰排前面 ——
// 兩個欄位回答兩個不同的問題，不可以互相取代。
describe('這個課程的診間怎麼排', () => {
  const rooms = [
    { id: 'iv2', name: '點滴2', type: '點滴室' },
    { id: 'iv10', name: '點滴10', type: '點滴室' },
    { id: 't2', name: '治2', type: '治療室' },
    { id: 't3', name: '治3', type: '治療室' },
    { id: 'gone', name: '治9', type: '治療室', deletedAt: 'x' },
  ];
  const course = (over) => ({
    assigns: 'room', allowedRoomTypes: ['治療室', '點滴室'], allowedRoomIds: [], ...over,
  });

  test('推薦的排最前面，順序照她填的', () => {
    const c = course({ preferredRoomIds: ['iv10', 't2'] });
    assert.deepEqual(orderedRoomsForCourse(c, rooms).map((r) => r.name),
      ['點滴10', '治2', '點滴2', '治3']);
  });

  test('沒填推薦就跟 roomsForCourse() 一模一樣', () => {
    const c = course({});
    assert.deepEqual(orderedRoomsForCourse(c, rooms), roomsForCourse(c, rooms));
  });

  test('推薦裡有一間排不進去的話不出現 —— 也不會因此變成允許', () => {
    const c = course({ allowedRoomTypes: ['點滴室'], preferredRoomIds: ['t2', 'iv10'] });
    assert.deepEqual(orderedRoomsForCourse(c, rooms).map((r) => r.name), ['點滴10', '點滴2']);
  });

  test('推薦裡有一間被刪掉了也不出現', () => {
    const c = course({ preferredRoomIds: ['gone', 't3'] });
    assert.deepEqual(orderedRoomsForCourse(c, rooms).map((r) => r.name),
      ['治3', '點滴2', '點滴10', '治2']);
  });

  test('不選診間的課程還是空的', () => {
    assert.deepEqual(orderedRoomsForCourse({ assigns: 'none', preferredRoomIds: ['t2'] }, rooms), []);
  });

  test('種子上 EECP 與 ILIB 的推薦就是她給的那幾間', () => {
    const byId = Object.fromEntries(SEED.rooms.map((r) => [r.id, r.name]));
    const pref = (id) => (SEED.courses.find((c) => c.id === id).preferredRoomIds ?? [])
      .map((x) => byId[x]);
    assert.deepEqual(pref('course-eecp'), ['治5', '治8']);
    assert.deepEqual(pref('course-iv-laser'), ['點滴10', '治2', '治3']);
  });

  // 兩個畫面都要「排好序的那一份選項 ＋ 每一顆是不是常用」，而它們原本各自
  // 拿 `orderedRoomsForCourse()` 組一次 rank Map、各自對 `roomSlots()` 重排 ——
  // 一邊切 primary/rest、一邊用 Infinity 墊底。同一件事寫了兩次。
  describe('排好序的診間選項', () => {
    const rooms = [
      { id: 'iv2', name: '點滴2', type: '點滴室' },
      { id: 'iv10', name: '點滴10', type: '點滴室' },
      { id: 't2', name: '治2', type: '治療室' },
    ];
    const course = { assigns: 'room', allowedRoomTypes: ['點滴室'], allowedRoomIds: [],
      preferredRoomIds: ['iv10'] };

    test('排得進去的排前面，推薦的又在最前面', () => {
      assert.deepEqual(orderedRoomSlots(course, rooms).map((s) => s.label),
        ['點滴10', '點滴2', '治2']);
    });

    test('每一顆都說得出自己是不是排得進去', () => {
      assert.deepEqual(orderedRoomSlots(course, rooms).map((s) => s.usual),
        [true, true, false]);
    });

    test('帶著 roomSlots() 給的那幾格 —— 呼叫端不用再湊一次', () => {
      const [first] = orderedRoomSlots(course, rooms);
      assert.equal(first.roomId, 'iv10');
      assert.equal(first.bed, null);
    });

    test('不選診間的課程：一顆都排不進去，但選項照樣列得出來', () => {
      const out = orderedRoomSlots({ assigns: 'none' }, rooms);
      assert.equal(out.length, 3);
      assert.deepEqual(out.map((s) => s.usual), [false, false, false]);
    });

    test('沒有診間就是空的', () => {
      assert.deepEqual(orderedRoomSlots(course, []), []);
    });
  });

  // 兩個入口各排一次的話，同一個課程在兩個畫面上第一顆丸子不一樣。
  test('壓表與來訪編輯器都走同一支排序', () => {
    for (const rel of ['js/ui/views/schedule.js', 'js/ui/views/visitEditor.js']) {
      const src = readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
      assert.match(src, /orderedRoomSlots\(/, `${rel} 沒有走排序那一支`);
      // 自己組 rank Map、自己對 roomSlots() 重排，就是把一半的排序搬回畫面
      assert.ok(!/roomSlots\(all\.rooms\)/.test(src), `${rel} 還在自己攤平診間`);
      assert.ok(
        !/orderedRoomsForCourse\(/.test(src.replace(/orderedRoomSlots\(/g, '')),
        `${rel} 還在自己排一次 —— 順序會跟另一頁不一樣`,
      );
    }
  });

  test('推薦診間只有選診間的課程才能設', () => {
    const bad = {
      name: 'X', durationMin: 30, category: 'C', assigns: 'therapist',
      allowedRoomTypes: [], allowedRoomIds: [], preferredRoomIds: ['t2'],
    };
    assert.ok(validate('courses', bad, { existing: [] }).some((e) => e.includes('診間')));
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

  // 她 2026-09-08 給的清單。**都沒有 4 號**，而簡寫裡的數字就是房號。
  test('診間就是她列的那三種、那幾間', () => {
    const of = (type) => SEED.rooms.filter((r) => r.type === type).map((r) => r.name);
    assert.deepEqual(of('治療室'), ['治2', '治3', '治5', '治8']);
    assert.deepEqual(of('點滴室'),
      ['點滴2', '點滴3', '點滴5', '點滴6', '點滴7', '點滴8', '點滴9', '點滴10']);
    assert.deepEqual(of('VIP室'), ['VIP2', 'VIP3', 'VIP5', 'VIP6', 'VIP7']);
    assert.equal(SEED.rooms.length, 17);
  });

  test('一間 4 號都沒有', () => {
    for (const r of SEED.rooms) {
      assert.ok(!/4/.test(r.name), `${r.name} 有 4`);
      assert.ok(!/4/.test(r.shortName ?? ''), `${r.name} 的簡寫有 4`);
    }
  });

  test('簡寫裡的數字就是房號', () => {
    const short = Object.fromEntries(SEED.rooms.map((r) => [r.name, r.shortName ?? r.name]));
    assert.equal(short['點滴2'], '.2');
    assert.equal(short['點滴10'], '.10');
    assert.equal(short['VIP7'], 'vip7');
    assert.equal(short['治8'], '治8', '治療室本來就夠短，不必有簡寫');
  });

  test('一間都沒有床位', () => {
    assert.ok(SEED.rooms.every((r) => !(r.beds ?? []).length));
  });

  test('ILIB 那個課程不再指著一個不存在的類型', () => {
    const ilib = SEED.courses.find((c) => c.id === 'course-iv-laser');
    for (const type of ilib.allowedRoomTypes) assert.ok(ROOM_TYPES.includes(type), type);
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

  test('復能選治療師且要選器材，ILIB 選診間且不用器材', () => {
    const recovery = SEED.courses.find((c) => c.name === '復能');
    assert.equal(recovery.assigns, 'therapist');
    assert.equal(recovery.requiresEquipment, true);

    const ilib = SEED.courses.find((c) => c.name === 'ILIB');
    assert.equal(ilib.assigns, 'room');
    assert.equal(ilib.requiresEquipment, false);
  });

  // ADR-0075：四選一是一筆額度、四台器材，而它們要的資源不一樣。
  test('每一台器材都指得到一個活著的課程', () => {
    for (const eq of SEED.equipment) {
      assert.ok(eq.courseId, `${eq.name} 沒有指到課程`);
      assert.ok(SEED.courses.some((c) => c.id === eq.courseId), `${eq.name} 指到不存在的課程`);
    }
  });

  test('ILIB 那一台指到 ILIB 課程，其餘三台指到復能', () => {
    const courseOf = (name) => SEED.equipment.find((e) => e.name === name).courseId;
    assert.equal(courseOf('ILIB'), 'course-iv-laser');
    for (const name of ['INDIBA', 'SIS', '高能量雷射']) {
      assert.equal(courseOf(name), 'course-recovery');
    }
  });

  test('種子資料有夏、許、李三位醫師，而且和治療師分得開', () => {
    const doctors = SEED.staff.filter((s) => s.role === DOCTOR_ROLE).map((s) => s.name);
    assert.deepEqual(doctors.sort(), ['夏', '李', '許'].sort());
    // 治療師那份名單一個醫師都不能混進去 —— 復能三器材要的是物理治療師
    const therapists = staffWithRole(SEED.staff, THERAPIST_ROLE);
    assert.ok(therapists.length >= 9);
    assert.ok(!therapists.some((s) => doctors.includes(s.name)));
  });

  test('只有二返預設要選醫師，其餘課程她想開再開', () => {
    const withDoctor = SEED.courses.filter((c) => c.requiresDoctor).map((c) => c.name);
    assert.deepEqual(withDoctor, ['二返']);
  });

  // 「需要醫師：門診類」這一條**一行程式都沒有改** —— A 類一律選得到
  // （`picksDoctor()`，ADR-0058）。而「一行都沒改」正是最容易沒有人盯的那種：
  // 有人把它改回「只看 requiresDoctor」的話，復健科與心臟科會安靜地選不到醫師。
  test('A 類一律選得到醫師，不用逐課程勾', () => {
    for (const c of SEED.courses.filter((x) => x.category === 'A')) {
      assert.equal(picksDoctor(c), true, c.name);
    }
    assert.equal(picksDoctor({ category: 'A' }), true, '連旗標都沒有也算');
    assert.equal(picksDoctor({ category: 'C', requiresDoctor: true }), true, '旗標是非 A 類的例外開關');
    assert.equal(picksDoctor({ category: 'C' }), false);
    assert.equal(picksDoctor({ category: null }), false);
    assert.equal(picksDoctor(null), false);
  });

  // 醫師走的是 `requiresDoctor` / `picksDoctor()` 那條路，不是 `assigns`
  // —— `assigns` 是單選的，而一段可以同時要空間和醫師（ADR-0026、0058）。
  test('醫師不塞進單選的 assigns', () => {
    const followup = SEED.courses.find((c) => c.name === '二返');
    assert.equal(followup.requiresDoctor, true);
    assert.ok(!ASSIGNS.includes('doctor'));
    assert.deepEqual(SEED.courses.filter((c) => c.assigns === 'doctor'), []);
  });

  // 她 2026-09-08 的三條規則。**這一張表就是那三條規則的白紙黑字版** ——
  // 種子改錯一格，她建的新資料庫就會在壓表時問她一個不該問的問題。
  //
  //   物理治療師  復能（多選一選到 INDIBA／SIS／高能量雷射 時也算）
  //   治療室      營養點滴、EECP、ILIB
  //   醫師        門診類（A 類一律選得到）
  //   都不用      體適能、身體組成分析、營養諮詢、健檢、門診
  test('每一個課程要指派什麼', () => {
    const want = {
      'course-recovery': 'therapist',
      'course-pt-consult': 'therapist',
      'course-iv-drip': 'room',
      'course-eecp': 'room',
      'course-iv-laser': 'room',
      'course-checkup': 'none',
      'course-fitness': 'none',
      'course-inbody': 'none',
      'course-nutrition-consult': 'none',
      'course-rehab': 'none',
      'course-followup': 'none',
      'course-cardio': 'none',
    };
    const got = Object.fromEntries(SEED.courses.map((c) => [c.id, c.assigns]));
    assert.deepEqual(got, want);
  });

  // `validate('courses')` 擋著「不選診間的課程不該設定診間限制」——
  // 改了 assigns 卻忘了清那兩格的話，種子本身就存不下去。
  test('不指派空間的課程身上沒有診間限制', () => {
    for (const c of SEED.courses) {
      if (c.assigns === 'room') continue;
      assert.deepEqual((c.allowedRoomTypes ?? []), [], `${c.name} 還留著診間類型`);
      assert.deepEqual((c.allowedRoomIds ?? []), [], `${c.name} 還留著指定診間`);
    }
  });

  test('種子的每一個課程都通得過驗證', () => {
    for (const c of SEED.courses) {
      const { id, ...row } = c;
      assert.deepEqual(
        validate('courses', { id, ...row }, { existing: SEED.courses, courses: SEED.courses }),
        [], `${c.name} 存不下去`,
      );
    }
  });

  test('體內金屬只提醒 SIS 與高能量雷射', () => {
    const blocked = SEED.equipment
      .filter((e) => e.contraindications.includes('體內金屬'))
      .map((e) => e.name);
    assert.deepEqual(blocked.sort(), ['SIS', '高能量雷射'].sort());
  });

  test('兩個方案的復能與 ILIB 次數相反，這是正常的', () => {
    const qty = (planName, label) =>
      SEED.plans.find((p) => p.name === planName).items.find((i) => i.label === label).qty;
    assert.equal(qty('筋骨強身', '復能-三選一(60)'), 12);
    assert.equal(qty('筋骨強身', 'ILIB(60)'), 20);
    assert.equal(qty('8萬方案', '復能-三選一(60)'), 20);
    assert.equal(qty('8萬方案', 'ILIB(60)'), 12);
  });

  test('復能與 ILIB 都給得出 30 與 60 兩種規格', () => {
    for (const name of ['復能', 'ILIB']) {
      const c = SEED.courses.find((x) => x.name === name);
      assert.deepEqual(c.durationChoices, [30, 60], `${name} 少了可選時長`);
      assert.ok(c.durationChoices.includes(c.durationMin));
    }
  });

  test('其餘課程沒有可選時長 —— 永遠不會被按的丸子只是噪音', () => {
    const others = SEED.courses.filter((c) => !['復能', 'ILIB'].includes(c.name));
    assert.ok(others.every((c) => !c.durationChoices?.length));
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

  test('C 類課程確認後沒有後續登記 —— 壓表就是 Abovee 那一件', () => {
    const cCourses = SEED.courses.filter((c) => c.category === 'C');
    assert.ok(cCourses.length >= 4);
    for (const c of cCourses) {
      assert.deepEqual(tasksForCategory(c.category), [], `${c.name} 不該有後續登記`);
      assert.equal(bookingSystemFor(c.category), 'Abovee');
    }
  });

  test('健檢壓在 Examine，其餘全部壓在 Abovee', () => {
    for (const c of SEED.courses) {
      assert.equal(
        bookingSystemFor(c.category),
        c.category === 'B' ? 'Examine' : 'Abovee',
        c.name,
      );
    }
  });

  test('「要不要簽療程單」只能是是或否 —— 字串會被判成「要簽」', () => {
    const base = SEED.courses.find((c) => c.id === 'course-recovery');
    assert.deepEqual(validate('courses', { ...base, needsTreatmentForm: false }), []);
    assert.deepEqual(validate('courses', { ...base, needsTreatmentForm: undefined }), []);
    assert.ok(validate('courses', { ...base, needsTreatmentForm: 'false' }).length,
      '存成字串的話 needsForm() 會回「要簽」，而她明明關掉了');
  });

  test('除了二返，種子課程全部都要簽療程單', () => {
    for (const c of SEED.courses) {
      assert.equal(
        needsForm(c),
        c.id !== 'course-followup',
        `${c.name} 的簽單設定不對`,
      );
    }
  });

  test('預設排序權重與 SPEC 第 9 節一致', () => {
    assert.deepEqual(DEFAULT_SETTINGS.sortWeights, { w1: 1.0, w2: 0.8, w3: 0.6, w4: 0.3 });
    assert.equal(DEFAULT_SETTINGS.slotGapMin, 15);
  });
});

describe('類別說明', () => {
  test('每個類別都說得出壓表在哪、確認後還要做什麼', () => {
    assert.match(describeCategory('A'), /Abovee 壓表.*Examine.*耀聖/);
    assert.match(describeCategory('B'), /Examine 壓表/);
    assert.match(describeCategory('C'), /Abovee 壓表.*沒有後續登記/);
    assert.ok(!describeCategory('C').includes('打電話'));
  });

  test('沒有後續登記要明講，不是空白', () => {
    for (const category of [null, undefined]) {
      assert.match(describeCategory(category), /^不用掛號 — Abovee 壓表，確認後沒有後續登記$/);
    }
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
          planItem({ type: 'pool', label: '復能', qty: 12, optionEquipmentIds: [] }),
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


// 2026-09-04 她問的：「我營養點滴如果一開始加購的是 A，但是我排來訪的時候，
// 選營養點滴還能排到其他 BCD？」壓表與來訪編輯器兩個入口讀的是這一支。
describe('排班時營養點滴給哪幾顆（ivChoicesFor）', () => {
  const PRODUCTS = [
    { id: 'iv-a', name: 'A' },
    { id: 'iv-b', name: 'B' },
    { id: 'iv-c', name: 'C', active: false },
    { id: 'iv-d', name: 'D', deletedAt: '2026-01-01' },
  ];

  test('買的那一款排第一顆，其餘的收在後面', () => {
    const { bought, primary, others } = ivChoicesFor({ ivProductId: 'iv-a' }, PRODUCTS);
    assert.equal(bought.name, 'A');
    assert.deepEqual(primary.map((p) => p.id), ['iv-a']);
    assert.deepEqual(others.map((p) => p.id), ['iv-b'], '停用與已刪除的不列');
  });

  test('額度上沒有品項（舊資料、n返）→ 全部列出來，一顆都不收', () => {
    const { bought, primary, others } = ivChoicesFor({}, PRODUCTS);
    assert.equal(bought, null);
    assert.deepEqual(primary.map((p) => p.id), ['iv-a', 'iv-b']);
    assert.deepEqual(others, []);
  });

  test('買的那一款被停用了照樣要出現 —— 那一筆額度上寫的就是它', () => {
    const { bought, primary, others } = ivChoicesFor({ ivProductId: 'iv-c' }, PRODUCTS);
    assert.equal(bought.name, 'C');
    assert.deepEqual(primary.map((p) => p.id), ['iv-c']);
    assert.deepEqual(others.map((p) => p.id), ['iv-a', 'iv-b']);
  });

  test('買的那一款在主檔裡整個不見了 → 講不出它叫什麼，退回全部列出來', () => {
    const { bought, primary } = ivChoicesFor({ ivProductId: 'iv-gone' }, PRODUCTS);
    assert.equal(bought, null);
    assert.deepEqual(primary.map((p) => p.id), ['iv-a', 'iv-b']);
  });

  test('沒有額度、沒有主檔也不會炸', () => {
    assert.deepEqual(ivChoicesFor(null, []), {
      boughtId: null, bought: null, primary: [], others: [],
    });
  });
});


// ADR-0076
describe('合作機構主檔', () => {
  test('名字不可空白、最多 12 字', () => {
    assert.deepEqual(validate('partners', { name: '自然美' }, { existing: [] }), []);
    assert.ok(validate('partners', { name: '  ' }, { existing: [] }).length);
    assert.ok(validate('partners', { name: '一二三四五六七八九十一二三' }, { existing: [] })
      .some((e) => e.includes('12 字')));
  });

  test('同名擋得下來', () => {
    const existing = [{ id: 'a', name: '自然美' }];
    assert.ok(validate('partners', { id: 'b', name: '自然美' }, { existing }).length);
  });

  test('名單只收還在用的，維持主檔順序', () => {
    assert.deepEqual(partnerNames([
      { name: '自然美' },
      { name: '停用的', active: false },
      { name: '刪掉的', deletedAt: 'x' },
      { name: '  ' },
    ]), ['自然美']);
    assert.deepEqual(partnerNames([]), []);
    assert.deepEqual(partnerNames(), []);
  });

  test('種子有自然美，而且它進得了主檔清單', () => {
    assert.deepEqual(SEED.partners.map((p) => p.name), ['自然美']);
    assert.ok(MASTER_TYPES.includes('partners'));
    assert.equal(MASTER_LABELS.partners, '合作機構');
  });
});
