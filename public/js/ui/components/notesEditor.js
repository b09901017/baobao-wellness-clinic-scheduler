// 客戶詳情備註那一段的「編輯」（ADR-0156）：整串一則一列可以刪；分段「加一則短的／加一則長的」。
//
// 電話、LINE 那兩列只寫「在『編輯』客戶資料裡改」—— 值在客戶身上另外兩格，這裡只排位置。
// 順序不在這裡排（「調整順序」在詳情頁原地拖，抽屜自己有直向拖曳）；新加的接在最後。
//
// 狀態由呼叫端持有（同 `marks.js` 的 `mount()`）：「取消」就真的是取消。
// 新增客戶那一頁照舊用 `marks.js` 的 `mount()`（那時候還沒有長備註可以寫）。

import {
  MARK_COLORS, DEFAULT_MARK_COLOR, MAX_MARK_LENGTH, MAX_MARKS, colorToken,
} from '../../domain/customerMarks.js';
import {
  MAX_LONG_TITLE, MAX_LONG_BODY, MAX_LONG_NOTES, newLongNoteId, firstLine,
} from '../../domain/customerNotes.js';
import { icon } from '../icons.js';
import { esc } from './form.js';
import { tip } from './tip.js';

/**
 * @param {HTMLElement} container
 * @param {{items: object[], onChange?: Function}} opts `items` 是 `noteItems()` 的形狀
 * @returns {{value: object[], flush: () => string|null}} `flush()`：把兩格裡還沒按「加入」的字
 *   都收進去（她打完直接按「儲存」—— 切過去的那一格還看得到，存不下去就是假的）；收不進去回一句話
 */
export function mount(container, { items, onChange }) {
  let list = [...(items ?? [])];
  let tab = 'mark';
  let colour = [...list].reverse().find((it) => it.kind === 'mark')?.mark.color ?? DEFAULT_MARK_COLOR;
  let seq = 0;
  // 兩格打到一半的字。`paint()` 整塊重畫（切「短的／長的」、刪一則），畫的時候帶回去 ——
  // 不然她打了一大段長的、手滑點到「加一則短的」再點回來就沒了。**重畫或收進去之前先 `stash()`**；
  // 收進去了那一格才清空。`flush()` 兩格都收：看得到還在的字，按「儲存」不可以存不下去。
  const drafts = { mark: '', title: '', body: '' };
  const stash = () => {
    const read = (sel) => container.querySelector(sel)?.value;
    drafts.mark = read('[data-notesed-mark]') ?? drafts.mark;
    drafts.title = read('[data-notesed-long-title]') ?? drafts.title;
    drafts.body = read('[data-notesed-long-body]') ?? drafts.body;
  };

  const count = (kind) => list.filter((it) => it.kind === kind).length;

  const rowHtml = (it) => {
    if (it.kind === 'phone' || it.kind === 'line' || it.kind === 'chartNo') {
      return `<div class="edrow">
        <span class="edrow__glyph">${icon(it.kind, { size: 15 })}</span>
        <span class="edrow__text ${it.kind === 'line' ? '' : 'mark__num'}">${esc(it.kind === 'line' ? 'LINE' : it.text)}</span>
        ${tip('在「編輯」客戶資料裡改', { label: '怎麼改' })}</div>`;
    }
    const text = it.kind === 'long' ? it.note.title : it.mark.text;
    const lead = it.kind === 'long'
      ? `<span class="edrow__glyph edrow__glyph--long">${icon('note', { size: 15 })}</span>`
      : `<span class="mark__dot edrow__dot" style="--mark: var(${colorToken(it.mark.color)})"></span>`;
    const sub = it.kind === 'long' && firstLine(it.note.body)
      ? `<span class="edrow__sub">${esc(firstLine(it.note.body))}</span>` : '';
    return `<div class="edrow ${it.kind === 'long' ? 'edrow--long' : ''}">${lead}
      <span class="edrow__main"><span class="edrow__text">${esc(text)}</span>${sub}</span>
      <button class="edrow__x" type="button" data-notesed-del="${esc(it.key)}" aria-label="刪掉「${esc(text)}」">
        ${icon('close', { size: 14, width: 2.2 })}</button></div>`;
  };

  const addHtml = () => {
    if (tab === 'mark') {
      if (count('mark') >= MAX_MARKS) return `<p class="muted">短備註已經有 ${MAX_MARKS} 則了，先刪掉一則再加。</p>`;
      return `
        <div class="swatches" style="margin-bottom: var(--space-2)" role="group" aria-label="顏色">
          ${MARK_COLORS.map((c) => `
            <button class="swatch" type="button" data-notesed-colour="${c.id}"
                    aria-pressed="${c.id === colour}" aria-label="${esc(c.label)}"
                    style="--mark: var(${c.token})"></button>`).join('')}
        </div>
        <div class="edadd">
          <input type="text" data-notesed-mark maxlength="${MAX_MARK_LENGTH}" placeholder="例：喜歡下午、指定女治療師"
                 value="${esc(drafts.mark)}"
                 aria-label="新的短備註" autocomplete="off" />
          <button class="btn" type="button" data-notesed-add-mark>加入</button>
        </div>`;
    }
    if (count('long') >= MAX_LONG_NOTES) return `<p class="muted">長備註已經有 ${MAX_LONG_NOTES} 則了，先刪掉一則再加。</p>`;
    return `
      <div class="edlong">
        <input type="text" data-notesed-long-title maxlength="${MAX_LONG_TITLE}" placeholder="標題，例：家人與接送"
               value="${esc(drafts.title)}"
               aria-label="長備註的標題" autocomplete="off" />
        <textarea data-notesed-long-body maxlength="${MAX_LONG_BODY}" rows="5" placeholder="想寫多長都可以"
                  aria-label="長備註的內文">${esc(drafts.body)}</textarea>
        <button class="btn" type="button" data-notesed-add-long>加入</button>
      </div>`;
  };

  const paint = (focus) => {
    container.innerHTML = `
      ${list.length
        ? `<div class="edlist">${list.map(rowHtml).join('')}</div>`
        : '<p class="muted" style="margin: 0 0 var(--space-3)">還沒有備註。</p>'}
      <div class="seg seg--tabs" role="tablist" aria-label="加哪一種">
        <button class="seg__btn" type="button" role="tab" data-notesed-tab="mark" aria-selected="${tab === 'mark'}">加一則短的</button>
        <button class="seg__btn" type="button" role="tab" data-notesed-tab="long" aria-selected="${tab === 'long'}">加一則長的</button>
      </div>
      <div data-notesed-add>${addHtml()}</div>`;
    if (focus) container.querySelector(focus)?.focus();
  };

  const commit = (focus) => {
    paint(focus);
    onChange?.(list);
  };

  /** 短的那一格加進去（讀 `drafts`，呼叫前先 `stash()`）。回一句收不進去的理由，或 null。 */
  const addMark = () => {
    const text = drafts.mark.trim();
    if (!text) return null;
    if (count('mark') >= MAX_MARKS) return `短備註最多 ${MAX_MARKS} 則`;
    // 同一句話加第二次多半是手滑，不是真的想要兩則
    if (!list.some((it) => it.kind === 'mark' && it.mark.text === text)) {
      seq += 1;
      list = [...list, { key: `mark:new${seq}`, kind: 'mark', mark: { text, color: colour } }];
    }
    drafts.mark = '';
    return null;
  };

  /** 長的那一格加進去（同上）。沒有標題時切到那一頁、游標放在標題。 */
  const addLong = () => {
    const title = drafts.title.trim();
    const { body } = drafts;
    if (!title && !body.trim()) return null;
    if (!title) {
      tab = 'long';
      paint('[data-notesed-long-title]');
      return '長備註要有標題';
    }
    if (count('long') >= MAX_LONG_NOTES) return `長備註最多 ${MAX_LONG_NOTES} 則`;
    const note = { id: newLongNoteId(), title, body };
    list = [...list, { key: `long:${note.id}`, kind: 'long', note }];
    drafts.title = '';
    drafts.body = '';
    return null;
  };

  /** 按「加入」：只收那一格；收進去了才重畫。 */
  const addOne = (add, focus) => {
    stash();
    const n = list.length;
    const said = add();
    if (list.length !== n || !said) commit(focus);
    return said;
  };

  container.addEventListener('click', (e) => {
    const del = e.target.closest('[data-notesed-del]');
    if (del) {
      stash();
      list = list.filter((it) => it.key !== del.dataset.notesedDel);
      commit();
      return;
    }
    const tb = e.target.closest('[data-notesed-tab]');
    if (tb) {
      stash();
      tab = tb.dataset.notesedTab;
      paint(tab === 'mark' ? '[data-notesed-mark]' : '[data-notesed-long-title]');
      return;
    }
    const sw = e.target.closest('[data-notesed-colour]');
    if (sw) {
      colour = sw.dataset.notesedColour;
      container.querySelectorAll('[data-notesed-colour]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === sw)));
      return;
    }
    let said = null;
    if (e.target.closest('[data-notesed-add-mark]')) said = addOne(addMark, '[data-notesed-mark]');
    if (e.target.closest('[data-notesed-add-long]')) said = addOne(addLong, '[data-notesed-long-title]');
    if (said) container.dispatchEvent(new CustomEvent('notesed:say', { detail: said, bubbles: true }));
  });

  // Enter 直接加（短的那一格）。內文那一格的 Enter 是換行。
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('[data-notesed-mark]')) return;
    e.preventDefault();
    const said = addOne(addMark, '[data-notesed-mark]');
    if (said) container.dispatchEvent(new CustomEvent('notesed:say', { detail: said, bubbles: true }));
  });

  paint();
  onChange?.(list);

  return {
    get value() { return list; },
    flush() {
      stash();
      const said = addMark() ?? addLong();
      if (!said) commit();
      else onChange?.(list); // 短的那一則收進去了、長的那一則缺標題：呼叫端的那一份也要有短的
      return said;
    },
  };
}
