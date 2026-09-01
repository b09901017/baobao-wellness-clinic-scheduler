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
// 通常就是今天記、今天處理。「挑日期」才展開系統原生的 `<input type="date">`：
// 自己畫一個小日曆是壓表那一頁才需要的（那裡要標紅、標休假），這裡不需要。
//
// **預設是沒有日期。** 泡泡那一支的標準是「三秒內記完」
//（`domain/notes.js` 的檔頭），多一個必填欄位就毀了它。

import { esc } from './form.js';
import { icon } from '../icons.js';
import { shortDate, todayISO } from '../../domain/dates.js';
import { undelivered, deliveryChoices, noteTextFor } from '../../domain/products.js';
import { MAX_LENGTH } from '../../domain/notes.js';
import { openSheet } from './sheet.js';
import { openCard, closeCard } from './card.js';
import { confirmAction } from './dialog.js';

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
 * @param {{today?: string, customer?: boolean, iconSize?: number}} [options]
 *   customer：要不要把掛的客戶名字印出來（客戶詳情頁上是多餘的）
 */
export function row(n, { today = todayISO(), customer = true, iconSize = 13, trash = false } = {}) {
  const late = n.date && !n.done && n.date < today;

  // 掛在這一筆身上的東西做成小丸擺在右邊：客戶一顆、日期一顆，沒掛的就沒有。
  // 以前客戶是換行掛在底下的一顆徽章，一列因此變成兩行高 —— 而那兩行講的是
  // 同一件事。
  const tags = `
    ${customer && n.customerName
      ? `<span class="notetag">${esc(n.customerName)}</span>` : ''}
    ${n.date
      ? `<span class="notetag notetag--date ${late ? 'notetag--past' : ''}">${esc(shortDate(n.date))}</span>`
      : ''}`;

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
      <button class="chip chip--sm" type="button" data-nd-pick
              aria-pressed="${Boolean(picked) && picked !== todayISO()}">挑日期</button>
      <span class="notedate__picked" ${picked ? '' : 'hidden'}>
        <span data-nd-label>${picked ? esc(shortDate(picked)) : ''}</span>
        <button class="chip chip--sm" type="button" data-nd-clear aria-label="拿掉日期">✕</button>
      </span>
      <input type="date" data-nd-input value="${esc(picked)}" hidden />
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
    box.querySelector('[data-nd-pick]').setAttribute('aria-pressed', String(Boolean(v) && v !== todayISO()));
  };

  const set = (iso) => {
    input.value = iso ?? '';
    input.hidden = true;
    paint();
  };

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-nd-today]')) return set(input.value === todayISO() ? null : todayISO());
    if (e.target.closest('[data-nd-clear]')) return set(null);
    if (e.target.closest('[data-nd-pick]')) {
      input.hidden = !input.hidden;
      // showPicker() 要在點擊的手勢堆疊裡才叫得動，跟 quick capture 的
      // focus() 是同一個坑（.scratch/quick-capture/issues/01）。
      if (!input.hidden) {
        try {
          input.showPicker?.();
        } catch {
          input.focus();
        }
      }
    }
    return undefined;
  });

  input.addEventListener('change', paint);
  paint();
  return { set };
}

// ---------- 掛給誰 ----------
//
// 也是選填的，而且跟日期一樣：**點開才讀客戶名單**。她十次有九次不掛人，
// 沒必要為了那一次讓每次開面板都多一趟往返。
//
// 首頁那一格以前沒有這個欄位（只有日期），所以變成一個「掛得了日期、
// 掛不了人」的奇怪組合，而掛人比掛日期常用（2026-08-24）。
// 抽出來之後首頁那一格與右下角的泡泡長一模一樣。

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
    list.innerHTML = `
      <div class="chips">
        ${customers.map((c) => `
          <button class="chip chip--sm" type="button" data-nw-pick="${esc(c.id)}"
                  aria-pressed="${idIn.value === c.id}">${esc(c.name)}</button>`).join('')
        || '<span class="muted">還沒有客戶。</span>'}
      </div>`;
  };

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
  const plain = {
    run: async () => ({ ...note, ...(await setDone(note.id, !note.done)) }),
    success: note.done ? '拿回來了' : '勾掉了',
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
 * @param {string} action `noteActions()` 給的 id
 * @param {object} note
 * @param {object} deps
 * @param {(id: string, changes: object) => Promise<any>} deps.update
 * @param {(id: string, reason: string) => Promise<any>} deps.remove
 * @param {(id: string, done: boolean) => Promise<any>} deps.setDone
 * @param {(customerId: string) => Promise<object[]>} deps.loadEntitlements
 * @param {(note, entitlement, delivery) => Promise<object>} deps.recordDelivery
 * @param {() => Promise<object[]>} deps.loadCustomers
 * @param {string} deps.today
 * @param {(kind: 'save', run: Function, o: {success: string}) => Promise<any>} deps.save
 *   包住寫入的那一層（呼叫端的 `toast.withSaveState`）。復原退得回去。
 * @param {Function} [deps.onEdit] 「改文字」—— 呼叫端自己決定開哪一個編輯器
 * @param {Function} [deps.onBag]  「看那一包營養品」
 * @returns {Promise<boolean>} true = 真的寫了東西（呼叫端該重畫）
 */
export async function runAction(action, note, deps) {
  const {
    update, remove, setDone, loadEntitlements, recordDelivery, loadProducts,
    loadCustomers, today, save, onEdit, onBag,
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
    const text = await askText(note.text ?? '');
    if (text === null || text === note.text) return false;
    await save(() => update(note.id, { text }), { success: '改好了' });
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

  if (action === 'today') {
    await save(() => update(note.id, { date: today }), { success: `改成今天（${shortDate(today)}）` });
    return true;
  }

  if (action === 'date') {
    const picked = await askDate(note.date ?? today);
    if (!picked) return false;
    await save(() => update(note.id, { date: picked }), { success: `改成 ${shortDate(picked)}` });
    return true;
  }

  if (action === 'undate') {
    await save(() => update(note.id, { date: null }), {
      success: '從日曆拿掉了，隨手記裡還在',
    });
    return true;
  }

  if (action === 'who') {
    const picked = await askCustomer(loadCustomers, note.customerId ?? null);
    if (picked === undefined) return false;
    // 兩個欄位是一組的（`domain/notes.js` 的 `normalizePatch()`）：
    // 只帶其中一個過來，另一個會被算成空的。
    await save(
      () => update(note.id, {
        customerId: picked?.id ?? null,
        customerName: picked?.name ?? null,
      }),
      { success: picked ? `掛給${picked.name}了` : '不掛人了' },
    );
    return true;
  }

  if (action === 'remove') {
    const ok = await confirmAction({
      title: '刪掉這一筆隨手記？',
      consequences: [
        note.text,
        '它會進「已刪除項目」，之後還原得回來',
        note.date ? '日曆上那一件也會一起消失 —— 那就是它本人' : '它只在隨手記裡',
      ],
      confirmLabel: '刪掉',
      danger: true,
    });
    if (!ok) return false;
    await save(() => remove(note.id, '長按刪掉'), { success: '刪掉了' });
    return true;
  }

  return false;
}

/**
 * 改那一行字。
 *
 * 內建的那一張，給**沒有自己的編輯器**的那四個入口用（首頁那張卡、
 * `#/todo/notes`、客戶詳情，加上那顆泡泡記完之後）。日曆有它自己的
 * （那裡連日期與刪除都在同一張表上），所以那邊傳 `onEdit` 走自己的。
 *
 * @returns {Promise<string|null>} null = 她按了取消或清成空白
 */
function askText(value) {
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
 * 掛給誰。一排丸子，跟 `wireWho()` 那一排長一樣 ——
 * 同一件事在兩個地方長得不一樣，她會以為是兩種東西。
 *
 * @returns {Promise<{id, name}|null|undefined>}
 *   物件 = 選了誰、null = 不掛人、**undefined = 她按了取消（什麼都不要做）**
 */
function askCustomer(loadCustomers, currentId) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      closeCard();
      resolve(v);
    };

    const card = openCard({
      title: '掛給誰',
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
      },
    });

    loadCustomers()
      .then((rows) => {
        const live = (rows ?? []).filter((c) => c.active !== false);
        card.update(live.length
          ? `<div class="chips">${live.map((c) => `
              <button class="chip" type="button" data-who-pick="${esc(c.id)}"
                      data-who-name="${esc(c.name)}"
                      aria-pressed="${currentId === c.id}">${esc(c.name)}</button>`).join('')}</div>`
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
