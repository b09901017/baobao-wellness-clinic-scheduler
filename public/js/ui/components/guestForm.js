// 一次性客人的名字卡表單（2026-11-05，ADR-0172）。**三個入口共用這一份**（過目 15）：
// 名字卡那一頁的「編輯」（全部五格）、日曆新增「＋ 新增一次性客人」與拍 Abovee「記成一次性客人」的快速表單（前三格）。
//
// 能填的只有客戶文件既有的五格：名字（必填）、病歷號、電話、LINE 名字、警示（spec「資料的形狀」）。
// 提醒照新增客戶那一套（`fieldWarnings()`）：同名、病歷號撞到 —— 貼在那一格旁邊的 ⚠，存檔前那一道再講一次（ADR-0102）；
// **「沒有電話也沒有 LINE」不講**（名字卡選填，`fieldWarnings()` 看到一次性的就不講）。
//
// 這一支**不寫資料庫**：驗證、存檔前那一道問完，把名字卡交給 `onSubmit`（同 `customerForm.js`）。

import * as rules from '../../domain/customers.js';
import { LINE_HINT, CHART_NO_HINT } from '../../domain/customerNotes.js';
import { confirmReview } from './dialog.js';
import * as f from './form.js';
import * as flagsUi from './flags.js';
import { tip } from './tip.js';

const esc = f.esc;
const warnTip = (text) => (text ? tip(text, { kind: 'warn' }) : '');

/**
 * 表單上的值 → 名字卡（`oneTimeCustomer()` 收的那一份）。
 * @returns {{name: string, chartNo: string|null, phone: string|null, lineId: string|null, flags: string[]}}
 */
export function cardOf(values = {}, flags = []) {
  const text = (v) => String(v ?? '').trim() || null;
  return {
    name: String(values.name ?? '').trim(),
    chartNo: text(values.chartNo),
    phone: text(values.phone),
    lineId: text(values.lineId),
    flags: [...(flags ?? [])],
  };
}

/**
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {object} [opts.card] 事先填好的（新增時只有名字；編輯時是那一位）
 * @param {string|null} [opts.id] 編輯哪一位（同名、病歷號比對時跳過自己）
 * @param {object[]} [opts.existing] 既有客戶（一般與一次性都算）
 * @param {string[]} [opts.alerts] 警示那幾個字（`clinicalTerms()`）；快速表單不用
 * @param {boolean} [opts.quick] 只露名字、病歷號、電話（日曆新增、拍 Abovee）
 * @param {string} [opts.submitLabel]
 * @param {(result: {card: object}) => Promise<void>|void} opts.onSubmit
 * @param {Function} [opts.onCancel]
 */
export function mountGuestForm(host, opts) {
  const {
    id = null, existing = [], alerts = [], quick = false, submitLabel = '建立', onSubmit, onCancel,
  } = opts;
  const start = { name: '', chartNo: '', phone: '', lineId: '', flags: [], ...(opts.card ?? {}) };
  let flags = [...(start.flags ?? [])];
  // 比對時當成一次性客人（`fieldWarnings()` 看 `oneTime`）：同名照講、沒有聯絡方式不講
  const asGuest = (values) => ({ ...rules.oneTimeCustomer(cardOf(values, flags)), id });

  const w = rules.fieldWarnings(asGuest(start), existing);
  host.innerHTML = `
    <form class="cform gform" data-gf-form novalidate>
      <div class="errors" data-errors hidden></div>
      <label class="field">
        <span class="field__label">名字<span data-gf-warn="name">${warnTip(w.name)}</span></span>
        <input type="text" name="name" value="${esc(start.name ?? '')}" autocomplete="off" required />
      </label>
      <label class="field">
        <span class="field__label">病歷號${tip(CHART_NO_HINT)}<span data-gf-warn="chartNo">${warnTip(w.chartNo)}</span></span>
        <input type="text" name="chartNo" value="${esc(start.chartNo ?? '')}" inputmode="numeric" autocomplete="off" />
      </label>
      <label class="field">
        <span class="field__label">電話</span>
        <input type="tel" name="phone" value="${esc(start.phone ?? '')}" inputmode="tel" autocomplete="off" />
      </label>
      ${quick ? '' : `
        ${f.text({ name: 'lineId', label: 'LINE 名字', value: start.lineId ?? '', hint: LINE_HINT })}
        <div data-gf-flags></div>`}
      <div class="form__actions">
        <button class="btn btn--primary" type="submit" data-gf-submit>${esc(submitLabel)}</button>
        <button class="btn" type="button" data-gf-cancel>取消</button>
      </div>
    </form>`;

  const form = host.querySelector('[data-gf-form]');
  const flagsBox = host.querySelector('[data-gf-flags]');
  if (flagsBox) {
    flagsUi.mount(flagsBox, { flags, alerts, onChange: (list) => { flags = list; } });
  }

  // 只換那一顆 ⚠（ADR-0038：重畫會吃掉她的下一次點擊）
  const swap = (slot, html) => {
    const box = host.querySelector(`[data-gf-warn="${slot}"]`);
    if (box && box.innerHTML !== html) box.innerHTML = html;
  };
  form.addEventListener('input', (e) => {
    if (!['name', 'chartNo'].includes(e.target.name)) return;
    const now = rules.fieldWarnings(asGuest(f.readForm(form)), existing);
    swap('name', warnTip(now.name));
    swap('chartNo', warnTip(now.chartNo));
  });

  form.querySelector('[data-gf-cancel]').addEventListener('click', () => onCancel?.());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const card = cardOf(f.readForm(form), flags);
    const guest = asGuest(f.readForm(form));
    const errors = rules.validate(guest);
    f.showErrors(host, errors);
    if (errors.length) return;
    if (!await confirmReview(rules.warnings(guest, existing))) return;
    await onSubmit?.({ card });
  });

  return { focus: () => form.querySelector('[name="name"]')?.focus() };
}
