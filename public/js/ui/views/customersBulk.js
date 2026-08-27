// 一次建立一群客戶。`.scratch/bulk-customer-create/issues/01`。
//
// 一場顧客會來了八位，她們的購買通路、購買日、方案全都一樣，只有姓名不一樣。
// 這一頁的形狀是一句話：**共用的填一次，不一樣的才微調。**
//
// 規則全部在 `domain/bulkCustomers.js`，這裡只負責畫與接事件。
// 微調面板裡的「加購」是 `components/buy.js` 那一張表，跟客戶詳情的「加購」與
// 新增客戶那一頁的「加一項」是同一張 —— 這一頁比那一支早兩天寫，所以它曾經
// 有自己的一張（`.scratch/buying-in-bulk/issues/01`）。
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
import * as buy from '../components/buy.js';
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
  let ivProducts;
  let products;
  try {
    // 品項與營養品是微調面板裡那一張加購表要的（同一張，`components/buy.js`）。
    // 跟另外四份同一趟拿，不多一輪往返。
    [plans, existing, courses, equipment, ivProducts, products] = await Promise.all([
      config.listAll('plans'),
      data.list(),
      config.listAll('courses'),
      config.listAll('equipment'),
      config.listAll('ivProducts'),
      config.listAll('products'),
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
    products,
    // 加購那一張表吃的就是這個形狀（`components/buy.js`）
    master: { courses: alive, equipment, ivProducts, products },
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
  products: state.products,
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
  // 「8萬健檢 1 次」「夜態美 2 份」—— 論次還是論份只寫在 `buy.unitOf()`
  for (const x of row.extras ?? []) parts.push(`加購 ${buy.summaryLine(x)}`);
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
              <span class="badge">${r.count} 筆・${amountText(r)}</span>
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
 * 一位身上會長出多少東西。**營養品論份，其餘論次**（ADR-0057）——
 * 兩種單位不可以加成同一個數字，那個數字看起來像「還要排幾次」。
 * 一份都沒買就不講「0 份」。
 */
function amountText(r) {
  const parts = [];
  if (r.total || !r.products) parts.push(`共 ${r.total} 次`);
  if (r.products) parts.push(`${r.products} 份`);
  return parts.join('・');
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
 * **加購那一段就是 `components/buy.js` 那一張表**，跟客戶詳情的「加購」與
 * 新增客戶那一頁的「加一項」一模一樣 —— 所以健檢選得到「幾萬的」、
 * 營養點滴選得到品項、營養品也在那一排丸子上。這一頁以前有自己的一張
 * （一個下拉選單挑課程、一格數字），那是它比 `components/buy.js` 早兩天寫的
 * 遺跡（`.scratch/buying-in-bulk/issues/01`）。
 *
 * **進階設定那七個欄位仍然不在這裡**（型態／顯示名稱／時長／頻率／到期日…）。
 * 那張是給「這筆額度長得跟任何範本都不一樣」用的，而她在這裡要的是
 * 「再給他三次健檢」。真的要調那七欄，客戶建好之後進詳情頁調。
 */
function openTune(key) {
  const row = state.rows.find((r) => r.key === key);
  if (!row) return;

  // 面板上改的是複本，按「好了」才寫回去 —— 拖下去關掉等於取消。
  // `adding` 是「加一項」那一張還沒按下「加進來」的草稿，null = 沒在加。
  const panel = { draft: { ...row, extras: [...(row.extras ?? [])] }, adding: null };

  // `openSheet()` **同步**呼叫 onMount（在它回傳之前），所以那裡面拿不到
  // 它的回傳值 —— 寫成 `const sheet = openSheet({ onMount: () => …sheet… })`
  // 會當場 TDZ 爆掉。改成先宣告，重畫時才去讀它。
  tuneSheet = openSheet({
    title: row.name,
    note: '沒動的就是跟大家一樣。',
    body: tuneHtml(panel),
    actions: `<button class="btn btn--primary btn--wide" type="button" data-apply>好了</button>`,
    // update() 會再呼叫一次 onMount，而監聽掛的是 drawer（它不會被換掉）——
    // 沒有這道旗標，重畫一次就多一組監聽，按「加進來」會一次加兩筆。
    onMount: (drawer) => {
      if (drawer.dataset.tuneWired) return;
      drawer.dataset.tuneWired = '1';
      wireTune(drawer, panel);
    },
    onClose: () => {
      tuneSheet = null;
    },
  });
}

/** 微調面板本人。重畫時要用到，而 onMount 的時候它還不存在（見上面）。 */
let tuneSheet = null;

function tuneHtml({ draft, adding }) {
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
        <input type="number" data-rowqty min="1" step="1"
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
                <span class="roster__name">${esc(x.label || '（沒有名稱）')}</span>
                <span class="roster__note">${esc(x.totalQty ?? 0)} ${esc(buy.unitOf(x))}</span>
              </span>
              <button class="roster__x" type="button" data-dropextra="${i}"
                      aria-label="拿掉">${icon('close', { size: 15, width: 2 })}</button>
            </li>`).join('')}
        </ul>` : '<p class="muted" style="margin: 0 0 var(--space-2)">還沒加購。</p>'}

      ${adding ? `
        <div class="card card--flat">
          <div class="errors" data-errors hidden></div>
          <form data-buyform>${buy.fields(adding, state.master)}</form>
          <div class="form__actions">
            <button class="btn btn--primary" type="button" data-addbuy>加進來</button>
            <button class="btn" type="button" data-cancelbuy>取消</button>
          </div>
        </div>`
      : '<button class="btn btn--sm" type="button" data-addextra>＋ 加一項</button>'}
    </div>`;
}

function wireTune(drawer, panel) {
  const repaint = () => {
    tuneSheet?.update(tuneHtml(panel));
  };
  const buyForm = () => drawer.querySelector('[data-buyform]');

  // 加購那一張表的四種動作（換丸子、`+1`、在「自己打」那一格打字）全部
  // 走 `components/buy.js` 的同一份接線 —— 這裡只回答「哪一塊要重畫」。
  f.wireChips(drawer);
  buy.wire(drawer, {
    form: buyForm,
    draft: () => panel.adding ?? buy.blank(),
    master: state.master,
    onChange: (next, { repaint: redraw }) => {
      panel.adding = next;
      if (redraw) repaint();
    },
  });

  drawer.addEventListener('change', (e) => {
    if (e.target.matches('[data-useplan]')) {
      panel.draft.usePlan = e.target.checked;
      // 不套方案時那個數量沒有意義，清掉不要留一個看不到卻還在的值
      if (!panel.draft.usePlan) panel.draft.quantity = null;
      repaint();
    }
  });

  drawer.addEventListener('input', (e) => {
    // 這一格是**她這一位的購買數量**，不是加購那一張表的「幾次」。
    // 兩個以前都叫 `data-qty`，而加購那一張表的 `+1` 是照著那個名字找欄位的。
    if (e.target.matches('[data-rowqty]')) {
      const v = e.target.value.trim();
      panel.draft.quantity = v === '' ? null : Number(v);
    }
  });

  // 加購那一張表沒有送出鈕，但它是一個 `<form>` —— 在數量那一格按 Enter
  // 會觸發瀏覽器的隱含送出，而那會整頁重載。接成「加進來」。
  drawer.addEventListener('submit', (e) => {
    e.preventDefault();
    if (panel.adding) addBuy(drawer, panel, repaint);
  });

  drawer.addEventListener('click', (e) => {
    const drop = e.target.closest('[data-dropextra]');
    if (drop) {
      panel.draft.extras.splice(Number(drop.dataset.dropextra), 1);
      repaint();
      return;
    }

    if (e.target.closest('[data-addextra]')) {
      panel.adding = buy.blank();
      repaint();
      return;
    }

    if (e.target.closest('[data-cancelbuy]')) {
      panel.adding = null;
      repaint();
      return;
    }

    if (e.target.closest('[data-addbuy]')) {
      addBuy(drawer, panel, repaint);
      return;
    }

    if (e.target.closest('[data-apply]')) {
      const row = state.rows.find((r) => r.key === panel.draft.key);
      if (row) Object.assign(row, {
        usePlan: panel.draft.usePlan,
        quantity: panel.draft.quantity,
        extras: panel.draft.extras,
      });
      state.run = null;
      closeSheet();
      paintRoster();
      paintSummary();
    }
  });
}

/**
 * 「加進來」。存進名單的是**一筆整理好的額度**，不是畫面上那張草稿 ——
 * 草稿上有 `tierOther` 這種只有畫面在用的欄位，留著它會一路寫進 Firestore。
 * 購買日留 null，`extrasFor()` 那一刻才蓋上整批的那一天。
 */
async function addBuy(drawer, panel, repaint) {
  const form = drawer.querySelector('[data-buyform]');
  if (!form) return;

  // 「＋ 新增…」打的那一款先寫進主檔（三個入口共用同一支）
  const next = await buy.commitNewProduct(
    { ...panel.adding, ...buy.values(form) }, state.master, (row) => config.create('products', row),
  );
  const errors = buy.validate(next, state.master);
  if (errors.length) {
    // 不重畫：重畫會把剛剛印上去的那幾句話換掉
    panel.adding = next;
    f.showErrors(drawer, errors);
    return;
  }

  panel.draft.extras.push(buy.toEntitlement(next));
  panel.adding = null;
  repaint();
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
        extras: extrasFor(row, state.shared),
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
