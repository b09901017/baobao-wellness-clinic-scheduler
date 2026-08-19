// 從底部滑上來的面板。全站共用一支。
//
// 為什麼不是換頁：她的動作幾乎都是「看一下這個，然後回到剛剛那裡」——
// 日曆上點某一天、客戶身上改一則備註、把來訪紀錄整份攤開。換頁會把
// 「我剛剛在哪」洗掉，而她一次要處理二十幾位客戶。
//
// 掛在 <body> 上而不是掛在 view 裡：view 重畫（每點一顆泡泡就會重畫一次）
// 會把自己的 innerHTML 整個換掉，掛在裡面的面板會當場消失。
//
// ≥900px 時 CSS 會把它改成置中的對話框 —— iPad 橫式上底部抽屜要跨過
// 整個螢幕才關得掉。那一段在 app.css 的 .drawer 區塊。

import { icon } from '../icons.js';
import { esc } from './form.js';

/** 同一時間只會有一個。開第二個之前先把前一個關掉，不要疊成兩層灰底。 */
let open = null;

/**
 * @param {object} opts
 * @param {string} opts.title      面板抬頭。也當作 aria-label。
 * @param {string} [opts.note]     抬頭底下的一句說明
 * @param {string} [opts.body]     內容 HTML（自己捲）
 * @param {string} [opts.actions]  底部按鈕列 HTML（釘住不捲）
 * @param {Function} [opts.onMount] 拿到 .drawer 元素，接自己的事件
 * @param {Function} [opts.onClose] 關掉之後做的事
 * @returns {{close: Function, update: Function, el: HTMLElement}}
 */
export function openSheet({ title, note = '', body = '', actions = '', onMount, onClose }) {
  closeSheet();

  const root = document.createElement('div');
  root.className = 'drawer-backdrop';
  root.innerHTML = `
    <div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button class="drawer__grip" type="button" data-sheet-close aria-label="關閉"></button>
      <div class="drawer__head">
        <h2 class="drawer__title">${esc(title)}</h2>
        <button class="drawer__x" type="button" data-sheet-close aria-label="關閉">
          ${icon('close', { size: 18, width: 2 })}
        </button>
      </div>
      ${note ? `<p class="card__note" style="margin-bottom: var(--space-2)">${note}</p>` : ''}
      <div class="drawer__body" data-sheet-body>${body}</div>
      ${actions ? `<div class="drawer__actions">${actions}</div>` : ''}
    </div>`;

  document.body.appendChild(root);

  const drawer = root.querySelector('.drawer');
  const close = () => {
    if (open?.root !== root) return;
    root.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    open = null;
    onClose?.();
  };

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  // 換頁就收掉。它掛在 <body> 上而不是 view 裡（見上面），所以路由換了它不會
  // 自己消失 —— 那會變成一個蓋在新畫面上、內容還是舊畫面的面板。
  window.addEventListener('hashchange', close, { once: true });

  // 點灰底關掉，點面板本身不關 —— 面板裡面到處都是按鈕，冒泡上來會誤關。
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  root.querySelectorAll('[data-sheet-close]').forEach((b) =>
    b.addEventListener('click', close),
  );
  document.addEventListener('keydown', onKey);

  const api = {
    el: drawer,
    close,
    /** 只換內容，不關掉也不重設捲動位置 —— 勾一筆隨手記不該把她捲回最上面。 */
    update(html) {
      const box = root.querySelector('[data-sheet-body]');
      if (!box) return;
      const top = box.scrollTop;
      box.innerHTML = html;
      box.scrollTop = top;
      onMount?.(drawer);
    },
  };

  open = { root, api };
  onMount?.(drawer);
  return api;
}

export function closeSheet() {
  open?.api.close();
}

export function isSheetOpen() {
  return Boolean(open);
}
