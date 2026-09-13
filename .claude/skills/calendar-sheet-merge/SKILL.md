---
name: calendar-sheet-merge
description: >
  把 TimeTree 匯出的行事曆（.ics）跟舊 Google 試算表（.xlsx）合起來：補齊只有日期、沒有時間的來訪，
  逐筆對帳抓出兩邊對不起來的地方（行事曆記了卻忘記回試算表打勾是最常見也最嚴重的一種），
  並產出一份可以貼進 app 的合併 JSON。使用者丟來 .ics 或 .xlsx、提到 TimeTree、行事曆、試算表、
  舊資料匯入、「幫我比對」「幫我合併」「抓出怪怪的地方」「忘記記到試算表」「次數對不起來」時，
  一定要用這個 skill —— 就算她只給了其中一個檔案、或只是問「這兩邊有沒有對不上」也一樣。
  不要自己從頭寫解析或比對，這裡的腳本已經踩過所有坑。
---

# 試算表 × 行事曆：對帳與合併

## 這件事在解決什麼

她的紀錄散在兩個地方：**舊 Google 試算表**（每位客戶一張分頁，只有「哪一天、上了哪個療程」
的勾選）與 **TimeTree 行事曆**（時間、診間、治療師、器材都在標題裡）。兩邊都只有事實的一半。

而且兩邊會不同步。她的原話：

> 之前我都是用腦袋記，有時候會記在行事曆上了卻忘記記在試算表中，這個很嚴重

漏勾在試算表上完全看不出來 —— 那一格就只是空的。所以這個 skill 的第一產物不是「合併結果」，
是**一份挑得出毛病的對帳報告**。合併只是順帶。

**判準：行事曆比較準。** 她是當下就記在手機上；試算表是事後回去補的，補漏了沒有人會發現。

## 動工前先讀

- `SPEC.md` 第 6.10 節（匯入要先 dry-run、人工確認才寫入）
- `docs/legacy/README.md` 全部（舊表結構、速記語法、六個已知陷阱）
- `docs/adr/0011`（匯入的來訪缺欄位是刻意的）、`0012`（匯入是貼上不是整合）、
  `0002`（app 是記錄者不是判斷者）
- 本 skill 的 `references/findings.md` —— 2026-08-19 拿真檔跑過一次的結論，
  裡面有「她怎麼寫字」的實測統計，不要重新發現一次

## 兩條鐵則

**一、真實客戶資料一格都不能進 repo。** 姓名、健康資訊、匯出的 TSV、報告、別名表，
全部只放本次工作階段的暫存區（系統提示裡那個 scratchpad 路徑）。
`scripts/xlsx-to-tsv.py` 會拒絕寫進 repo。理由見 `SPEC.md` 第 10 節：進了 git 歷史就拿不掉。

**二、不猜。** 對不上的東西一律列出來讓她判斷，不要為了讓數字好看而配對。
補錯一筆時間，在畫面上跟補對了長得一模一樣 —— 她永遠不會發現。漏補只是維持現狀。

## 流程

### 1. 收檔案，先確認年份

舊試算表的日期表頭是 `6月15日`，**沒有年份**。問她這批是哪一年（或從行事曆的涵蓋範圍推，
再跟她確認一次）。猜錯一年，整批來訪會落到別的地方去。

### 2. 轉檔

```bash
python3 .claude/skills/calendar-sheet-merge/scripts/xlsx-to-tsv.py <xlsx> <暫存區>/real
```

一張分頁一個 `.tsv`。這一支**不去識別化**（repo 的 `scripts/legacy-xlsx-to-tsv.py` 才會，
那是產生可進版控樣本用的，別拿錯）。

### 3. 準備別名表

行事曆上她叫客戶的方式跟試算表不一樣：只寫姓、只寫名、寫暱稱、打錯字、用異體字。
**暱稱推不出來，只能靠對照表。** 沒有這張表會直接掉掉整批來訪。

```json
{
  "nicknames":        { "<客戶全名>": ["<行事曆上的叫法>", "..."] },
  "therapists":       ["<行事曆上出現過的治療師寫法>", "..."],
  "therapistAliases": { "<主檔的正式名字>": ["<行事曆上的寫法>", "..."] },
  "doctors":          ["<醫師，通常只有一個字>", "..."],
  "noise":            ["<看起來像名字但不是人的字>", "..."]
}
```

`therapists` 是給「這串字裡有沒有寫別人」用的（少了它，寫著治療師名字的事件會被
當成別位客戶而整筆放棄）；`therapistAliases` 是給輸出用的 —— **合併檔裡一定要寫主檔的
正式名字**，送「新穎」「LU」過去，app 對不到主檔，那個欄位就會留空。

放在 `.local/aliases.json`（已經 gitignore）。腳本自己會處理的不用寫進去：
去姓（王陳小明→陳小明，假名）、括號裡的配偶名字、異體字（啟↔啓、惠↔慧、崴↔威）。

**這個容器會被回收，所以跑完一定要用 SendUserFile 把 `aliases.json` 交還給她**，
並告訴她下次連同 .ics/.xlsx 一起給你。她手上有這張表，下次就不用重講一遍。

### 4. 跑對帳

```bash
node .claude/skills/calendar-sheet-merge/scripts/merge.mjs \
  --sheets <暫存區>/real --ics <ics 檔> --year <年> \
  --aliases .local/aliases.json --today <今天> --out <暫存區>/out
```

產出兩個檔：`report.txt`（給她看的對帳報告）與 `import.json`（貼進 app 的合併檔，
格式見下面）。兩個都要用 SendUserFile 交給她。

### 5. 讀報告，把該問的問掉

報告分七段，**每一段對應她要做的一個動作**：

| 段 | 是什麼 | 她要做什麼 |
|---|---|---|
| ⓪b 舊表本身讀到的問題 | 讀她的舊表時發現的，跟行事曆無關（沒寫年份、勾了但不排班、勾得比買的多） | 掃過去。有幾種是「這一格沒進去」，有幾種是「匯進去之後資料健檢會報」 |
| ① 兩邊講的不是同一件事 | 試算表勾 A、行事曆寫 B | 判斷哪邊對。通常是行事曆 |
| ② 行事曆有、試算表沒勾 | **最嚴重**：做了但忘記打勾，次數少算 | 逐筆確認要不要補一筆來訪 |
| ③ 試算表有、行事曆沒有 | 沒記行事曆，或**勾錯人** | 看有沒有標 `⇄ 可能勾錯人` |
| ④ 補到了什麼 | 一位一位、一個時段一個時段列出補到的時間／診間／器材 | 掃過去看有沒有離譜的 |
| ④b 兩個人都可能 | 沒寫名字、那天兩位都勾了同一個療程 | 指認是誰 |
| ⑤ 未來的預約 | 對得到客戶與療程、日期在今天之後 | 決定要不要建成來訪 |
| ⑥ 對不到客戶的 | **全部列出來**，已經照標題分成休假／待辦／行事備註三類 | 掃過去看分錯了沒，其餘一筆一筆決定 |

報告只講事實，**判斷交給她**。不要在報告上替她決定。

⑥ 那一段動輒兩百筆，**不要為了讓報告短一點而摘要或抽樣** —— 她要的就是全部：

> 可以全部列給我，不用預設計入 app 沒關係，全部列給我我之後一個一個決定要不要匯入

同樣的道理，`import.json` 裡三份候選清單（未來的預約、行事曆有試算表沒勾、
對不到客戶的）一律 `include: false` —— 不過**那個欄位 app 沒有在讀**，
它只是描述性的。真正的預設值在 app 那一側依日期決定：**還沒發生的預設勾起來、
已經發生的預設不勾**（2026-08-21 使用者拍板，`docs/adr/0030-*`）。
界線刻意不寫進檔案 —— 「未來」是在她按下匯入的那一刻才算得準的。

## 什麼時候要停下來問

這些問了才做得對，不要自己選一個往下走：

- **對不到的名字**：某位客戶整批對不上，先問「行事曆上你都怎麼叫他」，不要放寬比對規則。
- **新的簡寫**：報告上出現沒見過的療程／器材／診間寫法，問清楚再加進
  `references/shorthand.md` 的對照表 —— 猜錯會把時段掛到錯的課程上。
- **同一天兩欄同一個日期**：那是「一個勾表達不了三個時段」的寫法，合併成一筆來訪是對的
  （見 `findings.md`）。但如果數量對不上，要問。
- **年份**、**跨年的批次**。
- **她說「這個之後再確認」的**：記下來，不要卡住其他部分。
- **報告的 ⓪c（購買名稱對不上的）每一條都要問**。她 2026-09-13：「所有的方案課程加購都可以
  再用各種課程的應有次數去驗證一次，然後合併的時候也可以再問我一次」。匯進去的是應有次數
  那一份，但哪一邊對由她決定。B2 怎麼讀見 `references/answers.md` 的 2026-09-13 那一節。

## 合併檔（`import.json`）

這是 skill 與 app 之間的契約。她的流程是：**給檔案 → 你問清楚 → 你給 JSON → 她貼進 app**，
所以這份格式兩邊都得認得。改欄位就是改契約，要同時改 app 那一側（`domain/mergeImport.js`）。

```
format: 'baobao-merge/v2'          （app 也收 v1：少的那幾格一律 null）
calendar: { file, span, events }
customers[]: { sheetName, name, source, purchasedAt, notes,
               marks[]: { text, color },             （v2：有「尾款」的是 red；notes 是它的鏡像）
               purchaseProblems[]: string,            （v2：B2 拿應有次數驗過、對不上的那幾條）
               entitlements[]: { key, type, label, totalQty, courseName,
                                 optionEquipmentNames[], productName,
                                 purchasedAt, sourcePlanName, sourcePlanSets, sourcePlanQty,
                                 purchaseKey },       （v2：同一次購買同一個 key）
               visits[]:       { date, status:'done',
                                 slots[]: { entitlementKey, courseName,
                                            startsAt, endsAt, roomName, therapistName,
                                            equipmentName, ivProductName,
                                            confidence:'high'|'low'|null, evidence } } }
futureVisits[]:    { customerName, date, status:'confirmed', courseName, startsAt, evidence, include:false }
missingFromSheet[]:{ customerName, date, courseName, startsAt, evidence, sheetHasThatDay, include:false }
eventCandidates[]: { title, startDate, endDate, allDay, startTime, endTime,
                     kind:'personal'|'leave'|'note', why, category, repeats, include:false }
ambiguous[]:       { date, evidence, course, who[] }
unreadable[]:      { title, raw, why }
```

`eventCandidates[].kind` 是**日曆上的哪一類**（ADR-0045 的四類扣掉來訪）。
`classifyEvent()` 照標題判，三條規則：寫了休假詞而且沒寫到別人 → `leave`；
標題裡沒寫時間而且有待辦動詞 → `note`；其餘 → `personal`。
**不能拿顏色判**（`references/shorthand.md`：9 種顏色底下都混著來訪與雜事）。

判錯休假的代價最大 —— 那幾天她根本不在，任何來訪都排不進去 —— 所以
`陳小美休假`、`林小華請假` 這種**寫了別人名字的一律退回 `personal`**。這條的實作
刻意不共用 `residualNames()`：那一支會把治療師名單扣掉（配對來訪時那是雜訊），
而這裡治療師正是那個「誰」，扣掉之後 `王小婷休假` 會變成她自己的休假。

`why` 是一句人話的理由，報告與 app 那一列都印它。**分類是建議不是結論**：
app 那一頁每一列都可以改（`ui/views/mergeImport.js`），這裡的工作是讓她不用
把兩百列一列一列重挑。`category` 只是給舊版 app 讀的鏡像（它認不得 `note`，
會退回行事備註）。

`eventCandidates[].endDate` 是**真的結束日**，跨天的事件靠它才進得去 ——
行事備註是這個系統裡唯一可以跨天的東西（`CONTEXT.md`、ADR-0015）。
整天事件的 `DTEND` 是不含端點的（iCalendar 規格：8/10–8/14 會寫成
`DTEND;VALUE=DATE:20260815`），`parseIcs()` 已經減過一天了。
`allDay` 是明確欄位，app 不用再從有沒有時間反推。
**判成 `leave` 的一律 `allDay: true`、沒有時間** —— 休假講的是「那幾天她根本不在」，
而行事曆的時間欄會歪（27/317 落在凌晨）。

`unreadable[]` 是 `DTSTART` 讀不出來、整筆沒有進到任何一段的事件。
**它要列出來** —— 「沒有這幾筆」和「讀不到這幾筆」是兩件事。

三個設計上的理由，改的時候不要弄丟：

**帶的是名字不是 id。** id 是她自己在主檔建的，這支腳本看不到她的 Firestore，也不該看得到。
app 那一側拿名字去對自己的主檔，對不到就報出來 —— 跟 `domain/legacyImport.js` 的
`resolveCourse()` 同一個判準。

**每個時段都帶 `confidence` 與 `evidence`。** 低信心的那幾筆在畫面上跟高信心的長得一模一樣，
沒有這兩個欄位她分不出哪幾筆是推測來的。`evidence` 是行事曆上的原文，
永遠比解析結果有說服力（`SPEC.md` 第 4.3 節）。

**時間在建立來訪的同一次寫入就填進去。** 匯進來的來訪是 `done`，落在唯讀鎖定區
（`SPEC.md` 第 6.4 節）；匯完再補時間，每一筆都要走更正流程填理由。

**配出來的二返額度不寫進檔案。** `planForSheet()` 會替每一筆健檢配一筆二返額度，
而 app 那一側匯入時會再配一次（規則只在 `domain/followups.js`，ADR-0022）。
兩邊都寫的話每位健檢客戶會長出兩筆二返額度，而症狀在別的地方：她在 ② 勾起來的
每一筆二返都會變成「對到不只一份額度，不知道要扣哪一份」而補不進去 ——
那正是這整份報告最在意的一種。

**ADR-0011 沒有被推翻。** 對不上的時段照樣 `startsAt: null`、照樣顯示「時間不詳」。
多了一份知道時間的資料，不等於可以編一個時間出來。

app 那一側的待辦在 `.scratch/legacy-calendar-merge/issues/`（已結案）與
`.scratch/first-real-import/issues/`。

## 兩份參考

- `references/shorthand.md` —— 她的速記語法：時間、器材、診間、治療師、品項怎麼寫
- `references/findings.md` —— 2026-08-19 那次的實測結果與踩過的坑
