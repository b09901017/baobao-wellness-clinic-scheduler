// 備忘錄／SOP：清單、閱讀、編輯。
//
// 她要的：「UIUX 可以很好的，很精心的設計流暢，閱讀舒適度的排版，沉浸式，
// 絲滑的感覺」，而且「在手機版可一鍵隨時查閱，不需要變成打勾任務」。
//
// ## 這一頁的簽名是那條脊線
//
// 她的筆記本來就是**分階段**的（前情提醒 → 當天 → 結束），而那個順序是真的
// 資訊，不是排版。所以標了時機的那幾節畫在一條由深到淺的細線上，一節一個節點
// —— 讀下來就是一次來訪從頭到尾的樣子。
//
// **一節時機都沒標的那一份不畫脊線**（復健科流程就是那種：一串平的清單）。
// 結構要能講出內容的真話，講不出來就不要畫 —— 每一份都有一條線的話，
// 那條線就只是裝飾。
//
// ## 沒有勾選框、沒有進度、沒有百分比
//
// 一放勾選框它就變成第二個待辦中心，而她指名「不需要變成打勾任務」（ADR-0067）。
//
// ## 動畫就四個，一個新的 token 都不加
//
//   章節展開收合   grid-template-rows 0fr→1fr   --motion-base（剛剛發生了什麼）
//   按壓回饋       scale(.985) + 底色            --motion-fast（按到了沒）
//   清單分組進場   淡入上移，前四段各差 30ms      --motion-base
//   收合箭頭       旋轉 180°                     --motion-base
//
// `prefers-reduced-motion` 由 app.css 底部那一段對 `*` 生效，這裡不再寫一次；
// 也**絕對不要用 setTimeout 等動畫播完** —— 那條路繞得過那一段。
//
// 規則一條都不在這裡，全部在 domain/playbook.js。

import * as playbooksData from '../../data/playbooks.js';
import * as config from '../../data/config.js';
import {
  normalize, validatePlaybook, linesOf, groupByTag, tagsOf, matches,
  whensOf, whenLabel,
  SECTION_WHEN, BLANK_SECTION, MAX_SECTIONS, MAX_TITLE, MAX_TAG, MAX_BODY,
} from '../../domain/playbook.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { icon } from '../icons.js';
import { pushScreen } from '../nav.js';
import { go } from '../router.js';
import * as toast from '../toast.js';

const esc = f.esc;

/**
 * 清單頁的看法。**存在模組裡不進網址** —— 它是看法，不是位置
 *（同待辦中心的「照人／照流程」）。
 */
let view = { search: '', tag: null };

/** 閱讀頁上哪幾節被收起來了。換一份就忘掉 —— 她打開一份是要從頭讀的。 */
let collapsed = new Set();

// ---------------------------------------------------------------------------
// 清單
// ---------------------------------------------------------------------------

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let rows;
  try {
    // fresh：從別的地方存完回來要看到新的那一份
    rows = await playbooksData.list({ fresh: true });
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore Rules 還沒部署。</p></div>`;
    return;
  }

  paintList(el, rows);
}

function paintList(el, rows) {
  const tags = tagsOf(rows);

  el.innerHTML = `
    <div class="page">
      <div class="page__row">
        <h1 class="page__title">備忘錄 / SOP</h1>
        <span class="footlinks footlinks--inline">
          <button class="footlink" type="button" data-new>寫一份</button>
        </span>
      </div>
      <p class="page__lead">你自己整理的流程與心得。不會變成要勾的待辦，隨時翻得到。</p>
    </div>

    ${rows.length ? `
      <label class="field" style="margin-bottom: var(--space-2)">
        <span class="visually-hidden">找一份備忘錄</span>
        <input type="text" data-search value="${esc(view.search)}" style="width: 100%"
               placeholder="找一份：標題、分類、內容" />
      </label>

      ${tags.length ? `
        <div class="chiprow noscroll-bar" role="group" aria-label="分類">
          <button class="chip chip--sm" type="button" data-tag=""
                  aria-pressed="${view.tag === null}">全部</button>
          ${tags.map((t) => `
            <button class="chip chip--sm" type="button" data-tag="${esc(t)}"
                    aria-pressed="${view.tag === t}">${esc(t)}</button>`).join('')}
        </div>` : ''}

      <div data-groups>${groupsHtml(rows)}</div>` : emptyHtml()}`;

  wireList(el, rows);
}

function emptyHtml() {
  return `
    <section class="card">
      <h2 class="card__title">還沒有備忘錄</h2>
      <p class="muted">把你自己的流程寫下來 —— 點滴當天要檢查什麼、外檢要帶哪幾張單子、
        復健科在哪一層樓報到。它不會變成要勾的待辦，只是隨時翻得到。</p>
      <p class="muted">寫的時候可以幫每一節標一個時機（事前／當天／結束後）。
        標了的那一節，會在日曆上點開那一筆來訪時自己浮出來。</p>
      <p><button class="btn btn--primary" type="button" data-new>寫第一份</button></p>
    </section>`;
}

function groupsHtml(rows) {
  const shown = rows.filter(
    (p) => matches(p, view.search) && (view.tag === null || (p.tag ?? null) === view.tag),
  );
  if (!shown.length) {
    return '<p class="muted">沒有符合的。換個字，或把上面的分類切回「全部」。</p>';
  }

  return groupByTag(shown)
    .filter((g) => g.rows.length)
    // 進場的階梯只給前四段 —— 再往下她已經在捲了，整頁都在動反而礙事
    .map((g, i) => `
      <div class="pbgroup" style="--i: ${Math.min(i, 3)}">
        <div class="section">
          <h2 class="section__title">${esc(g.tag)}</h2>
          <span class="section__n">${g.rows.length}</span>
        </div>
        ${g.rows.map(cardHtml).join('')}
      </div>`)
    .join('');
}

function cardHtml(p) {
  // 一張卡兩行：標題（她在掃的東西）與一行淡字。**節數不印** ——
  // 「有 4 節」回答不了任何問題。
  const whens = whensOf(p).join('・');
  return `
    <a class="card pbcard" href="#/playbook/${esc(p.id)}">
      <span class="pbcard__main">
        <span class="pbcard__title">
          ${p.pinned ? `<span class="pbcard__pin" aria-label="常看的">${icon('manual', { size: 15 })}</span>` : ''}
          ${esc(p.title ?? '（沒有標題）')}
        </span>
        <span class="pbcard__meta">${esc(whens)}</span>
      </span>
      ${icon('right', { size: 18 })}
    </a>`;
}

function wireList(el, rows) {
  const repaintGroups = () => {
    const box = el.querySelector('[data-groups]');
    if (box) box.innerHTML = groupsHtml(rows);
  };

  // input 而不是 change：她打完直接點下一個東西時，change 還沒發出去（iOS 尤其）
  el.querySelector('[data-search]')?.addEventListener('input', (e) => {
    view.search = e.target.value;
    repaintGroups();
  });

  // 選了一顆丸子**只改 aria-pressed 與底下那一塊**，不重畫整頁（ADR-0038）
  el.querySelector('.chiprow')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    view.tag = btn.dataset.tag || null;
    el.querySelectorAll('[data-tag]').forEach((b) =>
      b.setAttribute('aria-pressed', String((b.dataset.tag || null) === view.tag)));
    repaintGroups();
  });

  el.querySelectorAll('[data-new]').forEach((btn) =>
    btn.addEventListener('click', () => openEditor(el, null)));
}

// ---------------------------------------------------------------------------
// 閱讀
// ---------------------------------------------------------------------------

export async function renderOne(el, id) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let playbook;
  let courses;
  try {
    [playbook, courses] = await Promise.all([
      playbooksData.get(id),
      config.listAll('courses', { includeDeleted: true }),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  if (!playbook) {
    el.innerHTML = `
      <a class="backlink" href="#/playbook">${icon('left', { size: 17 })}備忘錄</a>
      <div class="card"><p>找不到這一份。可能被刪掉了 ——
        設定 → 已刪除項目裡還原得回來。</p></div>`;
    return;
  }

  collapsed = new Set();
  paintRead(el, { id, playbook, courses });
}

/** 這一份現在的樣子。標題底下那一行淡字用。 */
function metaLine(playbook, courses) {
  const names = (playbook.courseIds ?? [])
    .map((cid) => courses.find((c) => c.id === cid)?.name)
    .filter(Boolean);
  return [playbook.tag, names.join('、')].filter(Boolean).join('　·　');
}

function paintRead(el, ctx) {
  const { playbook, courses } = ctx;
  // 有任何一節標了時機，這一份就是一條線；一節都沒標的是一串平的清單。
  // **結構要講得出內容的真話** —— 每一份都畫一條線的話，那條線只是裝飾。
  const staged = (playbook.sections ?? []).some((s) => s.when);
  const meta = metaLine(playbook, courses);

  el.innerHTML = `
    <a class="backlink" href="#/playbook">${icon('left', { size: 17 })}備忘錄</a>

    <article class="pb">
      <header class="pb__head">
        <div class="pb__headmain">
          <h1 class="pb__title">${esc(playbook.title ?? '（沒有標題）')}</h1>
          ${meta ? `<p class="pb__meta">${esc(meta)}</p>` : ''}
        </div>
        <button class="btn btn--sm" type="button" data-edit>編輯</button>
      </header>

      <div class="pb__sections ${staged ? 'pb__sections--staged' : ''}">
        ${(playbook.sections ?? []).map((s, i) => sectionHtml(s, i, staged)).join('')}
      </div>
    </article>`;

  wireRead(el, ctx);
}

function sectionHtml(section, i, staged) {
  const open = !collapsed.has(i);
  const lines = linesOf(section);
  const label = section.heading || (staged ? whenLabel(section.when) : `第 ${i + 1} 節`);

  return `
    <section class="pbsec">
      ${staged ? '<span class="pbsec__dot" aria-hidden="true"></span>' : ''}
      <button class="pbsec__head" type="button" data-toggle="${i}" aria-expanded="${open}">
        <span class="pbsec__labels">
          ${staged && section.when
            ? `<span class="pbsec__when">${esc(whenLabel(section.when))}</span>` : ''}
          <span class="pbsec__heading">${esc(label)}</span>
        </span>
        <span class="pbsec__chev" aria-hidden="true">${icon('down', { size: 17 })}</span>
      </button>
      <div class="pbsec__wrap">
        <div class="pbsec__body">
          <ul class="pblines">
            ${lines.map((line) => `<li>${esc(line)}</li>`).join('')}
          </ul>
        </div>
      </div>
    </section>`;
}

function wireRead(el, ctx) {
  // 委派掛在那一塊上，不掛在整頁的 el 上 —— 那個節點每次重畫都會被換掉，
  // 所以沒有人需要記得拆它（tests/layering.test.js 盯著）。
  el.querySelector('.pb__sections')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (!btn) return;
    const i = Number(btn.dataset.toggle);
    if (collapsed.has(i)) collapsed.delete(i);
    else collapsed.add(i);
    // **只改那一顆的 aria-expanded**，CSS 接手動畫。重畫整塊會讓所有節
    // 一起閃一下，而她只點了一節（ADR-0038）。
    btn.setAttribute('aria-expanded', String(!collapsed.has(i)));
  });

  el.querySelector('[data-edit]')?.addEventListener('click', () => openEditor(el, ctx));
}

// ---------------------------------------------------------------------------
// 編輯
// ---------------------------------------------------------------------------

/**
 * 開一張編輯表單。
 *
 * `ctx` 是 null 代表新增。**原地換掉整頁不換網址**（ADR-0048）：
 * `pushScreen()` 讓返回鍵退得回閱讀模式，而不是整個離開這一份。
 */
async function openEditor(el, ctx) {
  const [all, courses] = await Promise.all([
    playbooksData.list().catch(() => []),
    config.listAll('courses').catch(() => []),
  ]);

  const source = ctx?.playbook;
  const draft = source
    ? {
      title: source.title ?? '',
      tag: source.tag ?? '',
      courseIds: [...(source.courseIds ?? [])],
      pinned: source.pinned === true,
      sections: (source.sections ?? []).map((s) => ({ ...s })),
    }
    : {
      title: '', tag: '', courseIds: [], pinned: false, sections: [{ ...BLANK_SECTION }],
    };

  paintEdit(el, {
    ...(ctx ?? {}), el, courses, tags: tagsOf(all), draft, isNew: !ctx,
  });
}

function paintEdit(el, ectx) {
  const { draft, courses, tags, isNew } = ectx;

  el.innerHTML = `
    <a class="backlink" href="#" data-back>${icon('left', { size: 17 })}${
      isNew ? '備忘錄' : esc(ectx.playbook.title ?? '備忘錄')}</a>

    <section class="card">
      <h2 class="card__title">${isNew ? '寫一份備忘錄' : '編輯'}</h2>
      <div class="errors" data-errors hidden></div>

      <form data-form>
        ${f.text({
          name: 'title', label: '標題', value: draft.title,
          placeholder: '營養點滴', maxlength: MAX_TITLE,
        })}

        ${f.text({
          name: 'tag', label: '分類', value: draft.tag,
          placeholder: '點滴', maxlength: MAX_TAG,
          hint: '選填。清單上會照分類分組，沒填的收在「沒有分類」那一組。',
        })}
        ${tags.length ? `
          <div class="chiprow noscroll-bar" role="group" aria-label="已經有的分類"
               style="margin: calc(var(--space-2) * -1) 0 var(--space-3)">
            ${tags.map((t) => `
              <button class="chip chip--sm" type="button" data-usetag="${esc(t)}">${esc(t)}</button>`).join('')}
          </div>` : ''}

        ${f.chips({
          name: 'courseIds', label: '掛哪些課程', value: draft.courseIds, multi: true, quiet: true,
          options: courses.map((c) => ({ value: c.id, label: c.name })),
          hint: '選填。掛了之後，日曆上點開那一筆來訪就會浮出對應時機的那一節。'
            + '外檢這種系統裡沒有的項目不用掛，寫在標題就好。',
        })}

        ${f.toggle({
          name: 'pinned', label: '釘在清單最上面', value: draft.pinned,
          hint: '常看的那幾份。釘起來會自成一組排在最前面。',
        })}

        <div class="fieldgroup">
          <span class="fieldgroup__label">章節　一行就是一件事</span>
          <div data-sections>${sectionsEditHtml(draft)}</div>
          <p>
            <button class="btn btn--sm" type="button" data-add
                    ${draft.sections.length >= MAX_SECTIONS ? 'disabled' : ''}>
              ${icon('plus', { size: 15 })} 加一節</button>
          </p>
        </div>

        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>

    ${isNew ? '' : `
      <section class="card">
        <h2 class="card__title">刪掉這一份</h2>
        <p class="muted">刪除只是標記，設定 → 已刪除項目裡還原得回來。</p>
        <p><button class="btn btn--danger" type="button" data-delete>刪掉</button></p>
      </section>`}`;

  wireEdit(el, ectx);
}

function sectionsEditHtml(draft) {
  return draft.sections
    .map((s, i) => `
      <div class="pbedit" data-sec="${i}">
        <div class="pbedit__bar">
          <span class="pbedit__n num">${i + 1}</span>
          <select class="pbedit__when" data-when="${i}" aria-label="第 ${i + 1} 節的時機">
            ${SECTION_WHEN.map((w) => `
              <option value="${w.id ?? ''}" ${(s.when ?? null) === w.id ? 'selected' : ''}>
                ${esc(w.label)}</option>`).join('')}
          </select>
          <input class="pbedit__heading" type="text" data-heading="${i}"
                 value="${esc(s.heading ?? '')}" placeholder="這一節叫什麼（選填）"
                 aria-label="第 ${i + 1} 節的標題" />
          <span class="pbedit__tools">
            <button class="pbedit__btn" type="button" data-move="${i}" data-dir="-1"
                    aria-label="往上移" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="pbedit__btn" type="button" data-move="${i}" data-dir="1"
                    aria-label="往下移" ${i === draft.sections.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="pbedit__btn pbedit__btn--danger" type="button" data-drop="${i}"
                    aria-label="刪掉這一節">${icon('close', { size: 15, width: 2 })}</button>
          </span>
        </div>
        <textarea class="pbedit__body" data-body="${i}" rows="5"
                  maxlength="${MAX_BODY}" aria-label="第 ${i + 1} 節的內容"
                  placeholder="一行寫一件事&#10;飯後打針（通知客人）&#10;預約系統註記">${esc(s.body ?? '')}</textarea>
      </div>`)
    .join('');
}

function wireEdit(el, ectx) {
  const { draft, isNew } = ectx;
  const form = el.querySelector('[data-form]');

  // 原地換掉整頁 → 疊一層，返回鍵退得回閱讀模式而不是離開這一份（ADR-0048）
  const leave = pushScreen('playbook-edit', () =>
    (isNew ? render(el) : paintRead(el, ectx)));
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    leave();
  });
  el.querySelector('[data-cancel]').addEventListener('click', leave);

  f.wireChips(form);

  /**
   * 把畫面上還沒送出的字收回 draft。
   *
   * **任何一次結構改動（加一節、上下移、刪掉）之前都要先跑一次** ——
   * 那幾個動作會重畫章節那一塊，而重畫會把她剛打到一半的字丟掉。
   */
  const harvest = () => {
    const box = el.querySelector('[data-sections]');
    if (!box) return;
    box.querySelectorAll('[data-sec]').forEach((row) => {
      const i = Number(row.dataset.sec);
      if (!draft.sections[i]) return;
      draft.sections[i].heading = row.querySelector('[data-heading]')?.value ?? '';
      draft.sections[i].body = row.querySelector('[data-body]')?.value ?? '';
      const when = row.querySelector('[data-when]')?.value ?? '';
      draft.sections[i].when = when || null;
    });
  };

  const repaintSections = () => {
    const box = el.querySelector('[data-sections]');
    if (box) box.innerHTML = sectionsEditHtml(draft);
    el.querySelector('[data-add]')?.toggleAttribute(
      'disabled', draft.sections.length >= MAX_SECTIONS,
    );
  };

  el.querySelector('[data-sections]').addEventListener('click', (e) => {
    const move = e.target.closest('[data-move]');
    const drop = e.target.closest('[data-drop]');
    if (!move && !drop) return;

    harvest();
    if (move) {
      const i = Number(move.dataset.move);
      const to = i + Number(move.dataset.dir);
      if (to < 0 || to >= draft.sections.length) return;
      [draft.sections[i], draft.sections[to]] = [draft.sections[to], draft.sections[i]];
    } else {
      draft.sections.splice(Number(drop.dataset.drop), 1);
      if (!draft.sections.length) draft.sections.push({ ...BLANK_SECTION });
    }
    repaintSections();
  });

  el.querySelector('[data-add]')?.addEventListener('click', () => {
    harvest();
    if (draft.sections.length >= MAX_SECTIONS) return;
    draft.sections.push({ ...BLANK_SECTION });
    repaintSections();
    // 加完之後游標落在新的那一格 —— 她按「加一節」就是要打字
    el.querySelector(`[data-body="${draft.sections.length - 1}"]`)?.focus();
  });

  // 分類的丸子只是把字填進去，不是另一個欄位 —— 她照樣可以打一個新的
  el.querySelector('[data-usetag]')?.closest('.chiprow')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-usetag]');
    if (!btn) return;
    const input = form.elements.tag;
    input.value = btn.dataset.usetag;
    input.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    harvest();
    const v = f.readForm(form);
    const next = normalize({
      title: v.title,
      tag: v.tag,
      courseIds: f.splitMulti(v.courseIds),
      pinned: v.pinned === true,
      sections: draft.sections,
    });

    const errors = validatePlaybook(next);
    f.showErrors(el, errors);
    if (errors.length) return;

    try {
      // key 一定要傳：連點兩下會送兩次，而第二次會多建一份
      // （tests/save-guards.test.js 掃得出漏掉的）
      const id = await toast.withSaveState(
        () => (isNew
          ? playbooksData.create(next)
          : playbooksData.update(ectx.id, next).then(() => ectx.id)),
        { success: '存起來了', key: `playbook:save:${ectx.id ?? 'new'}` },
      );

      if (isNew) {
        go(`/playbook/${id}`);
        return;
      }

      // **改既有的那一份不可以靠 `go()`** —— 網址沒有變（本來就在這一份上），
      // 而 `go()` 對相同的網址直接 return，於是編輯表單留在畫面上，
      // 而她剛剛才看到「存起來了」。
      //
      // 走 `leave()`：它退掉那一層（返回鍵的紀錄跟著收乾淨）並重畫閱讀模式。
      // 先把手上這一份換成剛存進去的樣子，那一次重畫就不用再讀一次網路。
      ectx.playbook = { ...ectx.playbook, ...next };
      leave();
    } catch {
      /* withSaveState 已顯示錯誤與重試 */
    }
  });

  el.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmAction({
      title: `刪掉「${ectx.playbook.title}」？`,
      consequences: [
        '它會從備忘錄清單上消失',
        '掛在課程上的那幾個地方也不會再浮出來',
        '設定 → 已刪除項目裡還原得回來',
      ],
      confirmLabel: '刪掉',
      danger: true,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => playbooksData.remove(ectx.id, '在備忘錄裡刪掉'), {
        success: '刪掉了', key: `playbook:remove:${ectx.id}`,
      });
      go('/playbook');
    } catch {
      /* 已處理 */
    }
  });
}
