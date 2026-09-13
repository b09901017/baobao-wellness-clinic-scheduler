// 「買過什麼」。一位客戶當初買了哪幾套方案、加購了什麼。
//
// 她 2026-09-06：「可以顯示清單文字等等，看到他購買了甚麼方案(如果有微調的話
// 可以註記)+加購甚麼等等」，而且「希望可以修改購買日期，因為購買日期和我記錄的
// 日期是不同的……我希望就只能改這個，然後 UIUX 簡潔清楚就好不需要多餘的說明文字」。
//
// ## 這一頁只有一件事改得動
//
// 購買日期。次數要改到那一排額度卡上按「調整」（ADR-0034：一頁一件事）。
//
// ## 它跟額度卡是兩件事
//
//   額度卡    「還剩幾次」—— 會一直變
//   這一頁    「當初買了什麼」—— 不會變
//
// 所以這一頁**不畫剩餘次數**：兩個地方講同一件事，遲早有一邊落後（ADR-0004）。
//
// ## 一天一張（2026-09-13）
//
// 她：「不要把方案品項都列出來，只要像小標題那樣呈現就好，就是哪個方案幾套，加購甚麼多少」，
// 以及「在買了甚麼那邊可以照你建議的這樣分」（照日期分）。所以一張卡片是一天，抬頭是那一天的
// 摘要（跟客戶抬頭同一支的項目段，ADR-0090），微調過的才在底下列一行「本來 → 現在」。
//
// 以前一次購買（`purchaseId`）一張、每一筆額度一列 —— 建新客戶時每一筆加購各自一個購買 id，
// 同一天會冒出好幾張。
//
// 分組與日期怎麼移只寫在 `domain/purchases.js`。

import * as data from '../../data/customers.js';
import * as config from '../../data/config.js';
import {
  purchaseDays, productsOf, dateChangePatch, describeDateChange, purchaseDayLabel,
} from '../../domain/purchases.js';
import { unitOf } from '../components/buy.js';
import { deliveryState } from '../../domain/products.js';
import { esc, showErrors } from '../components/form.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';

/** 現在有哪一組的日期正開著。null = 都沒開。 */
let editing = null;

export async function render(el, id) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  editing = null;

  let customer;
  let entitlements;
  let master;
  try {
    let plans;
    let equipment;
    let courses;
    let ivProducts;
    [customer, entitlements, plans, equipment, courses, ivProducts] = await Promise.all([
      data.get(id),
      data.listEntitlements(id),
      // 摘要那一行的簡寫與套數要的（`purchaseDays()`，ADR-0090）
      config.listAll('plans'),
      config.listAll('equipment'),
      config.listAll('courses'),
      config.listAll('ivProducts'),
    ]);
    master = { plans, equipment, courses, ivProducts };
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  if (!customer) {
    el.innerHTML = `
      <a class="backlink" href="#/customers">${icon('left', { size: 17 })}客戶</a>
      <div class="card"><p>找不到這位客戶，可能已經被刪除。</p></div>`;
    return;
  }

  paint({ el, id, customer, entitlements, master });
}

function paint(ctx) {
  const { el, id, customer, entitlements, master } = ctx;
  const groups = purchaseDays(entitlements, master);
  const products = productsOf(entitlements);

  // 委派掛在這一層，不掛在整頁的 `el` 上 —— `#view` 重畫一次就會多一顆，
  // 而換頁換不掉它（`tests/layering.test.js` 盯著，2026-08-25 付過那個帳）。
  el.innerHTML = `
    <div data-boughtroot>
    <a class="backlink" href="#/customers/${esc(id)}">${icon('left', { size: 17 })}${esc(customer.name)}</a>

    <div class="page"><h1 class="page__title">買過什麼</h1></div>

    <div class="errors" data-errors hidden></div>

    ${groups.length === 0 && products.length === 0
      ? '<p class="muted">還沒有買過任何東西。</p>'
      : groups.map(groupHtml).join('')}

    ${products.length ? `
      <section class="card">
        <div class="row" style="align-items: baseline">
          <h2 class="card__title" style="margin: 0">營養品</h2>
        </div>
        <ul class="roster">
          ${products.map(productRow).join('')}
        </ul>
      </section>` : ''}
    </div>`;

  wire(ctx);
}

/**
 * 一天一張。抬頭是**日期 → 那一天買了什麼**；日期排最前面是因為她認的就是那個
 * ——「七月那一次買的」。日期寫 `0723`，跟客戶抬頭同一種寫法。
 *
 * 底下**只有微調過的才有字**（「本來 20 → 23」）。沒改過的一列都不多 —— 同一個數字講兩遍
 * 等於把品項清單換個樣子放回來，而她說不要列品項。
 */
function groupHtml(g) {
  const when = purchaseDayLabel(g.date) || '沒有日期';
  return `
    <section class="card" data-group="${esc(g.key)}">
      <div class="row" style="align-items: baseline; gap: var(--space-2)">
        ${g.unknown
          ? `<span class="muted num">${esc(when)}</span>`
          : `<button class="footlink num" type="button" data-editdate="${esc(g.key)}">
               ${esc(when)} ${icon('pencil', { size: 13 })}</button>`}
        <h2 class="card__title" style="margin: 0; flex: 1">${esc(g.summary || '（沒有名稱）')}</h2>
        ${g.tweaks.length ? '<span class="badge badge--soon">微調過</span>' : ''}
      </div>

      <div data-dateform="${esc(g.key)}" hidden></div>

      ${g.tweaks.length ? `
        <ul class="roster">
          ${g.tweaks.map(tweakHtml).join('')}
        </ul>` : ''}
    </section>`;
}

/** 微調過的一項：`三選一(60)　本來 24 → 27`。 */
function tweakHtml(t) {
  return `
    <li class="roster__row" data-tweak>
      <span class="roster__main"><span class="roster__name">${esc(t.name)}</span></span>
      <span class="num">本來 ${esc(t.from)} → <strong>${esc(t.to)}</strong></span>
    </li>`;
}

/** 營養品那一列。它論的是月不是次（ADR-0059），而且要看得出給了沒。 */
function productRow(e) {
  const gave = deliveryState(e);
  return `
    <li class="roster__row">
      <span class="roster__main">
        <span class="roster__name">${esc(e.label || '（沒有名稱）')}</span>
        ${gave?.text ? `<span class="roster__note">${esc(gave.text)}</span>` : ''}
      </span>
      <span class="num" style="font-weight: 700">${esc(e.totalQty ?? 0)} ${esc(unitOf(e))}</span>
    </li>`;
}

/**
 * 改購買日那一格。**就地換掉，不跳一層畫面** ——
 * 改一個日期不值得一次進出（ADR-0048：多一層畫面才是多一步退得掉的路）。
 *
 * 「到期日跟著移」那一句**只在真的有到期日的時候出現**（`describeDateChange()`）。
 * 2026-09-06 之後預設不到期，所以大部分時候這裡就只有一格日期跟一顆存。
 */
function dateFormHtml(g, value) {
  const say = describeDateChange(g.rows, value);
  return `
    <div class="row" style="gap: var(--space-2); margin: var(--space-2) 0 0">
      <input type="date" data-newdate value="${esc(value ?? '')}" style="flex: 1"
             aria-label="購買日期" />
      <button class="btn btn--sm btn--primary" type="button" data-savedate>存</button>
      <button class="btn btn--sm" type="button" data-canceldate>取消</button>
    </div>
    ${say ? `<p class="muted dim" style="margin: var(--space-1) 0 0; font-size: var(--text-2xs)"
                data-datesay>${esc(say)}</p>` : '<span data-datesay hidden></span>'}`;
}

function wire(ctx) {
  // **委派掛在 `root` 不掛在 `ctx.el`。** 整頁那一顆重畫一次就多一個，
  // 而換頁換不掉它（`tests/layering.test.js` 盯著這個名字）。
  const root = ctx.el.querySelector('[data-boughtroot]');
  if (!root) return;
  const groups = purchaseDays(ctx.entitlements, ctx.master);
  const groupOf = (key) => groups.find((g) => g.key === key) ?? null;

  const openAt = (key) => {
    const g = groupOf(key);
    const host = root.querySelector(`[data-dateform="${CSS.escape(key)}"]`);
    if (!g || !host) return;
    editing = key;
    host.innerHTML = dateFormHtml(g, g.date);
    host.hidden = false;
    host.querySelector('[data-newdate]')?.focus();
  };

  const closeAt = (key) => {
    const host = root.querySelector(`[data-dateform="${CSS.escape(key)}"]`);
    if (host) {
      host.hidden = true;
      host.innerHTML = '';
    }
    editing = null;
  };

  root.addEventListener('click', async (ev) => {
    const open = ev.target.closest('[data-editdate]');
    if (open) {
      const key = open.dataset.editdate;
      if (editing === key) closeAt(key);
      else openAt(key);
      return;
    }

    if (ev.target.closest('[data-canceldate]')) {
      closeAt(editing);
      return;
    }

    const save = ev.target.closest('[data-savedate]');
    if (!save) return;

    const key = editing;
    const g = groupOf(key);
    const value = root.querySelector('[data-newdate]')?.value ?? '';
    const patches = dateChangePatch(g?.rows ?? [], value);
    if (!patches.length) {
      showErrors(root, ['先選一個日期']);
      return;
    }
    showErrors(root, []);

    await toast.withSaveState(
      () => data.updateEntitlements(ctx.id, patches),
      { success: '購買日期改好了', key: `purchase:date:${ctx.id}:${key}` },
    );
    render(ctx.el, ctx.id);
  });

  // 換一個日期就把那一句話換掉 —— 她要在按「存」之前看得到到期日會怎麼動。
  root.addEventListener('input', (ev) => {
    if (!ev.target.matches('[data-newdate]')) return;
    const g = groupOf(editing);
    const say = describeDateChange(g?.rows ?? [], ev.target.value);
    const line = root.querySelector('[data-datesay]');
    if (!line) return;
    line.textContent = say;
    line.hidden = !say;
  });
}
