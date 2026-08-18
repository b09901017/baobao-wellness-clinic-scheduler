// 客戶詳情。SPEC 第 8.5 節。
//
// 這一頁是她被客戶臨時問「我還剩幾次」時會打開的畫面，所以次數要現算，
// 而且要誠實：計數欄位與現算對不起來時把差異顯示出來，不自動偷改
//（SPEC 第 6.6 節）。

import * as data from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as config from '../../data/config.js';
import * as rules from '../../domain/customers.js';
import { counts, reconcile, isOverused, validateEntitlement } from '../../domain/entitlements.js';
import { describeStatus } from '../../domain/visits.js';
import { todayISO } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

export async function render(el, id) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let ctx;
  try {
    const [customer, entitlements, visits, courses, equipment] = await Promise.all([
      data.get(id),
      data.listEntitlements(id),
      visitsData.listByCustomer(id),
      config.listAll('courses'),
      config.listAll('equipment'),
    ]);
    ctx = { el, id, customer, entitlements, visits, courses, equipment };
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  if (!ctx.customer) {
    el.innerHTML = `
      <p><a href="#/customers">← 客戶</a></p>
      <div class="card"><p>找不到這位客戶，可能已經被刪除。</p>
      <p class="muted">刪除只是標記，資料還在，可以在設定 → 已刪除項目 還原。</p></div>`;
    return;
  }

  paint(ctx);
}

function reload(ctx) {
  return render(ctx.el, ctx.id);
}

// ---------- 主畫面 ----------

function paint(ctx) {
  const { el, customer, entitlements, visits, equipment } = ctx;
  const today = todayISO();
  const flags = rules.splitFlags(customer, equipment);
  const ms = rules.membershipState(customer.membershipExpiresAt, today);

  el.innerHTML = `
    <p><a href="#/customers" data-back>← 客戶</a></p>

    <section class="card">
      <div class="row__title">
        ${esc(customer.name)}
        ${customer.priority ? `<span class="badge badge--ok">★ ${customer.priority}</span>` : ''}
        ${flags.contraindications.map((x) => `<span class="flag">${esc(x)}</span>`).join('')}
        ${flags.others.map((x) => `<span class="badge">${esc(x)}</span>`).join('')}
        ${customer.active === false ? '<span class="badge badge--soon">已停用</span>' : ''}
      </div>
      <p class="muted">${esc(contactLine(customer))}</p>
      <p>${membershipBadge(ms)}</p>
      ${customer.notes ? `<p>${esc(customer.notes)}</p>` : ''}
      <p><button class="btn" type="button" data-edit>編輯基本資料</button></p>
    </section>

    <section class="card">
      <h2 class="card__title">額度<span class="muted"> ${entitlements.length}</span></h2>
      ${entitlements.length === 0
        ? '<p class="muted">還沒有額度。可以在這裡單項加購。</p>'
        : `<div class="pools">${entitlements
            .map((e) => poolCard(e, visits, ctx, today))
            .join('')}</div>`}
      <p><button class="btn btn--primary" type="button" data-add-ent>加購額度</button></p>
    </section>

    <section class="card">
      <h2 class="card__title">來訪<span class="muted"> ${visits.length}</span></h2>
      ${visits.length === 0
        ? '<p class="muted">還沒有來訪紀錄。</p>'
        : `<ul class="link-list">${visits.map(visitRow).join('')}</ul>`}
      <p><button class="btn btn--primary" type="button" data-add-visit>記錄一次來訪</button></p>
    </section>

    ${dangerZone(customer)}`;

  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    go('/customers');
  });
  el.querySelector('[data-edit]').addEventListener('click', () => paintEdit(ctx));
  el.querySelector('[data-add-ent]').addEventListener('click', () => paintEntitlement(ctx, null));
  el.querySelector('[data-add-visit]').addEventListener('click', () =>
    go(`/visits/new/${ctx.id}`),
  );

  el.querySelectorAll('[data-ent]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintEntitlement(ctx, entitlements.find((e) => e.id === btn.dataset.ent)),
    ),
  );

  el.querySelectorAll('[data-fix]').forEach((btn) =>
    btn.addEventListener('click', () => fixCounts(ctx, btn.dataset.fix)),
  );

  wireDangerZone(ctx);
}

function contactLine(c) {
  const parts = [];
  if (c.phone) parts.push(c.phone);
  if (c.lineId) parts.push(`LINE ${c.lineId}`);
  if (c.source) parts.push(c.source);
  if (c.purchasedAt) parts.push(`${c.purchasedAt} 購買`);
  return parts.length ? parts.join('・') : '沒有聯絡方式';
}

function membershipBadge(ms) {
  if (ms.state === 'none') return '<span class="badge">沒有會籍日期</span>';
  if (ms.state === 'expired') return `<span class="badge badge--overdue">會籍已過期 ${-ms.days} 天</span>`;
  if (ms.state === 'soon') return `<span class="badge badge--soon">會籍剩 ${ms.days} 天</span>`;
  return `<span class="badge badge--ok">會籍剩 ${ms.days} 天</span>`;
}

function poolCard(e, visits, ctx, today) {
  const c = counts(e, visits, e.id);
  const rec = reconcile(e, visits, e.id);
  const pct = (n) => (c.total > 0 ? Math.min(100, (n / c.total) * 100) : 0);
  const over = isOverused(c);
  const expiry = rules.membershipState(e.expiresAt, today);
  // 額度名稱常常就是課程名（靜脈、健檢），一樣的話不用印兩次
  const kind = kindText(e, ctx);

  return `
    <div class="pool">
      <div class="pool__head">
        <span>${esc(e.label)}</span>
        ${kind === e.label ? '' : `<span class="muted">${esc(kind)}</span>`}
      </div>

      <div class="meter ${over ? 'meter--over' : ''}"
           role="img" aria-label="共 ${c.total} 次，已完成 ${c.done}，已排未上 ${c.booked}，剩餘 ${c.remaining}">
        <span class="meter__done" style="width:${pct(c.done)}%"></span>
        <span class="meter__booked" style="width:${pct(c.booked)}%"></span>
      </div>

      <div class="legend">
        <span>已完成 <b>${c.done}</b></span>
        <span>已排未上 <b>${c.booked}</b></span>
        <span>剩餘 <b>${c.remaining}</b></span>
        <span>共 <b>${c.total}</b></span>
      </div>

      ${over ? '<p class="muted">⚠ 已排 + 已完成超過總次數。只是提醒，沒有擋任何東西。</p>' : ''}
      ${e.expiresAt ? `<p class="muted">${esc(e.expiresAt)} 到期${
        expiry.state === 'expired' ? '（已過期）' : ''
      }</p>` : ''}
      ${e.sourcePlanName
        ? `<p class="muted">來自方案「${esc(e.sourcePlanName)}」的展開，已與範本脫鉤</p>`
        : '<p class="muted">單項加購</p>'}
      ${rec.ok ? '' : reconcileWarning(e, rec)}

      <p><button class="btn" type="button" data-ent="${esc(e.id)}">調整</button></p>
    </div>`;
}

function reconcileWarning(e, rec) {
  return `
    <p class="muted">⚠ 計數欄位與來訪對不起來：
      存的是 已完成 ${rec.stored.done}、已排 ${rec.stored.booked}，
      重算是 已完成 ${rec.actual.done}、已排 ${rec.actual.booked}。
      畫面上顯示的是重算值。</p>
    <p><button class="btn" type="button" data-fix="${esc(e.id)}">把計數欄位改成重算值</button></p>`;
}

function kindText(e, ctx) {
  if (e.type === 'pool') {
    const names = (e.optionEquipmentIds ?? []).map(
      (id) => ctx.equipment.find((x) => x.id === id)?.name ?? '（已刪除）',
    );
    return `擇一：${names.join(' / ')}`;
  }
  return ctx.courses.find((c) => c.id === e.courseId)?.name ?? '（課程已刪除）';
}

function visitRow(v) {
  const courses = [...new Set((v.slots ?? []).map((s) => s.courseName).filter(Boolean))];
  return `
    <li><a href="#/visits/${esc(v.id)}">
      <span class="link-list__label">${esc(v.date)}
        <span class="muted">${esc(courses.join('、') || `${(v.slots ?? []).length} 個時段`)}</span>
      </span>
      <span class="badge ${statusClass(v.status)}">${esc(describeStatus(v.status))}</span>
    </a></li>`;
}

function statusClass(status) {
  if (status === 'pending_confirm') return 'badge--soon';
  if (status === 'cancelled' || status === 'no_show') return 'badge--overdue';
  return 'badge--ok';
}

async function fixCounts(ctx, entId) {
  const e = ctx.entitlements.find((x) => x.id === entId);
  const rec = reconcile(e, ctx.visits, entId);

  const ok = await confirmAction({
    title: `把「${e.label}」的計數欄位改成重算值？`,
    consequences: [
      `已完成 ${rec.stored.done} → ${rec.actual.done}`,
      `已排未上 ${rec.stored.booked} → ${rec.actual.booked}`,
      '重算值是從來訪推導出來的，那才是真相',
      '這次修正會留在稽核紀錄裡',
    ],
    confirmLabel: '修正',
  });
  if (!ok) return;

  try {
    await toast.withSaveState(
      () => data.updateEntitlement(ctx.id, entId, {
        doneCount: rec.actual.done,
        bookedCount: rec.actual.booked,
        lastReconciledAt: new Date().toISOString(),
      }),
      { success: '已修正' },
    );
    reload(ctx);
  } catch {
    /* 已處理 */
  }
}

// ---------- 編輯基本資料 ----------

function paintEdit(ctx) {
  const { el, customer } = ctx;

  el.innerHTML = `
    <p><a href="#" data-back>← ${esc(customer.name)}</a></p>
    <section class="card">
      <h2 class="card__title">編輯基本資料</h2>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${f.text({ name: 'name', label: '姓名', value: customer.name })}
        ${f.text({ name: 'phone', label: '電話', value: customer.phone ?? '' })}
        ${f.text({ name: 'lineId', label: 'LINE', value: customer.lineId ?? '' })}
        ${f.text({ name: 'source', label: '購買通路', value: customer.source ?? '' })}
        ${f.select({
          name: 'priority', label: '喜好程度', value: String(customer.priority ?? 0),
          options: Array.from({ length: rules.MAX_PRIORITY + 1 }, (_, i) => ({
            value: String(i), label: i === 0 ? '0 · 還沒評' : `${i} ${'★'.repeat(i)}`,
          })),
        })}
        ${f.text({
          name: 'flags', label: '永久限制', value: (customer.flags ?? []).join('、'),
          hint: '用頓號分隔。與器材禁忌同名的會變成硬性阻擋，其餘只是提醒。',
        })}
        ${f.textarea({ name: 'notes', label: '特殊狀況', value: customer.notes ?? '' })}
        ${f.date({ name: 'purchasedAt', label: '購買日', value: customer.purchasedAt ?? '' })}
        ${f.date({
          name: 'membershipExpiresAt', label: '會籍到期日',
          value: customer.membershipExpiresAt ?? '',
          hint: '改這裡不會動到任何一筆額度自己的到期日。',
        })}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>`;

  const back = () => paint(ctx);
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.readForm(e.target);
    const changes = {
      name: v.name.trim(),
      phone: v.phone.trim() || null,
      lineId: v.lineId.trim() || null,
      source: v.source.trim() || null,
      priority: Number(v.priority) || 0,
      flags: f.parseList(v.flags),
      notes: v.notes.trim() || null,
      purchasedAt: v.purchasedAt || null,
      membershipExpiresAt: v.membershipExpiresAt || null,
    };

    const errors = rules.validate({ ...changes, id: ctx.id });
    f.showErrors(el, errors);
    if (errors.length) return;

    try {
      await toast.withSaveState(() => data.update(ctx.id, changes), { success: '已儲存' });
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });
}

// ---------- 額度編輯 ----------

function paintEntitlement(ctx, record, draft = null) {
  const { el } = ctx;
  const isNew = !record;
  const e = draft ?? record ?? {
    type: 'single', label: '', totalQty: 1, durationMin: null,
    courseId: null, optionEquipmentIds: [], frequencyRule: null, expiresAt: null,
  };

  const aliveCourses = ctx.courses.filter((c) => !c.deletedAt);
  const aliveEquip = ctx.equipment.filter((x) => !x.deletedAt);

  el.innerHTML = `
    <p><a href="#" data-back>← ${esc(ctx.customer.name)}</a></p>
    <section class="card">
      <h2 class="card__title">${isNew ? '加購額度' : esc(record.label)}</h2>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${f.select({
          name: 'type', label: '型態', value: e.type,
          options: [
            { value: 'single', label: '單一課程（固定療程）' },
            { value: 'pool', label: '擇一池（每次選一種器材）' },
          ],
          hint: '換型態會換掉下面要填的欄位。',
        })}
        ${f.text({ name: 'label', label: '顯示名稱', value: e.label, placeholder: '復能' })}
        ${f.number({ name: 'totalQty', label: '總次數', value: e.totalQty, min: 1 })}
        ${f.number({
          name: 'durationMin', label: '時長（分鐘）', value: e.durationMin ?? '', min: 1, step: 5,
          hint: '留空就用課程本身的時長。',
        })}
        ${e.type === 'pool'
          ? f.checkboxes({
              name: 'optionEquipmentIds', label: '可選的器材',
              values: e.optionEquipmentIds ?? [],
              options: aliveEquip.map((x) => ({ value: x.id, label: x.name })),
              hint: '至少兩種。客戶身上有對應禁忌的器材，排班時會被硬性擋掉。',
            })
          : f.select({
              name: 'courseId', label: '課程', value: e.courseId ?? null,
              options: [
                { value: null, label: '（請選擇）' },
                ...courseOptions(aliveCourses, e.courseId),
              ],
            })}
        ${f.text({
          name: 'frequencyRule', label: '頻率限制', value: e.frequencyRule ?? '',
          placeholder: '每季一次', hint: '只提示不阻擋。留空代表沒有限制。',
        })}
        ${f.date({ name: 'expiresAt', label: '這筆額度的到期日', value: e.expiresAt ?? '' })}
        ${isNew ? '' : usedFields(record)}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>
    ${isNew ? '' : entitlementDanger(record)}`;

  const back = () => paint(ctx);
  el.querySelector('[data-back]').addEventListener('click', (ev) => {
    ev.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  const form = el.querySelector('[data-form]');

  // 換型態要換欄位，所以重畫。先把填到一半的值讀回來，不要清掉。
  form.addEventListener('change', (ev) => {
    if (ev.target.name !== 'type') return;
    paintEntitlement(ctx, record, { ...e, ...readEntitlement(form) });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const next = { ...e, ...readEntitlement(form) };

    const errors = validateEntitlement(next, { courses: ctx.courses, equipment: ctx.equipment });
    f.showErrors(el, errors);
    if (errors.length) return;

    const payload = {
      type: next.type,
      label: next.label,
      totalQty: next.totalQty,
      durationMin: next.durationMin,
      courseId: next.type === 'single' ? next.courseId : null,
      optionEquipmentIds: next.type === 'pool' ? next.optionEquipmentIds : null,
      frequencyRule: next.frequencyRule,
      expiresAt: next.expiresAt,
    };

    try {
      if (isNew) {
        await toast.withSaveState(
          () => data.createEntitlement(ctx.id, {
            ...payload,
            sourcePlanName: null, // 單項加購
            purchasedAt: ctx.customer.purchasedAt ?? null,
            doneCount: 0,
            bookedCount: 0,
            lastReconciledAt: null,
          }),
          { success: '已加購' },
        );
      } else {
        await toast.withSaveState(() => data.updateEntitlement(ctx.id, record.id, payload), {
          success: '已儲存',
        });
      }
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });

  if (!isNew) wireEntitlementDanger(ctx, record);
}

function courseOptions(courses, currentId) {
  const opts = courses.map((c) => ({
    value: c.id,
    label: c.active === false ? `${c.name}（已停用）` : c.name,
  }));
  // 指向已刪除課程的舊資料要留著顯示，不可以無聲改成別的課程。
  if (currentId && !courses.some((c) => c.id === currentId)) {
    opts.unshift({ value: currentId, label: '（課程已刪除）' });
  }
  return opts;
}

function readEntitlement(form) {
  const v = f.readForm(form);
  return {
    type: v.type,
    label: String(v.label ?? '').trim(),
    totalQty: v.totalQty,
    durationMin: v.durationMin ?? null,
    courseId: v.courseId ?? null,
    optionEquipmentIds: v.optionEquipmentIds ?? [],
    frequencyRule: String(v.frequencyRule ?? '').trim() || null,
    expiresAt: v.expiresAt || null,
  };
}

/** 已扣掉的次數不可直接改數字，只能透過來訪狀態變化連動 —— SPEC 第 6.4 節。 */
function usedFields(record) {
  return `
    ${f.readonly({
      label: '已完成 / 已排未上',
      value: `${record.doneCount ?? 0} / ${record.bookedCount ?? 0}`,
      hint: '這兩個數字不能直接改，它們跟著來訪的狀態走。對不起來時詳情頁會顯示差異。',
    })}`;
}

function entitlementDanger(record) {
  return `
    <section class="card danger">
      <h2 class="card__title">刪除這筆額度</h2>
      <p class="muted">刪除是標記，資料不會消失，可以在設定 → 已刪除項目 還原。</p>
      <p><button class="btn btn--danger" type="button" data-del-ent>刪除</button></p>
    </section>`;
}

function wireEntitlementDanger(ctx, record) {
  ctx.el.querySelector('[data-del-ent]').addEventListener('click', async () => {
    const c = counts(record, ctx.visits, record.id);
    const ok = await confirmAction({
      title: `刪除「${record.label}」這筆額度？`,
      consequences: [
        `這筆額度共 ${c.total} 次，已完成 ${c.done} 次、已排未上 ${c.booked} 次`,
        '已經排好的來訪不會被刪，但它們會指向一筆已刪除的額度',
        '這是標記刪除，可以在設定 → 已刪除項目 還原',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => data.removeEntitlement(ctx.id, record.id), {
        success: '已刪除',
      });
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });
}

// ---------- 停用與刪除客戶 ----------

function dangerZone(c) {
  const disabled = c.active === false;
  return `
    <section class="card danger">
      <h2 class="card__title">停用與刪除</h2>
      <p class="muted">
        ${disabled
          ? '目前已停用：不會出現在客戶清單與待排佇列裡，資料都還在。'
          : '停用後不會出現在客戶清單與待排佇列裡，既有來訪不受影響。'}
      </p>
      <p>
        <button class="btn" type="button" data-toggle-active>${disabled ? '重新啟用' : '停用'}</button>
        <button class="btn btn--danger" type="button" data-delete>刪除</button>
      </p>
      <p class="muted">刪除是標記，資料不會消失，可以在設定 → 已刪除項目 還原。</p>
    </section>`;
}

function wireDangerZone(ctx) {
  const { el, customer } = ctx;

  el.querySelector('[data-toggle-active]').addEventListener('click', async () => {
    const turningOff = customer.active !== false;
    const ok = await confirmAction({
      title: turningOff ? `停用「${customer.name}」？` : `重新啟用「${customer.name}」？`,
      consequences: turningOff
        ? [
            '客戶清單預設看不到他，要切到「已停用」才會出現',
            '壓表時不會再被排進待排佇列',
            '額度、來訪、任務全部原封不動留著',
            '隨時可以再啟用',
          ]
        : ['他會重新出現在客戶清單與待排佇列裡'],
      confirmLabel: turningOff ? '停用' : '啟用',
      danger: turningOff,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => data.update(ctx.id, { active: !turningOff }), {
        success: turningOff ? '已停用' : '已啟用',
      });
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });

  el.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: `刪除「${customer.name}」？`,
      consequences: [
        '這是標記刪除，資料不會真的消失',
        `他底下的 ${ctx.entitlements.length} 筆額度與 ${ctx.visits.length} 筆來訪都不會被修改`,
        '客戶清單上不再顯示，壓表時也不會出現',
        '可以在設定 → 已刪除項目 還原',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => data.remove(ctx.id), { success: '已刪除' });
      toast.failed('已刪除。要還原嗎？', async () => {
        await data.restore(ctx.id);
        toast.saved('已還原');
        go(`/customers/${ctx.id}`);
      });
      go('/customers');
    } catch {
      /* 已處理 */
    }
  });
}
