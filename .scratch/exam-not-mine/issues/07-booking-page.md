# 07：壓表

Status: done
Blocked by: 04, 05

## 動工前先讀

- `CLAUDE.md` 連動表「壓表那一頁的任何互動」（不接成整頁重畫，ADR-0038）、「新增一個會建立時段的入口」
- `public/js/ui/views/schedule.js`：那一排（1290-1310）、`nthFields()`（1534-）、`pickDefaultNth()`（2079）、組時段（2190-2200）

## 她要的

（spec.md 第一段：「拍照或是自己新增來訪的時候可以直接新增二/n返」。壓表她沒點名，但三個入口共用 `slotOptionsFor()`，那一顆在壓表上一定會出現，所以要接好）

## 為什麼會這樣

壓表選了「＋ n返」走 `nthFields()`（返數＋接哪一次健檢）、`pickDefaultNth()` 預選返數。
**她這種客人多半不在壓表牆上**：身上沒有剩次數的客戶不會進佇列（`scheduling.js:264`）—— 會在牆上的是另外還有額度、健檢又不是她排的那種。

## 要做的

- 那一顆按下去：「第幾返」（**二返～十返、不預選**；現有的 `nthFields()` 那一排是 3～10、提示句寫「二返…在上面那一排選它的額度」（`schedule.js:1537`、`:1548`）—— 另做一排、換句子）、醫師；
  沒有接哪一次健檢那一排；只改 `aria-pressed` 與那一塊，不整頁重畫
- `pickCourse()` 那一段分流（`schedule.js:2079-2080`；`pickDefaultNth()` 定義在 `:2129`）：新的一顆**兩邊都不走** —— 不預選返數、也不 `pickExamIfObvious()`（過目 S7）
- 壓表上用 `view.entitlementId === 新的值` 表示它，不另加 view 欄位；另加的話 `resetPicks()`（`:159-165`）與 `resetCourseBoundPicks()`（`:171-182`）都要一起加
- 組時段走 02 的 `slotFromPicks()`；存檔前那一道講（04）
- E2E：有額度、沒有健檢的客人在壓表 → 點開收合 → 健檢不是我排的 → 二返 → 存 → 二返額度（沒有）不受影響、試算表那一段落在「二返（不算次數）」可以只在單元測試量

## 判準

- 一般的「＋ n返」照舊預選返數、照舊要選健檢嗎？
- 按那一顆、再按回額度那一顆，組出來的段乾淨嗎？（`resetCourseBoundPicks()` 那一類的重設要包含新的那一格）

## 做完時留下的

- **view 怎麼表示**：`view.entitlementId === NOT_MINE_PICK`（沒有另加 view 欄位）；返數存在**既有的 `view.nth`**（2～10）——
  兩排不會同時出現，`resetPicks()`／`resetCourseBoundPicks()` 本來就清它，所以按回額度那一顆之後乾淨（E2E `84` B2 量著）
- `schedule.js`：
  - **`notMineNthField()`**：「第幾返」二返～十返、屬性 **`data-nmnth`**（不是 `data-nth`）、不預選、說明收在標題旁邊那顆 `?`；`entFields()` 照 `picked.isNotMine` 畫它（不畫 `examField()`）
  - `onDeckClick()`：`[data-nmnth]` 只改 `view.nth` 與那一排的 `aria-pressed`（ADR-0038），再按一次取消
  - `pickCourse()`：`isNotMine` **兩邊都不走**（不 `pickDefaultNth()`、不 `pickExamIfObvious()`）；`pickIvIfBought()`／`pickDoctorIfOnly()` 照走（二返指定的那一科剛好一位就先選好，新的一段的規則）
  - `addSlot()`：`slotFromPicks()` 多傳 `examNotMine: Boolean(picked?.isNotMine)`；返數照舊 `nth: view.nth`（沒選 → 「先選第幾返」畫在卡片的錯誤框）
  - 副字「不扣次數」是 05 做的
- 紅字與確認框：`slotFromPicks()` 之後的 `validateVisit()`／`bookingConsequences()` 本來就接著（04），沒有另外接
- E2E **`84-exam-not-mine-booking`**（新的，登記進 `related.js`）：B1 有額度沒健檢的客人 → 其他 ▸ → 第幾返不預選、不替她選健檢、沒選擋下來 → 二返 → 確認框「二返的健檢不是你排的」→
  存進去的形狀（沒有 `followupNth`）、三選一一次都沒扣、那一排沒有整塊重畫；B2 選了它、四返，再按回額度 → 存下去沒有標記、沒有返數；
  B3 做完健檢、還有二返額度的客人按了它 → 存檔前那一道兩句紅字，按「先不要」一筆都沒存
- 試算表那一段落在「二返（不算次數）」：03 的單元測試量過（`tests/sheet-rows-without-entitlement.test.js`），這裡沒另外量
- `public/sw.js` v214 → v215、`npm run shell:snapshot`

