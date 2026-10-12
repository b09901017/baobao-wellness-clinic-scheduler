// 課程自己勾壓哪幾個系統（2026-10-05，issue 03，ADR-0119）。
//
// 她的原話：
//
// > 每個課程都要可以自己選：壓表壓哪幾個系統…。之後都還要能改
// > 功醫門診：…三個系統都要壓…
//
// 以前規則綁在四選一的類別上（A／B／C／不用掛號），做不出「只壓 Abovee＋耀聖」。
// 這一支盯三件事：
//
//   1. **沒勾過的課程算出來跟以前一模一樣**（讀的時候退回類別，既有資料一筆都不搬）
//   2. 勾了的照勾的算：壓表在哪、確認後長哪幾張、取消時收哪幾個
//   3. 沒有任何一處再自己比 `course.category`（掃原始碼）

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  systemsOf, bookingSystemOf, tasksForCourse, describeSystems,
  // 類別那兩支留著當退路，也是這一支的「以前的答案」
  bookingSystemFor, tasksForCategory,
  syncTasksForVisit, newRegistrations, cancelTasksFor, cancelsBooking,
  bookingSystemsForVisit, tasksForVisit, cancelKindFor,
} from '../public/js/domain/taskRules.js';
import { SYSTEMS, validate, courseDefaultsFor, COURSE_GROUPS, OTHER_GROUP } from '../public/js/domain/masterData.js';
import { SEED } from '../public/js/domain/seed.js';
import { customersToBook } from '../public/js/domain/scheduling.js';
import { bookingSystemLabel, rebookConsequences } from '../public/js/domain/consequences.js';
import { todosForVisit } from '../public/js/domain/todoFlow.js';
import { fieldLabel } from '../public/js/domain/audit.js';

const TODAY = '2026-09-01';

describe('沒勾過的課程：跟以前一模一樣', () => {
  test('類別的五種答案（A／B／C／不用掛號／認不得）一個都沒變', () => {
    for (const category of ['A', 'B', 'C', null, 'Z', undefined]) {
      const course = { id: 'x', name: 'x', category };
      assert.equal(bookingSystemOf(course), bookingSystemFor(category), `bookAt ${category}`);
      assert.deepEqual(tasksForCourse(course), tasksForCategory(category), `onConfirm ${category}`);
    }
  });

  test('第六種：課程主檔裡沒有那一門 —— 回得出「不知道」', () => {
    assert.equal(systemsOf(undefined), null);
    assert.equal(systemsOf(null), null);
    // 兩個呼叫端各自照原本的方向處理：壓在哪用猜的（Abovee），確認後不長任何東西
    assert.equal(bookingSystemOf(undefined), 'Abovee');
    assert.deepEqual(tasksForCourse(undefined), []);
  });

  test('每一門種子課程：拿掉 systems 之後算出來的一樣（種子的勾法就是它的類別）', () => {
    for (const c of SEED.courses) {
      assert.ok(Array.isArray(c.systems), `${c.name} 的種子要填 systems`);
      // 唯一的例外：不用壓的課（`systems: []`，ADR-0126）。四種類別沒有一種推得出「都不用壓」，
      // 所以它只能靠勾的 —— 見 `tests/book-nowhere.test.js`
      if (!c.systems.length) continue;
      const { systems, ...bare } = c;
      assert.equal(bookingSystemOf(c), bookingSystemOf(bare), `${c.name} 壓表在哪`);
      assert.deepEqual(tasksForCourse(c), tasksForCourse(bare), `${c.name} 確認後`);
      assert.deepEqual(systemsOf(c), systemsOf(bare), c.name);
    }
  });

  test('全是認不得的字的 systems 不算勾過，退回類別；明確的空陣列是「不用壓」（ADR-0126）', () => {
    // 2026-10-06 之前空陣列也退回類別（三個系統）—— 那正是 ADR-0126 改掉的行為
    assert.deepEqual(systemsOf({ category: 'A', systems: [] }), []);
    assert.deepEqual(systemsOf({ category: 'B', systems: ['打電話'] }), ['Examine']);
    assert.deepEqual(systemsOf({ category: 'B', systems: null }), ['Examine']);
  });
});

describe('勾了的照勾的算', () => {
  test('順序固定是 Abovee、Examine、耀聖，不照她勾的順序', () => {
    assert.deepEqual(SYSTEMS, ['Abovee', 'Examine', '耀聖']);
    assert.deepEqual(systemsOf({ systems: ['耀聖', 'Abovee'] }), ['Abovee', '耀聖']);
  });

  test('勾了 Abovee 就是壓在 Abovee；沒勾 Abovee、勾了 Examine 就是 Examine', () => {
    assert.equal(bookingSystemOf({ systems: ['Abovee', 'Examine', '耀聖'] }), 'Abovee');
    assert.equal(bookingSystemOf({ systems: ['Examine', '耀聖'] }), 'Examine');
    assert.equal(bookingSystemOf({ systems: ['Examine'] }), 'Examine');
  });

  test('確認之後長的是其餘勾起來的，扣掉壓表那一個', () => {
    assert.deepEqual(tasksForCourse({ systems: ['Abovee', 'Examine', '耀聖'] }), ['Examine', '耀聖']);
    assert.deepEqual(tasksForCourse({ systems: ['Abovee', '耀聖'] }), ['耀聖']);
    assert.deepEqual(tasksForCourse({ systems: ['Examine', '耀聖'] }), ['耀聖']);
    assert.deepEqual(tasksForCourse({ systems: ['Abovee'] }), []);
  });

  test('勾的蓋過類別：A 類只勾 Abovee 就不長 Examine、耀聖', () => {
    const c = { category: 'A', systems: ['Abovee'] };
    assert.deepEqual(tasksForCourse(c), []);
    assert.equal(bookingSystemOf(c), 'Abovee');
  });

  test('一句話講得出壓在哪、確認後還有什麼', () => {
    assert.equal(describeSystems({ systems: ['Abovee', 'Examine', '耀聖'] }), 'Abovee 壓，確認後 Examine、耀聖');
    assert.equal(describeSystems({ systems: ['Examine'] }), 'Examine 壓');
    assert.equal(describeSystems({ category: 'A' }), 'Abovee 壓，確認後 Examine、耀聖');
    assert.equal(describeSystems({ category: null }), 'Abovee 壓');
  });
});

describe('一門課只勾 Abovee＋耀聖', () => {
  const COURSES = {
    ay: { id: 'ay', name: '只壓 Abovee 與耀聖', systems: ['Abovee', '耀聖'] },
    ey: { id: 'ey', name: '只壓 Examine 與耀聖', systems: ['Examine', '耀聖'] },
    rehab: { id: 'rehab', name: '復健科', category: 'A' },
  };
  const visit = (over = {}) => ({
    id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-09-10',
    status: 'confirmed', slots: [{ courseId: 'ay', startsAt: '10:00', status: 'confirmed' }],
    ...over,
  });
  const ctx = { coursesById: COURSES, today: TODAY };

  test('客人確認後只長一張耀聖', () => {
    const { create } = syncTasksForVisit(visit(), [], ctx);
    assert.deepEqual(create.map((t) => t.kind), ['耀聖']);
    assert.deepEqual(tasksForVisit(visit(), COURSES).map((t) => t.kind), ['耀聖']);
    assert.deepEqual(newRegistrations(visit(), [], COURSES, TODAY).map((t) => t.kind), ['耀聖']);
  });

  test('取消：長「取消 Abovee」；耀聖勾過才再長「取消 耀聖」', () => {
    const cancelled = visit({ status: 'cancelled', slots: [{ courseId: 'ay', startsAt: '10:00', status: 'cancelled' }] });
    assert.deepEqual(cancelTasksFor(cancelled, [], COURSES, TODAY).map((t) => t.kind), ['取消 Abovee']);

    const done = { id: 't1', visitId: 'v1', kind: '耀聖', done: true, autoGenerated: true, slotIndexes: [0] };
    assert.deepEqual(
      cancelTasksFor(cancelled, [done], COURSES, TODAY).map((t) => t.kind),
      ['取消 Abovee', '取消 耀聖'],
    );
    // 它沒勾 Examine，所以怎麼取消都不會叫她去 Examine
    assert.ok(!cancelTasksFor(cancelled, [done], COURSES, TODAY).some((t) => t.kind === '取消 Examine'));
  });

  test('只勾 Examine＋耀聖：壓表在 Examine、確認後長耀聖、取消收 Examine', () => {
    const v = visit({ slots: [{ courseId: 'ey', startsAt: '10:00', status: 'confirmed' }] });
    assert.deepEqual(bookingSystemsForVisit(v, COURSES), ['Examine']);
    assert.deepEqual(syncTasksForVisit(v, [], ctx).create.map((t) => t.kind), ['耀聖']);
    assert.equal(bookingSystemLabel(v, COURSES), 'Examine');

    const gone = { ...v, status: 'cancelled', slots: [{ ...v.slots[0], status: 'cancelled' }] };
    const [task] = cancelTasksFor(gone, [], COURSES, TODAY);
    assert.equal(task.kind, cancelKindFor('Examine'));
    assert.equal(cancelsBooking(gone, task, COURSES), true, '那一張收的是壓表登記');
  });

  test('改期那一道確認框問的是新那一段壓在哪', () => {
    const before = visit({ slots: [{ courseId: 'ey', startsAt: '10:00', endsAt: '10:30', status: 'confirmed' }] });
    const after = {
      ...before,
      slots: [
        { ...before.slots[0], status: 'cancelled' },
        { courseId: 'ey', startsAt: '14:00', endsAt: '14:30', status: 'pending_confirm' },
      ],
    };
    const said = rebookConsequences({ before, after, index: 0, tasks: [], coursesById: COURSES, today: TODAY });
    assert.match(said.title, /Examine/);
  });

  test('讀取卡片：沒有 slotIndexes 的舊「取消 耀聖」歸到用得到耀聖的那一段', () => {
    const v = visit({
      slots: [
        { courseId: 'ay', startsAt: '10:00', status: 'cancelled' },
        { courseId: 'rehab', startsAt: '11:00', status: 'confirmed' },
      ],
    });
    const legacy = { id: 't9', visitId: 'v1', kind: '取消 耀聖', done: false, autoGenerated: true };
    const at = (i) => todosForVisit(v, { tasks: [legacy], coursesById: COURSES, focusSlot: i })
      .some((row) => row.kind === '取消 耀聖');
    assert.equal(at(0), true, '取消掉的那一段用得到耀聖');
    assert.equal(at(1), false);
  });
});

describe('待辦中心「壓表登記」講哪個系統', () => {
  const person = { id: 'c1', name: '王小明', active: true };
  const book = (over) => customersToBook({
    customers: [person], visitsBy: {}, targetMonth: '2026-09', ...over,
  });

  test('單一課程的額度照那門課勾的：只勾 Examine 的列在 Examine', () => {
    const rows = book({
      entitlementsBy: { c1: [{ id: 'e1', type: 'single', label: 'X', courseId: 'x', totalQty: 2 }] },
      coursesById: { x: { id: 'x', category: 'C', systems: ['Examine'] } },
    });
    assert.deepEqual(rows[0].systems.map((s) => s.system), ['Examine']);
  });

  test('擇一池問的是那一池推得出的課程，不寫死成 C 類', () => {
    const pool = { id: 'e1', type: 'pool', label: '復能', optionEquipmentIds: ['eq1'], totalQty: 12 };
    const coursesById = { rec: { id: 'rec', requiresEquipment: true, systems: ['Examine'] } };
    const rows = book({
      entitlementsBy: { c1: [pool] }, coursesById,
      equipment: [{ id: 'eq1', courseId: 'rec' }],
    });
    assert.deepEqual(rows[0].systems.map((s) => s.system), ['Examine']);

    // 推不出課程（舊資料、器材沒指到課程、主檔裡沒有擇一池的課）→ 退回 Abovee
    const guess = book({ entitlementsBy: { c1: [pool] }, coursesById: {}, equipment: [] });
    assert.deepEqual(guess[0].systems.map((s) => s.system), ['Abovee']);
  });

  test('這個月的來訪裡認不得的課程不算壓過（刻意跟取消相反）', () => {
    const ent = { id: 'e1', type: 'single', label: 'X', courseId: 'x', totalQty: 2 };
    const rows = book({
      entitlementsBy: { c1: [ent] },
      coursesById: { x: { id: 'x', systems: ['Abovee'] } },
      visitsBy: { c1: [{ id: 'v', status: 'confirmed', date: '2026-09-03', slots: [{ courseId: 'gone' }] }] },
    });
    assert.equal(rows.length, 1, '認不得的那一段不可以把她從清單上抹掉');
    // 而取消時照樣猜 Abovee
    assert.deepEqual(bookingSystemsForVisit({ slots: [{ courseId: 'gone' }] }, {}), ['Abovee']);
  });

  test('這個月壓過一門只勾 Examine 的課：Examine 那一區就沒有他了', () => {
    const ent = { id: 'e1', type: 'single', label: 'X', courseId: 'x', totalQty: 2 };
    const rows = book({
      entitlementsBy: { c1: [ent] },
      coursesById: { x: { id: 'x', category: 'C', systems: ['Examine'] } },
      visitsBy: { c1: [{ id: 'v', status: 'confirmed', date: '2026-09-03', slots: [{ courseId: 'x' }] }] },
    });
    assert.deepEqual(rows, []);
  });
});

describe('驗證與預設', () => {
  const ok = { name: '新課', durationMin: 30, category: 'C', assigns: 'none' };

  test('沒有這一格存得下去（舊課程）；勾了要合法', () => {
    assert.deepEqual(validate('courses', { ...ok }), []);
    assert.deepEqual(validate('courses', { ...ok, systems: ['Abovee', '耀聖'] }), []);
    assert.deepEqual(validate('courses', { ...ok, systems: ['Examine'] }), []);
  });

  test('只勾耀聖：存不下去，講為什麼；三個都不勾存得下去（不用壓，ADR-0126）', () => {
    const errors = validate('courses', { ...ok, systems: ['耀聖'] });
    assert.ok(errors.some((e) => /Abovee.*Examine.*至少/.test(e)));
    assert.deepEqual(validate('courses', { ...ok, systems: [] }), []);
  });

  test('認不得的系統名字擋下來', () => {
    assert.ok(validate('courses', { ...ok, systems: ['Abovee', '打電話'] }).length);
    assert.ok(validate('courses', { ...ok, systems: 'Abovee' }).length);
  });

  test('每一組新增時帶的系統跟那一組的類別推出來的一樣', () => {
    for (const g of [...COURSE_GROUPS, OTHER_GROUP]) {
      const d = courseDefaultsFor(g);
      if (!('category' in d)) continue;
      const { systems, ...bare } = d;
      assert.ok(Array.isArray(systems), `${g} 要帶 systems`);
      assert.deepEqual(systemsOf(d), systemsOf(bare), g);
    }
    assert.deepEqual(courseDefaultsFor('醫師門診').systems, ['Abovee', 'Examine', '耀聖']);
    assert.deepEqual(courseDefaultsFor('健檢').systems, ['Examine'], '健檢只壓 Examine');
  });

  test('稽核不印英文欄位名', () => {
    assert.equal(fieldLabel('systems'), '壓哪幾個系統');
  });
});

describe('沒有任何一處再自己比 course.category', () => {
  const ROOT = new URL('../public/js/', import.meta.url);
  const files = (dir) => readdirSync(new URL(dir, ROOT), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? files(`${dir}${d.name}/`) : [`${dir}${d.name}`]))
    .filter((f) => f.endsWith('.js'));

  // `.category` 還可以出現的地方，每一條都有理由：
  const ALLOWED = new Map([
    ['domain/taskRules.js', '`systemsOf()` 的退回：沒勾過的課程照舊從類別推'],
    ['domain/masterData.js', '類別合不合法的驗證、醫師那一條的退回（ADR-0058，歸 issue 04）'],
    ['ui/views/masterList.js', '表單把原本的類別原樣帶回去（不再改它）'],
    // 底下是**行事備註的** category（休假／行事備註），另一件事
    ['domain/events.js', '行事備註的類別'],
    ['domain/audit.js', '行事備註的類別'],
    ['domain/mergeImport.js', '行事備註的類別'],
    ['ui/views/calendar.js', '行事備註的類別'],
    ['ui/views/eventEditor.js', '行事備註的類別'],
  ]);

  test('`.category` 只剩名單上那幾支', () => {
    const hits = files('').filter((f) => /\.category\b/.test(
      readFileSync(new URL(f, ROOT), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
    ));
    assert.deepEqual(hits.filter((f) => !ALLOWED.has(f)), []);
  });

  test('類別那兩支退路沒有別人在叫', () => {
    const callers = files('')
      .filter((f) => f !== 'domain/taskRules.js')
      .filter((f) => /\b(bookingSystemFor|tasksForCategory|describeCategory|CATEGORY_OPTIONS)\b/.test(
        readFileSync(new URL(f, ROOT), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
      ))
      // 行事備註自己也有一支同名的 `describeCategory()`（`domain/events.js`）
      .filter((f) => !['domain/events.js', 'ui/views/calendar.js'].includes(f));
    assert.deepEqual(callers, []);
  });
});
