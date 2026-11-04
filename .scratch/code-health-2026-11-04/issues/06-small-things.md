# 小事：部署順序、規則註解、小腳本的日期、備份沒有 config/ai

Status: open（2026-11-04 只記錄，順手修就好）
來源：`../REPORT.md` 三、五
Blocked by: —

- `.github/workflows/deploy.yml`：Hosting 在 Firestore Rules／索引之前部署。考慮先推 Rules 與索引、最後才上 Hosting
  （注意 `firebase-tools` 釘 13 那一段、Storage 那一步可能紅的理由）
- `firestore.rules:24-28`：`keepsExistingId()` 的註解說它擋硬刪除，實際只檢查有沒有 `updatedAt`；改註解（或名字）。
  `audit` 的 `at` 沒釘 `request.time`（可選）
- `.claude/skills/customer-availability-sheet/scripts/history.mjs:92-93`：今天改用本地時區（lessons 第七節）
- `public/js/data/backup.js`：要不要把 `config/ai` 一起匯出、`restore-backup.mjs` 一起還原（不是必要，`docs/STAGING.md:360`）

## Comments
