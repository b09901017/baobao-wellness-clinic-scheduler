# verify 只跑「上一次全綠之後動過的」

Status: done（2026-10-16）
來源：她 2026-10-16「e2e 現在好像跑得有點久了」
動工前先讀：`scripts/e2e-changes.mjs` 的檔頭（為什麼可以取交集）、`tests-e2e/related.js` 的 `pick()`

## 量到的

CI 全量 9/10 8 分鐘 → 10/15 13～14 分鐘，但**每一條變快了**（4.8 → 3.6 秒）—— 是條數 219 → 504。
那一段是 09 的事。她真正在等的是 `npm run verify`：

- `--related` 以前一律**跟 develop 比**（整條分支）。拿 9/20 之後合進 develop 的 27 支 PR 重播收尾那一刻：
  **6 支全跑**（共用底座或沒登記的檔案）、**另外 13 支選到 50 支以上**（總共 69 支）
- 一個檔案自己就挑很多：`ui/views/schedule.js` 29、`calendar.js` 28、`home.js`／`visitEditor.js` 24、
  `domain/visits.js` 23 —— 一輪通常每一個都會碰到，聯集就是大半套
- 本機每一條是 CI 的約 1.6 倍（10/14：47 支 339 條 33.8 分鐘；CI 是 3.6 秒一條）
- 10/4 之後 14 支 PR、246 個 commit，假設每個 commit 都 verify 一次（上限的估法）：
  跟 develop 比 **96.7 小時**，只比這一步改的 **30.6 小時**（CI 秒數）—— 約三分之一
- 另外有 4 支被追蹤的程式沒登記、改到就全跑：`data/audit.js`、`data/batches.js`、`data/events.js`、
  `domain/lineText.js`，還有 `public/icons/`、`.gitattributes`、`skills-lock.json`、`tests-e2e/project-id.mjs`

## 做了什麼

1. **跟上一次全綠比**：全綠的那一刻把整個工作區（含還沒 commit、還沒 add 的）用暫存的 index
   `add -A` ＋ `write-tree` 拍成一個 tree，記在 `.artifacts/verify-green.json`（每個工作目錄自己一份）。
   下一次拿現在的工作區跟它比
2. **兩邊取交集**：跟 develop 比挑到的、跟上一次全綠比也挑到的才跑。可以不跑的條件是「它摸得到的檔案
   跟 develop 一樣（develop 是綠的）**或**跟上一次全綠一樣（那一次是綠的）」，所以交集是對的、不是猜的
3. 退回只看 develop：沒有紀錄、tree 被 gc 收掉、`related.js` 在那之後改過、自己帶 `--base`
4. 只有 `--related` 與不點名的全跑會記；跑的時候帶 `--forbid-only`（留一個 `test.only` 會只跑那一條而且綠）
5. `related.js` 多 `FOLLOWS`（只被別人 import 的檔案跟著 import 它的人走），上面那幾支補登記；
   `tests/e2e-related.test.js` 多一條：**被追蹤的每一個檔案都要認得出來**（以前退回全跑只在那一次 verify 的畫面上講一句）

## 驗過的

- 單元測試 `tests/e2e-since-green.test.js`：交集、四種退回、什麼時候記、真的 git（她 stage 的不被動到、
  沒 add 的認得、中文檔名、搬家新舊兩邊、gitignore 擋掉的不算、tree 不在了回 null 不是「沒改」）
- 模擬兩步：第一步改 `visits.js`（23 支）全綠，第二步只改 `lineText.js` → 跟 develop 比 27 支、
  跟上一次全綠比 5 支 → 跑 5 支
- 把 `FOLLOWS` 拿掉一條，新的守衛紅、而且講得出要加在哪

## 還沒解的

一步改到壓表、日曆、`visits.js` 本身就是 20 幾支（本機 15～20 分鐘）。那種丟 CI
（`gh workflow run e2e-full.yml --ref <分支>`），不佔她的電腦。名單本身照「它壞了哪一支會紅」寫，沒有放寬。
