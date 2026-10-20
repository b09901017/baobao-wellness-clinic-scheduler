// 點一則長備註 → 畫面中間浮出一張卡看全文（ADR-0156）。
//
// ## 從她點的那一顆長出來（她 2026-10-19 選的）
//
// 卡片底下那一層（`.lncard__bg`）從那一顆的位置與大小，位移＋縮放成整張（`transform-origin: 0 0`）；
// 字等底那一層長好了再淡進來 —— 丸子比卡片小很多，字跟著一起縮放會糊。關掉時縮回那一顆；
// 那一顆不在畫面上了（重畫過、捲走了）就改成淡出。開著的時候那一顆是隱形的（`.is-source`），
// 看起來就是「它變大了」。
//
// **WAAPI 不吃 `app.css` 底部那條 reduced-motion 規則**（那一條只壓 CSS 的 animation／transition），
// 所以自己問 `matchMedia()`：是就只淡入淡出。
//
// ## 返回鍵關它，不是離開那一頁
//
// 推一層（`pushLayer()`），handle 存成變數、問 `.active`（CLAUDE.md「存起來的 pushLayer() handle」）。
// 它蓋住整頁，上緣自己讓開鏡頭那一塊（`env(safe-area-inset-top)`，ADR-0147）—— 在 CSS 裡。
//
// ## 改這一則就在這張卡上改
//
// 標題＋內文，取消／存起來在卡片**頂端**（鍵盤推不走它，同備忘錄的編輯卡）。存檔由呼叫端做
// （`onSave(next)`，要寫的那幾格由 `domain/customerNotes.js` 算）；改到一半按返回或點外面，
// 先問要不要存（同備忘錄 `leaveEdit()`：關掉那道框＝繼續改）。

import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import { chooseAction } from './dialog.js';
import { esc } from './form.js';
import { MAX_LONG_TITLE, MAX_LONG_BODY, validateLongNotes } from '../../domain/customerNotes.js';

/** 同一時間只有一張。 */
let open = null;

/** 推的那一層。**問 `.active`，不要問它是不是 null**（換頁會把 stack 清光）。 */
let layer = null;

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const EASE_OUT = 'cubic-bezier(0.22, 0.85, 0.3, 1)';

/**
 * @param {object} o
 * @param {() => HTMLElement|null} o.source 她點的那一顆（關掉時再問一次 —— 那一段可能重畫過）
 * @param {string} o.eyebrow 抬頭小字（客戶名）
 * @param {{id: string, title: string, body: string}} o.note
 * @param {(next: object) => Promise<object|void>} [o.onSave] 存那一則；丟錯＝沒存（toast 已經講了）
 * @param {() => void} [o.onDeck] 「在長備註那一疊看」；沒給就不畫那一顆
 * @param {boolean} [o.editing] 一打開就在改
 */
export function openNoteCard({ source, eyebrow, note, onSave, onDeck, editing = false }) {
  closeNoteCard({ instant: true });

  const root = document.createElement('div');
  root.className = 'lnov';
  root.innerHTML = `
    <div class="lnov__scrim" data-notecard-close></div>
    <article class="lncard" role="dialog" aria-modal="true" aria-labelledby="lncard-title"></article>`;
  document.body.appendChild(root);
  const card = root.querySelector('.lncard');

  const state = { note: { ...note }, editing, error: '', closing: false, saving: false };
  open = { root, card, state, source, eyebrow, onSave, onDeck };

  paint();
  animateIn();

  layer = pushLayer(() => {
    // 返回鍵：那一層已經被收掉了。改到一半的話先問；她選繼續改就再推一層回來。
    layer = null;
    requestClose();
  });

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    requestClose();
  });

  return { close: () => closeNoteCard() };
}

/** 有沒有開著（測試與呼叫端用）。 */
export const isNoteCardOpen = () => Boolean(open);

/** 收掉。`instant`：不播動畫（換頁、換一張）。 */
export function closeNoteCard({ instant = false } = {}) {
  if (!open || open.state.closing) return;
  const o = open;
  o.state.closing = true;
  if (layer?.active) layer.pop();
  layer = null;

  const done = () => {
    o.root.remove();
    o.source?.()?.classList.remove('is-source');
    for (const el of document.querySelectorAll('.is-source[data-notes-long]')) el.classList.remove('is-source');
    if (open === o) open = null;
    o.source?.()?.focus?.({ preventScroll: true });
  };

  if (instant || reduced()) {
    done();
    return;
  }

  const scrim = o.root.querySelector('.lnov__scrim');
  const bg = o.card.querySelector('.lncard__bg');
  const src = visibleSource(o);
  let anim;
  if (src && bg) {
    const to = shrinkTo(src, o.card);
    contentOf(o.card).forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' }));
    anim = bg.animate([
      { transform: 'none', borderRadius: '18px' },
      { transform: to, borderRadius: '17px' },
    ], { duration: 320, delay: 60, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' });
  } else {
    anim = o.card.animate([
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(24px) scale(0.97)' },
    ], { duration: 200, easing: 'ease-in', fill: 'forwards' });
  }
  scrim?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' });
  anim.finished.then(done, done);
}

// ---------------------------------------------------------------------------

/** 那一顆還在畫面上嗎（捲走了、重畫掉了 → 改成淡出）。 */
function visibleSource(o) {
  const el = o.source?.();
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return null;
  return el;
}

/** 從整張卡變回那一顆的 transform。 */
function shrinkTo(src, card) {
  const s = src.getBoundingClientRect();
  const d = card.getBoundingClientRect();
  return `translate(${s.left - d.left}px, ${s.top - d.top}px) scale(${s.width / d.width}, ${s.height / d.height})`;
}

const contentOf = (card) => [...card.querySelectorAll(':scope > :not(.lncard__bg)')];

function animateIn() {
  const { root, card } = open;
  const scrim = root.querySelector('.lnov__scrim');
  const src = visibleSource(open);
  if (reduced()) {
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
  } else if (src) {
    const bg = card.querySelector('.lncard__bg');
    bg.animate([
      { transform: shrinkTo(src, card), borderRadius: '17px' },
      { transform: 'none', borderRadius: '18px' },
    ], { duration: 440, easing: EASE_OUT });
    contentOf(card).forEach((el, i) => el.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, delay: 190 + i * 50, easing: EASE_OUT, fill: 'backwards' },
    ));
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  } else {
    card.animate([
      { opacity: 0, transform: 'translateY(32px) scale(0.97)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 320, easing: EASE_OUT });
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
  }
  src?.classList.add('is-source');
  try {
    navigator.vibrate?.(8);
  } catch {
    /* 沒有就算了 */
  }
}

function paint() {
  const { card, state, eyebrow, onDeck, onSave } = open;
  const n = state.note;
  card.classList.toggle('lncard--edit', state.editing);

  if (state.editing) {
    card.innerHTML = `
      <div class="lncard__bg"></div>
      <div class="lncard__bar">
        <p class="lncard__eyebrow">${esc(eyebrow)}・改長備註</p>
        <button class="btn btn--sm" type="button" data-notecard-cancel>取消</button>
        <button class="btn btn--sm btn--primary" type="button" data-notecard-save>存起來</button>
      </div>
      <div class="lncard__edit">
        <h2 class="visually-hidden" id="lncard-title">改「${esc(n.title)}」</h2>
        <input type="text" data-notecard-title maxlength="${MAX_LONG_TITLE}" value="${esc(n.title)}"
               placeholder="標題" aria-label="標題" autocomplete="off" />
        ${state.error ? `<p class="lncard__err" role="alert">${esc(state.error)}</p>` : ''}
        <textarea data-notecard-body maxlength="${MAX_LONG_BODY}" aria-label="內文"
                  placeholder="想寫多長都可以">${esc(n.body)}</textarea>
      </div>`;
    card.querySelector('[data-notecard-body]')?.focus({ preventScroll: true });
    return;
  }

  card.innerHTML = `
    <div class="lncard__bg"></div>
    <div class="lncard__head">
      <div>
        <p class="lncard__eyebrow">${esc(eyebrow)}・長備註</p>
        <h2 class="lncard__title" id="lncard-title">${esc(n.title)}</h2>
      </div>
      <button class="iconbtn lncard__x" type="button" data-notecard-close aria-label="關掉">
        ${icon('close', { size: 18, width: 2 })}</button>
    </div>
    <div class="lncard__body" tabindex="0">${n.body.trim() ? esc(n.body) : '<span class="muted">（還沒有內文）</span>'}</div>
    ${onDeck || onSave ? `
      <div class="lncard__foot">
        ${onDeck ? '<button class="btn btn--sm" type="button" data-notecard-deck>在長備註那一疊看</button>' : ''}
        <span class="grow"></span>
        ${onSave ? `<button class="btn btn--sm" type="button" data-notecard-edit>
          ${icon('pencil', { size: 15 })}改這一則</button>` : ''}
      </div>` : ''}`;
  card.querySelector('[data-notecard-close]')?.focus({ preventScroll: true });
}

/** 畫面上打的字。 */
function readEditor() {
  const { card, state } = open;
  return {
    ...state.note,
    title: card.querySelector('[data-notecard-title]')?.value ?? state.note.title,
    body: card.querySelector('[data-notecard-body]')?.value ?? state.note.body,
  };
}

function isDirty() {
  if (!open?.state.editing) return false;
  const now = readEditor();
  return now.title.trim() !== open.state.note.title.trim() || now.body !== open.state.note.body;
}

function repaintFade() {
  paint();
  if (!reduced()) contentOf(open.card).forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }));
}

async function onClick(e) {
  if (!open) return;
  const hit = (sel) => e.target.closest(sel);

  if (hit('[data-notecard-close]')) {
    requestClose();
    return;
  }
  if (hit('[data-notecard-edit]')) {
    open.state.editing = true;
    open.state.error = '';
    repaintFade();
    return;
  }
  if (hit('[data-notecard-cancel]')) {
    open.state.editing = false;
    open.state.error = '';
    repaintFade();
    return;
  }
  if (hit('[data-notecard-save]')) {
    await save();
    return;
  }
  if (hit('[data-notecard-deck]')) {
    const { onDeck } = open;
    closeNoteCard({ instant: true });
    onDeck?.();
  }
}

async function save() {
  const o = open;
  if (!o || o.state.saving) return;
  const next = readEditor();
  next.title = next.title.trim();
  const errors = validateLongNotes([next]);
  if (errors.length) {
    o.state.note = { ...o.state.note, body: next.body };
    o.state.error = errors[0];
    paint();
    o.card.querySelector('[data-notecard-title]').value = next.title;
    return;
  }
  o.state.saving = true;
  try {
    await o.onSave?.(next);
  } catch {
    // 沒存進去（toast 已經講了）：留在編輯，打的字還在
    o.state.saving = false;
    return;
  }
  o.state.saving = false;
  if (open !== o) return;
  o.state.note = next;
  o.state.editing = false;
  o.state.error = '';
  repaintFade();
  // 呼叫端存完重畫了那一段：新的那一顆要接著隱形
  o.source?.()?.classList.add('is-source');
}

/** 點外面、按返回、按 Escape、按叉叉：沒改過直接收；改到一半先問。 */
async function requestClose() {
  const o = open;
  if (!o || o.state.closing) return;
  if (!isDirty()) {
    closeNoteCard();
    return;
  }
  if (o.state.asking) return;
  o.state.asking = true;
  try {
    const pick = await chooseAction({
      title: '這一則改到一半',
      consequences: [
        '存起來：卡片上就是剛剛打的字。',
        '不要了：回到按「改這一則」之前的樣子，剛剛打的字不會留下來。',
      ],
      choices: [
        { key: 'discard', label: '不要了' },
        { key: 'save', label: '存起來', tone: 'primary' },
      ],
    });
    if (open !== o) return;
    if (pick === 'save') {
      await save();
      if (!o.state.editing) closeNoteCard();
    } else if (pick === 'discard') {
      closeNoteCard();
    }
  } finally {
    o.state.asking = false;
    // 還開著（她選了繼續改、或存失敗）：返回鍵那一層要補回來
    if (open === o && !o.state.closing && !layer?.active) {
      layer = pushLayer(() => {
        layer = null;
        requestClose();
      });
    }
  }
}
