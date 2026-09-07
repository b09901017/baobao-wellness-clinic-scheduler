// 資料健檢。SPEC 第 6.6、8.7 節。
//
// 主力裝置是 iPad（差異比對是表格），手機看得到摘要也修得動每一筆。
//
// 這一頁只算不寫。會寫入的是**符合 SPEC 第 6.6 節那三個條件**的那幾項一鍵修正
// （有明確正解／沒有第二種意思／沒有別的地方做得了）—— 數量會變，所以這裡跟
// SPEC 一樣寫條件不寫數字。今天符合的是「次數對帳」（計數欄位是快取、真相在
// 來訪，ADR-0004）、「補上缺的二返額度」（次數就是健檢的次數，ADR-0023）
// 與「備註寫著舊的說法」（「姓名欄的編號：」→「病歷號」，ADR-0050）。
// 其餘只顯示差異並提供跳過去的連結，要怎麼處理是她的決定（ADR-0002）。見
// docs/adr/0007-health-check-reads-only.md。
//
// **加一種修正就要在 `FIX_COPY` 與 `KIND_TO_CHECK` 各補一列。** 少補的話
// `copyFor()` 會安靜地退回別項的文案 —— 按鈕印著別人的字，按下去讀不到
// 那一項沒有的欄位就整個炸掉，而畫面上什麼都不會說。

import * as healthData from '../../data/health.js';
import { healthBadge } from '../../domain/health.js';
import { todayISO } from '../../domain/dates.js';
import { esc } from '../components/form.js';
import { icon } from '../icons.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

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
      <p class="page__lead">發現的問題只會顯示出來。正解不需要判斷的那幾項才有
        「修正」可以按，其餘一律不會自動改任何資料。</p>
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
  poolLabel: {
    button: () => '改成新的名字',
    all: (n) => `一次改這 ${n} 筆`,
    one: (fix) => ({
      title: `把「${fix.from}」改成「${fix.to}」？`,
      lines: [
        '額度的名字是購買當下的快照，所以它不會自己跟上（ADR-0003）',
        '只改名字 —— 次數、器材、到期日一個字都不會動',
        '同一位客戶身上兩種名字並排，看起來像兩種東西',
      ],
    }),
    many: (fixes) => ({
      title: `把這 ${fixes.length} 筆復能額度都改成新的名字？`,
      lines: fixes.map((fix) => `${fix.label} → ${fix.to}`),
    }),
  },
  alertTerm: {
    button: () => '補進警示名單',
    all: (n) => `一次補這 ${n} 個`,
    one: (fix) => ({
      title: `把「${fix.label}」補進警示名單？`,
      lines: [
        '器材上登記了這個字，但警示名單裡沒有',
        '少了它，客戶身上打了這個字，壓表卡片牆上什麼都不會出現',
        '補進去之後是紅色實心 —— 之後可以到設定 → 警示改樣式',
      ],
    }),
    many: (fixes) => ({
      title: `把這 ${fixes.length} 個字都補進警示名單？`,
      lines: fixes.map((fix) => fix.label),
    }),
  },
  seedEquipment: {
    button: () => '把這一台建起來',
    all: (n) => `一次建這 ${n} 台`,
    one: (fix) => ({
      title: `把「${fix.label}」建進器材主檔？`,
      lines: [
        '種子資料裡有這一台，你的器材主檔沒有',
        '少了它，加購那一排的「四選一」按不出來',
        '建起來之後可以到設定 → 器材改名字與提醒詞',
      ],
    }),
    many: (fixes) => ({
      title: `把這 ${fixes.length} 台都建進器材主檔？`,
      lines: fixes.map((fix) => fix.label),
    }),
  },
  // 器材改名。**改名不會搬既有的東西**：客戶身上的額度名字、已經排出去的
  // 時段快照都留在原地（ADR-0002、0003），所以那兩句要講出來。
  equipmentNames: {
    button: () => '改成建議值',
    all: (n) => `一次改這 ${n} 台`,
    one: (fix) => ({
      title: `把「${fix.fromName}」改成「${fix.name}」？`,
      lines: [
        `全名 ${fix.fromName} → ${fix.name}，別稱 ${fix.fromShort} → ${fix.shortName ?? '（空）'}`,
        '額度的名字讀全名、月曆讀別稱 —— 兩邊之後印的就是這兩個字',
        '已經買下去的額度與已經排出去的來訪都不會跟著改名',
        '「復能額度還叫舊名字」那一列要在這一步之後再按',
      ],
    }),
    many: (fixes) => ({
      title: `把這 ${fixes.length} 台的名字都改成建議值？`,
      lines: fixes.map((fix) => `${fix.fromName} → ${fix.name}`),
    }),
  },
  // 她 2026-09-08 的三條規則。**每一句都只講真的會發生的事**（ADR-0070）——
  // 改的是主檔那一格，既有來訪身上的診間一個字都不會動。
  courseAssigns: {
    button: () => '改成建議值',
    all: (n) => `一次改這 ${n} 個課程`,
    one: (fix) => ({
      title: `把「${fix.label}」改成「${fix.toLabel}」？`,
      lines: [
        `現在是「${fix.fromLabel}」`,
        '之後壓表與來訪編輯器上，這個課程不再問你要哪一間',
        '已經排出去的來訪一筆都不會動 —— 上面那個診間留著，只是畫面上不再顯示',
      ],
    }),
    many: (fixes) => ({
      title: `把這 ${fixes.length} 個課程的指派都改成建議值？`,
      lines: fixes.map((fix) => `${fix.label}：${fix.fromLabel} → ${fix.toLabel}`),
    }),
  },
  seedDuration: {
    button: () => '填上 30／60',
    all: (n) => `一次填這 ${n} 個課程`,
    one: (fix) => ({
      title: `把「${fix.label}」的可選時長填成 ${fix.durationChoices.join('、')} 分鐘？`,
      lines: [
        '這個課程有兩種以上的規格，但主檔上那一格是空的',
        '沒填的話加購時「幾分鐘」那一排不出現，名字也少了後面那個數字',
        '月檢視更分不出那天排的是 30 還是 60',
      ],
    }),
    many: (fixes) => ({
      title: `把這 ${fixes.length} 個課程的可選時長都填上？`,
      lines: fixes.map((fix) => `${fix.label} → ${fix.durationChoices.join('、')} 分鐘`),
    }),
  },
  chartNo: {
    button: () => '改成「病歷號」',
    all: (n) => `一次改這 ${n} 筆`,
    one: (fix) => ({
      title: `把「${fix.label}」那則備註改成「病歷號」？`,
      lines: [
        '匯入時寫的是「姓名欄的編號：」，那時候只是推測',
        '號碼一個字都不會動，只換前面那幾個字',
        '備註與它的純文字鏡像會一起改（ADR-0050）',
      ],
    }),
    many: (fixes) => ({
      title: `把這 ${fixes.length} 筆備註都改成「病歷號」？`,
      lines: fixes.map((fix) => `${fix.label}`),
    }),
  },
};

const KIND_TO_CHECK = {
  recount: 'counts',
  addFollowup: 'followups',
  renameChartNo: 'chartNo',
  renamePool: 'poolLabel',
  addAlert: 'alertTerm',
  addEquipment: 'seedEquipment',
  setDurations: 'seedDuration',
  setAssigns: 'courseAssigns',
  renameEquipment: 'equipmentNames',
};

/**
 * 這一筆修正要用哪一組文案。
 *
 * **對不到就是漏了一列，不要退回別人的文案。** 以前這裡寫著
 * `?? FIX_COPY.counts`，於是 `renameChartNo` 印著「改成重算值」，
 * 而按下去 `one()` 去讀那一筆根本沒有的 `fix.from.done` 就整個炸掉 ——
 * 一鍵修正在畫面上完全按不動，而畫面上什麼都沒說（ADR-0050 那一項）。
 * 現在對不到就丟例外：它會被 `render()` 的 catch 接住寫成「讀取失敗」，
 * 那比一顆長得正常、按下去沒反應的按鈕誠實。
 */
function copyFor(fix) {
  const copy = FIX_COPY[KIND_TO_CHECK[fix?.kind]];
  if (!copy) throw new Error(`資料健檢：沒有「${fix?.kind}」這種修正的文案`);
  return copy;
}
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

