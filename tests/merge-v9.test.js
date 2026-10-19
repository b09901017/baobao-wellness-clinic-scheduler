// 合併檔 v9：舊表的備註分到該去的地方（2026-10-20，`.scratch/merge-v9-notes/`）。
//
// 她的原話：
//
// > 通常我試算表，A B 底下放的都是這個客戶的整體備註，然後F 之後的療程內容最底下的在往下一排都是當天的那個時段的備註，
// > 如果那一整排有日期單是沒勾最下面寫得像是她忘記，就是她取消的理由，請不要全部都放入這個客戶的備註之中，
// > 如果有你判斷是長備註，也可以幫我變成長備註
//
// v8 只帶得了客戶的短備註。v9 多四格（都選填）：段的 `note`、段的 `status`（只收已取消／未到）＋`cancelReason`、客戶的 `longNotes`。
// 名字一律假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMAT, FORMATS, validateFile, planForCustomer, summarize, addExtraVisits, countNewTasks, countTickedTasks,
  missedSlotsLine, newTasksLine,
} from '../public/js/domain/mergeImport.js';
import { SEED } from '../public/js/domain/seed.js';
import { recount, slotCancelReasonOf, slotStatus, validateVisit, withSlotStatuses } from '../public/js/domain/visits.js';
import { importedTasksFor, isCancelKind, syncTasksForVisit } from '../public/js/domain/taskRules.js';
import { counts } from '../public/js/domain/entitlements.js';
import { noteItems, readLongNotes, validateLongNotes } from '../public/js/domain/customerNotes.js';

const TODAY = '2026-10-20';
const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, existingCustomers: [], today: TODAY,
};
const ILIB = { key: 'r8', type: 'single', label: 'ILIB 60mins', totalQty: 20, durationMin: 60, courseName: 'ILIB', optionEquipmentNames: [], productName: null };
const slot = (over = {}) => ({ entitlementKey: 'r8', courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00', roomName: null, therapistName: null, equipmentName: null, ivProductName: null, confidence: 'high', evidence: null, ...over });
const entry = (over = {}) => ({ sheetName: '王小明', name: '王小明', notes: '', marks: [], entitlements: [ILIB], visits: [], ...over });
const file = (customers) => ({ format: FORMAT, calendar: { file: 'x', span: [], events: 0 }, customers, futureVisits: [], missingFromSheet: [], eventCandidates: [] });
const errorsOf = (c) => validateFile(file([c])).errors;

describe('契約：baobao-merge/v9', () => {
  test('一律寫 v10（v10 只多客戶的 LINE 名字）；v1～v9 照收', () => {
    assert.equal(FORMAT, 'baobao-merge/v10');
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(FORMATS.includes(`baobao-merge/v${v}`), `v${v}`);
  });
});

describe('段的「記一句」（issue 02）', () => {
  test('帶 note 的那一段寫進 slot.note（去頭尾空白），其他段 null', () => {
    const plan = planForCustomer(entry({
      visits: [{ date: '2026-10-16', status: 'done', slots: [slot({ note: '  遲到十五分鐘 ' }), slot({ startsAt: '11:15', endsAt: '12:15' })] }],
    }), CTX);
    assert.deepEqual(plan.problems, []);
    assert.equal(plan.visits[0].slots[0].note, '遲到十五分鐘');
    assert.equal(plan.visits[0].slots[1].note, null);
  });

  test('v8 那種沒有 note 的段：note 是 null（讀的那一側都先 ?? 空字串，跟沒有那一格一樣）', () => {
    const plan = planForCustomer(entry({ visits: [{ date: '2026-10-16', status: 'done', slots: [slot()] }] }), CTX);
    assert.equal(plan.visits[0].slots[0].note, null);
  });

  test('note 不是字串、或超過 200 字 → 整份拒收（不是安靜截掉）', () => {
    const bad = (note) => errorsOf(entry({ visits: [{ date: '2026-10-16', status: 'done', slots: [slot({ note })] }] }));
    assert.equal(bad('遲到').length, 0);
    assert.equal(bad(null).length, 0);
    assert.ok(bad(42).length);
    assert.ok(bad('字'.repeat(201)).length);
  });

  test('摘要卡數得到幾段帶記一句；同名跳過的那一位不算', () => {
    const visits = [{ date: '2026-10-16', status: 'done', slots: [slot({ note: '遲到' }), slot({ startsAt: '11:15', endsAt: '12:15', note: '  ' })] }];
    const kept = planForCustomer(entry({ visits }), CTX);
    const skipped = planForCustomer(entry({ name: '李小華', visits }), { ...CTX, existingCustomers: [{ id: 'c1', name: '李小華' }] });
    assert.equal(kept.counts.slotNotes, 1, '空白的那一格不算');
    assert.equal(summarize([kept, skipped]).slotNotes, 1);
  });
});

// ---------- issue 03：已取消／未到的段＋取消理由 ----------
//
// 她 10/20 選的：沒勾、底下寫理由的那幾格建成那一天已取消的段＋取消理由（課程與時間從 Abovee 那天取消的那一列拿）；
// 客戶失約的建成未到、理由記在記一句。不扣次數。取消類的待辦長一張**已經勾好的**（ADR-0164）——
// 只是「不長」的話，之後任何一次存那一天 `cancelTasksFor()` 就補長一張，叫她去放一個舊系統上早就放掉的時段。

const CLINIC = { key: 'r1', type: 'single', label: '復健科醫師門診', totalQty: 4, durationMin: 30, courseName: '復健科醫師門診', optionEquipmentNames: [], productName: null };
const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));

/** 照 `data/legacyImport.js` 的 `importPlan()` 換 id、補段的狀態（那一支連著 Firestore，測不到） */
const asImported = (plan) => plan.visits.map((v, n) => withSlotStatuses({
  id: `v${n}`, ...v, customerId: 'c1',
  slots: v.slots.map(({ entitlementKey, ...s }) => ({ ...s, entitlementId: entitlementKey ? `e:${entitlementKey}` : null })),
}));
const entsOf = (plan) => plan.entitlements.map((e) => ({ id: `e:${e.key}`, ...e.doc }));
const tasksOf = (visit) => importedTasksFor(visit, { coursesById, today: TODAY, at: '2026-10-20T00:00:00Z' });
const day = (date, slots, status = 'done') => ({ date, status, slots });

describe('段的狀態與取消理由：檔案的形狀（issue 03）', () => {
  const bad = (over) => errorsOf(entry({ visits: [day('2026-10-16', [slot(over)])] }));

  test('只收已取消、未到；done、confirmed 或亂寫整份拒收（那兩種是整筆的事）', () => {
    assert.equal(bad({ status: 'cancelled' }).length, 0);
    assert.equal(bad({ status: 'no_show' }).length, 0);
    assert.equal(bad({ status: null }).length, 0);
    for (const status of ['done', 'confirmed', 'pending_confirm', '取消', 3]) assert.ok(bad({ status }).length, String(status));
  });

  test('取消理由：字串、200 字以內、只寫在已取消的段上', () => {
    assert.equal(bad({ status: 'cancelled', cancelReason: '她忘記' }).length, 0);
    assert.equal(bad({ status: 'cancelled', cancelReason: null }).length, 0);
    assert.ok(bad({ status: 'cancelled', cancelReason: 42 }).length);
    assert.ok(bad({ status: 'cancelled', cancelReason: '字'.repeat(201) }).length);
    assert.ok(bad({ cancelReason: '她忘記' }).length, '沒取消的段寫了理由：產檔那側寫錯了');
    assert.ok(bad({ status: 'no_show', cancelReason: '她忘記' }).length, '失約的理由寫在記一句');
  });
});

describe('段的狀態寫實、整筆照段推（issue 03）', () => {
  test('v8 那種沒有段狀態的：每一段寫實整筆的（過去的已完成、今天之後的已確認），跟以前補出來的一樣', () => {
    const plan = planForCustomer(entry({ visits: [day('2026-10-16', [slot()]), day('2026-10-28', [slot()])] }), CTX);
    assert.deepEqual(plan.visits.map((v) => [v.status, v.slots[0].status, v.slots[0].attended]), [['done', 'done', true], ['confirmed', 'confirmed', false]]);
  });

  test('一段做完、一段取消：整筆已完成、理由在那一段上、次數只算做完的那一段', () => {
    const plan = planForCustomer(entry({ visits: [day('2026-10-16', [
      slot(),
      slot({ startsAt: '11:15', endsAt: '12:15', status: 'cancelled', cancelReason: ' 她忘記 ' }),
    ])] }), CTX);
    assert.deepEqual(plan.problems, []);
    const [v] = asImported(plan);
    assert.equal(v.status, 'done');
    assert.equal(slotStatus(v, v.slots[1]), 'cancelled');
    assert.equal(slotCancelReasonOf(v, v.slots[1]), '她忘記');
    assert.equal(slotCancelReasonOf(v, v.slots[0]), null);
    assert.deepEqual(recount(['e:r8'], [v])['e:r8'], { doneCount: 1, bookedCount: 0 });
  });

  test('只有一段、取消了 → 整筆已取消；只剩未到 → 整筆未到；取消＋未到 → 整筆未到', () => {
    const statusOf = (slots) => planForCustomer(entry({ visits: [day('2026-10-16', slots)] }), CTX).visits[0].status;
    assert.equal(statusOf([slot({ status: 'cancelled' })]), 'cancelled');
    assert.equal(statusOf([slot({ status: 'no_show' })]), 'no_show');
    assert.equal(statusOf([slot({ status: 'cancelled' }), slot({ startsAt: '11:15', status: 'no_show' })]), 'no_show');
  });

  test('今天之後的一天：一段取消、一段還沒來 → 整筆已確認', () => {
    const plan = planForCustomer(entry({ visits: [day('2026-10-28', [slot({ status: 'cancelled' }), slot({ startsAt: '11:15' })])] }), CTX);
    assert.equal(plan.visits[0].status, 'confirmed');
    assert.deepEqual(plan.visits[0].slots.map((s) => s.status), ['cancelled', 'confirmed']);
  });

  test('未到：不扣、剩的不少；記一句照帶', () => {
    const plan = planForCustomer(entry({ visits: [day('2026-10-16', [slot({ status: 'no_show', note: '客戶失約' })])] }), CTX);
    const [v] = asImported(plan);
    const c = counts({ totalQty: 20 }, [v], 'e:r8');
    assert.equal(c.noShow, 1);
    assert.equal(c.remaining, 20);
    assert.equal(v.slots[0].note, '客戶失約');
    assert.equal(v.slots[0].attended, false);
  });

  test('取消的段帶著額度：之後她編輯那一天存得下去（validateVisit 每一段都要額度）', () => {
    const plan = planForCustomer(entry({ visits: [day('2026-10-16', [slot(), slot({ startsAt: '11:15', endsAt: '12:15', status: 'cancelled' })])] }), CTX);
    const visits = asImported(plan);
    const { errors } = validateVisit(visits[0], {
      customer: { id: 'c1', name: '王小明' }, courses: SEED.courses, equipment: SEED.equipment,
      ivProducts: SEED.ivProducts, staff: SEED.staff, entitlements: entsOf(plan), customerVisits: visits,
    });
    assert.deepEqual(errors, []);
  });
});

describe('取消類的待辦：一出生就勾好（issue 03、ADR-0164）', () => {
  const planOf = (visits) => planForCustomer(entry({ entitlements: [ILIB, CLINIC], visits }), CTX);

  test('只有一段、取消了 → 一張勾好的「取消 Abovee」蓋那一段，沒有沒勾的', () => {
    const [v] = asImported(planOf([day('2026-10-16', [slot({ status: 'cancelled' })])]));
    const tasks = tasksOf(v);
    assert.deepEqual(tasks.map((t) => [t.kind, t.done, t.slotIndexes]), [['取消 Abovee', true, [0]]]);
    assert.equal(tasks[0].doneAt, '2026-10-20T00:00:00Z');
    assert.doesNotMatch(tasks[0].note, /回去/, '不叫她回去放一個已經放掉的時段');
  });

  test('做完＋取消、取消＋未到 → 取消類全部勾好；其餘一張都不長（已經發生的，ADR-0093）', () => {
    for (const slots of [
      [slot(), slot({ startsAt: '11:15', status: 'cancelled' })],
      [slot({ status: 'cancelled' }), slot({ startsAt: '11:15', status: 'no_show' })],
    ]) {
      const [v] = asImported(planOf([day('2026-10-16', slots)]));
      const tasks = tasksOf(v);
      assert.ok(tasks.length, '有一張取消類');
      assert.ok(tasks.every((t) => isCancelKind(t.kind) && t.done), JSON.stringify(tasks.map((t) => t.kind)));
    }
  });

  test('取消＋還沒來（今天之後）→ 取消的勾好；還沒來的那一段照常長掛號、沒勾', () => {
    const clinic = slot({ entitlementKey: 'r1', courseName: '復健科醫師門診', startsAt: '11:15', endsAt: '11:45' });
    const [v] = asImported(planOf([day('2026-10-28', [slot({ status: 'cancelled' }), clinic])]));
    const tasks = tasksOf(v);
    const cancels = tasks.filter((t) => isCancelKind(t.kind));
    const open = tasks.filter((t) => !t.done);
    assert.deepEqual(cancels.map((t) => [t.kind, t.done, t.slotIndexes]), [['取消 Abovee', true, [0]]]);
    assert.deepEqual(open.map((t) => [t.kind, t.slotIndexes]).sort(), [['Examine', [1]], ['耀聖', [1]]]);
  });

  test('之後再存一次那一天：一張取消類都不補長', () => {
    for (const slots of [
      [slot({ status: 'cancelled' })],
      [slot(), slot({ startsAt: '11:15', status: 'cancelled' })],
    ]) {
      const [v] = asImported(planOf([day('2026-10-16', slots)]));
      const born = tasksOf(v).map((t, i) => ({ id: `t${i}`, ...t }));
      const again = syncTasksForVisit(v, born, { coursesById, today: TODAY });
      assert.deepEqual(again.create.filter((t) => isCancelKind(t.kind)), []);
    }
  });

  test('匯入頁的數字：countNewTasks 只數沒勾的（要做的事），勾好的另外數', () => {
    const plan = planOf([day('2026-10-16', [slot({ status: 'cancelled' })]), day('2026-10-17', [slot(), slot({ startsAt: '11:15', status: 'cancelled' })])]);
    assert.equal(countNewTasks([plan], { courses: SEED.courses, today: TODAY }), 0);
    assert.equal(countTickedTasks([plan], { courses: SEED.courses, today: TODAY }), 2);
  });
});

describe('候選併進同一天（addExtraVisits）＋摘要卡（issue 03）', () => {
  test('併進一天整筆已取消的：新的那一段寫實自己的狀態、整筆重推', () => {
    const plan = planForCustomer(entry({ visits: [day('2026-10-28', [slot({ status: 'cancelled' })])] }), CTX);
    assert.equal(plan.visits[0].status, 'cancelled');
    const problems = addExtraVisits([plan], [{ customerName: '王小明', date: '2026-10-28', courseName: 'ILIB', startsAt: '14:00' }], CTX);
    assert.deepEqual(problems, []);
    const v = plan.visits[0];
    assert.equal(v.slots[1].status, 'confirmed');
    assert.equal(v.status, 'confirmed');
    assert.equal(slotStatus(v, v.slots[1]), 'confirmed', '不會被整筆的「已取消」蓋掉');
    assert.equal(plan.counts.future, 1);
  });

  test('另開一天的候選：段上也寫實狀態', () => {
    const plan = planForCustomer(entry(), CTX);
    addExtraVisits([plan], [{ customerName: '王小明', date: '2026-10-28', courseName: 'ILIB', startsAt: '14:00' }], CTX);
    assert.equal(plan.visits[0].slots[0].status, 'confirmed');
  });

  test('摘要卡數得到幾段已取消、幾段未到', () => {
    const plan = planForCustomer(entry({ visits: [
      day('2026-10-16', [slot(), slot({ startsAt: '11:15', status: 'cancelled' })]),
      day('2026-10-17', [slot({ status: 'no_show' })]),
    ] }), CTX);
    const s = summarize([plan]);
    assert.equal(s.cancelled, 1);
    assert.equal(s.noShow, 1);
  });

  // 審查（10/20）：同一天幾段一起取消的收成一張（`cancelTasksFor()` 一種一張），寫「各記一張」就是講錯張數
  test('那一句的張數：同一天兩段一起取消是一張，不寫「各記一張」', () => {
    const plan = planForCustomer(entry({ visits: [
      day('2026-10-16', [slot({ status: 'cancelled' }), slot({ startsAt: '11:15', status: 'cancelled' })]),
    ] }), CTX);
    const ticked = countTickedTasks([plan], { courses: SEED.courses, today: TODAY });
    assert.equal(ticked, 1);
    const line = missedSlotsLine(summarize([plan]), ticked);
    assert.ok(line.includes('2 段已取消'));
    assert.ok(line.includes('1 張'));
    assert.ok(!line.includes('各記一張'), line);
    assert.equal(missedSlotsLine({ cancelled: 0, noShow: 0 }, 0), '', 'v8 的檔案一個字都不多');
  });

  // 審查（10/20）：確認框上面那一句才講了「會記幾張勾好的取消」，最後那一句還寫「不會產生任何待辦任務」（ADR-0070：只講真的會發生的事）
  test('確認框講任務的那一句：有一出生就勾好的那幾張時講「要做的」、講張數；沒有時一個字都不變', () => {
    assert.equal(newTasksLine({ future: 0 }, 0), '不會產生任何待辦任務 —— 這次沒有還沒發生的來訪');
    assert.equal(newTasksLine({ future: 2 }, 0), '不會產生任何待辦任務 —— 還沒發生的那 2 筆都是不用另外掛號的課程');
    assert.equal(newTasksLine({ future: 2 }, 3), '還沒發生的那幾筆會產生 3 筆登記待辦；已經發生的一筆都不會長');
    for (const [s, tasks] of [[{ future: 0, ticked: 2 }, 0], [{ future: 2, ticked: 2 }, 3]]) {
      const line = newTasksLine(s, tasks);
      assert.ok(!line.startsWith('不會產生任何待辦任務'), line);
      assert.ok(!line.includes('一筆都不會長'), line);
      assert.ok(line.includes('要做的') && line.includes('2 張'), line);
    }
  });
});

// ---------- issue 04：客戶的長備註 ----------
//
// 她 10/20：「A B 底下放的都是這個客戶的整體備註 … 如果有你判斷是長備註，也可以幫我變成長備註」。
// v8 只有短備註（一則 40 字、一位 12 則）：一大段被照句子切成好幾則，讀不懂、一位就超過上限。

describe('長備註（issue 04）', () => {
  const LONG = [
    { title: '家族史', body: '父親高血壓。\n母親糖尿病。' },
    { title: '營養諮詢筆記', body: '早餐多吃蛋白質' },
  ];

  test('v8 那種沒有 longNotes 的：客戶身上沒有那一格（跟以前一樣），讀起來是空的', () => {
    const plan = planForCustomer(entry(), CTX);
    assert.ok(!('longNotes' in plan.customer));
    assert.deepEqual(readLongNotes(plan.customer), []);
  });

  test('帶兩則：寫進 customer.longNotes、各有一個不一樣的 id、不寫順序（照預設排在短備註前面）', () => {
    const plan = planForCustomer(entry({ longNotes: LONG, marks: [{ text: '怕冷', color: null }] }), CTX);
    const notes = plan.customer.longNotes;
    assert.equal(notes.length, 2);
    assert.deepEqual(notes.map((n) => [n.title, n.body]), LONG.map((n) => [n.title, n.body]));
    assert.ok(notes.every((n) => n.id), '每一則都有 id');
    assert.equal(new Set(notes.map((n) => n.id)).size, 2);
    assert.ok(!('noteOrder' in plan.customer));
    assert.deepEqual(validateLongNotes(notes), []);
    const kinds = noteItems(plan.customer).map((x) => x.kind);
    assert.ok(kinds.lastIndexOf('long') < kinds.indexOf('mark'), JSON.stringify(kinds));
  });

  test('標題去頭尾空白；空的清單當沒寫', () => {
    const plan = planForCustomer(entry({ longNotes: [{ title: '  家族史 ', body: '父親高血壓' }] }), CTX);
    assert.equal(plan.customer.longNotes[0].title, '家族史');
    assert.ok(!('longNotes' in planForCustomer(entry({ longNotes: [] }), CTX).customer));
  });

  test('形狀不對整份拒收：標題 41 字、沒有標題、21 則、內文太長、不是陣列、標題不是字串', () => {
    const bad = (longNotes) => errorsOf(entry({ longNotes }));
    assert.equal(bad(LONG).length, 0);
    assert.equal(bad(null).length, 0);
    assert.ok(bad([{ title: '字'.repeat(41), body: '' }]).length);
    assert.ok(bad([{ title: '  ', body: '有內文' }]).length);
    assert.ok(bad(Array.from({ length: 21 }, (_, i) => ({ title: `第${i}則`, body: '' }))).length);
    assert.ok(bad([{ title: '家族史', body: '字'.repeat(5001) }]).length);
    assert.ok(bad({ title: '家族史', body: '' }).length);
    assert.ok(bad([{ title: 42, body: '' }]).length);
    assert.ok(bad([{ title: '家族史', body: 42 }]).length);
  });

  test('摘要卡：幾位帶長備註、一共幾則；同名跳過的不算', () => {
    const kept = planForCustomer(entry({ longNotes: LONG }), CTX);
    const skipped = planForCustomer(entry({ name: '李小華', longNotes: LONG }), { ...CTX, existingCustomers: [{ id: 'c1', name: '李小華' }] });
    const s = summarize([kept, skipped, planForCustomer(entry({ name: '陳小美' }), CTX)]);
    assert.equal(s.longNoteCustomers, 1);
    assert.equal(s.longNotes, 2);
  });
});
