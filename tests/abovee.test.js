// Abovee 上的寫法 → app 主檔（issue 12）。
//
// Abovee 右半邊跟 app 主檔講的是同一批東西，寫法不一樣：服務資源是治療師的**全名**、
// 醫師的全名，診間是「治療室5」，課程是「SIS 60」。
//
// **這一支有沒有任何一條路，讓一個 Abovee 上的名字被認成兩位裡面的某一位、而她沒選？** —— 沒有：
// 符合的零位或好幾位一律 null。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { aliasWrites, courseFrom, roomFrom, staffFrom, staffRoleFor } from '../public/js/domain/abovee.js';
import { SEED } from '../public/js/domain/seed.js';
import { validate } from '../public/js/domain/masterData.js';

const STAFF = [
  { id: 's-fang', name: '小芳', role: '物理治療師' },
  { id: 's-lulu', name: 'LuLu', role: '物理治療師', aboveeNames: ['陳露露'] },
  { id: 's-xia', name: '夏', role: '醫師' },
  { id: 's-xia-pt', name: '夏', role: '物理治療師', deletedAt: '2026-01-01' },
];

describe('服務資源 → 治療師／醫師', () => {
  test('治療師名字是全名的結尾：陳小芳 → 小芳', () => {
    assert.equal(staffFrom('陳小芳', STAFF)?.id, 's-fang');
  });

  test('另一位的名字也是結尾（芳）→ 兩位都符合，null', () => {
    assert.equal(staffFrom('陳小芳', [...STAFF, { id: 's-f', name: '芳', role: '物理治療師' }]), null);
  });

  test('記住的寫法完全相同 → 直接對上，不管結尾規則', () => {
    assert.equal(staffFrom('陳露露', STAFF)?.id, 's-lulu');
    assert.equal(staffFrom(' 陳露露 ', STAFF)?.id, 's-lulu');
    // 記住的寫法贏過結尾規則：另一位叫「露露」也不會搶走
    assert.equal(staffFrom('陳露露', [...STAFF, { id: 's-ll', name: '露露', role: '物理治療師' }])?.id, 's-lulu');
  });

  test('醫師的姓是全名的開頭：夏OO → 夏（醫師）；治療師的「夏」不算開頭', () => {
    assert.equal(staffFrom('夏大同', STAFF)?.id, 's-xia');
    assert.equal(staffFrom('夏大同', [{ id: 'pt', name: '夏', role: '物理治療師' }]), null);
  });

  test('認不出來、空白、已刪除的 → null', () => {
    assert.equal(staffFrom('王大明', STAFF), null);
    assert.equal(staffFrom('', STAFF), null);
    assert.equal(staffFrom('林夏', [{ id: 'gone', name: '夏', role: '物理治療師', deletedAt: 'x' }]), null);
  });
});

describe('診間／服務資源 → 診間', () => {
  const rooms = SEED.rooms;
  test('治療室5 → 治5；點滴室10 → 點滴10；VIP室3 → VIP3', () => {
    assert.equal(roomFrom('治療室5', '', rooms)?.id, 'room-t5');
    assert.equal(roomFrom('點滴室10', '', rooms)?.id, 'room-iv10');
    assert.equal(roomFrom('VIP室3', '', rooms)?.id, 'room-vip3');
  });

  test('診間那一格空著 → 看服務資源的房間部分：I1點10 → 點滴10、I2治2 → 治2', () => {
    assert.equal(roomFrom('', 'I1點10', rooms)?.id, 'room-iv10');
    assert.equal(roomFrom('', 'I2治2', rooms)?.id, 'room-t2');
  });

  test('認不出來 → null（EECP1 是機器不是房間）', () => {
    assert.equal(roomFrom('', 'EECP1', rooms), null);
    assert.equal(roomFrom('會議室', '', rooms), null);
  });
});

describe('課程那一格 → 課程、器材、分鐘', () => {
  const master = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts };
  const plain = { ivProductId: null, nth: null, uncounted: false };

  test('SIS 60 → 復能、SIS、60', () => {
    assert.deepEqual(courseFrom('SIS 60', master), { courseId: 'course-recovery', equipmentId: 'eq-sis', durationMin: 60, ...plain });
  });

  test('ILIB 60 → ILIB 課程（也帶著那一台，四選一要它）', () => {
    assert.deepEqual(courseFrom('ILIB 60', master), { courseId: 'course-iv-laser', equipmentId: 'eq-ilib', durationMin: 60, ...plain });
  });

  test('EECP60、二返60 → 課程、分鐘；INDIBA 30 → 復能', () => {
    assert.deepEqual(courseFrom('EECP60', master), { courseId: 'course-eecp', equipmentId: null, durationMin: 60, ...plain });
    assert.deepEqual(courseFrom('二返60', master), { courseId: 'course-followup', equipmentId: null, durationMin: 60, ...plain });
    assert.equal(courseFrom('INDIBA 30', master)?.equipmentId, 'eq-indiba');
  });

  test('XYZ 30、空白 → null', () => {
    assert.equal(courseFrom('XYZ 30', master), null);
    assert.equal(courseFrom('', master), null);
  });
});

describe('她替認不出來的寫法選了人 → 記住', () => {
  test('每一位一筆，接在原本的後面；已經認得的、已經記著的不再寫', () => {
    const writes = aliasWrites([
      { text: '陳小芳', staffId: 's-fang' }, // 結尾規則本來就認得 → 不寫
      { text: '林芳芳', staffId: 's-fang' },
      { text: '陳露', staffId: 's-lulu' },
      { text: '陳露露', staffId: 's-lulu' }, // 已經記著
      { text: '林芳芳', staffId: 's-fang' }, // 同一個選了兩次
    ], STAFF);
    assert.deepEqual(writes, [
      { id: 's-fang', name: '小芳', changes: { aboveeNames: ['林芳芳'] } },
      { id: 's-lulu', name: 'LuLu', changes: { aboveeNames: ['陳露露', '陳露'] } },
    ]);
  });

  test('那個寫法已經是別人的 → 不寫（兩位不可以同一個寫法）', () => {
    assert.deepEqual(aliasWrites([{ text: '陳露露', staffId: 's-fang' }], STAFF), []);
  });
});

// ---------- abovee-and-master-2026-10-05/07：主檔記住 Abovee 怎麼寫、認得課程／品項／診間／人 ----------

describe('07 服務資源分角色認人', () => {
  // 治療師「小芳」與醫師「李」都在：全名「李小芳」兩條規則都符合（結尾是小芳、開頭是李）
  const staff = [
    { id: 's-fang', name: '小芳', role: '物理治療師' },
    { id: 's-li', name: '李', role: '醫師' },
  ];
  const master = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts };

  test('不知道角色 → 兩位都符合，照舊 null（不猜）', () => {
    assert.equal(staffFrom('李小芳', staff), null);
  });

  test('復能那一列（要治療師）→ 小芳；二返那一列（要醫師）→ 李', () => {
    const recovery = courseFrom('SIS 60', master);
    const followup = courseFrom('二返30', master);
    assert.equal(staffRoleFor(recovery, master), '物理治療師');
    assert.equal(staffRoleFor(followup, master), '醫師');
    assert.equal(staffFrom('李小芳', staff, { role: staffRoleFor(recovery, master) })?.id, 's-fang');
    assert.equal(staffFrom('李大同', staff, { role: staffRoleFor(followup, master) })?.id, 's-li');
  });

  test('分了角色，記住的寫法也只在那一種人裡找', () => {
    const both = [...staff, { id: 's-x', name: '阿光', role: '物理治療師', aboveeNames: ['李大同'] }];
    assert.equal(staffFrom('李大同', both, { role: '醫師' })?.id, 's-li');
    assert.equal(staffFrom('李大同', both, { role: '物理治療師' })?.id, 's-x');
  });

  test('ILIB、EECP、營養點滴（要診間）、認不出的課程 → 不分角色', () => {
    assert.equal(staffRoleFor(courseFrom('ILIB 60', master), master), null);
    assert.equal(staffRoleFor(courseFrom('EECP60', master), master), null);
    assert.equal(staffRoleFor(courseFrom('腸道修復', master), master), null);
    assert.equal(staffRoleFor(null, master), null);
  });

  test('任選60（擇一池還沒選哪一台）照樣是治療師', () => {
    assert.equal(staffRoleFor(courseFrom('任選60', master), master), '物理治療師');
  });
});

describe('07 診間與服務資源裡的房間', () => {
  const rooms = SEED.rooms;
  // 2026-10-06 之前這三種寫法都拿掉床位認成點滴8。床位那兩間現在是各自的診間（ADR-0127），
  // 所以帶著床位的認成那一間；細節（沒寫床的、還沒按資料健檢的資料庫）在 `tests/bed-rooms.test.js`
  test('帶著床位的認成那一間：點滴室8床A → 點滴8A、點滴室8床B → 點滴8B；服務資源 點滴8A → 點滴8A', () => {
    assert.equal(roomFrom('點滴室8床A', 'ILIB4', rooms)?.id, 'room-iv8a');
    assert.equal(roomFrom('點滴室8床B', 'ILIB5', rooms)?.id, 'room-iv8b');
    assert.equal(roomFrom(null, '點滴8A', rooms)?.id, 'room-iv8a');
  });

  test('營養點滴那一列：診間空著、服務資源就是房間（點滴5、4樓休2 → VIP2）', () => {
    assert.equal(roomFrom(null, '點滴5', rooms)?.id, 'room-iv5');
    assert.equal(roomFrom('', '4樓休2', rooms)?.id, 'room-vip2');
  });

  test('休息室N → VIPN', () => {
    assert.equal(roomFrom('休息室3', '', rooms)?.id, 'room-vip3');
  });

  test('機器不是房間：ILIB5、EECP2 → null；人名 → null', () => {
    assert.equal(roomFrom('', 'ILIB5', rooms), null);
    assert.equal(roomFrom('', 'EECP2', rooms), null);
    assert.equal(roomFrom('', '陳小芳', rooms), null);
  });

  test('她在設定把一間的 Abovee 寫法填成「4樓休2」→ 認成那一間（記住的寫法先比）', () => {
    const mine = rooms.map((r) => (r.id === 'room-vip5' ? { ...r, aboveeNames: ['4樓休2'] } : r));
    assert.equal(roomFrom('', '4樓休2', mine)?.id, 'room-vip5');
  });

  test('兩間填同一個寫法 → 存不下去', () => {
    const existing = rooms.map((r) => (r.id === 'room-vip5' ? { ...r, aboveeNames: ['4樓休2'] } : r));
    const errors = validate('rooms', { ...rooms.find((r) => r.id === 'room-vip6'), aboveeNames: ['4樓休 2'] }, { existing });
    assert.ok(errors.some((e) => e.includes('「4樓休 2」已經是「VIP5」的了')), errors.join('；'));
  });
});

describe('07 課程那一格：品項、Abovee 寫法、三返、任選', () => {
  // 功醫門診與羊膜種子還沒有（issue 12 才補）—— 這裡用夾具，形狀照 12 要建的
  const extra = [
    { id: 'course-fm', name: '功醫門診', group: '醫師門診', durationMin: 30, assigns: 'none', doctorPick: '功能／二返', uncounted: true, aboveeNames: ['功醫門診'] },
    { id: 'course-amnion', name: '羊膜', group: '醫師門診', durationMin: 30, assigns: 'none', doctorPick: '復健科', aboveeNames: ['羊膜'] },
  ];
  const master = { courses: [...SEED.courses, ...extra], equipment: SEED.equipment, ivProducts: SEED.ivProducts };
  const at = (text) => {
    const r = courseFrom(text, master);
    return r && [r.courseId, r.equipmentId, r.ivProductId, r.durationMin, r.nth, r.uncounted];
  };

  test('EECP20 → EECP 體驗（整格比對、在拆分鐘之前）；EECP60 → EECP', () => {
    assert.deepEqual(at('EECP20'), ['course-eecp-trial', null, null, null, null, false]);
    assert.deepEqual(at('EECP60'), ['course-eecp', null, null, 60, null, false]);
  });

  test('二返60 → 二返＋60；三返30／三返60 → n返、第三返（借二返的課程）', () => {
    assert.deepEqual(at('二返60'), ['course-followup', null, null, 60, null, false]);
    assert.deepEqual(at('三返30'), ['course-followup', null, null, 30, 3, false]);
    assert.deepEqual(at('三返60'), ['course-followup', null, null, 60, 3, false]);
    assert.deepEqual(at('四返'), ['course-followup', null, null, null, 4, false]);
  });

  test('任選60 → 復能池、還沒選哪一台、60；高能量60 → 高能量雷射', () => {
    assert.deepEqual(at('任選60'), ['course-recovery', null, null, 60, null, false]);
    assert.deepEqual(at('高能量60'), ['course-recovery', 'eq-laser', null, 60, null, false]);
  });

  test('腸道修復、護肝排毒 → 營養點滴＋那一款；雪顏亮采 → 雪顏亮彩', () => {
    assert.deepEqual(at('腸道修復'), ['course-iv-drip', null, 'iv-gut', null, null, false]);
    assert.deepEqual(at('護肝排毒'), ['course-iv-drip', null, 'iv-liver', null, null, false]);
    assert.deepEqual(at('雪顏亮采'), ['course-iv-drip', null, 'iv-snow', null, null, false]);
  });

  test('功醫門診 → 那門課、不算次數；羊膜 → 那門課', () => {
    assert.deepEqual(at('功醫門診'), ['course-fm', null, null, null, null, true]);
    assert.deepEqual(at('羊膜'), ['course-amnion', null, null, null, null, false]);
  });

  test('心臟門診、復健門診、體適能、身體組成、營養諮詢 → 主檔那門課', () => {
    assert.equal(at('心臟門診')[0], 'course-cardio');
    assert.equal(at('復健門診')[0], 'course-rehab');
    assert.equal(at('體適能')[0], 'course-fitness');
    assert.equal(at('身體組成')[0], 'course-inbody');
    assert.equal(at('營養諮詢')[0], 'course-nutrition-consult');
  });

  test('Abovee 那 353 筆的課程那一格，每一種寫法都認得（去掉人名的那一份）', () => {
    const SEEN = [
      '復健門診', 'SIS 30', '任選60', 'SIS 60', 'ILIB 60', '高能量60', '心臟門診', 'EECP60', 'IN 30', 'IN 60',
      '二返60', '二返30', '護肝排毒', '腸道修復', '雪顏亮采', 'EECP20', 'ILIB 30', '功醫門診', '體適能', '羊膜',
    ];
    assert.deepEqual(SEEN.filter((t) => !courseFrom(t, master)), []);
  });

  test('寫法跟著那一筆走：她把高能量雷射改名，高能量60 照樣認得', () => {
    const renamed = SEED.equipment.map((e) => (e.id === 'eq-laser' ? { ...e, name: '高能雷射二代' } : e));
    assert.equal(courseFrom('高能量60', { ...master, equipment: renamed })?.equipmentId, 'eq-laser');
  });

  test('跨種撞同一個寫法：品項 → 器材 → 課程（越具體越先）', () => {
    const iv = [...SEED.ivProducts, { id: 'iv-x', name: '某一款', aboveeNames: ['同一個字'] }];
    const courses = [...master.courses, { id: 'course-x', name: '某一門', durationMin: 30, assigns: 'none', aboveeNames: ['同一個字'] }];
    assert.equal(courseFrom('同一個字', { ...master, ivProducts: iv, courses })?.ivProductId, 'iv-x');
  });

  // 這一條本來拿 HRV 當認不出來的例子；2026-10-06 種子有 HRV 這門課了，換一個主檔沒有的字
  test('認不出來 → null，不猜（主檔沒有的字、空白）', () => {
    assert.equal(courseFrom('大腸鏡', master), null);
    assert.equal(courseFrom('   ', master), null);
  });

  test('四種主檔：同一種裡兩筆同一個寫法存不下去；跨種不擋', () => {
    const existing = SEED.courses;
    assert.ok(validate('courses', { ...SEED.courses.find((c) => c.id === 'course-rehab'), aboveeNames: ['心臟門診'] }, { existing })
      .some((e) => e.includes('已經是「心臟科評估」的了')));
    assert.ok(validate('equipment', { ...SEED.equipment.find((e) => e.id === 'eq-sis'), aboveeNames: ['IN'] }, { existing: SEED.equipment, courses: SEED.courses })
      .some((e) => e.includes('已經是「INDIBA」的了')));
    assert.ok(validate('ivProducts', { id: 'iv-new', name: '新的一款', aboveeNames: ['雪顏亮采'] }, { existing: SEED.ivProducts })
      .some((e) => e.includes('已經是「雪顏亮彩」的了')));
    assert.deepEqual(validate('ivProducts', { id: 'iv-new', name: '新的一款', aboveeNames: ['IN'] }, { existing: SEED.ivProducts }), []);
  });
});
