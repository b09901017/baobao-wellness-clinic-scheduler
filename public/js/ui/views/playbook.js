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
import { partnerNames } from '../../domain/masterData.js';
import {
  validatePlaybook, matches, deckOrder, bodyOf, MAX_TITLE, MAX_BODY,
} from '../../domain/playbook.js';
import {
  sanitizeLinePaste, describeCleanup, hasLineCodes, EMOJI_ROW,
} from '../../domain/lineText.js';
import * as f from '../components/form.js';
import { confirmAction, chooseAction } from '../components/dialog.js';
import { wireLongPress } from '../components/actions.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';

const esc = f.esc;

/** 這一頁現在的樣子。**存在模組裡不進網址** —— 它是看法，不是位置。 */
let ctx = null;

/** 認「現在停在第幾張」的那一個。每次重畫都要先斷掉，不然會愈積愈多。 */
let spy = null;

/** 一張新的、還沒存進去的。id 用這個字串認得出來。 */
const NEW_ID = '__new__';

/**
 * 「改到一半要不要存」那一道正在問。**Escape 會同時打到這一頁與對話框** ——
 * 焦點還在輸入框裡時，keydown 先冒到這一頁、再冒到 document 上的對話框 ——
 * 少了這一格就會連跳兩道一模一樣的框。
 */
let leaving = false;

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
  let partners;
  try {
    // fresh：從別的地方存完回來要看到新的那一份
    [rows, courses, partners] = await Promise.all([
      playbooksData.list({ fresh: true }),
      config.listAll('courses'),
      // 合作機構（ADR-0076）。掛了的那一份會在帶著那個標記的客戶身上浮出來。
      config.listAll('partners'),
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
    partners: partnerNames(partners ?? []),
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
  // 掛了什麼那一行：課程與合作機構接在一起。她要的是「這一份什麼時候會浮出來」，
  // 而那個答案不分是哪一種掛法。
  const names = [courseNames(p.courseIds), (p.partners ?? []).join('・')]
    .filter(Boolean).join('・');

  return `
    <article class="pbcard" data-card="${esc(p.id)}" tabindex="-1">
      <header class="pbcard__head">
        <h2 class="pbcard__title">${esc(titleOf(p))}</h2>
        ${/* 點一下是改；**長按它變成紅色垃圾桶**，再點一下才跳刪除確認
               （她 2026-09-10 要的）。那不是唯一的路 —— 編輯中右上角還有一顆
               （ADR-0060：長按是捷徑，每一顆都要另外有一條點得到的路）。 */''}
        <button class="pbcard__edit" type="button" data-edit="${esc(p.id)}" data-longpress
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
 *
 * ## 存起來在右上角，底下沒有任何一排按鈕（2026-09-10）
 *
 * 她：「"存起來" 可以放在這個備忘錄的右上角就是原本鉛筆的地方」「取消也移除，
 * 改成我點擊其他地方就會跳出儲存還是取消」「這樣拉長且下面那排清掉，希望讓
 * 文字輸入框就可以大一點長一點」。
 *
 * 底下那一排（存起來／取消／刪掉）以前是**整張卡變矮的原因**：手機鍵盤一上來
 * 可見高度掉到一半，而那一排一定要還在畫面上，所以 `.pbdeck[data-editing]`
 * 被寫死成 62dvh —— 比讀的時候還矮。按鈕搬到頂端之後鍵盤推不走它，
 * 那個天花板就沒有存在理由了。
 *
 * 存檔鈕在**最右邊**（鉛筆原本的位置），垃圾桶在它左邊而且是灰的 ——
 * 兩顆中間留 16px，44px 的感應範圍才不會疊（疊到的那一段由後面那顆贏）。
 * 新的那一份沒有垃圾桶：還沒存進去，沒有東西可以刪。
 */
function editCardHtml(p) {
  const draft = ctx.editing.draft;
  const isNew = p.id === NEW_ID;

  return `
    <article class="pbcard pbcard--edit" data-card="${esc(p.id)}">
      <div class="errors" data-errors hidden></div>

      <div class="pbedit__head">
        <input class="pbedit__title" type="text" data-title maxlength="${MAX_TITLE}"
               value="${esc(draft.title ?? '')}" placeholder="標題" aria-label="標題"
               enterkeyhint="next" autocomplete="off" />
        ${isNew ? '' : `
          <button class="pbedit__icon pbedit__icon--del" type="button" data-del
                  aria-label="刪掉「${esc(titleOf(p))}」">${icon('trash', { size: 17 })}</button>`}
        <button class="pbedit__icon pbedit__icon--save" type="button" data-save
                aria-label="存起來">${icon('check', { size: 18, width: 2.2 })}</button>
      </div>

      ${hangHtml(draft)}

      <textarea class="pbedit__body" data-body maxlength="${MAX_BODY}"
                aria-label="內容" placeholder="一行一件事就好"
                rows="10">${esc(bodyOf(draft))}</textarea>

      ${emojiRowHtml()}
    </article>`;
}

/**
 * 「掛在哪」：課程與合作機構收成**一行**，上面一個分段切換。
 *
 * 她 2026-09-08：
 *
 * > 新增合作機構支援後，表單垂直高度被拉長，導致「儲存按鈕」被擠到視窗
 * > 下方需要額外滾動。將「掛課程」與「掛機構」重構至同一行。
 *
 * 兩排各自有一個標籤加一排丸子，也就是**四行**。收成分段切換之後是兩行，
 * 省下來的正是把「存起來」擠出畫面的那兩行。
 *
 * ## 三件不可以做的事
 *
 * 1. **兩種還是可以同時掛。** 切換的是「現在在編哪一種」，不是「只能掛一種」。
 * 2. **切過去之後，前一種選了什麼不可以被清掉。** 所以兩個
 *    `<input type="hidden">` **都留在 DOM 裡**（`readEditor()` 讀的就是它們），
 *    只是丸子那一排 `hidden`。拿掉節點的話她切一下就把掛好的課程清光了。
 * 3. **沒有合作機構時整個分段控制不畫** —— 一顆永遠按不下去的分頁只是噪音
 *    （同這一支既有的規矩）。那時候就是原本那一排課程。
 *
 * 選了幾個印在分頁上：不然切過去之前她不知道那一邊有沒有東西。
 */
function hangHtml(draft) {
  const courseChips = f.chips({
    name: 'courseIds', label: '掛哪些課程', value: draft.courseIds ?? [], multi: true,
    quiet: true,
    options: ctx.courses.map((c) => ({ value: c.id, label: c.name })),
  });

  // 掛合作機構（ADR-0076）。掛了的那一份會在**帶著那個標記的客戶**身上浮出來。
  if (!(ctx.partners ?? []).length) return courseChips;

  const partnerChips = f.chips({
    name: 'partners', label: '掛哪些合作機構', value: draft.partners ?? [], multi: true,
    quiet: true,
    options: ctx.partners.map((name) => ({ value: name, label: name })),
  });

  const tab = (key, label, n) => `
    <button class="seg__btn" type="button" role="tab" data-hang="${key}"
            aria-selected="${key === 'courseIds'}">
      ${esc(label)}<span class="seg__n" data-hang-n="${key}">${n || ''}</span>
    </button>`;

  return `
    <div class="fieldgroup pbedit__hang">
      <div class="seg seg--tabs" role="tablist" aria-label="掛在哪">
        ${tab('courseIds', '掛課程', (draft.courseIds ?? []).length)}
        ${tab('partners', '掛機構', (draft.partners ?? []).length)}
      </div>
      <div data-hang-panel="courseIds">${courseChips}</div>
      <div data-hang-panel="partners" hidden>${partnerChips}</div>
    </div>`;
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

  // Escape ＝ 點外面：沒改過直接收掉，改過才問。掛在 `page` 上而不是 document ——
  // `page` 每次整頁重畫都是新節點，監聽跟著它一起消失，不會愈掛愈多。
  page.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !ctx.editing) return;
    e.preventDefault();
    leaveEdit();
  });

  // 長按鉛筆 → 那一顆原地變成紅色垃圾桶。`wireLongPress()` 自己會吃掉放手那一下
  // 的 click，所以不會同時進到編輯。
  wireLongPress(page, '.pbcard__edit[data-edit]', (btn) => armDelete(btn));

  if (ctx.searchOpen) search?.focus();
  if (ctx.editing) mountEditor();
}

function onClick(e) {
  // **編輯中點到那一張卡以外的地方 ＝ 要離開。** 這一下只負責「離開編輯」，
  // 不順便做它原本會做的事（滑到別張、開搜尋）—— 先把手上這一張收好，
  // 她再點一次就是了。反過來的話，存檔失敗的那一次她已經在看別張卡了。
  if (ctx.editing && !e.target.closest('.pbcard--edit')) {
    leaveEdit();
    return undefined;
  }

  // 長按過的那一顆已經是紅色垃圾桶了：這一下是「刪掉」。點到別的地方就變回鉛筆。
  const armed = e.target.closest('[data-armed="true"]');
  if (armed) return removeOne(armed.dataset.edit);
  disarm();

  const goto = e.target.closest('[data-goto]');
  if (goto) return focusCard(goto.dataset.goto);

  const edit = e.target.closest('[data-edit]');
  if (edit) return enterEdit(edit.dataset.edit);

  if (e.target.closest('[data-new]')) return addOne();
  if (e.target.closest('[data-save]')) return saveEditing();
  if (e.target.closest('[data-del]')) return removeOne(ctx.editing?.id);
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

  ctx.editing = {
    id: NEW_ID,
    draft: { id: NEW_ID, title: '', courseIds: [], partners: [], body: '' },
  };
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

  wireHang(card);

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

/**
 * 「掛在哪」那兩個分頁。
 *
 * **只換 `hidden` 與 `aria-selected`，不重畫任何 HTML** —— 重畫會把
 * `f.wireChips()` 掛好的委派連同節點一起換掉，而且會洗掉她選到一半的那一排
 * （同壓表那一頁的規矩，ADR-0038）。
 *
 * 計數跟著丸子走：那幾排是 `quiet` 的（不派 change），所以自己接一次 click。
 */
function wireHang(card) {
  const seg = card.querySelector('.seg');
  if (!seg) return;

  const counts = () => {
    for (const key of ['courseIds', 'partners']) {
      const box = card.querySelector(`input[type="hidden"][name="${key}"]`);
      const n = f.splitMulti(box?.value).length;
      const dot = card.querySelector(`[data-hang-n="${key}"]`);
      if (dot) dot.textContent = n || '';
    }
  };

  seg.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-hang]');
    if (!btn) return;
    const picked = btn.dataset.hang;
    seg.querySelectorAll('[data-hang]').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.hang === picked)));
    card.querySelectorAll('[data-hang-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.hangPanel !== picked;
    });
  });

  // 丸子是 quiet 的，所以計數要自己接。掛在卡片上，委派 ——
  // 那一排每次重畫（收合「換一款」）之後照樣接得到。
  card.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-chip]')) counts();
  });
}

/** 畫面上現在打的那些。存檔與取消都要先讀一次，不然重畫會洗掉。 */
function readEditor() {
  const card = cardEl(ctx.editing.id);
  if (!card) return ctx.editing.draft;
  const box = card.querySelector('input[type="hidden"][name="courseIds"]');
  const partnerBox = card.querySelector('input[type="hidden"][name="partners"]');
  return {
    ...ctx.editing.draft,
    title: card.querySelector('[data-title]')?.value ?? '',
    body: card.querySelector('[data-body]')?.value ?? '',
    courseIds: f.splitMulti(box?.value),
    // **那一排不在畫面上時要留原值**（一個合作機構都沒有的時候不畫）——
    // 讀成空陣列等於把她掛過的那幾家清掉，而畫面上沒有任何地方看得出來。
    partners: partnerBox ? f.splitMulti(partnerBox.value) : (ctx.editing.draft.partners ?? []),
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

/**
 * 畫面上打的跟打開時的不一樣嗎。
 *
 * 比的是**她看得到的那幾格**：標題、內文（`bodyOf()` 就是塞進輸入框的那一份，
 * 它會 trim，所以這邊也 trim —— 不然尾巴多一個換行就被當成改過）、掛了哪些
 * 課程與機構。新的那一份跟「什麼都沒有」比：按了右下角那顆、一個字都沒打就點
 * 外面，不該跳一道框問她要不要存一份空的。
 */
function isDirty() {
  if (!ctx.editing) return false;
  const now = readEditor();
  const was = ctx.editing.id === NEW_ID
    ? { title: '', body: '', courseIds: [], partners: [] }
    : ctx.rows.find((x) => x.id === ctx.editing.id) ?? {};
  const same = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));
  return String(now.title ?? '') !== String(was.title ?? '')
    || String(now.body ?? '').trim() !== bodyOf(was)
    || !same(now.courseIds ?? [], was.courseIds ?? [])
    || !same(now.partners ?? [], was.partners ?? []);
}

/**
 * 點外面、按 Escape：要離開編輯了。
 *
 * **沒改過就直接收掉，一句話都不問。** 每點一次外面都跳一道框，比留一顆
 * 「取消」還煩 —— 而她拿掉「取消」就是為了少一件事。
 *
 * 改過才問，而且是**三選一**：存起來、不要了、或者把框關掉（Escape、返回鍵、
 * 點背景）＝ 繼續改。最後那一種不可以被當成「不要了」—— 一個誤觸的返回手勢
 * 會把她打了半天的字丟掉，所以這裡不能用 `confirmAction()` 的 true/false。
 */
async function leaveEdit() {
  if (leaving) return;
  if (!isDirty()) {
    cancelEdit();
    return;
  }
  leaving = true;
  try {
    const pick = await chooseAction({
      title: '這一份改到一半',
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
    // null：她把框關掉了 —— 繼續改，什麼都不動
  } finally {
    leaving = false;
  }
}

/** 長按那一下：鉛筆原地換成紅色垃圾桶。**只換那一顆，整疊不重畫**（ADR-0038）。 */
function armDelete(btn) {
  if (ctx.editing) return;
  disarm();
  const p = ctx.rows.find((x) => x.id === btn.dataset.edit);
  if (!p) return;
  btn.dataset.armed = 'true';
  btn.classList.add('pbcard__edit--armed');
  btn.setAttribute('aria-label', `刪掉「${titleOf(p)}」`);
  btn.innerHTML = icon('trash', { size: 18 });
}

/** 變回鉛筆。點到別的地方、刪除確認按了「取消」都走這一支。 */
function disarm() {
  for (const btn of ctx.el.querySelectorAll('[data-armed="true"]')) {
    const p = ctx.rows.find((x) => x.id === btn.dataset.edit);
    delete btn.dataset.armed;
    btn.classList.remove('pbcard__edit--armed');
    btn.setAttribute('aria-label', `改「${titleOf(p)}」`);
    btn.innerHTML = icon('pencil', { size: 18 });
  }
}

/**
 * 刪掉一份。**兩條路共用這一支**：編輯中右上角那顆垃圾桶、讀的時候長按鉛筆
 * 變出來的那一顆（ADR-0060）。兩份寫法的話，確認框上那兩句後果遲早有一邊漏改。
 */
async function removeOne(id) {
  const p = ctx.rows.find((x) => x.id === id);
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
  if (!ok) {
    disarm();
    return;
  }

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
