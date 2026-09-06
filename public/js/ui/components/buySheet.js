// 「加一項」那一張從底下升起來的面板。
//
// 裡面就是 `components/buy.js` 那一張表 —— **她賣了什麼給客戶只有一張表**
// （CLAUDE.md）。這一支只是把它裝進面板裡，並且把「＋ 新增…」那一款寫進主檔。
//
// ## 為什麼自己一個檔案
//
// `buy.js` 不可以 import `data/config.js`：那條路會一路 import 到 Firebase SDK
// （一個 `https:` 網址），而 `tests/buy.test.js` 直接載入 `buy.js`，Node 載不動。
// 所以「開面板 + 寫主檔」這一段住在這裡，`buy.js` 維持只認得 `form.js`。
//
// ## 兩個入口共用
//
//   新增客戶那一頁的「加一項」        `ui/views/customers.js`
//   客戶詳情「加購方案」裡的「加一項」  `ui/views/customerDetail.js`
//
// 各寫一次的話遲早有一邊忘了叫 `commitNewProduct()`，而那一邊她打的新品項
// 會在存下去之後從 `items` 裡消失（`buy.js` 的檔頭記過那一次）。

import * as f from './form.js';
import * as buy from './buy.js';
import { openSheet, closeSheet } from './sheet.js';
import * as config from '../../data/config.js';

/**
 * 開一張「加一項」。按下「加進來」之後把那一筆草稿交給 `onAdd`。
 *
 * **沒有「進階設定」**：她在加一項的時候要的是「再給他三次健檢」，
 * 那幾個欄位一年動不到一次，建好之後進客戶詳情調。所以這裡沒有顯示名稱
 * 那一格 —— 名字一律自動帶。
 *
 * @param {{courses:object[], equipment:object[], ivProducts:object[], products:object[]}} master
 * @param {(draft: object) => void} onAdd
 * @param {{title?: string, note?: string}} [text]
 */
export function openBuySheet(master, onAdd, { title = '加購', note = '方案之外多買的。加完可以再加一項。' } = {}) {
  let item = buy.blank();
  let sheet = null;

  const html = () => `
    <div class="errors" data-errors hidden></div>
    <form data-buyform>${buy.fields(item, master)}</form>`;

  sheet = openSheet({
    title,
    note,
    body: html(),
    actions: `
      <button class="btn" type="button" data-sheet-close>取消</button>
      <button class="btn btn--primary" type="button" data-addbuy>加進來</button>`,
    // `update()` 會再呼叫一次 onMount，而監聽掛的是 drawer（它不會被換掉）——
    // 沒有這道旗標，重畫一次就多一組監聽，按「加進來」會一次加兩筆。
    onMount: (drawer) => {
      if (drawer.dataset.buyWired) return;
      drawer.dataset.buyWired = '1';
      f.wireChips(drawer);

      const formOf = () => drawer.querySelector('[data-buyform]');

      // 換丸子、`+1`、在「自己打」那一格打字，四種動作走同一份接線
      // （`components/buy.js`）—— 這裡只回答「哪一塊要重畫」。
      buy.wire(drawer, {
        form: formOf,
        draft: () => item,
        master,
        onChange: (next, { repaint }) => {
          item = next;
          if (repaint) sheet.update(html());
        },
      });

      drawer.addEventListener('click', async (ev) => {
        if (!ev.target.closest('[data-addbuy]')) return;
        const form = formOf();
        if (!form) return;

        // 「＋ 新增…」打的那一款先寫進主檔（三個入口共用同一支）
        const next = await buy.commitNewProduct(
          { ...item, ...buy.values(form, master) }, master, (row) => config.create('products', row),
        );
        const errors = buy.validate(next, master);
        f.showErrors(drawer, errors);
        if (errors.length) {
          item = next;
          return;
        }
        onAdd(next);
        closeSheet();
      });
    },
  });

  return sheet;
}
