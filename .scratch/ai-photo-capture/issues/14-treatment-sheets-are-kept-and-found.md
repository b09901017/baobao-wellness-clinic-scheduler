# 療程單的存放與搜尋

Status: done
Blocked by: 03、06、11
來源：`../spec.md`
動工前先讀：01 的照片與隱私 ADR、`CONTEXT.md:469`（療程單）、`ui/views/settings.js:81`（「資料」那一區）、
`firestore.rules`（子集合逐個列出的那段註解）、`data/backup.js` 的 `exportAll()` ＋ `scripts/restore-backup.mjs:63` 的 `SECTIONS`、
`domain/audit.js` 的 `describeParts()`、`domain/dayReview.js` 的 `STAGES`、`SPEC.md` 第 6.1 節；
`.local/references/images/療程單-*.jpg`（**有真名，只看不抄**）

## 她要的（原話）

> 第四 : 定期拍診療單 → 確認「已到」「沒排錯」，這個可以放在設定資料那個區塊，多一個拍診療單之類的，這個是可以存起來的 ? 就是我可以在這邊搜尋人名然後看到這個人的診療單，就是我拍照或是上傳照片，可以先辨識這是誰，然後和之前的比如果是新增的話那就替換掉那張照片，如果是不同的，那就新增照片，但是其實我也不會一直更新診療單，所以其實大部分的時候診療單的內容都是落後的，可能兩三個月一次吧 ?

> e 療程單被新版取代時真的刪掉，反正有紙本正本

她說的「診療單」在 `CONTEXT.md` 叫**療程單**，畫面一律寫療程單。

## 為什麼會這樣

療程單是**一位客戶一種課程一張**，客人每做一次簽一列，滿了（20 列）換下一張（EECP 40 堂就是兩張）。
所以兩三個月後再拍，大部分是**同一張多了幾列**；少數是新的一張（換課程、上一張滿了）。

照片實際上：

- 表頭：方案名、民國年日期（`115.5.14`）、客戶姓名、**客戶編號**（＝病歷號，11 用得到）、課程名稱
- 每一列：序號、日期（常常只寫 `7/15` 沒寫年）、客戶簽名、治療師章、器材勾選格、扣課章
- 復能四選一那一種有四格（Indiba／超磁場／高能量雷射／靜脈雷射），同一列可能勾兩格

「同一張還是新的一張」**不可以讓 AI 判斷**（ADR「AI 只抄字」）。

Cloud Storage 從 2026-02-03 起要 Blaze（她本來就是），這個 repo 還沒有 `storage.rules`。

## 要做什麼

### 資料

- `customers/{customerId}/treatmentSheets/{sheetId}`：`courseText`（原字）、`courseIds[]`（她確認過的）、
  `headerDate`、`rows[{ seq, date, signed, ticked[] }]`（日期已補好年份）、`photoPath`、`photoAt`、`updatedAt`、`deletedAt`
- Storage `treatmentSheets/{customerId}/{sheetId}/{photoAt}.jpg`
- `firestore.rules`：子集合**逐個列出**（照那段註解）；`tests-e2e/rules/` 補
- `storage.rules`（新檔）：讀寫刪都要 `firestore.exists(allowedUsers/uid)`；只收 `image/jpeg`、≤ 1.5MB；
  `firebase.json` 加 storage 與模擬器；`start-emulators.sh` 的 `--only` 加 `storage`
- `exportAll()` 與 `SECTIONS` 一起加 `treatmentSheets`（**照片不進備份**，ADR 有理由）

### 年份怎麼補（`domain/treatmentSheets.js`，純函式）

- 表頭有民國年 → 西元；列上寫了年就用那一列的
- 沒寫年的列：從表頭的年開始，**日期比上一列早就跨年 +1**
- 補不出來 → 那一列 `date` 空著、確認時讓她填

### 同一張還是新的一張（同一支）

`sameSheet(existing, incoming)`：同一位客戶、課程對得上，而且 **incoming 的前 k 列（k = existing 的列數，最多 5 列）日期與勾選都一樣** → 同一張的新版。
其餘 → 新的一張。

### 畫面

- 設定 →「資料」多一格 **療程單**（`#/settings/treatment-sheets`），副標「N 位・M 張」
- 搜人名 → 那一位的療程單，**一種課程一張卡**：縮圖、課程、最後一列簽名的日期、「照片是 M/D 拍的」
- 點縮圖 → 全螢幕看原圖，可以縮放
- 右下角相機 → `openCamera({ kind: 'treatmentSheet', max: 10 })`
- 每一張照片一張確認卡：
  - **是誰**：11 的 `identifyCustomer({ name, chartNo })`，對不上就讓她選
  - **課程**：`courseText` → 課程與器材的名字比對；對不上讓她選
  - **這是**：「XX 的新版（多了 3 列）」或「新的一張」—— `sameSheet()` 算的，她可以改成另一個
  - 列表：日期、有沒有簽、勾了哪一台，每一列 06 的「照片上寫的是」
- 存檔：
  - 新的一張 → 上傳照片 → 建文件
  - 新版 → 上傳新照片 → 更新文件 → **刪掉舊照片檔**（真刪，她 9/17；文件本身不刪）
  - 順序不可以反過來：先刪舊的、新的沒傳上去 = 兩張都沒了
- 刪除一整張療程單 → 文件軟刪除，照片檔**留著**（「已刪除項目」還原得回來）
- 稽核那一句（`describeParts()`）：「幫 客戶A 換了 復能 療程單的照片（多了 3 列）」；`dayReview.js` 的 `STAGES` 要收得下

## 判準

- **04 考試（2026-09-17）低於 90% 的那幾欄，確認層要讓她特別看**（ADR-0100「考試結果」）：日期 54/62（7/8↔7/18、8/13↔8/3）；列上的年份會讀成 107、113 → **補年份以表頭為準，離表頭一年以上的列年份不信**；勾的器材 15/18、姓名 8/11

- `tests/treatment-sheets.test.js`：
  - 表頭 `115.5.14`，列 `11/20`、`12/3`、`1/8` → 2026-11-20、2026-12-03、**2027-01-08**
  - 既有 5 列、新的 8 列而且前 5 列一樣 → 同一張；新的前 5 列有一列不一樣 → 新的一張
- 拍一張新版 → Storage 模擬器裡那位客戶那一張只剩**一個**檔案，文件的 `rows` 是 8 列
- 上傳中斷（E2E 讓上傳失敗）→ 舊照片還在、文件沒變
- 沒登入或不在白名單 → Storage 讀寫都被擋（rules 測試）
- `npm run restore` 演練：還原完療程單的文件都在（照片不在是預期的，畫面上那一張卡講「照片不在備份裡」）
- **這一支有沒有任何一條路，讓 AI 決定「這是同一張」？**

## 實作時跟上面不一樣的地方

- **列上的器材存的是 `equipmentIds`（她確認過的器材 id），不是 `ticked[]`**：比對（15）要拿它走 `courseForEquipment()`，
  原字（`IN`、`超磁場`）只在確認卡上給她看，不進資料庫。另外存了 `customerId`／`customerName`／`courseName` 的快照
  （稽核那一句講得出是誰的哪一張、「全部比對一次」照 `customerId` 找來訪）、`ivProductIds`（營養點滴一款一張，
  她的照片上兩款是兩張 —— 不分品項的話兩張會互相說對方「單子上沒有」）、`stalePhotoPaths`（見下）
- **舊照片刪不掉時記在 `stalePhotoPaths`**，下次打開療程單那一頁再刪一次：新版的文件已經指到新照片了，
  最後那一下斷線不算存失敗，但也不可以安靜地留著一份身分資訊在雲端（ADR-0101）
- **年份沒有表頭時從拍照那一天往回推**（判準只寫了表頭）：她的物理賦能那幾張沒有表頭日期，全部空著的話一張要填八格
- **「同一張」拿不準一律是新的一張**（既有的一列都沒有、新拍的比較短）：新版會刪照片，新的一張什麼都不刪。寫進 ADR-0105
- **一張療程單一張卡，不是一種課程一張卡**：EECP 40 堂是兩張紙、兩張照片，併成一張卡就只看得到其中一張的照片
- **認不出人時多一格「打名字找」**：13 的 `none` 不給選人，但療程單的姓名考試只有 8/11，
  名字讀錯、那一位身上又沒有病歷號時，沒有這一格就存不下去。候選照舊不預選（ADR-0103）
- **稽核那一句照 `joinParts()` 的句型**：「換了療程單的照片 客戶A・復能・多了 3 列」，不是判準寫的
  「幫 客戶A 換了…」—— 其餘掛客戶的句子都是「動詞 名字・細節」，照人分組那一格去掉名字才讀得通
- **Storage 的 Rules 擋覆蓋要寫 `resource == null`**，只寫 `allow update: if false` 擋不住（Storage 把同名再傳一次算成 create）
- **`npm run test:rules` 改成一支一支跑**（`--test-concurrency=1`）：Storage 的 Rules 跨服務讀同一份 `allowedUsers`，
  兩支平行跑時 Firestore 那一支清資料會把 Storage 那一支的白名單清掉
- **CI 多兩件**：`deploy.yml` 多一步「部署 Storage Rules」；`e2e-full.yml` 的模擬器補開 functions 與 storage
  （拍照那幾支 35～42 在全量 E2E 上本來就起不來 —— A 組留下來的）。正式環境 CI 那把服務帳號少 serviceusage 的權限，
  寫進 `docs/STAGING.md`「三之三」6b 與上線前檢查表
- **Storage 的 SDK 接在 `data/treatmentSheets.js`，不是 `data/firebase.js`**：跟 `data/ai.js` 接 Functions 同一個做法
  （用到才初始化）；`data/firebase.js` 在 E2E 的「共用底座」清單上，動它就是全跑
