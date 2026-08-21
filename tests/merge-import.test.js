// 合併檔匯入。比對與判斷在 .claude/skills/calendar-sheet-merge 那一側做完，
// 這裡測的是「吃進來之後有沒有對到主檔、有沒有把問題講出來」。
//
// fixture 全部是編出來的匿名資料 —— 真實的合併檔含客戶姓名與健康資訊，
// 一個字都不可以進版控（SPEC.md 第 10 節）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMAT, validateFile, planForCustomer, addExtraVisits, eventDocs, summarize, countNewTasks,
} from '../public/js/domain/mergeImport.js';
import { SEED } from '../public/js/domain/seed.js';
import { validateVisit } from '../public/js/domain/visits.js';

const CTX = {
  courses: SEED.courses,
  equipment: SEED.equipment,
  ivProducts: SEED.ivProducts,
  rooms: SEED.rooms,
  staff: SEED.staff,
  existingCustomers: [],
};

const CUSTOMER = () => ({
  sheetName: '客戶A',
  name: '客戶A',
  source: '0522 顧客會-8',
  notes: '姓名欄的編號：9001',
  entitlements: [
    {
      key: 'r7', type: 'pool', label: '復能(1小時)', totalQty: 20, courseName: null,
      optionEquipmentNames: ['INDIBA', '超磁場', '高能量雷射'], productName: null,
    },
    {
      key: 'r8', type: 'single', label: 'ILIB 60mins', totalQty: 12, courseName: '靜脈',
      optionEquipmentNames: [], productName: null,
    },
  ],
  visits: [{
    date: '2026-08-13',
    status: 'done',
    slots: [
      {
        entitlementKey: 'r7', courseName: '復能', startsAt: '13:00', endsAt: '14:00',
        roomName: null, therapistName: '騰崴', equipmentName: '超磁場', ivProductName: null,
        confidence: 'high', evidence: '1~3.客戶A SIS治A',
      },
      {
        entitlementKey: 'r8', courseName: '靜脈', startsAt: '15:15', endsAt: '16:15',
        roomName: '點滴10', therapistName: null, equipmentName: null, ivProductName: null,
        confidence: 'high', evidence: '3.15客戶A IL.10',
      },
    ],
  }],
});

const FILE = (overrides = {}) => ({
  format: FORMAT,
  generatedAt: '2026-08-19T00:00:00.000Z',
  year: 2026,
  calendar: { file: 'timetree.ics', span: ['2026-06-08', '2027-07-27'], events: 317 },
  customers: [CUSTOMER()],
  futureVisits: [],
  missingFromSheet: [],
  eventCandidates: [],
  ambiguous: [],
  ...overrides,
});

const plan = (entry = CUSTOMER(), ctx = {}) => planForCustomer(entry, { ...CTX, ...ctx }, FILE());
const why = (p) => p.problems.map((x) => `${x.where}｜${x.raw}｜${x.why}`);

test('格式不對就整份拒絕，不匯入一半', () => {
  assert.ok(validateFile(null).errors.length);
  assert.ok(validateFile({ format: 'something-else' }).errors[0].includes(FORMAT));
  // 格式不對時不要再往下挑毛病 —— 她要看的是「貼錯東西了」，不是三十行欄位錯誤
  assert.equal(validateFile({ format: 'v0', customers: 'nope' }).errors.length, 1);
  assert.deepEqual(validateFile(FILE()).errors, []);
});

test('候選清單的名字對不上 customers 時要講出來', () => {
  const f = FILE({
    missingFromSheet: [{ customerName: '客戶A9001', date: '2026-08-20', courseName: '靜脈', include: false }],
  });
  const { errors, warnings } = validateFile(f);
  // 這不是壞檔案，只是補不進去 —— 擋下來反而讓她連對得上的那些也匯不了
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('客戶A9001')));
});

test('時間只填一半是壞掉的資料，整段不詳才是舊表沒記過', () => {
  const half = FILE();
  half.customers[0].visits[0].slots[0].endsAt = null;
  assert.ok(validateFile(half).errors.some((e) => e.includes('只填了一半')));

  const unknown = FILE();
  const slot = unknown.customers[0].visits[0].slots[0];
  slot.startsAt = null;
  slot.endsAt = null;
  assert.deepEqual(validateFile(unknown).errors, []);
});

test('名字對到她自己主檔的 id', () => {
  const p = plan();
  const [pool, iv] = p.visits[0].slots;
  assert.equal(pool.courseId, 'course-recovery');
  assert.equal(pool.equipmentId, 'eq-sis');
  assert.equal(pool.therapistId, 'staff-tw');
  assert.equal(iv.roomId, 'room-iv10');
  assert.deepEqual(p.entitlements[0].doc.optionEquipmentIds, ['eq-indiba', 'eq-sis', 'eq-laser']);
  assert.deepEqual(why(p), []);
});

test('主檔裡沒有的診間、治療師：欄位留空，但要講出來', () => {
  const entry = CUSTOMER();
  entry.visits[0].slots[1].roomName = '點滴99';
  entry.visits[0].slots[0].therapistName = '還沒建的治療師';
  const p = plan(entry);
  assert.equal(p.visits[0].slots[1].roomId, null);
  assert.equal(p.visits[0].slots[0].therapistId, null);
  assert.ok(why(p).some((w) => w.includes('點滴99') && w.includes('診間')));
  assert.ok(why(p).some((w) => w.includes('還沒建的治療師') && w.includes('治療師')));
  // 欄位對不到不該讓整個時段消失
  assert.equal(p.counts.slots, 2);
});

test('主檔裡沒有的課程：那一筆額度與它的時段都不匯入', () => {
  const entry = CUSTOMER();
  entry.entitlements[1].courseName = '還沒建的課程';
  const p = plan(entry);
  assert.equal(p.entitlements.length, 1);
  assert.equal(p.counts.slots, 1);
  assert.ok(why(p).some((w) => w.includes('還沒建的課程') && w.includes('主檔裡沒有')));
});

test('同名的客戶整位跳過，重複貼不會建出第二份', () => {
  const p = plan(CUSTOMER(), { existingCustomers: [{ id: 'c1', name: '客戶A' }] });
  assert.ok(p.skip.includes('已經有'));
  assert.equal(p.customer, null);
  assert.equal(p.counts.slots, 0);
});

test('擇一池的器材不到兩種就建不起來', () => {
  const entry = CUSTOMER();
  entry.entitlements[0].optionEquipmentNames = ['INDIBA'];
  const p = plan(entry);
  assert.ok(why(p).some((w) => w.includes('擇一池')));
  assert.ok(!p.entitlements.some((e) => e.doc.type === 'pool'));
});

test('時間不詳的時段照樣匯入（ADR-0011），而且驗證得過', () => {
  const entry = CUSTOMER();
  const slot = entry.visits[0].slots[0];
  slot.startsAt = null;
  slot.endsAt = null;
  const p = plan(entry);
  assert.equal(p.counts.slots, 2);
  assert.equal(p.counts.timed, 1);

  const visit = {
    ...p.visits[0],
    customerId: 'c1',
    slots: p.visits[0].slots.map((s, i) => ({ ...s, entitlementId: `e${i}` })),
  };
  const { errors } = validateVisit(visit, {
    customer: { flags: [] },
    courses: SEED.courses,
    equipment: SEED.equipment,
    ivProducts: SEED.ivProducts,
    entitlements: [
      { id: 'e0', type: 'pool', label: '復能', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'] },
      { id: 'e1', type: 'single', label: '靜脈' },
    ],
  });
  assert.deepEqual(errors, []);
});

test('補進來的來訪併進同一天，不會多長一筆', () => {
  const plans = [plan()];
  const problems = addExtraVisits(plans, [
    { customerName: '客戶A', date: '2026-08-13', courseName: '靜脈', startsAt: '17:00', status: 'done' },
  ], CTX);
  assert.deepEqual(problems, []);
  assert.equal(plans[0].visits.length, 1);
  assert.equal(plans[0].visits[0].slots.length, 3);
  assert.equal(plans[0].visits[0].slots[2].endsAt, '18:00');
});

test('補進來的來訪對不到額度就不猜', () => {
  const plans = [plan()];
  const problems = addExtraVisits(plans, [
    { customerName: '客戶A', date: '2026-09-01', courseName: '二返', startsAt: '10:00', status: 'confirmed' },
    { customerName: '不存在的人', date: '2026-09-01', courseName: '靜脈', startsAt: '10:00', status: 'done' },
  ], CTX);
  assert.equal(problems.length, 2);
  assert.ok(problems[0].why.includes('沒有這個課程的額度'));
  assert.ok(problems[1].why.includes('沒有這位客戶'));
  assert.equal(plans[0].visits.length, 1);
});

test('未來的預約是已確認、還沒來，所以不算出席', () => {
  const plans = [plan()];
  addExtraVisits(plans, [
    { customerName: '客戶A', date: '2026-09-01', courseName: '靜脈', startsAt: '10:00', status: 'confirmed' },
  ], CTX);
  const visit = plans[0].visits.find((v) => v.date === '2026-09-01');
  assert.equal(visit.status, 'confirmed');
  assert.equal(visit.slots[0].attended, false);
});

test('個人行程沒有時間就是整天', () => {
  const [timed, allDay] = eventDocs([
    { title: '公出', startDate: '2026-08-10', endDate: '2026-08-10', startTime: '15:00', endTime: null },
    { title: '宜蘭休假', startDate: '2026-08-11', endDate: '', startTime: null, endTime: null, repeats: true },
  ]);
  assert.equal(timed.allDay, false);
  assert.equal(timed.endTime, '16:00');
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.endDate, '2026-08-11');
  assert.ok(allDay.note.includes('重複事件'));
});

test('摘要的數字要跟報告對得起來', () => {
  const s = summarize([plan(), plan(CUSTOMER(), { existingCustomers: [{ id: 'c1', name: '客戶A' }] })]);
  assert.equal(s.customers, 1);
  assert.equal(s.skipped.length, 1);
  assert.equal(s.entitlements, 2);
  assert.equal(s.visits, 1);
  assert.equal(s.slots, 2);
  assert.equal(s.timed, 2);
});

// ---------- 已經來過 vs 還沒來（.scratch/first-real-import/issues/03） ----------
//
// 舊表上有打勾在她的用法裡是「排了」，不是「來了」—— 她也會先把未來的預約寫進去。
// 合併檔那側因此一律吐 done，2026-08-21 那份 67 筆來訪全是 done，其中 11 筆在今天之後。
// `done` 才扣次數（SPEC 第 4.2 節），所以那 11 筆會讓剩餘次數少算。

const FUTURE = () => {
  const entry = CUSTOMER();
  entry.visits.push({
    date: '2026-09-30',
    status: 'done', // 合併檔那側一律吐 done —— 這正是要修的東西
    slots: [{
      entitlementKey: 'r8', courseName: '靜脈', startsAt: '10:00', endsAt: '11:00',
      roomName: null, therapistName: null, equipmentName: null, ivProductName: null,
      confidence: 'high', evidence: '10.IL',
    }],
  });
  return entry;
};

test('日期在今天之後的來訪建成已確認，今天含以前的維持已完成', () => {
  const p = plan(FUTURE(), { today: '2026-08-21' });
  const past = p.visits.find((v) => v.date === '2026-08-13');
  const ahead = p.visits.find((v) => v.date === '2026-09-30');

  assert.equal(past.status, 'done');
  assert.equal(ahead.status, 'confirmed');
});

test('還沒來就不算出席 —— 未來那幾段的 attended 是 false', () => {
  const p = plan(FUTURE(), { today: '2026-08-21' });
  const ahead = p.visits.find((v) => v.date === '2026-09-30');
  const past = p.visits.find((v) => v.date === '2026-08-13');

  assert.equal(ahead.slots.every((x) => x.attended === false), true);
  assert.equal(past.slots.every((x) => x.attended === true), true);
});

test('今天當天算已經發生，不是未來', () => {
  const p = plan(CUSTOMER(), { today: '2026-08-13' });
  assert.equal(p.visits[0].status, 'done');
});

test('檔案說 confirmed 就聽它，不管日期', () => {
  // futureVisits 那條路標的 confirmed 是有依據的判斷，不要拿算出來的結果蓋掉它
  const entry = CUSTOMER();
  entry.visits[0].status = 'confirmed';
  const p = plan(entry, { today: '2026-12-31' });
  assert.equal(p.visits[0].status, 'confirmed');
});

test('沒給 today 就只看檔案裡寫什麼', () => {
  const p = plan(FUTURE());
  assert.deepEqual(p.visits.map((v) => v.status), ['done', 'done']);
});

test('補進來的未來來訪也要是已確認，不要又變回已完成', () => {
  // 她從 missingFromSheet 勾一筆未來的，走的是 addExtraVisits() 那一條
  const plans = [plan(CUSTOMER(), { today: '2026-08-21' })];
  addExtraVisits(plans, [
    { customerName: '客戶A', date: '2026-09-15', courseName: '靜脈', startsAt: '10:00', status: 'done' },
    { customerName: '客戶A', date: '2026-08-01', courseName: '靜脈', startsAt: '10:00', status: 'done' },
  ], { ...CTX, today: '2026-08-21' });

  const ahead = plans[0].visits.find((v) => v.date === '2026-09-15');
  const past = plans[0].visits.find((v) => v.date === '2026-08-01');
  assert.equal(ahead.status, 'confirmed');
  assert.equal(ahead.slots[0].attended, false);
  assert.equal(past.status, 'done');
  assert.equal(past.slots[0].attended, true);
});

test('摘要要講出「其中幾筆還沒發生」', () => {
  const plans = [plan(FUTURE(), { today: '2026-08-21' })];
  assert.equal(summarize(plans).future, 1);

  addExtraVisits(plans, [
    { customerName: '客戶A', date: '2026-09-15', courseName: '靜脈', startsAt: '10:00', status: 'done' },
  ], { ...CTX, today: '2026-08-21' });
  assert.equal(summarize(plans).future, 2, '補進來的那一筆也要算進去');
  assert.equal(summarize(plans).visits, 3);
});

// ---------- 待辦（.scratch/first-real-import/issues/04） ----------

test('確認框上的待辦筆數只數還沒發生的那些', () => {
  const ahead = plan(FUTURE(), { today: '2026-08-21' });
  // 9/30 那筆是靜脈（C 類 → Abovee 一件）；8/13 那筆已經發生，一件都不長
  assert.equal(countNewTasks([ahead], { courses: SEED.courses, today: '2026-08-21' }), 1);

  const past = plan(CUSTOMER(), { today: '2026-08-21' });
  assert.equal(countNewTasks([past], { courses: SEED.courses, today: '2026-08-21' }), 0);
});

test('整位跳過的客戶不算待辦', () => {
  const skipped = plan(FUTURE(), { today: '2026-08-21', existingCustomers: [{ id: 'c1', name: '客戶A' }] });
  assert.equal(countNewTasks([skipped], { courses: SEED.courses, today: '2026-08-21' }), 0);
});

// ---------- 二返（GitHub issue #15） ----------
//
// 行事曆上有、試算表沒有的 27 筆來訪裡，15 筆補不進來，訊息是
// 「這位客戶沒有這個課程的額度」，大半就是二返。舊表的療程列裡沒有二返，
// 所以合併檔的 entitlements 裡也不會有。健檢的額度一展開就配一筆二返，
// 那些時段才有得扣。

const WITH_CHECKUP = () => ({
  ...CUSTOMER(),
  entitlements: [
    ...CUSTOMER().entitlements,
    {
      key: 'r9', type: 'single', label: '0.75萬健檢', totalQty: 2, courseName: '健檢',
      optionEquipmentNames: [], productName: null,
    },
  ],
});

test('有健檢就配一筆同次數的二返額度', () => {
  const p = plan(WITH_CHECKUP());
  const followup = p.entitlements.find((e) => e.doc.courseId === 'course-followup');

  assert.ok(followup, '健檢那一筆要配出二返額度');
  assert.equal(followup.doc.totalQty, 2, '買 2 次健檢就有 2 次二返');
  assert.equal(followup.doc.followupForEntitlementKey, 'r9', '要指得回是哪一筆健檢配的');
  assert.equal(p.counts.followups, 1);
  assert.equal(summarize([p]).followups, 1);
});

test('沒買健檢就不會憑空多出二返額度', () => {
  const p = plan();
  assert.equal(p.entitlements.some((e) => e.doc.courseId === 'course-followup'), false);
  assert.equal(p.counts.followups, 0);
});

test('行事曆上那筆二返補得進來了 —— 這一支的重點', () => {
  const p = plan(WITH_CHECKUP());
  const problems = addExtraVisits(
    [p],
    [{ customerName: '客戶A', date: '2026-08-19', courseName: '二返', startsAt: '10:00', status: 'done' }],
    CTX,
  );

  assert.deepEqual(problems, [], '不該再出現「這位客戶沒有這個課程的額度」');
  const added = p.visits.find((v) => v.date === '2026-08-19');
  assert.ok(added);
  assert.equal(added.slots[0].courseId, 'course-followup');
  assert.equal(added.slots[0].startsAt, '10:00');
});

test('沒買健檢的人，行事曆上的二返照樣補不進來，而且要講清楚為什麼', () => {
  const p = plan();
  const problems = addExtraVisits(
    [p],
    [{ customerName: '客戶A', date: '2026-08-19', courseName: '二返', startsAt: '10:00', status: 'done' }],
    CTX,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].why, /沒有這個課程的額度/);
});
