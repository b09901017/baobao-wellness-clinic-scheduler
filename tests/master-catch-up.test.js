// 主檔補齊：種子跟上 Abovee，既有資料庫走資料健檢補（2026-10-05，abovee-and-master/12，ADR-0124）。
//
// 她的原話：
//
// > 二、主檔補齊到跟 Abovee 一樣。診間、13 款營養點滴、治療師、醫師、課程。
// > 其他課程我自己也不熟，所以設計要讓我之後自己加得進去、改得動，不要現在一次建滿。
// > 功醫門診：跟二返不同；不算次數、不簽療程單、不寫紀錄；三個系統都要壓；要選醫師
// > 羊膜：加購（有次數，像營養針）；選復健科醫師（只有一位）；要簽療程單
// > （2026-10-06）羊膜：先預設和營養針一樣，然後是預設選復建科醫師
// > （治7）加回去
// > （皮蛇疫苗）先預設30分鐘 ? 但是要可以修改
//
// `loadSeed()` 只建不覆蓋，所以種子上每一個改動都配一列資料健檢：**她那一格還是原樣／空的才報，
// 她改過的不動，按了才寫**。這一支盯兩邊：種子本身，與四種既有資料庫各會看到什麼。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runHealthCheck, CHECKS } from '../public/js/domain/health.js';
import { SEED } from '../public/js/domain/seed.js';
import {
  validate, roomsForCourse, orderedRoomsForCourse, isUncounted, doctorRuleOf, groupOf, MASTER_TYPES,
} from '../public/js/domain/masterData.js';
import { systemsOf, tasksForCourse } from '../public/js/domain/taskRules.js';
import { needsForm, slotMinutes } from '../public/js/domain/visits.js';
import { courseFrom } from '../public/js/domain/abovee.js';

const TODAY = '2026-10-05';
const course = (id) => SEED.courses.find((c) => c.id === id);
const iv = (name) => SEED.ivProducts.find((p) => p.name === name);

/** 一份完整的種子主檔，改其中幾筆。`over` 是 { 種類: (rows) => rows }。 */
function master(over = {}) {
  const out = {};
  for (const type of ['courses', 'rooms', 'staff', 'equipment', 'ivProducts', 'clinicalFlags']) {
    const rows = structuredClone(SEED[type] ?? []);
    out[type] = over[type] ? over[type](rows) : rows;
  }
  return out;
}
const patch = (id, fn) => (rows) => rows.map((r) => (r.id === id ? fn(r) : r));
const drop = (...ids) => (rows) => rows.filter((r) => !ids.includes(r.id));
const without = (r, ...keys) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));

const run = (m) => runHealthCheck({
  customers: [], entitlements: [], visits: [], tasks: [], availability: [], master: m,
}, TODAY);
const of = (result, id) => result.checks.find((c) => c.id === id).findings;
const allFindings = (result) => result.checks.flatMap((c) => c.findings.map((f) => `${c.id}：${f.title}`));

describe('種子：跟 Abovee 一樣的那幾樣', () => {
  test('點滴 14 款：Abovee 的 13 款＋她自己的 NAC 愛咳痰', () => {
    const names = SEED.ivProducts.map((p) => p.name);
    for (const n of ['元氣活力', '免疫馥活', '減脂健康', '營養守護', '癒原養方', '養心舒眠', '皮蛇疫苗']) {
      assert.ok(names.includes(n), `少了 ${n}`);
    }
    assert.ok(names.includes('NAC 愛咳痰'), 'NAC 愛咳痰留著不動');
    assert.equal(names.length, 14);
  });

  test('皮蛇疫苗 30 分（一針，不是兩小時的點滴）；其餘新的六款跟著營養點滴走', () => {
    assert.equal(iv('皮蛇疫苗').durationMin, 30);
    for (const n of ['元氣活力', '免疫馥活', '減脂健康', '營養守護', '癒原養方', '養心舒眠']) {
      assert.equal(iv(n).durationMin, undefined, n);
    }
    const drip = course('course-iv-drip');
    const mins = (p) => slotMinutes({ course: drip, ivProduct: p, entitlement: null });
    assert.equal(mins(iv('皮蛇疫苗')), 30);
    assert.equal(mins(iv('元氣活力')), 120);
  });

  test('治7 回來了，EECP 與體驗課可以排治5／治7／治8', () => {
    const t7 = SEED.rooms.find((r) => r.id === 'room-t7');
    assert.deepEqual([t7?.name, t7?.type], ['治7', '治療室']);
    for (const id of ['course-eecp', 'course-eecp-trial']) {
      assert.deepEqual(roomsForCourse(course(id), SEED.rooms).map((r) => r.name), ['治5', '治7', '治8'], id);
      assert.deepEqual(orderedRoomsForCourse(course(id), SEED.rooms).map((r) => r.name), ['治5', '治7', '治8'], id);
    }
  });

  test('EECP 體驗 20 分（Abovee 的 EECP20）', () => {
    assert.equal(course('course-eecp-trial').durationMin, 20);
    assert.equal(course('course-eecp').durationMin, 60);
  });

  test('功醫門診：不算次數、三個系統、功能／二返的醫師、不簽療程單、不寫紀錄、不用指派、30 分', () => {
    const fm = course('course-fm');
    assert.equal(fm.name, '功醫門診');
    assert.equal(groupOf(fm), '醫師門診');
    assert.equal(isUncounted(fm), true);
    assert.deepEqual(systemsOf(fm), ['Abovee', 'Examine', '耀聖']);
    assert.deepEqual(tasksForCourse(fm), ['Examine', '耀聖']);
    assert.equal(doctorRuleOf(fm), '功能／二返');
    assert.equal(needsForm(fm), false);
    assert.notEqual(fm.needsRecord, true);
    assert.equal(fm.assigns, 'none');
    assert.equal(fm.durationMin, 30);
  });

  test('羊膜：要次數、復健科的醫師、要簽療程單；系統與寫紀錄跟營養點滴一樣', () => {
    const am = course('course-amnion');
    const drip = course('course-iv-drip');
    assert.equal(am.name, '羊膜');
    assert.equal(groupOf(am), '醫師門診');
    assert.equal(isUncounted(am), false);
    assert.equal(doctorRuleOf(am), '復健科');
    assert.equal(needsForm(am), true);
    assert.equal(am.durationMin, 30);
    // 她 2026-10-06：只壓 Abovee、確認後不長別的、不寫紀錄
    assert.deepEqual(systemsOf(am), systemsOf(drip));
    assert.deepEqual(systemsOf(am), ['Abovee']);
    assert.deepEqual(tasksForCourse(am), []);
    assert.equal(am.needsRecord === true, drip.needsRecord === true);
    // 沒勾過系統的那一條退路（照類別推）講的要是同一件事
    assert.deepEqual(systemsOf({ ...am, systems: undefined }), ['Abovee']);
  });

  test('拍 Abovee 認得那兩門新課', () => {
    const m = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts };
    assert.equal(courseFrom('功醫門診', m).courseId, 'course-fm');
    assert.equal(courseFrom('功醫門診', m).uncounted, true);
    assert.equal(courseFrom('羊膜', m).courseId, 'course-amnion');
    assert.equal(courseFrom('皮蛇疫苗', m).ivProductId, iv('皮蛇疫苗').id);
  });

  test('人名一個都沒加（真名不進 repo）', () => {
    assert.equal(SEED.staff.length, 12);
  });

  test('每一筆都通得過自己的驗證；一份全新的資料庫資料健檢 0 項', () => {
    for (const type of MASTER_TYPES) {
      for (const r of SEED[type] ?? []) {
        assert.deepEqual(validate(type, r, { existing: SEED[type], courses: SEED.courses, equipment: SEED.equipment }), [], r.name);
      }
    }
    assert.deepEqual(allFindings(run(master())), []);
  });
});

describe('資料健檢：種子有、她沒有的', () => {
  test('少了的那 7 款點滴列得出來、建得起來，皮蛇疫苗帶著 30 分', () => {
    const added = ['元氣活力', '免疫馥活', '減脂健康', '營養守護', '癒原養方', '養心舒眠', '皮蛇疫苗'];
    const ids = added.map((n) => iv(n).id);
    const rows = of(run(master({ ivProducts: drop(...ids) })), 'seedIvProduct');
    assert.deepEqual(rows.map((f) => f.title).sort(), [...added].sort());
    const shingles = rows.find((f) => f.title === '皮蛇疫苗').fix;
    assert.equal(shingles.kind, 'addIvProduct');
    assert.equal(shingles.ivProductId, iv('皮蛇疫苗').id);
    assert.equal(shingles.data.durationMin, 30);
    assert.equal(shingles.data.active, true);
    assert.ok(!('id' in shingles.data));
  });

  test('她刪掉的那一款不報', () => {
    const id = iv('元氣活力').id;
    assert.deepEqual(of(run(master({ ivProducts: patch(id, (r) => ({ ...r, deletedAt: 'x' })) })), 'seedIvProduct'), []);
  });

  test('她把某一款改了名字：不報那一款「少了」', () => {
    const id = iv('護肝排毒').id;
    assert.deepEqual(of(run(master({ ivProducts: patch(id, (r) => ({ ...r, name: '肝' })) })), 'seedIvProduct'), []);
  });

  test('她自己已經建了同名的一款（id 不是種子的）：不再建第二款', () => {
    const id = iv('元氣活力').id;
    const mine = (rows) => [...rows.filter((r) => r.id !== id), { id: 'abc123', name: '元氣活力' }];
    assert.deepEqual(of(run(master({ ivProducts: mine })), 'seedIvProduct'), []);
  });

  test('功醫門診、羊膜：課程主檔少了一門那一列自己會報，帶著整份設定', () => {
    const rows = of(run(master({ courses: drop('course-fm', 'course-amnion') })), 'seedCourse');
    assert.deepEqual(rows.map((f) => f.title).sort(), ['功醫門診', '羊膜'].sort());
    const fm = rows.find((f) => f.title === '功醫門診').fix.data;
    assert.equal(fm.uncounted, true);
    assert.equal(fm.needsTreatmentForm, false);
    assert.deepEqual(fm.systems, ['Abovee', 'Examine', '耀聖']);
    assert.deepEqual(fm.aboveeNames, ['功醫門診']);
  });

  test('她自己已經在設定建了一門「功醫門診」：不再建第二門', () => {
    const mine = (rows) => [...rows.filter((r) => r.id !== 'course-fm'),
      { id: 'xyz789', name: '功醫門診', durationMin: 30, assigns: 'none', uncounted: true }];
    assert.deepEqual(of(run(master({ courses: mine })), 'seedCourse'), []);
  });

  test('一個種子 id 都沒有的資料庫：一條都不念', () => {
    const own = {
      courses: [{ id: 'c1', name: '我的課', durationMin: 30, assigns: 'none' }],
      rooms: [{ id: 'r1', name: '我的房間', type: '治療室' }],
      staff: [], equipment: [{ id: 'e1', name: '我的機器' }], ivProducts: [{ id: 'i1', name: '我的點滴' }], clinicalFlags: [],
    };
    assert.deepEqual(allFindings(run(own)), []);
  });
});

describe('資料健檢：治7（ADR-0124）', () => {
  const rooms = (result) => of(result, 'roomList');

  test('沒有 → 建起來', () => {
    const [f] = rooms(run(master({ rooms: drop('room-t7') })));
    assert.equal(f.title, '治7');
    assert.deepEqual([f.fix.kind, f.fix.mode, f.fix.roomId], ['applyRoom', 'add', 'room-t7']);
  });

  test('9/08 照建議刪掉了 → 還原，而且講得出為什麼', () => {
    const [f] = rooms(run(master({ rooms: patch('room-t7', (r) => ({ ...r, deletedAt: 'x' })) })));
    assert.equal(f.title, '治7');
    assert.deepEqual([f.fix.kind, f.fix.mode, f.fix.roomId], ['applyRoom', 'restore', 'room-t7']);
    assert.match(f.detail, /EECP/);
  });

  test('還開著 → 什麼都不報（以前會建議刪掉）', () => {
    assert.deepEqual(rooms(run(master())), []);
  });

  test('她自己另外建了一間「治7」：不建、不還原第二間', () => {
    const mine = (rows) => [...rows.filter((r) => r.id !== 'room-t7'), { id: 'my-t7', name: '治7', type: '治療室' }];
    assert.deepEqual(rooms(run(master({ rooms: mine }))), []);
    const both = (rows) => [...rows.map((r) => (r.id === 'room-t7' ? { ...r, deletedAt: 'x' } : r)),
      { id: 'my-t7', name: '治7', type: '治療室' }];
    assert.deepEqual(rooms(run(master({ rooms: both }))), []);
  });

  test('別的她自己刪掉的種子診間照舊不報 —— 只有治7 是回來的', () => {
    assert.deepEqual(rooms(run(master({ rooms: patch('room-vip2', (r) => ({ ...r, deletedAt: 'x' })) }))), []);
  });

  test('治9／治10／ILIB4 照舊建議刪掉', () => {
    const more = (rows) => [...rows, { id: 'room-t9', name: '治9', type: '治療室' }];
    const [f] = rooms(run(master({ rooms: more })));
    assert.deepEqual([f.title, f.fix.mode], ['治9', 'drop']);
  });
});

describe('資料健檢：主檔有幾格還沒跟上', () => {
  const blanks = (m) => of(run(m), 'seedBlanks');
  const OLD = ['room-t5', 'room-t8'];

  test('EECP 還是舊的那一份（治5、治8）→ 建議加上治7；體驗課一樣', () => {
    const old = (r) => ({ ...r, allowedRoomIds: [...OLD], preferredRoomIds: [...OLD] });
    const rows = blanks(master({ courses: (cs) => cs.map((c) => (c.id.startsWith('course-eecp') ? old(c) : c)) }));
    assert.deepEqual(rows.map((f) => f.title).sort(), ['EECP', 'EECP體驗']);
    const fix = rows.find((f) => f.title === 'EECP').fix;
    assert.equal(fix.kind, 'setMasterFields');
    assert.deepEqual([fix.type, fix.id], ['courses', 'course-eecp']);
    assert.deepEqual(fix.changes, {
      allowedRoomIds: ['room-t5', 'room-t7', 'room-t8'], preferredRoomIds: ['room-t5', 'room-t7', 'room-t8'],
    });
    // 這一列寫兩格 —— 確認框那一句要講出第二格（ADR-0070：只講真的會發生的事）
    assert.match(fix.why, /常用診間.*一起加上治7/);
  });

  test('她自己把 EECP 改成只有治5：不建議加治7', () => {
    const m = master({ courses: patch('course-eecp', (r) => ({ ...r, allowedRoomIds: ['room-t5'], preferredRoomIds: ['room-t5'] })) });
    assert.deepEqual(blanks(m).filter((f) => f.title === 'EECP'), []);
  });

  test('她只改了順序（常用診間）：限制補上治7，順序不動', () => {
    const m = master({ courses: patch('course-eecp', (r) => ({ ...r, allowedRoomIds: [...OLD], preferredRoomIds: ['room-t8'] })) });
    const [f] = blanks(m).filter((x) => x.title === 'EECP');
    assert.deepEqual(f.fix.changes, { allowedRoomIds: ['room-t5', 'room-t7', 'room-t8'] });
    assert.match(f.fix.why, /常用診間.*不動/);
  });

  test('她的治7 是自己建的那一間：加的是那一間的 id', () => {
    const m = master({
      rooms: (rows) => [...rows.filter((r) => r.id !== 'room-t7'), { id: 'my-t7', name: '治7', type: '治療室' }],
      courses: patch('course-eecp', (r) => ({ ...r, allowedRoomIds: [...OLD], preferredRoomIds: [...OLD] })),
    });
    const [f] = blanks(m).filter((x) => x.title === 'EECP');
    assert.deepEqual(f.fix.changes.allowedRoomIds, ['room-t5', 'my-t7', 'room-t8']);
  });

  test('課程的分類、要哪一科的醫師：從來沒有那一格才補', () => {
    const m = master({ courses: patch('course-rehab', (r) => without(r, 'group', 'doctorPick')) });
    const rows = blanks(m).filter((f) => f.title === '復健科醫師門診');
    assert.deepEqual(rows.map((f) => f.fix.changes), [{ group: '醫師門診' }, { doctorPick: '復健科' }]);
  });

  test('她自己放到「其他」（存成 null）的分類不動；她選過的醫師那一格不動', () => {
    const m = master({ courses: patch('course-rehab', (r) => ({ ...r, group: null, doctorPick: 'any' })) });
    assert.deepEqual(blanks(m), []);
  });

  test('二返的「約的時候選時長」空著才補；她自己填了可選時長（兩格只能填一格）就不補', () => {
    const bare = master({ courses: patch('course-followup', (r) => without(r, 'bookingMinutes')) });
    assert.deepEqual(blanks(bare).map((f) => f.fix.changes), [{ bookingMinutes: [30, 60] }]);

    const hers = master({ courses: patch('course-followup', (r) => ({ ...without(r, 'bookingMinutes'), durationChoices: [30, 60] })) });
    assert.deepEqual(blanks(hers), []);

    const odd = master({ courses: patch('course-followup', (r) => ({ ...without(r, 'bookingMinutes'), durationMin: 45 })) });
    assert.deepEqual(blanks(odd), [], '預設時長不在名單上的話補了就存不下去');
  });

  test('Abovee 上的寫法：課程、器材、品項空著才補；她自己填過的不動', () => {
    const m = master({
      courses: patch('course-eecp-trial', (r) => without(r, 'aboveeNames')),
      equipment: patch('eq-laser', (r) => ({ ...r, aboveeNames: [] })),
      ivProducts: (rows) => rows.map((r) => {
        if (r.id === 'iv-snow') return without(r, 'aboveeNames');
        return r;
      }),
    });
    const rows = blanks(m);
    assert.deepEqual(rows.map((f) => [f.fix.type, f.fix.id, f.fix.changes]), [
      ['courses', 'course-eecp-trial', { aboveeNames: ['EECP20'] }],
      ['equipment', 'eq-laser', { aboveeNames: ['高能量'] }],
      ['ivProducts', 'iv-snow', { aboveeNames: ['雪顏亮采'] }],
    ]);

    const hers = master({ equipment: patch('eq-laser', (r) => ({ ...r, aboveeNames: ['高能'] })) });
    assert.deepEqual(blanks(hers), []);
  });

  test('那個寫法已經是她另一筆的了：不補（補了兩筆都存不下去）', () => {
    const m = master({
      courses: (rows) => [...rows.map((r) => (r.id === 'course-eecp-trial' ? without(r, 'aboveeNames') : r)),
        { id: 'mine', name: '我的體驗課', durationMin: 20, assigns: 'none', aboveeNames: ['EECP 20'] }],
    });
    assert.deepEqual(blanks(m), []);
  });

  test('刪掉的那一筆不念', () => {
    const m = master({ equipment: patch('eq-laser', (r) => ({ ...without(r, 'aboveeNames'), deletedAt: 'x' })) });
    assert.deepEqual(blanks(m), []);
  });

  test('每一列都講得出補的是哪一格、補成什麼', () => {
    const m = master({ courses: patch('course-followup', (r) => without(r, 'bookingMinutes', 'aboveeNames', 'group', 'doctorPick')) });
    for (const f of blanks(m)) {
      assert.ok(f.fix.what && f.fix.to, JSON.stringify(f.fix));
      assert.ok(f.detail.includes(f.fix.to), f.detail);
      assert.equal(f.link, '#/settings/courses');
    }
    assert.equal(blanks(m).length, 4);
  });
});

describe('既有那幾列跟著種子走', () => {
  test('EECP 體驗還是 30 分 → 課程的時長那一列報 30 → 20', () => {
    const rows = of(run(master({ courses: patch('course-eecp-trial', (r) => ({ ...r, durationMin: 30 })) })), 'courseDuration');
    assert.equal(rows.length, 1);
    assert.match(rows[0].detail, /30 分.*20 分/);
  });
});

describe('每一種新的修正：寫得下去、畫面上有文案', () => {
  const data = readFileSync(new URL('../public/js/data/health.js', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../public/js/ui/views/health.js', import.meta.url), 'utf8');

  test('兩項新的檢查在名單上', () => {
    const ids = CHECKS.map((c) => c.id);
    assert.ok(ids.includes('seedIvProduct'));
    assert.ok(ids.includes('seedBlanks'));
  });

  test('data/health.js 認得 addIvProduct、setMasterFields、applyRoom 的 restore', () => {
    assert.match(data, /fix\?\.kind === 'addIvProduct'/);
    assert.match(data, /fix\?\.kind === 'setMasterFields'/);
    assert.match(data, /fix\.mode === 'restore'/);
  });

  test('ui/views/health.js 兩張表都有', () => {
    assert.ok(view.includes("addIvProduct: 'seedIvProduct'"));
    assert.ok(view.includes("setMasterFields: 'seedBlanks'"));
    assert.ok(view.includes('  seedIvProduct: {'));
    assert.ok(view.includes('  seedBlanks: {'));
    assert.match(view, /restore: '還原'/);
  });
});
