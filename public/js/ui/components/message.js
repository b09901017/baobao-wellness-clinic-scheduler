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
