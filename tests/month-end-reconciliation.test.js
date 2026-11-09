// 月底對帳 skill（`.claude/skills/month-end-reconciliation/`）的比對那一步。
//
// 那支 skill 一個月才跑一次，而它判斷「對不對得上」用的全是 app 自己的函式（`readAbovee()`、`absentFromPhoto()`、
// `counts()`、`syncBundle()`）—— 哪天其中一支改了形狀，月底才發現就晚了。這一支用假資料把 `reconcile.mjs` 整支跑一次：
// 乾淨的一個月要是 0 件；四種最常見的不一樣（還沒簽、app 沒有、app 多一段、Abovee 取消了 app 還排著）各要分對類；
// 認不出的人收在另外一份、不算進「要處理的」。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { SEED } from '../public/js/domain/seed.js';
import { counts } from '../public/js/domain/entitlements.js';

const SCRIPT = '.claude/skills/month-end-reconciliation/scripts/reconcile.mjs';
const PEOPLE = [
  { id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] },
  { id: 'c-a', name: '客戶甲', marks: [{ text: '病歷號 2222', color: 'grey' }] },
];
const CHART = { 王小明: '00001234', 客戶甲: '00002222' };
const POOL = (parentId) => ({
  id: `${parentId}-pool`, parentId, type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'],
  durationMin: 60, totalQty: 30,
});
const end = (t) => `${String(Number(t.slice(0, 2)) + 1).padStart(2, '0')}:${t.slice(3)}`;

/** app 那一側：`{ 'c-wang': { '2026-10-02': 'done' } }` → 一天一筆、一段 SIS 60 */
function snapshot(days) {
  const visits = [];
  for (const [customerId, byDate] of Object.entries(days)) {
    for (const [date, status] of Object.entries(byDate)) {
      visits.push({
        id: `v-${customerId}-${date}`, customerId, customerName: PEOPLE.find((p) => p.id === customerId).name, date, status,
        slots: [{ entitlementId: `${customerId}-pool`, courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '11:00', status }],
      });
    }
  }
  // 額度上存的次數跟重算的一樣（不然多一件「畫面上的次數要重算」）
  const entitlements = PEOPLE.map((p) => {
    const e = POOL(p.id);
    const c = counts(e, visits.filter((v) => v.customerId === p.id), e.id);
    return { ...e, doneCount: c.done, bookedCount: c.booked };
  });
  return {
    meta: { projectId: 'test', readAt: '2026-11-02T00:00:00.000Z' },
    customers: PEOPLE, entitlements, visits, tasks: [],
    master: { ...Object.fromEntries(['courses', 'equipment', 'rooms', 'staff', 'ivProducts'].map((k) => [k, SEED[k]])), plans: [], products: [], clinicalFlags: [] },
  };
}

/** Abovee 那一側：`[['10-02', '王小明', '課程完成']]` */
const abovee = (rows) => ({
  meta: { month: '2026-10', complete: true },
  rows: rows.map(([md, name, status, extra = {}], i) => ({
    src: 'a.png', row: i + 1, status, date: `2026-${md}`, time: `10:00 - ${end('10:00')}`, name, chartNo: CHART[name] ?? '00009999',
    course: 'SIS 60', merged: '', actualChartNo: '', relation: '', source: '顧客會', room: '', resource: '', cancelReason: '-', ...extra,
  })),
});

function reconcile(days, rows) {
  const dir = mkdtempSync(join(tmpdir(), 'mer-'));
  try {
    writeFileSync(join(dir, 's.json'), JSON.stringify(snapshot(days)));
    writeFileSync(join(dir, 'a.json'), JSON.stringify(abovee(rows)));
    execFileSync(process.execPath, [SCRIPT, '--abovee', join(dir, 'a.json'), '--snapshot', join(dir, 's.json'),
      '--month', '2026-10', '--today', '2026-11-02', '--out', join(dir, 'r.json')], { stdio: 'pipe' });
    return JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const types = (r) => r.issues.map((i) => `${i.date?.slice(5) ?? ''} ${i.type}`);
const CLEAN = { 'c-wang': { '2026-10-02': 'done', '2026-10-09': 'done', '2026-10-16': 'done' } };
const THREE = [['10-02', '王小明', '課程完成'], ['10-09', '王小明', '課程完成'], ['10-16', '王小明', '課程完成']];

describe('月底對帳', () => {
  test('三邊一樣：0 件、三個數字一樣、每一位都對得上', () => {
    const r = reconcile(CLEAN, THREE);
    assert.deepEqual(types(r), []);
    assert.deepEqual(r.summary.totals, { abovee: 3, app: 3, sheet: 3 });
    assert.ok(r.people.every((p) => p.ok));
    assert.equal(r.summary.matched, 3);
  });

  test('Abovee 做完了、app 還是已確認 → 「還沒簽療程單」，次數差一次', () => {
    const r = reconcile({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-16': 'confirmed' } }, THREE);
    assert.deepEqual(types(r), ['10-16 unsigned']);
    assert.deepEqual(r.summary.totals, { abovee: 3, app: 2, sheet: 2 });
    assert.equal(r.issues[0].sheet.mark, '△');
  });

  test('Abovee 做完了、app 沒有那一段 → 「app 沒有這一段」', () => {
    const { '2026-10-16': _, ...two } = CLEAN['c-wang'];
    const r = reconcile({ 'c-wang': two }, THREE);
    assert.deepEqual(types(r), ['10-16 missing']);
  });

  test('app 多做完一段、Abovee 上找不到 → 「app 扣了一次，Abovee 上找不到」', () => {
    const r = reconcile({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-23': 'done' } }, THREE);
    assert.deepEqual(types(r), ['10-23 extra']);
  });

  test('Abovee 這個月只有王小明、app 上客戶甲做完一段 → 照樣講（月底對每一位，不照照片上幾位猜，ADR-0153）', () => {
    const r = reconcile({ ...CLEAN, 'c-a': { '2026-10-12': 'done' } }, THREE);
    assert.deepEqual(types(r), ['10-12 extra']);
  });

  test('Abovee 取消了、app 還排著 → 「app 還排著」', () => {
    const r = reconcile({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-30': 'confirmed' } }, [...THREE, ['10-30', '王小明', '已取消']]);
    assert.deepEqual(types(r), ['10-30 stillBooked']);
  });

  test('Abovee 上有、app 裡沒有的人收在另外一份，不算要處理的；Abovee 取消、app 也沒有的不講', () => {
    const r = reconcile(CLEAN, [...THREE, ['10-20', '陌生人', '課程完成'], ['10-21', '客戶甲', '已取消']]);
    assert.deepEqual(types(r), []);
    assert.equal(r.strangers.length, 1);
    assert.equal(r.strangers[0].rows.length, 1);
  });

  test('用家人的額度（實際扣課病歷號是別人的）：講出扣的是哪一位', () => {
    const r = reconcile({ ...CLEAN, 'c-a': { '2026-10-20': 'done' } },
      [...THREE, ['10-20', '王小明', '課程完成', { actualChartNo: CHART.客戶甲, relation: '夫妻' }]]);
    // family-merge-round 04 起那一列記在被扣的那一位（客戶甲）身上、對到她那天那一段（誰來的空著 → 小字那一件）
    const row = [...r.issues, ...r.minor].find((i) => i.date === '2026-10-20' && i.abovee);
    assert.deepEqual(row.abovee.paidBy, { chartNo: CHART.客戶甲, relation: '夫妻', name: '客戶甲', customerId: 'c-a' });
  });

  test('沒拍到「共 N 筆」：只信第一列到最後一列之間 —— 最後一天沒截完的下午那一段不喊，頭尾那兩天不算次數', () => {
    // 2026-10-16 冷測試：她說「截到 10/9」，最後一張停在 10/9 早上，那天下午的段被喊成「Abovee 上找不到」
    const data = abovee(THREE);
    data.meta.complete = null;
    const days = { 'c-wang': { ...CLEAN['c-wang'] } };
    const snap = snapshot(days);
    const v = snap.visits.find((x) => x.date === '2026-10-16');
    v.slots.push({ ...v.slots[0], startsAt: '15:00', endsAt: '16:00' });
    snap.entitlements.find((e) => e.parentId === 'c-wang').doneCount += 1;   // 額度上存的次數跟著（不然多一件「要重算」）
    const dir = mkdtempSync(join(tmpdir(), 'mer-'));
    try {
      writeFileSync(join(dir, 's.json'), JSON.stringify(snap));
      writeFileSync(join(dir, 'a.json'), JSON.stringify(data));
      execFileSync(process.execPath, [SCRIPT, '--abovee', join(dir, 'a.json'), '--snapshot', join(dir, 's.json'),
        '--month', '2026-10', '--today', '2026-11-02', '--out', join(dir, 'r.json')], { stdio: 'pipe' });
      const r = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
      assert.deepEqual(types(r), []);
      assert.deepEqual(r.summary.totals, { abovee: 1, app: 1, sheet: 1 });
      assert.deepEqual(r.days.filter((d) => d.coverage === 'edge').map((d) => d.date.slice(5)), ['10-02', '10-16']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('只截了一段日子：範圍外的 app 段不算 Abovee 上找不到、也不算進次數', () => {
    const data = abovee(THREE.slice(0, 2));
    data.meta.from = '2026-10-01';
    data.meta.to = '2026-10-12';
    const dir = mkdtempSync(join(tmpdir(), 'mer-'));
    try {
      writeFileSync(join(dir, 's.json'), JSON.stringify(snapshot(CLEAN)));
      writeFileSync(join(dir, 'a.json'), JSON.stringify(data));
      execFileSync(process.execPath, [SCRIPT, '--abovee', join(dir, 'a.json'), '--snapshot', join(dir, 's.json'),
        '--month', '2026-10', '--today', '2026-11-02', '--out', join(dir, 'r.json')], { stdio: 'pipe' });
      const r = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
      assert.deepEqual(types(r), []);
      assert.deepEqual(r.summary.totals, { abovee: 2, app: 2, sheet: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('健檢不是她排的（ADR-0169，exam-not-mine 03）：不另開桶', () => {
  // app 那一側一段帶標記的二返（10/02）、一段帶標記的三返（10/09）；Abovee 那一側照片上就是二返、三返。
  // 照片那一列讀照片時不會被按上標記（拍 Abovee 不替她按），所以要靠「同一個桶」對上：
  // 二返沒有額度 → `course:<二返>`、三返 → `nth:3`，兩邊一樣（`bucketOfSlot()`／`bucketOfItem()`）
  const flagged = (date, nth) => ({
    id: `v-wang-${date}`, customerId: 'c-wang', customerName: '王小明', date, status: 'done',
    slots: [{
      entitlementId: null, courseId: 'course-followup', courseName: nth === 3 ? '三返' : '二返',
      ...(nth === 3 ? { followupNth: 3 } : {}), followupForVisitId: null, giftKind: null, doctorId: null,
      startsAt: '10:00', endsAt: '10:30', minutes: 30, status: 'done', attended: true, examNotMine: true,
    }],
  });
  const withFlagged = () => {
    const snap = snapshot({});
    snap.visits.push(flagged('2026-10-02', 2), flagged('2026-10-09', 3));
    return snap;
  };
  const ROWS = [
    ['10-02', '王小明', '課程完成', { course: '二返', time: '10:00 - 10:30' }],
    ['10-09', '王小明', '課程完成', { course: '三返', time: '10:00 - 10:30' }],
  ];

  function run(snap, rows) {
    const dir = mkdtempSync(join(tmpdir(), 'mer-'));
    try {
      writeFileSync(join(dir, 's.json'), JSON.stringify(snap));
      writeFileSync(join(dir, 'a.json'), JSON.stringify(abovee(rows)));
      execFileSync(process.execPath, [SCRIPT, '--abovee', join(dir, 'a.json'), '--snapshot', join(dir, 's.json'),
        '--month', '2026-10', '--today', '2026-11-02', '--out', join(dir, 'r.json')], { stdio: 'pipe' });
      return JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('Abovee 有一列二返、一列三返；app 有帶標記的那兩段 → 對得上，0 件', () => {
    const r = run(withFlagged(), ROWS);
    assert.deepEqual(types(r), []);
    const wang = r.people.find((p) => p.customerId === 'c-wang');
    const byKey = Object.fromEntries(wang.buckets.map((b) => [b.key, [b.abovee, b.app, b.ok]]));
    assert.deepEqual(byKey['course:course-followup'], [1, 1, true]);
    assert.deepEqual(byKey['nth:3'], [1, 1, true]);
    assert.ok(wang.ok);
    // 那一桶的名字對帶標記的與舊資料裡沒有額度的二返都講得通，不為標記另寫一句
    assert.equal(wang.buckets.find((b) => b.key === 'course:course-followup').label, '二返（沒有扣額度）');
  });

  test('app 沒有那一段二返 → 照舊講 app 沒有（桶對得上才算數，不是被吞掉）', () => {
    const snap = snapshot({});
    snap.visits.push(flagged('2026-10-09', 3));
    assert.deepEqual(types(run(snap, ROWS)), ['10-02 missing']);
  });
});

// ---------- 2026-11-04 她定的樣子：可能少截、只差時間、合併扣課沒標、舊表、TimeTree ----------

/** 照原樣跑一次：自己組好的快照、Abovee、（選填）舊表與行事曆 */
function runRaw(snap, data, legacy = null, answered = null) {
  const dir = mkdtempSync(join(tmpdir(), 'mer-'));
  try {
    writeFileSync(join(dir, 's.json'), JSON.stringify(snap));
    writeFileSync(join(dir, 'a.json'), JSON.stringify(data));
    const extra = legacy ? ['--legacy', join(dir, 'l.json')] : [];
    if (legacy) writeFileSync(join(dir, 'l.json'), JSON.stringify(legacy));
    // 她答過的（family-merge-round 06）
    if (answered != null) {
      writeFileSync(join(dir, 'answered.md'), answered);
      extra.push('--answered', join(dir, 'answered.md'));
    }
    execFileSync(process.execPath, [SCRIPT, '--abovee', join(dir, 'a.json'), '--snapshot', join(dir, 's.json'),
      '--month', '2026-10', '--today', '2026-11-02', '--out', join(dir, 'r.json'), ...extra], { stdio: 'pipe' });
    return JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** 存著的次數跟著重算（不然多一件「畫面上的次數要重算」） */
function recount(snap) {
  for (const e of snap.entitlements) {
    const c = counts(e, snap.visits.filter((v) => v.customerId === e.parentId), e.id);
    Object.assign(e, { doneCount: c.done, bookedCount: c.booked });
  }
  return snap;
}

describe('月底對帳：她 2026-11-04 定的那幾塊', () => {
  test('同一位、同一天、同一門課，app 的時間不一樣（app 那段已完成）→ 一件「只差時間」，不是「app 少一次」＋「Abovee 找不到」', () => {
    const snap = snapshot(CLEAN);
    snap.visits.find((v) => v.date === '2026-10-16').slots[0].startsAt = '00:00';
    const r = runRaw(recount(snap), abovee(THREE));
    assert.deepEqual(types(r), ['10-16 timeOnly']);
    assert.equal(r.issues[0].app.time, '00:00');
    assert.deepEqual(r.summary.totals, { abovee: 3, app: 3, sheet: 3 });
  });

  // family-merge-round 05／06：那一段扣的那一筆是兩列加起來的分鐘（60 ＝ 30＋30）→ 拍 Abovee 照分鐘認成後一半（ADR-0185），
  // 對帳列在「合併扣課」那一塊（可能忘了勾）；Abovee 照勾算兩次
  test('Abovee 兩列各 30 分都課程完成、沒標合併扣課，app 一段 60 分蓋住兩列 → 一件「可能忘了勾」', () => {
    const rows = [...THREE.slice(0, 2),
      ['10-16', '王小明', '課程完成', { course: 'SIS 30', time: '10:00 - 10:30', resource: '陳小芳' }],
      ['10-16', '王小明', '課程完成', { course: '高能量30', time: '10:30 - 11:00', resource: '陳小芳' }]];
    const r = runRaw(snapshot(CLEAN), abovee(rows));
    assert.deepEqual(types(r), ['10-16 mergeForgot']);
    assert.equal(r.issues[0].abovee.course, 'SIS 30＋高能量30');
    assert.equal(r.issues[0].apps.length, 1, 'app 那一段');
    assert.deepEqual(r.summary.totals, { abovee: 4, app: 3, sheet: 3 });
  });

  test('沒標、app 一段蓋住兩列、可是那一筆每次 30 分（分鐘對不起來）→ 照舊一件「沒標合併扣課」', () => {
    const rows = [...THREE.slice(0, 2),
      ['10-16', '王小明', '課程完成', { course: 'SIS 30', time: '10:00 - 10:30' }],
      ['10-16', '王小明', '課程完成', { course: '高能量30', time: '10:30 - 11:00' }]];
    const snap = snapshot(CLEAN);
    snap.entitlements.find((e) => e.parentId === 'c-wang').durationMin = 30;
    const r = runRaw(snap, abovee(rows));
    assert.deepEqual(types(r), ['10-16 mergeUnmarked']);
    assert.equal(r.issues[0].abovee.with.course, 'SIS 30');
  });

  test('兩列都標了合併扣課、app 一段蓋住兩列（前一列已經被那一段認走）→ 一致，不是「沒標合併扣課」', () => {
    const rows = [...THREE.slice(0, 2),
      ['10-16', '王小明', '課程完成', { course: 'SIS 30', time: '10:00 - 10:30', merged: '是' }],
      // 後一列 Abovee 多排了 15 分（10:30–11:15，2026-11-09 真的那一件）：以前 `claimHalves()` 拿起訖比、認不走 → 落單；
      // family-merge-round 05 起做到幾點照課程字的 30 分（`rowEnd()`），app 那一段（10:00–11:00）蓋得住 → 已經記了
      ['10-16', '王小明', '課程完成', { course: '高能量30', time: '10:30 - 11:15', merged: '是' }]];
    const r = runRaw(snapshot(CLEAN), abovee(rows));
    assert.deepEqual(types(r), []);
    // 那一對在 Abovee 只扣一次：次數也只算一次（2026-11-09 重對時抓到兩列各加了 1，三個數字變成 99≠98）
    assert.deepEqual(r.summary.totals, { abovee: 3, app: 3, sheet: 3 });
  });

  test('兩列都標了合併扣課、app 一段剛好蓋住兩列（後一列被認成已經記了）→ 那一對只算一次，每一位的表上沒有多一列', () => {
    // 2026-11-09 全部重對：8/27、8/31、9/11 那三對的後一列掉進「沒有扣額度」那一格各多算一次（總數只加額度那幾格，所以沒露出來）
    const rows = [...THREE.slice(0, 2),
      ['10-16', '王小明', '課程完成', { course: 'SIS 30', time: '10:00 - 10:30', merged: '是' }],
      ['10-16', '王小明', '課程完成', { course: '高能量30', time: '10:30 - 11:00', merged: '是' }]];
    const r = runRaw(snapshot(CLEAN), abovee(rows));
    assert.deepEqual(types(r), []);
    assert.deepEqual(r.summary.totals, { abovee: 3, app: 3, sheet: 3 });
    assert.ok(r.people.every((p) => p.ok), JSON.stringify(r.people.flatMap((p) => p.buckets.map((b) => [b.label, b.abovee, b.app]))));
  });

  test('家人用名單上那一位的號碼做完（實際扣課病歷號）、那一位 app 上沒有這一段 → 算到那一位，一件「app 少扣一次」', () => {
    const r = runRaw(snapshot(CLEAN), abovee([...THREE, ['10-20', '陌生人', '課程完成', { actualChartNo: CHART.王小明, relation: '夫妻' }]]));
    assert.deepEqual(types(r), ['10-20 familyMissing']);
    assert.equal(r.issues[0].customerId, 'c-wang');
    assert.match(r.issues[0].say, /陌生人.*夫妻/);
    assert.deepEqual(r.summary.totals, { abovee: 4, app: 3, sheet: 3 });
    // family-merge-round 04：那一列認得是扣王小明的（`readAbovee()` 讀那兩欄，ADR-0184）—— 來的人不再另外列在「app 裡沒有這個人」
    assert.equal(r.strangers.length, 0);
  });

  test('家人用那一位的號碼、app 記在那一位身上同一個時間（舊資料：誰來的空著，8/27 那種）→ 次數對、不講少扣，小字提一句沒寫誰來的', () => {
    const r = runRaw(snapshot({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-20': 'done' } }),
      abovee([...THREE, ['10-20', '陌生人', '課程完成', { actualChartNo: CHART.王小明, relation: '夫妻' }]]));
    assert.deepEqual(types(r), []);
    assert.deepEqual(r.summary.totals, { abovee: 4, app: 4, sheet: 4 });
    assert.equal(r.strangers.length, 0, '那一列對到 app 裡那一段，不在「app 裡沒有這個人」');
    assert.deepEqual(r.minor.filter((i) => i.type === 'familyNoAttendee').map((i) => [i.date, i.customerId]), [['2026-10-20', 'c-wang']]);
  });

  test('family-merge-round 04：10/29 那一種補進 app 之後（那一段寫了誰來的）→ 對上、不在 familyMissing、看得出是家人來的', () => {
    const snap = snapshot({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-20': 'done' } });
    snap.visits.find((v) => v.date === '2026-10-20').slots[0].attendee = '陌生人（夫妻）';
    const r = runRaw(snap, abovee([...THREE, ['10-20', '陌生人', '課程完成', { actualChartNo: CHART.王小明, relation: '夫妻' }]]));
    assert.deepEqual(types(r), []);
    assert.equal(r.minor.filter((i) => i.type === 'familyNoAttendee').length, 0);
    assert.deepEqual(r.summary.totals, { abovee: 4, app: 4, sheet: 4 });
    assert.equal(r.strangers.length, 0);
    assert.ok(r.people.every((p) => p.ok));
  });

  test('family-merge-round 04：王小明本人同一個時間也來了、app 只記了本人那一段 → 家人那一列不搶它，一件 familyMissing', () => {
    const snap = snapshot({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-20': 'done' } });
    const r = runRaw(snap, abovee([...THREE, ['10-20', '王小明', '課程完成'],
      ['10-20', '陌生人', '課程完成', { actualChartNo: CHART.王小明, relation: '夫妻' }]]));
    assert.deepEqual(types(r), ['10-20 familyMissing']);
    assert.deepEqual(r.summary.totals, { abovee: 5, app: 4, sheet: 4 });
  });

  test('family-merge-round 04：被扣的號碼 app 裡沒有 → 照舊列在「app 裡沒有這個人」，不算次數', () => {
    const r = runRaw(snapshot(CLEAN), abovee([...THREE, ['10-20', '陌生人', '課程完成', { actualChartNo: '00007777', relation: '夫妻' }]]));
    assert.deepEqual(types(r), []);
    assert.equal(r.strangers.length, 1);
    assert.deepEqual(r.summary.totals, { abovee: 3, app: 3, sheet: 3 });
  });

  test('Abovee 那一列預約來源寫體驗（不扣額度）、app 那一段扣著額度 → 一件「扣法不一樣」，Abovee 那一次不算進額度', () => {
    // 2026-11-09 全部重對（驗證那一邊抓到的）：7/8 那一列寫體驗，以前照 app 那一段算成 Abovee 也扣了一次
    const rows = [...THREE.slice(0, 2), ['10-16', '王小明', '課程完成', { source: '體驗' }]];
    const r = runRaw(snapshot(CLEAN), abovee(rows));
    assert.deepEqual(types(r), ['10-16 charge']);
    assert.deepEqual(r.summary.totals, { abovee: 2, app: 3, sheet: 3 });
  });

  /** 三張截圖：a（滿頁兩列）、b（跟 a 一模一樣）、c；app 在 a 的最後一列與 c 的第一列之間多一段 */
  function paged({ twin }) {
    const data = abovee([['10-02', '王小明', '課程完成'], ['10-09', '王小明', '課程完成'], ['10-16', '王小明', '課程完成']]);
    data.rows[2].src = 'c.png';
    data.rows[2].row = 1;
    data.meta.shots = ['a.png', 'c.png'];
    data.meta.rowsPerShot = { 'a.png': 2, 'b.png': 2, 'c.png': 1 };
    data.meta.duplicates = twin ? [{ shot: 'b.png', sameAs: 'a.png' }] : [];
    return data;
  }

  test('同一頁截了兩次、下一頁沒截到：那一段 app 的不喊「Abovee 找不到」，收進「可能少截」，那幾天不算次數', () => {
    const r = runRaw(recount(snapshot({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-12': 'done' } })), paged({ twin: true }));
    assert.deepEqual(types(r), []);
    assert.equal(r.gaps.length, 1);
    assert.equal(r.gaps[0].twin, 'b.png');
    assert.deepEqual(r.gaps[0].slots.map((x) => x.date), ['2026-10-12']);
    assert.ok(r.days.filter((d) => d.coverage === 'gap').map((d) => d.date).includes('2026-10-12'));
    assert.deepEqual(r.summary.totals, { abovee: 1, app: 1, sheet: 1 });
  });

  test('沒有重複的截圖，但滿頁的接縫之間 app 有段 → 也是「可能少截」；接縫之間 app 沒有段就不講', () => {
    const r = runRaw(recount(snapshot({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-12': 'done' } })), paged({ twin: false }));
    assert.equal(r.gaps.length, 1);
    assert.equal(r.gaps[0].twin, null);
    assert.equal(runRaw(snapshot(CLEAN), paged({ twin: false })).gaps.length, 0);
  });

  test('同一頁截了兩次，但少的那一天補截了整天的單日清單（meta.days）→ 不是「可能少截」', () => {
    const data = paged({ twin: true });
    // 接縫在 10/09 → 10/16 之間；10/09～10/16 每一天都有單日清單才算補齊
    const days = {};
    for (let d = 9; d <= 16; d += 1) days[`2026-10-${String(d).padStart(2, '0')}`] = { shots: ['d.png'], rows: 1 };
    data.meta.days = days;
    data.meta.edges = { 'a.png': { first: '2026-10-02 10:00', last: '2026-10-09 10:00' }, 'c.png': { first: '2026-10-16 10:00', last: '2026-10-16 10:00' } };
    const r = runRaw(snapshot(CLEAN), data);
    assert.equal(r.gaps.length, 0);
    delete days['2026-10-12'];
    assert.equal(runRaw(snapshot(CLEAN), data).gaps.length, 1);
  });

  test('舊表：多勾（Abovee 與 app 都沒做完）與少勾（兩邊都做完、舊表沒勾）才列；跟 app 一樣的不列', () => {
    const legacy = {
      legacy: {
        file: 'all_client.xlsx', groups: { 王小明: ['c-wang'] }, unmatchedSheets: [], unmappedLabels: [],
        ticks: [
          { group: '王小明', date: '2026-10-02', label: 'SIS(60min)', courseId: 'course-recovery', accepts: ['course-recovery'] },
          { group: '王小明', date: '2026-10-05', label: 'SIS(60min)', courseId: 'course-recovery', accepts: ['course-recovery'] },
          { group: '王小明', date: '2026-10-16', label: 'SIS(60min)', courseId: 'course-recovery', accepts: ['course-recovery'] },
        ],
      },
      timetree: { file: null, days: [] },
    };
    const r = runRaw(snapshot(CLEAN), abovee(THREE), legacy);
    assert.deepEqual(r.legacy.rows.map((x) => `${x.date.slice(5)} ${x.kind}`), ['10-05 extra', '10-09 missing']);
  });

  test('TimeTree：只列「Abovee 那天做完了、TimeTree 那天沒寫這一位」', () => {
    const legacy = { legacy: { file: null }, timetree: { file: 'timetree.ics', days: [{ customerId: 'c-wang', date: '2026-10-02' }] } };
    const r = runRaw(snapshot(CLEAN), abovee(THREE), legacy);
    assert.deepEqual(r.timetree.missing.map((m) => m.date.slice(5)), ['10-09', '10-16']);
  });
});

describe('一次性客人（ADR-0172）：認得就是有記，不拿去比次數', () => {
  // 客戶乙是一份名字卡（`oneTime: true`），他的段都標一次性、沒有額度。她 11/5 第 8 題：
  // 有名字卡、這一段也記了 → 算有記；這一段沒記 → 「app 沒有這一段」；沒有名字卡的才在「Abovee 上有、app 裡沒有這個人」
  const guest = { id: 'c-b', name: '客戶乙', oneTime: true, marks: [{ text: '病歷號 3333', color: 'grey' }] };
  const slotOf = (status, over = {}) => ({
    entitlementId: null, courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '11:00',
    giftKind: null, status, attended: status === 'done' ? true : null, oneTime: true, ...over,
  });
  const visitOf = (date, status) => ({ id: `v-b-${date}`, customerId: 'c-b', customerName: '客戶乙', date, status, slots: [slotOf(status)] });
  const withGuest = () => {
    const snap = snapshot(CLEAN);
    snap.customers = [...snap.customers, guest];
    snap.visits.push(visitOf('2026-10-05', 'done'), visitOf('2026-10-12', 'confirmed'), visitOf('2026-10-26', 'done'), visitOf('2026-10-28', 'confirmed'));
    return snap;
  };
  const B = (md, status) => [md, '客戶乙', status, { chartNo: '00003333' }];
  const ROWS = [...THREE, B('10-05', '課程完成'), B('10-12', '課程完成'), B('10-19', '課程完成'), B('10-28', '已取消')];

  test('有名字卡就不是陌生人；記了的那一段算有記', () => {
    const r = runRaw(withGuest(), abovee(ROWS));
    assert.equal(r.strangers.length, 0);
    assert.ok(r.summary.matched >= 4, String(r.summary.matched));
    assert.ok(!r.issues.some((i) => i.date === '2026-10-05'), types(r).join('、'));
  });

  test('沒記的、還沒簽的、app 多一段、Abovee 取消了 app 還排著 → 跟一般客戶一樣分類，講次數的那一句換成「不扣次數」', () => {
    const r = runRaw(withGuest(), abovee(ROWS));
    const mine = r.issues.filter((i) => i.customerId === 'c-b');
    assert.deepEqual(mine.map((i) => `${i.date.slice(5)} ${i.type}`), ['10-12 unsigned', '10-19 missing', '10-26 extra', '10-28 stillBooked']);
    for (const i of mine) {
      assert.match(i.say, /不扣次數/, i.say);
      assert.doesNotMatch(i.say, /次數還沒扣|佔著一次|扣了一次|少算一次/, i.say);
    }
  });

  test('次數表不數一次性的段：三個數字跟只有王小明時一樣', () => {
    const r = runRaw(withGuest(), abovee(ROWS));
    assert.deepEqual(r.summary.totals, { abovee: 3, app: 3, sheet: 3 });
    assert.ok(!r.people.some((p) => p.customerId === 'c-b'), JSON.stringify(r.people.map((p) => p.name)));
  });

  test('沒建名字卡的人照舊在「Abovee 上有、app 裡沒有這個人」', () => {
    const r = runRaw(withGuest(), abovee([...ROWS, ['10-20', '陌生人', '課程完成']]));
    assert.deepEqual(r.strangers.map((x) => x.name), ['陌生人']);
  });
});

describe('合成抄本：同一頁截了兩次', () => {
  test('兩張抄出來一模一樣 → 只算一次，記在 meta.duplicates', async () => {
    const { assemble } = await import('../.claude/skills/month-end-reconciliation/scripts/assemble.mjs');
    const head = '預約狀態\t預約日期\t預約時段\t姓名\t病歷號\t課程\t合併扣課\t實際扣課病歷號\t關係\t預約來源\t診間\t服務資源\t取消原因';
    const body = ['課程完成\t2026-10-02\t10:00 - 11:00\t王小明\t00001234\tSIS 60\t\t\t\t顧客會\t\t\t-',
      '課程完成\t2026-10-09\t10:00 - 11:00\t王小明\t00001234\tSIS 60\t\t\t\t顧客會\t\t\t-'].join('\n');
    const tsv = (shot) => `# 截圖\t${shot}\n${head}\n${body}\n`;
    const out = assemble([{ file: '01_a.tsv', text: tsv('a.png') }, { file: '02_b.tsv', text: tsv('b.png') }], { month: '2026-10' });
    assert.equal(out.rows.length, 2);
    assert.deepEqual(out.meta.duplicates, [{ shot: 'b.png', sameAs: 'a.png' }]);
    assert.deepEqual(out.meta.shots, ['a.png']);
  });
});

describe('合成抄本：補截的單日清單（`# 單日`）', () => {
  const head = '預約狀態\t預約日期\t預約時段\t姓名\t病歷號\t課程\t合併扣課\t實際扣課病歷號\t關係\t預約來源\t診間\t服務資源\t取消原因';
  const row = (date, time, course = 'SIS 60', status = '課程完成') => `${status}\t${date}\t${time}\t王小明\t00001234\t${course}\t\t\t\t顧客會\t\t\t-`;
  const tsv = (shot, rows, tags = '') => `# 截圖\t${shot}\n${tags}${head}\n${rows.join('\n')}\n`;
  // 整月那一張只截到 10/09 早上；10/09 單獨篩出來重截了兩頁（共 3 筆），其中一列跟整月那一張重疊在中間
  const month = tsv('a.png', [row('2026-10-02', '10:00 - 11:00'), row('2026-10-09', '09:00 - 10:00'), row('2026-10-16', '10:00 - 11:00')]);
  const day1 = tsv('d1.png', [row('2026-10-09', '08:00 - 09:00', 'IN 60'), row('2026-10-09', '09:00 - 10:00')], '# 單日\t2026-10-09\n# 頁\t共 3 筆，第 1 / 2 頁\n');
  const day2 = tsv('d2.png', [row('2026-10-09', '14:00 - 15:00', 'ILIB 60')], '# 單日\t2026-10-09\n');

  test('那一天以單日清單為準：整月那一張同一天的列不重複算，照日期排，接縫留著', async () => {
    const { assemble } = await import('../.claude/skills/month-end-reconciliation/scripts/assemble.mjs');
    const out = assemble([{ file: '01_a.tsv', text: month }, { file: '02_d1.tsv', text: day1 }, { file: '03_d2.tsv', text: day2 }], { month: '2026-10' });
    assert.deepEqual(out.problems, []);
    assert.deepEqual(out.rows.map((r) => `${r.date.slice(5)} ${r.time.slice(0, 5)} ${r.src}`),
      ['10-02 10:00 a.png', '10-09 08:00 d1.png', '10-09 09:00 d1.png', '10-09 14:00 d2.png', '10-16 10:00 a.png']);
    assert.deepEqual(out.rows.map((r) => r.id), ['A001', 'A002', 'A003', 'A004', 'A005']);
    assert.deepEqual(out.meta.days['2026-10-09'], { shots: ['d1.png', 'd2.png'], rows: 3, total: 3, replaced: 1, missing: 0 });
    assert.deepEqual(out.meta.shots, ['a.png']);
    assert.deepEqual(out.meta.edges['a.png'], { first: '2026-10-02 10:00', last: '2026-10-16 10:00' });
    assert.deepEqual(out.meta.rowsPerShot, { 'a.png': 3, 'd1.png': 2, 'd2.png': 1 });
  });

  test('整月那一張的列在單日清單裡找不到、或筆數跟「共 N 筆」不一樣 → 要看', async () => {
    const { assemble } = await import('../.claude/skills/month-end-reconciliation/scripts/assemble.mjs');
    const wrong = tsv('d1.png', [row('2026-10-09', '08:00 - 09:00', 'IN 60'), row('2026-10-09', '09:00 - 10:00', 'IN 60')], '# 單日\t2026-10-09\n# 頁\t共 3 筆\n');
    const out = assemble([{ file: '01_a.tsv', text: month }, { file: '02_d1.tsv', text: wrong }], { month: '2026-10' });
    assert.equal(out.problems.length, 2, out.problems.join('\n'));
    assert.match(out.problems[0], /找不到/);
    assert.match(out.problems[1], /共 3 筆，抄出來 2 列/);
  });
});


// ---------- 合併扣課那一塊、她答過的（family-merge-round 06）----------
//
// 她 11/9：Abovee 是給櫃檯看的，合併扣課可能忘了勾、也可能多勾；月底對帳以後固定查（判斷跟拍 Abovee 同一支，ADR-0185）。
// 10/30 她：「反正過去了，幫我記得就好」—— 答過的那一件以後照樣列、標「答過了」，不算進要看的。

const REPORT = '.claude/skills/month-end-reconciliation/scripts/report.mjs';
const HALVES = (merged = '', second = '高能量30') => [
  // 同一位治療師（`looksMerged()` 要的）
  ['10-16', '王小明', '課程完成', { course: 'SIS 30', time: '10:00 - 10:30', merged, resource: '陳小芳' }],
  ['10-16', '王小明', '課程完成', { course: second, time: '10:30 - 11:15', merged, resource: '陳小芳' }],
];
/** 王小明那一筆額度改成每次 30 分 */
const thirty = (snap) => {
  snap.entitlements.find((e) => e.parentId === 'c-wang').durationMin = 30;
  return snap;
};
/** 10/16 那一天 app 是兩段 30 分（10:00、10:30），都已完成 */
const twoSlots = (snap) => {
  const v = snap.visits.find((x) => x.date === '2026-10-16');
  v.slots = [{ ...v.slots[0], endsAt: '10:30' }, { ...v.slots[0], equipmentId: 'eq-laser', startsAt: '10:30', endsAt: '11:00' }];
  return recount(snap);
};
const ANSWERED = (rows) => ['# 她答過的', '', '| 日期 | 誰 | 種類 | 病歷號 | Abovee | app | 她怎麼說 | 什麼時候答的 |', '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.join(' | ')} |`), ''].join('\n');
const html = (r) => {
  const dir = mkdtempSync(join(tmpdir(), 'mer-'));
  try {
    writeFileSync(join(dir, 'r.json'), JSON.stringify(r));
    execFileSync(process.execPath, [REPORT, join(dir, 'r.json'), join(dir, 'r.html')], { stdio: 'pipe' });
    return readFileSync(join(dir, 'r.html'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('月底對帳：合併扣課那一塊（勾跟額度的分鐘對不起來）', () => {
  test('兩列 30 分都沒勾、額度 60 分一次、app 是兩段 → 一件「可能忘了勾」（mergeForgot），app 那一格寫兩段', () => {
    const r = runRaw(twoSlots(snapshot(CLEAN)), abovee([...THREE.slice(0, 2), ...HALVES()]));
    assert.deepEqual(types(r), ['10-16 mergeForgot']);
    const [m] = r.issues;
    assert.equal(m.abovee.course, 'SIS 30＋高能量30');
    assert.match(m.abovee.note, /兩列都沒標合併扣課（額度 60 分一次）/);
    assert.equal(m.apps.length, 2);
    assert.deepEqual(r.mergeChecks, [m.id]);
  });

  test('兩列都沒勾、額度 30 分一次 → 不列（那是兩次）', () => {
    const r = runRaw(thirty(twoSlots(snapshot(CLEAN))), abovee([...THREE.slice(0, 2), ...HALVES()]));
    assert.deepEqual(types(r).filter((t) => /merge/.test(t)), []);
  });

  test('兩列都勾、額度 30 分一次 → 一件「可能多勾」（mergeExtra），一對只列一次', () => {
    const r = runRaw(thirty(twoSlots(snapshot(CLEAN))), abovee([...THREE.slice(0, 2), ...HALVES('是')]));
    assert.deepEqual(types(r).filter((t) => /merge/.test(t)), ['10-16 mergeExtra']);
    assert.match(r.issues.find((i) => i.type === 'mergeExtra').abovee.note, /兩列都標了合併扣課（額度 30 分一次）/);
  });

  test('四列連著都勾、額度 30 分一次、app 沒有那一天 → 兩對各一件「可能多勾」，不配出中間那一對；Abovee 照勾算兩次（段四審查）', () => {
    const { '2026-10-16': _, ...two } = CLEAN['c-wang'];
    const row = (course, time) => ['10-16', '王小明', '課程完成', { course, time, merged: '是', resource: '陳小芳' }];
    const r = runRaw(thirty(snapshot({ 'c-wang': two })), abovee([...THREE.slice(0, 2),
      row('SIS 30', '10:00 - 10:30'), row('高能量30', '10:30 - 11:00'), row('SIS 30', '11:00 - 11:30'), row('高能量30', '11:30 - 12:00')]));
    const extra = r.issues.filter((i) => i.type === 'mergeExtra');
    assert.deepEqual(extra.map((i) => i.abovee.course), ['SIS 30＋高能量30', 'SIS 30＋高能量30']);
    assert.deepEqual(extra.map((i) => i.startsAt), ['10:00', '11:00']);
    // 前兩天各一次＋兩對各一次（照勾，一對 Abovee 扣一次）
    assert.equal(r.summary.totals.abovee, 4);
  });

  test('兩列都勾、額度 60 分一次（勾得對）→ 不列', () => {
    const snap = snapshot(CLEAN);
    const r = runRaw(snap, abovee([...THREE.slice(0, 2), ...HALVES('是')]));
    assert.deepEqual(types(r).filter((t) => /merge/.test(t)), []);
  });

  test('一列勾了、找不到另一半 → 一件「可能多勾」', () => {
    const rows = [...THREE.slice(0, 2), ['10-16', '王小明', '課程完成', { merged: '是' }]];
    const r = runRaw(snapshot(CLEAN), abovee(rows));
    assert.deepEqual(types(r), ['10-16 mergeExtra']);
    assert.match(r.issues[0].abovee.note, /找不到另一半/);
  });

  test('app 上沒有、兩列沒勾、額度 60 分一次 → 「app 沒有這一段」＋「可能忘了勾」；Abovee 那一天照勾算兩次', () => {
    const { '2026-10-16': _, ...two } = CLEAN['c-wang'];
    const r = runRaw(snapshot({ 'c-wang': two }), abovee([...THREE.slice(0, 2), ...HALVES()]));
    assert.deepEqual(types(r).sort(), ['10-16 mergeForgot', '10-16 missing']);
    assert.deepEqual(r.summary.totals, { abovee: 4, app: 2, sheet: 2 });
  });
});

describe('月底對帳：她答過的', () => {
  const rows = [...THREE.slice(0, 2), ...HALVES()];

  test('對到日期＋種類＋病歷號 → 標「答過了」、不算進要看的；那一頁照樣列、寫「答過了」', () => {
    const md = ANSWERED([['2026-10-16', '王小明', '`mergeForgot`', '00001234', '兩列沒勾', '兩段', '當成忘了按，Abovee 不補勾', '2026-11-09']]);
    const r = runRaw(twoSlots(snapshot(CLEAN)), abovee(rows), null, md);
    assert.deepEqual(r.issues[0].answered, { said: '當成忘了按，Abovee 不補勾', when: '2026-11-09' });
    assert.equal(r.summary.fix, 0);
    assert.equal(r.summary.answered, 1);
    const page = html(r);
    assert.match(page, /合併扣課可能忘了勾／多勾/);
    assert.match(page, /答過了：當成忘了按，Abovee 不補勾/);
    assert.match(page, /0 件（另 1 件答過了）/);
    assert.match(page, /全部對得上/, '答過的不算進「要看的 N 件」');
  });

  test('病歷號那一格空著 → 看「誰」裡有沒有這一位的名字', () => {
    const md = ANSWERED([['2026-10-16', '王小明（她自己）', 'mergeForgot', '', '', '', '答過', '2026-11-09']]);
    assert.ok(runRaw(twoSlots(snapshot(CLEAN)), abovee(rows), null, md).issues[0].answered);
  });

  test('沒列在裡面的新一件照舊要處理：日期不一樣、種類不一樣、病歷號不一樣、沒有「種類」那一欄都不算', () => {
    const cases = [
      ANSWERED([['2026-10-15', '王小明', 'mergeForgot', '00001234', '', '', '答過', '2026-11-09']]),
      ANSWERED([['2026-10-16', '王小明', 'mergeExtra', '00001234', '', '', '答過', '2026-11-09']]),
      ANSWERED([['2026-10-16', '王小明', 'mergeForgot', '00002222', '', '', '答過', '2026-11-09']]),
      ['| 日期 | 誰 | Abovee | app | 她怎麼說 | 什麼時候答的 |', '|---|---|---|---|---|---|', '| 2026-10-16 | 王小明 | 兩列 | 兩段 | 答過 | 2026-11-09 |'].join('\n'),
    ];
    for (const md of cases) {
      const r = runRaw(twoSlots(snapshot(CLEAN)), abovee(rows), null, md);
      assert.equal(r.issues[0].answered, undefined, md);
      assert.equal(r.summary.fix, 1);
    }
  });
});
