#!/usr/bin/env node
//
// 把 app 匯出的備份 JSON 寫回 Firestore。
//
// **這支存在的理由**：`public/js/data/backup.js` 只有 `exportAll()`，沒有任何
// 程式讀得回那份檔案。一份從來沒有被還原過的備份不算備份，只是一個 JSON 檔 ——
// 而 `backup.js` 的檔頭把它稱為「最後一道防線」。
//
// ---------------------------------------------------------------------------
// 怎麼用
// ---------------------------------------------------------------------------
//
//   # 先看它打算做什麼，一個字都不寫（**每次都從這個開始**）
//   node scripts/restore-backup.mjs 備份.json --project staging --dry-run
//
//   # 對著模擬器演練（不需要任何憑證）
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     node scripts/restore-backup.mjs 備份.json --project demo-scheduler --wipe --yes
//
//   # 真的寫進 staging（要服務帳號金鑰）
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-sa.json \
//     node scripts/restore-backup.mjs 備份.json --project staging --wipe --yes
//
// ---------------------------------------------------------------------------
// 三條安全規則，刻意寫死
// ---------------------------------------------------------------------------
//
// 1. **預設不寫。** 沒有 `--yes` 就只是 dry run。
// 2. **正式環境要再喊一次。** `--allow-prod` 不給就直接拒絕跑在正式專案上。
//    還原是「拿舊資料蓋掉現在的資料」，在正式環境上按錯的代價是不可逆的。
// 3. **`--wipe` 是軟刪除，不是真的刪。** 它把目標集合裡不在備份裡的文件標成
//    `deletedAt`，跟 app 自己的刪除走同一條路（SPEC 6.1：永不硬刪除）。
//    真的要清空請自己去 Console —— 那個決定不該藏在一個 flag 後面。
//
// 服務帳號金鑰是萬能鑰匙，它繞過所有 Security Rules。**絕對不要 commit** ——
// `.gitignore` 有三條規則擋著它。

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

/** 正式專案的 id。跟 `public/js/firebase-config.js` 的 prod 那一份一致。 */
const PROD_PROJECT = 'wellness-clinic-scheduler';

/** `.firebaserc` 的別名 → 真的專案 id。指令列打得出 `--project staging`。 */
const ALIASES = {
  prod: PROD_PROJECT,
  production: PROD_PROJECT,
  staging: 'wellness-clinic-staging',
};

/**
 * 備份裡的每一段各自要寫到哪裡。
 *
 * `parent` 有值的代表它是子集合，路徑要從那一筆自己的 `customerId` 組出來
 * （匯出時被 `withCustomerId()` 攤平了）。
 *
 * **這張表要跟 `data/backup.js` 的 `exportAll()` 對得上。**
 * 那邊新增一個集合卻沒有回來加這裡，症狀是「還原完少了一整類資料」，
 * 而且要等到她去找那類東西才會發現。`checkCoverage()` 在跑之前先對一次。
 */
export const SECTIONS = [
  { key: 'customers', path: () => 'customers' },
  { key: 'entitlements', path: (r) => `customers/${r.customerId}/entitlements`, parent: 'customerId' },
  { key: 'availability', path: (r) => `customers/${r.customerId}/availability`, parent: 'customerId' },
  { key: 'visits', path: () => 'visits' },
  { key: 'tasks', path: () => 'tasks' },
  { key: 'batches', path: () => 'batches' },
  { key: 'notes', path: () => 'notes' },
  { key: 'events', path: () => 'events' },
  { key: 'formInvites', path: () => 'formInvites' },
  { key: 'formResponses', path: () => 'formResponses' },
  { key: 'playbooks', path: () => 'playbooks' },
];

// ---------------------------------------------------------------------------
// 指令列
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { file: null, project: null, dryRun: false, wipe: false, yes: false, allowProd: false, audit: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--wipe') out.wipe = true;
    else if (arg === '--yes') out.yes = true;
    else if (arg === '--allow-prod') out.allowProd = true;
    else if (arg === '--audit') out.audit = true;
    else if (arg.startsWith('--project=')) out.project = arg.slice('--project='.length);
    else if (arg === '--project') out.project = '__next__';
    else if (out.project === '__next__') out.project = arg;
    else if (!arg.startsWith('-')) out.file = arg;
  }
  if (out.project === '__next__') out.project = null;
  return out;
}

const USAGE = `
用法：node scripts/restore-backup.mjs <備份.json> --project <staging|prod|專案id> [選項]

  --dry-run      只印出打算做什麼，一個字都不寫（沒給 --yes 時的預設行為）
  --yes          真的寫進去
  --wipe         備份裡沒有、目標卻有的文件標成已刪除（軟刪除，不是真的刪）
  --allow-prod   允許跑在正式專案上。不給的話直接拒絕
  --audit        連稽核紀錄一起還原（備份有勾「含稽核」時才有東西可還原）

憑證：
  模擬器   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080（不需要金鑰）
  真的專案 GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
`;

// ---------------------------------------------------------------------------
// JSON → Firestore 的值
// ---------------------------------------------------------------------------

const TIMESTAMP_SENTINEL = 'firestore/timestamp/1.0';

/** 這個物件是不是一個被 JSON.stringify 過的 Timestamp。 */
export function isSerialisedTimestamp(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v.type === TIMESTAMP_SENTINEL) return true;
  // 舊版 SDK 的 toJSON() 沒有 type 欄位，只有這兩個。認形狀：剛好兩個 key、
  // 而且都是數字 —— 這個 app 的資料裡沒有第二種長成這樣的東西。
  const keys = Object.keys(v);
  return keys.length === 2
    && keys.includes('seconds') && keys.includes('nanoseconds')
    && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number';
}

/**
 * 把 JSON 裡的值換回 Firestore 認得的型別。
 *
 * 目前只有 Timestamp 需要換 —— 這個 app 沒有用 GeoPoint、DocumentReference
 * 或 Bytes。碰到別種 `firestore/…` 標記時**丟例外而不是猜**：
 * 猜錯會把一個型別安靜地變成一坨 map，而那要幾個月後才會有人發現。
 */
export function reviveValue(value, where) {
  if (Array.isArray(value)) return value.map((v, i) => reviveValue(v, `${where}[${i}]`));
  if (isSerialisedTimestamp(value)) {
    return new Timestamp(value.seconds, value.nanoseconds);
  }
  if (value && typeof value === 'object') {
    if (typeof value.type === 'string' && value.type.startsWith('firestore/')) {
      throw new Error(`${where} 是還原不回來的型別 ${value.type} —— 這支腳本只認得 Timestamp`);
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, reviveValue(v, `${where}.${k}`)]),
    );
  }
  return value;
}

/**
 * 一筆匯出的資料 → 要寫進去的文件內容。
 *
 * 拿掉兩個欄位：
 * - `id`：它是文件 id，不是內容
 * - `customerId`（只有子集合那兩段）：匯出時 `withCustomerId()` 從路徑推出來
 *   貼上去的，原本的文件身上沒有這個欄位。留著就是還原出一份跟原本不一樣的資料
 */
export function docDataOf(row, section) {
  const { id, ...rest } = row;
  if (section.parent) delete rest[section.parent];
  return reviveValue(rest, `${section.key}/${id}`);
}

// ---------------------------------------------------------------------------
// 檢查
// ---------------------------------------------------------------------------

/**
 * 備份裡有、但這支腳本不認得的段落。
 *
 * `data/backup.js` 新增了集合卻沒有回來加 `SECTIONS`，症狀是「還原完少了
 * 一整類資料」—— 而那要等到她去找那一類東西才會發現。所以寧可在開始前擋下來。
 */
export function checkCoverage(backup) {
  const known = new Set([
    ...SECTIONS.map((s) => s.key),
    'version', 'exportedAt', 'includesDeleted', 'counts', 'settings', 'config', 'audit',
  ]);
  return Object.keys(backup).filter((k) => !known.has(k));
}

export function checkShape(backup) {
  const problems = [];
  if (backup.version !== 2) {
    problems.push(`備份格式是第 ${backup.version} 版，這支腳本認得的是第 2 版（見 data/backup.js 的 BACKUP_VERSION）`);
  }
  if (!backup.includesDeleted) {
    problems.push('這份備份不含已刪除的資料 —— 還原之後救不回誤刪的東西');
  }
  for (const section of SECTIONS) {
    if (backup[section.key] != null && !Array.isArray(backup[section.key])) {
      problems.push(`${section.key} 不是陣列`);
    }
  }
  const orphans = SECTIONS
    .filter((s) => s.parent)
    .flatMap((s) => (backup[s.key] ?? [])
      .filter((r) => !r[s.parent])
      .map((r) => `${s.key}/${r.id} 沒有 ${s.parent}，不知道要寫到誰底下`));
  problems.push(...orphans.slice(0, 5));
  if (orphans.length > 5) problems.push(`（還有 ${orphans.length - 5} 筆同樣的問題）`);
  return problems;
}

// ---------------------------------------------------------------------------
// 寫入
// ---------------------------------------------------------------------------

/** Firestore 一個 batch 上限 500。留一點餘裕。 */
const BATCH_SIZE = 400;

async function writeAll(db, plan, { dryRun }) {
  let written = 0;
  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const chunk = plan.slice(i, i + BATCH_SIZE);
    if (!dryRun) {
      const batch = db.batch();
      for (const { path, id, data } of chunk) batch.set(db.collection(path).doc(id), data);
      await batch.commit();
    }
    written += chunk.length;
    process.stdout.write(`\r  寫入 ${written}/${plan.length}`);
  }
  if (plan.length) process.stdout.write('\n');
  return written;
}

/**
 * 目標上有、備份裡沒有的那些，標成已刪除。
 *
 * **軟刪除，不是真的刪**（SPEC 6.1）。理由跟 app 裡一樣：還原完發現搞錯了，
 * 那些資料還在「已刪除項目」裡找得回來。真的要清空請去 Console。
 */
async function wipeExtras(db, plan, { dryRun }) {
  const keep = new Set(plan.map((p) => `${p.path}/${p.id}`));
  const paths = [...new Set(plan.map((p) => p.path))];
  const extras = [];

  for (const path of paths) {
    const snap = await db.collection(path).get();
    for (const doc of snap.docs) {
      if (keep.has(`${path}/${doc.id}`)) continue;
      if (doc.data().deletedAt) continue; // 已經是刪掉的了
      extras.push({ path, id: doc.id });
    }
  }

  if (!extras.length) return 0;
  console.log(`  備份裡沒有、目標卻有的：${extras.length} 筆 → 標成已刪除`);
  if (dryRun) return extras.length;

  for (let i = 0; i < extras.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { path, id } of extras.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection(path).doc(id), {
        deletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  return extras.length;
}

/** 還原完之後真的數一次。「說寫好了」跟「真的在裡面」是兩件事。 */
async function verify(db, plan) {
  const byPath = new Map();
  for (const p of plan) byPath.set(p.path, (byPath.get(p.path) ?? 0) + 1);

  const rows = [];
  for (const [path, expected] of byPath) {
    const snap = await db.collection(path).get();
    rows.push({ path, expected, actual: snap.size, ok: snap.size >= expected });
  }
  return rows;
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file || !args.project) {
    console.error(USAGE);
    process.exit(2);
  }

  const projectId = ALIASES[args.project] ?? args.project;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;

  if (projectId === PROD_PROJECT && !args.allowProd && !emulator) {
    console.error(`
拒絕跑在正式專案（${PROD_PROJECT}）上。

還原是「拿一份舊資料蓋掉現在的資料」。真的要這樣做的話，
再加一個 --allow-prod，而且**先在 staging 上跑過同一份檔案**。
`);
    process.exit(3);
  }

  const backup = JSON.parse(readFileSync(args.file, 'utf8'));

  const unknown = checkCoverage(backup);
  if (unknown.length) {
    console.error(`備份裡有這支腳本不認得的段落：${unknown.join('、')}`);
    console.error('八成是 data/backup.js 新增了集合，SECTIONS 要跟著加一列。');
    process.exit(4);
  }

  const problems = checkShape(backup);
  if (problems.length) {
    console.error('這份備份看起來不對：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(5);
  }

  // ---- 組出要寫的每一筆 ----
  const plan = [];
  for (const section of SECTIONS) {
    for (const row of backup[section.key] ?? []) {
      plan.push({ path: section.path(row), id: row.id, data: docDataOf(row, section) });
    }
  }
  // 主檔：config/app/{type}/{id}
  for (const [type, rows] of Object.entries(backup.config ?? {})) {
    for (const row of rows) {
      plan.push({
        path: `config/app/${type}`,
        id: row.id,
        data: docDataOf(row, { key: `config.${type}` }),
      });
    }
  }
  if (args.audit) {
    for (const row of backup.audit ?? []) {
      plan.push({ path: 'audit', id: row.id, data: docDataOf(row, { key: 'audit' }) });
    }
  }

  const willWrite = args.yes && !args.dryRun;

  console.log(`
備份檔　　 ${args.file}
匯出於　　 ${backup.exportedAt}
目標專案　 ${projectId}${emulator ? `（模擬器 ${emulator}）` : ''}
模式　　　 ${willWrite ? '**真的寫入**' : 'dry run（不寫任何東西）'}${args.wipe ? ' + 清掉多的' : ''}
要寫的筆數 ${plan.length}
`);

  for (const section of SECTIONS) {
    const n = (backup[section.key] ?? []).length;
    if (n) console.log(`  ${section.key.padEnd(16)} ${n}`);
  }
  const masterCount = Object.values(backup.config ?? {}).reduce((n, r) => n + r.length, 0);
  if (masterCount) console.log(`  ${'config（主檔）'.padEnd(14)} ${masterCount}`);
  if (args.audit) console.log(`  ${'audit'.padEnd(16)} ${(backup.audit ?? []).length}`);
  console.log('');

  if (!willWrite) {
    console.log('沒有寫任何東西。確認上面的數字對了，再加 --yes 跑一次。\n');
    return;
  }

  // ---- 連線 ----
  initializeApp({
    projectId,
    // 模擬器不需要憑證；真的專案吃 GOOGLE_APPLICATION_CREDENTIALS。
    ...(emulator ? {} : { credential: credentialFor() }),
  });
  const db = getFirestore();

  // 設定值那一份是文件不是集合，另外寫。
  if (backup.settings) {
    await db.doc('config/app').set(reviveValue(backup.settings, 'settings'), { merge: true });
    console.log('  設定值 config/app 寫好了');
  }

  await writeAll(db, plan, { dryRun: false });
  if (args.wipe) await wipeExtras(db, plan, { dryRun: false });

  // ---- 對帳 ----
  console.log('\n數一次：');
  const rows = await verify(db, plan);
  let bad = 0;
  for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
    if (!r.ok) bad += 1;
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.path.padEnd(42)} 備份 ${r.expected}　現在 ${r.actual}`);
  }

  if (bad) {
    console.error(`\n有 ${bad} 個集合對不起來。**不要**就這樣算了 —— 先查清楚。`);
    process.exit(6);
  }
  console.log('\n還原完成，數量對得上。\n');
}

function credentialFor() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(`
找不到憑證。要寫進真的專案需要一把服務帳號金鑰：

  Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰
  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/restore-backup.mjs …

那把金鑰繞過所有 Security Rules，**絕對不要 commit**（.gitignore 有擋）。
`);
    process.exit(7);
  }
  return applicationDefault();
}

// **只有被直接執行時才跑。** `tests/restore-backup.test.js` 要 import 上面那幾支
// 純函式，而 import 一支會自己動起來的腳本，等於每跑一次測試就還原一次資料庫。
const runDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runDirectly) {
  main().catch((err) => {
    console.error(`\n出事了：${err.message}`);
    process.exit(1);
  });
}
