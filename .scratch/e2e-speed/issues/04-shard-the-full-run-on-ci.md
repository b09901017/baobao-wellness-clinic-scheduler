# CI 上把全量拆成三份同時跑

Status: done（2026-09-09）
來源：2026-09-09，`.scratch/e2e-speed/issues/01` 量到的 21.5 分鐘
動工前先讀：`.github/workflows/e2e-full.yml`、`playwright.config.js` 的 `workers`
**這四支（04～07）裡先做這一支** —— 它是唯一不碰任何共用程式的。

## 為什麼是這一支先

全量 21.5 分鐘。`workers: 1` 還沒解得掉（見 issue 03 與 config 檔頭：真正的瓶頸
是那一顆 Firestore 模擬器與每個測試都重載一次 Firebase SDK），但 **CI 上不需要
解那個問題** —— 開三台機器，一台跑三分之一，每台各有自己的模擬器。

不碰 `workers`、不碰 `projectIdFor()`、不碰任何 app 程式。壞掉最多就是 CI 紅，
本機一個字都不受影響。

## 做法

Playwright 內建 `--shard=i/N`，它會**照測試數量**把整套切成 N 份。

`.github/workflows/e2e-full.yml` 的那個 job 加一個 matrix：

```yaml
strategy:
  fail-fast: false          # 一份紅了，另外兩份也要跑完 —— 不然只看得到最早那個錯
  matrix:
    shard: [1, 2, 3]
```

跑的那一行加 `--shard=${{ matrix.shard }}/3`，artifact 的名字帶上 shard 號
（三個 job 同名會撞）。

**`fail-fast: false` 不要漏。** 沒有它，第一份紅掉時另外兩份會被取消，
而你會誤以為問題只有一個。

## 三件要留意的

1. **切法是照「測試數量」不是照時間。** `07-chaos` 一支就佔 284 秒（全套的 13%），
   所以三份不會一樣長。要更平均得用 Playwright 的 `blob` reporter 加
   `--last-failed`／時間統計，那是後話 —— 先接受不平均。
2. **報告會變成三份。** 現在的 `reporter` 是 `list` + `html` + `json`。
   三個 job 各寫各的，合起來要用 `blob` reporter ＋ `npx playwright merge-reports`。
   **第一版不要做這個** —— 判斷紅綠不需要合併報告，而 artifact 各存各的就夠查。
3. **`retries` 在 CI 上是 1**（`playwright.config.js`）。分片不影響它。

## 值多少

| | 現在 | 之後 |
|---|---|---|
| CI 全量（`e2e-full.yml`） | 估 20~25 分鐘 | 估 8~10 分鐘 |
| 本機全量 | 21.5 分鐘 | **一樣**（這支不動本機） |

本機那一欄沒變是刻意的 —— 本機要快是 issue 03／05／06 的事。

## 怎麼知道做對了

- 推一支測試分支，`e2e-full.yml` 手動觸發（`workflow_dispatch`）
- 三個 job 都綠，而且**三份的測試數加起來等於 193**
  （某一份跑了 0 支的話就是 shard 參數寫錯，而那時候三個 job 全綠 ——
  **這是這件事唯一會靜默出錯的地方**，要真的去數）
- 故意弄壞一支測試，確認它所在的那一份會紅、而且另外兩份照樣跑完

---

## 做完了（2026-09-09）

PR #89。只動 `.github/workflows/e2e-full.yml`（＋順手修的 `deploy.yml`，見下）。

### 三份的測試數：70 ／ 60 ／ 63 ＝ **193** ✅

CI 上真的數過的，不是本機推估的
（[run 34340484450](https://github.com/b09901017/baobao-wellness-clinic-scheduler/actions/runs/34340484450)）：

| shard | 開跑時印的 | 結果 | 測試步驟 | job wall clock |
|---|---|---|---|---|
| 1/3 | `Running 70 tests ... shard 1 of 3` | 70 passed | 10.7m | **11m56s** |
| 2/3 | `Running 60 tests ... shard 2 of 3` | 60 passed | 5.0m | 6m05s |
| 3/3 | `Running 63 tests ... shard 3 of 3` | 63 passed | 5.5m | 6m38s |
| | **193** | **193 passed / 0 failed** | | 整個 run **12m01s** |

本機 `--list` 事先數的也是 70／60／63，兩邊對得上。

### 不平均比預估的嚴重

issue 估「一份 8~10 分鐘」，實際是 **6 ／ 6 ／ 12**。原因是 shard 切在檔案
邊界上而 `07-chaos`（284s）落在 **shard 1**，那一份還連著 `00`～`08` 九支。
最慢那一份 11m56s，`timeout-minutes: 25` 還有 13m04s 餘裕（2.1 倍），夠。

**但省下來的是 21.5 → 12 分鐘（-44%），不是預估的 -60%** —— 因為最慢那一份
就是天花板。要再往下得先做 issue 07（把 `07-chaos` 弄快），或改用時間加權
分片。這一支先到這裡。

### `fail-fast: false` 有效

故意弄壞測試的兩次 run，另外那幾份**都跑完了、沒有被取消**：

- 弄壞 shard 2 一支 → 2/3 failure、1/3 success、3/3 success
- 弄壞 shard 2 與 shard 3 各一支 → 2/3 failure、3/3 failure、**1/3 照樣 success（70 passed）**

### artifact 名字沒撞 —— 但撞不撞根本還輪不到

驗這一條的時候發現**一個從第一天就在的缺陷**：`.artifacts/` 是點開頭的目錄，
而 `upload-artifact@v4` 預設把隱藏檔整個排掉。所以第一次弄壞的那個 run，
shard 2 紅了、upload 那一步「成功」了、artifact **0 個**：

    ##[warning]No files were found with the provided path: .artifacts/. No artifacts will be uploaded.

**它不報錯**，job 照樣紅（因為測試紅），從結果頁上完全看不出證據沒留下來。
`e2e-full.yml` 與 `deploy.yml` 兩支都有，兩邊都補了 `include-hidden-files: true`。

補完之後讓 shard 2 與 shard 3 同時紅，兩份證據都上得去而且名字沒撞：

| artifact | 大小 |
|---|---|
| `全量-e2e-證據-2` | 816,372 bytes |
| `全量-e2e-證據-3` | 828,198 bytes |

那兩支故意弄壞的分支（`claude/tmp-shard-redcheck`、`...redcheck2`）本機與遠端
都已刪掉，`expect(1).toBe(2)` 沒有進到任何一支分支。
