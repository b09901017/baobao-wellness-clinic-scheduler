/**
 * 唯讀報表 — Google Apps Script
 *
 * 這支只做兩件事：**收下 app 推過來的資料**、**把它排成看得舒服的表並上鎖**。
 *
 * 它不算任何數字。三段式次數（已完成／已排未上／剩餘）全部在 app 的
 * domain/sheetReport.js 算完才送過來 —— 那裡有測試，這裡沒有。
 * 同一個算法有兩份實作，遲早會對不起來，而對不起來的那天沒有人會發現。
 *
 * 它也不去拿資料。要讓 Apps Script 讀 Firestore 得放一把服務帳號金鑰在
 * 專案屬性裡，那把鑰匙外洩等於全部客戶的資料外洩（ADR-0010）。
 * 這裡沒有任何 Google 憑證，只有一個收件口。
 *
 * ─────────────────────────────────────────────
 * 安裝（做一次）
 *
 * 1. 試算表 → 擴充功能 → Apps Script，把這個檔案整份貼進去。
 * 2. 專案設定 → 指令碼屬性 → 新增 `SYNC_TOKEN`，值自己想一串長一點的亂碼。
 * 3. 部署 → 新增部署作業 → 網頁應用程式
 *      執行身分：我
 *      誰可以存取：**所有人**
 *    （必須是「所有人」，因為 app 是從瀏覽器直接送過來的，帶不了你的 Google 登入。
 *      擋住不速之客的是上面那組密鑰，不是這個選項。）
 * 4. 複製部署後的網址，連同密鑰填進 app 的「設定 → 試算表報表」。
 * 5. 舊的 onEdit 那支請整份刪掉 —— 這張表從此是報表，不是資料來源。
 *
 * 之後 app 每次存檔，安靜幾秒就會自己推一份過來。
 */

var TOKEN_PROPERTY = 'SYNC_TOKEN';
var DATA_SHEET = '_data';
/** 認得的資料格式版本。對不上就整包拒絕，不要半套渲染。 */
var SUPPORTED_FORMAT = 1;

// ---------- 版面 ----------
//
// 沿用她原本看得懂的骨架：療程項目 × 日期的勾選矩陣。
// 改掉的只有次數 —— 舊表的「應有／實際」兩欄講不出「已排未上」，
// 而那正是最容易掉東西的一段。

var COL = {
  LABEL: 1,      // A 療程項目
  TOTAL: 2,      // B 應有
  DONE: 3,       // C 已完成
  BOOKED: 4,     // D 已排未上
  REMAINING: 5,  // E 剩餘
  FIRST_DATE: 6, // F 以後每欄一個日期
};
var HEADER_ROWS = 4;  // 標題、客戶資訊、產生時間、空行
var MATRIX_HEADER_ROW = HEADER_ROWS + 1;

var STYLE = {
  font: 'Noto Sans TC',
  titleSize: 14,
  bodySize: 11,
  labelWidth: 190,
  countWidth: 62,
  dateWidth: 58,
  noteWidth: 300,
  rowHeight: 26,
};

var COLOR = {
  notice: '#FFF3E0',
  noticeText: '#8D4E00',
  header: '#37474F',
  headerText: '#FFFFFF',
  band: '#F5F7F8',
  done: '#C8E6C9',
  booked: '#FFF2CC',
  low: '#FFCDD2',      // 剩餘 0
  border: '#B0BEC5',
  noteHeader: '#ECEFF1',
};

// ---------- 收件口 ----------

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);

    if (!expected) return reply({ ok: false, error: '這份指令碼還沒設定 SYNC_TOKEN' });
    if (body.token !== expected) return reply({ ok: false, error: '密鑰不對' });

    var bundle = body.bundle;
    if (!bundle || bundle.format !== SUPPORTED_FORMAT) {
      return reply({
        ok: false,
        error: '資料格式版本是 ' + (bundle && bundle.format) + '，這份指令碼只認得 '
          + SUPPORTED_FORMAT + '。請更新試算表這一側的指令碼。',
      });
    }

    // 一次只讓一個請求進來改表。app 端已經擋過一次，但網頁應用程式的網址
    // 是公開的，這裡再擋一次比較踏實 —— 兩份同時寫會把表寫成一半一半。
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return reply({ ok: false, error: '另一份同步還在進行中' });

    try {
      var made = render(SpreadsheetApp.getActiveSpreadsheet(), bundle);
      return reply({ ok: true, sheets: made });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function reply(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- 渲染 ----------

function render(ss, bundle) {
  stashRawData(ss, bundle);

  var keep = { '總表': true };
  keep[DATA_SHEET] = true;

  renderOverview(ss, bundle);
  for (var i = 0; i < bundle.sheets.length; i++) {
    keep[renderCustomer(ss, bundle.sheets[i], bundle)] = true;
  }

  removeStaleSheets(ss, keep);
  protectEverything(ss);
  return bundle.sheets.length + 1;
}

/**
 * 原始 JSON 留一份在隱藏分頁。
 *
 * 用途只有一個：渲染出來的東西看起來不對時，可以確認是「推過來就錯了」
 * 還是「排版排錯了」。沒有這一份，出事時只能兩邊瞎猜。
 */
function stashRawData(ss, bundle) {
  var sheet = ss.getSheetByName(DATA_SHEET) || ss.insertSheet(DATA_SHEET);
  sheet.clear();
  sheet.getRange(1, 1).setValue('這一頁是 app 推過來的原始資料，給出問題時對照用。請不要編輯。');
  // 一格最多 50000 個字元，整包塞不下就切開來放
  var text = JSON.stringify(bundle);
  for (var i = 0; i * 45000 < text.length; i++) {
    sheet.getRange(i + 2, 1).setValue(text.substr(i * 45000, 45000));
  }
  sheet.hideSheet();
}

function renderOverview(ss, bundle) {
  var sheet = resetSheet(ss, '總表');
  var head = ['姓名', '購買名稱', '會籍到期', '應有', '已完成', '已排未上', '剩餘',
    '上次來訪', '下次預約', '永久限制'];

  ensureSize(sheet, bundle.overview.length + 8, head.length);
  noticeRow(sheet, head.length, bundle);
  sheet.getRange(2, 1, 1, head.length).merge()
    .setValue('客戶總表　·　產生時間 ' + bundle.generatedAt)
    .setFontSize(STYLE.titleSize).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  var top = 4;
  sheet.getRange(top, 1, 1, head.length).setValues([head]);
  styleHeader(sheet.getRange(top, 1, 1, head.length));

  var rows = bundle.overview.map(function (c) {
    return [c.name, c.source, c.membershipExpiresAt, c.total, c.done, c.booked,
      c.remaining, c.lastVisit, c.nextVisit, (c.flags || []).join('、')];
  });
  if (rows.length) {
    var body = sheet.getRange(top + 1, 1, rows.length, head.length);
    body.setValues(rows).setVerticalAlignment('middle').setWrap(true);
    sheet.getRange(top + 1, 4, rows.length, 4).setHorizontalAlignment('center');
    banding(sheet, top + 1, rows.length, head.length);
    // 剩餘 0 的整列標起來 —— 那是「這個人快沒次數了」，看總表就是為了看這個
    for (var i = 0; i < rows.length; i++) {
      if (bundle.overview[i].remaining === 0) {
        sheet.getRange(top + 1 + i, 1, 1, head.length).setBackground(COLOR.low);
      }
    }
  }

  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 190);
  sheet.setColumnWidth(3, 96);
  for (var c = 4; c <= 9; c++) sheet.setColumnWidth(c, 78);
  sheet.setColumnWidth(10, 200);
  sheet.setFrozenRows(top);
  sheet.setFrozenColumns(1);
  finish(sheet, top, rows.length, head.length);
}

function renderCustomer(ss, data, bundle) {
  var name = sheetNameFor(data.name);
  var sheet = resetSheet(ss, name);
  var dateCount = data.dateLabels.length;
  var width = COL.FIRST_DATE - 1 + Math.max(dateCount, 1);

  ensureSize(sheet, MATRIX_HEADER_ROW + data.rows.length + data.log.length + 12, width);
  noticeRow(sheet, width, bundle);

  // 第 2 列：名字大字，右邊接購買名稱與會籍
  sheet.getRange(2, 1, 1, 2).merge().setValue(data.name)
    .setFontSize(STYLE.titleSize).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.getRange(2, 3, 1, Math.max(width - 2, 1)).merge()
    .setValue(infoLine(data))
    .setVerticalAlignment('middle').setWrap(true);

  sheet.getRange(3, 1, 1, width).merge()
    .setValue('產生時間 ' + bundle.generatedAt + '　·　這一頁由 app 產生，改資料請回 app')
    .setFontSize(9).setFontColor('#78909C').setVerticalAlignment('middle');

  // 矩陣表頭
  var head = ['療程項目', '應有', '已完成', '已排未上', '剩餘'].concat(data.dateLabels);
  sheet.getRange(MATRIX_HEADER_ROW, 1, 1, head.length).setValues([head]);
  styleHeader(sheet.getRange(MATRIX_HEADER_ROW, 1, 1, head.length));

  var rows = data.rows.map(function (r) {
    return [r.label, r.total, r.done, r.booked, r.remaining].concat(r.marks);
  });

  if (rows.length) {
    var top = MATRIX_HEADER_ROW + 1;
    var body = sheet.getRange(top, 1, rows.length, head.length);
    body.setValues(rows).setVerticalAlignment('middle').setWrap(true);
    sheet.getRange(top, 2, rows.length, head.length - 1).setHorizontalAlignment('center');
    banding(sheet, top, rows.length, head.length);

    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      if (r.done > 0) sheet.getRange(top + i, COL.DONE).setBackground(COLOR.done);
      if (r.booked > 0) sheet.getRange(top + i, COL.BOOKED).setBackground(COLOR.booked);
      if (r.remaining === 0) sheet.getRange(top + i, COL.REMAINING).setBackground(COLOR.low);
      // 有勾的格子上色。勾選框看久了會漏看，一片顏色不會。
      for (var d = 0; d < r.marks.length; d++) {
        if (r.marks[d]) {
          sheet.getRange(top + i, COL.FIRST_DATE + d).setBackground(COLOR.done);
        }
      }
    }
  }

  renderNotes(sheet, data, MATRIX_HEADER_ROW + Math.max(rows.length, 1) + 2, width);

  sheet.setColumnWidth(COL.LABEL, STYLE.labelWidth);
  for (var c = COL.TOTAL; c < COL.FIRST_DATE; c++) sheet.setColumnWidth(c, STYLE.countWidth);
  for (var d2 = 0; d2 < dateCount; d2++) {
    sheet.setColumnWidth(COL.FIRST_DATE + d2, STYLE.dateWidth);
  }
  sheet.setFrozenRows(MATRIX_HEADER_ROW);
  sheet.setFrozenColumns(1);
  finish(sheet, MATRIX_HEADER_ROW, rows.length, head.length);
  return name;
}

/**
 * 備註區。位置就是舊表 TODO 區塊原本待的地方。
 *
 * 那些 TODO 是掛號待辦，現在由 app 的待辦中心管，試算表不需要它們。
 * 空出來的位置改放舊表從來記不住的東西：那天幾點、哪一間、誰做的、用了什麼。
 */
function renderNotes(sheet, data, top, width) {
  var row = top;

  row = noteBlock(sheet, row, width, '這位客戶', [
    data.flags && data.flags.length ? '永久限制：' + data.flags.join('、') : '',
    data.notes || '',
  ].filter(String));

  var lines = [];
  for (var i = 0; i < data.log.length; i++) {
    var day = data.log[i];
    var parts = [];
    for (var j = 0; j < day.items.length; j++) {
      var it = day.items[j];
      parts.push([
        it.time,
        it.course,
        it.equipment,
        it.ivProduct,
        it.room ? it.room + (it.bed ? ' 床' + it.bed : '') : '',
        it.therapist,
      ].filter(String).join('　'));
    }
    lines.push(day.label + '　' + parts.join('\n' + '　　　'));
  }
  noteBlock(sheet, row, width, '來訪紀錄', lines);
}

function noteBlock(sheet, top, width, title, lines) {
  sheet.getRange(top, 1, 1, width).merge().setValue(title)
    .setFontWeight('bold').setBackground(COLOR.noteHeader)
    .setVerticalAlignment('middle');

  if (!lines.length) {
    sheet.getRange(top + 1, 1, 1, width).merge().setValue('（沒有）')
      .setFontColor('#90A4AE').setVerticalAlignment('middle');
    return top + 3;
  }

  for (var i = 0; i < lines.length; i++) {
    sheet.getRange(top + 1 + i, 1, 1, width).merge()
      .setValue(lines[i]).setWrap(true).setVerticalAlignment('middle');
  }
  return top + lines.length + 2;
}

function infoLine(data) {
  return [
    data.source ? '購買名稱：' + data.source : '',
    data.membershipExpiresAt ? '會籍到期：' + data.membershipExpiresAt : '',
    '合計　應有 ' + data.totals.total + '　已完成 ' + data.totals.done
      + '　已排未上 ' + data.totals.booked + '　剩餘 ' + data.totals.remaining,
  ].filter(String).join('　·　');
}

// ---------- 共用的排版動作 ----------

function noticeRow(sheet, width, bundle) {
  sheet.getRange(1, 1, 1, width).merge()
    .setValue(bundle.notice)
    .setBackground(COLOR.notice).setFontColor(COLOR.noticeText).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
}

function styleHeader(range) {
  range.setBackground(COLOR.header).setFontColor(COLOR.headerText).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
}

function banding(sheet, top, rowCount, width) {
  for (var i = 1; i < rowCount; i += 2) {
    sheet.getRange(top + i, 1, 1, width).setBackground(COLOR.band);
  }
}

function finish(sheet, headerRow, rowCount, width) {
  var all = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), headerRow), width);
  all.setFontFamily(STYLE.font).setFontSize(STYLE.bodySize);
  if (rowCount) {
    sheet.getRange(headerRow, 1, rowCount + 1, width)
      .setBorder(true, true, true, true, true, true, COLOR.border,
        SpreadsheetApp.BorderStyle.SOLID);
  }
  sheet.setRowHeights(1, Math.max(sheet.getLastRow(), 1), STYLE.rowHeight);
  sheet.getRange(1, 1, 1, width).setFontSize(STYLE.bodySize);
}

/**
 * 客戶名字直接拿來當分頁名。舊表匯進來的名字裡可能有斜線（`名字(高能/sis)3157`），
 * 而分頁名不吃那些字元 —— 換成減號，並留住原名在分頁裡面的標題列。
 */
function sheetNameFor(name) {
  var safe = String(name || '（沒有名字）').replace(/[\\/:*?\[\]']/g, '-').trim();
  return safe.slice(0, 90) || '（沒有名字）';
}

/** 分頁預設 1000 列 × 26 欄。日期一多就會不夠寬，寫下去會直接爆掉。 */
function ensureSize(sheet, rows, cols) {
  if (sheet.getMaxColumns() < cols) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
}

function resetSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    unprotect(sheet);
    sheet.clear();
    sheet.clearConditionalFormatRules();
    // 上一次的合併留著會讓這一次的 setValues 整個炸掉
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  } else {
    sheet = ss.insertSheet(name);
  }
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  return sheet;
}

/**
 * app 裡刪掉的客戶，這裡也要跟著消失。
 *
 * 但**不刪**沒見過的分頁 —— 她可能自己開了一張在旁邊算東西，
 * 而這支指令碼沒有資格判斷那張重不重要。只清掉「曾經是我們產生的」那些，
 * 靠第一列的那句提醒認。
 */
function removeStaleSheets(ss, keep) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (keep[sheet.getName()]) continue;
    if (String(sheet.getRange(1, 1).getValue()).indexOf('系統自動產生') === -1) continue;
    unprotect(sheet);
    ss.deleteSheet(sheet);
  }
}

// ---------- 上鎖 ----------
//
// 兩層。保護範圍讓別人改不動，onEdit 接住漏網的那一種
// （擁有者自己編輯時保護範圍只會跳警告，不會真的擋下來）。

function protectEverything(ss) {
  var me = Session.getEffectiveUser();
  var myEmail = me.getEmail();
  var sheets = ss.getSheets();

  for (var i = 0; i < sheets.length; i++) {
    unprotect(sheets[i]);
    var p = sheets[i].protect().setDescription('由 app 產生，請勿手動編輯');
    p.addEditor(me);

    // 刻意**不用** setWarningOnly：那只會跳一句「你確定嗎」然後照樣讓人改。
    // 對其他人是真的鎖住；對擁有者鎖不住（Google 不讓擁有者把自己鎖在門外），
    // 所以擁有者那一種由下面的 onEdit 接住。
    var others = [];
    var editors = p.getEditors();
    for (var j = 0; j < editors.length; j++) {
      if (editors[j].getEmail() !== myEmail) others.push(editors[j].getEmail());
    }
    if (others.length) p.removeEditors(others);
    if (p.canDomainEdit()) p.setDomainEdit(false);
  }
}

function unprotect(sheet) {
  var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for (var i = 0; i < existing.length; i++) existing[i].remove();
}

/**
 * 手動改了就還原。
 *
 * 這張表是報表不是資料來源（SPEC 第 4.8 節）—— 在這裡改的東西不會回到 app，
 * 而且下一次同步就會被蓋掉。與其讓她改了之後困惑「怎麼又變回去了」，
 * 不如當場還原並講一句。
 */
function onEdit(e) {
  if (!e || !e.range) return;
  if (e.source.getActiveSheet().getName() === DATA_SHEET) return;

  var previous = typeof e.oldValue === 'undefined' ? '' : e.oldValue;
  e.range.setValue(previous);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    '這張表由 app 自動產生，改了也不會回到 app，而且下次同步就會被蓋掉。請回 app 修改。',
    '已還原',
    8,
  );
}
