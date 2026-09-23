#!/usr/bin/env node
//
// 在 staging（或模擬器）上長出一份可以拿來點的假資料。
//
// **合成的，不是把正式資料匿名化。** 匿名化那條路有兩個問題：匿名腳本自己會
// 漏欄位（漏一個就是真名進了另一個資料庫），而且它要先把正式資料倒出來 ——
// 那份檔案在硬碟上放著的每一分鐘都是風險。合成資料一個真名都不會有，
// 規模還可以自己調（要壓測就 `--customers 200`）。
//
// 假名一律用專案已經在用的那幾個（CLAUDE.md：例子一律寫「客戶A」，
// 規則跟名字的字數有關時用假名）。`tests/no-secrets.test.js` 盯著。
//
// ---------------------------------------------------------------------------
//
//   # 模擬器（不需要憑證）
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     node scripts/seed-staging.mjs --project demo-scheduler --yes
//
//   # staging（要服務帳號金鑰）
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/staging-sa.json \
//     node scripts/seed-staging.mjs --project staging --yes
//
// 跟 `restore-backup.mjs` 一樣：沒有 `--yes` 就只是印出打算做什麼，
// 而且**拒絕跑在正式專案上**（連 `--allow-prod` 都沒有 —— 正式環境沒有任何
// 理由需要假客戶）。

import { pathToFileURL } from 'node:url';

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { SEED, DEFAULT_SETTINGS } from '../public/js/domain/seed.js';
import { expandPlan, poolName, timedLabel } from '../public/js/domain/entitlements.js';
// 任務照規則產生，不自己編一個種類。
import { newRegistrations } from '../public/js/domain/taskRules.js';

const PROD_PROJECT = 'wellness-clinic-scheduler';
// **正式那兩個別名一定要在這裡。** 少了它們，`--project prod` 會原封不動地
// traverse 過守衛（'prod' !== 'wellness-clinic-scheduler'），然後死在
// 「找不到憑證」——看起來像是被擋下來了，其實只是剛好沒有金鑰。
const ALIASES = {
  staging: 'wellness-clinic-staging',
  prod: PROD_PROJECT,
  production: PROD_PROJECT,
};

/**
 * 假名。**客戶A、客戶B……** —— 她 2026-09-06 指名的，也是這個 repo 其他地方
 * 已經在用的寫法（CLAUDE.md、`tests-e2e/fixtures/data.js`）。
 *
 * 二十六位就到底了。`--customers 200` 那種壓測會接著編號（客戶A2、客戶B2……），
 * **不會退回真名** —— 這一支從頭到尾一個真名都不可以有。
 */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const fakeName = (i) => `客戶${LETTERS[i % 26]}${i < 26 ? '' : Math.floor(i / 26) + 1}`;

/**
 * 假資料的 id 一律用這個開頭。`clearPrevious()` 靠它認出「上一輪長出來的東西」。
 *
 * 前綴而不是「整個集合清空」是刻意的：staging 上可能有她自己手動建的東西，
 * 那些不該被一個種子腳本掃掉。
 */
const PREFIX = 'seed-cus-';

/**
 * 種子。同一個種子跑兩次長出一模一樣的資料 —— 可重現才拿得來查 bug。
 *
 * **每一位客戶配一組自己的**，不是全部共用一條序列。共用的話，改動一位客戶
 * 的產生邏輯會讓後面每一位的資料全部位移，而 diff 看起來像整份重寫。
 */
function rng(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

function parseArgs(argv) {
  const out = { project: null, yes: false, customers: 20, months: 6 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') out.yes = true;
    else if (arg === '--project') out.project = argv[++i];
    else if (arg.startsWith('--project=')) out.project = arg.slice('--project='.length);
    else if (arg === '--customers') out.customers = Number(argv[++i]);
    else if (arg === '--months') out.months = Number(argv[++i]);
  }
  return out;
}

/**
 * 這一輪要種出來的那幾種復能額度（issue 04）。她真的買得到的組合。
 *
 * **名字是算出來的不是寫死的**（`poolName()` + `timedLabel()`）——
 * 寫死的話 2026-09-07 那次改格式之後，這份假資料一打開資料健檢就報
 * 七筆「復能額度還叫舊名字」，而那是假資料自己造出來的。
 */
const RECOVERY_EXTRAS = [
  { ids: ['eq-laser', 'eq-sis', 'eq-indiba', 'eq-ilib'], durationMin: 30, qty: 10 },
  { ids: ['eq-sis'], durationMin: 60, qty: 5 },
  { ids: ['eq-indiba'], durationMin: 30, qty: 5 },
].map((x) => ({
  ...x,
  label: timedLabel(poolName(x.ids, SEED.equipment, SEED.courses), x.durationMin),
}));

/**
 * 兩份備忘錄（ADR-0067、0076）。一份掛課程、一份掛合作機構 ——
 * **兩種掛法各種一份**，不然她點不出「掛自然美的那一份會在哪裡浮出來」。
 */
const PLAYBOOKS = [
  {
    id: 'seed-cus-pb-drip',
    title: '營養點滴',
    courseIds: ['course-iv-drip'],
    partners: [],
    body: ['飯後打針，空腹容易不舒服', '先問慣用手', '打完留 10 分鐘再走'].join('\n'),
  },
  {
    id: 'seed-cus-pb-nb',
    title: '自然美對接',
    courseIds: [],
    partners: ['自然美'],
    body: [
      '壓完表當天就跟他們的專員說一聲',
      '對方要的是日期＋時段，不用講課程',
      '他們回覆之前先不要跟客人說「約好了」',
    ].join('\n'),
  },
];

/**
 * 時段與治療師都要**散開**。
 *
 * 以前每一筆來訪都是 `10:30 騰崴`，於是二十位客戶的來訪全部撞在一起 ——
 * 資料健檢的「衝突殘留」一打開就十幾條紅字，而那是假資料自己造出來的，
 * 不是她的資料有問題。一份假資料如果一打開就滿江紅，她就沒辦法拿
 * 「健檢有沒有變多」當成回歸的判準了。
 */
const START_TIMES = ['09:15', '10:30', '13:00', '14:15', '15:30', '16:45'];
const THERAPISTS = ['staff-tw', 'staff-zn', 'staff-lulu', 'staff-xy', 'staff-gy'];
// ILIB 那幾間照她 2026-09-08 給的優先順序（`.10、治2、治3`）。
// `room-ilib4` 2026-09-08 從診間清單上拿掉了 —— 那一間有個 4。
const ILIB_ROOMS = ['room-iv10', 'room-t2', 'room-t3'];

/** 開始時間 + 60 分鐘。這一份的每一段都是一小時。 */
function plusHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 隨手記寫她真的會寫的那種。「記得帶健保卡」是 2026-09-06 拿掉的。 */
const NOTE_TEXTS = ['這次想指定騰崴', '下次要問他要不要續約', '他說血管在右手比較好打'];

/** 一筆額度的空白欄位。方案展開那一邊由 `expandPlan()` 補，這裡是加購那一筆。 */
function extraEntitlement(extra, { purchaseId, purchasedAt }) {
  return {
    type: 'pool',
    label: extra.label,
    courseId: null,
    optionEquipmentIds: extra.ids,
    totalQty: extra.qty,
    durationMin: extra.durationMin,
    frequencyRule: null,
    sourcePlanName: null,
    sourcePlanQty: null,
    purchaseId,
    purchasedAt,
    // **不給到期日**（issue 15）：她 2026-09-06 說「基本上不會到期」。
    expiresAt: null,
    doneCount: 0,
    bookedCount: 0,
    lastReconciledAt: null,
  };
}

/**
 * 一位假客戶連同他的額度、來訪、任務、隨手記。
 *
 * 來訪的狀態**照日期判**，跟 `domain/mergeImport.js` 的 `statusFor()` 同一個
 * 判斷（ADR-0029）：過去的是已完成、未來的是已確認或待確認。
 * 隨手猜一個狀態出來的話，資料健檢會滿江紅，那份假資料就沒有人想用。
 */
/**
 * 一筆種子來訪的登記任務。**照規則產生，不自己編一個 kind**：寫死一個種類正是
 * 2026-08-23 退休的「Abovee」還留在假資料裡的原因 —— 種子跟規則各寫一次，
 * 規則改了種子不會跟。
 *
 * 走 app 存檔時那一支（`newRegistrations()`）：逐段、每一張帶 `slotIndexes`（ADR-0107）。
 * 沒帶的會被當成蓋住整天（`cancelSlotsOf()`），她在 staging 上改期之後新那一段
 * 談定了一張都不長（prelaunch-audit-2026-09-23/issues/15）。
 */
export function registrationTasks(vid, data, coursesById) {
  return newRegistrations({ ...data, id: vid }, [], coursesById)
    .map((t, k) => ({ id: `${vid}-task-${k}`, data: t }));
}

export function makeCustomer(i, today, { months }) {
  // 每一位自己一條序列（見 `rng()` 的說明）。
  const rand = rng(1000 + i);
  const id = `${PREFIX}${String(i + 1).padStart(3, '0')}`;
  const name = fakeName(i);
  const plan = SEED.plans[i % SEED.plans.length];
  const purchasedAt = addDays(today, -Math.floor(rand() * months * 30));
  const purchaseId = `${id}-buy`;

  const planRows = expandPlan(plan, 1, { purchasedAt, purchaseId });

  // 每四位有一位的方案被微調過（issue 05）—— 「買過什麼」那一頁才點得出東西。
  if (i % 4 === 1) {
    const at = planRows.findIndex((e) => e.type === 'pool');
    if (at >= 0) planRows[at] = { ...planRows[at], totalQty: planRows[at].totalQty - 5 };
  }

  // 每三位有一位多買一種復能（issue 04）：四選一、單台 SIS、單台 INDIBA。
  // **輪流換一種** —— `i % RECOVERY_EXTRAS.length` 會永遠是 0（被選中的 i 都
  // 是 3 的倍數），那樣二十位裡只會出現四選一那一種。
  const extra = i % 3 === 0 ? RECOVERY_EXTRAS[(i / 3) % RECOVERY_EXTRAS.length] : null;
  const extraRows = extra
    ? [extraEntitlement(extra, { purchaseId: `${id}-buy2`, purchasedAt })]
    : [];

  const entitlements = [...planRows, ...extraRows]
    .map((data, n) => ({ id: `${id}-ent-${n}`, data }));

  const visits = [];
  const tasks = [];
  // 一位客戶大約 0–8 筆來訪，扣的是他的擇一池那一筆。
  // **有四選一就用四選一** —— 那是唯一種得出「這一段用了 ILIB」的池，
  // 而那一段正是 ADR-0075 要她點得出來的東西（課程跟著換、要診間不要治療師）。
  const pool = entitlements.find((e) => (e.data.optionEquipmentIds ?? []).includes('eq-ilib'))
    ?? entitlements.find((e) => e.data.type === 'pool')
    ?? entitlements[0];
  const poolIds = pool.data.optionEquipmentIds ?? ['eq-indiba'];
  const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));
  const howMany = Math.floor(rand() * 9);
  // **同一位客戶同一天只會有一筆**（ADR-0083）。日期是亂數挑的，所以會撞 ——
  // 撞到就跳過那一筆，不要把兩筆記在同一天。資料健檢有一列盯著這件事，
  // 而一份假資料一打開就報紅字，她就沒辦法拿健檢當回歸的判準了。
  const usedDates = new Set();

  for (let n = 0; n < howMany; n += 1) {
    const offset = Math.floor(rand() * months * 30) - Math.floor(months * 22);
    const date = addDays(today, offset);
    if (usedDates.has(date)) continue;
    usedDates.add(date);
    const past = date < today;
    const vid = `${id}-visit-${n}`;

    // 這一段用了哪一台。**四選一有時候會選到 ILIB**（ADR-0075）——
    // 那一段的課程要跟著換成 ILIB，不然它會帶著一個要治療師的復能存進去。
    const equipmentId = poolIds[n % poolIds.length];
    const onIlib = equipmentId === 'eq-ilib';
    const courseId = onIlib ? 'course-iv-laser' : 'course-recovery';
    const status = past ? 'done' : (rand() > 0.4 ? 'confirmed' : 'pending_confirm');
    // 時段散開：同一位治療師同一天同一個時間只會有一位客戶。
    const startsAt = START_TIMES[(i * 3 + n) % START_TIMES.length];

    const data = {
      customerId: id,
      customerName: name,
      date,
      status,
      slots: [{
        entitlementId: pool.id,
        courseId,
        courseName: onIlib ? 'ILIB' : '復能',
        equipmentId,
        startsAt,
        endsAt: plusHour(startsAt),
        // ILIB 要診間、其餘三台要治療師（ADR-0075）
        ...(onIlib
          ? { roomId: ILIB_ROOMS[(i + n) % ILIB_ROOMS.length] }
          : { therapistId: THERAPISTS[(i + n) % THERAPISTS.length] }),
        ...(past ? { attended: true } : {}),
      }],
      note: null,
    };
    visits.push({ id: vid, data });

    tasks.push(...registrationTasks(vid, data, coursesById));
  }

  // 計數欄位要跟來訪對得起來，否則資料健檢第一項就滿江紅。
  const doneCount = visits.filter((v) => v.data.status === 'done').length;
  const bookedCount = visits.filter(
    (v) => v.data.status === 'confirmed' || v.data.status === 'pending_confirm',
  ).length;
  const counted = entitlements.map((e) => (e.id === pool.id
    ? { ...e, data: { ...e.data, doneCount, bookedCount } }
    : e));

  // **這個月的可用性收集要有一份。** 少了它，資料健檢的「資料過期」會把
  // 每一位還有剩餘次數的假客戶都列出來 —— 而一份假資料如果一打開就滿江紅，
  // 那她就沒辦法拿「健檢有沒有變多」當成回歸的判準了。
  // 一份就是一個月（ADR-0053），有效期涵蓋今天。
  const monthStart = `${today.slice(0, 7)}-01`;
  const availability = [{
    id: `${id}-avail`,
    data: {
      month: today.slice(0, 7),
      rawText: '星期三下午不行',
      // **kind 一定要是 `RULE_KINDS` 裡的那幾個。** 2026-09-06 之前這裡寫的是
      // `{ kind: 'weekday', allowed: false }` —— `blocks()` 四個分支一個都對不上，
      // 所以那句話一天都沒有真的擋掉，而畫面上完全看不出來（可用性那一頁印的是
      // 原文、卡片牆上那顆丸子是 `describeRule()` 畫的，兩個都還是對的）。
      rules: [{ kind: 'exclude_weekday', weekday: 3, partOfDay: 'pm' }],
      validFrom: monthStart,
      validTo: addDays(monthStart, 60),
      collectedAt: addDays(today, -Math.floor(rand() * 10)),
    },
  }];

  const notes = rand() > 0.6
    ? [{
      id: `${id}-note`,
      data: {
        text: NOTE_TEXTS[i % NOTE_TEXTS.length],
        done: false,
        date: addDays(today, Math.floor(rand() * 20)),
        customerId: id,
        customerName: name,
        entitlementId: null,
      },
    }]
    : [];

  // 警示（ADR-0074）。**兩種樣式各看得到一個** —— 一份假資料如果每一位都
  // 長一樣，她點不出這一輪改了什麼。
  const flags = [];
  if (i % 5 === 0) flags.push('體內金屬');
  if (i % 5 === 2) flags.push('血管難打');
  if (i % 7 === 3) flags.push('固定禮拜五不行');

  return {
    customer: {
      id,
      data: {
        name,
        active: true,
        priority: Math.floor(rand() * 6),
        marks: [],
        flags,
        // 大約四分之一的人掛自然美（ADR-0076）
        partners: i % 4 === 0 ? ['自然美'] : [],
        purchasedAt,
        membershipExpiresAt: null,
      },
    },
    entitlements: counted,
    availability,
    visits,
    tasks,
    notes,
  };
}

const BATCH_SIZE = 400;

/**
 * 把上一輪種出來的東西先清掉。
 *
 * **不清會出事，而且症狀很難看懂**：客戶與額度的 id 是固定的（會被蓋掉），
 * 但來訪的筆數是隨機的 —— 上一輪種了 8 筆、這一輪只種 5 筆，
 * 多出來的那 3 筆會留在資料庫裡。於是額度上的計數欄位（這一輪算的）
 * 跟從來訪重算的值對不起來，資料健檢第一項就滿江紅，
 * 而看起來完全像是 app 算錯了。
 *
 * 這裡是**真的刪掉**，不是軟刪除 —— 這些是合成資料，不是她的東西，
 * 而且留著一堆 `deletedAt` 的假資料只會讓「已刪除項目」那一頁看不懂。
 * 只刪 id 以 `seed-cus-` 開頭的，她自己在 staging 上手動建的不會被掃到。
 */
async function clearPrevious(db) {
  const refs = [];

  for (const path of ['visits', 'tasks', 'notes', 'playbooks', 'customers']) {
    const snap = await db.collection(path).get();
    for (const doc of snap.docs) if (doc.id.startsWith(PREFIX)) refs.push(doc.ref);
  }
  // 子集合的 id 也帶著前綴，但保險起見連父文件一起認 ——
  // collectionGroup 掃得到的才刪得掉，漏掉的會變成孤兒。
  for (const group of ['entitlements', 'availability']) {
    const snap = await db.collectionGroup(group).get();
    for (const doc of snap.docs) {
      if (doc.ref.parent.parent?.id?.startsWith(PREFIX)) refs.push(doc.ref);
    }
  }

  if (!refs.length) return 0;
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_SIZE)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}

async function writeAll(db, plan) {
  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { path, id, data } of plan.slice(i, i + BATCH_SIZE)) {
      batch.set(db.collection(path).doc(id), {
        deletedAt: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdBy: 'seed-staging',
        ...data,
      });
    }
    await batch.commit();
    process.stdout.write(`\r  寫入 ${Math.min(i + BATCH_SIZE, plan.length)}/${plan.length}`);
  }
  if (plan.length) process.stdout.write('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = ALIASES[args.project] ?? args.project;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;

  if (!projectId) {
    console.error('用法：node scripts/seed-staging.mjs --project <staging|專案id> [--yes] [--customers 20]');
    process.exit(2);
  }
  if (projectId === PROD_PROJECT) {
    console.error(`\n拒絕。正式專案（${PROD_PROJECT}）沒有任何理由需要假客戶。\n`);
    process.exit(3);
  }

  const today = iso(new Date());
  const people = Array.from({ length: args.customers }, (_, i) => makeCustomer(i, today, args));

  const plan = [];
  for (const [type, rows] of Object.entries(SEED)) {
    for (const row of rows) {
      const { id, ...data } = row;
      plan.push({ path: `config/app/${type}`, id, data: { ...data, active: true } });
    }
  }
  for (const pb of PLAYBOOKS) {
    const { id, ...data } = pb;
    plan.push({ path: 'playbooks', id, data });
  }
  for (const p of people) {
    plan.push({ path: 'customers', id: p.customer.id, data: p.customer.data });
    for (const e of p.entitlements) plan.push({ path: `customers/${p.customer.id}/entitlements`, id: e.id, data: e.data });
    for (const a of p.availability) plan.push({ path: `customers/${p.customer.id}/availability`, id: a.id, data: a.data });
    for (const v of p.visits) plan.push({ path: 'visits', id: v.id, data: v.data });
    for (const t of p.tasks) plan.push({ path: 'tasks', id: t.id, data: t.data });
    for (const n of p.notes) plan.push({ path: 'notes', id: n.id, data: n.data });
  }

  console.log(`
目標專案　 ${projectId}${emulator ? `（模擬器 ${emulator}）` : ''}
模式　　　 ${args.yes ? '**真的寫入**' : 'dry run'}
假客戶　　 ${people.length} 位
來訪　　　 ${people.reduce((n, p) => n + p.visits.length, 0)} 筆
額度　　　 ${people.reduce((n, p) => n + p.entitlements.length, 0)} 筆
總文件數　 ${plan.length}
`);

  if (!args.yes) {
    console.log('沒有寫任何東西。加 --yes 跑一次。\n');
    return;
  }

  initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
  const db = getFirestore();

  await db.doc('config/app').set(DEFAULT_SETTINGS, { merge: true });
  const cleared = await clearPrevious(db);
  if (cleared) console.log(`  清掉上一輪種出來的 ${cleared} 筆`);
  await writeAll(db, plan);

  console.log(`
寫好了。接下來：

  1. 到 staging 的 app 登入一次，畫面會說「這個帳號還沒有權限」並印出你的 uid
  2. 把那串 uid 加進 staging 專案的 allowedUsers 集合（見 docs/STAGING.md）
  3. 開 #/settings/health 跑一次資料健檢 —— 這份假資料應該一條都不報
`);
}

// **只有真的用 node 跑它的時候才動手。** `tests/seed-staging.test.js` 會
// import 這一支去檢查它種出來的形狀（可用性的 rule kind、任務的種類、假名），
// 而那時候一個 Firestore 連線都不該開。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\n出事了：${err.message}`);
    process.exit(1);
  });
}
