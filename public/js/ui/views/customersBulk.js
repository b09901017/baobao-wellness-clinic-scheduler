// 一次建立一群客戶。`.scratch/bulk-customer-create/issues/01`。
//
// 一場顧客會來了八位，她們的購買通路、購買日、方案全都一樣，只有姓名不一樣。
// 這一頁的形狀是一句話：**共用的填一次，不一樣的才微調。**
//
// 規則全部在 `domain/bulkCustomers.js`，這裡只負責畫與接事件。
//
// ## 這一頁為什麼分成三塊各自重畫
//
// 中間那個輸入框是她一直在打字的地方 —— 整頁重畫會把游標與輸入法的組字狀態
// 一起洗掉，而她一批要打八個名字。所以：
//
// - **共用欄位那一塊從頭到尾不重畫。** 值收在 `state.shared` 裡，
//   `input` 事件直接改它，DOM 上那幾個 input 一直是同一個節點。
// - **名單與摘要各自重畫**（`[data-roster]` / `[data-summary]`）。
// - 事件用委派掛在整頁上，所以重畫之後不必重掛。
//
// 跟壓表那一頁同一個判斷（ADR-0038），理由也一樣：她在這一頁要連點很多下。

import * as data from '../../data/customers.js';
import * as config from '../../data/config.js';
import {
  parseNames, newRow, isAdjusted, duplicatesOf, quantityFor,
  extrasFor, customerFor, summarizeRoster, validateRoster, rosterWarnings,
} from '../../domain/bulkCustomers.js';
import { todayISO } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';
import { go } from '../router.js';
import { back } from '../nav.js';

const esc = f.esc;

/** 這一批的狀態。留在模組層是因為畫面是一塊一塊重畫的（見檔頭）。 */
let state = null;

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let plans;
  let existing;
  let courses;
  let equipment;
  try {
    [plans, existing, courses, equipment] = await Promise.all([
      config.listAll('plans'),
      data.list(),
      config.listAll('courses'),
      config.listAll('equipment'),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  const usable = plans.filter((p) => p.active !== false);
  const alive = courses.filter((c) => !c.deletedAt && c.active !== false);

  state = {
    el,
    plans: usable,
    existing,
    courses: alive,
    coursesById: Object.fromEntries(alive.map((c) => [c.id, c])),
    equipment,
    shared: {
      source: '',
      purchasedAt: todayISO(),
      planId: usable[0]?.id ?? null,
      quantity: 1,
    },
    rows: [],
    // 建立進行中的狀態。null 代表還沒開始。
    run: null,
  };

  paint();
}

const ctxOf = () => ({
  plan: state.plans.find((p) => p.id === state.shared.planId) ?? null,
  coursesById: state.coursesById,
  equipment: state.equipment,
});

// ---------- 整頁 ----------

function paint() {
  const { el, shared } = state;

  el.innerHTML = `
    <a class="backlink" href="#/customers" data-back>${icon('left', { size: 17 })}客戶</a>

    <div class="page">
      <h1 class="page__title">快速建立一群</h1>
      <p class="page__lead">同一場顧客會的一群人。共用的填一次，不一樣的才微調。</p>
    </div>

    <div data-page>
      <details class="card" data-shared open>
        <summary class="sharedhead">
          <span class="sharedhead__title">這一批共同的</span>
          <span class="sharedhead__digest" data-digest></span>
        </summary>
        ${f.text({
          name: 'source', label: '購買通路', value: shared.source,
          placeholder: '0522 顧客會-8', hint: '舊試算表 B2 那一欄。整批同一個。',
        })}
        ${f.date({ name: 'purchasedAt', label: '購買日', value: shared.purchasedAt })}
        ${f.select({
          name: 'planId', label: '方案', value: shared.planId,
          options: [{ value: null, label: '不套方案（每個人自己加購）' },
            ...state.plans.map((p) => ({ value: p.id, label: p.name }))],
        })}
        ${f.number({ name: 'quantity', label: '購買數量', value: shared.quantity, min: 1 })}
      </details>

      <section class="card">
        <h2 class="card__title">有誰 <span class="muted" data-count>0</span></h2>
        <div class="rosteradd">
          <input type="text" data-name placeholder="打名字按 Enter"
                 aria-label="加一位客戶" autocomplete="off" enterkeyhint="done" />
          <button class="btn" type="button" data-add>加入</button>
        </div>
        <p class="card__note">一次貼一串也可以 —— 換行、逗號、頓號都會自己拆開。</p>
        <div data-roster></div>
      </section>

      <div data-summary></div>
    </div>`;

  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back('/customers');
  });

  wireShared();
  wirePage();
  paintRoster();
  paintSummary();
  paintDigest();
}

/**
 * 收起來時那一行摘要（`0522 顧客會-8・8/23・筋骨強身 ×1`）。
 *
 * 只改 textContent，**不重畫那一塊** —— 底下那幾個 input 一旦被換掉，
 * 她打到一半的字與輸入法的組字狀態就沒了。
 */
function paintDigest() {
  const box = state.el.querySelector('[data-digest]');
  if (!box) return;

  const { shared } = state;
  const plan = ctxOf().plan;
  const qty = Number(shared.quantity) || 1;
  const parts = [
    shared.source || '沒填通路',
    shared.purchasedAt ? shared.purchasedAt.slice(5).replace('-', '/') : '沒填購買日',
    plan ? `${plan.name}${qty > 1 ? ` ×${qty}` : ''}` : '不套方案',
  ];
  box.textContent = parts.join('・');
}

/**
 * 共用欄位。**這一塊從頭到尾不重畫** —— 她在購買通路那一欄打到一半時，
 * 加一個名字不可以把她的字或輸入法的組字狀態洗掉。
 */
function wireShared() {
  const { el, shared } = state;
  const form = el.querySelector('[data-page]');

  form.addEventListener('input', (e) => {
    const name = e.target.name;
    if (!['source', 'purchasedAt', 'quantity'].includes(name)) return;
    shared[name] = name === 'quantity' ? Number(e.target.value) : e.target.value;
    paintDigest();
    // 數量會改變「會建立什麼」，但不改變名單本身
    if (name === 'quantity') paintSummary();
  });

  form.addEventListener('change', (e) => {
    if (e.target.name !== 'planId') return;
    // f.select() 把 null 那個選項的 value 寫成 '__null__'（見 components/form.js）
    shared.planId = e.target.value === '__null__' ? null : (e.target.value || null);
    paintDigest();
    paintSummary();
  });
}

// ---------- 名單 ----------

function paintRoster() {
  const { el, rows } = state;
  const box = el.querySelector('[data-roster]');
  const count = el.querySelector('[data-count]');
  if (count) count.textContent = String(rows.length);
  if (!box) return;

  if (!rows.length) {
    box.innerHTML = `<p class="muted" style="margin: var(--space-3) 0 0">
      還沒有人。上面打一個名字，或直接把 LINE 上那串貼進去。</p>`;
    return;
  }

  const dup = duplicatesOf(rows, state.existing);
  box.innerHTML = `<ul class="roster">${rows.map((r) => rosterRow(r, dup.get(r.key))).join('')}</ul>`;
}

function rosterRow(row, dup) {
  return `
    <li class="roster__row">
      <span class="roster__main">
        <span class="roster__name">${esc(row.name)}</span>
        ${isAdjusted(row) ? `<span class="roster__note">${esc(adjustedLabel(row))}</span>` : ''}
        ${dup ? `<span class="roster__warn">${icon('alert', { size: 13 })}${esc(dupText(dup))}</span>` : ''}
      </span>
      <button class="chip chip--sm" type="button" data-tune="${esc(row.key)}"
              aria-pressed="${isAdjusted(row)}">微調</button>
      <button class="roster__x" type="button" data-drop="${esc(row.key)}"
              aria-label="拿掉 ${esc(row.name)}">${icon('close', { size: 15, width: 2 })}</button>
    </li>`;
}

/**
 * 微調過的那一列多寫一行字。**沒動過的什麼都不寫** ——
 * 「跟大家一樣」是預設，而預設不需要標籤：八列各掛一個「跟大家一樣」，
 * 那一頁就只剩下那八個標籤看得到。
 */
function adjustedLabel(row) {
  const parts = [];
  if (!row.usePlan) parts.push('不套方案');
  if (row.quantity != null) parts.push(`數量 ${row.quantity}`);
  for (const x of row.extras ?? []) {
    parts.push(`加購 ${state.coursesById[x.courseId]?.name ?? '?'} ${x.qty}`);
  }
  return parts.join('・');
}

function dupText(dup) {
  const parts = [];
  if (dup.existing) parts.push(`已經有 ${dup.existing} 位叫這個名字`);
  if (dup.inList) parts.push('這張名單裡重複了');
  return `${parts.join('，')} —— 確認不是同一個人`;
}

// ---------- 會建立什麼 ----------

function paintSummary() {
  const { el, rows } = state;
  const box = el.querySelector('[data-summary]');
  if (!box) return;

  if (!rows.length) {
    box.innerHTML = '';
    return;
  }

  const ctx = ctxOf();
  const s = summarizeRoster(rows, state.shared, ctx);
  const warnings = rosterWarnings(rows, state.shared, ctx);
  const run = state.run;

  box.innerHTML = `
    <section class="card">
      <h2 class="card__title">會建立
        <span class="num">${s.people}</span> 位・<span class="num">${s.entitlements}</span> 筆額度</h2>

      <details class="foldout">
        <summary>一位一位看</summary>
        <ul class="roster">
          ${s.rows.map((r) => `
            <li class="roster__row">
              <span class="roster__main"><span class="roster__name">${esc(r.name)}</span></span>
              <span class="badge">${r.count} 筆・共 ${r.total} 次</span>
            </li>`).join('')}
        </ul>
      </details>

      ${warnings.length ? `
        <div class="card card--flat">
          <h3 class="card__title">提醒</h3>
          <ul class="muted">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
          <p class="muted" style="margin-bottom: 0">這些只是提醒，不會擋著不讓你建。</p>
        </div>` : ''}

      <div class="errors" data-errors hidden></div>

      ${run ? runHtml(run) : `
        <button class="btn btn--primary btn--wide" type="button" data-create>
          建立 ${s.people} 位</button>`}
    </section>`;
}

/**
 * 建立到一半的樣子。
 *
 * 中間有一位失敗就停下來，而且**已經建好的不退回去** —— 那幾位是真的客戶了，
 * 把她們刪掉是拿一個「資料乾淨」的錯覺去換掉真實的資料，
 * 而這個 repo 的第一條規矩是永不硬刪除（SPEC 第 6.1 節）。
 * 還沒建的那幾位留在名單上，直接按一次就繼續。
 */
function runHtml(run) {
  if (run.state === 'running') {
    return `<p class="muted">建立中… ${run.done} / ${run.total}</p>`;
  }
  if (run.state === 'failed') {
    return `
      <div class="warn warn--hard">
        ${icon('alert', { size: 18 })}
        <span>已經建立 <b>${run.done}</b> 位。<b>${esc(run.failedName)}</b> 失敗了：
          ${esc(run.message)}<br />還沒建立的那幾位留在名單上，處理完再按一次就繼續。</span>
      </div>
      <button class="btn btn--primary btn--wide" type="button" data-create>
        繼續建立剩下的</button>`;
  }
  return `<p class="muted">建好了 ${run.done} 位。</p>`;
}

// ---------- 事件 ----------

function wirePage() {
  const page = state.el.querySelector('[data-page]');

  page.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) return addFromInput();
    if (e.target.closest('[data-create]')) return createAll();

    const drop = e.target.closest('[data-drop]');
    if (drop) return dropRow(drop.dataset.drop);

    const tune = e.target.closest('[data-tune]');
    if (tune) return openTune(tune.dataset.tune);
    return null;
  });

  const input = page.querySelector('[data-name]');

  // Enter 就加一位。**要擋掉輸入法組字中的那一下** ——
  // 中文輸入法選字時按 Enter 是「確定這個字」，不是「送出」，
  // 沒擋的話她每打一個中文名字就會多出一列半成品。
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    addFromInput();
  });

  // 貼一串進來就當場拆開。她的名單在 LINE 上，
  // 貼完還要自己一個一個按 Enter 就等於沒省到事。
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/[\n\r,，、;；\t]/.test(text)) return;
    e.preventDefault();
    addNames(parseNames(text));
  });
}

function addFromInput() {
  const input = state.el.querySelector('[data-name]');
  addNames(parseNames(input.value));
}

function addNames(names) {
  if (!names.length) return;

  // 加第一個名字就把共用那一塊收起來。**這是收起來的自然時機** ——
  // 她接下來只會打名字，而那一塊在手機上佔掉大半頁。
  // 收在這裡而不是「失焦就收」：失焦會在她還在填的時候收掉，那是搶她的東西。
  if (!state.rows.length) {
    const shared = state.el.querySelector('[data-shared]');
    if (shared) shared.open = false;
  }

  state.rows.push(...names.map((n) => newRow(n)));
  // 加了人就等於這一批重新開始 —— 上一次跑到一半的結果不再適用
  state.run = null;

  const input = state.el.querySelector('[data-name]');
  input.value = '';
  paintRoster();
  paintSummary();
  // 焦點留在輸入框：她的下一個動作是打下一個名字，不是找輸入框
  input.focus();
}

function dropRow(key) {
  state.rows = state.rows.filter((r) => r.key !== key);
  state.run = null;
  paintRoster();
  paintSummary();
}

// ---------- 微調那一張面板 ----------

/**
 * 一位客戶一張。只有三件事：數量、要不要套方案、加購。
 *
 * **不用客戶詳情頁那張額度表單**（型態／顯示名稱／總次數／時長／課程／頻率／
 * 到期日，七個欄位）。那張是給「這筆額度長得跟任何範本都不一樣」用的，
 * 而她在這裡要的是「再給他三次健檢」。真的要調那七欄，
 * 客戶建好之後進詳情頁調 —— 那是一年兩次的事，不該讓它把這一頁弄雜。
 */
function openTune(key) {
  const row = state.rows.find((r) => r.key === key);
  if (!row) return;

  // 面板上改的是複本，按「好了」才寫回去 —— 拖下去關掉等於取消
  const draft = { ...row, extras: [...(row.extras ?? [])] };

  // `openSheet()` **同步**呼叫 onMount（在它回傳之前），所以那裡面拿不到
  // 它的回傳值 —— 寫成 `const sheet = openSheet({ onMount: () => …sheet… })`
  // 會當場 TDZ 爆掉。改成先宣告，重畫時才去讀它。
  tuneSheet = openSheet({
    title: row.name,
    note: '沒動的就是跟大家一樣。',
    body: tuneHtml(draft),
    actions: `<button class="btn btn--primary btn--wide" type="button" data-apply>好了</button>`,
    // update() 會再呼叫一次 onMount，而監聽掛的是 drawer（它不會被換掉）——
    // 沒有這道旗標，重畫一次就多一組監聽，按「加」會一次加兩筆。
    onMount: (drawer) => {
      if (drawer.dataset.tuneWired) return;
      drawer.dataset.tuneWired = '1';
      wireTune(drawer, draft);
    },
    onClose: () => {
      tuneSheet = null;
    },
  });
}

/** 微調面板本人。重畫時要用到，而 onMount 的時候它還不存在（見上面）。 */
let tuneSheet = null;

function tuneHtml(draft) {
  const batchQty = quantityFor({ quantity: null }, state.shared);
  const plan = ctxOf().plan;

  return `
    <label class="choice choice--row">
      <input type="checkbox" data-useplan ${draft.usePlan ? 'checked' : ''} />
      <span>套用${plan ? `「${esc(plan.name)}」` : '整批的方案'}</span>
    </label>
    ${plan ? '' : '<p class="muted">這一批沒有選方案，所以只能靠底下的加購。</p>'}

    ${draft.usePlan && plan ? `
      <label class="field">
        <span class="field__label">購買數量　整批是 ${batchQty}</span>
        <input type="number" data-qty min="1" step="1"
               value="${draft.quantity ?? ''}" placeholder="${batchQty}" />
        <span class="field__hint">留空就跟大家一樣。</span>
      </label>` : ''}

    <div class="fieldgroup">
      <span class="fieldgroup__label">加購　方案之外多買的</span>
      ${draft.extras.length ? `
        <ul class="roster">
          ${draft.extras.map((x, i) => `
            <li class="roster__row">
              <span class="roster__main">
                <span class="roster__name">${esc(state.coursesById[x.courseId]?.name ?? '?')}</span>
                <span class="roster__note">${x.qty} 次</span>
              </span>
              <button class="roster__x" type="button" data-dropextra="${i}"
                      aria-label="拿掉">${icon('close', { size: 15, width: 2 })}</button>
            </li>`).join('')}
        </ul>` : '<p class="muted" style="margin: 0 0 var(--space-2)">還沒加購。</p>'}

      <div class="rosteradd">
        <select data-extracourse aria-label="加購哪一個課程" style="flex: 1; min-width: 0">
          ${state.courses.map((c) => `
            <option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
        </select>
        <input type="number" data-extraqty min="1" step="1" value="1"
               aria-label="幾次" style="width: 5.5em" />
        <button class="btn" type="button" data-addextra>加</button>
      </div>
    </div>`;
}

function wireTune(drawer, draft) {
  const repaint = () => {
    tuneSheet?.update(tuneHtml(draft));
  };

  drawer.addEventListener('change', (e) => {
    if (e.target.matches('[data-useplan]')) {
      draft.usePlan = e.target.checked;
      // 不套方案時那個數量沒有意義，清掉不要留一個看不到卻還在的值
      if (!draft.usePlan) draft.quantity = null;
      repaint();
    }
  });

  drawer.addEventListener('input', (e) => {
    if (e.target.matches('[data-qty]')) {
      const v = e.target.value.trim();
      draft.quantity = v === '' ? null : Number(v);
    }
  });

  drawer.addEventListener('click', (e) => {
    const drop = e.target.closest('[data-dropextra]');
    if (drop) {
      draft.extras.splice(Number(drop.dataset.dropextra), 1);
      repaint();
      return;
    }

    if (e.target.closest('[data-addextra]')) {
      const courseId = drawer.querySelector('[data-extracourse]')?.value;
      const qty = Number(drawer.querySelector('[data-extraqty]')?.value) || 1;
      if (courseId) draft.extras.push({ courseId, qty });
      repaint();
      return;
    }

    if (e.target.closest('[data-apply]')) {
      const row = state.rows.find((r) => r.key === draft.key);
      if (row) Object.assign(row, {
        usePlan: draft.usePlan, quantity: draft.quantity, extras: draft.extras,
      });
      state.run = null;
      closeSheet();
      paintRoster();
      paintSummary();
    }
  });
}

// ---------- 建立 ----------

/**
 * 一位一個 commit（`createWithPlan()` 本身是原子的），一位一位建。
 *
 * 不用一個大 batch：一位失敗全部退回，等於她八個名字白打；
 * 而且 Firestore 的 batch 有筆數上限，八位乘上七筆額度就快到了。
 */
async function createAll() {
  const ctx = ctxOf();
  const errors = validateRoster(state.rows, state.shared, ctx);
  f.showErrors(state.el, errors);
  if (errors.length) return;

  const pending = [...state.rows];
  state.run = { state: 'running', done: 0, total: pending.length };
  paintSummary();

  for (const row of pending) {
    try {
      await data.createWithPlan(customerFor(row, state.shared), {
        plan: row.usePlan ? ctx.plan : null,
        quantity: quantityFor(row, state.shared),
        // 加購跟方案展開的那幾筆走同一個 commit，二返才配得到（ADR-0022）
        extras: extrasFor(row, state.shared, ctx),
      });
    } catch (err) {
      state.run = {
        state: 'failed',
        done: state.run.done,
        total: pending.length,
        failedName: row.name,
        message: err?.message ?? '不知道為什麼',
      };
      paintRoster();
      paintSummary();
      return;
    }

    // 建好的從名單上拿掉：失敗時剩下的就是「還沒建的」，按一次就繼續
    state.rows = state.rows.filter((r) => r.key !== row.key);
    state.run.done += 1;
    paintRoster();
    paintSummary();
  }

  toast.info(`建好了 ${pending.length} 位`);
  go('/customers');
}
