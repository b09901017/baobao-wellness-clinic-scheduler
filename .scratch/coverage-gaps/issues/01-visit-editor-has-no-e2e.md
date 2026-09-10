# 來訪編輯器那三支 ADR 沒有一支 E2E

Status: done（2026-09-10，`tests-e2e/specs/25-visit-editor-one-slot.spec.js`）
來源：2026-09-10 的覆蓋率盤點（見 `spec.md`）
動工前先讀：`docs/adr/0083`、`0084`、`0085`

## 症狀

手動驗收清單第 19、20、25、27、28、29、30、31 這八條 —— 也就是「改一段就是
改那一段」「一天一筆」「加一段不繼承已確認」「那一句話記在段上」整組 ——
第一線把關的全是**原始碼掃描**：

| 條 | 守衛 | 掃的是什麼 |
|---|---|---|
| 19 | `visit-editor.test.js:138` | `visitEditor.js` 裡有沒有那一段 `canAddSlots` |
| 20 | `visit-editor.test.js:131` | `readDraft()` 裡有沒有那一行 early return |
| 29 | `visits.test.js:1832` | `blankSlot()` 裡有沒有 `status: INITIAL_STATUS` 這一串字 |
| 30 | `visit-editor.test.js:195` | `submit()` 裡有沒有 `hasNewSlots(` |
| 31 | `visit-editor.test.js:204` | `slotXButton()` 裡有沒有 `storedSlotCount` |

第 25 條（一天三段只記一段，就只有那一列亮夾板）唯一那支 E2E
（`19-untick-and-drawer-todos` 的 U10）**餵的是舊形狀**：整筆的 `visit.note`
加上那一天只有一段。ADR-0084 真正修的症狀它抓不到。

## 為什麼掃描不夠

搬去別的函式、被上游覆蓋、或者接線那一端根本沒把值傳進來 —— 三種都會讓
掃描照樣綠。第 29 條那個洞（一段從沒問過客人的時間被靜默標成談定了，
而且開始佔次數）是這一輪最貴的一個，而它的守衛是一次字串比對。

## 做法

新增 `tests-e2e/specs/25-visit-editor-one-slot.spec.js`，八支，從瀏覽器那一端
問同樣的問題。登記進 `tests-e2e/related.js`（`visits.js` 與 `visitEditor.js`
是它的主場）。

## 結果

**第一次跑就抓到兩個 bug**，兩個掃描都看不到：

- issue 03：日曆加一段進已確認的來訪，整筆狀態沒有重推（跟壓表不一致）
- issue 04：`.slothead__x::after` 貼錯盒子，「記一句」那一顆按下去會跳「取消這一段」

## Comments

2026-09-10：V4 拆成兩支 —— 時段那兩格的斷言是綠的，整筆那一格移進
`V4b`，掛 `test.fail()` 指著 issue 03。修好那天它會轉紅（`test.fail()` 的
測試通過時 Playwright 會讓整份紅），所以不會被忘記。
