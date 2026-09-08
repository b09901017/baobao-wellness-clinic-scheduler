// 設定 → 名稱怎麼寫。
//
// 她 2026-09-08：
//
// > 我不希望出現復能(器材)，靜脈(IL)等其他格式，只會有以下這六種
// > …設定就不用管復能或靜脈的課程命名，這兩個就固定用上面那六種，
// > 然後改也是改上面那六種
//
// ## 這一頁的形狀：六列
//
// 上面一區就是她列的那六種，一種一列，每一列印出「月曆怎麼寫」與
// 「LINE 草稿怎麼寫」：
//
//   復能-三選一      月曆 IN/SIS/高能量雷射   LINE 復能
//   復能-四選一      月曆 …/IL                LINE 復能/靜脈雷射
//   復能-INDIBA      月曆 [ IN  ]             LINE 復能
//   復能-SIS         月曆 [     ]             LINE 復能
//   復能-高能量雷射   月曆 [     ]             LINE 復能
//   ILIB            月曆 [ IL  ]             LINE [靜脈雷射]
//
// **前兩列只給看。** 它們是一種**買法**（三台器材的組合），背後沒有一筆主檔
// 可以存字 —— 另外開一份存名字的地方，她改了 SIS 的別稱之後那一列會停在舊的。
// 那兩列的名字跟著「那天用了哪一台」走，所以改底下三列就好。
//
// **這六列一列都不寫死。** 哪幾台屬於復能、多出來的那一個課程是誰，
// 全部從器材主檔上的 `courseId` 推（ADR-0075），跟加購那一排問的是同一句話
//（`poolChoices()`、`poolSiblingCourseIds()`）。她之後多接一台新器材、
// 指到一個新課程，這一頁自己會多一列。
//
// ## 這一頁改什麼、不改什麼
//
//   改   器材的別稱（月曆那一格）、ILIB 課程的別稱與 LINE 名
//   改   其他課程的別稱與 LINE 名（底下那一區）
//   不改 器材的 LINE 名 —— 貼給客人的那一句只講課程（ADR-0077），
//        那一格畫不出來，所以器材那幾列根本不給它
//   不改 全名 —— 改全名會動到主檔清單、方案範本、稽核紀錄，那是課程／器材
//        自己那一頁的事。復能那五種在 LINE 上都寫「復能」，那就是課程的全名，
//        真的要改就去設定 → 課程改它
//
// ## 為什麼要有預覽
//
// 「別稱」跟「LINE 名」單獨看沒有意義 —— 她要看的是那兩個字**擺進那一格**
// 長什麼樣。組法只在 `domain/naming.js`，這一頁只是把它畫出來。
//
// 預覽是**就地換字**的：打字重畫會洗掉游標與輸入法的組字狀態（同 `buy.js`
// 那句「會變成『8萬健檢』」）。

import * as config from '../../data/config.js';
import { slotName } from '../../domain/naming.js';
import {
  poolName, poolChoices, poolCourseOf, poolSiblingCourseIds,
} from '../../domain/entitlements.js';
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

/**
 * 復能與 ILIB 那六列是哪幾列。**一列都不寫死。**
 *
 * 順序照她列的：兩種整組、三台單買、最後 ILIB。
 *
 * 回的是兩種形狀，靠 `type` 分：
 *
 *   整組（只給看） `{ key, title, pool, note }`      —— 沒有一筆主檔可以存字
 *   一筆主檔       `{ key, title, slot, type, id, hasLine }`
 *
 * `key` 是那一列在畫面上的身分（`data-row`），重畫預覽時照它找 —— 不照位置對。
 *
 * @returns {object[]}
 */
function rehabRows(master) {
  const { courses, equipment } = master;
  const home = poolCourseOf(master);
  if (!home) return [];

  const { sets, singles } = poolChoices(master);
  const rows = [];

  // 一、二：整組。**只給看** —— 它是一種買法，不是一筆主檔。
  for (const set of sets) {
    rows.push({
      key: `set:${set.value}`,
      title: poolName(set.ids, equipment, courses),
      // 預覽要印出「這一種在月曆上可能是哪幾個字」，所以帶著整池的器材
      pool: set.ids,
      note: '名字跟著那天用的是哪一台走 —— 要改就改底下那幾列',
    });
  }

  // 三～五：單買一台。改得動的是器材的**別稱**（月曆那一格）。
  for (const one of singles) {
    const eq = equipment.find((x) => x.id === one.value) ?? null;
    if (!eq) continue;
    rows.push({
      key: `equipment:${eq.id}`,
      title: poolName([eq.id], equipment, courses),
      slot: { courseId: home.id, courseName: home.name, equipmentId: eq.id },
      type: 'equipment',
      id: eq.id,
      hasLine: false,
    });
  }

  // 六：復能的鄰居（現在就是 ILIB）。它是一個**課程**，所以兩格都改得動。
  for (const id of poolSiblingCourseIds(master)) {
    const course = courses.find((c) => c.id === id && !c.deletedAt) ?? null;
    if (!course) continue;
    rows.push({
      key: `courses:${course.id}`,
      title: course.name,
      slot: { courseId: course.id, courseName: course.name },
      type: 'courses',
      id: course.id,
      hasLine: true,
    });
  }

  return rows;
}

/** 底下那一區：復能與 ILIB 以外的課程。 */
function otherCourses(master) {
  const home = poolCourseOf(master);
  const siblings = poolSiblingCourseIds(master);
  return (master.courses ?? []).filter(
    (c) => !c.deletedAt && c.id !== home?.id && !siblings.has(c.id),
  );
}

function paint(ctx) {
  const { el, courses, equipment } = ctx;
  const master = { courses, equipment };

  el.innerHTML = `
    <div data-namingroot>
    <a class="backlink" href="#/settings">${icon('left', { size: 17 })}設定</a>

    <div class="page">
      <h1 class="page__title">名稱怎麼寫</h1>
      <p class="page__lead">同一個東西在三個地方寫法不一樣：<b>額度</b>是當初買了什麼，
        <b>月曆</b>一格只放得下幾個字，<b>LINE 草稿</b>要她跟客人都看得懂。
        全名在課程與器材那兩頁改。</p>
    </div>

    <section class="card" data-namecard>
      <h2 class="card__title">復能與 ILIB</h2>
      <p class="muted" style="margin: 0 0 var(--space-3)">就是這六種。
        前兩種是一種買法，名字跟著那天用的器材走，所以只給看。</p>
      ${rehabRows(master).map((row) => rehabRowHtml(row, master)).join('')}
    </section>

    <section class="card" data-namecard>
      <h2 class="card__title">其他課程</h2>
      ${otherCourses(master).map((c) => nameRow({
        key: `courses:${c.id}`,
        title: c.name,
        type: 'courses',
        row: c,
        hasLine: true,
        slot: { courseId: c.id, courseName: c.name },
        master,
      })).join('')}
    </section>
    </div>`;

  wire(ctx, master);
}

/** 那六列。前兩列沒有輸入框，其餘走 `nameRow()`。 */
function rehabRowHtml(row, master) {
  if (!row.type) {
    return `
      <div class="namerow" data-row="${esc(row.key)}">
        <div class="namerow__head">${esc(row.title)}</div>
        <p class="namerow__preview" data-preview>${poolPreview(row.pool, master)}</p>
        <p class="namerow__preview">${esc(row.note ?? '')}</p>
      </div>`;
  }

  const rows = row.type === 'courses' ? master.courses : master.equipment;
  return nameRow({
    key: row.key,
    title: row.title,
    type: row.type,
    row: rows.find((r) => r.id === row.id),
    hasLine: row.hasLine,
    slot: row.slot,
    master,
  });
}

/**
 * 一列：名字、一到兩格、兩種寫法的預覽。
 *
 * **器材那幾列沒有 LINE 那一格**（ADR-0077）：貼給客人的那一句只講課程，
 * 所以器材的 `lineName` 一輩子都畫不出來。留著一個永遠不會出現在任何地方的
 * 輸入框比沒有還糟 —— 她會填，然後找不到它在哪裡。
 */
function nameRow({ key, title, type, row, hasLine, slot, master }) {
  if (!row) return '';

  const line = hasLine ? `
        <label class="field">
          <span class="field__label">LINE</span>
          <input type="text" data-line value="${esc(row.lineName ?? '')}"
                 placeholder="${esc(row.name)}" maxlength="12" />
        </label>` : '';

  return `
    <div class="namerow" data-row="${esc(key ?? `${type}:${row.id}`)}"
         data-name="${esc(type)}:${esc(row.id)}">
      <div class="namerow__head">${esc(title)}</div>
      <div class="namerow__fields">
        <label class="field">
          <span class="field__label">月曆</span>
          <input type="text" data-short value="${esc(row.shortName ?? '')}"
                 placeholder="${esc(row.name)}" maxlength="12" />
        </label>${line}
      </div>
      <p class="namerow__preview" data-preview>${previewText(slot, master)}</p>
    </div>`;
}

/**
 * 一列的預覽。**`domain/naming.js` 組，這一頁只印。**
 *
 * 月曆那一格印的是「這一段真的排出去之後長什麼樣」，所以它不帶分鐘 ——
 * 分鐘要有起訖時間才算得出來（`withMinutes()`），而這裡沒有哪一天。
 * 底下那一句話講清楚這件事。
 */
function previewText(slot, master) {
  return `月曆 ${esc(slotName(slot, master, 'short'))}（30／60 會接在後面）`
    + `　｜　LINE ${esc(slotName(slot, master, 'line'))}`;
}

/**
 * 整組那兩列的預覽：**這一種在月曆上可能是哪幾個字。**
 *
 * 她自己寫的就是 `IN/SIS/高能量雷射`、`復能/靜脈雷射` —— 斜線的意思是
 * 「其中一個，看那天壓了哪一台」。
 */
function poolPreview(ids, master) {
  const slots = (ids ?? []).map((id) => {
    const eq = (master.equipment ?? []).find((x) => x.id === id) ?? null;
    const course = (master.courses ?? []).find((c) => c.id === eq?.courseId) ?? null;
    return { courseId: course?.id, courseName: course?.name, equipmentId: id };
  });
  const uniq = (list) => [...new Set(list.filter(Boolean))].join('/');
  return `月曆 ${esc(uniq(slots.map((s) => slotName(s, master, 'short'))))}`
    + `　｜　LINE ${esc(uniq(slots.map((s) => slotName(s, master, 'line'))))}`;
}

function wire(ctx, master) {
  const root = ctx.el.querySelector('[data-namingroot]');
  if (!root) return;

  /**
   * 這一列改過的值先寫回手上那一份主檔，預覽才跟得上。
   *
   * 器材那幾列沒有 LINE 那一格（`nameRow()`），所以那一格**不存在**時
   * `lineName` 一個字都不要動 —— 寫成 `null` 等於一打開這一頁就把她
   * 以前設過的東西清掉，而畫面上什麼都不會說。
   */
  const apply = (holder) => {
    const [type, id] = holder.dataset.name.split(':');
    const rows = type === 'courses' ? ctx.courses : ctx.equipment;
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    row.shortName = holder.querySelector('[data-short]').value.trim() || null;
    const lineBox = holder.querySelector('[data-line]');
    if (lineBox) row.lineName = lineBox.value.trim() || null;
    return { type, id, row, hasLine: Boolean(lineBox) };
  };

  // 打字**不重畫** —— 重畫會洗掉游標與輸入法的組字狀態。
  // **整頁的預覽都要跟著換**：改了 SIS 的別稱，上面「三選一」那一列的
  // `IN/SIS/高能量雷射` 也會變。
  root.addEventListener('input', (ev) => {
    const holder = ev.target.closest('[data-name]');
    if (!holder || !apply(holder)) return;
    repaintPreviews(root, ctx, master);
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
        ...(hit.hasLine ? { lineName: hit.row.lineName } : {}),
      }),
      { success: '改好了', key: `naming:${hit.type}:${hit.id}` },
    );
  });
}

/**
 * 每一列的預覽重算一次。
 *
 * **整組那兩列也要**：它們沒有輸入框（改不動），但它們印的正是底下那幾列的
 * 別稱組起來的樣子 —— 只重畫有輸入框的那幾列，她改了 SIS 之後「三選一」
 * 那一列會停在舊的字。所以整頁重畫，而不是一張卡一張卡。
 *
 * **照 `data-row` 找，不照位置對。** 以前這裡拿 `cards[0]` 與 `holders[i]`
 * 去跟 `rehabRows()` 對位 —— 之後多一列、少一列、或換個順序，預覽就會畫到
 * 別列上，而畫面上看起來只是「那一列的字怪怪的」。
 */
function repaintPreviews(root, ctx, master) {
  const paint = (key, html) => {
    const line = root.querySelector(`[data-row="${CSS.escape(key)}"] [data-preview]`);
    if (line) line.innerHTML = html;
  };

  for (const row of rehabRows(master)) {
    paint(row.key, row.type ? previewText(row.slot, master) : poolPreview(row.pool, master));
  }

  for (const course of otherCourses(master)) {
    paint(`courses:${course.id}`,
      previewText({ courseId: course.id, courseName: course.name }, master));
  }
}
