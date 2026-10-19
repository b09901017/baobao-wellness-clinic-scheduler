// 可以複製到 LINE 的訊息框。
//
// 三個地方要用同一顆按鈕（首頁的今天壓了誰、客戶詳情、時段反查），
// 而真正麻煩的不是按鈕本身，是 iOS 的剪貼簿：在非安全情境或沒有使用者手勢時
// navigator.clipboard 會直接丟例外，那時要退回「幫她選起來讓她長按複製」。
// 這段邏輯抄三份就會有兩份忘記處理。
//
// 訊息內容一律**可以改**：產生的是草稿不是定稿（domain/messages.js），
// 她想加一句「不好意思這麼晚打擾」是很正常的事。
//
// 「打開 LINE」那一顆（`line`，ADR-0157）：跟客人確認時間、問這輪的時間那兩張卡有給。它送的是
// **這一格現在的字**，交給手機上的 MacroDroid 打開那一位的對話、貼上（不送出）；怎麼叫、叫不到
// 怎麼退都在 `integrations/lineMacro.js`。屬性用自己的前綴（`data-msg-line`），不用頁面的名字。

import { esc } from './form.js';
import { openLineChat } from '../../integrations/lineMacro.js';

/**
 * @param {object} opts
 * @param {string} opts.id 同一頁裡不重複就好
 * @param {string} opts.text 訊息內容
 * @param {string} [opts.label] 標題
 * @param {boolean} [opts.collapsed] 收起來，展開才看得到內容。
 *   一頁有很多則時（首頁一次十幾位客戶）用這個，不然整頁都是文字框。
 * @param {string} [opts.buttonLabel]
 * @param {{name: string}} [opts.line] 給了就在「複製」旁邊多一顆「打開 LINE」：交給手機上的 MacroDroid
 *   打開那一位的對話、把**這一格現在的字**貼上（不送出，ADR-0157）。`name` 是客戶身上的 LINE 名字，
 *   空的照樣畫（按了講去哪裡填）；**讀不到那位客戶的時候不要給**（講「還沒填」是假話）
 */
export function box({ id, text, label = '', collapsed = false, buttonLabel = '複製訊息', line = null }) {
  const area = `
    <textarea class="msg" rows="3" data-msg="${esc(id)}">${esc(text)}</textarea>`;

  return `
    <div class="msg-box">
      ${collapsed
        ? `<details data-msg-wrap="${esc(id)}">
             <summary class="muted">${esc(label || '先看一下訊息')}</summary>
             ${area}
           </details>`
        : `${label ? `<div class="field__label">${esc(label)}</div>` : ''}${area}`}
      <p class="form__actions">
        <button class="btn" type="button" data-copy="${esc(id)}">${esc(buttonLabel)}</button>
        ${line ? `<button class="btn" type="button" data-msg-line="${esc(id)}"
                          data-msg-line-name="${esc(line.name ?? '')}">打開 LINE</button>` : ''}
      </p>
    </div>`;
}

/**
 * 把容器裡所有訊息框的複製按鈕接起來。
 *
 * @param {HTMLElement} el
 * @param {(message:string) => void} notify 成功或退而求其次時要說的話
 */
export function wire(el, notify) {
  el.querySelectorAll('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', () => copy(el, btn.dataset.copy, notify)),
  );
  // 送出去的是她改過之後的字（那一格本來就可以改），不是當初產生的那一份
  el.querySelectorAll('[data-msg-line]').forEach((btn) =>
    btn.addEventListener('click', () => openLineChat({
      name: btn.dataset.msgLineName,
      msg: el.querySelector(`[data-msg="${CSS.escape(btn.dataset.msgLine)}"]`)?.value ?? '',
      notify,
    })),
  );
}

/**
 * 她改過的訊息，跨整頁重畫留著（line-macrodroid 06）。
 *
 * 用到這個元件的兩頁（確認時間、問這輪的時間）每一次互動都整頁換掉，textarea 跟著回到產生的那一份 ——
 * 她改了訊息、開一次抽屜，改的字就沒了，「打開 LINE」送出去的是沒改過的。
 *
 * - `keep(el)`：重畫之前叫。畫面上**改過的**（跟產生的時候不一樣）或**展開著的**那幾則記下來；
 *   畫面上沒改、收著的那幾則拿掉（她改回去、收起來了）。**不在畫面上的照舊留著** ——
 *   問這輪的時間切到另一個分段時那一張不在畫面上，切回來還要在
 * - `restore(el)`：畫完之後叫。**那一則本來的樣子變了就不帶**（新產生的 ≠ 記下的那一份）而且丟掉：
 *   她確認了其中一段、訊息少了一段，她改的是舊的那一段 —— 帶回來就是把一段已經談定的時間又問一次
 *
 * 一頁一份，**從待辦中心點進來時換一份新的**（呼叫端管）：昨天沒送的那一段，今天不該自己跑回來。
 */
export function editStore() {
  /** @type {Map<string, {base: string, value: string, open: boolean}>} */
  const kept = new Map();
  return {
    keep(el) {
      el?.querySelectorAll('textarea[data-msg]').forEach((area) => {
        const open = Boolean(area.closest('details')?.open);
        if (area.value !== area.defaultValue || open) {
          kept.set(area.dataset.msg, { base: area.defaultValue, value: area.value, open });
        } else {
          kept.delete(area.dataset.msg);
        }
      });
    },
    restore(el) {
      kept.forEach(({ base, value, open }, id) => {
        const area = el?.querySelector(`textarea[data-msg="${CSS.escape(id)}"]`);
        if (!area) return;
        if (area.defaultValue !== base) {
          kept.delete(id);
          return;
        }
        area.value = value;
        const wrap = area.closest('details');
        if (wrap && open) wrap.open = true;
      });
    },
  };
}

async function copy(el, id, notify) {
  const area = el.querySelector(`[data-msg="${CSS.escape(id)}"]`);
  const text = area?.value ?? '';
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    notify?.('已複製，貼到 LINE 就可以送出');
  } catch {
    // iOS 在非安全情境或沒有使用者手勢時會擋剪貼簿。
    // 退而求其次：把訊息選起來讓她長按複製，而不是安靜失敗。
    const wrap = area.closest('details');
    if (wrap) wrap.open = true;
    area.select();
    notify?.('複製被瀏覽器擋下來了，訊息已經選起來，長按複製');
  }
}
