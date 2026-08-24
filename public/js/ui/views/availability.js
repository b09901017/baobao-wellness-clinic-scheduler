// 本輪可用性的收集與檢視。SPEC 第 4.3、8.5 節。掛在客戶詳情底下。
//
// 這一頁的設計只有一個重點：**原文永遠比解析結果大**。
//
// 收集有兩個來源：她自己記的，和客戶自己填表單填的（`source: 'form'`，
// 見 ADR-0031 與 ADR-0032）。兩種在這一頁長得一樣、改起來也一樣 ——
// 差別只有一顆徽章，因為客戶自己講的話比她轉述的可信，那件事值得看得見。
// 原文用正常字級顯示在最上面，解析出來的規則排在它下面，而且明講那是「系統讀成」，
// 讓她一眼看得出系統有沒有讀錯。看不懂的句子也要列出來 —— 安靜地少一條規則，
// 她會以為系統知道，其實不知道。

import * as data from '../../data/customers.js';
import {
  parseAvailability, describeRule, collectionState, currentCollection,
  validateCollection, availableDates,
  manualRule, mergeRules, validateRule,
} from '../../domain/availability.js';
import { todayISO, addMonths, lastDayOf, shortDate } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { icon } from '../icons.js';
import { pushScreen } from '../nav.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

const esc = f.esc;

const STATE_BADGE = {
  valid: ['badge--ok', '有效'],
  expiring: ['badge--soon', '快過期'],
  expired: ['badge--overdue', '已過期'],
  upcoming: ['badge', '還沒開始'],
  none: ['badge', '沒有有效期'],
};

// ---------- 客戶詳情裡的區塊 ----------

export function sectionHtml(collections, today) {
  const current = currentCollection(collections, today);
  const others = collections.filter((c) => c.id !== current?.id);

  return `
    <div class="section">
      <h2 class="section__title">不能的時間</h2>
      ${current
        ? ''
        : '<span class="badge badge--overdue">該重問了</span>'}
      <button class="section__more" type="button" data-add-avail>記一次</button>
    </div>

    ${current
      ? collectionCard(current, today, true)
      : `<p class="muted" style="margin: 0">${collections.length
          ? '收集到的都已經過期了。過期的條件不能拿來排班，要重新問一次。'
          : '還沒問過這位客戶哪幾天方便。'}</p>`}

    ${others.length
      ? `<details style="margin-top: var(--space-2)">
           <summary class="muted">以前問過的 ${others.length} 次</summary>
           ${others.map((c) => collectionCard(c, today, false)).join('')}
         </details>`
      : ''}`;
}

function collectionCard(record, today, isCurrent) {
  const { state, days } = collectionState(record, today);
  const [badgeClass, badgeText] = STATE_BADGE[state] ?? STATE_BADGE.none;
  const rules = record.rules ?? [];
  const free = record.validFrom && record.validTo
    ? availableDates(rules, record.validFrom, record.validTo).length
    : null;

  return `
    <div class="pool ${state === 'expired' ? 'pool--stale' : ''}">
      <div class="pool__head">
        <span>${esc(record.validFrom ?? '?')} 到 ${esc(record.validTo ?? '?')}</span>
        <span>
          ${record.source === 'form'
            ? '<span class="badge badge--ok">客戶自己填的</span>'
            : ''}
          <span class="badge ${badgeClass}">${badgeText}${
            state === 'expired' ? ` ${-days} 天` : ''
          }</span>
        </span>
      </div>

      <p class="ban__raw" style="margin-top: var(--space-2)">${esc(record.rawText ?? '')}</p>
      <p class="muted dim" style="margin: var(--space-1) 0 0; font-size: var(--text-2xs)">
        ${esc(record.collectedAt ?? '?')} 問的${
          free === null ? '' : `・這段期間可用 ${free} 天`
        }</p>

      ${rules.length
        ? `<ul class="muted" style="margin: var(--space-2) 0 0; padding-left: var(--space-4)">
             ${rules.map((r) => `<li>${esc(describeRule(r))}</li>`).join('')}</ul>
           <p class="muted dim" style="margin: var(--space-1) 0 0; font-size: var(--text-2xs)">
             上面那幾條是系統從原文讀出來的。讀錯了以原文為準。</p>`
        : `<p class="muted dim" style="margin: var(--space-1) 0 0; font-size: var(--text-2xs)">
             沒有解析出任何規則，以上面的原文為準。</p>`}

      ${record.followupNote ? `<p class="muted">追蹤：${esc(record.followupNote)}</p>` : ''}

      ${isCurrent || state !== 'expired'
        ? `<p style="margin: var(--space-2) 0 0">
             <button class="btn btn--sm" type="button"
                     data-edit-avail="${esc(record.id)}">編輯</button></p>`
        : ''}
    </div>`;
}

export function wireSection(ctx) {
  ctx.el.querySelector('[data-add-avail]')?.addEventListener('click', () => paintForm(ctx, null));

  ctx.el.querySelectorAll('[data-edit-avail]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(ctx, ctx.availability.find((c) => c.id === btn.dataset.editAvail)),
    ),
  );
}

// ---------- 收集表單 ----------

/** 她問的永遠是「下個月」，所以有效期預設就是下個月整月。 */
function defaultRange(today) {
  const first = `${addMonths(today, 1).slice(0, 7)}-01`;
  const [y, m] = first.split('-').map(Number);
  return { validFrom: first, validTo: `${first.slice(0, 7)}-${String(lastDayOf(y, m)).padStart(2, '0')}` };
}

function paintForm(ctx, record, draft = null) {
  const { el, customer } = ctx;
  const today = todayISO();
  const isNew = !record?.id;

  const c = draft ?? record ?? {
    rawText: '',
    collectedAt: today,
    ...defaultRange(today),
    followupNote: '',
    rules: [],
  };

  // 每次重畫都重新解析，讓她邊打邊看到系統讀成什麼
  const parsed = parseAvailability(c.rawText, { year: Number((c.validFrom ?? today).slice(0, 4)) });
  const rules = c.rules ?? [];

  el.innerHTML = `
    <a class="backlink" href="#" data-back>${icon('left', { size: 17 })}${esc(customer.name)}</a>
    <section class="card">
      <h2 class="card__title">${isNew ? '記一次詢問結果' : '編輯這次的詢問結果'}</h2>
      <div class="errors" data-errors hidden></div>

      <form data-form>
        ${f.textarea({
          name: 'rawText', label: '客戶原話', value: c.rawText, rows: 4,
          placeholder: '9月禮拜一不行，9/17、9/18、9/22–24 不行',
          hint: '照抄就好，不用整理。原文永遠留著，解析錯了以原文為準。',
        })}

        <p><button class="btn" type="button" data-reparse>用原文重新解析</button></p>

        ${rulesBlock(rules, parsed, c)}

        ${f.date({ name: 'collectedAt', label: '什麼時候問的', value: c.collectedAt })}
        ${f.date({
          name: 'validFrom', label: '有效期起', value: c.validFrom,
          hint: '預設是下個月整月。過了迄日這份就會變灰，並提示該重問了。',
        })}
        ${f.date({ name: 'validTo', label: '有效期迄', value: c.validTo })}
        ${f.text({
          name: 'followupNote', label: '追蹤備註', value: c.followupNote ?? '',
          placeholder: '禮拜一再確認一次', hint: '選填。不會被解析成規則。',
        })}

        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>
    ${isNew ? '' : dangerZone()}`;

  // 原地換掉整頁 → 疊一層。這一頁重畫自己很多次（重新解析、加一條規則、
  // 刪一條），所以 pushScreen 要一把 key，不然按五次返回鍵才回得去。
  const back = pushScreen('availability-form', () => ctx.back());
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  const form = el.querySelector('[data-form]');
  const read = () => ({ ...c, ...readForm(form) });

  el.querySelector('[data-reparse]').addEventListener('click', () => {
    const next = read();
    const fresh = parseAvailability(next.rawText, {
      year: Number((next.validFrom ?? today).slice(0, 4)),
    });
    // 自己加的那幾條本來就不在原文的解析結果裡（那正是她手動加的原因），
    // 整份取代等於每次重新解析都清掉一次，而且不會有任何訊息。
    paintForm(ctx, record, { ...next, rules: mergeRules(rules, fresh.rules) });
  });

  el.querySelectorAll('[data-drop-rule]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = read();
      next.rules = rules.filter((_, i) => i !== Number(btn.dataset.dropRule));
      paintForm(ctx, record, next);
    }),
  );

  el.querySelector('[data-take-parsed]')?.addEventListener('click', () => {
    const next = read();
    paintForm(ctx, record, { ...next, rules: mergeRules(rules, parsed.rules) });
  });

  // 自己加一條。解析器一定會漏，漏了的時候原本唯一的辦法是改寫原文，
  // 而原文照抄是 SPEC 第 4.3 節的硬性要求。
  el.querySelector('[data-add-rule]')?.addEventListener('click', () => {
    const next = read();
    const box = el.querySelector('[data-new-rule]');
    const rule = manualRule({
      kind: box.querySelector('[name="ruleKind"]').value,
      weekday: box.querySelector('[name="ruleWeekday"]').value,
      date: box.querySelector('[name="ruleDate"]').value || null,
      from: box.querySelector('[name="ruleFrom"]').value || null,
      to: box.querySelector('[name="ruleTo"]').value || null,
      partOfDay: box.querySelector('[name="rulePart"]').value,
    });

    const errors = validateRule(rule ?? {});
    if (errors.length) {
      f.showErrors(el, errors.map((why) => `自己加的那一條：${why}`));
      return;
    }
    f.showErrors(el, []);
    paintForm(ctx, record, { ...next, rules: [...rules, rule] });
  });

  // 種類換了要換欄位（星期／單日／區間各要填的不一樣），不重畫整張表單，
  // 免得她上面打到一半的原文被清掉。
  el.querySelector('[name="ruleKind"]')?.addEventListener('change', (e) => {
    for (const box of el.querySelectorAll('[data-for-kind]')) {
      box.hidden = !box.dataset.forKind.split(' ').includes(e.target.value);
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(ctx, record, { ...read(), rules });
  });

  if (!isNew) wireDangerZone(ctx, record);
}

function readForm(form) {
  const v = f.readForm(form);
  return {
    rawText: String(v.rawText ?? ''),
    collectedAt: v.collectedAt || null,
    validFrom: v.validFrom || null,
    validTo: v.validTo || null,
    followupNote: String(v.followupNote ?? '').trim() || null,
  };
}

/**
 * 解析結果。刻意排在原文下面而且標明「系統讀成」——
 * 這是她唯一能發現解析錯了的地方。
 */
function rulesBlock(rules, parsed, c) {
  const differs = JSON.stringify(rules) !== JSON.stringify(parsed.rules);

  return `
    <fieldset class="field">
      <legend class="field__label">系統讀成<span class="muted"> ${rules.length} 條</span></legend>

      ${rules.length
        ? rules
            .map(
              (r, i) => `
          <div class="row">
            <span class="row__main">${esc(describeRule(r))}${
              r.manual ? '<span class="badge">自己加的</span>' : ''
            }</span>
            <button class="btn" type="button" data-drop-rule="${i}">${
              r.manual ? '刪掉' : '讀錯了，刪掉'
            }</button>
          </div>`,
            )
            .join('')
        : '<p class="muted">還沒有規則。上面打完原文之後按「用原文重新解析」。</p>'}

      ${parsed.unparsed.length
        ? `<p class="muted">這幾句看不懂，沒有變成規則（原文仍然留著）：</p>
           <ul class="muted">${parsed.unparsed.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
           <p class="muted">可以換個寫法再解析一次，例如「9/17 不行」「禮拜一不行」。</p>`
        : ''}

      ${differs
        ? `<p class="muted">原文解析出來的是 ${parsed.rules.length} 條，跟目前這份不一樣。</p>
           <p><button class="btn" type="button" data-take-parsed>改用解析結果</button></p>`
        : ''}

      ${newRuleBox()}

      ${rules.length && c.validFrom && c.validTo
        ? `<p class="muted">${esc(shortDate(c.validFrom))} 到 ${esc(shortDate(c.validTo))}
             這段期間可用 ${availableDates(rules, c.validFrom, c.validTo).length} 天。</p>`
        : ''}
    </fieldset>`;
}

/**
 * 「自己加一條」。
 *
 * 解析器漏掉一句時，原本唯一的辦法是把原文改寫成它認得的講法 —— 而 SPEC 第 4.3 節
 * 要求原文照抄、永遠保留。這一區是那條路的替代品：**補在規則上，原文一個字都不動。**
 *
 * 四種規則要填的欄位不一樣，用 hidden 切換而不是重畫整張表單 ——
 * 重畫會把她上面打到一半的原文洗掉。
 */
function newRuleBox() {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    .map((name, i) => ({ value: String(i), label: `禮拜${name}` }));

  return `
    <details class="field" data-new-rule>
      <summary>自己加一條（解析器漏掉的時候用，原文不會被改動）</summary>

      ${f.select({
        name: 'ruleKind', label: '種類', value: 'exclude_weekday',
        options: [
          { value: 'exclude_weekday', label: '每個禮拜某天不行' },
          { value: 'exclude_date', label: '某一天不行' },
          { value: 'exclude_range', label: '某段期間不行' },
          { value: 'prefer', label: '某天方便（喜好）' },
        ],
      })}

      <div data-for-kind="exclude_weekday prefer">
        ${f.select({ name: 'ruleWeekday', label: '星期', value: '1', options: weekdays })}
      </div>

      <div data-for-kind="exclude_date prefer" hidden>
        ${f.date({
          name: 'ruleDate', label: '日期',
          hint: '「某天方便」填了日期就以日期為準，不填就用上面的星期。',
        })}
      </div>

      <div data-for-kind="exclude_range" hidden>
        ${f.date({ name: 'ruleFrom', label: '從' })}
        ${f.date({ name: 'ruleTo', label: '到' })}
      </div>

      <div data-for-kind="exclude_weekday exclude_date prefer">
        ${f.select({
          name: 'rulePart', label: '整天還是半天', value: '',
          options: [
            { value: '', label: '整天' },
            { value: 'am', label: '只有上午' },
            { value: 'pm', label: '只有下午' },
          ],
        })}
      </div>

      <p><button class="btn" type="button" data-add-rule>加進去</button></p>
    </details>`;
}

async function submit(ctx, record, next) {
  const errors = validateCollection(next);
  f.showErrors(ctx.el, errors);
  if (errors.length) return;

  const payload = {
    rawText: next.rawText.trim(),
    collectedAt: next.collectedAt,
    validFrom: next.validFrom,
    validTo: next.validTo,
    followupNote: next.followupNote,
    rules: next.rules ?? [],
  };

  try {
    if (record?.id) {
      await toast.withSaveState(() => data.updateAvailability(ctx.id, record.id, payload), {
        success: '已儲存',
      });
    } else {
      await toast.withSaveState(() => data.createAvailability(ctx.id, payload), {
        success: '已記錄',
      });
    }
    ctx.back();
  } catch {
    /* withSaveState 已顯示錯誤與重試 */
  }
}

function dangerZone() {
  return `
    <section class="card danger">
      <h2 class="card__title">刪除這次的詢問結果</h2>
      <p class="muted">問錯人、記錯了才用刪除。過期的不用刪 —— 它會自己變灰，
        而且留著看得出上次是什麼時候問的。</p>
      <p><button class="btn btn--danger" type="button" data-del-avail>刪除</button></p>
    </section>`;
}

function wireDangerZone(ctx, record) {
  ctx.el.querySelector('[data-del-avail]').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: '刪除這次的詢問結果？',
      consequences: [
        '原文與解析出來的規則都會一起收起來',
        '這是標記刪除，資料不會真的消失',
        '如果只是過期了，不用刪 —— 它會自己變灰',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => data.removeAvailability(ctx.id, record.id), {
        success: '已刪除',
      });
      ctx.back();
    } catch {
      /* 已處理 */
    }
  });
}
