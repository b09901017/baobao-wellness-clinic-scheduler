#!/usr/bin/env node
// 這個月回覆的每一位，在 app 裡以前是什麼樣子：**唯讀**讀正式站，寫一份「客戶脈絡」給你判斷用。
//
//   node history.mjs <月份資料夾> [--project prod|staging|<id>]
//
// 讀 <月份資料夾>/過程/名單.json（["名字", …]，照她寫的字），寫 <月份資料夾>/過程/客戶脈絡.json：
//   每一位 → 對到 app 的哪幾位客戶（名字、LINE 名字）、最近一年還算數的來訪落在星期幾／上午下午晚上／幾點、
//   最近 12 段來訪、以前每個月記過的「不能的時間」（原文＋規則）、客戶身上的警示（flags，例：體內金屬）。
// 終端機只印編號與數字（脈絡檔有真名，只在 .local/）。
//
// 憑證與「只讀」的做法跟 month-end-reconciliation 的 snapshot.mjs 一樣：她的 gcloud ADC；
// firebase-admin 每一個會寫的入口都換成丟錯。讀不到憑證時照那支 SKILL.md「卡住的時候」第一列。
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const require = createRequire(resolve(REPO, 'package.json'));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const firestore = require('firebase-admin/firestore');
const { slotStatus } = await import(pathToFileURL(resolve(REPO, 'public/js/domain/visits.js')).href);

const ALIASES = { prod: 'wellness-clinic-scheduler', production: 'wellness-clinic-scheduler', staging: 'wellness-clinic-staging' };
const WD = '日一二三四五六';

const argv = process.argv.slice(2);
const folder = argv.find((a) => !a.startsWith('--'));
const pi = argv.indexOf('--project');
const projectId = ALIASES[pi >= 0 ? argv[pi + 1] : 'prod'] ?? argv[pi + 1];
if (!folder || !existsSync(join(folder, '過程', '名單.json'))) {
  console.error('用法：node history.mjs <月份資料夾> [--project prod]；先把這個月回覆的名字寫進 過程/名單.json');
  process.exit(2);
}
if (!resolve(folder).includes(`${resolve(REPO, '.local')}`)) {
  console.error('月份資料夾要在 .local/ 底下（脈絡檔有真名）');
  process.exit(2);
}

function readOnly(db) {
  const no = (what) => () => { throw new Error(`這支只讀不寫：擋下了 ${what}`); };
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

const plain = (v) => {
  if (v == null) return v;
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};

const emulator = process.env.FIRESTORE_EMULATOR_HOST ?? null;
const app = initializeApp(emulator ? { projectId } : { credential: applicationDefault(), projectId });
const db = readOnly(firestore.getFirestore(app));

const [customers, visits, availability] = await Promise.all([
  db.collection('customers').get().then((s) => s.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))),
  db.collection('visits').get().then((s) => s.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))),
  db.collectionGroup('availability').get().then((s) => s.docs.map((d) => ({ id: d.id, customerId: d.ref.parent.parent?.id, ...plain(d.data()) }))),
]);

const squash = (s) => String(s ?? '').replace(/\s+/g, '');
/** 照她寫的字找 app 的客戶：一模一樣 → 名字互相包含 → LINE 名字包含。停用的也列（標出來）。 */
function matchesOf(name) {
  const n = squash(name);
  const live = customers.filter((c) => !c.deletedAt);
  const exact = live.filter((c) => squash(c.name) === n);
  if (exact.length) return { how: 'exact', list: exact };
  const part = live.filter((c) => c.name && (squash(c.name).includes(n) || n.includes(squash(c.name))));
  if (part.length) return { how: 'partial', list: part };
  const line = live.filter((c) => c.lineId && (squash(c.lineId).includes(n) || n.includes(squash(c.lineId))));
  return { how: line.length ? 'lineId' : 'none', list: line };
}

const hourOf = (s) => {
  const m = String(s ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
};
const partOf = (h) => (h == null ? null : h < 12 ? '上午' : h < 18 ? '下午' : '晚上');
const today = new Date().toISOString().slice(0, 10);
const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

const names = JSON.parse(readFileSync(join(folder, '過程', '名單.json'), 'utf8'));
const out = [];
names.forEach((name, i) => {
  const { how, list } = matchesOf(name);
  const ids = new Set(list.map((c) => c.id));
  const slots = [];
  for (const v of visits) {
    if (!ids.has(v.customerId) || v.deletedAt || !v.date || v.date < yearAgo) continue;
    (v.slots ?? []).forEach((s) => {
      const st = slotStatus(v, s);
      if (st === 'cancelled') return;
      const h = hourOf(s.startsAt);
      const wd = WD[new Date(`${v.date}T00:00:00`).getDay()];
      slots.push({ date: v.date, weekday: wd, start: s.startsAt ?? null, part: partOf(h), course: s.courseName ?? null, status: st, future: v.date > today });
    });
  }
  slots.sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));
  const tally = (key) => slots.filter((s) => !s.future && s.status !== 'no_show').reduce((m, s) => (s[key] ? { ...m, [s[key]]: (m[s[key]] ?? 0) + 1 } : m), {});
  const past = availability
    .filter((a) => ids.has(a.customerId) && !a.deletedAt)
    .map((a) => ({ from: a.validFrom ?? null, to: a.validTo ?? null, source: a.source ?? null, rawText: a.rawText ?? '', rules: a.rules ?? [] }))
    .sort((a, b) => String(b.from).localeCompare(String(a.from)));
  out.push({
    name,
    match: how,
    customers: list.map((c) => ({ id: c.id, name: c.name, lineId: c.lineId ?? null, active: c.active !== false, flags: c.flags ?? [] })),
    pastSlots: slots.filter((s) => !s.future).length,
    weekdays: tally('weekday'),
    partOfDay: tally('part'),
    recent: slots.filter((s) => !s.future).slice(-12),
    upcoming: slots.filter((s) => s.future),
    availability: past,
  });
  const metal = list.some((c) => (c.flags ?? []).some((f) => String(f).includes('金屬')));
  console.log(`#${i + 1} 對到 ${list.length} 位（${how}）${metal ? '・體內金屬' : ''}・過去一年來過 ${out.at(-1).pastSlots} 段・以前記過不能的時間 ${past.length} 份・之後已排 ${out.at(-1).upcoming.length} 段`);
});

writeFileSync(join(folder, '過程', '客戶脈絡.json'), JSON.stringify({ readAt: new Date().toISOString(), projectId, people: out }, null, 2));
console.log(`寫好了：過程/客戶脈絡.json（${out.length} 位）`);
process.exit(0);
