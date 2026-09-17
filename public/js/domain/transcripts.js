// 四種單子的抄字長什麼樣 —— domain 這一側的那一份（ADR-0099）。
//
// 格式的定義在 `functions/transcripts/`（給模型的 responseJsonSchema 與提示詞）。
// Function 部署時只帶 `functions/` 那個資料夾，所以兩邊是**兩份檔案**，
// 由 `tests/ai-transcripts.test.js` 盯著一模一樣。改一邊就要改另一邊。
//
// 寫法：`'string'`／`'boolean'` 是一格字或是非；`['string']` 是一串字；
// `[{ … }]` 是一串物件；`[['string']]` 是一串字串陣列（Abovee 的列）。
// **沒有任何一格是 id、狀態、課程或器材** —— 那些是翻譯的人（07、09、13、14）的事。

/** 每一種都有的兩格。 */
export const COMMON_FIELDS = Object.freeze({
  readable: 'boolean',
  unreadable: ['string'],
});

export const TRANSCRIPT_FIELDS = Object.freeze({
  orderForm: {
    customerName: 'string',
    formMonth: 'string',
    handwrittenDates: ['string'],
    packages: [{ printedName: 'string', quantity: 'string', noteText: 'string' }],
    checkupTicked: ['string'],
    handwrittenRows: [{ text: 'string', quantity: 'string' }],
    unpaid: 'string',
    obNote: 'string',
    stickyNotes: ['string'],
  },
  planFlyer: {
    title: 'string',
    priceText: 'string',
    membershipText: 'string',
    items: [{ category: 'string', text: 'string', detailText: 'string', quantityText: 'string' }],
  },
  aboveeList: {
    columns: ['string'],
    rows: [['string']],
    pageText: 'string',
  },
  treatmentSheet: {
    title: 'string',
    headerDate: 'string',
    customerName: 'string',
    customerNumber: 'string',
    courseText: 'string',
    headerTicked: ['string'],
    totalText: 'string',
    rows: [{
      seq: 'string',
      date: 'string',
      signed: 'boolean',
      staffSigned: 'boolean',
      deducted: 'boolean',
      itemText: 'string',
      ticked: ['string'],
      noteText: 'string',
    }],
  },
});

export const TRANSCRIPT_KINDS = Object.freeze(Object.keys(TRANSCRIPT_FIELDS));

/** Abovee 列表只抄這九欄（照片上沒有的那一欄不會出現在 `columns`）。 */
export const ABOVEE_COLUMNS = Object.freeze([
  '預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間', '服務資源', '取消原因',
]);
