// 認人：人名＋病歷號交叉比對（issue 11，ADR-0103）。純函式。
//
// 她 2026-09-17：「病歷號可以拿來認 Abovee 上的人嗎 ? 可以拿來交叉比對，人名和病歷號」。
//
// 照片帶入（拍 Abovee、療程單）要知道那一列是 app 裡的哪一位。只用名字的話同名的兩位分不開、
// AI 抄錯一個字就認不得（2026-09-17 考試 Abovee 姓名 9/10）；只用號碼的話有的客戶身上沒有那則備註。
// 所以兩樣一起比，**對不上的時候不挑一位** —— `numberOnly`、`conflict`、`ambiguous` 的 `customer`
// 一律是 null，只給候選讓她選。挑一個「最像的」就是把一段時間記到別人身上，而畫面上看起來是認得的。
//
// 病歷號**是一格**（`customer.chartNo`，ADR-0160，2026-10-19 推翻 ADR-0050 的「是一則備註」）。
// 畫面上它照樣在備註那一段（一顆丸子），資料上跟電話、LINE 一樣是客戶身上的一格。
// **舊的「病歷號 1234」短備註照樣認**（`CHART_NO_PREFIX`）：還沒搬的資料庫、合併檔那一側（`merge.mjs`）
// 都還是那個寫法 —— 搬家由匯入與資料健檢做（`customerNotes.js` 的 `chartNoMove()`）。

import { readMarks } from './customerMarks.js';
import { CHART_NO_PREFIX, OLD_CHART_NO_PREFIX } from './legacyImport.js';
import { normalizeAlias, oneCharOff } from './masterData.js';

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

/**
 * 名字去掉所有空白（含全形空白）、全形半形一致、英文不分大小寫。
 * 跟治療師「Abovee 上的寫法」是同一個比法（`masterData.js` 的 `normalizeAlias()`），只寫一份。
 */
export const normalizeName = normalizeAlias;

export const sameName = (a, b) => {
  const x = normalizeName(a);
  return Boolean(x) && x === normalizeName(b);
};

/**
 * 一則短備註裡的病歷號（前綴後面那幾個字，原字去掉頭尾空白）；不是那一種回 null。
 * 舊的說法「姓名欄的編號：」也認。
 */
export function chartNoInMark(text) {
  const t = String(text ?? '').trim();
  const prefix = PREFIXES.find((p) => t.startsWith(p));
  if (!prefix) return null;
  return t.slice(prefix.length).trim() || null;
}

/**
 * 這位客戶身上記著哪幾個病歷號（已經正規化）。**那一格排第一個**，接著是還寫成短備註的
 * （兩種說法都認）—— 一樣的不重複。
 */
export function chartNosOf(customer) {
  const out = [];
  const add = (raw) => {
    const no = raw == null ? '' : normalizeChartNo(raw);
    if (no && !out.includes(no)) out.push(no);
  };
  add(customer?.chartNo);
  for (const { text } of readMarks(customer)) add(chartNoInMark(text));
  return out;
}

/**
 * 照片上的一個人 → app 裡的哪一位。
 *
 * | how | 條件 | customer |
 * |---|---|---|
 * | both | 名字與病歷號都對上同一位 | 那一位 |
 * | nearName | 病歷號對上**剛好一位**、名字跟他差一個字（三個字以上、一樣長，`oneCharOff()`） | 那一位 |
 * | numberOnly | 病歷號對上、名字不一樣（改過名、字打錯） | null |
 * | nameNoChart | 名字對上**剛好一位**、照片上有號碼、那一位身上一個號碼都沒有 | 那一位 |
 * | nameOnly | 名字對上一位、照片上沒有號碼 | 那一位 |
 * | conflict | 名字對上 A、病歷號對上 B；或名字對上的人身上的號碼跟照片不一樣 | null |
 * | ambiguous | 同名好幾位、號碼分不開 | null |
 * | none | 都沒有 | null |
 *
 * 已刪除、已停用的客戶不參與。
 *
 * **`nameNoChart` 是 2026-10-19 從 `nameOnly` 分出來的**（ADR-0160）：以前那一格算 `nameOnly`、拍 Abovee 預設打勾 ——
 * 照片上那一位可能是**另一個人**（還沒建進 app、或剛好同名），而 app 那一位沒有號碼可以核對。`customer` 照舊是他
 *（多半就是他），但畫面上**不先勾、講一句**（`chartNoSay()`），她勾了存的時候順便把號碼記上（`chartNoWrites()`）。
 *
 * **`nearName` 是 2026-10-06 放寬的那一格**（ADR-0128）。她：「直接算吻合」。兩個訊號都指向同一位，只是 AI 把名字裡
 * 一個少見的字抄錯（考試 Abovee 姓名 9/10）。兩個字的名字不放寬 —— 差一個字等於只有姓或名一樣，
 * 號碼再看錯一位就認到另一位身上。**畫面上一定要講出來**（`nearNameSay()`），不是安靜地當成完全吻合。
 *
 * @param {{name?: string, chartNo?: string}} seen 照片上寫的
 * @param {object[]} customers
 * @returns {{customer: object|null, how: 'both'|'nearName'|'numberOnly'|'nameNoChart'|'nameOnly'|'conflict'|'ambiguous'|'none',
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
  if (byNumber.length === 1 && oneCharOff(normalizeName(name), normalizeName(byNumber[0].name))) {
    return answer('nearName', byNumber, byNumber[0]);
  }
  if (byNumber.length) return answer('numberOnly', byNumber);

  if (byName.length) {
    // 照片上有號碼、名字對上的人身上也有號碼，卻一個都對不上 —— 名字說是他、號碼說不是
    if (photoNo && byName.some((c) => chartNosOf(c).length)) return answer('conflict', byName);
    if (byName.length > 1) return answer('ambiguous', byName);
    return answer(photoNo ? 'nameNoChart' : 'nameOnly', byName, byName[0]);
  }
  return answer('none', []);
}

/**
 * `nearName` 那一種畫面上的那一句（ADR-0128）。拍 Abovee 與療程單兩個確認層共用 —— 各寫一句的話遲早一邊沒講。
 * 不是那一種、或她已經換成別人（`pickedId` 不是認人那一次認的那一位）就是空字串 —— 那一句講的是認人那一次的事。
 *
 * @param {ReturnType<typeof identifyCustomer>} who
 * @param {string} seenName 照片上的名字（原字）
 * @param {string|null} [pickedId] 那一列現在是誰（沒給就當成還是認人那一次那一位）
 */
export function nearNameSay(who, seenName, pickedId = who?.customer?.id) {
  if (who?.how !== 'nearName' || !pickedId || pickedId !== who.customer?.id) return '';
  return `病歷號對上了，名字跟照片上差一個字（照片上是「${String(seenName ?? '').trim()}」）—— 當成這一位；不是的話換一位`;
}

/**
 * `nameNoChart` 那一種畫面上的那一句（ADR-0160）。拍 Abovee 與療程單兩個確認層共用（同 `nearNameSay()`）。
 * 號碼印去掉前面 0 的（照片上是補零的 `00001234`，她打的是 `1234`）。
 * 不是那一種、或她已經換成別人 → 空字串。
 *
 * @param {ReturnType<typeof identifyCustomer>} who
 * @param {string} seenChartNo 照片上的病歷號（原字）
 * @param {string|null} [pickedId] 那一列現在是誰（沒給就當成還是認人那一次那一位）
 * @param {{then?: string}} [o] 是他的話要做什麼：拍 Abovee 是「勾起來」，療程單沒有勾、是「照常存」
 */
export function chartNoSay(who, seenChartNo, pickedId = who?.customer?.id, { then = '勾起來' } = {}) {
  if (who?.how !== 'nameNoChart' || !pickedId || pickedId !== who.customer?.id) return '';
  const no = normalizeChartNo(seenChartNo);
  if (!no) return '';
  return `app 上這一位還沒有病歷號，照片上是 ${no} —— 是他的話${then}，存的時候順便記上`;
}

/**
 * 存的時候要順便記上的病歷號（ADR-0160）。同 `abovee.js` 的 `aliasWrites()`：**只寫空著的**、寫好了下一次算出來是空的。
 *
 * - 只收 `nameNoChart`、而且那一列現在還是認人那一次那一位的（她換了人就不寫 —— 照片上的號碼是照片上那個人的）
 * - 那一位身上現在已經有號碼（那一格或還寫成短備註的）→ 不寫
 * - 同一位好幾列、號碼不一樣 → 不寫（拿不準是哪一個）
 * - 寫去掉前面 0 的（`normalizeChartNo()`）—— 比較像她自己打的
 *
 * @param {{who: object, chartNo: string, customerId: string|null}[]} rows 她勾了、要存的那幾列
 * @param {object[]} customers 現在手上那一份（寫好一次要換掉，不然再按一次會再寫一次）
 * @returns {{id: string, name: string, changes: {chartNo: string}}[]}
 */
export function chartNoWrites(rows = [], customers = []) {
  const byId = new Map();
  for (const r of rows ?? []) {
    if (r?.who?.how !== 'nameNoChart' || !r.customerId || r.customerId !== r.who.customer?.id) continue;
    const no = normalizeChartNo(r.chartNo);
    if (!no) continue;
    byId.set(r.customerId, [...(byId.get(r.customerId) ?? []), no]);
  }
  const out = [];
  for (const [id, nos] of byId) {
    const customer = (customers ?? []).find((c) => c?.id === id);
    if (!customer || chartNosOf(customer).length || new Set(nos).size > 1) continue;
    out.push({ id, name: customer.name ?? '', changes: { chartNo: nos[0] } });
  }
  return out;
}
