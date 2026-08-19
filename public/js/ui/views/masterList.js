// 單一主檔類型的清單與編輯。
//
// 破壞性操作刻意不放在主要動線上（SPEC 第 6.5 節）：卡片上只有「編輯」，
// 停用與刪除放在編輯畫面的最下方，而且都要二次確認並顯示具體後果。

import * as config from '../../data/config.js';
import {
  MASTER_LABELS, ROOM_TYPES, STAFF_ROLES, ASSIGNS, ASSIGN_LABELS, validate,
  planItem, BLANK_PLAN_ITEM,
  copyPlan,
} from '../../domain/masterData.js';
import { CATEGORY_OPTIONS, describeCategory } from '../../domain/taskRules.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { icon } from '../icons.js';

const esc = f.esc;

const editors = {
  rooms: {
    blank: { name: '', type: ROOM_TYPES[0], beds: [] },
    summary: (r) => `${r.type}${r.beds?.length ? ` · 床位 ${r.beds.join('、')}` : ''}`,
    fields: (r) => [
      f.text({ name: 'name', label: '診間名稱', value: r.name, placeholder: '治3' }),
      f.select({ name: 'type', label: '類型', value: r.type, options: ROOM_TYPES }),
      f.text({
        name: 'beds', label: '床位', value: (r.beds ?? []).join('、'), placeholder: 'A、B',
        hint: '用頓號分隔。留空代表整間就是一個資源；有床位時同一間的不同床可以同時有人。',
      }),
    ],
    parse: (v) => ({ name: v.name.trim(), type: v.type, beds: f.parseList(v.beds) }),
  },

  staff: {
    blank: { name: '', role: STAFF_ROLES[0] },
    summary: (r) => r.role,
    fields: (r) => [
      f.text({ name: 'name', label: '姓名', value: r.name, placeholder: '騰崴' }),
      f.select({ name: 'role', label: '角色', value: r.role, options: STAFF_ROLES }),
    ],
    parse: (v) => ({ name: v.name.trim(), role: v.role }),
  },

  equipment: {
    blank: { name: '', contraindications: [] },
    summary: (r) =>
      r.contraindications?.length
        ? `⚠ 禁忌：${r.contraindications.join('、')}`
        : '無禁忌',
    fields: (r) => [
      f.text({ name: 'name', label: '器材名稱', value: r.name, placeholder: 'INDIBA' }),
      f.text({
        name: 'contraindications', label: '醫療禁忌',
        value: (r.contraindications ?? []).join('、'), placeholder: '體內金屬',
        hint: '用頓號分隔。客戶身上有同名的永久限制時，這個器材會被硬性擋掉，不是警告。',
      }),
    ],
    parse: (v) => ({ name: v.name.trim(), contraindications: f.parseList(v.contraindications) }),
  },

  ivProducts: {
    blank: { name: '' },
    summary: () => '營養點滴品項',
    fields: (r) => [f.text({ name: 'name', label: '品項名稱', value: r.name, placeholder: '護肝排毒' })],
    parse: (v) => ({ name: v.name.trim() }),
  },

  products: {
    blank: { name: '' },
    summary: () => '不排程，只記錄',
    fields: (r) => [f.text({ name: 'name', label: '商品名稱', value: r.name, placeholder: '夜態美' })],
    parse: (v) => ({ name: v.name.trim() }),
  },

  courses: {
    blank: {
      name: '', durationMin: 60, category: 'C', assigns: 'room',
      allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, requiresIvProduct: false, frequencyRule: null,
    },
    summary: (r) =>
      `${r.durationMin} 分 · ${ASSIGN_LABELS[r.assigns] ?? '?'} · ${describeCategory(r.category)}`,
    fields: (r) => [
      f.text({ name: 'name', label: '課程名稱', value: r.name, placeholder: '復能' }),
      f.number({ name: 'durationMin', label: '時長（分鐘）', value: r.durationMin, min: 1, step: 5 }),
      f.select({
        name: 'category', label: '任務類別', value: r.category ?? null,
        options: CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: `${o.label}（${o.hint}）` })),
        hint: '決定這個課程的來訪會自動產生哪些系統任務。',
      }),
      f.select({
        name: 'assigns', label: '排班時要指派', value: r.assigns,
        options: ASSIGNS.map((a) => ({ value: a, label: ASSIGN_LABELS[a] })),
        hint: '復能三器材選治療師；其餘含靜脈選診間；心臟科評估都不用。',
      }),
      f.checkboxes({
        name: 'allowedRoomTypes', label: '可用的診間類型',
        values: r.allowedRoomTypes ?? [], options: ROOM_TYPES,
        hint: '只在「選診間」時有效。',
      }),
      f.toggle({
        name: 'requiresEquipment', label: '來訪時要選器材（擇一池）',
        value: !!r.requiresEquipment,
      }),
      f.toggle({
        name: 'requiresIvProduct', label: '來訪時要選營養點滴品項',
        value: !!r.requiresIvProduct,
        hint: '每次施打的品項可能不同，勾了之後來訪編輯器才會出現品項選單。',
      }),
      f.text({
        name: 'frequencyRule', label: '頻率限制', value: r.frequencyRule ?? '',
        placeholder: '每季一次', hint: '只提示不阻擋。留空代表沒有限制。',
      }),
    ],
    parse: (v, prev) => ({
      name: v.name.trim(),
      durationMin: v.durationMin,
      category: v.category,
      assigns: v.assigns,
      allowedRoomTypes: v.assigns === 'room' ? (v.allowedRoomTypes ?? []) : [],
      // 指定診間是例外覆寫，這個表單不動它，保留原值
      allowedRoomIds: v.assigns === 'room' ? (prev?.allowedRoomIds ?? []) : [],
      requiresEquipment: !!v.requiresEquipment,
      requiresIvProduct: !!v.requiresIvProduct,
      frequencyRule: v.frequencyRule?.trim() || null,
    }),
    note: (r, all) => {
      const ids = r.allowedRoomIds ?? [];
      if (!ids.length) return '';
      const names = ids.map((id) => all.rooms.find((x) => x.id === id)?.name ?? '（已刪除）');
      return `<p class="muted">例外指定：只能在 ${esc(names.join('、'))}，蓋過上面的類型設定。</p>`;
    },
  },

  plans: {
    blank: { name: '', membershipMonths: 12, note: '', items: [] },
    summary: (r) => `${r.items?.length ?? 0} 個項目 · 會籍 ${r.membershipMonths ?? '?'} 個月`,
    fields: (r, all) => [
      f.text({ name: 'name', label: '方案名稱', value: r.name, placeholder: '筋骨強身' }),
      f.number({ name: 'membershipMonths', label: '會籍（月）', value: r.membershipMonths, min: 1 }),
      f.text({ name: 'note', label: '備註', value: r.note ?? '', placeholder: '總價 288,000，限本人' }),
      itemsField(r.items ?? [], all),
    ],
    parse: (v) => ({
      name: v.name.trim(),
      membershipMonths: v.membershipMonths,
      note: v.note?.trim() || null,
      items: readItems(v),
    }),
    wireForm: wirePlanItems,
    note: (r, all) => {
      if (!r.items?.length) return '<p class="muted">還沒有項目。</p>';
      const rows = r.items.map((it) => {
        const detail =
          it.type === 'pool'
            ? `擇一：${(it.optionEquipmentIds ?? [])
                .map((id) => all.equipment.find((e) => e.id === id)?.name ?? '（已刪除）')
                .join(' / ')}`
            : all.courses.find((c) => c.id === it.courseId)?.name ?? '（課程已刪除）';
        return `<li>${esc(it.label)} <b>${it.qty}</b> 次 <span class="muted">${esc(detail)}</span></li>`;
      });
      return `<ul class="muted">${rows.join('')}</ul>`;
    },
  },
};

// ---------- 方案的項目編輯器 ----------
//
// 方案是唯一有巢狀資料的主檔。項目的欄位隨型態而變，所以這一段需要
// 「讀回表單 → 合併成草稿 → 重畫」，不能像其他主檔那樣 render 一次就結束。
//
// 排序用上下移動按鈕，不做拖拉（SPEC 第 8.0 節：無 hover、無拖拉、
// 最小點擊區 44px）。種子資料就有 7 個項目，實際只會更多，所以一項一張卡單欄堆疊。
//
// 驗證一律呼叫 domain 的 validate()，這裡不另寫一套 —— SPEC 第 6.7 節的雙層是
// 「前端一次、Rules 一次」，不是「UI 一次、domain 一次」。

function itemsField(items, all) {
  return `
    <fieldset class="field">
      <legend class="field__label">項目<span class="muted"> ${items.length}</span></legend>
      ${items.length
        ? items.map((it, i) => itemCard(it, i, items.length, all)).join('')
        : '<p class="muted">還沒有項目。方案至少要有一個項目才存得進去。</p>'}
      <p><button class="btn" type="button" data-add-item>＋ 新增項目</button></p>
    </fieldset>`;
}

function itemCard(it, i, total, all) {
  const isPool = it.type === 'pool';

  return `
    <div class="pool" data-item="${i}">
      <div class="pool__head">
        <span>第 ${i + 1} 個項目</span>
        <span class="pool__actions">
          <button class="btn" type="button" data-move="${i}:-1"
                  ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
          <button class="btn" type="button" data-move="${i}:1"
                  ${i === total - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        </span>
      </div>

      ${f.select({
        name: `item-${i}-type`, label: '型態', value: it.type ?? 'single',
        options: [
          { value: 'single', label: '單一課程（固定療程）' },
          { value: 'pool', label: '擇一池（每次選一種器材）' },
        ],
        hint: '換型態會換掉下面要填的欄位，已經填的名稱與次數不會被清掉。',
      })}

      ${f.text({ name: `item-${i}-label`, label: '顯示名稱', value: it.label ?? '', placeholder: '復能' })}
      ${f.number({ name: `item-${i}-qty`, label: '次數', value: it.qty ?? '', min: 1 })}

      ${isPool
        ? f.checkboxes({
            name: `item-${i}-equip`, label: '可選的器材',
            values: it.optionEquipmentIds ?? [],
            options: equipmentOptions(all.equipment, it.optionEquipmentIds ?? []),
            hint: '至少兩種。擇一池換的是器材，不是課程。',
          })
        : f.select({
            name: `item-${i}-course`, label: '課程', value: it.courseId ?? null,
            options: [
              { value: null, label: '（請選擇）' },
              ...courseOptions(all.courses, it.courseId),
            ],
          })}

      ${f.number({
        name: `item-${i}-duration`, label: '時長（分鐘）', value: it.durationMin ?? '',
        min: 1, step: 5,
        hint: isPool ? '擇一池沒有課程可以帶，要自己填。' : '選課程時會帶入該課程的時長，可以改。',
      })}

      ${f.text({
        name: `item-${i}-freq`, label: '頻率限制', value: it.frequencyRule ?? '',
        placeholder: '每季一次', hint: '只提示不阻擋。留空代表沒有限制。',
      })}

      <p><button class="btn" type="button" data-del-item="${i}">移除這個項目</button></p>
    </div>`;
}

// 已停用的仍然選得到，只標出來 —— validate 只擋已刪除、不擋停用，UI 不要比 domain 嚴。
// 指向已刪除課程的舊資料要原樣留著顯示，絕對不能在重畫時改成第一個選項：
// 那是無聲改資料，違反 SPEC 第 6 節的整個精神。讓 validate 去報錯。
function courseOptions(courses, currentId) {
  const opts = courses.map((c) => ({
    value: c.id,
    label: c.active === false ? `${c.name}（已停用）` : c.name,
  }));
  if (currentId && !courses.some((c) => c.id === currentId)) {
    opts.unshift({ value: currentId, label: '（課程已刪除）' });
  }
  return opts;
}

function equipmentOptions(equipment, currentIds) {
  const opts = equipment.map((e) => ({
    value: e.id,
    label: e.active === false ? `${e.name}（已停用）` : e.name,
  }));
  for (const id of currentIds) {
    if (!equipment.some((e) => e.id === id)) opts.push({ value: id, label: '（器材已刪除）' });
  }
  return opts;
}

/**
 * 從扁平的表單值組回項目陣列。
 * readForm 讀出來是一層物件，所以每個項目的欄位各自帶了 index 當名字。
 */
function readItems(v) {
  const items = [];
  for (let i = 0; `item-${i}-type` in v; i += 1) {
    items.push(
      planItem({
        type: v[`item-${i}-type`],
        label: v[`item-${i}-label`],
        qty: v[`item-${i}-qty`],
        durationMin: v[`item-${i}-duration`],
        courseId: v[`item-${i}-course`],
        optionEquipmentIds: v[`item-${i}-equip`],
        frequencyRule: v[`item-${i}-freq`],
      }),
    );
  }
  return items;
}

function wirePlanItems({ form, all, data, readDraft, repaint }) {
  form.querySelector('[data-add-item]')?.addEventListener('click', () => {
    const next = readDraft();
    next.items = [...next.items, planItem({ ...BLANK_PLAN_ITEM })];
    repaint(next, next.items.length - 1);
  });

  form.querySelectorAll('[data-del-item]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = readDraft();
      next.items = next.items.filter((_, i) => i !== Number(btn.dataset.delItem));
      repaint(next);
    }),
  );

  form.querySelectorAll('[data-move]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const [from, step] = btn.dataset.move.split(':').map(Number);
      const to = from + step;
      const next = readDraft();
      if (to < 0 || to >= next.items.length) return;
      const items = [...next.items];
      [items[from], items[to]] = [items[to], items[from]];
      next.items = items;
      // 停留在被移動的那一項，不是停在原本的位置
      repaint({ ...next }, to);
    }),
  );

  // 換型態要換欄位、換課程要帶預設值，兩者都得重畫。
  form.addEventListener('change', (ev) => {
    const m = /^item-(\d+)-(type|course)$/.exec(ev.target.name ?? '');
    if (!m) return;
    const i = Number(m[1]);
    const next = readDraft();
    if (m[2] === 'course') fillFromCourse(next.items[i], data.items?.[i], all.courses);
    repaint(next, i);
  });
}

/**
 * 選了課程就把時長、頻率、名稱帶進來。
 *
 * 只在「還沒填」或「填的正好是上一個課程的預設值」時覆蓋 ——
 * 她自己打過的數字不能被無聲蓋掉。
 */
function fillFromCourse(item, previous, courses) {
  const course = courses.find((c) => c.id === item?.courseId);
  if (!course) return;
  const was = courses.find((c) => c.id === previous?.courseId);

  if (item.durationMin == null || item.durationMin === was?.durationMin) {
    item.durationMin = course.durationMin ?? null;
  }
  if (!item.label || item.label === was?.name) item.label = course.name;

  if (!item.frequencyRule || item.frequencyRule === was?.frequencyRule) {
    if (course.frequencyRule) item.frequencyRule = course.frequencyRule;
    else delete item.frequencyRule;
  }
}

export async function render(el, type) {
  if (!editors[type]) {
    el.innerHTML = `<div class="card"><p>沒有這個主檔類型：${esc(type)}</p></div>`;
    return;
  }
  el.innerHTML = '<p class="muted">載入中…</p>';

  let all;
  try {
    all = await config.loadAll();
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  paintList(el, type, all);
}

function paintList(el, type, all) {
  const ed = editors[type];
  const rows = all[type];

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <section class="card">
      <h2 class="card__title">${MASTER_LABELS[type]}<span class="muted"> ${rows.length}</span></h2>
      <p><button class="btn btn--primary" type="button" data-new>新增</button></p>
    </section>
    ${rows.length === 0 ? '<p class="muted">還沒有資料。</p>' : ''}
    ${rows
      .map(
        (r) => `
      <section class="card row">
        <div class="row__main">
          <div class="row__title">
            ${esc(r.name)}
            ${r.active === false ? '<span class="badge badge--soon">已停用</span>' : ''}
          </div>
          <div class="muted">${esc(ed.summary(r))}</div>
          ${ed.note ? ed.note(r, all) : ''}
        </div>
        <div class="row__actions">
          <button class="btn" type="button" data-edit="${esc(r.id)}">編輯</button>
          ${type === 'plans'
            ? `<button class="btn" type="button" data-copy="${esc(r.id)}">複製一份</button>`
            : ''}
        </div>
      </section>`,
      )
      .join('')}`;

  el.querySelector('[data-new]').addEventListener('click', () =>
    paintForm(el, type, all, null),
  );
  el.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(el, type, all, rows.find((r) => r.id === btn.dataset.edit)),
    ),
  );
  // 複製是「開一張帶著內容的新表單」，不是直接寫一筆進去 ——
  // 按了儲存才算數，跟現有的新增流程一致（ADR-0003 的複製，見那張 issue）。
  el.querySelectorAll('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(el, type, all, null, copyPlan(rows.find((r) => r.id === btn.dataset.copy))),
    ),
  );
}

/**
 * @param {object|null} record 已存在的紀錄，新增時是 null
 * @param {object|null} draft 填到一半的內容。表單要重畫（例如方案加了一個項目）時，
 *   先把畫面上的值讀回來當草稿再重畫，否則其他欄位會被清空。
 * @param {number|null} focusItem 重畫後要捲到第幾個項目
 */
function paintForm(el, type, all, record, draft = null, focusItem = null) {
  const ed = editors[type];
  // 看有沒有 id，不是看有沒有 record —— 帶著草稿重畫時 record 還是那一筆，
  // 但草稿本身沒有 id，用 !record 判斷會把「新增中」誤判成「編輯既有」。
  const isNew = !record?.id;
  const data = draft ?? record ?? { ...ed.blank };

  el.innerHTML = `
    <a class="backlink" href="#/settings/${type}" data-back>${icon('left', { size: 17 })}${MASTER_LABELS[type]}</a>
    <section class="card">
      <h2 class="card__title">${isNew ? `新增${MASTER_LABELS[type]}` : esc(data.name)}</h2>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${ed.fields(data, all).join('')}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
          ${!isNew && type === 'plans'
            ? '<button class="btn" type="button" data-copy>複製一份</button>'
            : ''}
        </div>
      </form>
    </section>
    ${isNew ? '' : dangerZone(record)}`;

  const back = () => render(el, type);
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);
  // 帶著這一張的內容開一張新表單。畫面上還沒存的修改不帶過去 ——
  // 複製的是「已經存下來的那一張」，那是她按下去時看到的東西。
  el.querySelector('[data-copy]')?.addEventListener('click', () =>
    paintForm(el, type, all, null, copyPlan(record)),
  );

  const form = el.querySelector('[data-form]');

  // 需要換欄位的編輯器（目前只有方案的項目）用這個重畫，草稿由它自己準備。
  if (ed.wireForm) {
    ed.wireForm({
      form,
      all,
      data,
      readDraft: () => ({ ...data, ...ed.parse(f.readForm(form), data) }),
      repaint: (next, focus = null) => paintForm(el, type, all, record, next, focus),
    });
  }

  if (focusItem !== null) {
    const card = el.querySelector(`[data-item="${focusItem}"]`);
    card?.scrollIntoView({ block: 'center' });
    card?.querySelector('input')?.focus({ preventScroll: true });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = f.readForm(e.target);
    const parsed = ed.parse(values, record);
    const candidate = { ...parsed, id: record?.id };

    const errors = validate(type, candidate, {
      existing: all[type],
      courses: all.courses,
      equipment: all.equipment,
    });
    f.showErrors(el, errors);
    if (errors.length) return;

    try {
      if (isNew) {
        await toast.withSaveState(() => config.create(type, { ...parsed, active: true }), {
          success: '已新增',
        });
      } else {
        await toast.withSaveState(() => config.update(type, record.id, parsed), {
          success: '已儲存',
        });
      }
      back();
    } catch {
      /* withSaveState 已顯示錯誤與重試 */
    }
  });

  if (!isNew) wireDangerZone(el, type, record, back);
}

// ---------- 破壞性操作 ----------

function dangerZone(r) {
  const disabled = r.active === false;
  return `
    <section class="card danger">
      <h2 class="card__title">停用與刪除</h2>
      <p class="muted">
        ${disabled
          ? '目前已停用：新增來訪時不會出現在選單，既有來訪不受影響。'
          : '停用後新增來訪時不會再出現在選單，既有來訪不受影響。'}
      </p>
      <p>
        <button class="btn" type="button" data-toggle-active>
          ${disabled ? '重新啟用' : '停用'}
        </button>
        <button class="btn btn--danger" type="button" data-delete>刪除</button>
      </p>
      <p class="muted">刪除是標記，資料不會消失，可以在「已刪除項目」還原。</p>
    </section>`;
}

function wireDangerZone(el, type, r, back) {
  el.querySelector('[data-toggle-active]').addEventListener('click', async () => {
    const turningOff = r.active !== false;
    const ok = await confirmAction({
      title: turningOff ? `停用「${r.name}」？` : `重新啟用「${r.name}」？`,
      consequences: turningOff
        ? [
            '之後新增來訪時，選單裡不會再出現它',
            '已經排好的來訪完全不受影響，照舊留著',
            '資料健檢頁會把指向已停用主檔的來訪列出來讓你有空再處理',
            '隨時可以再啟用',
          ]
        : ['之後新增來訪時，選單裡會重新出現它'],
      confirmLabel: turningOff ? '停用' : '啟用',
      danger: turningOff,
    });
    if (!ok) return;

    const before = r.active !== false;
    try {
      await toast.withSaveState(() => config.update(type, r.id, { active: !before }), {
        success: turningOff ? '已停用' : '已啟用',
      });
      back();
    } catch {
      /* 已處理 */
    }
  });

  el.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: `刪除「${r.name}」？`,
      consequences: [
        '這是標記刪除，資料不會真的消失',
        '清單上不再顯示，新增來訪時也選不到',
        '已經引用它的來訪與方案不會被修改，但會顯示為「已刪除」',
        '可以在設定 → 已刪除項目 還原',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      // 復原按鈕由 withSaveState 自己接上（SPEC 第 6.3 節）
      await toast.withSaveState(() => config.remove(type, r.id), { success: '已刪除' });
      back();
    } catch {
      /* 已處理 */
    }
  });
}
