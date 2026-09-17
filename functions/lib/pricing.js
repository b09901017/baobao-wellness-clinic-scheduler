// 估計花費。ADR-0100「估計花費照 2027 年的價格算」。
//
// **這裡的數字是漲價之後的。** 3.8 Flash 優惠價到 2026-12-31（輸入 US$0.75、
// 輸出 US$3.75／百萬 token），2027-01-01 起翻倍。照翻倍後的算，今年底前畫面上
// 的數字會比帳單高；換到的是上限不會在元旦那天突然只擋得住一半 —— 那一天
// 沒有人會記得回來改這張表。
//
// 改這張表的時候：ADR-0100 的價格日期、設定 → AI 用量那一顆 `?` 的說明要一起看。

export const MODEL = 'gemini-3.8-flash';

/** 每一個 token 多少美元。thinking 算輸出。 */
export const USD_PER_TOKEN = Object.freeze({
  input: 1.5 / 1_000_000,
  output: 7.5 / 1_000_000,
});

/**
 * 一次呼叫模型最多可以吐多少 token（thinking ＋ 抄出來的字）。
 * Abovee 一頁 10 列 × 9 欄抄出來大約兩千 token，其餘是 thinking 的空間。
 */
export const MAX_OUTPUT_TOKENS = 12_000;

/**
 * 預留時當作輸入有多少 token：一張長邊 2000px 的照片（高解析度約一千出頭）
 * ＋ 提示詞 ＋ 格式。寧可估多 —— 預留多了只是暫時看起來花比較多，
 * 回來之後就換成實際值。
 */
export const INPUT_RESERVE_TOKENS = 8_000;

/** 美元，取到小數第六位（百萬分之一美元），存進 Firestore 的是這個。 */
export const roundUsd = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;

/**
 * 一次呼叫實際估計花多少。
 * @param {{inputTokens?: number, outputTokens?: number}} usage
 */
export function estimateUsd(usage = {}) {
  const input = Math.max(0, Number(usage.inputTokens) || 0);
  const output = Math.max(0, Number(usage.outputTokens) || 0);
  return roundUsd(input * USD_PER_TOKEN.input + output * USD_PER_TOKEN.output);
}

/** 叫之前先預留的那一筆：輸入估多一點、輸出照上限算。 */
export const RESERVE_USD = estimateUsd({
  inputTokens: INPUT_RESERVE_TOKENS,
  outputTokens: MAX_OUTPUT_TOKENS,
});
