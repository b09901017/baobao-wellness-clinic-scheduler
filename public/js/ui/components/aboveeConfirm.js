// 拍 Abovee 的確認層（issue 13，ADR-0104）。
//
// 她 2026-09-17：「一口氣新增很多來訪…版面可以好好用心的設計，畢竟這可能一次會新增很多，
// 有很多資訊，必須要能夠主次分明一目瞭然，要有層次感呼吸感…一樣可以微調…
// 要有沉浸感的不要有種分割感跳到另一個地方的感覺」。
//
// **從壓表那一頁往上長出來的一層**（`pushLayer()`，不換網址），返回鍵收起來。
// 一列一段：第一眼只有時間、客戶、那天做什麼、一個小標；點一列**原地展開**成幾排丸子。
// 要她看的那幾列排最前面；其餘照日期分組。
//
// 規則全部在 `domain/aboveeImport.js`（翻譯、分四種、組來訪、標成壓完），這一支只畫與接線。
// **這一層就是 ADR-0086 的第一道**（每一列展開看得到 warnings），存檔前只再問一次（ADR-0104）。
// 照片與辨識出來的字都不存（ADR-0101）：收起來就 `release()`。
//
// 屬性名一律 `data-abl-*`（共用元件不用頁面身上的名字）。

import * as visitsData from '../../data/visits.js';
import * as batchesData from '../../data/batches.js';
import * as config from '../../data/config.js';
import { examChoiceNote } from '../../domain/followups.js';
import {
  aboveeDatesIn, entitlementChoices, examChoices, needsAttention, picksOf, planAbovee, queueMarksAfter, readAbovee,
  resolveItem, summarizeAbovee,
} from '../../domain/aboveeImport.js';
import { aliasWrites, staffFrom } from '../../domain/abovee.js';
import { validateVisit, picksEquipment, assignsFor } from '../../domain/visits.js';
import { slotFromPicks } from '../../domain/slotDraft.js';
import {
  DOCTOR_ROLE, THERAPIST_ROLE, ivChoicesFor, orderedRoomSlots, picksDoctor, staffWithRole,
} from '../../domain/masterData.js';
import { slotName } from '../../domain/naming.js';
import { shortDate, monthLabel } from '../../domain/dates.js';
import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import * as toast from '../toast.js';
import { chooseAction, confirmAction } from './dialog.js';
import { esc } from './form.js';
import { tip } from './tip.js';
import { seenChip, wireSeen } from './seen.js';

const TAGS = {
  new: '新的', recorded: '已經記了', mismatch: '對不上', unknown: '認不得', saved: '記好了', cancelled: '已取消',
};

/** 認不得人的那幾種，畫面上講一句為什麼（ADR-0103）。 */
const WHY_UNKNOWN = {
  numberOnly: '病歷號對上了，名字不一樣 —— 是這一位嗎？',
  conflict: '名字跟病歷號指到不同的人，選一位',
  ambiguous: '同名的有好幾位，選一位',
  none: 'app 裡沒有這位客戶',
};

/**
 * @param {object} o
 * @param {{url: string, transcript: object}[]} o.photos 拍照那一層辨識好的（照拍的順序）
 * @param {Function} o.release 收掉照片網址
 * @param {{customers, entitlementsBy, visitsBy, master: {courses, equipment, rooms, staff, ivProducts}, today}} o.ctx
 * @param {(summary: {saved: number}) => void} [o.onFinish]
 * @param {(date: string) => void} [o.onOpenDay] 「對不上」那一列：去日曆那一天
 */
export function openAboveeConfirm({ photos, release, ctx: given, onFinish, onOpenDay }) {
  let ctx = given;
  let items = [];
  let pairing = 'single';
  let sizes = null;
  let attention = new Set();
  let openKey = null;
  let batches = [];
  let running = false;
  let failure = null;
  let closed = false;
  const savedKeys = new Set();
  /** 這一層記好的每一位每一天（跨好幾次按「記錄」）。標壓完照它算。 */
  const savedDays = [];
  let savedCount = 0;
  const showAllRooms = new Set();

  const urlOf = (i) => photos[i]?.url ?? null;
  /** 打開這一層時的網址。分得出「返回鍵」與「換頁」（`requestClose()`）。 */
  const openedAt = window.location.hash;

  const root = document.createElement('div');
  root.className = 'abl';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Abovee 的預約');
  root.innerHTML = `
    <header class="abl__head">
      <button class="abl__close" type="button" data-abl-close aria-label="收起">${icon('close', { size: 20, width: 2 })}</button>
      <div class="abl__heading">
        <h2 class="abl__title">Abovee</h2>
        <p class="abl__sum" data-abl-sum>讀取中…</p>
      </div>
    </header>
    <div class="abl__body" data-abl-body><p class="muted abl__loading">讀取中…</p></div>
    <footer class="abl__bar" data-abl-bar></footer>`;
  document.body.append(root);
  document.body.classList.add('has-abl');
  requestAnimationFrame(() => root.classList.add('abl--in'));

  let layer = pushLayer(() => requestClose({ fromBack: true }));

  // ---------- 載入：照片上那幾天的來訪、還開著的壓表清單 ----------

  async function start() {
    const transcripts = photos.map((p) => p.transcript);
    // 跟翻譯每一列同一種讀法（民國年也認）—— 自己再寫一份的話，民國年那幾天不會補讀
    const dates = aboveeDatesIn(transcripts);
    try {
      // 壓表那一頁只讀了那個月的來訪；照片上的日子可能跨到下個月 —— 補讀，不然「已經記了」會被當成新的
      const [extra, active] = await Promise.all([
        dates.length ? visitsData.listBetween(dates[0], dates[dates.length - 1]) : [],
        batchesData.listActive().catch(() => []),
      ]);
      batches = active;
      const visitsBy = Object.fromEntries(Object.entries(ctx.visitsBy ?? {}).map(([k, v]) => [k, [...v]]));
      for (const v of extra) {
        const list = (visitsBy[v.customerId] ??= []);
        if (!list.some((x) => x.id === v.id)) list.push(v);
      }
      ctx = { ...ctx, visitsBy };
    } catch {
      /* 讀不到就用手上那一份；存的時候每一位會再讀一次 */
    }
    if (closed) return;

    ({ pairing, counts: sizes, items } = readAbovee(transcripts, ctx));
    // 打開時要看的那幾列排在最前面，之後不跟著跳（她選了人，那一列不會突然換位置）
    attention = new Set(items.filter(needsAttention).map((i) => i.key));
    paintBody();
  }

  // ---------- 畫 ----------

  function plan() {
    const { groups, problems } = planAbovee(items, ctx);
    const warningsBy = {};
    for (const g of groups) {
      const { errors, warnings } = validateVisit(g.visit, {
        customer: { flags: ctx.customers.find((c) => c.id === g.customerId)?.flags ?? [] },
        entitlements: ctx.entitlementsBy[g.customerId] ?? [],
        courses: ctx.master.courses, equipment: ctx.master.equipment, rooms: ctx.master.rooms,
        staff: ctx.master.staff, ivProducts: ctx.master.ivProducts,
        customerVisits: ctx.visitsBy[g.customerId] ?? [],
        sameDayVisits: Object.values(ctx.visitsBy).flat().filter((v) => v.date === g.date),
      });
      for (const item of g.items) {
        if (errors.length) problems[item.key] = [...(problems[item.key] ?? []), ...errors];
        warningsBy[item.key] = warnings;
      }
    }
    return { groups: groups.filter((g) => g.items.every((i) => !problems[i.key])), problems, warningsBy };
  }

  function paintSummary() {
    const s = summarizeAbovee(items.filter((i) => !savedKeys.has(i.key)));
    const bits = [
      savedCount ? `記好了 ${savedCount} 段` : '',
      s.new ? `新的 ${s.new} 段` : '',
      s.recorded ? `已經記了 ${s.recorded} 段` : '',
      s.attention ? `要你看 ${s.attention} 段` : '',
    ].filter(Boolean);
    root.querySelector('[data-abl-sum]').textContent = bits.join('・') || '照片上沒有讀到預約';
  }

  function paintBody() {
    const body = root.querySelector('[data-abl-body]');
    const p = plan();
    const look = items.filter((i) => attention.has(i.key));
    const rest = items.filter((i) => !attention.has(i.key))
      .slice()
      .sort((a, b) => `${a.date}|${a.startsAt}`.localeCompare(`${b.date}|${b.startsAt}`));
    const days = [];
    for (const item of rest) {
      const last = days[days.length - 1];
      if (last && last.date === item.date) last.items.push(item);
      else days.push({ date: item.date, items: [item] });
    }

    body.innerHTML = `
      <div class="abl__photos">
        ${photos.map((ph, i) => `
          <button class="abl__thumb" type="button" data-seen-text="" data-seen-photo="${esc(ph.url)}"
                  aria-label="看第 ${i + 1} 張照片"><img src="${esc(ph.url)}" alt="" /></button>`).join('')}
        ${pairingNote()}
      </div>
      ${items.length ? '' : '<p class="abl__empty">照片上沒有讀到任何一列預約。拍含「姓名」那幾欄的那一半試試。</p>'}
      ${look.length ? `
        <section class="abl__group abl__group--look" aria-label="要你看">
          <h3 class="abl__day">要你看</h3>
          <ol class="abl__rows">${look.map((i) => rowHtml(i, p)).join('')}</ol>
        </section>` : ''}
      ${days.map((d) => `
        <section class="abl__group" aria-label="${esc(d.date ?? '讀不出日期')}">
          <h3 class="abl__day">${d.date ? esc(shortDate(d.date)) : '讀不出日期'}</h3>
          <ol class="abl__rows">${d.items.map((i) => rowHtml(i, p)).join('')}</ol>
        </section>`).join('')}`;
    paintSummary();
    paintBar(p);
  }

  function repaintRow(key) {
    const p = plan();
    const li = [...root.querySelectorAll('[data-abl-row]')].find((el) => el.dataset.ablRow === key);
    const item = items.find((i) => i.key === key);
    if (li && item) {
      const holder = document.createElement('template');
      holder.innerHTML = rowHtml(item, p).trim();
      li.replaceWith(holder.content.firstElementChild);
    }
    // 同一天同一位的另一列：警告與「還差一步」跟著變
    for (const other of items) {
      if (other.key === key || other.customerId !== item?.customerId || other.date !== item?.date) continue;
      const el = [...root.querySelectorAll('[data-abl-row]')].find((x) => x.dataset.ablRow === other.key);
      if (!el) continue;
      const holder = document.createElement('template');
      holder.innerHTML = rowHtml(other, p).trim();
      el.replaceWith(holder.content.firstElementChild);
    }
    paintSummary();
    paintBar(p);
  }

  /** 左右兩張怎麼對上的 —— **常駐**，不收進 ?（會改變寫進去的東西）。 */
  function pairingNote() {
    if (pairing === 'halves') {
      return '<p class="abl__pairing">右半邊的診間、服務資源是<b>照列的順序</b>對上的，點開一列對照看看。</p>';
    }
    if (pairing === 'mismatch') {
      return `<p class="abl__pairing abl__pairing--warn">左右兩張的列數不一樣（左 ${sizes.left} 列、右 ${sizes.right} 列），
        <b>沒有對上</b> —— 診間與治療師那幾格空著，點開一列選。</p>`;
    }
    if (pairing === 'noNames') {
      return '<p class="abl__pairing abl__pairing--warn">這一張沒有「姓名」那一欄，認不出是誰。拍含姓名的那一半（最左邊那幾欄）。</p>';
    }
    return '';
  }

  function slotOf(item) {
    if (!item.customerId) return null;
    // 跟存檔（`planAbovee()`）交給 `slotFromPicks()` 的是同一份 —— 另組一份的話，列上印的名字會跟存下去的不一樣
    return slotFromPicks(picksOf(item), {
      courses: ctx.master.courses, equipment: ctx.master.equipment, ivProducts: ctx.master.ivProducts,
      entitlements: ctx.entitlementsBy[item.customerId] ?? [], visits: ctx.visitsBy[item.customerId] ?? [],
    });
  }

  function tagOf(item) {
    if (savedKeys.has(item.key)) return 'saved';
    if (item.cancelled) return 'cancelled';
    return item.kind;
  }

  function rowHtml(item, p) {
    const tag = tagOf(item);
    const open = openKey === item.key;
    const customer = ctx.customers.find((c) => c.id === item.customerId);
    const built = slotOf(item);
    const what = built?.slot ? slotName(built.slot, ctx.master, 'short') : (item.row.course || '？');
    const canCheck = item.kind === 'new' && item.customerId && !savedKeys.has(item.key) && !running;
    const problems = item.checked ? (p.problems[item.key] ?? []) : [];

    return `
      <li class="abl-row abl-row--${tag}${open ? ' is-open' : ''}${problems.length ? ' has-problem' : ''}" data-abl-row="${esc(item.key)}">
        <div class="abl-row__line">
          <button class="abl-row__check" type="button" role="checkbox" data-abl-check
                  aria-checked="${Boolean(item.checked)}" ${canCheck ? '' : 'disabled'}
                  aria-label="記這一段">${icon('check', { size: 15, width: 2.6 })}</button>
          <button class="abl-row__main" type="button" data-abl-open aria-expanded="${open}">
            <span class="abl-row__time">${attention.has(item.key) && item.date
              ? `<small class="abl-row__date">${esc(shortDate(item.date))}</small>` : ''}${esc(item.startsAt ?? '—')}</span>
            <span class="abl-row__who">${esc(customer?.name ?? (item.row.name || '？'))}</span>
            <span class="abl-row__what">${esc(what)}</span>
            <span class="abl-row__tag">${esc(tag === 'unknown' && item.who.how === 'none' ? 'app 裡沒有' : TAGS[tag])}</span>
          </button>
        </div>
        ${problems.length && !open ? `<p class="abl-row__hint">還差一步：${esc(problems[0])}</p>` : ''}
        ${open ? detailHtml(item, built, problems, p.warningsBy[item.key] ?? []) : ''}
      </li>`;
  }

  // ---------- 展開的那一列 ----------

  function detailHtml(item, built, problems, warnings) {
    const left = urlOf(item.photos[0]);
    const right = urlOf(item.photos[1] ?? item.photos[0]);
    const r = item.row;
    const seen = `
      <div class="abl-row__seen">
        <span class="abl-row__seenlabel">照片上寫的是</span>
        ${seenChip(item.statusText, { photo: left })}
        ${seenChip(r.date, { photo: left })}
        ${seenChip(r.time, { photo: left })}
        ${seenChip([r.name, r.chartNo].filter(Boolean).join(' '), { photo: left })}
        ${seenChip(r.course, { photo: left })}
        ${seenChip(r.room, { photo: right })}
        ${seenChip(r.resource, { photo: right })}
        ${seenChip(r.cancelReason, { photo: right })}
      </div>`;

    if (savedKeys.has(item.key)) return `<div class="abl-row__detail">${seen}<p class="abl-row__say">已經記進日曆了。</p></div>`;
    if (item.kind === 'recorded') {
      return `<div class="abl-row__detail">${seen}<p class="abl-row__say">這一段 app 裡已經有了，不用再記。</p></div>`;
    }
    if (item.kind === 'mismatch') {
      return `<div class="abl-row__detail">${seen}
        <p class="abl-row__say">${esc(shortDate(item.date))} ${esc(item.startsAt)} app 裡已經有一段，但做的不一樣。
          這裡不改 —— 要改的話去日曆那一天。</p>
        ${onOpenDay ? `<button class="btn btn--sm" type="button" data-abl-day="${esc(item.date)}">
          去日曆 ${esc(shortDate(item.date))}（照片不會留著）</button>` : ''}
      </div>`;
    }
    if (item.kind === 'unknown') {
      return `<div class="abl-row__detail">${seen}
        <p class="abl-row__say">${esc(WHY_UNKNOWN[item.who.how] ?? '')}</p>
        ${item.who.candidates.length ? chipRow('是誰', item.who.candidates.map((c) => ({
          value: c.id, label: c.name, on: item.customerId === c.id, attr: 'data-abl-who',
        }))) : ''}
      </div>`;
    }

    const rows = [];
    // 她自己選的人：候選那一排留著，選錯了換得掉
    if (!item.who.customer && item.who.candidates.length) {
      rows.push(chipRow('是誰', item.who.candidates.map((c) => ({
        value: c.id, label: c.name, on: item.customerId === c.id, attr: 'data-abl-who',
      }))));
    }

    const choices = entitlementChoices(item.customerId, item.course, ctx);
    if (!item.course) rows.push('<p class="abl-row__say">認不出課程那一格寫的是什麼。到壓表那張卡上手動記這一段。</p>');
    else if (!choices.length) rows.push('<p class="abl-row__say">這位客戶身上沒有可以扣這一段的額度。</p>');
    else {
      rows.push(chipRow('額度', choices.map(({ entitlement: e, remaining }) => ({
        value: e.id, label: e.label, sub: `剩 ${remaining}`, on: item.entitlementId === e.id, attr: 'data-abl-ent',
      }))));
    }

    const ent = (ctx.entitlementsBy[item.customerId] ?? []).find((e) => e.id === item.entitlementId) ?? null;
    const course = built?.course ?? null;
    if (ent?.type === 'pool') {
      rows.push(chipRow('器材', (ent.optionEquipmentIds ?? [])
        .map((id) => ctx.master.equipment.find((e) => e.id === id)).filter(Boolean)
        .map((e) => ({ value: e.id, label: e.name, on: item.equipmentId === e.id, attr: 'data-abl-eq' }))));
    }
    if (course?.requiresIvProduct) {
      const iv = ivChoicesFor(ent, ctx.master.ivProducts);
      rows.push(chipRow('品項', [...iv.primary, ...iv.others].map((x) => ({
        value: x.id, label: x.name, on: item.ivProductId === x.id, attr: 'data-abl-iv',
      }))));
    }
    const exams = examChoices(item.customerId, ent, ctx);
    if (exams.length) {
      // 每一次都標它自己的狀態，**只有已完成、沒被佔走的按得下去**（`pickable`，issues/11）
      rows.push(chipRow('接哪一次健檢', exams.map((x) => ({
        value: x.visitId, label: shortDate(x.date),
        sub: examChoiceNote(x),
        on: item.followupForVisitId === x.visitId, attr: 'data-abl-exam', off: !x.pickable,
      }))));
    } else if (ent?.followupForEntitlementId) {
      // 一次都沒排過：跟壓表、來訪編輯器一樣，標題旁邊一顆 ?（issues/11）
      rows.push(chipRow('接哪一次健檢', [], tip('還沒排過健檢')));
    }

    const assigns = course ? assignsFor(ent, course, item.equipmentId) : null;
    if (course && picksEquipment(ent, course) && !item.equipmentId) {
      rows.push('<p class="abl-row__say">先選上面那一台，才知道要治療師還是診間。</p>');
    } else if (assigns === 'room') {
      const slots = orderedRoomSlots(course, ctx.master.rooms);
      const usual = slots.filter((s) => s.usual);
      const shown = showAllRooms.has(item.key) || !usual.length ? slots : usual;
      rows.push(chipRow('診間', shown.map((s) => ({
        value: s.roomId, label: s.label, on: item.roomId === s.roomId, attr: 'data-abl-room',
      })), shown.length < slots.length ? `<button class="chip chip--sm chip--more" type="button" data-abl-allrooms>其他診間</button>` : ''));
    } else if (assigns === 'therapist') {
      rows.push(chipRow('治療師', staffWithRole(ctx.master.staff, THERAPIST_ROLE).map((s) => ({
        value: s.id, label: s.name, on: item.therapistId === s.id, attr: 'data-abl-therapist',
      }))));
    }
    if (course && picksDoctor(course)) {
      rows.push(chipRow('醫師', staffWithRole(ctx.master.staff, DOCTOR_ROLE).map((s) => ({
        value: s.id, label: s.name, on: item.doctorId === s.id, attr: 'data-abl-doctor',
      }))));
    }

    const learn = item.staffPickText && (item.therapistId || item.doctorId)
      ? `<p class="abl-row__learn">${icon('check', { size: 13, width: 2.4 })}記住：以後 Abovee 上的「${esc(item.staffPickText)}」都認成 ${esc(
        ctx.master.staff.find((s) => s.id === (item.therapistId ?? item.doctorId))?.name ?? '')}</p>`
      : '';

    return `
      <div class="abl-row__detail">
        ${seen}
        ${rows.join('')}
        ${learn}
        ${problems.length ? `<ul class="abl-row__problems">${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${warnings.length ? `<ul class="abl-row__warnings">${warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>`;
  }

  function chipRow(label, chips, extra = '') {
    return `
      <div class="abl-row__pick">
        <span class="abl-row__picklabel">${esc(label)}</span>
        <span class="abl-row__chips">
          ${chips.map((c) => `
            <button class="chip chip--sm abl-chip" type="button" ${c.attr}="${esc(c.value)}" aria-pressed="${Boolean(c.on)}"
                    ${c.off ? 'disabled' : ''}>${esc(c.label)}${c.sub ? `<span class="chip__note">${esc(c.sub)}</span>` : ''}</button>`).join('')}
          ${extra}
        </span>
      </div>`;
  }

  // ---------- 底下那一條 ----------

  function paintBar(p = plan()) {
    const bar = root.querySelector('[data-abl-bar]');
    const checked = items.filter((i) => i.checked && !savedKeys.has(i.key));
    const stuck = checked.filter((i) => p.problems[i.key]);
    const n = checked.length;
    const say = failure
      ? `記好了 ${savedCount} 段；${failure.name} 那一天沒記：${failure.message}。再按一次記剩下的。`
      : stuck.length ? `勾起來的有 ${stuck.length} 段還差一步，點開補上`
        : n ? '' : '勾起要記的那幾段';
    bar.innerHTML = `
      ${say ? `<p class="abl__why" role="status">${esc(say)}</p>` : ''}
      <button class="btn btn--primary abl__save" type="button" data-abl-save
              ${!n || stuck.length || running ? 'disabled' : ''}>${running ? '記錄中…' : (n ? `記錄這 ${n} 段` : '記錄')}</button>`;
  }

  // ---------- 接線 ----------

  wireSeen(root);

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled || !root.contains(t)) return;
    if (t.matches('[data-abl-close]')) { requestClose(); return; }
    if (t.matches('[data-abl-save]')) { save(); return; }
    if (t.dataset.ablDay) { leaveTo(t.dataset.ablDay); return; }

    const key = t.closest('[data-abl-row]')?.dataset.ablRow;
    const at = items.findIndex((i) => i.key === key);
    if (at < 0) return;
    const item = items[at];
    const set = (next) => { items[at] = next; repaintRow(key); };

    if (t.matches('[data-abl-check]')) { set({ ...item, checked: !item.checked }); return; }
    if (t.matches('[data-abl-open]')) {
      const before = openKey;
      openKey = openKey === key ? null : key;
      if (before && before !== key) repaintRow(before);
      repaintRow(key);
      return;
    }
    if (t.dataset.ablWho) {
      set(resolveItem(item, t.dataset.ablWho, ctx));
      return;
    }
    if (t.dataset.ablEnt) {
      const ent = (ctx.entitlementsBy[item.customerId] ?? []).find((x) => x.id === t.dataset.ablEnt);
      const options = ent?.optionEquipmentIds ?? [];
      const exams = examChoices(item.customerId, ent, ctx).filter((x) => x.pickable);
      set({
        ...item,
        entitlementId: ent?.id ?? null,
        equipmentId: ent?.type === 'pool'
          ? (options.includes(item.course?.equipmentId) ? item.course.equipmentId : (options.length === 1 ? options[0] : null))
          : null,
        ivProductId: ent?.ivProductId ?? item.ivProductId,
        followupForVisitId: exams.length === 1 ? exams[0].visitId : null,
      });
      return;
    }
    if (t.dataset.ablEq) { set({ ...item, equipmentId: t.dataset.ablEq }); return; }
    if (t.dataset.ablIv) { set({ ...item, ivProductId: t.dataset.ablIv }); return; }
    if (t.dataset.ablExam) { set({ ...item, followupForVisitId: t.dataset.ablExam }); return; }
    if (t.dataset.ablRoom) { set({ ...item, roomId: t.dataset.ablRoom }); return; }
    if (t.matches('[data-abl-allrooms]')) { showAllRooms.add(key); repaintRow(key); return; }
    if (t.dataset.ablTherapist || t.dataset.ablDoctor) {
      const staffId = t.dataset.ablTherapist ?? t.dataset.ablDoctor;
      // 服務資源那一格認不出來、她選了人 → 存的時候記住那個寫法（12 的 `aliasWrites()`）
      const unknownText = item.row.resource && !staffFrom(item.row.resource, ctx.master.staff)
        ? item.row.resource : null;
      set({
        ...item,
        ...(t.dataset.ablTherapist ? { therapistId: staffId } : { doctorId: staffId }),
        staffPickText: unknownText,
      });
    }
  });

  function onKey(e) {
    if (e.key !== 'Escape' || document.querySelector('.dialog-backdrop, .seenview')) return;
    requestClose();
  }
  document.addEventListener('keydown', onKey);

  function onHash() { close({ fromBack: true }); }
  window.addEventListener('hashchange', onHash);

  // ---------- 存 ----------

  async function save() {
    const p = plan();
    const groups = p.groups.filter((g) => g.items.every((i) => !savedKeys.has(i.key)));
    const n = groups.reduce((sum, g) => sum + g.items.length, 0);
    if (!n || running) return;

    const aliases = aliasWrites(
      items.filter((i) => i.staffPickText && (i.therapistId || i.doctorId) && i.checked)
        .map((i) => ({ text: i.staffPickText, staffId: i.therapistId ?? i.doctorId })),
      ctx.master.staff,
    );
    const marks = queueMarksAfter(groups.map((g) => ({ customerId: g.customerId, date: g.date })), batches);
    const people = new Set(groups.map((g) => g.customerId)).size;
    const nameOf = (id) => ctx.customers.find((c) => c.id === id)?.name ?? '';

    const ok = await confirmAction({
      title: `記錄這 ${n} 段？`,
      consequences: [
        `${people} 位・${groups.length} 天・${n} 段`,
        '每一段都記成「待確認」—— Abovee 上寫的「確認前往」不等於問過客人',
        ...groups.filter((g) => g.reopened).map((g) =>
          `${g.customerName} ${shortDate(g.date)} 那一天已經確認過，併進去之後整天退回待確認`),
        ...aliases.flatMap((a) => a.changes.aboveeNames.slice(-1).map((x) => `以後 Abovee 上的「${x}」都認成 ${a.name}`)),
        ...marks.map((m) => `${m.customerIds.map(nameOf).join('、')} 在 ${monthLabel(batches.find((b) => b.id === m.batchId)?.targetMonth ?? '')}壓表清單上標成壓完`),
      ],
      confirmLabel: '已確認，記錄',
    });
    if (!ok || closed) return;

    running = true;
    failure = null;
    paintBody();
    let current = null;
    const doneNow = [];

    // 一位一天一個 commit。**重試只會記一次**：先到的那一趟記好的，另一趟看到 savedKeys 就跳過
    const write = async () => {
      for (const g of groups) {
        if (g.items.every((i) => savedKeys.has(i.key))) continue;
        current = g;
        const fresh = await visitsData.listByCustomer(g.customerId);
        // 用剛讀回來的那一份重組一次：她在別的裝置上剛改過那一天的話，不可以蓋掉
        const [again] = planAbovee(g.items, { ...ctx, visitsBy: { ...ctx.visitsBy, [g.customerId]: fresh } }).groups;
        await visitsData.save(again.visit, fresh);
        g.items.forEach((i) => savedKeys.add(i.key));
        savedCount += g.items.length;
        doneNow.push({ customerId: g.customerId, date: g.date });
        savedDays.push({ customerId: g.customerId, date: g.date });
        if (!closed) paintBody();
      }
      return doneNow.length;
    };

    try {
      await toast.withSaveState(write, { success: `記好了 ${n} 段`, key: 'abovee:save', undoable: false });
    } catch (err) {
      failure = { name: current?.customerName ?? '', message: err?.message ?? '不知道為什麼' };
      toast.hide();
    }

    // 記好的那幾位才記住寫法、標壓完。**算的是到目前為止記好的全部**（不只這一次），
    // 而且**寫好一次就更新手上那一份** —— 再按一次時是拿它算的：沒更新的話，寫回去的整份
    // queue／aboveeNames 是打開這一層時讀的那一份，上一次標好的壓完會被蓋回「還沒壓」。
    // 已經寫過的算出來是空的（`aliasWrites()`、`queueMarksAfter()` 都跳過），沒寫成的下一次補
    const missed = new Set();
    for (const a of aliasWrites(
      items.filter((i) => savedKeys.has(i.key) && i.staffPickText && (i.therapistId || i.doctorId))
        .map((i) => ({ text: i.staffPickText, staffId: i.therapistId ?? i.doctorId })),
      ctx.master.staff,
    )) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await config.update('staff', a.id, a.changes);
        const staff = ctx.master.staff.map((s) => (s.id === a.id ? { ...s, ...a.changes } : s));
        ctx = { ...ctx, master: { ...ctx.master, staff } };
      } catch {
        missed.add('治療師在 Abovee 上的寫法');
      }
    }
    for (const m of queueMarksAfter(savedDays, batches)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await batchesData.saveProgress(m.batchId, m.queue, m.cursor);
        batches = batches.map((b) => (b.id === m.batchId ? { ...b, queue: m.queue } : b));
      } catch {
        missed.add('壓表清單上的壓完');
      }
    }

    running = false;
    // 來訪已經記好了，這兩件沒寫成不擋 —— 但**要講**：確認框上說了會做
    const missedLine = missed.size ? `；${[...missed].join('、')}沒記上，到壓表那一頁手動補` : '';
    if (closed) {
      if (missedLine) toast.failed(`記好了 ${savedCount} 段${missedLine}`);
      return;
    }
    const left = items.some((i) => i.checked && !savedKeys.has(i.key));
    if (!failure && !left) {
      close();
      if (missedLine) toast.failed(`記好了 ${savedCount} 段${missedLine}`);
      else toast.info(`記好了 ${savedCount} 段`);
      return;
    }
    if (missedLine) toast.failed(`記好了 ${savedCount} 段${missedLine}`);
    paintBody();
  }

  // ---------- 收起來 ----------

  function leaveTo(date) {
    // 換頁（hashchange）會收掉這一層、不退紀錄 —— 不先 pop，不然退紀錄那一趟會把換頁退掉
    onOpenDay?.(date);
  }

  async function requestClose({ fromBack = false } = {}) {
    if (closed) return true;
    // **換頁不是返回鍵**：「去日曆」換網址時瀏覽器也會先發一下 popstate，`nav.js` 照返回鍵叫到這裡。
    // 網址已經不是打開這一層時的那一個了 → 不問（按鈕上寫了「照片不會留著」），直接收。
    // 問了的話，緊接著的 hashchange 會把這一層收掉，那一道確認框卻留在日曆上
    if (fromBack && window.location.hash !== openedAt) {
      close({ fromBack: true });
      return true;
    }
    const pending = items.filter((i) => i.checked && !savedKeys.has(i.key)).length;
    if (pending && !running) {
      const pick = await chooseAction({
        title: `還有 ${pending} 段沒記`,
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

  root.querySelector('[data-abl-close]').focus({ preventScroll: true });
  start();
  return { close: () => requestClose() };
}

