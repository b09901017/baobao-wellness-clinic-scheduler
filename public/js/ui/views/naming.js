// 設定 → 名稱怎麼寫。
//
// 她 2026-09-06：
//
// > 設定可以多一個名稱檢視表？就是可以設定課程的全名以及別稱(像是月檢視這邊
// > 呈現的)以及如果是 line 草稿要怎麼寫名稱等等
//
// ## 這一頁改什麼、不改什麼
//
//   改  別稱、LINE 名 —— 同一個東西的另外兩種寫法
//   不改 全名 —— 改全名會動到主檔清單、方案範本、稽核紀錄，那是課程／器材
//        自己那一頁的事
//
// ## 為什麼要有預覽
//
// 「別稱」跟「LINE 名」單獨看沒有意義 —— 她要看的是那兩個字**組起來**長什麼樣
//（`復能(SIS)`）。組法只在 `domain/naming.js`，這一頁只是把它畫出來。
//
// 預覽是**就地換字**的：打字重畫會洗掉游標與輸入法的組字狀態（同 `buy.js`
// 那句「會變成『8萬健檢』」）。

import * as config from '../../data/config.js';
import { NAME_CONTEXTS, CONTEXT_LABELS, slotName } from '../../domain/naming.js';
import { esc } from '../components/form.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let courses;
  let equipment;
  try {
    [courses, equipment] = await Promise.all([
      config.listAll('courses'),
      config.listAll('equipment'),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  paint({ el, courses, equipment });
}

function paint(ctx) {
  const { el, courses, equipment } = ctx;
  const master = { courses, equipment };

  el.innerHTML = `
    <div data-namingroot>
    <a class="backlink" href="#/settings">${icon('left', { size: 17 })}設定</a>

    <div class="page">
      <h1 class="page__title">名稱怎麼寫</h1>
      <p class="page__lead">同一個東西在三個地方寫法不一樣：月檢視一格只放得下幾個字，
        貼給客戶的那一句要她跟客人都看得懂。全名在課程與器材那兩頁改。</p>
    </div>

    ${courses.map((c) => courseCard(c, equipment, master)).join('')}
    </div>`;

  wire(ctx, master);
}

/**
 * 一個課程一張卡，它的器材縮排掛在底下。
 *
 * 器材掛在課程底下是因為她要看的正是那兩個字**組起來**的樣子
 * —— 「超磁場」單獨一列講不出「復能(SIS)」。掛哪一個課程由器材主檔上的
 * `courseId` 決定（ADR-0075）。
 */
function courseCard(course, equipment, master) {
  const mine = equipment.filter((e) => e.courseId === course.id);
  return `
    <section class="card" data-namecard="${esc(course.id)}">
      ${nameRow(course, 'courses', { slot: { courseId: course.id, courseName: course.name }, master })}
      ${mine.map((eq) => nameRow(eq, 'equipment', {
        slot: { courseId: course.id, courseName: course.name, equipmentId: eq.id },
        master,
        indent: true,
      })).join('')}
    </section>`;
}

/** 一列：名字、兩格、三種寫法的預覽。 */
function nameRow(row, type, { slot, master, indent = false }) {
  return `
    <div class="namerow ${indent ? 'namerow--sub' : ''}"
         data-name="${esc(type)}:${esc(row.id)}">
      <div class="namerow__head">${esc(row.name)}</div>
      <div class="namerow__fields">
        <label class="field">
          <span class="field__label">別稱</span>
          <input type="text" data-short value="${esc(row.shortName ?? '')}"
                 placeholder="${esc(row.name)}" maxlength="12" />
        </label>
        <label class="field">
          <span class="field__label">LINE</span>
          <input type="text" data-line value="${esc(row.lineName ?? '')}"
                 placeholder="${esc(row.shortName || row.name)}" maxlength="12" />
        </label>
      </div>
      <p class="namerow__preview" data-preview>${previewText(slot, master)}</p>
    </div>`;
}

/** 三種情境並排。`domain/naming.js` 組，這一頁只印。 */
function previewText(slot, master) {
  return NAME_CONTEXTS
    .map((c) => `${CONTEXT_LABELS[c]} ${esc(slotName(slot, master, c))}`)
    .join('　｜　');
}

function wire(ctx, master) {
  const root = ctx.el.querySelector('[data-namingroot]');
  if (!root) return;

  /** 這一列改過的值先寫回手上那一份主檔，預覽才跟得上。 */
  const apply = (holder) => {
    const [type, id] = holder.dataset.name.split(':');
    const rows = type === 'courses' ? ctx.courses : ctx.equipment;
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    row.shortName = holder.querySelector('[data-short]').value.trim() || null;
    row.lineName = holder.querySelector('[data-line]').value.trim() || null;
    return { type, id, row };
  };

  // 打字**不重畫** —— 重畫會洗掉游標與輸入法的組字狀態。
  // 那一張卡上每一列的預覽都要跟著換：改了「復能」的別稱，底下三台器材的
  // 「月檢視」那一格也會變。
  root.addEventListener('input', (ev) => {
    const holder = ev.target.closest('[data-name]');
    if (!holder || !apply(holder)) return;
    for (const card of root.querySelectorAll('[data-namecard]')) refreshCard(card, ctx, master);
  });

  // 離開那一格才寫進去。**每打一個字就存一次**會把稽核紀錄灌成一長串
  // （SPEC 第 6.2 節：每一次寫入都留 before / after）。
  root.addEventListener('focusout', async (ev) => {
    const holder = ev.target.closest('[data-name]');
    if (!holder || !ev.target.matches('[data-short], [data-line]')) return;
    const hit = apply(holder);
    if (!hit) return;

    await toast.withSaveState(
      () => config.update(hit.type, hit.id, {
        shortName: hit.row.shortName,
        lineName: hit.row.lineName,
      }),
      { success: '改好了', key: `naming:${hit.type}:${hit.id}` },
    );
  });
}

/** 一張卡上的每一列預覽重算一次。 */
function refreshCard(card, ctx, master) {
  const courseId = card.dataset.namecard;
  const course = ctx.courses.find((c) => c.id === courseId) ?? null;
  if (!course) return;

  for (const holder of card.querySelectorAll('[data-name]')) {
    const [type, id] = holder.dataset.name.split(':');
    const slot = {
      courseId,
      courseName: course.name,
      equipmentId: type === 'equipment' ? id : null,
    };
    const line = holder.querySelector('[data-preview]');
    if (line) line.innerHTML = previewText(slot, master);
  }
}
