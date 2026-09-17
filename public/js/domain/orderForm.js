// 拍顧客會訂購單 → 新增客戶／加購到既有客戶（issue 09，ADR-0099）。純函式。
//
// 她 2026-09-17：「拍完後，然後可以先辨識出是誰，甚麼時候的顧客會，買了什麼方案，加購什麼，
// 欠尾款多少，然後點擊小鉛筆的icon可以微調」「尾款寫成紅色備註就夠…各項金額不用記」。
//
// **AI 只抄字**（`functions/transcripts/orderForm.js`），這一支把字翻成新增客戶那張表的草稿
// （`ui/components/customerForm.js` 的 `blankDraft()` 同一個形狀）。怎麼讀一次購買，
// repo 裡舊表那一側已經寫過一次，**這裡重用，不另寫一套**：
//
// | 單子上 | 讀法 |
// |---|---|
// | 手寫列 `任選(30)`、`SIS 60分`、`ILIB 30` | `photoPlan.js` 的 `shapeOf()`（裡面是舊表的 `rowShape()`） |
// | 便利貼、OB 專員備註 | `flagsFromText()`／`partnersFromText()`／`marksFrom()`（「尾款」紅色） |
// | 印好的「8萬筋骨強身」 | 去掉價格字頭比方案範本的名字；**對不上就空著**，不猜 |
//
// **這一支有沒有任何一行，讓 AI 決定這位客人買的是哪一個方案？** 沒有：抄字格式裡沒有 id，
// 方案是名稱比對，客戶是她點過才算數（04 考試名字只對 9/16）。
//
// 各項金額與總計不讀（她 9/17），尾款只變成一則紅色備註。電話不抄（spec「暫定」）。

import { isValidDate } from './dates.js';
import { autoLabel, durationChoicesOf, poolCourseOf, tieredLabel, validateEntitlement } from './entitlements.js';
import { followupCourseIdOf } from './followups.js';
import { PURCHASE_CHANNELS, flagsFromText, marksFrom, partnersFromText, rowShape } from './legacyImport.js';
import { contraindicationHints } from './contraindications.js';
import { shapeOf } from './photoPlan.js';
import { readMarks, toCustomerFields } from './customerMarks.js';
import { partnersOf } from './customers.js';

/** 訂購單就是顧客會那一條通路（舊表 B2 的寫法，`purchaseHeadline()` 讀它）。 */
export const ORDER_FORM_CHANNEL = PURCHASE_CHANNELS[0];

const live = (rows) => (rows ?? []).filter((r) => r && !r.deletedAt);
const clean = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const squash = (s) => clean(s).replace(/\s+/g, '');

// ---------- 數字 ----------

const CN_DIGITS = Object.freeze({ 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 });

/**
 * 數量那一格：`1`、`一`、`—`（一劃）、`x15`、`2套`。
 * **讀不出來回 null**（考試時手寫的 2 抄成過「T」）—— 那一格空著讓她填，不是當成 1。
 */
export function readQuantity(text) {
  const s = clean(text).replace(/^[x×✕*]\s*/i, '');
  if (!s) return null;
  if (/^[—–\-ー]$/.test(s)) return 1;
  if (CN_DIGITS[s]) return CN_DIGITS[s];
  const m = s.match(/^(\d+)\s*(?:套|組|堂|次)?$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 金額：`8萬`、`80000,-`、`12.9万`、`3W`。**空白是 0**（「尚欠尾款」那一格沒寫就是沒欠）；
 * 寫了字但讀不出來回 null —— 那不是 0。
 */
export function readAmount(text) {
  const s = clean(text).replace(/^(?:尚欠)?尾款\s*/, '').replace(/[,，\s]/g, '').replace(/[-=—]+$/, '');
  if (!s) return 0;
  const m = s.match(/^(?:NT\$?|\$)?(\d+(?:\.\d+)?)(萬|万|w)?元?$/i);
  return m ? Math.round(Number(m[1]) * (m[2] ? 10000 : 1)) : null;
}

// ---------- 日期 ----------

/** 表頭印的「2026年08月」→ `{ year, month }`。民國年（`115年8月`）也認。 */
export function formMonthOf(text) {
  const nums = clean(text).match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  let year = Number(nums[0]);
  const month = Number(nums[1]);
  if (year > 100 && year < 200) year += 1911;
  return year >= 2000 && month >= 1 && month <= 12 ? { year, month } : null;
}

/** 手寫的 `8/27`、`0827`、`8月27日`、`115/8/27` → `{ month, day }`。 */
function monthDayOf(text) {
  const s = clean(text);
  const four = s.match(/^(\d{2})(\d{2})$/);
  const nums = four ? [four[1], four[2]] : (s.match(/\d+/g) ?? []);
  if (nums.length < 2) return null;
  const [m, d] = nums.length >= 3 ? [nums[1], nums[2]] : [nums[0], nums[1]];
  return { month: Number(m), day: Number(d) };
}

/**
 * 購買日。**表頭月份前後一個月內的手寫日期才採用**，不然空著 ——
 * 手寫日期沒有年份，而一張八月的訂購單上寫的「3/2」多半是別的事（下次回診、生日）。
 * 表頭沒有年月就不猜年份。
 */
export function purchaseDateOf(formMonth, handwrittenDates = []) {
  const head = formMonthOf(formMonth);
  if (!head) return null;
  const at = head.year * 12 + (head.month - 1);
  for (const raw of handwrittenDates ?? []) {
    const md = monthDayOf(raw);
    if (!md || md.month < 1 || md.month > 12) continue;
    for (const year of [head.year - 1, head.year, head.year + 1]) {
      if (Math.abs(year * 12 + (md.month - 1) - at) > 1) continue;
      const iso = `${year}-${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}`;
      if (isValidDate(iso)) return iso;
    }
  }
  return null;
}

// ---------- 方案 ----------

/**
 * 印好的套組名稱 → 方案範本。去掉價格字頭（`8萬筋骨強身` → `筋骨強身`）比名字，
 * 名字本身帶數字的（`8萬方案`）先比整串。**對不上回 null**，不找「最像的」。
 */
export function planForPrinted(printedName, plans = []) {
  const usable = live(plans).filter((p) => p.active !== false);
  const full = squash(printedName);
  if (!full) return null;
  const bare = full.replace(/^(?:NT\$?)?\d+(?:\.\d+)?(?:萬|万|w)?/i, '');
  const candidates = [...new Set([full, bare, bare.replace(/方案$/, '')])].filter(Boolean);
  for (const name of candidates) {
    const hit = usable.find((p) => squash(p.name) === name);
    if (hit) return hit;
  }
  return null;
}

/** 印好的「功醫健檢」那一列：它不是方案，勾選格（`checkupTicked`）才是那一筆健檢。 */
const isCheckupRow = (printedName) => /健檢/.test(clean(printedName));

// ---------- 加購 ----------

/**
 * 一筆加購的草稿 —— `ui/components/buy.js` 的 `blank()` 那個形狀（額度的形狀）。
 * domain 不 import 畫面，所以欄位列在這裡；`buy.payload()` 只讀它認得的那幾格。
 */
function extraDraft(fields) {
  return {
    type: 'single', label: '', totalQty: 1, durationMin: null, courseId: null, optionEquipmentIds: [],
    frequencyRule: null, expiresAt: null, tier: null, tierOther: false, ivProductId: null,
    productId: null, items: [], amountTwd: null, newProduct: false, newProductName: '',
    ...fields,
  };
}

/**
 * 考試抄錯過的兩種字（2026-09-17，ADR-0100「考試結果」）：`ILIB` 抄成 `TLIB`、`任選` 抄成 `代選`。
 * **只收看過的**：多收一個就多一種把別的東西讀成課程的機會。
 */
const MISREADS = [
  [/^[Tt1l]LIB/, 'ILIB'],
  [/代選/, '任選'],
];

/**
 * 手寫加上去的一列 → 一筆加購的草稿。認不出來回 null（確認卡上留原字那一列讓她選或拿掉）。
 *
 * 數量可以寫在「數量」那一格，也可以寫在字裡（`代選(30)x15`、`EECP 40堂`）；
 * 時長可以寫在括號裡（`任選(30)`）或後面（`SIS 60分`、`ILIB 30`）。
 * 光禿禿的一個數字（`SIS 60`、`EECP 40`）是時長還是次數，**看那個課程分不分時長**。
 */
export function extraFromRow(row, master = {}) {
  let text = clean(row?.text);
  for (const [re, to] of MISREADS) text = text.replace(re, to);
  let qty = readQuantity(row?.quantity);

  const tail = text.match(/^(.+?)\s*(?:[x×✕*]\s*(\d+)|(\d+)\s*[堂次])$/i);
  if (tail) {
    text = tail[1];
    qty ??= Number(tail[2] ?? tail[3]);
  }

  let minutes = null;
  const unit = text.match(/^(.+?)\s*(\d+)\s*(?:mins?|分鐘?)$/i);
  if (unit) {
    text = unit[1];
    minutes = Number(unit[2]);
  }

  let shape = shapeOf(text, minutes, master);
  minutes ??= rowShape(text)?.durationMin ?? null;

  if (!shape) {
    const bare = text.match(/^(.+?)\s+(\d+)$/);
    if (bare) {
      const n = Number(bare[2]);
      const asMinutes = shapeOf(bare[1], n, master);
      if (asMinutes && choicesOf(asMinutes, master).includes(n)) {
        shape = asMinutes;
        minutes = n;
      } else {
        shape = shapeOf(bare[1], null, master);
        if (shape) qty ??= n;
      }
    }
  }
  if (!shape) return null;

  const draft = extraDraft({
    type: shape.type,
    totalQty: qty,
    courseId: shape.type === 'single' ? shape.courseId : null,
    optionEquipmentIds: shape.type === 'pool' ? shape.optionEquipmentIds : [],
    // 分時長的課程才記（ILIB、擇一池）；EECP 那種寫了也不記，跟加購那一排一樣
    durationMin: choicesOf(shape, master).length ? minutes : null,
  });
  draft.label = autoLabel(draft, master);
  // 存得下去才算認得出來：營養點滴沒寫品項、次數讀不出來，都交給她選
  return draft.label && !validateEntitlement(draft, master).length ? draft : null;
}

/** 這一種分哪幾種時長。擇一池看「復能」那個課程，單一課程看自己。 */
function choicesOf(shape, master) {
  const course = shape.type === 'pool'
    ? poolCourseOf(master)
    : live(master.courses).find((c) => c.id === shape.courseId);
  return durationChoicesOf(course);
}

/** 「功醫健檢」勾的那一格（`12萬`）→ 一筆帶金額等級的健檢（ADR-0054）。二返在寫入那一層配。 */
function checkupFromTick(tick, master) {
  const course = live(master.courses).find((c) => followupCourseIdOf(c));
  if (!course) return null;
  const amount = readAmount(tick);
  const tier = amount ? `${amount / 10000}萬` : clean(tick) || null;
  const draft = extraDraft({ type: 'single', courseId: course.id, tier, totalQty: 1, label: tieredLabel(tier, course.name) });
  // 同手寫列：存得下去才算（等級那一格太長時 Rules 會擋）
  return validateEntitlement(draft, master).length ? null : draft;
}

// ---------- 一張訂購單 → 一位客戶的草稿 ----------

/** 純符號（✓、○、—）不是一句話，不進備註。 */
const hasWords = (s) => /[\p{L}\p{N}]/u.test(s);

/**
 * @param {object} transcript `orderForm` 的抄字（好幾張照片的話先 `mergeTranscripts()`）
 * @param {{plans, courses, equipment, ivProducts, products, clinicalFlags, partners}} master
 *   `clinicalFlags` 與 `partners` 是主檔的列（有 `name`），不是名字陣列
 * @returns {{draft: object, seen: object, unresolved: {kind: string, text: string, quantity?: string}[],
 *            hints: object[], unreadable: string[]}}
 *   `draft` 是新增客戶那張表的草稿；`seen` 是畫面上「照片上寫的是」要印的原字；
 *   `unresolved` 是認不出來、要她選或拿掉的那幾項
 */
export function orderDraftFrom(transcript = {}, master = {}) {
  const t = transcript ?? {};
  const unresolved = [];
  const extras = [];
  const seen = { name: clean(t.customerName), formMonth: clean(t.formMonth), dates: '', plan: '', quantity: '', unpaid: '' };

  // 方案：第一個對得上的算數，同一個方案再出現就加套數（兩張照片併成一位時）
  let plan = null;
  let quantity = 1;
  let quantityUnread = false;
  const planTexts = [];
  const qtyTexts = [];
  for (const pkg of t.packages ?? []) {
    const name = clean(pkg?.printedName);
    if (!name) continue;
    if (isCheckupRow(name)) {
      // 勾選格沒勾、數量那一格卻寫了 → 講出來讓她選，不猜是幾萬的
      if (!(t.checkupTicked ?? []).some((x) => clean(x))) {
        unresolved.push({ kind: 'extra', text: name, quantity: clean(pkg.quantity) });
      }
      continue;
    }
    const hit = planForPrinted(name, master.plans);
    const n = readQuantity(pkg.quantity);
    if (!hit || (plan && hit.id !== plan.id)) {
      // 對不上、或是第二個不一樣的方案（一次只建一個，另一個建好之後到客戶詳情加購）
      unresolved.push({ kind: 'plan', text: name, quantity: clean(pkg.quantity) });
      continue;
    }
    planTexts.push(name);
    qtyTexts.push(clean(pkg.quantity));
    if (n == null) quantityUnread = true;
    quantity = plan ? quantity + (n ?? 0) : (n ?? 0);
    plan = hit;
  }
  if (plan && quantityUnread) unresolved.push({ kind: 'quantity', text: qtyTexts.join('、') });
  seen.plan = planTexts.join('、');
  seen.quantity = qtyTexts.join('、');

  for (const tick of t.checkupTicked ?? []) {
    if (!clean(tick)) continue;
    const x = checkupFromTick(tick, master);
    if (x) extras.push({ ...x, seen: clean(tick) });
    else unresolved.push({ kind: 'extra', text: `健檢 ${clean(tick)}` });
  }

  for (const row of t.handwrittenRows ?? []) {
    const text = clean(row?.text);
    if (!text) continue;
    const quantityText = clean(row?.quantity);
    const x = extraFromRow(row, master);
    const said = [text, quantityText && `×${quantityText}`].filter(Boolean).join(' ');
    if (x) extras.push({ ...x, seen: said });
    else unresolved.push({ kind: 'extra', text, quantity: quantityText });
  }

  // 尾款：0 或空白 → 什麼都不做；其餘一則紅色（讀不出來的也寫，原字照抄）
  const unpaidTexts = [t.unpaid].flat().map(clean).filter(Boolean);
  const owed = unpaidTexts.filter((u) => readAmount(u) !== 0);
  // 原字連「0」一起印：「沒欠」旁邊看得到她寫的是 0，才對得過照片
  seen.unpaid = unpaidTexts.join('、');

  const notes = [clean(t.obNote), ...(t.stickyNotes ?? []).map(clean), ...(t.packages ?? []).map((p) => clean(p?.noteText))]
    .filter((s) => s && hasWords(s));
  const marks = dedupeMarks([
    ...owed.map((u) => ({ text: `尾款 ${u.replace(/^(?:尚欠)?尾款\s*/, '')}`, color: 'red' })),
    ...marksFrom(notes),
  ]);

  const dates = (t.handwrittenDates ?? []).map(clean).filter(Boolean);
  seen.dates = dates.join('、');

  return {
    draft: {
      name: seen.name,
      phone: '',
      lineId: '',
      source: ORDER_FORM_CHANNEL,
      purchasedAt: purchaseDateOf(t.formMonth, dates),
      priority: 0,
      flags: flagsFromText(notes, master.clinicalFlags ?? []),
      partners: partnersFromText(notes, master.partners ?? []),
      marks,
      planId: plan?.id ?? null,
      // 讀不出來就空著（她按鉛筆填），不是 0 —— 0 在那張表上是「不展開方案」
      quantity: plan && quantityUnread ? '' : quantity,
      extras,
    },
    seen,
    unresolved,
    hints: contraindicationHints(notes.map((text) => ({ where: '訂購單', text })), master.equipment ?? []),
    unreadable: (t.unreadable ?? []).map(clean).filter(Boolean),
  };
}

/** 同一句話只留一則（`validateMarks()` 擋重複）。 */
function dedupeMarks(marks) {
  const seenText = new Set();
  return marks.filter((m) => {
    if (seenText.has(m.text)) return false;
    seenText.add(m.text);
    return true;
  });
}

// ---------- 一次好幾張照片 ----------

/**
 * 好幾張照片的抄字接成一份（**購買合併**）：兩張寫同一個名字的訂購單是同一位的兩次購買，
 * 便利貼特寫那一張只有便利貼。一格一格接起來，不去重 —— 同一個方案兩張就是兩套，
 * 確認卡上兩個原字（「1、1」）都看得到。
 */
export function mergeTranscripts(list = []) {
  const all = (list ?? []).filter(Boolean);
  const first = (key) => all.map((t) => clean(t[key])).find(Boolean) ?? '';
  const cat = (key) => all.flatMap((t) => t[key] ?? []);
  return {
    readable: all.some((t) => t.readable !== false),
    unreadable: cat('unreadable'),
    customerName: first('customerName'),
    formMonth: first('formMonth'),
    handwrittenDates: cat('handwrittenDates'),
    packages: cat('packages'),
    checkupTicked: cat('checkupTicked'),
    handwrittenRows: cat('handwrittenRows'),
    unpaid: all.map((t) => t.unpaid).filter((u) => clean(u)),
    obNote: all.map((t) => clean(t.obNote)).filter(Boolean).join('\n'),
    stickyNotes: cat('stickyNotes'),
  };
}

/**
 * 好幾張照片分給幾位（spec「暫定」，她沒回答到）：
 *
 * - 認得出名字的每張一位；**名字一樣的併成一位**（不管隔了幾張）
 * - 認不出名字的那張（便利貼特寫）**掛在前一張那一位身上**，標 `attached`，她點一下拆開
 * - 第一張就認不出名字 → 自己一位，名字空著
 *
 * @param {{url: string, transcript: object}[]} photos 照拍的順序
 * @returns {{key: string, name: string, photos: {url: string, transcript: object, attached: boolean}[]}[]}
 */
export function groupOrderForms(photos = []) {
  const groups = [];
  let last = null;
  for (const [i, p] of (photos ?? []).entries()) {
    const name = clean(p?.transcript?.customerName);
    const photo = { url: p.url, transcript: p.transcript, attached: false };
    let group = name ? groups.find((g) => g.name === name) : null;
    if (!name && last) {
      photo.attached = true;
      group = last;
    }
    if (!group) {
      group = { key: `g${i}`, name, photos: [] };
      groups.push(group);
    }
    group.photos.push(photo);
    last = group;
  }
  return groups;
}

/** 拆開：掛上去的那一張自己變成一位（名字空著），排在原本那一位後面。 */
export function detachPhoto(groups = [], key, url) {
  const at = groups.findIndex((g) => g.key === key);
  const group = groups[at];
  const photo = group?.photos.find((p) => p.url === url);
  if (!photo || group.photos.length < 2) return groups;
  const rest = { ...group, photos: group.photos.filter((p) => p !== photo) };
  const alone = { key: `${key}-${group.photos.indexOf(photo)}`, name: '', photos: [{ ...photo, attached: false }] };
  return [...groups.slice(0, at), rest, alone, ...groups.slice(at + 1)];
}

// ---------- 確認卡 ----------

/** 既有客戶裡同名的那幾位（停用的也算 —— 回來加購的常常是很久沒來的人）。 */
export function sameNameCustomers(name, existing = []) {
  const want = clean(name);
  return want ? live(existing).filter((c) => clean(c.name) === want) : [];
}

/** 「幾套」那一格填好了沒（0 是合法的：有人只買加購）。 */
const quantityFilled = (q) => String(q ?? '').trim() !== '' && Number.isInteger(Number(q)) && Number(q) >= 0;

/**
 * 「建立」為什麼還按不下去。空陣列就是按得下去。
 *
 * - **名字一定要她點過**（考試 9/16）：沒有同名的點「名字對」，有同名的兩顆**都不預選**
 * - 方案選了、幾套讀不出來 → 要她填
 * - 認不出來的每一項要她選或拿掉 —— 安靜地少建一筆，比按不下去糟
 *
 * @param {{draft: object, unresolved: object[], nameOk: boolean, who: string|null}} card
 */
export function blockersOf(card, existing = []) {
  const out = [];
  const { draft } = card;
  const same = sameNameCustomers(draft.name, existing);
  if (!clean(draft.name)) out.push('認不出名字：按鉛筆補上');
  else if (same.length && !(card.who === 'new' || same.some((c) => c.id === card.who))) {
    out.push(`已經有 ${same.length} 位「${clean(draft.name)}」：選加購到那一位，或新增一位`);
  } else if (!same.length && !card.nameOk) out.push('名字要對過照片：點「名字對」');
  if (draft.planId && !quantityFilled(draft.quantity)) out.push('「幾套」讀不出來：按鉛筆補上');
  // 「幾套」那一項上一行講過了，不算兩次
  const open = card.unresolved.filter((u) => u.kind !== 'quantity');
  if (open.length) out.push(`還有 ${open.length} 項認不出來：選一個或拿掉`);
  return out;
}

/** 加購到哪一位。`null` 就是新增一位。 */
export function addOnTarget(card, existing = []) {
  if (!card.who || card.who === 'new') return null;
  return sameNameCustomers(card.draft.name, existing).find((c) => c.id === card.who) ?? null;
}

/**
 * 加購到既有客戶時，那一位身上要跟著改的：備註接在後面（同一句不重複）、警示與合作機構併進去。
 * **既有的一個都不拿掉**。沒有要改的回 null。
 */
export function addOnChanges(customer, draft) {
  const changes = {};
  const marks = readMarks(customer);
  const more = (draft.marks ?? []).filter((m) => m?.text && !marks.some((x) => x.text === m.text));
  if (more.length) Object.assign(changes, toCustomerFields([...marks, ...more]));
  const flags = union(customer.flags ?? [], draft.flags ?? []);
  if (flags.length !== (customer.flags ?? []).length) changes.flags = flags;
  const partners = union(partnersOf(customer), draft.partners ?? []);
  if (partners.length !== partnersOf(customer).length) changes.partners = partners;
  return Object.keys(changes).length ? changes : null;
}

const union = (a, b) => [...new Set([...a, ...b].map((x) => String(x).trim()).filter(Boolean))];

/**
 * 全部處理完的那一行摘要。**講得出是哪一位沒建**（「王小明 沒建立」）。
 * @param {{draft: {name: string}, state: string}[]} cards
 */
export function summaryOf(cards = []) {
  const done = cards.filter((c) => c.state === 'done');
  const failed = cards.filter((c) => c.state === 'failed');
  // 按了建立、還沒回來的：它會建好，不是「沒按建立」（離開前問的那一句不可以把它算進去）
  const saving = cards.filter((c) => c.state === 'saving');
  const left = cards.length - done.length - failed.length - saving.length;
  const nameOf = (c) => clean(c.draft?.name) || '認不出名字的那一位';
  const parts = [];
  if (done.length) parts.push(`建好了 ${done.length} 位`);
  if (saving.length) parts.push(`${saving.map(nameOf).join('、')} 正在建立`);
  if (failed.length) parts.push(`${failed.map(nameOf).join('、')} 沒建立`);
  if (left) parts.push(`還有 ${left} 位沒按建立`);
  return {
    done: done.length, failed: failed.length, saving: saving.length, left, line: parts.join('；') || '一位都還沒建',
  };
}
