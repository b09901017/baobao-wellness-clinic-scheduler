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
// 展開與換分類只改屬性、不重畫（ADR-0038）。**收不回去**，同「換一款」那一顆（`.chip--more`）——
// 選著一顆送的／體驗時收起來，看起來會像取消選取。

import { esc } from './form.js';

/**
 * @param {object} o
 * @param {object[]} o.options 那一排（`slotOptionsFor()` 或 `arrangeSlotOptions()` 排好的）
 * @param {string|null} o.value 現在按著的那一顆
 * @param {boolean} o.open `foldOpen()`
 * @param {(option: object) => string} o.chip 一顆選項的 HTML（呼叫端自己的屬性）
 * @param {string} [o.cls] 一排丸子的容器（會換行的那一種）
 * @param {boolean} [o.sm] 小一號的丸子（拍 Abovee）
 * @param {string} [o.empty] 上面那一排一顆都沒有時那一句
 */
export function html({ options = [], value = null, open, chip, cls = 'chips', sm = false, empty = '' }) {
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

  return `
    <div data-giftfold="${open ? 'open' : 'closed'}">
      ${main.length ? '' : empty}
      ${row(`${mainChips}<button class="chip${size} chip--more" type="button" data-giftfold-more
        aria-expanded="${Boolean(open)}">送的／體驗…</button>`)}
      <div class="giftfold">
        ${first.length ? row(first.map(chip).join('')) : ''}
        ${groups.length ? `
          <span class="giftfold__lead">別的課當體驗</span>
          ${row(groups.map((g, i) => (g.items.length === 1 ? chip(g.items[0]) : `
            <button class="chip${size}" type="button" data-giftfold-group="${i}" aria-pressed="${i === at}">
              ${esc(g.group)}<span class="chip__note">▾</span></button>`)).join(''))}
          ${groups.map((g, i) => (g.items.length > 1
            ? `<div data-giftfold-in="${i}"${i === at ? '' : ' hidden'}>${row(g.items.map(chip).join(''))}</div>`
            : '')).join('')}` : ''}
      </div>
    </div>`;
}

/**
 * 「送的／體驗…」與「別的課當體驗」的分類那幾顆。接在呼叫端的 click 委派裡；是這一支的就回 `true`。
 * 換分類時**選著的那一門所在的那一類不收**（收起來看起來像取消選取）。
 */
export function toggle(e) {
  const more = e.target.closest?.('[data-giftfold-more]');
  if (more) {
    more.setAttribute('aria-expanded', 'true');
    more.closest('[data-giftfold]')?.setAttribute('data-giftfold', 'open');
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
