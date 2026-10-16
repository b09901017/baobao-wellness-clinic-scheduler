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
    assert.deepEqual(row.abovee.paidBy, { chartNo: CHART.客戶甲, relation: '夫妻', name: '客戶甲' });
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
