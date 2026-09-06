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
// 分組與日期怎麼移只寫在 `domain/purchases.js`。

import * as data from '../../data/customers.js';
import {
  groupPurchases, productsOf, isTweaked, dateChangePatch, describeDateChange,
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
  try {
    [customer, entitlements] = await Promise.all([
      data.get(id),
      data.listEntitlements(id),
    ]);
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

  paint({ el, id, customer, entitlements });
}

function paint(ctx) {
  const { el, id, customer, entitlements } = ctx;
  const groups = groupPurchases(entitlements);
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
 * 一組購買。
 *
 * 抬頭上是**日期 → 名字 → 微調過**。日期排最前面是因為她認的就是那個
 * ——「三月那一次買的」。
 */
function groupHtml(g) {
  return `
    <section class="card" data-group="${esc(g.key)}">
      <div class="row" style="align-items: baseline; gap: var(--space-2)">
        ${g.purchaseId && !g.unknown
          ? `<button class="footlink" type="button" data-editdate="${esc(g.key)}">
               ${esc(g.purchasedAt ?? '沒有日期')} ${icon('pencil', { size: 13 })}</button>`
          : `<span class="muted">${esc(g.purchasedAt ?? '沒有日期')}</span>`}
        <h2 class="card__title" style="margin: 0; flex: 1">${esc(g.label)}</h2>
        ${g.tweaked ? '<span class="badge badge--soon">微調過</span>' : ''}
      </div>

      <div data-dateform="${esc(g.key)}" hidden></div>

      <ul class="roster">
        ${g.rows.map(rowHtml).join('')}
      </ul>
    </section>`;
}

/**
 * 一列。**改過的才印「方案本來 N 次」** —— 沒改過的印出來等於把同一個數字
 * 講兩遍（同 `components/planTweak.js` 的 `noteFor()`）。
 */
function rowHtml(e) {
  const notes = [
    isTweaked(e) ? `方案本來 ${e.sourcePlanQty} 次` : null,
    e.followupForEntitlementId ? '健檢配出來的' : null,
  ].filter(Boolean);

  return `
    <li class="roster__row">
      <span class="roster__main">
        <span class="roster__name">${esc(e.label || '（沒有名稱）')}</span>
        ${notes.length ? `<span class="roster__note">${esc(notes.join('　'))}</span>` : ''}
      </span>
      <span class="num" style="font-weight: 700">${esc(e.totalQty ?? 0)} ${esc(unitOf(e))}</span>
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
  const groups = groupPurchases(ctx.entitlements);
  const groupOf = (key) => groups.find((g) => g.key === key) ?? null;

  const openAt = (key) => {
    const g = groupOf(key);
    const host = root.querySelector(`[data-dateform="${CSS.escape(key)}"]`);
    if (!g || !host) return;
    editing = key;
    host.innerHTML = dateFormHtml(g, g.purchasedAt);
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
