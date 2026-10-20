// 客戶詳情的備註那一段：電話、LINE、長備註、短備註一起排順序（ADR-0156）。純函式。
//
// ## 長備註是備註的長版本，不是第四種東西
//
// 一則＝標題＋一大塊字（上限跟備忘錄同一級）。**存在客戶身上**（`customer.longNotes`）——
// 備份、稽核、刪客戶、改名全部自動跟著，不用新開集合、不用開 Rules 的洞。
// ADR-0067 擋的是「綁客戶的東西第四種」，這不是：它就是備註，只是長。
//
// ## `marks` 一個字都不改形狀
//
// 二十幾處讀 `customer.marks`（壓表卡片牆、客戶清單卡片、試算表的 `customer.notes` 鏡像、
// 拍訂購單的「尾款」、合併檔匯入…）。它們照舊只看到短備註 —— **長備註不進試算表、
// 不上壓表卡片牆**。所以順序另外存一份（`customer.noteOrder`），短備註在裡面只佔位置：
// 第 n 個 `'mark'` ＝ `readMarks(customer)` 的第 n 則。別的入口加一則短備註（只會接在最後）
// 不會壞 —— 沒有位置的接在最後；順序裡指到不存在的東西就跳過。
//
// **拖過順序之後短備註本身也照新的先後重排**（形狀不變、只有先後；她 2026-10-19 同意）：
// 第 n 個佔位要指到第 n 則，換位置就是換陣列裡的先後。卡片牆上的前三則會跟著變。
//
// ## 電話、LINE、病歷號只是位置
//
// 值照舊是 `customer.phone`／`customer.lineId`／`customer.chartNo`（在編輯客戶的表單裡改），沒填就不畫、不佔位。
// **病歷號是 2026-10-19 加的**（ADR-0160）：以前是一則「病歷號 1234」短備註，現在是一格 ——
// 她：「她一樣在備註阿，只是多了個icon」，所以它照樣在這一串裡。舊的那一則由 `chartNoMove()` 搬進來。
// **`lineId` 存的是她 LINE 好友清單上看到的名字**，不是 ID 也不是網址（ADR-0157，推翻 ADR-0156 的
// 「點了開加好友那一頁」）：點了交給手機上的 MacroDroid 去 LINE 搜尋那個名字（`integrations/lineMacro.js`）。
//
// **讀這一串只有 `noteItems()` 一支**，畫面不自己拼。

import { readMarks, toCustomerFields, normalizeMark } from './customerMarks.js';
import { nameHas } from './customers.js';
import { normalizeAlias } from './masterData.js';
import { chartNoInMark, normalizeChartNo, sameChartNo } from './identify.js';

/** 標題與內文上限：跟備忘錄同一級（`domain/playbook.js` 的 `MAX_TITLE`／`MAX_BODY`）。 */
export const MAX_LONG_TITLE = 40;
export const MAX_LONG_BODY = 5000;

/**
 * 一位客戶最多幾則長備註。Firestore 一份文件 1MB，一則最長 5000 字（中文一字 3 bytes）——
 * 20 則塞滿也只有 300KB，客戶文件上其他的東西都很小。
 */
export const MAX_LONG_NOTES = 20;

/**
 * 順序（`noteOrder`）最多幾格 —— `firestore.rules` 擋的就是這個數字（`tests/customer-notes.test.js` 盯著）。
 * 正常最多是電話＋LINE＋病歷號＋12 則短的＋20 則長的＝35；多留幾格給舊表匯入沒截掉的短備註
 * （`legacyImport.js` 超過 12 則只提醒）與拍訂購單接在後面的「尾款」。
 */
export const MAX_NOTE_ORDER = 40;

const trimmed = (v) => String(v ?? '').trim();

/** 這位客戶的長備註。形狀不對的、沒有 id 的丟掉（id 是順序裡認它的唯一方法）。 */
export function readLongNotes(customer) {
  const list = Array.isArray(customer?.longNotes) ? customer.longNotes : [];
  return list
    .filter((n) => n && typeof n === 'object' && trimmed(n.id))
    .map((n) => ({ id: trimmed(n.id), title: trimmed(n.title), body: String(n.body ?? '') }));
}

/** 新的一則的 id。只要在同一位客戶身上不重複就好。 */
export function newLongNoteId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `ln${Date.now().toString(36)}${rand}`;
}

/** 內文第一行有字的那一行（丸子與卡片副標用）。 */
export function firstLine(body) {
  return String(body ?? '').split('\n').map((s) => s.trim()).find(Boolean) ?? '';
}

/** 抬頭那個數字：短備註＋長備註。電話、LINE、病歷號不算（那是聯絡方式與號碼，不是她記的事）。 */
export function sectionCount(customer) {
  return readMarks(customer).length + readLongNotes(customer).length;
}

// ---------------------------------------------------------------------------
// 電話與 LINE
// ---------------------------------------------------------------------------

/**
 * 撥號連結。她有時候一格寫兩支（「0912… / 02…」）—— 撥第一支，畫面上照樣印整格。
 * 一個號碼都認不出來（「請打給女兒」）回 null：照樣畫那一顆，只是點了不撥。
 */
export function telHref(phone) {
  const hit = String(phone ?? '').match(/\+?\d[\d\s\-().]*\d/);
  if (!hit) return null;
  const digits = hit[0].replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 3) return null;
  return `tel:${digits}`;
}

/**
 * 編輯客戶那一格 LINE 名字旁邊的 `?`（新增客戶與編輯兩張表共用）。
 *
 * 手機上的 MacroDroid 拿這幾個字去 LINE 的搜尋框找人、點「一模一樣」的那一個 ——
 * 少一個字、多一個空白都找不到，所以這一句講的是「照抄」。
 */
export const LINE_HINT = '打你 LINE 好友清單上看到的名字，一個字都不能差：'
  + '手機會拿它去 LINE 搜尋、打開他的對話。';

/** 病歷號那一格的 `?`（新增客戶與編輯兩張表共用，ADR-0160）。 */
export const CHART_NO_HINT = '醫院系統的編號。拍 Abovee、療程單時拿它跟名字一起核對是誰；它會出現在備註那一段。';

// ---------------------------------------------------------------------------
// 那一串
// ---------------------------------------------------------------------------

/**
 * 備註那一串，照她排的順序。
 *
 * 每一項：
 * - `{ key: 'phone', kind: 'phone', text, href }`
 * - `{ key: 'line', kind: 'line', text }`（`text` 是她 LINE 上的那個名字；沒有連結，點了做什麼是畫面的事）
 * - `{ key: 'chartNo', kind: 'chartNo', text }`（她打的原字）
 * - `{ key: 'long:<id>', kind: 'long', note }`
 * - `{ key: 'mark:<n>', kind: 'mark', index, mark }`（`n` 是 `readMarks()` 裡的位置）
 *
 * 沒排過（沒有 `noteOrder`）：病歷號、LINE、長備註、短備註、**電話最後**（她 2026-10-20：「病歷號最前面，然後有line的line第二個，
 * 然後電話是在最後面」，ADR-0163 —— 推翻 10/18 的「最上面一行電話」）。排過的照她排的；不在順序裡的病歷號／LINE 放最前面
 *（排的時候還沒填），長備註、短備註接在後面（別的入口加的 —— 拍訂購單的「尾款」），**電話照樣在整串的最後**。
 */
export function noteItems(customer) {
  const marks = readMarks(customer);
  const longs = readLongNotes(customer);
  const phone = trimmed(customer?.phone);
  const line = trimmed(customer?.lineId);
  const chartNo = trimmed(customer?.chartNo);

  const phoneItem = phone ? { key: 'phone', kind: 'phone', text: phone, href: telHref(phone) } : null;
  const lineItem = line ? { key: 'line', kind: 'line', text: line } : null;
  const chartItem = chartNo ? { key: 'chartNo', kind: 'chartNo', text: chartNo } : null;
  const longItem = (n) => ({ key: `long:${n.id}`, kind: 'long', note: n });
  const markItem = (mark, index) => ({ key: `mark:${index}`, kind: 'mark', index, mark });

  const order = Array.isArray(customer?.noteOrder) ? customer.noteOrder : null;
  if (!order) {
    return [chartItem, lineItem, ...longs.map(longItem), ...marks.map(markItem), phoneItem].filter(Boolean);
  }

  const out = [];
  const placed = new Set();
  let nextMark = 0;
  const put = (item) => {
    if (!item || placed.has(item.key)) return;
    placed.add(item.key);
    out.push(item);
  };

  for (const token of order) {
    if (typeof token !== 'string') continue;
    if (token === 'phone') put(phoneItem);
    else if (token === 'line') put(lineItem);
    else if (token === 'chartNo') put(chartItem);
    else if (token === 'mark') {
      if (nextMark < marks.length) put(markItem(marks[nextMark], nextMark));
      nextMark += 1;
    } else if (token.startsWith('long:')) {
      const n = longs.find((x) => x.id === token.slice(5));
      if (n) put(longItem(n));
    }
  }

  const front = [chartItem, lineItem].filter((it) => it && !placed.has(it.key));
  const tail = [
    ...longs.map(longItem).filter((it) => !placed.has(it.key)),
    ...marks.map(markItem).filter((it) => !placed.has(it.key)),
    ...[phoneItem].filter((it) => it && !placed.has(it.key)),
  ];
  return [...front, ...out, ...tail];
}

/** 一項在順序裡寫成什麼。 */
const tokenOf = (it) => (it.kind === 'long' ? `long:${it.note.id}` : it.kind);

/**
 * 整串存回去：`{ marks, notes, longNotes, noteOrder }`，**同一個 commit 一起寫**。
 *
 * 短備註照它們在這一串裡的先後重排（第 n 個佔位要指到第 n 則）；`marks` 與 `notes` 走
 * `toCustomerFields()`（永遠一起寫，ADR-0019）。電話、LINE、病歷號只寫位置。
 *
 * @param {object[]} items 照新順序的那一串（`noteItems()` 的形狀；編輯器加的新項目照同一個形狀）
 */
export function notesFields(items = []) {
  const list = (items ?? []).filter(Boolean);
  const marks = list.filter((it) => it.kind === 'mark').map((it) => normalizeMark(it.mark));
  const longNotes = list.filter((it) => it.kind === 'long')
    .map(({ note }) => ({ id: note.id, title: trimmed(note.title), body: String(note.body ?? '') }));
  return {
    ...toCustomerFields(marks),
    longNotes,
    noteOrder: list.map(tokenOf),
  };
}

/**
 * 還寫成短備註的病歷號（「病歷號 1234」，舊的說法「姓名欄的編號：」也算）→ 病歷號那一格（ADR-0160）。
 * **匯入（`mergeImport.js`）與資料健檢（`health.js`）都走這一支** —— 各搬一次的話遲早一邊往前錯一格。
 *
 * - 沒有那一則 → `null`（前綴後面不是號碼的不算：`病歷號要再問` 是她打的一句話）
 * - 好幾則不一樣、或那一格已經是另一個號碼 → `{ blocked: true, nos }`（拿不準是哪一個，不搬，只列）
 * - 其餘 → `{ chartNo, changes }`：`changes` 是要寫進客戶的那幾格。那一格空著就放那一則的原字、
 *   已經是同一個號碼就留她打的；那幾則短備註一起拿掉（同一個號碼寫了兩則也是）
 *
 * **位置**：排過順序的，病歷號接在第一則原本的位置（第 n 個 `'mark'` 換成 `'chartNo'`、其餘的
 * 跟著那幾則一起拿掉 —— 走 `notesFields()`），後面每一則短備註都不往前錯；沒排過的不寫順序，
 * 照預設排在最前面（ADR-0163）。
 */
export function chartNoMove(customer) {
  const marks = readMarks(customer);
  // 只搬號碼（`病歷號要再問` 那種她自己打的話留在短備註裡）
  const hits = marks.map((m, i) => ({ i, raw: chartNoInMark(m.text) }))
    .filter((h) => h.raw != null && /^\d+$/.test(normalizeChartNo(h.raw)));
  if (!hits.length) return null;

  const field = trimmed(customer?.chartNo);
  const nos = [...new Set(hits.map((h) => normalizeChartNo(h.raw)))];
  if (nos.length > 1 || (field && !sameChartNo(field, hits[0].raw))) {
    return { blocked: true, nos: field ? [...new Set([normalizeChartNo(field), ...nos])] : nos };
  }

  const chartNo = field || hits[0].raw;
  const drop = new Set(hits.map((h) => h.i));
  if (!Array.isArray(customer?.noteOrder)) {
    return { chartNo, changes: { chartNo, ...toCustomerFields(marks.filter((_, i) => !drop.has(i))) } };
  }

  const first = hits[0].i;
  const items = noteItems(customer).filter((it) => it.kind !== 'chartNo').flatMap((it) => {
    if (it.kind !== 'mark' || !drop.has(it.index)) return [it];
    return it.index === first ? [{ key: 'chartNo', kind: 'chartNo', text: chartNo }] : [];
  });
  const { longNotes, ...rest } = notesFields(items);
  return { chartNo, changes: { chartNo, ...rest } };
}

/**
 * 存檔前的檢查。回傳訊息陣列，空陣列代表可以存。
 * 短備註的 40 字／12 則照舊在 `validateMarks()`。
 */
export function validateLongNotes(list) {
  if (list != null && !Array.isArray(list)) return ['長備註格式錯誤'];
  const notes = list ?? [];
  const errors = [];
  if (notes.length > MAX_LONG_NOTES) {
    errors.push(`長備註最多 ${MAX_LONG_NOTES} 則（現在有 ${notes.length} 則）`);
  }
  for (const n of notes) {
    const title = trimmed(n?.title);
    if (!title) errors.push('長備註要有標題');
    else if (title.length > MAX_LONG_TITLE) errors.push(`「${title.slice(0, 12)}…」標題太長了（最多 ${MAX_LONG_TITLE} 字）`);
    if (String(n?.body ?? '').length > MAX_LONG_BODY) {
      errors.push(`「${title.slice(0, 12) || '這一則'}」太長了（內文最多 ${MAX_LONG_BODY} 字）`);
    }
  }
  const ids = notes.map((n) => trimmed(n?.id));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) errors.push('長備註格式錯誤');
  return [...new Set(errors)];
}

// ---------------------------------------------------------------------------
// 長備註那一頁只動一則（不碰短備註）
// ---------------------------------------------------------------------------

/**
 * 加或改一則。回傳要寫進客戶的那幾格 —— **沒有 `marks`**：那一頁不碰短備註。
 * 同一個 id 是改那一則（位置不動）；新的接在最後。
 * 順序只在排過的時候補一格（沒排過的照預設順序畫，本來就看得到）。
 */
export function withLongNote(customer, note) {
  const notes = readLongNotes(customer);
  const next = { id: note.id, title: trimmed(note.title), body: String(note.body ?? '') };
  const at = notes.findIndex((n) => n.id === next.id);
  const longNotes = at >= 0 ? notes.map((n, i) => (i === at ? next : n)) : [...notes, next];
  const out = { longNotes };
  if (Array.isArray(customer?.noteOrder)) {
    const token = `long:${next.id}`;
    out.noteOrder = customer.noteOrder.includes(token) ? [...customer.noteOrder] : [...customer.noteOrder, token];
  }
  return out;
}

/** 拿掉一則，連它在順序裡那一格。 */
export function withoutLongNote(customer, id) {
  const out = { longNotes: readLongNotes(customer).filter((n) => n.id !== id) };
  if (Array.isArray(customer?.noteOrder)) {
    out.noteOrder = customer.noteOrder.filter((t) => t !== `long:${id}`);
  }
  return out;
}

/**
 * 長備註那一頁的一疊卡：在服務中的客戶排前面、停用的排後面，同一位照他詳情的順序。
 * 刪掉的客戶（軟刪除）不列。每一張 `{ customer, note, key: '<客戶>:<那一則>' }`。
 */
export function longNoteRows(customers = []) {
  const live = (customers ?? []).filter((c) => c && !c.deletedAt);
  const ordered = [...live.filter((c) => c.active !== false), ...live.filter((c) => c.active === false)];
  return ordered.flatMap((customer) => noteItems(customer)
    .filter((it) => it.kind === 'long')
    .map(({ note }) => ({ customer, note, key: `${customer.id}:${note.id}` })));
}

/** 搜尋：人名（同 `nameHas()`，打字找客戶的比法只有一種）、標題、內文。 */
export function matchesLongNote(row, query) {
  const q = normalizeAlias(query);
  if (!q) return true;
  return nameHas(row.customer?.name, query)
    || normalizeAlias(row.note?.title).includes(q)
    || normalizeAlias(row.note?.body).includes(q);
}
