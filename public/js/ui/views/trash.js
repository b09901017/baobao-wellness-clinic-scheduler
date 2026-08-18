// 已刪除項目。SPEC 第 6.1 節：刪除只是標記，這裡把它們找回來。
//
// 只要有任何一種資料能被刪，它就必須出現在這一頁 —— 刪除對話框上寫著
// 「可以在設定 → 已刪除項目 還原」，那句話不能是假的。

import * as config from '../../data/config.js';
import * as customers from '../../data/customers.js';
import { MASTER_TYPES, MASTER_LABELS } from '../../domain/masterData.js';
import { esc } from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

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
    <p><a href="#/settings">← 設定</a></p>
    <section class="card">
      <h2 class="card__title">已刪除項目</h2>
      <p class="muted">系統從不真的刪除資料。這裡的每一筆都能還原。</p>
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
  const [master, deletedCustomers, deletedEnts, aliveCustomers] = await Promise.all([
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
      label: '額度',
      rows: deletedEnts.map((e) => ({
        name: e.label,
        note: nameOf.get(e.parentId) ?? '（客戶已刪除）',
        deletedAt: e.deletedAt,
        restore: () => customers.restoreEntitlement(e.parentId, e.id),
      })),
    },
  ];
}

function formatWhen(ts) {
  // Firestore Timestamp 或字串都可能
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? '未知時間' : d.toLocaleString('zh-TW');
}
