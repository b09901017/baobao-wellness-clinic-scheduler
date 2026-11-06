// 隨手記。SPEC 第 8.1 節。純函式。
//
// 客人臨時提出的零碎小要求：指定某位治療師、下次記得帶健保卡、幫我問問看能不能約週六。
// 這些沒有死線，也不是來訪產生的，所以它不是任務 —— 見 CONTEXT.md 兩者的分界。
//
// 刻意做得很薄：一行字、一個勾、選填掛在誰身上、選填掛一個日期。
// 它要能在三秒內記完，多一個**必填**欄位就會變成「算了我等一下再記」，
// 然後就忘了 —— 所以後面那兩個永遠是選填的。
//
// ## 掛了日期就上日曆
//
// 有日期的那幾筆會出現在日曆上（`views/calendar.js` 的「待辦」那一類），
// 勾掉了畫成刪除線。**日曆上那一類就是這個集合，不是另一份資料** ——
// 「也必須要同步到隨手記那邊」最可靠的作法是根本沒有第二份。
// 見 docs/adr/0044-a-dated-note-goes-on-the-calendar.md。
//
// 日期**不是死線**。任務要有死線且由來訪產生（CONTEXT.md），
// 隨手記的日期是「我想在這一天處理」——過了也不會變紅字。

import { isValidDate } from './dates.js';

const trimmed = (v) => String(v ?? '').trim();

/** 一筆隨手記最多多長。超過的通常是應該寫進客戶備註的東西。 */
export const MAX_LENGTH = 200;

/**
 * 存檔前的檢查。
 *
 * @returns {{errors: string[]}}
 */
export function validateNote(note) {
  const errors = [];
  const text = trimmed(note?.text);

  if (!text) errors.push('要寫點東西');
  if (text.length > MAX_LENGTH) {
    errors.push(`太長了（${text.length} 字，最多 ${MAX_LENGTH} 字）。這種份量寫進客戶備註比較找得到`);
  }

  // customerId 有填就要連名字一起帶 —— 清單頁不會為了一行字再去讀一次客戶
  if (note?.customerId && !trimmed(note?.customerName)) {
    errors.push('掛了客戶卻沒有名字');
  }

  // 日期是選填的，但填了就要是真的日期。**過去的日期不擋** ——
  // 她會補記昨天那一件。
  const date = trimmed(note?.date);
  if (date && !isValidDate(date)) errors.push('日期看不懂');

  // 營養品的提醒不連進一組（ADR-0179）：勾它要先問「給了哪幾款」、交付記回那一包（ADR-0059），
  // 一起勾的那幾天沒有人問過 —— 交付紀錄就少了。
  if (trimmed(note?.linkId) && trimmed(note?.entitlementId)) {
    errors.push('營養品的提醒不能跟別天連在一起');
  }

  return { errors };
}

/** 這筆還算不算數。 */
export function isLive(note) {
  return Boolean(note) && !note.deletedAt;
}

export function isOpen(note) {
  return isLive(note) && !note.done;
}

/**
 * 排序：沒勾的在上面，勾掉的沉到最下面。
 *
 * 勾掉的不馬上消失，因為她會勾錯 —— 看得到才點得回來。
 *
 * ## 兩組問的不是同一個問題（2026-09-05）
 *
 * 她的原話：
 *
 * > 已完成我希望由上到下的排序是我剛勾掉到我更之前勾掉的排序，
 * > 就是最上面的應該是我剛勾掉的
 *
 * 所以**沒勾的照 `createdAt`**（「我剛記了什麼」，她記的順序就是她想到的
 * 順序），**勾掉的照 `doneAt`**（「我剛做完什麼」）。兩組都用 `createdAt`
 * 的話，一件三天前記、今天才處理掉的事會排在一件今天記今天勾掉的下面。
 *
 * 這不是一條新規矩，是隨手記去對齊任務那幾頁既有的那一條：`data/tasks.js`
 * 的 `listDone()` 早就是 `doneAt desc`（SPEC 第 8.1 節）。
 *
 * **`doneAt` 讀不出來就退回 `createdAt`，不要退回空字串。** 空字串在
 * 由新到舊的排序裡會沉到最底，於是舊資料（匯入的那一批 `doneAt: null`、
 * 手動改過的）會全部黏在最下面**而且彼此之間沒有順序**。
 */
export function sortNotes(notes) {
  const when = (n) => (n.done ? (n.doneAt || n.createdAt) : n.createdAt);
  return [...(notes ?? [])].filter(isLive).sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    return String(when(b) ?? '').localeCompare(String(when(a) ?? ''));
  });
}

/**
 * 依客戶分組。客戶詳情頁與待辦的「依客戶」看法都用這個。
 *
 * 沒掛客戶的收在 null 這一組，不要丟掉 —— 那些通常是最容易忘的雜事。
 *
 * @returns {{customerId: string|null, customerName: string, notes: object[]}[]}
 */
export function groupByCustomer(notes) {
  const groups = new Map();

  for (const note of sortNotes(notes)) {
    const key = note.customerId ?? null;
    if (!groups.has(key)) {
      groups.set(key, {
        customerId: key,
        customerName: key ? (note.customerName ?? '（沒有名字）') : '沒掛客戶',
        notes: [],
      });
    }
    groups.get(key).notes.push(note);
  }

  return [...groups.values()].sort((a, b) => {
    // 沒掛客戶的排最後
    if (!a.customerId !== !b.customerId) return a.customerId ? -1 : 1;
    return String(a.customerName).localeCompare(String(b.customerName), 'zh-TW');
  });
}

/**
 * 有日期、而且落在這段期間裡的。日曆用。
 *
 * **含已經勾掉的** —— 日曆上勾掉的要畫成刪除線，不是消失。
 * 日期舊的在前，同一天照建立時間。
 */
export function datedIn(notes = [], from, to) {
  return notes
    .filter((n) => isLive(n) && n.date && n.date >= from && n.date <= to)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))
      || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}

/** 某位客戶身上還沒處理掉的。客戶詳情頁用。 */
export function openFor(notes, customerId) {
  return sortNotes(notes).filter((n) => n.customerId === customerId && !n.done);
}

/**
 * 這位客戶身上有沒有一筆一模一樣、還沒勾掉的隨手記。
 *
 * 「跟客人確認時間」那張卡片上打的「禮拜一再問問」會同時落進隨手記
 *（`.scratch/asks-2026-08-25/issues/05`），而那個輸入框每按一次「記」就寫一次
 * —— 她改了字又改回來、或者按兩下，都不該長出第二筆。
 *
 * 比的是**還沒勾掉的**：勾掉的那一筆代表那件事處理完了，同一句話再出現一次
 * 是真的又要做一次。
 *
 * @returns {object|null} 找到的那一筆
 */
export function sameOpenNote(notes = [], { customerId = null, text = '' } = {}) {
  const want = trimmed(text);
  if (!want) return null;

  return (notes ?? []).find(
    (n) => isOpen(n)
      && (n.customerId ?? null) === (customerId ?? null)
      && trimmed(n.text) === want,
  ) ?? null;
}

/**
 * 首頁那一列要顯示的數字：還沒勾掉的有幾**列**。
 *
 * 連在一起的一組算 1（ADR-0179）：清單上它就是一列，數字跟看到的對得上。
 */
export function openCount(notes) {
  return groupLinked((notes ?? []).filter(isOpen)).length;
}

// ---------- 連在一起的隨手記（ADR-0179） ----------
//
// 「複製到別天」預設連在一起：**每一天一筆真的文件**（日曆、逾期／今天／明天照 `date` 查，一行都不用改），
// 同一組共用一個 `linkId`（最初那一筆的 id）。連在一起＝**同一個 `linkId`、還活著的兩筆以上** ——
// 刪掉、還原、復原都不清 `linkId`，只剩一筆時它自然就不算連在一起了，還原回來又自然連回去。
//
// 哪幾種一起變（spec 那張表）：勾掉／拿回來、改字、改掛給誰 → 同一組每一筆；改日期、刪掉 → 只這一筆；
// 拆開這一天 → 這一筆的 `linkId` 清掉。**照真的變了什麼，不是照帶了哪些鍵** —— 日曆編輯器每次存都帶字、日期、
// 掛給誰，照鍵算的話只改日期那一下另外那幾天各多一則什麼都沒變的稽核。
//
// `linkId` 這個名字 Kotlin（Android 小工具）照抄 —— 改名要兩邊一起改。

/** 同一組裡一起變的那幾格。日期、`linkId` 不在裡面（只動這一筆）。 */
const SHARED_KEYS = ['text', 'customerId', 'customerName', 'done'];

/**
 * 同一組其他還活著的那幾筆（不含自己）。**判斷「連在一起」只有這一支。**
 *
 * @param {object} note
 * @param {object[]} notes 手上那一份（寫的那一刻要是照 `linkId` 重讀的那一份 —— 畫面手上的都只是一部分）
 */
export function linkedPeers(note, notes) {
  const linkId = trimmed(note?.linkId);
  if (!linkId) return [];
  return (notes ?? []).filter((n) => isLive(n) && n.id !== note.id && trimmed(n.linkId) === linkId);
}

export function isLinked(note, notes) {
  return linkedPeers(note, notes).length > 0;
}

/** 兩個值算不算一樣（null、undefined、空字串都算「沒有」）。 */
const blankToNull = (v) => (v === undefined || v === '' ? null : v);
const sameValue = (a, b) => blankToNull(a) === blankToNull(b);

/**
 * 改一筆連在一起的隨手記，每一筆要寫什麼。
 *
 * @param {object} before 這一筆存之前（重讀的那一份）
 * @param {object} patch  要改的那幾欄（`normalizePatch()` 的結果；勾掉時連 `doneAt`）
 * @param {object[]} peers 同一組其他還活著的那幾筆（`linkedPeers()`，重讀的那一份）
 * @returns {{id: string, changes: object}[]} 真的有變的那幾筆，這一筆在第一個；一筆都沒變回空陣列
 */
export function linkedChanges(before, patch = {}, peers = []) {
  const has = (key) => Object.prototype.hasOwnProperty.call(patch ?? {}, key);

  // 這一筆自己：帶到的而且跟存之前不一樣的
  const own = {};
  for (const key of ['text', 'date', 'linkId']) {
    if (has(key) && !sameValue(before?.[key], patch[key])) own[key] = patch[key];
  }
  const customerMoved = (has('customerId') || has('customerName'))
    && (!sameValue(before?.customerId, patch.customerId) || !sameValue(before?.customerName, patch.customerName));
  if (customerMoved) {
    own.customerId = patch.customerId ?? null;
    own.customerName = patch.customerName ?? null;
  }
  const doneMoved = has('done') && Boolean(before?.done) !== Boolean(patch.done);
  if (doneMoved) {
    own.done = Boolean(patch.done);
    if (has('doneAt')) own.doneAt = patch.doneAt;
  }

  const writes = Object.keys(own).length ? [{ id: before.id, changes: { ...own } }] : [];

  // 同一組要跟著變的。**勾不勾是她明說的那一個值，不是「變了才算」**：手上那一份舊了（這一筆其實已經勾了）、
  // 或一組勾得不一樣（離線、還原帶回來的）時，按下去要讓同一組每一筆都變成她按的那個樣子 ——
  // 照「這一筆變了沒」算的話，這一筆沒變、另外那幾天就一筆都不動
  const shared = Object.fromEntries(Object.entries(own).filter(([k]) => SHARED_KEYS.includes(k)));
  if (has('done')) {
    shared.done = Boolean(patch.done);
    if (has('doneAt')) shared.doneAt = patch.doneAt;
  }
  if (!Object.keys(shared).length) return writes;

  for (const peer of peers ?? []) {
    const changes = {};
    if ('text' in shared && !sameValue(peer.text, shared.text)) changes.text = shared.text;
    if ('customerId' in shared
      && (!sameValue(peer.customerId, shared.customerId) || !sameValue(peer.customerName, shared.customerName))) {
      changes.customerId = shared.customerId;
      changes.customerName = shared.customerName;
    }
    if ('done' in shared && Boolean(peer.done) !== shared.done) {
      changes.done = shared.done;
      if ('doneAt' in shared) changes.doneAt = shared.doneAt;
    }
    if (Object.keys(changes).length) writes.push({ id: peer.id, changes });
  }
  return writes;
}

/**
 * 複製到別天要寫哪幾筆。
 *
 * - 帶過去的：文字、掛給誰；一律是還沒勾的；`entitlementId` 不帶
 * - **營養品的提醒不給複製**（`blocked`）
 * - 連在一起：`linkId` 沿用它的；還沒有就用它自己的 id（重試、重按都還是同一個 → 冪等）。
 *   同一組那一天已經有一筆（還活著的）就不再建 —— 第二次按、失敗重按都不多一份
 * - 它自己那一天、重複的、看不懂的日期不建
 *
 * 用哪一個 `linkId`：
 *   - 還沒勾、已經在一組裡 → 沿用它的
 *   - 還沒勾、還沒有 → 它自己的 id（原本那一筆補上）；**它拆開過**（`linkId` 清了，但它的 id 還是舊那一組的 `linkId`）
 *     → `newLinkId`（呼叫端給一個新的 id）—— 用它的 id 會連回舊那一組
 *   - **已經勾掉了、自己沒有 `linkId`** → 新的那幾筆用**它的 id**，它自己不寫 `linkId`（段三審查 R3）：新的那幾筆是還沒勾的，
 *     拉它進來就是一組勾得不一樣，所以它不在那一組裡（`linkedPeers()` 問的是它自己的 `linkId`）；
 *     但下一次照它的 id 重讀讀得到上一次複製出去的那幾天 → 圈起來、不再建（按兩次不多一份）。
 *     它的 id 那一組裡**有勾掉的**（拆開過的舊組、或上一次那幾筆也勾了）→ `newLinkId`，新的那幾筆不跟勾掉的連在一起
 *   - 已經勾掉了、自己在一組裡 → `newLinkId`（不冪等：再複製一次同一天會多一份，ADR-0179 寫了）
 *
 * @param {object} note 要複製的那一筆（重讀的那一份）
 * @param {string[]} dates 她在小月曆上點的那幾天
 * @param {{linked?: boolean, group?: object[], newLinkId?: string}} o
 *   group：照 `linkId`（沒有就照它的 id）重讀的那一組（**含已刪除的**，`linkId` 撞不撞要連刪掉的一起看）
 * @returns {{blocked: string|null, linkId: string|null, link: {id: string, changes: object}|null,
 *            creates: object[], skipped: string[], taken: string[], together: number, sourceIn: boolean}}
 *   taken：同一組已經有的那幾天（不含它自己那一天；小月曆圈起來的）；together：寫完之後那一組活著的有幾筆（沒連在一起是 0）；
 *   sourceIn：它自己在不在那一組裡
 */
export function copyPlan(note, dates = [], { linked = true, group = [], newLinkId = null } = {}) {
  const empty = {
    linkId: null, link: null, creates: [], skipped: [], taken: [], together: 0, sourceIn: false,
  };
  if (trimmed(note?.entitlementId)) {
    return { ...empty, blocked: '營養品的提醒不給複製 —— 要約別天給，到客戶詳情的「營養品」那一段約時間' };
  }

  const wanted = [...new Set((dates ?? []).map(trimmed))]
    .filter((d) => d && isValidDate(d) && d !== trimmed(note?.date))
    .sort();

  const others = (group ?? []).filter((n) => n.id !== note.id);
  const own = trimmed(note?.linkId);
  const byMyId = others.filter((n) => trimmed(n.linkId) === note.id);
  let linkId = null;
  let link = null;
  if (linked) {
    if (note?.done) {
      linkId = own || byMyId.some((n) => isLive(n) && n.done) ? (newLinkId || note.id) : note.id;
    } else if (own) {
      linkId = own;
    } else {
      linkId = byMyId.length ? (newLinkId || note.id) : note.id;
    }
    if (!note?.done && own !== linkId) link = { id: note.id, changes: { linkId } };
  }
  const sourceIn = linked && !note?.done;

  // 同一組那幾天已經有一筆了（含它自己）—— 只看還活著的
  const members = linked
    ? [...(sourceIn ? [note] : []), ...others.filter((n) => trimmed(n.linkId) === linkId)].filter(isLive)
    : [];
  const taken = new Set(members.map((n) => trimmed(n.date)).filter(Boolean));

  const creates = [];
  const skipped = [];
  for (const date of wanted) {
    if (taken.has(date)) {
      skipped.push(date);
      continue;
    }
    creates.push(normalize({
      text: note.text,
      customerId: note.customerId,
      customerName: note.customerName,
      date,
      done: false,
      linkId,
    }));
  }

  return {
    blocked: null,
    linkId,
    link,
    creates,
    skipped,
    taken: [...taken].filter((d) => d !== trimmed(note?.date)).sort(),
    together: linked ? members.length + creates.length : 0,
    sourceIn,
  };
}

/**
 * 複製完的那一句（段三審查 R3）：照**真的連起來的**講 —— 連在一起的那一組只有一筆（從勾掉的那一筆只複製到一天）時
 * 不講「其他天一起勾」；它自己不在那一組裡（已經勾掉了）時講「新的那幾天連在一起」。
 *
 * @param {{created: number, linked: boolean, together: number, sourceIn: boolean}} r `copyTo()` 回的
 */
export function copiedSay({ created = 0, linked = false, together = 0, sourceIn = false } = {}) {
  if (!created) return '那幾天已經有了，沒有多建';
  const base = `複製到 ${created} 天`;
  if (!linked || together < 2) return base;
  return sourceIn ? `${base}：勾一天，其他天一起勾` : `${base}：新的那幾天連在一起`;
}

/**
 * 一組裡代表那一列的是哪一天：今天或之後最早的；全部過了是最後一天；沒有日期的不當代表
 * （一筆日期都沒有時照 `sortNotes()` 的第一筆）。
 */
function representativeOf(members, today) {
  const dated = members.filter((n) => n.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))
      || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  if (!dated.length) return sortNotes(members)[0];
  const next = dated.find((n) => !today || n.date >= today);
  if (next) return next;
  const lastDate = dated[dated.length - 1].date;
  return dated.find((n) => n.date === lastDate);
}

/**
 * 清單類一組一列（首頁那張卡、`#/todo/notes`、客戶詳情；小工具也照這一支）。
 * **日曆、逾期／今天／明天不走這一支** —— 那幾頁照日子看，每一天各一列。
 *
 * - 鑰匙是 `linkId` ＋ 勾了沒：勾得不一樣的一組（離線、還原帶回來的）分成兩列，一筆都不藏（資料健檢會列出來）
 * - 沒有 `linkId` 的、只剩一筆的照舊一筆一列
 * - 順序照 `sortNotes()`，一組用代表的那一筆排
 *
 * @param {object[]} notes
 * @param {string} [today]
 * @returns {{note: object, members: object[], days: string[]}[]}
 *   note：代表的那一筆（點、長按、日期那一顆都用它）；members：這一列代表的每一筆（照日期）；
 *   days：不同的日子（沒日期的不算一天、同一天兩筆算一天）
 */
export function groupLinked(notes, today) {
  const buckets = new Map();
  for (const n of (notes ?? []).filter(isLive)) {
    const linkId = trimmed(n.linkId);
    const key = linkId ? `link:${linkId}:${n.done ? 1 : 0}` : `id:${n.id}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n);
  }

  const rows = [...buckets.values()].map((members) => {
    const ordered = [...members].sort((a, b) => String(a.date ?? '￿').localeCompare(String(b.date ?? '￿'))
      || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
    return {
      note: representativeOf(ordered, today),
      members: ordered,
      days: [...new Set(ordered.map((n) => n.date).filter(Boolean))],
    };
  });

  const order = new Map(sortNotes(rows.map((r) => r.note)).map((n, i) => [n.id, i]));
  return rows.sort((a, b) => order.get(a.note.id) - order.get(b.note.id));
}

/**
 * 連在一起的一組「會作用在幾天」：**選單、改文字與掛給誰那兩張卡、日曆編輯器那一行、存完與勾掉的 toast、清單那一顆
 * 只有這一種算法**（段三審查 R2：以前四種算法，同一組講出 2、3 兩種數字）。
 *
 * 兩天以上講天（不同的日子；沒日期的不算一天、同一天兩筆算一天）；連在一起但只剩一天（改日期改到撞、拿掉了日期）講筆。
 *
 * @param {object} note
 * @param {object[]} peers 同一組其他還活著的那幾筆（`linkedPeers()`；寫的那一刻是重讀的那一組）
 * @returns {{days: number, notes: number, count: number, unit: '天'|'筆', label: string}|null} 沒連在一起是 null
 */
export function linkedReach(note, peers = []) {
  if (!note || !(peers ?? []).length) return null;
  const members = [note, ...peers];
  const days = new Set(members.map((n) => n?.date).filter(Boolean)).size;
  const unit = days >= 2 ? '天' : '筆';
  const count = unit === '天' ? days : members.length;
  return { days, notes: members.length, count, unit, label: `共 ${count} ${unit}` };
}

/**
 * `linkedReach()` 講成每一個地方的那一句。沒連在一起（null）每一句都是空的。
 *
 * @param {ReturnType<typeof linkedReach>} reach
 */
export function linkedWords(reach) {
  if (!reach) return { tick: null, change: null, date: null, card: '', toast: '', hint: '' };
  const n = `${reach.count} ${reach.unit}`;
  return {
    tick: `${n}一起`,
    change: `${n}一起改`,
    date: `只改這一${reach.unit}`,
    card: `${reach.label}會一起改`,
    toast: `（${reach.label}）`,
    hint: `連在一起：${reach.label}的字與掛給誰會一起改，日期只動這一筆。`,
  };
}

/**
 * 一列旁邊那一顆：兩天以上「共 N 天」；連在一起但只剩一天（改日期改到撞、拿掉了日期）「共 N 筆」；一筆的沒有。
 * 算法是 `linkedReach()`（長按那一列時每一句講的跟這一顆一樣）。
 *
 * @param {{members: object[], days: string[]}} row `groupLinked()` 的一列
 * @returns {string|null}
 */
export function linkedBadge(row) {
  const [first, ...rest] = row?.members ?? [];
  return linkedReach(first, rest)?.label ?? null;
}

// ---------- 長按的快捷選單 ----------

/**
 * 長按一筆隨手記，快捷選單上有哪幾顆（ADR-0060）。
 *
 * **五個入口共用一份**：待辦首頁那張卡、`#/todo/notes`、客戶詳情、
 * 日曆的抽屜／日／週。在待辦中心長按有「改日期」、在日曆長按沒有 ——
 * 那不是兩個畫面，是同一個畫面壞了一半（`ui/components/note.js` 的檔頭）。
 *
 * **最多五顆**（加上選單自己的「先不要」剛好六顆，`openActions()` 的上限）。
 * 所以分兩組：
 *
 *   - 一般的隨手記：勾掉／改日期／掛給誰／改文字／複製到別天
 *   - **營養品的提醒**（掛了 `entitlementId`，`domain/products.js`）：
 *     勾掉那一顆會先問「給了哪些」，所以不再塞「給營養品」——
 *     它已經是一包了。多給一顆「看那一包」通到客戶詳情。**不給複製**（ADR-0179）。
 *
 * ## 2026-11-06 重排（她：「收成『改日期』比較直觀」，ADR-0179）
 *
 * 加「複製到別天」之後放不下，所以日期那幾顆（改成今天／改哪一天／拿掉日期）收成一顆「**改日期**」，
 * 點了一張卡再選（`dateChoices()`）；連在一起的「拆開這一天」收在「複製到別天」那張卡的最上面。
 * 以前已勾掉那幾筆的「刪掉」也放不下了 —— 刪掉還有隨手記那一頁的垃圾桶、「清掉這 N 筆」、日曆編輯器的「刪掉」。
 *
 * 連在一起的底下那一行小字講出會作用在幾天：勾「N 天一起」、改日期「只改這一天」、
 * 掛給誰與改文字「N 天一起改」（她看到一樣東西、按下去就作用在那一樣東西 —— 作用在別天的要講出來）。
 * 數字與單位只問 `linkedReach()`（只剩一天時講筆：「2 筆一起」「只改這一筆」）。
 *
 * @param {object} note
 * @param {{reach?: ReturnType<typeof linkedReach>}} [o] 這一組作用在幾天（呼叫端照重讀的那一組算；沒連在一起是 null）
 * @returns {{id:string, label:string, note?:string, icon?:string, tone?:string}[]}
 */
export function noteActions(note, { reach = null } = {}) {
  const out = [];
  const product = Boolean(note?.entitlementId);
  const words = linkedWords(product ? null : reach);
  const together = words.tick;

  if (note?.done) {
    out.push({ id: 'untick', label: '拿回來，還沒做', note: together ?? undefined, icon: 'todo' });
  } else {
    out.push({
      id: 'tick',
      label: '做完了，勾掉',
      // 營養品的提醒勾掉之前會先問「給了哪些」（`prepareToggle()`）——
      // 講出來，不然她會以為按下去就直接勾掉了。
      note: product ? '會先問給了哪幾款' : (together ?? undefined),
      icon: 'check',
      tone: 'primary',
    });
  }

  // 有沒有日期都叫「改日期」（她的字）。現在是哪一天寫在底下那一行小字；連在一起的講「只改這一天」。
  out.push({
    id: 'date',
    label: '改日期',
    note: words.date ?? (note?.date ?? undefined),
    icon: 'calendar',
  });

  // 營養品的提醒到這裡就收尾。它已經是一包了，不再塞「給營養品」——
  // 多的那一顆通到客戶詳情看整包（金額、哪幾款、給了哪些）。
  if (product) {
    out.push({ id: 'bag', label: '看那一包營養品', icon: 'box' });
    return out;
  }

  out.push({
    id: 'who',
    label: note?.customerId ? '改掛給誰' : '掛給誰',
    note: together ? words.change : (note?.customerName ?? undefined),
    icon: 'people',
  });

  // 「改文字」補上的是 ADR-0044 Consequences 記著的那個缺口：在這之前
  // 隨手記除了勾掉之外只有日曆上那一張編輯器改得動。
  out.push({ id: 'edit', label: '改文字', note: together ? words.change : undefined, icon: 'pencil' });

  // 小月曆一次點好幾天，預設連在一起（ADR-0179）。連在一起的「拆開這一天」在那張卡的最上面。
  out.push({ id: 'copy', label: '複製到別天', icon: 'copy' });

  return out;
}

/**
 * 「改日期」那張卡上有哪幾個選項（她 11/6：「改成今天 改成某天 改成拿掉日期」）。
 *
 * - 改成今天：已經是今天、已經勾掉的不給（替一件做完的事改到今天沒有意義 —— 以前同一條）
 * - 改成某天：永遠在
 * - 拿掉日期：有日期才給；日曆上講成「從日曆拿掉」（那才是她看得到的後果）；營養品的提醒不給（以前同一條）
 *
 * @param {object} note
 * @param {{today: string, onCalendar?: boolean}} o
 * @returns {{id: 'today'|'pick'|'undate', label: string, note?: string}[]}
 */
export function dateChoices(note, { today, onCalendar = false } = {}) {
  const out = [];
  if (!note?.done && note?.date !== today) out.push({ id: 'today', label: '改成今天' });
  out.push({ id: 'pick', label: '改成某天' });
  if (note?.date && !note?.entitlementId) {
    out.push({
      id: 'undate',
      label: onCalendar ? '從日曆拿掉' : '拿掉日期',
      note: '這一筆會留在隨手記裡',
    });
  }
  return out;
}

/**
 * 送進 data 層之前把形狀整理好。**吃的是一份完整的隨手記**，
 * 沒帶到的欄位一律算成「空的」。新增走這一支，改一筆請走 `normalizePatch()`。
 *
 * 沒掛客戶時兩個欄位一起清成 null，不要留一個空字串 ——
 * 「掛了一位叫空字串的客戶」跟「沒掛客戶」在查詢上是兩件事。
 */
export function normalize(note) {
  const customerId = trimmed(note?.customerId) || null;
  return {
    text: trimmed(note?.text),
    customerId,
    customerName: customerId ? trimmed(note?.customerName) : null,
    // 沒有日期就是 null，不要留空字串 —— 日曆是用
    // `where('date', '>=', ...)` 撈的，空字串會被撈進來而 null 不會。
    date: trimmed(note?.date) || null,
    done: Boolean(note?.done),
    // 這一筆講的是哪一包營養品（`domain/products.js`）。一般的隨手記沒有這個，
    // 所以是 null。**`normalizePatch()` 刻意不碰它** —— 待辦編輯器只問
    // 「記什麼」與「哪一天」，帶不到它，而少帶就等於清空。
    entitlementId: trimmed(note?.entitlementId) || null,
    // 連在一起的那一組共用的字串（ADR-0179）。一般的隨手記是 null，跟 `entitlementId` 一樣。
    // **`normalizePatch()` 只在有帶到時碰它** —— 改字、改日期不可以把一筆拆出來。
    linkId: trimmed(note?.linkId) || null,
  };
}

/**
 * 改一筆的時候用。**只整理有帶到的那幾個欄位。**
 *
 * `normalize()` 吃的是一份完整的隨手記，所以少帶一個欄位就等於把它清空。
 * 而 `update(id, changes)` 收的天生是一份「只有變了的那幾欄」：日曆上那個
 * 待辦編輯器只問「記什麼」與「哪一天」，於是 2026-08-25 以前**改一件已經
 * 勾掉的待辦會把它變回沒做**（`done` 沒帶到 → 算成 false），而 `doneAt`
 * 還留著上次勾掉的時間，兩個欄位從此對不起來。
 *
 * 那不是有人忘了帶一個欄位，是「完整的文件」與「只有變了的那幾欄」用了
 * 同一支函式。所以這一支只碰 `changes` 裡真的出現過的鍵。
 *
 * @param {object} changes 只有要改的那幾個欄位
 */
export function normalizePatch(changes = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(changes ?? {}, key);
  const out = {};

  if (has('text')) out.text = trimmed(changes.text);
  if (has('date')) out.date = trimmed(changes.date) || null;
  if (has('done')) out.done = Boolean(changes.done);
  // 只有複製（補上）與拆開（清掉）會帶它（ADR-0179）
  if (has('linkId')) out.linkId = trimmed(changes.linkId) || null;

  // 兩個欄位是一組的：掛了人就要有名字，沒掛人兩個一起清成 null。
  // 只帶其中一個過來時，另一個要跟著算出來，不能留著上一版的值。
  if (has('customerId') || has('customerName')) {
    const customerId = trimmed(changes.customerId) || null;
    out.customerId = customerId;
    out.customerName = customerId ? trimmed(changes.customerName) : null;
  }

  return out;
}
