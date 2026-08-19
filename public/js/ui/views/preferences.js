// 排序權重與時段間隔。SPEC 第 9 節。
//
// 權重做成可調是刻意的：一開始沒人知道對的值，讓她用兩週後自己微調。

import * as config from '../../data/config.js';
import { DEFAULT_SETTINGS } from '../../domain/seed.js';
import * as f from '../components/form.js';
import * as toast from '../toast.js';
import { icon } from '../icons.js';

const WEIGHTS = [
  { key: 'w1', label: 'w1 · 限制越多越優先', hint: '可用天數越少排越前面' },
  { key: 'w2', label: 'w2 · 喜好程度', hint: '重要客戶往前排' },
  { key: 'w3', label: 'w3 · 快到期又沒上完', hint: '剩餘次數 ÷ 距方案到期天數' },
  { key: 'w4', label: 'w4 · 距上次上課天數', hint: '太久沒來的往前排' },
];

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let s;
  try {
    s = await config.getSettings();
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${f.esc(err.message)}</p></div>`;
    return;
  }

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <section class="card">
      <h2 class="card__title">待排佇列的排序權重</h2>
      <p class="muted">
        分數 = w1×限制 + w2×喜好 + w3×急迫 + w4×間隔。
        排序只是建議，每張卡片都會用人話寫出理由，你隨時可以跳著處理。
      </p>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${WEIGHTS.map((w) =>
          f.number({
            name: w.key, label: w.label,
            value: s.sortWeights?.[w.key] ?? DEFAULT_SETTINGS.sortWeights[w.key],
            min: 0, step: 0.1, hint: w.hint,
          }),
        ).join('')}

        <h3 class="card__title">其他</h3>
        ${f.number({
          name: 'slotGapMin', label: '來訪內時段間隔（分鐘）',
          value: s.slotGapMin ?? DEFAULT_SETTINGS.slotGapMin, min: 0, step: 5,
          hint: '一次來訪含多個連續時段，中間預設隔這麼久。',
        })}
        ${f.number({
          name: 'noReplyDays', label: '幾天沒回覆就跳紅色',
          value: s.noReplyDays ?? DEFAULT_SETTINGS.noReplyDays, min: 1, step: 1,
          hint: '已壓表但客人還沒回，超過這個天數會在待辦中心變紅。',
        })}

        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-reset>回復預設值</button>
        </div>
      </form>
    </section>`;

  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.readForm(e.target);

    const errors = [];
    for (const w of WEIGHTS) {
      if (!(v[w.key] >= 0)) errors.push(`${w.label} 必須是 0 或正數`);
    }
    if (!(v.slotGapMin >= 0)) errors.push('時段間隔必須是 0 或正數');
    if (!(v.noReplyDays >= 1)) errors.push('未回覆天數至少要 1 天');
    f.showErrors(el, errors);
    if (errors.length) return;

    const next = {
      sortWeights: Object.fromEntries(WEIGHTS.map((w) => [w.key, v[w.key]])),
      slotGapMin: v.slotGapMin,
      noReplyDays: v.noReplyDays,
    };
    try {
      await toast.withSaveState(() => config.saveSettings(next), { success: '已儲存' });
    } catch {
      /* 已處理 */
    }
  });

  el.querySelector('[data-reset]').addEventListener('click', async () => {
    try {
      await toast.withSaveState(() => config.saveSettings(DEFAULT_SETTINGS), {
        success: '已回復預設值',
      });
      render(el);
    } catch {
      /* 已處理 */
    }
  });
}
