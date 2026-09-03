// 永久限制的編輯器與它的三種畫法。新增客戶與編輯基本資料兩張表單共用一支。
//
// ## 永久限制有三層（ADR-0064）
//
//   醫療禁忌   體內金屬         會讓某個器材完全不能用 —— 全站唯一的硬性阻擋
//   臨床提醒   血管難打、第一針  什麼都不擋，但壓表那一刻要一眼看得到
//   其餘       固定禮拜五不行    排班相關的話，由本輪可用性與可用日在管
//
// 前兩層都是**有限的一組字**，所以做成丸子讓她點；第三層是她自己的話，
// 留自由輸入。
//
// 為什麼前兩層不給她打字：醫療禁忌靠客戶身上的字與器材上的字**完全相同**才擋得住，
// 打成「體內有金屬」就一台器材都擋不住；臨床提醒打錯一個字則是壓表卡片牆上
// 什麼都不會出現。**兩種錯在畫面上都跟做對了一模一樣**，那比看得出來的錯危險。
//
// 兩份名單各有各的家：醫療禁忌從器材主檔推出來（`contraindicationTerms()`），
// 臨床提醒自己一份主檔（`clinicalTerms()`）。臨床提醒沒有東西要對得上，
// 所以它不能也從別的地方推。

import { esc, parseList } from './form.js';
import { splitFlagsForEdit, mergeFlags } from '../../domain/customers.js';
import { equipmentLimitLabel } from '../../domain/contraindications.js';

/**
 * 掃過去一眼要看到的那幾個：**會擋掉器材的**與**臨床提醒**。
 *
 * 壓表卡片牆與待辦的「壓表登記」兩頁共用（ADR-0046）。分開寫的話會出現
 * 一邊紅一邊灰，而這一排的整個意義就是「掃過去一眼分得出誰要特別注意」。
 *
 * **第三層不畫。**「固定禮拜五不行」也是永久限制，但一張卡上十個字等於
 * 全都沒有重點（SPEC 第 4.3 節仍然成立：記錄面板與客戶詳情上全部都有）。
 *
 * 兩層的畫法差一級是刻意的：
 *
 *   .flag--block  實心紅   這台機器**不能用**
 *   .flag--alert  茶外框   這個人做起來**要注意**
 *
 * 兩份名單由呼叫端算好傳進來，不在這裡算 —— 一頁要畫二十幾張卡，
 * 每張重算一次主檔是白費的。
 *
 * @param {object} opts
 * @param {string[]} opts.flags 這位客戶的全部永久限制
 * @param {string[]} opts.terms 會擋掉器材的那幾個字（`contraindicationTerms()`）
 * @param {string[]} [opts.clinical] 臨床提醒那幾個字（`clinicalTerms()`）
 * @param {object[]|null} [opts.options] 這位客戶擇一池裡的器材。給了才會多一句
 *   「只能 INDIBA」；沒有擇一池就不給。
 */
export function alertChips({ flags = [], terms = [], clinical = [], options = null }) {
  const blocking = new Set(terms);
  const alerts = new Set(clinical);

  const mine = flags.filter((x) => blocking.has(x));
  // 兩份名單撞名時**禁忌贏**：那一顆擋得住東西，畫成比較輕的一顆等於
  // 把硬性阻擋降級，而降級在畫面上看不出來。同 `splitFlags()` 的判斷。
  const alerted = flags.filter((x) => !blocking.has(x) && alerts.has(x));
  if (!mine.length && !alerted.length) return '';

  const limit = mine.length && options ? equipmentLimitLabel({ flags }, options) : null;

  return `
    <span class="blockchips">
      ${mine.map((x) => `<span class="flag flag--block">${esc(x)}</span>`).join('')}
      ${limit
        ? `<span class="flag ${limit.leftCount ? 'flag--left' : 'flag--block'}">${esc(limit.text)}</span>`
        : ''}
      ${alerted.map((x) => `<span class="flag flag--alert">${esc(x)}</span>`).join('')}
    </span>`;
}

/**
 * 攤開的那一面：**三層都畫**，給看得完的那幾頁用
 * （客戶清單的卡片、客戶詳情、來訪編輯器、壓表的記錄面板）。
 *
 * SPEC 第 4.3 節：「永久限制在任何畫面都必須跟著客戶名字顯示，不可被摺疊隱藏。」
 * 所以這裡跟 `alertChips()` 的分工是**畫面大小**，不是重要程度 ——
 * 卡片牆一張卡只回答一個問題（ADR-0046），這幾頁看得完。
 *
 * 一支而不是四支：2026-09-03 之前這四個地方各自寫了一次
 * `flags.map(x => '<span class="flag">')`，於是新增臨床提醒那一層時，
 * 四個地方會有幾個忘了跟 —— 而忘了跟的症狀是「那顆丸子在這一頁有、那一頁沒有」。
 *
 * @param {{contraindications: string[], clinical: string[], others: string[]}} split
 *   `domain/customers.js` 的 `splitFlags()` 給的
 * @param {{others?: boolean}} [opts] others：要不要畫第三層。
 *   客戶清單的卡片把第三層放在卡片底下另一區，所以那一個呼叫端會關掉它。
 */
export function detailChips(split, { others = true } = {}) {
  const parts = [
    ...(split?.contraindications ?? []).map((x) => `<span class="flag">${esc(x)}</span>`),
    ...(split?.clinical ?? []).map((x) => `<span class="flag flag--alert">${esc(x)}</span>`),
    ...(others ? (split?.others ?? []).map((x) => `<span class="badge">${esc(x)}</span>`) : []),
  ];
  return parts.join('');
}

/**
 * 掛一個永久限制編輯器進 host。
 *
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string[]} opts.flags  現在的永久限制
 * @param {string[]} opts.terms  醫療禁忌那幾個字（`contraindicationTerms()`）
 * @param {string[]} [opts.clinical] 臨床提醒那幾個字（`clinicalTerms()`）
 * @param {Function} opts.onChange 收到合好的 string[]
 * @returns {{value: () => string[]}} 送出表單時直接讀得到現值
 */
export function mount(host, { flags = [], terms = [], clinical = [], onChange }) {
  if (!host) return { value: () => flags };

  const split = splitFlagsForEdit(flags, terms, clinical);
  const picked = new Set(split.picked);
  const alerts = new Set(split.clinicalPicked);
  let others = split.others;

  const value = () => mergeFlags([...picked], [...alerts], others);
  const emit = () => onChange?.(value());

  host.innerHTML = `
    <div class="fieldgroup">
      <span class="fieldgroup__label">永久限制　跟著這位客戶一輩子的條件</span>
      ${terms.length ? `
        <div class="chiprow noscroll-bar" role="group" aria-label="醫療禁忌">
          ${terms.map((t) => `
            <button class="chip chip--sm chip--hard" type="button"
                    aria-pressed="${picked.has(t)}" data-term="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
        <p class="field__hint">這幾個是器材上登記的醫療禁忌，選了就會直接鎖住對應的器材
          —— 全站唯一會擋下來的檢查。</p>` : `
        <p class="field__hint">還沒有任何器材登記醫療禁忌。要讓「體內金屬」擋得住東西，
          先到設定 → 器材上把禁忌填好。</p>`}

      ${clinical.length ? `
        <div class="chiprow noscroll-bar" role="group" aria-label="臨床提醒"
             style="margin-top: var(--space-3)">
          ${clinical.map((t) => `
            <button class="chip chip--sm chip--soft" type="button"
                    aria-pressed="${alerts.has(t)}" data-alert="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
        <p class="field__hint"><b>不會擋任何東西</b>，它只是讓你壓表的時候一眼看得到。
          要加新的到設定 → 臨床提醒。</p>` : ''}

      <label class="field">
        <span class="field__label">其他限制</span>
        <input type="text" data-others value="${esc(others.join('、'))}"
               placeholder="固定禮拜五不行" />
        <span class="field__hint">用頓號分隔。這一欄只是提醒，不會擋任何東西，
          <b>也不會出現在壓表的卡片牆上</b> —— 要出現在那裡的話用上面那兩排。</span>
      </label>
    </div>`;

  // 兩排丸子同一個處理方式，差在存進哪一個 Set。分開寫兩份監聽的話，
  // 之後改按下去的行為（例如加一段動畫）會有一排忘了跟。
  const wireRow = (attr, set) =>
    host.querySelectorAll(`[data-${attr}]`).forEach((btn) =>
      btn.addEventListener('click', () => {
        const term = btn.dataset[attr];
        if (set.has(term)) set.delete(term);
        else set.add(term);
        btn.setAttribute('aria-pressed', String(set.has(term)));
        emit();
      }),
    );

  wireRow('term', picked);
  wireRow('alert', alerts);

  // input 而不是 change：她打完直接按儲存時，change 還沒發出去（iOS 上尤其）
  host.querySelector('[data-others]')?.addEventListener('input', (e) => {
    others = parseList(e.target.value);
    emit();
  });

  return { value };
}
