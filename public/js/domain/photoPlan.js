// 拍方案文宣 → 方案範本的草稿（issue 07，ADR-0099）。純函式。
//
// 她 2026-09-17：「拍方案 → 新增方案範本，可以再設定方案範本新增旁邊多一個相機的icon…
// 然後說辯是到了什麼內容，然後可以微調」。
//
// **AI 只抄字**（`functions/transcripts/planFlyer.js`），這一支把字翻成主檔：
// - 文宣寫 `高能量雷射 或 超磁場 或 INDIBA 共計60min` ×12，主檔要的是
//   `{ type: 'pool', optionEquipmentIds: [...], durationMin: 60, qty: 12 }`
// - **擇一池還是單一課程由這裡決定**：「或」連起來的器材是擇一池（ADR-0075：池換的是器材），
//   `SIS(60)` 那種寫法交給舊表那一支 `rowShape()`，其餘比課程的名字
// - **項目的名字不抄文宣**，由 `autoLabel()` 算（ADR-0078）
// - **認不出來就空著**，帶著原字讓她選；不猜
//
// 回傳兩份：`plan` 是要存的東西（跟手打的一模一樣），`seen` 是畫面上「照片上寫的是」要印的原字。

import { SHEET_COURSE_ALIASES, rowShape } from './legacyImport.js';
import { autoLabel, idsForPoolKind, POOL_SET_ALL, POOL_SET_HOME } from './entitlements.js';
import { planItem } from './masterData.js';

/** 文宣上的正式名稱 → 主檔課程名。舊表那一份（`SHEET_COURSE_ALIASES`）也一起查。 */
export const FLYER_COURSE_ALIASES = Object.freeze({
  經皮靜脈雷射: 'ILIB',
  靜脈雷射: 'ILIB',
});

/** 器材的舊名與簡寫 → 器材主檔的全名。「超磁場」是 SIS 的舊名（SPEC 第 12 節）。 */
export const EQUIPMENT_ALIASES = Object.freeze({
  超磁場: 'SIS',
  超磁: 'SIS',
  高能: '高能量雷射',
  IN: 'INDIBA',
});

const squash = (s) => String(s ?? '').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
const live = (rows) => (rows ?? []).filter((r) => !r.deletedAt);

/** 「12」「12次」→ 12。讀不出來回 null（驗證會擋），不是 1。 */
export function quantityOf(text) {
  const m = String(text ?? '').match(/\d+/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 「60min」「共計60min」「30分鐘」→ 分鐘；沒寫回 null。 */
export function minutesOf(text) {
  const m = String(text ?? '').match(/(\d+)\s*(min|分)/i);
  return m ? Number(m[1]) : null;
}

/** 「會籍 1 年(限本人)」→ 12；「6個月」→ 6；沒寫 → 12（新增方案的預設）。 */
export function membershipMonthsOf(text) {
  const s = String(text ?? '');
  const y = s.match(/(\d+)\s*年/);
  if (y) return Number(y[1]) * 12;
  const mo = s.match(/(\d+)\s*個?\s*月/);
  return mo ? Number(mo[1]) : 12;
}

function frequencyOf(detail) {
  const m = String(detail ?? '').match(/每(季|月|週|周|年)\s*一次/);
  return m ? m[0].replace('周', '週').replace(/\s/g, '') : '';
}

function courseByName(text, courses) {
  const s = squash(text);
  const want = FLYER_COURSE_ALIASES[s] ?? SHEET_COURSE_ALIASES[s] ?? s;
  return live(courses).find((c) => squash(c.name) === squash(want)) ?? null;
}

function equipmentByName(token, equipment) {
  const s = squash(token);
  const full = EQUIPMENT_ALIASES[s.toUpperCase()] ?? EQUIPMENT_ALIASES[s] ?? s;
  return live(equipment).find((e) => squash(e.name).toLowerCase() === squash(full).toLowerCase()
    || (e.shortName && squash(e.shortName).toLowerCase() === squash(full).toLowerCase())) ?? null;
}

/**
 * 一個項目 → 主檔的形狀。認不出來回 null。
 * @returns {{type: 'pool', optionEquipmentIds: string[]}|{type: 'single', courseId: string}|null}
 */
export function shapeOf(text, durationMin, master) {
  // 一、「A 或 B 或 C」：每一個都要認得出來，才是擇一池
  const parts = String(text ?? '').split(/\s*(?:或|\/|／|、)\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const hits = parts.map((p) => equipmentByName(p, master.equipment));
    return hits.every(Boolean) ? { type: 'pool', optionEquipmentIds: [...new Set(hits.map((e) => e.id))] } : null;
  }

  // 二、舊表認得的寫法（`SIS(60)`、`任選(30)`、`ILIB 60`）
  const shape = rowShape(durationMin && !/\(/.test(text) ? `${squash(text)}(${durationMin})` : text);
  if (shape?.kind === 'pool' && shape.only) {
    const eq = equipmentByName(shape.only, master.equipment);
    if (eq) return { type: 'pool', optionEquipmentIds: [eq.id] };
  }
  // 「任選(30)」「三選一(60)」：復能自己的那幾台（ADR-0075）；四選一是全部還在用的器材。
  // 沒寫幾選一的「任選」先照三選一 —— 跟舊表匯入同一個決定（她 2026-09-15：之後個別問）。
  // 組法借加購那一排的 `idsForPoolKind()`，跟 `legacyImport.js` 的 `poolIdsFor()` 同一份
  if (shape?.kind === 'pool' && !shape.only) {
    const ids = idsForPoolKind(shape.set === 'all' ? POOL_SET_ALL : POOL_SET_HOME, master);
    if (ids?.length) return { type: 'pool', optionEquipmentIds: ids };
  }
  if (shape?.kind === 'single') {
    const c = courseByName(shape.course, master.courses);
    if (c) return { type: 'single', courseId: c.id };
  }

  // 三、只有一台器材的名字
  const eq = equipmentByName(text, master.equipment);
  if (eq && eq.courseId) {
    const home = live(master.courses).find((c) => c.id === eq.courseId);
    // 那一台自己就是一門課（ILIB）→ single；其餘是只有一台的擇一池
    if (home && squash(home.name).toLowerCase() === squash(eq.name).toLowerCase()) {
      return { type: 'single', courseId: home.id };
    }
    return { type: 'pool', optionEquipmentIds: [eq.id] };
  }

  // 四、課程名稱
  const c = courseByName(text, master.courses);
  return c ? { type: 'single', courseId: c.id } : null;
}

/**
 * @param {object} transcript `planFlyer` 的抄字
 * @param {{courses: object[], equipment: object[], ivProducts?: object[]}} master
 * @returns {{plan: {name: string, membershipMonths: number, note: string|null, items: object[]},
 *            seen: {title: string, priceText: string, membershipText: string,
 *                   items: {text: string, detailText: string, quantityText: string, unresolved: boolean}[]}}}
 */
export function planDraftFrom(transcript = {}, master = {}) {
  const items = [];
  const seenItems = [];

  for (const raw of transcript.items ?? []) {
    const text = String(raw.text ?? '').trim();
    const detail = String(raw.detailText ?? '').trim();
    const minutes = minutesOf(detail) ?? minutesOf(text);
    const shape = shapeOf(text, minutes, master);
    const course = shape?.type === 'single'
      ? live(master.courses).find((c) => c.id === shape.courseId) : null;

    const base = planItem({
      type: shape?.type ?? 'single',
      qty: quantityOf(raw.quantityText),
      // 文宣沒寫時長 → 單一課程帶課程的預設；擇一池沒有課程可以帶，空著讓她填
      durationMin: minutes ?? course?.durationMin ?? null,
      courseId: shape?.type === 'single' ? shape.courseId : null,
      optionEquipmentIds: shape?.type === 'pool' ? shape.optionEquipmentIds : [],
      frequencyRule: frequencyOf(detail),
      label: '',
    });
    // 名字算出來的（ADR-0078）；認不出來的那一項先放原字，她選了課程之後編輯器會照舊帶
    base.label = shape ? autoLabel(base, master) || text : text;

    items.push(base);
    seenItems.push({
      text,
      detailText: detail,
      quantityText: String(raw.quantityText ?? ''),
      unresolved: !shape,
    });
  }

  const price = String(transcript.priceText ?? '').replace(/[$＄\s]/g, '').replace(/^NT/i, '');
  const noteBits = [price ? `總價 ${price}` : '', /限本人/.test(transcript.membershipText ?? '') ? '限本人' : '']
    .filter(Boolean);

  return {
    plan: {
      name: String(transcript.title ?? '').trim(),
      membershipMonths: membershipMonthsOf(transcript.membershipText),
      note: noteBits.join('，') || null,
      items,
    },
    seen: {
      title: String(transcript.title ?? ''),
      priceText: String(transcript.priceText ?? ''),
      membershipText: String(transcript.membershipText ?? ''),
      items: seenItems,
    },
  };
}
