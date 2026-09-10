// 「她自己看」的那幾頁一律印那天做了什麼（`SIS(30)`），
// 貼給客人的那一句一律印課程（`靜脈雷射`）。
//
// 界線只有一條，而且每一個呼叫端都要各自回答一次：
//
// | 那串字要去哪 | 印哪一種 |
// |---|---|
// | 會被複製進 LINE 貼給客人 | `line` —— 一個器材字都不寫（ADR-0077） |
// | 留在 app 畫面上給她掃 | `short` —— `SIS(30)`、`IL(60)`（ADR-0078） |
//
// `domain/naming.js` 的 `slotName()` 本身一直是對的（`tests/naming.test.js`
// 盯著）。**破口全在沒有走它的呼叫端** —— 直接讀 `slot.courseName` 快照
// 或 `course.name` 全名，於是同一段來訪在月曆上寫「SIS(30)」、在進度追蹤
// 那一列寫「復能」，而她會以為那是兩筆。
//
// 這一支分兩半：
//
// 1. **跑得到的那幾支照跑**（`buildProgress()`、`offerSlotMessage()`）
// 2. 其餘是內嵌在樣板字串裡的，**掃原始碼**：那一段有沒有走 `slotName()`，
//    以及有沒有還留著讀快照的那一行

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildProgress } from '../public/js/domain/progress.js';
import { offerSlotMessage } from '../public/js/domain/messages.js';

const MASTER = {
  courses: [
    { id: 'c-recovery', name: '復能', durationChoices: [30, 60] },
    { id: 'c-ilib', name: 'ILIB', shortName: 'IL', lineName: '靜脈雷射', durationChoices: [30, 60] },
    { id: 'c-iv', name: '營養點滴', requiresIvProduct: true },
  ],
  equipment: [
    { id: 'eq-sis', name: 'SIS', courseId: 'c-recovery' },
    { id: 'eq-indiba', name: 'INDIBA', shortName: 'IN', courseId: 'c-recovery' },
  ],
  ivProducts: [{ id: 'iv-snow', name: '雪顏亮彩', shortName: '雪' }],
};

const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

/**
 * 一支函式的原始碼。`from` 是它的開頭，`to` 是下一支的開頭。
 *
 * 掃整支檔案會被別處同名的字誤判 —— 這一支要問的是
 * 「**那一段**有沒有走 `slotName()`」。
 */
function region(src, from, to) {
  const at = src.indexOf(from);
  assert.ok(at > 0, `找不到 ${from}`);
  const end = src.indexOf(to, at + from.length);
  assert.ok(end > at, `找不到 ${from} 的結尾（${to}）`);
  return src.slice(at, end);
}

// ---------- 跑得到的那兩支 ----------

describe('進度追蹤那一列（客戶詳情的「這個月」共用同一支）', () => {
  const visit = (slots) => ({
    id: 'v1', customerId: 'c1', date: '2026-09-10', status: 'confirmed', slots,
  });
  const run = (slots) => buildProgress({
    customers: [{ id: 'c1', name: '王小明' }],
    visits: [visit(slots)],
    month: '2026-09',
    master: MASTER,
  }).rows[0].days[0].slots;

  test('復能那一段印器材與分鐘，不印「復能」', () => {
    const [s] = run([{
      courseId: 'c-recovery', courseName: '復能', equipmentId: 'eq-sis',
      startsAt: '09:00', endsAt: '09:30',
    }]);
    assert.equal(s.name, 'SIS(30)');
  });

  test('營養點滴印的是那天打的品項', () => {
    const [s] = run([{
      courseId: 'c-iv', courseName: '營養點滴', ivProductId: 'iv-snow',
      startsAt: '14:00', endsAt: '15:00',
    }]);
    assert.equal(s.name, '雪');
  });

  test('n返讀快照，不讀主檔 —— 三返不可以印成「二返」', () => {
    const [s] = run([{
      courseId: 'c-recovery', courseName: '三返', followupNth: 3,
      startsAt: '09:00', endsAt: '09:30',
    }]);
    assert.equal(s.name, '三返');
  });

  test('沒帶主檔的呼叫端退回快照，不會吐空字串', () => {
    const rows = buildProgress({
      customers: [{ id: 'c1', name: '王小明' }],
      visits: [visit([{ courseId: 'c-recovery', courseName: '復能', startsAt: '09:00', endsAt: '09:30' }])],
      month: '2026-09',
    }).rows;
    assert.equal(rows[0].days[0].slots[0].name, '復能');
  });
});

describe('時段反查貼給客人的邀約訊息（ADR-0077）', () => {
  // 這一頁組的是一段**假時段**（那一格還沒有人補），而它以前只填了
  // `courseName: course.name` —— 於是 `slotName(…, 'line')` 在主檔裡找不到
  // 課程、退回快照，貼給客人的 LINE 會寫「ILIB」而不是「靜脈雷射」。
  const slot = {
    date: '2026-09-10', startsAt: '14:00', endsAt: '15:00',
    courseId: 'c-ilib', courseName: 'ILIB',
  };

  test('填了 courseId 才講得出 LINE 名', () => {
    const text = offerSlotMessage({ name: '王小明' }, slot, { master: MASTER });
    assert.match(text, /靜脈雷射/);
    assert.doesNotMatch(text, /ILIB/);
  });

  test('少了 courseId 就退回快照 —— 這正是要修的那個 bug', () => {
    const { courseId, ...noId } = slot;
    assert.match(offerSlotMessage({ name: '王小明' }, noId, { master: MASTER }), /ILIB/);
  });

  test('那一頁真的把 courseId 填進去了', () => {
    const src = read('js/ui/views/backfill.js');
    const body = region(src, 'function resultHtml(', 'function candidateCard(');
    assert.match(body, /courseId: course\.id/, '假時段少了 courseId，LINE 會寫成器材名');
  });
});

// ---------- 內嵌在樣板字串裡的那幾處 ----------

/**
 * 每一列是「哪一支函式、要出現什麼、不可以出現什麼」。
 *
 * `mustNot` 那一欄是原本印錯的那一行 —— 留著它，下一輪有人把 `slotName()`
 * 改回讀快照時這一支會紅。
 */
const SPOTS = [
  {
    file: 'js/ui/views/progress.js',
    from: 'function slotHtml(', to: '/**',
    must: 'slot.name', mustNot: 'slot.courseName',
    what: '進度追蹤一段一列',
  },
  {
    file: 'js/ui/views/schedule.js',
    from: 'function recordedSlots(', to: '// ---------- 選中那一天要記什麼 ----------',
    must: 'slotName(', mustNot: 's.courseName',
    what: '壓表 →「這個月壓好的」清單',
  },
  {
    file: 'js/ui/views/schedule.js',
    from: 'const said = bookingConsequences(', to: 'confirmLabel: \'已確認，記錄\'',
    must: 'slotName(', mustNot: 'course.name',
    what: '壓表存檔前那道確認的第一行',
  },
  {
    file: 'js/ui/views/visitEditor.js',
    from: 'function slotSummary(', to: '// ---------- 狀態 ----------',
    must: 'slotName(', mustNot: 'course?.name',
    what: '來訪編輯器存檔前那道確認',
  },
  {
    file: 'js/ui/views/home.js',
    from: 'function drawerHtml(', to: 'function wireConfirm(',
    must: 'slotName(', mustNot: 'r.slot.courseName',
    what: '待辦「跟客人確認時間」點客人之後的抽屜',
  },
  {
    file: 'js/ui/views/home.js',
    from: 'function showConfirmed(', to: '// ---------- 簽療程單（收尾） ----------',
    must: 'slotName(', mustNot: 'r.slot.courseName',
    what: '「已確認」那張卡片',
  },
  {
    file: 'js/ui/views/home.js',
    from: 'function closeRow(', to: 'function closeDrawerHtml(',
    must: 'slotName(', mustNot: 'sl.courseName',
    what: '收尾（簽療程單）卡片那排丸子',
  },
  {
    file: 'js/ui/views/home.js',
    from: 'function closeDrawerHtml(', to: 'function wireClose(',
    must: 'slotName(', mustNot: 'sl.courseName',
    what: '收尾抽屜逐段那幾列',
  },
  {
    file: 'js/ui/views/backfill.js',
    from: 'function resultHtml(', to: 'function candidateCard(',
    must: 'slotName(', mustNot: 'esc(course.name)',
    what: '時段反查結果的抬頭（她自己看的）',
  },
];

describe('她自己看的那幾處走的是 slotName()，不是快照', () => {
  for (const spot of SPOTS) {
    test(`${spot.what}（${spot.file}）`, () => {
      const body = region(read(spot.file), spot.from, spot.to);
      assert.ok(body.includes(spot.must), `${spot.what} 沒有走 ${spot.must}`);
      assert.ok(!body.includes(spot.mustNot), `${spot.what} 還留著 ${spot.mustNot}`);
    });
  }
});

describe('拿得到主檔才算得出名字', () => {
  test('待辦任務列第二行要把 master 傳給 taskLine()', () => {
    const body = region(read('js/ui/views/home.js'), 'function fillVisitInfo(', 'let followupBookings');
    assert.match(body, /taskLine\(\{\}, visit, taskVisits\.master\)/,
      'taskLine() 第三個參數沒傳，那一行會讀快照');
  });

  test('收尾那一頁要讀器材與品項主檔，不是只讀課程', () => {
    const body = region(read('js/ui/views/home.js'), 'async function renderClose(', 'function paintClose(');
    for (const key of ['equipment', 'ivProducts']) {
      assert.ok(body.includes(`'${key}'`), `renderClose() 少讀了 ${key} 主檔`);
    }
  });
});

// `slotName()` 的 master 是三份（courses、equipment、ivProducts）。少一份的
// 症狀是**這一頁的點滴寫「營養點滴」，那一頁寫「雪」**。`tests/naming.test.js`
// 盯著 `master: {` 那一種寫法，而 `const master = {` / `d.master = {` 那一種
// 從來沒有被掃過 —— 待辦「依客戶」的抽屜與客戶詳情的三份都少了品項。
test('用 `=` 組出來的 master 也要三份都帶齊', () => {
  const PAGES = [
    'js/ui/views/backfill.js',
    'js/ui/views/calendar.js',
    'js/ui/views/customerDetail.js',
    'js/ui/views/customersBulk.js',
    'js/ui/views/home.js',
    'js/ui/views/progress.js',
  ];

  let total = 0;
  for (const rel of PAGES) {
    const src = read(rel);
    let at = src.indexOf('master = {');
    while (at >= 0) {
      const lit = src.slice(at, at + 260);
      // `master = {}` 是參數的預設值，不是一份主檔 —— 掃它只會掃到後面
      // 那一段不相干的程式。
      const empty = lit.slice('master = {'.length).trimStart().startsWith('}');
      // 不是每一個叫 master 的東西都餵給 `slotName()` —— 判準是有沒有 courses
      if (!empty && lit.includes('courses')) {
        total += 1;
        for (const key of ['equipment', 'ivProducts']) {
          assert.ok(lit.includes(key), `${rel} 有一份 master 少了 ${key}`);
        }
      }
      at = src.indexOf('master = {', at + 1);
    }
  }
  assert.ok(total >= 4, `只找到 ${total} 份 master —— 這支測試可能失效了`);
});
