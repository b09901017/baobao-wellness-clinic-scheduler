// 「做什麼」那一排最後那一顆「送的／體驗…」（gift-and-trial 04）。三個入口共用：壓表、來訪編輯器、拍 Abovee 的確認層。
//
// 她的原話：
//
// > 然後我希望這種不算次數的，在壓表或是新增來訪那邊可以先預設不出現先收合或是擺到底下，畢竟不常用
//
// **哪幾顆收起來、什麼順序、要不要一打開就展開只在 `domain/slotOptions.js`**（`folded`、`arrangeSlotOptions()`、
// `foldOpen()`）—— 這一支只畫：沒收起來的那幾顆＋最後一顆「送的／體驗…」，按了露出底下兩塊：
// 不算次數的課一排、「別的課當體驗」分類 → 課程兩步（同加購那一排：一類只有一門的那一顆直接就是那一門）。
//
// 每一顆選項長什麼樣由呼叫端給（`chip(o)`）：三個入口各自的屬性（`data-ent`、`data-chip`、`data-abl-opt`）照舊，
// 按下去走各自原本那一條路。這一支自己的屬性用自己的前綴（`data-giftfold-*`，CLAUDE.md「共用元件身上的屬性名字」）。
// 展開、收回與換分類只改屬性、不重畫（ADR-0038）。
//
// **收得回去**（2026-10-18，staging-polish 03，她：「送的/體驗這個，也可以展開之後再縮合回去」）。
// 以前刻意收不回去：選著一顆送的／體驗時收起來，那一顆就看不見了，看起來像取消選取。那個顧慮還在 ——
// 所以收起來時**那一顆開關寫出選了哪一門、而且是按下去的樣子**（`foldLabel()`），一眼看得出「選著這個、只是收起來了」。
//
// **開著還是收著是她決定的**，存在呼叫端（壓表那一張卡、來訪編輯器那一段、拍 Abovee 那一列，用 `key` 認）：
// `foldOpen()` 只是第一次畫的預設 —— 每畫一次都問它的話，選著體驗時收起來撐不過下一次重畫。
// 按了開關走 `toggle(e, onFold)`，`onFold(key, open)` 讓呼叫端記下來；不重畫的入口（壓表）選了別顆之後叫 `sync()`。

import { esc } from './form.js';

/**
 * @param {object} o
 * @param {object[]} o.options 那一排（`slotOptionsFor()` 或 `arrangeSlotOptions()` 排好的）
 * @param {string|null} o.value 現在按著的那一顆
 * @param {boolean} o.open 呼叫端記著的開或收；還沒記過就是 `foldOpen()`
 * @param {(option: object) => string} o.chip 一顆選項的 HTML（呼叫端自己的屬性）
 * @param {string} [o.cls] 一排丸子的容器（會換行的那一種）
 * @param {boolean} [o.sm] 小一號的丸子（拍 Abovee）
 * @param {string} [o.empty] 上面那一排一顆都沒有時那一句
 * @param {string} [o.key] 這一組是哪一段／哪一列的（`toggle()` 的 `onFold` 拿回去記）
 */
export function html({ options = [], value = null, open, chip, cls = 'chips', sm = false, empty = '', key = '' }) {
  const row = (inner) => `<div class="${cls}">${inner}</div>`;
  const main = options.filter((o) => !o.folded);
  const mainChips = main.map((o) => `${o.breakBefore ? '<span class="chips__break"></span>' : ''}${chip(o)}`).join('');
  const folded = options.filter((o) => o.folded);
  if (!folded.length) return main.length ? row(mainChips) : empty;

  const size = sm ? ' chip--sm' : '';
  const first = folded.filter((o) => !o.other);
  const groups = [];
  for (const o of folded.filter((x) => x.other)) {
    const g = groups.find((x) => x.group === o.group);
    if (g) g.items.push(o);
    else groups.push({ group: o.group, items: [o] });
  }
  const at = groups.findIndex((g) => g.items.some((o) => o.entitlementId === value));
  const picked = folded.find((o) => o.entitlementId === value) ?? null;
  // 收起來時開關上要寫選了哪一門 —— 不重畫的入口（壓表）是從畫面上讀的（`sync()`），所以每一顆帶著名字
  const named = (o) => chip(o).replace(/<button\b/, `<button data-giftfold-name="${esc(o.label)}"`);

  return `
    <div data-giftfold="${open ? 'open' : 'closed'}" data-giftfold-key="${esc(key)}">
      ${main.length ? '' : empty}
      ${row(`${mainChips}<button class="chip${size} chip--more" type="button" data-giftfold-more
        aria-expanded="${Boolean(open)}" aria-pressed="${Boolean(picked && !open)}">${foldLabel(open, picked?.label)}</button>`)}
      <div class="giftfold">
        ${first.length ? row(first.map(named).join('')) : ''}
        ${groups.length ? `
          <span class="giftfold__lead">別的課當體驗</span>
          ${row(groups.map((g, i) => (g.items.length === 1 ? named(g.items[0]) : `
            <button class="chip${size}" type="button" data-giftfold-group="${i}" aria-pressed="${i === at}">
              ${esc(g.group)}<span class="chip__note">▾</span></button>`)).join(''))}
          ${groups.map((g, i) => (g.items.length > 1
            ? `<div data-giftfold-in="${i}"${i === at ? '' : ' hidden'}>${row(g.items.map(named).join(''))}</div>`
            : '')).join('')}` : ''}
      </div>
    </div>`;
}

/**
 * 開關上那幾個字。收著而且選著底下一顆：寫那一門（按下去的樣子由 `aria-pressed` 給）。
 *
 * @param {boolean} open
 * @param {string|null} [picked] 選著的那一門（沒選底下任何一顆就是 null）
 */
export function foldLabel(open, picked = null) {
  if (open) return '送的／體驗<span class="chip__note">▾ 收起來</span>';
  if (picked) return `${esc(picked)}<span class="chip__note">送的／體驗 ▸</span>`;
  return '送的／體驗…';
}

/**
 * 「送的／體驗…」與「別的課當體驗」的分類那幾顆。接在呼叫端的 click 委派裡；是這一支的就回 `true`。
 * 開關按一次展開、再按一次收回；`onFold(key, open)` 讓呼叫端記下來（重畫時傳回 `html()` 的 `open`）。
 * 換分類時**選著的那一門所在的那一類不收**（收起來看起來像取消選取）。
 *
 * @param {Event} e
 * @param {(key: string, open: boolean) => void} [onFold]
 */
export function toggle(e, onFold) {
  const more = e.target.closest?.('[data-giftfold-more]');
  if (more) {
    const fold = more.closest('[data-giftfold]');
    if (!fold) return true;
    const open = fold.dataset.giftfold !== 'open';
    fold.setAttribute('data-giftfold', open ? 'open' : 'closed');
    paintMore(fold);
    if (typeof onFold === 'function') onFold(fold.dataset.giftfoldKey ?? '', open);
    return true;
  }
  const group = e.target.closest?.('[data-giftfold-group]');
  const fold = group?.closest('[data-giftfold]');
  if (!fold) return false;
  for (const box of fold.querySelectorAll('[data-giftfold-in]')) {
    box.hidden = box.dataset.giftfoldIn !== group.dataset.giftfoldGroup && !box.querySelector('[aria-pressed="true"]');
  }
  for (const g of fold.querySelectorAll('[data-giftfold-group]')) {
    const box = fold.querySelector(`[data-giftfold-in="${g.dataset.giftfoldGroup}"]`);
    g.setAttribute('aria-pressed', String(Boolean(box && !box.hidden)));
  }
  return true;
}

/**
 * 選擇改了、那一排沒有重畫（壓表，ADR-0038）：開關上的字與按下去的樣子跟著換。
 * 會重畫的入口不用叫（`html()` 自己畫對）。
 *
 * @param {ParentNode|null} root
 */
export function sync(root) {
  for (const fold of root?.querySelectorAll?.('[data-giftfold]') ?? []) paintMore(fold);
}

function paintMore(fold) {
  const more = fold.querySelector('[data-giftfold-more]');
  if (!more) return;
  const open = fold.dataset.giftfold === 'open';
  const picked = fold.querySelector('.giftfold [aria-pressed="true"][data-giftfold-name]');
  more.setAttribute('aria-expanded', String(open));
  more.setAttribute('aria-pressed', String(Boolean(picked && !open)));
  more.innerHTML = foldLabel(open, picked?.dataset.giftfoldName ?? null);
}
