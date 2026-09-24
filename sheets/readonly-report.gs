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
/**
 * 認得的資料格式版本。對不上就整包拒絕，不要半套渲染。
 * 6（2026-09-24）：來訪紀錄一段一行、帶狀態；多一段「買過什麼」。
 */
var SUPPORTED_FORMAT = 6;

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

/**
 * TODO 與 FINISHED 並排，位置照她舊表：TODO 在 A 欄、FINISHED 在 K 欄。
 *
 * 差別是這兩塊由 app 填，她不用回來勾。舊表的 FINISH 區永遠是空的，
 * 因為那要她手動搬 —— 22 張分頁裡只有 1 筆搬過去
 * （docs/legacy/README.md 第 6 節）。
 */
var TODO_COL = 1;
var FINISH_COL = 11;
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
  pending: '#E3F2FD',
  noShow: '#ECEFF1',
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
      var result = render(SpreadsheetApp.getActiveSpreadsheet(), bundle);
      return reply({
        ok: true,
        sheets: result.sheets,
        // 跳過的要講出來，不然她會以為推好了而那幾位其實沒更新
        skipped: result.skipped,
      });
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

  // 沒有總表。她要的是「和我原本那個一樣」，而舊表從來沒有總表（2026-08-20）。
  var keep = {};
  keep[DATA_SHEET] = true;

  var made = 0;
  var skipped = [];
  for (var i = 0; i < bundle.sheets.length; i++) {
    var written = renderCustomer(ss, bundle.sheets[i], bundle);
    if (written === null) {
      skipped.push(bundle.sheets[i].name);
      continue;
    }
    keep[written] = true;
    made += 1;
  }

  removeStaleSheets(ss, keep);
  protectEverything(ss);
  return { sheets: made, skipped: skipped };
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

function renderCustomer(ss, data, bundle) {
  var name = sheetNameFor(data.name);
  var sheet = resetSheet(ss, name);
  if (!sheet) return null;   // 這張是她自己的，不動它

  var dateCount = data.dateLabels.length;
  var matrixWidth = COL.FIRST_DATE - 1 + Math.max(dateCount, 1);
  // FINISHED 在 K 欄，日期少的時候矩陣還沒那麼寬，但表還是要留到那裡
  var width = Math.max(matrixWidth, FINISH_COL + 2);

  ensureSize(
    sheet,
    MATRIX_HEADER_ROW + data.rows.length + logLineCount(data)
      + ((data.purchases || []).length + 3)
      + ((data.products || []).length + 2)
      + data.tasks.todo.length + data.tasks.finished.length + 20,
    width,
  );
  noticeRow(sheet, width, bundle);

  // 第 2 列：名字大字，右邊接購買名稱與合計
  sheet.getRange(2, 1, 1, 2).merge().setValue(data.name)
    .setFontSize(STYLE.titleSize).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.getRange(2, 3, 1, Math.max(width - 2, 1)).merge()
    .setValue(infoLine(data))
    .setVerticalAlignment('middle').setWrap(true);

  sheet.getRange(3, 1, 1, width).merge()
    .setValue('產生時間 ' + bundle.generatedAt + '　·　這一頁由 app 產生，改資料請回 app'
      + '　·　' + bundle.legend)
    .setFontSize(9).setFontColor('#78909C').setVerticalAlignment('middle');

  // 矩陣表頭
  var head = ['療程項目', '應有', '已完成', '已排未上', '剩餘'].concat(data.dateLabels);
  sheet.getRange(MATRIX_HEADER_ROW, 1, 1, head.length).setValues([head]);
  styleHeader(sheet.getRange(MATRIX_HEADER_ROW, 1, 1, head.length));

  // 每一列的內容與它是什麼。**「這一天用了哪一台」那一列夾在它那一筆額度的
  // 正下方**（格式 4，她的原話：「在當天的那一列下面」），所以不能先把
  // `data.rows` 直接攤成矩陣 —— 上色那一圈的 index 要對得上真正的列號。
  var rows = [];
  var meta = [];
  for (var n = 0; n < data.rows.length; n++) {
    var one = data.rows[n];
    rows.push([one.label, one.total, one.done, one.booked, one.remaining].concat(one.marks));
    meta.push(one);

    var note = equipmentNoteAt(data, n);
    if (note) {
      rows.push(noteLine(note, head.length));
      meta.push(null);   // null = 註記列，不上色也沒有數字
    }

    // 「那一段記了什麼」（格式 5）。接在器材那一列後面，同樣夾在它那一筆
    // 額度的正下方 —— 她 2026-09-16 要的：「記在當天那一列的下面」。
    var said = noteRowAt(data.slotNotes, n);
    if (said) {
      rows.push(noteLine(said, head.length));
      meta.push(null);
    }
  }

  var top = MATRIX_HEADER_ROW + 1;
  if (rows.length) {
    var body = sheet.getRange(top, 1, rows.length, head.length);
    body.setValues(rows).setVerticalAlignment('middle').setWrap(true);
    sheet.getRange(top, 2, rows.length, head.length - 1).setHorizontalAlignment('center');
    banding(sheet, top, rows.length, head.length);

    for (var i = 0; i < meta.length; i++) {
      var r = meta[i];
      if (!r) {
        // 註記列：小一號的灰字，跟上面那一列分得出來但看得出是一組
        sheet.getRange(top + i, 1, 1, head.length)
          .setFontSize(9).setFontColor(COLOR.noticeText);
        continue;
      }
      if (r.done > 0) sheet.getRange(top + i, COL.DONE).setBackground(COLOR.done);
      if (r.booked > 0) sheet.getRange(top + i, COL.BOOKED).setBackground(COLOR.booked);
      if (r.remaining === 0) sheet.getRange(top + i, COL.REMAINING).setBackground(COLOR.low);
      // 有東西的格子上色。符號看久了會漏看，一片顏色不會 ——
      // 而且顏色要跟著符號分，否則三種狀態在畫面上又變回一種。
      for (var d = 0; d < r.marks.length; d++) {
        var colour = colourForMark(r.marks[d]);
        if (colour) sheet.getRange(top + i, COL.FIRST_DATE + d).setBackground(colour);
      }
    }
  }

  var after = MATRIX_HEADER_ROW + Math.max(rows.length, 1) + 1;
  after = renderFollowupNotes(sheet, data, after, matrixWidth);
  after = renderPurchases(sheet, data, after, width);
  after = renderProducts(sheet, data, after, width);
  after = renderNotes(sheet, data, after + 1, width);
  renderTasks(sheet, data, after, width);

  sheet.setColumnWidth(COL.LABEL, STYLE.labelWidth);
  for (var c = COL.TOTAL; c < COL.FIRST_DATE; c++) sheet.setColumnWidth(c, STYLE.countWidth);
  for (var d2 = 0; d2 < dateCount; d2++) {
    sheet.setColumnWidth(COL.FIRST_DATE + d2, STYLE.dateWidth);
  }
  // 只凍結列，**不要凍結欄**。表頭那三列是橫跨整張表的合併儲存格，
  // 而 Google 試算表不讓凍結線穿過合併儲存格 —— 加回 setFrozenColumns(1)
  // 會在這裡丟例外，第一位客戶之後一張都畫不出來。
  // 見 .scratch/first-real-import/issues/01-frozen-column-splits-a-merged-cell.md
  sheet.setFrozenRows(MATRIX_HEADER_ROW);
  // 字體蓋整張寬度（含 FINISHED 那幾欄），框線只框矩陣
  finish(sheet, MATRIX_HEADER_ROW, rows.length, head.length, width);
  return name;
}

/** 符號決定顏色，不是「有沒有東西」決定顏色。 */
function colourForMark(mark) {
  if (!mark) return null;
  if (mark.indexOf('✓') === 0) return COLOR.done;
  if (mark.indexOf('△') === 0) return COLOR.booked;
  if (mark.indexOf('○') === 0) return COLOR.pending;
  return COLOR.noShow;
}

/**
 * 第 n 筆額度底下要不要接一列「這一天用了哪一台」（格式 4）。
 *
 * 只有**得選的擇一池**才有（`domain/sheetReport.js` 的 `equipmentCells()`）：
 * 單台的池那一列的名字已經是「超磁場(60)」了，再寫一次是噪音。
 *
 * 舊格式沒有這一份，`data.equipmentNotes` 是 undefined —— 那時候一列都不畫。
 */
function equipmentNoteAt(data, rowIndex) {
  return noteRowAt(data.equipmentNotes, rowIndex);
}

/**
 * 第 n 筆額度底下的那一列註記。**兩種註記共用一支**（器材那一份與
 * 「那一段記了什麼」那一份形狀一模一樣：`{rowIndex, label, cells}`）。
 *
 * 舊格式沒有那一份時傳進來的是 undefined —— 那時候一列都不畫。
 */
function noteRowAt(notes, rowIndex) {
  var list = notes || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].rowIndex === rowIndex) return list[i];
  }
  return null;
}

/** 那一列的內容：前五欄留白，日期欄放那一格的字。 */
function noteLine(note, width) {
  var line = [];
  for (var i = 0; i < width; i++) line.push('');
  for (var c = 0; c < note.cells.length; c++) {
    var col = COL.FIRST_DATE - 1 + note.cells[c].dateIndex;
    if (col < width) line[col] = note.cells[c].text;
  }
  return line;
}

/**
 * 二返註記。緊接在矩陣底下那一列，寫在**那次健檢被勾起來的那一欄**。
 *
 * 位置與寫法都照她原本的（docs/legacy/README.md 第 6 節）——
 * 她看那一格的習慣已經養成了十幾張分頁，不要搬家。
 */
function renderFollowupNotes(sheet, data, top, matrixWidth) {
  var notes = data.followupNotes || [];
  if (!notes.length) return top;

  for (var i = 0; i < notes.length; i++) {
    var col = COL.FIRST_DATE + notes[i].dateIndex;
    if (col > matrixWidth) continue;   // 日期欄不見了就不要寫到表外面去
    sheet.getRange(top, col).setValue(notes[i].text)
      .setFontSize(9).setFontColor(COLOR.noticeText)
      .setVerticalAlignment('middle').setWrap(true);
  }
  return top + 1;
}

/**
 * 營養品那一區。緊接在二返註記底下。
 *
 * **格式 3 起它才自己一區。** 以前營養品混在矩陣裡，而那四個數字欄印的是
 * 月數 —— 「應有 2 已完成 0 已排未上 0 剩餘 2」沒有一個看得懂。
 *
 * **一筆都沒有就整段不畫** —— 大部分客戶不買，而一個永遠空著的區塊只是在
 * 每次看報表時提醒她那件事不存在。
 */
function renderProducts(sheet, data, top, width) {
  var rows = data.products || [];
  if (!rows.length) return top;

  var head = top + 1;
  blockHead(sheet, head, 1, '營養品');

  var headers = ['品名', '金額', '幾個月', '哪幾種', '給了沒'];
  sheet.getRange(head + 1, 1, 1, headers.length).setValues([headers]);
  styleHeader(sheet.getRange(head + 1, 1, 1, headers.length));

  var body = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    body.push([
      r.label || '',
      r.amount == null ? '' : r.amount,
      r.months == null ? '' : r.months,
      (r.items || []).join('、'),
      (r.deliveredAt ? r.deliveredAt + '　' : '') + (r.delivery || ''),
    ]);
  }
  sheet.getRange(head + 2, 1, body.length, headers.length).setValues(body)
    .setVerticalAlignment('middle').setWrap(true);

  // 還沒給完的那幾列標起來 —— 那是她要回去補的東西。
  // 借「已排未上」那個琥珀色，不開新色（同 ADR-0039 的判斷：色不夠用了）。
  for (var j = 0; j < rows.length; j++) {
    if (rows[j].done) continue;
    sheet.getRange(head + 2 + j, 1, 1, headers.length).setBackground(COLOR.booked);
  }

  return head + 2 + body.length + 1;
}

/**
 * 備註區。
 *
 * 舊表上這一段是她手寫在 A 欄的：健康狀況、家人、偏好、住哪裡。
 * 匯入時全進了 `customer.notes`（ADR-0019），這裡放回去 ——
 * 不放回去她會覺得表變空了。
 *
 * 底下再接來訪紀錄：那天幾點、哪一間、誰做的、用了什麼，舊表從來記不住的東西。
 */
function renderNotes(sheet, data, top, width) {
  var row = top;

  row = noteBlock(sheet, row, width, '備註', [
    data.flags && data.flags.length ? '永久限制：' + data.flags.join('、') : '',
    data.notes || '',
  ].filter(String));

  // **日期自己一行，底下一段一行、前面是那一段的狀態**（格式 6）。她 2026-09-24：
  // 「第一段會接在日期後面，然後下面的不會，能不能就是第一行是日期，然後換行後在寫每一段，
  // 這樣感覺就可以對齊了」。以前是一天一格、第一段接在日期後面、後面幾段縮三個全形空白 ——
  // 日期的字數不一樣就對不齊。
  //
  // **一行一列，不是一格塞好幾行**：合併儲存格不一定會自己長高，一格塞四行常常只看得到第一行。
  // 取消的段 app 那側就不送了（她選「不寫」）；狀態的字也是 app 給的，這裡不另寫一份對照。
  var lines = [];   // { text, day }：day 是日期那一列（粗體）
  for (var i = 0; i < data.log.length; i++) {
    var day = data.log[i];
    lines.push({ text: day.label, day: true });
    for (var j = 0; j < day.items.length; j++) {
      var it = day.items[j];
      lines.push({ day: false, text: '　' + [
        it.status,
        it.time,
        it.course,
        it.equipment,
        it.ivProduct,
        it.room ? it.room + (it.bed ? ' 床' + it.bed : '') : '',
        it.therapist,
        it.doctor ? it.doctor + '醫師' : '',
      // **不是 `filter(String)`**：`String(null)` 是 'null'（真值），沒有器材、沒有品項的那兩格
      // 以前留在陣列裡、被 join 印成空的 —— 「復能　　　治3」中間多兩個全形空白，也是對不齊的原因之一
      ].filter(function (x) { return x != null && x !== ''; }).join('　') });
    }
  }
  var end = noteBlock(sheet, row, width, '來訪紀錄', lines.map(function (l) { return l.text; }));
  for (var k = 0; k < lines.length; k++) {
    if (lines[k].day) sheet.getRange(row + 1 + k, 1, 1, width).setFontWeight('bold');
  }
  return end;
}

/** 來訪紀錄會佔幾列：一天一列日期、一段一列。`ensureSize()` 要先開夠。 */
function logLineCount(data) {
  var n = 0;
  for (var i = 0; i < data.log.length; i++) n += 1 + data.log[i].items.length;
  return n;
}

/**
 * 「買過什麼」一天一行（格式 6，ADR-0115）。緊接在二返註記底下、營養品上面 —— 她選的位置。
 *
 * 那一行在 app 組好（`purchaseLines()`，跟 app 的「買過什麼」那一頁同一支算），這裡一個字都不組。
 * **一筆都沒有就整段不畫**（同營養品）。
 */
function renderPurchases(sheet, data, top, width) {
  var lines = data.purchases || [];
  if (!lines.length) return top;
  // noteBlock 底下留了一列空白，營養品那一區自己會再空一列 —— 退一列，中間只空一列
  return noteBlock(sheet, top + 1, width, '買過什麼', lines) - 1;
}

/**
 * TODO 與 FINISHED，並排，位置照她舊表（TODO 在 A 欄、FINISHED 在 K 欄）。
 *
 * **這兩塊由 app 填，她不用回來勾。** 舊表要她手動搬，結果 22 張分頁裡
 * FINISH 只有 1 筆、TODO 的框幾乎全是 FALSE —— 她自己的說法是
 * 「很多 todo 我根本忘記勾」。所以這裡沒有核取方塊，只有現況。
 */
function renderTasks(sheet, data, top, width) {
  var todo = (data.tasks && data.tasks.todo) || [];
  var finished = (data.tasks && data.tasks.finished) || [];

  blockHead(sheet, top, TODO_COL, 'TODO（還沒做的）');
  blockHead(sheet, top, FINISH_COL, 'FINISHED（做完的）');

  var body = top + 2;   // 中間空一列，和舊表一樣
  taskLines(sheet, body, TODO_COL, todo, false);
  taskLines(sheet, body, FINISH_COL, finished, true);

  if (!todo.length) emptyLine(sheet, body, TODO_COL);
  if (!finished.length) emptyLine(sheet, body, FINISH_COL);

  return body + Math.max(todo.length, finished.length, 1) + 1;
}

function blockHead(sheet, row, col, title) {
  sheet.getRange(row, col, 1, 3).merge().setValue(title)
    .setFontWeight('bold').setBackground(COLOR.noteHeader)
    .setVerticalAlignment('middle');
}

/**
 * 一列一筆：`{M/D} {療程}`、任務種類、死線或完成時間。
 *
 * 日期與療程名中間**有一個空白** —— 舊表沒有，所以 `7/6` 加 `0.75萬健檢`
 * 會黏成 `7/60.75萬健檢`（docs/legacy/README.md 第 6 節）。
 */
function taskLines(sheet, top, col, items, done) {
  for (var i = 0; i < items.length; i++) {
    var t = items[i];
    sheet.getRange(top + i, col, 1, 3).setValues([[
      t.label,
      t.kind,
      done ? (t.doneAt || '').slice(0, 10) : t.dueDate,
    ]]).setVerticalAlignment('middle').setWrap(true);
    if (done) sheet.getRange(top + i, col, 1, 3).setFontColor('#78909C');
  }
}

function emptyLine(sheet, row, col) {
  sheet.getRange(row, col, 1, 3).merge().setValue('（沒有）')
    .setFontColor('#90A4AE').setVerticalAlignment('middle');
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

/**
 * @param {number} matrixWidth 框線要框的範圍（矩陣）
 * @param {number} [fullWidth] 字體要蓋的範圍。省略就跟矩陣一樣寬
 */
function finish(sheet, headerRow, rowCount, matrixWidth, fullWidth) {
  var width = fullWidth || matrixWidth;
  var all = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), headerRow), width);
  all.setFontFamily(STYLE.font).setFontSize(STYLE.bodySize);
  if (rowCount) {
    sheet.getRange(headerRow, 1, rowCount + 1, matrixWidth)
      .setBorder(true, true, true, true, true, true, COLOR.border,
        SpreadsheetApp.BorderStyle.SOLID);
  }
  sheet.setRowHeights(1, Math.max(sheet.getLastRow(), 1), STYLE.rowHeight);
  sheet.getRange(1, 1, 1, width).setFontSize(STYLE.bodySize);
}

/**
 * 客戶名字直接拿來當分頁名。舊表匯進來的名字裡可能有斜線（`名字(高能/sis)1234`），
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

/**
 * 清空重畫。**只清我們自己產生過的分頁。**
 *
 * 分頁是用客戶名字命名的，而她可能在同一份試算表裡自己開了一張同名的
 * （最容易發生的情況：網址不小心填到舊試算表，那裡每一位客戶都有一張）。
 * 沒有這條檢查的話，第一次同步就會把她手寫的東西整張清掉。
 *
 * 判斷方式和 removeStaleSheets() 一樣，靠第一列那句提醒認。
 * 認不出來就不動它，回傳 null，那位客戶這次不渲染。
 */
function resetSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    if (sheet.getLastRow() > 0
        && String(sheet.getRange(1, 1).getValue()).indexOf('系統自動產生') === -1) {
      return null;
    }
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
