// 舊資料匯入。SPEC 第 6.10 節：先 dry-run 產出比對報告，人工確認後才真的寫入。
//
// 這一頁刻意分成兩段，中間隔一顆按鈕：貼上 → 看報告 → 確認 → 寫入。
// 一鍵匯入是最危險的設計 —— 20 張工作表一次進去，錯了她也不知道錯在哪一張。
//
// 為什麼是貼上而不是接 Google Sheets API，見
// docs/adr/0012-legacy-import-is-a-paste-not-an-integration.md
//
// 解析與判斷全部在 domain/legacyImport.js，寫入在 data/legacyImport.js，
// 這一層只負責收文字、畫報告、把結果講清楚。

import * as importer from '../../data/legacyImport.js';
import { parseSheet, planForSheet, summarize, reportText } from '../../domain/legacyImport.js';
import { todayISO } from '../../domain/dates.js';
import { esc } from '../components/form.js';
import { saveText, dated } from '../components/download.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

/**
 * 貼進來的工作表。**只放在記憶體裡**，重新整理就沒了 ——
 * 這裡面是真實的客戶姓名與療程紀錄，沒有理由讓它留在瀏覽器的儲存空間裡過夜。
 * 畫面上會講明白這件事。
 * @type {{sheetName: string, text: string}[]}
 */
let pasted = [];

/** 表頭的日期大多沒有年份，要補哪一年。 */
let baseYear = Number(todayISO().slice(0, 4));

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let ctx;
  try {
    ctx = await importer.loadContext();
  } catch (err) {
    el.innerHTML = `
      <p><a href="#/settings">← 設定</a></p>
      <div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  paint(el, ctx);
}

function plansOf(ctx) {
  return pasted.map((sheet) =>
    planForSheet(parseSheet(sheet.text, { sheetName: sheet.sheetName }), {
      ...ctx,
      year: baseYear,
      importedAt: new Date().toISOString(),
    }),
  );
}

function paint(el, ctx) {
  const plans = plansOf(ctx);
  const s = summarize(plans);

  el.innerHTML = `
    <p><a href="#/settings">← 設定</a></p>

    <section class="card">
      <h2 class="card__title">舊資料匯入</h2>
      <p class="muted">在試算表裡打開一位客戶的工作表，全選複製，貼進下面的框。
        一次貼一張，貼完看報告，確認了才會真的寫進去。</p>
      <p class="muted">貼進來的東西只留在這個畫面上，重新整理就沒了 ——
        裡面是客戶的姓名與療程紀錄，不會存進這台裝置。</p>

      <label class="field">
        <span class="field__label">沒有寫年份的日期算哪一年</span>
        <input type="number" data-year value="${baseYear}" min="2000" max="2100" step="1">
        <span class="field__hint">舊表的表頭大多只寫「8/11」。年份挑錯，那一整批來訪就會落到別的地方去。</span>
      </label>

      <label class="field">
        <span class="field__label">工作表名稱（選填，幫你自己認）</span>
        <input type="text" data-name placeholder="例：客戶A">
      </label>

      <label class="field">
        <span class="field__label">貼在這裡</span>
        <textarea data-text rows="6" placeholder="從試算表全選複製後貼上"></textarea>
      </label>

      <p class="form__actions">
        <button class="btn btn--primary" type="button" data-add>加進待匯入</button>
      </p>
    </section>

    ${pasted.length ? sheetsCard(plans) : ''}
    ${pasted.length ? reportCard(plans, s) : ''}`;

  el.querySelector('[data-add]')?.addEventListener('click', () => add(el, ctx));
  el.querySelector('[data-year]')?.addEventListener('change', (e) => {
    const n = Number(e.target.value);
    if (Number.isInteger(n) && n >= 2000 && n <= 2100) baseYear = n;
    paint(el, ctx);
  });

  el.querySelectorAll('[data-drop]').forEach((btn) =>
    btn.addEventListener('click', () => {
      pasted.splice(Number(btn.dataset.drop), 1);
      paint(el, ctx);
    }),
  );

  el.querySelector('[data-download]')?.addEventListener('click', () =>
    saveText(dated('舊資料匯入比對報告', 'txt'), currentReport(plans)),
  );
  el.querySelector('[data-run]')?.addEventListener('click', () => run(el, ctx, plans, s));
}

function currentReport(plans) {
  return reportText(plans, { generatedAt: new Date().toLocaleString('zh-TW'), year: baseYear });
}

function add(el, ctx) {
  const text = el.querySelector('[data-text]').value;
  if (!text.trim()) {
    toast.info('框裡沒有東西');
    return;
  }
  const sheetName = el.querySelector('[data-name]').value.trim();
  pasted.push({ sheetName, text });
  paint(el, ctx);
}

function sheetsCard(plans) {
  return `
    <section class="card">
      <h2 class="card__title">已經貼進來的（${plans.length} 張）</h2>
      <ul class="link-list">
        ${plans
          .map(
            (p, i) => `<li><div class="row">
              <div class="row__main">
                <div class="row__title">${esc(p.customerName || '（沒有名字）')}</div>
                <div class="muted">${
                  p.skip
                    ? esc(p.skip)
                    : `額度 ${p.counts.entitlements}、來訪 ${p.counts.visits}`
                      + `、時段 ${p.counts.slots}`
                      + (p.problems.length ? `，${p.problems.length} 處要看一下` : '')
                }</div>
              </div>
              <button class="btn" type="button" data-drop="${i}">移除</button>
            </div></li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

function reportCard(plans, s) {
  return `
    <section class="card">
      <h2 class="card__title">比對報告</h2>
      <p>會建立 <b>${s.customers}</b> 位客戶、<b>${s.entitlements}</b> 筆額度、
        <b>${s.visits}</b> 筆來訪（${s.slots} 個時段）。</p>
      ${s.skipped.length
        ? `<p class="muted">整張跳過 ${s.skipped.length} 張：${
            s.skipped.map((x) => esc(x.customerName || x.sheetName)).join('、')
          }</p>`
        : ''}
      <p class="${s.problems ? '' : 'muted'}">要看一下的地方：<b>${s.problems}</b> 處。
        這些不會擋下匯入，但匯進去之後那幾筆會少東西。</p>

      <pre class="report">${esc(currentReport(plans))}</pre>

      <p class="form__actions">
        <button class="btn" type="button" data-download>下載報告</button>
        <button class="btn btn--primary" type="button" data-run
          ${s.customers ? '' : 'disabled'}>開始匯入</button>
      </p>
      <p class="muted">匯入的每一筆都會標上來源，之後查得出是從哪一張工作表進來的。
        來訪一律標成已完成，而且沒有時間、器材、診間與治療師 —— 舊表沒有記過那些。</p>
    </section>`;
}

async function run(el, ctx, plans, s) {
  const ok = await confirmAction({
    title: '開始匯入',
    consequences: [
      `建立 ${s.customers} 位客戶、${s.entitlements} 筆額度、${s.visits} 筆來訪`,
      '來訪一律是已完成，時間、器材、診間、治療師都不詳（舊表沒有記過）',
      '不會產生任何待辦任務 —— 那些掛號在舊系統早就做完了',
      s.problems ? `報告上有 ${s.problems} 處沒讀懂，那幾筆會少東西` : '報告上沒有讀不懂的地方',
      '每位客戶各自寫入，一位失敗不影響其他人',
    ],
    confirmLabel: '匯入',
  });
  if (!ok) return;

  toast.saving('匯入中…');
  let results;
  try {
    results = await importer.importAll(plans, (done, total, name) =>
      toast.saving(`匯入中… ${done}/${total}（${name}）`),
    );
  } catch (err) {
    toast.failed(`匯入失敗：${err.message}`);
    return;
  }

  const failed = results.filter((r) => !r.ok);
  toast.hide();

  if (failed.length) {
    toast.failed(
      `${results.length - failed.length} 位進去了，${failed.length} 位失敗：`
        + failed.map((r) => `${r.customerName}（${r.error}）`).join('；'),
    );
  } else {
    toast.info(`${results.length} 位客戶都匯進去了`);
  }

  // 成功的從待匯入清單裡拿掉，剩下的就是還要處理的那幾張。
  const ok2 = new Set(results.filter((r) => r.ok).map((r) => `${r.sheetName} ${r.customerName}`));
  pasted = pasted.filter((sheet, i) => !ok2.has(`${sheet.sheetName} ${plans[i].customerName}`));

  await render(el);
}
