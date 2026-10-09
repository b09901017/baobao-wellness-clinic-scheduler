# 交接檔：二返先接上還沒做完的健檢（B）

先讀 `CLAUDE.md` → `docs/agents/lessons.md`（第一、二、五節）→ 這一份 → `issues/01`（全貌與七條連動）→ 要做的那一支子 issue。
子 issue（02–12）只寫範圍、判準、依賴；細節（現在那一行在哪、改了會怎樣）在 01，**不重複**。

## 現況

| issue | 內容 | 狀態 |
|---|---|---|
| 01 | 母 issue（她 10/9 的原話、七條連動、五題的回答） | 拆成 02–12 |
| 02 | 核心：還沒做完的健檢按得下去、`owed()` 扣掉接在沒做完上的、`linkedSeconds()`／`claimedExams()` 合一 | done |
| 03 | n返 一起放寬 | done |
| 04 | 一次健檢一場二返（存檔驗證） | done |
| 05 | 簽療程單擋：接的那一次沒做完 | done |
| 06 | 健檢取消／未到：確認框與抽屜講一句；取消入口收成一支 | done |
| 07 | 另約一次健檢時講「二返還接在被取消的那一次上」 | done |
| 08 | 二返排在健檢之前：提醒 | done |
| 09 | 客戶詳情三個數字 | done |
| 10 | 資料健檢兩列 | done |
| 11 | 拍 Abovee：同一批先存健檢再接二返、沒有健檢不預設打勾 | todo |
| 12 | 文件、ADR-0145、E2E 65、量測、PR | todo |

- 分支 `claude/followup-link-before-exam`，從 `origin/develop` `9e40c21`（PR #147 合進去那一個）開。一支 PR 進 `develop`。
- 編號：ADR-0145 起、E2E spec `65`（登記進 `tests-e2e/related.js`）、`sw.js` `v187`（02 升，之後不再升）。

## 每一支怎麼做

1. 先寫會紅的測試（`tests/`，不帶真名：客戶A／王小明、人員寫「某」）→ 跑過確認紅 → 修到綠 → `npm test` → 一支一個 commit → `Status: done` ＋「做完時留下的」。
2. E2E 只跑相關的 spec（`node scripts/e2e.mjs <編號>`），跑之前看 5000、8080 有沒有人在用，跑完依 port 關模擬器。全量丟 CI。
3. 不部署、不連正式站。
4. 改檔有反斜線或長樣板字串就用 Write 寫腳本到 scratchpad 再跑（lessons、上一輪 HANDOFF 的坑）。

## 每一支留下的

（做完一支加三五行：偏離 issue 的地方與理由、下一支要知道的。）
