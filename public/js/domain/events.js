// 行事備註與休假。SPEC 第 5.3 節、ADR-0015。純函式。
//
// 這是唯一可以跨天的資料。「來訪」的定義是「客戶某一天到院一次」（見 CONTEXT.md），
// 跨天的來訪不存在，所以那兩件事刻意不共用同一個形狀 ——
// 合成一個集合再用欄位區分，會讓「這筆要不要扣次數」變成到處都要判斷的分支，
// 而漏判一次就是次數算錯。這裡的程式碼碰不到額度，也就不可能扣錯。
//
// **2026-08-23 改名：「個人行程」→「行事備註」。** 只改畫面上的字，
// `category` 的 id（`personal` / `leave`）一個都沒動 —— Firestore 裡已經有的
// 資料不必搬。日曆上那四類見 ADR-0045。

import { addDays, daysBetween, isValidDate, shortDate } from './dates.js';
import { isValidTime, toMinutes } from './visitTime.js';
import { MARK_COLORS } from './customerMarks.js';

/**
 * 兩種，差別是實質的：休假那幾天她根本不在，任何來訪都排不進去；
 * 行事備註只是那個時段有事，其餘時間照樣排得了。
 */
export const CATEGORIES = [
  { id: 'personal', label: '行事備註', kind: 'kind-personal' },
  { id: 'leave', label: '休假', kind: 'kind-leave' },
];

export const DEFAULT_CATEGORY = 'personal';

const BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/** 不認得的類別原樣顯示，不要吞掉 —— 那代表資料有問題，要看得見。 */
export function describeCategory(id) {
  return BY_ID[id]?.label ?? `未知類別（${id}）`;
}

/** 日曆上這一種要用哪一組顏色。CSS 那邊是 .kind-personal / .kind-leave。 */
export function kindClass(id) {
  return BY_ID[id]?.kind ?? 'kind-personal';
}

/**
 * 她可以替一筆行事備註自己挑的顏色。
 *
 * 「公出、宜蘭休假、高齡演講」對系統來說一律是「那個時段有事」——
 * 它們之間**沒有系統看得懂的差別**，但對她來說差很多，而那個差別只有她知道。
 * 這跟客戶身上的備註是同一個形狀（ADR-0019），所以名單直接借
 * `domain/customerMarks.js` 的六色：色票只能有一份，兩個地方各挑六個顏色，
 * 遲早會變成兩組不一樣的六色。
 *
 * **存的是名字不是色碼。** 存色碼的話深色模式那一份就沒有人換得掉，
 * 而且以後要調色就得回頭改每一筆資料。見 ADR-0040。
 */
export const EVENT_COLOR_OPTIONS = MARK_COLORS.map(({ id, label }) => ({ id, label }));

export const EVENT_COLORS = EVENT_COLOR_OPTIONS.map((c) => c.id);

/**
 * 這筆行事備註要用哪一組顏色的 class。
 *
 * **沒挑或認不得就回空字串**，讓呼叫端落回 `kindClass()` 那一類本來的顏色。
 * 這跟 `describeCategory()` 對不認得的類別大聲講出來刻意不同：
 * 類別錯了是資料壞了、要看得見；顏色沒挑只是她還沒挑，畫成預設色才是對的。
 * 2026-08 以前建的那幾筆身上都沒有這個欄位，那些不是壞資料。
 */
export function colorClass(event) {
  const color = event?.color;
  return EVENT_COLORS.includes(color) ? `evcolor-${color}` : '';
}

/**
 * 日曆上這一筆實際要套的顏色 class。挑過就用挑的，沒挑就用那一類的。
 *
 * 休假挑了顏色時**兩個 class 都給**：`.kind-leave` 身上那條斜線紋不跟著顏色走。
 * 那條紋路講的是「這幾天我不在」，不是一種配色（ADR-0039、0040）。
 * CSS 那邊 `.evcolor-*` 排在 `.kind-*` 後面，所以顏色由挑的那個決定，
 * 紋路由 `.kind-leave` 決定 —— 兩者管的是不同的屬性，不會互相蓋掉。
 */
export function paintClass(event) {
  const color = colorClass(event);
  if (!color) return kindClass(event?.category);
  return isLeave(event) ? `${color} kind-leave` : color;
}

export function isLeave(event) {
  return event?.category === 'leave';
}

/** 這筆行事備註還算不算數。 */
export function isLive(event) {
  return Boolean(event) && !event.deletedAt;
}

// ---------- 檢查 ----------

/**
 * 存檔前的檢查。
 *
 * 行事備註不綁客戶、不產生任務、不扣次數，所以這裡沒有任何「只提示」的警告 ——
 * 錯的東西就是錯的，其餘都不關系統的事。
 *
 * @returns {{errors: string[]}}
 */
export function validateEvent(event) {
  const errors = [];
  const e = event ?? {};

  if (!String(e.title ?? '').trim()) errors.push('要有名稱');
  if (!BY_ID[e.category]) errors.push('要選一種：行事備註或休假');

  // 顏色是選填的（沒挑就跟著類別走），但挑了就要是認得的那六個之一。
  // 顯示端對舊資料寬容（`colorClass()` 落回預設），這裡不寬容 ——
  // 那份寬容是為了已經存在的資料，不是為了讓新的髒資料寫得進來。
  if (e.color != null && e.color !== '' && !EVENT_COLORS.includes(e.color)) {
    errors.push('不認得的顏色');
  }

  if (!isValidDate(e.startDate)) errors.push('開始日期不對');
  if (!isValidDate(e.endDate)) errors.push('結束日期不對');

  if (isValidDate(e.startDate) && isValidDate(e.endDate) && e.endDate < e.startDate) {
    errors.push('結束日期比開始日期早');
  }

  if (!e.allDay) {
    if (!isValidTime(e.startTime)) errors.push('開始時間不對');
    if (!isValidTime(e.endTime)) errors.push('結束時間不對');
    // 只有同一天才比得了時間。跨天的「22:00 到隔天 06:00」是合理的。
    if (
      isValidTime(e.startTime) &&
      isValidTime(e.endTime) &&
      e.startDate === e.endDate &&
      toMinutes(e.endTime) <= toMinutes(e.startTime)
    ) {
      errors.push('結束時間不比開始時間晚');
    }
  }

  return { errors };
}

// ---------- 範圍 ----------

/** 這筆行事備註蓋到那一天沒有。跨天的中間每一天都算。 */
export function coversDate(event, date) {
  if (!isLive(event) || !isValidDate(date)) return false;
  if (!isValidDate(event.startDate) || !isValidDate(event.endDate)) return false;
  return event.startDate <= date && date <= event.endDate;
}

/** 跟 from–to 這段有沒有重疊。日曆一次只讀畫得出來的範圍。 */
export function overlapsRange(event, from, to) {
  if (!isLive(event)) return false;
  if (!isValidDate(event.startDate) || !isValidDate(event.endDate)) return false;
  return event.startDate <= to && event.endDate >= from;
}

export function inRange(events, from, to) {
  return (events ?? []).filter((e) => overlapsRange(e, from, to));
}

/** 一筆行事備註橫跨幾天。同一天是 1。 */
export function lengthInDays(event) {
  if (!isValidDate(event?.startDate) || !isValidDate(event?.endDate)) return 0;
  return daysBetween(event.startDate, event.endDate) + 1;
}

/**
 * 休假蓋掉的日子。
 *
 * 壓表的小日曆要把這些劃掉 —— 她人不在，那幾天排了也是白排。
 * 行事備註不算：那只是某個時段有事，其餘時間照樣排得了。
 *
 * @returns {Set<string>}
 */
export function blockedDates(events, from, to) {
  const out = new Set();
  for (const event of inRange(events, from, to)) {
    if (!isLeave(event)) continue;
    for (let d = event.startDate; d <= event.endDate; d = addDays(d, 1)) {
      if (d >= from && d <= to) out.add(d);
    }
  }
  return out;
}

// ---------- 月檢視的排版 ----------

/**
 * 把行事備註攤成每一週的色條。
 *
 * 月檢視上跨天的東西要畫成橫跨格子的一條，不是每天一個圓點 ——
 * 看不出從哪天到哪天的話，那條資訊等於沒給。一筆跨週的行事備註會在每一週
 * 各得到一段，所以回傳的是「每週各自的色條」而不是「每筆行事備註一條」。
 *
 * 同一週裡的色條要疊成好幾層（lane），層數有上限，放不下的用「+N」表示 ——
 * 格子撐爛比少講幾筆更糟。
 *
 * @param {object[]} events
 * @param {{date:string, inMonth:boolean}[][]} weeks calendar.js 的 monthWeeks()
 * @param {{maxLanes?: number}} [opts]
 * @returns {{bars: object[], more: number[]}[]} 與 weeks 等長。
 *   bars 的 col 是 1–7（CSS grid-column 從 1 起算），span 是橫跨幾格，
 *   lane 從 0 起算。more[i] 是第 i 天被擠掉幾筆。
 */
export function layoutMonth(events, weeks, { maxLanes = 3 } = {}) {
  return (weeks ?? []).map((week) => layoutWeek(events, week, maxLanes));
}

function layoutWeek(events, week, maxLanes) {
  const from = week[0]?.date;
  const to = week[week.length - 1]?.date;
  if (!from || !to) return { bars: [], more: [0, 0, 0, 0, 0, 0, 0] };

  const pieces = inRange(events, from, to)
    .map((event) => {
      const startIdx = Math.max(0, daysBetween(from, event.startDate));
      const endIdx = Math.min(6, daysBetween(from, event.endDate));
      return { event, startIdx, endIdx };
    })
    .filter((p) => p.startIdx <= p.endIdx)
    // 長的排上面、早開始的排前面。順序固定，她換裝置回來看到的排版才一樣。
    .sort(
      (a, b) =>
        a.startIdx - b.startIdx ||
        b.endIdx - b.startIdx - (a.endIdx - a.startIdx) ||
        String(a.event.title).localeCompare(String(b.event.title), 'zh-TW'),
    );

  const lanes = [];
  const bars = [];
  const more = [0, 0, 0, 0, 0, 0, 0];

  for (const piece of pieces) {
    const lane = firstFreeLane(lanes, piece);
    if (lane >= maxLanes) {
      for (let i = piece.startIdx; i <= piece.endIdx; i += 1) more[i] += 1;
      continue;
    }
    (lanes[lane] ??= []).push(piece);
    bars.push({
      id: piece.event.id,
      title: piece.event.title,
      category: piece.event.category,
      // 呼叫端可以自己指定顏色組。日曆的月檢視要把來訪與行事備註排在同一組
      // lane 裡（否則兩種東西會互相蓋住），所以它會餵進來訪並自己標 kind。
      kind: piece.event.kind ?? paintClass(piece.event),
      col: piece.startIdx + 1,
      span: piece.endIdx - piece.startIdx + 1,
      lane,
      // 從上一週延續過來、或延續到下一週。UI 可以用它決定要不要把邊角切平。
      continuesBefore: piece.event.startDate < from,
      continuesAfter: piece.event.endDate > to,
    });
  }

  return { bars, more };
}

function firstFreeLane(lanes, piece) {
  for (let lane = 0; ; lane += 1) {
    const taken = lanes[lane];
    if (!taken) return lane;
    const clash = taken.some((p) => p.startIdx <= piece.endIdx && p.endIdx >= piece.startIdx);
    if (!clash) return lane;
  }
}

// ---------- 日檢視 ----------

/**
 * 某一天的行事備註，分成整天的與有時間的。
 *
 * 整天的釘在畫面最上面，不進時間軸 —— 它沒有時間，硬塞進時間軸只能擺在某個
 * 假的位置上，那會讓人以為它只佔那一格。
 */
export function dayEvents(events, date) {
  const covering = (events ?? []).filter((e) => coversDate(e, date));

  const allDay = [];
  const timed = [];

  for (const event of covering) {
    // 跨天但有時間的，中間那幾天對她來說就是整天都有事
    const isMiddleDay = event.startDate !== date || event.endDate !== date;
    if (event.allDay || isMiddleDay) allDay.push(withSpanLabel(event, date));
    else timed.push(withSpanLabel(event, date));
  }

  timed.sort(
    (a, b) =>
      (isValidTime(a.startTime) ? toMinutes(a.startTime) : Infinity) -
        (isValidTime(b.startTime) ? toMinutes(b.startTime) : Infinity) ||
      String(a.title).localeCompare(String(b.title), 'zh-TW'),
  );
  allDay.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-TW'));

  return { allDay, timed };
}

/**
 * 「什麼時候」那一句：跨天的給日期範圍、整天的就寫整天、其餘給起訖時間。
 *
 * 日曆的格子與資訊卡片講的是同一件事，所以只有這一份 —— 兩份的下場是
 * 同一筆行事備註在兩個地方寫得不一樣，而她會以為那是兩筆。
 */
export function spanLabel(event) {
  const e = event ?? {};
  if (lengthInDays(e) > 1) return `${shortDate(e.startDate)}–${shortDate(e.endDate)}`;
  if (e.allDay) return '整天';
  return `${e.startTime}–${e.endTime}`;
}

function withSpanLabel(event, date) {
  return {
    ...event,
    kind: paintClass(event),
    spanLabel: spanLabel(event),
    isFirstDay: event.startDate === date,
    isLastDay: event.endDate === date,
  };
}

/**
 * 每一天有幾筆。週檢視的格子用。
 *
 * @returns {Record<string, number>}
 */
export function countByDate(events, from, to) {
  const out = {};
  for (const event of inRange(events, from, to)) {
    for (let d = event.startDate; d <= event.endDate; d = addDays(d, 1)) {
      if (d < from || d > to) continue;
      out[d] = (out[d] ?? 0) + 1;
    }
  }
  return out;
}
