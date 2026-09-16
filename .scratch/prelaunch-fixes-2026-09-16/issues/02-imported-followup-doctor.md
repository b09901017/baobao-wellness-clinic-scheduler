# 匯入的二返，醫師被寫進治療師那一格

Status: todo
來源：`../spec.md`（報告 §2.3）
動工前先讀：`docs/adr/0026`（醫師是可指派的人）、`docs/adr/0058`（門診一律選得到醫師）、
`domain/masterData.js` 的 `picksDoctor()`、`DOCTOR_ROLE`

## 現在壞在哪

她那份 import 裡 9 段二返，**8 段帶著醫師**（夏、許、李）。模擬匯入之後那 8 段的
`therapistId` 指到一位 `role: 醫師` 的人，而 `doctorId` **這一格根本不存在**
（`'doctorId' in slot` 是 false）。

`domain/mergeImport.js:301` 的 `resolveAssignments()` 拿 `therapistName` 照名字對 staff，
**不看角色**，回傳的四格裡也沒有 `doctorId`。skill 那一側把行事曆上的「*許」放在
`therapistName`（`merge.mjs:1122`）—— 那一側沒有錯，錯在這一側沒有分角色。

後果：

- 讀取卡片上看起來正常（名字照樣印）
- 試算表那一格：`domain/sheetReport.js:513` 讀的是 `doctorId`，所以印成 `7/17 二返`，
  **醫師那個括號沒了**（而空括號在她的寫法裡是「還沒約」的意思，ADR-0026）
- 她改那一段任何東西再存：二返不指派治療師，`ui/views/visitEditor.js:870` 把
  `therapistId` 清成 `null` —— **名字安靜地不見了**
- 撞期判斷刻意不比醫師（`domain/visits.js` 的 `conflictWarnings()`），但這 8 段是當成治療師比的

## 做法

- `resolveAssignments()` 對到 staff 之後看 `role`：是醫師就放 `doctorId`、`therapistId` 留 `null`；
  是治療師就照舊。角色的判斷走 `domain/masterData.js` 既有的 `DOCTOR_ROLE`，不要在這裡寫死字串
- 回傳的物件補上 `doctorId`（現在連 `null` 都沒有）
- 對不到主檔時照舊進 `problems`，訊息要分得出「沒有這位治療師」與「沒有這位醫師」

## 判準

- **這一行會不會讓一位治療師被當成醫師存進去？**（反過來一樣糟）
- 一段二返、`therapistName` 是主檔裡的醫師 → `doctorId` 有值、`therapistId` 是 `null`
- 一段復能、`therapistName` 是主檔裡的治療師 → `therapistId` 有值、`doctorId` 是 `null`
- 匯進去之後那一段的試算表格子印得出 `7/17 二返(夏)`
- 她打開那一段改個時間再存，醫師還在
- 重現測試 `tests/prelaunch-repro/2-3-doctor-in-therapist-field.test.js` 轉綠
