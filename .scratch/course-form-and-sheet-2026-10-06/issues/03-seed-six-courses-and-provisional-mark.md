# 種子補六門課，外加「設定暫定」的小標

Status: todo
來源：她 2026-10-06 第一點之 7、第五點；問題 1（同意）、問題 6
動工前先讀：`public/js/domain/seed.js` 的 `courses`（每一門上面的註解）、`public/js/domain/health.js` 的 `checkSeedCourse()`／`checkSeedBlanks()`／`sameNamed()`、
ADR-0119、ADR-0120、ADR-0121、ADR-0125、`tests/course-systems.test.js`、`tests/course-groups.test.js`、`tests/uncounted-courses.test.js`、
`CLAUDE.md` 連動表「`domain/seed.js`（種子）加一筆、改一格」那一列（**三條護欄＋另外四個地方**）
Blocked by: 02（HRV 的 `systems` 是空陣列）

## 她要的

> 7. 基本上我已經給你完整的課程項目清單了，很少會變，所以希望你幫我把我給你的清單項目的內容都補上去，然後可以標記我還沒決定壓那些阿之類的，以及醫師也可以都補上去…

> 第五 : 補充一點
> HRV也是不算次數的，通常會是我想邀客戶來體驗送的，就會讓他當天做完HRV後然後接著功醫門診聽報告

她的清單（`課程種類與項目.md`，在她機器的 `.local/`）跟種子比，少的是：回測報告、HA-PRP、PRP（醫師門診）、MOTI、運動（運動區）。
其餘都有（寫法不同的靠 `aboveeNames`：復健門診、心臟門診、營養諮詢、身體組成、體適能；三返是 n返）。

## 為什麼會這樣

上一輪（abovee-and-master/12）只補了她答過的功醫門診與羊膜；這五門當時列在「待她回答」。
**Abovee 5～10 月那 353 筆裡這五門一筆都沒有**，所以每一格設定都只能猜 —— 她說「可以標記我還沒決定壓那些」。

## 談定的做法

### 六門課（她問題 1：「同意」）

| id | 名字 | 分類 | 類別／系統 | 指派 | 醫師 | 算次數 | 時長 | `aboveeNames` |
|---|---|---|---|---|---|---|---|---|
| `course-retest` | 回測報告 | 醫師門診 | A／三個都壓 | 都不用 | 功能／二返 | 算 | 30 分 | 回測報告 |
| `course-ha-prp` | HA-PRP | 醫師門診 | C／只壓 Abovee | 都不用 | 復健科 | 算 | 30 分 | HA-PRP |
| `course-prp` | PRP | 醫師門診 | C／只壓 Abovee | 都不用 | 復健科 | 算 | 30 分 | PRP |
| `course-moti` | MOTI | 運動區 | 無／只壓 Abovee | 都不用 | 不用 | 算 | 30 分 | MOTI |
| `course-exercise` | 運動 | 運動區 | 無／只壓 Abovee | 都不用 | 不用 | 算 | 30 分 | 運動 |
| `course-hrv` | HRV | 醫師門診 | 無／**都不用壓**（`systems: []`） | 都不用 | 不用 | **不算**（`uncounted: true`） | 30 分 | （Abovee 沒有這門課，不填） |

- HA-PRP、PRP 照羊膜那一門抄（`requiresDoctor: true`、`doctorPick: '復健科'`；不是 A 類又要醫師的種子課一定要帶 `requiresDoctor`，
  兩支種子測試互相盯著）
- HRV：不簽療程單（沒有次數可以扣，同功醫門診）、不寫紀錄。其餘五門照預設要簽、不寫紀錄
- HRV 的 `lineName`（貼給客人的那一句）：`自律神經檢查` —— 她 10/5 自己的說法（「HRV＝自律神經檢查」）。
  不填的話那一句印三個字母，而 ILIB 當初就是為了「客人看不懂」才有 `lineName`。這一格也在「設定暫定」底下，交付時提一次
- 每一門都帶 `provisional: true`

「算」＝要加購才排得進去。預設都算是刻意的：不算次數的課會出現在**每一位**客戶的「做什麼」那一排（`slotOptionsFor()`），
而她的抱怨正是「好多課程然後都滑不到想要的」。

### 「設定暫定」（`course.provisional`）

- 課程主檔上一格布林，**只認 `true`**（同 `isUncounted()` 的理由）。判斷只有 `masterData.js` 的 `isProvisional()`
- **它只畫一個小標**：設定 → 課程 清單那一列的「設定暫定」徽章、清單最上面一句「還有 N 門的設定是暫定的」。編輯表上的開關在 06
- **沒有任何規則讀它** —— 排得進去、扣得到、長得出待辦，跟沒有這一格一模一樣。照 `tests/course-groups.test.js` 的做法加一條掃原始碼的測試：
  `domain/` 底下只有 `masterData.js`（與資料健檢補空格那一支）問 `.provisional`
- `validators.courses`：有這一格就要是布林
- 字：畫面上寫「設定暫定」。**不要寫「待確認」**（那是來訪的狀態，`CONTEXT.md`）

### 既有資料庫（`loadSeed()` 只建不覆蓋）

- 新的六門走既有的 `checkSeedCourse()`（種子有、她沒有 → 建）。**三條護欄照舊**：她改過的不動、一個種子 id 都沒有的資料庫不念、
  她自己已經建了同名的不再建（`sameNamed()`，ADR-0125）。補上去的值要過得了 `validate()`
- 動工時確認 `checkSeedCourse()` 建出來的那一筆帶著 `provisional`、`uncounted`、`systems: []`（它是不是整筆照抄種子）

## 判準

- 既有資料庫按了資料健檢那一顆：六門出現在對的分類底下、都帶「設定暫定」；她自己已經建了一門「PRP」的那一份不會多一門
- HRV：每一位客戶的「做什麼」那一排有它（不用加購）；加購那一排**沒有**它；排了一段之後客戶身上的數字一格都不動
- 回測報告、PRP 等五門：沒買就排不進去（「做什麼」那一排沒有它）
- 拍 Abovee 課程那一格寫 `PRP` → 認成 PRP，**不是** HA-PRP；寫 `HA-PRP` → HA-PRP（`tests/abovee.test.js`）
- **這一行會不會讓「設定暫定」變成一條規則？**（掃原始碼的測試）
- `tests/course-systems.test.js`：種子每一門的 `systems` 跟 `category` 推出來的一樣 —— HRV 是 02 開的那個例外，其餘五門照舊成立

## 改了種子另外要查的四個地方（記憶裡那張清單，上一輪四個都踩到）

1. **E2E 裡寫死的筆數**：`47-course-groups`（一組裡有哪幾門）、`16`、`17`。跑 `--related` 之前先 `--dry` 看會跑幾支
2. **E2E 自己建了同名的東西**：`git grep -n "回測報告\|PRP\|MOTI\|HRV" tests-e2e/`
3. **`.claude/skills/calendar-sheet-merge/scripts/merge.mjs`**：`TOKENS` 與 `ivProductOf()` 拿名字的前兩個字比行事曆標題。
   新名字的前兩個字（回測、HA、PR、MO、運動、HR）會不會誤認？**`HRV` 現在被 `TOKENS` 認成功醫門診** —— 那一條這一支不要動
   （那 7 句 HRV 怎麼處理還在等她回，見 11 第四節）。**動這一支之前先照 11 的「基準」跑一次、做完再跑一次比數字**
4. **`tests/health.test.js` 的夾具混著種子 id**：新的檢查會不會在每一支既有測試多報一列

另外：`npm test` 要在新檔案 `git add` 之後再跑一次（真名掃描只掃被追蹤的檔案；中文字後面直接黏兩到四位數字會被當成「姓名黏病歷號」）。

## 連動

- `docs/課程與待辦對照表.md`（六門各一列）、`SPEC.md` 第 12 節種子、`CONTEXT.md`（HRV 現在是一門課 —— 「功醫門診」那一條的 _Avoid_ 寫著 HRV，要改）
- `README.md` 開發狀態表
- 06 畫編輯表上的開關；07、08 靠分類把這幾門排進去；01 之後試算表上 HRV 自己一列
