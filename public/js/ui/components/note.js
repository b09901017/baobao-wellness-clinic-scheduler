// 隨手記在畫面上的三塊：**一列**（`row`）、**選填的日期欄**（`field`）與
// **選填的「掛給誰」**（`who`）。
//
// 四個地方共用：待辦首頁底下那張卡、右下角那顆泡泡、`#/todo/notes`、
// 客戶詳情頁，之後再加日曆上的待辦（ADR-0044）。
//
// 抽出來不是為了省行數，是為了**只有一個地方決定它長什麼樣**。
// 這兩塊在這一支之前各有三份寫法，而加一個日期欄位就是三個地方都要記得改 ——
// 其中一份遲早會把空字串當成有值，而空字串跟 null 在日曆的查詢上是兩件事
//（`domain/notes.js` 的 `normalize()`）。
//
// ## 為什麼是兩顆丸子，不是一個攤開的日曆
//
// 「今天」一次點擊就完成，而那是最常見的那一種 —— 客人當著她的面講的話，
// 通常就是今天記、今天處理。「挑日期」那一顆**本身就是**系統原生的 `<input type="date">`：
// 丸子的樣子，裡面疊一個透明、蓋滿整顆的日期框，點下去就是原生的日期選擇、選了就記上。
// 自己畫一個小日曆是壓表那一頁才需要的（那裡要標紅、標休假），這裡不需要。
//
// **不要改回「按丸子 → 程式叫 `showPicker()`」**（2026-11-05 第一輪小修 05）：她用手機那樣按，
// 跳出日曆、選了一天卻什麼都沒記上，要再點底下那個長框框選一次才記得上 —— 點原生的框選得上、
// 程式叫出來的選不上。所以現在只有她自己點到的那一個框，沒有第二條路。
//
// **預設是沒有日期。** 泡泡那一支的標準是「三秒內記完」
//（`domain/notes.js` 的檔頭），多一個必填欄位就毀了它。

import {
  isOneTime, nameHas, chartNoHas, nameSuggestions,
} from '../../domain/customers.js';
import { esc } from './form.js';
import { icon } from '../icons.js';
import { shortDate, todayISO, addMonths } from '../../domain/dates.js';
import { undelivered, deliveryChoices, noteTextFor } from '../../domain/products.js';
import {
  MAX_LENGTH, linkedPeers, noteActions, dateChoices, linkedReach, linkedWords, copyPlan, copiedSay,
} from '../../domain/notes.js';
import { monthWeeks, titleOf, WEEKDAY_HEADERS } from '../../domain/calendar.js';
import { openSheet } from './sheet.js';
import { openCard, closeCard } from './card.js';
import { openActions } from './actions.js';
import { confirmAction } from './dialog.js';

/**
 * 隨手記清單標題旁邊那一顆 `?`（首頁那張卡、`#/todo/notes`）。她 11/6：「這邊也許可以加一個小tooltip說長按可以修改」。
 * 長按有哪幾顆照 `domain/notes.js` 的 `noteActions()` —— 那邊改了這一句要跟著改。
 */
export const LONGPRESS_TIP = '點一下勾掉；長按可以改日期、改字、掛給誰、複製到別天';

/**
 * 「掛給誰」那兩份名單上面那一格搜尋（notes-widget 03）：名字（`nameHas()`）或病歷號（`chartNoHas()`）。
 * **一格一格問，不要接成一串再比**（`CLAUDE.md`「打字找客戶的框」）。沒打字＝每一位都列。
 */
const whoMatches = (c, q) => !String(q ?? '').trim() || nameHas(c?.name, q) || chartNoHas(c, q);

const whoSearch = (attr) => `<input type="search" class="notewho__search" ${attr}
  placeholder="找名字或病歷號" aria-label="找客戶" autocomplete="off" enterkeyhint="search" />`;

/** 隨手記「掛給誰」那兩排：一次性客人名字後面一小格「一次性」（ADR-0172 第 5 題：找人的框也標）。 */
const guestTag = (c) => (isOneTime(c) ? ' <span class="guestmark">一次性</span>' : '');

/**
 * 一列隨手記。點一下就勾掉／取消勾（呼叫端接 `[data-note]`）。
 *
 * 有日期的在文字前面掛一顆日期標籤。過了今天而且還沒勾的用逾期色 ——
 * **但它不是死線**（隨手記沒有死線，見 `CONTEXT.md`），所以只有字變色，
 * 沒有紅底。紅底在這個 app 裡的意思是「這件事該做了」。
 *
 * **`data-longpress` 掛在整列上**（ADR-0060）：點一下勾掉，長按開快捷選單。
 * 這一支只負責標記，「有哪幾顆」在 `domain/notes.js` 的 `noteActions()`，
 * 「選了之後做什麼」在底下的 `runAction()` —— 五個入口共用同樣那三份。
 *
 * @param {object} n
 * @param {{today?: string, customer?: boolean, iconSize?: number, badge?: string|null}} [options]
 *   customer：要不要把掛的客戶名字印出來（客戶詳情頁上是多餘的）
 *   badge：清單上一列代表連在一起的一組時，日期那一顆旁邊那一顆（`linkedBadge()`：「共 3 天」，ADR-0179）。
 *   **日曆、逾期／今天／明天不傳**（那幾頁每一天各一列）
 */
export function row(n, {
  today = todayISO(), customer = true, iconSize = 13, trash = false, badge = null,
} = {}) {
  const late = n.date && !n.done && n.date < today;

  // 掛在這一筆身上的東西做成小丸擺在右邊：客戶一顆、日期一顆，沒掛的就沒有。
  // 以前客戶是換行掛在底下的一顆徽章，一列因此變成兩行高 —— 而那兩行講的是
  // 同一件事。
  const tags = `
    ${customer && n.customerName
      ? `<span class="notetag">${esc(n.customerName)}</span>` : ''}
    ${n.date
      ? `<span class="notetag notetag--date ${late ? 'notetag--past' : ''}">${esc(shortDate(n.date))}</span>`
      : ''}
    ${badge ? `<span class="notecount">${esc(badge)}</span>` : ''}`;

  return `
    <div class="noterow">
      <button class="note ${n.done ? 'note--done' : ''}" type="button"
              data-note="${esc(n.id)}" data-longpress>
        <span class="note__box">${icon('check', { size: iconSize, width: 3.2 })}</span>
        <span class="note__main">
          <span class="note__text">${esc(n.text)}</span>
        </span>
        <span class="notetags">${tags}</span>
      </button>
      ${trash && n.done
        ? `<button class="noterow__trash" type="button" data-note-del="${esc(n.id)}"
                   aria-label="刪掉這一筆">${icon('trash', { size: 15 })}</button>`
        : ''}
    </div>`;
}

/**
 * @param {{value?: string|null}} [options] value：已經有的日期
 */
export function field({ value = null } = {}) {
  const picked = value || '';
  return `
    <div class="notedate" data-notedate>
      <button class="chip chip--sm" type="button" data-nd-today
              aria-pressed="${picked === todayISO()}">今天</button>
      ${/* label 不是 button：<button> 裡不能放 <input>。亮不亮寫在 data-on（label 沒有 aria-pressed）。 */''}
      <label class="chip chip--sm notedate__pick" data-nd-pick
             data-on="${Boolean(picked) && picked !== todayISO()}">挑日期<input
             type="date" class="notedate__input" data-nd-input value="${esc(picked)}" aria-label="挑日期" /></label>
      <span class="notedate__picked" ${picked ? '' : 'hidden'}>
        <span data-nd-label>${picked ? esc(shortDate(picked)) : ''}</span>
        <button class="chip chip--sm" type="button" data-nd-clear aria-label="拿掉日期">✕</button>
      </span>
    </div>`;
}

/**
 * 現在選的是哪一天。沒選回 null（不是空字串）—— 空字串在日曆的查詢上
 * 跟 null 是兩件事（`domain/notes.js` 的 `normalize()`）。
 *
 * 讀第一個就好：呼叫端一次送一份表單，而一份表單只有一個日期欄。
 * 要讀某一份特定的就把那一份的容器傳進來，不要傳整頁。
 */
export function read(root) {
  return root?.querySelector('[data-nd-input]')?.value || null;
}

/**
 * 掛上互動。回傳一支 `set(iso)`，讓呼叫端在存完之後把它清回沒有日期。
 *
 * 事件用委派掛在 `[data-notedate]` 上，所以呼叫端把整塊重畫也不會漏掛。
 *
 * **一個 root 底下有幾個就綁幾個。** 今天每一頁都只有一塊（泡泡那一塊在
 * `document.body` 底下的面板裡，不在頁面的 root 裡），但只綁第一個是一個
 * 沒有人會發現的假設 —— 下一個人把面板改成 inline，第二塊就靜靜不會動了。
 * `set()` 會一起清掉全部。
 */
export function wire(root) {
  const boxes = [...(root?.querySelectorAll('[data-notedate]') ?? [])];
  if (!boxes.length) return { set: () => {} };
  if (boxes.length > 1) {
    const each = boxes.map((box) => wireOne(box));
    return { set: (iso) => each.forEach((w) => w.set(iso)) };
  }
  return wireOne(boxes[0]);
}

function wireOne(box) {
  const input = box.querySelector('[data-nd-input]');
  const label = box.querySelector('[data-nd-label]');
  const picked = box.querySelector('.notedate__picked');

  const paint = () => {
    const v = input.value;
    label.textContent = v ? shortDate(v) : '';
    picked.hidden = !v;
    box.querySelector('[data-nd-today]').setAttribute('aria-pressed', String(v === todayISO()));
    box.querySelector('[data-nd-pick]').dataset.on = String(Boolean(v) && v !== todayISO());
  };

  const set = (iso) => {
    input.value = iso ?? '';
    paint();
  };

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-nd-today]')) return set(input.value === todayISO() ? null : todayISO());
    if (e.target.closest('[data-nd-clear]')) return set(null);
    // 「挑日期」不用接：點到的就是那個日期框本身，選了走底下的 change。
    return undefined;
  });

  // iOS 有的版本選的時候只發 input、按「完成」才發 change —— 兩個都接，paint() 重畫幾次都一樣。
  input.addEventListener('change', paint);
  input.addEventListener('input', paint);
  paint();
  return { set };
}

// ---------- 掛給誰 ----------
//
// 也是選填的。客戶名單**用到才讀、只讀一次**：點開「掛給誰」或打字跳出客戶（`wireSuggest()`）時讀，
// 兩邊共用同一份（`wireCapture()` 的 `customers()`）。她十次有九次不掛人，沒必要每次開面板都多一趟往返。
//
// 首頁那一格以前沒有這個欄位（只有日期），所以變成一個「掛得了日期、
// 掛不了人」的奇怪組合，而掛人比掛日期常用（2026-08-24）。
// 首頁那一格、右下角的泡泡、日曆的待辦編輯器三個入口接線都走底下的 `wireCapture()`
//（2026-11-06 notes-widget 02：首頁那一格也有了「給營養品」，四顆排一排）。

/**
 * @param {{customerId?: string|null, customerName?: string|null}} [options]
 */
export function who({ customerId = null, customerName = null } = {}) {
  const has = Boolean(customerId);
  return `
    <div class="notewho" data-notewho>
      <button class="chip chip--sm" type="button" data-nw-toggle aria-pressed="${has}">
        <span data-nw-label>${has ? esc(customerName ?? '') : '掛給誰'}</span>
      </button>
      <button class="chip chip--sm chip--clear" type="button" data-nw-clear
              ${has ? '' : 'hidden'} aria-label="不掛了">✕ 不掛了</button>
      <input type="hidden" data-nw-id value="${esc(customerId ?? '')}" />
      <input type="hidden" data-nw-name value="${esc(customerName ?? '')}" />
      <div class="notewho__list" data-nw-list hidden></div>
    </div>`;
}

/** 現在掛的是誰。沒掛回兩個 null —— 空字串跟 null 在查詢上是兩件事。 */
export function readWho(root) {
  const box = root?.querySelector('[data-notewho]');
  const id = box?.querySelector('[data-nw-id]')?.value || null;
  return {
    customerId: id,
    customerName: id ? (box?.querySelector('[data-nw-name]')?.value || null) : null,
  };
}

/**
 * @param {HTMLElement} root
 * @param {{load: () => Promise<object[]>}} opts load：點開才會被呼叫，而且只呼叫一次
 * @returns {{set: Function}} 存完之後把它清回沒掛人
 */
export function wireWho(root, { load }) {
  const box = root?.querySelector('[data-notewho]');
  if (!box) return { set: () => {} };

  const idIn = box.querySelector('[data-nw-id]');
  const nameIn = box.querySelector('[data-nw-name]');
  const label = box.querySelector('[data-nw-label]');
  const clear = box.querySelector('[data-nw-clear]');
  const list = box.querySelector('[data-nw-list]');
  let customers = null;

  const paint = () => {
    const has = Boolean(idIn.value);
    label.textContent = has ? nameIn.value : '掛給誰';
    box.querySelector('[data-nw-toggle]').setAttribute('aria-pressed', String(has));
    clear.hidden = !has;
  };

  const set = (customer) => {
    idIn.value = customer?.id ?? '';
    nameIn.value = customer?.name ?? '';
    list.hidden = true;
    paint();
  };

  const openList = async () => {
    if (!list.hidden) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    if (!customers) {
      list.innerHTML = '<p class="muted">讀取中…</p>';
      try {
        customers = await load();
      } catch {
        list.innerHTML = '<p class="muted">讀不到客戶名單。先記下來，之後再掛人也行。</p>';
        return;
      }
    }
    if (!customers.length) {
      list.innerHTML = '<span class="muted">還沒有客戶。</span>';
      return;
    }
    // 最上面一格搜尋（notes-widget 03）：一邊打一邊只換底下那一排，搜尋框留著（鍵盤不收）
    list.innerHTML = `${whoSearch('data-nw-search')}<div class="chips" data-nw-chips>${chipsFor('')}</div>`;
  };

  const shownFor = (q) => (customers ?? []).filter((c) => whoMatches(c, q));
  const chipsFor = (q) => shownFor(q).map((c) => `
    <button class="chip chip--sm" type="button" data-nw-pick="${esc(c.id)}"
            aria-pressed="${idIn.value === c.id}">${esc(c.name)}${guestTag(c)}</button>`).join('')
    || '<span class="muted">找不到這個名字或病歷號。</span>';

  box.addEventListener('input', (e) => {
    if (!e.target.matches?.('[data-nw-search]')) return;
    const chips = box.querySelector('[data-nw-chips]');
    if (chips) chips.innerHTML = chipsFor(e.target.value);
  });

  // 搜尋框在首頁那一格的 <form> 裡：Enter 不可以把隨手記送出去。剛好剩一位就是選他
  box.addEventListener('keydown', (e) => {
    if (!e.target.matches?.('[data-nw-search]') || e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const shown = shownFor(e.target.value);
    if (shown.length === 1) set(shown[0]);
  });

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-nw-clear]')) return set(null);
    if (e.target.closest('[data-nw-toggle]')) return openList();
    const pick = e.target.closest('[data-nw-pick]');
    if (pick) {
      const found = (customers ?? []).find((c) => c.id === pick.dataset.nwPick);
      // 再點一次同一位就取消
      return set(idIn.value === found?.id ? null : found);
    }
    return undefined;
  });

  paint();
  return { set };
}

// ---------- 記一筆那一排：三個有「掛給誰」的入口共用的接線 ----------
//
// 首頁那張卡、右下角泡泡、日曆的待辦編輯器（2026-11-06 notes-widget 02）。以前三處各接一次
// `wire()`／`wireWho()`／`wireGive()`，「選了一包就把掛給誰收起來、字自動填」各寫一份 ——
// 首頁那一格當初就是少接了給營養品。客戶詳情那一格只有日期（固定掛那一位），不走這一支。

/**
 * 打名字就跳出客戶的那一排（notes-widget 03）。放在**輸入框底下、丸子那一排上面**（鍵盤跳出來時它貼著輸入框）；
 * 沒有符合的不佔位置。接線在 `wireCapture()`。
 */
export function suggestRow() {
  return '<div class="notesuggest" data-nsuggest hidden aria-label="符合的客戶"></div>';
}

/**
 * 那一排現在選了什麼：日期、掛給誰；**選了一包營養品時掛的人與 `entitlementId` 由那一包決定**
 *（「掛給誰」那一排那時候是收起來的）。`customerId`／`customerName` 一律兩個一起回
 *（`domain/notes.js` 的 `normalizePatch()`：只帶一個，另一個會被算成空的）。
 */
export function readCapture(root) {
  const bag = readGive(root);
  return {
    date: read(root),
    ...(bag
      ? { customerId: bag.customerId, customerName: bag.customerName, entitlementId: bag.entitlementId }
      : readWho(root)),
  };
}

/**
 * 掛上那一排的互動。
 *
 * @param {HTMLElement} root 包住那一排（與輸入框）的那一塊。**每次重畫都要再叫一次**：
 *   監聽掛在那幾塊自己身上（`[data-notedate]`、`[data-notewho]`、`[data-notegive]`），重畫就是新的節點
 * @param {object} o
 * @param {() => HTMLInputElement|null} o.input 打字的那一格（選了一包營養品時把字填進去）
 * @param {() => HTMLElement|null} o.whoBox 選了一包時要收起來的那一塊（包住「掛給誰」）
 * @param {() => Promise<object[]>} o.loadCustomers 用到才讀（點開掛給誰、或打字跳出客戶）、只讀一次
 * @param {(() => Promise<object[]>)|null} [o.loadBags] `givableBags()`；沒有「給營養品」那一顆就不用給
 * @returns {{read: () => object, reset: () => void}} reset：存完之後清回沒有日期、沒掛人、沒選一包
 */
export function wireCapture(root, {
  input = () => null, whoBox = () => null, loadCustomers, loadBags = null,
} = {}) {
  // 「掛給誰」的名單與打名字跳出客戶讀同一份（spec：列的人＝掛給誰的名單），只讀一次；讀不到下次再讀
  let pending = null;
  const customers = () => {
    pending ??= Promise.resolve().then(loadCustomers).catch((err) => {
      pending = null;
      throw err;
    });
    return pending;
  };
  const when = wire(root);
  const whom = wireWho(root, { load: customers });
  const suggest = wireSuggest(root, { input, customers });
  const bag = wireGive(root, {
    load: loadBags ?? (async () => []),
    onPick: (picked) => {
      const box = whoBox();
      if (box) box.hidden = Boolean(picked);
      const el = input();
      if (picked && el) el.value = picked.text;
      if (picked) suggest.hide();
    },
  });
  suggest.onPick((c) => whom.set(c));
  return {
    read: () => readCapture(root),
    reset: () => {
      when.set(null);
      whom.set(null);
      bag.set(null);
      suggest.hide();
    },
  };
}

/**
 * 打名字就跳出客戶（notes-widget 03）。她 11/6：「我打王 下面就跳出王小明，然後我點了之後，
 * 輸入框直接跳出王小明我只要在打回電就好，如果我點了就也順便幫我掛給他」。
 *
 * - 找哪一段、列誰只問 `domain/customers.js` 的 `nameSuggestions()`（名字**開頭**，不是包含）
 * - **注音選字中不找**（`compositionstart`～`compositionend`；`input` 事件的 `isComposing`）：一排名字會蓋住選字列
 * - 點一位：那一段換成全名、游標接在後面、**框不失焦**（`pointerdown`／`mousedown` 擋掉預設 —— 失焦就是鍵盤收起來）、
 *   掛給他（已經掛給別人就換成他；名字從框裡刪掉不自動拿掉，按「✕ 不掛了」）
 * - **選了一包營養品時不出現**：那一包已經決定是誰
 */
function wireSuggest(root, { input, customers }) {
  const row = root?.querySelector('[data-nsuggest]');
  const el = input();
  let picked = () => {};
  const api = { hide: () => {}, onPick: (fn) => { picked = fn; } };
  if (!row || !el) return api;
  let shown = null;
  let composing = false;
  let asked = 0;

  const hide = () => {
    shown = null;
    row.hidden = true;
    row.innerHTML = '';
  };
  api.hide = hide;

  const quiet = () => composing || readGive(root) || document.activeElement !== el;

  const refresh = async () => {
    asked += 1;
    const mine = asked;
    if (quiet()) return hide();
    let list;
    try {
      list = await customers();
    } catch {
      return hide();
    }
    // 讀名單的那一下她可能又打了字：只畫最後一次
    if (mine !== asked) return undefined;
    if (quiet()) return hide();
    const caret = el.selectionStart ?? el.value.length;
    const s = nameSuggestions(el.value, caret, list, { currentId: readWho(root).customerId });
    if (!s.matches.length) return hide();
    shown = s;
    row.innerHTML = s.matches.map((c) => `
      <button class="chip chip--sm" type="button" data-ns-pick="${esc(c.id)}">${esc(c.name)}${guestTag(c)}</button>`).join('');
    row.hidden = false;
    return undefined;
  };

  el.addEventListener('compositionstart', () => {
    composing = true;
    hide();
  });
  el.addEventListener('compositionend', () => {
    composing = false;
    refresh();
  });
  el.addEventListener('input', (e) => {
    if (e.isComposing) return;
    refresh();
  });
  el.addEventListener('blur', () => hide());

  // 點下去那一下不要讓框失焦（鍵盤會收起來）
  const keepFocus = (e) => {
    if (e.target.closest('[data-ns-pick]')) e.preventDefault();
  };
  row.addEventListener('pointerdown', keepFocus);
  row.addEventListener('mousedown', keepFocus);
  row.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-ns-pick]');
    if (!hit || !shown || readGive(root)) return;
    const c = shown.matches.find((x) => x.id === hit.dataset.nsPick);
    if (!c) return;
    const v = el.value;
    el.value = `${v.slice(0, shown.from)}${c.name}${v.slice(shown.to)}`;
    const at = shown.from + String(c.name).length;
    el.focus();
    el.setSelectionRange?.(at, at);
    picked(c);
    hide();
  });

  return api;
}

// ---------- 營養品的交付 ----------
//
// 掛了 `entitlementId` 的那幾筆隨手記是**營養品的提醒**（`domain/products.js`）。
// 勾掉它不只是勾掉 —— 要順便問「給了哪些」，因為那是要進試算表的紀錄。
//
// **四個入口共用這一支**（首頁那張卡、右下角泡泡、`#/todo/notes`、客戶詳情，
// 再加上日曆的待辦編輯器）。四邊各寫一次的話遲早有一邊只勾不記，
// 而少掉的那一筆紀錄要到她對帳時才會被發現 —— 同 `components/buy.js` 的教訓。

/**
 * 準備勾掉一筆隨手記。**營養品的提醒會先問「給了哪些」。**
 *
 * 回的是**一份還沒執行的寫入**，不是直接寫進去。這樣呼叫端才能只把真的會寫的
 * 那一下包進 `toast.withSaveState()` —— 包住問話那一段的話，她按了「先不要」
 * 也會跳一句「勾掉了」，而那是在說一件沒有發生的事（順帶還會給出一個
 * 什麼都退不掉的「復原」）。
 *
 * 逐項預設全部打勾，跟收尾那一張同一個判斷（十次有九次是整包給完）。
 *
 * **`run()` 會回傳寫完之後的那一筆隨手記。** 呼叫端多半是整塊重畫（那時它
 * 自己會去讀），但原地重畫的那一個（日曆的待辦卡片）需要知道結果 ——
 * 而它猜不得：只給了一部分時 `recordDelivery()` 刻意把提醒留成沒勾掉並換掉
 * 文字，猜 `!note.done` 的話卡片會說一件資料庫沒有發生的事（SPEC 第 6.9 節）。
 *
 * @param {object} note 那一筆隨手記
 * @param {object} deps
 * @param {(customerId: string) => Promise<object[]>} deps.loadEntitlements
 * @param {(note, entitlement, delivery) => Promise<object>} deps.recordDelivery
 * @param {(id: string, done: boolean) => Promise<object>} deps.setDone
 * @param {string} deps.today
 * @param {() => Promise<object[]>} [deps.loadProducts] 營養品主檔。
 *   舊資料上 `items[].name` 是空字串，靠它認回名字（`itemsOf()` 的檔頭）——
 *   沒給的話那張面板每一列會是空白的。讀不到就算了，不要因此擋住她勾選。
 * @returns {Promise<{run: () => Promise<object>, success: string}|null>}
 *          null = 她按了「先不要」，什麼都不要做
 */
export async function prepareToggle(note, {
  loadEntitlements, recordDelivery, setDone, today, loadProducts,
}) {
  // 連在一起的同一組一起勾（ADR-0179）：作用在幾天由寫入那一支回報（它重讀過那一組），不是畫面手上那一份 ——
  // 日曆只讀了一個月，自己數會少數不在這個月的那幾天
  let reach = null;
  const plain = {
    run: async () => {
      const { reach: r = null, ...changes } = (await setDone(note.id, !note.done)) ?? {};
      reach = r;
      return { ...note, ...changes };
    },
    success: () => `${note.done ? '拿回來了' : '勾掉了'}${linkedWords(reach).toast}`,
  };

  // 拿回來（取消勾選）永遠只是拿回來 —— 不要順便問她給了什麼。
  if (!note?.entitlementId || note.done) return plain;

  let entitlement = null;
  try {
    const rows = await loadEntitlements(note.customerId);
    entitlement = (rows ?? []).find((e) => e.id === note.entitlementId) ?? null;
  } catch {
    entitlement = null;
  }

  // 額度讀不到（被刪了、離線）就退回普通的勾掉 —— 少一筆交付紀錄，
  // 不是少一次勾選。擋下來的話她連那一列都關不掉。
  if (!entitlement) return plain;

  // 舊資料的名字是空字串（`domain/products.js` 的 `itemsOf()`）。讀不到主檔
  // 也照樣往下走 —— 少幾個名字，不是少一次勾選。
  let master;
  try {
    master = loadProducts ? { products: await loadProducts() } : undefined;
  } catch {
    master = undefined;
  }

  const picked = await askGiven(entitlement, { customerName: note.customerName ?? '', master });
  if (!picked) return null;

  // 一款都沒有可以記的（她在那張確認框按了「就這樣勾掉」）：
  // 走普通的勾掉。呼叫 `recordDelivery()` 的話 `withDelivery()` 會回 null，
  // 那一筆提醒原封不動 —— 又是一條走不完的路。
  if (!picked.length) {
    return {
      run: plain.run,
      success: '收起來了，沒有多記交付',
    };
  }

  return {
    run: () => recordDelivery(note, entitlement, { at: today, productIds: picked }),
    success: picked.length === undelivered(entitlement, master).length
      ? '都給了，記起來了' : '記起來了',
  };
}

/**
 * 「給了什麼？」那一張面板。**逐項預設打勾**，點一下切成「沒給」。
 *
 * **沒有東西可以給的時候不開這一張。** 那時候面板上一列都沒有、按鈕還是灰的，
 * 唯一的出路是「先不要」—— 她看到的就是「點開是完全空白的，而且完成後不會
 * 被勾掉」（`.scratch/quick-actions-and-supplements/issues/10`）。
 * 改成問一句話並給一條路出去。
 *
 * **export 出去**是因為客戶詳情的「已經給了」要問一模一樣的問題（issue 11）。
 * 兩邊各畫一張逐款面板的話，遲早有一邊少了「給了的才會記進試算表」那一句 ——
 * 而那一句正是她判斷要不要取消勾選某一款的依據。
 *
 * @param {object} entitlement
 * @param {{customerName?: string, master?: {products?: object[]}}} [o]
 * @returns {Promise<string[]|null>} null = 她按了「先不要」；
 *   **空陣列 = 勾掉但不記交付**（沒有東西可以記）
 */
export async function askGiven(entitlement, { customerName = '', master } = {}) {
  const { left, everGave, nothingLeft } = deliveryChoices(entitlement, master);

  if (nothingLeft) {
    const ok = await confirmAction({
      title: '這一包沒有還沒給的東西',
      consequences: [
        everGave ? '這一包裡的每一款都已經記過交付了' : '這一包沒有記到是哪幾款（舊資料）',
        '勾掉只是把這一則提醒收起來，不會再多記一筆交付',
        '要補記給了什麼，到客戶詳情的「營養品」那一段改',
      ],
      confirmLabel: '就這樣勾掉',
    });
    return ok ? [] : null;
  }

  const state = new Set(left.map((x) => x.productId));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      sheet.close();
      resolve(value);
    };

    const body = () => `
      <p class="drawer__note" style="padding: 0">哪一種沒給就點它一下。給了的才會記進試算表。</p>
      ${left.map((x) => {
        const on = state.has(x.productId);
        return `
          <button class="slotrow ${on ? '' : 'slotrow--no'}" type="button"
                  data-give="${esc(x.productId)}">
            <span class="slotrow__main"><span class="slotrow__what">${esc(x.name)}</span></span>
            <span class="badge ${on ? 'badge--ok' : 'badge--overdue'}">${on ? '給了' : '沒給'}</span>
          </button>`;
      }).join('')}`;

    const actions = () => {
      const n = state.size;
      return `
        <button class="btn btn--primary" type="button" data-give-ok ${n ? '' : 'disabled'}>
          ${n === left.length ? `${n} 種都給了，記起來` : `${n} 種給了，記起來`}</button>
        <button class="btn" type="button" data-give-cancel>先不要，回去</button>`;
    };

    const sheet = openSheet({
      title: `給了什麼？　${customerName}`,
      body: body(),
      actions: actions(),
      onClose: () => finish(null),
      onMount: (drawer) => {
        if (drawer.dataset.giveWired) return;
        drawer.dataset.giveWired = '1';

        drawer.addEventListener('click', (ev) => {
          const hit = ev.target.closest('[data-give]');
          if (hit) {
            const id = hit.dataset.give;
            if (state.has(id)) state.delete(id);
            else state.add(id);
            sheet.update(body());
            sheet.setActions(actions());
            return;
          }
          if (ev.target.closest('[data-give-ok]')) finish([...state]);
          else if (ev.target.closest('[data-give-cancel]')) finish(null);
        });
      },
    });
  });
}

// ---------- 長按之後選了一顆，接下來做什麼 ----------
//
// 「有哪幾顆」在 `domain/notes.js` 的 `noteActions()`，這裡是**執行那一顆**。
//
// **五個入口共用這一支**（待辦首頁那張卡、右下角泡泡、`#/todo/notes`、
// 客戶詳情、日曆的抽屜／日／週）。五邊各寫一次的話遲早有一邊直接叫
// `setDone()` 而不是 `prepareToggle()` —— 那正是 `#/todo/notes` 犯過的錯，
// 症狀是營養品的交付紀錄靜靜地沒了（見這個檔案上半段）。
//
// 寫入那幾支由呼叫端傳進來，這一支不 import `/data` —— 同 `prepareToggle()`
// 與 `buy.commitNewProduct()` 的理由。

/**
 * 執行一顆快捷動作。
 *
 * **連在一起的**（ADR-0179）：勾、改字、改掛給誰由寫入那一支一起寫到同一組（`data/notes.js`）；這一支只多兩件事 ——
 * 改字、掛給誰那張卡講出「共 N 天會一起改」（`deps.peers`，數字只問 `linkedReach()`），「複製到別天」那張卡最上面多一顆「拆開這一天」。
 *
 * @param {string} action `noteActions()` 給的 id
 * @param {object} note
 * @param {object} deps
 * @param {(id: string, changes: object) => Promise<any>} deps.update
 * @param {(id: string, done: boolean) => Promise<any>} deps.setDone
 * @param {(customerId: string) => Promise<object[]>} deps.loadEntitlements
 * @param {(note, entitlement, delivery) => Promise<object>} deps.recordDelivery
 * @param {() => Promise<object[]>} deps.loadCustomers
 * @param {(linkId: string) => Promise<object[]>} deps.listLinked 照 `linkId` 重讀那一組（含已刪除的）
 * @param {(note, dates: string[], o: {linked: boolean}) => Promise<{created: number}>} deps.copyTo
 * @param {(id: string) => Promise<any>} deps.unlink
 * @param {string} deps.today
 * @param {(run: Function, o: {success: string|Function, key?: string}) => Promise<any>} deps.save
 *   包住寫入的那一層（呼叫端的 `toast.withSaveState`）。復原退得回去。
 * @param {object[]} [deps.peers] 同一組其他還活著的那幾筆（`openMenu()` 給的；沒給就當沒連在一起）
 * @param {boolean} [deps.onCalendar] 這一列畫在日曆上（「改日期」那張卡講「從日曆拿掉」）
 * @param {Function} [deps.onEdit] 「改文字」—— 呼叫端自己決定開哪一個編輯器
 * @param {Function} [deps.onBag]  「看那一包營養品」
 * @returns {Promise<boolean>} true = 真的寫了東西（呼叫端該重畫）
 */
export async function runAction(action, note, deps) {
  const {
    update, setDone, loadEntitlements, recordDelivery, loadProducts,
    loadCustomers, today, save, onEdit, onBag, peers = [], onCalendar = false,
  } = deps;

  if (action === 'bag') {
    onBag?.(note);
    return false;
  }

  if (action === 'edit') {
    // 呼叫端有自己的編輯器（日曆那一張，連日期與刪除都在裡面）就走它。
    // **沒有的話用內建的那一張小卡片** —— 另外四個入口以前只能回一句
    // 「先勾掉再記一筆新的」，而那是在解釋一個限制，不是在做事。
    // 這一顆補的正是 ADR-0044 Consequences 記著的缺口。
    if (onEdit) {
      onEdit(note);
      return false;
    }
    const words = linkedWords(linkedReach(note, peers));
    const text = await askText(note.text ?? '', { also: words.card });
    if (text === null || text === note.text) return false;
    await save(() => update(note.id, { text }), { success: `改好了${words.toast}` });
    return true;
  }

  // 勾掉／拿回來**一定要走 `prepareToggle()`** —— 營養品的提醒要先問
  // 「給了哪些」，而那筆交付紀錄是要進試算表的。
  if (action === 'tick' || action === 'untick') {
    const plan = await prepareToggle(note, {
      // `loadProducts` 一定要往下傳：舊資料的 `items[].name` 是空字串，
      // 少了它那張「給了什麼？」的面板每一列都是空白（issue 10）。
      loadEntitlements, recordDelivery, setDone, today, loadProducts,
    });
    if (!plan) return false;
    await save(plan.run, { success: plan.success });
    return true;
  }

  // 「改日期」一張卡：改成今天／改成某天／拿掉日期（她 11/6，ADR-0179）。連在一起的也只改這一天
  if (action === 'date') {
    const picked = await askDateChange(note, { today, onCalendar, linked: peers.length > 0 });
    if (!picked) return false;
    if (picked.date === (note.date ?? null)) return false;
    const success = picked.date === null
      ? '從日曆拿掉了，隨手記裡還在'
      : picked.date === today ? `改成今天（${shortDate(today)}）` : `改成 ${shortDate(picked.date)}`;
    await save(() => update(note.id, { date: picked.date }), { success });
    return true;
  }

  if (action === 'copy') return copyAction(note, deps);

  if (action === 'who') {
    const words = linkedWords(linkedReach(note, peers));
    const picked = await askCustomer(loadCustomers, note.customerId ?? null, { also: words.card });
    if (picked === undefined) return false;
    // 兩個欄位是一組的（`domain/notes.js` 的 `normalizePatch()`）：
    // 只帶其中一個過來，另一個會被算成空的。
    await save(
      () => update(note.id, {
        customerId: picked?.id ?? null,
        customerName: picked?.name ?? null,
      }),
      { success: `${picked ? `掛給${picked.name}了` : '不掛人了'}${words.toast}` },
    );
    return true;
  }

  return false;
}

/**
 * 「複製到別天」：小月曆一次點好幾天、預設連在一起；連在一起的最上面一顆「拆開這一天」（ADR-0179）。
 *
 * **打開之前照 `linkId` 重讀那一組**：小月曆上同一組已經有的那幾天要標出來（點了也不會多建 —— `copyPlan()` 跳過），
 * 「拆開這一天」只在真的還連著時給。畫面手上那一份（日曆一個月）數不準。
 */
async function copyAction(note, deps) {
  const { listLinked, copyTo, unlink, save, today } = deps;
  if (note.entitlementId) return false; // 營養品的提醒不給複製（選單上也沒有那一顆）

  // 照 `copyTo()` 讀的同一組（沒有 `linkId` 就照它的 id）：已經勾掉的那一筆上一次複製出去的那幾天也要圈起來（R3）
  let group = [note, ...(deps.peers ?? [])];
  if (listLinked) {
    try {
      group = [note, ...(await listLinked(note.linkId || note.id)).filter((n) => n.id !== note.id)];
    } catch {
      /* 讀不到就用手上那一份 —— 寫的那一刻 `copyTo()` 自己會再重讀一次 */
    }
  }
  // 圈起來的那幾天照 `copyPlan()` 算（連在一起時會跳過的那幾天），不在畫面上另算一份
  const { taken } = copyPlan(note, [], { linked: true, group, newLinkId: '(新的一組)' });

  const picked = await askCopy(note, { today, peers: linkedPeers(note, group), taken });
  if (!picked) return false;

  if (picked.split) {
    await save(() => unlink(note.id), {
      success: `拆開了：${note.date ? shortDate(note.date) : '這一筆'}以後自己勾`,
      key: `note:unlink:${note.id}`,
    });
    return true;
  }

  let result = null;
  await save(async () => {
    result = await copyTo(note, picked.dates, { linked: picked.linked });
    return result;
  }, {
    success: () => copiedSay({ ...result, linked: picked.linked }),
    // 小月曆按兩下、或網路慢按兩次：同一份不建兩次（`copyTo()` 重讀之後也會跳過已經有的那幾天）
    key: `note:copy:${note.id}:${picked.dates.join(',')}:${picked.linked ? 1 : 0}`,
  });
  return true;
}

/**
 * 長按一筆隨手記：選單、選了之後做什麼，**三個入口共用這一支**（首頁那張卡與隨手記那一頁、客戶詳情、日曆）——
 * 三邊各寫一次的話，遲早有一邊漏了「選單最上面列出是哪幾天」或「共 N 天會一起改」。
 *
 * @param {object} n 長按的那一筆（清單上一列代表一組時是代表的那一筆，`groupLinked()`）
 * @param {object} o
 * @param {object[]} [o.notes] 畫面手上那一份
 * @param {boolean} [o.complete] 手上那一份是不是**整組都在**：隨手記那一頁（全部）、首頁那張卡（還沒勾的 —— 一組勾法一樣）、
 *   客戶詳情（那一位）是；日曆（一個月）、逾期／今天／明天（那一天）不是 —— 不是的話打開選單之前照 `linkId` 重讀
 * @param {boolean} [o.customer] 抬頭要不要印掛的客戶（客戶詳情上是多餘的）
 * @param {boolean} [o.onCalendar]
 * @param {object} o.deps `runAction()` 那一份
 * @param {Function} [o.onEdit]
 * @param {Function} [o.onBag]
 * @param {Function} [o.after] 真的寫了東西之後（重畫）
 */
export async function openMenu(n, {
  notes = [], complete = true, customer = true, onCalendar = false, deps, onEdit, onBag, after,
} = {}) {
  let peers = linkedPeers(n, notes);
  if (n.linkId && !complete && deps?.listLinked) {
    try {
      peers = linkedPeers(n, await deps.listLinked(n.linkId));
    } catch {
      /* 讀不到就照手上那一份 —— 選單上少列幾天，寫的那一刻照樣重讀 */
    }
  }
  const days = [...new Set([n, ...peers].map((x) => x.date).filter(Boolean))].sort();

  openActions({
    title: n.text,
    // 連在一起的：日期那一段換成底下那一排（哪幾天、代表的那一天標出來）
    subtitle: [peers.length ? null : (n.date ? shortDate(n.date) : '沒有日期'), customer ? n.customerName : null]
      .filter(Boolean).join('・'),
    tags: peers.length ? days.map((d) => ({ label: shortDate(d), on: d === n.date })) : [],
    items: noteActions(n, { reach: linkedReach(n, peers) }),
    onPick: async (action) => {
      try {
        const changed = await runAction(action, n, { ...deps, peers, onCalendar, onEdit, onBag });
        if (changed) await after?.();
      } catch {
        /* 已處理（toast） */
      }
    },
  });
}

/**
 * 改那一行字。
 *
 * 內建的那一張，給**沒有自己的編輯器**的那四個入口用（首頁那張卡、
 * `#/todo/notes`、客戶詳情，加上那顆泡泡記完之後）。日曆有它自己的
 * （那裡連日期與刪除都在同一張表上），所以那邊傳 `onEdit` 走自己的。
 *
 * @param {string} value
 * @param {{also?: string}} [o] 連在一起的會一起改，講出來（`linkedWords().card`：「共 3 天會一起改」—— lessons 五）
 * @returns {Promise<string|null>} null = 她按了取消或清成空白
 */
function askText(value, { also = '' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeCard();
      resolve(v);
    };

    openCard({
      title: '改文字',
      subtitle: also || '',
      body: `
        <label class="field">
          <span class="visually-hidden">記什麼</span>
          <input type="text" data-edittext maxlength="${MAX_LENGTH}"
                 value="${esc(value)}" style="width: 100%" />
        </label>`,
      actions: `
        <button class="btn btn--primary" type="button" data-edittext-ok>存起來</button>
        <button class="btn" type="button" data-edittext-cancel>先不要</button>`,
      onClose: () => finish(null),
      onMount: (card) => {
        if (card.dataset.edittextWired) return;
        card.dataset.edittextWired = '1';
        card.querySelector('[data-edittext]')?.focus();
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-edittext-cancel]')) return finish(null);
          if (!e.target.closest('[data-edittext-ok]')) return undefined;
          // 空白不算改 —— 一筆沒有字的隨手記在清單上是一列看不懂的東西
          // （`validateNote()` 也擋）。
          return finish(String(card.querySelector('[data-edittext]')?.value ?? '').trim() || null);
        });
        card.addEventListener('keydown', (e) => {
          if (!e.target.matches('[data-edittext]')) return;
          // 輸入法組字中的 Enter 是「確定這個字」，不是「送出」（同泡泡那一支）
          if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          finish(String(e.target.value ?? '').trim() || null);
        });
      },
    });
  });
}

/**
 * 挑一天。
 *
 * 走 `openCard()` 而不是直接 `showPicker()`：那一支要在點擊的手勢堆疊裡才叫得動
 * （`wireOne()` 那一段的同一個坑），而這裡是長按選單關掉之後才走到的 ——
 * 手勢堆疊早就散了。一張小卡片反而更穩，而且它自己吃返回鍵。
 *
 * **export 出去**是因為客戶詳情的營養品那兩顆（「約時間」「已經給了」）
 * 要問同一句話。兩邊各畫一張的話，一邊有「這個日期不是死線」那句說明、
 * 另一邊沒有 —— 她會以為是兩種東西。
 *
 * @param {string|null} value 預設帶哪一天
 * @param {{title?: string, subtitle?: string}} [copy]
 * @returns {Promise<string|null>} null = 她按了取消
 */
export function askDate(value, copy = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeCard();
      resolve(v);
    };

    openCard({
      title: copy.title ?? '哪一天',
      subtitle: copy.subtitle ?? '這個日期不是死線 —— 它是「我想在這一天處理」',
      body: `
        <label class="field">
          <span class="visually-hidden">日期</span>
          <input type="date" data-pickdate value="${esc(value ?? '')}" style="width: 100%" />
        </label>`,
      actions: `
        <button class="btn btn--primary" type="button" data-pickdate-ok>存起來</button>
        <button class="btn" type="button" data-pickdate-cancel>先不要</button>`,
      onClose: () => finish(null),
      onMount: (card) => {
        if (card.dataset.pickdateWired) return;
        card.dataset.pickdateWired = '1';
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-pickdate-cancel]')) finish(null);
          else if (e.target.closest('[data-pickdate-ok]')) {
            finish(card.querySelector('[data-pickdate]')?.value || null);
          }
        });
      },
    });
  });
}

/**
 * 「改日期」那張卡（她 11/6：「改成今天 改成某天 改成拿掉日期」，ADR-0179）。有哪幾個選項只問 `dateChoices()`。
 * 「改成某天」點了才露出日期框（同 `askDate()` 的理由：長按選單收掉之後手勢堆疊散了，`showPicker()` 叫不動）。
 *
 * @returns {Promise<{date: string|null}|null>} null = 她按了取消／點外面；`date: null` = 拿掉日期
 */
function askDateChange(note, { today, onCalendar = false, linked = false } = {}) {
  const choices = dateChoices(note, { today, onCalendar });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeCard();
      resolve(v);
    };

    const sub = [note.date ? `現在是 ${shortDate(note.date)}` : '現在沒有日期', linked ? '只改這一天' : null]
      .filter(Boolean).join('・');

    openCard({
      title: '改日期',
      subtitle: esc(sub),
      body: `
        <div class="datechoice">
          ${choices.map((c) => `
            <button class="datechoice__row" type="button" data-dc="${c.id}">
              <span class="datechoice__label">${esc(c.label)}</span>
              ${c.id === 'today' ? `<span class="datechoice__note num">${esc(shortDate(today))}</span>` : ''}
              ${c.note ? `<span class="datechoice__note">${esc(c.note)}</span>` : ''}
            </button>`).join('')}
          <div class="datechoice__pick" data-dc-pickbox hidden>
            <label class="field">
              <span class="visually-hidden">改成哪一天</span>
              <input type="date" data-dc-input value="${esc(note.date ?? today)}" style="width: 100%" />
            </label>
            <button class="btn btn--primary btn--wide" type="button" data-dc-ok>改成這一天</button>
          </div>
        </div>`,
      onClose: () => finish(null),
      onMount: (el) => {
        if (el.dataset.dcWired) return;
        el.dataset.dcWired = '1';
        el.addEventListener('click', (e) => {
          const hit = e.target.closest('[data-dc]');
          if (hit?.dataset.dc === 'today') return finish({ date: today });
          if (hit?.dataset.dc === 'undate') return finish({ date: null });
          if (hit?.dataset.dc === 'pick') {
            const box = el.querySelector('[data-dc-pickbox]');
            box.hidden = false;
            hit.setAttribute('aria-expanded', 'true');
            box.querySelector('[data-dc-input]')?.focus();
            return undefined;
          }
          if (e.target.closest('[data-dc-ok]')) {
            const v = el.querySelector('[data-dc-input]')?.value || null;
            if (v) finish({ date: v });
          }
          return undefined;
        });
      },
    });
  });
}

/**
 * 「複製到別天」那張卡：小月曆（這個月＋可以翻月）一次點好幾天、底下「連在一起」預設打開、「複製到 N 天」。
 *
 * - 它自己那一天、同一組已經有的那幾天：圈起來、點不了（`copyPlan()` 也會跳過）
 * - 今天以前的點不了（替過去的一天補一則提醒沒有意義；要補記昨天那一件用「記一筆」）
 * - 連在一起的：最上面一顆「拆開這一天」（放在這裡是她 11/6 定的，長按選單放不下）
 *
 * 小月曆**另畫一份**，不共用日曆的 `openDatePicker()`：那一張是「點一天就跳過去」、綁著日曆自己的狀態（`state.view`）；
 * 這一張要一次點好幾天、標出不能點的。格子照同一支 `monthWeeks()`（週一起算）、長相照同一組 `.datepick__*` 的 class。
 *
 * @returns {Promise<{dates: string[], linked: boolean}|{split: true}|null>} null = 她按了 ✕／點外面／返回
 */
function askCopy(note, { today, peers = [], taken: takenDays = [] } = {}) {
  const taken = new Set(takenDays);
  const own = note.date ?? null;
  const picked = new Set();
  let linked = true;
  let cursor = `${(own && own >= today ? own : today).slice(0, 7)}-01`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeCard();
      resolve(v);
    };

    const okLabel = () => `複製到 ${picked.size} 天`;
    const body = () => copyDaysHtml({
      cursor, today, own, taken, picked, linked, canSplit: peers.length > 0, done: Boolean(note.done),
    });

    const card = openCard({
      title: '複製到別天',
      body: body(),
      actions: `<button class="btn btn--primary btn--wide" type="button" data-cd-ok disabled>${okLabel()}</button>`,
      onClose: () => finish(null),
      onMount: (el) => {
        if (el.dataset.cdWired) return;
        el.dataset.cdWired = '1';
        const repaint = () => {
          card.update(body());
          const ok = el.querySelector('[data-cd-ok]');
          if (ok) {
            ok.textContent = okLabel();
            ok.disabled = picked.size === 0;
          }
        };
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-cd-split]')) return finish({ split: true });
          const step = e.target.closest('[data-cd-step]');
          if (step) {
            cursor = addMonths(cursor, Number(step.dataset.cdStep));
            repaint();
            return undefined;
          }
          const day = e.target.closest('[data-cd-day]');
          if (day && !day.disabled) {
            const d = day.dataset.cdDay;
            if (picked.has(d)) picked.delete(d);
            else picked.add(d);
            repaint();
            return undefined;
          }
          if (e.target.closest('[data-cd-ok]') && picked.size) {
            return finish({ dates: [...picked].sort(), linked });
          }
          return undefined;
        });
        el.addEventListener('change', (e) => {
          if (e.target.matches('[data-cd-linked]')) linked = e.target.checked;
        });
      },
    });
  });
}

/** 小月曆那一塊（翻頁、週列頭、格子、開關；連在一起的最上面多「拆開這一天」）。 */
function copyDaysHtml({
  cursor, today, own, taken, picked, linked, canSplit, done = false,
}) {
  const ym = cursor.slice(0, 7);
  const weeks = monthWeeks(ym);
  const cell = (c) => {
    const isOwn = c.date === own;
    const isTaken = taken.has(c.date);
    const past = c.date < today;
    const disabled = isOwn || isTaken || past;
    const cls = [
      'datepick__day', 'datepick__day--tap', 'num', 'copydays__day',
      c.inMonth ? '' : 'is-out', c.date === today ? 'is-today' : '',
      isOwn || isTaken ? 'is-there' : '',
    ].filter(Boolean).join(' ');
    return `<button class="${cls}" type="button" data-cd-day="${c.date}"
              aria-pressed="${picked.has(c.date)}" ${disabled ? 'disabled' : ''}
              aria-label="${esc(shortDate(c.date))}${isOwn ? '（這一筆）' : isTaken ? '（已經有了）' : ''}">${Number(c.date.slice(8))}</button>`;
  };
  return `
    <div class="copydays">
      ${canSplit ? `
        <button class="copydays__split" type="button" data-cd-split>
          ${icon('unlink', { size: 16 })}<span>拆開這一天${own ? `（${esc(shortDate(own))}）` : ''}</span>
          <span class="copydays__splitnote">以後這一天自己勾</span>
        </button>` : ''}
      <div class="datepick__bar">
        <button class="calbar__nav" type="button" data-cd-step="-1" aria-label="上個月">${icon('left', { size: 15 })}</button>
        <span class="datepick__label num">${esc(titleOf('month', cursor, today))}</span>
        <button class="calbar__nav" type="button" data-cd-step="1" aria-label="下個月">${icon('right', { size: 15 })}</button>
      </div>
      <div class="datepick__row datepick__row--head">
        ${WEEKDAY_HEADERS.map((w) => `<span class="datepick__wd">${esc(w)}</span>`).join('')}
      </div>
      ${weeks.map((row) => `<div class="datepick__row">${row.map(cell).join('')}</div>`).join('')}
      <label class="choice choice--row copydays__linked">
        <input type="checkbox" data-cd-linked ${linked ? 'checked' : ''} />
        <span>${done
          // 已經勾掉的那一筆不拉進來（拉進來就是一組勾得不一樣，ADR-0179）—— 連在一起的是新的那幾天（R3）
          ? '新的那幾天連在一起：勾一天，其他天一起勾（這一筆已經勾了，不算在裡面）'
          : '連在一起：勾一天，其他天一起勾'}</span>
      </label>
    </div>`;
}

/**
 * 掛給誰。一排丸子，跟 `wireWho()` 那一排長一樣 ——
 * 同一件事在兩個地方長得不一樣，她會以為是兩種東西。
 *
 * @param {{also?: string}} [o] 連在一起的會一起改，講出來（`linkedWords().card`）
 * @returns {Promise<{id, name}|null|undefined>}
 *   物件 = 選了誰、null = 不掛人、**undefined = 她按了取消（什麼都不要做）**
 */
function askCustomer(loadCustomers, currentId, { also = '' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let live = [];
    const chipsFor = (q) => live.filter((c) => whoMatches(c, q)).map((c) => `
      <button class="chip" type="button" data-who-pick="${esc(c.id)}"
              data-who-name="${esc(c.name)}"
              aria-pressed="${currentId === c.id}">${esc(c.name)}${guestTag(c)}</button>`).join('')
      || '<span class="muted">找不到這個名字或病歷號。</span>';
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeCard();
      resolve(v);
    };

    const card = openCard({
      title: '掛給誰',
      subtitle: also || '',
      body: '<p class="muted">讀取中…</p>',
      actions: `
        ${currentId ? '<button class="btn" type="button" data-who-none>✕ 不掛人</button>' : ''}
        <button class="btn" type="button" data-who-cancel>先不要</button>`,
      onClose: () => finish(undefined),
      onMount: (el) => {
        if (el.dataset.whoWired) return;
        el.dataset.whoWired = '1';
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-who-cancel]')) return finish(undefined);
          if (e.target.closest('[data-who-none]')) return finish(null);
          const hit = e.target.closest('[data-who-pick]');
          if (hit) finish({ id: hit.dataset.whoPick, name: hit.dataset.whoName });
          return undefined;
        });
        // 最上面那一格搜尋（notes-widget 03）：只換底下那一排，搜尋框留著
        el.addEventListener('input', (e) => {
          if (!e.target.matches?.('[data-who-search]')) return;
          const chips = el.querySelector('[data-who-chips]');
          if (chips) chips.innerHTML = chipsFor(e.target.value);
        });
      },
    });

    loadCustomers()
      .then((rows) => {
        // **這一份濾掉停用的**（`wireWho()` 那一份不濾）—— 照現狀各自保留（notes-widget 03 的「做完時留下的」）
        live = (rows ?? []).filter((c) => c.active !== false);
        card.update(live.length
          ? `${whoSearch('data-who-search')}<div class="chips" data-who-chips>${chipsFor('')}</div>`
          : '<p class="muted">還沒有客戶。</p>');
      })
      .catch(() => {
        card.update('<p class="muted">讀不到客戶名單。先記下來，之後再掛人也行。</p>');
      });
  });
}

// ---------- 「給營養品」那一顆捷徑 ----------
//
// 她要記的那一件事本來就有專門的形狀：**一筆掛了 `entitlementId` 的隨手記**
// （ADR-0059）。所以這一顆不是第五種欄位，是一條捷徑：
//
//     一般的隨手記：  打字 → （選填）日期 → （選填）掛給誰
//     給營養品：      選客戶 → 選哪一包 → （選填）日期 → 文字與 entitlementId 自動填好
//
// **不要讓她自己打「給客戶A營養品：夜態美」那一行字。** `noteTextFor()` 產得出來，
// 而她自己打的那一行**沒有 `entitlementId`** —— 於是勾掉的時候不會問
// 「給了哪些」，那筆要進試算表的交付紀錄就沒了（見這個檔案上半段）。
//
// 「有哪幾位、哪幾包」的規則在 `domain/products.js` 的 `givableBags()`，
// 這裡只負責畫與收值。

/**
 * 那一顆與它展開的兩層清單。**選填的捷徑，不是欄位** ——
 * 沒按就跟以前一模一樣（`domain/notes.js` 的「三秒內記完」標準）。
 */
export function give() {
  return `
    <div class="notegive" data-notegive>
      <button class="chip chip--sm" type="button" data-ng-toggle aria-pressed="false">
        <span data-ng-label>給營養品</span>
      </button>
      <button class="chip chip--sm chip--clear" type="button" data-ng-clear hidden
              aria-label="不是這一包">✕ 不是這個</button>
      <input type="hidden" data-ng-ent value="" />
      <input type="hidden" data-ng-cid value="" />
      <input type="hidden" data-ng-cname value="" />
      <input type="hidden" data-ng-text value="" />
      <div class="notewho__list" data-ng-list hidden></div>
    </div>`;
}

/**
 * 選好的是哪一包。沒選回 null。
 *
 * 回的是**一份已經填好的隨手記**：文字、掛給誰、`entitlementId` 三件事一起。
 */
export function readGive(root) {
  const box = root?.querySelector('[data-notegive]');
  const entitlementId = box?.querySelector('[data-ng-ent]')?.value || null;
  if (!entitlementId) return null;
  return {
    entitlementId,
    customerId: box.querySelector('[data-ng-cid]').value || null,
    customerName: box.querySelector('[data-ng-cname]').value || null,
    text: box.querySelector('[data-ng-text]').value || '',
  };
}

/**
 * 掛上互動。
 *
 * 兩層：先選客戶（**只列身上有還沒給完的營養品的那幾位**），再選哪一包。
 * 跟 `wireWho()` 同一條規矩：**點開才讀**，而且只讀一次 ——
 * 她十次有九次不是在記營養品。
 *
 * @param {HTMLElement} root
 * @param {object} o
 * @param {() => Promise<object[]>} o.load `givableBags()` 的結果
 * @param {(picked: object|null) => void} [o.onPick] 選好了／取消了。呼叫端用它
 *   收掉「掛給誰」那一排（客戶已經由那一包決定了，兩個地方各講一次會出現
 *   「掛給客戶B、內容是給客戶A營養品」這種東西）並把文字填進輸入框。
 * @returns {{set: Function}} 存完之後清回沒選
 */
export function wireGive(root, { load, onPick } = {}) {
  const box = root?.querySelector('[data-notegive]');
  if (!box) return { set: () => {} };

  const entIn = box.querySelector('[data-ng-ent]');
  const cidIn = box.querySelector('[data-ng-cid]');
  const cnameIn = box.querySelector('[data-ng-cname]');
  const textIn = box.querySelector('[data-ng-text]');
  const label = box.querySelector('[data-ng-label]');
  const clear = box.querySelector('[data-ng-clear]');
  const list = box.querySelector('[data-ng-list]');
  let rows = null;
  /** 現在攤開的是哪一位。null = 還在選客戶那一層。 */
  let openCustomer = null;

  const paint = () => {
    const has = Boolean(entIn.value);
    label.textContent = has ? textIn.value : '給營養品';
    box.querySelector('[data-ng-toggle]').setAttribute('aria-pressed', String(has));
    clear.hidden = !has;
  };

  const set = (picked) => {
    entIn.value = picked?.entitlementId ?? '';
    cidIn.value = picked?.customerId ?? '';
    cnameIn.value = picked?.customerName ?? '';
    textIn.value = picked?.text ?? '';
    list.hidden = true;
    openCustomer = null;
    paint();
    onPick?.(picked ?? null);
  };

  const paintList = () => {
    if (!rows?.length) {
      list.innerHTML = '<p class="muted" style="margin: 0">現在沒有人有還沒給完的營養品。</p>';
      return;
    }
    if (!openCustomer) {
      list.innerHTML = `
        <div class="chips">
          ${rows.map((r) => `
            <button class="chip chip--sm" type="button" data-ng-cust="${esc(r.customerId)}"
              >${esc(r.customerName)}<span class="chip__note">${r.bags.length}</span></button>`).join('')}
        </div>`;
      return;
    }
    const who = rows.find((r) => r.customerId === openCustomer);
    list.innerHTML = `
      <button class="chip chip--sm" type="button" data-ng-back>← 換一位</button>
      <div class="groups" style="margin-top: var(--space-2)">
        ${(who?.bags ?? []).map((b) => `
          <button class="grouprow" type="button" data-ng-bag="${esc(b.entitlementId)}">
            <span class="grouprow__main">
              <span class="grouprow__label">${esc(b.label)}</span>
              ${b.hint ? `<span class="grouprow__note">${esc(b.hint)}</span>` : ''}
            </span>
          </button>`).join('')}
      </div>`;
  };

  const openList = async () => {
    if (!list.hidden) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    openCustomer = null;
    if (!rows) {
      list.innerHTML = '<p class="muted" style="margin: 0">讀取中…</p>';
      try {
        rows = await load();
      } catch {
        list.innerHTML = '<p class="muted" style="margin: 0">讀不到營養品。先記一行字，之後再從客戶詳情約時間。</p>';
        return;
      }
    }
    paintList();
  };

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-ng-clear]')) return set(null);
    if (e.target.closest('[data-ng-toggle]')) return openList();
    if (e.target.closest('[data-ng-back]')) {
      openCustomer = null;
      paintList();
      return undefined;
    }
    const cust = e.target.closest('[data-ng-cust]');
    if (cust) {
      openCustomer = cust.dataset.ngCust;
      paintList();
      return undefined;
    }
    const bag = e.target.closest('[data-ng-bag]');
    if (bag) {
      const who = rows.find((r) => r.customerId === openCustomer);
      const found = who?.bags.find((b) => b.entitlementId === bag.dataset.ngBag);
      if (!found) return undefined;
      return set({
        entitlementId: found.entitlementId,
        customerId: who.customerId,
        customerName: who.customerName,
        text: noteTextFor(found.entitlement, who.customerName),
      });
    }
    return undefined;
  });

  paint();
  return { set };
}
