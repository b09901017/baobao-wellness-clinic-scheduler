# Abovee 的六種預約狀態對到 app 的狀態，加上「這個時間點合不合理」

Status: done
Blocked by: —
動工前先讀：`spec.md`「六種狀態 → app」；`.local/references/圖片辨識參考/編輯預約欄位結構.md` 第一節（六種，**有真名，只在 `.local/`、一個字都不抄進 repo**）；
ADR-0116、ADR-0104 第 3 點；`domain/aboveeImport.js` 的 `aboveeState()` 與它的每一個呼叫端（`grep -n "aboveeState\|\.cancelled\|statusText"`）；
`docs/agents/lessons.md` 一、四、七

## 她要的

> 預約狀態有 待確認／聯繫中／確認前往／已取消／客戶失約／課程完成 這六種，為什麼認不出來 ?

> 只要是abovee上寫課程完成，那就是完成了，待確認，聯繫中，確認前往，在app應該都是待確認， 已取消就是取消，客戶失約就是未到

> 不合理的(例如未來的完成了或是過去的沒取消也沒完成)也提醒

## 為什麼會這樣

`aboveeState()`（`aboveeImport.js:384`）只認「取消」「完成」兩個字，其餘回 `'booked'`。ADR-0116 寫「Abovee 的『預約狀態』那一欄有三種字」——
那是 9/24 從截圖歸納的，10/5 的參考資料（六種）沒有回頭對。**客戶失約被當成還排著**；空的、抄錯的也被當成還排著，沒有人講。

## 要做的

1. 一支把 Abovee 那一格翻成 app 狀態的函式（名字自己定，例如 `statusFromAbovee(text)`）：
   - 含「完成」→ `'done'`；含「取消」→ `'cancelled'`；含「失約」→ `'no_show'`；「待確認」「聯繫中」「確認前往」→ `'pending_confirm'`
   - 那一格空的或認不出來（「聯絡中」「確認前往X」那種近似的字也算）→ `'pending_confirm'` ＋ 一個「讀不出來」的旗標（03、04 拿它講「讀不出預約狀態」、不預設勾也不改）
   - **分清楚兩種「沒有」**：整張照片的 columns 裡根本沒有「預約狀態」（左半張切掉最左欄、兩頁裡有一張沒拍到 —— `tableOf()`、`ABOVEE_KEYS`，`aboveeImport.js:42-45`、`:115-126`）
     不算讀不出來：照舊當待確認、照舊的預設勾，只給確認層一個「這張沒拍到預約狀態那一欄」的旗標（抬頭講一次，不要每一列各講一次）。
     照寫成讀不出來的話，整張每一列都不勾 —— 等於安靜地改了預設勾
   - 比對前照 `clean()` 正規化（全形、空白）。**先判失約、取消、完成，再判待確認那三種**（「待確認」也含「確認」兩個字，別拿「確認」當鑰匙）
2. `aboveeState()` 的呼叫端改問新的那一支，或讓 `aboveeState()` 回四種（`cancelled`／`done`／`no_show`／`booked`）—— 擇一，**只留一份判斷**。
   `sameRow()` 的 `gone`、`claimTimeless()`／`claimHalves()`「取消的列不認領」、`rebookedHere()`、`item.cancelled`：這幾處問的是「取消了沒」，失約不算取消 —— 逐一確認語意沒變
3. 一支「這個狀態在這個日期合不合理」（例如 `photoTimeSays(status, date, today)`）：
   - 未來的 `done` → 「還沒到就寫完成了」；未來的 `no_show` → 「還沒到就寫失約了」
   - 過去的 `pending_confirm` → 「日子過了還沒結案」
   - 今天的什麼都不講；`cancelled` 不看日期
   - `today` 由呼叫端傳（`todayISO()`），不在裡面 `new Date()`
4. 句子放 domain（`aboveeImport.js`），畫面只畫。這一支不改任何寫入、不改預設勾 —— 那是 03、04

## 判準

- 六種字各自翻成表上那一種；「 課程完成 」（前後空白）、全形字也一樣
- 「待確認」不會被判成別的；「客戶失約」不再是還排著
- 空的那一格、「確認前往X」「聯絡中」這種抄壞或近似的字 → 待確認＋讀不出來的旗標，不是完成也不是取消
- 照片的 columns 裡沒有「預約狀態」：每一列**不是**讀不出來、照舊的預設勾，只有一個整張的旗標
- 拿 `.local/references/abovee-m5-m10/擷取/abovee-m5-m10.json`（353 列）跑一次：四種字（課程完成 207、已取消 77、客戶失約 3、確認前往 66）全部認得、沒有一列落到「讀不出來」（腳本只印數字；待確認、聯繫中這份裡 0 列，靠單元測試釘）
- 改完之後**既有的 `tests/abovee-*.test.js` 全綠** —— 這一支只加認得的字，不改任何一列的種類或預設勾（失約那 3 種情況除外：寫一支測試釘著它現在被當成什麼）
- 「時間合不合理」：未來完成、未來失約、過去待確認各一條；今天的三種都不講

## 做完時留下的（10/15 段一）

**做成的樣子**（`domain/aboveeImport.js`，`aboveeState()` 拿掉了，只剩一份判斷）：

- `statusFromAbovee(text)` → `{ status, unread }`：先判失約、取消、完成（字裡有沒有），再判待確認那三種（去掉每一個空白後整格一模一樣）；其餘 → `pending_confirm` ＋ `unread: true`
- 每一列多三格（`photoStatusOf()`）：
  - `photoStatus`：`'done'|'pending_confirm'|'cancelled'|'no_show'`，**那一張沒拍到那一欄是 `null`**（看不出來 —— 不是待確認。04 拿它比 app 時 `null` 要當成「不比」，不然會對沒拍到那一欄的列喊「Abovee 上還沒改成課程完成」）
  - `statusUnread`：拍到了、那一格空的或認不出來
  - `cancelled`：＝ `photoStatus === 'cancelled'`（失約不算取消；`sameRow()` 的 `gone`、`claimHalves()`、`claimTimeless()`、`rebookedHere()`、`needsAttention()`、`summarizeAbovee()` 問的都還是它，語意沒變）
- 「這一張有沒有拍到那一欄」是 `tableOf()` 在每一列記的 `row.statusSeen`；兩頁併成一列時有一張拍到就算（`joinPages()`）
- `readAbovee()` 多回 `noStatusColumn`：`null`／`'some'`／`'all'`；抬頭那一句是 `statusColumnSay(read)`（07 畫）
- `photoTimeSays(status, date, today)`：未來完成「還沒到就寫完成了」、未來失約「還沒到就寫失約了」、過去待確認「日子過了還沒結案」；今天與已取消不講。**回的是核心那幾個字，不帶「確定再勾」那種下一步** —— 03（新列）與 04（既有的段）要講的下一步不一樣
- `photoStatusSay(item, today)`：讀不出來 →「讀不出預約狀態（照片上是「X」）」／「…那一格是空的」；讀得出來 → `photoTimeSays()`；`photoStatus` 是 `null` → 空字串
- `crossCheck()` 收 `photoStatus`：只比 `cancelled` 與 `done`，**失約、待確認、`null` 照舊當成還掛著**（＝以前的 booked）。所以 app 已完成＋照片失約照舊是「已經記了」—— 04 才改，`tests/abovee-six-statuses.test.js` 最後一組釘著現在的樣子

**畫面一個字都沒改**（`aboveeConfirm.js` 沒動）：讀不出來那一句是 03 畫在新列上、抬頭那一句是 07。

**語料**：353 列 → done 207、cancelled 77、no_show 3、pending_confirm 66，讀不出來 0。

**給段二**：合併扣課的那一列（`mergedItem()`）只帶第一列的 `photoStatus`；第二列的在 `merged.parts[1].photoStatus`（04「兩列的狀態要一樣才改」拿它）。另見 HANDOFF「中途發現」的 `joinPages()` 那一條。

測試：`tests/abovee-six-statuses.test.js`（25 條）；`npm test` 4493 全綠；相關 E2E 7 支 43 條全綠（00、41、51、57、62、65、67）。
