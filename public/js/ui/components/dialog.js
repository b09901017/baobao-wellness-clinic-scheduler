// 二次確認對話框。
//
// SPEC 第 6.5 節：確認框要顯示具體後果，不要只有「確定嗎？」。
// 所以 consequences 是必填的，不給就沒有東西可以顯示。

import { pushLayer } from '../nav.js';

let openDialog = null;

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string[]} opts.consequences 這個動作會造成什麼，一條一行
 * @param {string} [opts.confirmLabel]
 * @param {boolean} [opts.danger] 破壞性操作，按鈕變紅
 * @returns {Promise<boolean>}
 */
export function confirmAction({ title, consequences, confirmLabel = '確定', danger = false }) {
  return new Promise((resolve) => {
    close();

    const el = document.createElement('div');
    el.className = 'dialog-backdrop';
    el.innerHTML = `
      <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 class="card__title" id="dlg-title">${title}</h2>
        <ul class="dialog__list">
          ${consequences.map((c) => `<li>${c}</li>`).join('')}
        </ul>
        <div class="dialog__actions">
          <button class="btn" type="button" data-cancel>取消</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-ok>
            ${confirmLabel}
          </button>
        </div>
      </div>`;

    // 對話框也吃返回鍵，而且**返回等於取消**。這一顆很重要：破壞性操作的
    // 二次確認如果被返回鍵略過，那顆「刪除」會在她以為自己取消了的時候執行。
    const layer = pushLayer(() => finish(false, { fromBack: true }));

    const finish = (answer, { fromBack = false } = {}) => {
      if (!fromBack) layer.pop();
      close();
      resolve(answer);
    };

    el.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    el.querySelector('[data-ok]').addEventListener('click', () => finish(true));
    // 點背景等於取消。破壞性操作不會因為誤觸背景而執行。
    el.addEventListener('click', (e) => {
      if (e.target === el) finish(false);
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        finish(false);
      }
    });

    document.body.appendChild(el);
    openDialog = el;
    el.querySelector('[data-cancel]').focus();
  });
}

function close() {
  openDialog?.remove();
  openDialog = null;
}
