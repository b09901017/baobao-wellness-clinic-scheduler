# 01：鍵盤跳出來蓋住輸入框（全螢幕的 app）—— 全站排查、一起修

Status: todo
Blocked by: —

## 動工前先讀

- `spec.md`「五」與她的原話（圖三、圖四）
- ADR-0147（裝好的那一顆是全螢幕：`display: fullscreen`、殼由 `.app__body` 讓開、**高度靠 `inset: 0` 不寫 `100dvh`**）、ADR-0021（抽屜靠 `transform` 拖）
- `CLAUDE.md` 連動表：「蓋住整頁的一層、殼最上面那一條、『是不是裝到主畫面的』」「貼在畫面底部的東西」「存起來的 `pushLayer()` handle」
- `tests/full-height-units.test.js`（盯著不准用 dvh 撐高度；抽屜的「最多佔幾成」不算）
- `public/css/app.css` 的 `.drawer`（`:3876` 附近；`--sheet-y`、`.drawer--tall`、`.drawer__actions` 反向位移、`.drawer__body` 捲動）、`tokens.css` 的 `--sheet-peek-max`／`--sheet-full`（dvh）、`app.css:8008-8011`、`:8315` 那兩段假設鍵盤高度的註解、`.popcard`（`ui/components/card.js`）
- `public/js/ui/components/sheet.js`（`wireDrag`：從輸入框開始的拖曳不接 `:193`／`:437`）
- `public/index.html` 的 viewport meta（`width=device-width, initial-scale=1, viewport-fit=cover`，沒有 `interactive-widget`）

## 她要的

> 如圖三圖四我不論是在首頁還是再隨手記那一頁，點了鉛筆，他就會這樣，跳出鍵盤遮住輸入的地方 並且如果我將抽屜往上拉，整個頁面都會往上拉 輸入的地方也不見??? 我不知道還有沒有地方會這樣，叫出鍵盤後會破壞版面，請你幫我排查，並且修復，跳出鍵盤後應該那個輸入的抽屜要往上吧 ? 我才能看到我輸入什麼阿，

## 為什麼會這樣（要驗證）

全站沒有一行在處理鍵盤（沒有 `visualViewport`、`virtualKeyboard`、`interactive-widget`、聚焦時捲動）。推測：全螢幕（immersive）的 Android 上鍵盤跳出來時版面不縮（Android 在全螢幕視窗裡 `adjustResize` 不生效的老問題），
`.drawer` 貼在底部、被鍵盤整張蓋住；她往上拉時是瀏覽器在捲 visual viewport，整頁跟著跑。**分頁裡（不是全螢幕）可能重現不出來** —— 這就是 E2E 一直綠的原因。

## 要做的

1. **先確認原因，在 HTC 上**：她會把 HTC 開「USB 偵錯」接筆電（段二開頭主控已經請她做好，或照 HANDOFF 的步驟請她）。**不用裝 Android SDK**：桌機 Chrome 的 `chrome://inspect` 自己找得到 USB 的手機，
   用它的 **Port forwarding**（`localhost:5000` → 筆電的模擬器 hosting）讓 HTC 的 Chrome 開 `http://localhost:5000`（localhost 算安全環境），**裝到主畫面**（manifest 是 fullscreen）→ 重現圖三、圖四，用 inspect 看 `visualViewport`、`innerHeight`、`navigator.virtualKeyboard`。
   模擬器上的資料是種子（假資料），**不是 staging**；從 HTC 截的圖照樣只放 scratchpad。裝不成全螢幕就照文件與推測寫，**在「做完時留下的」寫清楚哪一段是實機才驗得到的**
2. **修法**（照實際驗證選；先試最小的）：
   - 先試 viewport meta 加 `interactive-widget=resizes-content`（Chrome 108+：鍵盤跳出來時版面縮）—— 全螢幕下有沒有用要實機看
   - 不夠才用 `navigator.virtualKeyboard.overlaysContent = true` ＋ 貼底的層 `env(keyboard-inset-height, 0px)`。**它是全站的開關**：一開，每一頁的表單都不再被瀏覽器推上去（新增客戶、設定那幾頁、LINE 模板、客戶／壓表的搜尋、編輯基本資料…），
     所以**只在裝到主畫面時開**（`data/auth.js` 的 `INSTALLED`），而且那幾頁也要照樣看得到在打的那一格（聚焦時 `scrollIntoView`）
   - 不支援的退回 `visualViewport` 的 `resize`（`innerHeight - visualViewport.height` 寫進一個 CSS 變數）
   - **一支模組管**（例如 `ui/keyboard.js`），不要每個抽屜各寫一次
   - 抽屜往上之後**最多佔多高**要重算（剩下的畫面 − 一點縫），框在抽屜裡要捲得到
   - 鍵盤開著時拖抽屜不要拖整頁（`wireDrag` 那一段）
   - iPad（Safari、standalone）不支援 VirtualKeyboard：退路要在那裡也不壞（Safari 本來就會推版面 —— **不要雙重讓開**）
3. **全站排查**（11/6 過目列的，逐一點過、逐一記結果）：右下角泡泡「記一筆」、日曆待辦編輯器、日曆「要幫誰排？」搜尋、日曆來訪編輯器（時間、解鎖理由、記一句）、
   客戶詳情備註編輯（`notesEditor.js`）、訊息框（`message.js` 的 textarea）、加購（`buy.js` 數字）、批次建立微調（數字）、長備註「寫給誰」、`note.js` 的改文字卡與挑日期卡、
   `pushLayer` 那幾層（`noteCard.js`、長備註／備忘錄編輯器、`dialog.confirmWithReason`、拍 Abovee 的搜尋、療程單確認層的搜尋與日期、壓表那疊卡片的時間）；
   **整頁的表單**（新增客戶、編輯基本資料、設定那幾頁、LINE 回覆模板、客戶清單與壓表的搜尋）—— 修法若改了全站的鍵盤行為，這幾頁一定要點過
4. 新檔案進 `sw.js` 的 `SHELL`、`tests-e2e/related.js`；`public/` 有動照規定升 `VERSION`

## 判準

- 鍵盤跳出來時，正在打字的那一格與它的「存」那一顆按鈕看得到嗎？（每一個入口）
- 鍵盤收起來之後，抽屜回到原本的位置、底部沒有留一塊空白嗎？
- iPad Safari／iPad 主畫面那一顆，會不會被讓開兩次（框跑到畫面中間、底下一大塊空白）？
- 桌機（沒有鍵盤）行為一模一樣嗎？`tests/full-height-units.test.js` 照舊綠嗎？
- 能寫成 E2E 的寫（例如 CDP 縮 visual viewport 量抽屜的下緣在不在可見範圍裡）；**寫不成的列進手動驗收清單，她在 HTC 的主畫面那一顆點**（staging 部署之後）

## 做完時留下的

（做完補）
