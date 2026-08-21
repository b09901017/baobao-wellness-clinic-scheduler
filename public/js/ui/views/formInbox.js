// 待辦中心的「客戶填好的時間」。`#/todo/forms`
//
// 客戶送出的答案停在這裡，**她按「收下」才會變成本輪可用性**（ADR-0032）。
// 多這一步的理由不是形式：客戶會點錯一天、會幫別人填、會在她壓完表之後才回，
// 而那三件事只有她看得出來。
//
// 收下的同時給她一則回覆客戶的訊息，內容是把系統讀到的東西複述回去 ——
// 那是最便宜的驗證：讀錯了客戶會當場說「不是啦我是說⋯⋯」。

import * as responsesData from '../../data/formResponses.js';
import * as invitesData from '../../data/formInvites.js';
import { describePicks, collectionFrom } from '../../domain/availabilityForm.js';
import { describeRule } from '../../domain/availability.js';
import { availabilityReceivedMessage } from '../../domain/messages.js';
import { todayISO, shortDate } from '../../domain/dates.js';
import * as f from '../components/form.js';
import * as message from '../components/message.js';
import { icon } from '../icons.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

const esc = f.esc;

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  const [rows, invites] = await Promise.all([
    responsesData.listInbox(),
    invitesData.list(),
  ]);

  paint({
    el,
    rows,
    invitesByToken: Object.fromEntries(invites.map((i) => [i.id, i])),
    today: todayISO(),
  });
}

function paint(ctx) {
  const { el, rows, invitesByToken, today } = ctx;

  el.innerHTML = `
    <a class="backlink" href="#/">${icon('left', { size: 19 })}待辦</a>
    <div class="page">
      <h1 class="page__title">客戶填好的時間</h1>
      <p class="page__lead">${rows.length
        ? '客戶自己填的，看過沒問題就收下。收下之後才會拿來排班。'
        : '沒有新的。'}</p>
    </div>

    ${rows.map((row) => card(row, invitesByToken[row.token], today)).join('')}`;

  message.wire(el, toast.info);
  wire(ctx);
}

function card(row, invite, today) {
  const lines = describePicks(row);
  const record = invite ? collectionFrom(row, invite, { today }) : null;
  const month = Number(String(row.month ?? '').slice(5));

  return `
    <div class="card">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(row.customerName || '（沒有名字）')}</div>
          <div class="muted num">${month ? `${month} 月的時間・` : ''}${esc(submittedLabel(row))}</div>
        </div>
        <a class="footlink" href="#/customers/${esc(row.customerId)}">看客戶</a>
      </div>

      <p class="field__label" style="margin-top: var(--space-3)">他說</p>
      <ul class="stack" style="margin: 0; padding-left: var(--space-4)">
        ${lines.map((l) => `<li>${esc(l)}</li>`).join('')}
      </ul>

      ${record ? `
        <p class="muted dim" style="margin: var(--space-3) 0 0; font-size: var(--text-2xs)">
          收下之後會存成：${esc(record.rules.map(describeRule).join('、') || '沒有限制')}
          ・有效期 ${esc(record.validFrom)} 到 ${esc(record.validTo)}</p>`
        : `<p class="muted dim" style="margin: var(--space-3) 0 0">
             找不到這條連結的邀請，收不下來。可以先看他說了什麼，再自己記一次。</p>`}

      ${message.box({
        id: `got-${row.token}`,
        text: availabilityReceivedMessage(
          { name: row.customerName },
          { month: row.month, lines },
        ),
        collapsed: true,
        label: '回他一句（先看一下訊息）',
        buttonLabel: '複製 LINE 訊息',
      })}

      <div class="form__actions" style="margin-top: var(--space-2)">
        <button class="btn btn--primary" type="button"
                data-take="${esc(row.token)}" ${record ? '' : 'disabled'}>收下</button>
        <button class="btn btn--sm" type="button" data-drop="${esc(row.token)}">這一份不要</button>
      </div>
    </div>`;
}

/**
 * 什麼時候填的。**這件事要看得見** —— 她可能已經壓完那個月的表了客戶才回，
 * 而那份晚到的可用性會跟已經壓好的班互相矛盾。
 */
function submittedLabel(row) {
  const at = row.submittedAt;
  if (!at) return '不知道什麼時候填的';
  const date = typeof at.toDate === 'function' ? at.toDate() : new Date(at);
  if (Number.isNaN(date.getTime())) return '不知道什麼時候填的';
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${shortDate(iso)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 填的`;
}

function wire(ctx) {
  const { el, rows, invitesByToken, today } = ctx;

  el.querySelectorAll('[data-take]').forEach((btn) => btn.addEventListener('click', async () => {
    const row = rows.find((r) => r.token === btn.dataset.take);
    const invite = invitesByToken[row?.token];
    if (!row || !invite) return;

    await toast.withSaveState(
      () => responsesData.take(row, invite, { today }),
      { pending: '收下中…', success: '收下了，可以拿來排班了' },
    );
    render(el);
  }));

  el.querySelectorAll('[data-drop]').forEach((btn) => btn.addEventListener('click', async () => {
    const row = rows.find((r) => r.token === btn.dataset.drop);
    if (!row) return;

    const ok = await confirmAction({
      title: '不收這一份？',
      consequences: [
        `${esc(row.customerName || '這位客戶')}填的這一份會從清單消失`,
        '它只是被收起來，設定頁的「已刪除項目」找得回來',
        '他手上那條連結已經用掉了，要他重填就得重發一條',
      ],
      confirmLabel: '不收',
      danger: true,
    });
    if (!ok) return;

    await toast.withSaveState(
      () => responsesData.discard(row.token, '收件匣手動略過'),
      { pending: '處理中…', success: '收起來了' },
    );
    render(el);
  }));
}
