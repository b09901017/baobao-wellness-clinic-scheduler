// 設定 → 療程單（issue 14，ADR-0105）。
//
// 她 2026-09-17：「這個可以放在設定資料那個區塊，多一個拍診療單之類的，這個是可以存起來的？
// 就是我可以在這邊搜尋人名然後看到這個人的診療單」。
//
// 兩頁：
// - `#/settings/treatment-sheets`：搜人名 → 有療程單的那幾位
// - `#/settings/treatment-sheets/:customerId`：那一位的療程單，一張一張卡
// 兩頁右下角都有一顆相機（`camera.js` → `sheetConfirm.js`）。
//
// 比對（issue 15）：每一張卡底下一行「比到 8/25：對得上 12 次・要你看 2 件」，點開是那幾件、各連到日曆那一天。
// **這兩頁沒有任何一顆按鈕改得到來訪**（ADR-0007 只列不修、ADR-0056 改來訪只有日曆）。
// 「全部比對一次」是她按了才跑 —— 兩三個月拍一次，不值得每次打開都讀一輪來訪。
//
// 規則在 `domain/treatmentSheets.js`，讀寫在 `data/treatmentSheets.js`。這一支只畫與接線。

import * as customersData from '../../data/customers.js';
import * as config from '../../data/config.js';
import * as sheetsData from '../../data/treatmentSheets.js';
import * as visitsData from '../../data/visits.js';
import {
  compareAll, compareLine, compareSheet, issueSentence, lastSignedDate, sheetLabel,
} from '../../domain/treatmentSheets.js';
import { normalizeName } from '../../domain/identify.js';
import { shortDate, todayISO } from '../../domain/dates.js';
import { openCamera } from '../components/camera.js';
import { openSheetConfirm } from '../components/sheetConfirm.js';
import { confirmAction } from '../components/dialog.js';
import { esc } from '../components/form.js';
import { openPhoto } from '../components/seen.js';
import { tip } from '../components/tip.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import * as toast from '../toast.js';
import { showDate } from './calendar.js';

// 搜尋框打的字留在模組層：點進一位再按返回，她剛剛找的那幾個字還在
const view = { search: '' };

async function load() {
  const [customers, master, sheets] = await Promise.all([
    customersData.list(), config.loadAll(), sheetsData.listAll(),
  ]);
  return { customers, master, sheets };
}

/** `2026-09-17T01:00:00Z` → 她那一台的日曆日（`todayISO()` 只給今天，這裡照同一個寫法算那一天）。 */
function dayOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fab() {
  return `
    <div class="fab">
      <button class="fab__main" type="button" data-sheet-camera aria-label="拍療程單">
        ${icon('camera', { size: 24, width: 2 })}</button>
    </div>`;
}

/** 拍 → 確認層 → 存好之後重畫這一頁。 */
function photograph(el, repaint) {
  openCamera({
    kind: 'treatmentSheet',
    max: 10,
    onDone: async (photos, { release }) => {
      let data;
      try {
        data = await load();
      } catch (err) {
        release();
        toast.failed(`讀取失敗：${err.message}`);
        return;
      }
      openSheetConfirm({
        photos,
        release,
        ctx: { customers: data.customers, master: data.master, sheets: data.sheets, today: todayISO() },
        onFinish: ({ saved }) => { if (saved) repaint(); },
      });
    },
  });
}

// ---------- 搜人名 ----------

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  let data;
  try {
    data = await load();
  } catch (err) {
    el.innerHTML = `<a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
      <div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  const byCustomer = new Map();
  for (const s of data.sheets) {
    if (!byCustomer.has(s.customerId)) byCustomer.set(s.customerId, []);
    byCustomer.get(s.customerId).push(s);
  }

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <div class="page">
      <h1 class="page__title">療程單${tip(
        '客人簽過的療程單拍起來存在這裡，搜名字看得到。同一張多簽了幾列就再拍一次，會換掉舊的那張照片；'
        + '換了新的一張就多一張。照片不進匯出備份（有紙本正本）。')}</h1>
    </div>
    <label class="field tsheets__search">
      <span class="visually-hidden">找人</span>
      <input type="search" data-sheet-search value="${esc(view.search)}" placeholder="找人：姓名" autocomplete="off" />
    </label>
    ${data.sheets.length ? `
      <div class="tsheets__compareall">
        <button class="btn" type="button" data-sheet-compare-all>全部比對一次</button>
        ${tip('拿每一張療程單上簽了的列，跟那一位記在 app 裡的來訪比一次。只比到每一張最後一次簽名的那一天。')}
      </div>
      <div data-sheet-compare-result></div>` : ''}
    <div data-sheet-people></div>
    ${fab()}`;

  const paintPeople = () => {
    const want = normalizeName(view.search);
    const people = data.customers
      .filter((c) => (want ? normalizeName(c.name).includes(want) : byCustomer.has(c.id)))
      .sort((a, b) => Number(byCustomer.has(b.id)) - Number(byCustomer.has(a.id)));
    const holder = el.querySelector('[data-sheet-people]');
    if (!data.sheets.length && !want) {
      holder.innerHTML = '<p class="tsheets__empty">還沒有拍過療程單。右下角的相機拍一張。</p>';
      return;
    }
    if (!people.length) {
      holder.innerHTML = `<p class="tsheets__empty">沒有叫「${esc(view.search)}」的客戶。</p>`;
      return;
    }
    holder.innerHTML = `${want ? '' : `<p class="tsheets__label">有療程單的 ${people.length} 位</p>`}<ul class="tsheets__people">${people.map((c) => {
      const mine = byCustomer.get(c.id) ?? [];
      if (!mine.length) {
        return `<li class="tsheets__person tsheets__person--none"><span>${esc(c.name)}</span><span class="tsheets__meta">還沒有療程單</span></li>`;
      }
      const latest = mine.map((s) => dayOf(s.photoAt)).filter(Boolean).sort().at(-1);
      return `
        <li><a class="tsheets__person" href="#/settings/treatment-sheets/${encodeURIComponent(c.id)}" data-sheet-person="${esc(c.id)}">
          <span class="tsheets__name">${esc(c.name)}</span>
          <span class="tsheets__meta num">${mine.length} 張${latest ? `・${esc(shortDate(latest))} 拍的` : ''}</span>
          ${icon('right', { size: 17 })}
        </a></li>`;
    }).join('')}</ul>`;
  };
  paintPeople();

  el.querySelector('[data-sheet-search]').addEventListener('input', (e) => {
    if (e.isComposing) return;
    view.search = e.target.value;
    paintPeople();
  });
  el.querySelector('[data-sheet-search]').addEventListener('compositionend', (e) => {
    view.search = e.target.value;
    paintPeople();
  });
  el.querySelector('[data-sheet-camera]').addEventListener('click', () => photograph(el, () => render(el)));
  el.querySelector('[data-sheet-compare-all]')?.addEventListener('click', (e) => compareEveryone(el, data, e.currentTarget));

  // 上一次沒刪掉的舊照片檔（`data/treatmentSheets.js` 的 `replace()`），打開這一頁時再刪一次
  for (const s of data.sheets.filter((x) => (x.stalePhotoPaths ?? []).length)) {
    sheetsData.sweepStale(s).catch(() => {});
  }
}

// ---------- 那一位的療程單 ----------

export async function renderPerson(el, customerId) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  let data;
  try {
    data = await load();
  } catch (err) {
    el.innerHTML = `<a class="backlink" href="#/settings/treatment-sheets">${icon('left', { size: 19 })}療程單</a>
      <div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }
  const customer = data.customers.find((c) => c.id === customerId) ?? null;
  // 比對要那一位的來訪。讀不到不擋整頁：卡片照畫，那一行講讀不到
  const visits = await visitsData.listByCustomer(customerId).catch(() => null);
  const sheets = data.sheets
    .filter((s) => s.customerId === customerId)
    .sort((a, b) => `${a.courseName}|${firstDate(a)}`.localeCompare(`${b.courseName}|${firstDate(b)}`, 'zh-TW'));

  // 監聽掛在裡面這一層：存好之後重畫同一頁會換掉它，不會一次疊一個（`shell.js` 只在換頁時換 `#view`）
  el.innerHTML = `<div data-sheet-page>
    <a class="backlink" href="#/settings/treatment-sheets">${icon('left', { size: 19 })}療程單</a>
    <div class="page">
      <h1 class="page__title">${esc(customer?.name ?? '找不到這位客戶')}</h1>
    </div>
    ${sheets.length ? `<div class="tsheets__cards">${sheets.map((s) => cardHtml(s, data.master, visits)).join('')}</div>`
    : '<p class="tsheets__empty">這一位還沒有療程單。右下角的相機拍一張。</p>'}
    ${fab()}</div>`;
  const page = el.querySelector('[data-sheet-page]');

  page.querySelector('[data-sheet-camera]').addEventListener('click', () => photograph(el, () => renderPerson(el, customerId)));

  page.addEventListener('click', async (e) => {
    const day = e.target.closest('[data-sheet-day]');
    if (day) {
      // 日曆那一天：這一頁不是一層，直接換頁（返回鍵回到這一位）
      showDate(day.dataset.sheetDay);
      go('/calendar');
      return;
    }
    const more = e.target.closest('[data-sheet-compare]');
    if (more) {
      const list = page.querySelector(`[data-sheet-issues="${CSS.escape(more.dataset.sheetCompare)}"]`);
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      if (list) list.hidden = !open;
      return;
    }
    const photo = e.target.closest('[data-sheet-photo]');
    if (photo && photo.dataset.url) {
      openPhoto(photo.dataset.url, '');
      return;
    }
    const del = e.target.closest('[data-sheet-delete]');
    if (del) {
      const sheet = sheets.find((s) => s.id === del.dataset.sheetDelete);
      if (sheet) removeSheet(el, sheet, customerId, data.master);
    }
  });

  // 縮圖：網址要問 Storage（帶著權杖，不存、不記）。檔案不在 → 講出來（還原備份之後就是這樣）
  for (const s of sheets) {
    const btn = el.querySelector(`[data-sheet-photo="${CSS.escape(s.id)}"]`);
    // eslint-disable-next-line no-await-in-loop
    const url = await sheetsData.photoUrl(s.photoPath).catch(() => undefined);
    if (!btn?.isConnected) return;
    if (url) {
      btn.dataset.url = url;
      btn.innerHTML = `<img src="${esc(url)}" alt="${esc(`${sheetLabel(s, data.master)} 療程單的照片`)}" />`;
    } else {
      btn.disabled = true;
      btn.classList.add('tsheet__photo--missing');
      btn.innerHTML = `<span>${url === null ? '照片不在備份裡' : '照片讀不到'}</span>`;
    }
  }
}

const firstDate = (sheet) => (sheet.rows ?? []).map((r) => r.date).filter(Boolean).sort()[0] ?? '';

function cardHtml(sheet, master, visits) {
  const last = lastSignedDate(sheet);
  const taken = dayOf(sheet.photoAt);
  const first = firstDate(sheet);
  return `
    <article class="tsheet card" data-sheet="${esc(sheet.id)}">
      <button class="tsheet__photo" type="button" data-sheet-photo="${esc(sheet.id)}" aria-label="看照片">
        <span class="tsheet__spin" aria-hidden="true"></span></button>
      <div class="tsheet__body">
        <h2 class="tsheet__title">${esc(sheetLabel(sheet, master) || sheet.courseName || '療程單')}</h2>
        <p class="tsheet__facts num">${first ? `${esc(shortDate(first))} 起・` : ''}${(sheet.rows ?? []).length} 列${
  last ? `・最後簽名 ${esc(shortDate(last))}` : ''}</p>
        ${taken ? `<p class="tsheet__taken">照片是 ${esc(shortDate(taken))} 拍的</p>` : ''}
      </div>
      <div class="tsheet__wide">${compareHtml(sheet, master, visits)}</div>
      <div class="tsheet__actions">
        <button class="btn btn--sm btn--ghost" type="button" data-sheet-delete="${esc(sheet.id)}">刪掉這一張</button>
      </div>
    </article>`;
}

/** 卡片底下那一行，有要看的就是一顆按鈕、點開那幾件。 */
function compareHtml(sheet, master, visits) {
  if (!visits) return '<p class="tsheet__compare tsheet__compare--none">讀不到來訪，沒辦法比對</p>';
  const result = compareSheet(sheet, visits, master);
  const line = compareLine(result);
  if (!result.issues.length) return `<p class="tsheet__compare${result.to ? ' tsheet__compare--ok' : ''}">${esc(line)}</p>`;
  return `
    <button class="tsheet__compare tsheet__compare--look" type="button" data-sheet-compare="${esc(sheet.id)}" aria-expanded="false">
      <span>${esc(line)}</span>${icon('down', { size: 16 })}</button>
    <ul class="tsheet__issues" data-sheet-issues="${esc(sheet.id)}" hidden>
      ${result.issues.map((i) => `
        <li class="tsheet__issue tsheet__issue--${esc(i.kind)}">
          <span>${esc(issueSentence(i, master))}</span>
          <button class="btn btn--sm" type="button" data-sheet-day="${esc(i.date)}">去日曆 ${esc(shortDate(i.date))}</button>
        </li>`).join('')}
    </ul>`;
}

/** 「全部比對一次」：讀有療程單的那幾位在區間內的來訪，列出哪幾位有要看的。 */
async function compareEveryone(el, data, button) {
  const holder = el.querySelector('[data-sheet-compare-result]');
  const dates = data.sheets.flatMap((s) => (s.rows ?? []).map((r) => r.date)).filter(Boolean).sort();
  if (!holder || !dates.length) return;
  button.disabled = true;
  holder.innerHTML = '<p class="tsheets__empty">讀取中…</p>';
  try {
    const visits = await visitsData.listBetween(dates[0], dates[dates.length - 1]);
    const people = compareAll(data.sheets, visits, data.master, data.customers);
    holder.innerHTML = people.length
      ? `<p class="tsheets__label tsheets__label--look">比對：有要你看的 ${people.length} 位</p><ul class="tsheets__people tsheets__people--look">${people.map((p) => `
          <li><a class="tsheets__person" href="#/settings/treatment-sheets/${encodeURIComponent(p.customerId)}" data-sheet-look="${esc(p.customerId)}">
            <span class="tsheets__name">${esc(p.customerName)}</span>
            <span class="tsheets__meta tsheets__meta--look num">要你看 ${p.issues} 件</span>
            ${icon('right', { size: 17 })}
          </a></li>`).join('')}</ul>`
      : '<p class="tsheets__allgood">每一張都對得上（各自比到最後一次簽名那一天）。</p>';
  } catch (err) {
    holder.innerHTML = `<p class="tsheets__empty">讀不到來訪：${esc(err.message)}</p>`;
  } finally {
    button.disabled = false;
  }
}

async function removeSheet(el, sheet, customerId, master) {
  const ok = await confirmAction({
    title: `刪掉 ${sheetLabel(sheet, master) || '這一張'} 療程單？`,
    consequences: [
      '照片留著，在 設定 → 已刪除項目 還原得回來',
      '要換成新拍的那一張不用刪 —— 再拍一次，選「那一張的新版」',
    ],
    confirmLabel: '刪掉',
    danger: true,
  });
  if (!ok) return;
  try {
    await toast.withSaveState(() => sheetsData.remove(sheet), { success: '刪掉了' });
    renderPerson(el, customerId);
  } catch {
    /* 已處理 */
  }
}
