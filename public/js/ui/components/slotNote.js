// 一段時段身上那一句話。**兩個入口共用**：來訪編輯器的每一段、壓表的記錄卡。
//
// 她 2026-09-09：
//
// > 新增時段的時候不用每個都給記一句的輸入框，就是有需要的時候點一個 icon
// > 或是什麼再展開填就好，不然感覺會很占版面…要簡潔直觀，而且閱讀起來舒服，
// > 有呼吸感
//
// ## 三種狀態，而「有呼吸感」就是從這三條來的
//
//   ① 沒有字      抬頭列右邊一顆淡的夾板，**零額外高度**
//   ② 點下去      就地展開 textarea，自動聚焦，夾板轉主色
//   ③ 有字收起    夾板主色 + 底下一行淡字，點那一行也展開
//
// **收起來不是藏起來。** 這個 repo 自己的規矩寫在 `app.css` 的 `.advanced`：
// 「摺疊的標題要講出裡面被動過幾樣 —— 收起來的東西不能安靜地生效。」
// 所以第三種狀態一定看得到那句話，只是縮成一行。
//
// ## icon 是 `book`，而且不是這一支挑的
//
// 日曆上那一列右邊早就有一顆了（`ui/views/calendar.js` 的 `noteMarks()`，
// `aria-label="有記的話"`），是她 2026-09-04 選的。兩個畫面同一顆才講得出
// 同一句話 —— 另外挑一顆的話，她要學兩次「哪個圖示代表我寫了字」。
//
// `manual`（攤開的書）是備忘錄／SOP，**不要拿來用**：那一顆綁課程、勾不掉，
// 跟這一句是兩種東西。

import { esc } from './form.js';
import { icon } from '../icons.js';

/**
 * 那一句話的欄位。
 *
 * @param {object} o
 * @param {string} o.name 表單欄位名（來訪編輯器是 `s0-note`，壓表是 `note`）
 * @param {string|null} [o.value]
 * @param {number} o.maxlength `NOTE_MAX`，由呼叫端帶進來 —— 這一支不決定業務上限
 * @param {string} [o.label] 給輔助科技念的那一句
 * @param {string} [o.placeholder]
 * @returns {string}
 */
export function html({ name, value = null, maxlength, label = '記一句', placeholder = '例：她說下午比較好' }) {
  const text = String(value ?? '');
  return disclosure({
    name,
    peek: text,
    body: `
      <label class="slotnote__box" hidden>
        <span class="visually-hidden">${esc(label)}</span>
        <textarea name="${esc(name)}" rows="2" maxlength="${Number(maxlength)}"
                  placeholder="${esc(placeholder)}">${esc(text)}</textarea>
      </label>`,
  });
}

/**
 * 一塊「收起來是一行字、點下去才展開」的外殼。
 *
 * `html()` 是它最常見的那一種（一個 textarea）。**另外開這一支**是因為
 * 待辦中心那一句（「問過了、客人還沒回」）帶著自己的送出按鈕與 form ——
 * 但**展開的行為只能有一份**：兩份的話遲早有一邊忘了改 `aria-expanded`，
 * 而那顆夾板的狀態就會跟畫面對不起來。
 *
 * `body` 那一塊自己要帶 `class="slotnote__box"` 與 `hidden`。
 *
 * @param {{name:string, peek?:string, body:string}} o
 */
export function disclosure({ name, peek = '', body }) {
  const text = String(peek ?? '');

  return `
    <div class="slotnote" data-slotnote="${esc(name)}" data-open="false">
      ${/* 收起來時那一行。**有字才畫** —— 沒字的時候一個像素都不佔，
             這一句就是她說的「不然感覺會很占版面」的答案。 */''}
      <button class="slotnote__peek" type="button" data-slotnote-toggle
              ${text.trim() ? '' : 'hidden'}>${esc(text)}</button>
      ${body}
    </div>`;
}

/**
 * 抬頭列上那一顆。**分開一支**是因為它要跟那顆 × 排在同一格，
 * 而那一格由呼叫端擺（來訪編輯器是 `.slotcard__tools`，壓表在卡片抬頭）。
 *
 * @param {object} o
 * @param {string} o.name 要對到 `html()` 的那一個
 * @param {boolean} [o.on] 這一段現在有沒有字（決定顏色）
 */
export function toggle({ name, on = false }) {
  return `
    <button class="slotnote__pin ${on ? 'is-on' : ''}" type="button"
            data-slotnote-toggle="${esc(name)}" aria-expanded="false"
            aria-label="${on ? '改這一段記的話' : '替這一段記一句'}"
            title="${on ? '改這一段記的話' : '替這一段記一句'}">
      ${icon('book', { size: 15 })}
    </button>`;
}

/**
 * 把展開接起來。事件委派掛在 `root` 上。
 *
 * **`root` 會被重畫換掉時不用給 `signal`**（監聽跟著節點消失）；掛在一個
 * 會留著的容器上就一定要給，不然每重畫一次就多掛一組（同 `form.js`
 * 的 `wireChips()`）。
 *
 * 展開之後**不重畫任何東西**：這一支只換 `hidden` 與 `aria-expanded`。
 * 重畫的話她打到一半的字會不見，而來訪編輯器的 `change` 監聽是整張重畫的
 * （ADR-0038 為那個閃爍付過帳）。
 */
export function wire(root, { signal } = {}) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slotnote-toggle]');
    if (!btn) return;

    // 抬頭那一顆帶著欄位名，收起來那一行沒有（它就長在自己那一塊裡面）
    const name = btn.dataset.slotnoteToggle;
    const box = name
      ? root.querySelector(`[data-slotnote="${CSS.escape(name)}"]`)
      : btn.closest('[data-slotnote]');
    if (!box) return;

    open(box);
  }, { signal });
}

/** 展開某一塊，游標放到最後面（改既有那一句時她多半是要接著寫）。 */
function open(box) {
  box.dataset.open = 'true';
  const peek = box.querySelector('.slotnote__peek');
  const field = box.querySelector('.slotnote__box');
  // textarea 或 input 都收 —— 待辦中心那一句是一行的 `<input>`
  const area = box.querySelector('textarea, input[type="text"]');
  if (peek) peek.hidden = true;
  if (field) field.hidden = false;

  const pin = document.querySelector(
    `[data-slotnote-toggle="${CSS.escape(box.dataset.slotnote)}"]`,
  );
  if (pin) pin.setAttribute('aria-expanded', 'true');

  if (area) {
    area.focus();
    // 游標放最後面：改既有那一句時她多半是要接著寫。
    // **`setSelectionRange` 不是每一種 input 都支援**（`type="date"` 會丟），
    // 所以包起來 —— 展開失敗比游標位置不對糟得多。
    try {
      area.setSelectionRange(area.value.length, area.value.length);
    } catch {
      /* 不支援就算了 */
    }
  }
}
