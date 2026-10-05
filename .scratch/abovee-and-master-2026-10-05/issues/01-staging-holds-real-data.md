# staging 改放真資料（預演）

Status: done
來源：`../spec.md`「我 10/5 決定的三件事」、第七題
分支：`claude/staging-real-data`（獨立一支 PR，`sw.js` v143）
動工前先讀：`docs/STAGING.md` 全部、`.scratch/PRODUCTION_AUDIT.md` §3.1、§3.2、`scripts/seed-staging.mjs`、
`scripts/restore-backup.mjs` 的 `SECTIONS`、`public/js/firebase-config.js` 的 `bannerFor()` 一帶（第 140–155 行）

## 她要的

> - **staging 改成放真實資料**（我決定的，代價我聽過了）。這件事還沒落地，請排進這一輪的第一支：
>   - 要一起改：`CLAUDE.md`「`develop` 上 staging，那裡是假資料」那一句、`docs/STAGING.md` 開頭那張表與「放一份假資料進去」那一節、殼上橫幅「這裡的資料是假的」那幾個字、`.scratch/PRODUCTION_AUDIT.md` §3.2 的原則（講清楚被我推翻了）。
>   - staging 上那二十位種子假客戶要先清掉，我才貼合併檔；`npm run seed:staging` 之後不能隨手跑。
>   - **從此 staging 的畫面上有真名**：你在 staging 上測試時，截圖、驗收清單、PR 內文一個真名都不能帶。

> 7. 不搬，staging 只當預演。切換那天正式站重新匯一次合併檔

## 為什麼會這樣

`.scratch/PRODUCTION_AUDIT.md` §3.2 的原則是「永遠不要把正式資料倒進 staging」，理由是匿名化會漏欄位、倒出來的檔案是風險。
那條原則在「正式站已經有真資料、staging 要一份可以亂點的資料」的前提下成立。現在的前提反過來了：**正式站還沒記過任何真東西**
（`go-live-cutover` 那一輪她定的：切換前 app 不記真的東西），而她要在切換前看合併檔匯進去長什麼樣 —— staging 是唯一點得到的地方。

會咬人的地方（第一段查到的 i）：

- `seed-staging.mjs` 每跑一次 `batch.set` **整份種子主檔**（`config/app/<type>/<種子 id>`），不只是加客戶 —— 她在 staging 上改過的主檔會被蓋回種子的樣子
- `clearPrevious()` 只刪 id 以 `seed-cus-` 開頭的文件。staging 上被點過的那幾個月，app 自己建的來訪、任務、隨手記、壓表清單、
  行事備註、表單邀請、療程單**都是亂數 id**，指著已經不存在的假客戶 —— 只清前綴會留下一堆孤兒，日曆和待辦上照樣看得到假的東西
- `docs/STAGING.md` 第五節的還原演練寫的是「還原到 staging --wipe」：真資料上去之後，演練一次就軟刪掉她的預演資料
- `docs/STAGING.md` 第四節「在 staging 上用假資料實際點過那條路」：從此我在 staging 上點的每一下都寫在真資料上

## 談定的做法

1. **ADR-0118**：staging 放真資料、只當預演；切換那天正式站重新匯合併檔，staging 上記的不搬。寫明推翻了
   `PRODUCTION_AUDIT.md` §3.2 的原則、為什麼（前提變了）、代價（畫面上有真名、我的驗收換地方、備份檔有真名）
2. **一支清空工具** `scripts/reset-staging.mjs`（`npm run staging:reset`）：
   - 清的範圍**照 `restore-backup.mjs` 的 `SECTIONS`**（備份裡有的那幾類資料就是「她的資料」）：customers（含 entitlements、availability 子集合）、
     visits、tasks、batches、notes、events、formInvites、formResponses、playbooks、treatmentSheets，**加上 Storage 的 `treatmentSheets/` 底下的照片**
   - **不清**：`config`（主檔與設定）、`allowedUsers`、`audit`、`aiUsage`
   - 跟 `restore-backup.mjs` 同樣三條安全規則：沒有 `--yes` 只印每一類幾筆；正式專案一律拒絕（**沒有** `--allow-prod`）；只認 staging 與模擬器
   - 真刪（`batch.delete`），不寫 `deletedAt` —— 留著會讓「已刪除項目」那一頁塞滿預演的殘骸
   - 之後每一次重新預演（新的合併檔）都是「清空 → 貼合併檔」，所以它是可以重複用的工具，不是一次性的
3. **`seed-staging.mjs` 擋住**：目標不是模擬器、而且那個專案裡有任何一位 id 不是 `seed-cus-` 開頭的客戶 → 拒絕、講為什麼、指到 `staging:reset`。
   判斷寫成一支純函式（`refuseReason({ projectId, emulator, customerIds })`）讓測試釘得住
4. **橫幅**（`firebase-config.js`）：label 還是「測試環境」（她認得這個字）；hint 換成講預演那件事，例：「資料是真的，但這裡只是預演 —— 切換那天不會搬過去」。
   `PRODUCTION_AUDIT.md` 第 800 行引用的那句跟著改說明
5. **文件**：
   - `CLAUDE.md` 第 18、25、30 行：「`develop` 上 staging，那裡是假資料」→ 預演＋真名規矩（截圖、驗收清單、PR 一個真名都不帶；會寫入的驗收步驟在本機模擬器走）
   - `docs/STAGING.md`：開頭表格「資料」那一列、第二節改成「清空重來（每次預演之前）」、`seed:staging` 只在模擬器用、第四節的日常、第五節還原演練改成對模擬器（staging 那一行拿掉或標明會清掉預演資料）、第七節上線檢查表有沒有提到假資料要看一遍
   - `.scratch/PRODUCTION_AUDIT.md`：第 14 行的狀態表與 §3.2 開頭各加一句「2026-10-05 她推翻了（ADR-0118）」，原文不刪
   - `.github/workflows/e2e-full.yml` 第 16 行的註解（「那裡是假資料」）
   - `README.md` 第 687 行那一條是歷史紀錄，不改
6. **實際清一次**：本機有 staging 的服務帳號金鑰才跑（先 dry run 看每一類幾筆，再 `--yes`）；沒有就把指令寫進 PR，請她跑
7. **她要自己看的**（寫進 PR）：staging 的白名單（`allowedUsers`）有誰；設定 → 試算表 推到哪一份（真資料會跟著推過去）

## 牽連

- `tests/seed-staging.test.js`：種子腳本照樣要能在模擬器跑出 0 findings —— 只加守衛，不動產資料的邏輯
- `tests/env.test.js`：`envOf()` 不動
- E2E 一律跑在模擬器上（`deploy.yml`、`e2e-full.yml` 都不碰 staging 的資料庫）—— 查過，不受影響
- `docs/STAGING.md` 第三之三節（拍照 Function）不受影響

## 判準

- staging 上有任何一位真客戶時跑 `npm run seed:staging -- --project staging --yes`：**拒絕**，主檔一筆都沒被寫？
- `npm run staging:reset -- --project staging`（沒有 `--yes`）：只印每一類幾筆，一筆都沒刪？
- `--project prod` 或 `wellness-clinic-scheduler`：不管帶什麼旗標都拒絕？
- 清完之後：日曆、待辦、客戶清單、壓表、療程單、表單收件匣全空，**設定裡的主檔一筆都沒少**？
- 文件裡再也找不到「staging 是假資料」的說法（`grep -rn 假資料` 只剩歷史紀錄與模擬器那幾處）？

## 審查之後補的（2026-10-05，subagent 對著程式碼查過；跟上面衝突的地方以這一節為準）

- 守衛原本寫「那個專案裡全是種子客戶才放行」：**清空之後一位客戶都沒有，守衛就過得去**，照樣把主檔蓋掉 —— 而清空正是貼合併檔的前一步。
  改成**不是模擬器一律拒絕**、dry run 也一樣（`cecb5ce`）
- 做完：PR #137（`b1a2507`、`cecb5ce`）。對 staging 跑過一次只看：客戶 59 位（種子 20、其他 39 是之前測試建的），**還沒清，等她說可以**
