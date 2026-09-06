// 客戶總覽與新增。SPEC 第 8.5 節。
//
// 業務規則不寫在這裡：欄位驗證在 domain/customers.js，次數計算在
// domain/entitlements.js，備註在 domain/customerMarks.js，寫入在 data/customers.js。
// 這一層只負責畫面。
//
// 上面那一排丸子是**排序**不是篩選：她心裡的問題是「先看誰」，不是
// 「把誰藏起來」。原本的「剩餘快用完 / 會籍快到期」兩個篩選拿掉了 ——
// 會籍這件事實務上不存在（ADR-0019），而「快用完」是排序理由不是分類。
// 丸子一律橫向滑，不換行往下堆，否則它會把底下的客戶一路往下推。

import * as data from '../../data/customers.js';
import * as config from '../../data/config.js';
import * as visitsData from '../../data/visits.js';
import * as rules from '../../domain/customers.js';
import { summarize, expandPlan, isProduct } from '../../domain/entitlements.js';
import { customerPools } from '../../domain/scheduling.js';
import { readMarks, toCustomerFields, validateMarks } from '../../domain/customerMarks.js';
import { clinicalTerms } from '../../domain/masterData.js';
import { isActive } from '../../domain/visits.js';
import { icon } from '../icons.js';
import { todayISO, addDays, shortDate } from '../../domain/dates.js';
import * as f from '../components/form.js';
import * as marksUi from '../components/marks.js';
import * as flagsUi from '../components/flags.js';
import * as buy from '../components/buy.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import * as toast from '../toast.js';
import { go } from '../router.js';
import { back as goBack } from '../nav.js';

const esc = f.esc;

/**
 * 排序丸。全部都是「先看誰」的不同答案，沒有一個會把人藏起來。
 *
 * 課程丸另外一組（由實際存在的額度算出來），點了才會收窄名單 ——
 * 那是唯一會少人的丸子，所以它跟排序丸中間隔一條線。
 */
const SORTS = [
  { id: 'recent', label: '最近來過' },
  { id: 'stale', label: '最久沒來' },
  { id: 'added', label: '新加入的' },
  { id: 'priority', label: '喜好程度' },
  { id: 'name', label: '姓名' },
];

// 搜尋字與排序留在模組層：從詳情頁按上一頁回來時，她想看到剛剛那份清單。
const view = { search: '', sort: 'recent', course: null, showInactive: false };

/** 上次來訪往回看多久。超過就一律算「很久沒來」，不必把整個資料庫拉下來。 */
const LOOKBACK_DAYS = 180;
const LOOKAHEAD_DAYS = 120;

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  const today = todayISO();
  let rows;
  let entsBy;
  let equipment;
  let clinicalFlags;
  let visits;
  try {
    [rows, entsBy, equipment, clinicalFlags, visits] = await Promise.all([
      data.list(),
      data.entitlementsByCustomer(),
      config.listAll('equipment'),
      // 臨床提醒（ADR-0064）。跟另外幾份同一趟拿，不多一輪往返。
      config.listAll('clinicalFlags'),
      visitsData.listBetween(addDays(today, -LOOKBACK_DAYS), addDays(today, LOOKAHEAD_DAYS)),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore Rules 還沒部署，或這個帳號不在白名單裡。</p></div>`;
    return;
  }

  const ctx = { rows, entsBy, equipment, clinicalFlags, today, visitsBy: byCustomer(visits, today) };

  el.innerHTML = `
    <div class="page">
      <div class="page__row">
        <h1 class="page__title">客戶</h1>
        <span class="footlinks footlinks--inline">
          <a class="footlink" href="#/customers/progress">看這個月的進度</a>
          <button class="footlink" type="button" data-inactive
                  aria-pressed="${view.showInactive}">
            ${view.showInactive ? '看在服務中的' : '看已停用的'}</button>
        </span>
      </div>
    </div>

    <label class="field" style="margin-bottom: var(--space-2)">
      <span class="visually-hidden">搜尋客戶</span>
      <input type="text" data-search value="${esc(view.search)}" style="width: 100%"
             placeholder="找人：姓名、電話、LINE、購買通路" />
    </label>

    <div class="chiprow noscroll-bar" role="group" aria-label="先看誰">
      ${SORTS.map((s) => `
        <button class="chip chip--sm" type="button" data-sort="${s.id}"
                aria-pressed="${s.id === view.sort && !view.course}">${s.label}</button>`).join('')}
      ${courseChips(ctx)}
    </div>

    <div data-rows></div>

    <div class="fab" data-fab>
      <div class="fab__menu" hidden data-fabmenu>
        <button class="fab__item" type="button" data-bulk>
          <span>快速建立一群</span>
          <span class="fab__dot fab__dot--tea">${icon('people', { size: 18 })}</span>
        </button>
        <button class="fab__item" type="button" data-new>
          <span>新增一位</span>
          <span class="fab__dot">${icon('plus', { size: 18, width: 2.2 })}</span>
        </button>
      </div>
      <button class="fab__main" type="button" data-fabtoggle aria-label="新增"
              aria-expanded="false">
        ${icon('plus', { size: 24, width: 2.2 })}
      </button>
    </div>`;

  const rowsEl = el.querySelector('[data-rows]');
  const repaint = () => paintRows(rowsEl, ctx);
  repaint();

  el.querySelector('[data-search]').addEventListener('input', (e) => {
    view.search = e.target.value;
    repaint();
  });

  el.querySelector('[data-inactive]').addEventListener('click', () => {
    view.showInactive = !view.showInactive;
    render(el);
  });

  const pressSort = () => {
    el.querySelectorAll('[data-sort]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.sort === view.sort && !view.course)),
    );
    el.querySelectorAll('[data-course]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.course === view.course)),
    );
  };

  el.querySelectorAll('[data-sort]').forEach((btn) =>
    btn.addEventListener('click', () => {
      view.sort = btn.dataset.sort;
      view.course = null;
      pressSort();
      repaint();
    }),
  );

  el.querySelectorAll('[data-course]').forEach((btn) =>
    btn.addEventListener('click', () => {
      // 再點一次同一顆就取消，回到原本的排序 —— 不要逼她去找「全部」在哪
      view.course = view.course === btn.dataset.course ? null : btn.dataset.course;
      pressSort();
      repaint();
    }),
  );

  // 懸浮鈕點開兩條路。單一動作直接跳走的那一版在「快速建立一群」出現之後
  // 就不夠用了 —— 但預設仍然是收起來的：她大部分時候是來看名單，不是來新增。
  const fab = el.querySelector('[data-fab]');
  const menu = el.querySelector('[data-fabmenu]');
  const toggle = el.querySelector('[data-fabtoggle]');

  toggle.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    fab.dataset.open = String(open);
  });

  el.querySelector('[data-new]').addEventListener('click', () => go('/customers/new'));
  el.querySelector('[data-bulk]').addEventListener('click', () => go('/customers/bulk'));
}

/** 課程丸：實際上有人還有剩餘次數的那幾種，多的排前面。 */
function courseChips(ctx) {
  const tally = new Map();
  for (const c of ctx.rows) {
    if (c.active === false || c.deletedAt) continue;
    for (const p of customerPools({ entitlements: ctx.entsBy[c.id] ?? [] }).pools) {
      if (p.remaining > 0) tally.set(p.label, (tally.get(p.label) ?? 0) + 1);
    }
  }
  if (!tally.size) return '';

  const labels = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh-TW'))
    .slice(0, 10);

  return `<span class="chiprow__sep" aria-hidden="true"></span>
    ${labels.map(([label, n]) => `
      <button class="chip chip--sm" type="button" data-course="${esc(label)}"
              aria-pressed="${label === view.course}">${esc(label)}
        <span class="num dim">${n}</span></button>`).join('')}`;
}

/** 只留這位客戶在時間窗內的來訪，並算出上次與下次。 */
function byCustomer(visits, today) {
  const out = {};
  for (const v of visits) {
    if (!isActive(v)) continue;
    (out[v.customerId] ??= []).push(v);
  }
  for (const [id, list] of Object.entries(out)) {
    const dates = list.map((v) => v.date).sort();
    out[id] = {
      last: [...dates].reverse().find((d) => d <= today) ?? null,
      next: dates.find((d) => d > today) ?? null,
    };
  }
  return out;
}

function matches(customer, ctx) {
  const q = view.search.trim();
  if (q) {
    const hay = [customer.name, customer.phone, customer.lineId, customer.source]
      .map((v) => String(v ?? ''))
      .join(' ');
    if (!hay.includes(q)) return false;
  }

  if (view.showInactive) return customer.active === false;
  if (customer.active === false) return false;

  if (view.course) {
    const { pools } = customerPools({ entitlements: ctx.entsBy[customer.id] ?? [] });
    return pools.some((p) => p.label === view.course && p.remaining > 0);
  }
  return true;
}

/** Firestore 的 Timestamp、Date、字串都可能出現，一律換成毫秒才比得了。 */
function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

function sortRows(list, ctx) {
  const name = (c) => String(c.name ?? '');
  const byName = (a, b) => name(a).localeCompare(name(b), 'zh-TW');
  const last = (c) => ctx.visitsBy[c.id]?.last ?? '';
  const remainingOf = (c) =>
    customerPools({ entitlements: ctx.entsBy[c.id] ?? [] }).pools
      .find((p) => p.label === view.course)?.remaining ?? 0;

  // 點了課程丸就照那個課程還剩幾次排 —— 那一刻她問的是「這個還有誰要排」
  if (view.course) {
    return [...list].sort((a, b) => remainingOf(b) - remainingOf(a) || byName(a, b));
  }

  const sorters = {
    // 沒來過的沉到最後：這一排要回答「誰最近有動靜」
    recent: (a, b) => (last(b) || '').localeCompare(last(a) || '') || byName(a, b),
    // 反過來，沒來過的浮到最前 —— 那正是「最久沒來」要找的人
    stale: (a, b) => (last(a) || '0').localeCompare(last(b) || '0') || byName(a, b),
    added: (a, b) => millis(b.createdAt) - millis(a.createdAt) || byName(a, b),
    priority: (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || byName(a, b),
    name: byName,
  };
  return [...list].sort(sorters[view.sort] ?? byName);
}

function paintRows(el, ctx) {
  const visible = sortRows(ctx.rows.filter((c) => matches(c, ctx)), ctx);

  if (!visible.length) {
    el.innerHTML = `<p class="muted">${
      ctx.rows.length ? '沒有符合的客戶。' : '還沒有客戶。按右下角的加號開始。'
    }</p>`;
    return;
  }

  el.innerHTML = `
    <p class="muted" style="margin: 0 0 var(--space-3)">
      ${visible.length} 位${view.course ? `・還有「${esc(view.course)}」可以排` : ''}</p>
    <div class="cardgrid">${visible.map((c) => card(c, ctx)).join('')}</div>`;
}

function card(c, ctx) {
  const ents = ctx.entsBy[c.id] ?? [];
  const sum = summarize(ents);
  const flags = rules.splitFlags(c, ctx.clinicalFlags);
  const marks = readMarks(c);
  let { pools } = customerPools({ entitlements: ents });

  // 點了課程丸就把那一項提到最上面 —— 她現在問的就是它
  if (view.course) {
    pools = [...pools].sort((a, b) => (b.label === view.course) - (a.label === view.course));
  }
  const shown = pools.filter((p) => p.total > 0).slice(0, 4);

  return `
    <a class="card" href="#/customers/${esc(c.id)}"
       style="display: block; text-decoration: none; color: inherit">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">
            ${esc(c.name)}
            ${c.priority ? `<span class="stars">${'★'.repeat(c.priority)}</span>` : ''}
            ${flagsUi.detailChips(flags, { others: false, rows: ctx.clinicalFlags })}
            ${c.active === false ? '<span class="badge">已停用</span>' : ''}
          </div>
          <div class="hero__meta">${esc(metaLine(c, ctx))}</div>
        </div>
        ${icon('right', { size: 16 })}
      </div>

      ${marks.length
        ? `<div style="margin-top: var(--space-2)">${marksUi.row(marks, { max: 3 })}</div>`
        : ''}

      ${shown.length
        ? `<div class="stack" style="margin-top: var(--space-3); gap: 6px">
            ${shown.map((p) => poolLine(p)).join('')}
            ${pools.length > shown.length
              ? `<p class="muted dim" style="margin: 0; font-size: var(--text-2xs)">
                  還有 ${pools.length - shown.length} 種，點進去看</p>`
              : ''}
          </div>`
        : `<p class="muted" style="margin: var(--space-2) 0 0">${
            // 買了營養品但沒有任何課程額度是會發生的（ADR-0057）。
            // 這一列不畫營養品（它排不進來訪，寫在這裡只會擠掉真的要排的人），
            // 但也不可以說成「還沒有額度」—— 她明明賣掉了東西。
            ents.some(isProduct) ? '只買了營養品，沒有要排的課程。' : '還沒有額度。'
          }</p>`}

      ${flags.others.length || sum.overused ? `
        <div class="chips" style="margin-top: var(--space-3); row-gap: 6px">
          ${flags.others.map((x) => `<span class="badge">${esc(x)}</span>`).join('')}
          ${sum.overused ? '<span class="badge badge--overdue">有額度超用</span>' : ''}
        </div>` : ''}
    </a>`;
}

/**
 * 一行一個課程。三段式次數在詳情頁完整呈現，這裡只給細條與剩餘數字 ——
 * 一位客戶四種課程，用詳情頁那種高度會直接吃掉半個螢幕。
 */
function poolLine(p) {
  const w = (n) => `${p.total ? Math.min(100, Math.round((n / p.total) * 100)) : 0}%`;
  return `
    <div class="poolline ${p.remaining <= 2 ? 'poolline--low' : ''}">
      <span class="poolline__label">${esc(p.label)}</span>
      <span class="meter meter--thin"
            role="img" aria-label="共 ${p.total} 次，已完成 ${p.done}，已排未上 ${p.booked}">
        <span class="meter__done" style="width: ${w(p.done)}"></span>
        <span class="meter__booked" style="width: ${w(p.booked)}"></span>
      </span>
      <span class="poolline__n">${p.remaining}</span>
    </div>`;
}

/** 上次來訪、下次預約、購買通路。SPEC 第 8.5 節要求的那幾欄。 */
function metaLine(c, ctx) {
  const seen = ctx.visitsBy[c.id] ?? {};
  const parts = [];
  parts.push(seen.last ? `上次 ${shortDate(seen.last)}` : `${LOOKBACK_DAYS} 天內沒來過`);
  if (seen.next) parts.push(`下次 ${shortDate(seen.next)}`);
  if (c.source) parts.push(c.source);
  return parts.join('・');
}

// ---------- 新增客戶 ----------

export async function renderNew(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let plans;
  let existing;
  let equipment;
  let clinicalFlags;
  let courses;
  let ivProducts;
  let products;
  try {
    // 課程／品項／營養品是底下那一段「加購」要的（同一張表，`components/buy.js`）。
    // 跟另外三份同一趟拿，不多一輪往返。
    [plans, existing, equipment, clinicalFlags, courses, ivProducts, products] =
      await Promise.all([
        config.listAll('plans'), data.list(), config.listAll('equipment'),
        config.listAll('clinicalFlags'),
        config.listAll('courses'), config.listAll('ivProducts'), config.listAll('products'),
      ]);
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
    priority: 0,
    flags: [],
    marks: [],
    planId: null,
    quantity: 1,
    // 方案之外多買的。建立之前都只是草稿，一個字都還沒寫進去。
    extras: [],
  };

  paintNew(el, draft, usable, existing, clinicalTerms(clinicalFlags), {
    courses, equipment, ivProducts, products,
  });
}

// 這幾個欄位一動，畫面上算出來的東西就變了。
//
// **只有「方案」那一排會重畫整頁**，因為選了方案才會多出「購買數量」那一格。
// 另外兩個各自只換一小塊，而那兩塊裡面**沒有任何可以點的東西** ——
// 這一條不是為了省效能，是為了不吃掉她的下一次點擊：
//
// `change` 在**離開欄位的那一刻**才發生，而她離開欄位的方式通常就是去點下一個
// 東西。整頁重畫會在那一下點擊送達之前把目標換掉，於是「打完名字點方案」
// 的第一下永遠沒有反應（ADR-0038 講的是同一件事）。
const RECOMPUTE_ON = ['planId', 'quantity', 'name'];

/**
 * 買了幾份方案。**0 是合法的** —— 她的原話是「購買方案的數量可以是0，
 * 因為有人會單買加購的療程」。
 *
 * 0 不等於「不選方案」：她選了方案又打 0，畫面要承認她做了這件事
 *（預覽那一塊會講出來），而不是偷偷把方案清掉。
 */
const planQuantity = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
};

function paintNew(el, draft, plans, existing, alerts, master) {
  const plan = plans.find((p) => p.id === draft.planId) ?? null;
  const qty = planQuantity(draft.quantity);
  const preview = qty > 0 ? expandPlan(plan, qty) : [];

  el.innerHTML = `
    <a class="backlink" href="#/customers" data-back>${icon('left', { size: 17 })}客戶</a>
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
        ${f.date({ name: 'purchasedAt', label: '購買日', value: draft.purchasedAt })}
        ${f.chips({
          name: 'priority', label: '喜好程度', value: String(draft.priority),
          options: priorityOptions(),
          hint: '0 代表還沒評。',
        })}
        <div data-flags></div>

        <div class="fieldgroup">
          <span class="fieldgroup__label">備註　客戶臨時提的小事，顏色自己分</span>
          <div data-marks></div>
        </div>

        <h3 class="card__title" style="margin-top: var(--space-5)">買了什麼</h3>
        ${f.chips({
          name: 'planId', label: '方案', value: draft.planId,
          options: [{ value: null, label: '不選方案' },
                    ...plans.map((p) => ({ value: p.id, label: p.name }))],
          hint: '之後改範本不會動到這位客戶。',
        })}
        ${plan ? f.number({ name: 'quantity', label: '購買數量', value: draft.quantity, min: 1 }) : ''}

        <div data-preview>${previewHtml(plan, preview, qty)}</div>
        ${extrasHtml(draft.extras)}
        <div data-warnings>${warningsHtml(draftToCustomer(draft), existing)}</div>

        <div class="form__actions">
          <button class="btn btn--primary" type="submit">建立客戶</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>`;

  const leave = () => goBack('/customers');
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    leave();
  });
  el.querySelector('[data-cancel]').addEventListener('click', leave);

  const form = el.querySelector('[data-form]');

  marksUi.mount(el.querySelector('[data-marks]'), {
    marks: draft.marks,
    onChange: (list) => {
      draft.marks = list;
    },
  });

  flagsUi.mount(el.querySelector('[data-flags]'), {
    flags: draft.flags,
    alerts,
    onChange: (list) => {
      draft.flags = list;
    },
  });

  // 丸子換掉了方案與喜好程度那兩個下拉。掛在 `form` 上就好 ——
  // 它每次重畫都會被換掉，沒有人需要記得拆它。
  f.wireChips(form);

  const repaint = (next) => paintNew(el, next, plans, existing, alerts, master);
  const swap = (sel, html) => {
    const box = el.querySelector(sel);
    if (box) box.innerHTML = html;
  };

  form.addEventListener('change', (e) => {
    if (!RECOMPUTE_ON.includes(e.target.name)) return;
    const next = { ...draft, ...f.readForm(form) };
    Object.assign(draft, next);

    // 方案換了才重畫整頁：選了方案才會多出「購買數量」那一格
    if (e.target.name === 'planId') {
      repaint(next);
      return;
    }
    const nextPlan = plans.find((p) => p.id === next.planId) ?? null;
    const nextQty = planQuantity(next.quantity);
    if (e.target.name === 'quantity') {
      swap('[data-preview]', previewHtml(nextPlan, nextQty > 0 ? expandPlan(nextPlan, nextQty) : [], nextQty));
    } else {
      swap('[data-warnings]', warningsHtml(draftToCustomer(next), existing));
    }
  });

  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-addextra]')) {
      // 面板裡改的是它自己的草稿，按「加進來」才回到這一頁的名單上
      openBuySheet(master, (item) => repaint({
        ...draft, ...f.readForm(form), extras: [...draft.extras, item],
      }));
      return;
    }
    const drop = e.target.closest('[data-dropextra]');
    if (drop) {
      const at = Number(drop.dataset.dropextra);
      repaint({
        ...draft,
        ...f.readForm(form),
        extras: draft.extras.filter((_, i) => i !== at),
      });
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = { ...draft, ...f.readForm(form) };
    const customer = draftToCustomer(values);

    const errors = [...rules.validate(customer), ...validateMarks(values.marks)];
    f.showErrors(el, errors);
    if (errors.length) return;

    const quantity = planQuantity(values.quantity);
    // 數量 0 就不展開方案。**不是把方案清掉** —— 展開 0 次會建出一串
    // 總次數是 0 的額度，而那幾筆之後只會在她的畫面上礙事。
    const chosen = quantity > 0 ? (plans.find((p) => p.id === values.planId) ?? null) : null;

    try {
      const id = await toast.withSaveState(
        () => data.createWithPlan(customer, {
          plan: chosen,
          quantity,
          // 加購跟方案展開的那幾筆走同一個 commit，加購的健檢才配得到二返
          // （ADR-0022，`data/customers.js` 的 `createWithPlan()` 檔頭）。
          extras: values.extras.map(
            (x) => buy.toEntitlement(x, { purchasedAt: customer.purchasedAt ?? null }),
          ),
        }),
        // 連點兩下就是兩位同名客戶，各自展開一整份方案額度。
        { success: '已建立', key: 'customer:create' },
      );
      go(`/customers/${id}`);
    } catch {
      /* withSaveState 已顯示錯誤與重試 */
    }
  });
}

/**
 * 「加購」那一段。跟客戶詳情的加購是**同一張表**（`components/buy.js`），
 * 只是這裡列的是還沒寫進去的草稿 —— 建立之前一個字都還沒進資料庫。
 */
function extrasHtml(extras) {
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">加購　方案之外多買的</span>
      ${extras.length ? `
        <ul class="roster">
          ${extras.map((x, i) => `
            <li class="roster__row">
              <span class="roster__main">
                <span class="roster__name">${esc(x.label || '（沒有名稱）')}</span>
                <span class="roster__note">${esc(x.totalQty ?? 0)} ${esc(buy.unitOf(x))}</span>
              </span>
              <button class="roster__x" type="button" data-dropextra="${i}"
                      aria-label="拿掉">${icon('close', { size: 15, width: 2 })}</button>
            </li>`).join('')}
        </ul>` : '<p class="muted" style="margin: 0 0 var(--space-2)">還沒加購。</p>'}
      <button class="btn btn--sm" type="button" data-addextra>＋ 加一項</button>
    </div>`;
}

/**
 * 加一項的那一張面板。
 *
 * 內容就是 `components/buy.js` 那一張表，所以健檢的「幾萬的」、營養點滴的
 * 「哪一種」、營養品的「幾份」在這裡與客戶詳情長得一模一樣。
 *
 * 沒有「進階設定」：她在建立一位新客戶的時候要的是「再給他三次健檢」，
 * 那七個欄位一年動不到一次，建好之後進詳情頁調（同 `views/customersBulk.js`
 * 的微調面板）。所以這裡沒有顯示名稱那一格 —— 名字一律自動帶。
 */
function openBuySheet(master, onAdd) {
  let item = buy.blank();
  let sheet = null;

  const html = () => `
    <div class="errors" data-errors hidden></div>
    <form data-buyform>${buy.fields(item, master)}</form>`;

  sheet = openSheet({
    title: '加購',
    note: '方案之外多買的。加完可以再加一項。',
    body: html(),
    actions: `
      <button class="btn" type="button" data-sheet-close>取消</button>
      <button class="btn btn--primary" type="button" data-addbuy>加進來</button>`,
    // `update()` 會再呼叫一次 onMount，而監聽掛的是 drawer（它不會被換掉）——
    // 沒有這道旗標，重畫一次就多一組監聽，按「加進來」會一次加兩筆。
    onMount: (drawer) => {
      if (drawer.dataset.buyWired) return;
      drawer.dataset.buyWired = '1';
      f.wireChips(drawer);

      const formOf = () => drawer.querySelector('[data-buyform]');

      // 換丸子、`+1`、在「自己打」那一格打字，四種動作走同一份接線
      // （`components/buy.js`）—— 這裡只回答「哪一塊要重畫」。
      buy.wire(drawer, {
        form: formOf,
        draft: () => item,
        master,
        onChange: (next, { repaint }) => {
          item = next;
          if (repaint) sheet.update(html());
        },
      });

      drawer.addEventListener('click', async (ev) => {
        if (!ev.target.closest('[data-addbuy]')) return;
        const form = formOf();
        if (!form) return;

        // 「＋ 新增…」打的那一款先寫進主檔（三個入口共用同一支）
        const next = await buy.commitNewProduct(
          { ...item, ...buy.values(form) }, master, (row) => config.create('products', row),
        );
        const errors = buy.validate(next, master);
        f.showErrors(drawer, errors);
        if (errors.length) return;
        onAdd(next);
        closeSheet();
      });
    },
  });
}

function priorityOptions() {
  return Array.from({ length: rules.MAX_PRIORITY + 1 }, (_, i) => ({
    value: String(i),
    label: i === 0 ? '0 · 還沒評' : `${i} ${'★'.repeat(i)}`,
  }));
}

/**
 * 會籍到期日刻意不在這張表單裡（ADR-0019）—— 實務上沒有會籍這件事。
 * 欄位本身留在資料上，舊資料照樣讀得到，只是不再有人填它。
 */
function draftToCustomer(d) {
  return {
    name: String(d.name ?? '').trim(),
    phone: String(d.phone ?? '').trim() || null,
    lineId: String(d.lineId ?? '').trim() || null,
    source: String(d.source ?? '').trim() || null,
    purchasedAt: d.purchasedAt || null,
    membershipExpiresAt: null,
    priority: Number(d.priority) || 0,
    flags: d.flags ?? [],
    // marks 與 notes 永遠一起寫，不要有只改到一邊的路徑
    ...toCustomerFields(d.marks),
  };
}

function previewHtml(plan, preview, qty) {
  if (!plan) {
    return `<p class="muted">沒有選方案，底下可以一項一項加購。</p>`;
  }
  // 她選了方案又打 0。**畫面要承認她做了這件事** —— 偷偷把方案當成沒選，
  // 等於她之後永遠不知道那一格為什麼沒有作用。
  if (qty === 0) {
    return `<p class="muted">數量是 0，「${esc(plan.name)}」不會展開任何額度。
      底下的加購還是會建。</p>`;
  }
  if (!preview.length) {
    return `<p class="muted">「${esc(plan.name)}」還沒有任何項目，
      建立後這位客戶會是零額度。先去設定 → 方案範本 補齊項目。</p>`;
  }
  return `
    <div class="card card--flat">
      <h3 class="card__title">會展開這些額度</h3>
      <ul class="muted" style="margin-bottom: 0">
        ${preview
          .map((e) => `<li>${esc(e.label)} <b>${e.totalQty}</b> 次</li>`)
          .join('')}
      </ul>
    </div>`;
}

function warningsHtml(customer, existing) {
  const list = rules.warnings(customer, existing);
  if (!list.length) return '';
  return `
    <div class="card card--flat">
      <h3 class="card__title">提醒</h3>
      <ul class="muted">${list.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p class="muted" style="margin-bottom: 0">這些只是提醒，不會擋著不讓你存。</p>
    </div>`;
}
