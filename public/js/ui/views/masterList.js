// 單一主檔類型的清單與編輯。
//
// 破壞性操作刻意不放在主要動線上（SPEC 第 6.5 節）：卡片上只有「編輯」，
// 停用與刪除放在編輯畫面的最下方，而且都要二次確認並顯示具體後果。

import * as config from '../../data/config.js';
import {
  MASTER_LABELS, ROOM_TYPES, STAFF_ROLES, ASSIGNS, ASSIGN_LABELS, validate,
} from '../../domain/masterData.js';
import { CATEGORY_OPTIONS, describeCategory } from '../../domain/taskRules.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

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
    fields: (r) => [
      f.text({ name: 'name', label: '方案名稱', value: r.name, placeholder: '筋骨強身' }),
      f.number({ name: 'membershipMonths', label: '會籍（月）', value: r.membershipMonths, min: 1 }),
      f.text({ name: 'note', label: '備註', value: r.note ?? '', placeholder: '總價 288,000，限本人' }),
    ],
    parse: (v, prev) => ({
      name: v.name.trim(),
      membershipMonths: v.membershipMonths,
      note: v.note?.trim() || null,
      items: prev?.items ?? [],
    }),
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
    <p><a href="#/settings">← 設定</a></p>
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
        <button class="btn" type="button" data-edit="${esc(r.id)}">編輯</button>
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
}

function paintForm(el, type, all, record) {
  const ed = editors[type];
  const isNew = !record;
  const data = record ?? { ...ed.blank };

  el.innerHTML = `
    <p><a href="#/settings/${type}" data-back>← ${MASTER_LABELS[type]}</a></p>
    <section class="card">
      <h2 class="card__title">${isNew ? `新增${MASTER_LABELS[type]}` : esc(data.name)}</h2>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${ed.fields(data).join('')}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>
    ${isNew ? '' : dangerZone(data)}`;

  const back = () => render(el, type);
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
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

  if (!isNew) wireDangerZone(el, type, data, back);
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
      await toast.withSaveState(() => config.remove(type, r.id), { success: '已刪除' });
      toast.failed('已刪除。要還原嗎？', async () => {
        await config.restore(type, r.id);
        toast.saved('已還原');
        back();
      });
      back();
    } catch {
      /* 已處理 */
    }
  });
}
