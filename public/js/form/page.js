// 客戶自己填這一輪時間的那一頁。`/form.html?t=<token>`
//
// **這一頁的使用者不是她，是她的客戶，而客戶全是長輩。**
//
// 一頁只做一件事，做完按一顆按鈕換下一頁 —— 不要往下捲。第一版把三題疊在
// 一頁裡往下捲，使用者第一次拿去用的回饋是「有點雜亂，資訊太多，往下滑更亂」，
// 所以改成兩頁：**點日曆 → 確認並送出**。理由與被推翻的那幾個決定見 ADR-0034。
//
//   點一個日期 → 底下浮出「整天／只有上午／只有下午」→ 選完就收起來
//
// 選好的東西**不在這一頁複述**，複述整個搬到第二頁 —— 那一頁本來就只有複述，
// 而日曆上的格子自己會寫著「✕／上午／下午」，第一頁不需要第二份清單。
//
// 這一頁**讀不到任何既有資料**：邀請上只有名字與月份，沒有次數、沒有病史、
// 沒有來訪。連結被轉傳的最壞情況是別人看到「某人 9 月 18 號不行」。

import * as api from '../data/publicForm.js';
import {
  monthGrid, describePicks, inviteState, FREE_TEXT_MAX,
} from '../domain/availabilityForm.js';
import { todayISO, shortDate } from '../domain/dates.js';

/** 畫面上的順序是一到日，跟她的日曆一樣。 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const PART_LABELS = { all: '整天不行', am: '只有上午不行', pm: '只有下午不行' };

// form.html 的保險絲看這一個。**一定要在這裡設，不能寫在 inline script 裡** ——
// 寫在那邊等於 module 還沒跑就先說「跑起來了」，保險絲永遠不會燒斷。
window.__formBooted = true;

const root = () => document.getElementById('root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const state = {
  token: null,
  invite: null,
  screen: 'loading',
  dates: new Map(),   // 'YYYY-MM-DD' → 'all' | 'am' | 'pm'
  freeText: '',
  sheetDate: null,    // 正在選整天／半天的那一天
  error: '',
  busy: false,
};

// ---------- 進來 ----------

start();

async function start() {
  state.token = new URLSearchParams(location.search).get('t');
  if (!state.token) return fail('這個連結不完整，麻煩您把 LINE 上收到的連結整條點開。');

  try {
    api.init();
    const invite = await api.getInvite(state.token);
    if (!invite) return fail('這個連結找不到，可能已經換過一條了。麻煩您直接在 LINE 跟我說一聲。');

    state.invite = invite;

    // 填過就不再給表單。不重填是 Rules 保證的，這裡只是讓他看得懂發生了什麼。
    const submitted = await api.getResponse(state.token);
    if (submitted) {
      loadFrom(submitted);
      state.screen = 'done';
      return paint();
    }

    // 「這條連結還能不能填」是 domain 的事，不要在這裡自己比日期字串 ——
    // 她那一側的三區也是讀同一支（ADR-0033）。
    if (inviteState(invite, todayISO()) !== 'open') {
      return fail('這一次的時間已經收完了。如果還有要調整的，直接在 LINE 跟我說就可以。');
    }

    state.screen = 'pick';
    paint();
  } catch {
    fail('連線好像不太順，麻煩您重新整理一次，或直接在 LINE 跟我說。');
  }
}

function fail(message) {
  state.screen = 'blocked';
  state.error = message;
  paint();
}

function loadFrom(response) {
  state.dates = new Map((response.dates ?? []).map((d) => [d.date, d.partOfDay ?? 'all']));
  state.freeText = response.freeText ?? '';
}

/** state 的 Map → domain 認得的形狀。`all` 在 domain 裡就是「沒有 partOfDay」。 */
function picks() {
  return {
    dates: [...state.dates.entries()].map(([date, v]) => ({
      date,
      partOfDay: v === 'am' || v === 'pm' ? v : null,
    })),
  };
}

// ---------- 畫 ----------

function paint() {
  const screens = {
    // 跟 form.html 靜態那一行同一句：JS 接手的瞬間畫面不要閃一下換句話。
    loading: () => '<p class="wait">點一下這個月不方便的日期就好，大概半分鐘。</p>',
    blocked: blockedHtml,
    pick: pickHtml,
    confirm: confirmHtml,
    done: doneHtml,
  };
  root().innerHTML = (screens[state.screen] ?? screens.loading)();
  wire();
  // 換頁一定回到最上面。長輩不會自己往上捲，捲軸停在中間他會以為東西不見了。
  if (state.screen !== 'pick' || !state.sheetDate) window.scrollTo(0, 0);
}

function blockedHtml() {
  return `<div class="card card--talk"><p class="talk">${esc(state.error)}</p></div>`;
}

// ---------- 第一頁：日曆 ----------

function pickHtml() {
  const month = Number(state.invite.month.slice(5));
  const cells = monthGrid(state.invite.month, { today: todayISO() });

  return `
    <header class="head">
      <p class="head__hello">${esc(state.invite.customerName || '您')} 您好</p>
      <h1 class="head__title">${month} 月哪幾天不方便？</h1>
      <p class="head__lead">
        點一下不方便的日期就好。整個月都方便的話，直接按下面那顆按鈕。
      </p>
    </header>

    <div class="cal">
      <div class="cal__week">
        ${WEEK_ORDER.map((w) => `<span class="cal__wd">${WEEKDAY_NAMES[w]}</span>`).join('')}
      </div>
      <div class="cal__grid">${cells.map(cellHtml).join('')}</div>
    </div>

    <button class="go" type="button" data-next>填好了</button>
    <p class="foot">送出前還會讓您確認一次。</p>

    ${state.sheetDate ? sheetHtml(state.sheetDate) : ''}`;
}

function cellHtml(cell) {
  if (!cell.date) return '<span class="cell cell--blank"></span>';
  if (cell.past) {
    return `<span class="cell cell--past"><span class="cell__d">${cell.day}</span></span>`;
  }

  const picked = state.dates.get(cell.date);
  const mark = { all: '✕', am: '上午', pm: '下午' }[picked] ?? '';

  return `
    <button class="cell ${picked ? `cell--off cell--${picked}` : ''}" type="button"
            data-date="${cell.date}" aria-pressed="${Boolean(picked)}">
      <span class="cell__d">${cell.day}</span>
      ${mark ? `<span class="cell__tag">${mark}</span>` : ''}
    </button>`;
}

/**
 * 點了一天之後浮出來的三選一。
 *
 * 從底下浮出來而不是畫面正中央：拇指構得到，而且不會蓋住日曆上半部 ——
 * 他要看得到自己剛剛點的是哪一格，才確定沒點錯。
 */
function sheetHtml(date) {
  const current = state.dates.get(date);

  return `
    <div class="sheet-back" data-close>
      <div class="sheet" role="dialog" aria-modal="true">
        <p class="sheet__title">${esc(shortDate(date))}</p>
        ${['all', 'am', 'pm'].map((v) => `
          <button class="choice ${current === v ? 'choice--on' : ''}" type="button"
                  data-set="${v}">${PART_LABELS[v]}</button>`).join('')}
        <button class="sheet__cancel" type="button" data-close>
          ${current ? '這天其實可以' : '取消'}
        </button>
      </div>
    </div>`;
}

// ---------- 第二頁：確認並送出 ----------

function confirmHtml() {
  const lines = describePicks(picks(), { month: state.invite.month });

  return `
    <div class="card">
      <h1 class="confirm__title">您告訴我的是</h1>
      <ul class="said">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>

      <p class="ask">還有什麼要跟我說的嗎？<span class="ask__opt">可以不填</span></p>
      <textarea class="free" rows="3" maxlength="${FREE_TEXT_MAX}"
                placeholder="例：這個月要出國、最近的身體狀況">${esc(state.freeText)}</textarea>

      ${state.error ? `<p class="err">${esc(state.error)}</p>` : ''}
      <button class="go" type="button" data-submit ${state.busy ? 'disabled' : ''}>
        ${state.busy ? '送出中…' : '確定送出'}
      </button>
      <button class="back" type="button" data-back ${state.busy ? 'disabled' : ''}>回去改</button>
    </div>`;
}

function doneHtml() {
  const lines = describePicks(picks(), { month: state.invite.month });
  const free = String(state.freeText ?? '').trim();

  return `
    <div class="card card--talk">
      <p class="done__mark">✓</p>
      <h1 class="confirm__title">收到了，謝謝您~</h1>
      <ul class="said">
        ${lines.map((l) => `<li>${esc(l)}</li>`).join('')}
        ${free ? `<li>${esc(free)}</li>` : ''}
      </ul>
      <p class="talk">我會照這個幫您安排，排好之後再跟您確認時間。</p>
      <p class="talk">祝您有美好的一天</p>
      <p class="talk talk--dim">如果要修改，直接在 LINE 跟我說就好。</p>
    </div>`;
}

// ---------- 接事件 ----------

function wire() {
  const el = root();

  el.querySelectorAll('[data-date]').forEach((btn) => btn.addEventListener('click', () => {
    // 點一下不直接標掉，先問整天還是半天 —— 半天在下面另外一張清單裡改，
    // 是使用者第一次試用時嫌最亂的地方。
    state.sheetDate = btn.dataset.date;
    paint();
  }));

  el.querySelectorAll('[data-set]').forEach((btn) => btn.addEventListener('click', () => {
    state.dates.set(state.sheetDate, btn.dataset.set);
    state.sheetDate = null;
    paint();
  }));

  // 背景與「取消／這天其實可以」共用：已經標過的就取消掉，沒標過的只是關起來。
  el.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', (e) => {
    if (e.target !== node) return;   // 點在卡片裡面不算點背景
    if (node.classList.contains('sheet__cancel')) state.dates.delete(state.sheetDate);
    state.sheetDate = null;
    paint();
  }));

  // 這一格刻意**不觸發重畫**。整頁是 innerHTML 重畫的，打字時重畫會讓
  // 游標跳掉、鍵盤收起來 —— 同一個坑在 .scratch/calendar-no-page-change 踩過。
  el.querySelector('.free')?.addEventListener('input', (e) => {
    state.freeText = e.target.value;
  });

  el.querySelector('[data-next]')?.addEventListener('click', () => {
    state.error = '';
    state.screen = 'confirm';
    paint();
  });
  el.querySelector('[data-back]')?.addEventListener('click', () => {
    state.error = '';
    state.screen = 'pick';
    paint();
  });
  el.querySelector('[data-submit]')?.addEventListener('click', submit);
}

async function submit() {
  if (state.busy) return;
  state.busy = true;
  state.error = '';
  paint();

  try {
    await api.submit(state.invite, { ...picks(), freeText: state.freeText });
    state.screen = 'done';
  } catch (err) {
    // 最常見的失敗是「這條連結已經填過了」或「已經過期」，兩種在 Rules 那一側
    // 都是 permission-denied。分不出來就一起講 —— 對客戶來說下一步是同一個。
    state.error = String(err?.code ?? '').includes('permission-denied')
      ? '這個連結已經填過或是已經結束了。要修改的話，直接在 LINE 跟我說就可以。'
      : '送出沒有成功，可能是網路不穩。麻煩您再按一次，或直接在 LINE 跟我說。';
    state.screen = 'confirm';
  } finally {
    state.busy = false;
    paint();
  }
}
