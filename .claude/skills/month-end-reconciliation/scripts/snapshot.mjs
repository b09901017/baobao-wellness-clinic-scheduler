#!/usr/bin/env node
// 從 Firestore **唯讀**拍一份快照：客戶、額度、來訪、任務、主檔。之後的比對只讀這一份檔案。
//
//   node snapshot.mjs --project prod|staging|<專案 id> --out <快照.json>
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node snapshot.mjs --project demo-scheduler-w5 --out <快照.json>
//
// 憑證：她的 gcloud ADC（%APPDATA%\gcloud\application_default_credentials.json）。這台的 gcloud 被防毒擋，
// 但 Node 讀得到（NODE_EXTRA_CA_CERTS）。讀不到就照 SKILL.md「卡住的時候」那張表的第一列（服務帳號金鑰）。
//
// **只讀不寫**：底下把 firebase-admin 每一個會寫的入口換成丟錯 —— 程式哪天被改到去寫，會在第一下就停住，
// 不是寫進去之後才發現。快照有真名，只能寫進 .local/（不進版控）。
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const require = createRequire(resolve(REPO, 'package.json'));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const firestore = require('firebase-admin/firestore');

const ALIASES = { prod: 'wellness-clinic-scheduler', production: 'wellness-clinic-scheduler', staging: 'wellness-clinic-staging' };
/** 主檔的種類（`domain/masterData.js` 的 `MASTER_TYPES`）。讀不到的那一種照樣往下，記在 meta 裡。 */
const MASTER = ['rooms', 'staff', 'equipment', 'courses', 'plans', 'ivProducts', 'products', 'clinicalFlags'];

function args(argv) {
  const out = { project: 'prod', out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

/** 每一個會寫的入口都換成丟錯。 */
function readOnly(db) {
  const no = (what) => () => { throw new Error(`月底對帳只讀不寫：擋下了 ${what}`); };
  const { DocumentReference, CollectionReference, WriteBatch, Firestore } = firestore;
  for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = no(`doc.${m}`);
  CollectionReference.prototype.add = no('collection.add');
  for (const m of ['set', 'update', 'delete', 'create', 'commit']) WriteBatch.prototype[m] = no(`batch.${m}`);
  for (const m of ['batch', 'runTransaction', 'bulkWriter', 'recursiveDelete']) {
    Firestore.prototype[m] = no(m);
    db[m] = no(m);
  }
  return db;
}

/** Timestamp → ISO 字串，其餘照原樣（JSON 寫得出去、domain 讀得懂）。 */
function plain(value) {
  if (value == null) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

const rowsOf = (snap, extra = () => ({})) => snap.docs.map((d) => ({ id: d.id, ...plain(d.data()), ...extra(d) }));

const opt = args(process.argv.slice(2));
if (!opt.out) {
  console.error('用法：node snapshot.mjs --project prod|staging|<id> --out <快照.json>');
  process.exit(2);
}
const projectId = ALIASES[opt.project] ?? opt.project;
const emulator = process.env.FIRESTORE_EMULATOR_HOST ?? null;
if (emulator && ALIASES[opt.project]) {
  console.error(`開著模擬器（${emulator}）卻指定了 ${opt.project} —— 拿掉 FIRESTORE_EMULATOR_HOST 或換成模擬器的命名空間`);
  process.exit(2);
}

const app = initializeApp(emulator ? { projectId } : { credential: applicationDefault(), projectId });
const db = readOnly(firestore.getFirestore(app));

const t0 = Date.now();
const [customers, entitlements, visits, tasks] = await Promise.all([
  db.collection('customers').get().then((s) => rowsOf(s)),
  db.collectionGroup('entitlements').get().then((s) => rowsOf(s, (d) => ({ parentId: d.ref.parent.parent?.id ?? null }))),
  db.collection('visits').get().then((s) => rowsOf(s)),
  db.collection('tasks').get().then((s) => rowsOf(s)),
]);
const master = {};
const missing = [];
for (const type of MASTER) {
  try {
    master[type] = rowsOf(await db.collection(`config/app/${type}`).get());
  } catch (e) {
    master[type] = [];
    missing.push(`${type}: ${e.code ?? e.message}`);
  }
}

const snapshot = {
  meta: {
    projectId,
    emulator,
    readAt: new Date().toISOString(),
    ms: Date.now() - t0,
    counts: { customers: customers.length, entitlements: entitlements.length, visits: visits.length, tasks: tasks.length },
    masterMissing: missing,
  },
  customers, entitlements, visits, tasks, master,
};
mkdirSync(dirname(resolve(opt.out)), { recursive: true });
writeFileSync(opt.out, JSON.stringify(snapshot));
// 終端機只印數字
console.log(JSON.stringify({ projectId, emulator, ...snapshot.meta.counts, masterMissing: missing, ms: snapshot.meta.ms }));
