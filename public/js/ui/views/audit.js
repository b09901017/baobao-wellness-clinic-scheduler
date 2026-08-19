// 稽核檢視。SPEC 第 6.2 節。
//
// 兩種用法共用同一組列：
//   - 整頁（#/settings/audit）：全庫最近的變更，出事時從這裡往回找
//   - 一段（客戶詳情頁的「變更紀錄」）：只有這位客戶相關的變更
//
// 這一頁完全唯讀。稽核是 append-only，Rules 直接禁止 update 與 delete，
// 畫面上也不該出現任何看起來能改它的東西。
// 要把某一筆改回去請走復原或直接編輯那筆資料，那樣才會再留一則稽核。

import * as auditData from '../../data/audit.js';
import { describeAction, describeTarget, changedFields, formatValue } from '../../domain/audit.js';
import { esc } from '../components/form.js';
import { icon } from '../icons.js';

/** 整頁一次載入幾筆。她要找的通常是剛剛發生的事，不是三個月前的。 */
const PAGE_SIZE = 100;

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let events;
  try {
    events = await auditData.listRecent(PAGE_SIZE);
  } catch (err) {
    el.innerHTML = `
      <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
      <div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果訊息裡有建立索引的連結，點它建好之後再回來。</p></div>`;
    return;
  }

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <section class="card">
      <h2 class="card__title">稽核紀錄<span class="muted"> 最近 ${events.length} 筆</span></h2>
      <p class="muted">每一次寫入都會留下一筆，改不掉也刪不掉。
        這裡只能看 —— 要改回去請到那筆資料上編輯，那樣才會再留一筆紀錄。</p>
    </section>
    ${events.length ? listHtml(events) : '<p class="muted">還沒有任何變更紀錄。</p>'}`;
}

/**
 * 客戶詳情頁那一段。SPEC 第 8.5 節的「變更紀錄」。
 *
 * 刻意做成展開才載入：一位客戶的稽核要查他本人、額度、可用性再加上每一筆來訪，
 * 是這一頁最貴的一次讀取，而她十次打開這一頁有九次是在看「還剩幾次」。
 */
export function sectionHtml() {
  return `
    <details class="card" data-audit-section>
      <summary class="card__title">變更紀錄</summary>
      <div data-audit-body><p class="muted">展開時才載入。</p></div>
    </details>`;
}

/**
 * @param {HTMLElement} el 詳情頁的容器
 * @param {() => Promise<object[]>} load 展開時才會被呼叫
 */
export function wireSection(el, load) {
  const details = el.querySelector('[data-audit-section]');
  if (!details) return;
  const body = details.querySelector('[data-audit-body]');
  let loaded = false;

  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    loaded = true;
    body.innerHTML = '<p class="muted">載入中…</p>';
    try {
      const events = await load();
      body.innerHTML = events.length
        ? `${listHtml(events)}
           <p class="muted">收的是這位客戶本人、他的額度、可用性與來訪的變更。
             任務的變更在它所屬的來訪底下看得到。</p>`
        : '<p class="muted">沒有變更紀錄。</p>';
    } catch (err) {
      // 失敗要能再試一次，所以把旗標放回去
      loaded = false;
      body.innerHTML = `<p>讀取失敗：${esc(err.message)}</p>
        <p class="muted">收起來再展開一次就會重試。</p>`;
    }
  });
}

/** 一組稽核列。整頁、客戶詳情底下的「變更紀錄」面板都用它，不要各畫一份。 */
export function listHtml(events) {
  return `<div class="audit">${events.map(rowHtml).join('')}</div>`;
}

function rowHtml(event) {
  const fields = changedFields(event);

  return `
    <div class="audit__row">
      <div class="audit__head">
        <span class="audit__what">${esc(describeAction(event.action))}</span>
        <span class="muted">${esc(formatWhen(event.at))}</span>
      </div>
      <div class="muted">${esc(describeTarget(event.targetPath))}・${esc(event.targetPath ?? '')}</div>
      ${event.note ? `<div class="muted">${esc(event.note)}</div>` : ''}
      ${fields.length
        ? `<ul class="audit__fields">${fields.map(fieldHtml).join('')}</ul>`
        : '<p class="muted">沒有欄位變動。</p>'}
    </div>`;
}

function fieldHtml(field) {
  return `
    <li>
      <span class="audit__field">${esc(field.label)}</span>
      <span class="muted">${esc(formatValue(field.before))} → </span>
      <b>${esc(formatValue(field.after))}</b>
    </li>`;
}

/** Firestore Timestamp 或字串都可能。時間本身就是稽核的價值，不能顯示成「未知」就算了。 */
function formatWhen(at) {
  const ms = auditData.millisOf(at);
  return ms ? new Date(ms).toLocaleString('zh-TW') : '（沒有時間）';
}
