// 拍 Abovee 的確認層（issue 13，ADR-0104）。
//
// 她 2026-09-17：「一口氣新增很多來訪…版面可以好好用心的設計，畢竟這可能一次會新增很多，
// 有很多資訊，必須要能夠主次分明一目瞭然，要有層次感呼吸感…一樣可以微調…
// 要有沉浸感的不要有種分割感跳到另一個地方的感覺」。
//
// **從壓表那一頁往上長出來的一層**（`pushLayer()`，不換網址），返回鍵收起來。
// 照片底下一個切換（ADR-0170，她 11/3：「不要有說明文字」「切換之後才看到」）：
// - **辨識結果**（預設）：照日期一天一塊、每一列都在，一行說明都沒有。一列一段：時間、客戶、課程＋人／診間、一個小標、
//   會改變寫入結果的那幾種提醒只畫一個**紅字短標記**（`rowTag()`：最要緊的那一個＋「+N」）
// - **發現問題 N**：要改的、要你看、有提醒的、日子過了還沒結案、app 有這次照片上沒有、照片層級的問題 —— 句子都在這一頁
//   （哪幾件、N 是多少只問 `problemsPage()`）。**只畫目前那一頁**：兩頁同時在的話同一列會出現兩次
// 點一列**原地展開**成幾排丸子，展開之後兩頁都看得到全部的句子。
//
// 規則全部在 `domain/aboveeImport.js`（翻譯、分四種、組來訪、標成壓完），這一支只畫與接線。
// **這一層就是 ADR-0086 的第一道**（每一列展開看得到 warnings），存檔前只再問一次（ADR-0104）。
// **會改變寫入結果的那幾種提醒不點開也看得到有事**（ADR-0138、0170）：收著的列一定畫得出短標記，存檔前那一道把句子列出來 ——
// 每一列預設收著而且打著勾，只畫在點開的那一塊裡就等於沒講。
// 照片與辨識出來的字都不存（ADR-0101）：收起來就 `release()`。
//
// 屬性名一律 `data-abl-*`（共用元件不用頁面身上的名字）。

import * as visitsData from '../../data/visits.js';
import * as batchesData from '../../data/batches.js';
import * as tasksData from '../../data/tasks.js';
import * as config from '../../data/config.js';
import * as customersData from '../../data/customers.js';
import { chartNoWrites } from '../../domain/identify.js';
import { examChoiceNote } from '../../domain/followups.js';
import { aboveeConsequences } from '../../domain/consequences.js';
import {
  aboveeLoadRange, absentFromPhoto, briefWarnings, changeLines, customersOnPhoto, goneButtonSay, diffSay, examChoices, mergedLine,
  markRepeat, mismatchSay, missedSay, needsAttention, nearSay, newRowSay, offersChange, optionValueOf, partialSay, pastStillOpen, photoDayPlan,
  photoRowSays, problemsPage, rowGlance, rowTag,
  pickMinutes, pickOption, picksOf, planToWrite, pressedDays, queueMarksAfter, readAbovee, recordBar, recordBarSay, recordedSay, refreshCloseBlocks, repeatSay, resolveItem,
  statusColumnSay, summarizeAbovee, refreshNoExam, wantsWrite, photoChartNos, writePhotoPlan, whatIfChecked,
} from '../../domain/aboveeImport.js';
import { aliasWrites } from '../../domain/abovee.js';
import {
  picksEquipment, assignsFor, shortStatus, slotMinutes,
  equipmentChoicesFor, minuteChoicesFor,
} from '../../domain/visits.js';
import { slotFromPicks } from '../../domain/slotDraft.js';
import { slotOptionsFor, foldOpen } from '../../domain/slotOptions.js';
import { MAX_NTH, MIN_NTH, SECOND, examChoicesForNth, nthLabel } from '../../domain/nthFollowup.js';
import { searchCustomers } from '../../domain/customers.js';
import {
  THERAPIST_ROLE, ivChoicesFor, orderedRoomSlots, picksDoctor, doctorChoicesFor, staffWithRole, GIFT_KINDS, giftLabel,
} from '../../domain/masterData.js';
import { fullNameOf } from '../../domain/naming.js';
import { shortDate, monthLabel } from '../../domain/dates.js';
import { icon } from '../icons.js';
import { pushLayer, whenSettled } from '../nav.js';
import * as toast from '../toast.js';
import { chooseAction, confirmAction } from './dialog.js';
import { esc } from './form.js';
import { tip } from './tip.js';
import { seenChip, wireSeen } from './seen.js';
import * as giftFold from './giftFold.js';

const TAGS = {
  new: '新的', recorded: '已經記了', mismatch: '對不上', unknown: '認不得', saved: '記好了', cancelled: '已取消', change: '要改',
};

/** 要拿去 `chartNoWrites()` 的那幾列：認人那一次的結果、照片上的號碼、現在是誰。 */
const chartNoRows = (list) => list.map((i) => ({ who: i.who, chartNo: i.row?.chartNo, customerId: i.customerId }));

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
  /** 有沒有哪一張沒拍到「預約狀態」那一欄（`readAbovee()` 的 `noStatusColumn`，01） */
  let noStatusColumn = null;
  /** 「要改的」那一塊「補上治療師／診間」那一行管的是哪幾列（畫的時候記著，按那一個勾時一起換） */
  let fillKeys = [];
  /** 那一行點開了沒 —— 按一個勾會整片重畫，不記的話每按一下就收回去 */
  let fillOpen = false;
  let attention = new Set();
  /** 「要你看」裡收起來的那幾列（`pastStillOpen()`：日子過了、Abovee 上還沒結案），跟 `attention` 同一個時機定 */
  let later = new Set();
  /** 收起來的那一組點開了沒（整片重畫時不收回去） */
  let laterOpen = false;
  /**
   * 照片底下那一個切換現在在哪一頁（ADR-0170）：`result` 辨識結果、`problems` 發現問題。**不進網址**（看法不是位置），
   * 跨重畫留著（`paintBody()` 從好幾處被叫）；關掉這一層就忘了
   */
  let view = 'result';
  /** 「發現問題」那一頁畫出來的那幾列（`rowsSig()`）—— 換了就整頁重畫：`repaintRow()` 只換得了畫面上已經有的列 */
  let shownRows = '';
  /**
   * 「照片上寫的」打開過的那幾列（staging-polish 02）。預設收著：那是對照用的原字，她要的時候才看。
   * 按一顆「要做什麼」整列會重畫，所以記在這裡、重畫時照記的畫；關掉確認層就忘了。
   */
  const seenOpen = new Set();
  /** 「送的／體驗…」那一組她按成開著還是收著（staging-polish 03），照列的 key 記；沒記過照 `foldOpen()` */
  const giftOpen = new Map();
  let openKey = null;
  let batches = [];
  let running = false;
  /** 按了記錄、確認框還沒出來（先讀併進那幾天的任務）—— 連點兩下不可以跳兩個框 */
  let asking = false;
  let failure = null;
  let closed = false;
  const savedKeys = new Set();
  /**
   * 同一批裡還沒存的那一次健檢存好之後的真的 id（暫時 id → 真的 id，`resolveSaved()`，ADR-0145）。
   * **跨好幾次按「記錄」**：她先記健檢那一天、之後才記二返那一天時，二返那一列接的照舊是暫時 id
   */
  const savedIds = new Map();
  /** 這一層記好的每一位每一天（跨好幾次按「記錄」）。標壓完照它算。 */
  const savedDays = [];
  /**
   * 每一位第一次按「記錄」時就有的健檢鏈待辦（id）。那一位全部存完之後，這幾張以外、中途長出來、最後用不到的收掉
   *（`dropChainLeftovers()`，10/16 審查）。**跨好幾次按「記錄」**：上一次存到一半長出來的，下一次存完照樣認得出來
   */
  const chainKnown = new Map();
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

    ({ pairing, counts: sizes, items, noStatusColumn } = readAbovee(transcripts, ctx));
    // 打開時要看的那幾列排在最前面，之後不跟著跳（她選了人，那一列不會突然換位置）
    attention = new Set(items.filter(needsAttention).map((i) => i.key));
    later = new Set(items.filter((i) => needsAttention(i) && pastStillOpen(i)).map((i) => i.key));
    paintBody();
  }

  /**
   * 這幾位的**全部**來訪（prelaunch-fixes/09）。壓表那一頁手上只有最近 180 天 —— 半年前打完的那一筆在那一份裡
   * 看起來還有剩，於是預選它、那一列預設打勾、也不講「排完會超過」。讀回來的整份換掉 `visitsBy[那一位]`；
   * 撞期那一份是把 `visitsBy` 攤平再濾日期（`visitsForCheck()`），照舊成立。
   *
   * **讀不到的不安靜地照算**：記進 `ctx.partial`，那一位的列不預設打勾、講一句（`partialSay()`）。
   * 離線、或讀回來的是快取（網路不穩時 SDK 自己退回快取，`navigator.onLine` 照樣是 true）也算讀不到 ——
   * Firestore 離線時不會失敗，回的是快取裡剛好有的那幾筆（`listWhole()` 兩種都丟，ADR-0158）。
   */
  async function loadHistory(ids) {
    const wanted = [...new Set(ids)].filter((id) => id && !whole.has(id));
    if (!wanted.length) return;
    const got = await Promise.all(wanted.map((id) => visitsData.listWhole(id)
      .then((list) => [id, list], () => [id, null])));
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
   * 這一次還沒記的列記完之後長什麼樣（`photoDayPlan()`，abovee-status-follows-photo 06）：驗證與提醒（每一列底下那幾行、「還差一步」）、
   * 存檔前那一道、真的寫入三邊讀同一份 —— 以前這裡自己組一次、確認框與寫入又各組一次。
   * 記好的那幾列不算（`savedKeys`）：它們已經在 `ctx.visitsBy` 裡了（`record()` 存一筆換一筆）。
   */
  function plan() {
    return photoDayPlan(items.filter((i) => !savedKeys.has(i.key)), ctx);
  }

  /** 「app 有、這次照片上沒有」（ADR-0129）。每畫一次算一次 —— 她換了某一列是誰，結果跟著變。 */
  const absentNow = () => absentFromPhoto(transcripts, items, ctx);

  /** 這一次會寫進去、還沒記的那幾列（勾起來的新的、改成 Abovee 的、照片要改狀態與改期的，`wantsWrite()`）。 */
  const pending = () => items.filter((i) => wantsWrite(i) && !savedKeys.has(i.key));
  const pendingCount = () => pending().length;

  function paintSummary(gone = absentNow()) {
    const s = summarizeAbovee(items.filter((i) => !savedKeys.has(i.key)), gone.slots);
    const bits = [
      savedCount ? `記好了 ${savedCount} 段` : '',
      s.new ? `新的 ${s.new} 段` : '',
      s.changes ? `要改 ${s.changes} 段` : '',
      s.recorded ? `已經記了 ${s.recorded} 段` : '',
      s.attention ? `要你看 ${s.attention} 段` : '',
      s.pastOpen ? `過了還沒結案 ${s.pastOpen} 段` : '',
    ].filter(Boolean);
    root.querySelector('[data-abl-sum]').textContent = bits.join('・') || '照片上沒有讀到預約';
  }

  /** 「發現問題」那一頁列哪幾件、N 是多少（`problemsPage()`，ADR-0170）—— 那一顆上的數字與那一頁畫的讀同一份 */
  function pageOf(p, gone) {
    return problemsPage(items.filter((i) => !savedKeys.has(i.key)), p, {
      attention, later, absent: gone, customers: ctx.customers, pairing, noStatusColumn,
    });
  }

  /** 那一頁畫出來的那幾列（`look`／`flagged`／`later`）。要改的與 app 有照片沒有那兩塊每次都整塊換，不用算進來 */
  const rowsSig = (page) => [page.look, page.flagged, page.later].map((keys) => keys.join(',')).join('|');

  function paintBody() {
    const body = root.querySelector('[data-abl-body]');
    const p = plan();
    const gone = absentNow();
    const page = pageOf(p, gone);
    // 在「發現問題」那一頁、最後一件也處理了 → 回到辨識結果（那一顆灰掉了，留在一頁空白上沒有意思）
    if (view === 'problems' && !page.count) view = 'result';
    shownRows = view === 'problems' ? rowsSig(page) : '';

    body.innerHTML = `
      <div class="abl__photos">
        ${photos.map((ph, i) => `
          <button class="abl__thumb" type="button" data-seen-text="" data-seen-photo="${esc(ph.url)}"
                  aria-label="看第 ${i + 1} 張照片"><img src="${esc(ph.url)}" alt="" /></button>`).join('')}
      </div>
      ${segHtml(page.count)}
      ${items.length ? '' : '<p class="abl__empty">照片上沒有讀到任何一列預約。拍含「姓名」那幾欄的那一半試試。</p>'}
      ${view === 'problems' ? problemsHtml(p, page, gone) : resultHtml(p)}`;
    paintSummary(gone);
    paintBar(p);
  }

  /** 照片底下那一個切換（ADR-0170）。樣子照首頁的「總覽／依客戶」；0 件時「發現問題」灰掉 ＝ 檢查過了、沒事 */
  function segHtml(n) {
    return `
      <div class="seg abl__seg" role="group" aria-label="看哪一頁">
        <button class="seg__item" type="button" data-abl-view="result" aria-pressed="${view === 'result'}">辨識結果</button>
        <button class="seg__item" type="button" data-abl-view="problems" aria-pressed="${view === 'problems'}"
                ${n ? '' : 'disabled'}>${segLabel(n)}</button>
      </div>`;
  }

  /** 那一顆的字是一整串（`.seg__item` 是 flex：字與數字拆成兩塊的話，中間那個空格會被吃掉） */
  const segLabel = (n) => `發現問題 ${n}`;

  /** 換了一列之後：只換「發現問題」那一顆的數字與按不按得下去（整頁不重畫） */
  function paintSeg(n) {
    const btn = root.querySelector('[data-abl-view="problems"]');
    if (!btn) return;
    btn.disabled = !n;
    btn.textContent = segLabel(n);
  }

  /** 辨識結果（ADR-0170）：一天一塊、**每一列都在**（要你看的那幾列也回到它那一天），一行說明都沒有 */
  function resultHtml(p) {
    const days = [];
    for (const item of items.slice().sort((a, b) => `${a.date}|${a.startsAt}`.localeCompare(`${b.date}|${b.startsAt}`))) {
      const last = days[days.length - 1];
      if (last && last.date === item.date) last.items.push(item);
      else days.push({ date: item.date, items: [item] });
    }
    return days.map((d) => `
      <section class="abl__group" aria-label="${esc(d.date ?? '讀不出日期')}">
        <h3 class="abl__day">${d.date ? esc(shortDate(d.date)) : '讀不出日期'}</h3>
        <ol class="abl__rows">${d.items.map((i) => rowHtml(i, p)).join('')}</ol>
      </section>`).join('');
  }

  /**
   * 發現問題（ADR-0170）：照片層級 → 要改的 → 要你看 → 有提醒的 → 日子過了還沒結案（收著）→ app 有、這次照片上沒有。
   * 哪幾列在哪一塊只照 `problemsPage()`；每一列底下那幾行提示照畫（這一頁就是給她讀句子的）。
   */
  function problemsHtml(p, page, gone) {
    const byKey = new Map(items.map((i) => [i.key, i]));
    const rowsOf = (keys) => keys.map((k) => byKey.get(k)).filter(Boolean).map((i) => rowHtml(i, p)).join('');
    return `
      ${notesHtml(page.notes)}
      <div data-abl-changes>${changesHtml(p)}</div>
      ${page.look.length ? `
        <section class="abl__group abl__group--look" aria-label="要你看">
          <h3 class="abl__day">要你看</h3>
          <ol class="abl__rows">${rowsOf(page.look)}</ol>
        </section>` : ''}
      ${/* 辨識結果上有紅字短標記的那幾列（連還差一步）—— 看到一個 ⚠ 切過來一定找得到整句 */''}
      ${page.flagged.length ? `
        <section class="abl__group abl__group--flag" aria-label="有提醒的">
          <h3 class="abl__day">有提醒的</h3>
          <ol class="abl__rows">${rowsOf(page.flagged)}</ol>
        </section>` : ''}
      ${/* 中途發現 5：日子過了、Abovee 上還沒結案的那幾列收起來 —— 拍一張比較舊的頁面時一次好幾列，攤開會擠掉真的要決定的 */''}
      ${page.later.length ? `
        <section class="abl__group abl__group--later" aria-label="日子過了、Abovee 上還沒結案">
          <details class="abl__later" ${laterOpen ? 'open' : ''}>
            <summary class="abl__day">日子過了、Abovee 上還沒結案的 ${page.later.length} 段</summary>
            <ol class="abl__rows">${rowsOf(page.later)}</ol>
          </details>
        </section>` : ''}
      <div data-abl-absent>${absentHtml(gone, p, page.absent)}</div>`;
  }

  /**
   * 「要改的」那一塊（abovee-status-follows-photo 07）：照片要改 app 上既有那一段的事，一行一件、預設勾、勾了只改那一件。
   * 句子與次數那一個括號都在 domain（`changeLines()` 讀計畫的 `rows`），這裡只畫。沒有要改的就一個像素都不佔。
   * 屬性用自己的（`data-abl-change`／`data-abl-for`／`data-abl-fill`）—— 不可以是 `data-abl-row`：`repaintRow()` 會拿那一列的樣子把它換掉。
   */
  function changesHtml(p) {
    const { lines, fill } = changeLines(items.filter((i) => !savedKeys.has(i.key)), p, ctx);
    fillKeys = fill?.keys ?? [];
    if (!lines.length && !fill) return '';
    const check = (on, attrs, label) => `<button class="abl-row__check" type="button" role="checkbox" ${attrs}
      aria-checked="${on}" aria-label="${esc(label)}" ${running ? 'disabled' : ''}>${icon('check', { size: 15, width: 2.6 })}</button>`;
    return `
      <section class="abl__group abl__group--change" aria-label="要改的">
        <h3 class="abl__day">要改的</h3>
        <ul class="abl__rows">
          ${lines.map((l) => `<li class="abl-chg">
            ${check(l.on, `data-abl-change="${esc(l.field)}" data-abl-for="${esc(l.key)}"`, '改這一件')}
            <span class="abl-chg__say">${esc(l.text)}</span></li>`).join('')}
          ${fill ? `<li class="abl-chg">
            ${check(fill.on, 'data-abl-fill', '補上這幾段')}
            <details class="abl-chg__more" ${fillOpen ? 'open' : ''}><summary class="abl-chg__say">${esc(fill.text)}</summary>
              <ul class="abl-row__diffs">${fill.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details></li>` : ''}
        </ul>
      </section>`;
  }

  /**
   * 「app 有、這次照片上沒有」那一塊（ADR-0129），在「發現問題」那一頁最後。**只講不改**（ADR-0056、0116）：
   * 列上不放按鈕 —— 「去日曆」按了就離開這一層，而照片不留（ADR-0101），一列一顆的話她看完第一段就要整張重拍。
   * 整塊底下一顆，字講出後果：有勾起來的先走既有的存檔、存完才換頁；沒有就直接去。
   * **都在照片上就不畫**（ADR-0170 推翻 ADR-0129 那一句：「發現問題」那一顆灰掉就是檢查過了、沒事）；講什麼、算幾件只問 `absentShown()`。
   */
  function absentHtml(gone, p, shown = pageOf(p, gone).absent) {
    if (!shown.count) return '';
    const head = `
        <h3 class="abl__day">app 有、這次照片上沒有</h3>
        <p class="abl__absentsay">${esc(shown.say)}</p>`;
    if (!gone.slots.length) {
      return `<section class="abl__group abl__group--gone" aria-label="app 有、這次照片上沒有">${head}</section>`;
    }
    const first = gone.slots[0].date;
    const waiting = pendingCount();
    const stuck = pending().some((i) => p.problems[i.key]);
    return `
      <section class="abl__group abl__group--gone" aria-label="app 有、這次照片上沒有">
        ${head}
        <ol class="abl__rows">${gone.slots.map((s) => `
          <li class="abl-row abl-row--gone">
            <div class="abl-row__line">
              <span aria-hidden="true"></span>
              <div class="abl-row__main">
                <span class="abl-row__time"><small class="abl-row__date">${esc(shortDate(s.date))}</small>${esc(s.startsAt ?? '—')}</span>
                <span class="abl-row__who">${esc(s.customerName)}</span>
                <span class="abl-row__what"><span class="abl-row__glance">${esc(s.name)}</span></span>
                <span class="abl-row__tag">${esc(shortStatus(s.status))}</span>
              </div>
            </div>
          </li>`).join('')}</ol>
        ${onOpenDay ? `<button class="btn btn--sm abl__gone" type="button" data-abl-gone="${esc(first)}"
          ${running || stuck ? 'disabled' : ''}>${esc(goneButtonSay(waiting, first))}</button>` : ''}
      </section>`;
  }

  /**
   * @param {string} key 變了的那一列
   * @param {{was?: string|null}} [o] `was`：這一列原本是哪一位（換一位時傳）—— 他別的列也要跟著重畫
   */
  function repaintRow(key, { was = null } = {}) {
    const p = plan();
    const gone = absentNow();
    const page = pageOf(p, gone);
    // 「發現問題」那一頁列的那幾列換了（拿掉一列的勾、還差一步補好了、最後一件也處理了）→ 整頁重畫：
    // 只換畫面上已經有的列的話，N 會跟列出來的對不上
    if (view === 'problems' && (!page.count || rowsSig(page) !== shownRows)) {
      paintBody();
      return;
    }
    const li = [...root.querySelectorAll('[data-abl-row]')].find((el) => el.dataset.ablRow === key);
    const item = items.find((i) => i.key === key);
    if (li && item) {
      const holder = document.createElement('template');
      holder.innerHTML = rowHtml(item, p).trim();
      li.replaceWith(holder.content.firstElementChild);
    }
    // 警告與「還差一步」會跟著變的別列：**同一位的每一列（不只同一天）、同一天的每一列（不只同一位）**。
    // 超用與撞期是連這一次別組要記的一起算的（`visitsForCheck()`）—— 只重畫同一天同一位的話，
    // 她把別天那一列的勾拿掉，這一列收著的那一行還留著舊的「會超過總次數」（2026-10-09 審查，E2E `62` 的 P4）
    for (const other of items) {
      if (other.key === key) continue;
      const sameWho = Boolean(other.customerId) && [item?.customerId, was].includes(other.customerId);
      // 點開著的那一列（沒勾的話畫著「勾起來的話」）照當下勾著的算 —— 別列勾起或拿掉，它也要重算（09）
      if (!sameWho && other.date !== item?.date && other.key !== openKey) continue;
      const el = [...root.querySelectorAll('[data-abl-row]')].find((x) => x.dataset.ablRow === other.key);
      if (!el) continue;
      const holder = document.createElement('template');
      holder.innerHTML = rowHtml(other, p).trim();
      el.replaceWith(holder.content.firstElementChild);
    }
    // 換了某一列是誰、勾了一列：「app 有、這次照片上沒有」與那一顆按鈕的字跟著變（不在這一頁的那兩塊找不到就跳過）
    const changes = root.querySelector('[data-abl-changes]');
    if (changes) changes.innerHTML = changesHtml(p);
    const absent = root.querySelector('[data-abl-absent]');
    if (absent) absent.innerHTML = absentHtml(gone, p, page.absent);
    paintSeg(page.count);
    paintSummary(gone);
    paintBar(p);
  }

  /**
   * 照片層級的問題（`problemsPage()` 的 `notes`，「發現問題」那一頁最上面；會改變寫進去的東西，不收進 ?）。
   * 左右兩半正常配上不是問題，不畫（ADR-0170）。
   */
  function notesHtml(codes) {
    const say = {
      // 沒拍到「預約狀態」那一欄：看不出完成或取消，照舊記成待確認（01）
      statusColumn: () => esc(statusColumnSay({ noStatusColumn })),
      mismatch: () => `左右兩張的列數不一樣（左 ${sizes.left} 列、右 ${sizes.right} 列），
        <b>沒有對上</b> —— 診間與治療師那幾格空著，點開一列選。`,
      noNames: () => '這一張沒有「姓名」那一欄，認不出是誰。拍含姓名的那一半（最左邊那幾欄）。',
    };
    if (!codes.length) return '';
    return `<div class="abl__notes">${codes.map((c) => `<p class="abl__pairing abl__pairing--warn">${say[c]()}</p>`).join('')}</div>`;
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
    // 照片要改狀態、改期的那一段（04、05）：勾在「要改的」那一塊
    if (item.statusChange || item.move) return 'change';
    if (item.cancelled) return 'cancelled';
    return item.kind;
  }

  function rowHtml(item, p) {
    const tag = tagOf(item);
    const open = openKey === item.key;
    // ADR-0170：「辨識結果」那一頁收著的列一行說明都不畫，只有課程那一行右邊一個紅字短標記；
    // 列底下那幾行在「發現問題」那一頁、或點開之後
    const say = view === 'problems' || open;
    const customer = ctx.customers.find((c) => c.id === item.customerId);
    const built = slotOf(item);
    // 課程＋人／診間，印的是存完之後那一段（`rowGlance()`，abovee-confirm-glance 02）
    const glance = rowGlance(item, p, ctx);
    const canCheck = item.kind === 'new' && item.customerId && !savedKeys.has(item.key) && !running;
    const problems = wantsWrite(item) ? (p.problems[item.key] ?? []) : [];
    const near = nearSay(item);
    // 不點開也要看得到的提醒（ADR-0138）。只有會寫進去的那幾列才算得出來：勾著的、按了「改成 Abovee 的」的
    const must = wantsWrite(item) && !savedKeys.has(item.key) ? (p.mustSeeBy[item.key] ?? []) : [];

    return `
      <li class="abl-row abl-row--${tag}${open ? ' is-open' : ''}${problems.length ? ' has-problem' : ''}" data-abl-row="${esc(item.key)}">
        <div class="abl-row__line">
          <button class="abl-row__check" type="button" role="checkbox" data-abl-check
                  aria-checked="${Boolean(item.checked)}" ${canCheck ? '' : 'disabled'}
                  aria-label="記這一段">${icon('check', { size: 15, width: 2.6 })}</button>
          <button class="abl-row__main" type="button" data-abl-open aria-expanded="${open}">
            <span class="abl-row__time">${view === 'problems' && item.date
              ? `<small class="abl-row__date">${esc(shortDate(item.date))}</small>` : ''}${esc(item.startsAt ?? '—')}</span>
            <span class="abl-row__who">${esc(customer?.name ?? (item.row.name || '？'))}</span>
            <span class="abl-row__what">${glanceHtml(glance)}${flagHtml(rowTag(item, p))}</span>
            <span class="abl-row__tag">${esc(tag === 'unknown' && item.who.how === 'none' ? 'app 裡沒有' : TAGS[tag])}</span>
          </button>
        </div>
        ${item.merged ? `
          <p class="abl-row__merged"><b>合併扣課</b>${esc(mergedLine(item))}
            ${savedKeys.has(item.key) || item.kind !== 'new' ? '' : '<button class="btn btn--sm btn--ghost" type="button" data-abl-split>拆開成兩段</button>'}</p>` : ''}
        ${say ? hintsHtml(item, problems, must, open, near) : ''}
        ${open ? detailHtml(item, built, problems, p.warningsBy[item.key] ?? [], whatIfOf(item)) : ''}
      </li>`;
  }

  /**
   * 列底下那幾行（「發現問題」那一頁、或點開之後才畫，ADR-0170）。每一行講一件事、句子都在 domain。
   */
  function hintsHtml(item, problems, must, open, near) {
    return `
        ${problems.length && !open ? `<p class="abl-row__hint">還差一步：${esc(problems[0])}</p>` : ''}
        ${/* 會改變寫入結果的提醒：收著的列在這一頁畫整句（點開之後在底下那一份完整的裡面，不畫兩次） */''}
        ${open ? '' : briefWarnings(must).map((w) => `<p class="abl-row__hint abl-row__hint--warn">${esc(w)}</p>`).join('')}
        ${/* 為什麼這一列沒有先勾好（ADR-0116） */''}
        ${!problems.length && newRowSay(item) ? `<p class="abl-row__hint">${esc(newRowSay(item))}</p>` : ''}
        ${/* 照片上的狀態為什麼沒先勾（03：還沒到就寫完成、日子過了還沒結案、讀不出來、二返簽不成）—— 勾著的在上面那幾行（mustSee） */''}
        ${wantsWrite(item) || savedKeys.has(item.key) ? '' : photoRowSays(item).map((w) => `<p class="abl-row__hint">${esc(w)}</p>`).join('')}
        ${/* 這一位的全部來訪讀不到（09）：次數可能不準，所以沒有先勾好 */''}
        ${partialSay(item) && !savedKeys.has(item.key) ? `<p class="abl-row__hint">${esc(partialSay(item))}</p>` : ''}
        ${/* 跟另一張照片上的那一列看起來是同一段（10）：所以沒有先勾好 */''}
        ${repeatSay(item) && !savedKeys.has(item.key) ? `<p class="abl-row__hint">${esc(repeatSay(item))}</p>` : ''}
        ${/* 認得、但不是一字不差（ADR-0128） */''}
        ${near && !savedKeys.has(item.key) ? `<p class="abl-row__hint abl-row__hint--near">${esc(near)}</p>` : ''}
        ${/* 中途發現 12：狀態對不上（只提醒）、治療師／診間照 Abovee 改的那一段 —— 留在要你看，這一行講治療師那一件在哪裡勾 */''}
        ${item.kind === 'mismatch' && offersChange(item) && !open && !savedKeys.has(item.key)
          ? `<p class="abl-row__hint">${esc(item.diffs.map((d) => diffSay(d, ctx.master)).join('；'))} —— ${item.adopt
            ? '照 Abovee 改（勾在「發現問題」那一頁最上面「要改的」那一塊）' : '「發現問題」那一頁最上面「要改的」那一塊沒勾，不改'}</p>` : ''}
        ${item.kind === 'recorded' && item.diffs?.length && item.locked && !open
          ? `<p class="abl-row__hint">${esc(item.diffs.map((d) => diffSay(d, ctx.master)).join('；'))}</p>` : ''}`;
  }

  /**
   * 紅字短標記（ADR-0170）：最要緊的那一個＋「+N」，接在課程＋人那一格後面、自己不被截（`.abl-row__flag` 是 `flex: none`）。
   * 字與先後都是 domain 給的（`rowTag()`）—— 這裡不比來源。滑過去（`title`）看得到全部是哪幾種。
   */
  function flagHtml(tag) {
    if (!tag) return '';
    return `<span class="abl-row__flag" title="${esc(tag.all.join('、'))}">${icon('alert', { size: 13, width: 2.2 })}${
      esc(tag.text)}${tag.more ? ` +${tag.more}` : ''}</span>`;
  }

  /**
   * 列上那一行的課程＋人／診間（abovee-confirm-glance 02），樣子照日曆那一列：`IN(60) 姿璇`、`三返 夏`；
   * 還沒有的那一格灰色「醫師？」。一整串一格、太長就截（`.abl-row__glance`）——
   * 右邊接紅字短標記（`flagHtml()`；`.abl-row__what` 是 flex，標記不被截）。
   */
  function glanceHtml(g) {
    const cells = g.cells.map((c) => (c.name
      ? `<span class="abl-row__person">${esc(c.name)}</span>`
      : `<span class="abl-row__person abl-row__person--none">${esc(c.label)}？</span>`)).join('');
    return `<span class="abl-row__glance"><span class="abl-row__course">${esc(g.what)}</span>${cells}</span>`;
  }

  /**
   * 點開的那一列**沒勾**：勾起來的話會怎樣（before-golive-2026-10-19/09）。只在點開時算（同時只開一列，`openKey`），
   * 收著不畫 —— 沒勾的那幾列多半是刻意不勾的；也不進收著的那幾行與確認框的「其中 N 段有提醒」（ADR-0138 的紅線只管會寫進去的）。
   */
  function whatIfOf(item) {
    if (savedKeys.has(item.key)) return null;
    return whatIfChecked(items.filter((i) => !savedKeys.has(i.key)), item.key, ctx);
  }

  /** 「勾起來的話：」那一塊。字跟勾起來之後那幾行一模一樣（同一支算的），錯誤講「存不下去」。 */
  function whatIfHtml(w) {
    if (!w || (!w.problems.length && !w.warnings.length)) return '';
    return `
      <div class="abl-row__whatif" data-abl-whatif>
        <p class="abl-row__say">勾起來的話：</p>
        ${w.problems.length ? `<ul class="abl-row__problems">${w.problems.map((x) => `<li>存不下去 —— ${esc(x)}</li>`).join('')}</ul>` : ''}
        ${w.warnings.length ? `<ul class="abl-row__warnings">${w.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>`;
  }

  // ---------- 展開的那一列 ----------

  function detailHtml(item, built, problems, warnings, whatIf = null) {
    const left = urlOf(item.photos[0]);
    const right = urlOf(item.photos[1] ?? item.photos[0]);
    const r = item.row;
    // 收的只有原字這一排 —— `mustSee()` 的提醒、對不上的理由都在外面，一個字都不收（ADR-0138）
    const seen = `
      <details class="foldout abl-row__seenfold" data-abl-seen="${esc(item.key)}" ${seenOpen.has(item.key) ? 'open' : ''}>
        <summary>照片上寫的</summary>
        <div class="abl-row__seen">
        ${seenChip(item.statusText, { photo: left })}
        ${seenChip(r.date, { photo: left })}
        ${seenChip(r.time, { photo: left })}
        ${seenChip([r.name, r.chartNo].filter(Boolean).join(' '), { photo: left })}
        ${seenChip(r.course, { photo: left })}
        ${seenChip(r.source, { photo: right })}
        ${seenChip(r.room, { photo: right })}
        ${seenChip(r.resource, { photo: right })}
        ${seenChip(r.cancelReason, { photo: right })}
        </div>
      </details>`;

    if (savedKeys.has(item.key)) return `<div class="abl-row__detail">${seen}<p class="abl-row__say">已經記進日曆了。</p></div>`;
    // 「是誰」每一種都換得掉（還沒記好的列）：認錯人的那一列以前只能整列放棄
    const who = whoHtml(item);
    if (item.kind === 'recorded') {
      // 是哪一種已經記了（同一個時間、合併扣課的後一半、沒有時間的舊段）那一句在 domain（`recordedSay()`，11）
      // 上面那一句講的是照片要它改成什麼；這一次會不會改看「要改的」那一塊的勾
      const where = !offersChange(item) ? ''
        : `<p class="abl-row__say">${wantsWrite(item) ? '要不要改，勾在「發現問題」那一頁最上面「要改的」那一塊。' : '「發現問題」那一頁最上面「要改的」那一塊沒勾 —— 這一次不改。'}</p>`;
      return `<div class="abl-row__detail">${seen}<p class="abl-row__say">${esc(recordedSay(item))}</p>${adoptHtml(item, warnings)}${where}${who}</div>`;
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
    // 「要做什麼」那一排跟壓表同一份（`slotOptionsFor()`，ADR-0121）：額度（二返排最後）、＋n返、送的／體驗。
    // **用完的額度也列** —— Abovee 上已經約了，那一段是既成事實；選了照舊有「會超過次數」的提醒
    const options = optionsFor(item);
    const value = optionValueOf(item);
    if (!options.length) {
      rows.push('<p class="abl-row__say">這位客戶身上沒有可以排的額度，主檔上也沒有可以當體驗的課 —— 先去加購再回來記。</p>');
    } else {
      if (!item.course) rows.push('<p class="abl-row__say">照片上的課程那一格認不出來，選這一段要做什麼。</p>');
      // 照分類排、二返那一組另起一行（`arrangeSlotOptions()`，issue 08；小標 issue 16 拿掉了）；
      // 送的／體驗收在最後一顆「送的／體驗…」後面（gift-and-trial 04，壓表與來訪編輯器同一支）
      rows.push(`
        <div class="abl-row__pick">
          <span class="abl-row__picklabel">要做什麼</span>
          ${giftFold.html({
            options, value, key: item.key, open: giftOpen.get(item.key) ?? foldOpen(options, value),
            cls: 'abl-row__chips', sm: true,
            chip: (o) => chipHtml({
              value: o.entitlementId, label: o.label,
              sub: o.isNth || o.isGift || o.isNotMine ? '不扣次數' : `剩 ${o.remaining}`,
              on: o.entitlementId === value, attr: 'data-abl-opt',
            }),
          })}
        </div>`);
      // 照片上是 n返／二返、這一位走不了一般那一條：那一句在 domain（`newRowSay()` 的 `notMineHint`，exam-not-mine 08），
      // 上面那一行講了（列底下那幾行，`hintsHtml()`）—— 這裡不再講一次
    }

    const ent = item.isNth ? null
      : ((ctx.entitlementsBy[item.customerId] ?? []).find((e) => e.id === item.entitlementId) ?? null);
    const course = built?.course ?? null;
    // 送的／體驗的那一段（gift-and-trial 02）：沒有額度，「排多久」那一排多收那門課買的時候分的那幾種
    const giftKind = item.giftCourseId ? (item.giftKind ?? 'trial') : null;
    // 「體驗｜送的」（gift-and-trial 04）：預設體驗（她：「四門都寫體驗」）
    if (giftKind) {
      rows.push(chipRow('體驗或送的', GIFT_KINDS.map((k) => ({
        value: k, label: giftLabel(k), on: k === giftKind, attr: 'data-abl-gift',
      }))));
    }
    // **要不要記器材問 `picksEquipment()`，列哪幾台問 `equipmentChoicesFor()`**（壓表、來訪編輯器同兩支）——
    // 以前只有擇一池才畫這一排：一段體驗的復能停在「先選上面那一台」，而上面一台都沒有
    if (course && picksEquipment(ent, course)) {
      rows.push(chipRow('器材', equipmentChoicesFor(ent, course, ctx.master.equipment, { keep: item.equipmentId })
        .map((e) => ({ value: e.id, label: e.name, on: item.equipmentId === e.id, attr: 'data-abl-eq' }))));
    }
    if (course?.requiresIvProduct) {
      const iv = ivChoicesFor(ent, ctx.master.ivProducts);
      rows.push(chipRow('品項', [...iv.primary, ...iv.others].map((x) => ({
        value: x.id, label: x.name, on: item.ivProductId === x.id, attr: 'data-abl-iv',
      }))));
    }
    if (item.notMine) {
      // 健檢不是她排的（ADR-0169）：只有「第幾返」—— **沒有「接哪一次健檢」**（它不接任何一次）
      rows.push(notMineNthRow(item));
    } else if (item.isNth && course) {
      rows.push(...nthRows(item));
    } else {
      // 連同這一張照片上勾著的健檢一起列（ADR-0145：健檢和二返都是新的，當下就接得上）
      const exams = examChoices(item.customerId, ent, ctx, items, item);
      if (exams.length) {
        // 每一次都標它自己的狀態，**排著的與做完的、沒被佔走的按得下去**（`pickable`，issues/11、ADR-0145）
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
    const minutes = minuteChoicesFor({ entitlement: ent, course, giftKind });
    if (minutes.length) {
      const ivProduct = course.requiresIvProduct
        ? (ctx.master.ivProducts.find((p) => p.id === item.ivProductId) ?? null) : null;
      const now = slotMinutes({ entitlement: ent, course, ivProduct, minutes: item.minutes, giftKind });
      rows.push(chipRow('排多久', minutes.map((n) => ({
        value: String(n), label: `${n} 分`, on: n === now, attr: 'data-abl-min',
      }))));
    }

    // 還沒按任何一顆（照片上三返、還沒按「健檢不是我排的」）組不出時段：治療師／診間／醫師那幾排照照片認出的課程畫
    //（abovee-confirm-glance 02）—— 按了只改這一列的那一格，存檔照舊走 `slotFromPicks()`，組不出來就照舊擋
    const seenCourse = course ? null
      : (ctx.master.courses.find((c) => c.id === item.course?.courseId) ?? null);
    const assigns = course ? assignsFor(ent, course, item.equipmentId) : (seenCourse?.assigns ?? null);
    const peopleCourse = course ?? seenCourse;
    if (course && picksEquipment(ent, course) && !item.equipmentId) {
      rows.push('<p class="abl-row__say">先選上面那一台，才知道要治療師還是診間。</p>');
    } else if (assigns === 'room') {
      // 認到的是停用的那一間（她主檔上停用的診間，ADR-0127）時那一顆也要在上面，不然看起來像沒認到
      const slots = orderedRoomSlots(peopleCourse, ctx.master.rooms, { keep: item.roomId });
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
    if (peopleCourse && picksDoctor(peopleCourse)) {
      // 誰排前面只寫在 `doctorChoicesFor()`（ADR-0120）。**這裡不套 `preselect`** ——
      // 照片上已經寫著是哪一位，認不出來時替她挑一位等於把照片上的字蓋掉
      const { first, others } = doctorChoicesFor(peopleCourse, ctx.master.staff);
      rows.push(chipRow('醫師', [...first, ...others].map((s) => ({
        value: s.id, label: s.name, on: item.doctorId === s.id, attr: 'data-abl-doctor',
      }))));
    }

    const learn = item.staffPickText && (item.therapistId || item.doctorId)
      ? `<p class="abl-row__learn">${icon('check', { size: 13, width: 2.4 })}記住：以後 Abovee 上的「${esc(item.staffPickText)}」都認成 ${esc(
        fullNameOf(ctx.master.staff.find((s) => s.id === (item.therapistId ?? item.doctorId))))}</p>`
      : '';

    return `
      <div class="abl-row__detail">
        ${seen}
        ${rows.join('')}
        ${learn}
        ${problems.length ? `<ul class="abl-row__problems">${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${warnings.length ? `<ul class="abl-row__warnings">${warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${whatIfHtml(whatIf)}
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

  /**
   * 11：「app 是 A、Abovee 是 B」。勾不勾在「要改的」那一塊（07）—— 這裡只列，不再有一顆按鈕（兩個地方都能按就是各記一份）。
   * 已完成的鎖著。
   */
  function adoptHtml(item, warnings) {
    if (!item.diffs?.length) return '';
    return `
      <ul class="abl-row__diffs">${item.diffs.map((d) => `<li>${esc(diffSay(d, ctx.master))}</li>`).join('')}</ul>
      ${item.locked ? '<p class="abl-row__say">已完成的鎖著 —— 要改去日曆那一天。</p>' : ''}
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

  /**
   * 這位客戶這一段可以做什麼（`slotOptionsFor()`，壓表同一支；用完的也列）。最後收在「其他 ▸」裡的是「健檢不是我排的」
   * （exam-not-mine 05、09）：按了走 `pickOption()` 的 `NOT_MINE_PICK`。
   */
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
   * 「健檢不是我排的」那一列的第幾返（ADR-0169）：二返～十返，照片上的字已經按好（`pickOption()`）；照片上不是回訪就沒按，
   * 勾了由 `slotFromPicks()` 擋「先選第幾返」（「還差一步」那一行）。屬性是 `data-abl-nmnth` —— **不是 n返 那一排的 `data-abl-nth`**
   * （來訪編輯器 `s${i}-nmnth`、壓表 `data-nmnth` 同一個分法）。
   */
  function notMineNthRow(item) {
    const numbers = [];
    for (let n = SECOND; n <= MAX_NTH; n += 1) numbers.push(n);
    return chipRow('第幾返', numbers.map((n) => ({
      value: String(n), label: nthLabel(n), on: item.nth === n, attr: 'data-abl-nmnth',
    })), tip('健檢不是你排的：這一場不扣任何次數、不接 app 裡的任何一次健檢。'));
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
    // 新的、改成 Abovee 的（11）、照片要改狀態與改期的（04、05）都在「記錄」那一下寫。
    // 數的是**這一份計畫真的會寫的**（`recordBar()`）—— 勾著卻改不成的不算進去
    const counted = recordBar(pending(), p);
    const { fresh, changed, stuck } = counted;
    const n = fresh + changed;
    // 記新的與改既有的分開數（確認框的抬頭同一種說法，`aboveeConsequences()`）
    const label = !n ? '記錄' : fresh && changed ? `記錄 ${fresh} 段、改 ${changed} 段` : fresh ? `記錄這 ${fresh} 段` : `改這 ${changed} 段`;
    const say = failure
      ? `記好了 ${savedCount} 段；${failure.name} 那一天沒記：${failure.message}。再按一次記剩下的。`
      : recordBarSay(counted);
    bar.innerHTML = `
      ${say ? `<p class="abl__why" role="status">${esc(say)}</p>` : ''}
      <button class="btn btn--primary abl__save" type="button" data-abl-save
              ${!n || stuck || running ? 'disabled' : ''}>${running ? '記錄中…' : label}</button>`;
  }

  // ---------- 接線 ----------

  wireSeen(root);
  // `toggle` 不冒泡 —— 用 capture 接
  root.addEventListener('toggle', (e) => {
    if (e.target.matches?.('.abl-chg__more')) fillOpen = e.target.open;
    if (e.target.matches?.('.abl__later')) laterOpen = e.target.open;
    if (e.target.matches?.('[data-abl-seen]')) {
      if (e.target.open) seenOpen.add(e.target.dataset.ablSeen);
      else seenOpen.delete(e.target.dataset.ablSeen);
    }
  }, true);

  root.addEventListener('click', (e) => {
    // 「送的／體驗…」與「別的課當體驗」的分類：只改屬性、不重畫這一列（gift-and-trial 04）
    if (giftFold.toggle(e, (key, open) => giftOpen.set(key, open))) return;
    const t = e.target.closest('button');
    if (!t || t.disabled || !root.contains(t)) return;
    if (t.matches('[data-abl-close]')) { requestClose(); return; }
    if (t.matches('[data-abl-save]')) { save(); return; }
    // 照片底下那一個切換（ADR-0170）：換一頁＝整頁重畫（只畫目前那一頁），焦點放回那一顆
    if (t.dataset.ablView) {
      if (t.dataset.ablView !== view) {
        view = t.dataset.ablView;
        paintBody();
        root.querySelector(`[data-abl-view="${view}"]`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (t.dataset.ablDay) { leaveTo(t.dataset.ablDay); return; }
    if (t.dataset.ablGone) { goSee(t.dataset.ablGone); return; }
    // 「要改的」那一塊（07）：勾了只改那一件；補上治療師／診間那一行一次換那幾列
    if (t.dataset.ablChange) {
      const was = items.find((i) => i.key === t.dataset.ablFor);
      const field = t.dataset.ablChange;
      if (was) flip([was.key], field, !was[field], `[data-abl-change="${field}"][data-abl-for="${CSS.escape(was.key)}"]`);
      return;
    }
    if (t.matches('[data-abl-fill]')) {
      const on = fillKeys.every((k) => items.find((i) => i.key === k)?.adopt);
      flip(fillKeys, 'adopt', !on, '[data-abl-fill]');
      return;
    }

    const key = t.closest('[data-abl-row]')?.dataset.ablRow;
    const at = items.findIndex((i) => i.key === key);
    if (at < 0) return;
    const item = items[at];
    const set = (next) => {
      items[at] = next;
      // 勾起／拿掉一列（多半是健檢那一列）、或換了接哪一次：同一位的二返那一排與「先去約健檢」那一句跟著變（ADR-0145）
      if (next.checked !== item.checked || next.followupForVisitId !== item.followupForVisitId) {
        refreshNoExam(items, ctx).forEach((x, j) => { items[j] = x; });
        // 二返簽不簽得成已完成跟著同一批的健檢勾不勾變（03，中途發現 7）
        refreshCloseBlocks(items, ctx).forEach((x, j) => { items[j] = x; });
        for (const x of items) if (x.customerId === next.customerId && x.key !== key) repaintRow(x.key);
      }
      repaintRow(key);
    };

    if (t.matches('[data-abl-check]')) { set({ ...item, checked: !item.checked }); return; }
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
    if (t.dataset.ablOpt) { set(pickOption(item, t.dataset.ablOpt, ctx, items)); return; }
    if (t.dataset.ablNth) { set({ ...item, nth: Number(t.dataset.ablNth) }); return; }
    // 「健檢不是我排的」那一列的第幾返（ADR-0169）：只換返數，標記、醫師、時長照舊
    if (t.dataset.ablNmnth) { set({ ...item, nth: Number(t.dataset.ablNmnth) }); return; }
    // 按到那門課的「體驗的時候排幾分」→ 換成體驗（ADR-0154，壓表、來訪編輯器同一支 `trialFromMinutes()`）
    if (t.dataset.ablMin) { set(pickMinutes(item, Number(t.dataset.ablMin), ctx, items)); return; }
    if (t.dataset.ablGift) { set({ ...item, giftKind: t.dataset.ablGift }); return; }
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

  /**
   * 「要改的」那一塊按了一個勾：那幾列的那一格換掉。照片上那一次健檢不改成已完成的話，同一位的二返跟著簽不成 ——
   * 新的列重算記號（`refreshCloseBlocks()`），既有那一段的由計畫講（`changeLines()` 讀 `plan.missed`）。整片重畫、焦點放回那一個勾。
   */
  function flip(keys, field, value, focus) {
    for (const key of keys) {
      const at = items.findIndex((i) => i.key === key);
      if (at >= 0) items[at] = { ...items[at], [field]: value };
    }
    refreshCloseBlocks(items, ctx).forEach((x, j) => { items[j] = x; });
    paintBody();
    root.querySelector(focus)?.focus({ preventScroll: true });
  }

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
    const was = items[at].customerId ?? null;
    // 換成的這一位，別張照片上可能已經有同一段了（同一頁拍了兩次、這一張名字抄錯）—— 再看一次（`markRepeat()`）
    items[at] = markRepeat(resolveItem(items[at], customerId, ctx, items), items);
    // 換了一位：那一排是他的額度了，開或收回到預設
    giftOpen.delete(key);
    // 換成的這一位有沒有接得上的健檢（「先去約健檢」那一句）連同這一批重算
    refreshNoExam(items, ctx).forEach((x, j) => { items[j] = x; });
    refreshCloseBlocks(items, ctx).forEach((x, j) => { items[j] = x; });
    repaintRow(key, { was });
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
    const n = new Set(p.writes.flatMap((w) => w.keys)).size;
    if (!n || running || asking) return;
    asking = true;
    try {
      await record(p, n, then);
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

  /**
   * 問一次（ADR-0104）、按下去才寫。`save()` 已經擋掉連點與空的。
   *
   * **確認框與寫入讀同一份計畫**（`photoDayPlan()`，abovee-status-follows-photo 06）：框講的是 `p`；寫的時候一位一位**重讀**
   * 之後拿同一支再算一次（她在別的裝置上剛改過的話不蓋掉 —— 沒改成的回在 `missed`，照理由講）。
   * 一位的那幾筆照計畫的先後存（被接著的健檢那一天先存），**存一筆換一筆**（`writePhotoPlan()`）：額度快取看得到前一筆、
   * 那幾列記進 `savedKeys`。存到一半失敗再按一次：記好的那幾列不再算，剩下的拿重讀的那一份再組 —— 不重複。
   */
  async function record(p, n, then = null) {
    const aliases = aliasWrites(
      items.filter((i) => i.staffPickText && (i.therapistId || i.doctorId) && i.checked)
        .map((i) => ({ text: i.staffPickText, staffId: i.therapistId ?? i.doctorId })),
      ctx.master.staff,
    );
    const marks = queueMarksAfter(pressedDays(p), batches);
    // 名字對上、app 那一位沒有病歷號、她勾了（ADR-0160）→ 存的時候順便記上。數的是這一次會寫的每一列（連「要改的」）
    const chartNos = photoChartNos(items.filter((i) => !savedKeys.has(i.key)), ctx.customers);
    const nameOf = (id) => ctx.customers.find((c) => c.id === id)?.name ?? '';
    const coursesById = Object.fromEntries((ctx.master.courses ?? []).map((c) => [c.id, c]));
    const people = [...new Set(p.writes.map((w) => w.customerId))];

    // 句子一個字都不在這裡組（`consequences.js`，asks-2026-09-24-evening/issues/07）。這裡只讀它要的那幾份：
    // 會改到的既有那幾筆身上的任務（舊任務蓋住整天，不讀的話會講一張不會長的；照片放掉的段那一句也要它）、
    // 每一位健檢那條鏈的額度與任務（`chainInputs()`，跟存檔時算的同一份）
    const known = [...new Set(p.writes.map((w) => w.visit.id).filter(Boolean))];
    const [tasksByVisit, chainBy] = await Promise.all([
      Promise.all(known.map(async (id) => [id, await tasksData.listByVisitForSync(id).catch(() => [])])).then(Object.fromEntries),
      Promise.all(people.map(async (id) => [id, await visitsData.chainInputs(id, coursesById)])).then(Object.fromEntries),
    ]);
    if (closed) return;
    for (const id of people) {
      if (chainBy[id] && !chainKnown.has(id)) chainKnown.set(id, new Set((chainBy[id].tasks ?? []).map((t) => t.id)));
    }
    // 這一次真的要寫的那幾列身上，不點開也要看得到的提醒（ADR-0138）。沒勾的列不會寫進去，不算
    const flagged = p.writes.flatMap((w) => w.keys.map((key) => ({ customerName: w.customerName, date: w.date, texts: p.mustSeeBy[key] ?? [] })))
      .filter((f) => f.texts.length);
    const said = aboveeConsequences({
      plan: p,
      flagged,
      coursesById,
      today: ctx.today,
      tasksByVisit,
      chainBy,
      // 存一段新的健檢、還有一場二返接在取消的那一次上（ADR-0145）
      entitlementsBy: ctx.entitlementsBy,
      visitsBy: ctx.visitsBy,
      aliases: aliases.flatMap((a) => a.changes.aboveeNames.slice(-1).map((text) => ({ text, name: a.name }))),
      chartNos: chartNos.map((c) => ({ name: c.name, chartNo: c.changes.chartNo })),
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
    /** 寫的時候沒改成的那幾列（她看到的不是現在的值、二返簽不成、存不下去） */
    const missed = [];

    // **重試只會記一次**：先到的那一趟記好的，另一趟看到 savedKeys 就跳過
    const write = async () => {
      for (const customerId of people) {
        current = { customerName: nameOf(customerId) };
        const mine = items.filter((i) => i.customerId === customerId && wantsWrite(i) && !savedKeys.has(i.key));
        if (!mine.length) continue;
        // eslint-disable-next-line no-await-in-loop
        // 讀不完整就停在這一位、講出來（ADR-0158；`save()` 也會擋，這裡先擋省得讀完其餘幾份）
        const fresh = await visitsData.listWhole(customerId, nameOf(customerId));
        // 同一支再算一次；接著同一批別天那一次健檢的，存好了的換成真的 id（跨好幾次按「記錄」，`planToWrite()`）
        const again = planToWrite(mine, { ...ctx, visitsBy: { ...ctx.visitsBy, [customerId]: fresh } }, savedIds);
        // eslint-disable-next-line no-await-in-loop
        await writePhotoPlan(again, {
          hand: fresh,
          save: visitsData.save,
          savedIds,
          onWrite: (w, id, hand) => {
            w.keys.forEach((k) => savedKeys.add(k));
            savedCount += w.keys.length;
            if (w.pressed) savedDays.push({ customerId, date: w.date });
            // 手上那一份換成存好之後的 —— 之後再按一次、或下一位的驗證，看得到這一筆
            ctx = { ...ctx, visitsBy: { ...ctx.visitsBy, [customerId]: hand } };
          },
        });
        // 這一位全部存完了：中途長出來、最後用不到的健檢鏈待辦收掉（確認框講的是最後的樣子）。
        // 存到一半丟出來的錯會跳過這一行 —— 那時候那一張還是對的；收不掉就算了（多一張可以勾掉）
        if (chainKnown.has(customerId)) {
          // eslint-disable-next-line no-await-in-loop
          await visitsData.dropChainLeftovers(customerId, chainKnown.get(customerId), coursesById).catch(() => 0);
        }
        missed.push(...again.missed);
        // 重讀之後組不進去的（那一天驗證沒過）：沒寫、講出來
        for (const i of mine.filter((x) => !savedKeys.has(x.key) && !again.missed.some((m) => m.key === x.key))) {
          missed.push({ ...i, missedWhy: 'invalid', errors: again.problems[i.key] ?? [] });
        }
        if (!closed) paintBody();
      }
      return savedCount;
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
    const unsent = new Set();
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
        unsent.add('治療師在 Abovee 上的寫法');
      }
    }
    // 病歷號同一條（ADR-0160）：記好的那幾列才寫、寫好一次就換掉手上那一份（再按一次算出來是空的）
    for (const c of chartNoWrites(chartNoRows(items.filter((i) => savedKeys.has(i.key))), ctx.customers)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await customersData.update(c.id, c.changes);
        ctx = { ...ctx, customers: ctx.customers.map((x) => (x.id === c.id ? { ...x, ...c.changes } : x)) };
      } catch {
        unsent.add('客戶的病歷號');
      }
    }
    for (const m of queueMarksAfter(savedDays, batches)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await batchesData.saveProgress(m.batchId, m.queue, m.cursor);
        batches = batches.map((b) => (b.id === m.batchId ? { ...b, queue: m.queue } : b));
      } catch {
        unsent.add('壓表清單上的壓完');
      }
    }

    running = false;
    // 來訪已經記好了，這兩件沒寫成不擋 —— 但**要講**：確認框上說了會做。
    // 沒改成的那幾列照理由講（`missedSay()`）—— 以前寫死「治療師／診間剛在別的裝置上改過」
    const why = missedSay(missed);
    const missedLine = (unsent.size ? `；${[...unsent].join('、')}沒記上，到壓表那一頁手動補` : '') + (why ? `；${why}` : '');
    // 沒改成的那幾列：那一列不再寫「已經記進日曆了」，沒改成的那一個勾拿掉（她看到的不是現在的值，不再送一次）。
    // **同一列一件改成了、一件沒改成**（`missedField`，10/16 審查）：改成的那一件是真的寫進去了 —— 那一列照樣算記好了，
    // 只拿掉沒改成的那一個勾（以前整列的勾都拿掉、變回沒記，狀態那一行寫「不改」，其實已經改了）
    for (const i of missed) {
      const at = items.findIndex((x) => x.key === i.key);
      const partly = savedKeys.has(i.key) && Boolean(i.missedField);
      if (!partly) savedKeys.delete(i.key);
      if (at < 0 || i.missedWhy === 'invalid') continue;
      const stale = i.missedWhy === 'stale' ? { diffs: null } : {};
      items[at] = i.missedField
        ? { ...items[at], [i.missedField]: false, ...(i.missedField === 'adopt' ? stale : {}) }
        : { ...items[at], adopt: false, ...stale, adoptStatus: false, adoptMove: false, adoptCharge: false };
    }
    if (closed) {
      if (missedLine) toast.failed(`記好了 ${savedCount} 段${missedLine}`);
      return;
    }
    if (!failure && !pendingCount()) {
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
    const left = pendingCount();
    if (left && !running) {
      const pick = await chooseAction({
        title: `還有 ${left} 段沒記`,
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

