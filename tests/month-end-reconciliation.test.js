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
    const row = r.issues.find((i) => i.date === '2026-10-20' && i.abovee);
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
function runRaw(snap, data, legacy = null) {
  const dir = mkdtempSync(join(tmpdir(), 'mer-'));
  try {
    writeFileSync(join(dir, 's.json'), JSON.stringify(snap));
    writeFileSync(join(dir, 'a.json'), JSON.stringify(data));
    const extra = legacy ? ['--legacy', join(dir, 'l.json')] : [];
    if (legacy) writeFileSync(join(dir, 'l.json'), JSON.stringify(legacy));
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

  test('Abovee 兩列各 30 分都課程完成、沒標合併扣課，app 一段 60 分蓋住兩列 → 一件「沒標合併扣課」', () => {
    const rows = [...THREE.slice(0, 2),
      ['10-16', '王小明', '課程完成', { course: 'SIS 30', time: '10:00 - 10:30' }],
      ['10-16', '王小明', '課程完成', { course: '高能量30', time: '10:30 - 11:00' }]];
    const r = runRaw(snapshot(CLEAN), abovee(rows));
    assert.deepEqual(types(r), ['10-16 mergeUnmarked']);
    assert.equal(r.issues[0].abovee.with.course, 'SIS 30');
  });

  test('兩列都標了合併扣課、app 一段蓋住兩列（前一列已經被那一段認走）→ 一致，不是「沒標合併扣課」', () => {
    const rows = [...THREE.slice(0, 2),
      ['10-16', '王小明', '課程完成', { course: 'SIS 30', time: '10:00 - 10:30', merged: '是' }],
      // 後一列超出 app 那一段（10:00–11:00）：`claimHalves()` 認不走、`mergeRows()` 又只配兩列都是新的 → 落單（2026-11-09 真的那一件）
      ['10-16', '王小明', '課程完成', { course: '高能量30', time: '10:30 - 11:15', merged: '是' }]];
    const r = runRaw(snapshot(CLEAN), abovee(rows));
    assert.deepEqual(types(r), []);
    assert.ok(r.minor.some((i) => i.type === 'mergedOneSlot'), JSON.stringify(r.minor.map((i) => i.type)));
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
    assert.deepEqual(r.summary.totals, { abovee: 4, app: 3, sheet: 3 });
    assert.equal(r.strangers.length, 1); // 來的人照舊列在「app 裡沒有這個人」
  });

  test('家人用那一位的號碼、app 記在那一位身上同一個時間 → 次數對、不講少扣', () => {
    const r = runRaw(snapshot({ 'c-wang': { ...CLEAN['c-wang'], '2026-10-20': 'done' } }),
      abovee([...THREE, ['10-20', '陌生人', '課程完成', { actualChartNo: CHART.王小明, relation: '夫妻' }]]));
    assert.ok(!types(r).some((t) => t.includes('familyMissing')), JSON.stringify(types(r)));
    assert.equal(r.summary.totals.abovee, r.summary.totals.app);
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

