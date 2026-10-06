# 「做什麼」那一排：拿掉每一類前面的灰色小標

Status: done
來源：她 2026-10-06 在 staging 試完 08 回的
動工前先讀：`issues/08-…`（整支，尤其「做完時留下的」）、`public/js/domain/slotOptions.js` 的 `arrangeSlotOptions()`、
`public/js/ui/views/schedule.js`（「做什麼」那一塊）、`public/js/ui/views/visitEditor.js`（`s${i}-ent` 那一排）、
`public/js/ui/components/aboveeConfirm.js` 的 `chipHtml()`、`public/css/app.css` 的 `.chips__head`／`.chips__break`、
`tests/slot-options-order.test.js`、`tests-e2e/specs/56-what-to-do-by-group.spec.js`、
`CLAUDE.md` 連動表「額度那一排的順序」
Blocked by: —

## 她要的

08 交付時請她試「做什麼」那一排順不順（她問題 5 指名要提醒）。她 2026-10-06 回（逐字）：

> 3. 「做什麼」那一排試起來，有幾個地方不順：
>    第一：我覺得壓表或是新增來訪的地方就不用每一類前面有灰色小標，也就是如果是這個人有的，肯定不會很多，就和之前一樣一次呈現所有的丸子就好不需要灰色小標。加購的話也就是一次會呈現所有課程的地方，就維持你這次修改的，這樣就好
>    → 壓表、來訪編輯器、拍 Abovee 三個地方拿掉小標；順序照現在的分類排；二返照舊自己另起一行（不要跟健檢並排）。加購那一排不動

同一則裡另外兩句，不用動程式的：

> 2. HRV 的 LINE 那一句：留著
>
>    第三：功醫門診和 HRV 加購不到 → 那是故意的（不算次數的課不用加購就排得進去），不用改

## 為什麼會這樣

08 照她問題 5 的回答做的（「先照你的建議依照分類排列並加小標，不增加點選步驟，但是要提醒我去測試和你說好不好」）。
小標是 `arrangeSlotOptions()` 回的每一顆上的 `lead`（每一類第一顆＝那一類的名字），三個入口各自畫：

- 壓表 `schedule.js`、拍 Abovee `aboveeConfirm.js`：`<span class="chips__head"><span class="chiprow__lead">…`（小標跟第一顆綁成一塊）
- 來訪編輯器 `visitEditor.js`：傳給 `f.chips()` 的 `lead`

她試了之後：這一排列的是**這位客戶有的**，本來就沒幾顆，小標只是多佔地方。加購那一排列的是全部課程，分類留著。

## 談定的做法

- `arrangeSlotOptions()` 不再回 `lead`。**順序一個字都不變**（照分類、類裡照名字、二返與 n返 最後一組）、`group` 留著、`breakBefore` 留著（二返那一組另起一行）
- 三個入口把畫小標的那幾行拿掉；`.chips__head` 那幾條 CSS 沒有人用了，一起刪
- 來訪編輯器 08 之前的兩個小標（「加約」「不用加購」）**不加回來** —— 她說的是三個地方都拿掉；不算次數的那幾顆丸子上本來就寫著「不扣次數」
- `f.chips()` 的 `lead` 不動（加購那一排的「商品」「單買一台」、課程編輯表的「指定一科」還在用）
- 加購那一排（`buy.js`）一個字都不動

## 判準

- 三個入口那一排裡**一個 `.chiprow__lead` 都沒有**（壓表的「排序」那個小標是另一排，不算）
- 順序跟 08 一樣：`tests/slot-options-order.test.js` 釘順序的那幾條原樣綠，只有釘 `lead` 的那幾條翻過來
- **二返那一顆照舊在健檢那一顆的下一行**（E2E 56 量位置的那一條原樣綠）
- 加購那一排的小標與分類照舊（`tests/buy.test.js`、E2E 55 原樣綠）

## 連動

- `CLAUDE.md` 連動表「額度那一排的順序」那一列（「每一類第一顆一個小標」那一句）
- `SPEC.md` 第 8.8 節分類那一段、`docs/操作手冊.md` 壓表那一段
- `HANDOFF.md` 手動驗收清單第 16、17 條
- `public/sw.js` 的 VERSION

## 做完時留下的（2026-10-07）

- `arrangeSlotOptions()` 不再回 `lead`（每一顆剩 `group` 與 `breakBefore` 兩格）。**順序一個字都沒變**
- 三個入口各刪掉畫小標那幾行：壓表 `schedule.js`、拍 Abovee `aboveeConfirm.js` 的 `chipHtml()`、來訪編輯器傳給 `f.chips()` 的 `lead`。
  `.chips__head` 那三條 CSS 沒有人用了，刪掉；`.chips__break`（另起一行）留著
- 來訪編輯器 08 之前的「加約」「不用加購」兩個小標沒有加回來（她說三個地方都拿掉）；不算次數的那幾顆丸子上照舊寫著「不扣次數」
- `f.chips()` 的 `lead` 沒動：加購的「商品」「單買一台」「沒有的」、課程編輯表的「指定一科」還在用。`tests/slot-options-order.test.js` 多一條釘著加購那一排照舊
- 測試：`tests/slot-options-order.test.js` 釘 `lead` 的那幾條翻過來（2 條在舊的程式上紅：每一顆都沒有小標、三個入口的原始碼不讀 `.lead`）；
  釘順序的原樣綠。E2E `56` 的 W1／W2 改成「那一排一個 `.chiprow__lead` 都沒有」，量「二返在健檢下一行」那一條沒動；W2 補了順序
- `sw.js` v174；`SPEC.md` 第 8.8 節、`docs/操作手冊.md` 壓表那一段、`CLAUDE.md` 連動表「額度那一排的順序」（寫了「不要加回來」）
- `HANDOFF.md` 手動驗收清單第 16、17 條跟著改（這一段收尾時一起）
