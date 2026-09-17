// 方案文宣的抄字格式。欄位在 issue 03 補齊（ADR-0099 的三條規矩見 index.js）。

export const planFlyer = {
  schema: { type: 'object', properties: {}, required: [] },
  prompt: '這是一張方案文宣的照片。只抄照片上寫的字，照格式回傳。',
};
