// 療程單的抄字格式（ADR-0099、CONTEXT「療程單」）。
//
// 一位客戶一種課程一張。表頭：單子的名字（「EECP 體外反搏療程單」「護理/復能療程單」）、
// 客戶姓名、客戶編號（＝病歷號）、有的有日期（民國年 `115.5.14`）、有的在表頭勾器材
// （Indiba／超磁場／高能量雷射／靜脈雷射）、手寫「共40堂」。
// 每一列：序號、日期（常常沒寫年）、客戶簽名、治療師簽名或章（旁邊常手寫「IN」「ILIB」）、
// 健管師簽名、備註（「20堂/3堂」）、扣課章。
//
// **簽名與章上的名字一個字都不抄**，只抄「有沒有」。

const str = (description) => ({ type: 'string', description });
const bool = (description) => ({ type: 'boolean', description });

export const treatmentSheet = {
  schema: {
    type: 'object',
    properties: {
      title: str('單子上印的名字，照寫（例：「EECP 體外反搏療程單」）'),
      headerDate: str('表頭的日期，照寫（例：「115.5.14」）；沒有就不要這一格'),
      customerName: str('「客戶姓名」那一格寫的名字，照寫'),
      customerNumber: str('「客戶編號」那一格寫的，照寫，前面的 0 要留著'),
      courseText: str('表頭另外寫的課程名稱或方案名，照寫；沒有就不要這一格'),
      headerTicked: {
        type: 'array',
        items: { type: 'string' },
        description: '表頭印好的勾選格裡打勾的那幾個，照印的字寫（例：「Indiba」「高能量雷射」）',
      },
      totalText: str('表頭手寫的總堂數，照寫（例：「共40堂」）；沒有就不要這一格'),
      rows: {
        type: 'array',
        description: '表格裡**日期那一格有寫東西**的每一列，由上到下',
        items: {
          type: 'object',
          properties: {
            seq: str('序號，照寫'),
            date: str('日期那一格，照寫（例：「7/28」「115/6/8」）'),
            signed: bool('「客戶簽名」那一格有沒有簽名'),
            staffSigned: bool('治療師或護理師那一格有沒有簽名或蓋章'),
            deducted: bool('「扣課」那一格有沒有蓋章'),
            itemText: str('那一列手寫的器材或項目簡寫，照寫（例：「IN」「ILIB」）；沒有就不要這一格'),
            ticked: {
              type: 'array',
              items: { type: 'string' },
              description: '那一列自己的勾選格裡打勾的，照印的字寫；那一列沒有勾選格就是空的',
            },
            noteText: str('備註那一格，照寫（例：「20堂/3堂」）'),
          },
          required: ['date', 'signed'],
        },
      },
    },
    required: ['customerName', 'rows'],
  },

  prompt: `這是一張診所「療程單」的照片（客人每做一次療程簽一列的紙）。
你的工作只有一件：**把照片上寫的字照抄下來**，填進指定的格式。

規矩：
1. 照抄，不翻譯、不換算、不猜。日期照寫（「7/28」就寫「7/28」，不要補年份）。
2. **簽名與章上面的名字一個字都不要抄**，只回答「有沒有」（signed、staffSigned、deducted）。
3. 只列日期那一格有寫東西的列。日期有寫但客戶沒簽的，signed 寫 false。
4. 客戶編號前面的 0 要留著。
5. 看不清楚的格子留空，並在 unreadable 用一句中文講是哪一格。
6. 不是療程單、或整張看不清楚時，readable 寫 false，其他都留空。

例：客戶姓名「王小明」、客戶編號「00001234」、第 1 列日期「7/28」有簽名、旁邊寫「IN」、有扣課章
→ customerName「王小明」、customerNumber「00001234」、
  rows [{ seq「1」、date「7/28」、signed true、itemText「IN」、deducted true }]。`,
};
