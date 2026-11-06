# 09：派送（App Distribution）、裝好兩支、文件

Status: done
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

段七（2026-11-06）。

**App Distribution**（兩個專案她在主控台按了「開始使用」—— 沒按之前 CLI 回 404；其餘段七用 CLI）：兩個專案各一個群組「只有我」（alias `owner`），只有她一位。
staging 第一版 **0.1.0（versionCode 1）已派送**（她會收到邀請信）；正式站還沒派送（段九，她在 HTC 點過說可以才派、才裝三星）。
派送指令、第一次裝（允許不明來源）、更新、換手機都在 `docs/STAGING.md`「三之四、桌面小工具」。

**簽章**：GitHub Secrets 四格 `BAOFU_NOTES_STORE_BASE64`（鑰匙檔 base64）／`_STORE_PASSWORD`／`_KEY_ALIAS`／`_KEY_PASSWORD`（她自己跑段七的腳本放的 —— auto mode 擋我寫 Secrets）；
備份在私人 repo `android-signing/`（jks＋寫著四行的 README，段七 commit `5db2155`，沒 push）。讀過密碼的腳本用完刪了。
`android.yml` 推到 develop／main 時多一步：Secrets 解成檔案、建 `assembleStagingRelease`／`assembleProdRelease`、檢查沒有 unsigned、刪鑰匙檔；**APK 不上傳成 artifact**（repo public）。沒有 Secrets 就跳過（fork 的 PR）。`versionCode` 每派送一版加一（`build.gradle.kts` 有註解）。

**小工具挑選畫面的預覽**（段六中途發現 6）：`res/layout/widget_preview.xml`（`android:previewLayout`，假的三列字、Palette.Light 的顏色）。
HTC 上剛重裝完第一次看是「無法載入小工具」（`Resources$NotFoundException`：桌面程式拿著重裝前那一支的資源）；重開桌面程式之後正常。清單寫了。

**HTC**：段七把接模擬器的開發版移除（只有模擬器的假資料），改裝 release 簽的 0.1.0（跟派送的是同一個 APK）；她登入 staging、放了小工具。
唯讀走過的見 `android-checklist.md` 最後「誰走過」。過程中段七用 `svc power stayon usb` 開了「充電時不關螢幕」、**馬上關回去了**（`stay_on_while_plugged_in` 是 0）—— 不改她手機的設定。

**文件**：`docs/STAGING.md`「三之四」、`docs/操作手冊.md`「桌面小工具」、`docs/常見問題.md` 三條（小工具上還沒出現／三星有毛玻璃 HTC 沒有／沒有權限）、`SPEC.md` 隨手記那一節一段、`README.md` 開發狀態 41k（☐，段九合進去之後打勾）。沒有鑰匙、密碼、email、真名。

**手動驗收清單草稿**：`.scratch/notes-widget/android-checklist.md`（A HTC 測試版、B 三星正式版）。寫入的那幾步段六在模擬器那一支走過，段九陪她在 staging 走。
