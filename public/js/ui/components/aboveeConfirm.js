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
import * as tasksData from '../../data/tasks.js';
import * as config from '../../data/config.js';
import { examChoiceNote } from '../../domain/followups.js';
import { aboveeConsequences } from '../../domain/consequences.js';
import {
  aboveeLoadRange, absentFromPhoto, absentSay, adoptAbovee, customersOnPhoto, goneButtonSay, diffSay, examChoices, mergedLine, mergedNotices,
  markRepeat, mismatchSay, needsAttention, nearSay, newRowSay, optionValueOf, partialSay, pickOption, picksOf, planAbovee, queueMarksAfter, readAbovee,
  repeatSay, resolveItem, summarizeAbovee,
} from '../../domain/aboveeImport.js';
import { aliasWrites } from '../../domain/abovee.js';
import { validateVisit, slotSay, picksEquipment, assignsFor, shortStatus, slotMinutes } from '../../domain/visits.js';
import { slotFromPicks } from '../../domain/slotDraft.js';
import { slotOptionsFor } from '../../domain/slotOptions.js';
import { MAX_NTH, MIN_NTH, examChoicesForNth, nthLabel } from '../../domain/nthFollowup.js';
import { searchCustomers } from '../../domain/customers.js';
import {
  THERAPIST_ROLE, bookingMinutesOf, ivChoicesFor, orderedRoomSlots, picksDoctor, doctorChoicesFor, staffWithRole,
} from '../../domain/masterData.js';
import { slotName } from '../../domain/naming.js';
import { shortDate, monthLabel } from '../../domain/dates.js';
import { icon } from '../icons.js';
import { pushLayer, whenSettled } from '../nav.js';
import { isOffline } from '../net.js';
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
  none: 'app 裡沒有照片上這個名字 —— 打名字找找看；真的沒有就先去新增客戶',
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
  /** 按了記錄、確認框還沒出來（先讀併進那幾天的任務）—— 連點兩下不可以跳兩個框 */
  let asking = false;
  let failure = null;
  let closed = false;
  const savedKeys = new Set();
  /** 這一層記好的每一位每一天（跨好幾次按「記錄」）。標壓完照它算。 */
  const savedDays = [];
  let savedCount = 0;
  const showAllRooms = new Set();
  /** 每一列「換一位」打開了沒、框裡打了什麼（列的 key → 字）。不放在列上 —— 那一份是要交給 domain 的 */
  const finding = new Map();
  /** 已經讀到**全部**來訪的那幾位（`loadHistory()`）。讀過就不再讀；存檔前那一次重讀是另一回事 */
  const whole = new Set();

  const transcripts = photos.map((p) => p.transcript);
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

  // ---------- 載入：照片上那幾天的來訪、那幾位的全部來訪、還開著的壓表清單 ----------
  //
  // **兩種需求、兩份來訪**（prelaunch-fixes/09）：撞期與「app 有、這次照片上沒有」要的是**那幾天全部客戶**的
  //（`listBetween()`）；算「還剩幾次」、預選、提醒要的是**那幾位客戶的全部**（`loadHistory()`）。

  async function start() {
    // 跟翻譯每一列同一種讀法（民國年也認）—— 自己再寫一份的話，民國年那幾天不會補讀。
    // 放寬到整個月、含起訖那兩格：「app 有、這次照片上沒有」可能對到那麼遠（ADR-0129）
    const range = aboveeLoadRange(transcripts);
    try {
      // 壓表那一頁只讀了那個月的來訪；照片上的日子可能跨到下個月 —— 補讀，不然「已經記了」會被當成新的
      const [extra, active] = await Promise.all([
        range ? visitsData.listBetween(range.from, range.to) : [],
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
    // 照片上認得的每一位（一頁最多 20 位）各讀一次全部，才翻譯 —— 預選與提醒是翻譯那一下算的
    await loadHistory(customersOnPhoto(transcripts, ctx.customers));
    if (closed) return;

    ({ pairing, counts: sizes, items } = readAbovee(transcripts, ctx));
    // 打開時要看的那幾列排在最前面，之後不跟著跳（她選了人，那一列不會突然換位置）
    attention = new Set(items.filter(needsAttention).map((i) => i.key));
    paintBody();
  }

  /**
   * 這幾位的**全部**來訪（prelaunch-fixes/09）。壓表那一頁手上只有最近 180 天 —— 半年前打完的那一筆在那一份裡
   * 看起來還有剩，於是預選它、那一列預設打勾、也不講「排完會超過」。讀回來的整份換掉 `visitsBy[那一位]`；
   * 撞期那一份是把 `visitsBy` 攤平再濾日期（`checkCtx()`），照舊成立。
   *
   * **讀不到的不安靜地照算**：記進 `ctx.partial`，那一位的列不預設打勾、講一句（`partialSay()`）。
   * 離線也算讀不到 —— Firestore 離線時不會失敗，回的是快取裡剛好有的那幾筆。
   */
  async function loadHistory(ids) {
    const wanted = [...new Set(ids)].filter((id) => id && !whole.has(id));
    if (!wanted.length) return;
    const offline = isOffline();
    const got = await Promise.all(wanted.map((id) => (offline
      ? [id, null]
      : visitsData.listByCustomer(id).then((list) => [id, list], () => [id, null]))));
    // 等回來之後才拿手上那一份：同時有兩趟在讀時，後回來的不可以蓋掉先回來的
    const visitsBy = { ...ctx.visitsBy };
    const partial = new Set(ctx.partial ?? []);
    for (const [id, list] of got) {
      if (list) {
        visitsBy[id] = list;
        whole.add(id);
        partial.delete(id);
      } else partial.add(id);
    }
    ctx = { ...ctx, visitsBy, partial };
  }

  // ---------- 畫 ----------

  /**
   * `validateVisit()` 要的那一份（這位客戶、那一天）。
   *
   * **每一段用時間與名字叫**（`slotSay()`，issue 07）：這一層一列一段，沒有「第幾個時段」可以指 ——
   * 而整筆的提醒會原樣掛到那一組的每一列上。
   */
  function checkCtx(customerId, date, visit) {
    return {
      slotLabel: (i) => slotSay(visit?.slots?.[i], ctx.master),
      customer: { flags: ctx.customers.find((c) => c.id === customerId)?.flags ?? [] },
      entitlements: ctx.entitlementsBy[customerId] ?? [],
      courses: ctx.master.courses, equipment: ctx.master.equipment, rooms: ctx.master.rooms,
      staff: ctx.master.staff, ivProducts: ctx.master.ivProducts,
      customerVisits: ctx.visitsBy[customerId] ?? [],
      sameDayVisits: Object.values(ctx.visitsBy).flat().filter((v) => v.date === date),
    };
  }

  function plan() {
    const { groups, problems } = planAbovee(items, ctx);
    const warningsBy = {};
    // 11：按了「改成 Abovee 的」的那一段，改完照樣跑一次（換了診間可能撞到別人，`conflictWarnings()`）
    for (const item of items.filter((i) => i.adopt && !savedKeys.has(i.key))) {
      const visit = (ctx.visitsBy[item.customerId] ?? []).find((v) => v.id === item.existing?.visitId);
      if (!visit) continue;
      const adopted = adoptAbovee(visit, [item]).visit;
      // 她按的那一段叫「這一段」、其餘照時間與名字叫，再挑「這一段」開頭的那幾句 —— 拿 `slotSay()` 當鑰匙的話，
      // 同一天兩段同時間同名（重複的、合併扣課留下的）會互相拿到對方的提醒
      const at = item.existing.slotIndex;
      const check = { ...checkCtx(item.customerId, visit.date, adopted),
        slotLabel: (i) => (i === at ? '這一段' : slotSay(adopted.slots?.[i], ctx.master)) };
      warningsBy[item.key] = validateVisit(adopted, check).warnings.filter((w) => w.startsWith('這一段'));
    }
    for (const g of groups) {
      const { errors, warnings } = validateVisit(g.visit, checkCtx(g.customerId, g.date, g.visit));
      const customer = { flags: ctx.customers.find((c) => c.id === g.customerId)?.flags ?? [] };
      for (const item of g.items) {
        if (errors.length) problems[item.key] = [...(problems[item.key] ?? []), ...errors];
        // 合併扣課只記第一台，第二台要提醒的事接在後面（`mergedNotices()`）
        warningsBy[item.key] = [...warnings, ...mergedNotices(item, customer, ctx.master.equipment)];
      }
    }
    return { groups: groups.filter((g) => g.items.every((i) => !problems[i.key])), problems, warningsBy };
  }

  /** 「app 有、這次照片上沒有」（ADR-0129）。每畫一次算一次 —— 她換了某一列是誰，結果跟著變。 */
  const absentNow = () => absentFromPhoto(transcripts, items, ctx);

  /** 勾起來（或按了「改成 Abovee 的」）還沒記的幾段。 */
  const pendingCount = () => items.filter((i) => (i.checked || i.adopt) && !savedKeys.has(i.key)).length;

  function paintSummary(gone = absentNow()) {
    const s = summarizeAbovee(items.filter((i) => !savedKeys.has(i.key)), gone.slots);
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
    const gone = absentNow();

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
      <div data-abl-absent>${absentHtml(gone, p)}</div>
      ${days.map((d) => `
        <section class="abl__group" aria-label="${esc(d.date ?? '讀不出日期')}">
          <h3 class="abl__day">${d.date ? esc(shortDate(d.date)) : '讀不出日期'}</h3>
          <ol class="abl__rows">${d.items.map((i) => rowHtml(i, p)).join('')}</ol>
        </section>`).join('')}`;
    paintSummary(gone);
    paintBar(p);
  }

  /**
   * 「app 有、這次照片上沒有」那一塊（ADR-0129），接在「要你看」底下。**只講不改**（ADR-0056、0116）：
   * 列上不放按鈕 —— 「去日曆」按了就離開這一層，而照片不留（ADR-0101），一列一顆的話她看完第一段就要整張重拍。
   * 整塊底下一顆，字講出後果：有勾起來的先走既有的存檔、存完才換頁；沒有就直接去。
   * 沒有對不上的時候只留一行講對了誰、哪幾天 —— 少了它分不出沒列出來是「沒有」還是「沒檢查」。
   */
  function absentHtml(gone, p) {
    const say = absentSay(gone, ctx.customers);
    if (!say) return '';
    if (!gone.slots.length) return `<p class="abl__absentsay">${esc(say)}</p>`;
    const first = gone.slots[0].date;
    const pending = pendingCount();
    const stuck = items.some((i) => i.checked && !savedKeys.has(i.key) && p.problems[i.key]);
    return `
      <section class="abl__group abl__group--gone" aria-label="app 有、這次照片上沒有">
        <h3 class="abl__day">app 有、這次照片上沒有</h3>
        <p class="abl__absentsay">${esc(say)}</p>
        <ol class="abl__rows">${gone.slots.map((s) => `
          <li class="abl-row abl-row--gone">
            <div class="abl-row__line">
              <span aria-hidden="true"></span>
              <div class="abl-row__main">
                <span class="abl-row__time"><small class="abl-row__date">${esc(shortDate(s.date))}</small>${esc(s.startsAt ?? '—')}</span>
                <span class="abl-row__who">${esc(s.customerName)}</span>
                <span class="abl-row__what">${esc(s.name)}</span>
                <span class="abl-row__tag">${esc(shortStatus(s.status))}</span>
              </div>
            </div>
          </li>`).join('')}</ol>
        ${onOpenDay ? `<button class="btn btn--sm abl__gone" type="button" data-abl-gone="${esc(first)}"
          ${running || stuck ? 'disabled' : ''}>${esc(goneButtonSay(pending, first))}</button>` : ''}
      </section>`;
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
    // 換了某一列是誰、勾了一列：「app 有、這次照片上沒有」與那一顆按鈕的字跟著變
    const gone = absentNow();
    const absent = root.querySelector('[data-abl-absent]');
    if (absent) absent.innerHTML = absentHtml(gone, p);
    paintSummary(gone);
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
    // 對不上排在已取消前面：Abovee 上取消了、app 上還活著的那一列要看得出來（ADR-0116）
    if (item.kind === 'mismatch') return 'mismatch';
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
    const near = nearSay(item);

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
        ${item.merged ? `
          <p class="abl-row__merged"><b>合併扣課</b>${esc(mergedLine(item))}
            ${savedKeys.has(item.key) ? '' : '<button class="btn btn--sm btn--ghost" type="button" data-abl-split>拆開成兩段</button>'}</p>` : ''}
        ${problems.length && !open ? `<p class="abl-row__hint">還差一步：${esc(problems[0])}</p>` : ''}
        ${/* 為什麼這一列沒有先勾好（ADR-0116）—— 收起來也看得到 */''}
        ${!problems.length && newRowSay(item) ? `<p class="abl-row__hint">${esc(newRowSay(item))}</p>` : ''}
        ${/* 這一位的全部來訪讀不到（09）：次數可能不準，所以沒有先勾好 —— 收起來也看得到 */''}
        ${partialSay(item) && !savedKeys.has(item.key) ? `<p class="abl-row__hint">${esc(partialSay(item))}</p>` : ''}
        ${/* 跟另一張照片上的那一列看起來是同一段（10）：所以沒有先勾好 —— 收起來也看得到 */''}
        ${repeatSay(item) && !savedKeys.has(item.key) ? `<p class="abl-row__hint">${esc(repeatSay(item))}</p>` : ''}
        ${/* 認得、但不是一字不差（ADR-0128）—— 收起來也看得到 */''}
        ${near && !savedKeys.has(item.key) ? `<p class="abl-row__hint abl-row__hint--near">${esc(near)}</p>` : ''}
        ${item.kind === 'recorded' && item.diffs?.length && !open
          ? `<p class="abl-row__hint">${esc(item.diffs.map((d) => diffSay(d, ctx.master)).join('；'))}</p>` : ''}
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
    // 「是誰」每一種都換得掉（還沒記好的列）：認錯人的那一列以前只能整列放棄
    const who = whoHtml(item);
    if (item.kind === 'recorded') {
      return `<div class="abl-row__detail">${seen}<p class="abl-row__say">${item.cancelled
        ? '兩邊都是取消的，不用記。' : '這一段 app 裡已經有了，不用再記。'}</p>${adoptHtml(item, warnings)}${who}</div>`;
    }
    if (item.kind === 'mismatch') {
      // 那一句在 domain（`mismatchSay()`，ADR-0116）：課程不一樣、或兩邊的預約狀態講不一樣
      return `<div class="abl-row__detail">${seen}
        <p class="abl-row__say">${esc(shortDate(item.date))} ${esc(item.startsAt)} ${esc(mismatchSay(item))}
          這裡不改 —— 要改的話去日曆那一天。</p>
        ${onOpenDay ? `<button class="btn btn--sm" type="button" data-abl-day="${esc(item.date)}">
          去日曆 ${esc(shortDate(item.date))}（照片不會留著）</button>` : ''}
        ${who}
      </div>`;
    }
    if (item.kind === 'unknown') {
      return `<div class="abl-row__detail">${seen}
        <p class="abl-row__say">${esc(WHY_UNKNOWN[item.who.how] ?? '')}</p>
        ${who}
      </div>`;
    }

    const rows = [who];
    // 10：Abovee 上改了時間、app 還沒改 —— 改期是取消＋重新排（ADR-0108），去日曆做
    if (item.movedFrom && onOpenDay) {
      rows.unshift(`<button class="btn btn--sm" type="button" data-abl-day="${esc(item.date)}">
        去日曆 ${esc(shortDate(item.date))} 改期（照片不會留著）</button>`);
    }
    // 「要做什麼」那一排跟壓表同一份（`slotOptionsFor()`，ADR-0121）：額度（二返排最後）、＋n返、不算次數的課。
    // **用完的額度也列** —— Abovee 上已經約了，那一段是既成事實；選了照舊有「會超過次數」的提醒
    const options = optionsFor(item);
    const value = optionValueOf(item);
    if (!options.length) {
      rows.push('<p class="abl-row__say">這位客戶身上沒有可以排的額度，也沒有不算次數的課 —— 先去加購再回來記。</p>');
    } else {
      if (!item.course) rows.push('<p class="abl-row__say">照片上的課程那一格認不出來，選這一段要做什麼。</p>');
      // 照分類排、二返那一組另起一行（`arrangeSlotOptions()`，issue 08；小標 issue 16 拿掉了）
      rows.push(chipRow('要做什麼', options.map((o) => ({
        value: o.entitlementId, label: o.label,
        sub: o.isNth || o.isUncounted ? '不扣次數' : `剩 ${o.remaining}`,
        on: o.entitlementId === value, attr: 'data-abl-opt',
        brk: o.breakBefore,
      }))));
      if (item.isNth && !options.some((o) => o.isNth)) {
        rows.push('<p class="abl-row__say">照片上是 n返，這位客戶還沒有做完的健檢可以接 —— 選別的，或先去日曆把那次健檢記成已完成。</p>');
      }
    }

    const ent = item.isNth ? null
      : ((ctx.entitlementsBy[item.customerId] ?? []).find((e) => e.id === item.entitlementId) ?? null);
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
    if (item.isNth && course) {
      rows.push(...nthRows(item));
    } else {
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
    }
    // 約的時候選時長（ADR-0122）：照片上的數字先按好（二返60 → 60），沒寫就是預設那一顆
    const minutes = bookingMinutesOf(course);
    if (minutes.length) {
      const ivProduct = course.requiresIvProduct
        ? (ctx.master.ivProducts.find((p) => p.id === item.ivProductId) ?? null) : null;
      const now = slotMinutes({ entitlement: ent, course, ivProduct, minutes: item.minutes });
      rows.push(chipRow('排多久', minutes.map((n) => ({
        value: String(n), label: `${n} 分`, on: n === now, attr: 'data-abl-min',
      }))));
    }

    const assigns = course ? assignsFor(ent, course, item.equipmentId) : null;
    if (course && picksEquipment(ent, course) && !item.equipmentId) {
      rows.push('<p class="abl-row__say">先選上面那一台，才知道要治療師還是診間。</p>');
    } else if (assigns === 'room') {
      // 認到的是停用的那一間（照片上沒寫床 → 點滴8，ADR-0127）時那一顆也要在上面，不然看起來像沒認到
      const slots = orderedRoomSlots(course, ctx.master.rooms, { keep: item.roomId });
      const usual = slots.filter((s) => s.usual || s.retired);
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
      // 誰排前面只寫在 `doctorChoicesFor()`（ADR-0120）。**這裡不套 `preselect`** ——
      // 照片上已經寫著是哪一位，認不出來時替她挑一位等於把照片上的字蓋掉
      const { first, others } = doctorChoicesFor(course, ctx.master.staff);
      rows.push(chipRow('醫師', [...first, ...others].map((s) => ({
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
          ${chips.map(chipHtml).join('')}
          ${extra}
        </span>
      </div>`;
  }

  /** 11：「app 是 A、Abovee 是 B」＋一顆「改成 Abovee 的」（按著／放開）。已完成的鎖著，不給按。 */
  function adoptHtml(item, warnings) {
    if (!item.diffs?.length) return '';
    return `
      <ul class="abl-row__diffs">${item.diffs.map((d) => `<li>${esc(diffSay(d, ctx.master))}</li>`).join('')}</ul>
      ${item.locked
        ? '<p class="abl-row__say">已完成的鎖著 —— 要改去日曆那一天。</p>'
        : `<span class="abl-row__chips"><button class="chip chip--sm abl-chip" type="button" data-abl-adopt
             aria-pressed="${Boolean(item.adopt)}">改成 Abovee 的</button></span>`}
      ${item.adopt && warnings.length
        ? `<ul class="abl-row__warnings">${warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  }

  function chipHtml(c) {
    return `${c.brk ? '<span class="chips__break"></span>' : ''}
      <button class="chip chip--sm abl-chip" type="button" ${c.attr}="${esc(c.value)}" aria-pressed="${Boolean(c.on)}"
              ${c.off ? 'disabled' : ''}>${esc(c.label)}${c.sub ? `<span class="chip__note">${esc(c.sub)}</span>` : ''}</button>`;
  }

  /**
   * 「是誰」那一排。認得的只畫名字＋「換一位」；按了（或本來就認不得）才有找人的框與候選。
   * **打字只換候選那一塊**（`[data-abl-found]`）—— 整列重畫會換掉輸入框，中文選字打到一半就斷了（ADR-0038 的精神）。
   */
  function whoHtml(item) {
    const customer = ctx.customers.find((c) => c.id === item.customerId);
    if (customer && !finding.has(item.key)) {
      return `
        <div class="abl-row__pick">
          <span class="abl-row__picklabel">是誰</span>
          <span class="abl-row__chips">
            <span class="abl-row__whonow">${esc(customer.name)}</span>
            <button class="chip chip--sm chip--more" type="button" data-abl-find>換一位</button>
          </span>
        </div>`;
    }
    return `
      <div class="abl-row__pick">
        <span class="abl-row__picklabel">是誰</span>
        <span class="abl-row__chips" data-abl-found>${whoChips(item)}</span>
        <label class="abl-row__find">
          <span class="visually-hidden">打名字找客戶</span>
          <input type="search" data-abl-query value="${esc(finding.get(item.key) ?? '')}"
                 placeholder="打名字找" autocomplete="off" />
        </label>
      </div>`;
  }

  /** 候選（認人給的）＋ 她打字找到的（`searchCustomers()`）。找不到才講「先去新增客戶」—— 這一層不建客戶。 */
  function whoChips(item) {
    const query = String(finding.get(item.key) ?? '').trim();
    const seenIds = new Set();
    const pool = [...(item.who?.candidates ?? []), ...searchCustomers(ctx.customers, query)]
      .filter((c) => c && !seenIds.has(c.id) && seenIds.add(c.id))
      .slice(0, 8);
    if (!pool.length) {
      return query
        ? `<span class="abl-row__say">找不到「${esc(query)}」—— app 裡真的沒有的話，先去新增客戶再回來拍。</span>`
        : '';
    }
    return pool.map((c) => chipHtml({ value: c.id, label: c.name, on: item.customerId === c.id, attr: 'data-abl-who' })).join('');
  }

  /** 這位客戶這一段可以做什麼（`slotOptionsFor()`，壓表同一支；用完的也列）。 */
  function optionsFor(item) {
    if (!item.customerId) return [];
    return slotOptionsFor({
      entitlements: ctx.entitlementsBy[item.customerId] ?? [],
      visits: ctx.visitsBy[item.customerId] ?? [],
      courses: ctx.master.courses,
      equipment: ctx.master.equipment,
      // n返 借的課程跟著她選的那一次健檢走
      followupForVisitId: item.isNth ? item.followupForVisitId : null,
    }, { includeUsedUp: true });
  }

  /**
   * n返 的兩排：第幾返、接哪一次健檢。照壓表那兩排（`schedule.js` 的 `nthFields()`）：
   * 已經有幾返照樣標出來、沒做完的那一次按不下去、**不替她選**接哪一次。
   */
  function nthRows(item) {
    const numbers = [];
    for (let n = MIN_NTH; n <= MAX_NTH; n += 1) numbers.push(n);
    const exams = examChoicesForNth({
      entitlements: ctx.entitlementsBy[item.customerId] ?? [],
      coursesById: Object.fromEntries(ctx.master.courses.map((c) => [c.id, c])),
      visits: ctx.visitsBy[item.customerId] ?? [],
    });
    return [
      chipRow('第幾返', numbers.map((n) => ({
        value: String(n), label: nthLabel(n), on: item.nth === n, attr: 'data-abl-nth',
      }))),
      chipRow('接哪一次健檢', exams.map((x) => ({
        value: x.visitId, label: shortDate(x.date), sub: examChoiceNote(x),
        on: item.followupForVisitId === x.visitId, attr: 'data-abl-exam', off: !x.pickable,
      }))),
    ];
  }

  // ---------- 底下那一條 ----------

  function paintBar(p = plan()) {
    const bar = root.querySelector('[data-abl-bar]');
    const checked = items.filter((i) => i.checked && !savedKeys.has(i.key));
    const stuck = checked.filter((i) => p.problems[i.key]);
    // 11：按了「改成 Abovee 的」的那幾列跟新的那幾段一起在「記錄」那一下寫
    const n = checked.length + items.filter((i) => i.adopt && !savedKeys.has(i.key)).length;
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
    if (t.dataset.ablGone) { goSee(t.dataset.ablGone); return; }

    const key = t.closest('[data-abl-row]')?.dataset.ablRow;
    const at = items.findIndex((i) => i.key === key);
    if (at < 0) return;
    const item = items[at];
    const set = (next) => { items[at] = next; repaintRow(key); };

    if (t.matches('[data-abl-check]')) { set({ ...item, checked: !item.checked }); return; }
    if (t.matches('[data-abl-adopt]')) { set({ ...item, adopt: !item.adopt }); return; }
    if (t.matches('[data-abl-split]')) {
      // 拆開成兩段：換回原本那兩列（一般的兩段，各扣各的）。不再合 —— 她拆的
      items.splice(at, 1, ...item.merged.parts.map((p) => ({ ...p, checked: item.checked && p.checked })));
      if (attention.has(key)) item.merged.parts.forEach((p) => attention.add(p.key));
      if (openKey === key) openKey = null;
      paintBody();
      return;
    }
    if (t.matches('[data-abl-open]')) {
      const before = openKey;
      openKey = openKey === key ? null : key;
      if (before && before !== key) repaintRow(before);
      repaintRow(key);
      return;
    }
    if (t.matches('[data-abl-find]')) {
      finding.set(key, '');
      repaintRow(key);
      rowEl(key)?.querySelector('[data-abl-query]')?.focus();
      return;
    }
    if (t.dataset.ablWho) { pickWho(key, t.dataset.ablWho); return; }
    if (t.dataset.ablOpt) { set(pickOption(item, t.dataset.ablOpt, ctx)); return; }
    if (t.dataset.ablNth) { set({ ...item, nth: Number(t.dataset.ablNth) }); return; }
    if (t.dataset.ablMin) { set({ ...item, minutes: Number(t.dataset.ablMin) }); return; }
    if (t.dataset.ablEq) { set({ ...item, equipmentId: t.dataset.ablEq }); return; }
    if (t.dataset.ablIv) { set({ ...item, ivProductId: t.dataset.ablIv }); return; }
    if (t.dataset.ablExam) { set({ ...item, followupForVisitId: t.dataset.ablExam }); return; }
    if (t.dataset.ablRoom) { set({ ...item, roomId: t.dataset.ablRoom }); return; }
    if (t.matches('[data-abl-allrooms]')) { showAllRooms.add(key); repaintRow(key); return; }
    if (t.dataset.ablTherapist || t.dataset.ablDoctor) {
      const staffId = t.dataset.ablTherapist ?? t.dataset.ablDoctor;
      // 服務資源那一格認不出來、她選了人 → 存的時候記住那個寫法（12 的 `aliasWrites()`）。
      // 認不認得照翻譯那一次（`readAbovee()` 分了角色）—— 這裡再問一次不分角色的會跟它不一樣
      const unknownText = item.row.resource && !item.staffKnown ? item.row.resource : null;
      set({
        ...item,
        ...(t.dataset.ablTherapist ? { therapistId: staffId } : { doctorId: staffId }),
        staffPickText: unknownText,
      });
    }
  });

  // 找人的框：打字只換候選那一塊，不重畫整列（中文選字打到一半不可以斷）
  root.addEventListener('input', (e) => {
    const box = e.target.closest?.('[data-abl-query]');
    const key = box?.closest('[data-abl-row]')?.dataset.ablRow;
    const item = items.find((i) => i.key === key);
    if (!item) return;
    finding.set(key, box.value);
    const found = rowEl(key)?.querySelector('[data-abl-found]');
    if (found) found.innerHTML = whoChips(item);
  });

  function rowEl(key) {
    return [...root.querySelectorAll('[data-abl-row]')].find((el) => el.dataset.ablRow === key) ?? null;
  }

  /**
   * 「是誰」選了一位：換了人整列重算（`resolveItem()`）；**她自己選的人不自動勾**（那一支的規則）。
   * **先讀那一位的全部來訪**（09）—— 照片上沒認出他，打開時沒有替他讀；拿壓表那一頁的 180 天去算就是原本那個 bug。
   * 讀的那一下她可能又按了別的：回來之後照 key 再找一次那一列，記好了的不動。
   */
  async function pickWho(key, customerId) {
    finding.delete(key);
    await loadHistory([customerId]);
    if (closed) return;
    const at = items.findIndex((i) => i.key === key);
    if (at < 0 || savedKeys.has(key)) return;
    // 換成的這一位，別張照片上可能已經有同一段了（同一頁拍了兩次、這一張名字抄錯）—— 再看一次（`markRepeat()`）
    items[at] = markRepeat(resolveItem(items[at], customerId, ctx), items);
    repaintRow(key);
  }

  function onKey(e) {
    if (e.key !== 'Escape' || document.querySelector('.dialog-backdrop, .seenview')) return;
    // 找人的框裡按 Esc 是清掉打的字，不是收掉整層
    if (e.target?.matches?.('[data-abl-query]') && e.target.value) return;
    requestClose();
  }
  document.addEventListener('keydown', onKey);

  function onHash() { close({ fromBack: true }); }
  window.addEventListener('hashchange', onHash);

  // ---------- 存 ----------

  /** @param {{then?: string}} [o] `then`：全部記好之後去日曆那一天（「app 有、這次照片上沒有」那一顆） */
  async function save({ then = null } = {}) {
    const p = plan();
    const groups = p.groups.filter((g) => g.items.every((i) => !savedKeys.has(i.key)));
    const adopts = items.filter((i) => i.adopt && !savedKeys.has(i.key));
    const n = groups.reduce((sum, g) => sum + g.items.length, 0) + adopts.length;
    if (!n || running || asking) return;
    asking = true;
    try {
      await record(groups, adopts, n, then);
    } finally {
      asking = false;
    }
  }

  /**
   * 「app 有、這次照片上沒有」底下那一顆（ADR-0129）：沒有勾起來的就直接去；有的話先走既有的存檔
   *（同一道確認框），全部記好才換頁 —— 按了取消、或有一位沒記成，就留在這一層。
   */
  async function goSee(date) {
    if (!pendingCount()) { leaveTo(date); return; }
    await save({ then: date });
  }

  /** 問一次（ADR-0104）、按下去才寫。`save()` 已經擋掉連點與空的。 */
  async function record(groups, adopts, n, then = null) {
    const aliases = aliasWrites(
      items.filter((i) => i.staffPickText && (i.therapistId || i.doctorId) && i.checked)
        .map((i) => ({ text: i.staffPickText, staffId: i.therapistId ?? i.doctorId })),
      ctx.master.staff,
    );
    const marks = queueMarksAfter(groups.map((g) => ({ customerId: g.customerId, date: g.date })), batches);
    const nameOf = (id) => ctx.customers.find((c) => c.id === id)?.name ?? '';

    // 句子一個字都不在這裡組（`consequences.js`，asks-2026-09-24-evening/issues/07）——
    // 以前在這裡，壓表與日曆新增後來跟上的「會多幾張掛號」「補登過去那一天」它都沒跟上。
    // 這裡只把 id 換成名字交過去。併進既有那一天的，先讀那一筆身上的任務（同壓表那一道，
    // `schedule.js` 的 `listByVisitForSync()`）—— 舊任務蓋住整天，不讀的話會講一張不會長的
    const merging = groups.map((g) => g.visit?.id).filter(Boolean);
    const tasksByVisit = Object.fromEntries(await Promise.all(merging.map(async (id) => (
      [id, await tasksData.listByVisitForSync(id).catch(() => [])]))));
    if (closed) return;
    const said = aboveeConsequences({
      groups,
      coursesById: Object.fromEntries((ctx.master.courses ?? []).map((c) => [c.id, c])),
      today: ctx.today,
      tasksByVisit,
      adopts,
      aliases: aliases.flatMap((a) => a.changes.aboveeNames.slice(-1).map((text) => ({ text, name: a.name }))),
      marks: marks.map((m) => ({
        names: m.customerIds.map(nameOf),
        month: monthLabel(batches.find((b) => b.id === m.batchId)?.targetMonth ?? ''),
      })),
    });
    const ok = await confirmAction({
      title: said.title,
      consequences: said.lines,
      confirmLabel: '已確認，記錄',
    });
    if (!ok || closed) return;

    running = true;
    failure = null;
    paintBody();
    let current = null;
    const doneNow = [];

    // 一位一天一個 commit：新的段與「改成 Abovee 的」（11）併在同一個「重讀之後重組」裡
    const days = new Map();
    for (const g of groups) {
      days.set(`${g.customerId}|${g.date}`, { customerId: g.customerId, customerName: g.customerName, date: g.date, items: g.items, adopts: [] });
    }
    for (const a of adopts) {
      const k = `${a.customerId}|${a.existing.date}`;
      const day = days.get(k) ?? { customerId: a.customerId, customerName: nameOf(a.customerId), date: a.existing.date, items: [], adopts: [] };
      day.adopts.push(a);
      days.set(k, day);
    }
    /** 寫的時候發現別的裝置剛改過、沒改成的那幾列（她看到的不是現在的值） */
    const stale = [];

    // **重試只會記一次**：先到的那一趟記好的，另一趟看到 savedKeys 就跳過
    const write = async () => {
      for (const d of days.values()) {
        if ([...d.items, ...d.adopts].every((i) => savedKeys.has(i.key))) continue;
        current = d;
        const fresh = await visitsData.listByCustomer(d.customerId);
        // 用剛讀回來的那一份重組一次：她在別的裝置上剛改過那一天的話，不可以蓋掉
        const [again] = d.items.length
          ? planAbovee(d.items, { ...ctx, visitsBy: { ...ctx.visitsBy, [d.customerId]: fresh } }).groups : [];
        const toSave = new Map();
        if (again) toSave.set(again.visit.id ?? '(new)', again.visit);
        const missedHere = [];
        for (const a of d.adopts) {
          const base = toSave.get(a.existing.visitId) ?? fresh.find((v) => v.id === a.existing.visitId);
          const out = base ? adoptAbovee(base, [a]) : { visit: null, missed: [a] };
          missedHere.push(...out.missed);
          if (!out.missed.length) toSave.set(a.existing.visitId, out.visit);
        }
        // eslint-disable-next-line no-await-in-loop
        for (const visit of toSave.values()) await visitsData.save(visit, fresh);
        [...d.items, ...d.adopts].forEach((i) => savedKeys.add(i.key));
        stale.push(...missedHere);
        savedCount += d.items.length + d.adopts.length - missedHere.length;
        if (d.items.length) {
          doneNow.push({ customerId: d.customerId, date: d.date });
          savedDays.push({ customerId: d.customerId, date: d.date });
        }
        if (!closed) paintBody();
      }
      return doneNow.length + adopts.length;
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
    const missedLine = (missed.size ? `；${[...missed].join('、')}沒記上，到壓表那一頁手動補` : '')
      + (stale.length ? `；${stale.length} 段的治療師／診間剛在別的裝置上改過，這裡沒改 —— 去日曆看那一天` : '');
    // 11 沒改成的那幾段：她看到的不是現在的值。講出來、那一列不再寫「已經記進日曆了」
    for (const i of stale) {
      const at = items.findIndex((x) => x.key === i.key);
      savedKeys.delete(i.key);
      if (at >= 0) items[at] = { ...items[at], adopt: false, diffs: null };
    }
    if (closed) {
      if (missedLine) toast.failed(`記好了 ${savedCount} 段${missedLine}`);
      return;
    }
    const left = items.some((i) => (i.checked || i.adopt) && !savedKeys.has(i.key));
    if (!failure && !left) {
      // 「先記勾起來的，再去日曆」：換頁收掉這一層（hashchange），不先退紀錄。
      // 確認框收掉時排的那一趟 history.go 要先回來，不然它會把換頁退掉（`whenSettled()`）
      if (then) await whenSettled();
      if (then) leaveTo(then);
      else close();
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
    const pending = items.filter((i) => (i.checked || i.adopt) && !savedKeys.has(i.key)).length;
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

