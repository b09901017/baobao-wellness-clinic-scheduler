// 「買過什麼」那一頁的算法。純函式。
//
// 她 2026-09-06：
//
// > 我希望在客戶詳情額度那邊，可以多一個看總攬看詳情之類的按鈕或甚麼的之類的?
// > 名子你幫我想，然後點進去可以顯示清單文字等等，看到他購買了甚麼方案
// > (如果有微調的話可以註記)+加購甚麼等等
//
// 那一頁叫**「買過什麼」**：她本來就這樣講，而且跟「今天做了什麼」是同一種
// 命名（這個 app 的頁名是白話問句，不是名詞）。不叫「購買紀錄」——
// 「紀錄」在這個專案已經有兩個意思（寫紀錄、稽核紀錄）。
//
// ## 它跟那一排額度卡是兩件事
//
//   額度卡    「還剩幾次」—— 會一直變，現算（ADR-0004）
//   這一頁    「當初買了什麼」—— 不會變，看的是購買當下的快照
//
// 所以這一頁**不畫剩餘次數**：兩個地方講同一件事，遲早有一邊落後。
//
// ## 一筆都不可以被丟掉
//
// 分組有三層退路（見 `groupKey()`）。舊資料與匯進來的那幾筆身上什麼都沒有，
// 它們歸到最後一組 —— 同 `domain/dayReview.js` 的 `STAGES`：
// 最後一段永遠收得下剩下的。

import { isProduct, countWord, timedLabel } from './entitlements.js';
import { fullNameOf } from './naming.js';
import { isValidDate, daysBetween, addDays } from './dates.js';

/**
 * 這一筆屬於哪一組。**三層退路**：
 *
 * 1. `purchaseId` —— 2026-09-06 之後建的都有，一次購買一個。**最準**：
 *    同一天買兩套一樣的方案分得開，改了購買日那一組也不會散開。
 * 2. `sourcePlanName` + `purchasedAt` —— 在那之前從方案展開的那幾筆。
 * 3. 只有 `purchasedAt` —— 在那之前的單項加購。
 *
 * 三個都沒有就回 `null`，由呼叫端收進最後一組。
 */
export function groupKey(e) {
  if (e?.purchaseId) return `id:${e.purchaseId}`;
  const plan = String(e?.sourcePlanName ?? '').trim();
  const at = String(e?.purchasedAt ?? '').trim();
  if (plan) return `plan:${plan}|${at}`;
  if (at) return `single:${at}`;
  return null;
}

/**
 * 這一筆跟方案本來寫的不一樣。
 *
 * `sourcePlanQty` 是購買當下的快照（`expandPlan()`），所以之後範本改了它也不會變。
 * 沒有那一欄的（單項加購、舊資料）一律不算微調 —— 它們本來就沒有「本來幾次」。
 */
export const isTweaked = (e) =>
  e?.sourcePlanQty != null && e.sourcePlanQty !== (e?.totalQty ?? 0);

/** 營養品那一段。一次購買一筆（ADR-0059），所以不分組。 */
export const productsOf = (entitlements = []) =>
  (entitlements ?? []).filter((e) => e && !e.deletedAt && isProduct(e));

/**
 * 改了購買日之後，那一組每一筆要寫回去什麼。
 *
 * **有到期日的跟著移同樣的天數**（她 2026-09-06 選的），不是重算月數 ——
 * 舊資料的到期日不見得是「購買日 + 整數個月」，重算會把她手填的日期改掉。
 * 沒有到期日的（2026-09-06 之後的預設）什麼都不動。
 *
 * @param {object[]} rows 那一組的那幾筆
 * @param {string} nextDate 改成哪一天
 * @returns {{id:string, changes:{purchasedAt:string, expiresAt?:string}}[]}
 */
export function dateChangePatch(rows = [], nextDate) {
  if (!isValidDate(nextDate)) return [];

  return (rows ?? []).map((e) => {
    const changes = { purchasedAt: nextDate };
    const from = e?.purchasedAt ?? null;
    if (isValidDate(e?.expiresAt) && isValidDate(from)) {
      changes.expiresAt = addDays(e.expiresAt, daysBetween(from, nextDate));
    }
    return { id: e.id, changes };
  });
}

/**
 * 按下去之前那一句話：這一下會改到什麼。
 *
 * 收起來的東西不能安靜地生效 —— 到期日跟著移這件事她沒有按過任何一顆鈕，
 * 所以要先講。
 *
 * @returns {string} 沒有東西要多講就回空字串
 */
export function describeDateChange(rows = [], nextDate) {
  const moved = dateChangePatch(rows, nextDate).filter((p) => p.changes.expiresAt);
  if (!moved.length) return '';
  return moved.length === 1
    ? `到期日跟著移到 ${moved[0].changes.expiresAt}`
    : `${moved.length} 筆的到期日也跟著移同樣的天數`;
}

// ---------------------------------------------------------------------------
// 一行「買了什麼」（`.scratch/asks-2026-09-13/issues/04`）
// ---------------------------------------------------------------------------
//
// 她 2026-09-13：
//
// > 我希望可以呈現像是"0723 顧客會 新8萬方案x2+12萬健檢+EECPx40+sis(60)x5+ILIB(60)x5等等
// > 就是那個小標題只要呈現日期，顧客會/H2U導客(等等) 方案(沒有的話就不用)，加購的，懂嗎?
//
// **這一行是算出來的，不存成一段字。** 存字的話她之後加購一次，抬頭就跟額度對不起來
// （同 ADR-0004「次數現算」的理由）。客戶清單的卡片與客戶詳情的抬頭讀同一支。
//
// ## 簡寫是第四種名字，而那是刻意的
//
// ADR-0078 說全站只有三種名字，而額度名是 `復能-SIS(60)`。她在這一行指名要簡寫：
// 「就寫sis(60)x5這個簡寫就好，我看得懂就不要寫太複雜」。所以擇一池拿掉課程那一半。
// 只有這一行與「買過什麼」讀 `shortItemName()`，見 ADR-0090。

/** 抬頭與「買過什麼」要不要列這一筆。營養品、系統配出來的二返、刪掉的都不列。 */
const listed = (e) => e && !e.deletedAt && !isProduct(e) && !e.followupForEntitlementId;

const planNameOf = (e) => String(e?.sourcePlanName ?? '').trim();

const sameSet = (a = [], b = []) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * 一筆額度在「買了什麼」那一行叫什麼。
 *
 * | 那一筆 | 簡寫 |
 * |---|---|
 * | 擇一池（一台） | 那一台的全名＋時長：`SIS(60)` |
 * | 擇一池（N 台） | `三選一(30)` |
 * | 營養點滴 | 品項：`雪顏亮彩` |
 * | 其他 | 額度名本身：`ILIB(60)`、`EECP`、`12萬健檢` |
 *
 * 主檔對不到（器材刪掉了、她自己改過名字）就退回額度名 —— 名字總比空白好，
 * 而編一個簡寫出來會讓她以為那是另一種東西。
 */
export function shortItemName(e, master = {}) {
  const label = String(e?.label ?? '').trim();

  if (e?.type === 'pool') {
    const ids = e.optionEquipmentIds ?? [];
    const options = ids
      .map((id) => (master.equipment ?? []).find((x) => x.id === id))
      .filter(Boolean);
    if (!options.length || options.length !== ids.length) return label;
    const what = options.length === 1 ? fullNameOf(options[0]) : `${countWord(options.length)}選一`;
    return timedLabel(what, e.durationMin) || label;
  }

  const course = (master.courses ?? []).find((c) => c.id === e?.courseId) ?? null;
  if (course?.requiresIvProduct) {
    const item = (master.ivProducts ?? []).find((p) => p.id === e.ivProductId)?.name;
    if (item) return item;
    const prefix = `${course.name} - `;
    if (label.startsWith(prefix)) return label.slice(prefix.length);
  }
  return label;
}

/**
 * 沒有套數快照（`sourcePlanSets`）的舊資料，**反推得出來才回**。
 *
 * 舊試算表當年就是用除法反推數量出事的（`docs/legacy/README.md` 第 1 節），所以
 * 這裡的判準是嚴的：找得到同名的範本、每一項都對得到、而且每一項除出來都是
 * 同一個正整數。差一項就回 `null` —— 呼叫端只寫方案名，不猜。
 *
 * 用 `sourcePlanQty`（範本 × 套數的快照）不用 `totalQty`：後者可能被微調過。
 */
export function setsOf(rows = [], plans = []) {
  if (!rows?.length) return null;
  const name = planNameOf(rows[0]);
  const plan = (plans ?? []).find((p) => !p.deletedAt && String(p.name ?? '').trim() === name);
  if (!plan) return null;

  let n = null;
  for (const r of rows) {
    const item = (plan.items ?? []).find((it) => String(it.label ?? '').trim() === String(r.label ?? '').trim())
      ?? (plan.items ?? []).find((it) => it.type === r.type && (r.type === 'pool'
        ? sameSet(it.optionEquipmentIds ?? [], r.optionEquipmentIds ?? [])
        : Boolean(it.courseId) && it.courseId === r.courseId));
    const base = Number(item?.qty);
    const got = Number(r.sourcePlanQty ?? r.totalQty);
    if (!item || !base || !Number.isFinite(got)) return null;
    const k = got / base;
    if (!Number.isInteger(k) || k <= 0 || (n != null && k !== n)) return null;
    n = k;
  }
  return n;
}

/** `2026-07-23` → `0723`。客戶抬頭與「買過什麼」那一張的日期都是這種寫法。 */
export const purchaseDayLabel = (date) => (isValidDate(date) ? `${date.slice(5, 7)}${date.slice(8, 10)}` : '');

const byDate = (a, b) => {
  const x = isValidDate(a?.purchasedAt) ? a.purchasedAt : '9999-99-99';
  const y = isValidDate(b?.purchasedAt) ? b.purchasedAt : '9999-99-99';
  return x < y ? -1 : x > y ? 1 : 0;
};

const times = (name, n) => (n === 1 ? name : `${name}x${n}`);

/**
 * 那幾筆的項目段：`新8萬方案x2+12萬健檢+EECPx40`。**方案在前、加購在後**，各自照購買日。
 *
 * - 方案：同一個購買 id 一組，套數用快照，沒有快照走 `setsOf()`。同一個方案買兩次就加起來；
 *   有一組反推不出來，那一組就只寫方案名（不猜）
 * - 加購：同一個簡寫的加起來，1 次不寫 x1
 */
function itemsLine(rows, master) {
  const parts = [];

  const groups = new Map();
  for (const r of [...rows].filter(planNameOf).sort(byDate)) {
    const key = groupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const plans = new Map();
  for (const g of groups.values()) {
    const name = planNameOf(g[0]);
    const sets = Number.isInteger(g[0].sourcePlanSets) && g[0].sourcePlanSets > 0
      ? g[0].sourcePlanSets
      : setsOf(g, master.plans ?? []);
    if (!plans.has(name)) plans.set(name, { known: 0, unknown: 0 });
    if (sets) plans.get(name).known += sets;
    else plans.get(name).unknown += 1;
  }
  for (const [name, { known, unknown }] of plans) {
    if (known) parts.push(times(name, known));
    for (let i = 0; i < unknown; i += 1) parts.push(name);
  }

  const extras = new Map();
  for (const r of [...rows].filter((x) => !planNameOf(x)).sort(byDate)) {
    const name = shortItemName(r, master);
    if (!name) continue;
    extras.set(name, (extras.get(name) ?? 0) + (Number(r.totalQty) || 0));
  }
  for (const [name, n] of extras) parts.push(n > 0 ? times(name, n) : name);

  return parts.join('+');
}

/**
 * 客戶清單卡片與客戶詳情抬頭那一行：`0723 顧客會 新8萬方案x2+12萬健檢+EECPx40`。
 *
 * - **日期**是方案那一次的購買日；沒有方案就是最早那一筆的
 * - **通路**是客戶的購買通路（`customer.source`）
 * - **不分日期**：9/1 又加購的照樣接在同一串後面（她 2026-09-13：「在抬頭那邊不用這樣寫」）
 *
 * 三段各自可以缺，缺了不留空格。**一筆都沒有就回空字串** —— 畫面整行不畫，
 * 不要為了一個通路名留一行。
 *
 * @param {object} customer
 * @param {object[]} entitlements 那一位的全部額度
 * @param {{plans?:object[], equipment?:object[], courses?:object[], ivProducts?:object[]}} master
 */
export function purchaseHeadline(customer, entitlements = [], master = {}) {
  const rows = (entitlements ?? []).filter(listed);
  if (!rows.length) return '';

  const anchor = rows.filter(planNameOf).length ? rows.filter(planNameOf) : rows;
  const date = purchaseDayLabel([...anchor].sort(byDate)[0]?.purchasedAt);
  const source = String(customer?.source ?? '').trim();
  return [date, source, itemsLine(rows, master)].filter(Boolean).join(' ');
}

/**
 * 「買過什麼」那一頁：**一天一張**（她 2026-09-13：「在買了甚麼那邊可以照你建議的這樣分」）。
 *
 * 以前是一次購買（`purchaseId`）一張，而建新客戶時每一筆加購各自一個購買 id，
 * 同一天會冒出好幾張。現在照購買日分：抬頭是那一天的摘要（跟抬頭同一支，不帶通路），
 * 有微調才列「本來 N → 現在 M」。
 *
 * 配出來的二返**在那一天的 `rows` 裡**（改日期要跟著移），但不進摘要。
 * 沒有購買日的收在最後一張（`unknown`）—— 一筆都不丟。
 *
 * @returns {{key:string, date:string|null, summary:string,
 *            tweaks:{name:string, from:number, to:number}[], rows:object[], unknown:boolean}[]}
 */
export function purchaseDays(entitlements = [], master = {}) {
  const days = new Map();
  const orphans = [];
  for (const e of entitlements ?? []) {
    if (!e || e.deletedAt || isProduct(e)) continue;
    if (!isValidDate(e.purchasedAt)) {
      orphans.push(e);
      continue;
    }
    if (!days.has(e.purchasedAt)) days.set(e.purchasedAt, []);
    days.get(e.purchasedAt).push(e);
  }

  const card = (key, date, rows, unknown) => ({
    key,
    date,
    summary: itemsLine(rows.filter(listed), master),
    tweaks: rows.filter(isTweaked).map((r) => ({
      name: shortItemName(r, master), from: r.sourcePlanQty, to: r.totalQty ?? 0,
    })),
    rows,
    unknown,
  });

  const out = [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, rows]) => card(`day:${date}`, date, rows, false));
  if (orphans.length) out.push(card('unknown', null, orphans, true));
  return out;
}
