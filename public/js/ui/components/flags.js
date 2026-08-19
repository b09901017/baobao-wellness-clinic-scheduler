// 永久限制的編輯器。新增客戶與編輯基本資料兩張表單共用一支。
//
// 上面一排丸子是**會真的擋下器材的那幾個字**（體內金屬），從器材主檔推出來
// （`domain/contraindications.js` 的 `contraindicationTerms()`）；底下的自由輸入
// 收其餘的（固定禮拜五不行）。
//
// 為什麼要分成兩塊：醫療禁忌是全站唯一的硬性阻擋（ADR-0002），而它靠的是
// 客戶身上的字與器材上的字**完全相同**。打成「體內有金屬」就一台器材都擋不住，
// 而畫面上看起來跟擋得住的一模一樣 —— 那比沒有標記更危險。丸子讓那幾個字
// 不可能打錯；打不出來的那些話留給自由輸入。

import { esc, parseList } from './form.js';
import { splitFlagsForEdit, mergeFlags } from '../../domain/customers.js';

/**
 * 掛一個永久限制編輯器進 host。
 *
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string[]} opts.flags  現在的永久限制
 * @param {string[]} opts.terms  可以點的那幾個字（contraindicationTerms() 的結果）
 * @param {Function} opts.onChange 收到合好的 string[]
 * @returns {{value: () => string[]}} 送出表單時直接讀得到現值
 */
export function mount(host, { flags = [], terms = [], onChange }) {
  if (!host) return { value: () => flags };

  const split = splitFlagsForEdit(flags, terms);
  const picked = new Set(split.picked);
  let others = split.others;

  const value = () => mergeFlags([...picked], others);
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

      <label class="field">
        <span class="field__label">其他限制</span>
        <input type="text" data-others value="${esc(others.join('、'))}"
               placeholder="固定禮拜五不行" />
        <span class="field__hint">用頓號分隔。這一欄只是提醒，不會擋任何東西。</span>
      </label>
    </div>`;

  host.querySelectorAll('[data-term]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const term = btn.dataset.term;
      if (picked.has(term)) picked.delete(term);
      else picked.add(term);
      btn.setAttribute('aria-pressed', String(picked.has(term)));
      emit();
    }),
  );

  // input 而不是 change：她打完直接按儲存時，change 還沒發出去（iOS 上尤其）
  host.querySelector('[data-others]')?.addEventListener('input', (e) => {
    others = parseList(e.target.value);
    emit();
  });

  return { value };
}
