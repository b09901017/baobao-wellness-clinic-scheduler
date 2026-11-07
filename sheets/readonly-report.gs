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
 * 3. 左邊「服務」旁邊的 ＋ → 選「Google Sheets API」→ ID 保持 `Sheets` → 新增（2026-11-05 起一次讀完每一頁用它；
 *    沒加也推得上去，只是慢：平常推 5 秒變十幾秒。要在部署之前加，部署時才帶得進去）。
 * 4. 部署 → 新增部署作業 → 網頁應用程式
 *      執行身分：我
 *      誰可以存取：**所有人**
 *    （必須是「所有人」，因為 app 是從瀏覽器直接送過來的，帶不了你的 Google 登入。
 *      擋住不速之客的是上面那組密鑰，不是這個選項。）
 * 5. 複製部署後的網址，連同密鑰填進 app 的「設定 → 試算表報表」。
 * 6. 舊的 onEdit 那支請整份刪掉 —— 這張表從此是報表，不是資料來源。
 *
 * 之後 app 每次存檔，安靜幾秒就會自己推一份過來。
 */

var TOKEN_PROPERTY = 'SYNC_TOKEN';
var DATA_SHEET = '_data';
/**
 * 認得的資料格式版本。對不上就整包拒絕，不要半套渲染。
 * 6（2026-09-24）：來訪紀錄一段一行、帶狀態；多一段「買過什麼」。
 * 7（2026-10-05）：來訪紀錄那一行的最後面多「記一句：…」—— 沒有額度的段（n返、功醫門診）記的那一句。
 * 8（2026-10-19）：每一頁多 `fingerprint`（沒變的那幾頁不重畫）與 `chartNo`（抬頭那一行印病歷號）；
 *    請求多一個 `force`（設定頁「整份重畫」）。回報多 `kept`（沒變、只改了產生時間的幾頁）。
 *    2026-11-05（ADR-0174，格式沒升）：請求最外層多一個選填的 `dataAt`；比上一次畫完的舊 → 不畫、回 `{ ok: true, stale: true }`。
 */
var SUPPORTED_FORMAT = 8;

/**
 * **這一份指令碼自己的排版版號**（ADR-0161）。指紋是 app 算的，app 不知道這一份指令碼畫得怎樣 ——
 * 所以記下來的指紋後面接著這個數字：**改了任何一頁的畫法就加一**，下一次推送每一頁都重畫。
 * 忘了加的話，沒變的那幾頁會一直停在舊的畫法（直到那一位的資料變了、或按「整份重畫」）。
 */
var LAYOUT_VERSION = 8;
/** 每一頁上次畫的指紋記在文件屬性裡，鍵是「fp:分頁名」。分頁刪掉、改名，鍵就對不到 → 重畫。 */
var FP_PREFIX = 'fp:';
/**
 * 上一次畫完的那一包的資料時間（ADR-0174；文件屬性，毫秒）。app 每一包附 `dataAt`（稽核紀錄最新那一則的伺服器時間，
 * 打包之前讀的）—— 比這個舊的那一包不畫：兩台裝置幾乎同時推時，比較舊的那一包等到鎖之後會把新的蓋掉。
 * 不是 `fp:` 開頭，`forgetStale()` 不會清掉它。
 */
var LAST_DATA_AT = 'lastDataAt';

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
  // F 一條窄的空白欄（沒有字、沒有框線、白底）：數字四欄跟日期隔開（她 11/5 晚挑的「A 全白＋窄空白欄」，issues/14、
  // `.scratch/sheet-push-gaps/mock-count-columns-2026-11-05.html`）。以前是四欄淡灰底＋剩餘右邊一條粗線
  SPACER: 6,
  FIRST_DATE: 7, // G 以後每欄一個日期
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
var HEADER_ROWS = 4;  // 提醒、名字、號碼／購買名稱／合計、產生時間（2026-11-05 起沒有空行，issues/09）
var MATRIX_HEADER_ROW = HEADER_ROWS + 1;
/** 產生時間那一列。沒變的那幾頁只改這一格（`render()`）—— 畫的那一側與改時間的那一側都讀這個數字。 */
var STAMP_ROW = 4;
/*
 * **欄不凍結**（2026-11-05 晚，issues/14，ADR-0176 推翻 ADR-0175 的「凍結前五欄」）：她看了凍結的樣子說分裂感太重 ——
 * 所以最上面四列與下面「買過什麼」「營養品」「備註」「來訪紀錄」又是整頁寬（`width`）。
 * **列也不凍結**（2026-11-06，issues/16，ADR-0178 推翻 ADR-0176 的「列照舊凍結到矩陣表頭」）：她「就都不要有凍結，太割裂了」。
 * **哪天要再凍結欄**：凍結線不能穿過合併儲存格（Google 會丟例外，`.scratch/first-real-import/issues/01`），那些整頁寬的合併要先收回來。
 */

var STYLE = {
  font: 'Noto Sans TC',
  // 名字 18 號（她 11/5：「字再大一點」；.scratch/sheet-push-gaps/issues/08）
  titleSize: 18,
  bodySize: 11,
  labelWidth: 190,
  countWidth: 62,
  // 數字四欄與日期中間那一條空白欄（`COL.SPACER`）
  spacerWidth: 8,
  // 78：「10/29(四)」一行放得下（58 的時候常被擠到第二行，issues/08）
  dateWidth: 78,
  noteWidth: 300,
  rowHeight: 26,
  // 名字那一列（18 號字一行）
  titleHeight: 40,
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
  low: '#FFCDD2',      // 剩餘 0 或負數（超用）
  border: '#B0BEC5',
  noteHeader: '#ECEFF1',
  // 數字四欄與日期中間那一條空白欄：表頭那一格也白（issues/14）。應有～剩餘四欄不另外上底色，跟整列一樣（斑馬紋、狀態色照舊）
  spacer: '#FFFFFF',
  // 備註那一塊「永久限制：…」那一行（issues/12）
  flag: '#FDE7E7',
};

/**
 * 備註一則一列的底色（issues/12）：她在 app 裡替那則短備註挑的顏色的**淡色版**（`tokens.css` 淺色主題的 `--mark-*` 跟白色 15:85 混，
 * 黑字看得清楚）。鍵是 `domain/customerMarks.js` 的 `MARK_COLORS` 的 id —— `.gs` 讀不到 `tokens.css`，所以這裡另寫一份；
 * 那六色改了要回來改這裡。認不得的照灰色（同 `colorToken()`）。
 */
var MARK_TINT = {
  grey: '#EBEAE8',    // --mark-grey #7c7268
  green: '#E2EBE7',   // --mark-green #3f7a5f
  tea: '#F3EAE2',     // --mark-tea #b0763b
  red: '#F3E3E1',     // --mark-red #b04434
  blue: '#E4ECF0',    // --mark-blue #4d7f9c
  violet: '#EBE7EF',  // --mark-violet #7a6096
};

/**
 * 記一句疊在日期底下那幾格的底色（issues/15）：她 11/6「附註的那一個可以用舒服的顏色填滿，你就隨機填顏色就好」。
 * **照「第幾個日期＋疊在第幾格」錯開**（`(日期 + 格) % 5`），不是真的隨機：上下、左右挨著的不同色，同一份資料每次畫出來都一樣（指紋才有意義）。
 * 一開始是每一頁從第一色輪起 —— 大部分頁只有一兩句，11/6 staging 那一份 25 句裡 17 句同一色，看起來不像她說的「隨機」。
 * Google 試算表「淺色 2」那一排裡挑的；**避開狀態色**（綠、黃、淡藍、灰、紅，`COLOR`）—— 疊在日期那一欄底下，同色會被看成那一天的狀態。
 */
var NOTE_FILLS = [
  '#D9D2E9',  // 淡紫
  '#FCE5CD',  // 淡橘
  '#D0E0E3',  // 灰青
  '#EAD1DC',  // 淡玫瑰
  '#E6E0C8',  // 淡沙
];

// ---------- 收件口 ----------

// ---------- 每一步花幾秒（.scratch/sheet-push-gaps/issues/05）----------
//
// 寫進執行紀錄（Apps Script →「執行作業」→ 點那一次 → 記錄）一行：`計時 {"ms":{…},"drawn":N,"kept":M}`。
// 重畫比預估的慢（寫少了四分之三、時間只少三分之一），要知道慢在哪一步才決定下一步。
// **每一步結束時 `SpreadsheetApp.flush()`**：Google 會把寫入排著、等到下一次讀才做，不 flush 的話時間全算到後面那一步。
// 代價是多幾次 flush，總時間會比不量的時候慢一點點。

/** 執行紀錄裡一定有的那幾步（沒走到的記 0）。 */
var CLOCK_STEPS = ['總共', '等鎖', '讀', '原始資料', '清空', '排版', '寫值', '格式', '合併', '框線欄寬', '上鎖', '指紋', '改時間', '刪舊頁'];
var CLOCK = null;

function clockStart() {
  CLOCK = { start: Date.now(), ms: {}, drawn: 0, kept: 0 };
  for (var i = 0; i < CLOCK_STEPS.length; i++) CLOCK.ms[CLOCK_STEPS[i]] = 0;
  return CLOCK.start;
}

/** 從 `since` 到現在算進 `step`；`flush` 為真先把排著的寫入做完。回現在（給下一步當起點）。 */
function clockAdd(step, since, flush) {
  if (flush) SpreadsheetApp.flush();
  var now = Date.now();
  if (CLOCK) CLOCK.ms[step] = (CLOCK.ms[step] || 0) + (now - since);
  return now;
}

/** 寫進執行紀錄、回那一行（`doPost()` 再寫進 `_data` 的 B1：網頁應用程式被「所有人」叫的那幾次，執行作業那一頁常常不顯示紀錄）。 */
function clockLog(extra) {
  if (!CLOCK) return null;
  CLOCK.ms['總共'] = Date.now() - CLOCK.start;
  var out = { ms: CLOCK.ms, drawn: CLOCK.drawn, kept: CLOCK.kept };
  for (var k in (extra || {})) out[k] = extra[k];
  var line = '計時 ' + JSON.stringify(out);
  console.log(line);
  CLOCK = null;
  return line;
}

/**
 * 計時那一行也寫進藏起來的 `_data` 分頁的 B1（11/5 她：執行作業那一列展不開、看不到紀錄）。
 * 每一次推送 `stashRawData()` 都清空 `_data` 再寫原始資料，所以 B1 永遠是最近一次畫過的那一趟。寫不進去就算了 —— 它只是給人看的。
 */
var TIMING_SHEET = null;

function noteTiming(line) {
  // 用 `stashRawData()` 手上那一張，不再讀一次（讀會讓排著的寫入先做完，又多一次「寫完又讀」）
  var sheet = TIMING_SHEET;
  TIMING_SHEET = null;
  if (!line || !sheet) return;
  try {
    // 一格也用 setValues：客戶那幾頁一律先畫在草稿紙上、不逐格 setValue，這一格不是畫法（測試照名字數）
    sheet.getRange(1, 2).setValues([[line]]);
  } catch (err) {
    // 不影響推送的結果
  }
}

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
    var lockFrom = clockStart();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      clockLog({ busy: true });
      return reply({ ok: false, error: '另一份同步還在進行中' });
    }
    clockAdd('等鎖', lockFrom, false);

    var staleSkip = false;
    try {
      // **拿到鎖之後才比、才記**（ADR-0174）：比較舊的那一包不畫 —— 整份重畫（force）也一樣
      var props = PropertiesService.getDocumentProperties();
      var stored = props.getProperties();
      var dataAt = requestDataAt(body);
      if (isStaleBundle(dataAt, stored[LAST_DATA_AT])) {
        staleSkip = true;
        return reply({ ok: true, stale: true });
      }
      var result = render(SpreadsheetApp.getActiveSpreadsheet(), bundle, body.force === true, stored);
      // 畫完才記（畫到一半逾時不記）。沒帶時間的（舊版 app）照畫、不記
      if (dataAt !== null) props.setProperty(LAST_DATA_AT, String(dataAt));
      return reply({
        ok: true,
        sheets: result.sheets,
        // 沒變、只改了產生時間那一列的那幾頁（ADR-0161）
        kept: result.kept,
        // 跳過的要講出來，不然她會以為推好了而那幾位其實沒更新
        skipped: result.skipped,
      });
    } finally {
      var timing = clockLog(staleSkip ? { stale: true } : null);
      // 比較舊的那一包沒畫：B1 留著上一次畫的那一趟
      if (!staleSkip) noteTiming(timing);
      lock.releaseLock();
    }
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/** 請求最外層的 `dataAt`（毫秒）。沒帶、不是有限的數字 → null（舊版 app、或那一則稽核還沒送上雲端）。 */
function requestDataAt(body) {
  var at = body && body.dataAt;
  return typeof at === 'number' && isFinite(at) ? at : null;
}

/**
 * 這一包是不是比上一次畫完的那一包舊。**純函式**（`tests/sheet-stale-bundle.test.js`）。
 * 一樣的照畫（整包是冪等的）；任何一邊沒有時間照畫 —— 拿不準一律畫，最壞是跟以前一樣。
 *
 * @param {number|null} dataAt 這一包的
 * @param {string|undefined|null} last 文件屬性裡記的（字串）
 */
function isStaleBundle(dataAt, last) {
  if (dataAt === null || last == null || last === '') return false;
  var before = Number(last);
  return isFinite(before) && dataAt < before;
}

function reply(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- 渲染 ----------

/** 第一列那句提醒裡一定有的字：認得出「這一頁是我們畫的」。 */
var OURS_MARK = '系統自動產生';
/** 鎖的說明。`_data` 那一頁的鎖已經是這一個、只有我能改，就不拆了重上。 */
var PROTECT_NOTE = '由 app 產生，請勿手動編輯';

/**
 * 畫整包。**沒變的那幾頁不重畫**（ADR-0161）：app 每一頁附一個指紋（那一頁會畫出來的每一樣），
 * 跟這一頁上次畫的那一個一樣、分頁還在、第一列那句提醒也還在 → 只改產生時間那一列（`STAMP_ROW`）。
 * 指紋只記在這一側：她有手機與 iPad 兩台，各記各的會安靜地錯（8/27 那一支不照做的理由）。
 *
 * 每畫好一頁就上鎖、記下指紋 —— Apps Script 一次最多跑 6 分鐘，逾時的話下一次推送從沒畫完的那一頁接著做。
 * `force`（設定頁「整份重畫」）忽略指紋，等於以前的行為。
 *
 * **先讀完再寫**（2026-11-05，.scratch/sheet-push-gaps 的 02；Google 官方的 Apps Script 最佳做法）：
 * 每一次「寫完又讀」Google 都得先把前面排著的寫入做完才回答得了 —— 以前一頁讀四次、寫一次、下一頁又讀，
 * 34 頁都沒變的一次推送讀 143 次、寫完又讀 38 次。現在一開始把要知道的全部讀進 `book`（分頁、第一列、
 * 大小、鎖、指紋），之後整次推送只看這一份、寫的時候跟著改；寫完又讀只剩每畫好一頁上鎖時問一次「誰能改」。
 */
function render(ss, bundle, force, stored) {
  var t = Date.now();
  var props = PropertiesService.getDocumentProperties();

  // ---- 先讀完 ----
  // `stored`：doPost() 比新舊時已經讀過一次全部的文件屬性，傳進來就不再讀
  stored = stored || props.getProperties();
  var user = Session.getEffectiveUser();
  var me = { user: user, email: user.getEmail() };
  var book = readBook(ss);
  var data0 = book.byName[DATA_SHEET] || null;
  var dataLock = data0 ? lockState(data0, me) : null;
  if (data0 && data0.hidden == null) data0.hidden = data0.sheet.isSheetHidden();
  var plans = [];
  var inBundle = {};
  for (var p0 = 0; p0 < bundle.sheets.length; p0++) {
    var name0 = sheetNameFor(bundle.sheets[p0].name);
    inBundle[name0] = true;
    var entry0 = book.byName[name0];
    var plan0 = planFor(entry0, stored, name0, markOf(bundle.sheets[p0]), force);
    if (plan0 === 'draw' && entry0) {
      // 要重畫的那幾頁：認不認得（第一列空著才要問整頁是不是空的）、多大、上面有幾道鎖
      lastRowOf(entry0);
      if (isOurs(entry0.a1) || entry0.lastRow === 0) {
        sizeOf(entry0);
        // 鎖對了就留著（issues/06）；不對的才要先拿到那幾道 Protection，等一下拆
        entry0.keepLock = keepsLock(entry0, me);
        if (!entry0.keepLock) protectionsOf(entry0);
      }
    }
  }
  for (var s0 = 0; s0 < book.list.length; s0++) {
    // 這一包裡沒有、是我們畫的那幾頁等一下要刪：刪之前先拆鎖
    var old = book.list[s0];
    if (!inBundle[old.name] && old.name !== DATA_SHEET && isOurs(old.a1)) protectionsOf(old);
  }

  t = clockAdd('讀', t, false);

  // ---- 再寫 ----
  stashRawData(ss, bundle, book, data0);
  // 沒有總表。她要的是「和我原本那個一樣」，而舊表從來沒有總表（2026-08-20）。
  var keep = {};
  keep[DATA_SHEET] = true;
  if (!dataLock || !dataLock.ok) {
    var dataEntry = book.byName[DATA_SHEET];
    // 剛建好的那一頁上面沒有鎖
    protectSheet(dataEntry.sheet, me, dataLock ? dataLock.existing : []);
    dataEntry.protections = null;
  }
  t = clockAdd('原始資料', t, true);

  var made = 0;
  var kept = 0;
  var skipped = [];
  var stamp = stampLine(bundle);
  // 沒變的那幾頁先一起改時間（只寫、各在各的分頁，跟重畫的那幾頁誰先誰後畫出來都一樣）—— 才量得出「改時間」花多久
  var drawList = [];
  for (var k0 = 0; k0 < bundle.sheets.length; k0++) {
    var kName = sheetNameFor(bundle.sheets[k0].name);
    var kEntry = book.byName[kName];
    if (planFor(kEntry, stored, kName, markOf(bundle.sheets[k0]), force) === 'keep') {
      kEntry.sheet.getRange(STAMP_ROW, 1).setValue(stamp);
      keep[kName] = true;
      kept += 1;
    } else {
      drawList.push(bundle.sheets[k0]);
    }
  }
  t = clockAdd('改時間', t, true);

  for (var i = 0; i < drawList.length; i++) {
    var data = drawList[i];
    var name = sheetNameFor(data.name);
    var mark = markOf(data);
    // 先拿掉舊的指紋：畫到一半逾時的話，下一次不會把半張表當成畫好了
    props.deleteProperty(FP_PREFIX + name);
    delete stored[FP_PREFIX + name];
    t = clockAdd('指紋', t, false);
    var written = renderCustomer(ss, data, bundle, book);
    t = Date.now();
    if (written === null) {
      skipped.push(data.name);
      continue;
    }
    // resetSheet() 已經把這一頁放進 book（新建的也是）
    var drawn = book.byName[written];
    // 鎖對了就沒拆、不重上（issues/06）；其餘 resetSheet() 已經拆了，這裡上一道新的
    if (!drawn.keepLock) protectSheet(drawn.sheet, me, []);
    drawn.keepLock = false;
    drawn.locks = null;
    drawn.protections = null;
    drawn.a1 = bundle.notice;
    drawn.lastRow = null;
    t = clockAdd('上鎖', t, true);
    if (mark) {
      props.setProperty(FP_PREFIX + written, mark);
      stored[FP_PREFIX + written] = mark;
    }
    t = clockAdd('指紋', t, false);
    keep[written] = true;
    made += 1;
  }

  removeStaleSheets(ss, keep, book);
  forgetStale(props, keep, stored);
  clockAdd('刪舊頁', t, true);
  if (CLOCK) {
    CLOCK.drawn = made;
    CLOCK.kept = kept;
  }
  return { sheets: made, kept: kept, skipped: skipped };
}

/**
 * 一開始一次讀完：每一張分頁的名字與第一列那一格（認得出是不是我們畫的）。
 * 整次推送只看這一份 —— 新建的分頁、畫好的分頁、大小變了都要回來改它（`resetSheet()`、`ensureSize()`、`render()`）。
 * 大小、鎖、整頁是不是空的要用到才讀（`sizeOf()`、`protectionsOf()`、`lastRowOf()`），`render()` 在開始寫之前先問好。
 */
function readBook(ss) {
  var byName = {};
  var list = [];
  var sheets = ss.getSheets();
  // 開了「Google Sheets API」服務：名字、第一格、大小、藏起來了沒、整頁的鎖兩次讀完（issues/07）；沒開或失敗 → 照舊一頁一頁讀
  var api = readBookViaApi(ss, sheets.length);
  for (var i = 0; i < sheets.length; i++) {
    var entry = api
      ? {
        sheet: sheets[i], name: api[i].name, a1: api[i].a1,
        maxRows: api[i].maxRows, maxCols: api[i].maxCols, hidden: api[i].hidden, locks: api[i].locks,
      }
      : { sheet: sheets[i], name: sheets[i].getName(), a1: sheets[i].getRange(1, 1).getValue() };
    list.push(entry);
    byName[entry.name] = entry;
  }
  return { byName: byName, list: list };
}

/**
 * 用 Google Sheets API（Apps Script 的進階服務 `Sheets`）一次讀完每一頁（issues/07）：
 * 一次 `Spreadsheets.get`（名字、大小、藏起來了沒、整頁的鎖與誰能改）、一次 `Values.batchGet`（每一頁的 A1）。
 * 她 11/5 量的平常推 16.5 秒裡「讀」8.4 秒，就是 35 頁各讀一次第一格與名字。
 *
 * **沒開服務（`Sheets` 不存在）、丟錯、回來的頁數對不上 → null**，`readBook()` 照舊一頁一頁讀：
 * 忘了開、或 Google 那一側一時失敗，推送照樣成功，只是慢。順序跟 `getSheets()` 一樣（都是分頁由左到右）。
 *
 * @returns {{name: string, a1: *, maxRows: number, maxCols: number, hidden: boolean, locks: object[]}[]|null}
 */
function readBookViaApi(ss, count) {
  if (typeof Sheets === 'undefined' || !Sheets || !Sheets.Spreadsheets) return null;
  try {
    var id = ss.getId();
    var meta = Sheets.Spreadsheets.get(id, {
      fields: 'sheets(properties(title,hidden,gridProperties(rowCount,columnCount)),protectedRanges(range,description,editors))',
    });
    var sheets = (meta && meta.sheets) || [];
    if (sheets.length !== count) return null;
    var out = [];
    var ranges = [];
    for (var i = 0; i < sheets.length; i++) {
      var pr = sheets[i].properties || {};
      var grid = pr.gridProperties || {};
      out.push({
        name: pr.title,
        hidden: pr.hidden === true,
        maxRows: grid.rowCount,
        maxCols: grid.columnCount,
        locks: wholeSheetLocks(sheets[i].protectedRanges),
      });
      ranges.push("'" + String(pr.title).replace(/'/g, "''") + "'!A1");
    }
    var got = Sheets.Spreadsheets.Values.batchGet(id, { ranges: ranges });
    var values = (got && got.valueRanges) || [];
    if (values.length !== count) return null;
    for (var j = 0; j < values.length; j++) {
      var v = values[j].values;
      // 空的格子 Google 不回 values（跟 getValue() 回 '' 一樣當成空的）
      out[j].a1 = v && v[0] && v[0][0] != null ? v[0][0] : '';
    }
    return out;
  } catch (err) {
    return null;
  }
}

/** API 回的鎖裡「整頁那一種」（範圍只有 sheetId、沒有起訖）：說明、誰能改、網域能不能改。 */
function wholeSheetLocks(ranges) {
  var out = [];
  for (var i = 0; i < (ranges || []).length; i++) {
    var g = ranges[i].range || {};
    if (g.startRowIndex != null || g.endRowIndex != null || g.startColumnIndex != null || g.endColumnIndex != null) continue;
    var editors = ranges[i].editors || {};
    out.push({
      description: ranges[i].description || '',
      users: editors.users || [],
      domainEdit: editors.domainUsersCanEdit === true,
    });
  }
  return out;
}

/** 那一頁多大（`ensureSize()`、`resetSheet()` 的拆合併用）。新建的分頁第一次問才讀。 */
function sizeOf(entry) {
  if (entry.maxRows == null) {
    entry.maxRows = entry.sheet.getMaxRows();
    entry.maxCols = entry.sheet.getMaxColumns();
  }
  return entry;
}

/** 那一頁上面的鎖（整頁那一種）。拆掉之後要設回 null。API 那一份說一道都沒有就不用再問。 */
function protectionsOf(entry) {
  if (!entry.protections) {
    entry.protections = entry.locks && entry.locks.length === 0
      ? []
      : entry.sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  }
  return entry.protections;
}

/** API 那一份的鎖是不是已經對了（剛好一道、說明一樣、網域不能改、只有我）。 */
function locksOk(locks, me) {
  if (locks.length !== 1 || locks[0].description !== PROTECT_NOTE || locks[0].domainEdit) return false;
  for (var i = 0; i < locks[0].users.length; i++) {
    if (locks[0].users[i] !== me.email) return false;
  }
  return true;
}

/**
 * 重畫的那一頁的鎖要不要留著（issues/06）：程式是用她的身分跑的，鎖擋不住它，所以**鎖對了就不拆、不重上**。
 * 她 11/5 量的整份重畫 175 秒裡「上鎖」47 秒，就是每一頁拆了重上（`protect()`、改名單、問誰能改）。
 * 有 API 那一份 → 跟 `_data` 一樣的四個條件（免費）；沒有 → 只看是不是剛好一道（再問說明與名單要多讀好幾次，就不問了：
 * 那一道是這支程式上一次上的，除非她自己進去改過名單）。
 */
function keepsLock(entry, me) {
  if (entry.locks) return locksOk(entry.locks, me);
  return protectionsOf(entry).length === 1;
}

/**
 * 那一頁最後一列有字的是第幾列（`getLastRow()`，0 ＝整頁空著）。**第一列有字就一定不是空的**，不用問 ——
 * 只有第一列空著的才要問：整頁空著的那一種（她清掉了、或剛建好）照舊算我們的、可以畫。
 */
function lastRowOf(entry) {
  if (entry.lastRow == null) entry.lastRow = entry.a1 === '' || entry.a1 == null ? entry.sheet.getLastRow() : 1;
  return entry.lastRow;
}

/** `_data` 那一頁的鎖是不是已經對了：剛好一道、說明一樣、只有我能改、網域裡的人不能改。對了就不拆了重上。 */
function lockState(entry, me) {
  // API 那一份就判得出來，不用再問（鎖不對才要拿 Protection 來拆）
  if (entry.locks) return locksOk(entry.locks, me) ? { ok: true, existing: [] } : { ok: false, existing: protectionsOf(entry) };
  var existing = protectionsOf(entry);
  if (existing.length !== 1 || existing[0].getDescription() !== PROTECT_NOTE || existing[0].canDomainEdit()) {
    return { ok: false, existing: existing };
  }
  var editors = existing[0].getEditors();
  for (var i = 0; i < editors.length; i++) {
    if (editors[i].getEmail() !== me.email) return { ok: false, existing: existing };
  }
  return { ok: true, existing: existing };
}

/** 照手上那一份判 `sheetPlan()`（不讀試算表）。 */
function planFor(entry, stored, name, mark, force) {
  return sheetPlan({
    force: force === true,
    exists: Boolean(entry),
    ours: Boolean(entry) && isOurs(entry.a1),
    stored: stored[FP_PREFIX + name] || null,
    mark: mark,
  });
}

/**
 * 這一頁要不要重畫。**純函式**（node 裡測得到，`tests/sheet-fingerprint.test.js`）：
 * 拿不準一律重畫 —— 分頁不在、第一列那句提醒不在（她清掉了、或不是我們畫的）、沒有指紋、指紋不一樣、按了整份重畫。
 *
 * @param {{force: boolean, exists: boolean, ours: boolean, stored: (string|null), mark: (string|null)}} o
 * @returns {'keep'|'draw'}
 */
function sheetPlan(o) {
  if (o.force || !o.exists || !o.ours || !o.mark || !o.stored) return 'draw';
  return o.stored === o.mark ? 'keep' : 'draw';
}

/** 記下來的那一個：app 給的指紋＋這一份指令碼的排版版號。沒有指紋（舊版 app）→ null，一律重畫。 */
function markOf(data) {
  return data && data.fingerprint ? String(data.fingerprint) + '|' + LAYOUT_VERSION : null;
}

/**
 * 第一列那一格是那句提醒（「系統自動產生」）。不是的話：要嘛她清掉了、要嘛不是我們畫的 —— 都不可以當成沒變。
 * 只看第一列那一格就夠：空的分頁那一格是空字串，一樣認不出（以前多問一次 `getLastRow()`，答案一樣）。
 */
function isOurs(a1) {
  return String(a1).indexOf(OURS_MARK) !== -1;
}

/** 產生時間那一行（`STAMP_ROW`）。沒變的那幾頁只改這一格（她選的：「照樣更新成這一次推送的時間」）。 */
function stampLine(bundle) {
  return '產生時間 ' + bundle.generatedAt + '　·　這一頁由 app 產生，改資料請回 app'
    + '　·　' + bundle.legend;
}

/**
 * 分頁已經不在這一包裡的指紋拿掉 —— 留著的話，同名的分頁下次被她刪了又建回來時會被當成沒變。
 * `stored` 是一開始讀的那一份、這一次推送裡跟著改過（不再讀一次）。
 */
function forgetStale(props, keep, stored) {
  for (var key in stored) {
    if (key.indexOf(FP_PREFIX) !== 0) continue;
    if (!keep[key.slice(FP_PREFIX.length)]) props.deleteProperty(key);
  }
}

/**
 * 原始 JSON 留一份在隱藏分頁。
 *
 * 用途只有一個：渲染出來的東西看起來不對時，可以確認是「推過來就錯了」
 * 還是「排版排錯了」。沒有這一份，出事時只能兩邊瞎猜。
 */
function stashRawData(ss, bundle, book, entry) {
  var sheet;
  var hidden = false;
  if (entry) {
    sheet = entry.sheet;
    hidden = entry.hidden === true;
  } else {
    sheet = ss.insertSheet(DATA_SHEET);
    book.byName[DATA_SHEET] = { sheet: sheet, name: DATA_SHEET, a1: '' };
  }
  sheet.clear();
  TIMING_SHEET = sheet;
  // 一格最多 50000 個字元，整包塞不下就切開來放（一次寫完：一欄好幾列）
  var column = [['這一頁是 app 推過來的原始資料，給出問題時對照用。請不要編輯。']];
  var text = JSON.stringify(bundle);
  for (var i = 0; i * 45000 < text.length; i++) column.push([text.substr(i * 45000, 45000)]);
  sheet.getRange(1, 1, column.length, 1).setValues(column);
  if (!hidden) sheet.hideSheet();
}

/**
 * 畫一位。`book` 是 `render()` 一開始讀的那一份（一定要給：畫好的那一頁由 `resetSheet()` 放進去，`render()` 接著上鎖、記指紋）。
 * 回畫好的分頁名；那一頁是她自己的（認不出來）→ null，這一位這次不畫。
 */
function renderCustomer(ss, data, bundle, book) {
  var t = Date.now();
  var name = sheetNameFor(data.name);
  var entry = resetSheet(ss, name, book);
  if (!entry) return null;   // 這張是她自己的，不動它
  // 先畫在草稿紙上，最後一次寫上去（`paint()`，03）。底下的畫法一行都沒改
  var sheet = new Canvas();

  var dateCount = data.dateLabels.length;
  var matrixWidth = COL.FIRST_DATE - 1 + Math.max(dateCount, 1);
  // FINISHED 在 K 欄，日期少的時候矩陣還沒那麼寬，但表還是要留到那裡
  var width = Math.max(matrixWidth, FINISH_COL + 2);

  // 矩陣底下、每一個日期那一欄往下疊的（二返註記＋記一句，issues/15）
  var below = belowByDate(data, rowOrder(data.rows));

  ensureSize(
    entry,
    MATRIX_HEADER_ROW + data.rows.length + logLineCount(data) + depthOf(below)
      + ((data.purchases || []).length + 3)
      + ((data.products || []).length + 2)
      + ((data.noteLines || []).length || String(data.notes || '').split(String.fromCharCode(10)).length) + 1
      + data.tasks.todo.length + data.tasks.finished.length + 20,
    width,
  );
  t = clockAdd('清空', t, true);
  noticeRow(sheet, width, bundle);

  // 第 2 列名字大字（號碼接在名字後面、一樣大，issues/14）、第 3 列購買名稱＋合計、第 4 列產生時間 —— 整頁寬，長的折行
  sheet.getRange(2, 1, 1, width).merge().setValue(titleLine(data))
    .setFontSize(STYLE.titleSize).setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.getRange(3, 1, 1, width).merge()
    .setValue(infoLine(data))
    .setVerticalAlignment('middle').setWrap(true);

  sheet.getRange(STAMP_ROW, 1, 1, width).merge()
    .setValue(stampLine(bundle))
    .setFontSize(9).setFontColor('#78909C').setVerticalAlignment('middle').setWrap(true);

  // 矩陣表頭（第 6 欄是空白欄：沒有字）
  var head = ['療程項目', '應有', '已完成', '已排未上', '剩餘', ''].concat(data.dateLabels);
  sheet.getRange(MATRIX_HEADER_ROW, 1, 1, head.length).setValues([head]);
  styleHeader(sheet.getRange(MATRIX_HEADER_ROW, 1, 1, head.length));

  // 一筆額度一列。**器材與記一句不再多一列**（2026-11-05，issues/11，ADR-0175）：
  // 「這一天用了哪一台」併進那一格的字（「✓ IN」，格式 4 的 `equipmentNotes`），
  // 「那一段記了什麼」寫進那一格的附註（Google 的 note，右上角小黑三角，格式 5 的 `slotNotes`）—— 資料一個字都沒變，這裡畫的時候併。
  //
  // **照「做最多的在上面」畫**（她 11/5，issues/10）：`n` 照舊是 `data.rows` 裡原本的位置 —— 兩份註記的 `rowIndex` 指的是它，
  // 所以器材與記一句跟著它那一筆額度走。
  var rows = [];
  var meta = [];
  var order = rowOrder(data.rows);
  for (var o = 0; o < order.length; o++) {
    var n = order[o];
    var one = data.rows[n];
    var equipmentByDate = cellsByDate(equipmentNoteAt(data, n), one.marks.length);
    var marks = [];
    for (var m = 0; m < one.marks.length; m++) marks.push(markWithEquipment(one.marks[m], equipmentByDate[m]));
    rows.push([one.label, one.total, one.done, one.booked, one.remaining, ''].concat(marks));
    meta.push({ row: one, slotNotesByDate: cellsByDate(noteRowAt(data.slotNotes, n), one.marks.length) });
  }

  var top = MATRIX_HEADER_ROW + 1;
  if (rows.length) {
    var body = sheet.getRange(top, 1, rows.length, head.length);
    body.setValues(rows).setVerticalAlignment('middle').setWrap(true);
    sheet.getRange(top, 2, rows.length, head.length - 1).setHorizontalAlignment('center');
    banding(sheet, top, rows.length, head.length);

    for (var i = 0; i < meta.length; i++) {
      var r = meta[i].row;
      // 記一句：那一格的附註（全文、換行照留；表外的丟掉 —— `cellsByDate()` 只收得到日期欄以內的）
      for (var s2 = 0; s2 < meta[i].slotNotesByDate.length; s2++) {
        if (meta[i].slotNotesByDate[s2]) sheet.getRange(top + i, COL.FIRST_DATE + s2).setNote(meta[i].slotNotesByDate[s2]);
      }
      if (r.done > 0) sheet.getRange(top + i, COL.DONE).setBackground(COLOR.done);
      if (r.booked > 0) sheet.getRange(top + i, COL.BOOKED).setBackground(COLOR.booked);
      // 0 與負數（做的比買的多）都紅。先問是不是數字：沒有額度的那幾列是一槓（字串），
      // 而 JS 裡 '' <= 0、null <= 0 都是 true
      if (typeof r.remaining === 'number' && r.remaining <= 0) {
        sheet.getRange(top + i, COL.REMAINING).setBackground(COLOR.low);
      }
      // 有東西的格子上色。符號看久了會漏看，一片顏色不會 ——
      // 而且顏色要跟著符號分，否則三種狀態在畫面上又變回一種。**看原本的符號**（後面接了器材也一樣）
      for (var d = 0; d < r.marks.length; d++) {
        var colour = colourForMark(r.marks[d]);
        if (colour) sheet.getRange(top + i, COL.FIRST_DATE + d).setBackground(colour);
      }
    }
  }

  // 空白欄整條白（表頭那一格也是，蓋掉表頭色與斑馬紋）
  sheet.getRange(MATRIX_HEADER_ROW, COL.SPACER, rows.length + 1, 1).setBackground(COLOR.spacer);

  var after = MATRIX_HEADER_ROW + Math.max(rows.length, 1) + 1;
  var stack = renderBelowDates(sheet, below, after);
  after = stack.next;
  after = renderPurchases(sheet, data, after, width);
  after = renderProducts(sheet, data, after, width);
  after = renderNotes(sheet, data, after + 1, width);
  renderTasks(sheet, data, after, width);

  sheet.setColumnWidth(COL.LABEL, STYLE.labelWidth);
  for (var c = COL.TOTAL; c <= COL.REMAINING; c++) sheet.setColumnWidth(c, STYLE.countWidth);
  sheet.setColumnWidth(COL.SPACER, STYLE.spacerWidth);
  for (var d2 = 0; d2 < dateCount; d2++) {
    sheet.setColumnWidth(COL.FIRST_DATE + d2, STYLE.dateWidth);
  }
  // **列與欄都不凍結**（她 11/6：「就都不要有凍結，太割裂了」，issues/16，ADR-0178；欄是 issues/14、ADR-0176 拿掉的）。
  // `resetSheet()` 先把凍結歸 0，以前凍結的五列（第四輪）、五列五欄（第三輪）重畫時都拿掉；這裡不再設
  // 格線藏起來，只留矩陣的框線（issues/08，示意圖 6c）
  sheet.setHiddenGridlines(true);
  // 字體蓋整張寬度（含 FINISHED 那幾欄），框線只框矩陣
  finish(sheet, MATRIX_HEADER_ROW, rows.length, head.length, width);
  // 名字那一列加高（18 號字）。折行的那幾列 `finish()` 已經照字數加高了
  sheet.setRowHeights(2, 1, STYLE.titleHeight);
  // 疊在日期底下、要折行的那幾列照字數加高：**設過高度的列 Google 不會自己長高**（11/6 staging 匯出檔：18 句只看得到第一行）。
  // 那幾列沒有合併，`finish()` 的 `fitRows()` 管不到，所以在這裡另外加
  for (var sr = 0; sr < stack.heights.length; sr++) sheet.setRowHeights(stack.heights[sr][0], 1, stack.heights[sr][1]);
  clockAdd('排版', t, false);
  paint(entry.sheet, sheet);
  return name;
}

/**
 * 矩陣要照什麼順序畫：回 `data.rows` 的位置（issues/10）。**純函式**（`tests/sheet-layout.test.js`）。
 *
 * 額度那幾列照「已完成＋已排未上」由多到少，一樣多的照原本的先後（自己比位置，不靠排序穩不穩、不靠語系）；
 * 沒有額度的那幾列（n返、送的／體驗、額度被刪的 —— `syncBundle()` 接在後面的 `extraRows()`，帶 `extra: true`、應有是一槓）
 * 照舊在最下面、照原本的先後。**在這裡排、不在 `syncBundle()` 排**：只是畫的順序，月底對帳照 `syncBundle()` 的列順序對額度。
 */
function rowOrder(rows) {
  var counted = [];
  var extras = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.extra === true || typeof r.total !== 'number') extras.push(i);
    else counted.push(i);
  }
  var doneAndBooked = function (i) {
    var r = rows[i];
    return (typeof r.done === 'number' ? r.done : 0) + (typeof r.booked === 'number' ? r.booked : 0);
  };
  counted.sort(function (a, b) { return doneAndBooked(b) - doneAndBooked(a) || a - b; });
  return counted.concat(extras);
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
 * 第 n 筆額度「這一天用了哪一台」（格式 4）。2026-11-05 起併進那一格的字（`markWithEquipment()`），不再多一列。
 *
 * 只有**得選的擇一池**才有（`domain/sheetReport.js` 的 `equipmentCells()`）：
 * 單台的池那一列的名字已經是「超磁場(60)」了，再寫一次是噪音。
 *
 * 舊格式沒有這一份，`data.equipmentNotes` 是 undefined —— 那時候一格都不併。
 */
function equipmentNoteAt(data, rowIndex) {
  return noteRowAt(data.equipmentNotes, rowIndex);
}

/**
 * 第 n 筆額度的那一份註記。**兩種註記共用一支**（器材那一份與
 * 「那一段記了什麼」那一份形狀一模一樣：`{rowIndex, label, cells}`）。
 *
 * 舊格式沒有那一份時傳進來的是 undefined —— 那時候什麼都不畫。
 */
function noteRowAt(notes, rowIndex) {
  var list = notes || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].rowIndex === rowIndex) return list[i];
  }
  return null;
}

/** 一份註記攤成「第幾個日期 → 那一格的字」（`count` 個，沒有的是 ''）。落在表外的（`dateIndex` 超過日期欄）丟掉，同以前。 */
function cellsByDate(note, count) {
  var out = [];
  for (var i = 0; i < count; i++) out.push('');
  var cells = (note && note.cells) || [];
  for (var c = 0; c < cells.length; c++) {
    var at = cells[c].dateIndex;
    if (typeof at === 'number' && at >= 0 && at < count) out[at] = cells[c].text;
  }
  return out;
}

/** 那一格的字：符號＋空一格＋器材別稱（「✓ IN」「✓2 SIS」）。沒有器材照舊只有符號；只有器材沒有符號就只寫器材。 */
function markWithEquipment(mark, equipment) {
  if (!equipment) return mark;
  return mark ? mark + ' ' + equipment : equipment;
}

/**
 * 矩陣底下：**每一個日期那一欄各自往下疊**（issues/15）。
 *
 * - **二返註記**在最上面，位置與寫法照她原本的（docs/legacy/README.md 第 6 節）：寫在那次健檢被勾起來的那一欄、小字、不塗底 ——
 *   她看那一格的習慣已經養成了十幾張分頁，不要搬家。
 * - **記一句**接在底下（她 11/6：附註「也可以像是現在重複的「二返」記一句那樣記在這表格他那一個日期的最下方……如果有多個那就在往下」）：
 *   有額度的段（`slotNotes`）照矩陣上面那幾列的先後（`order`，`rowOrder()`），再來沒有額度的段（`log[].items[].note`，格式 7，
 *   用 `log[].date` 對 `dates` 找第幾個日期）照時間。附註（小黑三角）照留、來訪紀錄那一行也照留 —— 這裡是多一個一眼看得到的地方。
 * - **器材不疊**（她：「in sis 那種做了什麼的就不用」）：照舊在那一格的字裡（「✓ IN」）。
 *
 * 落在表外的（`dateIndex` 超過日期欄）丟掉，同以前。回 `[[{ text, followup }], …]`：第幾個日期 → 那一欄由上往下的格子。
 */
function belowByDate(data, order) {
  var count = (data.dateLabels || []).length;
  var cols = [];
  for (var i = 0; i < count; i++) cols.push([]);
  var follow = data.followupNotes || [];
  for (var f = 0; f < follow.length; f++) {
    var at = follow[f].dateIndex;
    if (typeof at === 'number' && at >= 0 && at < count && follow[f].text) cols[at].push({ text: follow[f].text, followup: true });
  }
  for (var o = 0; o < order.length; o++) {
    var cells = cellsByDate(noteRowAt(data.slotNotes, order[o]), count);
    for (var d = 0; d < count; d++) {
      if (cells[d]) cols[d].push({ text: cells[d], followup: false });
    }
  }
  var log = data.log || [];
  var dates = data.dates || [];
  for (var l = 0; l < log.length; l++) {
    var idx = dates.indexOf(log[l].date);
    if (idx < 0 || idx >= count) continue;
    var items = log[l].items || [];
    for (var j = 0; j < items.length; j++) {
      if (items[j].note) cols[idx].push({ text: items[j].note, followup: false });
    }
  }
  return cols;
}

/** 疊最深的那一欄有幾格。 */
function depthOf(cols) {
  var depth = 0;
  for (var i = 0; i < cols.length; i++) depth = Math.max(depth, cols[i].length);
  return depth;
}

/**
 * 把 `belowByDate()` 疊好的畫上去。回 `{ next, heights }`：下一塊從哪一列接、要加高的那幾列（`[列, 高]`，`finish()` 之後套）。
 * 每一格先下文字格式（`@`）：一句「10/15」不能被 Google 認成日期（同待辦的日期，issues/08）。
 * 記一句塗 `NOTE_FILLS[(日期 + 格) % 5]`、置中、10 號；二返註記照舊 9 號小字、字色、不塗底。
 * 高度照字數估（`rowHeightFor()`，日期欄 `STYLE.dateWidth` 寬），一列取最高的那一格；沒超過 `STYLE.rowHeight` 的不列。
 */
function renderBelowDates(sheet, cols, top) {
  var tallest = {};
  for (var d = 0; d < cols.length; d++) {
    for (var k = 0; k < cols[d].length; k++) {
      var one = cols[d][k];
      var size = one.followup ? 9 : 10;
      var cell = sheet.getRange(top + k, COL.FIRST_DATE + d).setNumberFormat('@').setValue(one.text)
        .setVerticalAlignment('middle').setWrap(true);
      if (one.followup) {
        cell.setFontSize(size).setFontColor(COLOR.noticeText);
      } else {
        cell.setFontSize(size).setHorizontalAlignment('center').setBackground(NOTE_FILLS[(d + k) % NOTE_FILLS.length]);
      }
      var h = rowHeightFor(one.text, STYLE.dateWidth, size);
      if (h > STYLE.rowHeight && h > (tallest[top + k] || 0)) tallest[top + k] = h;
    }
  }
  var heights = [];
  for (var row in tallest) heights.push([Number(row), tallest[row]]);
  heights.sort(function (a, b) { return a[0] - b[0]; });
  return { next: top + depthOf(cols), heights: heights };
}

/**
 * 營養品那一區。緊接在「買過什麼」底下。
 *
 * **格式 3 起它才自己一區。** 以前營養品混在矩陣裡，而那四個數字欄印的是
 * 月數 —— 「應有 2 已完成 0 已排未上 0 剩餘 2」沒有一個看得懂。
 * **2026-11-05 起一筆一行**（像「買過什麼」，issues/12）：`0901　營養品A　12,000 元・3 個月・魚油、益生菌　——　9/1　還差 益生菌`（購買日是 issues/14 加的）。
 * 以前那張五欄的表寬到第 E 欄以外也看不懂，而凍結五欄之後一格只剩 62 像素。
 *
 * **一筆都沒有就整段不畫** —— 大部分客戶不買，而一個永遠空著的區塊只是在
 * 每次看報表時提醒她那件事不存在。
 */
function renderProducts(sheet, data, top, width) {
  var rows = data.products || [];
  if (!rows.length) return top;
  var lines = [];
  var colours = [];
  for (var i = 0; i < rows.length; i++) {
    lines.push(productLine(rows[i]));
    // 還沒給完的那幾行標起來 —— 那是她要回去補的東西。
    // 借「已排未上」那個琥珀色，不開新色（同 ADR-0039 的判斷：色不夠用了）。
    colours.push(rows[i].done ? null : COLOR.booked);
  }
  return noteBlock(sheet, top + 1, width, '營養品', lines, colours);
}

/**
 * 營養品一行。字都是 app 給的（`syncBundle()` 的 `products`），這裡只接起來 —— 「給了沒」那一段（日期＋`delivery`）
 * 跟手動貼上那條路的「給了沒」那一格一字不差（`customerReport()`）。沒有的那幾段不印。
 * **最前面是購買日**（`0901`，跟「買過什麼」同一種寫法，issues/14）；還沒更新的 app 沒送那一格 → 照舊從名字開始。
 */
function productLine(r) {
  var detail = [
    r.amount == null || r.amount === '' ? '' : thousands(r.amount) + ' 元',
    r.months == null || r.months === '' ? '' : r.months + ' 個月',
    (r.items || []).join('、'),
  ].filter(function (x) { return x !== ''; }).join('・');
  var gave = (r.deliveredAt ? r.deliveredAt + '　' : '') + (r.delivery || '');
  return [r.purchasedAt || '', r.label || '', detail].filter(function (x) { return x !== ''; }).join('　')
    + (gave ? '　——　' + gave : '');
}

/** 12000 → 「12,000」（不靠語系）。 */
function thousands(n) {
  var digits = String(Math.round(Number(n)));
  var out = '';
  for (var i = 0; i < digits.length; i++) {
    var left = digits.length - i;
    out += digits.charAt(i);
    if (left > 1 && left % 3 === 1 && digits.charAt(i) !== '-') out += ',';
  }
  return out;
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

  var marks = noteLinesOf(data);
  row = noteBlock(sheet, row, width, '備註', marks.lines, marks.colours);

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
        // 格式 7：沒有額度的段記的那一句。有額度的段 app 不送這一格（它印在上面那一筆額度底下）
        it.note ? '記一句：' + it.note : '',
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

/**
 * 備註那一塊：「永久限制：…」一行（淡紅）＋每一則短備註一行、用她在 app 裡替那一則挑的顏色（淡色版，issues/12）。
 * **還沒更新的 app 沒送 `noteLines`** → 照 `notes`（短備註換行接起來的那一串）一行一列、統一淡灰 —— 新舊兩邊都合得來，不升 `SYNC_FORMAT`。
 */
function noteLinesOf(data) {
  var lines = [];
  var colours = [];
  if (data.flags && data.flags.length) {
    lines.push('永久限制：' + data.flags.join('、'));
    colours.push(COLOR.flag);
  }
  if (Array.isArray(data.noteLines)) {
    for (var i = 0; i < data.noteLines.length; i++) {
      var one = data.noteLines[i] || {};
      if (!one.text) continue;
      lines.push(String(one.text));
      colours.push(MARK_TINT[one.color] || MARK_TINT.grey);
    }
  } else {
    var parts = String(data.notes || '').split(String.fromCharCode(10));
    for (var j = 0; j < parts.length; j++) {
      var text = parts[j].trim();
      if (!text) continue;
      lines.push(text);
      colours.push(MARK_TINT.grey);
    }
  }
  return { lines: lines, colours: colours };
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
    // 日期那一格寫成文字（issues/08）：不然 Google 把「2026-09-15」認成日期格、照它自己的格式印。
    // `paint()` 先下這個格式再寫值
    sheet.getRange(top + i, col + 2).setNumberFormat('@');
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

/**
 * 一塊：抬頭一列、底下一行一列，每一列合併成整頁寬（`width`；2026-11-05 晚起，issues/14 —— 第三輪只到剩餘那一欄），
 * 長的折行、那一列由 `finish()` 照字數加高。
 * `colours`（選填）：每一行的底色（null ＝不上色；營養品沒給完、備註的顏色，issues/12）。
 *
 * **每一行都是文字格式**（`'@'`，同待辦的日期）：一則一格之後，看起來像數字、日期、公式的那一則（「0912345678」「5/20」「=…」）
 * 寫進去的那一刻會被 Google 認成數字（掉前面的 0）、日期、公式（段二審查）。`paint()` 先下數字格式再寫值。
 */
function noteBlock(sheet, top, width, title, lines, colours) {
  sheet.getRange(top, 1, 1, width).merge().setValue(title)
    .setFontWeight('bold').setBackground(COLOR.noteHeader)
    .setVerticalAlignment('middle');

  if (!lines.length) {
    sheet.getRange(top + 1, 1, 1, width).merge().setValue('（沒有）')
      .setFontColor('#90A4AE').setVerticalAlignment('middle');
    return top + 3;
  }

  for (var i = 0; i < lines.length; i++) {
    var line = sheet.getRange(top + 1 + i, 1, 1, width).merge()
      .setNumberFormat('@').setValue(lines[i]).setWrap(true).setVerticalAlignment('middle');
    if (colours && colours[i]) line.setBackground(colours[i]);
  }
  return top + lines.length + 2;
}

/**
 * 名字那一格：「客戶A　1234」—— 號碼接在名字後面、全形空白隔開、同一個 18 號粗體（她 11/5 晚：「名子旁邊直接也是一樣大的病歷號」，issues/14）。
 * 病歷號（格式 8）從備註搬成一格之後（ADR-0160），備註那一區就不印它；只寫號碼、不寫「病歷號」（issues/08）。沒有號碼的只有名字。
 * 手動貼上那條路（`customerReport()`）不動。
 */
function titleLine(data) {
  return data.chartNo ? data.name + '　' + String(data.chartNo) : data.name;
}

/** 名字底下那一行：購買名稱、會籍、合計（號碼 2026-11-05 晚搬到名字那一格，`titleLine()`）。 */
function infoLine(data) {
  return [
    data.source ? '購買名稱：' + data.source : '',
    data.membershipExpiresAt ? '會籍到期：' + data.membershipExpiresAt : '',
    '合計　應有 ' + data.totals.total + '　已完成 ' + data.totals.done
      + '　已排未上 ' + data.totals.booked + '　剩餘 ' + data.totals.remaining,
  ].filter(String).join('　·　');
}

// ---------- 一頁先畫在記憶體裡 ----------
//
// 2026-11-05（.scratch/sheet-push-gaps 的 03；Google 官方的 Apps Script 最佳做法：同一種動作收成一次）。
// 以前一格一格下：一頁重畫叫 Google 約 190 次（34 頁整份重畫 6,506 次、約 192 秒）——
// `noteBlock()` 每一行各自合併、寫字、換行、置中；矩陣上色逐格；欄寬逐欄。
//
// 現在畫法的程式碼**一行都沒改**（`renderCustomer()` 底下那幾支照舊叫 `sheet.getRange(…).merge().setValue(…)…`），
// 只是那個 `sheet` 換成這一張草稿紙（`Canvas`）：它記下每一格最後的值與格式（後設的蓋掉先設的，跟 Google 一樣）、
// 每一次合併、框線、欄寬、列高、凍結。畫完 `paint()` 一次寫上去 —— 值一次 `setValues`、每一種格式照值分組
// 各一次 `RangeList`、連續的合併一次 `mergeAcross()`、同寬的欄一次 `setColumnWidths()`。
// 畫出來一模一樣是測試釘著的（`tests/sheet-gs-batch.test.js`：雜湊是改前的 `.gs` 跑出來的）。
//
// **草稿紙只做畫法用到的那幾支**。畫法多叫一支它沒有的，替身裡第一次推送就會丟錯 —— 照樣補一支、記進 `paint()`。

/** 每一格會記的格式：草稿紙上那一支 → 寫上去時 RangeList 的哪一支。順序就是 `paint()` 寫的順序（彼此不影響）。 */
var CANVAS_FORMATS = [
  ['setBackground', 'background'],
  ['setFontFamily', 'fontFamily'],
  ['setFontSize', 'fontSize'],
  ['setFontWeight', 'fontWeight'],
  ['setFontColor', 'fontColor'],
  ['setHorizontalAlignment', 'hAlign'],
  ['setVerticalAlignment', 'vAlign'],
  ['setWrap', 'wrap'],
  // 數字格式要在寫值之前下（寫進去的那一刻 Google 就照格式認值），`paint()` 另外先寫它
  ['setNumberFormat', 'numberFormat'],
];

function Canvas() {
  /** values[列][欄]（從 1 起）。沒寫過的是 undefined。 */
  this.values = [];
  this.formats = {};
  for (var i = 0; i < CANVAS_FORMATS.length; i++) this.formats[CANVAS_FORMATS[i][1]] = [];
  this.merges = [];
  /** 每一格的附註（Google 的 note；記一句，issues/11）。notes[列][欄]。 */
  this.notes = [];
  this.borders = [];
  this.widths = [];
  this.heights = [];
  this.frozenRows = null;
  this.frozenCols = null;
  this.hiddenGridlines = null;
}

Canvas.prototype.getRange = function (row, col, rows, cols) {
  rows = rows == null ? 1 : rows;
  cols = cols == null ? 1 : cols;
  if (row < 1 || col < 1 || rows < 1 || cols < 1) {
    throw new Error('範圍不合法：' + row + ',' + col + ',' + rows + ',' + cols);
  }
  return new CanvasRange(this, row, col, rows, cols);
};

Canvas.prototype.setColumnWidth = function (col, width) { this.widths[col] = width; };
Canvas.prototype.setRowHeights = function (start, count, height) { this.heights.push([start, count, height]); };
Canvas.prototype.setFrozenRows = function (n) { this.frozenRows = n; };
Canvas.prototype.setFrozenColumns = function (n) { this.frozenCols = n; };
Canvas.prototype.setHiddenGridlines = function (hidden) { this.hiddenGridlines = hidden; };

/** 跟 Google 一樣：最後一列**有內容**的（寫進 '' 或 null 的不算）。 */
Canvas.prototype.getLastRow = function () {
  for (var r = this.values.length - 1; r >= 1; r--) {
    var row = this.values[r];
    if (!row) continue;
    for (var c = 1; c < row.length; c++) {
      if (row[c] !== '' && row[c] != null) return r;
    }
  }
  return 0;
};

Canvas.prototype.put = function (grid, row, col, value) {
  if (!grid[row]) grid[row] = [];
  grid[row][col] = value;
};

function CanvasRange(canvas, row, col, rows, cols) {
  this.canvas = canvas;
  this.row = row;
  this.col = col;
  this.rows = rows;
  this.cols = cols;
}

CanvasRange.prototype.setValue = function (value) {
  this.canvas.put(this.canvas.values, this.row, this.col, value);
  return this;
};

CanvasRange.prototype.setValues = function (grid) {
  if (grid.length !== this.rows) throw new Error('setValues 列數不合：' + grid.length + ' vs ' + this.rows);
  for (var r = 0; r < grid.length; r++) {
    if (grid[r].length !== this.cols) throw new Error('setValues 欄數不合：' + grid[r].length + ' vs ' + this.cols);
    for (var c = 0; c < grid[r].length; c++) this.canvas.put(this.canvas.values, this.row + r, this.col + c, grid[r][c]);
  }
  return this;
};

CanvasRange.prototype.setNote = function (text) {
  this.canvas.put(this.canvas.notes, this.row, this.col, text);
  return this;
};

CanvasRange.prototype.merge = function () {
  this.canvas.merges.push([this.row, this.col, this.rows, this.cols]);
  return this;
};

CanvasRange.prototype.setBorder = function () {
  this.canvas.borders.push([this.row, this.col, this.rows, this.cols, Array.prototype.slice.call(arguments)]);
  return this;
};

/** 草稿紙才有的：只在還沒設過字級的格子補上（`finish()` 用，issues/05）。 */
CanvasRange.prototype.fillFontSize = function (value) {
  var grid = this.canvas.formats.fontSize;
  for (var r = 0; r < this.rows; r++) {
    for (var c = 0; c < this.cols; c++) {
      var row = grid[this.row + r];
      if (!row || row[this.col + c] === undefined) this.canvas.put(grid, this.row + r, this.col + c, value);
    }
  }
  return this;
};

CANVAS_FORMATS.forEach(function (pair) {
  var key = pair[1];
  CanvasRange.prototype[pair[0]] = function (value) {
    var grid = this.canvas.formats[key];
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) this.canvas.put(grid, this.row + r, this.col + c, value);
    }
    return this;
  };
});

/**
 * 草稿紙寫上去。順序：數字格式 → 值 → 備註 → 其餘格式 → 合併 → 框線 → 欄寬 → 列高 → 格線 → 凍結。
 * 值先寫、再合併（合併區除了左上角都是 ''）：寫進已經合併的範圍 Google 會怎樣，替身驗不出來，就不要走那條路。
 * 凍結最後（凍結線不能穿過合併儲存格，合併要先在）。
 */
function paint(sheet, canvas) {
  var t = Date.now();
  // 數字格式先下（寫值的那一刻 Google 就照它認：先寫再下的話「2026-09-15」已經被認成日期了）
  paintFormat(sheet, canvas, 'setNumberFormat', 'numberFormat');
  var rows = 0;
  var cols = 0;
  for (var r = 1; r < canvas.values.length; r++) {
    if (!canvas.values[r]) continue;
    rows = r;
    cols = Math.max(cols, canvas.values[r].length - 1);
  }
  if (rows && cols) {
    var grid = [];
    for (var r2 = 1; r2 <= rows; r2++) {
      var line = [];
      var src = canvas.values[r2] || [];
      for (var c2 = 1; c2 <= cols; c2++) line.push(c2 < src.length && src.hasOwnProperty(c2) ? src[c2] : '');
      grid.push(line);
    }
    sheet.getRange(1, 1, rows, cols).setValues(grid);
  }
  paintNotes(sheet, canvas.notes);
  t = clockAdd('寫值', t, true);

  for (var f = 0; f < CANVAS_FORMATS.length; f++) {
    if (CANVAS_FORMATS[f][1] === 'numberFormat') continue;
    paintFormat(sheet, canvas, CANVAS_FORMATS[f][0], CANVAS_FORMATS[f][1]);
  }

  t = clockAdd('格式', t, true);

  mergeAll(sheet, canvas.merges);
  t = clockAdd('合併', t, true);

  for (var b = 0; b < canvas.borders.length; b++) {
    var one = canvas.borders[b];
    var range = sheet.getRange(one[0], one[1], one[2], one[3]);
    range.setBorder.apply(range, one[4]);
  }

  for (var w = 1; w < canvas.widths.length; w++) {
    if (canvas.widths[w] == null) continue;
    var end = w;
    while (canvas.widths[end + 1] === canvas.widths[w]) end++;
    sheet.setColumnWidths(w, end - w + 1, canvas.widths[w]);
    w = end;
  }

  for (var h = 0; h < canvas.heights.length; h++) {
    sheet.setRowHeights(canvas.heights[h][0], canvas.heights[h][1], canvas.heights[h][2]);
  }
  if (canvas.hiddenGridlines != null) sheet.setHiddenGridlines(canvas.hiddenGridlines);
  if (canvas.frozenRows != null) sheet.setFrozenRows(canvas.frozenRows);
  if (canvas.frozenCols != null) sheet.setFrozenColumns(canvas.frozenCols);
  clockAdd('框線欄寬', t, true);
}

/**
 * 備註（記一句）一次寫上去：框住每一格有備註的那一塊、一次 `setNotes()`，其餘寫 ''（`resetSheet()` 先清過了，寫 '' 等於沒有）。
 */
function paintNotes(sheet, notes) {
  var top = 0;
  var bottom = 0;
  var left = 0;
  var right = 0;
  for (var r = 1; r < notes.length; r++) {
    if (!notes[r]) continue;
    for (var c = 1; c < notes[r].length; c++) {
      if (!notes[r][c]) continue;
      if (!top) top = r;
      bottom = r;
      if (!left || c < left) left = c;
      if (c > right) right = c;
    }
  }
  if (!top) return;
  var grid = [];
  for (var r2 = top; r2 <= bottom; r2++) {
    var line = [];
    for (var c2 = left; c2 <= right; c2++) line.push((notes[r2] && notes[r2][c2]) || '');
    grid.push(line);
  }
  sheet.getRange(top, left, grid.length, grid[0].length).setNotes(grid);
}

/** 一種格式照值分組、每一組一次 `RangeList` 寫上去。 */
function paintFormat(sheet, canvas, setter, key) {
  var groups = rectsByValue(canvas.formats[key]);
  for (var g = 0; g < groups.length; g++) {
    sheet.getRangeList(groups[g].ranges)[setter](groups[g].value);
  }
}

/**
 * 照先後合併。連著好幾個「同樣幾欄、一列高、一列接一列」的（備註、來訪紀錄那一行一行）收成一次 `mergeAcross()`
 * （它把每一列各自合併）；其餘照舊一次一個 `merge()`。
 */
function mergeAll(sheet, merges) {
  for (var i = 0; i < merges.length; i++) {
    var m = merges[i];
    var j = i;
    while (m[2] === 1 && j + 1 < merges.length
        && merges[j + 1][2] === 1 && merges[j + 1][1] === m[1] && merges[j + 1][3] === m[3]
        && merges[j + 1][0] === merges[j][0] + 1) {
      j++;
    }
    if (j === i) {
      sheet.getRange(m[0], m[1], m[2], m[3]).merge();
    } else {
      sheet.getRange(m[0], m[1], j - i + 1, m[3]).mergeAcross();
    }
    i = j;
  }
}

/**
 * 一張「每一格的格式」照值分組，每一組收成幾塊長方形的 A1（`B3:D5`）—— 同一種值一次 `RangeList` 寫完。
 * 先一列裡連著同一個值的收成一段，再把上下一模一樣的段疊成一塊。沒設過的格子（undefined）不碰。
 *
 * @returns {{value: *, ranges: string[]}[]}
 */
function rectsByValue(grid) {
  var groups = {};
  var order = [];
  var open = {};   // 'c1,c2,key' → 這一塊從第幾列開始、到第幾列
  function close(id) {
    var o = open[id];
    groups[o.key].ranges.push(a1Of(o.top, o.c1) + ':' + a1Of(o.bottom, o.c2));
    delete open[id];
  }
  for (var r = 1; r <= grid.length; r++) {
    var row = grid[r] || [];
    var seen = {};
    for (var c = 1; c < row.length; c++) {
      if (row[c] === undefined) continue;
      var value = row[c];
      var key = typeof value + ':' + String(value);
      var c2 = c;
      while (c2 + 1 < row.length && row[c2 + 1] !== undefined
          && typeof row[c2 + 1] + ':' + String(row[c2 + 1]) === key) {
        c2++;
      }
      if (!groups[key]) {
        groups[key] = { value: value, ranges: [] };
        order.push(key);
      }
      var id = c + ',' + c2 + ',' + key;
      if (open[id] && open[id].bottom === r - 1) {
        open[id].bottom = r;
      } else {
        if (open[id]) close(id);
        open[id] = { top: r, bottom: r, c1: c, c2: c2, key: key };
      }
      seen[id] = true;
      c = c2;
    }
    for (var id2 in open) {
      if (!seen[id2] && open[id2].bottom < r) close(id2);
    }
  }
  for (var id3 in open) close(id3);
  var out = [];
  for (var k = 0; k < order.length; k++) out.push(groups[order[k]]);
  return out;
}

function a1Of(row, col) {
  var letters = '';
  var n = col;
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters + row;
}

// ---------- 共用的排版動作 ----------

function noticeRow(sheet, width, bundle) {
  sheet.getRange(1, 1, 1, width).merge()
    .setValue(bundle.notice)
    .setBackground(COLOR.notice).setFontColor(COLOR.noticeText).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
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
  // **只補沒設過字級的格子**（issues/05）：以前整頁 `setFontSize(11)`，把名字的大字、產生時間那一列與二返註記的 9 號都蓋掉了
  all.setFontFamily(STYLE.font).fillFontSize(STYLE.bodySize);
  if (rowCount) {
    // 框線分兩塊畫：療程項目～剩餘、日期那幾欄。**中間的空白欄（`COL.SPACER`）不畫**（issues/14）
    sheet.getRange(headerRow, 1, rowCount + 1, COL.REMAINING)
      .setBorder(true, true, true, true, true, true, COLOR.border,
        SpreadsheetApp.BorderStyle.SOLID);
    if (matrixWidth >= COL.FIRST_DATE) {
      sheet.getRange(headerRow, COL.FIRST_DATE, rowCount + 1, matrixWidth - COL.FIRST_DATE + 1)
        .setBorder(true, true, true, true, true, true, COLOR.border,
          SpreadsheetApp.BorderStyle.SOLID);
    }
  }
  sheet.setRowHeights(1, Math.max(sheet.getLastRow(), 1), STYLE.rowHeight);
  // 折行的合併儲存格：Google 不會替合併的格子自己長高（只看得到第一行），照字數估幾行、那一列加高（issues/09）
  var tall = fitRows(sheet);
  for (var t = 0; t < tall.length; t++) sheet.setRowHeights(tall[t][0], 1, tall[t][1]);
}

/**
 * 草稿紙上每一個「一列高、折行、有字」的合併儲存格估幾行，要比 `STYLE.rowHeight` 高的回 `[列, 高]`（同一列取最高的）。
 * 欄寬要先設好（`renderCustomer()` 在 `finish()` 之前設）。
 */
function fitRows(canvas) {
  var best = {};
  for (var i = 0; i < canvas.merges.length; i++) {
    var m = canvas.merges[i];
    if (m[2] !== 1) continue;
    var row = canvas.values[m[0]];
    var value = row ? row[m[1]] : undefined;
    var wrap = canvas.formats.wrap[m[0]] && canvas.formats.wrap[m[0]][m[1]];
    if (wrap !== true || typeof value !== 'string' || !value) continue;
    var px = 0;
    for (var c = m[1]; c < m[1] + m[3]; c++) px += canvas.widths[c] || 100;
    var sizes = canvas.formats.fontSize[m[0]];
    var size = (sizes && sizes[m[1]]) || STYLE.bodySize;
    var h = rowHeightFor(value, px, size);
    if (h > STYLE.rowHeight && (!best[m[0]] || best[m[0]] < h)) best[m[0]] = h;
  }
  var out = [];
  for (var r in best) out.push([Number(r), best[r]]);
  out.sort(function (a, b) { return a[0] - b[0]; });
  return out;
}

/**
 * 一段字放進 `px` 寬、`size` 號字要多高（像素）。**純函式**（`tests/sheet-layout.test.js`）。
 * **估的**：中日文、全形字算一個字寬（字級的 4/3 像素）、其餘 0.55 個；換行照算。Google 真的折成幾行只有貼上去才知道 ——
 * 估多了是那一列高一點，估少了是最後一行被切掉，所以寬度先扣 8 像素的邊距。
 */
function rowHeightFor(text, px, size) {
  var em = size * 4 / 3;
  var usable = Math.max(px - 8, em);
  var lines = 0;
  var parts = String(text).split(String.fromCharCode(10));
  for (var p = 0; p < parts.length; p++) {
    var w = 0;
    for (var k = 0; k < parts[p].length; k++) w += parts[p].charCodeAt(k) >= 0x2E80 ? em : em * 0.55;
    lines += Math.max(1, Math.ceil(w / usable));
  }
  return Math.max(STYLE.rowHeight, lines * Math.round(em * 1.35) + 6);
}

/**
 * 客戶名字直接拿來當分頁名。舊表匯進來的名字裡可能有斜線（`名字(高能/sis)1234`），
 * 而分頁名不吃那些字元 —— 換成減號，並留住原名在分頁裡面的標題列。
 */
function sheetNameFor(name) {
  var safe = String(name || '（沒有名字）').replace(/[\\/:*?\[\]']/g, '-').trim();
  return safe.slice(0, 90) || '（沒有名字）';
}

/** 分頁預設 1000 列 × 26 欄。日期一多就會不夠寬，寫下去會直接爆掉。大小讀一開始那一份（`sizeOf()`），加了就跟著改。 */
function ensureSize(entry, rows, cols) {
  var sheet = sizeOf(entry).sheet;
  if (entry.maxCols < cols) {
    sheet.insertColumnsAfter(entry.maxCols, cols - entry.maxCols);
    entry.maxCols = cols;
  }
  if (entry.maxRows < rows) {
    sheet.insertRowsAfter(entry.maxRows, rows - entry.maxRows);
    entry.maxRows = rows;
  }
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
function resetSheet(ss, name, book) {
  var entry = book.byName[name];
  if (entry) {
    if (lastRowOf(entry) > 0 && !isOurs(entry.a1)) return null;
    var sheet = sizeOf(entry).sheet;
    // 鎖對了就留著（`render()` 讀的那一段判好了 `keepLock`）：用她的身分清、畫，鎖擋不住
    if (!entry.keepLock) unprotect(entry);
    sheet.clear();
    // 備註（記一句，issues/11）不在 clear() 的範圍裡：不清的話，搬了位置的那一句會留在舊的那一格
    sheet.clearNotes();
    sheet.clearConditionalFormatRules();
    // 上一次的合併留著會讓這一次的 setValues 整個炸掉
    sheet.getRange(1, 1, entry.maxRows, entry.maxCols).breakApart();
  } else {
    entry = { sheet: ss.insertSheet(name), name: name, a1: '', lastRow: 0 };
    book.byName[name] = entry;
    book.list.push(entry);
  }
  entry.sheet.setFrozenRows(0);
  entry.sheet.setFrozenColumns(0);
  return entry;
}

/**
 * app 裡刪掉的客戶，這裡也要跟著消失。
 *
 * 但**不刪**沒見過的分頁 —— 她可能自己開了一張在旁邊算東西，
 * 而這支指令碼沒有資格判斷那張重不重要。只清掉「曾經是我們產生的」那些，
 * 靠第一列的那句提醒認（一開始讀的那一份，`readBook()`）。
 */
function removeStaleSheets(ss, keep, book) {
  for (var i = 0; i < book.list.length; i++) {
    var entry = book.list[i];
    if (keep[entry.name]) continue;
    if (!isOurs(entry.a1)) continue;
    unprotect(entry);
    ss.deleteSheet(entry.sheet);
  }
}

// ---------- 上鎖 ----------
//
// 兩層。保護範圍讓別人改不動，onEdit 接住漏網的那一種
// （擁有者自己編輯時保護範圍只會跳警告，不會真的擋下來）。

/**
 * 鎖一張。**畫好一頁就鎖那一頁**（格式 8 以前是最後一次鎖全部）：沒變的那幾頁上一次畫的時候就鎖了，
 * 而畫到一半逾時的話，已經畫好、記了指紋的那幾頁不可以停在沒鎖的樣子。
 *
 * `existing` 是這一頁上面原本的鎖（一開始讀的那一份）—— 先拆掉。
 * 兩個讀（誰能改、網域能不能改）擺在一起問：寫完又讀一次就好，不是兩次。
 */
function protectSheet(sheet, me, existing) {
  if (!sheet) return;
  for (var i = 0; i < existing.length; i++) existing[i].remove();
  var p = sheet.protect().setDescription(PROTECT_NOTE);
  p.addEditor(me.user);

  // 刻意**不用** setWarningOnly：那只會跳一句「你確定嗎」然後照樣讓人改。
  // 對其他人是真的鎖住；對擁有者鎖不住（Google 不讓擁有者把自己鎖在門外），
  // 所以擁有者那一種由下面的 onEdit 接住。
  var editors = p.getEditors();
  var domain = p.canDomainEdit();
  var others = [];
  for (var j = 0; j < editors.length; j++) {
    if (editors[j].getEmail() !== me.email) others.push(editors[j].getEmail());
  }
  if (others.length) p.removeEditors(others);
  if (domain) p.setDomainEdit(false);
}

/** 拆掉那一頁上面的鎖（一開始讀的那一份）。 */
function unprotect(entry) {
  var existing = protectionsOf(entry);
  for (var i = 0; i < existing.length; i++) existing[i].remove();
  entry.protections = null;
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
  var name = e.source.getActiveSheet().getName();
  if (name === DATA_SHEET) return;

  var previous = typeof e.oldValue === 'undefined' ? '' : e.oldValue;
  e.range.setValue(previous);
  // 還原不了的那幾種（選一塊格子按刪除、貼上一整塊 —— 多格編輯沒有 oldValue）要靠下一次推送畫回來。
  // **刪列、插列、版本記錄還原不會叫這一支**：指紋沒被拿掉，下一次推送當成沒變 —— 要她按「整份重畫」（常見問題「試算表沒有更新」）。
  // 格式 8 起沒變的那幾頁不重畫（ADR-0161），所以改過的那一頁拿掉指紋：下一次推送它照樣重畫，上面那一句才是真的
  try {
    PropertiesService.getDocumentProperties().deleteProperty(FP_PREFIX + name);
  } catch (err) {
    // 拿不掉就算了：最壞是那一頁等到它的資料變了、或她按「整份重畫」
  }
  SpreadsheetApp.getActiveSpreadsheet().toast(
    '這張表由 app 自動產生，改了也不會回到 app，而且下次同步就會被蓋掉。請回 app 修改。',
    '已還原',
    8,
  );
}
