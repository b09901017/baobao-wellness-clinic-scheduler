// 設定 → AI 用量（issue 05，ADR-0100）。
//
// 她 2026-09-17：「如果可以的話可以在設定那邊看到目前用了多少ai錢」「然後也要給ai預算限制」。
//
// **每一個金額都寫「估計」**，理由收在那一顆 `?`：照 2027 年的價格算、Google 帳單另外還有別的東西。
// 這一頁上沒有任何一個數字是 Google 的帳單金額。
//
// 數字與句子在 `domain/aiUsage.js`，讀寫在 `data/aiUsage.js`。

import * as ai from '../../data/aiUsage.js';
import {
  CEILING_USD, formatUsd, monthKey, usageView, validateCap,
} from '../../domain/aiUsage.js';
import * as f from '../components/form.js';
import { tip } from '../components/tip.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';

const ESTIMATE_TIP = '照 2027 年的價格算（Gemini 今年底前是優惠價），所以今年底前實際帳單會比這個低。'
  + 'Google 的帳單另外還有資料庫、網站這些，不在這裡面。上限擋的就是這個估計值。';

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  const now = new Date();
  const month = monthKey(now);

  let config;
  let usage;
  let calls;
  try {
    [config, usage, calls] = await Promise.all([
      ai.readConfig(), ai.readMonth(month), ai.recentCalls(month, 20),
    ]);
  } catch (err) {
    el.innerHTML = `<a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
      <div class="card"><p>讀取失敗：${f.esc(err.message)}</p></div>`;
    return;
  }

  const v = usageView(usage, config, calls, now);

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>

    <section class="card aiuse" data-aiuse>
      <h2 class="card__title">這個月估計${tip(ESTIMATE_TIP)}</h2>
      <p class="aiuse__big">
        <span class="aiuse__usd" data-month-usd>${f.esc(formatUsd(v.monthUsd))}</span>
        <span class="aiuse__cap">／上限 ${f.esc(formatUsd(v.capUsd))}</span>
      </p>
      <div class="aiuse__meter${v.warn ? ' aiuse__meter--warn' : ''}" role="img"
           aria-label="用了上限的 ${v.percent}%">
        <span style="width: ${v.percent}%"></span>
      </div>
      <dl class="aiuse__facts">
        <div><dt>今天</dt><dd data-today>${v.todayCalls} 次／每天最多 ${v.dailyLimit} 次</dd></div>
        <div><dt>這個月</dt><dd data-total>${v.totalCalls} 次${v.blocked ? `，被擋 ${v.blocked} 次` : ''}</dd></div>
      </dl>
      ${v.paused ? '<p class="aiuse__paused" data-paused-note>AI 暫停中 —— 四個拍照的地方都不會叫 AI</p>' : ''}
    </section>

    <section class="card">
      <h2 class="card__title">四種單子</h2>
      <ul class="aiuse__kinds">
        ${v.kinds.map((k) => `
          <li data-kind="${k.kind}">
            <span>${f.esc(k.label)}</span>
            <span class="aiuse__num">${k.calls} 次</span>
            <span class="aiuse__num">估計 ${f.esc(formatUsd(k.estUsd))}</span>
          </li>`).join('')}
      </ul>
    </section>

    <section class="card">
      <h2 class="card__title">最近 ${v.recent.length || ''} 次${tip('只記時間、哪一種單子、結果與估計多少，照片與辨識出來的字都不留。')}</h2>
      ${v.recent.length ? `
        <ul class="aiuse__recent" data-recent>
          ${v.recent.map((r) => `
            <li class="aiuse__call aiuse__call--${f.esc(r.outcomeKind)}">
              <span class="aiuse__time">${f.esc(r.time)}</span>
              <span>${f.esc(r.label)}</span>
              <span class="aiuse__outcome">${f.esc(r.outcome)}</span>
              <span class="aiuse__num">${f.esc(formatUsd(r.estUsd))}</span>
            </li>`).join('')}
        </ul>` : '<p class="muted">這個月還沒有辨識過。</p>'}
    </section>

    <section class="card">
      <h2 class="card__title">上限與暫停</h2>
      <div class="errors" data-errors hidden></div>
      <form data-cap-form>
        ${f.number({
          name: 'monthlyCapUsd', label: '每月上限（美元）', value: v.capUsd, min: 0, step: 1,
          hint: `這個月估計花到這個數字就不再叫 AI。最多 US$${CEILING_USD} —— 那是程式裡的天花板，`
            + '怕哪天手滑多打一個 0。填 0 等於關掉。',
        })}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">存上限</button>
        </div>
      </form>
      <div class="aiuse__pause">
        <button class="btn${v.paused ? ' btn--primary' : ''}" type="button" data-pause
                aria-pressed="${v.paused}">${v.paused ? '打開 AI' : '暫停 AI'}</button>
        ${tip('暫停之後四個拍照的地方都不會叫 AI，會講「AI 暫停中」。已經記進去的資料不受影響。')}
      </div>
    </section>`;

  el.querySelector('[data-cap-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { monthlyCapUsd } = f.readForm(e.target);
    const errors = validateCap(monthlyCapUsd);
    f.showErrors(el, errors);
    if (errors.length) return;
    try {
      await toast.withSaveState(() => ai.saveConfig({ monthlyCapUsd }), {
        success: `每月上限改成 US$${monthlyCapUsd}`, key: 'ai:cap',
      });
      render(el);
    } catch {
      /* 已處理 */
    }
  });

  el.querySelector('[data-pause]').addEventListener('click', async () => {
    const paused = !v.paused;
    try {
      await toast.withSaveState(() => ai.saveConfig({ paused }), {
        success: paused ? 'AI 暫停了' : 'AI 打開了', key: 'ai:pause',
      });
      render(el);
    } catch {
      /* 已處理 */
    }
  });
}
