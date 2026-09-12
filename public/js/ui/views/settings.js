// 設定頁首頁。主檔清單入口、任務規則檢視、種子資料、匯出。
//
// 業務規則不寫在這裡：驗證在 domain/masterData.js，寫入在 data/config.js。
// 這一層只負責畫面與把值傳過去。

import * as config from '../../data/config.js';
import * as backup from '../../data/backup.js';
import { MASTER_TYPES, MASTER_LABELS } from '../../domain/masterData.js';
import { CATEGORY_OPTIONS, describeCategory } from '../../domain/taskRules.js';
import { TEMPLATES, isCustom } from '../../domain/messageTemplates.js';
import { esc } from '../components/form.js';
import { tip } from '../components/tip.js';
import { icon } from '../icons.js';
import { signOutNow } from '../session.js';
import { saveText, dated } from '../components/download.js';
import { THEME_CHOICES, readTheme, setTheme } from '../theme.js';
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

  // 讀不到就當成「都是預設值」—— 這一格是一句說明，不值得為它擋住整頁。
  let changedTemplates = 0;
  try {
    const stored = await config.getTemplates();
    changedTemplates = TEMPLATES.filter((t) => isCustom(t.id, stored)).length;
  } catch {
    /* 那一格印「都是預設值」 */
  }

  el.innerHTML = `
    <div class="page">
      <h1 class="page__title">設定${tip(
        '診間與治療師都在這裡自己加，沒有寫死在程式碼裡。')}</h1>
    </div>

    ${empty ? seedCard() : ''}

    <section class="card card--flat">
      <h2 class="card__title">主檔${tip('這些都能自己加、自己改。')}</h2>
      <div class="tilegrid">
        ${MASTER_TYPES.map((t) => tile(
          `#/settings/${t}`, MASTER_LABELS[t], `${cache[t].length} 筆`,
        )).join('')}
      </div>
    </section>

    <section class="card card--flat">
      <h2 class="card__title">規則${tip('改了會影響之後產生的東西。')}</h2>
      <div class="tilegrid">
        ${tile('#/settings/preferences', '排序權重', '誰先看、時段間隔、幾天沒回覆算久')}
        ${tile('#/settings/templates', 'LINE 回覆模板',
          changedTemplates ? `六則，改過 ${changedTemplates} 則` : '六則，都是預設值')}
        ${/* 「一般」那一種 2026-09-08 拿掉了（ADR-0078）—— `NAME_CONTEXTS`
               現在只有月曆與 LINE 兩種，這一句留著就是在講一個不存在的東西。
               `tests/ui-copy.test.js` 有一條盯著它不會長回來。 */''}
        ${tile('#/settings/naming', '名稱怎麼寫', '月曆與 LINE 兩種寫法')}
      </div>
      <details style="margin-top: var(--space-3)">
        <summary class="muted">任務規則綁在課程的類別上${tip(
          '不逐課程設定。要改某個課程產生哪些任務，去改它的類別。')}</summary>
        <ul class="muted" style="margin-top: var(--space-2)">
          ${CATEGORY_OPTIONS.map((o) => `<li>${esc(describeCategory(o.value))}</li>`).join('')}
        </ul>
      </details>
    </section>

    <section class="card card--flat">
      <h2 class="card__title">資料${tip('出事時能回頭看的東西。')}</h2>
      <div class="tilegrid">
        ${tile('#/settings/health', '資料健檢', '對帳與異常')}
        ${tile('#/settings/audit', '稽核紀錄', '每一次寫入的 before / after')}
        ${tile('#/settings/trash', '已刪除項目', '刪除只是標記，還原得回來')}
        ${tile('#/settings/report', '試算表報表', '產生後貼回去，或讓它自己推')}
        ${tile('#/settings/merge', '舊資料匯入', '貼上對照過行事曆的合併檔')}
      </div>
    </section>

    <section class="card card--flat">
      <h2 class="card__title">外觀${tip(
        '記在這一台裝置上，兩台各自設定。「跟著系統」是 Android 的 設定 → 顯示 → 深色主題，'
        + 'iPad 的 設定 → 螢幕顯示與亮度。')}</h2>
      <div class="chiprow" data-theme-pick>
        ${THEME_CHOICES.map((c) => `
          <button class="chip" type="button" data-theme-set="${c.value}"
                  aria-pressed="${readTheme() === c.value}">${esc(c.label)}</button>`).join('')}
      </div>
    </section>

    <section class="card">
      <h2 class="card__title">帳號${tip('登出之後資料都還在雲端，重新登入就看得到。')}</h2>
      <button class="btn" type="button" data-signout>登出</button>
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

  // 換主題只改那一排丸子的 aria-pressed，**不重畫整頁**（ADR-0038）——
  // 顏色是 CSS 變數換的，畫面自己會跟上。
  el.querySelector('[data-theme-pick]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-set]');
    if (!btn) return;
    setTheme(btn.dataset.themeSet);
    el.querySelectorAll('[data-theme-set]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b === btn)));
  });

  el.querySelector('[data-seed]')?.addEventListener('click', () => runSeed(el));
  el.querySelector('[data-signout]')?.addEventListener('click', () => signOutNow());
  el.querySelector('[data-export]')?.addEventListener('click', () =>
    runExport(el.querySelector('[data-with-audit]')?.checked ?? false),
  );
}

function tile(href, label, meta) {
  return `
    <a class="settile" href="${href}">
      <span class="settile__label"><span>${esc(label)}</span>${icon('right', { size: 17 })}</span>
      <span class="settile__meta num">${esc(meta)}</span>
    </a>`;
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
