// staging 的清空工具（`scripts/reset-staging.mjs`，ADR-0118）。
//
// 她 2026-10-05：「staging 上那二十位種子假客戶要先清掉，我才貼合併檔」、
// 「不搬，staging 只當預演。切換那天正式站重新匯一次合併檔」。
//
// 預演會重來好幾次（每一份新的合併檔都是「清空 → 貼進去」），所以這是一支
// 會一直用的工具。它盯的是兩件事：**清的範圍跟備份一樣**（備份裡有的那幾類
// 就是她的資料，少清一類就是預演裡混著上一輪的東西），以及**絕對碰不到正式站**。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RESET_SECTIONS, KEEP, targetOf, parseArgs, masterSeedPlan, MASTER_PATHS } from '../scripts/reset-staging.mjs';
import { SECTIONS } from '../scripts/restore-backup.mjs';
import { SEED, seedData } from '../public/js/domain/seed.js';
import { MASTER_TYPES } from '../public/js/domain/masterData.js';

describe('清的範圍', () => {
  test('備份裡的每一類都清 —— 跟 restore-backup.mjs 的 SECTIONS 同一份', () => {
    assert.deepEqual(RESET_SECTIONS.map((s) => s.key).sort(), SECTIONS.map((s) => s.key).sort());
  });

  test('子集合從 collectionGroup 掃，頂層集合直接掃', () => {
    const sub = RESET_SECTIONS.filter((s) => s.group).map((s) => s.key).sort();
    assert.deepEqual(sub, ['availability', 'entitlements', 'treatmentSheets']);
    // 子集合要先清，客戶本人最後 —— 先刪客戶的話，collectionGroup 照樣掃得到底下那幾筆，但順序反了容易漏
    const order = RESET_SECTIONS.map((s) => s.key);
    assert.ok(order.indexOf('customers') > order.indexOf('entitlements'));
  });

  test('主檔、白名單、稽核、AI 帳本不清', () => {
    assert.deepEqual([...KEEP].sort(), ['aiUsage', 'allowedUsers', 'audit', 'config']);
    for (const key of KEEP) assert.ok(!RESET_SECTIONS.some((s) => s.key === key), `${key} 不可以被清`);
  });
});

describe('只碰得到 staging 與模擬器', () => {
  test('staging（別名或全名）放行', () => {
    assert.deepEqual(targetOf({ project: 'staging', emulator: null }), { projectId: 'wellness-clinic-staging' });
    assert.deepEqual(targetOf({ project: 'wellness-clinic-staging', emulator: null }), { projectId: 'wellness-clinic-staging' });
  });

  test('模擬器放行（不管專案叫什麼，除了正式那一個）', () => {
    assert.deepEqual(targetOf({ project: 'demo-scheduler', emulator: '127.0.0.1:8080' }), { projectId: 'demo-scheduler' });
  });

  test('正式專案一律拒絕 —— 別名、全名、帶模擬器旗標都一樣，而且沒有放行的旗標', () => {
    for (const project of ['prod', 'production', 'wellness-clinic-scheduler']) {
      for (const emulator of [null, '127.0.0.1:8080']) {
        const t = targetOf({ project, emulator });
        assert.ok(t.refuse, `${project} / ${emulator} 要拒絕`);
        assert.equal(t.projectId, undefined);
      }
    }
    assert.equal(parseArgs(['--project', 'prod', '--allow-prod', '--yes']).allowProd, undefined, '不認 --allow-prod');
  });

  test('不認得的真專案也拒絕（只清得了 staging）', () => {
    assert.ok(targetOf({ project: 'some-other-project', emulator: null }).refuse);
  });

  test('沒給專案：拒絕', () => {
    assert.ok(targetOf({ project: null, emulator: null }).refuse);
  });
});

describe('指令列', () => {
  test('沒有 --yes 就是只看', () => {
    assert.equal(parseArgs(['--project', 'staging']).yes, false);
    assert.equal(parseArgs(['--project', 'staging', '--yes']).yes, true);
    assert.equal(parseArgs(['--project=staging']).project, 'staging');
  });
});

// 2026-10-19（她：「好」）：`staging:reset` 只清資料、不清主檔 —— reset 之後主檔還是上一代的（還有 EECP體驗、點滴8），
// 要先按三項資料健檢才貼得上一份「一開始就是好的」合併檔。`--master` 跟正式站切換那天同一個做法（ADR-0143）：主檔也清掉、照現在的種子重載
describe('--master：主檔也照現在的種子重來', () => {
  test('沒寫就不碰主檔；寫了才碰', () => {
    assert.equal(parseArgs(['--project', 'staging', '--yes']).master, false);
    assert.equal(parseArgs(['--project', 'staging', '--yes', '--master']).master, true);
  });

  test('清的是 config/app 底下每一種主檔，不是 config 整個（排序權重、試算表密鑰、LINE 模板、AI 上限留著）', () => {
    assert.deepEqual(MASTER_PATHS, MASTER_TYPES.map((t) => `config/app/${t}`));
    assert.ok(!MASTER_PATHS.includes('config/app') && !MASTER_PATHS.includes('config/ai'));
  });

  test('重載的就是種子的每一筆，照 seedData() 寫（沒寫的是啟用）', () => {
    const plan = masterSeedPlan();
    const want = Object.entries(SEED).flatMap(([type, rows]) => rows.map((row) => ({ path: `config/app/${type}`, id: row.id, data: seedData(row) })));
    assert.deepEqual(plan, want);
    for (const { path } of plan) assert.ok(MASTER_PATHS.includes(path), path);
  });

  test('種子的每一種都是主檔的一種（多一種沒登記的話那一種清不掉也重載不了）', () => {
    for (const type of Object.keys(SEED)) assert.ok(MASTER_TYPES.includes(type), type);
  });
});
