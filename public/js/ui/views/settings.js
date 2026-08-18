// 設定頁首頁。主檔清單入口、任務規則檢視、種子資料、匯出。
//
// 業務規則不寫在這裡：驗證在 domain/masterData.js，寫入在 data/config.js。
// 這一層只負責畫面與把值傳過去。

import * as config from '../../data/config.js';
import * as backup from '../../data/backup.js';
import { MASTER_TYPES, MASTER_LABELS } from '../../domain/masterData.js';
import { CATEGORY_OPTIONS, describeCategory } from '../../domain/taskRules.js';
import { esc } from '../components/form.js';
import { saveText, dated } from '../components/download.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  let cache;
  try {
    cache = await config.loadAll();
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore Rules 還沒部署，或這個帳號不在白名單裡。</p></div>`;
    return;
  }

  const empty = MASTER_TYPES.every((t) => cache[t].length === 0);

  el.innerHTML = `
    ${empty ? seedCard() : ''}
    <section class="card">
      <h2 class="card__title">主檔</h2>
      <ul class="link-list">
        ${MASTER_TYPES.map(
          (t) => `<li><a href="#/settings/${t}">
                    <span class="link-list__label">${MASTER_LABELS[t]}</span>
                    <span class="muted">${cache[t].length}</span></a></li>`,
        ).join('')}
      </ul>
    </section>

    <section class="card">
      <h2 class="card__title">任務規則</h2>
      <p class="muted">綁在課程的類別上，不逐課程設定。要改某個課程產生哪些任務，去改它的類別。</p>
      <ul class="muted">
        ${CATEGORY_OPTIONS.map((o) => `<li>${esc(describeCategory(o.value))}</li>`).join('')}
      </ul>
    </section>

    <section class="card">
      <h2 class="card__title">其他</h2>
      <ul class="link-list">
        <li><a href="#/settings/preferences">
          <span class="link-list__label">排序權重與時段間隔</span></a></li>
        <li><a href="#/settings/health">
          <span class="link-list__label">資料健檢</span>
          <span class="muted">對帳與異常</span></a></li>
        <li><a href="#/settings/report">
          <span class="link-list__label">試算表報表</span>
          <span class="muted">貼回試算表</span></a></li>
        <li><a href="#/settings/audit">
          <span class="link-list__label">稽核紀錄</span>
          <span class="muted">誰改了什麼</span></a></li>
        <li><a href="#/settings/trash">
          <span class="link-list__label">已刪除項目</span></a></li>
      </ul>
    </section>

    <section class="card">
      <h2 class="card__title">匯出備份</h2>
      <p class="muted">匯出全部資料為一個 JSON 檔，含已刪除的資料 ——
        備份漏掉軟刪除的東西就救不回誤刪。建議每個月存一份到雲端硬碟。</p>
      <label class="choice choice--row">
        <input type="checkbox" data-with-audit />
        <span>含稽核紀錄</span>
      </label>
      <p class="muted">稽核紀錄是每一次寫入的完整 before / after，
        累積起來可能比其他資料加起來還大，手機下載會等比較久。</p>
      <p><button class="btn" type="button" data-export>匯出</button></p>
    </section>`;

  el.querySelector('[data-seed]')?.addEventListener('click', () => runSeed(el));
  el.querySelector('[data-export]')?.addEventListener('click', () =>
    runExport(el.querySelector('[data-with-audit]')?.checked ?? false),
  );
}

function seedCard() {
  return `
    <section class="card">
      <h2 class="card__title">還沒有任何主檔</h2>
      <p class="muted">可以先載入 SPEC 裡已知的診間、治療師、器材、課程與兩個方案範本，之後每一筆都能改。</p>
      <p><button class="btn btn--primary" type="button" data-seed>載入種子資料</button></p>
    </section>`;
}

async function runSeed(el) {
  const ok = await confirmAction({
    title: '載入種子資料',
    consequences: [
      '建立 SPEC 第 12 節列出的診間、治療師、器材、營養點滴品項、營養品、課程與兩個方案範本',
      '已經存在的一律跳過，不會覆蓋你改過的內容',
      '之後每一筆都能在這裡修改或刪除',
    ],
    confirmLabel: '載入',
  });
  if (!ok) return;

  try {
    const result = await toast.withSaveState(() => config.loadSeed(), {
      pending: '載入種子資料中…',
      success: `已載入`,
    });
    toast.info(`新增 ${result.created} 筆，跳過 ${result.skipped} 筆已存在的`);
    await render(el);
  } catch {
    /* withSaveState 已顯示錯誤與重試 */
  }
}

async function runExport(includeAudit) {
  toast.info('匯出中…');
  try {
    const data = await backup.exportAll({ includeAudit });
    saveText(dated('排課系統備份', 'json'), JSON.stringify(data, null, 2), 'application/json');
    // 匯出完要說清楚拿到了什麼。只說「已匯出」的話，檔案漏了一半也看不出來。
    toast.info(`已匯出 ${backup.describeCounts(data.counts)}。建議存一份到雲端硬碟。`);
  } catch (err) {
    toast.failed(`匯出失敗：${err.message}`);
  }
}
