// 認人：人名＋病歷號交叉比對（issue 11，ADR-0103）。純函式。
//
// 她 2026-09-17：「病歷號可以拿來認 Abovee 上的人嗎 ? 可以拿來交叉比對，人名和病歷號」。
//
// 照片帶入（拍 Abovee、療程單）要知道那一列是 app 裡的哪一位。只用名字的話同名的兩位分不開、
// AI 抄錯一個字就認不得（2026-09-17 考試 Abovee 姓名 9/10）；只用號碼的話有的客戶身上沒有那則備註。
// 所以兩樣一起比，**對不上的時候不挑一位** —— `numberOnly`、`conflict`、`ambiguous` 的 `customer`
// 一律是 null，只給候選讓她選。挑一個「最像的」就是把一段時間記到別人身上，而畫面上看起來是認得的。
//
// 病歷號**不是一個欄位**，是客戶備註裡的一則「病歷號 1234」（`CHART_NO_PREFIX`，ADR-0050）。
// 這一支從備註讀，不另開欄位。

import { readMarks } from './customerMarks.js';
import { CHART_NO_PREFIX, OLD_CHART_NO_PREFIX } from './legacyImport.js';

const PREFIXES = [CHART_NO_PREFIX, OLD_CHART_NO_PREFIX].map((p) => p.trim());

/** Abovee 補零到八位（`00001234`）、手寫會多空白：去掉空白與前面的 0 再比。 */
export function normalizeChartNo(raw) {
  const s = String(raw ?? '').normalize('NFKC').replace(/\s+/g, '');
  return /^\d+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s;
}

export const sameChartNo = (a, b) => {
  const x = normalizeChartNo(a);
  return Boolean(x) && x === normalizeChartNo(b);
};

/** 名字去掉所有空白（含全形空白）、全形半形一致、英文不分大小寫。 */
export function normalizeName(raw) {
  return String(raw ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export const sameName = (a, b) => {
  const x = normalizeName(a);
  return Boolean(x) && x === normalizeName(b);
};

/** 這位客戶身上記著哪幾個病歷號（已經正規化）。舊的說法「姓名欄的編號：」也認。 */
export function chartNosOf(customer) {
  const out = [];
  for (const { text } of readMarks(customer)) {
    const t = String(text ?? '').trim();
    const prefix = PREFIXES.find((p) => t.startsWith(p));
    if (!prefix) continue;
    const no = normalizeChartNo(t.slice(prefix.length));
    if (no && !out.includes(no)) out.push(no);
  }
  return out;
}

/**
 * 照片上的一個人 → app 裡的哪一位。
 *
 * | how | 條件 | customer |
 * |---|---|---|
 * | both | 名字與病歷號都對上同一位 | 那一位 |
 * | numberOnly | 病歷號對上、名字不一樣（改過名、字打錯） | null |
 * | nameOnly | 名字對上一位、沒有號碼說不是他 | 那一位 |
 * | conflict | 名字對上 A、病歷號對上 B；或名字對上的人身上的號碼跟照片不一樣 | null |
 * | ambiguous | 同名好幾位、號碼分不開 | null |
 * | none | 都沒有 | null |
 *
 * 已刪除、已停用的客戶不參與。
 *
 * @param {{name?: string, chartNo?: string}} seen 照片上寫的
 * @param {object[]} customers
 * @returns {{customer: object|null, how: 'both'|'numberOnly'|'nameOnly'|'conflict'|'ambiguous'|'none',
 *            candidates: object[]}}
 */
export function identifyCustomer({ name = '', chartNo = '' } = {}, customers = []) {
  const pool = (customers ?? []).filter((c) => c && !c.deletedAt && c.active !== false);
  const photoNo = normalizeChartNo(chartNo);
  const byNumber = photoNo ? pool.filter((c) => chartNosOf(c).includes(photoNo)) : [];
  const byName = normalizeName(name) ? pool.filter((c) => sameName(c.name, name)) : [];
  const answer = (how, list, customer = null) => ({ customer, how, candidates: list });

  const both = byNumber.filter((c) => byName.includes(c));
  if (both.length === 1) return answer('both', both, both[0]);
  if (both.length > 1) return answer('ambiguous', both);

  if (byNumber.length && byName.length) return answer('conflict', [...byName, ...byNumber]);
  if (byNumber.length) return answer('numberOnly', byNumber);

  if (byName.length) {
    // 照片上有號碼、名字對上的人身上也有號碼，卻一個都對不上 —— 名字說是他、號碼說不是
    if (photoNo && byName.some((c) => chartNosOf(c).length)) return answer('conflict', byName);
    return byName.length === 1 ? answer('nameOnly', byName, byName[0]) : answer('ambiguous', byName);
  }
  return answer('none', []);
}
