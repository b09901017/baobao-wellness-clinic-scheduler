#!/usr/bin/env node
// 月底對帳的本體：Abovee（截圖讀出來的）× app（Firebase 快照）× 試算表（app 推試算表那一支現算）。
//
//   node reconcile.mjs --abovee <abovee.json> --snapshot <快照.json> --month 2026-10 --out <比對.json> [--today 2026-11-02]
//
// **「這一列對不對得上」一律問 app 自己的那幾支** —— 拍 Abovee 用的 `readAbovee()`（一列一列認人、認課程、比狀態）、
// `absentFromPhoto()`（app 有、照片上沒有）、次數 `counts()`、試算表 `syncBundle()`。這裡不另寫一套規則：
// 兩份規則遲早有一份會落後，而月底對帳要回答的正是「app 的判斷對不對」。這一支只做三件事：
// 組 app 要的資料（跟拍 Abovee 那一層一樣：認得的每一位讀全部來訪）、把結果分成她看得懂的幾類、數次數。
//
// 輸出有真名，只能寫進 .local/。終端機只印數字。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const D = (f) => import(pathToFileURL(resolve(REPO, 'public/js/domain', f)).href);

const { readAbovee, absentFromPhoto, statusFromAbovee } = await D('aboveeImport.js');
const { counts, slotOutcome, isProduct } = await D('entitlements.js');
const { syncBundle } = await D('sheetReport.js');
const { slotStatus, isActive, isLiveSlot, markFor } = await D('visits.js');
const { slotName } = await D('naming.js');
const { giftKindOf, giftLabel } = await D('masterData.js');
const { nthOf } = await D('nthFollowup.js');
const { todayISO } = await D('dates.js');
const { bookingSystemOf } = await D('taskRules.js');

// ---------- 參數 ----------

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = argv[i].match(/^--(\w+)$/);
    if (m) out[m[1]] = argv[++i];
  }
  return out;
}
const opt = args(process.argv.slice(2));
for (const k of ['abovee', 'snapshot', 'month', 'out']) {
  if (!opt[k]) {
    console.error('用法：node reconcile.mjs --abovee <abovee.json> --snapshot <快照.json> --month YYYY-MM --out <比對.json> [--today YYYY-MM-DD]');
    process.exit(2);
  }
}
const MONTH = opt.month;
const TODAY = opt.today ?? todayISO();
const monthEnd = (() => {
  const [y, m] = MONTH.split('-').map(Number);
  return `${MONTH}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
})();
const inMonth = (date) => typeof date === 'string' && date.startsWith(`${MONTH}-`);

const abovee = JSON.parse(readFileSync(opt.abovee, 'utf8'));
// 截圖涵蓋的日期：畫面上方的「預約日期(起)／(訖)」有拍到就照它，沒有就是整個月（她截的是整個月）。
// app 與試算表的次數只數這一段 —— 只截了月中的一段時，範圍外的那幾天不算對不上
const FROM = abovee.meta?.from && abovee.meta.from > `${MONTH}-01` ? abovee.meta.from : `${MONTH}-01`;
const TO = abovee.meta?.to && abovee.meta.to < monthEnd ? abovee.meta.to : monthEnd;
const inRange = (date) => inMonth(date) && date >= FROM && date <= TO;
const snap = JSON.parse(readFileSync(opt.snapshot, 'utf8'));

// ---------- app 那一側：照 app 讀的樣子組 ----------

const alive = (x) => x && !x.deletedAt;
const groupBy = (rows, key) => {
  const out = {};
  for (const r of rows) if (r[key]) (out[r[key]] ??= []).push(r);
  return out;
};
const customers = snap.customers.filter(alive);
const customersById = Object.fromEntries(snap.customers.map((c) => [c.id, c]));
const entitlementsBy = groupBy(snap.entitlements.filter(alive), 'parentId');
const entitlementsById = Object.fromEntries(snap.entitlements.map((e) => [e.id, e]));
const visitsAlive = snap.visits.filter(alive);
const visitsBy = groupBy(visitsAlive, 'customerId');
const visitsById = Object.fromEntries(snap.visits.map((v) => [v.id, v]));
// 拍 Abovee 那一層拿的是不含刪除的主檔；試算表那一支連刪除的一起讀（`buildBundle()`）
const master = Object.fromEntries(Object.entries(snap.master).map(([t, rows]) => [t, rows.filter(alive)]));
const masterAll = snap.master;
const coursesById = Object.fromEntries((masterAll.courses ?? []).map((c) => [c.id, c]));

const ctx = { customers, entitlementsBy, visitsBy, master, today: TODAY, partial: new Set() };

// ---------- Abovee 那一側：抄字 → app 認得的形狀 ----------

/** 抄字的那一格：`-` 是「這張截圖沒拍到那一欄」，`??` 是看不清楚的記號（驗證過的不會有）。 */
const cell = (v) => (v == null || v === '-' ? '' : String(v).replace(/\?\?/g, ''));

const allRows = abovee.rows ?? [];
const rows = allRows.filter((r) => inMonth(String(r.date ?? '').trim().replaceAll('/', '-')));

// **截圖拍到哪裡**（冷測試 2026-10-16 抓到的）：她說「截到 10/9」，最後一張卻停在 10/9 早上 —— 那天下午的段截圖上本來就沒有。
// 所以沒拍到「共 N 筆」（`meta.complete` 是 true 才算拍齊；她說了整個月都截了也算）時，只信第一列到最後一列之間：
// 「app 有、截圖上沒有」照 app 拍 Abovee 的範圍算（`photoSpan()`，兩頭那個時間不算），次數只數**整天都在截圖裡**的日子
// （頭尾那兩天只截到一部分，不算 —— 試算表一格是一整天，切不開）。
const COMPLETE = abovee.meta?.complete === true;
const rowDates = rows.map((r) => String(r.date).replaceAll('/', '-')).sort();
const firstRowDate = rowDates[0] ?? null;
const lastRowDate = rowDates[rowDates.length - 1] ?? null;
const fullDay = (date) => inRange(date) && (COMPLETE || (Boolean(firstRowDate) && date > firstRowDate && date < lastRowDate));
// 「合併扣課」「取消原因」那一欄每一列都是 `-` 的話＝截圖沒拍到 → 不給 app 那一欄（沒拍到跟空的不一樣）
const seen = (key) => rows.some((r) => r[key] != null && r[key] !== '-');
const COLS = [
  ['預約狀態', 'status'], ['預約日期', 'date'], ['預約時段', 'time'], ['姓名', 'name'], ['病歷號', 'chartNo'],
  ['課程', 'course'], ['合併扣課', 'merged'], ['預約來源', 'source'], ['診間', 'room'], ['服務資源', 'resource'],
  ['取消原因', 'cancelReason'],
].filter(([, key]) => ['status', 'date', 'time', 'name', 'chartNo', 'course'].includes(key) || seen(key));

const transcript = {
  columns: COLS.map(([name]) => name),
  rows: rows.map((r) => COLS.map(([, key]) => cell(r[key]))),
  // 整個月都在這幾張裡（`abovee.meta.complete`）→ 照「每一列都在這裡」算 app 有、照片上沒有的範圍（`photoSpan()` 的 `all`）
  pageText: COMPLETE ? `共 ${rows.length} 筆` : '',
  dateFromText: FROM,
  dateToText: TO,
};

// readAbovee() 每一列帶 `key: a<第幾列>`，跟這裡的 rows 同一個順序
const { items } = readAbovee([transcript], ctx);
// 一整個月、每一位都要對：明說 `everyone` —— 不說的話照片上只有一兩位時只對那幾位（拍 Abovee 的規則，ADR-0153）
const absent = absentFromPhoto([transcript], items, ctx, { everyone: true });

// ---------- 一段算進哪一格（「桶」）----------

function bucketOfSlot(slot) {
  if (slot?.entitlementId) return `e:${slot.entitlementId}`;
  const nth = nthOf(slot);
  if (nth) return `nth:${nth}`;
  const gift = giftKindOf(slot, coursesById);
  if (gift) return `gift:${slot.courseId}:${gift}`;
  return `course:${slot?.courseId ?? '?'}`;
}

function bucketOfItem(item) {
  if (item.entitlementId) return `e:${item.entitlementId}`;
  if (item.isNth && item.nth) return `nth:${item.nth}`;
  if (item.giftCourseId) return `gift:${item.giftCourseId}:${item.giftKind ?? 'trial'}`;
  if (item.course?.courseId) return `course:${item.course.courseId}`;
  return `abovee:${item.row?.course ?? '?'}`;
}

function bucketLabel(key) {
  const [kind, id, extra] = key.split(':');
  if (kind === 'e') return entitlementsById[id]?.label ?? '（額度已刪除）';
  if (kind === 'nth') return `${id}返`;
  if (kind === 'gift') return `${coursesById[id]?.name ?? '?'}（${giftLabel(extra) ?? extra}）`;
  if (kind === 'course') return `${coursesById[id]?.name ?? '?'}（沒有扣額度）`;
  return `${id}（課程認不出來）`;
}

/** 那一列在 app 上對到的那一段。 */
function appSlotOf(item) {
  const ex = item.existing;
  if (!ex?.visitId || ex.slotIndex == null) return null;
  const visit = visitsById[ex.visitId];
  const slot = visit?.slots?.[ex.slotIndex];
  return slot ? { visit, slot, index: ex.slotIndex } : null;
}

const STATUS_WORD = { pending_confirm: '待確認', confirmed: '已確認', done: '已完成', no_show: '未到', cancelled: '已取消' };
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

// ---------- 試算表那一側 ----------

const listForSheet = visitsAlive.filter((v) => typeof v.date === 'string' && v.date <= addDays(TODAY, 400));
const sheetVisitsBy = groupBy(listForSheet, 'customerId');
const tasksBy = groupBy(snap.tasks.filter(alive), 'customerId');
const sheetCache = new Map();

/** 這一位在試算表上那一張（syncBundle 一次只給一位 —— 分頁名的撞名尾巴不影響數字）。 */
function sheetOf(customer) {
  if (!sheetCache.has(customer.id)) {
    const bundle = syncBundle({
      customers: [customer], entitlementsBy, visitsBy: sheetVisitsBy, tasksBy, today: TODAY, master: masterAll,
    });
    const sheet = bundle.sheets[0] ?? null;
    // 額度那幾列跟 `scheduled`（活著、不是營養品）同一個順序 —— syncBundle 的 rows 前面就是它們
    const scheduled = (entitlementsBy[customer.id] ?? []).filter((e) => !e.deletedAt && !isProduct(e));
    const byEnt = new Map(scheduled.map((e, i) => [e.id, sheet?.rows?.[i] ?? null]));
    sheetCache.set(customer.id, { sheet, byEnt });
  }
  return sheetCache.get(customer.id);
}

/** 一格符號裡有幾個某種符號：`✓2○` → ✓ 2 個。 */
function countMark(text, symbol) {
  const re = new RegExp(`${symbol}(\\d*)`, 'g');
  let n = 0;
  for (const m of String(text ?? '').matchAll(re)) n += m[1] ? Number(m[1]) : 1;
  return n;
}
const DONE_MARK = markFor('done');

/** 那一天、那一筆額度在試算表上那一格寫什麼。 */
function sheetMark(customerId, entitlementId, date) {
  const customer = customersById[customerId];
  if (!customer || !entitlementId) return null;
  const { sheet, byEnt } = sheetOf(customer);
  const row = byEnt.get(entitlementId);
  if (!sheet || !row) return null;
  const at = sheet.dates.indexOf(date);
  return at < 0 ? '' : (row.marks[at] ?? '');
}

// 已經被某一列認走的 app 段
const claimed = new Set(items.map((i) => (i.existing?.visitId != null && i.existing.slotIndex != null ? `${i.existing.visitId}:${i.existing.slotIndex}` : null)).filter(Boolean));

/** 認不出的那一列，app 上同一天同一個時間有哪幾位的段還沒被別列認走（名字寫法不一樣的那一種，例如一筆紀錄掛兩個人）。 */
function maybeAt(item) {
  if (!item.date || !item.startsAt) return [];
  const out = [];
  for (const v of visitsAlive) {
    if (v.date !== item.date || !isActive(v)) continue;
    (v.slots ?? []).forEach((slot, index) => {
      if (slot.startsAt === item.startsAt && isLiveSlot(slot) && !claimed.has(`${v.id}:${index}`)) {
        out.push({ customerId: v.customerId, name: customersById[v.customerId]?.name ?? v.customerName ?? '' });
      }
    });
  }
  return out;
}

// ---------- 分類：她要動手的（fix）、順便看看的（look）----------

const issues = [];
const minor = [];
const strangers = new Map();
let seq = 0;

function push(level, type, base, say, todo) {
  const out = { id: `i${++seq}`, level, type, ...base, say, todo };
  (level === 'note' ? minor : issues).push(out);
  return out;
}

function baseOfItem(item) {
  const r = item.row ?? {};
  const hit = appSlotOf(item);
  const customerId = item.customerId ?? null;
  const entId = hit?.slot?.entitlementId ?? item.entitlementId ?? null;
  return {
    date: item.date, time: r.time ?? '', startsAt: item.startsAt ?? null,
    customerId, name: customerId ? customersById[customerId]?.name ?? r.name : r.name,
    abovee: { status: r.status ?? '', course: r.course ?? '', resource: r.resource ?? '', src: rows[Number(item.key.slice(1))]?.src ?? null,
      row: rows[Number(item.key.slice(1))]?.row ?? null, paidBy: paidByOf(rows[Number(item.key.slice(1))]) },
    app: hit ? { status: slotStatus(hit.visit, hit.slot), name: slotName(hit.slot, master, 'short'), visitId: hit.visit.id, slotIndex: hit.index }
      : null,
    sheet: customerId && entId ? { mark: sheetMark(customerId, entId, item.date), label: entitlementsById[entId]?.label ?? '' } : null,
  };
}

/** Abovee 上「實際扣課病歷號」跟這一列的病歷號不一樣（用家人的額度）—— app 上那一段可能記在家人身上，要講出來。 */
function paidByOf(row) {
  const no = cell(row?.actualChartNo);
  if (!no || no === cell(row?.chartNo)) return null;
  const who = customers.find((c) => (c.marks ?? []).some((m) => String(m.text ?? '').replace(/\D/g, '') === no.replace(/^0+/, '')));
  return { chartNo: no, relation: cell(row?.relation), name: who?.name ?? null };
}

const photoWord = (item) => `Abovee 寫「${item.row?.status ?? '？'}」`;
const appWord = (s) => `app 是「${STATUS_WORD[s] ?? s ?? '？'}」`;
const past = (date) => date && date < TODAY;

for (const item of items) {
  const base = baseOfItem(item);
  const ps = item.photoStatus; // done / no_show / cancelled / pending_confirm / null
  const appStatus = base.app?.status ?? item.appStatus ?? null;

  if (item.kind === 'unknown') {
    // 認不出的人照人收成一份（`strangers`），不算進「要處理的」：Abovee 上本來就有不是她客人的預約（體驗、別人的客人），
    // 每個月都會出現。名字跟病歷號對到不同人、同名兩位 —— 那兩種是 app 的資料要修，照舊算要處理的
    const how = item.who?.how;
    if (how === 'conflict' || how === 'ambiguous') {
      push('fix', 'unknown', base, how === 'conflict' ? '名字跟病歷號在 app 裡對到不同的人' : 'app 裡同名的不只一位，病歷號也沒對上',
        '去客戶清單看這位的病歷號（備註那一段那一顆病歷號，「編輯」客戶資料裡改）');
    } else if (ps !== 'cancelled') {
      const k = `${item.row?.name ?? ''}|${item.row?.chartNo ?? ''}`;
      const who = strangers.get(k) ?? { name: item.row?.name ?? '', chartNo: item.row?.chartNo ?? '', rows: [], maybe: new Map() };
      for (const m of maybeAt(item)) who.maybe.set(m.customerId, m.name);
      who.rows.push({ date: item.date, time: item.row?.time ?? '', course: item.row?.course ?? '', status: item.row?.status ?? '' });
      strangers.set(k, who);
    }
    continue;
  }
  if (!item.course) {
    push(ps === 'cancelled' ? 'note' : 'fix', 'unknownCourse', base, `課程「${item.row?.course ?? ''}」app 認不出來`,
      '設定 → 課程，把 Abovee 上的寫法加到那門課的「Abovee 上的寫法」');
    continue;
  }

  if (item.kind === 'recorded') {
    const ch = item.statusChange;
    if (ch) {
      const from = ch.from;
      if (ch.to === 'done' && from === 'no_show') {
        push('fix', 'status', base, `${photoWord(item)}，app 記「未到」（沒扣）`, '確認客人那天有沒有來：有來的話日曆上那一段「退回簽療程單」再簽成做了');
      } else if (ch.to === 'done') {
        push('fix', 'unsigned', base, `${photoWord(item)}，app 還是「${STATUS_WORD[from]}」—— 療程單還沒簽，次數還沒扣`,
          '待辦中心 → 簽療程單，把這一段勾成做了');
      } else if (ch.to === 'no_show') {
        push('fix', 'unsigned', base, `${photoWord(item)}，app 還是「${STATUS_WORD[from]}」`, '待辦中心 → 簽療程單，這一段選「沒來」');
      } else if (ch.to === 'cancelled') {
        push('fix', 'stillBooked', base, `${photoWord(item)}，app 還排著（佔著一次）`, '日曆 → 那一段 → 取消這一段');
      }
    } else if (item.move) {
      push('note', 'moved', base, `時間不一樣：app 是 ${item.movedFrom?.startsAt ?? item.move?.from ?? ''}`, '以 Abovee 為準的話去日曆改期');
    }
    if (item.diffs) {
      push('note', 'diffs', base, '治療師或診間跟 Abovee 不一樣', '不影響次數；要改去日曆');
    }
    continue;
  }

  if (item.kind === 'mismatch') {
    switch (item.reason) {
      case 'course': {
        const v = visitsById[item.existing?.visitId];
        const there = (v?.slots ?? []).map((slot, index) => ({ slot, index }))
          .filter(({ slot }) => slot.startsAt === item.startsAt && isLiveSlot(slot));
        if (there[0]) base.app = { status: slotStatus(v, there[0].slot), name: slotName(there[0].slot, master, 'short'), visitId: v.id, slotIndex: there[0].index };
        push('fix', 'course', base, `同一個時間 app 記的是「${there.map(({ slot }) => slotName(slot, master, 'short')).join('、') || '別的課程'}」`,
          '確認那天做的是哪一門，去日曆改那一段（次數會扣到不同的額度）');
        break;
      }
      case 'appDoneStays':
        push('fix', 'status', base, `${photoWord(item)}，app 已經是「已完成」（扣了一次）`,
          ps === 'cancelled' ? '如果真的沒做：日曆上那一段要更正（已完成的鎖著，找我幫忙）' : '確認客人那天有沒有來');
        break;
      case 'aboveeNotDone':
        push('fix', 'aboveeBehind', base, `${photoWord(item)}，app 已經是「已完成」`, '回 Abovee 把這一筆改成課程完成');
        break;
      case 'bothOpen':
        push('fix', 'bothOpen', base, `日子過了，${photoWord(item)}、${appWord(appStatus)} —— 兩邊都還沒結案`,
          '那天有來的話：Abovee 改課程完成、app 簽療程單');
        break;
      case 'closeBlocked':
        push('fix', 'closeBlocked', base, `${photoWord(item)}，但 app 這一段接的那一次健檢還沒做完，簽不成`, '先把那一次健檢簽好，再簽這一段');
        break;
      case 'aboveeNotNoShow':
      case 'appCancelled':
      case 'noShowStays':
        push('note', 'statusNoCount', base, `${photoWord(item)}，${appWord(appStatus)}（兩邊都不扣次數）`, '不影響次數');
        break;
      default:
        push('fix', 'other', base, `${photoWord(item)}，${appWord(appStatus)}（${item.reason}）`, '去日曆看那一段');
    }
    continue;
  }

  // kind === 'new'：app 這個時間沒有這一段
  if (ps === 'cancelled') continue; // Abovee 取消了、app 也沒有 —— 一致
  if (item.appCancelledHere) {
    push(ps === 'done' ? 'fix' : 'note', 'appCancelled', base,
      `${photoWord(item)}，app 上這個時間的那一段已經取消了`, ps === 'done' ? '那天有做的話：在 app 補記這一段（拍一次 Abovee）' : '不影響次數');
    continue;
  }
  if (ps === 'done') {
    push('fix', 'missing', base, `${photoWord(item)}，app 上沒有這一段 —— app 少算一次`, '在 app 拍一次 Abovee 補記，或去日曆新增');
  } else if (ps === 'no_show') {
    push('note', 'missingNoShow', base, `${photoWord(item)}，app 上沒有這一段（不扣次數）`, '要留紀錄的話在 app 補記');
  } else if (past(item.date)) {
    push('fix', 'missingOpen', base, `日子過了，${photoWord(item)}，app 上沒有這一段`, '那天有來的話：Abovee 改課程完成，app 補記');
  } else {
    push('note', 'missingFuture', base, `${photoWord(item)}，app 上還沒有這一段`, '還沒到；在 app 拍一次 Abovee 就會記進去');
  }
}

for (const s of absent.slots) {
  const visit = visitsById[s.visitId];
  const slot = visit?.slots?.[s.slotIndex];
  const base = {
    date: s.date, time: s.startsAt ?? '', startsAt: s.startsAt, customerId: s.customerId, name: s.customerName,
    abovee: null,
    app: { status: s.status, name: s.name, visitId: s.visitId, slotIndex: s.slotIndex },
    sheet: slot?.entitlementId ? { mark: sheetMark(s.customerId, slot.entitlementId, s.date), label: entitlementsById[slot.entitlementId]?.label ?? '' } : null,
  };
  if (s.status === 'done') {
    push('fix', 'extra', base, 'app 是「已完成」（扣了一次），Abovee 上找不到這一段', '確認那天有沒有做：沒做的話 app 要更正；有做的話是 Abovee 漏壓');
  } else if (s.status === 'no_show') {
    push('note', 'extraNoShow', base, 'app 記「未到」，Abovee 上找不到這一段（不扣次數）', '不影響次數');
  } else if (past(s.date)) {
    push('fix', 'extraOpen', base, `日子過了，app 還是「${STATUS_WORD[s.status]}」，Abovee 上找不到這一段`, '那天有做就簽療程單；沒有就取消這一段');
  } else {
    push('note', 'extraFuture', base, `app 排了「${STATUS_WORD[s.status]}」，Abovee 上還沒有`, '還沒到；記得在 Abovee 壓表');
  }
}

// ---------- 次數：每一位、每一筆額度，這個月做了幾次 ----------

const people = new Map();
const personOf = (id, fallbackName) => {
  if (!people.has(id)) people.set(id, { customerId: id, name: customersById[id]?.name ?? fallbackName ?? '?', buckets: new Map() });
  return people.get(id);
};
const bucketIn = (person, key) => {
  if (!person.buckets.has(key)) person.buckets.set(key, { key, label: bucketLabel(key), abovee: 0, app: 0, sheet: null, aboveeBooked: false });
  return person.buckets.get(key);
};

// Abovee：課程完成的列，算進它在 app 上對到的那一段的桶（沒對到就算進 app 預選的那一筆）
for (const item of items) {
  if (!item.customerId || item.photoStatus !== 'done' || !fullDay(item.date)) continue;
  const hit = appSlotOf(item);
  const b = bucketIn(personOf(item.customerId, item.row?.name), hit ? bucketOfSlot(hit.slot) : bucketOfItem(item));
  b.abovee += 1;
  b.aboveeBooked = true;
}
// app：這個月每一段做完的
for (const v of visitsAlive) {
  if (!fullDay(v.date) || !isActive(v)) continue;
  for (const slot of v.slots ?? []) {
    if (slotOutcome(v, slot) !== 'done') continue;
    const b = bucketIn(personOf(v.customerId, v.customerName), bucketOfSlot(slot));
    b.app += 1;
    // 不壓 Abovee 的課（健檢壓 Examine、HRV 不用壓）Abovee 上本來就不會有 —— 那一桶不拿 Abovee 比
    if (bookingSystemOf(coursesById[slot.courseId] ?? null) === 'Abovee') b.aboveeBooked = true;
  }
}

const cacheIssues = [];
for (const person of people.values()) {
  const customer = customersById[person.customerId];
  for (const b of person.buckets.values()) {
    if (!b.key.startsWith('e:') || !customer) continue;
    const entId = b.key.slice(2);
    const e = entitlementsById[entId];
    const { sheet, byEnt } = sheetOf(customer);
    const row = byEnt.get(entId);
    if (row && sheet) {
      b.sheet = sheet.dates.reduce((n, date, i) => n + (fullDay(date) ? countMark(row.marks[i], DONE_MARK) : 0), 0);
      b.sheetRemaining = row.remaining;
    }
    if (e) {
      const live = counts(e, visitsBy[person.customerId] ?? [], entId);
      b.total = live.total;
      b.remaining = live.remaining;
      b.cachedRemaining = (e.totalQty ?? 0) - (e.doneCount ?? 0) - (e.bookedCount ?? 0);
    }
  }
}

// app 畫面上的「剩 N」讀額度上存的數字（`summarize()`）；跟重算的不一樣就是快取沒跟上 —— 每一位都看，不只這個月有來的
for (const e of snap.entitlements.filter(alive)) {
  if (isProduct(e) || !e.parentId || !customersById[e.parentId] || customersById[e.parentId].deletedAt) continue;
  const live = counts(e, visitsBy[e.parentId] ?? [], e.id);
  const storedDone = e.doneCount ?? 0;
  const storedBooked = e.bookedCount ?? 0;
  if (storedDone !== live.done || storedBooked !== live.booked) {
    cacheIssues.push(push('fix', 'cache', {
      date: null, time: '', customerId: e.parentId, name: customersById[e.parentId].name, abovee: null, app: null,
      sheet: { label: e.label ?? '' },
    }, `「${e.label}」app 畫面上寫做完 ${storedDone}、排著 ${storedBooked}，重算是做完 ${live.done}、排著 ${live.booked}`,
    '設定 → 資料健檢，照那一項按「修正」'));
  }
}

const peopleOut = [...people.values()].map((p) => {
  const buckets = [...p.buckets.values()].map((b) => {
    const sheetOk = b.sheet == null || b.sheet === b.app;
    const remainOk = b.remaining == null || ((b.sheetRemaining == null || b.sheetRemaining === b.remaining) && b.cachedRemaining === b.remaining);
    const abovee = b.aboveeBooked ? b.abovee : null;
    return { ...b, abovee, ok: (abovee == null || abovee === b.app) && sheetOk && remainOk };
  }).sort((a, b) => Number(a.ok) - Number(b.ok) || a.label.localeCompare(b.label, 'zh-TW'));
  const mine = issues.filter((i) => i.customerId === p.customerId);
  const alias = [...strangers.values()].filter((x) => x.maybe.has(p.customerId)).map((x) => x.name);
  return { customerId: p.customerId, name: p.name, buckets, issues: mine.length, alias, ok: buckets.every((b) => b.ok) && !mine.length };
}).sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name, 'zh-TW'));

// 試算表算的跟 app 不一樣（照理不會：同一支 counts()）—— 有的話是程式的事，不是她的
for (const p of peopleOut) {
  for (const b of p.buckets) {
    if (b.sheet != null && b.sheet !== b.app) {
      push('fix', 'sheet', { date: null, time: '', customerId: p.customerId, name: p.name, abovee: null, app: null, sheet: { label: b.label } },
        `「${b.label}」這個月試算表打勾 ${b.sheet} 次、app 做完 ${b.app} 次`, '這是程式的問題，不是妳的 —— 把這一頁給我看');
    }
  }
}

// ---------- 一天一格 ----------

const days = [];
for (let d = 1; d <= Number(monthEnd.slice(8)); d += 1) {
  const date = `${MONTH}-${String(d).padStart(2, '0')}`;
  const aboveeRows = rows.filter((r) => String(r.date).replaceAll('/', '-') === date);
  const appSlots = visitsAlive.filter((v) => v.date === date && isActive(v)).flatMap((v) => (v.slots ?? []).filter(isLiveSlot));
  days.push({
    // full＝整天都在截圖裡；edge＝第一列或最後一列那一天（只截到一部分）；out＝範圍外、或沒拍齊時第一列之前／最後一列之後
    date, inRange: inRange(date),
    coverage: !inRange(date) ? 'out' : fullDay(date) ? 'full' : (date === firstRowDate || date === lastRowDate) ? 'edge' : 'out',
    abovee: aboveeRows.length,
    aboveeDone: aboveeRows.filter((r) => statusFromAbovee(r.status).status === 'done').length,
    app: appSlots.length,
    fix: issues.filter((i) => i.date === date).length,
    note: minor.filter((i) => i.date === date).length,
  });
}

// ---------- 摘要 ----------

const tally = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const aboveeStatus = tally(rows, (r) => String(r.status ?? '').replace(/\?\?/g, '') || '空的');
const unverified = rows.filter((r) => r.verify && r.verify.ok === false).map((r) => ({
  src: r.src, row: r.row, date: r.date, name: r.name, fields: r.verify.bad ?? [],
}));

const totals = { abovee: 0, app: 0, sheet: 0 };
for (const p of peopleOut) {
  for (const b of p.buckets) {
    if (!b.key.startsWith('e:') || b.abovee == null) continue;
    totals.abovee += b.abovee; totals.app += b.app; totals.sheet += b.sheet ?? 0;
  }
}

const result = {
  meta: {
    month: MONTH, today: TODAY, from: FROM, to: TO, generatedAt: new Date().toISOString(),
    project: snap.meta?.projectId ?? null, emulator: snap.meta?.emulator ?? null, readAt: snap.meta?.readAt ?? null,
    shots: abovee.meta?.shots ?? [], aboveeRows: rows.length, droppedOutsideMonth: allRows.length - rows.length,
    complete: COMPLETE, firstRowDate, lastRowDate, pixel: abovee.meta?.pixel ?? null,
  },
  summary: {
    aboveeStatus,
    matched: items.filter((i) => i.kind === 'recorded').length,
    appSlotsInMonth: days.reduce((n, d) => n + d.app, 0),
    fix: issues.length, note: minor.length, cache: cacheIssues.length, strangers: strangers.size,
    people: peopleOut.length, peopleOk: peopleOut.filter((p) => p.ok).length,
    totals,
  },
  strangers: [...strangers.values()].map((x) => ({ ...x, maybe: [...x.maybe].map(([customerId, name]) => ({ customerId, name })) }))
    .sort((a, b) => b.rows.length - a.rows.length),
  issues: issues.sort((a, b) => `${a.date ?? '9999'}|${a.startsAt ?? ''}`.localeCompare(`${b.date ?? '9999'}|${b.startsAt ?? ''}`)),
  minor: minor.sort((a, b) => `${a.date}|${a.startsAt ?? ''}`.localeCompare(`${b.date}|${b.startsAt ?? ''}`)),
  people: peopleOut,
  days,
  unverified,
};
mkdirSync(dirname(resolve(opt.out)), { recursive: true });
writeFileSync(opt.out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ month: MONTH, today: TODAY, aboveeRows: rows.length, ...result.summary, aboveeStatus: undefined }));

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
