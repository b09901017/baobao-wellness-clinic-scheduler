// LINE 回覆模板。設定 → 回覆模板。
//
// 她的原話（2026-09-04）：
//
// > 我需要一個地方可以一次修改所有回復的模板，可以放在設定那邊。
//
// 在這之前那六則的字寫死在 `domain/messages.js`，她想把「呦～」改成「喔～」
// 都要改程式。
//
// 規則一條都不在這裡：預設值與驗證在 `domain/messageTemplates.js`，
// 寫入在 `data/config.js`。這一層只負責畫面與把值傳過去
//（同 `ui/views/preferences.js` 的分工）。
//
// ## 沒有即時預覽
//
// 預覽要餵假資料，而假資料裡一定要有一個假名字 —— 而一個看起來像真人的
// 預覽會讓她以為那是某位客戶（`tests/no-secrets.test.js` 盯的就是這種東西）。
// 她的驗收方式本來就是「改完去待辦中心按一次複製」，那比預覽誠實。

import * as config from '../../data/config.js';
import {
  TEMPLATES, VAR_LABELS, MAX_TEMPLATE, defaultText, textFor, isCustom, validateAll,
} from '../../domain/messageTemplates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';

const esc = f.esc;

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let stored;
  try {
    // fresh：從別的裝置改過就要看到新的那一份
    stored = await config.getTemplates({ fresh: true });
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  paint(el, stored);
}

function paint(el, stored) {
  const changed = TEMPLATES.filter((t) => isCustom(t.id, stored)).length;

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <section class="card">
      <h2 class="card__title">LINE 回覆模板</h2>
      <p class="muted">按下複製之前產生的那幾句話。改完立刻生效，
        ${changed ? `目前改過 ${changed} 則。` : '目前都是預設值。'}</p>
      <div class="errors" data-errors hidden></div>

      ${TEMPLATES.map((t) => cardHtml(t, stored)).join('')}

      <div class="form__actions">
        <button class="btn btn--primary" type="button" data-save>儲存</button>
        <button class="btn" type="button" data-reset-all>全部回復預設</button>
      </div>
    </section>`;

  wire(el);
}

/**
 * 一則。抬頭、它在哪裡用得到、一個大框、一排點得到的變數丸子。
 *
 * 變數那一排點一下**插在游標處**（`insertAtCursor()`，跟備忘錄的 emoji 列
 * 同一支）—— 打字打到一半要加一個 `{month}` 時，接在最後面是錯的。
 */
function cardHtml(t, stored) {
  const custom = isCustom(t.id, stored);

  return `
    <div class="tplbox" data-tpl="${esc(t.id)}">
      <div class="tplbox__head">
        <span class="field__label">${esc(t.label)}</span>
        ${custom ? '<span class="notetag notetag--ok">已改過</span>' : ''}
        <span class="app__spacer"></span>
        ${custom
          ? `<button class="btn btn--sm" type="button" data-reset="${esc(t.id)}">回復預設</button>`
          : ''}
      </div>
      <p class="tplbox__where">${esc(t.where)}</p>

      <textarea class="tplbox__body" data-text="${esc(t.id)}" rows="4"
                maxlength="${MAX_TEMPLATE}"
                aria-label="${esc(t.label)}">${esc(textFor(t.id, stored))}</textarea>

      <div class="tplvars noscroll-bar" role="group" aria-label="插入變數">
        ${t.vars.map((v) => `
          <button class="chip chip--sm" type="button"
                  data-var="${esc(t.id)}" data-name="${esc(v)}"
                  title="${esc(VAR_LABELS[v] ?? v)}">{${esc(v)}}</button>`).join('')}
      </div>

      ${t.hint ? `<p class="tplbox__hint">${esc(t.hint)}</p>` : ''}
    </div>`;
}

function wire(el) {
  const read = () => Object.fromEntries(
    TEMPLATES.map((t) => [t.id, el.querySelector(`[data-text="${CSS.escape(t.id)}"]`)?.value ?? '']),
  );

  // 委派一次。整塊每次都重畫，所以不會愈掛愈多。
  el.querySelector('.card')?.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-var]');
    if (v) {
      const box = el.querySelector(`[data-text="${CSS.escape(v.dataset.var)}"]`);
      f.insertAtCursor(box, `{${v.dataset.name}}`);
      return;
    }

    const one = e.target.closest('[data-reset]');
    if (one) {
      // 逐則回復**不用二次確認**：她看得到那一格現在寫什麼，
      // 而按錯了就是把預設值再改回來。整份那一顆才問。
      const box = el.querySelector(`[data-text="${CSS.escape(one.dataset.reset)}"]`);
      if (box) box.value = defaultText(one.dataset.reset);
      return;
    }

    if (e.target.closest('[data-save]')) await save(el, read());
    if (e.target.closest('[data-reset-all]')) await resetAll(el);
  });
}

async function save(el, next) {
  const errors = validateAll(next);
  f.showErrors(el, errors);
  if (errors.length) {
    el.querySelector('[data-errors]')?.scrollIntoView({ block: 'center' });
    return;
  }

  try {
    await toast.withSaveState(() => config.saveTemplates(next), {
      success: '已儲存，下一則訊息就是新的字',
      key: 'templates:save',
    });
  } catch {
    return; /* withSaveState 已顯示錯誤與重試 */
  }
  await render(el);
}

async function resetAll(el) {
  const ok = await confirmAction({
    title: '全部回復預設？',
    consequences: [
      '六則都會變回出廠的那幾句',
      '你改過的字會不見，而且沒有復原（那是設定不是資料）',
      '只想改回其中一則的話，用那一則自己的「回復預設」',
    ],
    confirmLabel: '全部回復',
    danger: true,
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => config.saveTemplates({}), {
      success: '已回復預設值',
      key: 'templates:reset',
    });
  } catch {
    return; /* 已處理 */
  }
  await render(el);
}
