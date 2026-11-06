// 連在一起的隨手記（ADR-0179）：每一天一筆真的文件，同一組共用一個 `linkId`。
//
// 判準（`.scratch/notes-widget/HANDOFF.md`）：**這一行會不會讓一筆沒有 `linkId` 的隨手記行為跟現在不一樣，
// 或讓一組連在一起的隨手記被列成好幾列、勾不完整、被複製成兩份？**

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateNote,
  normalize,
  normalizePatch,
  linkedPeers,
  isLinked,
  linkedChanges,
  copyPlan,
  groupLinked,
  linkedBadge,
  openCount,
  noteActions,
  dateChoices,
  linkedReach,
  linkedWords,
  copiedSay,
} from '../public/js/domain/notes.js';

const TODAY = '2026-11-06';

const note = (over = {}) => ({
  id: 'n1',
  text: '提醒王小明喝水',
  customerId: 'c1',
  customerName: '王小明',
  date: '2026-11-06',
  done: false,
  linkId: null,
  entitlementId: null,
  createdAt: '2026-11-01T02:00:00Z',
  deletedAt: null,
  ...over,
});

/** 一組三天：n1（今天，最初那一筆）、n2（11/8）、n3（11/10） */
const trio = (over = {}) => [
  note({ id: 'n1', linkId: 'n1', date: '2026-11-06', ...over }),
  note({ id: 'n2', linkId: 'n1', date: '2026-11-08', createdAt: '2026-11-02T02:00:00Z', ...over }),
  note({ id: 'n3', linkId: 'n1', date: '2026-11-10', createdAt: '2026-11-02T02:00:01Z', ...over }),
];

describe('形狀', () => {
  test('normalize() 帶 linkId；沒帶就是 null（跟 entitlementId 一樣）', () => {
    assert.equal(normalize({ text: 'x', linkId: 'abc' }).linkId, 'abc');
    assert.equal(normalize({ text: 'x' }).linkId, null);
    assert.equal(normalize({ text: 'x', linkId: '  ' }).linkId, null);
  });

  test('normalizePatch() 只在有帶到時碰 linkId —— 改字不會把它清掉', () => {
    assert.ok(!('linkId' in normalizePatch({ text: 'y' })));
    assert.ok(!('linkId' in normalizePatch({ date: '2026-11-08' })));
    assert.ok(!('linkId' in normalizePatch({ customerId: 'c2', customerName: '客戶A' })));
    assert.equal(normalizePatch({ linkId: null }).linkId, null);
    assert.equal(normalizePatch({ linkId: 'n1' }).linkId, 'n1');
  });

  test('營養品的提醒不能連進一組：linkId 與 entitlementId 不能同時有', () => {
    assert.equal(validateNote(note({ linkId: 'n1' })).errors.length, 0);
    assert.equal(validateNote(note({ entitlementId: 'e1' })).errors.length, 0);
    assert.ok(validateNote(note({ linkId: 'n1', entitlementId: 'e1' })).errors.length > 0);
  });
});

describe('連在一起＝同一個 linkId、活著的兩筆以上', () => {
  test('同一組其他還活著的那幾筆', () => {
    const notes = trio();
    assert.deepEqual(linkedPeers(notes[0], notes).map((n) => n.id), ['n2', 'n3']);
    assert.deepEqual(linkedPeers(notes[1], notes).map((n) => n.id), ['n1', 'n3']);
  });

  test('刪掉的不算；只剩一筆時就不算連在一起（不必清 linkId）', () => {
    const [a, b, c] = trio();
    const gone = [a, { ...b, deletedAt: 'x' }, { ...c, deletedAt: 'x' }];
    assert.equal(isLinked(a, gone), false);
    assert.equal(isLinked(a, [a, b, { ...c, deletedAt: 'x' }]), true);
  });

  test('還原刪掉的那一筆就又連回來 —— 因為 linkId 一直都在', () => {
    const [a, b] = trio();
    assert.equal(isLinked(a, [a, { ...b, deletedAt: 'x' }]), false);
    assert.equal(isLinked(a, [a, { ...b, deletedAt: null }]), true);
  });

  test('沒有 linkId 的永遠不算連在一起（就算別筆的 linkId 剛好等於它的 id 也不算）', () => {
    const lone = note({ id: 'n9', linkId: null });
    assert.equal(isLinked(lone, [lone, note({ id: 'x', linkId: null })]), false);
    assert.deepEqual(linkedPeers(lone, [lone, note({ id: 'x', linkId: 'n9' })]), []);
  });
});

describe('一起變的照「真的變了什麼」（linkedChanges）', () => {
  const ids = (writes) => writes.map((w) => w.id);

  test('勾掉一天 → 同一組每一筆一起勾（過去的、還沒到的都算）', () => {
    const [a, b, c] = trio();
    const w = linkedChanges(a, { done: true, doneAt: 'T' }, [b, c]);
    assert.deepEqual(ids(w), ['n1', 'n2', 'n3']);
    for (const x of w) assert.deepEqual(x.changes, { done: true, doneAt: 'T' });
  });

  test('已經勾掉的那幾筆不再寫（不多一則什麼都沒變的稽核）', () => {
    const [a, b, c] = trio();
    const w = linkedChanges(a, { done: true, doneAt: 'T' }, [{ ...b, done: true }, c]);
    assert.deepEqual(ids(w), ['n1', 'n3']);
  });

  test('這一筆其實已經勾了（手上那一份舊了）、同一組還有沒勾的 → 那幾筆照樣勾，這一筆不再寫', () => {
    const [a, b, c] = trio();
    const w = linkedChanges({ ...a, done: true }, { done: true, doneAt: 'T' }, [b, { ...c, done: true }]);
    assert.deepEqual(w, [{ id: 'n2', changes: { done: true, doneAt: 'T' } }]);
  });

  test('拿回來 → 每一筆一起拿回來', () => {
    const [a, b, c] = trio({ done: true, doneAt: 'X' });
    const w = linkedChanges(a, { done: false, doneAt: null }, [b, c]);
    assert.deepEqual(ids(w), ['n1', 'n2', 'n3']);
    assert.deepEqual(w[2].changes, { done: false, doneAt: null });
  });

  test('改字 → 同一組每一筆一起改', () => {
    const [a, b, c] = trio();
    const w = linkedChanges(a, normalizePatch({ text: '提醒王小明回電' }), [b, c]);
    assert.deepEqual(ids(w), ['n1', 'n2', 'n3']);
    assert.deepEqual(w[1].changes, { text: '提醒王小明回電' });
  });

  test('改掛給誰 → 兩格一起帶、同一組每一筆一起改', () => {
    const [a, b, c] = trio();
    const w = linkedChanges(a, normalizePatch({ customerId: 'c2', customerName: '客戶A' }), [b, c]);
    assert.deepEqual(ids(w), ['n1', 'n2', 'n3']);
    assert.deepEqual(w[2].changes, { customerId: 'c2', customerName: '客戶A' });
  });

  test('不掛人了 → 兩格一起清成 null、每一筆一起', () => {
    const [a, b, c] = trio();
    const w = linkedChanges(a, normalizePatch({ customerId: null, customerName: null }), [b, c]);
    assert.deepEqual(w[1].changes, { customerId: null, customerName: null });
  });

  test('改日期 → 只改這一天', () => {
    const [a, b, c] = trio();
    const w = linkedChanges(a, normalizePatch({ date: '2026-11-07' }), [b, c]);
    assert.deepEqual(w, [{ id: 'n1', changes: { date: '2026-11-07' } }]);
  });

  test('日曆編輯器只改日期按存（字與掛給誰照帶）→ 另外那幾天一筆都不寫', () => {
    const [a, b, c] = trio();
    const patch = normalizePatch({
      text: a.text, date: '2026-11-07', customerId: a.customerId, customerName: a.customerName,
    });
    assert.deepEqual(linkedChanges(a, patch, [b, c]), [{ id: 'n1', changes: { date: '2026-11-07' } }]);
  });

  test('什麼都沒變 → 一筆都不寫', () => {
    const [a, b, c] = trio();
    const patch = normalizePatch({ text: a.text, date: a.date, customerId: 'c1', customerName: '王小明' });
    assert.deepEqual(linkedChanges(a, patch, [b, c]), []);
  });

  test('同時改字與日期：字每一筆、日期只這一筆', () => {
    const [a, b] = trio();
    const w = linkedChanges(a, normalizePatch({ text: '新的', date: '2026-11-07' }), [b]);
    assert.deepEqual(w, [
      { id: 'n1', changes: { text: '新的', date: '2026-11-07' } },
      { id: 'n2', changes: { text: '新的' } },
    ]);
  });

  test('另外那一天的字已經跟新的一樣 → 那一天不寫', () => {
    const [a, b] = trio();
    assert.deepEqual(ids(linkedChanges(a, { text: '新的' }, [{ ...b, text: '新的' }])), ['n1']);
  });

  test('linkId 本身（複製、拆開）只動這一筆', () => {
    const [a, b] = trio();
    assert.deepEqual(linkedChanges(a, { linkId: null }, [b]), [{ id: 'n1', changes: { linkId: null } }]);
  });
});

describe('複製到別天（copyPlan）', () => {
  test('一筆還沒連的：每一天各多一筆、帶文字與掛給誰、一律還沒勾，原本那一筆補 linkId（＝它自己的 id）', () => {
    const src = note({ id: 'n1', linkId: null, done: false });
    const plan = copyPlan(src, ['2026-11-08', '2026-11-10'], { linked: true, group: [src] });
    assert.equal(plan.blocked, null);
    assert.equal(plan.linkId, 'n1');
    assert.deepEqual(plan.link, { id: 'n1', changes: { linkId: 'n1' } });
    assert.deepEqual(plan.creates.map((c) => c.date), ['2026-11-08', '2026-11-10']);
    for (const c of plan.creates) {
      assert.equal(c.text, src.text);
      assert.equal(c.customerId, 'c1');
      assert.equal(c.customerName, '王小明');
      assert.equal(c.done, false);
      assert.equal(c.linkId, 'n1');
      assert.equal(c.entitlementId, null);
    }
  });

  test('開關關掉：各自獨立的幾筆，原本那一筆不動', () => {
    const src = note({ id: 'n1', linkId: null });
    const plan = copyPlan(src, ['2026-11-08'], { linked: false, group: [src] });
    assert.equal(plan.link, null);
    assert.equal(plan.creates[0].linkId, null);
  });

  test('複製一筆已經連著的 → 沿用它的 linkId；同一組那一天已經有一筆的不再建（重按、重試不多一份）', () => {
    const group = trio();
    const plan = copyPlan(group[1], ['2026-11-10', '2026-11-12'], { linked: true, group });
    assert.equal(plan.linkId, 'n1');
    assert.equal(plan.link, null, '已經連著，不用補');
    assert.deepEqual(plan.creates.map((c) => c.date), ['2026-11-12']);
    assert.deepEqual(plan.skipped, ['2026-11-10']);
  });

  test('複製兩次（第二次拿第一次寫完之後重讀的那一組）→ 第二次一筆都不建', () => {
    const src = note({ id: 'n1', linkId: null });
    const first = copyPlan(src, ['2026-11-08'], { linked: true, group: [src] });
    const after = [{ ...src, linkId: 'n1' }, { ...first.creates[0], id: 'new1' }];
    const second = copyPlan(after[0], ['2026-11-08'], { linked: true, group: after });
    assert.deepEqual(second.creates, []);
    assert.equal(second.link, null);
  });

  test('刪掉的那一筆不佔那一天（再複製到那一天會建）', () => {
    const [a, b] = trio();
    const plan = copyPlan(a, ['2026-11-08'], { linked: true, group: [a, { ...b, deletedAt: 'x' }] });
    assert.deepEqual(plan.creates.map((c) => c.date), ['2026-11-08']);
  });

  test('它自己那一天、重複的、看不懂的日期都不建', () => {
    const src = note({ id: 'n1', linkId: null, date: '2026-11-06' });
    const plan = copyPlan(src, ['2026-11-06', '2026-11-08', '2026-11-08', 'x'], { linked: true, group: [src] });
    assert.deepEqual(plan.creates.map((c) => c.date), ['2026-11-08']);
  });

  test('營養品的提醒不給複製', () => {
    const plan = copyPlan(note({ entitlementId: 'e1' }), ['2026-11-08'], { linked: true, group: [] });
    assert.ok(plan.blocked);
    assert.deepEqual(plan.creates, []);
    assert.equal(plan.link, null);
  });

  test('拆開過的那一筆（它的 id 還是舊組的 linkId）再複製 → 用新的 linkId，不會連回舊的那一組', () => {
    const [a, b, c] = trio();
    const split = { ...a, linkId: null };
    const plan = copyPlan(split, ['2026-11-12'], { linked: true, group: [split, b, c], newLinkId: 'fresh' });
    assert.equal(plan.linkId, 'fresh');
    assert.deepEqual(plan.link, { id: 'n1', changes: { linkId: 'fresh' } });
    assert.equal(plan.creates[0].linkId, 'fresh');
  });

  test('已經勾掉的那一筆連在一起地複製 → 新的那幾筆自己一組，原本那一筆不拉進來（不然一組勾得不一樣）', () => {
    const src = note({ id: 'n1', linkId: null, done: true });
    const plan = copyPlan(src, ['2026-11-08', '2026-11-10'], { linked: true, group: [src], newLinkId: 'fresh' });
    assert.equal(plan.link, null);
    // R3：用它的 id（它自己不寫 linkId），下一次重讀讀得到這幾天
    assert.ok(plan.creates.every((c) => c.linkId === 'n1' && c.done === false));
  });
});

describe('清單類一組一列（groupLinked）', () => {
  test('一組三天是一列；代表的那一天＝今天或之後最早的', () => {
    const rows = groupLinked(trio(), TODAY);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].note.id, 'n1');
    assert.deepEqual(rows[0].days, ['2026-11-06', '2026-11-08', '2026-11-10']);
    assert.equal(rows[0].members.length, 3);
  });

  test('今天已經過了第一天 → 代表的是下一天', () => {
    assert.equal(groupLinked(trio(), '2026-11-07')[0].note.id, 'n2');
  });

  test('全部過了 → 代表最後一天', () => {
    assert.equal(groupLinked(trio(), '2026-11-20')[0].note.id, 'n3');
  });

  test('沒有 linkId 的、只剩一筆的照舊一筆一列', () => {
    const [a, b, c] = trio();
    const lone = note({ id: 'z', linkId: null, date: null });
    const rows = groupLinked([a, { ...b, deletedAt: 'x' }, { ...c, deletedAt: 'x' }, lone], TODAY);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.members.length === 1));
  });

  test('勾得不一樣的一組（離線、還原）分成勾了的與還沒勾的兩列 —— 不藏任何一筆', () => {
    const [a, b, c] = trio();
    const rows = groupLinked([a, { ...b, done: true }, c], TODAY);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.members.length).sort(), [1, 2]);
  });

  test('「共 N 天」數不同的日子；沒日期的不算一天；同一天兩筆算一天', () => {
    const [a, b, c] = trio();
    const rows = groupLinked([a, { ...b, date: null }, { ...c, date: '2026-11-06' }], TODAY);
    assert.deepEqual(rows[0].days, ['2026-11-06']);
    assert.equal(rows[0].members.length, 3);
  });

  test('徽章：兩天以上「共 N 天」；只有一天但兩筆以上「共 N 筆」；一筆沒有', () => {
    assert.equal(linkedBadge(groupLinked(trio(), TODAY)[0]), '共 3 天');
    const [a, b] = trio();
    assert.equal(linkedBadge(groupLinked([a, { ...b, date: a.date }], TODAY)[0]), '共 2 筆');
    assert.equal(linkedBadge(groupLinked([note({ linkId: null })], TODAY)[0]), null);
  });

  test('沒有日期的成員不當代表', () => {
    const [a, b] = trio();
    const rows = groupLinked([{ ...a, date: null }, b], TODAY);
    assert.equal(rows[0].note.id, 'n2');
  });

  test('首頁「隨手記 N」一組算 1', () => {
    const lone = note({ id: 'z', linkId: null });
    assert.equal(openCount([...trio(), lone]), 2);
    assert.equal(openCount([...trio({ done: true }), lone]), 1);
  });

  test('順序照 sortNotes()，一組用代表那一筆排', () => {
    const older = note({ id: 'old', linkId: null, createdAt: '2026-10-01T00:00:00Z' });
    const newer = note({ id: 'new', linkId: null, createdAt: '2026-11-05T00:00:00Z' });
    const rows = groupLinked([older, ...trio(), newer], TODAY);
    assert.deepEqual(rows.map((r) => r.note.id), ['new', 'n1', 'old']);
  });
});

describe('長按選單（她 11/6 定的：勾掉／改日期／掛給誰／改文字／複製到別天＋先不要）', () => {
  const ids = (n, o = {}) => noteActions(n, { today: TODAY, ...o }).map((a) => a.id);

  test('一般的隨手記：五顆，照這個順序', () => {
    assert.deepEqual(ids(note({ date: null })), ['tick', 'date', 'who', 'edit', 'copy']);
    assert.deepEqual(ids(note({ date: '2026-11-09' })), ['tick', 'date', 'who', 'edit', 'copy']);
    assert.deepEqual(ids(note({ done: true })), ['untick', 'date', 'who', 'edit', 'copy']);
  });

  test('日期那幾顆收成一顆「改日期」（有沒有日期都叫這個名字）', () => {
    for (const date of [null, TODAY, '2026-11-09']) {
      assert.equal(noteActions(note({ date }), { today: TODAY }).find((a) => a.id === 'date').label, '改日期');
    }
  });

  test('營養品的提醒照舊分流：勾掉／改日期／看那一包，不給複製', () => {
    assert.deepEqual(ids(note({ entitlementId: 'e1' })), ['tick', 'date', 'bag']);
    assert.ok(!ids(note({ entitlementId: 'e1', date: null })).includes('copy'));
  });

  test('連在一起的：底下那一行講會作用在幾天（勾、掛給誰、改文字一起；改日期只改這一天）', () => {
    const notes = (n) => Object.fromEntries(noteActions(n, { reach: linkedReach(n, trio().filter((x) => x.id !== n.id).map((x) => ({ ...x, done: n.done }))) }).map((a) => [a.id, a.note]));
    const open = notes(trio()[0]);
    assert.equal(open.tick, '3 天一起');
    assert.equal(open.date, '只改這一天');
    assert.equal(open.who, '3 天一起改');
    assert.equal(open.edit, '3 天一起改');
    assert.equal(notes(trio({ done: true })[0]).untick, '3 天一起');
    // 只有自己一天（沒連在一起）照舊
    assert.equal(noteActions(note({ date: '2026-11-09' }), { reach: null }).find((a) => a.id === 'date').note, '11/9(一)');
  });

  test('連在一起的也是五顆（拆開這一天收在「複製到別天」那張卡裡）', () => {
    const [a] = trio();
    assert.deepEqual(ids(a), ['tick', 'date', 'who', 'edit', 'copy']);
  });

  test('任何情況都不超過五顆 —— 加上「先不要」剛好是六顆的上限', () => {
    for (const done of [true, false]) {
      for (const date of [null, TODAY, '2026-11-09']) {
        for (const entitlementId of [null, 'e1']) {
          for (const linkId of [null, 'n1']) {
            const n = noteActions(note({ done, date, entitlementId, linkId }), { today: TODAY, onCalendar: true }).length;
            assert.ok(n <= 5, `done=${done} date=${date} ent=${entitlementId} link=${linkId}：${n} 顆`);
          }
        }
      }
    }
  });
});

describe('「改日期」那張卡：改成今天／改成某天／拿掉日期', () => {
  const ids = (n, o = {}) => dateChoices(n, { today: TODAY, ...o }).map((a) => a.id);

  test('沒有日期的：改成今天、改成某天（沒有拿掉日期）', () => {
    assert.deepEqual(ids(note({ date: null })), ['today', 'pick']);
  });

  test('掛了別天的：三顆都有', () => {
    assert.deepEqual(ids(note({ date: '2026-11-09' })), ['today', 'pick', 'undate']);
  });

  test('已經是今天的：不給「改成今天」', () => {
    assert.deepEqual(ids(note({ date: TODAY })), ['pick', 'undate']);
  });

  test('已經勾掉的不給「改成今天」（替做完的事改到今天沒有意義）', () => {
    assert.ok(!ids(note({ done: true, date: '2026-11-09' })).includes('today'));
  });

  test('日曆上「拿掉日期」講成「從日曆拿掉」', () => {
    const on = dateChoices(note({ date: '2026-11-09' }), { today: TODAY, onCalendar: true });
    const off = dateChoices(note({ date: '2026-11-09' }), { today: TODAY });
    assert.equal(on.find((a) => a.id === 'undate').label, '從日曆拿掉');
    assert.equal(off.find((a) => a.id === 'undate').label, '拿掉日期');
  });

  test('營養品的提醒不給拿掉日期（跟以前一樣）', () => {
    assert.ok(!ids(note({ entitlementId: 'e1', date: '2026-11-09' })).includes('undate'));
  });
});

describe('資料健檢', async () => {
  const { runHealthCheck, CHECKS } = await import('../public/js/domain/health.js');
  const run = (notes, customers = [{ id: 'c1', name: '王小明' }]) =>
    runHealthCheck({ customers, entitlements: [], visits: [], tasks: [], availability: [], notes, master: {} }, TODAY);
  const check = (r, id) => r.checks.find((c) => c.id === id);

  test('一組勾得不一樣 → 最後一項列一列（只是提醒、不修）', () => {
    const [a, b, c] = trio();
    const f = check(run([a, { ...b, done: true }, c]), 'linkedNotes');
    assert.equal(CHECKS.at(-1).id, 'linkedNotes');
    assert.equal(f.notice, true);
    assert.equal(f.findings.length, 1);
    assert.equal(f.findings[0].fix, null);
    assert.match(f.findings[0].detail, /11\/8.*勾了.*11\/6.*還沒勾/);
  });

  // 段三審查 R4：以前先換成「11/10(二)」再排字，十號排在九號前面、沒有日期的排在哪裡看字碼；也沒有連結
  test('日子照日期排（沒有日期的放最後）、連到隨手記那一頁', () => {
    const rows = [
      note({ id: 'a', linkId: 'a', date: '2026-11-08', done: true }),
      note({ id: 'b', linkId: 'a', date: '2026-11-10' }),
      note({ id: 'c', linkId: 'a', date: null }),
      note({ id: 'd', linkId: 'a', date: '2026-11-09' }),
    ];
    const f = check(run(rows), 'linkedNotes').findings[0];
    assert.equal(f.detail, '11/8(日) 勾了；11/9(一)、11/10(二)、沒有日期 還沒勾');
    assert.equal(f.link, '#/todo/notes');
  });

  test('勾得一樣、只剩一筆、刪掉的那一筆勾法不一樣 → 都不列', () => {
    const [a, b, c] = trio();
    assert.equal(check(run(trio()), 'linkedNotes').findings.length, 0);
    assert.equal(check(run(trio({ done: true })), 'linkedNotes').findings.length, 0);
    assert.equal(check(run([a, { ...b, done: true, deletedAt: 'x' }, c]), 'linkedNotes').findings.length, 0);
  });

  test('一組三天掛著一位已刪除的客戶 → 孤兒資料只列一行', () => {
    const r = run(trio(), [{ id: 'c1', name: '王小明', deletedAt: 'x' }]);
    const notesRows = check(r, 'orphans').findings.filter((x) => /隨手記/.test(x.title));
    assert.equal(notesRows.length, 1);
  });
});

// 段三審查 R2：同一組「會作用在幾天」只有一種算法（`linkedReach()`）—— 選單、兩張卡、日曆編輯器那一行、
// 兩種 toast、清單那一顆講同一個數字同一個單位。以前選單 `max(不同的日子, 2)`、卡片與存完的 toast 數筆、勾掉的 toast 數日子
describe('會作用在幾天（linkedReach，R2）', () => {
  const says = (n, peers) => {
    const reach = linkedReach(n, peers);
    const w = linkedWords(reach);
    const menu = Object.fromEntries(noteActions(n, { reach }).map((a) => [a.id, a.note]));
    return { reach, w, menu };
  };

  test('三天：每一句都講 3 天', () => {
    const [a, b, c] = trio();
    const { reach, w, menu } = says(a, [b, c]);
    assert.equal(reach.label, '共 3 天');
    assert.equal(menu.tick, '3 天一起');
    assert.equal(menu.who, '3 天一起改');
    assert.equal(menu.edit, '3 天一起改');
    assert.equal(menu.date, '只改這一天');
    assert.equal(w.card, '共 3 天會一起改');
    assert.equal(w.toast, '（共 3 天）');
    assert.match(w.hint, /共 3 天/);
    assert.equal(linkedBadge(groupLinked([a, b, c], TODAY)[0]), reach.label);
  });

  test('一組三天、其中一天拿掉了日期 → 每一句都講 2 天（跟清單那一顆一樣）', () => {
    const [a, b, c] = trio();
    const undated = { ...b, date: null };
    const { reach, w, menu } = says(a, [undated, c]);
    assert.equal(reach.label, linkedBadge(groupLinked([a, undated, c], TODAY)[0]));
    assert.equal(reach.label, '共 2 天');
    assert.equal(menu.tick, '2 天一起');
    assert.equal(menu.who, '2 天一起改');
    assert.equal(w.card, '共 2 天會一起改');
    assert.equal(w.toast, '（共 2 天）');
    // 長按的是沒日期的那一筆也一樣
    assert.equal(linkedReach(undated, [a, c]).label, '共 2 天');
  });

  test('兩筆改到同一天 → 講筆（跟清單那一顆一樣），改日期「只改這一筆」', () => {
    const [a, b] = trio();
    const same = { ...b, date: a.date };
    const { reach, w, menu } = says(a, [same]);
    assert.equal(reach.label, linkedBadge(groupLinked([a, same], TODAY)[0]));
    assert.equal(reach.label, '共 2 筆');
    assert.equal(menu.tick, '2 筆一起');
    assert.equal(menu.date, '只改這一筆');
    assert.equal(w.card, '共 2 筆會一起改');
    assert.equal(w.toast, '（共 2 筆）');
  });

  test('沒連在一起 → null，每一句都是空的、選單照舊', () => {
    const n = note({ date: '2026-11-09' });
    assert.equal(linkedReach(n, []), null);
    const w = linkedWords(null);
    assert.equal(w.card, '');
    assert.equal(w.toast, '');
    assert.equal(noteActions(n, { reach: null }).find((a) => a.id === 'date').note, '11/9(一)');
  });
});

// 段三審查 R3：從已勾掉的那一筆複製 —— toast 照真的連起來的講；再複製一次同一天不多一份
describe('從已勾掉的那一筆複製（R3）', () => {
  const done = () => note({ id: 'n1', linkId: null, done: true });

  test('第一次：新的那幾筆用它自己的 id 當 linkId，它自己不寫 linkId（不跟新的那幾筆連在一起）', () => {
    const src = done();
    const plan = copyPlan(src, ['2026-11-08', '2026-11-10'], { linked: true, group: [src], newLinkId: 'fresh' });
    assert.equal(plan.link, null);
    assert.ok(plan.creates.every((c) => c.linkId === 'n1' && c.done === false));
    assert.equal(plan.together, 2);
    assert.equal(plan.sourceIn, false);
    // 它自己沒有 linkId，所以不算在那一組裡
    assert.deepEqual(linkedPeers(src, [src, ...plan.creates.map((c, i) => ({ ...c, id: `c${i}` }))]), []);
  });

  test('再複製一次（拿第一次寫完重讀的那一組）→ 上一次那幾天圈起來、不再建', () => {
    const src = done();
    const first = { ...note({ id: 'c1', linkId: 'n1', date: '2026-11-08' }) };
    const plan = copyPlan(src, ['2026-11-08', '2026-11-12'], { linked: true, group: [src, first], newLinkId: 'fresh' });
    assert.deepEqual(plan.skipped, ['2026-11-08']);
    assert.deepEqual(plan.taken, ['2026-11-08']);
    assert.deepEqual(plan.creates.map((c) => c.date), ['2026-11-12']);
    assert.equal(plan.creates[0].linkId, 'n1');
    assert.equal(plan.together, 2);
  });

  test('它的 id 那一組裡有勾掉的（拆開過的舊組、或上一次那幾筆也勾了）→ 用新的 id，新的那幾筆不跟勾掉的連在一起', () => {
    const src = done();
    const old = note({ id: 'b', linkId: 'n1', date: '2026-11-08', done: true });
    const plan = copyPlan(src, ['2026-11-08'], { linked: true, group: [src, old], newLinkId: 'fresh' });
    assert.equal(plan.linkId, 'fresh');
    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.taken, []);
    assert.equal(plan.together, 1);
  });

  test('它自己已經在一組裡（勾掉的一組）→ 照舊用新的 id（不冪等，寫在 ADR-0179）', () => {
    const [a, b] = trio({ done: true });
    const plan = copyPlan(a, ['2026-11-12'], { linked: true, group: [a, b], newLinkId: 'fresh' });
    assert.equal(plan.linkId, 'fresh');
    assert.equal(plan.link, null);
  });

  test('toast：連在一起的只有新的那一筆時不講「其他天一起勾」', () => {
    assert.equal(copiedSay({ created: 1, linked: true, together: 1, sourceIn: false }), '複製到 1 天');
    assert.equal(copiedSay({ created: 2, linked: true, together: 2, sourceIn: false }), '複製到 2 天：新的那幾天連在一起');
    assert.equal(copiedSay({ created: 2, linked: true, together: 3, sourceIn: true }), '複製到 2 天：勾一天，其他天一起勾');
    assert.equal(copiedSay({ created: 2, linked: false, together: 0, sourceIn: false }), '複製到 2 天');
    assert.equal(copiedSay({ created: 0, linked: true, together: 3, sourceIn: true }), '那幾天已經有了，沒有多建');
  });

  test('還沒勾的照舊：together 含它自己', () => {
    const src = note({ id: 'n1', linkId: null });
    const plan = copyPlan(src, ['2026-11-08'], { linked: true, group: [src] });
    assert.equal(plan.together, 2);
    assert.equal(plan.sourceIn, true);
    assert.deepEqual(plan.taken, []);
  });
});
