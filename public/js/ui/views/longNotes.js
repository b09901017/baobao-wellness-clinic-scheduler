// 長備註：全部的人的長備註，一疊左右滑的卡（ADR-0156，staging-polish 15）。
//
// 她 10/18：「多一個地方是可以讓我記所有人的備註 … 可以像備忘錄一樣選人寫備註，有標題，
// 然後一樣可以左右滑，搜尋人等等」。
//
// ## 照備忘錄的骨架，共用的抽出去了
//
// 停在哪一張、滑到某一張、丸子與圓點跟著亮：`components/deck.js`（備忘錄也用它）；
// 卡片、丸子、圓點、搜尋列、懸浮鈕：同一份 CSS（`.pbdeck`、`.pbcard`…）。
// 共用不了的是**資料**：備忘錄一份是一筆文件，長備註是**客戶身上的一格**（`customer.longNotes`）——
// 存一則是改那一位客戶（`domain/customerNotes.js` 的 `withLongNote()`，跟客戶詳情寫的是同一份），
// 所以編輯、存、刪各自寫在這裡，沒有複製備忘錄那一支。
//
// ## 這一疊排什麼
//
// 在服務中的客戶排前面、停用的排後面（卡上一顆「已停用」—— 停用不是刪掉，她可能正要看）；
// 同一位照她在詳情排的順序；刪掉的客戶不列（`longNoteRows()`）。
//
// `#/customers/notes/<客戶>:<那一則>` 是「這一疊，開在那一張」（同備忘錄 `#/playbook/:id`）——
// 客戶詳情中間那張卡的「在長備註那一疊看」指著它。

import * as data from '../../data/customers.js';
import {
  longNoteRows, matchesLongNote, withLongNote, withoutLongNote, validateLongNotes, newLongNoteId,
  readLongNotes, MAX_LONG_TITLE, MAX_LONG_BODY, MAX_LONG_NOTES,
} from '../../domain/customerNotes.js';
import { nameHas } from '../../domain/customers.js';
import { watchDeck, focusCard, markActive } from '../components/deck.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { chooseAction } from '../components/dialog.js';
import { esc } from '../components/form.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { back, pushLayer, whenSettled } from '../nav.js';
import * as toast from '../toast.js';

/** 這一頁現在的樣子。**存在模組裡不進網址** —— 它是看法，不是位置。 */
let ctx = null;

/** 認「現在停在第幾張」的那一個。每次重畫都要先斷掉。 */
let spy = null;

/** 編輯中推的那一層：返回鍵先問要不要存（不是直接離開這一頁）。**問 `.active`。** */
let editLayer = null;

/** 「改到一半要不要存」那一道正在問（Escape 會同時打到這一頁與對話框）。 */
let leaving = false;

/** 還沒存進去的那一則。 */
const NEW_ID = '__new__';

const keyOf = (customerId, noteId) => `${customerId}:${noteId}`;

export async function render(el, focusKey = null) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  let customers;
  try {
    customers = await data.list();
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }
  ctx = {
    el, customers, search: '', searchOpen: false, editing: null, armed: null,
    activeKey: focusKey ? decodeURIComponent(focusKey) : null,
  };
  paint();
  if (ctx.activeKey) focus(ctx.activeKey, 'auto');
}

// ---------------------------------------------------------------------------
// 畫
// ---------------------------------------------------------------------------

function allRows() {
  const rows = longNoteRows(ctx.customers);
  const ed = ctx.editing;
  if (ed?.isNew) {
    const customer = ctx.customers.find((c) => c.id === ed.customerId);
    rows.push({ customer, note: { id: NEW_ID, title: '', body: '' }, key: ed.key });
  }
  return rows;
}

/** 現在該畫哪幾張。正在改的那一張一定留著。 */
function visibleRows() {
  return allRows().filter((r) => r.key === ctx.editing?.key || matchesLongNote(r, ctx.search));
}

function activeKey(shown) {
  return shown.some((r) => r.key === ctx.activeKey) ? ctx.activeKey : shown[0]?.key ?? null;
}

const titleOf = (n) => String(n?.title ?? '').trim() || '新的一則';

function paint() {
  const total = longNoteRows(ctx.customers).length;
  ctx.el.innerHTML = `
    <div class="pbpage" data-page>
      <a class="backlink" href="#/customers" data-back>${icon('left', { size: 17 })}客戶</a>
      <div class="pbtop">
        <h1 class="page__title">長備註 ${total ? `<span class="section__n">${total} 則</span>` : ''}</h1>
        <button class="iconbtn" type="button" data-search-toggle
                aria-label="找長備註" aria-expanded="${ctx.searchOpen}">${icon('search', { size: 20 })}</button>
      </div>
      <div class="pbsearch" data-searchwrap data-open="${ctx.searchOpen}">
        <div class="pbsearch__in">
          <input type="text" data-search value="${esc(ctx.search)}" placeholder="找人名、標題或裡面的字"
                 aria-label="找長備註" enterkeyhint="search" autocomplete="off" />
        </div>
      </div>
      <div data-stage>${stageHtml()}</div>
      <div class="fab" data-fab ${ctx.editing ? 'hidden' : ''}>
        <button class="fab__main" type="button" data-new aria-label="寫一則長備註">
          ${icon('plus', { size: 24, width: 2 })}</button>
      </div>
    </div>`;
  wire();
  watch();
}

function stageHtml() {
  const shown = visibleRows();
  if (!shown.length) {
    return ctx.search
      ? '<p class="muted" style="padding: var(--space-6) 0">沒有符合的。</p>'
      : '<p class="muted pbempty">還沒有長備註。右下角那顆，先選人再寫。</p>';
  }
  const on = activeKey(shown);
  return `
    <div class="chiprow pbchips noscroll-bar" role="group" aria-label="全部的長備註">
      ${shown.map((r) => `
        <button class="chip chip--sm" type="button" data-goto="${esc(r.key)}"
                aria-pressed="${r.key === on}">${esc(r.customer?.name ?? '')}・${esc(titleOf(r.note))}</button>`).join('')}
    </div>
    <div class="pbdeck" data-deck data-editing="${Boolean(ctx.editing)}">
      ${shown.map((r) => (r.key === ctx.editing?.key ? editCardHtml(r) : cardHtml(r))).join('')}
    </div>
    ${shown.length > 1 ? `
      <div class="pbdots" aria-hidden="true">
        ${shown.map((r) => `<span class="pbdot" data-dot="${esc(r.key)}" data-on="${r.key === on}"></span>`).join('')}
      </div>` : ''}`;
}

/** 客戶名那一行：點了到他的詳情。停用的帶一顆小標。 */
function whoHtml(customer) {
  return `
    <button class="pbcard__who" type="button" data-who="${esc(customer?.id ?? '')}">
      ${esc(customer?.name ?? '')}
      ${customer?.active === false ? '<span class="badge badge--soon">已停用</span>' : ''}
      ${icon('right', { size: 12, width: 2.4 })}</button>`;
}

function cardHtml({ customer, note, key }) {
  return `
    <article class="pbcard" data-card="${esc(key)}" tabindex="-1">
      ${whoHtml(customer)}
      <header class="pbcard__head">
        <h2 class="pbcard__title">${esc(titleOf(note))}</h2>
        <button class="pbcard__edit" type="button" data-edit="${esc(key)}"
                aria-label="改「${esc(titleOf(note))}」">${icon('pencil', { size: 18 })}</button>
      </header>
      <div class="pbcard__body">${esc(note.body)}</div>
    </article>`;
}

/**
 * 就地編輯：那一張卡在原地變成表單（同備忘錄）。存起來在右上角、垃圾桶在它左邊 ——
 * **按一次變「再按一次刪掉」，3 秒沒按就收回**（原型裡她看過的那一種）。新的一則沒有垃圾桶。
 */
function editCardHtml({ customer, key }) {
  const ed = ctx.editing;
  const armed = ctx.armed === key;
  return `
    <article class="pbcard pbcard--edit" data-card="${esc(key)}">
      <div class="errors" data-errors hidden></div>
      <p class="pbcard__eyebrow">${esc(customer?.name ?? '')}・${ed.isNew ? '新的一則' : '改長備註'}</p>
      <div class="pbedit__head">
        <input class="pbedit__title" type="text" data-title maxlength="${MAX_LONG_TITLE}"
               value="${esc(ed.draft.title)}" placeholder="標題，例：家人與接送" aria-label="標題"
               enterkeyhint="next" autocomplete="off" />
        ${ed.isNew ? '' : `
          <button class="pbedit__icon pbedit__icon--del ${armed ? 'pbedit__icon--armed' : ''}" type="button" data-del
                  aria-label="${armed ? '再按一次刪掉' : `刪掉「${esc(titleOf(ed.draft))}」`}">
            ${icon('trash', { size: 17 })}${armed ? '<span>再按一次刪掉</span>' : ''}</button>`}
        <button class="pbedit__icon pbedit__icon--save" type="button" data-save
                aria-label="存起來">${icon('check', { size: 18, width: 2.2 })}</button>
      </div>
      <textarea class="pbedit__body" data-body maxlength="${MAX_LONG_BODY}" aria-label="內文"
                placeholder="想寫多長都可以" rows="10">${esc(ed.draft.body)}</textarea>
    </article>`;
}

// ---------------------------------------------------------------------------
// 接線
// ---------------------------------------------------------------------------

function wire() {
  const page = ctx.el.querySelector('[data-page]');
  if (!page) return;
  page.addEventListener('click', onClick);

  page.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (ctx.editing) return; // 那一下由 onClick 收（先問要不要存）
    back('/customers');
  });

  page.querySelector('[data-search]')?.addEventListener('input', (e) => {
    ctx.search = e.target.value;
    repaintStage();
  });

  page.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !ctx.editing) return;
    e.preventDefault();
    leaveEdit();
  });

  if (ctx.searchOpen) page.querySelector('[data-search]')?.focus();
}

function onClick(e) {
  // 編輯中點到那一張卡以外 ＝ 要離開。這一下只負責「離開編輯」（同備忘錄）。
  if (ctx.editing && !e.target.closest('.pbcard--edit')) {
    leaveEdit();
    return;
  }
  const hit = (sel) => e.target.closest(sel);

  if (!hit('[data-del]')) disarm();

  const gt = hit('[data-goto]');
  if (gt) {
    focus(gt.dataset.goto);
    return;
  }
  const who = hit('[data-who]');
  if (who) {
    go(`/customers/${who.dataset.who}`);
    return;
  }
  const ed = hit('[data-edit]');
  if (ed) {
    enterEdit(ed.dataset.edit);
    return;
  }
  if (hit('[data-new]')) {
    openPicker();
    return;
  }
  if (hit('[data-save]')) {
    saveEditing();
    return;
  }
  if (hit('[data-del]')) {
    armOrDelete();
    return;
  }
  if (hit('[data-search-toggle]')) toggleSearch();
}

function toggleSearch() {
  ctx.searchOpen = !ctx.searchOpen;
  ctx.el.querySelector('[data-searchwrap]')?.setAttribute('data-open', String(ctx.searchOpen));
  ctx.el.querySelector('[data-search-toggle]')?.setAttribute('aria-expanded', String(ctx.searchOpen));
  const input = ctx.el.querySelector('[data-search]');
  if (ctx.searchOpen) {
    input?.focus();
    return;
  }
  // 收起來就把字清掉 —— 看不見的篩選條件會讓她以為長備註不見了
  if (!ctx.search) return;
  ctx.search = '';
  if (input) input.value = '';
  repaintStage();
}

function repaintStage() {
  const stage = ctx.el.querySelector('[data-stage]');
  if (!stage) return;
  stage.innerHTML = stageHtml();
  const fab = ctx.el.querySelector('[data-fab]');
  if (fab) fab.hidden = Boolean(ctx.editing);
  watch();
}

function watch() {
  spy?.disconnect();
  spy = watchDeck(ctx.el.querySelector('[data-deck]'), (key) => {
    if (key === ctx.activeKey) return;
    ctx.activeKey = key;
    markActive(ctx.el, key);
  });
}

function focus(key, behavior = 'smooth') {
  if (focusCard(ctx.el, key, behavior)) ctx.activeKey = key;
}

// ---------------------------------------------------------------------------
// 寫給誰
// ---------------------------------------------------------------------------

/**
 * ＋ → 先選人。**第七個打字找客戶的框**：比法只有 `nameHas()`（CLAUDE.md「打字找客戶的框」）。
 * 停用的也列（標「已停用」）—— 停用的客戶身上照樣可以寫；刪掉的不列。沒打字時列全部（在服務中的在前）。
 */
function openPicker() {
  const sheet = openSheet({
    title: '寫給誰？',
    body: `
      <input type="text" data-pick-search placeholder="打名字找" aria-label="找客戶" autocomplete="off" />
      <div class="lnpick" data-pick-list></div>`,
  });
  const list = sheet.el.querySelector('[data-pick-list]');
  const paintList = (q = '') => {
    const live = ctx.customers.filter((c) => !c.deletedAt && nameHas(c.name, q));
    const rows = [...live.filter((c) => c.active !== false), ...live.filter((c) => c.active === false)];
    list.innerHTML = rows.length ? rows.map((c) => {
      const n = readLongNotes(c).length;
      return `
        <button class="lnpick__row" type="button" data-pick-customer="${esc(c.id)}">
          <span class="lnpick__name">${esc(c.name)}</span>
          ${c.active === false ? '<span class="badge badge--soon">已停用</span>' : ''}
          <span class="lnpick__n">${n ? `已經有 ${n} 則` : '還沒有長備註'}</span>
        </button>`;
    }).join('') : '<p class="muted">沒有這個名字。</p>';
  };
  paintList();
  sheet.el.querySelector('[data-pick-search]').addEventListener('input', (e) => paintList(e.target.value));
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick-customer]');
    if (!b) return;
    const customer = ctx.customers.find((c) => c.id === b.dataset.pickCustomer);
    if (readLongNotes(customer).length >= MAX_LONG_NOTES) {
      toast.info(`${customer.name} 已經有 ${MAX_LONG_NOTES} 則長備註了，先刪掉一則再寫`);
      return;
    }
    closeSheet();
    await whenSettled();
    startNew(customer.id);
  });
}

// ---------------------------------------------------------------------------
// 編輯
// ---------------------------------------------------------------------------

function pushEditLayer() {
  if (editLayer?.active) return;
  editLayer = pushLayer(() => {
    editLayer = null;
    leaveEdit();
  });
}

function dropEditLayer() {
  if (editLayer?.active) editLayer.pop();
  editLayer = null;
}

function startNew(customerId) {
  ctx.search = '';
  ctx.searchOpen = false;
  const key = keyOf(customerId, NEW_ID);
  ctx.editing = { key, customerId, noteId: NEW_ID, isNew: true, draft: { title: '', body: '' } };
  ctx.activeKey = key;
  paint();
  focus(key, 'auto');
  ctx.el.querySelector('[data-title]')?.focus({ preventScroll: true });
  pushEditLayer();
}

function enterEdit(key) {
  const row = longNoteRows(ctx.customers).find((r) => r.key === key);
  if (!row) return;
  ctx.editing = {
    key, customerId: row.customer.id, noteId: row.note.id, isNew: false,
    draft: { title: row.note.title, body: row.note.body },
    // 比「改過沒」拿這一份：draft 會被重畫前的 readEditor() 換掉（按垃圾桶那一下）
    original: { title: row.note.title, body: row.note.body },
  };
  ctx.activeKey = key;
  repaintStage();
  focus(key, 'auto');
  ctx.el.querySelector('[data-body]')?.focus({ preventScroll: true });
  pushEditLayer();
}

function readEditor() {
  const card = ctx.el.querySelector('.pbcard--edit');
  return {
    title: card?.querySelector('[data-title]')?.value ?? ctx.editing.draft.title,
    body: card?.querySelector('[data-body]')?.value ?? ctx.editing.draft.body,
  };
}

function isDirty() {
  if (!ctx?.editing) return false;
  const now = readEditor();
  const was = ctx.editing.isNew ? { title: '', body: '' } : ctx.editing.original;
  return now.title.trim() !== String(was.title ?? '').trim() || now.body.trim() !== String(was.body ?? '').trim();
}

function showErrors(list) {
  const box = ctx.el.querySelector('.pbcard--edit [data-errors]');
  if (!box) return;
  box.hidden = !list.length;
  box.innerHTML = list.map((x) => `<p>${esc(x)}</p>`).join('');
}

function cancelEdit() {
  const wasNew = ctx.editing?.isNew;
  ctx.editing = null;
  ctx.armed = null;
  dropEditLayer();
  if (wasNew) ctx.activeKey = null;
  repaintStage();
  const k = activeKey(visibleRows());
  if (k) focus(k, 'auto');
}

async function saveEditing() {
  const ed = ctx.editing;
  if (!ed) return false;
  const draft = readEditor();
  ed.draft = draft;
  const customer = ctx.customers.find((c) => c.id === ed.customerId);
  const note = { id: ed.isNew ? newLongNoteId() : ed.noteId, title: draft.title.trim(), body: draft.body };
  const errors = validateLongNotes([note]);
  if (errors.length) {
    showErrors(errors);
    return false;
  }
  const fields = withLongNote(customer, note);
  try {
    await toast.withSaveState(() => data.update(customer.id, fields), {
      success: `記在${customer.name}身上了`, key: `customer:long-note:${customer.id}:${note.id}`,
    });
  } catch {
    return false; // 已處理；留在編輯，打的字還在
  }
  ctx.editing = null;
  dropEditLayer();
  await reload(keyOf(customer.id, note.id));
  return true;
}

/**
 * 垃圾桶那一顆變紅／變回來。**只換那一顆，整疊不重畫**（ADR-0038）——
 * 重畫一次 `.pbdeck` 的橫向捲動會回到第一張，她正在改的那一張就滑走了。
 */
function paintArmed(armed) {
  const btn = ctx.el.querySelector('.pbcard--edit [data-del]');
  if (!btn) return;
  btn.classList.toggle('pbedit__icon--armed', armed);
  btn.setAttribute('aria-label', armed ? '再按一次刪掉' : `刪掉「${titleOf(ctx.editing?.draft)}」`);
  btn.innerHTML = `${icon('trash', { size: 17 })}${armed ? '<span>再按一次刪掉</span>' : ''}`;
}

/** 垃圾桶：第一下變「再按一次刪掉」，3 秒內再按才刪。 */
async function armOrDelete() {
  const ed = ctx.editing;
  if (!ed || ed.isNew) return;
  if (ctx.armed !== ed.key) {
    ctx.armed = ed.key;
    paintArmed(true);
    const armedKey = ed.key;
    setTimeout(() => {
      if (ctx?.armed !== armedKey) return;
      ctx.armed = null;
      paintArmed(false);
    }, 3000);
    return;
  }
  const customer = ctx.customers.find((c) => c.id === ed.customerId);
  const fields = withoutLongNote(customer, ed.noteId);
  try {
    await toast.withSaveState(() => data.update(customer.id, fields), {
      success: '刪掉了', key: `customer:long-note-del:${customer.id}:${ed.noteId}`,
    });
  } catch {
    return;
  }
  ctx.editing = null;
  ctx.armed = null;
  dropEditLayer();
  await reload(null);
}

function disarm() {
  if (!ctx.armed) return;
  ctx.armed = null;
  paintArmed(false);
}

/**
 * 點外面、按 Escape、按返回：要離開編輯了。沒改過直接收掉；改過才問，**三選一**
 * （存起來／不要了／把框關掉＝繼續改）—— 同備忘錄的 `leaveEdit()`。
 */
async function leaveEdit() {
  if (leaving || !ctx?.editing) return;
  if (!isDirty()) {
    cancelEdit();
    return;
  }
  leaving = true;
  try {
    const pick = await chooseAction({
      title: '這一則改到一半',
      consequences: [
        '存起來：卡片上就是剛剛打的字。',
        '不要了：回到按鉛筆之前的樣子，剛剛打的字不會留下來。',
      ],
      choices: [
        { key: 'discard', label: '不要了' },
        { key: 'save', label: '存起來', tone: 'primary' },
      ],
    });
    if (pick === 'save') await saveEditing();
    else if (pick === 'discard') cancelEdit();
  } finally {
    leaving = false;
    // 還在改（她把框關掉、或存失敗）：返回鍵那一層補回來
    if (ctx?.editing) pushEditLayer();
  }
}

/** 存完／刪完重讀，停在指定的那一張。 */
async function reload(focusKey) {
  try {
    ctx.customers = await data.list();
  } catch {
    // 讀不回來就先用手上這一份 —— 寫入本身已經成功了
  }
  ctx.activeKey = focusKey;
  paint();
  if (focusKey) focus(focusKey, 'auto');
}
