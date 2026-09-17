// AI 用量：設定頁那一頁要講的數字，與拍照辨識沒做到時要講的那一句（ADR-0100）。
//
// **上限的數字真正生效的地方在 `functions/lib/guard.js`**（Function 部署時只帶那個資料夾）。
// 這裡是同一組數字的第二份，給畫面講得出「天花板是多少」；
// `tests/ai-usage.test.js` 盯著兩邊一樣。
//
// 她 2026-09-17：「如果可以的話可以在設定那邊看到目前用了多少ai錢」。
// 這一頁上的每一個數字都是**估計**，照 2027 年的價格算，不是 Google 的帳單。

/** 跟 `functions/lib/guard.js` 同一組數字。 */
export const DEFAULT_MONTHLY_CAP_USD = 10;
export const CEILING_USD = 30;
export const DAILY_LIMIT = 150;

/** 快到上限的那一條線：進度條從這裡開始變色。 */
export const WARN_RATIO = 0.8;

export const KIND_LABELS = Object.freeze({
  orderForm: '訂購單',
  planFlyer: '方案文宣',
  aboveeList: 'Abovee 畫面',
  treatmentSheet: '療程單',
});

const TZ = 'Asia/Taipei';

function taipeiParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour') === '24' ? '00' : get('hour'), mm: get('minute') };
}

/** `aiUsage/{這一格}`：台灣時間的年月。跟 Function 的 `monthKey()` 同一個算法。 */
export function monthKey(now = new Date()) {
  const { y, m } = taipeiParts(now);
  return `${y}-${m}`;
}

/** 每天次數的那一格。 */
export function dayKey(now = new Date()) {
  const { y, m, d } = taipeiParts(now);
  return `${y}-${m}-${d}`;
}

/** 她在設定頁看到的上限：沒填是預設值，填超過天花板就是天花板。 */
export function effectiveCap(config = {}) {
  const raw = config?.monthlyCapUsd;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_MONTHLY_CAP_USD;
  return Math.min(Math.max(0, n), CEILING_USD);
}

/**
 * 每月上限那一格。**跟欄位的 `min="0" step="1"` 講同一句話**（`tests/number-fields.test.js`）。
 * @returns {string[]} 錯誤，空的就是存得下去
 */
export function validateCap(value) {
  if (value === null || value === undefined || value === '') return ['每月上限要填一個數字'];
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return ['每月上限要是 0 或正數'];
  if (!Number.isInteger(n)) return ['每月上限填整數美元'];
  if (n > CEILING_USD) return [`每月上限最多 US$${CEILING_USD}（程式裡的天花板，填再大也只算 US$${CEILING_USD}）`];
  return [];
}

/** US$1.23。小於一分錢但不是 0 的寫 <US$0.01，不要讓她以為沒花。 */
export function formatUsd(n) {
  const v = Number(n) || 0;
  if (v > 0 && v < 0.005) return '<US$0.01';
  return `US$${v.toFixed(2)}`;
}

const REASON_SAYS = {
  paused: 'AI 暫停中',
  monthCap: '超過這個月的上限',
  dailyLimit: '今天的次數到了',
};

/** 最近那一列的結果，用人話。 */
export function outcomeText(call = {}) {
  switch (call.outcome) {
    case 'ok': return '成功';
    case 'failed': return '辨識失敗';
    case 'pending': return '辨識中';
    case 'blocked': return `被擋：${REASON_SAYS[call.reason] ?? '沒有叫 AI'}`;
    default: return '—';
  }
}

/** Firestore Timestamp／Date／字串 → Date。 */
const toDate = (at) => (at?.toDate ? at.toDate() : at instanceof Date ? at : at ? new Date(at) : null);

/** 最近那一列的時間：`9/17 14:05`。 */
export function callTime(at) {
  const d = toDate(at);
  if (!d || Number.isNaN(d.getTime())) return '';
  const { m, d: dd, hh, mm } = taipeiParts(d);
  return `${Number(m)}/${Number(dd)} ${hh}:${mm}`;
}

/**
 * 那一頁要畫的全部數字。
 *
 * @param {object|null} usage `aiUsage/{這個月}`
 * @param {object} config `config/ai`
 * @param {object[]} calls `aiUsage/{這個月}/calls`，新的在前
 * @param {Date} now
 */
export function usageView(usage, config, calls = [], now = new Date()) {
  const capUsd = effectiveCap(config);
  const monthUsd = Number(usage?.estUsd) || 0;
  const ratio = capUsd > 0 ? monthUsd / capUsd : (monthUsd > 0 ? 1 : 0);
  return {
    month: monthKey(now),
    monthUsd,
    capUsd,
    percent: Math.min(100, Math.round(ratio * 100)),
    warn: ratio >= WARN_RATIO || capUsd === 0,
    reached: capUsd === 0 || monthUsd >= capUsd,
    paused: config?.paused === true,
    todayCalls: Number(usage?.days?.[dayKey(now)]) || 0,
    dailyLimit: DAILY_LIMIT,
    totalCalls: Number(usage?.calls) || 0,
    blocked: Number(usage?.blocked) || 0,
    kinds: Object.entries(KIND_LABELS).map(([kind, label]) => ({
      kind,
      label,
      calls: Number(usage?.byKind?.[kind]?.calls) || 0,
      estUsd: Number(usage?.byKind?.[kind]?.estUsd) || 0,
    })),
    recent: calls.slice(0, 20).map((c) => ({
      time: callTime(c.at),
      label: KIND_LABELS[c.kind] ?? c.kind ?? '',
      outcome: outcomeText(c),
      outcomeKind: c.outcome ?? '',
      estUsd: Number(c.estUsd) || 0,
    })),
  };
}

/**
 * 辨識沒做到時畫面講的那一句（`data/ai.js` 的 `AiError.reason`）。
 *
 * **沒網路那一句可以說沒辦法**：這一次是真的沒做到，跟離線寫入「不可以說失敗」
 * （`ui/toast.js`，資料已經在本機）是兩件事。暫停與上限要講出去哪裡改。
 */
export function failureSentence(reason, details = {}) {
  switch (reason) {
    case 'offline': return '辨識要連網路，連上之後再按一次';
    case 'paused': return 'AI 暫停中，到設定 → AI 用量打開';
    case 'monthCap': return `這個月的 AI 上限用完了（${formatUsd(details.capUsd ?? 0)}），到設定 → AI 用量調高`;
    case 'dailyLimit': return `今天辨識到 ${DAILY_LIMIT} 次的上限了，明天再拍`;
    case 'notAllowed': return '這個帳號不能用 AI 辨識';
    case 'verify': return '沒辦法確認是從 app 送出的，重新整理之後再試一次';
    case 'tooLarge': return '這張照片太大了，重拍一張';
    default: return '辨識失敗，再試一次';
  }
}
