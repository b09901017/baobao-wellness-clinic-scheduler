// 「這一場走到哪了」—— 一筆來訪的讀取卡片底下那一小塊。
//
// 她的原話：
//
// > 點開日曆抽屜查看某一筆預約的詳情時，直接在詳情區塊列出「該預約所屬的所有
// > 待辦項目及其執行狀態」，讓管理師不需要跳轉至待辦中心。
//
// ## 只給看，不給勾
//
// 她 2026-09-04 選的。所以這裡**一個 `<input type="checkbox">` 都不會有** ——
// 一放勾選框她就會去點它，而點不動的勾選框是這張卡片上最糟的東西。
// 記號用 `✓` / `○` 兩個字元，不用表單元件。
//
// 要勾的地方一個都沒有變：待辦中心、客戶詳情，還有日曆上那一列長按。
//
// ## 它只長在「這一段」那一張上
//
// 她 2026-09-08：「會顯示『這一天的代辦』但其實不是這一天，現在已經是一項
// 一項分開來看了，所以應該要叫做這一項的代辦之類的」。當時的答案是抬頭兩種
// 說法各自成立（帶了段落就「這一項」，沒帶就「這一天」）。
//
// **2026-09-12 那一半沒有了。** 她：「如果是一整天的詳情，那也請不要呈現
// "這一天的待辦"和SOP，直接呈現那幾個分段讓我點就好，點進去再呈現那項的
// 詳情」。所以沒指定哪一段的那一張是**一張目錄**，這一塊整塊不畫，
// 抬頭也只剩「這一項的待辦」一種說法。
//
// 「那一天只有一段」不算目錄 —— `focusFor()` 會把它解成第 0 段
// （那時候「這一天」與「這一段」是同一件事）。
//
// ## 它長在四個畫面上，那是刻意的
//
// 這一塊接在 `visitReadHtml()` 裡面，而那一支是日曆、客戶詳情、待辦中心、
// 進度追蹤共用的（ADR-0018、0056）。同一筆來訪在四個畫面上看到的東西
// **本來就該一模一樣** ——「這一場的行政進度」不是日曆才要回答的問題。
//
// 客戶詳情頁上面另外有一整區任務，看起來像講兩次，但那兩個問的不是同一句話：
// 上面那一區問「這位客戶身上還有什麼沒做」，這一塊問「**這一場**走到哪」。
//
// 規則一條都不在這裡，全部在 `domain/todoFlow.js` 的 `todosForVisit()`。

import { esc } from './form.js';
import * as tasksData from '../../data/tasks.js';
import * as customersData from '../../data/customers.js';
import { todosForVisit } from '../../domain/todoFlow.js';
import { urgency, RECORD_TASK_KIND } from '../../domain/taskRules.js';
import { shortDate } from '../../domain/dates.js';

/**
 * @param {object} o
 * @param {object} o.visit
 * @param {object[]} [o.tasks] 這一筆來訪的任務（含已完成的）。
 *   **`undefined` 與 `[]` 是兩件事**：前者是「還沒讀到」，後者是「真的一張都沒有」。
 *   還沒讀到就整塊不畫 —— 畫一個「這一場沒有待辦」出來會是一句假話。
 * @param {Record<string, object>} [o.coursesById]
 * @param {string} o.today
 * @returns {string} HTML。沒有東西可以畫時回空字串
 */
export function mirrorHtml({ visit, tasks, coursesById = {}, today, focusSlot = null } = {}) {
  if (!Array.isArray(tasks)) return '';

  // **整天那一張只是目錄**（2026-09-12）：只列那幾段讓她點，一件待辦都不畫。
  // 呼叫端進來之前已經走過 `focusFor()`，所以「那一天只有一段」在這裡是
  // 帶著 0 進來的，不會掉進這一條。
  const focused = Number.isInteger(focusSlot) && Boolean((visit?.slots ?? [])[focusSlot]);
  if (!focused) return '';

  const rows = todosForVisit(visit, { tasks, coursesById, today, focusSlot });
  // 一件都沒有就整塊不畫。**不要留一個空殼** —— 一個永遠空的區塊會讓她
  // 以為那裡壞了（同 `playbookHint.js` 的規矩）。
  if (!rows.length) return '';

  return `
    <div class="taskmirror">
      <div class="taskmirror__head">這一項的待辦</div>
      <ul class="taskmirror__list">
        ${rows.map((r) => rowHtml(r, today)).join('')}
      </ul>
    </div>`;
}

function rowHtml(row, today) {
  // 未完成的右邊印死線，逾期用同一組 `urgency()` —— 待辦中心那一列用的也是它，
  // 兩個地方對同一張待辦說的「急不急」不可以不一樣。
  const late = !row.done && row.dueDate && today && urgency(row.dueDate, today) === 'overdue';
  const when = !row.done && row.dueDate ? shortDate(row.dueDate) : '';

  // **還沒發生的那幾張**（`todosForVisit()` 的 `pending`）：她 2026-09-08 問
  // 「我發現沒有寫記錄？」—— 那一張在那一場做完之前真的不存在（ADR-0066）。
  // 列出來但要講清楚它還沒長出來，不然她會去找它在哪裡然後找不到。
  //
  // 記號用第三個字元（`·`）而不是第三種顏色：這一塊只給看不給勾，
  // 而 `✓`／`○` 兩個字元本來就是為了不放勾選框才選的。
  // **那一段取消了**（`todosForVisit()` 的 `void`，`.scratch/asks-2026-09-13/issues/03`）。
  // 她 2026-09-13：「原本的那些一樣有然後灰掉然後多了取消」。灰掉、**不劃線** ——
  // 劃線是「做完了」，灰是「不會發生了」。做過的那幾張照樣帶著它的 ✓（那件事真的做過），
  // 死線不印（不會有人去趕它）。
  if (row.void) {
    return `
      <li class="taskmirror__row is-void">
        <span class="taskmirror__mark" aria-hidden="true">${row.done ? '✓' : '○'}</span>
        <span class="taskmirror__kind">${esc(row.kind)}</span>
        <span class="visually-hidden">這一段取消了，不會做</span>
      </li>`;
  }

  if (row.pending) {
    return `
      <li class="taskmirror__row is-pending">
        <span class="taskmirror__mark" aria-hidden="true">·</span>
        <span class="taskmirror__kind">${esc(row.kind)}</span>
        <span class="visually-hidden">還沒長出來</span>
        <span class="taskmirror__due">${esc(pendingNote(row.kind))}</span>
      </li>`;
  }

  return `
    <li class="taskmirror__row ${row.done ? 'is-done' : ''}">
      <span class="taskmirror__mark" aria-hidden="true">${row.done ? '✓' : '○'}</span>
      <span class="taskmirror__kind">${esc(row.kind)}</span>
      <span class="visually-hidden">${row.done ? '已完成' : '還沒做'}</span>
      ${when ? `<span class="taskmirror__due num ${late ? 'is-late' : ''}">${esc(when)}</span>` : ''}
    </li>`;
}

/**
 * 那一張什麼時候才會長出來。**兩個時機各一句**（ADR-0027、0066）——
 * 寫「還沒發生」而不講是等什麼，等於沒講。
 */
function pendingNote(kind) {
  return kind === RECORD_TASK_KIND ? '那一場做完才有' : '客人說可以才有';
}

/**
 * 把這張卡片**要多打一趟網路才拿得到的那幾樣**讀回來，補進已經開好的那一張。
 *
 * 兩樣：這一筆的任務（上面那一塊），以及這位客戶的額度
 *（每一段底下那一行「扣 復能-三選一(60)」，ADR-0077）。
 * **兩樣一起讀、一次重畫** —— 各自 `card.update()` 的話後到的那一次會把
 * 先到的那一份洗掉，而畫面上看起來只是「那一行有時候不見」。
 *
 * **點開才讀。** 日曆一次畫三個月、待辦中心一次列十幾筆，那幾百筆的任務與
 * 額度先讀回來是白費的（同 `loadGivableBags()` 的規矩）。
 *
 * **讀不到就不畫那一塊。** 它們是輔助資訊，不是這張卡片的主體 ——
 * 同 `playbooksData.list().catch(() => [])` 的判斷。
 *
 * 客戶詳情**不走這一支**：那一頁手上本來就有這位客戶的全部任務與額度，
 * 為了同一份資料再打一次網路沒有道理（她常常在大樓裡用行動網路）。
 *
 * @param {{el:HTMLElement, update:Function}} card `openCard()` 回來的那一個
 * @param {object} visit
 * @param {(tasks:object[], extra:{entitlementsById:object}) => string} render
 *        拿到之後整塊 body 長什麼樣
 */
export function fillMirror(card, visit, render) {
  if (!visit?.id) return;
  Promise.all([
    tasksData.listByVisit(visit.id).catch(() => []),
    visit.customerId
      ? customersData.listEntitlements(visit.customerId).catch(() => [])
      : Promise.resolve([]),
  ])
    .then(([tasks, entitlements]) => {
      // 她可能在讀回來之前就關掉這張卡、或點開了另一筆
      if (!card?.el?.isConnected) return;
      card.update(render(tasks, {
        entitlementsById: Object.fromEntries((entitlements ?? []).map((e) => [e.id, e])),
      }));
    })
    .catch(() => {});
}
