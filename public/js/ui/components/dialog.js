// 二次確認對話框。
//
// SPEC 第 6.5 節：確認框要顯示具體後果，不要只有「確定嗎？」。
// 所以 consequences 是必填的，不給就沒有東西可以顯示。

import { reviewWarnings } from '../../domain/consequences.js';
import { pushLayer } from '../nav.js';
import { esc } from './form.js';

/**
 * 同一時間只有一個。存的是**節點加上它的收尾函式** ——
 * 只存節點的話，被下一個對話框擠掉的那一個就沒有人替它收尾（見 `close()`）。
 *
 * @type {{el: HTMLElement, finish: Function}|null}
 */
let openDialog = null;

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string[]} opts.consequences 這個動作會造成什麼，一條一行
 * @param {string} [opts.confirmLabel]
 * @param {boolean} [opts.danger] 破壞性操作，按鈕變紅
 * @returns {Promise<boolean>}
 */
/**
 * 存檔前那一道「這幾段先看一下」（ADR-0086）。
 *
 * **兩個入口共用**（壓表、來訪編輯器）。呼叫端只回答「要不要往下走」——
 * 兩邊各自把 `reviewWarnings()` 的四個欄位攤開餵進 `confirmAction()` 的話，
 * 遲早有一邊漏掉 `cancelLabel`，而那顆按鈕就會變回意思模糊的「取消」。
 *
 * @param {string[]} warnings `validateVisit()` 回的那一份
 * @returns {Promise<boolean>} 沒有話要講就直接 `true`，不跳任何框
 */
export async function confirmReview(warnings) {
  const said = reviewWarnings(warnings);
  if (!said) return true;
  return confirmAction({
    title: said.title,
    consequences: said.lines,
    confirmLabel: said.confirmLabel,
    cancelLabel: said.cancelLabel,
  });
}

export function confirmAction({
  title, consequences, confirmLabel = '確定', cancelLabel = '取消', danger = false,
}) {
  // 參數名打錯了要當場講出來。
  //
  // 這裡以前是直接對 `consequences` 做 `.map()`，所以傳錯名字（例如寫成 `body`）
  // 會丟一個 TypeError —— 而它發生在 Promise 的執行器裡，於是那個 Promise 直接
  // reject，呼叫端寫在 `await` 之後的 `try` 接不到。畫面上的症狀是
  // **確認框一次都沒有出現、那個動作永遠做不到，而且一個字都不說**，
  // 正好是 SPEC 第 6.9 節說不可以有的靜默失敗。
  //
  // 丟一個看得懂的錯比丟 `undefined.map` 好：這種打錯字只會在開發時發生一次。
  if (!Array.isArray(consequences) || consequences.length === 0) {
    throw new Error(
      'confirmAction 需要 consequences（字串陣列）——'
      + ' SPEC 6.5：確認框要講出具體後果。參數名是 consequences 與 confirmLabel。',
    );
  }

  return new Promise((resolve) => {
    close();

    const el = document.createElement('div');
    el.className = 'dialog-backdrop';

    // **逃脫是這一層的責任，呼叫端不要自己 `esc()`。**
    //
    // 以前這裡直接內插，於是二十幾個呼叫端分裂成兩種寫法：四個自己逃脫、
    // 其餘直接把 `customer.name`、`draft.title`、`e.label` 塞進來 ——
    // 而那些全都是她自己打的自由文字。一位名字裡有 `<` 的客戶，
    // 刪除確認框就顯示不完整，**而那句話正是她判斷要不要按下去的依據**。
    //
    // 責任收在這裡是唯一講得清楚的歸屬：只有這一支知道自己在產 HTML。
    // 呼叫端傳純文字，這裡負責讓它安全地變成畫面。
    el.innerHTML = `
      <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 class="card__title" id="dlg-title">${esc(title)}</h2>
        <ul class="dialog__list">
          ${consequences.map((c) => `<li>${esc(c)}</li>`).join('')}
        </ul>
        <div class="dialog__actions">
          <button class="btn" type="button" data-cancel>${esc(cancelLabel)}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-ok>
            ${esc(confirmLabel)}
          </button>
        </div>
      </div>`;

    let settled = false;

    // 對話框也吃返回鍵，而且**返回等於取消**。這一顆很重要：破壞性操作的
    // 二次確認如果被返回鍵略過，那顆「刪除」會在她以為自己取消了的時候執行。
    const layer = pushLayer(() => finish(false, { fromBack: true }));

    // Esc 那一顆掛在 document 上，所以**不管從哪一條路關掉都要拆掉它**。
    // 以前只有「真的按了 Esc」那一條會拆，於是用叉叉或按鈕關掉的每一次
    // 都在 document 上多留一顆監聽 —— 這個 repo 已經修過三次同一種
    // 「監聽越掛越多」，而那三次都是只有把畫面真的開開關關才看得到。
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
    };

    /**
     * **唯一的出口。每一條關掉的路都要走它**，包含「被下一個對話框擠掉」
     * 那一條（見 `close()`）。少走一次就留下三樣東西：document 上的一顆
     * keydown、一層沒人收的返回鍵紀錄，以及一個永遠 pending 的 Promise ——
     * 而 `await` 它的那個呼叫端就這樣掛住了。
     *
     * 做成冪等的：連點確認鈕、或是「按了確定之後 Esc 又進來」都只算一次。
     *
     * @param {boolean} answer
     * @param {{fromBack?: boolean}} [opts]
     *   fromBack：這一下是返回鍵按的，紀錄已經退掉了，不要再退一次。
     */
    const finish = (answer, { fromBack = false } = {}) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      if (!fromBack) layer.pop();
      el.remove();
      if (openDialog?.el === el) openDialog = null;
      resolve(answer);
    };

    el.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    el.querySelector('[data-ok]').addEventListener('click', () => finish(true));
    // 點背景等於取消。破壞性操作不會因為誤觸背景而執行。
    el.addEventListener('click', (e) => {
      if (e.target === el) finish(false);
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(el);
    openDialog = { el, finish };
    el.querySelector('[data-cancel]').focus();
  });
}

/**
 * 收掉還開著的那一個。
 *
 * **走它自己的 `finish()`，不是只把節點拿掉。** 直接 `remove()` 的話那一個的
 * keydown 監聽會留在 document 上 —— 接著按 Esc 觸發的是**舊**對話框的收尾，
 * 而它又會呼叫這裡把**現在**這一個的節點移除，於是新的那個 Promise 也懸著了。
 *
 * `finish()` 進來之前先把 `openDialog` 清成 null，所以不會遞迴回來。
 */
function close() {
  const prev = openDialog;
  openDialog = null;
  prev?.finish(false);
}
