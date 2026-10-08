// 人員多一格「簡寫」，顯示名是全名（prelaunch-fixes 19，ADR-0141）。
//
// 她的原話：
//
// > 我最希望的是顯示名是全名，人員多一格簡寫，並且要有一支小工具可以幫我先預設好所有人的簡寫(就是現在的顯示名)
//
// 照診間那一套（ADR-0079）：窄的地方（日／週那一列、讀取卡片、試算表的 `二返(…)`）印簡寫，其餘印全名。
// **人員全名不進 repo**：這一支的人一律是「王某某」「某小芳」那種假名。
//
// 盯三件事：
//
//   1. 改成全名之後，拍 Abovee 還認得每一位嗎（全名、全名差一個字、只看姓／名字的舊規則改問簡寫）？
//   2. 簡寫撞名存得下去嗎（不分角色）？
//   3. 資料健檢會不會叫她把改過名的那一位再建一次？

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { validate, DOCTOR_ROLE, THERAPIST_ROLE } from '../public/js/domain/masterData.js';
import { staffFrom, aliasWrites } from '../public/js/domain/abovee.js';
import { agendaFor } from '../public/js/domain/calendar.js';
import { syncBundle } from '../public/js/domain/sheetReport.js';
import { runHealthCheck } from '../public/js/domain/health.js';
import { SEED } from '../public/js/domain/seed.js';

const DR_WANG = { id: 'd1', name: '王某某', shortName: '王', role: DOCTOR_ROLE };
const DR_WANG2 = { id: 'd2', name: '王二某', shortName: '王二', role: DOCTOR_ROLE };
const PT_FANG = { id: 't1', name: '某小芳', shortName: '小芳', role: THERAPIST_ROLE };
const PT_LULU = { id: 't2', name: '某露露', shortName: 'LuLu', role: THERAPIST_ROLE };
const STAFF = [DR_WANG, DR_WANG2, PT_FANG, PT_LULU];

describe('簡寫那一格存得下去嗎', () => {
  const errs = (row, existing = STAFF) => validate('staff', row, { existing });

  test('空的、跟自己的全名一樣都可以', () => {
    assert.deepEqual(errs({ name: '某甲乙', role: THERAPIST_ROLE }), []);
    assert.deepEqual(errs({ name: '某甲乙', shortName: '', role: THERAPIST_ROLE }), []);
    assert.deepEqual(errs({ id: 't1', name: '某小芳', shortName: '某小芳', role: THERAPIST_ROLE }), []);
  });

  test('最多 12 字，錯誤講「簡寫」不講「別稱」', () => {
    const e = errs({ name: '某甲乙', shortName: '一二三四五六七八九十一二三', role: THERAPIST_ROLE });
    assert.equal(e.length, 1);
    assert.match(e[0], /簡寫/);
  });

  test('簡寫跟別人的簡寫一樣：存不下去，醫師與治療師之間也一樣', () => {
    assert.equal(errs({ name: '某甲乙', shortName: '小芳', role: THERAPIST_ROLE }).length, 1);
    assert.equal(errs({ name: '某甲乙', shortName: '小芳', role: DOCTOR_ROLE }).length, 1);
    assert.equal(errs({ name: '某甲乙', shortName: '王', role: THERAPIST_ROLE }).length, 1);
  });

  test('簡寫跟別人的全名一樣、全名跟別人的簡寫一樣：都存不下去', () => {
    assert.equal(errs({ name: '某甲乙', shortName: '某小芳', role: THERAPIST_ROLE }).length, 1);
    assert.equal(errs({ name: '小芳', role: THERAPIST_ROLE }).length, 1);
    assert.equal(errs({ name: 'LuLu', role: DOCTOR_ROLE }).length, 1);
  });

  test('刪掉的那一位不算', () => {
    assert.deepEqual(errs({ name: '某甲乙', shortName: '小芳', role: THERAPIST_ROLE },
      [{ ...PT_FANG, deletedAt: 'x' }]), []);
  });
});

describe('拍 Abovee：全名就是顯示名之後還認得', () => {
  test('全名一模一樣就是那一位（先於「看姓」那一條）', () => {
    assert.equal(staffFrom('王二某', STAFF)?.id, 'd2');
    assert.equal(staffFrom('王某某', STAFF)?.id, 'd1');
    assert.equal(staffFrom('某露露', STAFF)?.id, 't2');
  });

  test('醫師看開頭、治療師看結尾，改拿簡寫問', () => {
    assert.equal(staffFrom('王甲乙', STAFF)?.id, 'd1');
    assert.equal(staffFrom('甲小芳', STAFF)?.id, 't1');
    // 兩位同姓、簡寫不同：「王二」開頭的是第二位 —— 兩位都符合就不猜
    assert.equal(staffFrom('王二乙', STAFF), null);
  });

  test('全名抄錯一個字：知道角色時認得', () => {
    assert.equal(staffFrom('某路露', STAFF, { role: THERAPIST_ROLE })?.id, 't2');
    assert.equal(staffFrom('某路露', STAFF), null, '不知道角色不放寬');
  });

  test('沒填簡寫的人照舊拿全名比', () => {
    const plain = [{ id: 'p', name: '小華', role: THERAPIST_ROLE }];
    assert.equal(staffFrom('某小華', plain)?.id, 'p');
  });

  test('本來就認得的全名不寫進 Abovee 上的寫法', () => {
    assert.deepEqual(aliasWrites([{ text: '某露露', staffId: 't2' }], STAFF), []);
    assert.deepEqual(aliasWrites([{ text: '甲小芳', staffId: 't1' }], STAFF), []);
  });
});

describe('畫面上印哪一個', () => {
  const visit = {
    id: 'v1', date: '2026-08-08', status: 'confirmed', customerId: 'c1',
    slots: [{ startsAt: '10:00', endsAt: '11:00', therapistId: 't1' }],
  };

  test('日／週那一列印簡寫，沒填簡寫退回全名', () => {
    const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(agendaFor([visit], '2026-08-08', { staffById: byId(STAFF) })[0].therapist, '小芳');
    const plain = { ...PT_FANG, shortName: null };
    assert.equal(agendaFor([visit], '2026-08-08', { staffById: byId([plain]) })[0].therapist, '某小芳');
  });

  test('試算表的 `二返(…)` 印簡寫', () => {
    const bundle = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: {
        c1: [
          { id: 'e-chk', label: '健檢', courseId: 'course-checkup', totalQty: 1 },
          { id: 'e-fu', label: '二返', courseId: 'course-followup', followupForEntitlementId: 'e-chk', totalQty: 1 },
        ],
      },
      visitsBy: {
        c1: [
          { id: 'v1', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e-chk' }] },
          { id: 'v2', date: '2026-08-08', status: 'confirmed', slots: [{ entitlementId: 'e-fu', doctorId: 'd1' }] },
        ],
      },
      today: '2026-08-10',
      master: {
        courses: [
          { id: 'course-checkup', name: '健檢', followupCourseId: 'course-followup' },
          { id: 'course-followup', name: '二返' },
        ],
        staff: STAFF,
      },
    });
    assert.deepEqual(bundle.sheets[0].followupNotes, [{ dateIndex: 0, text: '8/8 二返(王)' }]);
  });

  // 從一筆人員讀名字只有兩支：`nameOf(row, 'short')`（簡寫）與 `fullNameOf(row)`（全名）。
  // 散一份 `staffById[…]?.name` 的話，那一處永遠印全名、而且沒人知道它該印哪一個。
  test('掃原始碼：沒有人從人員那一筆直接讀 `.name`', () => {
    const files = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    };
    walk('public/js');
    const bad = /staffById\[[^\]]+\]\??\.name\b|staff\??\.find\([^)]*\)\??\.name\b/;
    const hits = files.flatMap((p) => readFileSync(p, 'utf8').split('\n')
      .map((line, i) => (bad.test(line) ? `${p}:${i + 1}` : null)).filter(Boolean));
    assert.deepEqual(hits, []);
  });

  // 2026-10-09 審查：上面那一條只認得「查到就直接讀」的寫法。**先存成變數再讀**（`const who = staff.find(…)` …
  // `who?.name`）它看不到 —— 那一輪就留了四處。這一條跟著變數走：同一支檔案裡，從人員那一份 `find()`／`staffById[…]`
  // 存下來的變數，後面不可以直接讀 `.name`
  test('掃原始碼：先存成變數再讀 `.name` 的也算', () => {
    const files = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    };
    walk('public/js');
    const held = /\b(?:const|let)\s+(\w+)\s*=\s*(?:[\w.?()\s[\]]*\bstaff\b[\w.?()\s[\]]*\.find\(|staffById\[)/g;
    const hits = [];
    for (const p of files) {
      const src = readFileSync(p, 'utf8');
      const names = new Set([...src.matchAll(held)].map((m) => m[1]));
      if (!names.size) continue;
      const read = new RegExp(`\\b(?:${[...names].join('|')})\\??\\.name\\b`);
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (read.test(line)) hits.push(`${p.replace(/\\/g, '/')}:${i + 1}`);
      });
    }
    assert.deepEqual(hits, []);
  });
});

describe('資料健檢：改過名的人不再叫她建一次', () => {
  const check = (staff) => runHealthCheck({
    customers: [], entitlements: [], visits: [], tasks: [], availability: [],
    master: { ...SEED, staff },
  }, '2026-10-09').checks.find((c) => c.id === 'seedStaff').findings;

  test('她自己建的那一位（不同 id）簡寫等於種子的名字 → 同一位', () => {
    const lulu = SEED.staff.find((s) => s.name === 'LuLu');
    const mine = [
      ...SEED.staff.filter((s) => s.id !== lulu.id),
      { id: 'mine-1', name: '某露露', shortName: 'LuLu', role: lulu.role },
    ];
    assert.deepEqual(check(mine), []);
  });

  test('種子建出來的人改成全名＋簡寫：一列都沒有', () => {
    const renamed = SEED.staff.map((s) => ({ ...s, name: `某${s.name}某`, shortName: s.name }));
    assert.deepEqual(check(renamed), []);
  });
});
