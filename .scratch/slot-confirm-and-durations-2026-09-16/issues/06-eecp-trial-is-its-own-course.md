# EECP：正式課 60 分，另開一門體驗課 30 分

Status: todo
來源：`../spec.md`（保留第 2 題）
動工前先讀：`domain/seed.js` 的 `courses`、`docs/adr/0079`（EECP 只能在治5、治8）、
`docs/課程與待辦對照表.md`、`SPEC.md` 第 7 節規則 2

## 她的答案（原話）

> EECP 30 還是 60 ? 之前有看行事曆還是哪裡有發現有EECP體驗課，也有發現30分鐘的EECP，
> 所以問了這個問題
>
> 體驗30正式課60，也就是預設資料裡面要多一門EECP體驗課，預設30分鐘，
> 這樣匯入的也可以對應到了

## 為什麼現在是 30

`domain/seed.js:246` 的 `course-eecp` 是 `durationMin: 30`。2026-09-16 早上她說
「這個先保留先當作30分鐘」，那是暫定值。**所以這一支要改兩件事，不是一件**：
既有那一門 30 → 60，再新增一門 30 分的體驗課。

`SPEC.md:232` 她自己記的實際紀錄寫著 `14:45–15:15  EECP 體驗` —— 30 分，對得上。

## 要做什麼

1. `domain/seed.js`：`course-eecp` 的 `durationMin` 改 **60**。
2. 新增一門 `course-eecp-trial`：
   - `name`: `EECP體驗`（**跟舊表 列14 寫的字一樣** —— `legacyImport.js:1197`
     的註解裡就是這四個字，匯入才對得到）
   - `durationMin: 30`、`category: 'C'`（Abovee，同正式課）
   - `assigns: 'room'`、`allowedRoomIds: ['room-t5', 'room-t8']`、
     `preferredRoomIds: ['room-t5', 'room-t8']`（**跟正式課同一組限制** ——
     機器就那兩間，體驗不會換地方）
   - `requiresEquipment: false`、`frequencyRule: null`、不用 `needsRecord`
3. `legacyImport.js` 的 `SHEET_COURSE_ALIASES`：加一列 `EECP體驗: 'EECP體驗'`。
   ⚠️ **`:1197` 那一段不要動** —— 它處理的是「列 14 寫了字、那天卻沒有營養點滴
   拿去用」，把那句話收成備註。體驗課是課程不是點滴品項，兩件事不在同一條路上。
4. `docs/課程與待辦對照表.md`：第 112 行那一列（`復能、ILIB、EECP | C | Abovee`）
   加上體驗課。`SPEC.md` 第 7 節那張表同樣。

## 產檔那側（`.local/`，不進版控）

`.claude/skills/calendar-sheet-merge/scripts/merge.mjs:31` 讀的就是
`public/js/domain/seed.js` 的 `SEED`，所以時長會自己跟上 —— **但課程的判定不會**。

她那份 `import-2026-09-16.json` 的 20 段 EECP 分屬 3 位客戶，`evidence` 原文寫著
「體驗」的**只有 1 段**（2026-08-11）。定案：**19 段算正式課 60 分、那 1 段算
體驗課 30 分**。重跑產檔時核對這個數字 —— 對不上就是判定寫錯了，先停下來問。

## 判準

- `SEED.courses` 裡 `EECP` 是 60 分、`EECP體驗` 是 30 分，兩門的 `allowedRoomIds`
  一模一樣
- 拿舊表寫著 `EECP體驗` 的那一格跑 `resolveCourse()` → 對到體驗課，不是正式課，
  也不是「對不到任何課程」
- 重跑產檔後：EECP 正式 19 段 × 60 分、體驗 1 段 × 30 分
- 這一行會不會讓一段 30 分的體驗課被算成 60 分而佔掉治5一整個小時？
