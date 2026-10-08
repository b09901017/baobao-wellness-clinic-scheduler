# 部署完一小時內可能拿到舊程式；兩次部署會互相蓋；本機預設指向正式站

Status: todo
來源：`f-deploy-cache`、`ops/report.md` 第 6、9 條
動工前先讀：`docs/agents/lessons.md` 第九節、`firebase.json:6-15`、`public/sw.js:170`、`:221`、
`.github/workflows/deploy.yml:130-131`、`.firebaserc`、`docs/STAGING.md`（部署指令那幾節）、
`CLAUDE.md` 連動表「`firebase-tools` 的版本」「`public/` 底下任何檔案」
Blocked by: —
重現：`curl -sI https://wellness-clinic-staging.web.app/js/app.js | grep -i cache-control`（現在是 `max-age=3600`；只讀公開的網頁檔）、
`node .local/references/audit-2026-10-08/ops/r-deploy-race.mjs develop 20`

## 她要的

> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單

報告那一張卡：

> 部署完一小時內可能拿到舊的程式；兩次部署同時跑會互相蓋掉
>
> 網站回給瀏覽器的設定是「程式檔可以快取一小時」。我直接看了 staging：app.js、app.css，連你打開的首頁網址都是一小時，只有 sw.js 不快取。

## 為什麼會這樣

- `firebase.json` 只替 `/sw.js` 與 `/index.html` 設不快取。`/js/**`、`/css/**`、`/` 用 Hosting 的預設（一小時）。
  service worker 是網路優先，但它抓檔也經過瀏覽器的 HTTP 快取。
- `deploy.yml` 沒有 `concurrency`：10/7 staging 有 19 秒退回上一版（較舊的那一次後完成）。
- `.firebaserc` 的預設專案是正式站：本機部署 Function 漏打一次 `--project` 就上正式。

上線那天正式站一口氣跳 50 版，新舊檔混在一起某幾頁可能打不開；她在 staging 驗收也可能看到「明明修了卻沒變」。

## 要做的

- `firebase.json`：程式檔（`/js/**`、`/css/**`、`/`、每一支 `.html`、`manifest`）改成 `no-cache`（每次都先問，沒變就是一個很小的 304）。
  圖示那種不會變的照舊。
- `deploy.yml` 加 `concurrency`，**同一個環境排隊、不取消進行中的**（取消會留下一半的部署）。
  **放在 workflow 那一層，不是 `deploy` 那個 job**：只放在 job 上的話，排隊的順序是「誰的測試先跑完」不是 commit 的順序，10/7 那種「舊的後完成」照樣會發生。
- `.firebaserc` 的預設改成 staging。審查查過：CI 三個部署步驟都自己帶專案（`deploy.yml:166`、`:184`、`:199`），`package.json` 與 `scripts/` 沒有靠預設值的指令 —— 動工時再確認一次，連 `docs/STAGING.md` 裡示範的指令一起。
- **`tests/env.test.js:108` 現在釘著相反的事**（`default` 要指到正式，理由是「不帶 `--project` 的指令走的是它」）。把那一條**改成新的決定並改掉理由那一句**，不是另外加一條。

## 判準

- 靠預設專案上正式的指令還剩幾條？（要 0。有的話是補 `--project`，不是把預設改回去）
- 模擬器與 E2E 用的 `demo-` 專案受不受影響？（`projectIdFor()` 那條路自己帶專案）
- 兩次 push 連著來：後面那一次會等前面那一次嗎？前面那一次會不會被砍到一半？
- 較舊的 commit 測試跑得比較久時，最後部署上去的還是不是最新的那一個？
- `sw.js` 與 `index.html` 原本的不快取還在嗎？
- **這一步怎麼確認真的生效**（lessons 九）：合進 develop、staging 部署完之後 `curl -sI …/js/app.js` 要看到 `no-cache`，寫進 23 的驗收清單。
  本機先驗一半（待查）：模擬器的 hosting 應該也吃 `firebase.json` 的 `headers` —— 這一段跑 E2E 開著模擬器時，對 `127.0.0.1:5000/js/app.js` 與 `/` 各 `curl -sI` 一次。

## 測試

- `tests/` **新開一支**讀 `firebase.json`（現在沒有任何一支測試讀它）：程式檔那幾種路徑都有 `no-cache`、`sw.js` 與 `index.html` 原本的還在。
- 一條讀 `deploy.yml`：workflow 那一層有 `concurrency`、`cancel-in-progress` 是 false。
- `.firebaserc`：改 `tests/env.test.js:108` 那一條（上面）。

## 文件

`docs/STAGING.md` 部署那幾節：本機指令照舊寫出 `--project`，補一句「預設是 staging」。
