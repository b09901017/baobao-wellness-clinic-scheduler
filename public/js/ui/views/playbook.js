// 備忘錄／SOP：一疊左右滑的卡牌。
//
// 她 2026-09-04 點過第一版之後要的：
//
// > 備忘錄要是像卡牌一樣可以左右滑動的，然後也有所有的清單可以快速選，
// > 就顯示標題。……然後可以有鉛筆點擊修改。然後我希望「加一個備忘錄」會是以
// > 浮動小泡泡的形式出現在這頁的右下角。……原本「寫一份」那個按鈕我覺得可以
// > 做成放大鏡的圖示，點開之後可以快速搜尋，不然這面就只要有卡牌以及清單丸子，
// > 也不需要太多的說明文字。背景要是有設計過像是備忘錄感覺的那種卡牌。
//
// ## 這一頁沒有一句解說文字
//
// 第一版有兩句（「你自己整理的流程與心得。不會變成要勾的待辦」）。
// 那種話她讀過一次就夠了，之後每天看到只是佔位置。**只有空的時候留一句。**
//
// ## 左右滑用原生捲動，不自己接手勢
//
// `scroll-snap-type: x mandatory` + 每張 `scroll-snap-align: center`。
// 自己寫 touchmove 永遠差一截慣性與橡皮筋，而她那句「絲滑」講的就是那一截。
// 旁邊露出一小條下一張，那是「還有東西」最早被看到的訊號 —— 比小圓點早。
//
// 現在停在第幾張用 `IntersectionObserver` 認，**不用 scroll 事件**：
// scroll 在 iOS 上捲動時會被節流，圓點與丸子會跟不上手指。
//
// ## 沒有勾選框、沒有進度、沒有百分比
//
// 一放勾選框它就變成第二個待辦中心，而她指名「不需要變成打勾任務」（ADR-0067）。
// `tests-e2e/specs/15-playbook.spec.js` 直接數這一頁上有幾個 checkbox。
//
// 規則一條都不在這裡，全部在 domain/playbook.js。

import * as playbooksData from '../../data/playbooks.js';
import * as config from '../../data/config.js';
import {
  validatePlaybook, matches, deckOrder, bodyOf, MAX_TITLE, MAX_BODY,
} from '../../domain/playbook.js';
import {
  sanitizeLinePaste, describeCleanup, hasLineCodes, EMOJI_ROW,
} from '../../domain/lineText.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';

const esc = f.esc;

/** 這一頁現在的樣子。**存在模組裡不進網址** —— 它是看法，不是位置。 */
let ctx = null;

/** 認「現在停在第幾張」的那一個。每次重畫都要先斷掉，不然會愈積愈多。 */
let spy = null;

/** 一張新的、還沒存進去的。id 用這個字串認得出來。 */
const NEW_ID = '__new__';

// ---------------------------------------------------------------------------
// 進場
// ---------------------------------------------------------------------------

/**
 * `#/playbook` 與 `#/playbook/:id` 走同一支。
 *
 * `:id` **不是另一頁**，是「這一疊，開在那一張」—— 日曆卡片上的「看整份」
 * 指著它。少一頁就少一個回不去的地方。
 */
export async function render(el, id = null) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let rows;
  let courses;
  try {
    // fresh：從別的地方存完回來要看到新的那一份
    [rows, courses] = await Promise.all([
      playbooksData.list({ fresh: true }),
      config.listAll('courses'),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore Rules 還沒部署。</p></div>`;
    return;
  }

  ctx = {
    el,
    rows: deckOrder(rows),
    courses: (courses ?? []).filter((c) => !c.deletedAt),
    search: '',
    searchOpen: false,
    editing: null,
    activeId: id ?? null,
  };

  paint();
  if (id) focusCard(id, 'auto');
}

// ---------------------------------------------------------------------------
// 畫
// ---------------------------------------------------------------------------

function paint() {
  const { el } = ctx;

  el.innerHTML = `
    <div class="pbpage" data-page>
      <div class="pbtop">
        <h1 class="page__title">備忘錄 / SOP</h1>
        <button class="iconbtn" type="button" data-search-toggle
                aria-label="搜尋備忘錄" aria-expanded="${ctx.searchOpen}">
          ${icon('search', { size: 20 })}
        </button>
      </div>

      <div class="pbsearch" data-searchwrap data-open="${ctx.searchOpen}">
        <div class="pbsearch__in">
          <input type="text" data-search value="${esc(ctx.search)}"
                 placeholder="找一份：標題或內容" aria-label="找一份備忘錄"
                 enterkeyhint="search" autocomplete="off" />
        </div>
      </div>

      <div data-stage>${stageHtml()}</div>

      ${/* 編輯中把這一顆收起來 —— 按下去會把她正在打的那一張換掉，
             而那是無聲的資料流失。全域的 `[hidden] { display: none !important }`
             壓得過 `.fab` 的 display:flex（app.css 開頭那一段）。 */''}
      <div class="fab" data-fab ${ctx.editing ? 'hidden' : ''}>
        <button class="fab__main" type="button" data-new aria-label="加一份備忘錄">
          ${icon('plus', { size: 24, width: 2 })}
        </button>
      </div>
    </div>`;

  wire();
  watchDeck();
}

/** 丸子清單 + 一疊卡 + 小圓點。搜尋與存檔之後只換這一塊。 */
function stageHtml() {
  const shown = visibleRows();

  if (!shown.length) return emptyHtml();

  return `
    <div class="chiprow pbchips noscroll-bar" role="group" aria-label="全部的備忘錄">
      ${shown.map((p) => `
        <button class="chip chip--sm" type="button" data-goto="${esc(p.id)}"
                aria-pressed="${p.id === activeId(shown)}">${esc(titleOf(p))}</button>`).join('')}
    </div>

    <div class="pbdeck" data-deck data-editing="${Boolean(ctx.editing)}">
      ${shown.map(cardHtml).join('')}
    </div>

    ${shown.length > 1 ? `
      <div class="pbdots" aria-hidden="true">
        ${shown.map((p) => `
          <span class="pbdot" data-dot="${esc(p.id)}"
                data-on="${p.id === activeId(shown)}"></span>`).join('')}
      </div>` : ''}`;
}

/** 現在該畫哪幾張。搜尋中的那一張正在編輯的一定留著。 */
function visibleRows() {
  const rows = ctx.editing?.id === NEW_ID ? [...ctx.rows, ctx.editing.draft] : ctx.rows;
  return rows.filter((p) => p.id === ctx.editing?.id || matches(p, ctx.search));
}

const titleOf = (p) => String(p?.title ?? '').trim() || '（還沒有標題）';

/** 目前停在哪一張。認不得的（剛搜完、剛刪掉）就退回第一張。 */
function activeId(shown) {
  return shown.some((p) => p.id === ctx.activeId) ? ctx.activeId : shown[0]?.id ?? null;
}

function emptyHtml() {
  if (ctx.search) {
    return '<p class="muted" style="padding: var(--space-6) var(--gutter)">沒有符合的。</p>';
  }
  return `
    <section class="card pbempty">
      <h2 class="card__title">還沒有備忘錄</h2>
      <p class="muted">把你自己的流程寫下來 —— 點滴當天要檢查什麼、外檢要帶哪幾張單子、
        復健科在哪一層樓報到。它不會變成要勾的待辦，只是隨時翻得到。</p>
      <p class="muted">右下角那顆加一份。</p>
    </section>`;
}

// ---------------------------------------------------------------------------
// 一張卡
// ---------------------------------------------------------------------------

function cardHtml(p) {
  if (ctx.editing?.id === p.id) return editCardHtml(p);

  const body = bodyOf(p);
  const names = courseNames(p.courseIds);

  return `
    <article class="pbcard" data-card="${esc(p.id)}" tabindex="-1">
      <header class="pbcard__head">
        <h2 class="pbcard__title">${esc(titleOf(p))}</h2>
        <button class="pbcard__edit" type="button" data-edit="${esc(p.id)}"
                aria-label="改「${esc(titleOf(p))}」">${icon('pencil', { size: 18 })}</button>
      </header>
      ${names ? `<p class="pbcard__courses">${esc(names)}</p>` : ''}
      <div class="pbcard__body">${esc(body)}</div>
    </article>`;
}

/**
 * 就地編輯：那一張卡在原地變成表單。
 *
 * **不換頁、不開抽屜。** 換頁會讓她失去「我正在看第三張」這件事，
 * 而那正是卡牌的全部價值。
 */
function editCardHtml(p) {
  const draft = ctx.editing.draft;
  const isNew = p.id === NEW_ID;

  return `
    <article class="pbcard pbcard--edit" data-card="${esc(p.id)}">
      <div class="errors" data-errors hidden></div>

      <input class="pbedit__title" type="text" data-title maxlength="${MAX_TITLE}"
             value="${esc(draft.title ?? '')}" placeholder="標題" aria-label="標題"
             enterkeyhint="next" autocomplete="off" />

      ${f.chips({
        name: 'courseIds', label: '掛哪些課程', value: draft.courseIds ?? [], multi: true,
        quiet: true,
        options: ctx.courses.map((c) => ({ value: c.id, label: c.name })),
      })}

      <textarea class="pbedit__body" data-body maxlength="${MAX_BODY}"
                aria-label="內容" placeholder="一行一件事就好"
                rows="10">${esc(bodyOf(draft))}</textarea>

      ${emojiRowHtml()}

      <div class="pbedit__actions">
        <button class="btn btn--primary" type="button" data-save>存起來</button>
        <button class="btn" type="button" data-cancel>取消</button>
        ${isNew ? '' : `
          <button class="btn btn--ghost pbedit__del" type="button" data-del>
            ${icon('trash', { size: 16 })}刪掉</button>`}
      </div>
    </article>`;
}

/**
 * 輸入框底下那一排點得到的 emoji。
 *
 * **一直看得到，不做展開／收起。** 一顆「打開 emoji」的按鈕等於每次都要多點
 * 一下，而這一排只有十七顆、佔一行。她要的是「一點就有」。
 *
 * 橫著捲不折行：折成兩行會把存檔鈕再推下去一次，而那正是
 * `.pbedit__body` 的 `max-height` 在避免的事（兩邊要一起看）。
 *
 * 有哪幾顆在 `domain/lineText.js` 的 `EMOJI_ROW` —— 跟 `(emoji)` 自動換上的
 * 那一顆同一份清單，分家的話她會想換掉那顆卻在這排裡找不到它。
 */
function emojiRowHtml() {
  return `
    <div class="emojirow noscroll-bar" role="group" aria-label="插入表情符號" data-emojirow>
      ${/* 「清掉貼圖代碼」排在最前面，而且**只在真的有代碼的時候出現**。
             貼上那條路蓋不到已經存在的字（她在這個功能之前就打進去的），
             而開檔自動改寫她的資料是這個 app 不做的事。放在這一排裡面是為了
             不多吃一行高度 —— 那正是 c／d 兩個問題的根源。 */''}
      <button class="emojirow__clean" type="button" data-clean hidden>清掉貼圖代碼</button>
      ${EMOJI_ROW.map((e) => `
        <button class="emojirow__btn" type="button" data-emoji="${esc(e)}"
                aria-label="插入 ${esc(e)}">${esc(e)}</button>`).join('')}
    </div>`;
}

/** 掛了哪些課程那一行。認不得的 id 印「（已刪除）」，不要靜靜地少一個。 */
function courseNames(ids = []) {
  return (ids ?? [])
    .map((id) => ctx.courses.find((c) => c.id === id)?.name ?? '（已刪除的課程）')
    .join('・');
}

// ---------------------------------------------------------------------------
// 接線
// ---------------------------------------------------------------------------

function wire() {
  const page = ctx.el.querySelector('[data-page]');
  if (!page) return;

  // 委派一次。`page` 每次重畫都是新的節點，所以不會愈掛愈多。
  page.addEventListener('click', onClick);

  const search = page.querySelector('[data-search]');
  // input 而不是 change：她打完直接點下一個東西時，change 還沒發出去（iOS 尤其）
  search?.addEventListener('input', (e) => {
    ctx.search = e.target.value;
    repaintStage();
  });

  if (ctx.searchOpen) search?.focus();
  if (ctx.editing) mountEditor();
}

function onClick(e) {
  const goto = e.target.closest('[data-goto]');
  if (goto) return focusCard(goto.dataset.goto);

  const edit = e.target.closest('[data-edit]');
  if (edit) return enterEdit(edit.dataset.edit);

  if (e.target.closest('[data-new]')) return addOne();
  if (e.target.closest('[data-save]')) return saveEditing();
  if (e.target.closest('[data-cancel]')) return cancelEdit();
  if (e.target.closest('[data-del]')) return removeEditing();
  if (e.target.closest('[data-search-toggle]')) return toggleSearch();
  return undefined;
}

function toggleSearch() {
  ctx.searchOpen = !ctx.searchOpen;
  const wrap = ctx.el.querySelector('[data-searchwrap]');
  const btn = ctx.el.querySelector('[data-search-toggle]');
  wrap?.setAttribute('data-open', String(ctx.searchOpen));
  btn?.setAttribute('aria-expanded', String(ctx.searchOpen));

  const input = ctx.el.querySelector('[data-search]');
  if (ctx.searchOpen) {
    input?.focus();
    return;
  }
  // 收起來就把字清掉 —— 一個看不見的篩選條件會讓她以為備忘錄不見了
  if (!ctx.search) return;
  ctx.search = '';
  if (input) input.value = '';
  repaintStage();
}

/** 只重畫丸子、卡牌與圓點那一塊。抬頭與搜尋框留著（她可能正在打字）。 */
function repaintStage() {
  const stage = ctx.el.querySelector('[data-stage]');
  if (!stage) return;
  stage.innerHTML = stageHtml();
  // 泡泡在編輯中要收起來（見 paint()）。它不在 [data-stage] 裡面，所以要自己切。
  const fab = ctx.el.querySelector('[data-fab]');
  if (fab) fab.hidden = Boolean(ctx.editing);
  watchDeck();
  if (ctx.editing) mountEditor();
}

// ---------------------------------------------------------------------------
// 滑到哪一張
// ---------------------------------------------------------------------------

const deckEl = () => ctx?.el.querySelector('[data-deck]');
const cardEl = (id) => ctx?.el.querySelector(`[data-card="${CSS.escape(id)}"]`);

function focusCard(id, behavior = 'smooth') {
  const card = cardEl(id);
  if (!card) return;
  ctx.activeId = id;
  markActive(id);
  card.scrollIntoView({ behavior, inline: 'center', block: 'nearest' });
}

/** 丸子與圓點只改屬性，整塊不重畫（ADR-0038）。 */
function markActive(id) {
  for (const b of ctx.el.querySelectorAll('[data-goto]')) {
    b.setAttribute('aria-pressed', String(b.dataset.goto === id));
  }
  for (const d of ctx.el.querySelectorAll('[data-dot]')) {
    d.setAttribute('data-on', String(d.dataset.dot === id));
  }
}

/**
 * 認「現在停在第幾張」。
 *
 * 用 `IntersectionObserver` 不用 scroll 事件：scroll 在 iOS 上捲動時會被節流，
 * 而圓點跟不上手指的話，那一排看起來就是壞的。
 */
function watchDeck() {
  spy?.disconnect();
  spy = null;

  const deck = deckEl();
  if (!deck) return;

  spy = new IntersectionObserver((entries) => {
    // 一次可能有兩張同時越線（一張進一張出），挑露出最多的那一張
    const best = entries
      .filter((x) => x.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!best) return;
    const id = best.target.dataset.card;
    if (!id || id === ctx.activeId) return;
    ctx.activeId = id;
    markActive(id);
  }, { root: deck, threshold: [0.55, 0.85] });

  for (const card of deck.querySelectorAll('[data-card]')) spy.observe(card);
}

// ---------------------------------------------------------------------------
// 編輯
// ---------------------------------------------------------------------------

function enterEdit(id) {
  const p = ctx.rows.find((x) => x.id === id);
  if (!p) return;
  ctx.editing = { id, draft: { ...p } };
  ctx.activeId = id;
  repaintStage();
  focusCard(id, 'auto');
}

function addOne() {
  ctx.search = '';
  const input = ctx.el.querySelector('[data-search]');
  if (input) input.value = '';

  ctx.editing = { id: NEW_ID, draft: { id: NEW_ID, title: '', courseIds: [], body: '' } };
  ctx.activeId = NEW_ID;
  repaintStage();
  focusCard(NEW_ID, 'auto');
  ctx.el.querySelector('[data-title]')?.focus();
}

/**
 * 編輯狀態每次重畫之後要接的那幾樣。
 *
 * 丸子掛在**那一張卡**上（它每次都是新的節點），所以不用 signal ——
 * 掛在整頁的 `el` 上才要（`f.wireChips()` 的檔頭）。
 */
function mountEditor() {
  const card = cardEl(ctx.editing.id);
  if (!card) return;
  f.wireChips(card);

  // 選著的那一顆課程捲進畫面。一排十幾個課程是橫著捲的，而她掛的那一個
  // 常常在最右邊 —— 看不到它等於這一排在說「一個都沒掛」。
  card.querySelector('[data-chip="courseIds"][aria-pressed="true"]')
    ?.scrollIntoView({ block: 'nearest', inline: 'center' });

  const body = card.querySelector('[data-body]');
  if (!body) return;

  // **內文那一格的高度交給 CSS，不再用 JS 撐。**
  //
  // 原本是「打到哪長到哪」（`body.style.height = scrollHeight`）。那個做法
  // 在這張卡上會兩邊都錯：短的備忘錄把卡片撐不滿，長的又把底下那一排 emoji
  // 與「存起來」擠出畫面 —— 她 2026-09-04 回報的就是後面那一種。
  //
  // 現在 `.pbcard--edit > .pbedit__body` 是 `flex: 1 1 0`：它吃掉卡片裡剩下的
  // 空間，超過就在自己裡面捲。整張卡不用滑，只有這一格會滑。
  // ---- 從 LINE 貼過來的那一段 ----
  //
  // 她的筆記記在 LINE 裡、用貼圖排版，複製出來全部變成 `(emoji)`、`(加1)`。
  // 規則在 `domain/lineText.js`，這裡只負責接。
  //
  // **只在貼上的時候清，打字不清** —— 她自己打 `(2)` 一定是有意的。
  body.addEventListener('paste', (e) => {
    const raw = e.clipboardData?.getData('text') ?? '';
    if (!raw) return;

    const clean = sanitizeLinePaste(raw);
    // 這一次貼得下幾個字（選起來的那一段會被取代掉，所以要加回來）
    const room = MAX_BODY - (body.value.length - (body.selectionEnd - body.selectionStart));
    // 沒有東西要清、長度也塞得下，就讓瀏覽器自己貼 ——
    // 那條路留得住原生的復原堆疊。
    if (clean === raw && clean.length <= room) return;

    e.preventDefault();
    // **`maxlength` 對貼上是硬截而且不發任何事件** —— 讓瀏覽器自己截的話，
    // 她貼一大段筆記進來，最後幾行安靜消失而畫面一個字都沒說（SPEC 6.9）。
    // 自己截才講得出被丟掉幾個字。
    const fits = clean.slice(0, Math.max(0, room));
    f.insertAtCursor(body, fits);

    const said = describeCleanup(raw, clean);
    if (said) toast.info(said);
    if (fits.length < clean.length) {
      toast.info(
        `太長了，後面 ${clean.length - fits.length} 個字沒有貼進來（一份最多 ${MAX_BODY} 字）`,
      );
    }
  });

  // ---- 底下那一排 emoji 與「清掉貼圖代碼」 ----
  //
  // 委派掛在**那一排**上（它每次重畫都是新的節點），所以不會愈掛愈多。
  const cleanBtn = card.querySelector('[data-clean]');

  /** 現在的字裡還有沒有代碼。有才把那一顆亮出來。 */
  const syncClean = () => {
    if (cleanBtn) cleanBtn.hidden = !hasLineCodes(body.value);
  };
  body.addEventListener('input', syncClean);
  syncClean();

  card.querySelector('[data-emojirow]')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-clean]')) {
      const before = body.value;
      const after = sanitizeLinePaste(before);
      if (after === before) return;
      body.value = after;
      body.dispatchEvent(new Event('input', { bubbles: true }));
      const said = describeCleanup(before, after);
      if (said) toast.info(said);
      return;
    }

    const btn = e.target.closest('[data-emoji]');
    if (!btn) return;
    // `insertAtCursor()` 會把焦點留在輸入框、游標留在插進去的字後面，
    // 並且手動發一次 `input`（`maxlength` 與其他監聽靠它）。
    f.insertAtCursor(body, btn.dataset.emoji);
  });
}

/** 畫面上現在打的那些。存檔與取消都要先讀一次，不然重畫會洗掉。 */
function readEditor() {
  const card = cardEl(ctx.editing.id);
  if (!card) return ctx.editing.draft;
  const box = card.querySelector('input[type="hidden"][name="courseIds"]');
  return {
    ...ctx.editing.draft,
    title: card.querySelector('[data-title]')?.value ?? '',
    body: card.querySelector('[data-body]')?.value ?? '',
    courseIds: f.splitMulti(box?.value),
  };
}

function showErrors(list) {
  const box = cardEl(ctx.editing?.id)?.querySelector('[data-errors]');
  if (!box) return;
  box.hidden = !list.length;
  box.innerHTML = list.map((x) => `<p>${esc(x)}</p>`).join('');
}

async function saveEditing() {
  const next = readEditor();
  ctx.editing.draft = next;

  const errors = validatePlaybook(next);
  if (errors.length) {
    showErrors(errors);
    return;
  }

  const isNew = ctx.editing.id === NEW_ID;
  let id;
  try {
    id = await toast.withSaveState(
      () => (isNew
        ? playbooksData.create(next)
        : playbooksData.update(ctx.editing.id, next).then(() => ctx.editing.id)),
      { success: '存起來了', key: `playbook:save:${ctx.editing.id}` },
    );
  } catch {
    return; // 已處理
  }

  // 重讀一次：新的那一份要拿到真的 id 與 createdAt（順序靠它，`deckOrder()`）
  await reload(id);
}

function cancelEdit() {
  ctx.editing = null;
  repaintStage();
  if (ctx.activeId === NEW_ID) ctx.activeId = null;
  const back = activeId(visibleRows());
  if (back) focusCard(back, 'auto');
}

async function removeEditing() {
  const p = ctx.rows.find((x) => x.id === ctx.editing?.id);
  if (!p) return;

  const ok = await confirmAction({
    title: `刪掉「${titleOf(p)}」？`,
    consequences: [
      '它會從這一疊裡消失，掛著它的來訪也不會再浮出這幾行。',
      '在「設定 → 已刪除項目」還原得回來。',
    ],
    confirmLabel: '刪掉',
    danger: true,
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => playbooksData.remove(p.id, '在備忘錄裡刪掉'), {
      success: '刪掉了',
    });
  } catch {
    return; // 已處理
  }
  await reload(null);
}

/** 存完／刪完重讀一次，停在指定的那一張。 */
async function reload(focusId) {
  ctx.editing = null;
  try {
    ctx.rows = deckOrder(await playbooksData.list({ fresh: true }));
  } catch {
    // 讀不回來就先用手上這一份 —— 寫入本身已經成功了
  }
  ctx.activeId = focusId ?? null;
  repaintStage();
  if (focusId) focusCard(focusId, 'auto');
}
