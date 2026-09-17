// 真的模型：Gemini 3.8 Flash on Agent Platform（ADR-0100）。
//
// **沒有 API key。** `vertexai: true` 讓 SDK 用執行環境的服務帳號（`ai-extract`）授權。
// 3.8 Flash 只在 global region（2026-09-17 查的），所以 location 是 global ——
// Function 在 asia-east1，但照片在哪裡被處理不保證（ADR-0101）。

import { GoogleGenAI } from '@google/genai';

import { MODEL } from './pricing.js';

/**
 * thinking 要想多深。考試（`scripts/ai-exam.mjs`）決定的，結果寫在 ADR-0100。
 * 抄字不需要推理，想太多只是多花輸出 token。
 */
export const THINKING_LEVEL = 'LOW';

/**
 * 一次呼叫（含重試）最多等多久。比 Function 的 120 秒短，才來得及記帳。
 *
 * 2026-09-17 考試量到的：中位數 7 秒，但同時送三張時有四成被 429 擋下
 * （3.8 Flash 在 Standard PayGo 是大家共用的額度），沒被擋的也有幾張超過 50 秒。
 */
const MODEL_DEADLINE_MS = 100_000;

/**
 * 被限流（429）或 Google 那一側暫時出錯時，退避再試。**只重試「沒有算到錢」的那幾種**：
 * 429／5xx 是在模型跑之前就被擋下來的。每一次重試都還在同一次預留的額度裡（`guard.js`）。
 */
export const RETRY = Object.freeze({ attempts: 3, initialDelay: 2, maxDelay: 10, httpStatusCodes: [429, 500, 502, 503, 504] });

export function makeGeminiModel({
  project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
  thinkingLevel = THINKING_LEVEL,
} = {}) {
  // 第一次叫的時候才建：部署時 firebase-tools 會 import 這支檔案來找函式，
  // 那時候不一定有專案 id，也不需要真的連線
  let ai = null;

  return {
    async generate({ image, schema, prompt, maxOutputTokens }) {
      ai ??= new GoogleGenAI({ vertexai: true, project, location: 'global' });
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: image } },
            { text: prompt },
          ],
        }],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          maxOutputTokens,
          thinkingConfig: { thinkingLevel },
          abortSignal: AbortSignal.timeout(MODEL_DEADLINE_MS),
          httpOptions: { retryOptions: RETRY },
        },
      });
      return { text: res.text ?? '', usage: usageOf(res.usageMetadata) };
    },
  };
}

/** thinking 算輸出（價格表就是這樣收的）。 */
export function usageOf(meta = {}) {
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
  };
}
