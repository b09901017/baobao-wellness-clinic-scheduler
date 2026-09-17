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

/** 模型叫多久還沒回來就放棄。比 Function 的 60 秒短，才來得及記帳。 */
const MODEL_TIMEOUT_MS = 50_000;

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
          abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
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
