// 一段來訪多一格「誰來的」：家人用被扣那一位的額度（family-merge-round 01，ADR-0183）。
//
// 她 2026-11-09：
//
// > 實際扣課病歷號：是扣誰的就扣誰的，可以標註。
//
// kickoff 她選「記在被扣的那一位身上＋寫誰來的」：先生用太太的額度那一段記在太太身上、
// `slot.attendee` 寫「先生」。次數照舊算太太的；名字後面接 `(先生來)`；同一筆裡太太本人一段、
// 先生一段時間疊在一起不報「時間重疊」—— 但同診間／同治療師的撞期照舊要講（先生跟太太同時佔同一張床還是撞）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateVisit, warningDetails, mustSee } from '../public/js/domain/visits.js';
import { slotName, attendeeOf, attendeeTag } from '../public/js/domain/naming.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import { messagesFor } from '../public/js/domain/messages.js';

// 三門都標「不算次數」：沒有額度也存得下去（驗證不擋「要選一個額度」），這幾支要看的只有重疊與撞期
const COURSES = [
  { id: 'c-fm', name: '功醫門診', durationMin: 30, assigns: 'none', uncounted: true, doctorPick: 'none' },
  { id: 'c-iv', name: '營養點滴', durationMin: 60, assigns: 'room', uncounted: true, allowedRoomTypes: [], allowedRoomIds: [] },
  { id: 'c-rec', name: '復健門診', lineName: '復健門診', durationMin: 60, assigns: 'therapist', uncounted: true, doctorPick: 'none' },
];
const ROOMS = [
  { id: 'r-8a', name: '點滴8A', type: '點滴室' },
  { id: 'r-big', name: '大間', type: '點滴室', capacity: 2 },
];
const STAFF = [{ id: 'st-1', name: '治療師甲', role: '物理治療師' }];
const MASTER = { courses: COURSES, equipment: [], ivProducts: [] };

const fm = (o = {}) => ({
  entitlementId: null, courseId: 'c-fm', courseName: '功醫門診', startsAt: '14:30', endsAt: '15:00', ...o,
});
const iv = (o = {}) => fm({ courseId: 'c-iv', courseName: '營養點滴', roomId: 'r-8a', ...o });
const rec = (o = {}) => fm({ courseId: 'c-rec', courseName: '復健門診', therapistId: 'st-1', ...o });

const mine = (slots) => ({
  id: null, customerId: 'c1', customerName: '客戶A', date: '2026-11-12', status: 'pending_confirm', slots,
});

const ask = (visit, o = {}) => validateVisit(visit, {
  customer: { id: 'c1', flags: [] }, entitlements: [], courses: COURSES, equipment: [],
  rooms: ROOMS, staff: STAFF, ivProducts: [], customerVisits: [], sameDayVisits: [], ...o,
});

describe('名字：她自己看的接 (先生來)、貼給客戶的接（先生）', () => {
  // 扣著額度的段（`giftKindOf()` 才不會把不算次數的課當成體驗）；`slotName()` 不查額度
  const paid = (o = {}) => fm({ entitlementId: 'e-x', ...o });

  test('有誰來的：月曆那一種最後接 (先生來)', () => {
    assert.equal(slotName(paid({ attendee: '先生' }), MASTER, 'short'), '功醫門診(先生來)');
  });

  test('空的、只有空白、沒有那一格：一個字都不變（舊資料）', () => {
    assert.equal(slotName(paid(), MASTER, 'short'), '功醫門診');
    assert.equal(slotName(paid({ attendee: '' }), MASTER, 'short'), '功醫門診');
    assert.equal(slotName(paid({ attendee: '  ' }), MASTER, 'short'), '功醫門診');
    assert.equal(attendeeOf(paid({ attendee: ' 先生 ' })), '先生');
    assert.equal(attendeeTag(paid()), '');
  });

  test('貼給客戶的那一種 slotName() 不接（設定頁的預覽也讀它），另一支給（先生）', () => {
    assert.equal(slotName(rec({ entitlementId: 'e-x', attendee: '先生' }), MASTER, 'line'), '復健門診');
    assert.equal(attendeeTag(rec({ attendee: '先生' }), 'line'), '（先生）');
  });

  test('送的／體驗的段：接在 (體驗) 後面', () => {
    assert.equal(slotName(fm({ attendee: '先生' }), MASTER, 'short'), '功醫門診(體驗)(先生來)');
  });
});

describe('同一筆裡的「時間重疊」：誰來的不一樣就不是同一個人', () => {
  test('太太本人 14:30、先生 14:30（不佔診間）：不報重疊，也不擋', () => {
    const { errors, warnings } = ask(mine([fm(), fm({ attendee: '先生' })]));
    assert.deepEqual(errors, []);
    assert.ok(!warnings.some((w) => w.includes('重疊')), warnings.join('｜'));
  });

  test('同一位本人兩段疊在一起：照舊報', () => {
    const { warnings } = ask(mine([fm(), fm({ startsAt: '14:45', endsAt: '15:15' })]));
    assert.ok(warnings.some((w) => w.includes('時間重疊')), warnings.join('｜'));
  });

  test('先生兩段疊在一起：照舊報（同一個人）', () => {
    const { warnings } = ask(mine([fm({ attendee: '先生' }), fm({ attendee: '先生 ' })]));
    assert.ok(warnings.some((w) => w.includes('時間重疊')), warnings.join('｜'));
  });

  test('取消掉的那一段不算', () => {
    const { warnings } = ask(mine([iv(), iv({ attendee: '先生', status: 'cancelled' })]));
    assert.ok(!warnings.some((w) => w.includes('點滴8A')), warnings.join('｜'));
  });
});

describe('同一筆裡誰來的不一樣、同診間／同治療師：撞期照舊要講', () => {
  test('同一間只裝一位的診間：講，而且進 mustSee', () => {
    const visit = mine([iv(), iv({ attendee: '先生' })]);
    const { errors, warnings } = ask(visit);
    assert.deepEqual(errors, []);
    const said = warnings.filter((w) => w.includes('點滴8A'));
    assert.ok(said.length >= 1, warnings.join('｜'));
    assert.ok(said.some((w) => w.includes('先生')), '講得出撞到的是先生那一段');
    const details = warningDetails(visit, {
      customer: { id: 'c1', flags: [] }, entitlements: [], courses: COURSES, equipment: [],
      rooms: ROOMS, staff: STAFF, ivProducts: [], customerVisits: [], sameDayVisits: [],
    }).filter((d) => d.text.includes('點滴8A'));
    assert.ok(details.length && details.every(mustSee), JSON.stringify(details));
  });

  test('裝得下兩位的診間：不講（一對夫妻同時排進去是她排的）', () => {
    const { warnings } = ask(mine([iv({ roomId: 'r-big' }), iv({ roomId: 'r-big', attendee: '先生' })]));
    assert.ok(!warnings.some((w) => w.includes('大間')), warnings.join('｜'));
  });

  test('裝得下兩位、那一天別人也排在那一間：第三位照樣講', () => {
    const other = {
      id: 'v-x', customerId: 'c9', customerName: '客戶B', date: '2026-11-12', status: 'confirmed',
      slots: [iv({ roomId: 'r-big', status: 'confirmed' })],
    };
    const { warnings } = ask(mine([iv({ roomId: 'r-big' }), iv({ roomId: 'r-big', attendee: '先生' })]), { sameDayVisits: [other] });
    assert.ok(warnings.some((w) => w.includes('大間') && w.includes('最多 2 位')), warnings.join('｜'));
  });

  test('同一位治療師：講', () => {
    const { warnings } = ask(mine([rec(), rec({ attendee: '先生' })]));
    assert.ok(warnings.some((w) => w.includes('治療師甲') && w.includes('先生')), warnings.join('｜'));
  });

  test('不同診間、不同治療師：一句都不講', () => {
    const { warnings } = ask(mine([iv(), rec({ attendee: '先生' })]));
    assert.deepEqual(warnings, []);
  });

  test('舊資料（沒有誰來的）同診間兩段：只有原本那一句「時間重疊」，不多出撞期句', () => {
    const { warnings } = ask(mine([iv(), iv()]));
    assert.equal(warnings.length, 1, warnings.join('｜'));
    assert.match(warnings[0], /時間重疊/);
  });
});

describe('次數照舊算被扣的那一位', () => {
  const ent = (o = {}) => ({
    id: 'e1', customerId: 'c1', courseId: 'c-iv2', label: '營養點滴(60)', totalQty: 1, doneCount: 0, bookedCount: 0,
    type: 'single', ...o,
  });

  // 這一門算次數（上面那三門都不算）
  const counted = { courses: [...COURSES, { id: 'c-iv2', name: '點滴', durationMin: 60, assigns: 'room', allowedRoomTypes: [], allowedRoomIds: [] }] };
  const paidIv = (o = {}) => iv({ courseId: 'c-iv2', courseName: '點滴', entitlementId: 'e1', ...o });

  test('只剩一次、太太本人一段＋先生一段：照樣講會超過（先生那一段也扣她的）', () => {
    const visit = mine([paidIv(), paidIv({ attendee: '先生', startsAt: '16:00', endsAt: '17:00' })]);
    const { warnings } = ask(visit, { entitlements: [ent()], ...counted });
    assert.ok(warnings.some((w) => w.includes('超過總次數')), warnings.join('｜'));
  });

  test('只剩一次、只有先生那一段：不講（一次不多不少）', () => {
    const visit = mine([paidIv({ attendee: '先生' })]);
    const { errors, warnings } = ask(visit, { entitlements: [ent()], ...counted });
    assert.deepEqual(errors, []);
    assert.ok(!warnings.some((w) => w.includes('超過總次數')), warnings.join('｜'));
  });
});

describe('組時段：slotFromPicks() 帶得過去', () => {
  const ctx = { courses: COURSES, equipment: [], ivProducts: [], entitlements: [], visits: [] };

  test('有字就寫、去頭尾空白', () => {
    const { slot } = slotFromPicks({ giftCourseId: 'c-fm', startsAt: '14:30', attendee: ' 先生 ' }, ctx);
    assert.equal(slot.attendee, '先生');
  });

  test('空的不寫那一格（本人那一段長得跟以前一模一樣）', () => {
    for (const attendee of [undefined, null, '', '  ']) {
      const { slot } = slotFromPicks({ giftCourseId: 'c-fm', startsAt: '14:30', attendee }, ctx);
      assert.ok(!('attendee' in slot), JSON.stringify(slot));
    }
  });
});

describe('貼給客戶的話：先生那一段照樣列、後面加（先生）', () => {
  const day = (status) => [{
    id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-11-12', status,
    slots: [rec({ status, startsAt: '15:00', endsAt: '16:00', attendee: '先生' }),
      rec({ status, startsAt: '16:00', endsAt: '17:00' })],
  }];
  const text = (visits) => messagesFor({ customer: { id: 'c1', name: '客戶A' }, visits, today: '2026-11-11', master: MASTER })
    .map((m) => m.text).join('\n');

  test('確認時間那一則：一段一行', () => {
    const t = text(day('pending_confirm'));
    assert.match(t, /15:00–16:00 復健門診（先生）/, t);
    assert.match(t, /16:00–17:00 復健門診(?!（)/, t);
  });

  test('明天的提醒：兩段是兩個名字', () => {
    const t = text(day('confirmed'));
    assert.match(t, /有復健門診（先生）、復健門診的課程/, t);
  });

  test('沒有誰來的：一個字都不變', () => {
    const plain = [{ ...day('confirmed')[0], slots: day('confirmed')[0].slots.map(({ attendee: _a, ...s }) => s) }];
    assert.match(text(plain), /有復健門診的課程/);
  });
});
