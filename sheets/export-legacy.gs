/**
 * 舊試算表 → 一份文字，貼一次就好
 *
 * 這支是**一次性的**：正式上線前跑一兩次（試一次、真的一次），之後就可以整份刪掉。
 *
 * 為什麼要有它：app 的匯入是貼上文字（見 docs/adr/0012），而 Google 試算表的
 * 剪貼簿一次只能複製一張分頁 —— 21 位客戶就是貼 21 次。這支把全部分頁串成
 * 一份文字，你複製一次，app 那邊自己切開。
 *
 * 它**不碰 Firestore、不需要任何憑證**，只是把你自己的試算表讀出來變成文字。
 * 所以 ADR-0012 的結論沒有變：這還是「貼上」，只是貼一次。
 *
 * ─────────────────────────────────────────────
 * 用法
 *
 * 1. 在**舊的**那份試算表：擴充功能 → Apps Script，把這個檔案貼進去。
 * 2. 回試算表重新整理，功能表會多出「排課系統」。
 * 3. 排課系統 → 匯出全部分頁給 app。
 * 4. 對話框裡的文字全選複製，貼進 app 的「設定 → 舊資料匯入」。
 *
 * 跳過的分頁：名字含「模板」的，以及隱藏起來的。那些不是客戶。
 */

/** 分頁之間的分隔線。app 那邊靠這一行切開，所以兩邊要一模一樣。 */
var SHEET_MARKER = '##### SHEET ';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('排課系統')
    .addItem('匯出全部分頁給 app', 'showExport')
    .addToUi();
}

/**
 * 全部分頁串成一份文字。
 *
 * 每一格照畫面上顯示的樣子讀（getDisplayValues）—— 日期在畫面上是「6月15日」，
 * 底層卻是完整的日期值。她平常複製貼上得到的是顯示值，匯入器也是照那個寫的，
 * 所以這裡要一致，不能因為換了一條路就送不一樣的東西過去。
 */
function buildExport() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var parts = [];

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var name = sheet.getName();
    if (sheet.isSheetHidden() || name.indexOf('模板') !== -1) continue;

    var values = sheet.getDataRange().getDisplayValues();
    var rows = [];
    for (var r = 0; r < values.length; r++) {
      // 儲存格裡的換行會把一列拆成兩列，換成字面的 \n 留住形狀
      var cells = [];
      for (var c = 0; c < values[r].length; c++) {
        cells.push(String(values[r][c]).replace(/\n/g, '\\n').replace(/\t/g, ' '));
      }
      rows.push(cells.join('\t'));
    }

    parts.push(SHEET_MARKER + name + '\n' + rows.join('\n'));
  }

  return { text: parts.join('\n'), count: parts.length };
}

function showExport() {
  var result = buildExport();
  var html = HtmlService.createHtmlOutput(
    '<p style="font:14px/1.6 system-ui">'
    + '這裡面有 <b>' + result.count + '</b> 張分頁。點一下框裡面 → 全選 → 複製，'
    + '貼進 app 的「設定 → 舊資料匯入」。</p>'
    + '<textarea id="t" style="width:100%;height:60vh;font:12px/1.4 monospace"></textarea>'
    + '<script>'
    + 'document.getElementById("t").value = ' + JSON.stringify(result.text) + ';'
    + 'document.getElementById("t").focus();'
    + 'document.getElementById("t").select();'
    + '</script>',
  ).setWidth(800).setHeight(600);

  SpreadsheetApp.getUi().showModalDialog(html, '匯出給 app');
}
