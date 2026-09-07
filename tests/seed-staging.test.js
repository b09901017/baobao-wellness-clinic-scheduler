// staging 那份假資料的形狀（`scripts/seed-staging.mjs`）。
//
// 她 2026-09-06：「我希望測試辦的資料可以更新 不要有 abovee 打電話那種舊資料
// 以及帶健保卡那種小事我希望 就沒有……然後我希望更新測試的資料然後可以取名叫
// 客戶A B C 等等」。
//
// 這一支盯的是**種子跟規則對不對得上**。那份假資料以前自己編了一個
// `kind: 'Abovee'`（2026-08-23 就退休了），而可用性的 rule 寫成
// `{ kind: 'weekday', allowed: false }` —— `blocks()` 四個分支一個都對不上，
// 所以那句「星期三下午不行」**一天都沒有真的擋掉**，而畫面上完全看不出來。
//
// 兩種錯都是「種子跟規則各寫一次」的結果，所以這裡比的就是那兩份。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeCustomer, fakeName } from '../scripts/seed-staging.mjs';
import { RULE_KINDS, dayStatus } from '../public/js/domain/availability.js';
import { RETIRED_KINDS } from '../public/js/domain/todoFlow.js';
import { TASK_KINDS } from '../public/js/domain/taskRules.js';
import { SEED } from '../public/js/domain/seed.js';
import { validateVisit } from '../public/js/domain/visits.js';
import { runHealthCheck } from '../public/js/domain/health.js';

const TODAY = '2026-09-06';
const people = Array.from({ length: 20 }, (_, i) => makeCustomer(i, TODAY, { months: 6 }));
const every = (fn) => people.flatMap(fn);

describe('假名', () => {
  test('客戶A、客戶B…… —— 一個真名都沒有', () => {
    assert.deepEqual(
      people.slice(0, 3).map((p) => p.customer.data.name),
      ['客戶A', '客戶B', '客戶C'],
    );
    for (const p of people) assert.match(p.customer.data.name, /^客戶[A-Z]\d*$/);
  });

  test('超過 26 位就接編號，不會退回真名', () => {
    assert.equal(fakeName(0), '客戶A');
    assert.equal(fakeName(25), '客戶Z');
    assert.equal(fakeName(26), '客戶A2');
  });
});

describe('可用性的規則', () => {
  test('每一條的 kind 都在 RULE_KINDS 裡 —— 認不得的一天都擋不掉', () => {
    const kinds = every((p) => p.availability.flatMap((a) => a.data.rules.map((r) => r.kind)));
    assert.ok(kinds.length);
    for (const k of kinds) assert.ok(RULE_KINDS.includes(k), `認不得的 kind：${k}`);
  });

  test('那句「星期三下午不行」真的擋得掉星期三下午', () => {
    // 這一條以前是 `{ kind: 'weekday', allowed: false }` —— `dayStatus()`
    // 一個分支都對不上，所以它擋不掉任何一天，而畫面上完全看不出來。
    const rules = people[0].availability[0].data.rules;
    const wed = dayStatus(rules, '2026-09-09');   // 星期三
    assert.equal(wed.blockedPart, 'pm', '下午要被擋掉');
    assert.ok(wed.reasons.length, '而且要講得出理由');

    const thu = dayStatus(rules, '2026-09-10');
    assert.equal(thu.blockedPart, null);
    assert.deepEqual(thu.reasons, []);
  });
});

describe('任務', () => {
  test('一個退休的種類都沒有 —— Abovee 與打電話 2026-08-23 就不再產生了', () => {
    for (const t of every((p) => p.tasks)) {
      assert.ok(!RETIRED_KINDS.includes(t.data.kind), `退休的種類：${t.data.kind}`);
    }
  });

  test('產生出來的都是現在還在用的那幾種', () => {
    const kinds = [...new Set(every((p) => p.tasks).map((t) => t.data.kind))];
    for (const k of kinds) assert.ok(TASK_KINDS.includes(k), `不該出現的種類：${k}`);
  });

  test('只有已確認的來訪才有登記任務（ADR-0027）', () => {
    for (const p of people) {
      const byVisit = new Map(p.visits.map((v) => [v.id, v.data.status]));
      for (const t of p.tasks) assert.equal(byVisit.get(t.data.visitId), 'confirmed');
    }
  });
});

describe('隨手記', () => {
  test('沒有「帶健保卡」那種舊的小事', () => {
    for (const n of every((p) => p.notes)) {
      assert.ok(!n.data.text.includes('健保卡'), n.data.text);
    }
  });
});

describe('這一輪的東西點得出來', () => {
  test('有人的方案被微調過 —— 「買過什麼」那一頁才有東西看', () => {
    const tweaked = every((p) => p.entitlements)
      .filter((e) => e.data.sourcePlanQty != null && e.data.sourcePlanQty !== e.data.totalQty);
    assert.ok(tweaked.length, '一位都沒有微調過');
  });

  test('有人加購了單台或四選一（issue 04）', () => {
    // 名字的格式是 2026-09-08 改的：`復能-SIS(60)`（半形括號、破折號兩邊
    // 不留空格），而後半是器材的**全名**。
    const labels = new Set(every((p) => p.entitlements).map((e) => e.data.label));
    assert.ok([...labels].some((l) => l.startsWith('復能-SIS')
      || l.startsWith('復能-INDIBA')), [...labels].join(' / '));
    assert.ok([...labels].some((l) => l.includes('四選一')));
  });

  test('有人掛自然美（ADR-0076）', () => {
    assert.ok(people.some((p) => (p.customer.data.partners ?? []).includes('自然美')));
  });

  test('警示兩種都有人掛（ADR-0074）', () => {
    const flags = new Set(people.flatMap((p) => p.customer.data.flags ?? []));
    assert.ok(flags.has('體內金屬'));
    assert.ok(flags.has('血管難打'));
  });

  test('一筆到期日都不給（issue 15：她說基本上不會到期）', () => {
    for (const e of every((p) => p.entitlements)) assert.equal(e.data.expiresAt, null);
  });

  test('每一筆額度都帶得出是哪一次購買（issue 06 分組要用）', () => {
    for (const e of every((p) => p.entitlements)) assert.ok(e.data.purchaseId);
  });
});

describe('種出來的來訪本身要驗得過', () => {
  const ctx = (p) => ({
    customer: p.customer.data,
    courses: SEED.courses,
    equipment: SEED.equipment,
    entitlements: p.entitlements.map((e) => ({ ...e.data, id: e.id })),
    rooms: SEED.rooms,
    staff: SEED.staff,
    ivProducts: SEED.ivProducts,
  });

  test('一筆 error 都沒有 —— 一打開就滿江紅的假資料沒有人想用', () => {
    for (const p of people) {
      for (const v of p.visits) {
        const { errors } = validateVisit({ ...v.data, id: v.id }, ctx(p));
        assert.deepEqual(errors, [], `${v.id}：${errors.join('、')}`);
      }
    }
  });

  test('四選一選到 ILIB 的那一段，課程跟著換成 ILIB（ADR-0075）', () => {
    const slots = every((p) => p.visits).flatMap((v) => v.data.slots);
    const onIlib = slots.filter((s) => s.equipmentId === 'eq-ilib');
    assert.ok(onIlib.length, '一段 ILIB 都沒有種出來');
    for (const s of onIlib) {
      assert.equal(s.courseId, 'course-iv-laser');
      assert.ok(s.roomId, 'ILIB 要診間不要治療師');
      assert.ok(!s.therapistId);
    }
  });
});


// 這一支是整份假資料的**驗收條件**：`scripts/seed-staging.mjs` 的檔尾就寫著
// 「開 #/settings/health 跑一次資料健檢 —— 這份假資料應該一條都不報」。
//
// 一份假資料如果一打開就滿江紅，她就沒辦法拿「健檢有沒有變多」當成回歸的判準了。
// 以前每一筆來訪都是 `10:30 騰崴`，於是二十位客戶的來訪全部撞在一起，
// 「衝突殘留」一打開就十幾條紅字 —— 而那是假資料自己造出來的。
describe('資料健檢一條都不報', () => {
  test('十三項全部乾淨', () => {
    const master = {
      courses: SEED.courses,
      rooms: SEED.rooms,
      staff: SEED.staff,
      equipment: SEED.equipment,
      ivProducts: SEED.ivProducts,
      clinicalFlags: SEED.clinicalFlags,
    };
    const withId = (rows, extra = {}) => rows.map((r) => ({ id: r.id, ...r.data, ...extra }));

    const result = runHealthCheck({
      customers: people.map((p) => ({ id: p.customer.id, ...p.customer.data })),
      entitlements: every((p) => p.entitlements
        .map((e) => ({ id: e.id, customerId: p.customer.id, ...e.data }))),
      availability: every((p) => p.availability
        .map((a) => ({ id: a.id, customerId: p.customer.id, ...a.data }))),
      visits: every((p) => withId(p.visits)),
      tasks: every((p) => withId(p.tasks)),
      notes: every((p) => withId(p.notes)),
      master,
    }, TODAY);

    const dirty = result.checks.filter((c) => c.findings.length)
      .map((c) => `${c.label}：${c.findings.length} 項（${c.findings[0].title}）`);
    assert.deepEqual(dirty, [], dirty.join(' / '));
  });
});
