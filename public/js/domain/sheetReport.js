// 產生給 Google 試算表的唯讀報表。SPEC 第 4.8 節。純函式。
//
// 試算表從「資料來源」降級成「報表」——app 才是唯一真相（SPEC 第 4.8 節），
// 所以這裡只負責**單向**把資料排成她原本看習慣的樣子。不做讀回來，
// 雙向同步一定會打架。
//
// 保留現行試算表的骨架（一位客戶一張表、療程項目 × 日期的勾選矩陣），
// 因為那是她已經會看的東西；但次數改成三段式（SPEC 第 4.2 節），
// 舊表的「應有／實際」兩欄講不出「已排未上」，而那正是最容易掉東西的地方。
//
// 次數一律從 visits 現算，不讀計數欄位 —— 報表會被存到雲端硬碟當備份看，
// 它必須是對的（ADR-0004：真正不能錯的地方一律現算）。
//
// 沒有總表。她要的是「和我原本那個一樣」，而舊表從來沒有總表（2026-08-20）。
// 一位客戶一張，就這樣。

import { counts, isProduct } from './entitlements.js';
import { deliveryState, amountOf, monthsOf, itemsOf } from './products.js';
import { purchaseDays, purchaseDayLabel } from './purchases.js';
import {
  isActive, markFor, slotStatus, isLiveSlot, slotNoteOf as slotNote, shortStatus, MARK_ORDER, MARK_LEGEND,
} from './visits.js';
import { pairsOf, holdsExam, usedAndDone } from './followups.js';
import { followupsOfExam, nthLabel } from './nthFollowup.js';
import { taskLine } from './todoFlow.js';
import { shortDate, isValidDate } from './dates.js';
import { chartNosOf } from './identify.js';
import { timeLabel } from './visitTime.js';
// `syncBundle()` 裡有一個同名的區域函式（id → 名字），所以這裡改個名字進來 ——
// 兩個 `nameOf` 擺在同一支裡，下一個讀的人要先停下來想一下是哪一個。
import { nameOf as variantName } from './naming.js';

/** 每張表的第一列。SPEC 第 4.8 節要求每張分頁都要有這句。 */
export const READONLY_NOTICE = '⚠️ 本表由系統自動產生，請勿手動編輯。修改請至 app。';

/**
 * 一位客戶一張表：療程項目 × 日期的矩陣，底下接二返註記、備註與 TODO / FINISHED。
 *
 * 這是**手動貼上**那條路（`#/settings/report`）。自動推送走的是 `syncBundle()`。
 * 兩邊共用同一組 `mark()` / `followupNotes()` / `equipmentCells()` / `taskBlocks()` ——
 * 矩陣、二返與器材註記、TODO 的**算法**一定一樣，這裡只負責把它們攤成格子。
 *
 * **但這條路比較少**：沒有來訪紀錄、記一句（格式 5）、買過什麼（格式 6）。她 2026-09-24 說
 * 「沒再用了」，所以不補；畫面上那一格的 `?` 講出來少了什麼
 *（`.scratch/asks-2026-09-24-evening/issues/05`）。哪天要補，照 `syncBundle()` 那三份攤。
 *
 * @param {object} ctx
 * @param {object} ctx.customer
 * @param {object[]} ctx.entitlements 這位客戶的額度
 * @param {object[]} ctx.visits 這位客戶的來訪
 * @param {object[]} [ctx.tasks] 這位客戶的任務，含已完成的
 * @param {object[]} [ctx.courses] 課程主檔，用來找出健檢配的二返（ADR-0022）
 * @param {object[]} [ctx.staff] 治療師與醫師，二返註記的括號要靠它換成名字
 * @param {object[]} [ctx.equipment] 器材主檔，「這一天用了哪一台」那一列要靠它換成別稱
 * @param {string} [ctx.generatedAt] 產生時間，寫在表頭讓她知道這份多舊
 * @returns {{name:string, rows:string[][]}}
 */
export function customerReport({
  customer, entitlements = [], visits = [], tasks = [], courses = [], staff = [],
  equipment = [], generatedAt = '',
}) {
  const alive = entitlements.filter((e) => !e.deletedAt);
  const used = visits.filter((v) => isActive(v) && isValidDate(v.date));
  const dates = [...new Set(used.map((v) => v.date))].sort();
  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));
  const staffById = Object.fromEntries(staff.map((x) => [x.id, x]));

  const rows = [
    [READONLY_NOTICE],
    ['客戶', customer?.name ?? ''],
    ['購買通路', customer?.source ?? ''],
    ['會籍到期', customer?.membershipExpiresAt ?? ''],
    ['永久限制', (customer?.flags ?? []).join('、')],
    ['產生時間', generatedAt],
    ['符號', MARK_LEGEND],
    [],
    ['療程項目', '應有', '已完成', '已排未上', '剩餘', ...dates.map(shortDate)],
  ];

  // 營養品不進矩陣 —— 它自己一區（見底下）。兩條路必須長一樣，
  // 所以這裡跟 `syncBundle()` 是同一個判斷。
  const scheduled = alive.filter((e) => !isProduct(e));

  for (const e of scheduled) {
    const c = counts(e, used, e.id);
    rows.push([
      e.label ?? '',
      String(c.total),
      String(c.done),
      String(c.booked),
      String(c.remaining),
      ...dates.map((date) => mark(used, e.id, date)),
    ]);

    // 「這一天用了哪一台」**接在那一列的正下方**（她的原話：「在當天的那一列
    // 下面，可以註記是 ILIB sis indiba 等等」）。只有得選的池才註記 ——
    // 單台的池與 single 那一列的名字已經講了是哪一台，再寫一次是噪音。
    const cells = equipmentCells(e, used, dates, equipment);
    if (cells.length) {
      const line = [];
      for (const cell of cells) line[COUNT_COLS + cell.dateIndex] = cell.text;
      rows.push([...line].map((x) => x ?? ''));
    }
  }

  if (!scheduled.length) rows.push(['（還沒有額度）']);

  // 回訪註記：寫在那次健檢被勾起來的那一欄底下 —— 位置照她原本的。
  //
  // **一返一列**，不是一格塞好幾行。自動推送那條路一格可以有好幾行
  //（`.gs` 那側 `setWrap(true)`），但這條路的產物會經過 `toTSV()`，
  // 而它把換行換成空白（不然貼進試算表會整個錯位）。同一格三返擠在二返後面
  // 是看得懂但很難掃的東西，所以這裡攤成幾列 —— 兩條路長得一樣，
  // 只是這一條把「同一格的第二行」畫成「下一列的同一欄」。
  const notes = followupNotes({ alive, visits: used, dates, coursesById, staffById });
  if (notes.length) {
    const parts = notes.map((note) => ({ at: note.dateIndex, lines: note.text.split(NL) }));
    const height = Math.max(...parts.map((p) => p.lines.length));

    for (let i = 0; i < height; i += 1) {
      const line = [];
      for (const part of parts) {
        if (part.lines[i]) line[COUNT_COLS + part.at] = part.lines[i];
      }
      rows.push([...line].map((cell) => cell ?? ''));
    }
  }

  // 營養品那一區。**一筆都沒有就整段不畫** —— 大部分客戶不買，
  // 而一個永遠空著的區塊只是在每次看報表時提醒她那件事不存在。
  const bought = alive.filter(isProduct);
  if (bought.length) {
    rows.push([], ['營養品', '金額', '幾個月', '哪幾種', '給了沒']);
    for (const e of bought) {
      const gave = deliveryState(e);
      rows.push([
        e.label ?? '',
        amountOf(e) == null ? '' : String(amountOf(e)),
        String(monthsOf(e)),
        itemsOf(e).map((x) => x.name).filter(Boolean).join('、'),
        deliveryCell(gave),
      ]);
    }
  }

  const blocks = taskBlocks(tasks, used, { courses, equipment });
  rows.push([], ['備註', customer?.notes ?? '']);
  rows.push([], ['TODO（還沒做的）'], ...taskRows(blocks.todo, '死線'));
  rows.push([], ['FINISHED（做完的）'], ...taskRows(blocks.finished, '完成'));

  return { name: customer?.name ?? '（沒有名字）', rows };
}

/**
 * 同一格裡好幾行時的分隔。`.gs` 那側寫那一格時 `setWrap(true)`，
 * 所以換行在試算表上就是換行。
 */
const NL = String.fromCharCode(10);

/** 矩陣左邊那幾欄（療程項目、應有、已完成、已排未上、剩餘）。日期從第 6 欄起。 */
const COUNT_COLS = 5;

/** 還沒做的看死線，做完的看完成日 —— 兩邊印同一個日期等於少講一件事。 */
const taskRows = (items, kind) =>
  (items.length ? items : [null]).map((t) =>
    (t ? [t.label, t.kind, kind === '完成' ? (t.doneAt ?? '').slice(0, 10) : (t.dueDate ?? '')]
       : ['（沒有）']));

/**
 * 那一天這筆額度長什麼樣。
 *
 * 不是只印一個勾：**符號分得出走到哪一步了**（○ 待確認、△ 已確認、✓ 已完成、
 * ✗ 未到），符號由 `domain/visits.js` 的 `markFor()` 給，這裡不自己定義一組。
 *
 * 同一天同一池用兩次是有的（上午一次下午一次），所以要帶數量 ——
 * 舊表的勾選格看不出這件事，對帳時就會少一次。兩次的狀態還可能不一樣
 * （一段做了、一段沒到），所以是逐種符號各自算，不是挑一個代表。
 *
 * ## 2026-09-08：真的逐段算了（ADR-0081）
 *
 * 這一支以前讀的是 `markFor(v.status)` —— **整筆**的狀態。所以一筆標
 * 「已完成」、其中一段 `attended: false` 的來訪，兩段都印 ✓，而她在
 * 對帳的時候看到的次數是對的、符號是錯的。上一版的註解自己寫著這件事
 * 還沒做，這裡把它補上：符號走 `slotStatus()`，跟日曆與讀取卡片同一支。
 *
 * **取消掉的那一段沒有符號**（`markFor('cancelled')` 本來就是空字串），
 * 所以它自然不會被算進去 —— 那正是對的：那一段沒發生。
 */
function mark(visits, entitlementId, date) {
  const tally = new Map();

  for (const v of visits) {
    if (v.date !== date) continue;
    for (const slot of v.slots ?? []) {
      if (slot.entitlementId !== entitlementId) continue;
      const symbol = markFor(slotStatus(v, slot));
      if (!symbol) continue;
      tally.set(symbol, (tally.get(symbol) ?? 0) + 1);
    }
  }

  return MARK_ORDER
    .filter((symbol) => tally.has(symbol))
    .map((symbol) => (tally.get(symbol) === 1 ? symbol : `${symbol}${tally.get(symbol)}`))
    .join('');
}

/**
 * 那一天做完的那一次健檢（用這筆額度的那一段做完了）。二返註記靠它找出健檢是哪一欄。
 *
 * **問那一段，不問那一天有沒有用到這筆額度**（ADR-0112 的 `usedAndDone()`，跟 app 的「約二返」同一個時機）。
 * 以前問的是後者：健檢那一段取消了、同一天復能做了，那一格空的、底下照印 `二返()`；
 * ○／△（還沒做）與 ✗（沒來）的底下也印（`.scratch/asks-2026-09-24-evening/issues/02`）。
 * 她 2026-09-24 晚選的：「跟舊表和 app 的『約二返』同一個時機」—— 舊表上是健檢打勾了才寫 `二返()`。
 */
function examOn(visits, entitlementId, date) {
  return (visits ?? []).find((v) => v.date === date && usedAndDone(v, entitlementId)) ?? null;
}

/** `7/13`。舊表的二返註記就是這個格式，沒有星期。 */
function monthDay(iso) {
  const [, m, d] = String(iso).split('-').map(Number);
  return `${m}/${d}`;
}

/**
 * 營養品那一區「給了沒」那一格印什麼。
 *
 * **兩條路共用**：貼上那條在這裡拼完，推送那條把兩半送過去讓 `.gs` 用同一個
 * 全形空白接起來（`renderProducts()`）。同一份報表因為走哪條路而長得不同，
 * 她會以為其中一條壞了 —— 而那正是這一支檔頭寫的規矩。
 */
export function deliveryCell(gave) {
  return gave?.at ? `${monthDay(gave.at)}　${gave.text}` : (gave?.text ?? '');
}

/**
 * 貼進試算表用。她選一格貼上，整份就會攤成表格。
 *
 * 儲存格裡的定位與換行一律換成空白 —— 留著會把一列拆成好幾列，
 * 而她要到很後面才會發現表格錯位了。
 */
export function toTSV({ rows }) {
  return rows
    .map((row) => row.map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

/** 下載成檔案用。逗號、引號、換行都要包起來，否則 Excel 開起來會錯位。 */
export function toCSV({ rows }) {
  return rows
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// ---------- 給 Apps Script 用的整包資料 ----------
//
// 上面那幾支排的是「貼進去就是一張表」的格子；這一支排的是**資料**，
// 由 `sheets/readonly-report.gs` 拿去排版（合併儲存格、欄寬、上鎖）。
//
// 為什麼分兩份而不是把 rows 直接送過去：`.gs` 那邊要合併儲存格、要把備註
// 塞進舊表 TODO 區塊的位置、要依剩餘次數上色 —— 那些需要知道「這一格是什麼」，
// 而不只是「這一格印什麼字」。次數照樣在這裡算完（ADR-0004：不能錯的地方現算），
// `.gs` 一個數字都不重算。
//
// 見 docs/adr/0013-sheet-sync-is-a-push-not-a-pull.md。

/**
 * 這包資料的格式版本。`.gs` 收到看不懂的版本要拒絕，不要半套渲染。
 *
 * 2 起：拿掉 `overview`（不做總表），勾選格改成四種符號，
 * 每張表多了 `tasks`（TODO / FINISHED 兩塊）與 `followupNotes`（二返註記）。
 *
 * 3 起：多了 `products`（營養品那一區）。以前營養品混在 `rows` 裡，
 * 而那四個數字欄印的是**月數** —— 「應有 2 已完成 0 已排未上 0 剩餘 2」
 * 沒有一個看得懂。現在它自己一區，帶金額、哪幾款、哪天給了。
 *
 * **升版了就一定要回 Google 試算表把 `.gs` 重新貼一次並重新部署** ——
 * 它收到不認得的版本會整份拒收（`SUPPORTED_FORMAT`），試算表會停止更新。
 *
 * 4（2026-09-06）：每一筆得選的擇一池底下多一列「這一天用了哪一台」。
 * 她的原話：「我希望能像二返那些註記一樣，就是在當天的那一列下面，可以註記
 * 是 ILIB sis indiba 等等」。**不塞進 `followupNotes`** —— `.gs` 把那一份
 * 全部畫在同一列，同一個 `dateIndex` 後面的會蓋掉前面的，而一位客戶同一天
 * 做了健檢又做了四選一是會發生的。
 *
 * 5（2026-09-16）：每一筆額度底下多一列「那一段記了什麼」（`slotNotes`）。
 * 起點是「家屬用本人的名額」—— app 裡沒有地方寫「實際來的是誰」，而她
 * 2026-09-16 選的是寫在那一段的記一句（ADR-0084）並且推上試算表：
 * 「希望是可以⋯⋯記在當天那一列的下面」。**同一個模子的第二次用**，
 * 理由跟格式 4 一模一樣，所以它也不塞進 `followupNotes`。
 *
 * 6（2026-09-24）：來訪紀錄每一段多一格 `status`（取消的段不再送），`.gs` 把日期自己排一行、
 * 底下一段一行；每一位多一份 `purchases`（「買過什麼」一天一行，ADR-0115）。她的原話：
 * 「能不能就是第一行是日期，然後換行後在寫每一段」「app中買過什麼那邊的資訊，我也想在試算表中看到」
 *（`.scratch/asks-2026-09-24-evening/issues/03、04`）。
 */
export const SYNC_FORMAT = 6;

/**
 * 每一位客戶在試算表上那一張分頁叫什麼。**只有真的撞名的那幾位加尾巴**，其餘一個字都不變。
 *
 * 分頁名就是客戶名（`.gs` 的 `sheetNameFor()`），而同名只提醒、照樣存得下去（ADR-0102）——
 * 第二位會把第一位剛畫好的那一張清掉重畫（prelaunch-audit-2026-09-23/issues/06）。
 * 尾巴先用病歷號（她認得），沒有或也撞了就用 id 的前幾碼。**每次推都要一樣**，
 * 不然 `removeStaleSheets()` 每次都刪掉重建 —— 所以不能用排序的位置。
 *
 * 分頁名最長 90 字：尾巴接在截過的名字後面，截字不會把兩位截回同一個。
 *
 * 已知的限制：比的是去掉頭尾空白的名字，不是 `.gs` 換掉 `/:*?[]'` 之後的 ——
 * 「A/B」與「A-B」兩位還是會撞，真的遇到再照 `sheetNameFor()` 的規則比。
 *
 * @returns {Map<string, string>} 客戶 id → 分頁名
 */
function sheetNames(customers) {
  const byName = new Map();
  for (const c of customers) {
    const key = String(c.name ?? '').trim();
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }
  const out = new Map();
  for (const [name, group] of byName) {
    if (group.length === 1) {
      out.set(group[0].id, group[0].name ?? '');
      continue;
    }
    const firstNo = (c) => chartNosOf(c)[0] ?? null;
    const nos = group.map(firstNo);
    for (const c of group) {
      const no = firstNo(c);
      const tail = no && nos.filter((x) => x === no).length === 1 ? no : String(c.id).slice(0, 6);
      out.set(c.id, `${name.slice(0, 88 - tail.length)}（${tail}）`);
    }
  }
  return out;
}

/**
 * 推給 Apps Script 的整包內容。**整包**是刻意的 —— 它是冪等的，
 * 漏推一次下一次會補回來，不需要在兩邊維護「哪些變了」。
 *
 * @param {object} ctx
 * @param {object[]} ctx.customers
 * @param {Record<string, object[]>} ctx.entitlementsBy 客戶 id → 額度
 * @param {Record<string, object[]>} ctx.visitsBy       客戶 id → 來訪
 * @param {string} ctx.today
 * @param {object} [ctx.master] config.loadAll() 的結果，用來把 id 換成名字（治療師在 staff 底下）
 * @param {string} [ctx.generatedAt]
 */
export function syncBundle({
  customers = [], entitlementsBy = {}, visitsBy = {}, tasksBy = {}, today,
  master = {}, generatedAt = '',
}) {
  const nameOf = (type, id) =>
    (master[type] ?? []).find((x) => x.id === id)?.name ?? null;

  // 課程刻意連已刪除的一起收：主檔把健檢刪掉，不代表已經做過的那幾次
  // 就不用配二返了。少讀那一筆的代價是註記無聲消失。
  const coursesById = Object.fromEntries((master.courses ?? []).map((c) => [c.id, c]));
  const staffById = Object.fromEntries((master.staff ?? []).map((x) => [x.id, x]));

  const sorted = customers
    .filter((c) => !c.deletedAt)
    .slice()
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-TW'));

  const tabName = sheetNames(sorted);
  const sheets = sorted.map((customer) => {
    const visits = (visitsBy[customer.id] ?? [])
      .filter((v) => isActive(v) && isValidDate(v.date));
    const alive = (entitlementsBy[customer.id] ?? []).filter((e) => !e.deletedAt);
    const dates = [...new Set(visits.map((v) => v.date))].sort();

    // 營養品不進矩陣（格式 3 起）—— 它自己一區。留在矩陣裡的話那四個數字欄
    // 印的是月數，而「應有 2 已完成 0 已排未上 0 剩餘 2」沒有一個看得懂。
    const scheduled = alive.filter((e) => !isProduct(e));

    const rows = scheduled.map((e) => {
      const c = counts(e, visits, e.id);
      return {
        label: e.label ?? '',
        total: c.total,
        done: c.done,
        booked: c.booked,
        remaining: c.remaining,
        marks: dates.map((date) => mark(visits, e.id, date)),
      };
    });

    // 「這一天用了哪一台」（格式 4 起）。一筆額度一列，畫在它那一列的正下方 ——
    // 帶 `label` 是因為一位客戶可能同時有四選一與三選一，兩列都要註記時
    // 得分得出來。
    const equipmentNotes = scheduled
      .map((e, rowIndex) => ({
        // **帶第幾列不是只帶名字**：一位客戶可能有兩筆同名的額度，
        // 而 `.gs` 要把這一列畫在**那一列的正下方**（她的原話）。
        rowIndex,
        label: e.label ?? '',
        cells: equipmentCells(e, visits, dates, master.equipment ?? []),
      }))
      .filter((x) => x.cells.length);

    // 「那一段記了什麼」（格式 5 起）。跟上面那一份同一個形狀、同一個理由 ——
    // `.gs` 把它畫在那一列的正下方。**每一筆額度都問**（不像器材那一份只問
    // 得選的擇一池）：一句話可以記在任何一段上。
    const slotNotes = scheduled
      .map((e, rowIndex) => ({
        rowIndex,
        label: e.label ?? '',
        cells: slotNoteCells(e, visits, dates),
      }))
      .filter((x) => x.cells.length);

    return {
      name: tabName.get(customer.id),
      source: customer.source ?? '',
      membershipExpiresAt: customer.membershipExpiresAt ?? '',
      flags: customer.flags ?? [],
      notes: customer.notes ?? '',
      dates,
      dateLabels: dates.map(shortDate),
      rows,
      equipmentNotes,
      slotNotes,
      // 「買過什麼」一天一行（格式 6，ADR-0115）。畫在營養品那一區上面
      purchases: purchaseLines(alive, master),
      // 營養品自己一區（格式 3 起）。它以前混在 `rows` 裡，而那幾個數字欄
      // 印的是月數 —— 一個都看不懂。這一區帶金額、哪幾款、哪天給了。
      products: alive.filter(isProduct).map((e) => {
        const gave = deliveryState(e);
        return {
          label: e.label ?? '',
          amount: amountOf(e),
          months: monthsOf(e),
          items: itemsOf(e).map((x) => x.name).filter(Boolean),
          // 「還差什麼」是她要回去補的東西，所以整句話都送過去
          delivery: gave.text,
          // **已經是 `8/20` 這種她自己的寫法**（`docs/legacy/README.md` 第 6 節，
          // 舊表上一個 ISO 日期都沒有），跟貼上那條路同一支 `monthDay()`。
          // 以前這裡原樣送 `2026-08-20`，於是同一份營養品在「手動貼上」印
          // `8/20`、在「自動推送」印 `2026-08-20` —— 而這一支的檔頭寫著
          // 兩條路必須長一樣。`.gs` 一個日期都不格式化，同它一個數字都不算。
          deliveredAt: gave.at ? monthDay(gave.at) : null,
          done: gave.state === 'all',
        };
      }),
      // 營養品**有那一列**（她的舊表第 12 列就是它，ADR-0024），
      // 但**不進合計** —— 那一行寫的是「剩餘 N 次」，而兩罐夜態美不是兩次。
      totals: rows.reduce((t, r) => ({
        total: t.total + r.total,
        done: t.done + r.done,
        booked: t.booked + r.booked,
        remaining: t.remaining + r.remaining,
      }), { total: 0, done: 0, booked: 0, remaining: 0 }),
      // 二返約在哪天，寫在**那次健檢被勾起來的那一欄**底下 —— 她原本就是這樣記的
      // （docs/legacy/README.md 第 6 節）。
      followupNotes: followupNotes({ alive, visits, dates, coursesById, staffById }),
      // 舊表的 TODO / FINISH 兩塊。差別是這裡由 app 填，她不用回來勾 ——
      // 舊表那些框她從來不勾，所以 FINISH 永遠是空的（同上）。
      tasks: taskBlocks(tasksBy[customer.id] ?? [], visits,
        { courses: master.courses ?? [], equipment: master.equipment ?? [] }),
      // 每一次來訪那天到底做了什麼、誰做的、在哪一間 —— 舊表從來記不住的東西。
      //
      // **取消的段不寫、每一段帶它自己的狀態、照開始時間排**（格式 6，
      // `.scratch/asks-2026-09-24-evening/issues/03`）。她：「如果取消了可以標註或是就不寫，
      // 也可以在這些來訪紀錄中標記狀態嗎?」→「不寫」—— 跟整天取消本來就不進來同一條。
      // 照時間排是因為新的段一律接在尾巴（`hasNewSlots()` 靠它），改期之後順序不是時間的順序。
      log: dates.map((date) => ({
        date,
        label: shortDate(date),
        items: visits
          .filter((v) => v.date === date)
          .flatMap((v) => (v.slots ?? [])
            .filter((slot) => slotStatus(v, slot) !== 'cancelled')
            .map((slot) => ({ v, slot })))
          .sort((a, b) => String(a.slot.startsAt ?? '99:99').localeCompare(String(b.slot.startsAt ?? '99:99')))
          .map(({ v, slot }) => ({
            // 字跟日曆、客戶詳情同一組（`STATUS_VIEW` 的 short）
            status: shortStatus(slotStatus(v, slot)),
            course: slot.courseName ?? nameOf('courses', slot.courseId) ?? '',
            time: timeLabel(slot),
            equipment: nameOf('equipment', slot.equipmentId),
            ivProduct: nameOf('ivProducts', slot.ivProductId),
            room: nameOf('rooms', slot.roomId),
            bed: slot.bed ?? null,
            therapist: nameOf('staff', slot.therapistId),
            // 醫師和治療師都住在 staff 底下，但它們是兩種人，各印各的 ——
            // 二返有醫師沒有治療師，復能反過來（CONTEXT.md）。
            doctor: nameOf('staff', slot.doctorId),
          })),
      })).filter((d) => d.items.length),
    };
  });

  return {
    format: SYNC_FORMAT,
    generatedAt,
    today,
    notice: READONLY_NOTICE,
    legend: MARK_LEGEND,
    sheets,
  };
}

/**
 * 「買過什麼」那一段，一天一行：`0723　新8萬方案　（微調：SIS(60) 本來 20 → 23）`。
 *
 * **跟 app 那一頁同一支算**（`purchaseDays()`）：日期、摘要、微調一個字都不自己組 ——
 * 同一件事兩份算法，遲早有一份少了微調或套數（ADR-0115）。營養品不在這裡（它自己一區），
 * 沒有購買日的收在最後一行，寫「沒有日期」（同那一頁）。那一行在這裡組好，`.gs` 一個字都不組。
 *
 * @param {object[]} entitlements 那一位還活著的額度
 * @param {object} master `config.loadAll()`（`plans`、`equipment`、`courses`、`ivProducts`）
 * @returns {string[]}
 */
export function purchaseLines(entitlements = [], master = {}) {
  return purchaseDays(entitlements, master).map((d) => {
    const when = d.unknown ? '沒有日期' : purchaseDayLabel(d.date);
    const tweaks = d.tweaks.length
      ? `（微調：${d.tweaks.map((t) => `${t.name} 本來 ${t.from} → ${t.to}`).join('、')}）`
      : '';
    return [when, d.summary || '（沒有名稱）', tweaks].filter(Boolean).join('　');
  });
}

/**
 * 一筆額度在哪幾欄用了哪一台。
 *
 * **只有得選的池才回東西**（`optionEquipmentIds.length >= 2`）：
 * 她 2026-09-06 說「如果是直接選 ILIB 或是直接選 sis indiba 那就扣那個，
 * 然後不用註記」—— 單台的池那一列的名字已經是「超磁場(60)」了。
 *
 * 寫的是**別稱**（`SIS`、`INDIBA`、`ILIB`）：她自己在行事曆與試算表上寫的
 * 就是簡寫。同一天同一筆額度有兩段就用頓號接，不要蓋掉一個。
 *
 * @returns {{dateIndex:number, text:string}[]}
 */
export function equipmentCells(entitlement, visits, dates, equipment = []) {
  if (entitlement?.type !== 'pool') return [];
  if ((entitlement.optionEquipmentIds ?? []).length < 2) return [];

  const out = [];
  dates.forEach((date, dateIndex) => {
    const names = [];
    for (const v of visits) {
      if (v.date !== date) continue;
      for (const slot of v.slots ?? []) {
        if (slot.entitlementId !== entitlement.id || !slot.equipmentId) continue;
        // **取消的那一段不印**：9/12 SIS 取消、INDIBA 做了，以前印「SIS、IND」—— 那一格只有一個 ✓
        //（`.scratch/asks-2026-09-24-evening/issues/02`）。未到的照印：那一格是 ✗，約的是哪一台有用
        if (slotStatus(v, slot) === 'cancelled') continue;
        const eq = equipment.find((x) => x.id === slot.equipmentId) ?? null;
        const name = eq ? variantName(eq, 'short', { as: 'equipment' }) : '';
        if (name && !names.includes(name)) names.push(name);
      }
    }
    if (names.length) out.push({ dateIndex, text: names.join('、') });
  });
  return out;
}

/**
 * 那一段記了什麼（格式 5 起）。形狀跟 `equipmentCells()` 一模一樣。
 *
 * 讀那一句走 `domain/visits.js` 的 `slotNote()` —— **唯一那一支**，
 * 而且舊資料退回整筆那一句（`visit.note`）的規則也在它裡面（ADR-0084）。
 *
 * **取消掉的那一段不印**：那一場沒發生，而那一格印出來的東西會讓她以為它發生了。
 *
 * 同一天同一筆額度有兩段都記了字時用換行接起來 —— 同 `followupNotes()` 的理由
 * （同一個 `dateIndex` 只能回一筆，不然 `.gs` 那側後面的會蓋掉前面的）。
 */
export function slotNoteCells(entitlement, visits, dates) {
  const out = [];
  dates.forEach((date, dateIndex) => {
    const lines = [];
    for (const v of visits) {
      if (v.date !== date) continue;
      for (const slot of v.slots ?? []) {
        if (slot.entitlementId !== entitlement.id) continue;
        if (!isLiveSlot(slot)) continue;
        const text = slotNote(v, slot);
        if (text && !lines.includes(text)) lines.push(text);
      }
    }
    if (lines.length) out.push({ dateIndex, text: lines.join('\n') });
  });
  return out;
}

/**
 * 二返註記。一行對到一欄。
 *
 * 配對走 `domain/followups.js` 的 `pairsOf()` —— 一位客戶可能買兩筆健檢，
 * 各自配各自的二返，靠 `followupForEntitlementId` 認（ADR-0022）。
 * 這裡不用課程比對，理由同那一支。
 *
 * 健檢做了 N 次就有 N 欄要註記，照日期順序配上二返的日期；
 * 還沒約的印 `二返()` —— 那個空括號是她自己的寫法，意思是「這件事還沒做」。
 *
 * 括號裡的醫師是 2026-08-20 補上的。舊表她手寫成 `7/13 二返(夏)`，
 * 在醫師進 config/staff 之前 app 記不住那個字，只能印一半
 * （docs/adr/0026-doctors-are-assignable-staff.md）。**沒選醫師就整個括號不印**，
 * 不要印一個空的 `()` —— 那在她的寫法裡是「還沒約」的意思，會反過來騙人。
 */
function followupNotes({ alive, visits, dates, coursesById, staffById = {} }) {
  // **一欄一格，格子裡可以有好幾行。**
  //
  // 以前這一支一個健檢欄位只回一筆，而手動貼上那條路是
  // `line[COUNT_COLS + note.dateIndex] = note.text` —— 後面的會蓋掉前面的。
  // 加約的三返、四返之後，同一次健檢底下會有好幾場，所以收攏一定要在這裡
  // 做完（同一個 dateIndex 只回一筆，`text` 裡面有換行），兩條路才會長一樣
  // —— 這一支的檔頭就寫著「同一份報表因為走哪條路而長得不同，她會以為
  // 其中一條壞了」。
  //
  // 換行**不需要動 `SYNC_FORMAT`**：形狀（`{dateIndex, text}`）一個欄位都沒變，
  // 而 `.gs` 那側寫那一格時本來就 `setWrap(true)`。她不用回 Google 試算表
  // 重貼腳本（`CLAUDE.md` 對格式對不上的警告：app 照樣推、`.gs` 整包拒收，
  // 而畫面上看起來跟推好了一模一樣）。
  const lines = new Map();
  const add = (dateIndex, text) => {
    if (dateIndex < 0) return;
    if (!lines.has(dateIndex)) lines.set(dateIndex, []);
    lines.get(dateIndex).push(text);
  };

  for (const pair of pairsOf(alive, coursesById)) {
    const label = coursesById[pair.followupCourseId]?.name ?? '二返';
    // **照連結配，不照位置配。** 以前這裡把健檢的日期與二返的日期各自排序，
    // 再拿第 i 個對第 i 個 —— 順序一亂就配錯，而錯了畫面上看不出來。
    // 連結在時段上（`slot.followupForVisitId`），見 `domain/followups.js`。
    const linked = pair.followup
      ? bookingsByExam(visits, pair.followup.id)
      : new Map();
    // 舊資料沒有那個欄位，所以照位置那條路留著當退路 —— 一次性回填會把
    // 猜出來的日期寫死，而猜錯的日期比空括號糟得多（同 ADR-0009 的判準）。
    const guessed = pair.followup ? bookingsOf(visits, pair.followup.id, dates) : [];
    const guessedFor = new Set(linked.keys());

    dates
      .filter((d) => examOn(visits, pair.source.id, d))
      .forEach((date, i) => {
        const exam = examOn(visits, pair.source.id, date);
        // 連結找得到就用連結的；找不到才退回照位置，而且**已經被連結認領掉的
        // 那幾場不可以再被猜一次** —— 否則同一場二返會出現在兩個健檢底下。
        const hit = (exam && linked.get(exam.id))
          ?? (exam && guessedFor.has(exam.id) ? null : takeUnlinked(guessed, linked, i));
        const doctor = hit?.doctorId ? (staffById[hit.doctorId]?.name ?? null) : null;
        const at = dates.indexOf(date);

        add(at, hit
          ? `${monthDay(hit.date)} ${label}${doctor ? `(${doctor})` : ''}`
          // 空括號在她的寫法裡就是「還沒約」的意思（ADR-0026），
          // 所以這裡刻意保留 —— 它不是漏印，它是一個訊息。
          : `${label}()`);

        // 加約的三返、四返……接在二返底下，同一格、照返數由小到大。
        //
        // **還沒約的 n返 不會出現**（二返有 `二返()` 那個空括號）：二返是一定
        // 要約的，所以「沒有」是一件待辦；n返 是加約的，「沒有三返」是常態，
        // 印一個空的 `三返()` 等於每一位客戶的表上都多一行永遠做不完的事。
        //
        // 第三個參數傳空陣列 —— 那一支靠它認二返，不給就只回 n返，
        // 而二返上面那一行已經印過了。
        if (!exam) return;
        for (const extra of followupsOfExam(exam.id, visits, [])) {
          const who = extra.slot.doctorId ? (staffById[extra.slot.doctorId]?.name ?? null) : null;
          // 醫師還沒定就印空括號 —— **這一種空括號是有意義的**：
          // 那一場已經約了（日期就在前面），只是醫師還沒挑。
          add(at, `${monthDay(extra.visit.date)} ${nthLabel(extra.nth)}${who ? `(${who})` : '()'}`);
        }
      });
  }

  return [...lines.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dateIndex, texts]) => ({ dateIndex, text: texts.join(NL) }));
}

/**
 * 這一筆二返額度被排在哪幾天，照它指到的那一次健檢收成一張表。
 *
 * @returns {Map<string, {date:string, doctorId:string|null}>} 健檢來訪 id → 那一場二返
 */
function bookingsByExam(visits, followupEntitlementId) {
  const out = new Map();
  for (const v of visits ?? []) {
    for (const slot of v.slots ?? []) {
      if (slot.entitlementId !== followupEntitlementId || !slot.followupForVisitId) continue;
      // 取消、未到的那一場不算約好了（`holdsExam()`，ADR-0112）—— 印成 `二返()`，
      // 跟約二返那一張待辦講同一句話
      if (!holdsExam(v, slot)) continue;
      // 同一次健檢被指了兩次是資料有問題，取第一個 —— 那要在資料健檢頁被看見，
      // 不是在報表上被展開（同 `bookingsOf()` 的判斷）。
      if (!out.has(slot.followupForVisitId)) {
        out.set(slot.followupForVisitId, { date: v.date, doctorId: slot.doctorId ?? null });
      }
    }
  }
  return out;
}

/** 照位置配的退路：第 i 個，但已經被連結認領掉的那幾場跳過。 */
function takeUnlinked(guessed, linked, i) {
  const taken = new Set([...linked.values()].map((b) => b.date));
  return guessed.filter((g) => !taken.has(g.date))[i] ?? null;
}

/**
 * 這筆額度被排在哪幾天，以及那天記的是哪位醫師。
 *
 * 同一天同一筆額度理論上只會有一段（二返一次一場），真的有兩段時取第一個
 * 有醫師的 —— 挑一個總比印空的好，而兩段各記不同醫師是資料有問題，
 * 那要在資料健檢頁被看見，不是在報表上被展開。
 *
 * **只猜沒連結的那幾場**（舊資料）。連結過的（`followupForVisitId`）由 `bookingsByExam()`
 * 照連結配；它被取消或未到時那一次健檢要印 `二返()`（ADR-0112）—— 讓這一支再把那一場猜回去，
 * 那一次被取消的二返就又出現在健檢底下了。
 *
 * **沒連結的那幾場也只猜佔著的**（`holdsExam()`）：舊資料上一場取消的二返，照位置猜的話會被當成
 * 約好了（`.scratch/asks-2026-09-24-evening/issues/02`）。
 */
function bookingsOf(visits, entitlementId, dates) {
  const mine = (v, s) => s.entitlementId === entitlementId && !s.followupForVisitId && holdsExam(v, s);
  const unlinkedOn = (d) => visits.some((v) => v.date === d && (v.slots ?? []).some((s) => mine(v, s)));
  return dates
    .filter(unlinkedOn)
    .map((date) => ({
      date,
      doctorId: visits
        .filter((v) => v.date === date)
        .flatMap((v) => (v.slots ?? []).filter((s) => mine(v, s)))
        .find((slot) => slot.doctorId)?.doctorId ?? null,
    }));
}

/**
 * TODO 與 FINISHED 兩塊。
 *
 * 一列的寫法照舊表：`{M/D} {療程名}` 加上任務種類。**中間有一個空白** ——
 * 舊表沒有，所以 `7/6` 加 `0.75萬健檢` 會黏成 `7/60.75萬健檢`，很難讀。
 *
 * 日期取的是**來訪那一天**，不是死線 —— 她認的是「哪一天那一場」，
 * 而死線是它的前一天，兩個差一天最容易看錯人。來訪找不到（獨立待辦、
 * 來訪被刪了）才退回用死線。
 */
function taskBlocks(tasks, visits, master = null) {
  const visitById = Object.fromEntries(visits.map((v) => [v.id, v]));
  const alive = (tasks ?? []).filter((t) => !t.deletedAt);

  const line = (t) => {
    // 哪一天、哪一場走 `todoFlow.js` 的 `taskLine()` —— 客戶詳情與待辦中心
    // 讀的是同一支。以前這裡自己算了一次同樣的東西，而「日期取來訪那一天
    // 不是死線」這個判斷只要有兩份，就會有一份差一天。
    const { date, what } = taskLine(t, visitById[t.visitId], master);
    return {
      label: [date ? monthDay(date) : '', what].filter(Boolean).join(' '),
      kind: t.kind ?? '',
      dueDate: t.dueDate ?? '',
      doneAt: t.doneAt ?? '',
      note: t.note ?? '',
    };
  };

  return {
    todo: alive.filter((t) => !t.done).sort(byDue).map(line),
    finished: alive.filter((t) => t.done).sort(byDoneDesc).map(line),
  };
}

const byDue = (a, b) => String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? ''));
const byDoneDesc = (a, b) => String(b.doneAt ?? '').localeCompare(String(a.doneAt ?? ''));

// ---------- 自動同步現在是什麼狀態 ----------

/**
 * `#/settings/report` 那張「自動同步」的卡現在該說哪幾句。
 *
 * 為什麼是一支純函式而不是寫在那張卡裡：**「還沒推」和「推了但被拒絕」是兩件事**，
 * 而她的處理方式完全不同 —— 前者等一下就好，後者要她去看設定或重新部署 `.gs`。
 * 這兩句講反了正是 `.scratch/first-real-import/issues/02` 要修的東西，
 * 而 `data/sheetSync.js` 那一層在 node 裡跑不起來（它一路 import 到 firebase 的
 * CDN 網址），所以規則放在這裡才測得到。
 *
 * 時間一律由呼叫端格式化好再傳進來 —— `toLocaleString()` 的結果跟著裝置的
 * 時區與語系走，寫在純函式裡就等於寫了一個在別台機器上會變的東西。
 *
 * @param {object} state
 * @param {boolean} state.configured      網址與密鑰都填了
 * @param {string|null} [state.lastAtLabel] 上次推成功的時間，已經格式化好
 * @param {boolean} [state.dirty]         有資料還沒推上去
 * @param {string|null} [state.error]     上次被拒絕的原因
 * @param {string|null} [state.errorAtLabel] 上次被拒絕的時間，已經格式化好
 * @param {string[]} [state.skipped]      沒有更新到的分頁名字
 * @returns {{tone: 'off'|'ok'|'waiting'|'partial'|'failed', lines: string[]}}
 */
/** `.gs` 拒收時那句話裡會有的字。兩邊的訊息只要提到版本就算。 */
const VERSION_HINT = /格式版本|只認得/;

export function describeSync({
  configured = false, lastAtLabel = null, dirty = false,
  error = null, errorAtLabel = null, skipped = [],
} = {}) {
  if (!configured) {
    return { tone: 'off', lines: ['沒有開。網址與密鑰兩個欄位都填了才會開始推。'] };
  }

  const lines = [`上次同步 ${lastAtLabel ?? '還沒推過'}`];
  let tone = 'ok';

  if (error) {
    tone = 'failed';
    lines.push(`上次推送被拒絕${errorAtLabel ? `（${errorAtLabel}）` : ''}：${error}`);
    // 這一句是為了擋掉「那我剛剛存的東西是不是也沒進去」那個念頭。
    // 資料在 Firestore 裡是安全的（ADR-0013），錯的是試算表上那一份。
    lines.push('資料在 app 裡是安全的，沒推出去的是報表 —— 試算表上那份現在是舊的。');
    // **版本對不上要講出她該做什麼。** `.gs` 那句話講的是原因
    //（「這份指令碼只認得 3」），而她要的是下一步。這是 app 升版之後
    // 最可能踩到的一種失敗，而且不做那一步試算表會一直停在舊的。
    if (VERSION_HINT.test(error)) {
      lines.push('到 Google 試算表 → 擴充功能 → Apps Script，'
        + '把 sheets/readonly-report.gs 整份重新貼一次，然後重新部署。');
    }
  } else if (dirty) {
    tone = 'waiting';
    lines.push('有資料還沒推上去，安靜幾秒會自己再推一次。');
  }

  if (skipped.length) {
    if (tone !== 'failed') tone = 'partial';
    lines.push(`另外有 ${skipped.length} 張分頁沒有更新：${skipped.join('、')}。`
      + '試算表上那幾張認不出來是系統畫的，所以不敢清空重畫 —— 那幾位的次數還是舊的。'
      + '到試算表把它們改名或刪掉，下次推送就會重畫。');
  }

  return { tone, lines };
}
