// 日曆。SPEC 第 8.6 節。取代 TimeTree（第 4.9 節）。
//
// 主力裝置兩者都是：手機用日／週，月檢視只在 iPad 橫式出現 ——
// 手機上一格 9px，看得到有東西但看不出是誰，那種畫面只會讓她再點一次。
//
// 這一頁只顯示她自己排的來訪。同事在 Abovee 上壓的東西這裡看不到
//（SPEC 第 4.7 節），所以「空的格子」不代表那個時段真的空著 ——
// 畫面上要講明這件事，不然她會拿這一頁當可用時段表用。

import * as config from '../../data/config.js';
import * as visitsData from '../../data/visits.js';
import {
  VIEWS, VIEW_LABELS, WEEKDAY_HEADERS,
  rangeOf, moveBy, titleOf, weekDays, monthWeeks, agendaFor, summaryByDate,
} from '../../domain/calendar.js';
import { describeStatus } from '../../domain/visits.js';
import { todayISO, shortDate } from '../../domain/dates.js';
import { esc } from '../components/form.js';

// 看到哪一天留在模組層：點進一筆來訪再退回來，她要回到原本那一頁而不是今天。
const state = { view: 'week', date: null };

export async function render(el) {
  state.date ??= todayISO();
  el.innerHTML = '<p class="muted">載入中…</p>';

  const range = rangeOf(state.view, state.date);
  let data;
  try {
    const [visits, rooms, staff] = await Promise.all([
      visitsData.listBetween(range.from, range.to),
      config.listAll('rooms'),
      config.listAll('staff'),
    ]);
    data = {
      visits,
      roomsById: Object.fromEntries(rooms.map((r) => [r.id, r])),
      staffById: Object.fromEntries(staff.map((s) => [s.id, s])),
    };
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果訊息裡有建立索引的連結，點它建好之後再回來。</p></div>`;
    return;
  }

  paint(el, data);
}

function paint(el, data) {
  const today = todayISO();

  el.innerHTML = `
    <section class="card">
      <div class="row">
        <div class="row__main">
          <div class="row__title">${esc(titleOf(state.view, state.date))}</div>
          <div class="muted">只有你自己排的來訪。同事在 Abovee 上壓的看不到，
            所以空的格子不等於那個時段真的空著。</div>
        </div>
      </div>

      <div class="chips">
        <button class="chip" type="button" data-move="-1">‹ 上一${VIEW_LABELS[state.view]}</button>
        <button class="chip" type="button" data-today>今天</button>
        <button class="chip" type="button" data-move="1">下一${VIEW_LABELS[state.view]} ›</button>
      </div>

      <div class="chips">
        ${VIEWS.map(
          (v) => `<button class="chip ${v === 'month' ? 'only-wide' : ''}" type="button"
                    data-view="${v}" aria-pressed="${v === state.view}">
                    ${VIEW_LABELS[v]}</button>`,
        ).join('')}
      </div>
    </section>

    ${bodyHtml(data, today)}`;

  el.querySelectorAll('[data-move]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.date = moveBy(state.view, state.date, Number(btn.dataset.move));
      render(el);
    }),
  );

  el.querySelector('[data-today]').addEventListener('click', () => {
    state.date = todayISO();
    render(el);
  });

  el.querySelectorAll('[data-view]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      render(el);
    }),
  );

  // 月檢視上點一天就跳到那天的日檢視 —— 月格子放不下細節，點下去才是重點
  el.querySelectorAll('[data-day]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.date = btn.dataset.day;
      state.view = 'day';
      render(el);
    }),
  );
}

function bodyHtml(data, today) {
  if (state.view === 'day') return dayHtml(data, state.date, today);
  if (state.view === 'week') return weekHtml(data, today);
  return monthHtml(data, today);
}

// ---------- 日 ----------

function dayHtml(data, date, today) {
  const rows = agendaFor(data.visits, date, data);

  return `
    <section class="card">
      <h2 class="card__title">
        ${esc(shortDate(date))}
        ${date === today ? '<span class="badge badge--ok">今天</span>' : ''}
        <span class="muted"> ${rows.length} 個時段</span>
      </h2>
      ${rows.length
        ? `<ul class="link-list">${rows.map(slotRow).join('')}</ul>`
        : '<p class="muted">這一天沒有排任何來訪。</p>'}
    </section>`;
}

function slotRow(row) {
  const where = [row.room ? `${row.room}${row.bed ?? ''}` : null, row.therapist]
    .filter(Boolean)
    .join('・');

  return `
    <li><a href="#/visits/${esc(row.visitId)}">
      <span class="link-list__label">
        <b>${esc(row.startsAt)}${row.endsAt ? `–${esc(row.endsAt)}` : ''}</b>
        ${esc(row.customerName)}
        <span class="muted">${esc([row.courseName, where].filter(Boolean).join('・'))}</span>
        ${row.clashes.length
          ? `<span class="badge badge--overdue">撞到 ${esc(row.clashes[0].what)}（${esc(
              row.clashes[0].with,
            )}）</span>`
          : ''}
      </span>
      <span class="badge ${statusClass(row.status)}">${esc(describeStatus(row.status))}</span>
    </a></li>`;
}

function statusClass(status) {
  if (status === 'pending_confirm') return 'badge--soon';
  if (status === 'no_show') return 'badge--overdue';
  return 'badge--ok';
}

// ---------- 週 ----------
//
// 手機是七段直的清單，iPad 橫式才變成七欄。一週是她真正在規劃的單位，
// 所以這裡要看得到每一天實際排了誰，不能只給一個數字。

function weekHtml(data, today) {
  const days = weekDays(state.date);

  return `
    <div class="weekgrid">
      ${days
        .map((date) => {
          const rows = agendaFor(data.visits, date, data);
          return `
            <section class="card ${date === today ? 'day--today' : ''}">
              <h3 class="card__title">
                <button class="link-plain" type="button" data-day="${esc(date)}">
                  ${esc(shortDate(date))}
                </button>
                <span class="muted"> ${rows.length}</span>
              </h3>
              ${rows.length
                ? `<ul class="link-list">${rows.map(compactRow).join('')}</ul>`
                : '<p class="muted">沒有安排</p>'}
            </section>`;
        })
        .join('')}
    </div>`;
}

function compactRow(row) {
  return `
    <li><a href="#/visits/${esc(row.visitId)}">
      <span class="link-list__label">
        <b>${esc(row.startsAt)}</b> ${esc(row.customerName)}
        <span class="muted">${esc(row.courseName)}</span>
        ${row.clashes.length ? '<span class="badge badge--overdue">撞到</span>' : ''}
      </span>
    </a></li>`;
}

// ---------- 月 ----------

function monthHtml(data, today) {
  const weeks = monthWeeks(state.date.slice(0, 7));
  const summary = summaryByDate(data.visits);

  return `
    <section class="card">
      <div class="monthgrid">
        ${WEEKDAY_HEADERS.map((w) => `<div class="monthgrid__head">${w}</div>`).join('')}
        ${weeks
          .flat()
          .map((cell) => monthCell(cell, summary[cell.date], today))
          .join('')}
      </div>
      <p class="muted">點一天看那天的細節。灰掉的是鄰月的日子。</p>
    </section>`;
}

function monthCell({ date, inMonth }, day, today) {
  const names = day?.names ?? [];

  return `
    <button class="monthgrid__cell ${inMonth ? '' : 'day--off'} ${date === today ? 'day--today' : ''}"
            type="button" data-day="${esc(date)}">
      <span class="monthgrid__date">${Number(date.slice(8))}</span>
      ${day
        ? `<span class="monthgrid__count">
             ${day.visits}
             ${day.pending ? `<span class="badge badge--soon">${day.pending}</span>` : ''}
           </span>
           <span class="monthgrid__names">${esc(names.slice(0, 3).join('、'))}${
             names.length > 3 ? `…+${names.length - 3}` : ''
           }</span>`
        : ''}
    </button>`;
}
