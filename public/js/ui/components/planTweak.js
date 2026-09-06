// 「加購一整個方案」那一張面板，連同確認前的微調。
//
// 她的原話（2026-09-06）：
//
// > 客戶詳情那邊的加購可以加購一整個方案
//
// > 我希望方案也可以微調，就是這個客戶的某個方案中的例如復能三選一(60)少幾次
// > 然後換成其他的之類的，這個不常發生，但是就是可以如果我加購方案，
// > 可以微調這個方案
//
// ## 微調只有兩件事
//
//   改次數    每一項一個 [−] N [＋]。**改成 0 就是不要那一項**
//   加項目    底下一顆「加一項」，開的就是 `components/buy.js` 那一張表
//
// 「少幾次然後換成其他的」是**兩步**：把復能改成 15、再加一項 5 次 INDIBA(30)。
// 做成一個「換」的動作要她先想清楚換的是什麼，而分兩步她每一步都看得到結果。
//
// 改成 0 不用另外一顆垃圾桶：`[−]` 按到 0 就是同一個意思，
// 而多一顆刪除鈕等於多一種要學的操作。
//
// ## 範本一個字都不會變
//
// ADR-0003：額度是展開當下的完整複本，跟範本脫鉤。微調只活在這一次購買上，
// 所以面板上要有一句話講清楚 —— 收起來的東西不能安靜地生效。
//
// ## 上半段沒有一行碰 DOM
//
// 跟 `components/buy.js` 同一個分法：`tests/plan-tweak.test.js` 盯上半段，
// 下半段的 `wire()` 薄到只剩「讀表單 → 叫上半段 → 交給呼叫端重畫」。

import * as f from './form.js';
import * as buy from './buy.js';
import { expandPlan, applyPlanTweak } from '../../domain/entitlements.js';

/** 一張空白的草稿。 */
export function blank(plans = []) {
  return {
    planId: (plans ?? []).find((p) => !p.deletedAt && p.active !== false)?.id ?? null,
    quantity: 1,
    // 第幾項 → 改成幾次。**只記她動過的那幾項** —— 全部記下來的話，
    // 之後換一個方案時舊的數字會蓋到新方案的項目上。
    qtyByIndex: {},
    // 方案之外多加的那幾筆（`components/buy.js` 吐的草稿形狀）
    extras: [],
    // 「加一項」那一張表現在的草稿。null = 沒開著。
    adding: null,
  };
}

/** 她選的那一張範本。 */
export const planOf = (draft, plans = []) =>
  (plans ?? []).find((p) => p.id === draft?.planId) ?? null;

/** 展開之後、還沒套微調的那幾筆。畫面上那一排就是它。 */
export function rowsOf(draft, plans = []) {
  const plan = planOf(draft, plans);
  const qty = Number(draft?.quantity) || 0;
  return plan && qty > 0 ? expandPlan(plan, qty) : [];
}

/** 第 i 項現在是幾次。她沒動過就是方案本來的。 */
export function qtyAt(draft, rows, i) {
  const map = draft?.qtyByIndex ?? {};
  return i in map ? map[i] : (rows[i]?.totalQty ?? 0);
}

/**
 * 真的會建立的那幾筆：方案（套過微調、扣掉 0 的）＋ 加購的。
 *
 * **購買 id 不在這裡給** —— 它在 `data/customers.js` 那一層鑄造
 * （一次呼叫就是一次購買）。這裡是純函式，不碰 id。
 */
export function payload(draft, plans = [], { purchasedAt = null } = {}) {
  const rows = rowsOf(draft, plans);
  const tweaked = rows.map((row, i) => ({
    ...row,
    totalQty: qtyAt(draft, rows, i),
    purchasedAt,
  }));
  return [
    ...applyPlanTweak(tweaked, {}),
    ...(draft?.extras ?? []).map((e) => buy.toEntitlement(e, { purchasedAt })),
  ];
}

/** 她動過幾樣。收起來的東西不能安靜地生效，所以這個數字一定要印出來。 */
export function tweakCount(draft, plans = []) {
  const rows = rowsOf(draft, plans);
  const changed = rows.filter((row, i) => qtyAt(draft, rows, i) !== row.totalQty).length;
  return changed + (draft?.extras ?? []).length;
}

/** 存得下去嗎。 */
export function validate(draft, plans = []) {
  if (!planOf(draft, plans)) return ['先選一個方案'];
  if (!(Number(draft?.quantity) > 0)) return ['「買幾套」要大於 0'];
  if (!payload(draft, plans).length) return ['每一項都改成 0 了，這樣沒有東西可以建立'];
  return [];
}

// ---------- 畫面 ----------

/**
 * 整張面板。
 *
 * @param {object} draft
 * @param {object[]} plans 方案範本
 */
export function fields(draft, plans) {
  const rows = rowsOf(draft, plans);
  const usable = (plans ?? []).filter((p) => !p.deletedAt && p.active !== false);
  const n = tweakCount(draft, plans);

  return `
    ${f.chips({
      name: 'planId',
      label: '方案',
      value: draft.planId,
      options: usable.map((p) => ({ value: p.id, label: p.name })),
    })}

    <div class="fieldgroup">
      <span class="fieldgroup__label">買幾套</span>
      <div class="qty">
        <input class="qty__n" type="number" name="quantity" min="1" step="1"
               inputmode="numeric" value="${f.esc(draft.quantity ?? 1)}" aria-label="買幾套" />
        ${[1, 2].map((x) => `
          <button class="chip chip--sm" type="button" data-plusqty="${x}">+${x}</button>`).join('')}
      </div>
    </div>

    ${rows.length ? `
      <div class="fieldgroup">
        <span class="fieldgroup__label">展開之後會建立</span>
        <ul class="roster">
          ${rows.map((row, i) => rowHtml(draft, rows, row, i)).join('')}
        </ul>
        <p class="field__hint">改成 0 就是不要那一項。這幾個數字只影響這一位客戶，
          <b>方案範本一個字都不會變</b>。</p>
      </div>

      ${(draft.extras ?? []).length ? `
        <div class="fieldgroup">
          <span class="fieldgroup__label">另外加的</span>
          <ul class="roster">
            ${draft.extras.map((x, i) => `
              <li class="roster__row">
                <span class="roster__main">
                  <span class="roster__name">${f.esc(x.label || '（沒有名稱）')}</span>
                  <span class="roster__note">${f.esc(x.totalQty ?? 0)} ${f.esc(buy.unitOf(x))}</span>
                </span>
                <button class="roster__x" type="button" data-dropextra="${i}"
                        aria-label="拿掉這一項">✕</button>
              </li>`).join('')}
          </ul>
        </div>` : ''}

      <p style="margin: var(--space-3) 0 0">
        <button class="btn btn--sm" type="button" data-addextra>＋ 加一項</button>
        ${n ? `<span class="muted" style="margin-left: var(--space-2)">上面改過 ${n} 項</span>` : ''}
      </p>` : '<p class="muted">選一個方案，底下就會列出它會建立哪幾筆。</p>'}`;
}

/**
 * 一列。
 *
 * **只有跟方案不一樣的那幾列才講一句話。** 沒動過的那幾列旁邊那個數字
 * 就是方案寫的，再印一次「方案本來 4 次」等於把同一個數字講兩遍 ——
 * 而七列都在講的時候，真的改過的那一列就不見了。
 *
 * 改過的要講出本來幾次：微調是不常發生的事（她的原話），幾個月後看到「15 次」
 * 她不會記得那是談出來的還是打錯的。
 */
function rowHtml(draft, rows, row, i) {
  const now = qtyAt(draft, rows, i);
  return `
    <li class="roster__row ${now <= 0 ? 'roster__row--off' : ''}" data-item="${i}">
      <span class="roster__main">
        <span class="roster__name">${f.esc(row.label || '（沒有名稱）')}</span>
        <span class="roster__note">${f.esc(noteFor(row, now))}</span>
      </span>
      <span class="stepper">
        <button class="stepper__b" type="button" data-step="${i}:-1" aria-label="減一次">−</button>
        <input class="stepper__n" type="number" name="qty-${i}" value="${f.esc(now)}"
               min="0" step="1" inputmode="numeric" aria-label="幾次" />
        <button class="stepper__b" type="button" data-step="${i}:1" aria-label="加一次">＋</button>
      </span>
    </li>`;
}

/**
 * 表單上這一張面板自己管的那幾格。
 *
 * **只記跟方案不一樣的那幾項**（同 `blank()` 的說明）：全部記下來的話，
 * 她換一個方案時舊的數字會蓋到新方案的同一個位置上，而那兩項不是同一件事。
 */
export function values(form, rows = []) {
  const v = f.readForm(form);
  const qtyByIndex = {};
  rows.forEach((row, i) => {
    const raw = v[`qty-${i}`];
    if (raw === undefined || raw === '') return;
    const n = Math.max(0, Number(raw) || 0);
    if (n !== (row?.totalQty ?? 0)) qtyByIndex[i] = n;
  });
  return { planId: v.planId ?? null, quantity: Number(v.quantity) || 0, qtyByIndex };
}

/**
 * 把面板接起來。呼叫端只回答「哪一塊要重畫」，跟 `buy.wire()` 同一個分工。
 *
 * 事件用委派，所以重畫之後不必重掛 —— 但 `root` 必須是**重畫時會被換掉**
 * 的那一層。`f.wireChips(root)` 要先掛。
 *
 * @param {HTMLElement} root
 * @param {object} o
 * @param {() => HTMLFormElement|null} o.form
 * @param {() => object} o.draft
 * @param {() => object[]} o.plans
 * @param {(next: object, o: {repaint: boolean}) => void} o.onChange
 */
export function wire(root, { form, draft, plans, onChange }) {
  const read = () => {
    const box = form();
    return box ? values(box, rowsOf(draft(), plans())) : {};
  };

  root.addEventListener('click', (ev) => {
    const now = { ...draft(), ...read() };

    // 換方案：**她動過的那幾個數字要清掉** —— 留著的話，
    // 舊方案第 3 項的次數會蓋到新方案第 3 項上，而那兩項不是同一件事。
    if (ev.target.closest('[data-chip="planId"]')) {
      onChange({ ...now, qtyByIndex: {} }, { repaint: true });
      return;
    }

    const plus = ev.target.closest('[data-plusqty]');
    if (plus) {
      const next = Math.max(1, (Number(now.quantity) || 0) + Number(plus.dataset.plusqty));
      // 買幾套一改，每一項的次數都不一樣了 —— 她動過的那幾個也跟著作廢
      onChange({ ...now, quantity: next, qtyByIndex: {} }, { repaint: true });
      return;
    }

    const step = ev.target.closest('[data-step]');
    if (step) {
      const [i, by] = step.dataset.step.split(':').map(Number);
      const rows = rowsOf(now, plans());
      const next = Math.max(0, qtyAt(now, rows, i) + by);
      // **只改一個數字，不重畫**（ADR-0038）—— 重畫會讓她的下一下落空。
      const box = form();
      const input = box?.elements[`qty-${i}`];
      if (input) input.value = String(next);
      const merged = { ...now, qtyByIndex: { ...now.qtyByIndex, [i]: next } };
      reflectRow(root, rows, merged, i);
      onChange(merged, { repaint: false });
      return;
    }

    const drop = ev.target.closest('[data-dropextra]');
    if (drop) {
      const at = Number(drop.dataset.dropextra);
      onChange({ ...now, extras: now.extras.filter((_, i) => i !== at) }, { repaint: true });
    }
  });

  // 直接打字改次數。**不重畫** —— 重畫會洗掉游標。
  root.addEventListener('input', (ev) => {
    if (!/^qty-\d+$/.test(ev.target.name ?? '')) return;
    const now = { ...draft(), ...read() };
    reflectRow(root, rowsOf(now, plans()), now, Number(ev.target.name.slice(4)));
    onChange(now, { repaint: false });
  });
}

/** 那一列旁邊要講什麼。跟方案一樣就什麼都不講。 */
export function noteFor(row, now) {
  if (now <= 0) return '不建立';
  return now === (row?.totalQty ?? 0) ? '' : `方案本來 ${row?.totalQty ?? 0} 次`;
}

/** 不重畫的那條路上，把那一句話與那一列的灰底寫回畫面。 */
function reflectRow(root, rows, draft, i) {
  const li = root.querySelector(`[data-item="${i}"]`);
  if (!li) return;
  const now = qtyAt(draft, rows, i);
  li.classList.toggle('roster__row--off', now <= 0);
  const note = li.querySelector('.roster__note');
  if (note) note.textContent = noteFor(rows[i], now);
}
