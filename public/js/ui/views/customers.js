// 客戶總覽與新增。SPEC 第 8.5 節。
//
// 業務規則不寫在這裡：欄位驗證在 domain/customers.js，次數計算在
// domain/entitlements.js，寫入在 data/customers.js。這一層只負責畫面。

import * as data from '../../data/customers.js';
import * as config from '../../data/config.js';
import * as rules from '../../domain/customers.js';
import { summarize, lowRemaining, expandPlan } from '../../domain/entitlements.js';
import { todayISO } from '../../domain/dates.js';
import * as f from '../components/form.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'low', label: '剩餘快用完' },
  { key: 'expiring', label: '會籍快到期' },
  { key: 'inactive', label: '已停用' },
];

// 搜尋字與篩選留在模組層：從詳情頁按上一頁回來時，她想看到剛剛那份清單，
// 不是被重設成全部。
const view = { search: '', filter: 'all' };

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let rows;
  let entsBy;
  let equipment;
  try {
    [rows, entsBy, equipment] = await Promise.all([
      data.list(),
      data.entitlementsByCustomer(),
      config.listAll('equipment'),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore Rules 還沒部署，或這個帳號不在白名單裡。</p></div>`;
    return;
  }

  el.innerHTML = `
    <section class="card">
      <h2 class="card__title">客戶<span class="muted"> ${rows.length}</span></h2>
      <label class="field">
        <span class="visually-hidden">搜尋客戶</span>
        <input type="text" data-search value="${esc(view.search)}"
               placeholder="搜尋姓名、電話、LINE、購買通路" />
      </label>
      <div class="chips">
        ${FILTERS.map(
          (x) => `<button class="chip" type="button" data-filter="${x.key}"
                    aria-pressed="${x.key === view.filter}">${x.label}</button>`,
        ).join('')}
      </div>
      <p><button class="btn btn--primary" type="button" data-new>新增客戶</button></p>
    </section>
    <div data-rows></div>`;

  const rowsEl = el.querySelector('[data-rows]');
  const repaint = () => paintRows(rowsEl, rows, entsBy, equipment);
  repaint();

  el.querySelector('[data-search]').addEventListener('input', (e) => {
    view.search = e.target.value;
    repaint();
  });

  el.querySelectorAll('[data-filter]').forEach((btn) =>
    btn.addEventListener('click', () => {
      view.filter = btn.dataset.filter;
      el.querySelectorAll('[data-filter]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.filter === view.filter)),
      );
      repaint();
    }),
  );

  el.querySelector('[data-new]').addEventListener('click', () => go('/customers/new'));
}

function matches(customer, ents, today) {
  const q = view.search.trim();
  if (q) {
    const hay = [customer.name, customer.phone, customer.lineId, customer.source]
      .map((v) => String(v ?? ''))
      .join(' ');
    if (!hay.includes(q)) return false;
  }

  if (view.filter === 'inactive') return customer.active === false;
  if (customer.active === false) return false; // 停用的只在自己的篩選裡出現
  if (view.filter === 'low') return lowRemaining(ents);
  if (view.filter === 'expiring') {
    return rules.membershipState(customer.membershipExpiresAt, today).state === 'soon';
  }
  return true;
}

function paintRows(el, rows, entsBy, equipment) {
  const today = todayISO();
  const visible = rows.filter((c) => matches(c, entsBy[c.id] ?? [], today));

  if (!visible.length) {
    el.innerHTML = `<p class="muted">${
      rows.length ? '沒有符合的客戶。' : '還沒有客戶。按上面的「新增客戶」開始。'
    }</p>`;
    return;
  }

  el.innerHTML = visible
    .map((c) => {
      const ents = entsBy[c.id] ?? [];
      const sum = summarize(ents);
      const flags = rules.splitFlags(c, equipment);
      const ms = rules.membershipState(c.membershipExpiresAt, today);

      return `
        <section class="card row">
          <a class="row-link" href="#/customers/${esc(c.id)}">
            <div class="row__main">
              <div class="row__title">
                ${esc(c.name)}
                ${c.priority ? `<span class="badge badge--ok">★ ${c.priority}</span>` : ''}
                ${flags.contraindications.map((x) => `<span class="flag">${esc(x)}</span>`).join('')}
                ${flags.others.map((x) => `<span class="badge">${esc(x)}</span>`).join('')}
                ${c.active === false ? '<span class="badge badge--soon">已停用</span>' : ''}
              </div>
              <div class="muted">${esc(summaryLine(sum, ms))}</div>
            </div>
          </a>
        </section>`;
    })
    .join('');
}

function summaryLine(sum, ms) {
  const parts = [];
  parts.push(sum.pools ? `剩 ${sum.remaining} 次 · ${sum.pools} 個額度` : '還沒有額度');
  if (sum.overused) parts.push('有額度超用');
  parts.push(membershipText(ms));
  return parts.join('・');
}

function membershipText(ms) {
  if (ms.state === 'none') return '沒有會籍日期';
  if (ms.state === 'expired') return `會籍已過期 ${-ms.days} 天`;
  if (ms.state === 'soon') return `會籍剩 ${ms.days} 天`;
  return `會籍剩 ${ms.days} 天`;
}

// ---------- 新增客戶 ----------

export async function renderNew(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let plans;
  let existing;
  try {
    [plans, existing] = await Promise.all([config.listAll('plans'), data.list()]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  const usable = plans.filter((p) => p.active !== false);

  const draft = {
    name: '',
    phone: '',
    lineId: '',
    source: '',
    purchasedAt: todayISO(),
    membershipExpiresAt: '',
    priority: 0,
    flags: '',
    notes: '',
    planId: null,
    quantity: 1,
  };

  paintNew(el, draft, usable, existing);
}

// 這幾個欄位一動，畫面上算出來的東西（到期日、展開預覽、提示）就變了，
// 所以要重畫。重畫一律先把表單現況讀回 draft，沒存的字不會不見。
const RECOMPUTE_ON = ['planId', 'quantity', 'purchasedAt', 'name'];

function paintNew(el, draft, plans, existing) {
  const plan = plans.find((p) => p.id === draft.planId) ?? null;
  const preview = expandPlan(plan, Number(draft.quantity) || 1);

  el.innerHTML = `
    <p><a href="#/customers" data-back>← 客戶</a></p>
    <section class="card">
      <h2 class="card__title">新增客戶</h2>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${f.text({ name: 'name', label: '姓名', value: draft.name, placeholder: '王小姐' })}
        ${f.text({ name: 'phone', label: '電話', value: draft.phone })}
        ${f.text({ name: 'lineId', label: 'LINE', value: draft.lineId })}
        ${f.text({
          name: 'source', label: '購買通路', value: draft.source,
          placeholder: '0522 顧客會-8', hint: '試算表 B2 那一欄的購買名稱。',
        })}
        ${f.select({
          name: 'priority', label: '喜好程度', value: String(draft.priority),
          options: priorityOptions(),
          hint: '排班佇列的排序權重之一（SPEC 第 9 節）。0 代表還沒評。',
        })}
        ${f.text({
          name: 'flags', label: '永久限制', value: draft.flags,
          placeholder: '體內金屬、固定禮拜五不行',
          hint: '用頓號分隔。與器材禁忌同名的會變成硬性阻擋，其餘只是提醒。',
        })}
        ${f.textarea({
          name: 'notes', label: '特殊狀況', value: draft.notes,
          placeholder: '重大疾病治療中，食慾還可以',
        })}

        <h3 class="card__title">買了什麼</h3>
        ${f.select({
          name: 'planId', label: '方案範本', value: draft.planId,
          options: [{ value: null, label: '不選方案（之後單項加購）' },
                    ...plans.map((p) => ({ value: p.id, label: p.name }))],
          hint: '展開後與範本完全脫鉤，之後改範本不會動到這位客戶。',
        })}
        ${f.number({ name: 'quantity', label: '購買數量', value: draft.quantity, min: 1 })}
        ${f.date({ name: 'purchasedAt', label: '購買日', value: draft.purchasedAt })}
        ${f.date({
          name: 'membershipExpiresAt', label: '會籍到期日', value: draft.membershipExpiresAt,
          hint: plan
            ? `選了方案就依「購買日 + ${plan.membershipMonths ?? '?'} 個月」自動算好，可以改。`
            : '沒選方案就自己填，或之後在詳情頁補。',
        })}

        ${previewHtml(plan, preview)}
        ${warningsHtml(draftToCustomer(draft), existing)}

        <div class="form__actions">
          <button class="btn btn--primary" type="submit">建立客戶</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>`;

  const back = () => go('/customers');
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  const form = el.querySelector('[data-form]');

  form.addEventListener('change', (e) => {
    if (!RECOMPUTE_ON.includes(e.target.name)) return;
    const next = { ...draft, ...f.readForm(form) };

    // 選了方案又填了購買日，到期日就自動算 —— 她仍然可以自己改掉。
    const chosen = plans.find((p) => p.id === next.planId) ?? null;
    if (['planId', 'purchasedAt'].includes(e.target.name) && chosen) {
      next.membershipExpiresAt =
        rules.membershipExpiry(next.purchasedAt, chosen.membershipMonths) ?? '';
    }
    paintNew(el, next, plans, existing);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = { ...draft, ...f.readForm(form) };
    const customer = draftToCustomer(values);

    const errors = rules.validate(customer);
    f.showErrors(el, errors);
    if (errors.length) return;

    const chosen = plans.find((p) => p.id === values.planId) ?? null;
    try {
      const id = await toast.withSaveState(
        () => data.createWithPlan(customer, { plan: chosen, quantity: Number(values.quantity) || 1 }),
        { success: '已建立' },
      );
      go(`/customers/${id}`);
    } catch {
      /* withSaveState 已顯示錯誤與重試 */
    }
  });
}

function priorityOptions() {
  return Array.from({ length: rules.MAX_PRIORITY + 1 }, (_, i) => ({
    value: String(i),
    label: i === 0 ? '0 · 還沒評' : `${i} ${'★'.repeat(i)}`,
  }));
}

function draftToCustomer(d) {
  return {
    name: String(d.name ?? '').trim(),
    phone: String(d.phone ?? '').trim() || null,
    lineId: String(d.lineId ?? '').trim() || null,
    source: String(d.source ?? '').trim() || null,
    purchasedAt: d.purchasedAt || null,
    membershipExpiresAt: d.membershipExpiresAt || null,
    priority: Number(d.priority) || 0,
    flags: f.parseList(d.flags),
    notes: String(d.notes ?? '').trim() || null,
  };
}

function previewHtml(plan, preview) {
  if (!plan) {
    return `<p class="muted">沒有選方案，建立後在詳情頁一項一項加購。</p>`;
  }
  if (!preview.length) {
    return `<p class="muted">「${esc(plan.name)}」還沒有任何項目，
      建立後這位客戶會是零額度。先去設定 → 方案範本 補齊項目。</p>`;
  }
  return `
    <div class="card">
      <h3 class="card__title">會展開這些額度</h3>
      <ul class="muted">
        ${preview
          .map((e) => `<li>${esc(e.label)} <b>${e.totalQty}</b> 次</li>`)
          .join('')}
      </ul>
      <p class="muted">建立後與範本脫鉤，可以個別加減。</p>
    </div>`;
}

function warningsHtml(customer, existing) {
  const list = rules.warnings(customer, existing);
  if (!list.length) return '';
  return `
    <div class="card">
      <h3 class="card__title">提醒</h3>
      <ul class="muted">${list.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p class="muted">這些只是提醒，不會擋著不讓你存。</p>
    </div>`;
}
