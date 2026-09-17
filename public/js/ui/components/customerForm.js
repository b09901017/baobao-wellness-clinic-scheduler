// 新增一位客戶的表單（issue 08，ADR-0102）。**兩個入口共用**：
// `#/customers/new` 那一頁，與拍訂購單（issue 09）確認卡上的小鉛筆（開在一層裡、事先填好）。
//
// 她 2026-09-17：「新增一個客戶的介面UIUX好醜，希望可以重新設計…版面好擠，資訊太多太雜」。
//
// 三塊，一塊一個問題：**是誰**、**買了什麼**、**要記得的**。
// - 說明全部收在標籤旁邊的 `?`
// - 提醒是貼在那一格旁邊的 ⚠，**只在真的有事時出現**；存檔前那一道再講一次（ADR-0086）
// - 打字時只換那一顆 ⚠，不重畫整張（ADR-0038：重畫會吃掉她的下一次點擊）
//
// 這一支**不寫資料庫**：驗證、存檔前那一道問完，把組好的東西交給 `onSubmit`。
// 寫法由呼叫端決定 —— 新增頁直接建，訂購單那一層只是改草稿。

import * as rules from '../../domain/customers.js';
import { expandPlan } from '../../domain/entitlements.js';
import { toCustomerFields, validateMarks } from '../../domain/customerMarks.js';
import { confirmReview } from './dialog.js';
import * as f from './form.js';
import * as marksUi from './marks.js';
import * as flagsUi from './flags.js';
import * as buy from './buy.js';
import { openBuySheet } from './buySheet.js';
import { tip } from './tip.js';
import { icon } from '../icons.js';

const esc = f.esc;

/**
 * 買了幾份方案。**0 是合法的** —— 她的原話是「購買方案的數量可以是0，
 * 因為有人會單買加購的療程」。0 不等於「不選方案」：選了方案又打 0 時 ⚠ 要講出來。
 */
export const planQuantity = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
};

/** 表單上的值 → 要寫進去的客戶。會籍到期日刻意不在表單裡（ADR-0019）。 */
export function draftToCustomer(d) {
  return {
    name: String(d.name ?? '').trim(),
    phone: String(d.phone ?? '').trim() || null,
    lineId: String(d.lineId ?? '').trim() || null,
    source: String(d.source ?? '').trim() || null,
    purchasedAt: d.purchasedAt || null,
    membershipExpiresAt: null,
    priority: Number(d.priority) || 0,
    flags: d.flags ?? [],
    partners: d.partners ?? [],
    // marks 與 notes 永遠一起寫，不要有只改到一邊的路徑
    ...toCustomerFields(d.marks),
  };
}

/** 一張空白的草稿。 */
export function blankDraft(today) {
  return {
    name: '', phone: '', lineId: '', source: '', purchasedAt: today, priority: 0,
    flags: [], partners: [], marks: [], planId: null, quantity: 1,
    // 方案之外多買的。建立之前都只是草稿，一個字都還沒寫進去。
    extras: [],
  };
}

const warnTip = (text) => (text ? tip(text, { kind: 'warn' }) : '');

/** 數量 0 那一顆 ⚠。選了方案才有數量那一格，所以沒選方案時沒有這一句。 */
function quantityWarning(plan, qty) {
  return plan && qty === 0 ? `數量是 0，「${plan.name}」不會展開任何額度。加購照樣會建。` : '';
}

function priorityOptions() {
  return Array.from({ length: rules.MAX_PRIORITY + 1 }, (_, i) => ({
    value: String(i),
    label: i === 0 ? '還沒評' : '★'.repeat(i),
  }));
}

/**
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {object} opts.draft `blankDraft()` 或事先填好的那一份
 * @param {object[]} opts.plans 還在用的方案範本
 * @param {object[]} opts.existing 既有客戶（同名提醒要比）
 * @param {string[]} opts.alerts 警示那幾個字（`clinicalTerms()`）
 * @param {{courses, equipment, ivProducts, products, partners}} opts.master
 * @param {string} [opts.head] 表單最上面多一塊 HTML（訂購單那一層放照片與原字）
 * @param {string} [opts.submitLabel]
 * @param {(result: {values: object, customer: object, plan: object|null, quantity: number, extras: object[]}) => Promise<void>|void} opts.onSubmit
 * @param {Function} [opts.onCancel]
 * @param {(draft: object) => void} [opts.onDraft] 每改一次交出目前的草稿（訂購單那一層要記住）
 * @returns {{readDraft: () => object}}
 */
export function mountCustomerForm(host, opts) {
  const {
    plans, existing, alerts, master, head = '', submitLabel = '建立客戶',
    onSubmit, onCancel, onDraft,
  } = opts;
  const draft = { ...blankDraft(''), ...opts.draft };

  const paint = () => {
    const plan = plans.find((p) => p.id === draft.planId) ?? null;
    const qty = planQuantity(draft.quantity);
    const warn = rules.fieldWarnings(draftToCustomer(draft), existing);

    host.innerHTML = `
      <form class="cform" data-cf-form novalidate>
        ${head}
        <div class="errors" data-errors hidden></div>

        <section class="cform__group" aria-labelledby="cf-who">
          <h3 class="cform__title" id="cf-who">是誰</h3>
          <label class="field">
            <span class="field__label">姓名<span data-cf-warn="name">${warnTip(warn.name)}</span></span>
            <input type="text" name="name" value="${esc(draft.name)}" placeholder="王小姐" autocomplete="off" />
          </label>
          <div class="cform__pair">
            <label class="field">
              <span class="field__label">電話<span data-cf-warn="contact">${warnTip(warn.contact)}</span></span>
              <input type="tel" name="phone" value="${esc(draft.phone)}" inputmode="tel" autocomplete="off" />
            </label>
            ${f.text({ name: 'lineId', label: 'LINE', value: draft.lineId })}
          </div>
        </section>

        <section class="cform__group" aria-labelledby="cf-bought">
          <h3 class="cform__title" id="cf-bought">買了什麼</h3>
          <div class="cform__pair">
            ${f.text({
              name: 'source', label: '購買通路', value: draft.source,
              placeholder: '0522 顧客會-8', hint: '試算表 B2 那一欄的購買名稱。',
            })}
            ${f.date({ name: 'purchasedAt', label: '購買日', value: draft.purchasedAt })}
          </div>
          ${f.chips({
            name: 'planId', label: '方案', value: draft.planId,
            options: [{ value: null, label: '不選方案' },
                      ...plans.map((p) => ({ value: p.id, label: p.name }))],
            hint: '之後改範本不會動到這位客戶。',
          })}
          ${plan ? `
            <div class="cform__qty">
              <label class="field">
                <span class="field__label">幾套<span data-cf-warn="quantity">${warnTip(quantityWarning(plan, qty))}</span></span>
                <input type="number" name="quantity" value="${esc(draft.quantity)}" min="0" step="1" inputmode="numeric" />
              </label>
              <div class="cform__preview" data-cf-preview>${previewHtml(plan, qty)}</div>
            </div>` : ''}
          ${extrasHtml(draft.extras)}
        </section>

        <section class="cform__group" aria-labelledby="cf-remember">
          <h3 class="cform__title" id="cf-remember">要記得的</h3>
          <div data-cf-flags></div>
          <div data-cf-partners></div>
          <div class="fieldgroup">
            <span class="fieldgroup__label">備註${tip('客戶臨時提的小事，顏色自己分。')}</span>
            <div data-cf-marks></div>
          </div>
          ${f.chips({
            name: 'priority', label: '喜好程度', value: String(draft.priority),
            options: priorityOptions(),
          })}
        </section>

        <div class="cform__bar">
          <button class="btn" type="button" data-cf-cancel>取消</button>
          <button class="btn btn--primary" type="submit">${esc(submitLabel)}</button>
        </div>
      </form>`;

    const form = host.querySelector('[data-cf-form]');

    marksUi.mount(host.querySelector('[data-cf-marks]'), {
      marks: draft.marks,
      onChange: (list) => { draft.marks = list; onDraft?.(readDraft()); },
    });
    flagsUi.mount(host.querySelector('[data-cf-flags]'), {
      flags: draft.flags,
      alerts,
      onChange: (list) => { draft.flags = list; onDraft?.(readDraft()); },
    });
    // 合作機構（ADR-0076）。跟客戶詳情的編輯表單同一支。
    flagsUi.mountPartners(host.querySelector('[data-cf-partners]'), {
      partners: draft.partners,
      options: master.partners ?? [],
      onChange: (list) => { draft.partners = list; onDraft?.(readDraft()); },
    });
    f.wireChips(form);

    const readDraft = () => ({ ...draft, ...f.readForm(form) });

    // 只換那一顆 ⚠：姓名、電話、LINE 打字時
    const swapWarn = (slot, html) => {
      const box = host.querySelector(`[data-cf-warn="${slot}"]`);
      if (box && box.innerHTML !== html) box.innerHTML = html;
    };
    form.addEventListener('input', (e) => {
      if (!['name', 'phone', 'lineId', 'quantity'].includes(e.target.name)) return;
      Object.assign(draft, readDraft());
      const w = rules.fieldWarnings(draftToCustomer(draft), existing);
      swapWarn('name', warnTip(w.name));
      swapWarn('contact', warnTip(w.contact));
      if (e.target.name === 'quantity') {
        const p = plans.find((x) => x.id === draft.planId) ?? null;
        const q = planQuantity(draft.quantity);
        swapWarn('quantity', warnTip(quantityWarning(p, q)));
        const box = host.querySelector('[data-cf-preview]');
        if (box) box.innerHTML = previewHtml(p, q);
      }
      onDraft?.(readDraft());
    });

    // 方案換了才重畫整張：選了方案才會多出「幾套」那一格
    form.addEventListener('change', (e) => {
      if (e.target.name !== 'planId') return;
      Object.assign(draft, readDraft());
      onDraft?.(readDraft());
      paint();
    });

    form.addEventListener('click', (e) => {
      if (e.target.closest('[data-cf-cancel]')) {
        onCancel?.();
        return;
      }
      if (e.target.closest('[data-cf-addextra]')) {
        // 面板裡改的是它自己的草稿，按「加進來」才回到這一張的名單上
        openBuySheet(master, (item) => {
          Object.assign(draft, readDraft(), { extras: [...draft.extras, item] });
          onDraft?.(readDraft());
          paint();
        });
        return;
      }
      const drop = e.target.closest('[data-cf-dropextra]');
      if (drop) {
        const at = Number(drop.dataset.cfDropextra);
        Object.assign(draft, readDraft());
        draft.extras = draft.extras.filter((_, i) => i !== at);
        onDraft?.(readDraft());
        paint();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = readDraft();
      const customer = draftToCustomer(values);

      const errors = [...rules.validate(customer), ...validateMarks(values.marks)];
      f.showErrors(host, errors);
      if (errors.length) return;

      // 存檔前那一道（ADR-0086、0102）：⚠ 收起來的那幾句，按下去之前一定再講一次
      if (!await confirmReview(rules.warnings(customer, existing))) return;

      const quantity = planQuantity(values.quantity);
      // 數量 0 就不展開方案。**不是把方案清掉** —— 展開 0 次會建出一串
      // 總次數是 0 的額度，而那幾筆之後只會在她的畫面上礙事。
      const plan = quantity > 0 ? (plans.find((p) => p.id === values.planId) ?? null) : null;
      await onSubmit?.({
        values,
        customer,
        plan,
        quantity,
        extras: values.extras.map(
          (x) => buy.toEntitlement(x, { purchasedAt: customer.purchasedAt ?? null }),
        ),
      });
    });
  };

  paint();
  return { readDraft: () => ({ ...draft, ...f.readForm(host.querySelector('[data-cf-form]')) }) };
}

/** 會展開的額度：一排小丸子，貼在方案底下（不是一張卡）。 */
function previewHtml(plan, qty) {
  if (!plan || qty === 0) return '';
  const preview = expandPlan(plan, qty);
  if (!preview.length) {
    return `<p class="cform__empty">「${esc(plan.name)}」還沒有任何項目，先去設定 → 方案範本補齊。</p>`;
  }
  return `
    <ul class="cform__expand" aria-label="會展開的額度">
      ${preview.map((e) => `<li><span>${esc(e.label)}</span><b>${e.totalQty}</b></li>`).join('')}
    </ul>`;
}

/**
 * 「加購」那一段。跟客戶詳情的加購是**同一張表**（`components/buy.js`），
 * 只是這裡列的是還沒寫進去的草稿 —— 建立之前一個字都還沒進資料庫。
 */
function extrasHtml(extras) {
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">加購${tip('方案之外多買的。')}</span>
      ${extras.length ? `
        <ul class="roster">
          ${extras.map((x, i) => `
            <li class="roster__row">
              <span class="roster__main">
                <span class="roster__name">${esc(x.label || '（沒有名稱）')}</span>
                <span class="roster__note">${esc(x.totalQty ?? 0)} ${esc(buy.unitOf(x))}</span>
              </span>
              <button class="roster__x" type="button" data-cf-dropextra="${i}"
                      aria-label="拿掉">${icon('close', { size: 15, width: 2 })}</button>
            </li>`).join('')}
        </ul>` : ''}
      <button class="btn btn--sm" type="button" data-cf-addextra>＋ 加一項</button>
    </div>`;
}
