// 試算表報表。SPEC 第 4.8 節。
//
// 試算表從「資料來源」降級成「報表」：app 是唯一真相，這一頁單向把資料排成
// 她原本看習慣的樣子，複製或下載之後貼回試算表。**不做讀回來**，
// 雙向同步一定會打架。
//
// 為什麼是「產生報表讓她貼」而不是 Apps Script 定時抓 Firestore，
// 見 docs/adr/0010-sheet-sync-is-an-export-not-a-service.md。
//
// 排版與次數的算法全部在 domain/sheetReport.js，這一層只負責選要哪一份、
// 顯示預覽、複製與下載。

import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as configData from '../../data/config.js';
import * as tasksData from '../../data/tasks.js';
import * as sheetSync from '../../data/sheetSync.js';
import { customerReport, toTSV, toCSV } from '../../domain/sheetReport.js';
import { todayISO, addDays } from '../../domain/dates.js';
import { esc } from '../components/form.js';
import * as message from '../components/message.js';
import { saveText, dated } from '../components/download.js';
import * as toast from '../toast.js';
import { icon } from '../icons.js';

/** 報表往回涵蓋多久的來訪。她的方案會籍是一年，涵蓋一年才看得到整份療程。 */
const LOOKBACK_DAYS = 400;

// 選了誰留著：她通常是一位一位貼，貼完回來換下一位。
// 沒有總表 —— 她要的是「和我原本那個一樣」，而舊表從來沒有總表（2026-08-20）。
let picked = null;

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let data;
  try {
    data = await load();
  } catch (err) {
    el.innerHTML = `
      <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
      <div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  paint(el, data);
}

async function load() {
  const today = todayISO();
  const [customers, entitlementsBy, visits, tasks, courses, settings] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    visitsData.listBetween(addDays(today, -LOOKBACK_DAYS), addDays(today, LOOKBACK_DAYS)),
    tasksData.listAll(),
    // 連已刪除的課程一起讀：主檔把健檢刪掉，不代表做過的那幾次就不用配二返了
    configData.listAll('courses', { includeDeleted: true }),
    configData.getSettings(),
  ]);

  const visitsBy = {};
  for (const v of visits) (visitsBy[v.customerId] ??= []).push(v);

  const tasksBy = {};
  for (const t of tasks) (tasksBy[t.customerId] ??= []).push(t);

  return { today, customers, entitlementsBy, visitsBy, tasksBy, courses, settings };
}

function paint(el, data) {
  const { customers } = data;
  if (!customers.some((c) => c.id === picked)) picked = customers[0]?.id ?? null;

  const report = buildReport(data);
  const tsv = toTSV(report);

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>

    <section class="card">
      <h2 class="card__title">試算表報表</h2>
      <p class="muted">把資料排成試算表的樣子，複製之後在試算表選一格貼上就是一張表。
        單向 —— 在試算表上改東西不會回到 app，那份試算表現在是報表不是資料來源。</p>

      <label class="field">
        <span class="field__label">要哪一份</span>
        <select data-pick>
          ${customers
            .map(
              (c) => `<option value="${esc(c.id)}"${picked === c.id ? ' selected' : ''}>
                        ${esc(c.name)}</option>`,
            )
            .join('')}
        </select>
      </label>

      <p><button class="btn" type="button" data-csv>下載 CSV</button></p>
      <p class="muted">貼上之後記得把那張分頁設成保護，並留著第一列的提醒 ——
        她（或未來的你）看到那句話才不會回頭手動改試算表。</p>
    </section>

    ${message.box({
      id: 'sheet-tsv',
      text: tsv,
      label: `${report.name}・${report.rows.length} 列`,
      collapsed: true,
      buttonLabel: '複製，貼到試算表',
    })}

    ${syncCard(data)}

    <section class="card">
      <h3 class="card__title">預覽</h3>
      <div class="tablewrap">${previewHtml(report)}</div>
    </section>`;

  el.querySelector('[data-pick]').addEventListener('change', (e) => {
    picked = e.target.value;
    paint(el, data);
  });

  el.querySelector('[data-csv]').addEventListener('click', () => {
    saveText(dated(`排課系統報表-${report.name}`, 'csv'), toCSV(report), 'text/csv;charset=utf-8');
    toast.info('已下載。試算表可以直接匯入這個檔。');
  });

  el.querySelector('[data-sync-save]')?.addEventListener('click', () => saveSync(el, data));
  el.querySelector('[data-sync-now]')?.addEventListener('click', () => pushNow(el, data));

  message.wire(el, toast.info);
}

/**
 * 自動同步。上面那一段是「複製貼上」的手動路線，這一段是自動的。
 *
 * 兩條並存不是重複：自動的那條需要試算表那邊裝好指令碼，沒裝好、或她只是想
 * 臨時貼一份到別的地方時，手動那條照樣要能用。
 */
function syncCard({ settings }) {
  const sync = settings.sheetSync ?? { url: '', token: '' };
  const on = Boolean(sync.url && sync.token);
  const last = sheetSync.lastSyncedAt();

  return `
    <section class="card">
      <h3 class="card__title">自動同步到試算表</h3>
      <p class="muted">設定好之後，每次存檔安靜幾秒就會自己推一份過去，不用再手動貼。
        單向 —— 試算表上改的東西不會回到 app，下次同步就會被蓋掉。</p>
      <p class="${on ? 'muted' : ''}">
        ${on
          ? `目前：<b>開著</b>。上次同步 ${last ? esc(new Date(last).toLocaleString('zh-TW')) : '還沒推過'}${
            sheetSync.isDirty() ? '，<b>有資料還沒推上去</b>' : ''}`
          : '目前：<b>沒有開</b>。兩個欄位都填了才會開始推。'}
      </p>

      <label class="field">
        <span class="field__label">網頁應用程式網址</span>
        <input type="url" data-sync-url value="${esc(sync.url ?? '')}"
          placeholder="https://script.google.com/macros/s/…/exec">
        <span class="field__hint">試算表 → 擴充功能 → Apps Script，貼上
          <code>sheets/readonly-report.gs</code> 後部署成網頁應用程式，把網址貼來這裡。</span>
      </label>

      <label class="field">
        <span class="field__label">密鑰</span>
        <input type="password" data-sync-token value="${esc(sync.token ?? '')}"
          autocomplete="off">
        <span class="field__hint">要跟指令碼屬性裡那組 <code>SYNC_TOKEN</code> 一模一樣。
          那個網址是公開的，擋住不速之客的就是這一串。</span>
      </label>

      <p class="form__actions">
        <button class="btn" type="button" data-sync-save>儲存設定</button>
        <button class="btn btn--primary" type="button" data-sync-now
          ${on ? '' : 'disabled'}>立刻推一次</button>
      </p>
    </section>`;
}

async function saveSync(el, data) {
  const url = el.querySelector('[data-sync-url]').value.trim();
  const token = el.querySelector('[data-sync-token]').value.trim();

  toast.saving('儲存中…');
  try {
    await configData.saveSettings({ sheetSync: { url, token } });
  } catch (err) {
    toast.failed(`儲存失敗：${err.message}`);
    return;
  }
  toast.info(url && token ? '設定好了。下次存檔就會自己推一份過去。' : '已清掉，自動同步關了。');
  data.settings = { ...data.settings, sheetSync: { url, token } };
  paint(el, data);
}

async function pushNow(el, data) {
  toast.saving('推送中…');
  const result = await sheetSync.push();

  if (result.ok) toast.info(`推好了，試算表更新了 ${result.sheets ?? ''} 張分頁`);
  else toast.failed(result.error ?? result.skipped ?? '推不出去');

  paint(el, data);
}

function buildReport(data) {
  const generatedAt = new Date().toLocaleString('zh-TW');
  const customer = data.customers.find((c) => c.id === picked);

  return customerReport({
    customer,
    entitlements: data.entitlementsBy[picked] ?? [],
    visits: data.visitsBy[picked] ?? [],
    tasks: data.tasksBy[picked] ?? [],
    courses: data.courses,
    generatedAt,
  });
}

/** 預覽用真的表格：貼上去長什麼樣，這裡就要長什麼樣。 */
function previewHtml({ rows }) {
  return `
    <table class="sheet">
      ${rows
        .map(
          (row, i) => `<tr>${row
            .map((cell) => `<${i === 0 || isHeader(rows, i) ? 'th' : 'td'}>${esc(cell)}</${
              i === 0 || isHeader(rows, i) ? 'th' : 'td'
            }>`)
            .join('')}</tr>`,
        )
        .join('')}
    </table>`;
}

const isHeader = (rows, i) => rows[i][0] === '療程項目';
