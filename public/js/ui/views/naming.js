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

  // 每一列打開之前的樣子。按「取消」或改點別列時要退回它 ——
  // 手上那一份主檔是**就地改**的（預覽靠它），不留一份原值的話，
  // 她按了取消，畫面上那一列還是新的字。
  const saved = new Map();
  for (const [type, rows] of [['courses', courses], ['equipment', equipment]]) {
    for (const r of rows) {
      saved.set(`${type}:${r.id}`, { shortName: r.shortName ?? null, lineName: r.lineName ?? null });
    }
  }

  paint({ el, courses, equipment, saved, editingKey: null });
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
  const open = ctx.editingKey ?? null;

  el.innerHTML = `
    <div data-namingroot>
    <a class="backlink" href="#/settings">${icon('left', { size: 17 })}設定</a>

    <div class="page">
      <h1 class="page__title">名稱怎麼寫</h1>
      <p class="page__lead">同一個東西在三個地方寫法不一樣：<b>額度</b>是當初買了什麼，
        <b>月曆</b>一格只放得下幾個字，<b>LINE 草稿</b>要你跟客人都看得懂。
        點右邊的鉛筆改一列，全名在課程與器材那兩頁改。</p>
    </div>

    <section class="card" data-namecard>
      <h2 class="card__title">復能與 ILIB</h2>
      <p class="muted" style="margin: 0 0 var(--space-3)">就是這六種。
        前兩種是一種買法，名字跟著那天用的器材走，所以只給看。</p>
      ${rehabRows(master).map((row) => rehabRowHtml(row, master, open)).join('')}
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
        editing: open === `courses:${c.id}`,
      })).join('')}
    </section>
    </div>`;

  wire(ctx, master);
}

/** 那六列。前兩列沒有輸入框，其餘走 `nameRow()`。 */
function rehabRowHtml(row, master, editingKey) {
  // 前兩列（三選一／四選一）**沒有鉛筆**：它們是一種買法，背後沒有一筆主檔
  // 可以存字（ADR-0078 第五點）。名字跟著那天用的器材走，所以改底下那幾列。
  if (!row.type) {
    return `
      <div class="namerow namerow--read" data-row="${esc(row.key)}">
        <div class="namerow__top">
          <span class="namerow__head">${esc(row.title)}</span>
        </div>
        <p class="namerow__preview" data-preview>${poolPreview(row.pool, master)}</p>
        <p class="namerow__note">${esc(row.note ?? '')}</p>
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
    editing: editingKey === row.key,
  });
}

/**
 * 一列：**預設只給看**，點右邊那支鉛筆才就地展開。
 *
 * 她 2026-09-08：
 *
 * > 以簡潔、具有呼吸感的排版，呈現所有既有課程的「一般名稱」、「月曆簡寫」、
 * > 「LINE 寫法」。此檢視狀態不呈現大量輸入框，不造成視覺負擔。
 *
 * 在這之前這一頁是**十幾列、每列兩個輸入框**一次全部攤開 —— 她要找的
 * 「這個東西現在叫什麼」被埋在一堆邊框裡。
 *
 * ## 讀的那一列只回答一句話
 *
 * ```
 * 復能-INDIBA                         ✎
 * 月曆 IN    LINE 復能
 * ```
 *
 * 標籤（`月曆`／`LINE`）留著不省：那兩個字就是「誰在看」，
 * 而這一頁整件事就是「同一個東西在三個地方寫法不一樣」。
 *
 * ## 一次只開一列
 *
 * 開第二列時第一列自己收起來 —— 兩列同時開著就回到原本那個滿頁輸入框的樣子。
 *
 * @param {{editing: boolean}} state
 */
function nameRow({ key, title, type, row, hasLine, slot, master, editing }) {
  if (!row) return '';

  const id = key ?? `${type}:${row.id}`;
  return `
    <div class="namerow ${editing ? 'is-editing' : ''}" data-row="${esc(id)}"
         data-name="${esc(type)}:${esc(row.id)}">
      <div class="namerow__top">
        <span class="namerow__head">${esc(title)}</span>
        <button class="namerow__edit" type="button" data-edit="${esc(id)}"
                aria-expanded="${editing}"
                aria-label="${editing ? '收起' : '改'}「${esc(title)}」的寫法">
          ${icon(editing ? 'close' : 'pencil', { size: 16 })}
        </button>
      </div>
      ${editing
        ? editFields({ row, hasLine, slot, master })
        : readForms(slot, master, hasLine, row)}
    </div>`;
}

/**
 * 讀的那一列：兩種寫法各一格，**沒有任何輸入框**。
 *
 * 器材那幾列的 LINE 也印出來（她 2026-09-08 要「所有課程項目」都看得到
 * 三種寫法），但**它不是那一台器材的字，是它屬於的課程的字** ——
 * 所以那一格底下多一句話說清楚要去哪裡改（ADR-0077 沒有被推翻：
 * 貼給客人的那一句從來不講是哪一台機器）。
 */
function readForms(slot, master, hasLine, row) {
  return `
    <dl class="namerow__reads">
      <div class="namerow__read">
        <dt>月曆</dt>
        <dd>${esc(slotName(slot, master, 'short')) || '<span class="dim">—</span>'}</dd>
      </div>
      <div class="namerow__read">
        <dt>LINE</dt>
        <dd>${esc(slotName(slot, master, 'line')) || '<span class="dim">—</span>'}</dd>
      </div>
    </dl>
    ${hasLine || !row ? '' : `
      <p class="namerow__note">LINE 那一句寫的是它屬於的課程 —— 要改到下面「其他課程」那一區</p>`}`;
}

/** 展開之後那幾格。**離開輸入框不存**，按「存起來」才寫進去。 */
function editFields({ row, hasLine, slot, master }) {
  const line = hasLine ? `
      <label class="field">
        <span class="field__label">LINE 草稿</span>
        <input type="text" data-line value="${esc(row.lineName ?? '')}"
               placeholder="${esc(row.name)}" maxlength="12" />
      </label>` : '';

  return `
    <div class="namerow__fields">
      <label class="field">
        <span class="field__label">月曆簡寫</span>
        <input type="text" data-short value="${esc(row.shortName ?? '')}"
               placeholder="${esc(row.name)}" maxlength="12" />
      </label>${line}
    </div>
    <p class="namerow__preview" data-preview>${previewText(slot, master)}</p>
    <div class="namerow__actions">
      <button class="btn btn--primary btn--sm" type="button" data-save>存起來</button>
      <button class="btn btn--sm" type="button" data-cancel>取消</button>
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
   * 器材那幾列沒有 LINE 那一格（`editFields()`），所以那一格**不存在**時
   * `lineName` 一個字都不要動 —— 寫成 `null` 等於一按存檔就把她以前設過的
   * 東西清掉，而畫面上什麼都不會說。
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

  /** 那一列的值退回她打開之前的樣子（按了取消、或存完之後收起來）。 */
  const revert = (holder) => {
    const [type, id] = (holder?.dataset.name ?? '').split(':');
    const rows = type === 'courses' ? ctx.courses : ctx.equipment;
    const row = rows.find((r) => r.id === id);
    const saved = ctx.saved.get(`${type}:${id}`);
    if (row && saved) Object.assign(row, saved);
  };

  // 打字**不重畫** —— 重畫會洗掉游標與輸入法的組字狀態。
  // **整頁的預覽都要跟著換**：改了 SIS 的別稱，上面「三選一」那一列的
  // `IN/SIS/高能量雷射` 也會變。
  root.addEventListener('input', (ev) => {
    const holder = ev.target.closest('[data-name]');
    if (!holder || !apply(holder)) return;
    repaintPreviews(root, ctx, master);
  });

  root.addEventListener('click', async (ev) => {
    // ---- 鉛筆：開這一列，順手把上一列收起來 ----
    const pencil = ev.target.closest('[data-edit]');
    if (pencil) {
      const next = pencil.dataset.edit;
      // 開著的那一列如果還沒存就退回原值 —— 點鉛筆離開不是一種儲存
      const openHolder = root.querySelector('.namerow.is-editing');
      if (openHolder) revert(openHolder);
      ctx.editingKey = ctx.editingKey === next ? null : next;
      paint(ctx);
      // 展開之後游標直接落在第一格：她點鉛筆就是要打字
      ctx.el.querySelector('.namerow.is-editing [data-short]')?.focus();
      return;
    }

    if (ev.target.closest('[data-cancel]')) {
      const holder = ev.target.closest('[data-name]');
      revert(holder);
      ctx.editingKey = null;
      paint(ctx);
      return;
    }

    // ---- 存起來 ----
    //
    // **按了才寫。** 以前這裡是 `focusout` 就存，而就地展開之後焦點會在
    // 兩個輸入框之間跳 —— 那會存兩次，稽核紀錄上多一筆什麼都沒改的紀錄
    // （SPEC 第 6.2 節：每一次寫入都留 before / after）。
    if (!ev.target.closest('[data-save]')) return;
    const holder = ev.target.closest('[data-name]');
    const hit = holder && apply(holder);
    if (!hit) return;

    try {
      await toast.withSaveState(
        () => config.update(hit.type, hit.id, {
          shortName: hit.row.shortName,
          ...(hit.hasLine ? { lineName: hit.row.lineName } : {}),
        }),
        { success: '改好了', key: `naming:${hit.type}:${hit.id}` },
      );
      // 存成功了，這一份就是新的原值
      ctx.saved.set(`${hit.type}:${hit.id}`, {
        shortName: hit.row.shortName, lineName: hit.row.lineName,
      });
      ctx.editingKey = null;
      paint(ctx);
    } catch {
      /* 已處理 —— 那一列留在展開的狀態，她改的字還在 */
    }
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
