# 來訪編輯器存檔時沿用打開那一刻的來訪 → 額度少算、同一天兩筆

Status: open（2026-11-04 只記錄，她說之後再改）
來源：`../REPORT.md` #1
動工前先讀：`public/js/ui/views/visitEditor.js` 的 `refreshCustomerVisits()`（`45dd973` 的 `:1643`）、`submit()`、`mergedPayload()`、
`cancelOneSlot()`；`public/js/data/visits.js` 的 `save()`、`countOps()`；ADR-0158、ADR-0083；`docs/agents/lessons.md` 第二節
Blocked by: —

## 問題

`refreshCustomerVisits()` 在打開時讀的是伺服器那一份、而且沒離線時就不重讀。存檔用那一份重算額度快取、判斷同一天有沒有一筆。
打開之後別台替同一位客戶加了一段（扣同一筆額度），這裡存檔就把 `bookedCount` 寫少一次；同一天的話還會長出第二筆來訪。
`ifUpdatedAt` 只擋同一筆，擋不到別筆。其他入口（壓表、日曆長按、批次取消、兩張抽屜、拍 Abovee）都在按下去那一刻 `listWhole()`。

## 怎麼重現（本機模擬器，不要在 staging）

1. `npm run emulators`；另一個終端機 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed:staging -- --project demo-scheduler --yes`
2. `127.0.0.1:5000` → 設定 → 資料健檢：應該一條都沒有
3. 分頁 A：日曆 → 點下週三 → ＋ → 新增來訪 → 客戶A → 選一筆有剩的額度，不要存
4. 分頁 B：日曆 → 點下週五 → ＋ → 新增來訪 → 客戶A → 同一筆額度 → 存
5. 回分頁 A 存
6. 資料健檢「次數對帳」出現客戶A，已排未上差一次。第 4 步也選下週三的話「同一天有兩筆來訪」也會出現

（步驟照程式碼推的，2026-11-04 沒在畫面上點過；數字錯誤用 `recount()` 算過：寫 2、應該 3）

## 修的方向

拿掉提前 return、按下去那一刻一律 `listWhole()`；或至少 `isNewDoc` 時一定重讀。順手改掉 `:1639-1641` 那句「`ifUpdatedAt` 照樣擋」。
修 bug 先寫一支會紅的測試（CLAUDE.md）。

## Comments
