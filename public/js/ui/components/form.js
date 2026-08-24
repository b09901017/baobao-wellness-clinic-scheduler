// 表單欄位。沒有框架，就是產生 HTML 字串再讀回值。
//
// 全站 input 至少 16px（iOS 上小於 16px 會觸發自動放大），
// 最小點擊區 44px，這些都寫在 css/app.css 裡。

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export { esc };

export function text({ name, label, value = '', placeholder = '', hint = '', maxlength = null }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <input type="text" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}"
             ${maxlength ? `maxlength="${Number(maxlength)}"` : ''} />
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

export function number({ name, label, value = '', min = 0, step = 1, hint = '' }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <input type="number" name="${name}" value="${esc(value)}" min="${min}" step="${step}" inputmode="numeric" />
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

export function date({ name, label, value = '', hint = '' }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <input type="date" name="${name}" value="${esc(value ?? '')}" />
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

export function time({ name, label, value = '', hint = '' }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <input type="time" name="${name}" value="${esc(value ?? '')}" step="300" />
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

export function textarea({ name, label, value = '', placeholder = '', rows = 3, hint = '' }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <textarea name="${name}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value ?? '')}</textarea>
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

/** 唯讀的一行說明，長得像欄位但不進 readForm。算出來的值用這個顯示。 */
export function readonly({ label, value, hint = '' }) {
  return `
    <div class="field">
      <span class="field__label">${esc(label)}</span>
      <div class="field__static">${esc(value)}</div>
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </div>`;
}

// 選項可以是字串（['治療室', …]），也可以是 { value, label }。
// value 明確給 null 時不可以退回成整個物件 —— 那會變成字串 "[object Object]"，
// 而且會一路存進 Firestore。
function optionOf(o) {
  const isObject = o !== null && typeof o === 'object';
  const value = isObject ? (o.value ?? null) : o;
  const label = isObject ? (o.label ?? String(value)) : o;
  return { value, label };
}

export function select({ name, label, value, options, hint = '' }) {
  const opts = options
    .map((option) => {
      const { value: v, label: l } = optionOf(option);
      const key = v === null ? '__null__' : String(v);
      const sel = (value ?? null) === (v ?? null) ? ' selected' : '';
      return `<option value="${esc(key)}"${sel}>${esc(l)}</option>`;
    })
    .join('');
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <select name="${name}">${opts}</select>
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

/**
 * 一排丸子。**取代大部分的下拉選單。**
 *
 * SPEC 第 8.2 節寫的是「課程／時段／器材／治療師／診間全部用點的，備註才要打字」，
 * 而第 8.3 節的來訪編輯器範例畫的也是丸子。實作卻用了 `<select>` ——
 * 這不是她想要新設計，是實作跟規格從一開始就不一樣（2026-08-24 她指出來）。
 *
 * 丸子比下拉好的三個實際理由（不只是好看）：
 *
 * 1. **看得到有哪些選項。** 下拉要點開才知道有三個還是三十個。
 * 2. **被禁忌擋掉的器材看得見。** 下拉選單裡那一行 `✕ 超磁場（不可使用）`
 *    只有點開才看得到，而 SPEC 第 4.3 節要求醫療禁忌**永遠可見、不可摺疊**。
 * 3. **少一次點擊。** 她一個晚上要記二三十筆。
 *
 * ## 值怎麼讀回去
 *
 * 丸子是 `<button>`，`readForm()` 看不到它們。所以旁邊藏一個 `<input type="hidden">`
 * 帶著同一個 `name` —— **呼叫端完全不用改讀值的那一段**。
 * 點一顆丸子會在那個 hidden input 上派一個 `change` 事件，
 * 所以原本掛在表單上的 change 處理器照樣會跑。
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.label
 * @param {*} opts.value 現在選的
 * @param {(string|{value:*, label:string, disabled?:boolean, note?:string})[]} opts.options
 * @param {string} [opts.hint]
 * @param {boolean} [opts.quiet] true = 選了不重畫（只換 aria-pressed）。
 *   給「換了它不會改變其他欄位」的那幾組用 —— 器材、治療師、診間、醫師、品項。
 *   她記一位客戶要點五六下，重畫的代價是卡片閃一下加捲回最上面（ADR-0038）。
 */
export function chips({ name, label, value, options, hint = '', quiet = false }) {
  const current = value ?? null;
  const items = options
    .map((option) => {
      const { value: v, label: l } = optionOf(option);
      const disabled = option?.disabled ? ' aria-disabled="true"' : '';
      const note = option?.note ? `<span class="chip__note">${esc(option.note)}</span>` : '';
      return `
        <button class="chip" type="button" data-chip="${esc(name)}"
                data-chip-value="${v === null ? '__null__' : esc(v)}"
                aria-pressed="${current === v}"${disabled}>
          ${esc(l)}${note}</button>`;
    })
    .join('');

  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">${esc(label)}</span>
      <div class="chiprow">${items}</div>
      <input type="hidden" name="${name}"
             value="${current === null ? '__null__' : esc(current)}"
             ${quiet ? 'data-chip-quiet' : ''} />
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </div>`;
}

/**
 * 把一排丸子接起來。事件委派掛在 root 上，所以任何一塊重畫之後都不必重掛。
 *
 * `quiet` 的那幾組選了**不派 change**，只改 `aria-pressed` 與那個 hidden input ——
 * 值還是讀得到（`readForm()` 讀的是 input），只是畫面不重畫。
 */
export function wireChips(root) {
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (!chip || chip.getAttribute('aria-disabled') === 'true') return;

    const name = chip.dataset.chip;
    const box = root.querySelector(`input[type="hidden"][name="${CSS.escape(name)}"]`);
    if (!box) return;

    box.value = chip.dataset.chipValue;
    for (const other of root.querySelectorAll(`[data-chip="${CSS.escape(name)}"]`)) {
      other.setAttribute('aria-pressed', String(other === chip));
    }

    if (box.dataset.chipQuiet === undefined) {
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

export function checkboxes({ name, label, values = [], options, hint = '' }) {
  const boxes = options
    .map((option) => {
      const { value: v, label: l } = optionOf(option);
      const on = values.includes(v) ? ' checked' : '';
      return `
        <label class="choice">
          <input type="checkbox" name="${name}" value="${esc(v)}"${on} data-many />
          <span>${esc(l)}</span>
        </label>`;
    })
    .join('');
  return `
    <fieldset class="field">
      <legend class="field__label">${esc(label)}</legend>
      <div class="choices">${boxes}</div>
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </fieldset>`;
}

export function toggle({ name, label, value = false, hint = '' }) {
  return `
    <label class="choice choice--row">
      <input type="checkbox" name="${name}"${value ? ' checked' : ''} />
      <span>${esc(label)}</span>
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

/** 逗號或頓號分隔的字串轉陣列，去空白去重。床位與禁忌都用這個。 */
export function parseList(raw) {
  return [...new Set(String(raw ?? '').split(/[,、，\s]+/).map((s) => s.trim()).filter(Boolean))];
}

/** 從 form 讀值。checkbox 群組回陣列，select 的 __null__ 轉回 null。 */
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      // 用標記而不是數「同名的有幾個」：選項剛好只剩一個時，
      // 數量判斷會把整組勾選變成單一開關，回傳 boolean 而不是陣列。
      if (el.dataset.many !== undefined) {
        out[el.name] ??= [];
        if (el.checked) out[el.name].push(el.value);
      } else {
        out[el.name] = el.checked;
      }
    } else if (el.type === 'number') {
      out[el.name] = el.value === '' ? null : Number(el.value);
    } else {
      out[el.name] = el.value === '__null__' ? null : el.value;
    }
  }
  return out;
}

/** 把驗證錯誤顯示在表單上方。 */
export function showErrors(container, errors) {
  const box = container.querySelector('[data-errors]');
  if (!box) return;
  if (!errors.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = `<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
}
