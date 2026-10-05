#!/usr/bin/env node
//
// 把 staging 清空，只留主檔與設定 —— 每一次預演之前跑一次（ADR-0118）。
//
// 她 2026-10-05：「staging 上那二十位種子假客戶要先清掉，我才貼合併檔」、
// 「不搬，staging 只當預演。切換那天正式站重新匯一次合併檔」。
//
// 所以 staging 上的東西是**可以整份丟掉重來的**：拿到一份新的合併檔 →
// 清空 → 貼進去 → 看。這一支是那個「清空」，會一直用，不是一次性的。
//
// ---------------------------------------------------------------------------
// 怎麼用
// ---------------------------------------------------------------------------
//
//   # 先看每一類有幾筆，一筆都不刪（**每次都從這個開始**）
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-sa.json \
//     npm run staging:reset -- --project staging
//
//   # 真的清
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-sa.json \
//     npm run staging:reset -- --project staging --yes
//
//   # 對著模擬器（不需要憑證）
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     node scripts/reset-staging.mjs --project demo-scheduler --yes
//
// ---------------------------------------------------------------------------
// 清什麼、不清什麼
// ---------------------------------------------------------------------------
//
// **清的範圍跟備份一樣**：`restore-backup.mjs` 的 `SECTIONS` 就是「她的資料」
// （客戶與額度、可用性、療程單、來訪、任務、壓表清單、隨手記、行事備註、
// 表單邀請與回覆、備忘錄），外加 Storage 上 `treatmentSheets/` 底下的照片。
// 備份多一類，這裡自動跟著多一類 —— 少清一類就是預演裡混著上一輪的東西。
//
// 2026-10-05 以前的 staging 清法（`seed-staging.mjs` 的 `clearPrevious()`）只刪
// id 以 `seed-cus-` 開頭的文件。被點過的那幾個月，app 自己建的來訪、任務、
// 隨手記都是亂數 id、指著已經不存在的假客戶 —— 只清前綴會留下一堆孤兒，
// 日曆和待辦上照樣看得到假的東西。所以這裡是整類清。
//
// **不清**：`config`（主檔與設定 —— 預演要用她的主檔）、`allowedUsers`（白名單，
// Rules 本來就寫不進去）、`audit`（稽核只追加，那是事情的經過）、`aiUsage`
// （Function 的帳本，不是她的資料）。
//
// ---------------------------------------------------------------------------
// 安全規則，刻意寫死
// ---------------------------------------------------------------------------
//
// 1. **預設不刪。** 沒有 `--yes` 就只印每一類幾筆。
// 2. **正式專案一律拒絕。** 跟 `restore-backup.mjs` 不一樣，這裡**沒有** `--allow-prod`：
//    正式站沒有任何理由需要被整份清空。帶著模擬器旗標也一樣拒絕。
// 3. **只認 staging 與模擬器。** 打錯一個專案 id 不會清到別的地方去。
// 4. **真刪，不是軟刪除。** 這裡清的是預演的殘骸，留著 `deletedAt` 只會讓
//    「已刪除項目」那一頁塞滿上一輪的東西。（SPEC 6.1 的「永不硬刪除」講的是
//    她的真資料；預演的那一份本來就說好了切換時不搬。）

import { pathToFileURL } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { SECTIONS } from './restore-backup.mjs';

const PROD_PROJECT = 'wellness-clinic-scheduler';
const STAGING_PROJECT = 'wellness-clinic-staging';
const ALIASES = { staging: STAGING_PROJECT, prod: PROD_PROJECT, production: PROD_PROJECT };

/** Storage 上要一起清的資料夾（療程單的照片，`storage.rules`）。 */
const STORAGE_PREFIXES = ['treatmentSheets/'];

/** 不清的那幾類。只是寫給人看、給測試釘的 —— 清的範圍由 `RESET_SECTIONS` 決定。 */
export const KEEP = Object.freeze(['config', 'allowedUsers', 'audit', 'aiUsage']);

/**
 * 要清的每一類。子集合（`parent` 有值的）用 collectionGroup 掃，**排在前面**，
 * 客戶本人最後 —— 從備份那張表推出來，不另寫一份。
 */
export const RESET_SECTIONS = Object.freeze([
  ...SECTIONS.filter((s) => s.parent).map((s) => ({ key: s.key, group: true })),
  ...SECTIONS.filter((s) => !s.parent && s.key !== 'customers').map((s) => ({ key: s.key, group: false })),
  { key: 'customers', group: false },
]);

export function parseArgs(argv) {
  const out = { project: null, yes: false };
  for (const arg of argv) {
    if (arg === '--yes') out.yes = true;
    else if (arg.startsWith('--project=')) out.project = arg.slice('--project='.length);
    else if (arg === '--project') out.project = '__next__';
    else if (out.project === '__next__') out.project = arg;
  }
  if (out.project === '__next__') out.project = null;
  return out;
}

/**
 * 要清哪一個專案。回 `{ projectId }` 或 `{ refuse: 一句話 }`。
 *
 * @param {{project: string|null, emulator: string|null}} o
 */
export function targetOf({ project, emulator }) {
  if (!project) return { refuse: '要說清哪一個：--project staging' };
  const projectId = ALIASES[project] ?? project;
  if (projectId === PROD_PROJECT) {
    return { refuse: `拒絕。正式專案（${PROD_PROJECT}）不可以被清空 —— 這一支沒有放行的旗標。` };
  }
  if (emulator) return { projectId };
  if (projectId !== STAGING_PROJECT) {
    return { refuse: `拒絕。這一支只清得了 staging（${STAGING_PROJECT}）與本機模擬器，不認得「${projectId}」。` };
  }
  return { projectId };
}

const USAGE = `
用法：node scripts/reset-staging.mjs --project staging [--yes]

  沒有 --yes   只印每一類有幾筆，一筆都不刪
  --yes        真的清（主檔、白名單、稽核、AI 用量不動）

憑證：
  模擬器   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080（不需要金鑰）
  staging  GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-sa.json
`;

/** Firestore 一個 batch 上限 500。留一點餘裕。 */
const BATCH_SIZE = 400;

async function refsOf(db, section) {
  const snap = section.group
    ? await db.collectionGroup(section.key).select().get()
    : await db.collection(section.key).select().get();
  return snap.docs.map((d) => d.ref);
}

async function deleteAll(db, refs) {
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_SIZE)) batch.delete(ref);
    await batch.commit();
  }
}

/**
 * Storage 上的照片。**拿不到就講、不擋**：模擬器沒開 Storage、或金鑰沒有 Storage 權限時，
 * 文件照樣清得掉，照片留著只是佔空間（療程單的文件沒了，那幾張照片也沒有地方畫）。
 */
async function storageFiles(projectId, emulator) {
  if (emulator && !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    return { files: [], note: '模擬器沒有設 FIREBASE_STORAGE_EMULATOR_HOST，照片那一段跳過' };
  }
  try {
    const { getStorage } = await import('firebase-admin/storage');
    const bucket = getStorage().bucket(`${projectId}.firebasestorage.app`);
    const files = [];
    for (const prefix of STORAGE_PREFIXES) {
      const [found] = await bucket.getFiles({ prefix });
      files.push(...found);
    }
    return { files, note: null };
  } catch (err) {
    return { files: [], note: `照片讀不到（${err.message}）—— 文件照清，照片要自己去 Console 看` };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const emulator = process.env.FIRESTORE_EMULATOR_HOST ?? null;
  const target = targetOf({ project: args.project, emulator });
  if (target.refuse) {
    console.error(`\n${target.refuse}\n${args.project ? '' : USAGE}`);
    process.exit(3);
  }
  const { projectId } = target;

  initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
  const db = getFirestore();

  const plan = [];
  for (const section of RESET_SECTIONS) plan.push({ section, refs: await refsOf(db, section) });
  const photos = await storageFiles(projectId, emulator);

  const total = plan.reduce((n, p) => n + p.refs.length, 0);
  console.log(`
目標專案　 ${projectId}${emulator ? `（模擬器 ${emulator}）` : ''}
模式　　　 ${args.yes ? '**真的清**' : '只看'}
`);
  for (const { section, refs } of plan) console.log(`  ${section.key.padEnd(16)} ${refs.length} 筆`);
  console.log(`  ${'照片'.padEnd(14)} ${photos.files.length} 張${photos.note ? `（${photos.note}）` : ''}`);
  console.log(`\n  合計 ${total} 筆文件。不動：${KEEP.join('、')}\n`);

  if (!args.yes) {
    console.log('沒有刪任何東西。加 --yes 真的清。\n');
    return;
  }

  for (const { section, refs } of plan) {
    await deleteAll(db, refs);
    process.stdout.write(`  清掉 ${section.key} ${refs.length} 筆\n`);
  }
  for (const file of photos.files) await file.delete({ ignoreNotFound: true });
  if (photos.files.length) console.log(`  清掉照片 ${photos.files.length} 張`);

  // 清完真的數一次。「說清好了」跟「真的空了」是兩件事
  const left = [];
  for (const section of RESET_SECTIONS) {
    const n = (await refsOf(db, section)).length;
    if (n) left.push(`${section.key} 還有 ${n} 筆`);
  }
  if (left.length) {
    console.error(`\n沒清乾淨：${left.join('、')}\n`);
    process.exit(5);
  }
  console.log(`
清好了，主檔與設定都還在。接下來：

  1. 打開 staging 的 app，到 設定 → 舊資料匯入 貼合併檔
  2. 貼完到 設定 → 資料健檢 看一次
`);
}

// **只有真的用 node 跑它的時候才動手**（`tests/reset-staging.test.js` 會 import 它）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n出事了：${err.message}`);
    process.exit(1);
  });
}
