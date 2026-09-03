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
// 它是點滴那份備忘錄 `before` 那一節的第一行，而那一節會在她正在發確認訊息
// 的那一刻出現在畫面上。
//
// ## 挑哪一節只有一份判斷
//
// `domain/playbook.js` 的 `whenForVisit()`。兩個入口問的是同一句話，
// 而同一筆來訪在兩個畫面浮出不同的一節，她不會知道哪個算數
//（同 ADR-0028、ADR-0043 的理由）。
//
// ## 為什麼共用一支而不是各寫一份
//
// 這個專案已經為了「兩份寫法」付過兩次帳：`buy.js` 的「其他…」那一格漏了
// 兩次、`note.js` 的 `.notemeta` 有兩個入口裸放。第三個入口以後接上去只要一行。

import { esc } from './form.js';
import {
  playbooksForVisit, whenForVisit, sectionFor, linesOf, whenLabel,
} from '../../domain/playbook.js';

/**
 * 這一筆來訪現在該看的那幾節。
 *
 * **這一支不決定「哪一節」，它只負責畫。** 時機由 `when` 決定：
 * 給了就用給的（確認動線那一頁永遠是「事前」—— 那一頁的定義就是還沒發生），
 * 沒給就問 `whenForVisit()`。
 *
 * 沒有東西可以畫時回空字串，**不要留一個空殼** —— 一個永遠空的區塊
 * 會讓她以為那裡壞了。
 *
 * @param {object} o
 * @param {object[]} o.playbooks 全部的備忘錄
 * @param {object} o.visit 那一筆來訪（要有 slots）
 * @param {string} [o.today] 沒給 `when` 時要它才問得出時機
 * @param {string|null} [o.when] 指定時機
 * @returns {string} HTML
 */
export function hintHtml({ playbooks = [], visit = null, today = null, when = undefined }) {
  const at = when === undefined ? whenForVisit(visit, today) : when;
  if (!at) return '';

  return playbooksForVisit(playbooks, visit)
    .map((p) => blockHtml(p, sectionFor(p, at), at))
    .filter(Boolean)
    .join('');
}

/**
 * 好幾筆來訪合起來問一次。確認動線那一頁是一位客戶一組，而一位客戶
 * 好幾天的來訪帶的是同一份備忘錄 —— **同一份只畫一次**。
 *
 * @param {object} o
 * @param {object[]} o.playbooks
 * @param {object[]} o.visits 這一組的那幾筆
 * @param {string|null} o.when 時機
 */
export function hintForVisits({ playbooks = [], visits = [], when = 'before' }) {
  if (!when) return '';
  const seen = new Set();
  const out = [];

  for (const visit of visits ?? []) {
    for (const p of playbooksForVisit(playbooks, visit)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const html = blockHtml(p, sectionFor(p, when), when);
      if (html) out.push(html);
    }
  }
  return out.join('');
}

function blockHtml(playbook, section, when) {
  const lines = linesOf(section);
  // 那一節不存在、或它是空的 → 整塊不畫。
  if (!lines.length) return '';

  return `
    <div class="pbhint">
      <div class="pbhint__head">
        <span class="pbhint__when">${esc(whenLabel(when))}</span>
        <span class="pbhint__title">${esc(playbook.title ?? '')}</span>
        <a class="pbhint__more" href="#/playbook/${esc(playbook.id)}">看整份</a>
      </div>
      <ul class="pblines pblines--tight">
        ${lines.map((line) => `<li>${esc(line)}</li>`).join('')}
      </ul>
    </div>`;
}
