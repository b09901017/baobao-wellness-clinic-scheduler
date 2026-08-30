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
import { undelivered } from '../../domain/products.js';
import { openSheet } from './sheet.js';

/**
 * 一列隨手記。點一下就勾掉／取消勾（呼叫端接 `[data-note]`）。
 *
 * 有日期的在文字前面掛一顆日期標籤。過了今天而且還沒勾的用逾期色 ——
 * **但它不是死線**（隨手記沒有死線，見 `CONTEXT.md`），所以只有字變色，
 * 沒有紅底。紅底在這個 app 裡的意思是「這件事該做了」。
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
      <button class="note ${n.done ? 'note--done' : ''}" type="button" data-note="${esc(n.id)}">
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
 * @returns {Promise<{run: () => Promise<object>, success: string}|null>}
 *          null = 她按了「先不要」，什麼都不要做
 */
export async function prepareToggle(note, {
  loadEntitlements, recordDelivery, setDone, today,
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

  const picked = await askDelivery(entitlement, note);
  if (!picked) return null;

  return {
    run: () => recordDelivery(note, entitlement, { at: today, productIds: picked }),
    success: picked.length === undelivered(entitlement).length ? '都給了，記起來了' : '記起來了',
  };
}

/**
 * 「給了什麼？」那一張面板。**逐項預設打勾**，點一下切成「沒給」。
 *
 * @returns {Promise<string[]|null>} null = 她按了「先不要」
 */
function askDelivery(entitlement, note) {
  const left = undelivered(entitlement);
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
      title: `給了什麼？　${note.customerName ?? ''}`,
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
