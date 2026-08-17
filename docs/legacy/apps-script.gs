// ⚠️ 這是「舊系統」的程式碼，原封不動保留作為參考，不是本專案要維護的程式。
// 新系統不照抄這裡的實作方式（儲存格狀態 → 資料庫狀態），但要保留其「意圖」。
// 已知與新規格牴觸之處見 docs/legacy/README.md。

// 全域顏色設定
var COLORS = {
  orange: "#fce5cd",
  cyan: "#d0e0e3",
  purple: "#d9d2e9",
  yellow: "#fff2cc",
  blue: "#c9daf8",
  gray: "#efefef",
  finishGray: "#cccccc"
};

// ==========================================
// 🧹 選單：給你「沒在連點時」手動壓緊空白列用
// ➕ 批次新增客戶（複製模板 → 改分頁名 → 寫入 A2）
// ==========================================

var TEMPLATE_SHEET_NAME = "8萬方案模板-數量ㄧ";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🍰 寶寶小工具")
    .addItem("🛠️整理 / 重新排序清單", "manualResort")
    .addItem("➕ 批次新增客戶", "showAddCustomersDialog")
    .addItem("📝 批量修改客戶", "showEditCustomersDialog")
    .addToUi();
}

function manualResort() {
  var sheet = SpreadsheetApp.getActiveSheet();

  var todoCell = sheet.createTextFinder("TODO").findNext();
  if (!todoCell) return;
  var todoHeaderRow = todoCell.getRow();
  var todoDataRow = todoCell.isPartOfMerge()
    ? todoCell.getMergedRanges()[0].getLastRow() + 1
    : todoHeaderRow + 1;

  var finishCell = sheet.createTextFinder("FINISH").findNext();
  var finishHeaderRow = finishCell ? finishCell.getRow() : todoHeaderRow;
  var finishDataRow = finishHeaderRow + 1;
  if (finishCell && finishCell.isPartOfMerge()) {
    finishDataRow = finishCell.getMergedRanges()[0].getLastRow() + 1;
  }

  sortTodoBlockArray(sheet, todoDataRow);
  sortFinishBlockArray(sheet, finishDataRow);
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast("清單已重新排序並壓緊空白列！", "🧹 整理完成", 3);
}

// ==========================================
// 🛡️ 安全還原：絕對不會寫出純文字 TRUE / FALSE
//    - 還是勾選框 → 變成「未勾選」
//    - 不是勾選框（屬性被清過）→ 直接清掉殘留值
// ==========================================
function safeResetCell(range) {
  var dv = range.getDataValidation();
  var isCheckbox = dv &&
    dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX;
  if (isCheckbox) {
    range.setValue(false);   // 是勾選框 → 安全地變回未勾選
  } else {
    range.clearContent();    // 不是勾選框 → 清掉殘留的 TRUE / FALSE 文字
  }
}

function onEdit(e) {
  if (!e || !e.range) return;

  // 🔒 交通指揮鎖，防止同時點擊造成資料衝突
  var lock = LockService.getDocumentLock();
  var success = lock.tryLock(15000);

  var value = String(e.value).toUpperCase();

  if (!success) {
    // 防呆退回：塞車時把剛才的動作「還原成點擊前的狀態」，
    // 讓你看到動作沒成功（剛取消的會被打回勾、剛勾的會退回未勾）→ 提醒你重點一次。
    // 只在它真的是勾選框時才動，避免寫出純文字 TRUE / FALSE。
    var dvFail = e.range.getDataValidation();
    var isCheckboxFail = dvFail &&
      dvFail.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX;
    if (isCheckboxFail) {
      if (value === "TRUE") e.range.setValue(false);       // 剛勾的 → 退回未勾
      else if (value === "FALSE") e.range.setValue(true);  // 剛取消的 → 打回已勾（這就是提醒你重點的訊號）
    }
    SpreadsheetApp.getActive().toast("系統處理塞車中，剛才的動作未成功，請『稍等幾秒』再點一次！", "⚠️ 提示", 5);
    return;
  }

  try {
    var sheet = e.source.getActiveSheet();
    var range = e.range;
    var row = range.getRow();
    var col = range.getColumn();

    // 🔍 智慧偵測 TODO 位置與「合併儲存格範圍」
    var todoCell = sheet.createTextFinder("TODO").findNext();
    var todoHeaderRow = todoCell ? todoCell.getRow() : -1;
    if (todoHeaderRow === -1) return;

    var todoDataRow = todoHeaderRow + 1;
    if (todoCell.isPartOfMerge()) {
      todoDataRow = todoCell.getMergedRanges()[0].getLastRow() + 1;
    }

    // 🔍 智慧偵測 FINISH 位置與「合併儲存格範圍」
    var finishCell = sheet.createTextFinder("FINISH").findNext();
    var finishHeaderRow = finishCell ? finishCell.getRow() : todoHeaderRow;
    var finishDataRow = finishHeaderRow + 1;
    if (finishCell && finishCell.isPartOfMerge()) {
      finishDataRow = finishCell.getMergedRanges()[0].getLastRow() + 1;
    }

    // 🗓️ 日期格式統一轉換器
    function parseToShortDate(str) {
      if (!str) return "";
      str = String(str);
      var match = str.match(/(?:\d{4}[-\/])?(\d{1,2})[-\/月](\d{1,2})日?/);
      if (match) {
        return parseInt(match[1], 10) + "/" + parseInt(match[2], 10);
      }
      return str;
    }

    // ==========================================
    // 區域 C：修改第一列的表頭日期 (同步更新並排序)
    // ==========================================
    if (row === 1 && col >= 6) {
      var newDateText = parseToShortDate(sheet.getRange(1, col).getDisplayValue());
      if (!newDateText) return;

      for (var r = 2; r < todoHeaderRow; r++) {
        if (sheet.getRange(r, col).getValue() === true) {
          var treatment = sheet.getRange(r, 3).getValue();
          if (!treatment) continue;

          var validCurrentDates = [];
          var maxCols = sheet.getLastColumn();
          for (var c = 6; c <= maxCols; c++) {
            if (sheet.getRange(r, c).getValue() === true) {
              var dText = parseToShortDate(sheet.getRange(1, c).getDisplayValue());
              if (dText && validCurrentDates.indexOf(dText) === -1) {
                validCurrentDates.push(dText);
              }
            }
          }
          updateDatesInBlock(sheet, 1, todoDataRow, treatment, validCurrentDates, newDateText);
          updateDatesInBlock(sheet, 11, finishDataRow, treatment, validCurrentDates, newDateText);
        }
      }
      sortTodoBlockArray(sheet, todoDataRow);
      sortFinishBlockArray(sheet, finishDataRow);

      SpreadsheetApp.flush();
      SpreadsheetApp.getActive().toast("表頭日期已同步更新並重新排序！", "📆 日期更新完成", 3);
      return;
    }

    if (value !== "TRUE" && value !== "FALSE") return;

    // ==========================================
    // 區域 A：上方的排程打勾區 (新增或移除)
    //   ※ 新增時 sort 是必要的（要照日期插入），保留
    //     順便會把下方完成留下的空白列一起壓緊補齊
    // ==========================================
    if (row < todoHeaderRow && col >= 6) {
      var dateHeader = sheet.getRange(1, col).getDisplayValue();
      var shortDate = parseToShortDate(dateHeader);
      var treatmentA = sheet.getRange(row, 3).getValue();
      if (!treatmentA) return;
      var titleText = shortDate + treatmentA;

      if (value === "TRUE") {
        createTodoTasks(sheet, todoDataRow, titleText, treatmentA);
        sortTodoBlockArray(sheet, todoDataRow);

        SpreadsheetApp.flush();
        SpreadsheetApp.getActive().toast("已成功產生排程任務：" + titleText, "✅ 處理完成", 3);
      }
      else if (value === "FALSE") {
        var found = removeRowByTitle(sheet, 1, todoDataRow, 9, titleText);
        if (found) {
          sortTodoBlockArray(sheet, todoDataRow);
        } else {
          var foundFinish = removeRowByTitle(sheet, 11, finishDataRow, 2, titleText);
          if (foundFinish) sortFinishBlockArray(sheet, finishDataRow);
        }

        SpreadsheetApp.flush();
        SpreadsheetApp.getActive().toast("已成功移除排程任務：" + titleText, "❌ 已移除", 3);
      }
      return;
    }

    // ==========================================
    // 區域 B：下方的 TODO 任務打勾區 (檢測是否全數完成)
    // ==========================================
    if (row >= todoDataRow && col >= 3 && col <= 9 && col % 2 !== 0) {
      var taskNameCell = sheet.getRange(row, col - 1);
      var checkboxCell = sheet.getRange(row, col);
      var taskName = String(taskNameCell.getValue()).trim();

      // 雙重狀態驗證：若這格的真實狀態跟事件對不上，代表資料已被換掉 → 直接放掉這個過時事件
      var currentCheckboxValue = String(checkboxCell.getValue()).toUpperCase();
      if ((value === "TRUE" && currentCheckboxValue !== "TRUE") ||
          (value === "FALSE" && currentCheckboxValue !== "FALSE")) {
        return;
      }

      // 座標偏移防呆：左邊不是合法任務名，代表點到錯位的空白列
      var validTasks = ["Examine", "打電話", "Abovee", "耀聖"];
      if (validTasks.indexOf(taskName) === -1) {
        safeResetCell(e.range);   // ✅ 安全還原，不會寫出多餘的 TRUE
        SpreadsheetApp.flush();
        SpreadsheetApp.getActive().toast("清單重新排序中，您點擊的位置有偏移！已自動復原，請確認新位置後再點。", "⚠️ 殘影防護", 4);
        return;
      }

      if (value === "TRUE") {
        taskNameCell.setFontLine("line-through").setBackground(COLORS.gray);
        checkboxCell.setFontLine("line-through").setBackground(COLORS.gray);

        var isFinished = true;
        var hasTasks = false;
        for (var c = 2; c <= 8; c += 2) {
          var tName = sheet.getRange(row, c).getValue();
          if (tName) {
            hasTasks = true;
            var cbValue = sheet.getRange(row, c + 1).getValue();
            if (cbValue !== true && String(cbValue).toUpperCase() !== "TRUE") {
              isFinished = false;
              break;
            }
          }
        }

        // 🎯 全部完成：移至 FINISH
        if (hasTasks && isFinished) {
          var finishedTitle = sheet.getRange(row, 1).getValue();

          var insertRowK = Math.max(getLastRowInColumn(sheet, 11) + 1, finishDataRow);

          sheet.getRange(insertRowK, 11).setValue(finishedTitle).setBackground(COLORS.gray).setFontLine("none");
          sheet.getRange(insertRowK, 12).insertCheckboxes().check().setBackground(COLORS.gray);

          // 就地清空原本的 TODO 列（留一個空白列，不立刻往上遞補）
          sheet.getRange(row, 1, 1, 9).clearContent().clearDataValidations().clearFormat();

          // ❌ 這裡「故意」不呼叫 sortTodoBlockArray！
          //    立刻排序會把下面的列往上抽走，正是「點擊偏移 / 殘影」的元凶。
          //    空白列會在你下次「新增排程」或按選單「整理清單」時自動壓緊。
          sortFinishBlockArray(sheet, finishDataRow);

          SpreadsheetApp.flush();
          SpreadsheetApp.getActive().toast(finishedTitle + " 所有任務已完成，移至 FINISH！", "🎉 恭喜完成", 3);
        }
      }
      else if (value === "FALSE") {
        taskNameCell.setFontLine("none");
        checkboxCell.setFontLine("none");

        var origColor = "#ffffff";
        if (taskName === "Examine") origColor = COLORS.cyan;
        else if (taskName === "打電話") origColor = COLORS.purple;
        else if (taskName === "Abovee") origColor = COLORS.yellow;
        else if (taskName === "耀聖") origColor = COLORS.blue;

        taskNameCell.setBackground(origColor);
        checkboxCell.setBackground(origColor);
      }
    }

    // ==========================================
    // 區域 D：FINISH 任務取消打勾 (退回 TODO)
    // ==========================================
    else if (row >= finishDataRow && col === 12) {
      if (value === "FALSE") {
        var revertTitle = sheet.getRange(row, 11).getValue();

        // 座標偏移防護：左邊是空白 → 點到錯位
        if (!revertTitle || String(revertTitle).trim() === "") {
          safeResetCell(e.range);   // ✅ 安全還原，不會寫出多餘的 TRUE
          SpreadsheetApp.flush();
          SpreadsheetApp.getActive().toast("清單重新排序中，您點擊的位置有偏移！已自動復原。", "⚠️ 殘影防護", 4);
          return;
        }

        var match = revertTitle.match(/^(\d{1,2}\/\d{1,2})(.*)$/);
        if (match) {
          var parsedTreatment = match[2];

          createTodoTasks(sheet, todoDataRow, revertTitle, parsedTreatment);
          sheet.getRange(row, 11, 1, 2).clearContent().clearDataValidations().clearFormat();

          sortTodoBlockArray(sheet, todoDataRow);
          sortFinishBlockArray(sheet, finishDataRow);

          SpreadsheetApp.flush();
          SpreadsheetApp.getActive().toast(revertTitle + " 已重新退回 TODO 清單", "↩️ 已復原", 3);
        }
      }
    }

  } catch (error) {
    SpreadsheetApp.getActive().toast("錯誤：" + error.message, "❌ 系統通知");
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 🛠️ 輔助功能庫
// ==========================================

function getTasksForTreatment(treatment) {
  var tasks = [];
  if (treatment.indexOf("健檢") !== -1) {
    tasks.push({ name: "Examine", color: COLORS.cyan });
    tasks.push({ name: "打電話", color: COLORS.purple });
  } else if (treatment.indexOf("復健") !== -1 || treatment.indexOf("心臟") !== -1 || treatment.indexOf("2返") !== -1) {
    tasks.push({ name: "Abovee", color: COLORS.yellow });
    tasks.push({ name: "Examine", color: COLORS.cyan });
    tasks.push({ name: "耀聖", color: COLORS.blue });
    tasks.push({ name: "打電話", color: COLORS.purple });
  } else if (treatment.indexOf("復能") !== -1 || treatment.indexOf("ILIB") !== -1 || treatment.indexOf("點滴") !== -1 || treatment.indexOf("EECP") !== -1 || treatment.indexOf("營養針") !== -1) {
    tasks.push({ name: "Abovee", color: COLORS.yellow });
    tasks.push({ name: "打電話", color: COLORS.purple });
  }
  return tasks;
}

function createTodoTasks(sheet, todoDataRow, titleText, treatment) {
  var tasks = getTasksForTreatment(treatment);
  if (tasks.length === 0) return;

  var insertRowA = Math.max(getLastRowInColumn(sheet, 1) + 1, todoDataRow);

  sheet.getRange(insertRowA, 1).setValue(titleText).setBackground(COLORS.orange).setFontLine("none");
  var currentStartCol = 2;
  tasks.forEach(function(task) {
    sheet.getRange(insertRowA, currentStartCol).setValue(task.name).setBackground(task.color).setFontLine("none");
    sheet.getRange(insertRowA, currentStartCol + 1).insertCheckboxes().setBackground(task.color).setFontLine("none").uncheck();
    currentStartCol += 2;
  });
}

function removeRowByTitle(sheet, colIndex, dataStartRow, clearWidth, titleText) {
  var lastRow = getLastRowInColumn(sheet, colIndex);
  if (lastRow < dataStartRow) return false;

  var titleValues = sheet.getRange(dataStartRow, colIndex, lastRow - dataStartRow + 1, 1).getValues();
  for (var i = 0; i < titleValues.length; i++) {
    if (titleValues[i][0] === titleText) {
      sheet.getRange(dataStartRow + i, colIndex, 1, clearWidth).clearContent().clearDataValidations().clearFormat();
      return true;
    }
  }
  return false;
}

function updateDatesInBlock(sheet, colIndex, dataStartRow, treatment, validCurrentDates, newDateText) {
  var lastRow = getLastRowInColumn(sheet, colIndex);
  if (lastRow < dataStartRow) return;

  var titleValues = sheet.getRange(dataStartRow, colIndex, lastRow - dataStartRow + 1, 1).getValues();
  for (var i = 0; i < titleValues.length; i++) {
    var title = titleValues[i][0];
    if (title.indexOf(treatment) !== -1 && title.endsWith(treatment)) {
      var extractedDate = title.substring(0, title.length - treatment.length);
      if (validCurrentDates.indexOf(extractedDate) === -1) {
        sheet.getRange(dataStartRow + i, colIndex).setValue(newDateText + treatment);
      }
    }
  }
}

function getLastRowInColumn(sheet, colIndex) {
  var maxRow = sheet.getLastRow();
  if (maxRow === 0) return 0;
  var data = sheet.getRange(1, colIndex, maxRow, 1).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (data[i][0] !== "" && data[i][0] !== null) {
      return i + 1;
    }
  }
  return 0;
}

function getSortKey(title) {
  var match = String(title).match(/^(\d{1,2})[-\/](\d{1,2})/);
  if (match) {
    var m = parseInt(match[1], 10);
    var d = parseInt(match[2], 10);
    return (m < 10 ? "0" + m : m) + "/" + (d < 10 ? "0" + d : d);
  }
  return "99/99";
}

// ==========================================
// 🚀 核心：記憶體陣列排序 (完全防護表頭版)
// ==========================================

function sortTodoBlockArray(sheet, todoDataRow) {
  var lastRow = getLastRowInColumn(sheet, 1);
  if (lastRow < todoDataRow) return;

  var range = sheet.getRange(todoDataRow, 1, lastRow - todoDataRow + 1, 9);
  var values = range.getValues();
  var backgrounds = range.getBackgrounds();
  var fontLines = range.getFontLines();
  var dataValidations = range.getDataValidations();

  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var title = String(values[i][0]).trim();
    if (title !== "") {
      rows.push({
        sortKey: getSortKey(title),
        val: values[i],
        bg: backgrounds[i],
        font: fontLines[i],
        valida: dataValidations[i]
      });
    }
  }

  range.clearContent().clearFormat().clearDataValidations();

  if (rows.length > 0) {
    rows.sort(function(a, b) {
      if (a.sortKey < b.sortKey) return -1;
      if (a.sortKey > b.sortKey) return 1;
      return 0;
    });

    var newValues = [], newBg = [], newFont = [], newValida = [];
    for (var j = 0; j < rows.length; j++) {
      newValues.push(rows[j].val);
      newBg.push(rows[j].bg);
      newFont.push(rows[j].font);
      newValida.push(rows[j].valida);
    }

    var writeRange = sheet.getRange(todoDataRow, 1, rows.length, 9);
    writeRange.setValues(newValues);
    writeRange.setBackgrounds(newBg);
    writeRange.setFontLines(newFont);
    writeRange.setDataValidations(newValida);
  }
}

function sortFinishBlockArray(sheet, finishDataRow) {
  var lastRow = getLastRowInColumn(sheet, 11);
  if (lastRow < finishDataRow) return;

  var range = sheet.getRange(finishDataRow, 11, lastRow - finishDataRow + 1, 2);
  var values = range.getValues();
  var backgrounds = range.getBackgrounds();
  var fontLines = range.getFontLines();
  var dataValidations = range.getDataValidations();

  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var title = String(values[i][0]).trim();
    if (title !== "") {
      rows.push({
        sortKey: getSortKey(title),
        val: values[i],
        bg: backgrounds[i],
        font: fontLines[i],
        valida: dataValidations[i]
      });
    }
  }

  range.clearContent().clearFormat().clearDataValidations();

  if (rows.length > 0) {
    rows.sort(function(a, b) {
      if (a.sortKey < b.sortKey) return -1;
      if (a.sortKey > b.sortKey) return 1;
      return 0;
    });

    var newValues = [], newBg = [], newFont = [], newValida = [];
    for (var j = 0; j < rows.length; j++) {
      newValues.push(rows[j].val);
      newBg.push(rows[j].bg);
      newFont.push(rows[j].font);
      newValida.push(rows[j].valida);
    }

    var writeRange = sheet.getRange(finishDataRow, 11, rows.length, 2);
    writeRange.setValues(newValues);
    writeRange.setBackgrounds(newBg);
    writeRange.setFontLines(newFont);
    writeRange.setDataValidations(newValida);
  }
}

// 開啟視窗（讀取 HTML 檔案 AddCustomersForm / EditCustomersForm）
function showAddCustomersDialog() {
  var html = HtmlService.createHtmlOutputFromFile("AddCustomersForm")
    .setWidth(820).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, "批次新增客戶");
}

function showEditCustomersDialog() {
  var html = HtmlService.createHtmlOutputFromFile("EditCustomersForm")
    .setWidth(860).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, "批量修改客戶");
}

// ---------- 共用小工具 ----------

// 讀模板 D2:D8 的基準值（購買數量＝1 時的數字）
function getTemplateBaseD(template) {
  return template.getRange("D2:D8").getValues().map(function(r){ return Number(r[0]) || 0; });
}

// 從 C9 解析「萬」數，例如 "12萬健檢" → 12；"x萬健檢" → 0
function parseWan(c9text) {
  var m = String(c9text || "").match(/(\d+)\s*萬健檢/);
  return m ? Number(m[1]) : 0;
}

// 判斷是不是「客戶分頁」（結構＝模板，但名字不是模板本身）
function isCustomerSheet(sheet) {
  if (sheet.getName() === TEMPLATE_SHEET_NAME) return false;
  var a1 = String(sheet.getRange("A1").getValue()).trim();
  var c2 = String(sheet.getRange("C2").getValue()).trim();
  return (a1 === "客戶名稱" && c2 === "Inbody");
}

// ---------- 批次新增 ----------

function createCustomerSheetsV2(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var template = ss.getSheetByName(TEMPLATE_SHEET_NAME);

  if (!template) {
    var allNames = ss.getSheets().map(function(s){ return s.getName(); });
    return {
      ok: false,
      message: "找不到模板工作表「" + TEMPLATE_SHEET_NAME + "」。\n\n" +
               "目前試算表裡的工作表有：\n• " + allNames.join("\n• ") +
               "\n\n請把程式碼最上方的 TEMPLATE_SHEET_NAME 改成正確名稱，再試一次。"
    };
  }

  var base = getTemplateBaseD(template);
  var created = [], skipped = [], failed = [];

  rows.forEach(function(r) {
    var name = String(r.name || "").trim();
    if (!name) return;
    if (ss.getSheetByName(name)) { skipped.push(name); return; }

    try {
      var qtyRaw = (r.qty == null) ? "" : String(r.qty).trim();
      var qty = (qtyRaw === "") ? 1 : Number(qtyRaw);
      if (isNaN(qty) || qty < 0) qty = 1;

      var wan   = String(r.checkupWan || "").trim();
      var dCnt  = Number(r.checkupCount) || 0;
      var eCnt  = Number(r.eecpCount) || 0;
      var pName = String(r.purchaseName || "").trim();

      var sh = template.copyTo(ss);
      sh.setName(name);
      sh.getRange("A2").setValue(name);
      if (pName) sh.getRange("B2").setValue(pName);

      // D2:D8 × 購買數量（qty=0 → 全 0）
      var newD = base.map(function(v){ return [v * qty]; });
      sh.getRange("D2:D8").setValues(newD);

      // C9 萬健檢、D9 健檢堂數、D10 EECP
      if (wan !== "" && Number(wan) > 0) sh.getRange("C9").setValue(wan + "萬健檢");
      sh.getRange("D9").setValue(dCnt);
      sh.getRange("D10").setValue(eCnt);

      created.push(name);
    } catch (err) {
      failed.push(name + "（" + err.message + "）");
    }
  });

  return { ok: true, created: created, skipped: skipped, failed: failed };
}

// ---------- 批量修改 ----------

// 讀出所有客戶資料給視窗顯示
function getCustomersData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var template = ss.getSheetByName(TEMPLATE_SHEET_NAME);
  if (!template) {
    return { ok: false, message: "找不到模板「" + TEMPLATE_SHEET_NAME + "」，無法計算購買數量。請先確認模板名稱。" };
  }
  var base = getTemplateBaseD(template);
  var baseD2 = base[0] || 0;  // Inbody 基準（通常是 4）

  var list = [];
  ss.getSheets().forEach(function(sh) {
    if (!isCustomerSheet(sh)) return;
    var d2 = Number(sh.getRange("D2").getValue()) || 0;
    var qty = baseD2 ? Math.round(d2 / baseD2) : 0;
    list.push({
      sheetName: sh.getName(),
      name: String(sh.getRange("A2").getValue() || "").trim(),
      qty: qty,
      wan: parseWan(sh.getRange("C9").getValue()),
      checkupCount: Number(sh.getRange("D9").getValue()) || 0,
      eecpCount: Number(sh.getRange("D10").getValue()) || 0,
      purchaseName: String(sh.getRange("B2").getValue() || "").trim()
    });
  });

  return { ok: true, customers: list };
}

// 儲存單一客戶的修改
function updateCustomer(originalSheetName, data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var template = ss.getSheetByName(TEMPLATE_SHEET_NAME);
  if (!template) return { ok: false, message: "找不到模板，無法套用購買數量。" };

  var sh = ss.getSheetByName(originalSheetName);
  if (!sh) return { ok: false, message: "找不到分頁「" + originalSheetName + "」，可能已被改名或刪除。請關掉視窗重開。" };

  try {
    var newName = String(data.name || "").trim();

    // 改名（含 A2）
    if (newName && newName !== originalSheetName) {
      if (ss.getSheetByName(newName)) return { ok: false, message: "已有同名分頁「" + newName + "」，請換一個名稱。" };
      sh.setName(newName);
    }
    if (newName) sh.getRange("A2").setValue(newName);

    // 購買數量 → 重新套用 D2:D8（= 模板基準 × qty）
    var qtyRaw = (data.qty == null) ? "" : String(data.qty).trim();
    var qty = (qtyRaw === "") ? 1 : Number(qtyRaw);
    if (isNaN(qty) || qty < 0) qty = 1;
    var base = getTemplateBaseD(template);
    sh.getRange("D2:D8").setValues(base.map(function(v){ return [v * qty]; }));

    // C9 / D9 / D10 / B2
    var wan = String(data.wan || "").trim();
    if (wan !== "" && Number(wan) > 0) sh.getRange("C9").setValue(wan + "萬健檢");
    else sh.getRange("C9").setValue("x萬健檢");
    sh.getRange("D9").setValue(Number(data.checkupCount) || 0);
    sh.getRange("D10").setValue(Number(data.eecpCount) || 0);
    sh.getRange("B2").setValue(String(data.purchaseName || "").trim());

    return { ok: true, sheetName: (newName || originalSheetName) };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
