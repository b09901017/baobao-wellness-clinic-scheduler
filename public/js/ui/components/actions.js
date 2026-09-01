// 長按一列跳出來的快捷選單。ADR-0060。
//
// 這個 app 的一列一直只回答一個手勢：**點一下＝看**（ADR-0020 定的，
// 「她點一筆的十次有九次只是要確認那天幾點、誰、做什麼」）。要做事就得
// 先看、再按鉛筆、再進編輯器 —— 那對「十次裡的第十次」是對的，
// 但對「客人剛剛在電話裡說可以」那一種，四層點擊太多了。
//
// 所以一列多回答一個手勢：**長按＝做**。點一下的行為一個字都沒有變。
//
// ## 這張選單就是一張疊上去的抽屜
//
// 不是第四種浮層。`views/home.js` 那句「這個 app 的浮層已經有三種了」還算數，
// 所以這裡借的是既有的東西：`.drawer` 的樣式、`wireDrag()` 的往下拖關掉、
// `pushLayer()` 的返回鍵、Escape、`hashchange` 收掉。新的只有一件事 ——
// **它不會把底下那一張抽屜關掉**。
//
// 那一件事正是不能走 `openSheet()` 的原因：那一支開頭第一行就是
// `closeSheet({ instant: true })`，它是**刻意的單例**（「兩張同時在畫面上滑
// 看起來像壞掉」）。而長按最重要的場景就是「日曆那一天的抽屜開著，
// 長按裡面某一列」—— 走 `openSheet()` 會把那一天整個關掉，
// 她看完那一筆就找不回原本在看的那一天了（ADR-0020）。
//
// 也不走 `openCard()`：那一張是置中的，而長按是**拇指在螢幕下半部**做的動作。
// 角色也不一樣 —— 那一張是「一筆的細節，先看再改」，這一張是「直接做」。
//
// ## 手勢是快捷方式，不是唯一的路
//
// `sheet.js` 的檔頭已經寫過這條（SPEC 第 8.0 節的「無拖拉」）。
// **這張選單上的每一顆，在別的地方都點得到。** 長按省掉的是找到那一筆的
// 四層點擊，不是那個決定本身 —— 所以破壞性的動作照樣走二次確認。

import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import { esc } from './form.js';
import { wireDrag } from './sheet.js';

/**
 * 按住多久才算「刻意按住」。
 *
 * 400 以下會誤觸（她在抽屜裡捲動時手指常常先停一下再滑），
 * 500 以上會讓人覺得沒反應。按壓回饋的 CSS 過場時間跟這個數字對齊 ——
 * 她看到那一格填滿的瞬間，正好就是選單跳出來的瞬間，所以那 450ms
 * 是一段有回饋的等待，不是「怎麼還沒動」。
 */
const HOLD_MS = 450;

/** 動超過這麼多就是在捲動，不是在長按。 */
const SLOP = 8;

/**
 * 把「長按這一列」接上去。事件用委派，所以那一塊重畫之後不必重掛。
 *
 * 用 **Pointer Events** 而不是 touch + mouse 各接一次：`sheet.js` 那一支要
 * `preventDefault()` 掉瀏覽器的捲動（只有 touch 事件做得到），這一支不需要
 * —— 它只要知道「手指有沒有移開、有沒有被別人接手」。
 *
 * `pointercancel` 是關鍵的一條：抽屜的 `wireDrag()` 接手手勢時
 * （`touchmove` 被 `preventDefault()`）瀏覽器會送這個事件過來，
 * 那是「面板正在被拖」與「她正在長按」唯一分得開的訊號。
 *
 * @param {HTMLElement} root 委派掛在這上面。**要是重畫時會被換掉的那一層**，
 *   或者本來就只有一個 —— 掛在一個會留著的容器上就一定要給 `signal`，
 *   不然每重畫一次就多一組（這個 repo 修過三次同一種）。
 * @param {string} selector 哪幾列算數，例：'[data-open]'
 * @param {(el: HTMLElement, ev: PointerEvent) => void} onHold 按住夠久之後做什麼
 * @param {{signal?: AbortSignal}} [opts]
 */
export function wireLongPress(root, selector, onHold, { signal } = {}) {
  if (!root) return;

  let timer = null;
  let target = null;
  let startX = 0;
  let startY = 0;
  /** 長按成立了 → 接下來那一次 click 要吃掉，不然會同時開讀取卡片。 */
  let fired = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    target?.classList.remove('is-pressing');
    target = null;
  };

  const onDown = (ev) => {
    // 只認單指／主鍵。兩指縮放與右鍵不該觸發長按。
    if (!ev.isPrimary || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const hit = ev.target.closest?.(selector);
    if (!hit || !root.contains(hit)) return;

    clear();
    fired = false;
    target = hit;
    startX = ev.clientX;
    startY = ev.clientY;
    hit.classList.add('is-pressing');

    timer = setTimeout(() => {
      const el = target;
      clear();
      if (!el) return;
      fired = true;
      // 成立的那一下給一點觸感。iOS Safari 沒有 vibrate，靜靜不做就好 ——
      // 畫面上本來就有一張選單升起來，回饋不缺這一項。
      try {
        navigator.vibrate?.(12);
      } catch {
        /* 有些瀏覽器在沒有使用者手勢時會丟 */
      }
      onHold(el, ev);
    }, HOLD_MS);
  };

  const onMove = (ev) => {
    if (!timer) return;
    if (Math.abs(ev.clientX - startX) > SLOP || Math.abs(ev.clientY - startY) > SLOP) clear();
  };

  root.addEventListener('pointerdown', onDown, { signal });
  root.addEventListener('pointermove', onMove, { signal });
  root.addEventListener('pointerup', clear, { signal });
  // 抽屜把手勢接走了（`wireDrag()` 的 preventDefault）、系統跳了別的東西、
  // 手指滑出視窗 —— 全部走這一條。
  root.addEventListener('pointercancel', clear, { signal });
  root.addEventListener('scroll', clear, { capture: true, signal });

  // **長按成立之後要吃掉接下來那一次 click。** 不吃掉的話手一放會同時跳出
  // 快捷選單與那一筆的讀取卡片。跟 `wireDrag()` 那一段同一個作法：capture 階段。
  root.addEventListener(
    'click',
    (ev) => {
      if (!fired) return;
      fired = false;
      ev.stopPropagation();
      ev.preventDefault();
    },
    { capture: true, signal },
  );

  // Android Chrome 與桌機右鍵會在同一個時間點跳系統選單，兩張疊在一起。
  // 順帶讓桌機右鍵直接開這一張 —— 她偶爾用 iPad 接鍵盤與滑鼠。
  root.addEventListener(
    'contextmenu',
    (ev) => {
      const hit = ev.target.closest?.(selector);
      if (!hit || !root.contains(hit)) return;
      ev.preventDefault();
      clear();
      onHold(hit, ev);
    },
    { signal },
  );
}

// ---------- 選單本身 ----------

/** 同一時間只會有一張。開第二張之前先把前一張拿掉，不要疊成兩層灰底。 */
let open = null;

/**
 * 一顆的形狀。
 *
 * @typedef {object} ActionItem
 * @property {string} id       選了它會用這個值回呼
 * @property {string} label    那一行字
 * @property {string} [note]   底下那一行小字（現在是哪一天、還差幾種）
 * @property {string} [icon]   `ui/icons.js` 的名字
 * @property {'default'|'primary'|'danger'} [tone]
 * @property {boolean} [disabled]
 */

/**
 * 開一張快捷選單。
 *
 * **最多六顆（含「先不要」）。** 第七顆開始這張選單就不是快捷方式了，
 * 她會停下來讀 —— 那時候該走的是編輯器。所以那幾支算「有哪幾顆」的
 * domain 函式自己要收斂，這裡只負責畫。
 *
 * @param {object} o
 * @param {string} o.title       長按到的是哪一筆
 * @param {string} [o.subtitle]  第二行（日期・狀態）
 * @param {ActionItem[]} o.items
 * @param {(id: string) => void} o.onPick 選了哪一顆。**選單會先自己收起來再回呼** ——
 *   回呼裡常常要開別的東西（確認框、日期選擇器），而兩層疊在一起看起來像壞掉。
 * @param {Function} [o.onClose]
 * @returns {{close: Function, el: HTMLElement}}
 */
export function openActions({ title, subtitle = '', items = [], onPick, onClose }) {
  closeActions();

  const root = document.createElement('div');
  // `--over` 只多一件事：z-index 疊到抽屜上面。其餘的灰底、置底、
  // ≥900px 變置中對話框，全部是 `.drawer-backdrop` 本來就有的。
  root.className = 'drawer-backdrop drawer-backdrop--over';
  root.innerHTML = `
    <div class="drawer drawer--actions" role="dialog" aria-modal="true"
         aria-label="${esc(title)}">
      <button class="drawer__grip" type="button" data-actions-close aria-label="關閉"></button>
      <div class="actions__head">
        <h2 class="actions__title">${esc(title)}</h2>
        ${subtitle ? `<p class="actions__sub">${esc(subtitle)}</p>` : ''}
      </div>
      <div class="actions__list">
        ${items.map((item, i) => rowHtml(item, i)).join('')}
      </div>
      <button class="btn btn--wide actions__cancel" type="button" data-actions-close>
        先不要，回去</button>
    </div>`;

  document.body.appendChild(root);
  const panel = root.querySelector('.drawer');

  // 疊了一層 → 多一筆返回鍵退得掉的紀錄（`ui/nav.js`）。
  const layer = pushLayer(() => close({ fromBack: true }));

  const remove = () => {
    root.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    if (open?.root === root) open = null;
    onClose?.();
  };

  const drag = wireDrag(panel, remove, { backdrop: root });

  const close = ({ instant = false, fromBack = false } = {}) => {
    if (open?.root !== root) return;
    open = null;
    if (!fromBack) layer.pop();
    if (instant) remove();
    else drag.dismiss();
  };

  function onKey(e) {
    // **最上面那一層先關，不要讓它傳到底下那張抽屜。** 按一下 Esc 應該只收掉
    // 這張小選單，而不是連那一天一起關掉（同 `card.js` 的 onKey）。
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  }
  // 換頁了。收掉但**不 pop** —— 理由同 `sheet.js` 的 onHash。
  const onHash = () => close({ instant: true, fromBack: true });

  window.addEventListener('hashchange', onHash, { once: true });
  document.addEventListener('keydown', onKey);

  root.addEventListener('click', (e) => {
    if (e.target === root) close();
    if (e.target.closest('[data-actions-close]')) close();

    const hit = e.target.closest('[data-action]');
    if (!hit || hit.disabled) return;
    const { action } = hit.dataset;
    // 先收起來再回呼：回呼常常要開確認框或日期選擇器，兩層疊著看起來像壞掉。
    close({ instant: true });
    onPick?.(action);
  });

  open = { root, api: { el: panel, close } };
  drag.playIn();
  return { el: panel, close };
}

export function closeActions() {
  open?.api.close({ instant: true });
}

export function isActionsOpen() {
  return Boolean(open);
}

/**
 * 一顆。長相跟日曆抽屜那顆「＋」展開的 `.addmenu__item` 是同一種
 * （左邊一顆圓點裝圖示、右邊一行字），差別只在它是整片的。
 *
 * `--i` 給 CSS 排依序浮現的時間差，**不用 JS 排程** ——
 * 一個 `animation-delay` 比一串 setTimeout 準，而且 `prefers-reduced-motion`
 * 那一段（`app.css` 最底下）自動把它壓掉。
 */
function rowHtml(item, i) {
  const tone = item.tone && item.tone !== 'default' ? ` actionrow--${item.tone}` : '';
  return `
    <button class="actionrow${tone}" type="button" style="--i: ${i}"
            data-action="${esc(item.id)}" ${item.disabled ? 'disabled' : ''}>
      <span class="actionrow__dot">${icon(item.icon ?? 'right', { size: 17 })}</span>
      <span class="actionrow__main">
        <span class="actionrow__label">${esc(item.label)}</span>
        ${item.note ? `<span class="actionrow__note">${esc(item.note)}</span>` : ''}
      </span>
    </button>`;
}
