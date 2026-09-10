// 永久限制的編輯器與它的兩種畫法。新增客戶與編輯基本資料兩張表單共用一支。
//
// ## 永久限制有兩層（ADR-0074）
//
//   警示   體內金屬、血管難打、第一針   什麼都不擋，但壓表那一刻要一眼看得到
//   其餘   固定禮拜五不行              排班相關的話，由本輪可用性與可用日在管
//
// 2026-09-06 之前是三層，最上面那一層是**醫療禁忌**，而它自成一層的唯一理由是
// 「它會硬性擋掉某台器材」。不擋之後那條界線就不存在了，所以兩層合併 ——
// 見 docs/adr/0074-a-contraindication-warns-it-does-not-block.md。
//
// 警示是**有限的一組字**（設定 → 警示那一份主檔），所以做成丸子讓她點；
// 其餘是她自己的話，留自由輸入。
//
// ## 每一個警示自己挑顏色與填法
//
// 兩層合併之後，一排上可能同時有「體內金屬」「血管難打」「第一針」「怕痛」，
// 而系統分不出哪一個對她比較重要 —— 那是她的判斷（ADR-0002）。所以樣式跟著
// 那一個警示走，記在主檔上（`domain/clinicalFlags.js`），同行事備註（ADR-0040）。
//
// 為什麼警示不給她打字：打錯一個字的症狀是**壓表卡片牆上什麼都不會出現**，
// 而畫面上看起來跟做對了一模一樣。看不出來的錯比看得出來的危險。
//
// 「哪一台器材要提醒」是另一件事，記在器材主檔上，只在她真的選了那一台的時候
// 才講一句（`domain/contraindications.js` 的 `noticeSentence()`）——
// 卡片牆上那顆算出來的「只能 INDIBA」2026-09-06 拿掉了，她指名不要。
//
// ## 這一支也畫合作機構
//
// 它**不是永久限制**（不擋、不影響排班），但它畫在同一個位置上：跟著客戶的
// 名字。四個畫面共用一支的理由跟警示一模一樣 —— 各寫一次遲早有一頁忘了跟，
// 而症狀是「那顆丸子在這一頁有、那一頁沒有」。見 ADR-0076。

import { esc, parseList } from './form.js';
import { splitFlagsForEdit, mergeFlags } from '../../domain/customers.js';
import { noticeSentence } from '../../domain/contraindications.js';
import { lookup, styleFor } from '../../domain/clinicalFlags.js';
import { icon } from '../icons.js';

/**
 * 掃過去一眼要看到的那幾個：**警示那一層**。
 *
 * 壓表卡片牆與待辦的「壓表登記」兩頁共用（ADR-0046）。分開寫的話會出現
 * 一邊有一邊沒有，而這一排的整個意義就是「掃過去一眼分得出誰要特別注意」。
 *
 * **第二層不畫。**「固定禮拜五不行」也是永久限制，但一張卡上十個字等於
 * 全都沒有重點（SPEC 第 4.3 節仍然成立：記錄面板與客戶詳情上兩層都有）。
 *
 * 名單由呼叫端算好傳進來，不在這裡算 —— 一頁要畫二十幾張卡，
 * 每張重算一次主檔是白費的。
 *
 * @param {object} opts
 * @param {string[]} opts.flags 這位客戶的全部永久限制
 * @param {string[]} opts.alerts 警示那幾個字（`clinicalTerms()`）
 * @param {object[]} [opts.rows] 警示主檔，樣式從這裡查。沒給就全部畫成預設
 */
export function alertChips({ flags = [], alerts = [], rows = [] }) {
  const known = new Set(alerts);
  const mine = flags.filter((x) => known.has(x));
  if (!mine.length) return '';

  return `<span class="blockchips">${mine.map((x) => chipHtml(x, rows)).join('')}</span>`;
}

/**
 * 一顆警示丸子。**兩種畫法共用這一支** —— `alertChips()` 與 `detailChips()`
 * 各寫一次的話，之後多一種填法會有一邊忘了跟，而症狀是「同一個字在這一頁是
 * 紅的、那一頁是茶色的」。
 */
function chipHtml(name, rows) {
  const look = lookup(rows)(name);
  return `<span class="flag flag--alert flag--${esc(look.fill)}"
                style="${esc(styleFor(look))}">${esc(name)}</span>`;
}

/**
 * 攤開的那一面：**兩層都畫**，給看得完的那幾頁用
 * （客戶清單的卡片、客戶詳情、來訪編輯器、壓表的記錄面板）。
 *
 * SPEC 第 4.3 節：「永久限制在任何畫面都必須跟著客戶名字顯示，不可被摺疊隱藏。」
 * 所以這裡跟 `alertChips()` 的分工是**畫面大小**，不是重要程度 ——
 * 卡片牆一張卡只回答一個問題（ADR-0046），這幾頁看得完。
 *
 * 一支而不是四支：2026-09-03 之前這四個地方各自寫了一次
 * `flags.map(x => '<span class="flag">')`，於是多一層的時候會有幾個忘了跟 ——
 * 而忘了跟的症狀是「那顆丸子在這一頁有、那一頁沒有」。
 *
 * @param {{alerts: string[], others: string[]}} split
 *   `domain/customers.js` 的 `splitFlags()` 給的
 * @param {{others?: boolean, rows?: object[]}} [opts] others：要不要畫第二層。
 *   客戶清單的卡片把第二層放在卡片底下另一區，所以那一個呼叫端會關掉它。
 *   rows：警示主檔，樣式從這裡查。
 */
export function detailChips(split, { others = true, rows = [] } = {}) {
  const parts = [
    ...(split?.alerts ?? []).map((x) => chipHtml(x, rows)),
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
 * @param {string[]} [opts.alerts] 警示那幾個字（`clinicalTerms()`）
 * @param {Function} opts.onChange 收到合好的 string[]
 * @returns {{value: () => string[]}} 送出表單時直接讀得到現值
 */
export function mount(host, { flags = [], alerts = [], onChange }) {
  if (!host) return { value: () => flags };

  const split = splitFlagsForEdit(flags, alerts);
  const picked = new Set(split.picked);
  let others = split.others;

  const value = () => mergeFlags([...picked], others);
  const emit = () => onChange?.(value());

  host.innerHTML = `
    <div class="fieldgroup">
      <span class="fieldgroup__label">永久限制　跟著這位客戶一輩子的條件</span>
      ${alerts.length ? `
        <div class="chiprow noscroll-bar" role="group" aria-label="警示">
          ${alerts.map((t) => `
            <button class="chip chip--sm chip--soft" type="button"
                    aria-pressed="${picked.has(t)}" data-alert="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
        <p class="field__hint"><b>不會擋任何東西</b>，它只是讓你壓表的時候一眼看得到。
          要加新的、或改它的顏色，到設定 → 警示。</p>` : `
        <p class="field__hint">還沒有任何警示。到設定 → 警示把「體內金屬」「血管難打」
          這種加進去，之後就點得到了。</p>`}

      <label class="field">
        <span class="field__label">其他限制</span>
        <input type="text" data-others value="${esc(others.join('、'))}"
               placeholder="固定禮拜五不行" />
        <span class="field__hint">用頓號分隔。這一欄只是提醒，
          <b>也不會出現在壓表的卡片牆上</b> —— 要出現在那裡的話用上面那一排。</span>
      </label>
    </div>`;

  host.querySelectorAll('[data-alert]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const term = btn.dataset.alert;
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

/**
 * 她剛剛選了這一台器材，底下要跳出來的那一塊。**兩個入口共用一支**
 * （壓表的記錄面板、來訪編輯器）—— 兩份寫法遲早有一邊漏掉新加的器材，
 * 而漏掉的症狀是「這一頁有提醒、那一頁沒有」。
 *
 * **沒選、或那一台沒事就整塊不畫。** 一個永遠在那裡的紅框，
 * 第三天她就不會再看它了。
 *
 * 用 `.warn--hard`（紅）是刻意的：這一頁其餘的提醒（診間撞、次數不夠、
 * 他說那天不行）都是**這一天本來就有的背景**，而這一句是**她這一下按出來的**。
 * 她 2026-09-06 要的就是這個差別：「只需要在選到不是 INDIBA 的時候更明顯提醒」。
 *
 * `role="status"` 是必要的而不是保險：兩個入口都是就地換字（不重畫整頁），
 * 沒有 live region 的話讀螢幕的人不會知道它變了。
 *
 * @param {object} o
 * @param {{flags?: string[]}} o.customer
 * @param {object|null} o.equipment 她選的那一台
 * @param {object[]} [o.options] 這一段選得到的那幾台，用來算「建議改用」
 * @param {number} [o.size] 圖示大小
 * @returns {string} HTML，沒有東西要講時是空字串
 */
export function noticeBlock({ customer, equipment, options = [], size = 18 }) {
  const say = equipment ? noticeSentence(customer, equipment, options) : null;
  if (!say) return '';
  return `
    <div class="warn warn--hard" role="status">
      ${icon('alert', { size })}
      <span><b>${esc(say.headline)}</b><br />${esc(say.detail)}</span>
    </div>`;
}

/**
 * 合作機構那幾顆（ADR-0076）。
 *
 * 畫法**跟警示分得出來**：那一排回答「這個人做起來要注意」，這一排回答
 * 「這一次要多跟一家講一聲」。兩件事長一樣的話，她掃過去會把它們當成同一種。
 *
 * **它不產生任何待辦**（她 2026-09-06 選的），所以這顆丸子就是全部的提醒 ——
 * 那正是它必須在每一個看得到客戶名字的地方都出現的理由。
 *
 * ## 它自己帶一層包裝，跟 `alertChips()` 一樣
 *
 * 2026-09-10 之前這一支回的是**裸的**幾顆 `<span class="flag">`，而四個呼叫端
 * 都是把它接在 `alertChips()` 那一份 `.blockchips` 的**後面**。落進
 * `flex-direction: column` 的容器裡時，預設的 `align-items: stretch`
 * 就把它拉滿整行 —— 她 2026-09-10：「那個綠色框框是一直延伸的誒？」
 *
 * 實測（390px）：壓表卡片牆那一顆 273px，另外三個呼叫端 60px。
 * **同一支 code、同一份 CSS，壞的只有一個容器** —— 所以從畫面上看不出是誰的錯。
 * 修在這裡而不是那個容器上，是因為下一個呼叫端還是會踩到。
 *
 * @param {string[]} partners 這位客戶掛的那幾家（`partnersOf()`）
 */
export function partnerChips(partners = []) {
  const mine = (partners ?? []).filter(Boolean);
  if (!mine.length) return '';
  return `<span class="blockchips blockchips--partner">${
    mine.map((x) => `<span class="flag flag--partner">${esc(x)}</span>`).join('')}</span>`;
}

/**
 * 掛一個合作機構的挑選器進 host（ADR-0076）。
 *
 * **跟永久限制分成兩支**，因為它們是兩件事：一個是「這個人做起來要注意」，
 * 一個是「這一次要多跟一家講一聲」。合成一支的話，之後改其中一種的行為
 * 會不小心動到另一種。畫面上它們相鄰是版面的事，不是同一件事。
 *
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string[]} opts.partners 現在掛的那幾家
 * @param {string[]} opts.options  主檔上還在用的那幾家（`partnerNames()`）
 * @param {Function} opts.onChange 收到合好的 string[]
 * @returns {{value: () => string[]}}
 */
export function mountPartners(host, { partners = [], options = [], onChange }) {
  if (!host) return { value: () => partners };

  const known = new Set(options);
  const picked = new Set((partners ?? []).filter((x) => known.has(x)));
  // 主檔上已經沒有的字照樣留著 —— 她可能把那一筆改名了，而客戶身上存的是字串。
  // 悄悄丟掉的話，那位客戶就再也不會出現「自然美」那顆丸子了。
  const orphans = (partners ?? []).filter((x) => x && !known.has(x));

  const value = () => [...options.filter((x) => picked.has(x)), ...orphans];

  host.innerHTML = `
    <div class="fieldgroup">
      <span class="fieldgroup__label">合作機構　這位客戶要跟誰一起約</span>
      ${options.length ? `
        <div class="chiprow noscroll-bar" role="group" aria-label="合作機構">
          ${options.map((t) => `
            <button class="chip chip--sm" type="button"
                    aria-pressed="${picked.has(t)}" data-partner="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
        <p class="field__hint">壓完表記得跟他們的專員說一聲。
          <b>不會產生任何待辦</b> —— 這顆丸子會跟著名字出現在壓表與待辦上。</p>` : `
        <p class="field__hint">還沒有合作機構。到設定 → 合作機構加一筆，之後就點得到了。</p>`}
      ${orphans.length ? `
        <p class="field__hint">主檔上已經沒有的：${esc(orphans.join('、'))}（照樣留著）</p>` : ''}
    </div>`;

  host.querySelectorAll('[data-partner]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const name = btn.dataset.partner;
      if (picked.has(name)) picked.delete(name);
      else picked.add(name);
      btn.setAttribute('aria-pressed', String(picked.has(name)));
      onChange?.(value());
    }),
  );

  return { value };
}
