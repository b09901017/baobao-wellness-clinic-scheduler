// 時段反查。SPEC 第 8.4 節。
//
// 主力裝置是手機：Abovee 上臨時空出一格、或有人取消釋出時段時，她通常人不在桌前。
// 所以這一頁只有三個欄位（日期、時間、課程），按一下就出名單，
// 每一位旁邊直接有一則可以貼到 LINE 的邀約訊息 —— 她要做的事就是問人。
//
// 排序用的是壓表那一套公式（domain/scheduling.js），不是另一套：
// 同一位客戶在壓表排第一、在這裡排第五的話，她沒辦法知道哪個才算數。
//
// 這一頁**不自動通知任何人**，也不替她決定要問誰（ADR-0002）。
// 排除掉的人也要列出來並說明理由 —— 「他為什麼不在名單上」跟「誰在名單上」
// 一樣重要，看不到理由她就不敢用這份名單。

import * as config from '../../data/config.js';
import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import { candidatesFor, strongestReason, monthRange } from '../../domain/scheduling.js';
import { offerSlotMessage } from '../../domain/messages.js';
import { endOf, isValidTime } from '../../domain/visitTime.js';
import { todayISO, addDays, shortDate, isValidDate } from '../../domain/dates.js';
import { splitFlags } from '../../domain/customers.js';
import * as flagsUi from '../components/flags.js';
import * as f from '../components/form.js';
import { icon } from '../icons.js';
import * as message from '../components/message.js';
import * as toast from '../toast.js';

const esc = f.esc;

// 查過的條件留著：她問了三個人都說不行，回來換一個課程再查一次是常見的動作。
let form = null;

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let all;
  try {
    all = await config.loadAll();
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  const courses = all.courses.filter((c) => c.active !== false);
  if (!courses.length) {
    el.innerHTML = `
      <a class="backlink" href="#/schedule">${icon('left', { size: 19 })}壓表</a>
      <div class="card"><p>還沒有課程主檔，沒有東西可以查。</p>
      <p><a href="#/settings/courses">去新增課程</a></p></div>`;
    return;
  }

  const today = todayISO();
  form ??= {
    date: today,
    startsAt: '14:00',
    courseId: courses[0].id,
  };
  // 課程可能在上次查完之後被刪掉或停用了
  if (!courses.some((c) => c.id === form.courseId)) form.courseId = courses[0].id;

  paintForm(el, { all, courses, today });
}

function paintForm(el, ctx, result = null) {
  const { courses, today } = ctx;
  const course = courses.find((c) => c.id === form.courseId);
  const endsAt = endOfSlot(course);

  el.innerHTML = `
    <a class="backlink" href="#/schedule">${icon('left', { size: 19 })}壓表</a>

    <div class="page">
      <h1 class="page__title">時段反查</h1>
      <p class="page__lead">臨時空出一格時，誰可以補。用的是跟壓表同一套順序 ——
        不會兩個畫面給你兩種答案。</p>
    </div>

    <section class="card">
      <form data-form>
        ${f.date({ name: 'date', label: '日期', value: form.date, hint: hintFor(form.date, today) })}
        ${f.time({ name: 'startsAt', label: '開始時間', value: form.startsAt })}
        ${f.select({
          name: 'courseId', label: '課程', value: form.courseId,
          options: courses.map((c) => ({ value: c.id, label: c.name })),
          hint: endsAt ? `依課程時長算到 ${endsAt}` : '這個課程沒有設定時長，只用開始時間比對',
        })}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">查誰可以補</button>
        </div>
      </form>
    </section>

    ${result ? resultHtml(result, ctx) : ''}`;

  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.readForm(e.target);
    form = { date: v.date, startsAt: v.startsAt, courseId: v.courseId };
    await search(el, ctx);
  });

  message.wire(el, toast.info);
}

function hintFor(date, today) {
  if (!date) return '';
  if (date === today) return '今天';
  if (date === addDays(today, 1)) return '明天';
  return date < today ? '這是過去的日期' : shortDate(date);
}

/** 時段的結束時間用課程時長推出來，她不用再打一次。 */
function endOfSlot(course) {
  const start = form?.startsAt;
  if (!isValidTime(start) || !course?.durationMin) return null;
  return endOf(start, course.durationMin);
}

async function search(el, ctx) {
  const course = ctx.courses.find((c) => c.id === form.courseId);
  if (!course || !isValidDate(form.date) || !isValidTime(form.startsAt)) {
    toast.info('日期、時間、課程都要填');
    return;
  }

  el.innerHTML = '<p class="muted">找人中…</p>';

  try {
    const data = await load(form.date);
    const result = candidatesFor({
      ...data,
      course,
      date: form.date,
      startsAt: form.startsAt,
      endsAt: endOfSlot(course),
      equipment: ctx.all.equipment,
    });
    paintForm(el, ctx, { ...result, course, endsAt: endOfSlot(course) });
  } catch (err) {
    el.innerHTML = `<div class="card"><p>查詢失敗：${esc(err.message)}</p></div>`;
  }
}

/**
 * 這一查要讀什麼。
 *
 * 來訪只往回讀半年：距上次上課超過一個月就一律算「很久沒來」（scheduling.js 的
 * STALE_DAYS），再往回讀也不會改變排序，只是多花錢。
 */
async function load(date) {
  const today = todayISO();
  const month = monthRange(date.slice(0, 7));
  // 可用天數是整個月算的，而「距上次上課」要往回看一段 —— 兩邊都要涵蓋到
  const from = [addDays(today, -180), month.from, date].sort()[0];
  const to = [month.to, date].sort().pop();

  const [customers, entitlementsBy, availabilityBy, visits, settings] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    customersData.availabilityByCustomer(),
    visitsData.listBetween(from, to),
    config.getSettings(),
  ]);

  const visitsBy = {};
  for (const v of visits) (visitsBy[v.customerId] ??= []).push(v);

  return { customers, entitlementsBy, availabilityBy, visitsBy, today, weights: settings.sortWeights };
}

// ---------- 結果 ----------

function resultHtml({ candidates, excluded, course, endsAt }, ctx) {
  const slot = {
    date: form.date,
    startsAt: form.startsAt,
    endsAt,
    courseName: course.name,
  };

  return `
    <section class="card">
      <h2 class="card__title">
        ${esc(shortDate(form.date))} ${esc(form.startsAt)}${endsAt ? `–${esc(endsAt)}` : ''}
        ${esc(course.name)}
        <span class="badge ${candidates.length ? 'badge--ok' : 'badge--overdue'}">
          ${candidates.length} 位可以補</span>
      </h2>
      ${candidates.length
        ? '<p class="muted">依壓表同一套優先序排。順序只是建議，跳著問沒關係。</p>'
        : '<p>沒有人補得上這一格。</p>'}
    </section>

    ${candidates.map((row) => candidateCard(row, slot, ctx)).join('')}

    ${excluded.length ? excludedHtml(excluded) : ''}`;
}

function candidateCard(row, slot, ctx) {
  const strongest = strongestReason(row);

  return `
    <section class="card">
      <div class="row__title">
        ${esc(row.customerName)}
        ${row.priority ? `<span class="badge badge--ok">★ ${row.priority}</span>` : ''}
        ${/* 永久限制三層各自的畫法（ADR-0064），跟客戶詳情與壓表的記錄面板
             共用同一支。以前這裡把三層全部畫成紅字，於是「固定禮拜五不行」
             跟醫療禁忌看起來一樣重。 */''}
        ${flagsUi.detailChips(splitFlags(
          { flags: row.flags ?? [] }, ctx?.all?.equipment ?? [], ctx?.all?.clinicalFlags ?? [],
        ))}
      </div>

      <p class="muted">
        ${esc(row.entitlementLabel ?? '')} 剩 ${row.remaining} / ${row.total}
        ${strongest ? `・${esc(strongest.label)}` : ''}
      </p>

      <ul class="muted">
        ${row.fitNotes.map((n) => `<li>${esc(n)}</li>`).join('')}
      </ul>

      ${row.rawText
        ? `<details>
             <summary class="muted">這輪問到的原文</summary>
             <p>${esc(row.rawText)}</p>
           </details>`
        : ''}

      ${message.box({
        id: `offer-${row.customerId}`,
        text: offerSlotMessage({ name: row.customerName }, slot),
        collapsed: true,
        label: '先看一下邀約訊息',
        buttonLabel: '複製邀約訊息',
      })}

      <p><a class="btn" href="#/customers/${esc(row.customerId)}">看這位客戶</a></p>
    </section>`;
}

/**
 * 沒被列進來的人與理由。
 *
 * 預設收起來 —— 平常她只要看誰可以補；但「XXX 呢？」這個問題一定會出現，
 * 那時要當場答得出來，不然這份名單她只會用一次。
 */
function excludedHtml(excluded) {
  return `
    <details class="card">
      <summary class="card__title">沒列進來的<span class="muted"> ${excluded.length}</span></summary>
      <p class="muted">有買這個課程、但這一格輪不到他的人。沒買這個課程的不會出現在這裡。</p>
      <ul class="link-list">
        ${excluded
          .map(
            (x) => `<li><a href="#/customers/${esc(x.customerId)}">
                      <span class="link-list__label">${esc(x.customerName)}
                        <span class="muted">${esc(x.why)}</span></span></a></li>`,
          )
          .join('')}
      </ul>
    </details>`;
}
