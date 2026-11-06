# 09：派送（App Distribution）、裝好兩支、文件

Status: todo
Blocked by: 07、08

## 動工前先讀

- `spec.md`「一」、06–08 的「做完時留下的」
- `docs/STAGING.md`（寫法照它：怎麼操作，不寫為什麼）、`docs/操作手冊.md`（不定義規則，連回 SPEC／ADR）
- `CLAUDE.md`「文件分工」

## 要做的

- **Firebase App Distribution**：兩個專案各開（先問她 —— 主控台的設定）、她的 email 加進測試者、GitHub Actions 建好上傳（或手動上傳的步驟寫清楚）；**不公開下載**
- **簽章（段五留下的）**：release 鑰匙**只有她筆電上一份**（`~/.android/baofu-notes-release.jks`，密碼在 `~/.gradle/gradle.properties` 的 `baofuNotes*`，SHA-1 已登記在兩個 Firebase 專案）。放進 GitHub Secrets（`app/build.gradle.kts` 的 `secret()` 認 `BAOFU_NOTES_STORE_FILE`／`_STORE_PASSWORD`／`_KEY_ALIAS`／`_KEY_PASSWORD`；鑰匙檔用 base64 的 secret 在 workflow 裡解成檔案）、**備份放哪先問她**（建議私人 repo `.local`）—— 弄丟了，裝好的那一支要移除重裝、Firebase 換登記一把 SHA-1。HTC 上現在裝的是筆電 debug 鑰匙簽的那一支（登入著 staging）：換成派送的 release 那一支**之前要先移除**（簽章不一樣裝不上去），手動驗收清單寫進去
- HTC 裝「隨手記（測試）」、三星裝「隨手記」（**三星裝正式版之前她在 HTC 上點過、說可以**）；第一次「允許安裝不明來源」的步驟一步一步寫給她
- 文件：
  - `docs/STAGING.md` 加一節「桌面小工具」：裝、更新、換手機、簽章鑰匙在哪（GitHub Secrets 的名字，不寫值）、怎麼建一版
  - `docs/操作手冊.md`：小工具怎麼放到桌面、怎麼記、怎麼勾（規則連回 SPEC／ADR-0178、0179）
  - `docs/常見問題.md`：「在 app 記的，小工具上還沒出現」「三星有毛玻璃、HTC 沒有」「登入說沒有權限」
  - `SPEC.md` 隨手記那一節補小工具一段、`README.md` 開發狀態表
- 手動驗收清單草稿（她照順序點的路，**寫的人自己在 HTC 上走過**）

## 判準

- 從零開始，照文件她自己裝得起來、更新得了嗎？
- 文件裡有沒有任何鑰匙、密碼、真名、她的 email？

## 做完時留下的

（做完補）
