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

/**
 * 一個數字欄位。
 *
 * ## `step` 是禁令不是提示
 *
 * HTML 的 `step` **從 `min` 起算**，所以 `min="1" step="5"` 的合法值是
 * 1、6、11、16、21、26、31…… 而 30 不在裡面 —— 瀏覽器會在 submit 之前擋下來，
 * 順口報出最近的兩個。2026-09-04 她就是這樣被課程時長那一格擋住的
 *（「他不讓我儲存說只能 26 或 31？？」），而 2026-08-30 金額那一格的
 * `step="100"` 是同一個坑的第一次（5050 存不下去，見 `domain/products.js`）。
 *
 * **判準：欄位的 `min` / `step` 要跟 domain 的驗證講同一句話。**
 * domain 說「大於 0 的整數」，欄位就是 `min: 1, step: 1`。
 * 「通常是 5 的倍數」那種話寫進 `hint`，寫進 `step` 會變成禁令。
 * `tests/number-fields.test.js` 盯著每一個呼叫端。
 *
 * @param {number|string} [o.step] 數字，或 `'any'`（小數不設限）
 */
export function number({ name, label, value = '', min = 0, step = 1, hint = '' }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <input type="number" name="${name}" value="${esc(value)}" min="${min}" step="${esc(step)}"
             inputmode="${step === 1 ? 'numeric' : 'decimal'}" />
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

/**
 * 一個時間欄位要用多大的 `step`。**四個手寫的 `type="time"` 也要用這一支。**
 *
 * `step="300"`（5 分鐘）是刻意的：手機上的時間滾輪會照著 5 分鐘跳，
 * 而她一天要點很多次，1 分鐘一格等於多滾五倍。
 *
 * 但它跟 `number()` 那一段是同一個坑：**現有的值如果不是 5 的倍數，
 * 她一打開那一筆就存不回去**，而錯誤訊息一樣是看不懂的「最接近的有效值」。
 * 匯入進來的舊資料就可能是 10:32。所以那種時候退成一分鐘一格 ——
 * 她自己新填的一律還是 5 分鐘的滾輪。
 */
export function timeStepFor(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return 300;
  return Number(m[2]) % 5 === 0 ? 300 : 60;
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
      <input type="time" name="${name}" value="${esc(value ?? '')}" step="${timeStepFor(value)}" />
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
 * 2. **要注意的那一台看得見。** 下拉選單裡那一行只有點開才看得到，
 *    而 SPEC 第 4.3 節要求永久限制**永遠可見、不可摺疊**。
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
 * @param {(string|{value:*, label:string, disabled?:boolean, note?:string,
 *            lead?:string})[]} opts.options
 *   `lead` = 這一顆前面插一條分隔線與一個小標，用來把一排丸子切成兩組。
 * @param {string} [opts.hint]
 * @param {boolean} [opts.quiet] true = 選了不重畫（只換 aria-pressed）。
 *   給「換了它不會改變其他欄位」的那幾組用 —— 器材、治療師、診間、醫師、品項。
 *   她記一位客戶要點五六下，重畫的代價是卡片閃一下加捲回最上面（ADR-0038）。
 * @param {boolean} [opts.multi] true = 複選。`value` 收的是一個陣列，
 *   hidden input 存的是用換行串起來的值（見 `MULTI_SEP`）。一次購買的營養品
 *   有好幾種（`domain/products.js`），那一排就是這一種。
 * @param {number} [opts.tuckAfter] 前幾顆一直看得到，其餘的收在一顆
 *   「換一款」後面。**不是藏起來，是排在後面** —— 給「有一個正確答案，
 *   但別的答案偶爾也對」的那幾排用（營養點滴的品項就是：買的是 A，
 *   而今天 A 剛好用完是真的會發生的事，見 `domain/masterData.js` 的
 *   `ivChoicesFor()`）。展開只改一個屬性，整排不重畫（ADR-0038）。
 * @param {string} [opts.moreLabel] 那一顆上面寫什麼
 */
export function chips({
  name, label, value, options, hint = '', quiet = false, multi = false,
  tuckAfter = null, moreLabel = '換一款',
}) {
  // **一顆選項都沒有就不畫那一排。** 一個「課程」標籤底下一列空白，在畫面上
  // 跟壞掉一模一樣 —— 而呼叫端算出空陣列是有正當理由的（擇一池的課程由
  // 器材推出來，ADR-0075，所以那一排刻意沒有選項）。
  //
  // 擋在這裡而不是每個呼叫端各判斷一次：這條不是某一頁的規矩，
  // 是「一排零顆的丸子」在任何一頁都是錯的。
  //
  // **但給了 `hint` 的話那一句要留著。** 空的理由分兩種：「這一排本來就不該
  // 出現」（擇一池的課程）與「主檔裡還沒有人」—— 後者整排消失的話，
  // 她會以為那個欄位不用填，而不是去設定裡補一個人。
  if (!(options ?? []).length) {
    return hint
      ? `
    <div class="fieldgroup">
      <span class="fieldgroup__label">${esc(label)}</span>
      <span class="field__hint">${esc(hint)}</span>
    </div>`
      : '';
  }

  const picked = multi ? new Set(value ?? []) : null;
  const current = value ?? null;
  const isOn = (v) => (multi ? picked.has(v) : current === v);
  // 選著的那一顆永遠看得到 —— 收起來的話畫面上會是「一排都沒選」。
  const tucks = tuckAfter != null && options.length > tuckAfter;
  const items = options
    .map((option, i) => {
      const { value: v, label: l } = optionOf(option);
      const disabled = option?.disabled ? ' aria-disabled="true"' : '';
      const note = option?.note ? `<span class="chip__note">${esc(option.note)}</span>` : '';
      const tucked = tucks && i >= tuckAfter && !isOn(v) ? ' chip--tucked' : '';
      // 同一排裡分成兩組時，中間插一條線與一個小標講出後面那一組是什麼
      // （壓表那一頁的「排序」用的是同一組 class）。一排十幾顆要滑，
      // 而滑到底才看到的那一顆如果是另一種東西，得先說一聲。
      const lead = option?.lead
        ? `<span class="chiprow__sep"></span><span class="chiprow__lead">${esc(option.lead)}</span>`
        : '';
      return `${lead}
        <button class="chip${tucked}" type="button" data-chip="${esc(name)}"
                data-chip-value="${v === null ? '__null__' : esc(v)}"
                aria-pressed="${isOn(v)}"${disabled}>
          ${esc(l)}${note}</button>`;
    })
    .join('');

  const more = tucks
    ? `<button class="chip chip--more" type="button" data-chip-more
               aria-expanded="false">${esc(moreLabel)}</button>`
    : '';

  return `
    <div class="fieldgroup" ${tucks ? "data-tuck='closed'" : ''}>
      <span class="fieldgroup__label">${esc(label)}</span>
      <div class="chiprow">${items}${more}</div>
      <input type="hidden" name="${name}"
             value="${multi ? esc([...picked].join(MULTI_SEP)) : (current === null ? '__null__' : esc(current))}"
             ${multi ? 'data-chip-multi' : ''} ${quiet ? 'data-chip-quiet' : ''} />
      ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    </div>`;
}

/**
 * 把一排丸子接起來。事件委派掛在 root 上，所以任何一塊重畫之後都不必重掛。
 *
 * `quiet` 的那幾組選了**不派 change**，只改 `aria-pressed` 與那個 hidden input ——
 * 值還是讀得到（`readForm()` 讀的是 input），只是畫面不重畫。
 *
 * **`root` 是會被重畫換掉的節點時不用給 `signal`**（監聽跟著節點一起消失）；
 * 掛在一個會留著的容器上（例如整頁的 `el`）就一定要給，不然每重畫一次就
 * 多掛一組，點一下會跑好幾次。
 */
export function wireChips(root, { signal } = {}) {
  root.addEventListener('click', (e) => {
    // 「換一款」：只改一個屬性，整排不重畫（ADR-0038）。
    const more = e.target.closest('[data-chip-more]');
    if (more) {
      more.setAttribute('aria-expanded', 'true');
      more.closest('[data-tuck]')?.setAttribute('data-tuck', 'open');
      return;
    }

    const chip = e.target.closest('[data-chip]');
    if (!chip || chip.getAttribute('aria-disabled') === 'true') return;

    const name = chip.dataset.chip;
    const box = root.querySelector(`input[type="hidden"][name="${CSS.escape(name)}"]`);
    if (!box) return;

    if (box.dataset.chipMulti === undefined) {
      box.value = chip.dataset.chipValue;
      for (const other of root.querySelectorAll(`[data-chip="${CSS.escape(name)}"]`)) {
        other.setAttribute('aria-pressed', String(other === chip));
      }
    } else {
      // 複選：點一下切一次，那一顆自己改 aria-pressed，別人不動。
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      const set = new Set(splitMulti(box.value));
      if (on) set.add(chip.dataset.chipValue);
      else set.delete(chip.dataset.chipValue);
      box.value = [...set].join(MULTI_SEP);
    }

    if (box.dataset.chipQuiet === undefined) {
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { signal });
}

/**
 * 複選的丸子把值串在一個 hidden input 裡的分隔字元。
 *
 * **不是逗號** —— 那一排存的是 id，而她自己加的那幾款營養品之後也可能拿名字
 * 當 id 的一部分。換行不會出現在 id 裡，也不會出現在她打的名字裡。
 */
const MULTI_SEP = '\n';

/** 複選丸子的 hidden input 讀回來。空字串是空陣列，不是 `['']`。 */
export const splitMulti = (raw) => String(raw ?? '').split(MULTI_SEP).filter(Boolean);

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

/**
 * 「還答不出來」的那一句。
 *
 * 擇一池還沒挑器材時，「要治療師還是治療室」沒有答案（`assignsFor()` 回
 * `null`）—— 兩排都不畫，但**要留一句話**：什麼都不出現跟「這一種不用指派」
 * 長得一模一樣，而她會直接按下去。
 *
 * 壓表與來訪編輯器兩個入口共用。規則早就共用了（`assignsFor()`），
 * 這一句話原本各寫一次 —— 改一個字要改兩處。
 *
 * @param {string} what 她剛剛按的那一顆額度丸子上的字
 */
export function undecidedHint(what) {
  return `
    <p class="field__hint" style="margin: 0 0 var(--space-4)">
      先選上面那一台 —— ${esc(what || '這一段')} 要治療師還是治療室，看那天用的是哪一種。
    </p>`;
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

/**
 * 在游標處插一段字。emoji 快捷列、模板頁的變數丸子、貼上清洗三個地方共用。
 *
 * 三件事都要做，少一件行為就跟打字不一樣：
 *
 *   1. **選起來的那一段被取代掉** —— 她反白了一段再點一顆 emoji，
 *      預期是換掉不是插在旁邊
 *   2. **游標停在插進去的字後面**，而且焦點留在輸入框上 ——
 *      焦點跑掉的話她點完一顆還要再點一次輸入框
 *   3. **手動發一次 `input`** —— 用程式改 `value` 不會觸發它，
 *      而備忘錄那一格靠 `input` 長高（`mountEditor()` 的 `grow()`）。
 *      不發的話貼進去的字會被壓在一個沒長高的框裡，
 *      正好是 `.pbedit__body` 那個 bug 的另一種版本。
 *
 * @param {HTMLTextAreaElement|HTMLInputElement} el
 * @param {string} value 要插進去的字
 */
export function insertAtCursor(el, value) {
  if (!el) return;
  const text = String(value ?? '');
  const from = el.selectionStart ?? el.value.length;
  const to = el.selectionEnd ?? from;

  el.value = `${el.value.slice(0, from)}${text}${el.value.slice(to)}`;

  const at = from + text.length;
  el.focus();
  el.setSelectionRange(at, at);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
