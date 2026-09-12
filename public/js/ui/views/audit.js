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
import * as customersData from '../../data/customers.js';
import {
  describeAction, changedFields, formatField, describeEvent, groupByDay, opOf,
} from '../../domain/audit.js';
import { esc } from '../components/form.js';
import { icon } from '../icons.js';
import { tip } from '../components/tip.js';

/** 整頁一次載入幾筆。她要找的通常是剛剛發生的事，不是三個月前的。 */
const PAGE_SIZE = 100;

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let events;
  // 客戶名單只是用來把 id 換成名字（額度與本輪可用性身上沒有名字，
  // 只有路徑上有 id）。**它讀不到不可以擋住稽核** —— 稽核才是這一頁的主體，
  // 少了名字那幾列就退回不講名字，那是 `describeParts()` 本來就有的行為。
  let nameOf = null;
  try {
    const [rows, customers] = await Promise.all([
      auditData.listRecent(PAGE_SIZE),
      customersData.list().catch(() => []),
    ]);
    events = rows;
    const byId = new Map(customers.map((c) => [c.id, c.name]));
    nameOf = (id) => byId.get(id) ?? null;
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
      <h2 class="card__title">稽核紀錄<span class="muted"> 最近 ${events.length} 筆</span>${tip(
        '每一次寫入都會留下一筆，改不掉也刪不掉。這裡只能看 —— 要改回去請到那筆資料上編輯，'
        + '那樣才會再留一筆紀錄。')}</h2>
    </section>
    ${events.length ? listHtml(events, { nameOf }) : '<p class="muted">還沒有任何變更紀錄。</p>'}`;
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
        // **這一段不收進泡泡**：它長在一摺 `<details>` 底下（`sectionHtml()`），
        // 展開才看得到，本來就不是常駐說明；而那一摺的 `<summary>` 是互動元素，
        // 裡面放 `tip()` 產出的 button 是內容模型的錯。
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

/**
 * 一組稽核列。整頁、客戶詳情底下的「變更紀錄」面板都用它，不要各畫一份。
 *
 * @param {object[]} events
 * @param {{nameOf?: (customerId: string) => (string|null)}} [ctx]
 *   id → 名字。沒傳的話講不出名字的那幾列就不講（`domain/audit.js` 的規矩：
 *   讀不到名字就不編一個）。
 */
export function listHtml(events, ctx = {}) {
  const days = groupByDay(events, dayOf);
  return days.map((d) => `
    <div class="audit__day">${esc(dayLabel(d.day))}</div>
    <div class="audit">${d.events.map((e) => rowHtml(e, ctx)).join('')}</div>`).join('');
}

/**
 * 一列 = 一句話 + 時間。**細節收在 `<details>` 裡。**
 *
 * 她打開這一頁是在問「我剛剛做了什麼」或「這筆怎麼變成這樣的」，
 * 兩個問題都是先掃過去、停在可疑的那一列，才想看細節。
 * 每一列都攤開路徑與欄位表的話，那一停就要捲三頁。
 */
function rowHtml(event, ctx = {}) {
  const fields = changedFields(event);
  const line = describeEvent(event, ctx);

  return `
    <details class="audit__row">
      <summary class="audit__head">
        <span class="audit__time">${esc(formatTime(event.at))}</span>
        <span class="audit__what">${esc(line ?? describeAction(event.action))}</span>
      </summary>
      <div class="audit__detail">
        ${line ? `<div class="muted">${esc(describeAction(event.action))}</div>` : ''}
        ${event.note ? `<div class="muted">${esc(event.note)}</div>` : ''}
        ${fields.length
    ? `<ul class="audit__fields">${fields.map((f) => fieldHtml(f, opOf(event))).join('')}</ul>`
    : '<p class="muted">沒有欄位變動。</p>'}
        <div class="audit__path">${esc(event.targetPath ?? '')}</div>
      </div>
    </details>`;
}

/**
 * 新增的那幾則**不畫箭頭**：新增之前本來就沒有值，一整排「（空的） →」
 * 是這一頁最沒有資訊量的東西，而它剛好佔掉每一列最左邊最顯眼的位置。
 */
function fieldHtml(field, op) {
  const to = `<b>${esc(formatField(field.key, field.after))}</b>`;
  return `
    <li>
      <span class="audit__field">${esc(field.label)}</span>
      ${op === 'create' ? to : `<span class="muted">${esc(formatField(field.key, field.before))} → </span>${to}`}
    </li>`;
}

/** Firestore Timestamp 或字串都可能。時間本身就是稽核的價值，不能顯示成「未知」就算了。 */
function formatTime(at) {
  const ms = auditData.millisOf(at);
  if (!ms) return '？？:？？';
  return new Date(ms).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 'YYYY-MM-DD'，讀不出時間的收成同一組。 */
function dayOf(event) {
  const ms = auditData.millisOf(event.at);
  return ms ? isoDay(new Date(ms)) : '';
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 今天、昨天，再遠就寫日期 —— 她想的是「那是今天還是昨天的事」。 */
function dayLabel(day) {
  if (!day) return '（沒有時間）';
  const today = isoDay(new Date());
  const yesterday = isoDay(new Date(Date.now() - 86400000));
  if (day === today) return '今天';
  if (day === yesterday) return '昨天';
  const [, m, d] = day.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}
