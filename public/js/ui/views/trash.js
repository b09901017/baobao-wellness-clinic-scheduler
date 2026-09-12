// 已刪除項目。SPEC 第 6.1 節：刪除只是標記，這裡把它們找回來。
//
// 只要有任何一種資料能被刪，它就必須出現在這一頁 —— 刪除對話框上寫著
// 「可以在設定 → 已刪除項目 還原」，那句話不能是假的。

import * as config from '../../data/config.js';
import * as customers from '../../data/customers.js';
import * as visits from '../../data/visits.js';
import * as eventsData from '../../data/events.js';
import * as notesData from '../../data/notes.js';
import * as playbooksData from '../../data/playbooks.js';
import { linesOf } from '../../domain/playbook.js';
import { MASTER_TYPES, MASTER_LABELS } from '../../domain/masterData.js';
import { esc } from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { icon } from '../icons.js';
import { tip } from '../components/tip.js';

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let groups;
  try {
    groups = await loadGroups();
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  // 還原動作用索引對回函式：不同種類的資料還原方式不一樣，
  // 不能只靠 id 猜它是誰。
  const actions = [];
  const withRows = groups.filter((g) => g.rows.length);

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <section class="card">
      <h2 class="card__title">已刪除項目${tip(
        '系統從不真的刪除資料。這裡的每一筆都能還原。')}</h2>
    </section>
    ${withRows.length === 0 ? '<p class="muted">沒有已刪除的項目。</p>' : ''}
    ${withRows
      .map(
        (g) => `
      <section class="card">
        <h3 class="card__title">${esc(g.label)}</h3>
        ${g.rows
          .map((r) => {
            actions.push(r.restore);
            return `
          <div class="row">
            <div class="row__main">
              <div class="row__title">${esc(r.name)}</div>
              <div class="muted">${esc(r.note ? `${r.note}・` : '')}刪除於 ${formatWhen(r.deletedAt)}</div>
            </div>
            <button class="btn" type="button" data-restore="${actions.length - 1}">還原</button>
          </div>`;
          })
          .join('')}
      </section>`,
      )
      .join('')}`;

  el.querySelectorAll('[data-restore]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await confirmAction({
        title: '還原這筆資料？',
        consequences: ['它會重新出現在清單上', '引用它的資料不再顯示為「已刪除」'],
        confirmLabel: '還原',
      });
      if (!ok) return;
      try {
        await toast.withSaveState(() => actions[Number(btn.dataset.restore)](), {
          success: '已還原',
        });
        render(el);
      } catch {
        /* 已處理 */
      }
    }),
  );
}

async function loadGroups() {
  const [
    master, deletedCustomers, deletedEnts, aliveCustomers,
    deletedVisits, deletedAvail, deletedEvents, deletedNotes, deletedPlaybooks,
  ] = await Promise.all([
    Promise.all(
      MASTER_TYPES.map(async (type) => ({
        label: MASTER_LABELS[type],
        rows: (await config.listAll(type, { includeDeleted: true }))
          .filter((r) => r.deletedAt)
          .map((r) => ({
            name: r.name,
            deletedAt: r.deletedAt,
            restore: () => config.restore(type, r.id),
          })),
      })),
    ),
    customers.listDeleted(),
    customers.listDeletedEntitlements(),
    customers.list(),
    visits.listDeleted(),
    customers.listDeletedAvailability(),
    eventsData.listDeleted(),
    notesData.listDeleted(),
    playbooksData.listDeleted(),
  ]);

  const nameOf = new Map(
    [...aliveCustomers, ...deletedCustomers].map((c) => [c.id, c.name]),
  );

  return [
    ...master,
    {
      label: '客戶',
      rows: deletedCustomers.map((c) => ({
        name: c.name,
        deletedAt: c.deletedAt,
        restore: () => customers.restore(c.id),
      })),
    },
    {
      label: '來訪',
      rows: deletedVisits.map((v) => ({
        name: `${v.date} ${v.customerName ?? ''}`.trim(),
        note: `${(v.slots ?? []).length} 個時段`,
        deletedAt: v.deletedAt,
        // 還原會把次數也還原回去，所以要先知道這位客戶現在有哪些來訪
        restore: async () =>
          visits.restore(v, await visits.listByCustomer(v.customerId)),
      })),
    },
    {
      label: '額度',
      rows: deletedEnts.map((e) => ({
        name: e.label,
        note: nameOf.get(e.parentId) ?? '（客戶已刪除）',
        deletedAt: e.deletedAt,
        restore: () => customers.restoreEntitlement(e.parentId, e.id),
      })),
    },
    {
      label: '行事備註',
      rows: deletedEvents.map((e) => ({
        name: e.title ?? '（沒有名稱）',
        note: e.startDate === e.endDate ? e.startDate : `${e.startDate} 到 ${e.endDate}`,
        deletedAt: e.deletedAt,
        restore: () => eventsData.restore(e.id),
      })),
    },
    {
      label: '隨手記',
      rows: deletedNotes.map((n) => ({
        name: n.text ?? '（空的）',
        note: n.customerName ?? '沒掛客戶',
        deletedAt: n.deletedAt,
        restore: () => notesData.restore(n.id),
      })),
    },
    {
      label: '備忘錄',
      rows: deletedPlaybooks.map((p) => ({
        name: p.title ?? '（沒有標題）',
        // 掛了哪些課程答不出來（這一層沒有課程主檔），所以講行數 ——
        // 她要分辨的是「哪一份是那一份」，而長短最快。
        note: `${linesOf(p).length} 行`,
        deletedAt: p.deletedAt,
        restore: () => playbooksData.restore(p.id),
      })),
    },
    {
      label: '本輪可用性',
      rows: deletedAvail.map((a) => ({
        // 原文就是這筆資料的身分，列表上直接顯示，不用再點進去才看得到
        name: a.rawText ?? '（沒有原文）',
        note: `${nameOf.get(a.parentId) ?? '（客戶已刪除）'}・${a.validFrom ?? '?'} 到 ${a.validTo ?? '?'}`,
        deletedAt: a.deletedAt,
        restore: () => customers.restoreAvailability(a.parentId, a.id),
      })),
    },
  ];
}

function formatWhen(ts) {
  // Firestore Timestamp 或字串都可能
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? '未知時間' : d.toLocaleString('zh-TW');
}
