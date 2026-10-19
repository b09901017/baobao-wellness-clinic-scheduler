// 備註那一串「調整順序」（ADR-0156）：按住一則上下拖，放開就吸到位。
//
// ## 在詳情頁原地做，不在抽屜裡
//
// 抽屜自己有直向的拖曳（拖著收，`sheet.js` 的 `wireDrag()`），兩個搶同一個手勢。
// 平常那一串是一排丸子；**只有排序的時候變成一列一列**（拖曳要固定高的列）。
//
// ## 做法
//
// 每一列固定高（`ROW_H`＋`GAP`），用 `translateY` 排；被拖的那一列跟著手指，其餘的滑開，
// 放開用 `--ease-pop` 吸到位（`.is-settling`，CSS 的過場 —— reduced-motion 那條規則管得到）。
// pointer events ＋ `setPointerCapture()`，手機、iPad、滑鼠同一條路；只有這幾列 `touch-action: none`，
// 所以拖的時候頁面不會跟著捲 —— **拖到畫面上下緣 60px 內就自己捲 `.app__main`**
// （最多 12 則短的＋20 則長的＋電話＋LINE，一個畫面放不下）。鍵盤上下鍵也排得動。
//
// 狀態在呼叫端：`order` 是 key 的陣列，按「完成」才存。

import { icon } from '../icons.js';
import { esc } from './form.js';
import { colorToken } from '../../domain/customerMarks.js';

export const ROW_H = 50;
export const GAP = 8;
const STEP = ROW_H + GAP;
const EDGE = 60;
const MAX_SPEED = 14;

const buzz = (ms) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS 沒有，靜靜不做 */
  }
};

/** 一列裡面寫什麼。 */
function label(it) {
  const g = (name) => `<span class="rrow__glyph rrow__glyph--${name}">${icon(name, { size: 16 })}</span>`;
  if (it.kind === 'phone') return `${g('phone')}<span class="rrow__text mark__num">${esc(it.text)}</span>`;
  if (it.kind === 'line') return `${g('line')}<span class="rrow__text">LINE</span>`;
  if (it.kind === 'chartNo') return `${g('chartNo')}<span class="rrow__text mark__num">${esc(it.text)}</span>`;
  if (it.kind === 'long') {
    return `${g('note')}<span class="rrow__text">${esc(it.note.title)}</span><span class="rrow__kind">長備註</span>`;
  }
  return `<span class="mark__dot rrow__dot" style="--mark: var(${colorToken(it.mark.color)})"></span>
    <span class="rrow__text">${esc(it.mark.text)}</span>`;
}

/** 排序那一塊的 HTML。`items` 已經照 `order` 排好。怎麼拖那一句是抬頭旁邊的 `tip()`（呼叫端畫）。 */
export function reorderHtml(items) {
  return `
    <div class="reorder" data-reorder-box role="list" aria-label="備註的順序"
         style="height: ${items.length * STEP - GAP}px">
      ${items.map((it, i) => `
        <div class="rrow" data-reorder-key="${esc(it.key)}" tabindex="0" role="listitem"
             aria-label="第 ${i + 1} 則，用上下鍵移動" style="transform: translateY(${i * STEP}px)">
          <span class="rrow__main">${label(it)}</span>
          <span class="rrow__grip">${icon('grip', { size: 20 })}</span>
        </div>`).join('')}
    </div>`;
}

function layout(box, order, except = null) {
  for (const r of box.querySelectorAll('.rrow')) {
    if (r === except) continue;
    const i = order.indexOf(r.dataset.reorderKey);
    r.style.transform = `translateY(${i * STEP}px)`;
    r.setAttribute('aria-label', `第 ${i + 1} 則，用上下鍵移動`);
  }
}

/**
 * 接上拖曳。`state.order` 會被換掉（不是就地改）。
 *
 * @param {HTMLElement} box `[data-reorder-box]`
 * @param {{order: string[]}} state
 */
export function wireReorder(box, state) {
  if (!box) return;
  const scroller = box.closest('.app__main') ?? document.scrollingElement;

  box.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.rrow');
    if (!row || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();

    const key = row.dataset.reorderKey;
    const order = state.order;
    const from = order.indexOf(key);
    const others = order.filter((k) => k !== key);
    const startY = e.clientY;
    const startScroll = scroller.scrollTop;
    let lastY = e.clientY;
    let target = from;
    let raf = 0;

    try {
      row.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件沒有 pointerId 可以抓 */
    }
    row.classList.remove('is-settling');
    row.classList.add('is-lifted');
    row.style.transform = `translateY(${from * STEP}px) scale(1.03)`;
    buzz(12);

    const place = () => {
      const max = (order.length - 1) * STEP;
      const dy = lastY - startY + (scroller.scrollTop - startScroll);
      const y = Math.max(-STEP * 0.35, Math.min(max + STEP * 0.35, from * STEP + dy));
      row.style.transform = `translateY(${y}px) scale(1.03)`;
      const t = Math.max(0, Math.min(order.length - 1, Math.round(y / STEP)));
      if (t !== target) {
        target = t;
        const tentative = [...others];
        tentative.splice(target, 0, key);
        layout(box, tentative, row);
        buzz(5);
      }
    };

    // 拖到上下緣：每一格畫面捲一點，愈靠邊愈快
    const edgeSpeed = () => {
      const r = scroller === document.scrollingElement
        ? { top: 0, bottom: window.innerHeight }
        : scroller.getBoundingClientRect();
      if (lastY < r.top + EDGE) return -MAX_SPEED * Math.min(1, (r.top + EDGE - lastY) / EDGE);
      if (lastY > r.bottom - EDGE) return MAX_SPEED * Math.min(1, (lastY - (r.bottom - EDGE)) / EDGE);
      return 0;
    };
    const tick = () => {
      raf = 0;
      const v = edgeSpeed();
      if (!v) return;
      const before = scroller.scrollTop;
      scroller.scrollTop += v;
      if (scroller.scrollTop !== before) place();
      raf = requestAnimationFrame(tick);
    };

    const move = (ev) => {
      lastY = ev.clientY;
      place();
      if (!raf && edgeSpeed()) raf = requestAnimationFrame(tick);
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      row.removeEventListener('pointermove', move);
      row.removeEventListener('pointerup', up);
      row.removeEventListener('pointercancel', up);
      const final = [...others];
      final.splice(target, 0, key);
      state.order = final;
      row.classList.remove('is-lifted');
      row.classList.add('is-settling');
      layout(box, final);
      // 放回原位的話 transform 沒變、不會有 transitionend —— 過場時間到了照樣收
      const fallback = setTimeout(() => settle(), 420);
      function settle(ev) {
        if (ev && ev.propertyName !== 'transform') return;
        clearTimeout(fallback);
        row.classList.remove('is-settling');
        row.removeEventListener('transitionend', settle);
      }
      row.addEventListener('transitionend', settle);
    };
    row.addEventListener('pointermove', move);
    row.addEventListener('pointerup', up);
    row.addEventListener('pointercancel', up);
  });

  // 鍵盤：上下鍵移一格，焦點跟著那一列
  box.addEventListener('keydown', (e) => {
    const row = e.target.closest('.rrow');
    if (!row || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const order = [...state.order];
    const i = order.indexOf(row.dataset.reorderKey);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    state.order = order;
    layout(box, order);
  });
}
