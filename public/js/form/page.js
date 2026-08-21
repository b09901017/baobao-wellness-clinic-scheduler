// 客戶自己填這一輪時間的那一頁。`/form.html?t=<token>`
//
// **這一頁的使用者不是她，是她的客戶，而客戶全是長輩。** 所以整頁只有一條規則：
//
//   點一下 = 那個時間整天不行。要改成半天，在下面那一列改。
//
// 不做「點第二下變上午、第三下變下午」的三態循環 —— 誤觸看不出來，
// 而且點錯了要再點三下才回得到原點，長輩到第二下就會放棄。
// 也不做拖拉：拖拉要關掉那一區的原生捲動，長輩想捲頁時畫面不動會以為當掉了。
// 連續的日子點兩三下就有了，而且每一下都有回饋。理由見
// `.scratch/customer-availability-form/spec.md` 第 2 節。
//
// 被選起來的東西一律**複述成一列一列的中文**。那張清單同時做三件事：
// 讓誤觸看得見、讓取消只要一下、讓長輩看到自己講的話被寫成中文才敢按送出。
//
// 這一頁**讀不到任何既有資料**：邀請上只有名字與月份，沒有次數、沒有病史、
// 沒有來訪。連結被轉傳的最壞情況是別人看到「某人 9 月 18 號不行」。

import * as api from '../data/publicForm.js';
import {
  monthGrid, weekdayBlock, describePicks, dateLabel, inviteState, FREE_TEXT_MAX,
} from '../domain/availabilityForm.js';
import { todayISO } from '../domain/dates.js';

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
/** 畫面上的順序是一到日，跟她的日曆一樣。 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
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
  weekdays: new Map(),   // weekday(0-6) → 'all' | 'am' | 'pm'
  dates: new Map(),      // 'YYYY-MM-DD' → 'all' | 'am' | 'pm'
  freeText: '',
  openWeekday: null,     // 哪一列的三選一被打開了
  openDate: null,
  notice: '',
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

    if (inviteState(invite, todayISO()) === 'expired') {
      return fail('這一次的時間已經收完了。如果還有要調整的，直接在 LINE 跟我說就可以。');
    }

    state.screen = 'form';
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
  state.weekdays = new Map((response.weekdays ?? []).map((w) => [w.weekday, w.partOfDay ?? 'all']));
  state.dates = new Map((response.dates ?? []).map((d) => [d.date, d.partOfDay ?? 'all']));
  state.freeText = response.freeText ?? '';
}

/** state 的 Map → domain 認得的形狀。`all` 在 domain 裡就是「沒有 partOfDay」。 */
function picks() {
  const part = (v) => (v === 'am' || v === 'pm' ? v : null);
  return {
    weekdays: [...state.weekdays.entries()].map(([weekday, v]) => ({ weekday, partOfDay: part(v) })),
    dates: [...state.dates.entries()].map(([date, v]) => ({ date, partOfDay: part(v) })),
    freeText: state.freeText,
  };
}

// ---------- 畫 ----------

function paint() {
  const screens = {
    loading: () => '<p class="wait">載入中…</p>',
    blocked: blockedHtml,
    form: formHtml,
    confirm: confirmHtml,
    done: doneHtml,
  };
  root().innerHTML = (screens[state.screen] ?? screens.loading)();
  wire();
  if (state.screen !== 'form') window.scrollTo(0, 0);
}

function blockedHtml() {
  return `
    <div class="card card--talk">
      <p class="talk">${esc(state.error)}</p>
    </div>`;
}

function formHtml() {
  const month = Number(state.invite.month.slice(5));

  return `
    <header class="head">
      <p class="head__hello">${esc(state.invite.customerName || '您')} 您好</p>
      <h1 class="head__title">要幫您安排 ${month} 月的課程</h1>
      <p class="head__lead">
        麻煩您把 ${month} 月<b>不方便</b>的時間點一點，大概半分鐘就好。
      </p>
    </header>

    <button class="allok" type="button" data-allok>
      這個月都可以，沒問題
    </button>

    ${weekdaySection()}
    ${dateSection(month)}
    ${freeSection()}

    ${state.error ? `<p class="err">${esc(state.error)}</p>` : ''}

    <button class="go" type="button" data-next>好了，下一步</button>
    <p class="foot">送出前還會讓您確認一次。</p>`;
}

// ---------- ① 固定哪個星期不行 ----------

function weekdaySection() {
  return `
    <section class="sec">
      <h2 class="sec__title"><span class="sec__n">1</span>固定哪個星期不行？</h2>
      <p class="sec__hint">例如每個禮拜五要回診。沒有的話這一題跳過就好。</p>

      <div class="pills">
        ${WEEK_ORDER.map((w) => {
          const on = state.weekdays.has(w);
          return `
            <button class="pill ${on ? 'pill--on' : ''}" type="button" data-weekday="${w}"
                    aria-pressed="${on}">
              <span class="pill__cap">禮拜</span>${WEEKDAY_NAMES[w]}
            </button>`;
        }).join('')}
      </div>

      ${recap(
        WEEK_ORDER.filter((w) => state.weekdays.has(w)).map((w) => ({
          key: String(w),
          what: `每個禮拜${WEEKDAY_NAMES[w]}`,
          value: state.weekdays.get(w),
          open: state.openWeekday === w,
          kind: 'weekday',
        })),
        '您說固定不行的',
      )}
    </section>`;
}

// ---------- ② 這個月哪幾天不行 ----------

function dateSection(month) {
  const cells = monthGrid(state.invite.month, { today: todayISO() });
  // 算一次就好。每一格各自呼叫 picks() 會把整份勾選重建三十次。
  const blocking = picks().weekdays;

  return `
    <section class="sec">
      <h2 class="sec__title"><span class="sec__n">2</span>${month} 月有哪幾天不行？</h2>
      <p class="sec__hint">點一下就是那天整天不行，再點一下取消。</p>

      ${state.notice ? `
        <p class="notice">
          ${esc(state.notice)}
          <button class="notice__go" type="button" data-toweek>回去改</button>
        </p>` : ''}

      <div class="cal">
        <div class="cal__week">
          ${WEEK_ORDER.map((w) => `<span class="cal__wd">${WEEKDAY_NAMES[w]}</span>`).join('')}
        </div>
        <div class="cal__grid">${cells.map((c) => cellHtml(c, blocking)).join('')}</div>
      </div>

      ${recap(
        [...state.dates.keys()].sort().map((date) => ({
          key: date,
          what: dateLabel(date),
          value: state.dates.get(date),
          open: state.openDate === date,
          kind: 'date',
        })),
        '您說不方便的日子',
      )}
    </section>`;
}

function cellHtml(cell, blocking) {
  if (!cell.date) return '<span class="cell cell--blank"></span>';

  // 已經說過「每個禮拜五不行」就不要再讓他一個一個點禮拜五 —— 白費力氣，
  // 而且點了會產生兩條互相重複的規則。
  const blocked = weekdayBlock(blocking, cell.date);
  if (blocked) {
    return `
      <button class="cell cell--byweek" type="button" data-blocked="${cell.weekday}">
        <span class="cell__d">${cell.day}</span>
        <span class="cell__tag">${blocked === 'all' ? '不行' : PART_LABELS[blocked].slice(2, 4)}</span>
      </button>`;
  }

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

// ---------- 複述清單 ----------
//
// 它不只是顯示。它是這一頁最重要的元件：誤觸在這裡看得見，取消在這裡只要一下，
// 而半天在這裡改 —— 那三顆按鈕擠在 44px 的格子裡誰都點不準。

function recap(rows, title) {
  if (!rows.length) return '';

  return `
    <div class="recap">
      <p class="recap__title">${esc(title)}</p>
      ${rows.map((row) => `
        <div class="recap__row">
          <span class="recap__what">${esc(row.what)}</span>
          <button class="recap__part" type="button"
                  data-open="${row.kind}:${esc(row.key)}">
            ${PART_LABELS[row.value] ?? PART_LABELS.all}
            <span class="recap__caret">▾</span>
          </button>
          <button class="recap__x" type="button" data-drop="${row.kind}:${esc(row.key)}"
                  aria-label="取消這一項">✕</button>
        </div>
        ${row.open ? `
          <div class="choices">
            ${['all', 'am', 'pm'].map((v) => `
              <button class="choice ${row.value === v ? 'choice--on' : ''}" type="button"
                      data-set="${row.kind}:${esc(row.key)}:${v}">${PART_LABELS[v]}</button>`).join('')}
          </div>` : ''}`).join('')}
    </div>`;
}

// ---------- ③ 還有什麼要說的 ----------

function freeSection() {
  return `
    <section class="sec">
      <h2 class="sec__title"><span class="sec__n">3</span>還有什麼要跟我說的嗎？</h2>
      <p class="sec__hint">可以不填。例如這個月要出國、最近的身體狀況。</p>
      <textarea class="free" rows="3" maxlength="${FREE_TEXT_MAX}"
                placeholder="例：9/22 要出國八天">${esc(state.freeText)}</textarea>
    </section>`;
}

// ---------- 送出前的確認 ----------
//
// 長輩填表最大的恐懼是「我不知道自己按了什麼」。這一頁值一半的成本。

function confirmHtml() {
  const lines = describePicks(picks());

  return `
    <div class="card">
      <h1 class="confirm__title">您告訴我的是</h1>
      <ul class="said">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${state.error ? `<p class="err">${esc(state.error)}</p>` : ''}
      <button class="go" type="button" data-submit ${state.busy ? 'disabled' : ''}>
        ${state.busy ? '送出中…' : '確定送出'}
      </button>
      <button class="back" type="button" data-back ${state.busy ? 'disabled' : ''}>回去改</button>
    </div>`;
}

function doneHtml() {
  const lines = describePicks(picks());

  return `
    <div class="card card--talk">
      <p class="done__mark">✓</p>
      <h1 class="confirm__title">收到了，謝謝您</h1>
      <ul class="said">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="talk">我會照這個幫您安排，排好之後再跟您確認時間。</p>
      <p class="talk talk--dim">如果要修改，直接在 LINE 跟我說就好。</p>
    </div>`;
}

// ---------- 接事件 ----------

function wire() {
  const el = root();

  el.querySelector('[data-allok]')?.addEventListener('click', () => {
    state.weekdays.clear();
    state.dates.clear();
    state.freeText = '';
    goConfirm();
  });

  el.querySelectorAll('[data-weekday]').forEach((btn) => btn.addEventListener('click', () => {
    const w = Number(btn.dataset.weekday);
    // 點一下就是整天不行 —— 最常見的答案一下就完成。要改半天去下面那一列。
    if (state.weekdays.has(w)) {
      state.weekdays.delete(w);
      if (state.openWeekday === w) state.openWeekday = null;
    } else {
      state.weekdays.set(w, 'all');
      state.openWeekday = null;
    }
    state.notice = '';
    paint();
  }));

  el.querySelectorAll('[data-date]').forEach((btn) => btn.addEventListener('click', () => {
    const { date } = btn.dataset;
    if (state.dates.has(date)) {
      state.dates.delete(date);
      if (state.openDate === date) state.openDate = null;
    } else {
      state.dates.set(date, 'all');
      state.openDate = null;
    }
    state.notice = '';
    paint();
  }));

  el.querySelectorAll('[data-blocked]').forEach((btn) => btn.addEventListener('click', () => {
    const w = Number(btn.dataset.blocked);
    const part = state.weekdays.get(w);
    state.notice = `這一天您已經說過「每個禮拜${WEEKDAY_NAMES[w]}${
      part === 'all' ? '' : PART_LABELS[part].slice(2, 4)}不行」了。`;
    paint();
  }));

  el.querySelector('[data-toweek]')?.addEventListener('click', () => {
    state.notice = '';
    paint();
    root().querySelector('.pills')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  el.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => {
    const [kind, key] = splitOnce(btn.dataset.open);
    if (kind === 'weekday') {
      state.openWeekday = state.openWeekday === Number(key) ? null : Number(key);
      state.openDate = null;
    } else {
      state.openDate = state.openDate === key ? null : key;
      state.openWeekday = null;
    }
    paint();
  }));

  el.querySelectorAll('[data-set]').forEach((btn) => btn.addEventListener('click', () => {
    const raw = btn.dataset.set;
    const kind = raw.slice(0, raw.indexOf(':'));
    const rest = raw.slice(raw.indexOf(':') + 1);
    const value = rest.slice(rest.lastIndexOf(':') + 1);
    const key = rest.slice(0, rest.lastIndexOf(':'));

    if (kind === 'weekday') {
      state.weekdays.set(Number(key), value);
      state.openWeekday = null;
    } else {
      state.dates.set(key, value);
      state.openDate = null;
    }
    paint();
  }));

  el.querySelectorAll('[data-drop]').forEach((btn) => btn.addEventListener('click', () => {
    const [kind, key] = splitOnce(btn.dataset.drop);
    if (kind === 'weekday') {
      state.weekdays.delete(Number(key));
      state.openWeekday = null;
    } else {
      state.dates.delete(key);
      state.openDate = null;
    }
    paint();
  }));

  // 這一格刻意**不觸發重畫**。整頁是 innerHTML 重畫的，打字時重畫會讓
  // 游標跳掉、鍵盤收起來 —— 同一個坑在 .scratch/calendar-no-page-change 踩過。
  el.querySelector('.free')?.addEventListener('input', (e) => {
    state.freeText = e.target.value;
  });

  el.querySelector('[data-next]')?.addEventListener('click', goConfirm);
  el.querySelector('[data-back]')?.addEventListener('click', () => {
    state.error = '';
    state.screen = 'form';
    paint();
  });
  el.querySelector('[data-submit]')?.addEventListener('click', submit);
}

const splitOnce = (raw) => [raw.slice(0, raw.indexOf(':')), raw.slice(raw.indexOf(':') + 1)];

function goConfirm() {
  state.error = '';
  state.notice = '';
  state.screen = 'confirm';
  paint();
}

async function submit() {
  if (state.busy) return;
  state.busy = true;
  state.error = '';
  paint();

  try {
    await api.submit(state.invite, picks());
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
