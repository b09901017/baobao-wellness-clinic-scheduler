// 設定 → 待辦首頁：每一列「一直顯示／有才顯示／不顯示」。ADR-0151。
//
// 她 10/18：「我希望所有的待辦，每一步……都可以在設定打開或隱藏或呈現……即使沒有人有這個待辦，
// 也可以呈現他」。名單、預設、「畫不畫」全部在 `domain/todoFlow.js`，這一頁只畫與存。
//
// 存在 `config/app` 的 `todoRows`（手機與 iPad 同一份、有稽核），**只存跟預設不一樣的**
//（`storedRowShows()`）—— 之後改預設，她沒動過的那幾列會跟著。

import * as config from '../../data/config.js';
import {
  HOME_ROWS, STAGES, stageOf, rowShowOf, storedRowShows,
} from '../../domain/todoFlow.js';
import * as f from '../components/form.js';
import * as toast from '../toast.js';
import { icon } from '../icons.js';

const esc = f.esc;

const SHOW_LABELS = { always: '一直顯示', auto: '有才顯示', hidden: '不顯示' };

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let settings;
  try {
    settings = await config.getSettings();
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  // 這一頁上現在的樣子。每按一顆就整份存一次（存的是跟預設不一樣的那幾格）
  const shows = Object.fromEntries(HOME_ROWS.map((r) => [r.id, rowShowOf(r.id, settings)]));

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <div class="page">
      <h1 class="page__title">待辦首頁</h1>
    </div>
    <div data-todorows>
    ${STAGES.map((stage) => {
      const mine = HOME_ROWS.filter((r) => stageOf(r.id) === stage.id);
      if (!mine.length) return '';
      return `
        <section class="card todorows">
          <h2 class="card__title"><span class="num">${stage.n}</span> ${esc(stage.label)}</h2>
          ${mine.map((r) => `
            <div class="todorows__row" data-row="${esc(r.id)}">
              <span class="todorows__label">${esc(r.label)}</span>
              <div class="seg" role="group" aria-label="${esc(r.label)}">
                ${Object.entries(SHOW_LABELS).map(([v, label]) => `
                  <button class="seg__item" type="button" data-show="${v}"
                          aria-pressed="${shows[r.id] === v}">${label}</button>`).join('')}
              </div>
            </div>`).join('')}
        </section>`;
    }).join('')}
    </div>`;

  // 掛在這一頁自己的那一塊上，不掛在 `el` —— `el` 換頁之後還在，掛上去的話每進來一次就多一組
  el.querySelector('[data-todorows]').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-show]');
    const row = btn?.closest('[data-row]');
    if (!row || btn.getAttribute('aria-pressed') === 'true') return;

    shows[row.dataset.row] = btn.dataset.show;
    for (const b of row.querySelectorAll('[data-show]')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    try {
      await toast.withSaveState(
        () => config.saveSettings({ todoRows: storedRowShows(shows) }),
        { success: '已儲存' },
      );
    } catch {
      /* 已處理 */
    }
  });
}
