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
//
// 手勢的部分見這個檔案下半段與
// docs/adr/0021-the-sheet-is-dragged-by-transform.md。

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
 * @returns {{close: Function, update: Function, setTitle: Function, setNote: Function,
 *            setActions: Function, expand: Function, body: Function, el: HTMLElement}}
 */
export function openSheet({ title, note = '', body = '', actions = '', onMount, onClose }) {
  // 換一張面板時上一張直接拿掉，不播收起來的動畫 —— 兩張同時在畫面上滑
  // 看起來像壞掉。
  closeSheet({ instant: true });

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

  const remove = () => {
    root.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    if (open?.root === root) open = null;
    onClose?.();
  };

  // 收起來的動畫播完才真的拿掉節點。手勢拖到底與按叉叉走的是同一條路。
  const drag = wireDrag(drawer, remove, { backdrop: root });

  const close = ({ instant = false } = {}) => {
    if (open?.root !== root) return;
    open = null;
    if (instant) remove();
    else drag.dismiss();
  };

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  const onHash = () => close({ instant: true });

  // 換頁就收掉。它掛在 <body> 上而不是 view 裡（見上面），所以路由換了它不會
  // 自己消失 —— 那會變成一個蓋在新畫面上、內容還是舊畫面的面板。
  window.addEventListener('hashchange', onHash, { once: true });

  // 點灰底關掉，點面板本身不關 —— 面板裡面到處都是按鈕，冒泡上來會誤關。
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  root.querySelectorAll('[data-sheet-close]').forEach((b) =>
    b.addEventListener('click', () => close()),
  );
  document.addEventListener('keydown', onKey);

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
    /** 直接拉到頂。掛整支編輯器進來的時候用 —— 表單本來就比一天的清單長。 */
    expand: drag.expand,
  };

  open = { root, api };
  onMount?.(drawer);
  drag.playIn();
  return api;
}

export function closeSheet(opts) {
  open?.api.close(opts);
}

export function isSheetOpen() {
  return Boolean(open);
}

// ---------- 手勢 ----------

/** 從停的位置再往下拖過這麼多就當她要關掉，不是手抖。 */
const CLOSE_PX = 90;
/** 甩得夠快就照方向決定，不看拖了多遠 —— 快速往下甩是「關掉」的通用手勢。 */
const FLICK = 0.55; // px/ms
/** 動超過這麼多才算真的拖過，以下都還算「點一下」（決定送不送出那個 click）。
    **這不是「拖到這裡才開始接手」** —— 接手在第一次 touchmove 就要決定，
    見 onMove() 裡的說明。 */
const SLOP = 5;

const isFormControl = (el) =>
  Boolean(el?.closest?.('input, textarea, select, [contenteditable="true"]'));

/**
 * 抓著面板上下拖。**整張面板都拖得動**，不是只有上面那條橫桿。
 *
 * ## 為什麼只動 transform
 *
 * 上一版用 `height` 做過場，於是每一幀都要把面板裡所有東西重新排版一次。
 * 症狀就是使用者說的「整塊斷裂的往上、下面沒有接續、會閃一下」——
 * 而且往上拖時面板根本沒跟著手指走（那時只讓它跟三分之一）。
 *
 * 現在的做法：手勢一開始就把面板換成**滿高**（瞬間換，同時用 `translateY`
 * 把它推回原本的位置，所以看起來完全沒動），之後純粹靠 `translateY` 跟手。
 * 底下的內容早就排好在那裡了，手拉多少就露多少，中間不會有任何一次重排。
 * 放開手之後彈到最近的那一格，也是 transform，一樣不重排。
 *
 * ## 捲動與拖曳怎麼分
 *
 * 會捲的那一塊（`.drawer__body`）維持瀏覽器原生的捲動 —— 慣性與邊緣回彈
 * 只有它給得出來（跟 ADR-0017 同一個判準）。手勢落在那裡時：
 *
 *   - 往下拖，而且它已經捲到最上面 → 交給面板（往下收）
 *   - 往上拖，而且面板還沒到頂     → 交給面板（往上長）
 *   - 其餘                          → 讓它自己捲
 *
 * 落在其他任何地方（把手、抬頭、留白、按鈕之間）一律拖面板。
 * 判斷只做一次，在手指移動超過 5px 的那一刻；決定了就不再改，
 * 免得同一個手勢裡捲一半又變成拖。
 *
 * 手勢是快捷方式，不是唯一的路：把手仍然是關閉鈕，右上角還有一個叉叉，
 * 點灰底也關得掉。SPEC 第 8.0 節的「無拖拉」講的是不靠拖拉就做不到的功能。
 *
 * @param {HTMLElement} drawer
 * @param {Function} onDismissed 收起來的動畫播完之後做什麼（拿掉節點、重畫那一頁）
 * @param {{backdrop?: HTMLElement}} [opts] 有給的話，收起來時灰底一起淡出
 */
export function wireDrag(drawer, onDismissed, { backdrop = null } = {}) {
  const px = (v) => `${Math.round(v)}px`;
  let y = 0;
  let peekY = 0;
  let fullH = 0;
  let detent = 'peek';

  const setY = (next) => {
    y = next;
    drawer.style.setProperty('--sheet-y', px(next));
  };
  const setPeek = (next) => {
    peekY = next;
    drawer.style.setProperty('--sheet-peek', px(next));
  };
  const anim = (on) => drawer.classList.toggle('drawer--anim', on);

  /** 這一格（內容自己撐出來的高度）有多高。量之前先把滿高拿掉。 */
  function measurePeekHeight() {
    const tall = drawer.classList.contains('drawer--tall');
    if (tall) drawer.classList.remove('drawer--tall');
    const h = drawer.offsetHeight;
    if (tall) drawer.classList.add('drawer--tall');
    return h;
  }

  /**
   * 換成滿高，同時把它推回原本看得到的位置 —— 這一步之後畫面上完全沒有變化，
   * 但底下的內容已經排好了，接下來拖多少就露多少。
   */
  function goTall() {
    if (drawer.classList.contains('drawer--tall')) {
      // 已經是滿高了，但內容可能整個換過（選完人之後換成編輯器），
      // 所以「那一格」有多高要重量一次，不能沿用上一次的值
      fullH = drawer.offsetHeight;
      setPeek(Math.max(0, fullH - measurePeekHeight()));
      return;
    }
    const peekH = drawer.offsetHeight;
    drawer.classList.add('drawer--tall');
    fullH = drawer.offsetHeight;
    setPeek(Math.max(0, fullH - peekH));
    setY(peekY + y);
  }

  /** 停在某一格。到 peek 時把滿高拿掉，讓面板回去貼著內容。 */
  function settleAt(target, after) {
    anim(true);
    setY(target);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      drawer.removeEventListener('transitionend', onEnd);
      anim(false);
      after?.();
    };
    const onEnd = (e) => {
      if (e.target === drawer && e.propertyName === 'transform') finish();
    };
    drawer.addEventListener('transitionend', onEnd);
    // transitionend 不一定會來（值沒變、分頁在背景），給一個保險
    setTimeout(finish, 380);
  }

  function toPeek() {
    detent = 'peek';
    settleAt(peekY, () => {
      drawer.classList.remove('drawer--tall');
      setPeek(0);
      setY(0);
    });
  }

  function toFull() {
    detent = 'full';
    settleAt(0);
  }

  /** 收起來：從現在的位置一路滑出去，灰底同時淡掉。拖到底與按叉叉共用。 */
  let dismissing = false;
  function dismiss() {
    if (dismissing) return;
    dismissing = true;
    goTall();
    backdrop?.classList.add('drawer-backdrop--out');
    settleAt(fullH + 40, () => onDismissed?.());
  }

  function playIn() {
    const h = drawer.offsetHeight;
    setY(h);
    // 先讓瀏覽器認得起點，下一幀才動 —— 同一幀設兩個值不會有過場
    requestAnimationFrame(() => {
      anim(true);
      setY(0);
      setTimeout(() => anim(false), 340);
    });
  }

  function expand() {
    if (detent === 'full') return;
    goTall();
    detent = 'full';
    requestAnimationFrame(() => settleAt(0));
  }

  // ---------- 一次手勢 ----------

  let startY = 0;
  let startTranslate = 0;
  let mode = 'none'; // none | undecided | sheet | scroll
  let scroller = null;
  // 速度用一小段時間窗算，不看最後一下。兩個事件擠在同一毫秒裡送達時，
  // 單看最後一下會算出十倍的速度，然後把「輕輕推一下」判成「用力甩」——
  // 面板就會在她只是想挪一點的時候整個關掉。
  let samples = [];
  let moved = false;

  const VELOCITY_WINDOW_MS = 90;

  function velocityNow() {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    const first = samples.find((p) => last.t - p.t <= VELOCITY_WINDOW_MS) ?? samples[0];
    const dt = last.t - first.t;
    // 取樣時間太短就不要猜 —— 寧可當作沒有甩
    return dt < 25 ? 0 : (last.y - first.y) / dt;
  }

  const scrollableUnder = (target) => {
    const box = target?.closest?.('.drawer__body');
    return box && box.scrollHeight > box.clientHeight + 1 ? box : null;
  };

  function onStart(clientY, target) {
    // 在輸入框上拖是在移動游標，不是在拖面板
    if (isFormControl(target)) return;
    mode = 'undecided';
    moved = false;
    startY = clientY;
    samples = [{ t: Date.now(), y: clientY }];
    scroller = scrollableUnder(target);
    startTranslate = y;
    anim(false);
  }

  /** @returns {boolean} 有沒有把這個手勢接過來（接了就要擋掉預設行為） */
  function onMove(clientY) {
    if (mode === 'none' || mode === 'scroll') return false;

    const dy = clientY - startY;
    if (Math.abs(dy) > SLOP) moved = true;

    if (mode === 'undecided') {
      // **第一下就要決定**，不能等手指移超過幾個 px 再說。
      // 內容那一塊是 touch-action: pan-y，瀏覽器在第一次 touchmove 就決定
      // 要不要開始捲；那一下沒有 preventDefault，這個手勢就被它拿走了，
      // 之後再擋也沒有用 —— 症狀是「有時候拖不動」。
      if (!dy) return false;
      if (!scroller) mode = 'sheet';
      else if (dy > 0 && scroller.scrollTop <= 0) mode = 'sheet';
      else if (dy < 0 && detent !== 'full') mode = 'sheet';
      else {
        mode = 'scroll';
        return false;
      }
      // 接過來的第一件事：換成滿高，這樣往上拖才有東西可以露。
      // 起點同時重設成「現在」，面板才不會先跳一下補上判斷用掉的距離。
      goTall();
      startY = clientY;
      startTranslate = y;
    }

    samples.push({ t: Date.now(), y: clientY });
    if (samples.length > 12) samples.shift();

    // 往上拖不能超過頂；往下拖不擋，一路可以拖到關掉
    setY(Math.max(0, Math.min(startTranslate + dy, fullH)));
    return true;
  }

  function onEnd() {
    const wasSheet = mode === 'sheet';
    mode = 'none';
    scroller = null;
    if (!wasSheet || !moved) return;

    const velocity = velocityNow();
    const flickDown = velocity > FLICK;
    const flickUp = velocity < -FLICK;

    // 從頂上往下甩一次只回到原本那一格，不會一路關掉 —— 那一下太容易誤觸，
    // 而她可能只是想把面板縮小一點看看底下的日曆。再甩一次才收。
    if (flickDown && detent === 'full') {
      toPeek();
      return;
    }
    if (!flickUp && (flickDown || y > peekY + CLOSE_PX)) {
      dismiss();
      return;
    }
    if (flickUp || y < peekY / 2) toFull();
    else toPeek();
  }

  // 觸控與滑鼠分開接：觸控要能在第一次 move 就擋掉瀏覽器的捲動
  //（passive: false），而那件事只有 touch 事件做得到。
  drawer.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      onStart(e.touches[0].clientY, e.target);
    },
    { passive: true },
  );
  drawer.addEventListener(
    'touchmove',
    (e) => {
      if (onMove(e.touches[0].clientY)) e.preventDefault();
    },
    { passive: false },
  );
  drawer.addEventListener('touchend', onEnd);
  drawer.addEventListener('touchcancel', onEnd);

  drawer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    onStart(e.clientY, e.target);
    const move = (ev) => onMove(ev.clientY);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onEnd();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  // 拖過就不算「點了那顆按鈕」—— 否則往上拖完手一放，面板當場關掉
  drawer.addEventListener(
    'click',
    (e) => {
      if (!moved) return;
      e.stopPropagation();
      e.preventDefault();
      moved = false;
    },
    true,
  );

  setPeek(0);
  setY(0);
  return { expand, playIn, dismiss };
}
