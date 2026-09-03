// firestore.rules 的真實測試：跑在 Firebase Firestore 模擬器上。
//
// 跟 tests/rules.test.js 的差別：那一支是**靜態比對**（拿規則檔的文字去對
// domain 的白名單），這一支是**真的送一筆寫入進去看它被不被擋**。
// 兩支都要有 —— 靜態那支抓得到「白名單漏一種」，這一支抓得到
// 「規則寫錯語法」「兩條 match 互相蓋掉」這種只有真的跑才看得出來的事。
//
// 用一個獨立的 projectId（demo-rules-test），跟 E2E 那份資料完全隔開。
//
// 前置：模擬器要在跑（tests-e2e/start-emulators.sh）。

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
  collectionGroup, query, where, serverTimestamp,
} from 'firebase/firestore';

const RULES = readFileSync(
  fileURLToPath(new URL('../../firestore.rules', import.meta.url)),
  'utf8',
);

const OK_UID = 'uid-allowed';    // 在白名單裡
const NOPE_UID = 'uid-stranger'; // 登入了，但不在白名單

let env;
let allowed;    // 白名單內的使用者
let stranger;   // 登入但不在白名單
let anon;       // 完全沒登入（= 客戶用 LINE 點開表單的那個人）

// 每一筆寫入都要有 updatedAt，否則 keepsExistingId() 會擋下來。
// 這正是 repo.js 每次 commit 都補上的那個欄位。
const stamped = (data) => ({ ...data, updatedAt: serverTimestamp(), deletedAt: null });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
  allowed = env.authenticatedContext(OK_UID).firestore();
  stranger = env.authenticatedContext(NOPE_UID).firestore();
  anon = env.unauthenticatedContext().firestore();
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'allowedUsers', OK_UID), {});
  });
});

// ---------- 第一道：沒登入、不在白名單，什麼都碰不到 ----------

describe('R1 白名單是唯一的門', () => {
  const COLLECTIONS = [
    'customers', 'visits', 'tasks', 'notes', 'events', 'batches', 'playbooks', 'audit',
  ];

  for (const path of COLLECTIONS) {
    test(`R1.1 沒登入讀不到 ${path}`, async () => {
      await assertFails(getDocs(collection(anon, path)));
    });

    test(`R1.2 登入但不在白名單也讀不到 ${path}`, async () => {
      await assertFails(getDocs(collection(stranger, path)));
    });
  }

  test('R1.3 白名單內讀得到', async () => {
    await assertSucceeds(getDocs(collection(allowed, 'customers')));
  });

  test('R1.4 不在白名單的人寫不進去', async () => {
    await assertFails(
      setDoc(doc(stranger, 'customers', 'c1'), stamped({ name: '王小明' })),
    );
  });

  test('R1.5 沒有明確開洞的集合一律拒絕', async () => {
    await assertFails(getDocs(collection(allowed, 'somethingNobodyDefined')));
    await assertFails(
      setDoc(doc(allowed, 'somethingNobodyDefined', 'x'), stamped({ a: 1 })),
    );
  });
});

// ---------- allowedUsers 自己 ----------

describe('R2 白名單本身', () => {
  test('R2.1 只讀得到自己那一筆', async () => {
    await assertSucceeds(getDoc(doc(allowed, 'allowedUsers', OK_UID)));
  });

  test('R2.2 讀不到別人那一筆', async () => {
    await assertFails(getDoc(doc(allowed, 'allowedUsers', NOPE_UID)));
  });

  test('R2.3 程式改不了白名單（要走 Console）', async () => {
    await assertFails(setDoc(doc(allowed, 'allowedUsers', 'uid-new'), {}));
    await assertFails(deleteDoc(doc(allowed, 'allowedUsers', OK_UID)));
  });
});

// ---------- 稽核紀錄：append-only ----------

describe('R3 稽核紀錄改不掉也刪不掉', () => {
  const auditDoc = (over = {}) => ({
    at: serverTimestamp(),
    actor: OK_UID,
    action: 'customers.create',
    targetPath: 'customers/c1',
    ...over,
  });

  test('R3.1 寫得進去', async () => {
    await assertSucceeds(setDoc(doc(allowed, 'audit', 'a1'), auditDoc()));
  });

  test('R3.2 actor 一定要是自己 —— 不能冒名', async () => {
    await assertFails(setDoc(doc(allowed, 'audit', 'a2'), auditDoc({ actor: NOPE_UID })));
  });

  test('R3.3 少一個必要欄位就寫不進去', async () => {
    await assertFails(setDoc(doc(allowed, 'audit', 'a3'), { actor: OK_UID, at: serverTimestamp() }));
  });

  test('R3.4 改不掉', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit', 'a4'), auditDoc());
    });
    await assertFails(updateDoc(doc(allowed, 'audit', 'a4'), { action: '竄改' }));
  });

  test('R3.5 刪不掉', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit', 'a5'), auditDoc());
    });
    await assertFails(deleteDoc(doc(allowed, 'audit', 'a5')));
  });
});

// ---------- 永不硬刪除 ----------

describe('R4 永不硬刪除（SPEC 6.1）', () => {
  const CASES = [
    ['customers', { name: '王小明' }],
    ['visits', { customerId: 'c1', date: '2026-09-03', slots: [{}], status: 'confirmed' }],
    ['tasks', { customerId: 'c1', kind: 'Examine', dueDate: '2026-09-02', done: false }],
    ['notes', { text: '記得帶健保卡', done: false }],
    ['events', {
      title: '宜蘭休假', category: 'leave',
      startDate: '2026-09-01', endDate: '2026-09-03', allDay: true,
    }],
    ['batches', { targetMonth: '2026-09', queue: [], status: 'active' }],
    ['playbooks', { title: '營養點滴', sections: [{ heading: '', when: null, body: '飯後打針' }] }],
  ];

  for (const [path, data] of CASES) {
    test(`R4.1 ${path} 刪不掉，只能寫 deletedAt`, async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), path, 'x1'), { ...data, updatedAt: new Date(), deletedAt: null });
      });
      await assertFails(deleteDoc(doc(allowed, path, 'x1')));
      await assertSucceeds(
        updateDoc(doc(allowed, path, 'x1'), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      );
    });
  }

  test('R4.2 沒有 updatedAt 的寫入被擋（keepsExistingId）', async () => {
    await assertFails(setDoc(doc(allowed, 'customers', 'c-noupd'), { name: '王小明', deletedAt: null }));
  });
});

// ---------- 額度的形狀 ----------
//
// CLAUDE.md 特別警告過這一段：白名單漏一種的症狀是「程式完全正確、測試全綠，
// 只有在真的裝置上按下加購才會看到 Missing or insufficient permissions」。

describe('R5 額度（validEntitlement）', () => {
  const entPath = (id) => doc(allowed, 'customers', 'c1', 'entitlements', id);
  const ent = (over = {}) => stamped({ label: '復能', type: 'pool', totalQty: 12, ...over });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'customers', 'c1'), {
        name: '王小明', updatedAt: new Date(), deletedAt: null,
      });
    });
  });

  for (const type of ['single', 'pool', 'product']) {
    test(`R5.1 型態 ${type} 寫得進去`, async () => {
      await assertSucceeds(setDoc(entPath(`e-${type}`), ent({ type })));
    });
  }

  test('R5.2 不認得的型態被擋', async () => {
    await assertFails(setDoc(entPath('e-bad'), ent({ type: 'bundle' })));
  });

  test('R5.3 名稱空白被擋', async () => {
    await assertFails(setDoc(entPath('e-noname'), ent({ label: '' })));
  });

  test('R5.4 次數 0 或負數被擋', async () => {
    await assertFails(setDoc(entPath('e-zero'), ent({ totalQty: 0 })));
    await assertFails(setDoc(entPath('e-neg'), ent({ totalQty: -3 })));
  });

  test('R5.5 金額等級（tier）太長被擋、正常的過', async () => {
    await assertSucceeds(setDoc(entPath('e-tier'), ent({ tier: '8萬' })));
    await assertFails(setDoc(entPath('e-tier-long'), ent({ tier: 'x'.repeat(21) })));
  });

  test('R5.6 營養品的金額必須是正整數', async () => {
    await assertSucceeds(setDoc(entPath('e-amt'), ent({ type: 'product', amountTwd: 5000 })));
    await assertFails(setDoc(entPath('e-amt0'), ent({ type: 'product', amountTwd: 0 })));
    await assertFails(setDoc(entPath('e-amtstr'), ent({ type: 'product', amountTwd: '5000' })));
  });

  test('R5.7 items / deliveries 必須是陣列', async () => {
    await assertSucceeds(setDoc(entPath('e-items'), ent({
      type: 'product', items: [{ productId: 'prod-gaba', name: 'GABA' }], deliveries: [],
    })));
    await assertFails(setDoc(entPath('e-items-bad'), ent({ type: 'product', items: 'GABA' })));
  });

  test('R5.8 collection group 讀得到（客戶總覽靠它）', async () => {
    await assertSucceeds(getDocs(collectionGroup(allowed, 'entitlements')));
  });

  test('R5.9 collection group 那條只開 read，繞不過 validEntitlement', async () => {
    await assertFails(setDoc(entPath('e-viacg'), ent({ type: 'bundle' })));
  });
});

// ---------- 來訪 ----------

describe('R6 來訪（validVisit）', () => {
  const v = (over = {}) => stamped({
    customerId: 'c1', date: '2026-09-03',
    slots: [{ courseId: 'course-recovery' }], status: 'pending_confirm', ...over,
  });

  for (const status of ['pending_confirm', 'confirmed', 'done', 'no_show', 'cancelled']) {
    test(`R6.1 狀態 ${status} 寫得進去`, async () => {
      await assertSucceeds(setDoc(doc(allowed, 'visits', `v-${status}`), v({ status })));
    });
  }

  test('R6.2 不認得的狀態被擋', async () => {
    await assertFails(setDoc(doc(allowed, 'visits', 'v-bad'), v({ status: 'draft' })));
  });

  test('R6.3 沒有時段的來訪被擋', async () => {
    await assertFails(setDoc(doc(allowed, 'visits', 'v-noslot'), v({ slots: [] })));
  });

  test('R6.4 日期格式不是 YYYY-MM-DD 被擋', async () => {
    await assertFails(setDoc(doc(allowed, 'visits', 'v-baddate'), v({ date: '2026-9-3' })));
  });

  test('R6.5 狀態機的反向轉移**不擋** —— 擋了就沒有復原（ADR-0006）', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'visits', 'v-undo'), {
        customerId: 'c1', date: '2026-09-03', slots: [{}], status: 'done',
        updatedAt: new Date(), deletedAt: null,
      });
    });
    await assertSucceeds(updateDoc(doc(allowed, 'visits', 'v-undo'), {
      status: 'pending_confirm', updatedAt: serverTimestamp(),
    }));
  });
});

// ---------- 行事備註：倒著長的色條 ----------

describe('R7 行事備註（validEvent）', () => {
  const e = (over = {}) => stamped({
    title: '宜蘭休假', category: 'leave',
    startDate: '2026-09-01', endDate: '2026-09-03', allDay: true, ...over,
  });

  test('R7.1 正常的跨天休假寫得進去', async () => {
    await assertSucceeds(setDoc(doc(allowed, 'events', 'ev1'), e()));
  });

  test('R7.2 endDate 早於 startDate 被擋（月檢視排版會算錯）', async () => {
    await assertFails(setDoc(doc(allowed, 'events', 'ev2'), e({ endDate: '2026-08-30' })));
  });

  test('R7.3 只有 personal / leave 兩種類別', async () => {
    await assertSucceeds(setDoc(doc(allowed, 'events', 'ev3'), e({ category: 'personal' })));
    await assertFails(setDoc(doc(allowed, 'events', 'ev4'), e({ category: 'note' })));
  });

  test('R7.4 顏色是選填，但形狀要對', async () => {
    await assertSucceeds(setDoc(doc(allowed, 'events', 'ev5'), e({ color: 'teal' })));
    await assertFails(setDoc(doc(allowed, 'events', 'ev6'), e({ color: 7 })));
  });
});

// ---------- 隨手記 ----------

describe('R8 隨手記（validNote）', () => {
  const n = (over = {}) => stamped({ text: '記得帶健保卡', done: false, ...over });

  test('R8.1 超過 200 字被擋', async () => {
    await assertSucceeds(setDoc(doc(allowed, 'notes', 'n1'), n({ text: '字'.repeat(200) })));
    await assertFails(setDoc(doc(allowed, 'notes', 'n2'), n({ text: '字'.repeat(201) })));
  });

  test('R8.2 空字串被擋', async () => {
    await assertFails(setDoc(doc(allowed, 'notes', 'n3'), n({ text: '' })));
  });

  test('R8.3 日期選填，null 也可以', async () => {
    await assertSucceeds(setDoc(doc(allowed, 'notes', 'n4'), n({ date: '2026-09-03' })));
    await assertSucceeds(setDoc(doc(allowed, 'notes', 'n5'), n({ date: null })));
    await assertFails(setDoc(doc(allowed, 'notes', 'n6'), n({ date: 20260903 })));
  });
});

// ---------- 備忘錄：只擋型別與大小，逐節的內容在前端 ----------

describe('R8b 備忘錄（validPlaybook，ADR-0067）', () => {
  const p = (over = {}) => stamped({
    title: '營養點滴',
    tag: '點滴',
    courseIds: ['course-iv-drip'],
    sections: [{ heading: '前情提醒', when: 'before', body: '飯後打針' }],
    pinned: false,
    ...over,
  });

  test('R8b.1 正常的一份寫得進去', async () => {
    await assertSucceeds(setDoc(doc(allowed, 'playbooks', 'pb1'), p()));
  });

  test('R8b.2 標題空的或太長被擋', async () => {
    await assertFails(setDoc(doc(allowed, 'playbooks', 'pb2'), p({ title: '' })));
    await assertFails(setDoc(doc(allowed, 'playbooks', 'pb3'), p({ title: '字'.repeat(41) })));
  });

  test('R8b.3 一節都沒有被擋 —— 打開是空的那一份沒有意義', async () => {
    await assertFails(setDoc(doc(allowed, 'playbooks', 'pb4'), p({ sections: [] })));
  });

  test('R8b.4 超過 20 節被擋', async () => {
    const many = Array.from({ length: 21 }, () => ({ heading: '', when: null, body: 'x' }));
    await assertFails(setDoc(doc(allowed, 'playbooks', 'pb5'), p({ sections: many })));
  });

  test('R8b.5 分類選填，null 也可以，但不能是數字', async () => {
    await assertSucceeds(setDoc(doc(allowed, 'playbooks', 'pb6'), p({ tag: null })));
    await assertFails(setDoc(doc(allowed, 'playbooks', 'pb7'), p({ tag: 5 })));
  });

  test('R8b.6 courseIds 必須是陣列 —— 掛錯型別會讓「自己浮出來」整段壞掉', async () => {
    await assertFails(setDoc(doc(allowed, 'playbooks', 'pb8'), p({ courseIds: 'course-x' })));
  });
});

// ---------- 本輪可用性：原文是最終依據 ----------

describe('R9 本輪可用性（validAvailability）', () => {
  const a = (over = {}) => stamped({
    rawText: '9/6 那星期不行', validFrom: '2026-09-01', validTo: '2026-09-30', rules: [], ...over,
  });
  const p = (id) => doc(allowed, 'customers', 'c1', 'availability', id);

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'customers', 'c1'), {
        name: '王小明', updatedAt: new Date(), deletedAt: null,
      });
    });
  });

  test('R9.1 原文空的被擋（SPEC 4.3：原文永遠比解析結果大）', async () => {
    await assertSucceeds(setDoc(p('av1'), a()));
    await assertFails(setDoc(p('av2'), a({ rawText: '' })));
  });

  test('R9.2 有效期倒著來被擋', async () => {
    await assertFails(setDoc(p('av3'), a({ validTo: '2026-08-01' })));
  });

  test('R9.3 collection group 讀得到（已刪除項目要跨客戶找）', async () => {
    await assertSucceeds(getDocs(collectionGroup(allowed, 'availability')));
  });
});

// ---------- 客戶自己填的表單：整份 Rules 唯一對外開的洞 ----------

describe('R10 表單邀請與回覆（唯一讓沒登入的人寫得進來的地方）', () => {
  const TOKEN = 'tok-abcdefghij1234567890';
  const future = () => new Date(Date.now() + 7 * 864e5);
  const past = () => new Date(Date.now() - 864e5);

  const seedInvite = (over = {}) => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'formInvites', TOKEN), {
      customerId: 'c1', customerName: '王小明', month: '2026-09',
      validFrom: '2026-09-01', validTo: '2026-09-30',
      expiresAt: future(), updatedAt: new Date(), deletedAt: null, ...over,
    });
  });

  // `submittedAt` 用 serverTimestamp()，跟 `data/publicForm.js` 真的送出去的一樣。
  // Rules 那邊比對的是 `d.submittedAt == request.time` —— 客戶端自己帶一個
  // `new Date()` 進來會被擋掉，那正是 R10.16 在測的事。
  const answer = (over = {}) => ({
    token: TOKEN, customerId: 'c1', customerName: '王小明', month: '2026-09',
    weekdays: [5], dates: ['2026-09-06'], freeText: '',
    submittedAt: serverTimestamp(), takenAt: null, deletedAt: null, ...over,
  });

  test('R10.1 拿得到 token 就讀得到那一份邀請（客戶在 LINE 點開）', async () => {
    await seedInvite();
    await assertSucceeds(getDoc(doc(anon, 'formInvites', TOKEN)));
  });

  test('R10.2 但列不出全部邀請 —— 那上面有客戶的名字', async () => {
    await seedInvite();
    await assertFails(getDocs(collection(anon, 'formInvites')));
    await assertSucceeds(getDocs(collection(allowed, 'formInvites')));
  });

  test('R10.3 沒登入的客戶送得出答案', async () => {
    await seedInvite();
    await assertSucceeds(setDoc(doc(anon, 'formResponses', TOKEN), answer()));
  });

  test('R10.4 只能填一次 —— 第二次送出是 update，客戶沒有那個權限', async () => {
    await seedInvite();
    await assertSucceeds(setDoc(doc(anon, 'formResponses', TOKEN), answer()));
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({ freeText: '改一下' })));
  });

  test('R10.5 邀請過期了就送不出來', async () => {
    await seedInvite({ expiresAt: past() });
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer()));
  });

  test('R10.6 邀請被刪掉了就送不出來', async () => {
    await seedInvite({ deletedAt: new Date() });
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer()));
  });

  test('R10.7 猜不到 token 就沒有邀請可以配（送不出來）', async () => {
    await assertFails(setDoc(doc(anon, 'formResponses', 'tok-guessed'), answer({ token: 'tok-guessed' })));
  });

  test('R10.8 customerId 與 month 拿邀請比對，不信任送過來的值', async () => {
    await seedInvite();
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({ customerId: 'c-someone-else' })));
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({ month: '2026-10' })));
  });

  test('R10.9 客戶不能自己把答案標成「已收下」', async () => {
    await seedInvite();
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({ takenAt: new Date() })));
  });

  test('R10.10 客戶不能自己把答案標成已刪除（那會讓收件匣看不到）', async () => {
    await seedInvite();
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({ deletedAt: new Date() })));
  });

  test('R10.11 塞不進多餘的欄位（hasOnly）', async () => {
    await seedInvite();
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({ isAdmin: true })));
  });

  test('R10.12 上限：weekdays 14 / dates 45 / freeText 500', async () => {
    await seedInvite();
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({
      dates: Array.from({ length: 46 }, (_, i) => `2026-09-${String((i % 30) + 1).padStart(2, '0')}`),
    })));
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({
      freeText: 'x'.repeat(501),
    })));
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({
      weekdays: Array.from({ length: 15 }, (_, i) => i),
    })));
  });

  test('R10.15 名字要是字串，而且有上限 —— 這裡是唯一沒登入也寫得進來的地方', async () => {
    await seedInvite();
    // 型別不對
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({
      customerName: { evil: true },
    })));
    // 超過上限（其餘欄位都有上限，這一個以前沒有）
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({
      customerName: '王'.repeat(101),
    })));
    // 正常長度照樣進得去
    await assertSucceeds(setDoc(doc(anon, 'formResponses', TOKEN), answer({
      customerName: '王小明',
    })));
  });

  test('R10.16 送出時間由伺服器決定 —— 客戶端自己指定的一律擋掉', async () => {
    await seedInvite();
    // 她要靠「什麼時候填的」判斷這一份是不是壓完表之後才回來的，
    // 所以那個時間不可以由填表的人決定。
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({
      submittedAt: new Date(Date.now() - 30 * 864e5),
    })));
    await assertFails(setDoc(doc(anon, 'formResponses', TOKEN), answer({
      submittedAt: new Date(Date.now() + 30 * 864e5),
    })));
  });

  test('R10.13 客戶列不出全部答案，她可以', async () => {
    await seedInvite();
    await assertFails(getDocs(collection(anon, 'formResponses')));
    await assertSucceeds(getDocs(collection(allowed, 'formResponses')));
  });

  test('R10.14 收下（takenAt）只有她做得到', async () => {
    await seedInvite();
    await setDoc(doc(anon, 'formResponses', TOKEN), answer());
    await assertFails(updateDoc(doc(anon, 'formResponses', TOKEN), { takenAt: new Date() }));
    await assertSucceeds(updateDoc(doc(allowed, 'formResponses', TOKEN), {
      takenAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
});

// ---------- 主檔 ----------

describe('R11 主檔（config）', () => {
  test('R11.1 白名單內讀寫得了，但刪不掉', async () => {
    await assertSucceeds(
      setDoc(doc(allowed, 'config', 'app', 'courses', 'course-x'), stamped({ name: '復能' })),
    );
    await assertFails(deleteDoc(doc(allowed, 'config', 'app', 'courses', 'course-x')));
  });

  test('R11.2 外人碰不到', async () => {
    await assertFails(getDocs(collection(stranger, 'config', 'app', 'courses')));
  });
});

// ---------- 這一份測試自己的完整性 ----------

describe('R12 白名單與 domain 對得上', () => {
  test('R12.1 ENTITLEMENT_TYPES 三種在 Rules 裡都通得過（見 R5.1）', async () => {
    const { ENTITLEMENT_TYPES } = await import('../../public/js/domain/entitlements.js');
    assert.deepEqual([...ENTITLEMENT_TYPES].sort(), ['pool', 'product', 'single']);
  });

  test('R12.2 VISIT_STATUSES 五種在 Rules 裡都通得過（見 R6.1）', async () => {
    const { VISIT_STATUSES } = await import('../../public/js/domain/visits.js');
    assert.deepEqual(
      [...VISIT_STATUSES].sort(),
      ['cancelled', 'confirmed', 'done', 'no_show', 'pending_confirm'],
    );
  });
});
