// 合併檔匯入。比對與判斷在 .claude/skills/calendar-sheet-merge 那一側做完，
// 這裡測的是「吃進來之後有沒有對到主檔、有沒有把問題講出來」。
//
// fixture 全部是編出來的匿名資料 —— 真實的合併檔含客戶姓名與健康資訊，
// 一個字都不可以進版控（SPEC.md 第 10 節）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMAT, validateFile, planForCustomer, addExtraVisits, eventDocs, noteDocs, eventKind,
  looseDocs, looseTally,
  summarize, countNewTasks,
  groupCandidates, defaultPicks,
} from '../public/js/domain/mergeImport.js';
import { importedTasksFor, syncTasksForVisit, RECORD_TASK_KIND } from '../public/js/domain/taskRules.js';
import { SEED } from '../public/js/domain/seed.js';
import { validateVisit } from '../public/js/domain/visits.js';
import { ivChoicesFor } from '../public/js/domain/masterData.js';

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
  notes: '病歷號 9001',
  entitlements: [
    {
      key: 'r7', type: 'pool', label: '復能(1小時)', totalQty: 20, courseName: null,
      optionEquipmentNames: ['INDIBA', 'SIS', '高能量雷射'], productName: null,
    },
    {
      key: 'r8', type: 'single', label: 'ILIB 60mins', totalQty: 12, courseName: 'ILIB',
      optionEquipmentNames: [], productName: null,
    },
  ],
  visits: [{
    date: '2026-08-13',
    status: 'done',
    slots: [
      {
        entitlementKey: 'r7', courseName: '復能', startsAt: '13:00', endsAt: '14:00',
        roomName: null, therapistName: '騰崴', equipmentName: 'SIS', ivProductName: null,
        confidence: 'high', evidence: '1~3.客戶A SIS治A',
      },
      {
        entitlementKey: 'r8', courseName: 'ILIB', startsAt: '15:15', endsAt: '16:15',
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
    missingFromSheet: [{ customerName: '客戶A9001', date: '2026-08-20', courseName: 'ILIB', include: false }],
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

// ADR-0075：單買一台 SIS 就是「這一池裡只有一台」。這一條以前寫著「不到兩種就建不起來」，
// 於是單買 SIS 的客戶就算 skill 產得出來也匯不進去（`.scratch/merge-answers-2026-09-14/issues/02`）。
test('擇一池只有一台也建得起來，一台都沒有才擋', () => {
  const one = CUSTOMER();
  one.entitlements[0].optionEquipmentNames = ['SIS'];
  const p = plan(one);
  const pool = p.entitlements.find((e) => e.doc.type === 'pool');
  assert.deepEqual(pool?.doc.optionEquipmentIds, ['eq-sis']);

  const none = CUSTOMER();
  none.entitlements[0].optionEquipmentNames = [];
  const q = plan(none);
  assert.ok(why(q).some((w) => w.includes('擇一池')));
  assert.ok(!q.entitlements.some((e) => e.doc.type === 'pool'));
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
      { id: 'e1', type: 'single', label: 'ILIB' },
    ],
  });
  assert.deepEqual(errors, []);
});

test('補進來的來訪併進同一天，不會多長一筆', () => {
  const plans = [plan()];
  const problems = addExtraVisits(plans, [
    { customerName: '客戶A', date: '2026-08-13', courseName: 'ILIB', startsAt: '17:00', status: 'done' },
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
    { customerName: '不存在的人', date: '2026-09-01', courseName: 'ILIB', startsAt: '10:00', status: 'done' },
  ], CTX);
  assert.equal(problems.length, 2);
  assert.ok(problems[0].why.includes('沒有這個課程的額度'));
  assert.ok(problems[1].why.includes('沒有這位客戶'));
  assert.equal(plans[0].visits.length, 1);
});

test('未來的預約是已確認、還沒來，所以不算出席', () => {
  const plans = [plan()];
  addExtraVisits(plans, [
    { customerName: '客戶A', date: '2026-09-01', courseName: 'ILIB', startsAt: '10:00', status: 'confirmed' },
  ], CTX);
  const visit = plans[0].visits.find((v) => v.date === '2026-09-01');
  assert.equal(visit.status, 'confirmed');
  assert.equal(visit.slots[0].attended, false);
});

test('跨天的行事備註進得去，明確的 allDay 欄位比反推優先', () => {
  // 產檔那側現在會給 endDate 與 allDay（.scratch/first-real-import/issues/06）
  const [away, odd, old] = eventDocs([
    { title: '出國', startDate: '2026-08-10', endDate: '2026-08-14', allDay: true, startTime: null },
    // 標成整天卻帶著時間：整天贏，時間清掉 —— 那個時間沒有來源
    { title: '休假', startDate: '2026-09-01', endDate: '2026-09-01', allDay: true, startTime: '09:00' },
    // 舊的合併檔沒有 allDay，照樣要吃得下
    { title: '公出', startDate: '2026-08-12', endDate: '2026-08-12', startTime: '14:30' },
  ]);

  assert.equal(away.endDate, '2026-08-14');
  assert.equal(away.allDay, true);
  assert.equal(odd.startTime, null);
  assert.equal(odd.endTime, null);
  assert.equal(old.allDay, false);
  assert.equal(old.endTime, '15:30');
});

test('結束日比開始日早的資料當成單天，不要送進去被 rules 打回來', () => {
  const [e] = eventDocs([
    { title: '壞掉的', startDate: '2026-08-10', endDate: '2026-08-01', allDay: true },
  ]);
  assert.equal(e.endDate, '2026-08-10');
});

test('讀不出來的行事曆事件要講出來', () => {
  const { warnings } = validateFile(FILE({
    unreadable: [{ title: '讀不出來的東西', raw: '壞掉的值', why: 'DTSTART 讀不出日期' }],
  }));
  assert.ok(warnings.some((w) => w.includes('讀不出日期')));
});

test('行事備註沒有時間就是整天', () => {
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
      entitlementKey: 'r8', courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00',
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
    { customerName: '客戶A', date: '2026-09-15', courseName: 'ILIB', startsAt: '10:00', status: 'done' },
    { customerName: '客戶A', date: '2026-08-01', courseName: 'ILIB', startsAt: '10:00', status: 'done' },
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
    { customerName: '客戶A', date: '2026-09-15', courseName: 'ILIB', startsAt: '10:00', status: 'done' },
  ], { ...CTX, today: '2026-08-21' });
  assert.equal(summarize(plans).future, 2, '補進來的那一筆也要算進去');
  assert.equal(summarize(plans).visits, 3);
});

// ---------- 候選清單分區（.scratch/first-real-import/issues/05） ----------
//
// 原本三張卡是照「這筆資料哪裡來的」分的，198 筆過去與未來交錯排列，
// 她要一筆一筆看日期才知道哪些還沒發生。

const CANDIDATES = () => FILE({
  missingFromSheet: [
    { customerName: '客戶A', date: '2026-07-02', courseName: 'ILIB', include: false },
    { customerName: '客戶A', date: '2026-09-20', courseName: 'ILIB', include: false },
    { customerName: '客戶A', date: '2026-08-05', courseName: '復能', include: false },
  ],
  futureVisits: [
    { customerName: '客戶A', date: '2026-09-05', courseName: '復能', status: 'confirmed', include: false },
  ],
  eventCandidates: [
    { title: '公出', startDate: '2026-08-30', endDate: '2026-08-30', include: false },
    { title: '演講', startDate: '2026-06-01', endDate: '2026-06-01', include: false },
  ],
});

test('候選清單先分時間再分來源', () => {
  const g = groupCandidates(CANDIDATES(), '2026-08-21');

  assert.deepEqual(g.future.visits.map((r) => r.date), ['2026-09-05', '2026-09-20']);
  assert.deepEqual(g.future.events.map((r) => r.date), ['2026-08-30']);
  assert.deepEqual(g.past.visits.map((r) => r.date), ['2026-08-05', '2026-07-02']);
  assert.deepEqual(g.past.events.map((r) => r.date), ['2026-06-01']);
});

test('排序是「離今天多遠」：未來近的在前，過去最近做的在前', () => {
  const g = groupCandidates(CANDIDATES(), '2026-08-21');
  assert.equal(g.future.visits[0].date, '2026-09-05');
  assert.equal(g.past.visits[0].date, '2026-08-05');
});

test('分組記的是原本清單裡的位置，勾選才對得回去', () => {
  const g = groupCandidates(CANDIDATES(), '2026-08-21');
  const late = g.future.visits.find((r) => r.kind === 'missing');
  assert.equal(late.index, 1, 'missingFromSheet 的第 2 筆');
  assert.equal(late.item.date, '2026-09-20');
});

test('還沒發生的預設勾起來，已經發生的一筆都不勾（ADR-0030）', () => {
  const chosen = defaultPicks(CANDIDATES(), '2026-08-21');
  assert.deepEqual(chosen.future, [0], '未來的預約那一筆');
  assert.deepEqual(chosen.missing, [1], '只有 9/20 那筆在未來');
  assert.deepEqual(chosen.events, [0], '只有 8/30 那筆在未來');
});

test('沒給 today 就全部算成已經發生，一筆都不預設勾', () => {
  // 分不出來的時候寧可不勾 —— 替她勾錯的成本比要她自己勾高
  const g = groupCandidates(CANDIDATES(), null);
  assert.equal(g.future.visits.length + g.future.events.length, 0);
  assert.deepEqual(defaultPicks(CANDIDATES(), null), { future: [], missing: [], events: [] });
});

test('customers[] 裡的未來來訪要數出來 —— 那張卡本來只列得出十一分之一', () => {
  const json = FILE({ customers: [FUTURE()] });
  assert.equal(groupCandidates(json, '2026-08-21').plannedFuture, 1);
  assert.equal(groupCandidates(json, '2026-12-31').plannedFuture, 0);
});

test('ambiguous 要有人講出來，不然那一筆就這樣消失了', () => {
  const json = FILE({
    ambiguous: [{ date: '2026-06-30', evidence: '3.15 IL治2', course: 'ILIB', who: ['客戶A', '王小明'] }],
  });
  const { errors, warnings } = validateFile(json);
  assert.deepEqual(errors, [], '這不是壞檔案');
  assert.ok(warnings.some((w) => w.includes('兩位以上')));
});

// ---------- 待辦（.scratch/first-real-import/issues/04） ----------

test('確認框上的待辦筆數只數還沒發生的那些', () => {
  // 9/30 那筆是 ILIB（C 類 → 確認後沒有後續登記），8/13 那筆已經發生 ——
  // 兩筆都不長。壓表登記那一件她在舊系統上早就做完了，見
  // .scratch/todo-flow-rework/issues/01
  const ahead = plan(FUTURE(), { today: '2026-08-21' });
  assert.equal(countNewTasks([ahead], { courses: SEED.courses, today: '2026-08-21' }), 0);

  const past = plan(CUSTOMER(), { today: '2026-08-21' });
  assert.equal(countNewTasks([past], { courses: SEED.courses, today: '2026-08-21' }), 0);
});

test('未來的門診會長出 Examine 與耀聖 —— 那兩件是真的還沒做', () => {
  const entry = CUSTOMER();
  entry.entitlements.push({
    key: 'r9', type: 'single', label: '復健科醫師門診', totalQty: 2,
    courseName: '復健科醫師門診', optionEquipmentNames: [], productName: null,
  });
  entry.visits.push({
    date: '2026-09-30',
    status: 'done',
    slots: [{
      entitlementKey: 'r9', courseName: '復健科醫師門診', startsAt: '10:00', endsAt: '10:30',
      roomName: null, therapistName: null, equipmentName: null, ivProductName: null,
      confidence: 'high', evidence: '10.復健',
    }],
  });

  const ahead = plan(entry, { today: '2026-08-21' });
  assert.equal(countNewTasks([ahead], { courses: SEED.courses, today: '2026-08-21' }), 2);
});

test('整位跳過的客戶不算待辦', () => {
  const skipped = plan(FUTURE(), { today: '2026-08-21', existingCustomers: [{ id: 'c1', name: '客戶A' }] });
  assert.equal(countNewTasks([skipped], { courses: SEED.courses, today: '2026-08-21' }), 0);
});

// ---------- 已經發生的那一筆一張都不長（ADR-0093、報告 §1.1） ----------
//
// 2026-09-16 實跑她那份 import：`countNewTasks()` 回 18，而那 18 張**全部是
// 「寫紀錄」、全部掛在已經發生的來訪上**（9 張二返 ＋ 9 張復健科醫師門診），
// 死線 5/21 到 9/15。確認框卻印著「還沒發生的那幾筆會產生 18 筆登記待辦；
// 已經發生的一筆都不會長」—— 每一半都是反的。
//
// 為什麼以前的測試沒抓到：底下那個「過去的來訪」用的課程沒有 `needsRecord`。

/** 一位客戶，六月做過一次二返（`needsRecord: true`），沒有任何未來的來訪。 */
const PAST_RECORD = () => ({
  sheetName: '客戶A',
  name: '客戶A',
  source: null,
  notes: null,
  entitlements: [{
    key: 'ck', type: 'single', label: '健檢', totalQty: 1,
    courseName: '健檢', optionEquipmentNames: [], productName: null,
  }],
  // 健檢一展開就配一筆二返（`followupPlanEntries()`），所以這一段對得到額度
  visits: [{
    date: '2026-06-18',
    status: 'done',
    slots: [{
      entitlementKey: 'ck-followup', courseName: '二返', startsAt: '14:00', endsAt: '14:30',
      roomName: null, therapistName: null, equipmentName: null, ivProductName: null,
      confidence: 'high', evidence: '（編的）',
    }],
  }],
});

describe('匯進來的來訪會長出什麼任務', () => {
  const TODAY = '2026-09-16';
  const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));

  test('這份 fixture 真的匯得進去（不是因為解析失敗才數到 0）', () => {
    const p = plan(PAST_RECORD(), { today: TODAY });
    assert.equal(p.skip, null);
    assert.equal(p.visits.length, 1, `problems: ${JSON.stringify(p.problems)}`);
    assert.equal(p.visits[0].status, 'done');
    assert.equal(p.counts.future, 0);
  });

  test('已經發生的那一筆一張都不長 —— 那一份紀錄她早就寫進耀聖了', () => {
    const p = plan(PAST_RECORD(), { today: TODAY });
    assert.equal(countNewTasks([p], { courses: SEED.courses, today: TODAY }), 0);
    assert.deepEqual(
      p.visits.flatMap((v) => importedTasksFor(v, { coursesById, today: TODAY })),
      [],
    );
  });

  test('一出生就逾期的紅字一張都不可以有', () => {
    const p = plan(PAST_RECORD(), { today: TODAY });
    const overdue = p.visits
      .flatMap((v) => importedTasksFor(v, { coursesById, today: TODAY }))
      .filter((t) => t.dueDate < TODAY);
    assert.deepEqual(overdue.map((t) => `${t.kind}・${t.dueDate}`), []);
  });

  test('這一條不是「濾掉寫紀錄」—— 同一筆來訪正常存檔時照樣長得出來', () => {
    // 她自己記完一場二返，那一張「寫紀錄」是真的要做的事（ADR-0066）
    const p = plan(PAST_RECORD(), { today: TODAY });
    const visit = { id: 'v1', customerId: 'c1', ...p.visits[0] };
    const { create } = syncTasksForVisit(visit, [], { coursesById, today: TODAY });
    assert.deepEqual(create.map((t) => t.kind), [RECORD_TASK_KIND]);
  });

  test('還沒發生的那一筆照舊長掛號任務', () => {
    const entry = CUSTOMER();
    entry.entitlements.push({
      key: 'r9', type: 'single', label: '復健科醫師門診', totalQty: 2,
      courseName: '復健科醫師門診', optionEquipmentNames: [], productName: null,
    });
    entry.visits.push({
      date: '2026-09-30',
      status: 'done',
      slots: [{
        entitlementKey: 'r9', courseName: '復健科醫師門診', startsAt: '10:00', endsAt: '10:30',
        roomName: null, therapistName: null, equipmentName: null, ivProductName: null,
        confidence: 'high', evidence: '10.復健',
      }],
    });
    const p = plan(entry, { today: '2026-08-21' });
    const ahead = p.visits.find((v) => v.date === '2026-09-30');
    assert.equal(ahead.status, 'confirmed');
    assert.deepEqual(
      importedTasksFor(ahead, { coursesById, today: '2026-08-21' }).map((t) => t.kind).sort(),
      ['Examine', '耀聖'],
    );
    // **復健科醫師門診也有 `needsRecord`**，而未來那一筆不可以長出它
    assert.equal(
      importedTasksFor(ahead, { coursesById, today: '2026-08-21' })
        .some((t) => t.kind === RECORD_TASK_KIND),
      false,
    );
  });
});

// ---------- 營養點滴額度記得住買的是哪一款（報告 §3.1） ----------

describe('營養點滴額度身上的 ivProductId', () => {
  const PRODUCT = SEED.ivProducts[0];

  const withIv = (productName) => {
    const entry = CUSTOMER();
    entry.entitlements.push({
      key: 'iv', type: 'single', label: `營養點滴 - ${productName ?? ''}`.trim(), totalQty: 10,
      courseName: '營養點滴', optionEquipmentNames: [], productName: productName ?? null,
    });
    return plan(entry, { today: '2026-09-16' });
  };
  const ivDoc = (p) => p.entitlements.find((e) => e.key === 'iv').doc;

  test('買的那一款對得到主檔就記下來', () => {
    assert.equal(ivDoc(withIv(PRODUCT.name)).ivProductId, PRODUCT.id);
  });

  test('記下來之後排班時那一款排第一顆', () => {
    const choices = ivChoicesFor(ivDoc(withIv(PRODUCT.name)), SEED.ivProducts);
    assert.deepEqual(choices.primary.map((x) => x.id), [PRODUCT.id]);
  });

  test('舊表沒寫品項的（「營養針」那種）是 null，而且不報問題', () => {
    const p = withIv(null);
    assert.equal(ivDoc(p).ivProductId, null);
    assert.equal(why(p).some((x) => x.includes('營養點滴品項')), false);
    // null 時 `ivChoicesFor()` 退回全部列出來 —— 那是對的，不是壞掉
    assert.ok(ivChoicesFor(ivDoc(p), SEED.ivProducts).primary.length > 1);
  });

  test('對不到主檔就留空並講一聲 —— 不要猜一個她沒買的品項', () => {
    const p = withIv('不存在的品項');
    assert.equal(ivDoc(p).ivProductId, null);
    assert.ok(why(p).some((x) => x.includes('主檔裡沒有這個營養點滴品項')));
  });
});

// ---------- 誰：醫師與治療師是兩個欄位（ADR-0026、報告 §2.3） ----------
//
// 產檔那側只有一格「誰」（行事曆上的「*許」寫在 `therapistName`），
// 而 2026-09-16 之前這一側不看角色 —— 她那份 import 的 9 段二返裡有 8 段
// 把醫師寫進了 `therapistId`，`doctorId` 連 `null` 都沒有。

describe('那一格「誰」要看角色', () => {
  const DOCTOR = SEED.staff.find((x) => x.role === '醫師').name;
  const THERAPIST = SEED.staff.find((x) => x.role === '物理治療師').name;
  const staffById = Object.fromEntries(SEED.staff.map((x) => [x.id, x]));

  const withWho = (who) => {
    const entry = CUSTOMER();
    entry.entitlements.push({
      key: 'ck', type: 'single', label: '健檢', totalQty: 1,
      courseName: '健檢', optionEquipmentNames: [], productName: null,
    });
    entry.visits.push({
      date: '2026-07-17',
      status: 'done',
      slots: [{
        entitlementKey: 'ck-followup', courseName: '二返', startsAt: '14:00', endsAt: '14:30',
        roomName: null, therapistName: who, equipmentName: null, ivProductName: null,
        confidence: 'high', evidence: '（編的）',
      }],
    });
    return plan(entry, { today: '2026-09-16' });
  };

  const followupSlot = (p) => p.visits.find((v) => v.date === '2026-07-17').slots[0];

  test('是醫師就進 doctorId，治療師那一格留空', () => {
    const slot = followupSlot(withWho(DOCTOR));
    assert.equal(staffById[slot.doctorId]?.role, '醫師');
    assert.equal(slot.therapistId, null);
  });

  test('是治療師就照舊進 therapistId，醫師那一格是 null 不是漏掉', () => {
    const slot = followupSlot(withWho(THERAPIST));
    assert.equal(staffById[slot.therapistId]?.role, '物理治療師');
    assert.equal(slot.doctorId, null);
  });

  test('沒寫誰的時候兩格都是 null，而且不報問題', () => {
    const p = plan(CUSTOMER(), { today: '2026-09-16' });
    const slot = p.visits[0].slots[1]; // ILIB 那一段沒有治療師
    assert.equal(slot.therapistId, null);
    assert.equal(slot.doctorId, null);
    assert.equal(why(p).some((x) => x.includes('治療師')), false);
  });

  test('對不到主檔照舊講一聲，而且講的是「治療師」（她在行事曆上寫那個字的位置）', () => {
    const p = withWho('不存在的人');
    assert.ok(why(p).some((x) => x.includes('主檔裡沒有這個治療師')));
    assert.equal(followupSlot(p).therapistId, null);
    assert.equal(followupSlot(p).doctorId, null);
  });
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

describe('行事曆上的雜事分三類', () => {
  test('eventKind() 讀產檔那側判好的分類', () => {
    assert.equal(eventKind({ kind: 'leave' }), 'leave');
    assert.equal(eventKind({ kind: 'note' }), 'note');
    assert.equal(eventKind({ kind: 'personal' }), 'personal');
  });

  // 2026-08-23 以前產的合併檔沒有 kind，那時候也還沒有「待辦」這一類。
  // 舊檔案照樣讀得進來，只是三類變兩類。
  test('舊的合併檔只有 category，照樣讀得進來', () => {
    assert.equal(eventKind({ category: 'leave' }), 'leave');
    assert.equal(eventKind({ category: 'personal' }), 'personal');
    assert.equal(eventKind({}), 'personal');
    assert.equal(eventKind({ kind: '亂寫的' }), 'personal');
  });

  test('休假走 events 的 category，不是另一個集合', () => {
    const [leave, plain] = eventDocs([
      { title: '休', startDate: '2026-09-05', endDate: '2026-09-05', allDay: true, kind: 'leave' },
      { title: '公出', startDate: '2026-09-06', endDate: '2026-09-06', allDay: true, kind: 'personal' },
    ]);
    assert.equal(leave.category, 'leave');
    assert.equal(plain.category, 'personal');
  });

  // 掛了日期的隨手記就是日曆上的待辦（ADR-0044），不是第三份資料 ——
  // 所以這裡吐的是 notes 的形狀，不是 events 的。
  test('待辦變成掛了日期的隨手記', () => {
    const [note] = noteDocs([
      { title: 'H2U電話', startDate: '2026-09-07', startTime: '14:00', kind: 'note' },
    ]);
    assert.equal(note.text, 'H2U電話');
    assert.equal(note.date, '2026-09-07');
    assert.equal(note.done, false);
    // 隨手記存得下日期、存不下時間，而判成待辦的前提就是她沒在標題最前面寫時間
    assert.equal(note.startTime, undefined);
    // 認錯人會把一件雜事掛到錯的客戶身上，所以一律不掛
    assert.equal(note.customerId, null);
    assert.equal(note.customerName, null);
  });
});

// ---------- 醫療禁忌（貼舊試算表那條路拿掉之後，這裡是唯一的守門員） ----------
//
// 舊表沒有「永久限制」這個欄位，那幾句話寫在購買名稱或空白處，合併檔照抄進備註。
// 匯進來之後 `customer.flags` 是空的，而擋器材是拿 flags 去比對的 ——
// 沒有那個標記，SIS 與高能量雷射不會被提醒，那是唯一會造成實際傷害的一條。
//
// 這一段 2026-08-23 從 tests/legacy-import.test.js 搬過來：那條路的入口拿掉了，
// 而**這條路以前根本沒有這個提示**。搬過來不是為了保住覆蓋率，是因為
// 拿掉一條路不可以順手拿掉一個安全網。
describe('文字裡的醫療禁忌要在匯入前講出來', () => {
  const metal = () => planForCustomer(
    { ...CUSTOMER(), source: '0604 顧客會-手有金屬，只能INDIBA' },
    { ...CTX, existingCustomers: [] },
  );

  test('購買名稱裡的禁忌字眼認得出來，並說得出沒設定會漏擋哪幾台', () => {
    const hits = metal().contraindications;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].term, '體內金屬');
    assert.deepEqual(hits[0].warns.sort(), ['SIS', '高能量雷射']);
  });

  test('備註裡的也算 —— 舊表的空白處就是寫在那裡', () => {
    const p = planForCustomer(
      { ...CUSTOMER(), notes: 'A15｜手術後體內金屬還在' },
      { ...CTX, existingCustomers: [] },
    );
    assert.equal(p.contraindications[0]?.term, '體內金屬');
  });

  test('app 這一側不自己判警示：檔案沒帶 flags 就是空的（判準只在產檔那側，ADR-0092）', () => {
    // 「手有金屬」要帶、「金屬已取出」不帶 —— 那個判斷只能有一份，在 legacyImport.js 的
    // flagsFromText()。這一側再判一次的話，兩邊遲早講不一樣的話。
    assert.deepEqual(metal().customer.flags, []);
  });

  test('摘要要數得出有幾位，那一頁才畫得出最上面那張紅卡', () => {
    const s = summarize([metal()]);
    assert.equal(s.contraindications.length, 1);
    assert.deepEqual(s.contraindications[0].terms, ['體內金屬']);
  });

  test('整張跳過的那幾位不算 —— 她們根本不會進來', () => {
    const s = summarize([planForCustomer(
      { ...CUSTOMER(), source: '0604 顧客會-手有金屬' },
      { ...CTX, existingCustomers: [{ id: 'c1', name: CUSTOMER().name }] },
    )]);
    assert.equal(s.contraindications.length, 0);
  });
});

// ---------- 待辦與行事備註分別寫到哪個集合 ----------
//
// 「待辦寫進 notes、另外兩種寫進 events」是規則不是畫面（SPEC 第 10 節），
// 所以它在 domain 而不在那一頁的事件處理器裡。
describe('looseDocs() 是那個分歧點', () => {
  const CANDS = [
    { title: '休', startDate: '2026-09-05', endDate: '2026-09-05', allDay: true, kind: 'leave' },
    { title: 'H2U電話', startDate: '2026-09-06', endDate: '2026-09-06', startTime: '14:00', kind: 'note' },
    { title: '顧客會', startDate: '2026-09-07', endDate: '2026-09-07', startTime: '19:00', kind: 'personal' },
  ];
  const fileKind = (i) => eventKind(CANDS[i]);

  test('待辦走 notes，另外兩種走 events', () => {
    const { events, notes } = looseDocs(CANDS, fileKind, [0, 1, 2]);
    assert.deepEqual(events.map((e) => e.title), ['休', '顧客會']);
    assert.deepEqual(notes.map((n) => n.text), ['H2U電話']);
    assert.deepEqual(events.map((e) => e.category), ['leave', 'personal']);
  });

  test('沒勾的一筆都不進去', () => {
    const { events, notes } = looseDocs(CANDS, fileKind, [1]);
    assert.equal(events.length, 0);
    assert.equal(notes.length, 1);
  });

  // 這是整支功能的重點：產檔那側判的只是建議，她改掉的那一個才算數。
  test('她改過的分類要真的改變寫到哪裡', () => {
    const hers = (i) => (i === 2 ? 'note' : 'leave');
    const { events, notes } = looseDocs(CANDS, hers, [0, 1, 2]);
    assert.deepEqual(notes.map((n) => n.text), ['顧客會'], '她把顧客會改成待辦');
    assert.deepEqual(events.map((e) => e.category), ['leave', 'leave'], '她把 H2U電話 改成休假');
  });

  // 隨手記的空日期要收成 null 不是空字串 —— 日曆是 where('date','>=',…) 撈的，
  // 空字串撈得到而 null 撈不到（domain/notes.js 的 normalize()）。
  test('待辦的形狀走隨手記自己的 normalize()', () => {
    const [n] = looseDocs([{ title: '記得帶健保卡', startDate: '' }], () => 'note', [0]).notes;
    assert.equal(n.date, null);
    assert.equal(n.customerId, null);
    assert.equal(n.done, false);
  });

  test('匯進來的東西標得出是從哪一次合併來的', () => {
    const json = { calendar: { file: 'timetree.ics' } };
    const { events, notes } = looseDocs(CANDS, fileKind, [0, 1], json);
    assert.equal(events[0].importedFrom.source, 'merge-file');
    assert.equal(events[0].importedFrom.calendar, 'timetree.ics');
    assert.equal(notes[0].importedFrom.calendar, 'timetree.ics');
  });

  test('數得出勾起來的各有幾筆', () => {
    assert.deepEqual(
      looseTally(CANDS, fileKind, [0, 1, 2]).map((x) => [x.label, x.count]),
      [['待辦', 1], ['行事備註', 1], ['休假', 1]],
    );
  });
});

// ---------------------------------------------------------------------------
// 合併檔 v2：購買日、方案與套數、帶顏色的備註（`.scratch/asks-2026-09-13/issues/08`）。
//
// 她 2026-09-13：「也希望你幫我調整完後也幫我去修改合併的那個skill，讓他們相容」。

describe('合併檔 v2', () => {
  const V2 = () => ({
    ...CUSTOMER(),
    source: '顧客會',
    purchasedAt: '2026-05-22',
    marks: [{ text: '病歷號 9001', color: 'grey' }, { text: '欠尾款3萬', color: 'red' }],
    purchaseProblems: ['購買名稱寫 2 套，但應有次數是 1 套，照應有次數匯'],
    entitlements: CUSTOMER().entitlements.map((e) => ({
      ...e,
      purchasedAt: '2026-05-22',
      sourcePlanName: '8萬方案',
      sourcePlanSets: 1,
      sourcePlanQty: e.totalQty,
      purchaseKey: 'plan',
    })),
  });

  test('v1、v2 的檔案照樣收，認不得的版本整份擋', () => {
    assert.deepEqual(validateFile(FILE()).errors, []);
    assert.deepEqual(validateFile({ ...FILE(), format: 'baobao-merge/v1' }).errors, []);
    assert.deepEqual(validateFile({ ...FILE(), format: 'baobao-merge/v2' }).errors, []);
    assert.ok(validateFile({ ...FILE(), format: 'baobao-merge/v9' }).errors.length);
  });

  test('客戶帶購買日、通路與帶顏色的備註；notes 是備註的鏡像', () => {
    const p = plan(V2());
    assert.equal(p.customer.purchasedAt, '2026-05-22');
    assert.equal(p.customer.source, '顧客會');
    assert.deepEqual(p.customer.marks, [{ text: '病歷號 9001', color: 'grey' }, { text: '欠尾款3萬', color: 'red' }]);
    assert.equal(p.customer.notes, '病歷號 9001\n欠尾款3萬');
  });

  test('額度帶購買日、方案名、套數，同一次購買同一個 purchaseId', () => {
    const p = plan(V2());
    const docs = p.entitlements.filter((e) => !e.doc.followupForEntitlementKey).map((e) => e.doc);
    assert.ok(docs.every((d) => d.purchasedAt === '2026-05-22'));
    assert.ok(docs.every((d) => d.sourcePlanName === '8萬方案' && d.sourcePlanSets === 1));
    assert.equal(new Set(docs.map((d) => d.purchaseId)).size, 1);
    assert.ok(docs[0].purchaseId);
    assert.ok(docs.every((d) => !('purchaseKey' in d)), '那個 key 只是檔案裡的暗號，不寫進資料庫');
  });

  test('購買名稱對不上的那幾條帶出來，匯入那一頁要列', () => {
    assert.deepEqual(plan(V2()).purchaseProblems, ['購買名稱寫 2 套，但應有次數是 1 套，照應有次數匯']);
  });

  test('v1 的客戶：沒有的欄位一律 null，備註從 notes 讀', () => {
    const p = plan(CUSTOMER());
    assert.equal(p.customer.purchasedAt, null);
    assert.equal(p.customer.marks, undefined, 'v1 沒有 marks 就不寫 —— readMarks() 會從 notes 拆');
    assert.ok(p.entitlements.every((e) => e.doc.sourcePlanName === null && e.doc.purchasedAt === null));
    assert.deepEqual(p.purchaseProblems, []);
  });
});

// ---------------------------------------------------------------------------
// 合併檔 v3（`.scratch/merge-answers-2026-09-14/issues/02`）：時長、警示、合作機構。

describe('合併檔 v3', () => {
  test('格式是 v3', () => {
    assert.equal(FORMAT, 'baobao-merge/v3');
  });

  test('額度帶時長：30 分的就是 30，沒寫的退回課程', () => {
    const entry = CUSTOMER();
    entry.entitlements[0].durationMin = 30;
    const p = plan(entry);
    assert.equal(p.entitlements.find((e) => e.key === 'r7').doc.durationMin, 30);
    assert.equal(p.entitlements.find((e) => e.key === 'r8').doc.durationMin,
      SEED.courses.find((c) => c.name === 'ILIB').durationMin, '沒寫就是課程的時長（v1、v2 照舊）');
  });

  test('警示與合作機構原樣寫到客戶身上（客戶身上存的是字串，ADR-0074、0076）', () => {
    const p = plan({ ...CUSTOMER(), flags: ['體內金屬'], partners: ['某合作機構'] });
    assert.deepEqual(p.customer.flags, ['體內金屬']);
    assert.deepEqual(p.customer.partners, ['某合作機構']);
  });

  test('v1、v2 沒有這兩格就是空的', () => {
    const p = plan(CUSTOMER());
    assert.deepEqual(p.customer.flags, []);
    assert.deepEqual(p.customer.partners, []);
  });

  test('亂塞的值不寫進去（只收字串陣列）', () => {
    const p = plan({ ...CUSTOMER(), flags: '體內金屬', partners: [1, '', '某合作機構'] });
    assert.deepEqual(p.customer.flags, []);
    assert.deepEqual(p.customer.partners, ['某合作機構']);
  });
});
