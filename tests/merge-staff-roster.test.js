// 合併檔 v6：人員的全名跟著合併檔進來（prelaunch-fixes 20，ADR-0141）。
//
// 她的原話：
//
// > 把 21 位全名一次填進 staging 和正式站…但是可以匯入合併檔或是載入種子資料的時候一並更新上去，
// > 就是不知道能不能不要寫進公開的程式碼…或是放在合併檔一起匯入也可以
//
// 全名只活在 `.local/references/staff-names.json`；這一支的人一律是「王某某」「某小芳」那種假名。
//
// 盯三件事：
//
//   1. 她自己先動過主檔（先手打了全名、改過簡寫）會不會被蓋掉、或被列成「主檔上沒有這一位」？
//   2. 同一份檔貼兩次：第二次人員 0 位嗎？
//   3. 主檔是種子的名字、或已經改成全名時匯：治療師／醫師都對得到嗎？

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMAT, FORMATS, validateFile, staffRenames, planForCustomer, canRun,
} from '../public/js/domain/mergeImport.js';
import { DOCTOR_ROLE, THERAPIST_ROLE } from '../public/js/domain/masterData.js';

const SEEDED = [
  { id: 'd1', name: '王', role: DOCTOR_ROLE },
  { id: 't1', name: '小芳', role: THERAPIST_ROLE },
  { id: 't2', name: 'LuLu', role: THERAPIST_ROLE },
];
const ROSTER = [
  { match: '王', name: '王某某', shortName: '王' },
  { match: '小芳', name: '某小芳', shortName: '小芳' },
  { match: 'LuLu', name: '某露露', shortName: 'LuLu' },
];
/** 照 `staffRenames()` 的結果改主檔，等於她按了「開始匯入」之後的樣子。 */
const apply = (staff, { changes }) => staff.map((s) => {
  const c = changes.find((x) => x.id === s.id);
  return c ? { ...s, name: c.name, shortName: c.shortName } : s;
});

describe('合併檔的版本', () => {
  test('寫 v6；v1～v5 照收', () => {
    assert.equal(FORMAT, 'baobao-merge/v6');
    for (const v of [1, 2, 3, 4, 5, 6]) assert.ok(FORMATS.includes(`baobao-merge/v${v}`), `v${v}`);
  });

  const file = (staff) => ({ format: FORMAT, customers: [], staff });

  test('`staff` 選填；形狀對的收', () => {
    assert.deepEqual(validateFile({ format: FORMAT, customers: [] }).errors, []);
    assert.deepEqual(validateFile(file(ROSTER)).errors, []);
  });

  test('`staff` 形狀不對整份拒收（匯入了一半比整個拒絕糟）', () => {
    for (const bad of [{}, 'x', [{ match: '王' }], [{ match: '', name: '王某某' }], [{ match: '王', name: 3 }],
      [{ match: '王', name: '王某某', shortName: 5 }]]) {
      assert.ok(validateFile(file(bad)).errors.length, JSON.stringify(bad));
    }
  });
});

describe('要改哪幾位（staffRenames）', () => {
  test('1. 主檔上的名字等於 match → 改成全名、簡寫是原本的名字', () => {
    const r = staffRenames(ROSTER, SEEDED);
    assert.deepEqual(r.changes.map((c) => [c.id, c.from, c.name, c.shortName]), [
      ['d1', '王', '王某某', '王'], ['t1', '小芳', '某小芳', '小芳'], ['t2', 'LuLu', '某露露', 'LuLu'],
    ]);
    assert.deepEqual(r.skipped, []);
    assert.equal(r.already, 0);
  });

  test('2. 已經是那個樣子 → 不算（同一份貼兩次是 0 位）', () => {
    const once = apply(SEEDED, staffRenames(ROSTER, SEEDED));
    const r = staffRenames(ROSTER, once);
    assert.deepEqual(r.changes, []);
    assert.deepEqual(r.skipped, []);
    assert.equal(r.already, 3);
  });

  test('3. 她先手打過全名、沒有簡寫 → 只補簡寫', () => {
    const mine = [{ id: 'd1', name: '王某某', role: DOCTOR_ROLE }];
    const r = staffRenames([ROSTER[0]], mine);
    assert.deepEqual(r.changes.map((c) => [c.id, c.name, c.shortName]), [['d1', '王某某', '王']]);
  });

  test('4. 簡寫對到了、全名她自己改過 → 不蓋，講出來', () => {
    const mine = [{ id: 'd1', name: '王某乙', shortName: '王', role: DOCTOR_ROLE }];
    const r = staffRenames([ROSTER[0]], mine);
    assert.deepEqual(r.changes, []);
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].why, /王某乙/);
  });

  test('5. 對不到、或一個字對到兩位 → 不改，講出來', () => {
    assert.match(staffRenames([{ match: '陌生', name: '某陌生' }], SEEDED).skipped[0].why, /沒有/);
    const two = [
      { id: 'a', name: '王', role: DOCTOR_ROLE },
      { id: 'b', name: '王二某', shortName: '王', role: DOCTOR_ROLE },
    ];
    const r = staffRenames([ROSTER[0]], two);
    assert.deepEqual(r.changes, []);
    assert.match(r.skipped[0].why, /兩位/);
  });

  test('全名跟另一位既有的人同名：那一位不改、講出來，其餘照改', () => {
    const mine = [...SEEDED, { id: 'x', name: '某小芳', role: THERAPIST_ROLE }];
    const r = staffRenames(ROSTER, mine);
    assert.deepEqual(r.changes.map((c) => c.id), ['d1', 't2']);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].match, '小芳');
  });

  test('全名就是原本的名字 → 不算（不補一個跟全名一樣的簡寫）', () => {
    const r = staffRenames([{ match: '某乙', name: '某乙', shortName: '某乙' }], [{ id: 'z', name: '某乙', role: DOCTOR_ROLE }]);
    assert.deepEqual(r.changes, []);
    assert.equal(r.already, 1);
  });

  test('刪掉的那一位不算', () => {
    const r = staffRenames([ROSTER[0]], [{ ...SEEDED[0], deletedAt: 'x' }]);
    assert.deepEqual(r.changes, []);
    assert.equal(r.skipped.length, 1);
  });

  test('沒有 `staff` 那一段 → 一位都不改、一句都不講', () => {
    assert.deepEqual(staffRenames(undefined, SEEDED), { changes: [], skipped: [], already: 0 });
  });
});

describe('匯入對人：名字對不到時比簡寫', () => {
  const entry = {
    name: '客戶A',
    entitlements: [
      { key: 'k1', type: 'single', courseName: '復能', label: '復能', totalQty: 5 },
      { key: 'k2', type: 'single', courseName: '二返', label: '二返', totalQty: 1 },
    ],
    visits: [{
      date: '2026-01-05', status: 'done',
      slots: [
        { courseName: '復能', entitlementKey: 'k1', therapistName: '小芳' },
        { courseName: '二返', entitlementKey: 'k2', therapistName: '王' },
      ],
    }],
  };
  const COURSES = [{ id: 'c-r', name: '復能' }, { id: 'c-f', name: '二返' }];
  const ctx = (staff) => ({ courses: COURSES, equipment: [], ivProducts: [], rooms: [], staff, existingCustomers: [] });
  const who = (staff) => {
    const plan = planForCustomer(entry, ctx(staff));
    const slots = plan.visits[0]?.slots ?? [];
    return { slots: slots.map((s) => [s.therapistId, s.doctorId]), staffProblems: plan.problems.filter((p) => /治療師/.test(p.why)).length };
  };

  test('先匯再改名（主檔還是種子的名字）與先改名再匯，結果一樣', () => {
    const before = who(SEEDED);
    const after = who(apply(SEEDED, staffRenames(ROSTER, SEEDED)));
    assert.deepEqual(after, before);
    assert.deepEqual(after.slots, [['t1', null], [null, 'd1']], '醫師照樣進 doctorId');
    assert.equal(after.staffProblems, 0);
  });

  test('簡寫對到兩位：留空、講出來，不拿第一位', () => {
    const two = [
      { id: 'a', name: '某小芳', shortName: '小芳', role: THERAPIST_ROLE },
      { id: 'b', name: '甲小芳', shortName: '小芳', role: THERAPIST_ROLE },
    ];
    const r = who(two);
    assert.deepEqual(r.slots[0], [null, null]);
    assert.ok(r.staffProblems >= 1);
  });
});

describe('客戶全部跳過、只剩人員要改時「開始匯入」按得下去', () => {
  test('canRun 收 staff', () => {
    assert.equal(canRun({ customers: 0, staff: 3 }), true);
    assert.equal(canRun({ customers: 0, staff: 0 }), false);
    assert.equal(canRun({ running: true, staff: 3 }), false);
  });
});
