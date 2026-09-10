// 說明泡泡：點一下才浮出來的那一小句話。
//
// 她 2026-09-10：
//
// > 整個app到處充滿者各種文字說明…非常占版面，一眼看下去非常雜亂，會視覺疲勞…
// > 我想要優化成Tooltip，小小的迷你的說明小泡泡，點了之後才會小小的在旁邊浮出說明
// > …有點像是對話泡泡的那種泡泡有一個小尖角的…就在原本?泡泡的那邊 浮出來
//
// ## 兩種，而且只有兩種
//
//   help  ⓘ 那一類：新手導覽、欄位說明、圖例 —— 讀過一次就夠的話
//   warn  ⚠ 那一類：這一刻有話要講，但**不改變按下去的結果**
//
// 會改變寫入結果的警告**不可以**收進來（`.scratch/quieter-screens/issues/08` 的五條紅線）。
// 分堆的判準只有一句：這一句藏起來之後，她按下去的結果會不會跟她以為的不一樣？
//
// ## 為什麼泡泡掛在 body 上
//
// 卡片、抽屜、卡牌幾乎都是 `overflow: hidden`。泡泡長在按鈕旁邊的話，
// 靠近卡片邊緣的那幾顆會被裁掉一半 —— 而那正是說明最長的那幾句。
// 所以它是 `position: fixed`，位置在打開的那一刻量。
//
// ## 為什麼不走 `pushLayer()`
//
// 它太輕了。一句說明佔一格瀏覽器紀錄的話，她看完按返回鍵會以為要回上一頁，
// 結果只是關掉一個泡泡 —— 下一次按返回鍵才真的走。點外面、Escape、換頁、
// 捲動都會關掉它，一次只開一張。
//
// ## 為什麼 `?` 是 CSS 畫的
//
// 16px 的圓裡放一個 SVG 問號，線條會糊成一團；一個字形清楚得多。
// 而那個字不可以是 HTML 裡的文字 —— 那樣「標籤之間沒有任何文字」這一條
// （`tests/tip.test.js`）就守不住，常駐文字會從這個洞長回來。

import { icon } from '../icons.js';
import { esc } from './form.js';

export const KINDS = Object.freeze(['help', 'warn']);

/**
 * 那一顆的 HTML。**沒話講就回空字串** —— 一個像素都不佔。
 *
 * 那段字放在 `data-tip` 裡，**標籤之間一個字都沒有**：收起來的時候它真的不在畫面上。
 *
 * @param {string} text 要講的那一句（純文字，這裡負責逃脫）
 * @param {{kind?: 'help'|'warn', label?: string}} [opts]
 *   label：讀螢幕時這一顆叫什麼。預設「說明」／「提醒」
 * @returns {string}
 */
export function tip(text, { kind = 'help', label } = {}) {
  const body = String(text ?? '').trim();
  if (!body) return '';
  const k = KINDS.includes(kind) ? kind : 'help';
  const name = label ?? (k === 'warn' ? '提醒' : '說明');
  return `<button class="tip tip--${k}" type="button" data-tip="${esc(body)}" `
    + `aria-expanded="false" aria-label="${esc(name)}">`
    + `${k === 'warn' ? icon('alert', { size: 13, width: 2.2 }) : ''}</button>`;
}

// ---------------------------------------------------------------------------
// 浮出來的那一張
// ---------------------------------------------------------------------------

/** 同一時間只有一張。 */
let current = null;
let installed = false;
let seq = 0;

/** 泡泡與那一顆之間留多少、離視窗邊緣至少多少、小尖角離泡泡邊緣至少多少。 */
const GAP = 9;
const EDGE = 10;
const TAIL_INSET = 16;

/**
 * 開機時接一次。**事件委派掛在 document 上**，所以每一頁、每一次重畫
 * 長出來的那幾顆都不用各自接 —— 各自接的話，漏接一頁就是「那一顆點了沒反應」。
 *
 * click 走 **capture**：那一顆常常長在一整列可以點的東西裡面（任務列、額度卡），
 * 在冒泡階段才接的話，列本身的點擊會先發生 —— 她只是想看一句說明，卻被帶去別頁。
 */
export function install(doc = document) {
  if (installed) return;
  installed = true;

  doc.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.tip[data-tip]');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (current?.btn === btn) close();
      else open(btn);
      return;
    }
    // 點在泡泡裡面不關（她可能正在選字），點到其他任何地方就關 ——
    // **而且那一下照樣做它原本的事**，不多要她點一次。
    if (current && !current.bubble.contains(e.target)) close();
  }, true);

  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) close({ refocus: true });
  });
  window.addEventListener('hashchange', () => close());
  window.addEventListener('resize', () => close());
  // 捲動就收：位置是打開那一刻量的，捲了之後小尖角會指著空氣
  doc.addEventListener('scroll', () => close(), true);
}

function open(btn) {
  close();
  const kind = btn.classList.contains('tip--warn') ? 'warn' : 'help';

  const bubble = document.createElement('div');
  bubble.className = `tip__bubble tip__bubble--${kind}`;
  bubble.id = `tip-${++seq}`;
  // 點了才出現的說明是「切換式提示」，不是滑過去的 tooltip：
  // 用 status 讓讀螢幕的人在它出現時聽得到，而不是只有焦點移過去才念
  bubble.setAttribute('role', 'status');
  bubble.innerHTML = `<span class="tip__text">${esc(btn.dataset.tip)}</span>`
    + '<span class="tip__tail" aria-hidden="true"></span>';
  document.body.appendChild(bubble);

  place(btn, bubble);
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', bubble.id);
  current = { btn, bubble };

  // 下一幀才切到 open：先讓瀏覽器畫出「縮小、透明」的那一格，transition 才有起點
  requestAnimationFrame(() => {
    if (current?.bubble === bubble) bubble.dataset.state = 'open';
  });
}

/**
 * 量位置。預設在那一顆**底下**，底下放不下才翻到上面；左右夾在視窗裡，
 * 小尖角跟著位移量一起移 —— 它永遠指著她按的那一顆，不是泡泡的正中間。
 *
 * `--tip-origin` 綁在小尖角上：泡泡是**從那一顆裡長出來的**，不是憑空淡入。
 */
function place(btn, bubble) {
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const w = bubble.offsetWidth;
  const h = bubble.offsetHeight;

  const cx = r.left + r.width / 2;
  const left = Math.round(Math.min(Math.max(cx - w / 2, EDGE), vw - w - EDGE));
  const below = r.bottom + GAP + h <= vh - EDGE || r.top - GAP - h < EDGE;
  const top = Math.round(below ? r.bottom + GAP : r.top - GAP - h);
  const tailX = Math.round(Math.min(Math.max(cx - left, TAIL_INSET), w - TAIL_INSET));

  bubble.dataset.side = below ? 'below' : 'above';
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.setProperty('--tip-tail-x', `${tailX}px`);
  bubble.style.setProperty('--tip-origin', `${tailX}px ${below ? '0' : '100%'}`);
}

/** @param {{refocus?: boolean}} [o] refocus：Escape 關的，焦點回到那一顆 */
function close({ refocus = false } = {}) {
  if (!current) return;
  const { btn, bubble } = current;
  current = null;
  btn.setAttribute('aria-expanded', 'false');
  btn.removeAttribute('aria-describedby');
  if (refocus && btn.isConnected) btn.focus();

  // 收的時候也有一小段動畫；`prefers-reduced-motion` 那一段會把 transition 歸零，
  // 所以**不用 setTimeout 等它**（tokens.css 的檔頭說過：那條路繞得過那一段）
  delete bubble.dataset.state;
  bubble.addEventListener('transitionend', () => bubble.remove(), { once: true });
  // 保險：沒有 transition 可以結束的時候（被歸零、或瀏覽器跳過）也要拿掉
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (getComputedStyle(bubble).transitionDuration.split(',').every((d) => parseFloat(d) === 0)) {
      bubble.remove();
    }
  }));
}
