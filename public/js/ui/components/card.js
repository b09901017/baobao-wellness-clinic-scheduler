// 置中浮出的一張卡片。疊在抽屜上面，不是取代它。
//
// 跟 `sheet.js` 的分工：抽屜是**那一天**（一整片內容，從底部推上來，可以拖大拖小）；
// 這張卡片是**那一筆**（一件事的細節，浮在中間）。她點日曆上的某一天再點裡面的
// 某一筆，兩層要同時在 —— 用抽屜開第二層會把第一層關掉，那等於每看一筆就要
// 重新找一次那一天。
//
// 一律先進**讀取模式**：她點一筆的十次有九次只是想確認「那天幾點、誰、做什麼」，
// 進去就是一張可以改的表單，等於每次都冒著改到東西的風險。要改就按鉛筆。

import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import { esc } from './form.js';

/** 同一時間只有一張。開第二張之前先收掉上一張，不要疊成三層灰底。 */
let open = null;

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]  抬頭旁邊的一句話（日期、狀態）
 * @param {string} [opts.body]      內容 HTML
 * @param {string} [opts.actions]   底部按鈕列 HTML
 * @param {boolean} [opts.canEdit]  抬頭右邊給不給那支小鉛筆
 * @param {Function} [opts.onEdit]  按了鉛筆做什麼
 * @param {Function} [opts.onMount] 拿到 .popcard 元素，接自己的事件
 * @param {Function} [opts.onClose]
 * @returns {{close: Function, update: Function, el: HTMLElement}}
 */
export function openCard({
  title, subtitle = '', body = '', actions = '',
  canEdit = false, onEdit, onMount, onClose,
}) {
  closeCard();

  const root = document.createElement('div');
  root.className = 'popcard-backdrop';
  root.innerHTML = `
    <div class="popcard" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="popcard__head">
        <div class="popcard__titles">
          <h2 class="popcard__title" data-card-title>${esc(title)}</h2>
          ${subtitle ? `<p class="popcard__sub" data-card-sub>${subtitle}</p>` : ''}
        </div>
        ${canEdit ? `
          <button class="popcard__icon" type="button" data-card-edit aria-label="改這一段">
            ${icon('pencil', { size: 17 })}
          </button>` : ''}
        <button class="popcard__icon" type="button" data-card-close aria-label="關閉">
          ${icon('close', { size: 17, width: 2 })}
        </button>
      </div>
      <div class="popcard__body" data-card-body>${body}</div>
      ${actions ? `<div class="popcard__actions" data-card-actions>${actions}</div>` : ''}
    </div>`;

  document.body.appendChild(root);

  const card = root.querySelector('.popcard');

  // 卡片疊在抽屜上面，所以它是第二層 —— 按返回鍵先關掉卡片，
  // 底下那一天的面板留著（`ui/nav.js`）。
  const layer = pushLayer(() => close({ fromBack: true }));

  const close = ({ fromBack = false } = {}) => {
    if (open?.root !== root) return;
    if (!fromBack) layer.pop();
    root.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    open = null;
    onClose?.();
  };
  // 換頁了。收掉但不 pop —— 理由同 sheet.js 的 onHash。
  const onHash = () => close({ fromBack: true });

  function onKey(e) {
    // 最上面那一層先關。底下的抽屜留著 —— 她只是看完這一筆，不是要離開那一天。
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  window.addEventListener('hashchange', onHash, { once: true });
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  root.querySelector('[data-card-close]').addEventListener('click', () => close());
  root.querySelector('[data-card-edit]')?.addEventListener('click', () => onEdit?.());
  document.addEventListener('keydown', onKey);

  const api = {
    el: card,
    close,
    /**
     * 就地換掉內容。**不要用「關掉再開一張」代替它** —— `openCard()` 第一行
     * 就是 `closeCard()`，重開等於畫面閃一下（ADR-0073 為那個閃爍付過帳，
     * ADR-0080 為卡片裡的換頁再講過一次）。
     *
     * `subtitle` 是選填的：讀取卡片在卡片裡換段落時，抬頭底下那一行講的是
     * **哪一段的狀態**，跟著 body 一起變（ADR-0085）。沒帶就不動它。
     * 開的時候沒給 subtitle 的話那個節點根本不存在，所以這裡問過才寫。
     */
    update(html, { subtitle: nextSub } = {}) {
      const box = root.querySelector('[data-card-body]');
      if (!box) return;
      box.innerHTML = html;
      if (nextSub !== undefined) {
        const sub = root.querySelector('[data-card-sub]');
        if (sub) sub.innerHTML = nextSub;
      }
      onMount?.(card);
    },
  };

  open = { root, api };
  onMount?.(card);
  return api;
}

export function closeCard() {
  open?.api.close();
}
