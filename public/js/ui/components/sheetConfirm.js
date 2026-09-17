// 拍療程單的確認層（issue 14，ADR-0105）。
//
// 她 2026-09-17：「我拍照或是上傳照片，可以先辨識這是誰，然後和之前的比如果是新增的話那就替換掉那張照片，
// 如果是不同的，那就新增照片」。
//
// **從療程單那一頁往上長出來的一層**（`pushLayer()`，不換網址），外殼借拍 Abovee 那一層（`.abl`）——
// 同一種「從頁面長出來、收起來回到原地」的一層，不另做第二種。
// 一張照片一張卡：是誰、哪一個課程、是新的一張還是哪一張的新版、每一列。每一格旁邊看得到照片上的原字
// （`seen.js`）：2026-09-17 考試療程單的日期 54/62、勾的器材 15/18、姓名 8/11，都要她看過。
//
// 規則全部在 `domain/treatmentSheets.js`（翻譯、補年份、同一張的判斷），寫入在 `data/treatmentSheets.js`。
// **「同一張還是新的一張」是 `sameSheet()` 算的**，她可以改；AI 從頭到尾沒有那一格（ADR-0099）。
//
// 照片只有她按「存」之後才離開這台裝置去 Storage；辨識出來的字不存草稿，收起來就沒了（ADR-0101）。
// 屬性名一律 `data-tsc-*`（共用元件不用頁面身上的名字）。

import * as sheetsData from '../../data/treatmentSheets.js';
import {
  MAX_PHOTO_BYTES, readSheet, rowsAdded, sheetFields, sheetLabel, validateSheet, withMatch,
} from '../../domain/treatmentSheets.js';
import { needsForm } from '../../domain/visits.js';
import { normalizeName } from '../../domain/identify.js';
import { shortDate } from '../../domain/dates.js';
import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import * as toast from '../toast.js';
import { chooseAction } from './dialog.js';
import { esc } from './form.js';
import { shrinkPhoto } from './photo.js';
import { seenChip, wireSeen } from './seen.js';

/** 認不得人的那幾種，畫面上講一句為什麼（ADR-0103）。 */
const WHY_UNKNOWN = {
  numberOnly: '客戶編號對上了，名字不一樣 —— 是這一位嗎？',
  conflict: '名字跟客戶編號指到不同的人，選一位',
  ambiguous: '同名的有好幾位，選一位',
  none: '認不出是哪一位，找一下',
};

const live = (rows) => (rows ?? []).filter((r) => r && !r.deletedAt && r.active !== false);
const uniq = (list) => [...new Set(list)];

/**
 * @param {object} o
 * @param {{url: string, blob: Blob, transcript: object}[]} o.photos 拍照那一層辨識好的
 * @param {Function} o.release 收掉照片網址
 * @param {{customers: object[], master: {courses, equipment, ivProducts}, sheets: object[], today: string}} o.ctx
 *   `sheets`：全部客戶還沒刪的療程單
 * @param {(summary: {saved: number}) => void} [o.onFinish]
 */
export function openSheetConfirm({ photos, release, ctx: given, onFinish }) {
  const ctx = { ...given, sheets: [...(given.sheets ?? [])] };
  const courses = live(ctx.master.courses).filter((c) => needsForm(c));
  let closed = false;
  let savedCount = 0;

  const cards = photos.map((p, i) => ({
    key: `p${i}`,
    photo: p,
    draft: readSheet(p.transcript, ctx),
    picked: false,
    finding: false,
    allCourses: false,
    query: '',
    openRow: null,
    state: 'open',
  }));

  const root = document.createElement('div');
  root.className = 'abl tsl';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '療程單');
  root.innerHTML = `
    <header class="abl__head">
      <button class="abl__close" type="button" data-tsc-close aria-label="收起">${icon('close', { size: 20, width: 2 })}</button>
      <div class="abl__heading">
        <h2 class="abl__title">療程單</h2>
        <p class="abl__sum" data-tsc-sum></p>
      </div>
    </header>
    <div class="abl__body" data-tsc-body></div>`;
  document.body.append(root);
  document.body.classList.add('has-abl');
  requestAnimationFrame(() => root.classList.add('abl--in'));

  let layer = pushLayer(() => requestClose({ fromBack: true }));

  // ---------- 畫 ----------

  function paintSummary() {
    const left = cards.filter((c) => c.state !== 'saved').length;
    root.querySelector('[data-tsc-sum]').textContent = [
      `${cards.length} 張`,
      savedCount ? `存好 ${savedCount} 張` : '',
      left && savedCount ? `還有 ${left} 張` : '',
    ].filter(Boolean).join('・');
  }

  function paintAll() {
    root.querySelector('[data-tsc-body]').innerHTML = cards.map((c) => cardHtml(c)).join('');
    paintSummary();
  }

  function repaint(card) {
    const el = [...root.querySelectorAll('[data-tsc-card]')].find((x) => x.dataset.tscCard === card.key);
    if (!el) return;
    const holder = document.createElement('template');
    holder.innerHTML = cardHtml(card).trim();
    el.replaceWith(holder.content.firstElementChild);
    paintSummary();
  }

  const customerOf = (id) => ctx.customers.find((c) => c.id === id) ?? null;
  const sheetsOf = (customerId) => ctx.sheets.filter((s) => s.customerId === customerId && !s.deletedAt);

  function cardHtml(card) {
    const { draft, photo } = card;
    const who = customerOf(draft.customerId);
    const label = sheetLabel(draft, ctx.master) || '還沒選課程';
    const replacing = ctx.sheets.find((s) => s.id === draft.replaces) ?? null;

    if (card.state === 'saved') {
      return `
        <article class="tsc tsc--saved" data-tsc-card="${card.key}">
          <div class="tsc__top">
            ${photoButton(photo)}
            <div class="tsc__heading">
              <p class="tsc__who">${esc(who?.name ?? '')}</p>
              <p class="tsc__what">${esc(label)}</p>
            </div>
            <span class="tsc__tag tsc__tag--ok">${icon('check', { size: 13, width: 2.6 })}${replacing ? '換好了' : '存好了'}</span>
          </div>
        </article>`;
    }

    const errors = validateSheet(draft);
    const busy = card.state === 'saving';
    return `
      <article class="tsc" data-tsc-card="${card.key}">
        <div class="tsc__top">
          ${photoButton(photo)}
          <div class="tsc__heading">
            <p class="tsc__who">${esc(who?.name ?? '還不知道是誰')}</p>
            <p class="tsc__what">${esc(label)}</p>
          </div>
          <span class="tsc__tag${replacing ? ' tsc__tag--new' : ''}">${esc(replacing ? '新版' : '新的一張')}</span>
        </div>

        ${whoHtml(card, who)}
        ${courseHtml(card)}
        ${draft.customerId ? kindHtml(card, replacing) : ''}
        ${rowsHtml(card)}

        ${errors.length ? `<ul class="tsc__problems">${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${card.message ? `<p class="tsc__fail" role="alert">${esc(card.message)}</p>` : ''}
        <button class="btn btn--primary tsc__save" type="button" data-tsc-save
                ${errors.length || busy ? 'disabled' : ''}>${busy ? '存檔中…' : (replacing ? '換掉那一張的照片' : '存這一張')}</button>
      </article>`;
  }

  function photoButton(photo) {
    return `<button class="tsc__photo" type="button" data-seen-text="" data-seen-photo="${esc(photo.url)}"
              aria-label="看這一張照片"><img src="${esc(photo.url)}" alt="" /></button>`;
  }

  function part(label, body, extra = '') {
    return `
      <section class="tsc__part">
        <span class="tsc__label">${esc(label)}</span>
        ${body}
        ${extra}
      </section>`;
  }

  function chips(list, extra = '') {
    return `<span class="tsc__chips">${list.map((c) => `
      <button class="chip chip--sm" type="button" ${c.attr}="${esc(c.value)}" aria-pressed="${Boolean(c.on)}">${esc(c.label)}${
  c.sub ? `<span class="chip__note">${esc(c.sub)}</span>` : ''}</button>`).join('')}${extra}</span>`;
  }

  function whoHtml(card, who) {
    const { draft } = card;
    const seen = seenChip(draft.seenName, { photo: card.photo.url });
    const how = draft.who.how;
    // 認得（名字與編號都對上、或只有名字而那一位身上沒有編號）：一行，旁邊一顆「換一位」
    if (who && !card.finding) {
      return part('是誰', `
        <span class="tsc__line">${seen}
          <button class="btn btn--sm btn--ghost" type="button" data-tsc-find>換一位</button></span>`);
    }
    return part('是誰', `
      <span class="tsc__line">${seen}</span>
      ${!who && how ? `<p class="tsc__say">${esc(WHY_UNKNOWN[how] ?? '')}</p>` : ''}
      <span data-tsc-found>${whoChips(card)}</span>
      <label class="tsc__find">
        <span class="visually-hidden">找一位客戶</span>
        <input type="search" data-tsc-query value="${esc(card.query)}" placeholder="打名字找" autocomplete="off" />
      </label>`);
  }

  /** 候選（認人給的）＋ 她打字找到的。**只換這一塊**：重畫整張卡會把輸入框換掉，中文選字打到一半就斷了。 */
  function whoChips(card) {
    const found = card.query ? findCustomers(card.query) : [];
    const pool = uniq([...(card.draft.who.candidates ?? []), ...found]).slice(0, 8);
    return pool.length
      ? chips(pool.map((c) => ({ attr: 'data-tsc-who', value: c.id, label: c.name, on: card.draft.customerId === c.id })))
      : '';
  }

  function findCustomers(q) {
    const want = normalizeName(q);
    if (!want) return [];
    return live(ctx.customers).filter((c) => normalizeName(c.name).includes(want)).slice(0, 6);
  }

  function courseHtml(card) {
    const { draft } = card;
    const seen = seenChip(draft.courseText, { photo: card.photo.url });
    // 認出來了就只畫選好的那幾顆＋「其他課程」：十幾顆課程一字排開，她要找的那一顆反而看不到
    const shown = draft.courseIds.length && !card.allCourses
      ? courses.filter((c) => draft.courseIds.includes(c.id))
      : courses;
    const more = shown.length < courses.length
      ? '<button class="chip chip--sm chip--more" type="button" data-tsc-allcourses>其他課程</button>' : '';
    const rows = [chips(shown.map((c) => ({
      attr: 'data-tsc-course', value: c.id, label: c.name, on: draft.courseIds.includes(c.id),
    })), more)];
    // 營養點滴一款一張：品項選得到，不選也存得下去（比對時就不分品項）
    const drip = draft.courseIds.map((id) => courses.find((c) => c.id === id)).some((c) => c?.requiresIvProduct);
    if (drip) {
      rows.push(`<span class="tsc__sublabel">品項</span>${chips(live(ctx.master.ivProducts).map((p) => ({
        attr: 'data-tsc-iv', value: p.id, label: p.name, on: (draft.ivProductIds ?? []).includes(p.id),
      })))}`);
    }
    return part('課程', `${seen ? `<span class="tsc__line">${seen}</span>` : ''}${rows.join('')}`);
  }

  function kindHtml(card, replacing) {
    const { draft } = card;
    const mine = sheetsOf(draft.customerId)
      .filter((s) => (s.courseIds ?? []).some((id) => draft.courseIds.includes(id)) || s.id === draft.replaces);
    const options = [
      { attr: 'data-tsc-kind', value: '', label: '新的一張', on: !draft.replaces },
      ...mine.map((s) => {
        const n = rowsAdded(s, draft);
        return {
          attr: 'data-tsc-kind',
          value: s.id,
          label: `${sheetLabel(s, ctx.master)}${firstDate(s) ? `（${shortDate(firstDate(s))} 起）` : ''}的新版`,
          sub: n > 0 ? `多了 ${n} 列` : (n < 0 ? `少了 ${-n} 列` : '列數一樣'),
          on: draft.replaces === s.id,
        };
      }),
    ];
    // **會改變寫進去的東西**，常駐不收進 ?：換掉哪一張、舊照片會被刪
    const warn = [];
    if (replacing && draft.suggested !== replacing.id) {
      warn.push('這一張的前幾列跟那一張對不上。換下去會用這一張的列蓋掉那一張，舊照片會刪掉。');
    }
    if (replacing && rowsAdded(replacing, draft) < 0) {
      warn.push(`這一次讀到的比上次少 ${-rowsAdded(replacing, draft)} 列，存下去以這一次為準。`);
    }
    if (replacing && !warn.length) warn.push('存下去會換掉那一張的照片，舊的那張照片會刪掉（有紙本正本）。');
    return part('這是', chips(options), warn.map((w) => `<p class="tsc__warn">${esc(w)}</p>`).join(''));
  }

  const firstDate = (sheet) => (sheet.rows ?? []).map((r) => r.date).filter(Boolean).sort()[0] ?? null;

  function equipmentOptions(draft) {
    return live(ctx.master.equipment).filter((e) => draft.courseIds.includes(e.courseId));
  }

  function rowsHtml(card) {
    const { draft } = card;
    const eqs = equipmentOptions(draft);
    const signed = draft.rows.filter((r) => r.signed).length;
    const items = draft.rows.map((r, i) => {
      const open = card.openRow === i;
      const eqNames = (r.equipmentIds ?? [])
        .map((id) => live(ctx.master.equipment).find((e) => e.id === id))
        .filter(Boolean).map((e) => e.shortName || e.name).join('＋');
      const [y, m, d] = String(r.date ?? '').split('-');
      return `
        <li class="tsr${open ? ' is-open' : ''}${r.date ? '' : ' tsr--nodate'}" data-tsc-row="${i}">
          <div class="tsr__line">
            <button class="tsr__main" type="button" data-tsc-rowopen aria-expanded="${open}">
              <span class="tsr__seq">${esc(r.seq)}</span>
              <span class="tsr__date">${r.date ? `${Number(m)}/${Number(d)}<small>${esc(y)}</small>` : '沒有日期'}</span>
              <span class="tsr__sign${r.signed ? ' is-on' : ''}">${r.signed ? '有簽' : '沒簽'}</span>
              <span class="tsr__eq">${esc(eqNames)}</span>
            </button>
            ${seenChip(r.dateText, { photo: card.photo.url })}
          </div>
          ${open ? `
            <div class="tsr__edit">
              <label class="tsr__field"><span>日期</span>
                <input type="date" data-tsc-date value="${esc(r.date ?? '')}" /></label>
              ${r.yearFrom === 'photo' ? '<p class="tsc__say">單子上沒有寫年，年份是照拍照那天往回推的。</p>' : ''}
              ${chips([
    { attr: 'data-tsc-signed', value: 'yes', label: '有簽', on: r.signed },
    { attr: 'data-tsc-signed', value: 'no', label: '沒簽', on: !r.signed },
  ])}
              ${eqs.length ? `<span class="tsc__sublabel">勾的是${r.seenEquipment ? ` ${seenChip(r.seenEquipment, { photo: card.photo.url })}` : ''}</span>
                ${chips(eqs.map((e) => ({ attr: 'data-tsc-eq', value: e.id, label: e.shortName || e.name, on: (r.equipmentIds ?? []).includes(e.id) })))}` : ''}
              <button class="btn btn--sm btn--ghost tsr__drop" type="button" data-tsc-droprow>拿掉這一列</button>
            </div>` : ''}
        </li>`;
    }).join('');
    return part(`${draft.rows.length} 列・有簽 ${signed} 列`,
      draft.rows.length ? `<ol class="tsr__list">${items}</ol>` : '<p class="tsc__say">照片上沒有讀到任何一列。</p>');
  }

  // ---------- 接線 ----------

  wireSeen(root);

  const cardOf = (el) => cards.find((c) => c.key === el.closest('[data-tsc-card]')?.dataset.tscCard) ?? null;
  const rematch = (card, { keepPick = card.picked } = {}) => {
    card.draft = withMatch(card.draft, ctx.sheets.filter((s) => !s.deletedAt), { keepPick });
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled || !root.contains(t)) return;
    if (t.matches('[data-tsc-close]')) { requestClose(); return; }
    const card = cardOf(t);
    if (!card || card.state !== 'open') return;
    const { draft } = card;

    if (t.matches('[data-tsc-save]')) { save(card); return; }
    if (t.matches('[data-tsc-allcourses]')) { card.allCourses = true; repaint(card); return; }
    if (t.matches('[data-tsc-find]')) { card.finding = true; repaint(card); focusQuery(card); return; }
    if (t.dataset.tscWho) {
      card.draft = { ...draft, customerId: t.dataset.tscWho };
      card.finding = false;
      card.picked = false;
      rematch(card, { keepPick: false });
      repaint(card);
      return;
    }
    if (t.dataset.tscCourse) {
      const id = t.dataset.tscCourse;
      const courseIds = draft.courseIds.includes(id) ? draft.courseIds.filter((x) => x !== id) : [...draft.courseIds, id];
      const stillDrip = courseIds.some((x) => courses.find((c) => c.id === x)?.requiresIvProduct);
      card.draft = { ...draft, courseIds, ivProductIds: stillDrip ? draft.ivProductIds : [] };
      rematch(card);
      repaint(card);
      return;
    }
    if (t.dataset.tscIv) {
      const id = t.dataset.tscIv;
      const on = (draft.ivProductIds ?? []).includes(id);
      card.draft = { ...draft, ivProductIds: on ? [] : [id] };
      rematch(card);
      repaint(card);
      return;
    }
    if (t.dataset.tscKind !== undefined) {
      card.draft = { ...draft, replaces: t.dataset.tscKind || null };
      card.picked = true;
      repaint(card);
      return;
    }

    const at = Number(t.closest('[data-tsc-row]')?.dataset.tscRow);
    if (!Number.isInteger(at)) return;
    const setRow = (next) => {
      card.draft = { ...draft, rows: draft.rows.map((r, i) => (i === at ? { ...r, ...next } : r)) };
      rematch(card);
      repaint(card);
    };
    if (t.matches('[data-tsc-rowopen]')) { card.openRow = card.openRow === at ? null : at; repaint(card); return; }
    if (t.dataset.tscSigned) { setRow({ signed: t.dataset.tscSigned === 'yes' }); return; }
    if (t.dataset.tscEq) {
      const ids = draft.rows[at].equipmentIds ?? [];
      setRow({ equipmentIds: ids.includes(t.dataset.tscEq) ? ids.filter((x) => x !== t.dataset.tscEq) : [...ids, t.dataset.tscEq] });
      return;
    }
    if (t.matches('[data-tsc-droprow]')) {
      card.draft = { ...draft, rows: draft.rows.filter((_, i) => i !== at) };
      card.openRow = null;
      rematch(card);
      repaint(card);
    }
  });

  root.addEventListener('change', (e) => {
    const input = e.target.closest('[data-tsc-date]');
    if (!input) return;
    const card = cardOf(input);
    const at = Number(input.closest('[data-tsc-row]')?.dataset.tscRow);
    if (!card || !Number.isInteger(at)) return;
    card.draft = {
      ...card.draft,
      rows: card.draft.rows.map((r, i) => (i === at ? { ...r, date: input.value || null, yearFrom: 'her' } : r)),
    };
    rematch(card);
    repaint(card);
  });

  // 找人：只換那一排丸子，不重畫整張卡（輸入框留著、選字不斷）
  const onQuery = (e) => {
    const input = e.target.closest('[data-tsc-query]');
    if (!input || e.isComposing) return;
    const card = cardOf(input);
    if (!card) return;
    card.query = input.value;
    const holder = input.closest('[data-tsc-card]')?.querySelector('[data-tsc-found]');
    if (holder) holder.innerHTML = whoChips(card);
  };
  root.addEventListener('input', onQuery);
  root.addEventListener('compositionend', onQuery);

  function focusQuery(card) {
    const el = [...root.querySelectorAll('[data-tsc-card]')].find((x) => x.dataset.tscCard === card.key);
    el?.querySelector('[data-tsc-query]')?.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key !== 'Escape' || document.querySelector('.dialog-backdrop, .seenview')) return;
    requestClose();
  }
  document.addEventListener('keydown', onKey);

  function onHash() { close({ fromBack: true }); }
  window.addEventListener('hashchange', onHash);

  // ---------- 存 ----------

  /** 送 AI 的那一張大於上限時再縮一次（通常不會：長邊 2000px 的紙大約 300～800KB）。 */
  async function keepable(blob) {
    if (blob.size <= MAX_PHOTO_BYTES) return blob;
    for (const [longEdge, quality] of [[1800, 0.78], [1500, 0.7]]) {
      // eslint-disable-next-line no-await-in-loop
      const { blob: smaller } = await shrinkPhoto(blob, { longEdge, quality });
      if (smaller.size <= MAX_PHOTO_BYTES) return smaller;
    }
    return blob;
  }

  async function save(card) {
    if (validateSheet(card.draft).length || card.state !== 'open') return;
    const existing = ctx.sheets.find((s) => s.id === card.draft.replaces) ?? null;
    const fields = sheetFields(card.draft, ctx);
    card.state = 'saving';
    card.message = '';
    repaint(card);

    try {
      const blob = await keepable(card.photo.blob);
      if (existing) {
        await toast.withSaveState(() => sheetsData.replace(existing, fields, blob), {
          success: `換好了 ${fields.customerName} 的 ${fields.courseName} 療程單`,
          key: `treatmentSheet:${card.key}`, undoable: false,
        });
      } else {
        await toast.withSaveState(() => sheetsData.create(fields, blob), {
          success: `存好了 ${fields.customerName} 的 ${fields.courseName} 療程單`,
          key: `treatmentSheet:${card.key}`, undoable: false,
        });
      }
      card.state = 'saved';
      savedCount += 1;
      // 同一批裡的下一張可能是同一張紙：重讀一次，下一張的「同一張」才算得到這一張
      try {
        ctx.sheets = await sheetsData.listAll();
        cards.filter((c) => c.state === 'open').forEach((c) => rematch(c));
      } catch {
        /* 讀不到就用手上那一份 */
      }
    } catch (err) {
      card.state = 'open';
      // 照片沒傳上去 → 文件沒動、舊照片還在（`data/treatmentSheets.js` 的順序）
      card.message = `${err?.message ?? '沒存起來'}。舊的那一張沒有動到。`;
      toast.hide();
    }
    if (closed) return;
    if (cards.every((c) => c.state === 'saved')) {
      close();
      toast.info(`存好了 ${savedCount} 張療程單`);
      return;
    }
    paintAll();
  }

  // ---------- 收起來 ----------

  async function requestClose({ fromBack = false } = {}) {
    if (closed) return true;
    const left = cards.filter((c) => c.state !== 'saved').length;
    if (left) {
      const pick = await chooseAction({
        title: `還有 ${left} 張沒存`,
        consequences: ['照片與辨識出來的字都不會留著，離開之後要重拍。'],
        choices: [
          { key: 'leave', label: '離開' },
          { key: 'stay', label: '留下來', tone: 'primary' },
        ],
      });
      if (pick !== 'leave') {
        if (fromBack && !closed) layer = pushLayer(() => requestClose({ fromBack: true }));
        return false;
      }
    }
    close({ fromBack });
    return true;
  }

  function close({ fromBack = false } = {}) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    if (!fromBack && layer.active) layer.pop();
    root.classList.remove('abl--in');
    document.body.classList.remove('has-abl');
    const done = () => root.remove();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setTimeout(done, 200);
    release?.();
    onFinish?.({ saved: savedCount });
  }

  paintAll();
  root.querySelector('[data-tsc-close]').focus({ preventScroll: true });
  return { close: () => requestClose() };
}
