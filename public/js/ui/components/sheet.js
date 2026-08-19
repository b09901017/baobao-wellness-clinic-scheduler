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

/** 拖過這麼多就當她要關掉，不是手抖。 */
const CLOSE_PX = 96;
/** 往上拖過這麼多就撐到滿版。比關掉的門檻小 —— 往上是「我要看更多」，不必那麼確定。 */
const FULL_PX = 56;
/** 甩得夠快就直接照方向決定，不看拖了多遠 —— 快速往下甩是「關掉」的通用手勢。 */
const FLICK_VELOCITY = 0.7; // px/ms

/**
 * @param {object} opts
 * @param {string} opts.title      面板抬頭。也當作 aria-label。
 * @param {string} [opts.note]     抬頭底下的一句說明
 * @param {string} [opts.body]     內容 HTML（自己捲）
 * @param {string} [opts.actions]  底部按鈕列 HTML（釘住不捲）
 * @param {Function} [opts.onMount] 拿到 .drawer 元素，接自己的事件
 * @param {Function} [opts.onClose] 關掉之後做的事
 * @returns {{close: Function, update: Function, setTitle: Function, setNote: Function,
 *            setActions: Function, body: Function, el: HTMLElement}}
 */
export function openSheet({ title, note = '', body = '', actions = '', onMount, onClose }) {
  closeSheet();

  const root = document.createElement('div');
  root.className = 'drawer-backdrop';
  root.innerHTML = `
    <div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button class="drawer__grip" type="button" data-sheet-close aria-label="關閉"></button>
      <div class="drawer__head">
        <h2 class="drawer__title" data-sheet-title>${esc(title)}</h2>
        <button class="drawer__x" type="button" data-sheet-close aria-label="關閉">
          ${icon('close', { size: 18, width: 2 })}
        </button>
      </div>
      <p class="drawer__note" data-sheet-note ${note ? '' : 'hidden'}>${note}</p>
      <div class="drawer__body" data-sheet-body>${body}</div>
      <div class="drawer__actions" data-sheet-actions ${actions ? '' : 'hidden'}>${actions}</div>
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

  wireDrag(drawer, close);

  const api = {
    el: drawer,
    close,
    /** 內容那一塊本身，要把整支編輯器掛進來的時候用。 */
    body: () => root.querySelector('[data-sheet-body]'),
    /** 只換內容，不關掉也不重設捲動位置 —— 勾一筆隨手記不該把她捲回最上面。 */
    update(html) {
      const box = root.querySelector('[data-sheet-body]');
      if (!box) return;
      const top = box.scrollTop;
      box.innerHTML = html;
      box.scrollTop = top;
      onMount?.(drawer);
    },
    /** 同一張面板換一個抬頭（選完人之後從「要幫誰排」變成那一天）。 */
    setTitle(next) {
      const h = root.querySelector('[data-sheet-title]');
      if (h) h.textContent = next;
      drawer.setAttribute('aria-label', next);
    },
    /**
     * 抬頭底下那句說明。換內容一定要跟著換 —— 留著上一段的說明比沒有說明更糟，
     * 它會在編輯器上面寫著「1 件事，點一筆看細節」。
     */
    setNote(next) {
      const box = root.querySelector('[data-sheet-note]');
      if (!box) return;
      box.innerHTML = next ?? '';
      box.hidden = !next;
    },
    /** 底下那排按鈕也會換 —— 選人的時候沒有按鈕，進了編輯器才有。 */
    setActions(html) {
      const box = root.querySelector('[data-sheet-actions]');
      if (!box) return;
      box.innerHTML = html ?? '';
      box.hidden = !html;
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

/**
 * 抓著上面那條橫桿上下拖。匯出的原因：首頁的確認動線自己畫了一張 `.drawer`
 * （它要跟著整頁一起重畫），沒走 `openSheet()`，但**所有抽屜的手勢都要一樣** ——
 * 只有一張拖不動的話，她會以為那張壞了。
 *
 *
 * 三個位置：關掉、原本高度、滿版。往下拖過門檻就關掉，往上拖就撐到滿版，
 * 從滿版往下拖回原本高度 —— 跟她手機上其他日曆 app 一樣。
 *
 * 為什麼這裡自己接指標事件，而卡片組（ADR-0017）刻意不接：那裡要的是慣性與
 * 邊緣回彈，`scroll-snap` 給得到而手寫給不到；這裡沒有慣性可言，只有「跟著手指走、
 * 放開後決定去哪一格」，反而是 scroll 容器做不到的（面板本身要能捲內容）。
 *
 * 手勢是快捷方式，不是唯一的路：把手本身仍然是關閉鈕，右上角還有一個叉叉。
 * SPEC 第 8.0 節的「無拖拉」講的是不靠拖拉就做不到的功能（ADR-0017 同一個判準）。
 */
export function wireDrag(drawer, close) {
  const grip = drawer.querySelector('.drawer__grip');
  const handles = [grip, drawer.querySelector('.drawer__head')].filter(Boolean);

  let startY = 0;
  let startAt = 0;
  let dy = 0;
  let dragging = false;
  let moved = false;

  const setOffset = (px) => {
    drawer.style.transform = px ? `translateY(${px}px)` : '';
  };

  const settle = () => {
    const full = drawer.classList.contains('drawer--full');
    const speed = Math.abs(dy) / Math.max(1, Date.now() - startAt);
    const flick = speed > FLICK_VELOCITY;

    drawer.classList.remove('drawer--dragging');
    setOffset(0);

    if (dy > 0 && (dy > CLOSE_PX || flick)) {
      // 從滿版往下甩一次只回到原本高度，不會一路關掉 —— 那一下太容易誤觸
      if (full) drawer.classList.remove('drawer--full');
      else close();
      return;
    }
    if (dy < 0 && (-dy > FULL_PX || flick)) drawer.classList.add('drawer--full');
  };

  const onDown = (e) => {
    // 右上角的叉叉在 .drawer__head 裡，不要把按它變成拖曳的起手式
    if (e.target.closest('.drawer__x')) return;
    dragging = true;
    moved = false;
    dy = 0;
    startY = e.clientY;
    startAt = Date.now();
    drawer.classList.add('drawer--dragging');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e) => {
    if (!dragging) return;
    dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    // 往上只讓它稍微跟一下手：真正的「變高」是放開之後換 class，
    // 拖的過程直接把面板拉超過螢幕頂只會看到一塊空白
    setOffset(dy > 0 ? dy : Math.max(dy / 3, -40));
    e.preventDefault();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    settle();
  };

  for (const h of handles) {
    h.addEventListener('pointerdown', onDown);
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
    h.addEventListener('pointercancel', onUp);
  }

  // 拖過就不算「點了把手」—— 否則往上拖完手一放，面板當場關掉
  grip?.addEventListener(
    'click',
    (e) => {
      if (!moved) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      moved = false;
    },
    true,
  );
}
