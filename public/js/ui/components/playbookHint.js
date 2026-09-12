// 備忘錄自己浮出來的那一小塊。兩個入口共用一支。
//
// 她的原話：
//
// > 我也希望能夠在點開該筆預約或日曆卡片時，自動浮現的操作小撇步，或是我記的
// > memo……然後像是點滴的「飯後打針」該何時提醒？怎麼提醒你也可以幫我設計，
// > 通常客人預約前一天或當天早上會發確認訊息，但好像也不用特別獨立開一個
// > 「提醒吃飯」的任務，避免洗版。
//
// **她選的是不開任務。** 所以這一支就是「飯後打針」那個問題的完整答案：
// 它是點滴那份備忘錄的前幾行，而它會在她正在發確認訊息的那一刻出現在畫面上。
//
// ## 洗版由行數擋，不由時機擋
//
// 第一版（2026-09-03）讓她替每一節標「事前／當天／結束後」，只浮對得上的
// 那一節。她點過之後說「不用特地幫我分什麼事前事後」，所以現在浮的是
// **整份的前幾行**（`PREVIEW_LINES`）。行數比時機好懂：她看得到自己寫的
// 第幾行會出現在卡片上，而時機要她先在腦袋裡跑一次判斷。見 ADR-0069。
//
// ## 它也認得合作機構
//
// 掛了「自然美」的那一份，會在**掛著自然美標記的客戶**身上浮出來（ADR-0076）。
// 它仍然不綁某一位客戶 —— 綁的是一家機構（跟課程一樣是主檔上的東西），
// 差別只有它是**透過客戶**浮出來的，所以這兩支都多收一個 `customer`。
//
// ## 為什麼共用一支而不是各寫一份
//
// 這個專案已經為了「兩份寫法」付過兩次帳：`buy.js` 的「其他…」那一格漏了
// 兩次、`note.js` 的 `.notemeta` 有兩個入口裸放。第三個入口以後接上去只要一行。

import { esc } from './form.js';
import { playbooksFor, previewOf } from '../../domain/playbook.js';

/**
 * 這一筆來訪掛到的那幾份，各印前幾行。
 *
 * 沒有東西可以畫時回空字串，**不要留一個空殼** —— 一個永遠空的區塊
 * 會讓她以為那裡壞了。
 *
 * @param {object} o
 * @param {object[]} o.playbooks 全部的備忘錄
 * @param {object} o.visit 那一筆來訪（要有 slots）
 * @param {object} [o.customer] 這位客戶。掛合作機構的那幾份要靠它（ADR-0076）
 * @param {number|null} [o.focusSlot] 她點的是哪一段。帶了就**只浮那一段的**
 *   （2026-09-12：「我點這一項，應該只需要出現這一項的SOP」），
 *   而且掛機構的那幾份也不浮 —— 規則在 `playbooksFor()`，這裡只把它傳下去
 * @returns {string} HTML
 */
export function hintHtml({ playbooks = [], visit = null, customer = null, focusSlot = null }) {
  return playbooksFor({ playbooks, visit, customer, focusSlot })
    .map(blockHtml).filter(Boolean).join('');
}

/**
 * 好幾筆來訪合起來問一次。確認動線那一頁是一位客戶一組，而一位客戶
 * 好幾天的來訪帶的是同一份備忘錄 —— **同一份只畫一次**。
 *
 * @param {object} o
 * @param {object[]} o.playbooks
 * @param {object[]} o.visits 這一組的那幾筆
 * @param {object} [o.customer] 這位客戶（ADR-0076）
 */
export function hintForVisits({ playbooks = [], visits = [], customer = null }) {
  const seen = new Set();
  const out = [];

  for (const visit of visits ?? []) {
    for (const p of playbooksFor({ playbooks, visit, customer })) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const html = blockHtml(p);
      if (html) out.push(html);
    }
  }
  return out.join('');
}

function blockHtml(playbook) {
  const { lines, rest } = previewOf(playbook);
  // 內文是空的 → 整塊不畫。
  if (!lines.length) return '';

  return `
    <div class="pbhint">
      <div class="pbhint__head">
        <span class="pbhint__title">${esc(playbook.title ?? '')}</span>
        <a class="pbhint__more" href="#/playbook/${esc(playbook.id)}">看整份</a>
      </div>
      <ul class="pblines pblines--tight">
        ${lines.map((line) => `<li>${esc(line)}</li>`).join('')}
      </ul>
      ${rest ? `<p class="pbhint__rest">還有 ${rest} 行</p>` : ''}
    </div>`;
}
