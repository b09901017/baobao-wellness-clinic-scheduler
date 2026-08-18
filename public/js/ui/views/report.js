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
import { customerReport, overviewReport, toTSV, toCSV } from '../../domain/sheetReport.js';
import { todayISO, addDays } from '../../domain/dates.js';
import { esc } from '../components/form.js';
import * as message from '../components/message.js';
import { saveText, dated } from '../components/download.js';
import * as toast from '../toast.js';

/** 報表往回涵蓋多久的來訪。她的方案會籍是一年，涵蓋一年才看得到整份療程。 */
const LOOKBACK_DAYS = 400;

// 選了誰留著：她通常是一位一位貼，貼完回來換下一位。
let picked = 'overview';

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let data;
  try {
    data = await load();
  } catch (err) {
    el.innerHTML = `
      <p><a href="#/settings">← 設定</a></p>
      <div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  paint(el, data);
}

async function load() {
  const today = todayISO();
  const [customers, entitlementsBy, visits] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    visitsData.listBetween(addDays(today, -LOOKBACK_DAYS), addDays(today, LOOKBACK_DAYS)),
  ]);

  const visitsBy = {};
  for (const v of visits) (visitsBy[v.customerId] ??= []).push(v);

  return { today, customers, entitlementsBy, visitsBy };
}

function paint(el, data) {
  const { customers } = data;
  if (!customers.some((c) => c.id === picked)) picked = 'overview';

  const report = buildReport(data);
  const tsv = toTSV(report);

  el.innerHTML = `
    <p><a href="#/settings">← 設定</a></p>

    <section class="card">
      <h2 class="card__title">試算表報表</h2>
      <p class="muted">把資料排成試算表的樣子，複製之後在試算表選一格貼上就是一張表。
        單向 —— 在試算表上改東西不會回到 app，那份試算表現在是報表不是資料來源。</p>

      <label class="field">
        <span class="field__label">要哪一份</span>
        <select data-pick>
          <option value="overview"${picked === 'overview' ? ' selected' : ''}>總表（每位客戶一列）</option>
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

  message.wire(el, toast.info);
}

function buildReport(data) {
  const generatedAt = new Date().toLocaleString('zh-TW');

  if (picked === 'overview') {
    return overviewReport({
      customers: data.customers,
      entitlementsBy: data.entitlementsBy,
      visitsBy: data.visitsBy,
      today: data.today,
      generatedAt,
    });
  }

  const customer = data.customers.find((c) => c.id === picked);
  return customerReport({
    customer,
    entitlements: data.entitlementsBy[picked] ?? [],
    visits: data.visitsBy[picked] ?? [],
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

const isHeader = (rows, i) => rows[i][0] === '療程項目' || rows[i][0] === '姓名';
