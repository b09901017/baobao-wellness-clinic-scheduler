# 來訪的「做什麼」那一排：照分類排、每一類一個小標，不多按一下

Status: done
來源：她 2026-10-06 第二點；問題 5 的回答
動工前先讀：`public/js/domain/slotOptions.js` 整支、`public/js/domain/scheduling.js` 的 `customerPools()`／`followupsLast()`／`sortPools()`、
`public/js/ui/views/schedule.js`（「做什麼」那一塊，`data-ent`）、`public/js/ui/views/visitEditor.js`（額度那一排，`s${i}-ent`；它**自己從額度組**，沒走 `slotOptionsFor()`）、
`public/js/ui/components/aboveeConfirm.js`（「要做什麼」，`chipRow()`）、`public/js/ui/components/form.js` 的 `chips()`（`lead`、`tuckAfter`）、
ADR-0022、ADR-0038、ADR-0063、ADR-0121、`.scratch/asks-2026-09-24/`（二返排最後那一支）、
`CLAUDE.md` 連動表「額度那一排的順序」「不算次數的課、『這一段可以做什麼』那一排」兩列
Blocked by: 03（不算次數的課變兩門）

## 她要的

> …或是新增來訪的選課程，都可以參考課程種類與項目.md去分層丸子選

問她「照分類排、加小標、不多按一下（建議）；還是跟加購一樣先按分類再按項目？」，她回：

> 問題 5：我覺得先照你的建議依照分類排列並加小標，不增加點選步驟，但是要提醒我去測試和你說好不好

**交付清單一定要有一條：請她試這一排順不順、跟我說好不好。**

## 為什麼不是兩層

這一排列的不是全部課程，是**這位客戶買了什麼**（額度）＋「＋ n返」＋不算次數的課。它是她按最多次的地方 ——
壓表一位客戶要點五六下（ADR-0038）。多一層就是每一段多按一下。所以只動順序與小標。

## 現在的順序

`slotOptionsFor()`：額度（`customerPools()` 的順序，二返排最後 —— `followupsLast()`，她 2026-09-24：「跟健檢並排一指就約錯」）→「＋ n返」→ 不算次數的課。
來訪編輯器那一排自己組，但 `CLAUDE.md` 寫明「壓表與來訪編輯器的額度那一排共用」同一個順序。

## 談定的做法

- **順序只在 `slotOptions.js` 一支算**，三個入口都照它：
  1. 照分類（`masterData.js` 的 `courseGroupNames()` 的順序；**讀分類一律走 `groupOf()`**，`slotOptions.js` 直接讀 `.group` 的話 `tests/course-groups.test.js` 會紅）：
     同一類裡先額度、再那一類不算次數的課
     - **同一類裡的額度照名字排**（審查查到的）：兩個入口「原本的先後」本來就不一樣 —— 壓表走 `customerPools()`（二返最後 → **剩得少的排前面** → 名字），
       來訪編輯器是讀回來的順序加 `followupsLast()`。不能拿「剩幾次」排：編輯器的剩餘把手上這份草稿算進去（`countsWithDraft()`）、壓表讀快取，兩邊數字會不一樣
     - 擇一池的額度算它推出來的第一門課的分類（`coursesForEntitlement()[0]`，跟現在 `slotOptionsFor()` 挑預設課程同一條）
  2. **二返照舊一律排最後**，不跟著「醫師門診」走；而且**健檢那一顆跟二返那一顆不可以緊鄰** ——
     照分類排之後健檢是最後一類，不處理的話兩顆每一次都相鄰，比現在還糟（她 9/24 抱怨的就是相鄰）。
     只隔一條線不夠（實體上還是隔壁）：**二返那一組另起一行**，或兩顆中間至少隔一顆別的丸子。有「＋ n返」的時候它跟二返同一組
  3. 「＋ n返」接在二返後面（現在就是）

**這是她看得到的改變**：壓表那一排以前「快用完的排前面」，之後照分類、類裡照名字（「快用完」只剩卡片牆上那個數字在講）。列進交付時請她試的那一條。
- **小標**：每一類第一顆前面一個小標（`lead`：一條線＋那一類的名字）。**整排只有一類時不畫小標**（一個小標等於沒有分類，只多佔一格）
- 每一顆回的形狀多一格 `group`（那一類的名字；二返與 n返 那一組另外一個字，字從 `CONTEXT.md` 挑，不要用它標 _Avoid_ 的）
- **來訪編輯器改成照同一支排**：它還是自己算「剩幾次」（`countsWithDraft()`，把手上這份草稿算進去），但順序與小標問 `slotOptions.js`。
  這一段現在指著、已經停用的那一門不算次數的課照舊要列（不然那一排一顆都沒按）
- **壓表**那一排是自己拼的 HTML（`.chips`、`data-ent`），不是 `f.chips()`：小標用同一組 class（`chiprow__sep`、`chiprow__lead`），
  動工時看 `.chips`（會換行）底下那兩個 class 長得對不對，不對就補 CSS
- **拍 Abovee** 的 `chipRow()` 同樣補小標

### 不算次數的課太多的時候

現在只有功醫門診與 HRV 兩門。她之後自己勾更多的話每一位客戶這一排都變長。

**這一輪不做「超過三門收起來」**（審查查到的）：第一段我跟她說會做，但 `form.js` 的 `tuckAfter` 是「整排前 N 顆之後全收」，照分類排之後不算次數的課散在各類裡，
收不了；壓表那一排也不是 `f.chips()`。現在才兩門，為一個還沒發生的情況另寫一套機制不划算。交付時跟她講這一條延後、等她真的勾到第四門再做。

## 判準

- 同一位客戶，**兩個入口都有的那幾顆，相對順序與小標一樣**（壓表不列用完的額度、編輯器列，所以不是「整排一模一樣」）；拍 Abovee 多的只是用完的額度
- 買了 8 萬方案的客戶：小標依序是 復能、ILIB、醫師門診、運動區…；功醫門診與 HRV 在「醫師門診」那一組裡、標「不扣次數」
- 只買了復能的客戶：沒有額度以外的分類時… 仍然有功醫門診與 HRV（醫師門診那一組），所以有兩個小標；**只有一類的那一種客戶整排沒有小標**
- **健檢與二返兩顆丸子不緊鄰**：domain 測試釘「回傳的陣列裡兩顆不同組」；E2E 量位置釘「二返那一顆不在健檢那一顆的正右邊」
  （只掃字串的測試在這種事上騙過人 —— `CLAUDE.md`「貼在畫面底部的東西」那一列）。列進請她試的那一條
- 二返照舊在所有額度的最後；`followupsLast()` 一個字都不改
- 客戶詳情的額度卡不受影響（它刻意用 `sortPools()`，健檢與二返相鄰，ADR-0022）
- 選了什麼只改 `aria-pressed`，不重畫整頁（ADR-0038）
- **這一行會不會讓同一位客戶在兩個入口的順序不一樣？**

## 連動

- `CLAUDE.md` 連動表「額度那一排的順序」那一列（照分類、類裡照名字、二返最後而且不跟健檢緊鄰；壓表不再照剩餘排）
- `tests/course-groups.test.js`（`slotOptions.js` 在 `domain/` 底下，問分類要走 `groupOf()`）
- `tests/uncounted-courses.test.js` 與 `slotOptions` 的測試；E2E 裡照「第幾顆」點這一排的那幾支（`git grep -n "data-ent\|-ent\"" tests-e2e/`）——
  照位置點的要改成照名字點
- `docs/操作手冊.md` 壓表那一段
- `public/sw.js` 的 VERSION

## 做完時留下的（2026-10-06）

- **順序只在 `slotOptions.js` 的 `arrangeSlotOptions(options, courses)`**：`slotOptionsFor()` 最後一步走它（壓表、拍 Abovee 拿到的就是排好的）；
  來訪編輯器自己組那一份（全部額度、`countsWithDraft()` 的剩幾次、停用但這一段還指著的那門不算次數的課）再交給同一支排。
  每一顆多三格：`group`、`lead`（每一類第一顆；**整排只有一類時全部 null**）、`breakBefore`（二返那一組的第一顆，前面還有別的時）
- 分類問 `masterData.js` 新的 `groupByCourse(items, courseOf, courses)`（07 的 `groupCourses()` 改成它的一個特例）——
  `slotOptions.js` 一個 `.group`、`groupOf(` 都沒有，`tests/course-groups.test.js` 原樣綠
- 二返那一組的小標是 `FOLLOWUP_GROUP = '二返・n返'`（`CONTEXT.md`：講一整類時才寫 n返）。二返認 `followupForEntitlementId`（同 `followupsLast()`），n返 認 `isNth`
- **另起一行三種畫法**：來訪編輯器是 `f.chips()` 新的 `breakBefore`（同一個欄位第二個 `.chiprow.chiprow--next`、同一個 hidden input，第二行自己左右滑）；
  壓表的 `.chips` 與拍 Abovee 的 `.abl-row__chips` 本來就會換行，插一個 `.chips__break`（`flex-basis: 100%`）。
  `f.chips()` 順手改了一件：**第一顆就帶 `lead` 的不再在行首畫一條分隔線**（以前來訪編輯器一個額度都沒有時，「不用加購」前面有一條多的線）
- 來訪編輯器以前的兩個小標「加約」「不用加購」換成分類的小標（n返 在「二返・n返」、功醫門診與 HRV 在「醫師門診」）
- `followupsLast()` 一個字都沒改（測試用原始碼釘著）；`customerPools()` 照舊「快用完的排前面」—— **卡片牆上那一排泡泡**還是那個順序，只有「做什麼」那一排換了
- E2E：新的一支 `56-what-to-do-by-group`（W1 壓表、W2 來訪編輯器：小標的順序、二返那一顆在健檢那一顆**下一行**，量 `boundingBox`）
- **延後的**：不算次數的課「超過三門收起來」（issue 寫明這一輪不做；現在兩門）
- **一定要請她試**：壓表、日曆新增、拍 Abovee 的「做什麼」那一排順不順。要講的兩件：①以前快用完的排前面，現在照分類、類裡照名字；
  ②健檢與二返隔開了沒（二返那一組另起一行）。她問題 5 指名「要提醒我去測試和你說好不好」
- `sw.js` v170；`SPEC.md` 第 8.8 節分類那一段；`docs/操作手冊.md` 壓表那一段與 n返 那一段的示意；`CLAUDE.md` 連動表「額度那一排的順序」；設定 → 課程 分類那一排的 `?`
- **截圖看到、補了的兩件（`20d0e70`）**：
  1. 壓表與拍 Abovee 那一排會換行，小標跟它那一類的第一顆分開時，換行把小標留在上一行的尾巴（手機與 iPad 都有）→
     小標與第一顆綁成一塊 `.chips__head`；E2E 56 的 W1 量「小標跟第一顆在同一行」
  2. **來訪編輯器新的一段預設扣 `entitlements[0]`**（`blankSlot()`、`withNewSlot()`），那是讀回來的順序 —— 照分類排之後
     預設的那一顆可能在那一排捲不到的右邊：畫面上一顆都沒按、抬頭寫著另一門課。編輯器讀回來就照 `arrangeSlotOptions()` 排
     （`inRowOrder()`），預設＝最左邊那一顆。**她看得到的改變**：日曆新增一位有好幾筆額度的客戶，第一段預設的課可能跟以前不一樣（現在是那一排第一顆）。
     `tests/scheduling.test.js`「來訪編輯器那一排用 followupsLast」那一條改成問 `arrangeSlotOptions(`
- E2E 56 的位置改成同一個畫面一次量（點了某一天之後那一張還在平滑捲動，分兩次 `boundingBox()` 會量到不同時刻）

