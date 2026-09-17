// 顧客會訂購單的抄字格式（ADR-0099）。
//
// 一個月一種版本：表頭印「2026年08月」、貴賓姓名；十列印好或手寫的套組（數量、金額、備註）、
// 功醫健檢兩個勾選格、尚欠尾款、訂單總計、付款與分期欄、OB 專員備註；常貼便利貼。
//
// **不抄**：身分證號、電話、生日、健管師與 OB 的名字、付款方式、分期、銀行、末四碼、發票號、
// 各項金額與總計（她 2026-09-17：「各項金額不用記」）。額度要的是數量，不是金額。

const str = (description) => ({ type: 'string', description });

export const orderForm = {
  schema: {
    type: 'object',
    properties: {
      customerName: str('「貴賓姓名」那一格手寫的名字，照寫'),
      formMonth: str('表頭印的年月，照印的寫（例：「2026年08月」）'),
      handwrittenDates: {
        type: 'array',
        items: { type: 'string' },
        description: '單子上手寫的顧客會或購買日期，照寫（例：「8/27」「0827」）',
      },
      packages: {
        type: 'array',
        description: '套組表格裡**數量那一格有寫東西**的每一列（印好的套組名稱那幾列）',
        items: {
          type: 'object',
          properties: {
            printedName: str('那一列印好的套組名稱，照印的寫（例：「8萬筋骨強身」）'),
            quantity: str('數量那一格寫的，照寫（例：「1」「一」「2」）'),
            noteText: str('那一列備註欄裡手寫的字或記號，照寫；印好的字不用抄'),
          },
          required: ['printedName', 'quantity'],
        },
      },
      checkupTicked: {
        type: 'array',
        items: { type: 'string' },
        description: '「功醫健檢」那一列打勾的選項，照印的字寫（「5萬」「12萬」）；沒勾就是空的',
      },
      handwrittenRows: {
        type: 'array',
        description: '套組表格裡**手寫加上去的**每一列（不是印好的套組名稱）',
        items: {
          type: 'object',
          properties: {
            text: str('手寫的項目名稱，照寫（例：「任選(30)」「EECP 40堂」「SIS 60」）'),
            quantity: str('數量那一格寫的，照寫'),
          },
          required: ['text'],
        },
      },
      unpaid: str('「尚欠尾款」後面寫的，照寫（例：「0」「3萬」「30000」）；空白就不要這一格'),
      obNote: str('「OB專員備註」那一格手寫的字，照寫；空白就不要這一格'),
      stickyNotes: {
        type: 'array',
        items: { type: 'string' },
        description: '貼在單子上的便利貼，一張一段，照寫',
      },
    },
    required: ['customerName', 'packages', 'checkupTicked', 'handwrittenRows'],
  },

  prompt: `這是一張診所「顧客會訂購單」的照片（手寫表格，照片可能是橫的）。
你的工作只有一件：**把照片上寫的字照抄下來**，填進指定的格式。

規矩：
1. 照抄，不翻譯、不換算、不猜。數字照寫成字串（「8萬」就寫「8萬」，「80000,-」就寫「80000,-」）。
2. 看不清楚的格子留空，並在 unreadable 用一句中文講是哪一格。
3. **以下一個字都不要抄，也不要放進任何欄位**：身分證字號、電話、生日、健管師與 OB 的名字、
   付款方式、刷卡分期、銀行、卡號末四碼、發票號、各項金額、訂單總計金額。
4. 不是訂購單、或整張看不清楚時，readable 寫 false，其他都留空。

例：貴賓姓名寫「王小明」、第 3 列「8萬筋骨強身」數量寫「1」、手寫一列「任選(30)」數量「10」、
尚欠尾款「0」→ customerName「王小明」、packages 一列（printedName「8萬筋骨強身」、quantity「1」）、
handwrittenRows 一列（text「任選(30)」、quantity「10」）、unpaid「0」。`,
};
