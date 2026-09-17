// 方案文宣的抄字格式（ADR-0099）。沒有個資。
//
// 版面：方案名、總價格、會籍（「會籍 1 年(限本人)」）、分類（醫療專業諮詢／健康檢測／物理賦能課程），
// 每一個項目有名稱、一行橘色的小字（「30min」「每季一次」「共計60min」）、次數、單價、價值。
//
// 單價與價值不抄：方案範本只記次數（ADR-0003），價格寫在範本的備註裡用的是總價格。

const str = (description) => ({ type: 'string', description });

export const planFlyer = {
  schema: {
    type: 'object',
    properties: {
      title: str('方案的名字，照寫（大字那一行，例：「筋骨強身」）'),
      priceText: str('總價格那一格，照寫（例：「$288,000」）'),
      membershipText: str('會籍那一句，照寫（例：「會籍 1 年(限本人)」）'),
      items: {
        type: 'array',
        description: '表格裡的每一個項目，由上到下',
        items: {
          type: 'object',
          properties: {
            category: str('那一項左邊直排的分類，照寫（例：「物理賦能課程」）'),
            text: str('項目名稱，好幾行就接成一行、中間空一格（例：「高能量雷射 或 超磁場 或 INDIBA」）'),
            detailText: str('名稱底下那一行小字，照寫（例：「共計60min」「每季一次」「60min (不可更換項目)」）'),
            quantityText: str('次數那一格，照寫（例：「12」）'),
          },
          required: ['text', 'quantityText'],
        },
      },
    },
    required: ['title', 'items'],
  },

  prompt: `這是一張診所健康方案的文宣（價目表）照片。
你的工作只有一件：**把照片上寫的字照抄下來**，填進指定的格式。

規矩：
1. 照抄，不翻譯、不換算、不猜。數字照寫成字串。
2. 單價與價值那兩欄不用抄。
3. 看不清楚的格子留空，並在 unreadable 用一句中文講是哪一格。
4. 不是方案文宣、或整張看不清楚時，readable 寫 false，其他都留空。

例：一項寫「高能量雷射 或 / 超磁場 或 / INDIBA」底下小字「共計60min」、次數「12」
→ text「高能量雷射 或 超磁場 或 INDIBA」、detailText「共計60min」、quantityText「12」。`,
};
