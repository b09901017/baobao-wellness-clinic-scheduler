// 已刪除項目。SPEC 第 6.1 節：刪除只是標記，這裡把它們找回來。

import * as config from '../../data/config.js';
import { MASTER_TYPES, MASTER_LABELS } from '../../domain/masterData.js';
import { esc } from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let groups;
  try {
    groups = await Promise.all(
      MASTER_TYPES.map(async (type) => ({
        type,
        rows: (await config.listAll(type, { includeDeleted: true })).filter((r) => r.deletedAt),
      })),
    );
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

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
        <h3 class="card__title">${MASTER_LABELS[g.type]}</h3>
        ${g.rows
          .map(
            (r) => `
          <div class="row">
            <div class="row__main">
              <div class="row__title">${esc(r.name)}</div>
              <div class="muted">刪除於 ${formatWhen(r.deletedAt)}</div>
            </div>
            <button class="btn" type="button"
              data-restore="${esc(r.id)}" data-type="${esc(g.type)}">還原</button>
          </div>`,
          )
          .join('')}
      </section>`,
      )
      .join('')}`;

  el.querySelectorAll('[data-restore]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const { restore: id, type } = btn.dataset;
      const ok = await confirmAction({
        title: '還原這筆資料？',
        consequences: ['它會重新出現在清單上', '新增來訪時又可以選到它'],
        confirmLabel: '還原',
      });
      if (!ok) return;
      try {
        await toast.withSaveState(() => config.restore(type, id), { success: '已還原' });
        render(el);
      } catch {
        /* 已處理 */
      }
    }),
  );
}

function formatWhen(ts) {
  // Firestore Timestamp 或字串都可能
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? '未知時間' : d.toLocaleString('zh-TW');
}
