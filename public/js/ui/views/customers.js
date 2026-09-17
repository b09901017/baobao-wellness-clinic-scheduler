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
import { summarize, isProduct } from '../../domain/entitlements.js';
import { purchaseHeadline } from '../../domain/purchases.js';
import { customerPools } from '../../domain/scheduling.js';
import { readMarks } from '../../domain/customerMarks.js';
import { clinicalTerms, partnerNames } from '../../domain/masterData.js';
import { isActive } from '../../domain/visits.js';
import { icon } from '../icons.js';
import { todayISO, addDays } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { blankDraft, mountCustomerForm } from '../components/customerForm.js';
import * as marksUi from '../components/marks.js';
import * as flagsUi from '../components/flags.js';
import * as toast from '../toast.js';
import { openCamera } from '../components/camera.js';
import { openOrderConfirm } from '../components/orderConfirm.js';
import { wireLongPress } from '../components/actions.js';
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
  let plans;
  let courses;
  let ivProducts;
  let products;
  let partners;
  try {
    [rows, entsBy, equipment, clinicalFlags, visits, plans, courses, ivProducts, products, partners] = await Promise.all([
      data.list(),
      data.entitlementsByCustomer(),
      config.listAll('equipment'),
      // 臨床提醒（ADR-0064）。跟另外幾份同一趟拿，不多一輪往返。
      config.listAll('clinicalFlags'),
      visitsData.listBetween(addDays(today, -LOOKBACK_DAYS), addDays(today, LOOKAHEAD_DAYS)),
      // 抬頭那一行「買了什麼」要的（`purchaseHeadline()`，ADR-0090）：
      // 方案主檔是套數的退路，課程與品項是簡寫的來源。
      config.listAll('plans'),
      config.listAll('courses'),
      config.listAll('ivProducts'),
      // 拍訂購單（issue 09）：加購那一張表與「單子上的字認出合作機構」要的
      config.listAll('products'),
      config.listAll('partners'),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore Rules 還沒部署，或這個帳號不在白名單裡。</p></div>`;
    return;
  }

  const ctx = {
    rows, entsBy, equipment, clinicalFlags, today, visitsBy: byCustomer(visits, today),
    master: { plans, equipment, courses, ivProducts, products, clinicalFlags, partners },
  };

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
        <button class="fab__item" type="button" data-orderform>
          <span>拍訂購單</span>
          <span class="fab__dot fab__dot--ink">${icon('camera', { size: 18 })}</span>
        </button>
        <button class="fab__item" type="button" data-bulk>
          <span>快速建立一群</span>
          <span class="fab__dot fab__dot--tea">${icon('people', { size: 18 })}</span>
        </button>
        <button class="fab__item" type="button" data-new>
          <span>新增一位</span>
          <span class="fab__dot">${icon('plus', { size: 18, width: 2.2 })}</span>
        </button>
      </div>
      <button class="fab__main" type="button" data-fabtoggle aria-label="新增（長按直接拍訂購單）"
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

  // 拍訂購單（issue 09）：選單那一項是點得到的那條路，長按懸浮鈕是捷徑（ADR-0060）
  const orderForms = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    fab.dataset.open = 'false';
    openCamera({
      kind: 'orderForm',
      max: 10,
      onDone: (photos, { release }) => openOrderConfirm({
        photos,
        release,
        master: ctx.master,
        existing: ctx.rows,
        entsBy: ctx.entsBy,
        // 建好的人要出現在清單上。換頁收掉的（`hashchange`）就不畫 —— 清單是非同步畫的，
        // 畫完會蓋掉新的那一頁
        onFinish: ({ done }) => {
          if (done && /^#\/customers\/?$/.test(window.location.hash)) render(el);
        },
      }),
    });
  };
  el.querySelector('[data-orderform]').addEventListener('click', orderForms);
  wireLongPress(fab, '[data-fabtoggle]', orderForms);
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
  // 名字底下那一行：買了什麼（ADR-0090）。上次／下次 2026-09-13 拿掉了，排序照樣靠 `byCustomer()`
  const meta = purchaseHeadline(c, ents, ctx.master);
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
            ${flagsUi.partnerChips(rules.partnersOf(c))}
            ${c.active === false ? '<span class="badge">已停用</span>' : ''}
          </div>
          ${meta ? `<div class="hero__meta hero__meta--clamp">${esc(meta)}</div>` : ''}
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
  let partners;
  try {
    // 課程／品項／營養品是「加購」要的（同一張表，`components/buy.js`）。
    // 跟另外三份同一趟拿，不多一輪往返。
    [plans, existing, equipment, clinicalFlags, courses, ivProducts, products, partners] =
      await Promise.all([
        config.listAll('plans'), data.list(), config.listAll('equipment'),
        config.listAll('clinicalFlags'),
        config.listAll('courses'), config.listAll('ivProducts'), config.listAll('products'),
        // 合作機構（ADR-0076）
        config.listAll('partners'),
      ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  el.innerHTML = `
    <a class="backlink" href="#/customers" data-back>${icon('left', { size: 17 })}客戶</a>
    <section class="card cform-card">
      <h2 class="card__title">新增客戶</h2>
      <div data-newcustomer></div>
    </section>`;

  const leave = () => goBack('/customers');
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    leave();
  });

  // 表單本體是共用元件（issue 08）：拍訂購單那一層的小鉛筆開的是同一張
  mountCustomerForm(el.querySelector('[data-newcustomer]'), {
    draft: blankDraft(todayISO()),
    plans: plans.filter((p) => p.active !== false),
    existing,
    alerts: clinicalTerms(clinicalFlags),
    master: { courses, equipment, ivProducts, products, partners: partnerNames(partners) },
    onCancel: leave,
    onSubmit: async ({ customer, plan, quantity, extras }) => {
      try {
        const id = await toast.withSaveState(
          // 加購跟方案展開的那幾筆走同一個 commit，加購的健檢才配得到二返
          // （ADR-0022，`data/customers.js` 的 `createWithPlan()` 檔頭）。
          () => data.createWithPlan(customer, { plan, quantity, extras }),
          // 連點兩下就是兩位同名客戶，各自展開一整份方案額度。
          { success: '已建立', key: 'customer:create' },
        );
        go(`/customers/${id}`);
      } catch {
        /* withSaveState 已顯示錯誤與重試 */
      }
    },
  });
}
