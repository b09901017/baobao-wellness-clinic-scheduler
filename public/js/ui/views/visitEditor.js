// 來訪編輯器。SPEC 第 8.3 節。
//
// 一個客戶、一天、多個連續時段。她是在 Abovee 壓完表才回來記錄的，
// 所以這一頁的目標是「快速記錄」：時間自動接、時長自動帶、該指派什麼自動判斷。
//
// 檢查全部在 domain/visits.js。這裡只負責把 errors 擋下來、把 warnings 顯示在旁邊。

import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as config from '../../data/config.js';
import {
  INITIAL_STATUS, describeStatus, nextStatuses, isLocked, validateVisit,
  coursesForEntitlement,
} from '../../domain/visits.js';
import { counts } from '../../domain/entitlements.js';
import { annotateOptions } from '../../domain/contraindications.js';
import { roomSlots, roomsForCourse } from '../../domain/masterData.js';
import { endOf, nextStart, isValidTime, DEFAULT_GAP_MIN } from '../../domain/visitTime.js';
import { todayISO } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

const roomKey = (roomId, bed) => `${roomId ?? ''}|${bed ?? ''}`;

function parseRoomKey(key) {
  if (!key) return { roomId: null, bed: null };
  const [roomId, bed] = String(key).split('|');
  return { roomId: roomId || null, bed: bed || null };
}

// ---------- 進入點 ----------

export async function renderNew(el, customerId) {
  await boot(el, { customerId });
}

export async function renderEdit(el, visitId) {
  await boot(el, { visitId });
}

async function boot(el, { customerId = null, visitId = null }) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let ctx;
  try {
    const existing = visitId ? await visitsData.get(visitId) : null;
    if (visitId && !existing) {
      el.innerHTML = `
        <p><a href="#/customers">← 客戶</a></p>
        <div class="card"><p>找不到這筆來訪，可能已經被刪除。</p></div>`;
      return;
    }

    const id = existing?.customerId ?? customerId;
    const [customer, entitlements, all, settings, customerVisits] = await Promise.all([
      customersData.get(id),
      customersData.listEntitlements(id),
      config.loadAll(),
      config.getSettings(),
      visitsData.listByCustomer(id),
    ]);

    if (!customer) {
      el.innerHTML = `
        <p><a href="#/customers">← 客戶</a></p>
        <div class="card"><p>找不到這位客戶。</p></div>`;
      return;
    }

    const draft = existing ? { ...existing } : blankVisit(customer, entitlements, all, settings);
    const sameDayVisits = await visitsData.listByDate(draft.date);

    ctx = {
      el, customer, entitlements, all, settings, customerVisits, sameDayVisits,
      isNew: !existing, unlockReason: null,
    };
    paint(ctx, draft);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
  }
}

function blankVisit(customer, entitlements, all, settings) {
  const visit = {
    customerId: customer.id,
    customerName: customer.name,
    date: todayISO(),
    status: INITIAL_STATUS,
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    released: null,
    slots: [],
  };
  const first = entitlements[0];
  if (first) visit.slots.push(blankSlot(first, all, settings, '09:00'));
  return visit;
}

function blankSlot(entitlement, all, settings, startsAt) {
  const course = coursesForEntitlement(entitlement, all.courses)[0] ?? null;
  const durationMin = entitlement?.durationMin ?? course?.durationMin ?? 60;
  return {
    entitlementId: entitlement?.id ?? null,
    courseId: course?.id ?? null,
    courseName: course?.name ?? null,
    equipmentId: null,
    ivProductId: null,
    startsAt,
    endsAt: endOf(startsAt, durationMin),
    roomId: null,
    bed: null,
    therapistId: null,
    attended: null,
  };
}

// ---------- 畫面 ----------

function paint(ctx, draft) {
  const { el, customer, entitlements, all, customerVisits, sameDayVisits, isNew } = ctx;
  const locked = isLocked(draft.status) && !ctx.unlockReason;

  const { errors, warnings } = validateVisit(draft, {
    customer,
    entitlements,
    courses: all.courses,
    equipment: all.equipment,
    rooms: all.rooms,
    staff: all.staff,
    ivProducts: all.ivProducts,
    sameDayVisits,
    customerVisits,
  });

  el.innerHTML = `
    <p><a href="#/customers/${esc(customer.id)}" data-back>← ${esc(customer.name)}</a></p>

    <section class="card">
      <div class="row__title">
        ${esc(customer.name)}
        <span class="badge ${statusClass(draft.status)}">${esc(describeStatus(draft.status))}</span>
        ${(customer.flags ?? []).map((x) => `<span class="flag">${esc(x)}</span>`).join('')}
      </div>
      ${blockedNote(customer, all.equipment)}
      <div class="errors" data-errors hidden></div>
      ${warnings.length ? warningsHtml(warnings) : ''}
    </section>

    ${locked ? lockedCard() : ''}

    <form data-form ${locked ? 'inert' : ''}>
      <section class="card">
        ${f.date({ name: 'date', label: '來訪日期', value: draft.date })}
      </section>

      ${draft.slots.map((slot, i) => slotCard(ctx, draft, slot, i)).join('')}

      <section class="card">
        <p><button class="btn" type="button" data-add-slot>＋ 新增一個時段</button></p>
        <p class="muted">預設接在上一段結束的 ${ctx.settings.slotGapMin ?? DEFAULT_GAP_MIN} 分鐘後。</p>
      </section>

      <section class="card">
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">${isNew ? '記錄這次來訪' : '儲存'}</button>
          <button class="btn" type="button" data-cancel-edit>取消</button>
        </div>
        ${ctx.submitted && errors.length
          ? '<p class="muted">上面紅色的問題要先處理才存得下去。</p>'
          : ''}
      </section>
    </form>

    ${isNew ? '' : statusCard(draft)}
    ${isNew ? '' : dangerZone()}`;

  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    go(`/customers/${customer.id}`);
  });
  el.querySelector('[data-cancel-edit]').addEventListener('click', () =>
    go(`/customers/${customer.id}`),
  );

  const form = el.querySelector('[data-form]');

  form.addEventListener('change', async (e) => {
    const next = readDraft(ctx, form, draft);
    if (e.target.name === 'date' && next.date !== draft.date) {
      try {
        ctx.sameDayVisits = await visitsData.listByDate(next.date);
      } catch {
        ctx.sameDayVisits = [];
      }
    }
    paint(ctx, next);
  });

  el.querySelector('[data-add-slot]').addEventListener('click', () => {
    const next = readDraft(ctx, form, draft);
    const last = next.slots[next.slots.length - 1];
    const gap = ctx.settings.slotGapMin ?? DEFAULT_GAP_MIN;
    const startsAt = last && isValidTime(last.endsAt) ? nextStart(last.endsAt, gap) : '09:00';
    next.slots.push(blankSlot(entitlements[0], all, ctx.settings, startsAt));
    paint(ctx, next);
  });

  el.querySelectorAll('[data-del-slot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = readDraft(ctx, form, draft);
      next.slots.splice(Number(btn.dataset.delSlot), 1);
      paint(ctx, next);
    }),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(ctx, readDraft(ctx, form, draft));
  });

  // 第一次送出之後才顯示 errors —— 一打開就滿江紅只會讓人不想看
  if (ctx.submitted) f.showErrors(el, errors);

  if (locked) wireUnlock(ctx, draft);
  if (!isNew && !locked) wireStatus(ctx, draft);
  if (!isNew) wireDangerZone(ctx, draft);
}

function statusClass(status) {
  if (status === 'pending_confirm') return 'badge--soon';
  if (status === 'cancelled' || status === 'no_show') return 'badge--overdue';
  return 'badge--ok';
}

function blockedNote(customer, equipment) {
  const blocked = annotateOptions(customer, equipment).filter((eq) => eq.blocked);
  if (!blocked.length) return '';
  return `<p class="muted">${blocked
    .map((eq) => `${esc(eq.name)} 已停用 —— ${esc(eq.reasons.join('、'))}禁忌`)
    .join('；')}</p>`;
}

function warningsHtml(warnings) {
  return `
    <div class="card">
      <h3 class="card__title">提醒</h3>
      <ul class="muted">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p class="muted">這些都只是提醒，不會擋著不讓你存 —— app 看不到同事在 Abovee 上壓的東西。</p>
    </div>`;
}

function slotCard(ctx, draft, slot, i) {
  const { entitlements, all, customerVisits, customer } = ctx;
  const ent = entitlements.find((x) => x.id === slot.entitlementId) ?? null;
  const courseChoices = coursesForEntitlement(ent, all.courses);
  const course = all.courses.find((c) => c.id === slot.courseId) ?? null;

  return `
    <section class="card">
      <div class="pool__head">
        <span>第 ${i + 1} 個時段</span>
        <span class="muted">${esc(slot.startsAt ?? '')}–${esc(slot.endsAt ?? '')}</span>
      </div>

      ${f.select({
        name: `s${i}-ent`, label: '額度', value: slot.entitlementId,
        options: [
          { value: null, label: '（請選擇）' },
          ...entitlements.map((e) => {
            const c = counts(e, customerVisits, e.id);
            return { value: e.id, label: `${e.label}（剩 ${c.remaining} / ${c.total}）` };
          }),
        ],
      })}

      ${courseChoices.length === 1
        ? f.readonly({ label: '課程', value: courseChoices[0].name })
        : f.select({
            name: `s${i}-course`, label: '課程', value: slot.courseId,
            options: [
              { value: null, label: '（請選擇）' },
              ...courseChoices.map((c) => ({ value: c.id, label: c.name })),
            ],
          })}

      ${course?.requiresEquipment ? equipmentField(customer, ent, all, slot, i) : ''}
      ${course?.requiresIvProduct
        ? f.select({
            name: `s${i}-iv`, label: '營養點滴品項', value: slot.ivProductId,
            options: [
              { value: null, label: '（請選擇）' },
              ...all.ivProducts.map((p) => ({ value: p.id, label: p.name })),
            ],
            hint: '每次施打的品項可能不同，所以每次都要記。',
          })
        : ''}

      ${f.time({ name: `s${i}-start`, label: '開始時間', value: slot.startsAt })}
      ${f.readonly({
        label: '結束時間',
        value: slot.endsAt ?? '—',
        hint: `依 ${esc(course?.name ?? '課程')} 的時長自動算，改開始時間就跟著動。`,
      })}

      ${course?.assigns === 'room' ? roomField(all, course, slot, i) : ''}
      ${course?.assigns === 'therapist'
        ? f.select({
            name: `s${i}-staff`, label: '治療師', value: slot.therapistId,
            options: [
              { value: null, label: '（請選擇）' },
              ...all.staff.filter((s) => s.active !== false)
                .map((s) => ({ value: s.id, label: s.name })),
            ],
          })
        : ''}

      ${draft.slots.length > 1
        ? `<p><button class="btn" type="button" data-del-slot="${i}">移除這個時段</button></p>`
        : ''}
    </section>`;
}

/** 擇一池的器材。被禁忌擋掉的要留在原位標示出來，不能整個消失。 */
function equipmentField(customer, ent, all, slot, i) {
  const pool = ent?.type === 'pool'
    ? (ent.optionEquipmentIds ?? [])
      .map((id) => all.equipment.find((e) => e.id === id))
      .filter(Boolean)
    : all.equipment;

  const annotated = annotateOptions(customer, pool);
  const options = [
    { value: null, label: '（請選擇）' },
    ...annotated.map((eq) => ({
      value: eq.id,
      label: eq.blocked ? `✕ ${eq.name}（${eq.reasons.join('、')}，不可使用）` : eq.name,
    })),
  ];

  return f.select({
    name: `s${i}-equip`, label: '器材', value: slot.equipmentId, options,
    hint: '打叉的是醫療禁忌擋下的，選了會存不進去 —— 這是全系統唯一會擋人的檢查。',
  });
}

function roomField(all, course, slot, i) {
  const allowed = roomsForCourse(course, all.rooms);
  const allowedIds = new Set(allowed.map((r) => r.id));
  const slots = roomSlots(all.rooms);

  const options = [
    { value: null, label: '（請選擇）' },
    ...slots
      .slice()
      .sort((a, b) => Number(allowedIds.has(b.roomId)) - Number(allowedIds.has(a.roomId)))
      .map((s) => ({
        value: roomKey(s.roomId, s.bed),
        label: allowedIds.has(s.roomId) ? s.label : `${s.label}（不是這個課程常用的）`,
      })),
  ];

  return f.select({
    name: `s${i}-room`, label: '診間',
    value: slot.roomId ? roomKey(slot.roomId, slot.bed) : null,
    options,
  });
}

// ---------- 讀回表單 ----------

function readDraft(ctx, form, draft) {
  const v = f.readForm(form);
  const { entitlements, all } = ctx;

  const slots = draft.slots.map((slot, i) => {
    const entitlementId = key(v, `s${i}-ent`, slot.entitlementId);
    const ent = entitlements.find((x) => x.id === entitlementId) ?? null;

    // 換了額度就要重挑課程，舊的課程可能根本不屬於新的額度
    const choices = coursesForEntitlement(ent, all.courses);
    let courseId = key(v, `s${i}-course`, slot.courseId);
    if (choices.length === 1) courseId = choices[0].id;
    else if (!choices.some((c) => c.id === courseId)) courseId = null;

    const course = all.courses.find((c) => c.id === courseId) ?? null;
    const startsAt = v[`s${i}-start`] || slot.startsAt;
    const durationMin = ent?.durationMin ?? course?.durationMin ?? 60;

    return {
      ...slot,
      entitlementId,
      courseId,
      courseName: course?.name ?? null,
      equipmentId: course?.requiresEquipment ? (v[`s${i}-equip`] ?? null) : null,
      ivProductId: course?.requiresIvProduct ? (v[`s${i}-iv`] ?? null) : null,
      startsAt,
      endsAt: isValidTime(startsAt) ? endOf(startsAt, durationMin) : slot.endsAt,
      ...(course?.assigns === 'room'
        ? parseRoomKey(v[`s${i}-room`])
        : { roomId: null, bed: null }),
      therapistId: course?.assigns === 'therapist' ? (v[`s${i}-staff`] ?? null) : null,
    };
  });

  return { ...draft, date: v.date || draft.date, slots };
}

// 沒被畫出來的欄位讀回來是 undefined，那時要保留原值而不是清成 null
function key(values, name, fallback) {
  return name in values ? values[name] : fallback;
}

// ---------- 儲存 ----------

async function submit(ctx, draft) {
  const { el, customer, entitlements, all, customerVisits, sameDayVisits, isNew } = ctx;
  ctx.submitted = true;

  const { errors } = validateVisit(draft, {
    customer, entitlements,
    courses: all.courses, equipment: all.equipment, rooms: all.rooms,
    staff: all.staff, ivProducts: all.ivProducts,
    sameDayVisits, customerVisits,
  });
  f.showErrors(el, errors);
  if (errors.length) {
    el.querySelector('[data-errors]')?.scrollIntoView({ block: 'center' });
    return;
  }

  // SPEC 第 7 節規則 10：標記已壓表時要問這一句。app 看不到 Abovee，
  // 這道確認就是她手寫的那兩個驚嘆號。
  if (isNew) {
    const ok = await confirmAction({
      title: '已經在 Abovee 壓好表了嗎？',
      consequences: [
        ...draft.slots.map((s) => slotSummary(s, all)),
        '這筆會記成「已壓表，等客戶回覆」',
        'app 看不到同事壓的東西，診間有沒有被佔用要以 Abovee 為準',
      ],
      confirmLabel: '已確認，記錄',
    });
    if (!ok) return;
  }

  const payload = ctx.unlockReason
    ? { ...draft, lastCorrection: { at: new Date().toISOString(), reason: ctx.unlockReason } }
    : draft;

  try {
    const id = await toast.withSaveState(() => visitsData.save(payload, customerVisits), {
      success: isNew ? '已記錄' : '已儲存',
    });
    go(`/customers/${customer.id}`);
    return id;
  } catch {
    return null; /* withSaveState 已顯示錯誤與重試 */
  }
}

function slotSummary(slot, all) {
  const course = all.courses.find((c) => c.id === slot.courseId);
  const room = all.rooms.find((r) => r.id === slot.roomId);
  const staff = all.staff.find((s) => s.id === slot.therapistId);
  const where = room ? `${room.name}${slot.bed ?? ''}` : staff?.name ?? '';
  return `${slot.startsAt}–${slot.endsAt} ${course?.name ?? ''}${where ? ` ${where}` : ''}`;
}

// ---------- 狀態 ----------

function statusCard(draft) {
  const options = nextStatuses(draft.status);
  if (!options.length) {
    return `
      <section class="card">
        <h2 class="card__title">狀態</h2>
        <p class="muted">${esc(describeStatus(draft.status))}。這是終點，不會再往下走。
          要改期就取消後重新排一筆（SPEC 第 7 節規則 9）。</p>
      </section>`;
  }
  return `
    <section class="card">
      <h2 class="card__title">狀態</h2>
      <p class="muted">現在是「${esc(describeStatus(draft.status))}」。</p>
      <p>${options
        .map((s) => `<button class="btn" type="button" data-status="${s}">${describeStatus(s)}</button>`)
        .join(' ')}</p>
      <label class="field">
        <span class="field__label">取消理由（選填）</span>
        <input type="text" data-cancel-reason placeholder="客人要改時間" />
      </label>
    </section>`;
}

function wireStatus(ctx, draft) {
  ctx.el.querySelectorAll('[data-status]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const to = btn.dataset.status;
      const reason = ctx.el.querySelector('[data-cancel-reason]')?.value?.trim() || null;

      if (to === 'cancelled') {
        const ok = await confirmAction({
          title: '取消這筆來訪？',
          consequences: [
            `${draft.slots.length} 個時段會退回去，次數也會還回來`,
            '改期不是改日期，是取消後重新排一筆',
            '如果已經在 Abovee／Examine／耀聖登記過，要回去把舊的取消掉',
            '取消後不能復原成已確認，但可以在已刪除項目看到這筆紀錄',
          ],
          confirmLabel: '取消這筆來訪',
          danger: true,
        });
        if (!ok) return;
      }

      const next = { ...draft, status: to };
      if (to === 'confirmed') next.confirmedAt = new Date().toISOString();
      if (to === 'cancelled') {
        next.cancelledAt = new Date().toISOString();
        next.cancelReason = reason;
        next.released = false;
      }
      if (to === 'done' || to === 'no_show') {
        next.slots = next.slots.map((s) => ({ ...s, attended: to === 'done' }));
      }

      try {
        await toast.withSaveState(() => visitsData.save(next, ctx.customerVisits), {
          success: `已改成「${describeStatus(to)}」`,
        });
        go(`/customers/${ctx.customer.id}`);
      } catch {
        /* 已處理 */
      }
    }),
  );
}

// ---------- 已完成的更正流程 ----------

function lockedCard() {
  return `
    <section class="card">
      <h2 class="card__title">這筆已經完成，是唯讀的</h2>
      <p class="muted">已完成的來訪不能直接改（SPEC 第 6.4 節）。要更正請填理由，
        理由會跟著這次修改一起留在稽核紀錄裡。</p>
      <label class="field">
        <span class="field__label">更正理由</span>
        <input type="text" data-unlock-reason placeholder="時間記錯了，實際是 15:00" />
      </label>
      <p><button class="btn" type="button" data-unlock>解鎖修改</button></p>
    </section>`;
}

function wireUnlock(ctx, draft) {
  ctx.el.querySelector('[data-unlock]').addEventListener('click', () => {
    const reason = ctx.el.querySelector('[data-unlock-reason]').value.trim();
    if (!reason) {
      toast.info('要先填更正理由');
      return;
    }
    ctx.unlockReason = reason;
    paint(ctx, draft);
  });
}

// ---------- 刪除 ----------

function dangerZone() {
  return `
    <section class="card danger">
      <h2 class="card__title">刪除這筆紀錄</h2>
      <p class="muted">誤建才用刪除。客人改時間或不來，請用上面的狀態按鈕，
        那些會留下為什麼。</p>
      <p><button class="btn btn--danger" type="button" data-delete>刪除</button></p>
    </section>`;
}

function wireDangerZone(ctx, draft) {
  ctx.el.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: '刪除這筆來訪紀錄？',
      consequences: [
        '這是標記刪除，資料不會真的消失',
        '它佔掉的次數會還回去',
        '如果是客人不來或改時間，用「取消」比較好 —— 那會留下理由',
        '可以在設定 → 已刪除項目 還原',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => visitsData.remove(draft, ctx.customerVisits), {
        success: '已刪除',
      });
      go(`/customers/${ctx.customer.id}`);
    } catch {
      /* 已處理 */
    }
  });
}
