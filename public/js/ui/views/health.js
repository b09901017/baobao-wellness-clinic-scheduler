// 資料健檢。SPEC 第 6.6、8.7 節。
//
// 主力裝置是 iPad（差異比對是表格），手機看得到摘要也修得動每一筆。
//
// 這一頁只算不寫，會寫入的只有兩種一鍵修正：「次數對帳」（計數欄位是快取、
// 真相在來訪，ADR-0004）與「補上缺的二返額度」（次數就是健檢的次數）。
// 只有這兩項有不需要判斷的正解 —— 其餘只顯示差異並提供跳過去的連結，
// 要怎麼處理是她的決定（ADR-0002）。見
// docs/adr/0007-health-check-reads-only.md 與
// docs/adr/0023-health-check-can-also-create-the-missing-followup.md。

import * as healthData from '../../data/health.js';
import { healthBadge } from '../../domain/health.js';
import { todayISO } from '../../domain/dates.js';
import { esc } from '../components/form.js';
import { icon } from '../icons.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

/** 上次掃描是哪一天、結果如何。跨重新整理也要記得，所以放 localStorage。 */
const LAST_RUN_KEY = 'health:lastRun';

export async function render(el) {
  el.innerHTML = '<p class="muted">掃描中…</p>';

  let result;
  try {
    result = await healthData.run(todayISO());
  } catch (err) {
    el.innerHTML = `
      <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
      <div class="card"><p>掃描失敗：${esc(err.message)}</p>
      <p class="muted">資料健檢要把整個資料庫讀一次，訊號不好時容易中斷，可以再試一次。</p>
      <p><button class="btn" type="button" data-retry>重新掃描</button></p></div>`;
    el.querySelector('[data-retry]').addEventListener('click', () => render(el));
    return;
  }

  rememberRun(result);
  paint(el, result);
}

function paint(el, result) {
  const badge = healthBadge(result);
  // 修正按鈕要指得回原本那一筆，所以畫之前先把可修正的編號 ——
  // 同一筆額度可能在不同檢查裡各出現一次，光靠 id 分不出來。
  indexFixes(result);

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>

    <div class="page">
      <div class="page__row">
        <h1 class="page__title">資料健檢</h1>
        ${badge
          ? `<span class="badge badge--overdue">${esc(badge)}</span>`
          : '<span class="badge badge--ok">全部對得起來</span>'}
      </div>
      <p class="page__lead">發現的問題只會顯示出來。只有計數欄位重算與補二返額度這兩件事
        有「修正」可以按，其餘一律不會自動改任何資料。</p>
    </div>

    <div class="checks" style="margin-bottom: var(--space-5)">
      ${result.checks.map(checkTile).join('')}
    </div>

    <p style="margin-bottom: var(--space-5)">
      <button class="btn" type="button" data-rescan>重新掃描</button>
      <span class="muted" style="margin-left: var(--space-3)">
        掃描於 ${new Date().toLocaleString('zh-TW')}</span>
    </p>

    ${result.checks.map(checkCard).join('')}`;

  el.querySelector('[data-rescan]').addEventListener('click', () => render(el));

  el.querySelectorAll('[data-fix-all]').forEach((btn) =>
    btn.addEventListener('click', () => fixAll(el, result, btn.dataset.fixAll)),
  );

  el.querySelectorAll('[data-fix]').forEach((btn) =>
    btn.addEventListener('click', () => fixOne(el, result, Number(btn.dataset.fix))),
  );
}

/**
 * 一眼看完的那一排。差異的數字要大 —— 她開這一頁是為了知道「有沒有事」，
 * 細節在底下的展開區。
 */
function checkTile(check) {
  const clean = check.count === 0;
  // 嚴重度記在每一筆 finding 上，不是整組檢查上。有任何一筆是「資料自己對不起來」
  // 就算紅的；全部只是「該去處理一件事」就算黃的。
  const hard = check.findings.some((x) => x.severity === 'mismatch');
  const cls = clean ? '' : hard ? 'check--bad' : 'check--warn';
  return `
    <div class="check ${cls}">
      <div class="check__n">${check.count}</div>
      <div class="check__label">${esc(check.label)}</div>
      <div class="check__note">${esc(check.hint)}</div>
    </div>`;
}

function checkCard(check) {
  const clean = check.count === 0;

  return `
    <details class="card" ${clean ? '' : 'open'}>
      <summary class="card__title">
        ${esc(check.label)}
        ${clean
          ? '<span class="badge badge--ok">沒問題</span>'
          : `<span class="badge badge--overdue">${check.count}</span>`}
      </summary>
      <p class="muted">${esc(check.hint)}</p>
      ${clean ? '' : findingsHtml(check)}
    </details>`;
}

function findingsHtml(check) {
  return `
    ${check.fixable > 1
      ? `<p><button class="btn btn--primary" type="button" data-fix-all="${esc(check.id)}">
           ${esc(FIX_COPY[check.id]?.all?.(check.fixable) ?? `一次修正這 ${check.fixable} 筆`)}
         </button></p>`
      : ''}
    <div class="audit">
      ${check.findings.map(findingHtml).join('')}
    </div>`;
}

function findingHtml(finding) {
  const index = FIX_INDEX.get(finding) ?? null;

  return `
    <div class="audit__row">
      <div class="audit__head">
        <span class="audit__what">${esc(finding.title)}</span>
        <span class="badge ${finding.severity === 'mismatch' ? 'badge--overdue' : 'badge--soon'}">
          ${finding.severity === 'mismatch' ? '對不起來' : '要處理'}
        </span>
      </div>
      <div class="muted">${esc(finding.detail)}</div>
      <p>
        ${finding.link ? `<a class="btn" href="${esc(finding.link)}">看這一筆</a>` : ''}
        ${finding.fix && index !== null
          ? `<button class="btn btn--primary" type="button" data-fix="${index}">
               ${esc(buttonLabel(finding.fix))}</button>`
          : ''}
      </p>
    </div>`;
}

/**
 * finding 物件 → 它在「可修正清單」裡的第幾個。
 * 用 WeakMap 而不是把 index 寫進 finding：domain 給出來的是唯讀的結果，
 * UI 不應該回頭在上面加欄位。
 */
const FIX_INDEX = new WeakMap();

function fixesOf(result, checkId = null) {
  return result.checks
    .filter((c) => !checkId || c.id === checkId)
    .flatMap((c) => c.findings)
    .filter((f) => f.fix);
}

function indexFixes(result) {
  fixesOf(result).forEach((f, i) => FIX_INDEX.set(f, i));
}

/**
 * 兩種修正的文案。**確認框上一定要寫這一次會發生什麼**，不是只有「確定嗎？」
 * （SPEC 第 6.5 節）—— 兩種修正動的是不同的東西，用同一段字就等於沒講。
 */
const FIX_COPY = {
  counts: {
    button: () => '改成重算值',
    all: (n) => `一次修正這 ${n} 筆`,
    one: (fix) => ({
      title: `把「${fix.label}」的計數欄位改成重算值？`,
      lines: [
        `已完成 ${fix.from.done} → ${fix.to.done}`,
        `已排未上 ${fix.from.booked} → ${fix.to.booked}`,
        '重算值是從來訪推導出來的，那才是真相',
      ],
    }),
    many: (fixes) => ({
      title: `把這 ${fixes.length} 筆的計數欄位都改成重算值？`,
      lines: fixes.map(
        (fix) => `${fix.label}：已完成 ${fix.from.done} → ${fix.to.done}、`
          + `已排未上 ${fix.from.booked} → ${fix.to.booked}`,
      ),
    }),
  },
  followups: {
    button: () => '補上二返額度',
    all: (n) => `一次補這 ${n} 筆`,
    one: (fix) => ({
      title: `替「${fix.label}」補一筆二返額度？`,
      lines: [
        `會新增「${fix.draft.label}」${fix.qty} 次`,
        '次數跟健檢一樣多。買幾次健檢就有幾次二返',
        '補了之後，她行事曆上的二返才記得進來',
      ],
    }),
    many: (fixes) => ({
      title: `替這 ${fixes.length} 筆健檢各補一筆二返額度？`,
      lines: fixes.map((fix) => `${fix.label} → ${fix.draft.label} ${fix.qty} 次`),
    }),
  },
};

const KIND_TO_CHECK = { recount: 'counts', addFollowup: 'followups' };
const copyFor = (fix) => FIX_COPY[KIND_TO_CHECK[fix?.kind]] ?? FIX_COPY.counts;
const buttonLabel = (fix) => copyFor(fix).button();

async function fixOne(el, result, index) {
  const finding = fixesOf(result)[index];
  if (!finding) return;

  const { title, lines } = copyFor(finding.fix).one(finding.fix);
  await applyAndReload(el, [finding.fix], {
    title,
    consequences: [...lines, '這次修正會留在稽核紀錄裡，也可以復原'],
  });
}

async function fixAll(el, result, checkId) {
  const fixes = fixesOf(result, checkId).map((f) => f.fix);
  if (!fixes.length) return;

  const { title, lines } = copyFor(fixes[0]).many(fixes);
  await applyAndReload(el, fixes, {
    title,
    consequences: [
      ...lines.slice(0, 5),
      ...(lines.length > 5 ? [`還有 ${lines.length - 5} 筆`] : []),
      '每一筆都會留一則稽核紀錄，整批可以一起復原',
    ],
  });
}

async function applyAndReload(el, fixes, { title, consequences }) {
  const ok = await confirmAction({ title, consequences, confirmLabel: '修正' });
  if (!ok) return;

  try {
    await toast.withSaveState(() => healthData.applyFixes(fixes), {
      pending: '修正中…',
      success: `已修正 ${fixes.length} 筆`,
    });
    render(el);
  } catch {
    /* withSaveState 已顯示錯誤與重試 */
  }
}

// ---------- 啟動時的背景掃描 ----------
//
// SPEC 第 6.6 節要求 app 啟動時也跑一次。但全庫掃描要把客戶、額度、來訪、任務、
// 可用性全讀一遍，每次開 app 都跑等於每天幾十次全表讀取 ——
// 所以改成「每天最多一次」：問題最慢隔天早上第一次打開就會浮出來，
// 而她本來就不是一天內把資料改壞好幾次的用法。

/**
 * 今天還沒掃過就掃一次。失敗一律安靜略過 —— 這是背景動作，
 * 它不該在她要做別的事情的時候跳錯誤出來擋路。
 *
 * @returns {Promise<object|null>} 這次的掃描結果，沒掃就是 null
 */
export async function runIfDue() {
  const today = todayISO();
  if (readLastRun()?.date === today) return null;

  try {
    const result = await healthData.run(today);
    rememberRun(result);
    return result;
  } catch {
    return null;
  }
}

/** 首頁的徽章要用。沒掃過或沒問題就回 null。 */
export function lastBadge() {
  return readLastRun()?.badge ?? null;
}

function rememberRun(result) {
  try {
    localStorage.setItem(
      LAST_RUN_KEY,
      JSON.stringify({ date: result.today, badge: healthBadge(result) }),
    );
  } catch {
    // iOS 的無痕模式寫 localStorage 會丟例外。記不住只是每次開都重掃，不是壞掉。
  }
}

function readLastRun() {
  try {
    return JSON.parse(localStorage.getItem(LAST_RUN_KEY) ?? 'null');
  } catch {
    return null;
  }
}
