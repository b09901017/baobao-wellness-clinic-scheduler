// 一列任務。**客戶詳情與待辦中心的「依客戶」抽屜共用這一份。**
//
// 這一列自己就講得完：哪一種、哪一天那一場、死線、做完了沒。
// 她的原話是「例如 Examine・9/1・二返」—— 種類正常粗細，後面那一串淡一級，
// 因為種類才是她在掃的東西。
//
// ## 為什麼要共用
//
// 2026-09-02 之前這個樣子只有客戶詳情有。待辦中心的「依客戶」那一格點下去
// 會跳到客戶詳情，所以她**看得到這個樣子**，只是要先離開待辦中心。
// 那一格改成原地展開抽屜之後，如果抽屜自己畫一份，這個 repo 就會有第三份
// 任務列的寫法（待辦中心那一頁還有一份多選用的），而三份遲早有一份
// 會用死線當日期 —— 死線是來訪日的前一天，兩個差一天最容易看錯人。
//
// 「哪一天、哪一場」一律走 `domain/taskRules.js` 的 `taskLine()`，
// 試算表的 TODO 區讀的也是同一支。這一支不自己判斷日期。

import { esc } from './form.js';
import { taskLine } from '../../domain/taskRules.js';
import { untickConsequences } from '../../domain/consequences.js';
import { shortDate } from '../../domain/dates.js';
import { previewTaskChange } from '../../data/visits.js';
import { confirmAction } from './dialog.js';
import { icon } from '../icons.js';

/**
 * @param {object} task
 * @param {object|null} [visit] 那一筆來訪。呼叫端手上本來就有，所以這裡不去讀
 *   —— 任務身上沒有來訪日與課程名，也不該有（`data/tasks.js` 的檔頭）。
 * @param {object} [opts]
 * @param {{booked:boolean, text:string}|null} [opts.booking]
 *   「約二返」那一列右邊那顆丸子（`bookingStateForTask()` 的結果）。
 *   **算不出來就傳 null，那一列什麼都不說** —— 斷言「還沒約」會讓她照著去多約一場。
 * @param {string} [opts.actions] 「詳情 ›」左邊要不要再插一顆按鈕（例：去壓表）
 * @param {boolean} [opts.link] 要不要那顆「詳情 ›」。預設要
 */
export function taskRow(task, visit = null, { booking = null, actions = '', link = true } = {}) {
  const line = taskLine(task, visit);
  // 來訪找不到（獨立待辦、來訪被刪了）就什麼都不接：右邊那顆丸子已經在講
  // 死線了，這裡再印一次死線只是把同一件事講兩遍，而且看起來像來訪日。
  const tail = line.fromDue
    ? ''
    : [shortDate(line.date), line.what].filter(Boolean).join('・');

  return `
    <div class="taskrow ${task.done ? 'taskrow--done' : ''}">
      <button class="note ${task.done ? 'note--done' : ''}" type="button"
              data-task="${esc(task.id)}" style="flex: 1; min-width: 0">
        <span class="note__box">${icon('check', { size: 13, width: 3.2 })}</span>
        <span class="note__main">
          <span class="note__text">${esc(line.kind)}${
            tail ? `<span class="note__sub">・${esc(tail)}</span>` : ''}</span>
          ${task.note ? `<span class="note__note">${esc(task.note)}</span>` : ''}
        </span>
        <span class="notetags">
          ${booking
            ? `<span class="notetag ${booking.booked ? 'notetag--ok' : 'notetag--warn'}">${
                esc(booking.text)}</span>`
            : ''}
          ${/* 日期一律走 shortDate()：全站別的地方寫的都是「8/30(日)」，
                 只有這一列印原始的 2026-08-30，看起來像另一種東西 */''}
          <span class="notetag ${!task.done && task.dueDate ? 'notetag--date' : ''}">${
            task.done ? '已完成' : `死線 ${esc(task.dueDate ? shortDate(task.dueDate) : '—')}`}</span>
        </span>
      </button>
      ${actions}
      ${link && task.visitId
        ? `<button class="taskrow__link" type="button" data-task-visit="${esc(task.visitId)}">
             詳情${icon('right', { size: 14 })}</button>`
        : ''}
    </div>`;
}

/**
 * 抽屜裡「這一件要去別的地方做」那種列。
 *
 * 「跟客人確認時間」與「簽療程單」都不是任務，也都不是一個布林值 ——
 * 前者要把所有時段攤開逐筆退回，後者要逐段記結果（ADR-0025）。
 * 硬做成勾選框的話，她點下去會以為事情做完了。
 *
 * 所以它們長得像一條路：右邊一個「›」，點下去換到**做那件事的地方**。
 * 跟上面那種勾得掉的列之間要有一條分隔線，見 `app.css` 的 `.tasklist__wayto`。
 */
export function wayRow({ label, note = '', hint = '', href, count = null }) {
  return `
    <a class="wayrow" href="${esc(href)}">
      <span class="wayrow__main">
        <span class="wayrow__label">${esc(label)}${
          count == null ? '' : `<span class="wayrow__n num">${count}</span>`}</span>
        ${note ? `<span class="wayrow__note">${esc(note)}</span>` : ''}
        ${hint ? `<span class="wayrow__hint">${esc(hint)}</span>` : ''}
      </span>
      ${icon('right', { size: 18 })}
    </a>`;
}

/**
 * 拿回一張已經勾掉的待辦之前要不要先問一句。**三個入口共用這一支。**
 *
 * 待辦中心的已完成那一格、待辦中心「依客戶」的抽屜、客戶詳情各接一次的話，
 * 就是這個 repo 已經付過兩次帳的形狀（`buy.js` 的「其他…」漏了兩次、
 * `note.js` 的 `.notemeta` 有兩個入口裸放）。
 *
 * ## 只有兩種會問
 *
 * 鏈上那兩種（追蹤健檢報告、約二返）拿回來會收掉別的張；其餘什麼都不會發生。
 * `previewTaskChange()` 對非鏈上的種類直接回 `null`，所以那幾種**連一次讀取
 * 都不會多打**。
 *
 * ## 讀不到就放行
 *
 * 網路不通的時候擋住她「拿回來」沒有道理 —— 那個動作本身在離線時照樣寫得進
 * 本機快取（`ui/toast.js` 的檔頭）。問不出後果就不問，不要變成一道
 * 「網路不好就做不了事」的閘門。
 *
 * @param {object} task 那一張待辦（勾選之前的樣子）
 * @param {boolean} done 要變成什麼。`true`（勾掉）一律放行 —— 這一支只管拿回來
 * @returns {Promise<boolean>} 可以做了嗎
 */
export async function confirmUntick(task, done = false) {
  if (done || !task) return true;

  let preview;
  try {
    preview = await previewTaskChange(task, false);
  } catch {
    return true;
  }

  const said = untickConsequences({ task, preview });
  if (!said) return true;

  return confirmAction({
    title: said.title,
    consequences: said.lines,
    confirmLabel: '還是拿回來',
    danger: said.danger,
  });
}
