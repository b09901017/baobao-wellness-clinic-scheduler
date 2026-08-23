// 隨手記在畫面上的兩塊：**一列**（`row`）與**那個選填的日期欄**（`field`）。
//
// 四個地方共用：待辦首頁底下那張卡、右下角那顆泡泡、`#/todo/notes`、
// 客戶詳情頁，之後再加日曆上的待辦（ADR-0044）。
//
// 抽出來不是為了省行數，是為了**只有一個地方決定它長什麼樣**。
// 這兩塊在這一支之前各有三份寫法，而加一個日期欄位就是三個地方都要記得改 ——
// 其中一份遲早會把空字串當成有值，而空字串跟 null 在日曆的查詢上是兩件事
//（`domain/notes.js` 的 `normalize()`）。
//
// ## 為什麼是兩顆丸子，不是一個攤開的日曆
//
// 「今天」一次點擊就完成，而那是最常見的那一種 —— 客人當著她的面講的話，
// 通常就是今天記、今天處理。「挑日期」才展開系統原生的 `<input type="date">`：
// 自己畫一個小日曆是壓表那一頁才需要的（那裡要標紅、標休假），這裡不需要。
//
// **預設是沒有日期。** 泡泡那一支的標準是「三秒內記完」
//（`domain/notes.js` 的檔頭），多一個必填欄位就毀了它。

import { esc } from './form.js';
import { icon } from '../icons.js';
import { shortDate, todayISO } from '../../domain/dates.js';

/**
 * 一列隨手記。點一下就勾掉／取消勾（呼叫端接 `[data-note]`）。
 *
 * 有日期的在文字前面掛一顆日期標籤。過了今天而且還沒勾的用逾期色 ——
 * **但它不是死線**（隨手記沒有死線，見 `CONTEXT.md`），所以只有字變色，
 * 沒有紅底。紅底在這個 app 裡的意思是「這件事該做了」。
 *
 * @param {object} n
 * @param {{today?: string, customer?: boolean, iconSize?: number}} [options]
 *   customer：要不要把掛的客戶名字印出來（客戶詳情頁上是多餘的）
 */
export function row(n, { today = todayISO(), customer = true, iconSize = 13 } = {}) {
  const late = n.date && !n.done && n.date < today;

  return `
    <button class="note ${n.done ? 'note--done' : ''}" type="button" data-note="${esc(n.id)}">
      <span class="note__box">${icon('check', { size: iconSize, width: 3.2 })}</span>
      <span class="note__main">
        <span class="note__text">${n.date
          ? `<span class="note__date ${late ? 'note__date--past' : ''}">${esc(shortDate(n.date))}</span>`
          : ''}${esc(n.text)}</span>
        ${customer && n.customerName
          ? `<span class="badge" style="margin-top: var(--space-1)">${esc(n.customerName)}</span>`
          : ''}
      </span>
    </button>`;
}

/**
 * @param {{value?: string|null}} [options] value：已經有的日期
 */
export function field({ value = null } = {}) {
  const picked = value || '';
  return `
    <div class="notedate" data-notedate>
      <button class="chip chip--sm" type="button" data-nd-today
              aria-pressed="${picked === todayISO()}">今天</button>
      <button class="chip chip--sm" type="button" data-nd-pick
              aria-pressed="${Boolean(picked) && picked !== todayISO()}">挑日期</button>
      <span class="notedate__picked" ${picked ? '' : 'hidden'}>
        <span data-nd-label>${picked ? esc(shortDate(picked)) : ''}</span>
        <button class="chip chip--sm" type="button" data-nd-clear aria-label="拿掉日期">✕</button>
      </span>
      <input type="date" data-nd-input value="${esc(picked)}" hidden />
    </div>`;
}

/** 現在選的是哪一天。沒選回 null（不是空字串）。 */
export function read(root) {
  return root?.querySelector('[data-nd-input]')?.value || null;
}

/**
 * 掛上互動。回傳一支 `set(iso)`，讓呼叫端在存完之後把它清回沒有日期。
 *
 * 事件用委派掛在 `[data-notedate]` 上，所以呼叫端把整塊重畫也不會漏掛。
 */
export function wire(root) {
  const box = root?.querySelector('[data-notedate]');
  if (!box) return { set: () => {} };

  const input = box.querySelector('[data-nd-input]');
  const label = box.querySelector('[data-nd-label]');
  const picked = box.querySelector('.notedate__picked');

  const paint = () => {
    const v = input.value;
    label.textContent = v ? shortDate(v) : '';
    picked.hidden = !v;
    box.querySelector('[data-nd-today]').setAttribute('aria-pressed', String(v === todayISO()));
    box.querySelector('[data-nd-pick]').setAttribute('aria-pressed', String(Boolean(v) && v !== todayISO()));
  };

  const set = (iso) => {
    input.value = iso ?? '';
    input.hidden = true;
    paint();
  };

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-nd-today]')) return set(input.value === todayISO() ? null : todayISO());
    if (e.target.closest('[data-nd-clear]')) return set(null);
    if (e.target.closest('[data-nd-pick]')) {
      input.hidden = !input.hidden;
      // showPicker() 要在點擊的手勢堆疊裡才叫得動，跟 quick capture 的
      // focus() 是同一個坑（.scratch/quick-capture/issues/01）。
      if (!input.hidden) {
        try {
          input.showPicker?.();
        } catch {
          input.focus();
        }
      }
    }
    return undefined;
  });

  input.addEventListener('change', paint);
  paint();
  return { set };
}
