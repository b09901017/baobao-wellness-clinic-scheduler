# 設定 → 課程 → 編輯：版面重排

Status: done
來源：她 2026-10-06 第一點之 1～6；問題 2（「目前沒有」）
動工前先讀：`public/js/ui/views/masterList.js`（`editors.courses` 的 `fields()`／`parse()`／`wireForm()`、`paintForm()`、`aliasField()`、`preferredRoomsField()`）、
`public/js/ui/components/form.js`（`chips()` 的 `lead`／`quiet`、`wireChips()`）、`public/js/ui/components/buy.js` 的 `TIER_OTHER`（「它不是一個等級，是一顆展開輸入框的鈕」）、
`public/js/ui/views/naming.js`（LINE 別稱現在在這裡）、`public/js/domain/masterData.js`（`doctorRuleOf()`、`nameVariants()`、`normalizeGroup()`）、
**ADR-0026（「醫師不塞進 assigns…它同時要診間和醫師」）、ADR-0058（「一段可以兩個都有」）**、ADR-0038、ADR-0075、ADR-0077、ADR-0119、ADR-0120、ADR-0122、`tests/number-fields.test.js`、`tests/tip-red-lines.test.js`、`tests/fewer-words.test.js`、
`CLAUDE.md` 連動表「畫面上一段常駐的說明」「任何一個 `type="number"`」「一段要用綠色的字」三列
Blocked by: 02（三個系統都不勾存得下去）、03（`provisional`）

## 她要的

> 有關設定 → 課程→ 編輯 的版面設計 : 請精心設計UIUX
> 1. 我希望新的分類可以變成加號的丸子放在分類的最後面，不用特別給他一格
> 2. 別稱要有月曆別稱以及line別稱設定(復能就不用)
> 3. abovee 上的寫法要幫我預設好，我已經給你整份清單了(見圖片辨識參考資料夾)
> 4. 時長，可選時長，預約時可選時長，平常不會設定到可以先三個平行收合起來
> 5. 排班時要指派的分四種，診間，物理治療師，醫師，都不用
> 然後我希望選了診間後才會顯示可用診間類型以及只能排在這幾間
> 選了醫師才顯示來訪時選醫師
> 6. 來訪時要選器材(目前只有復能需要)，來訪時選營養點滴品項(目前也只有營養點滴需要)，所以這兩個平常也可以先收合，其實頻率限制，做完之後還要再約一次也平常不會設定到
> 所以其實可以時長，可選時長，預約時可選時長，來訪時要選器材，來訪時選營養點滴品項，其實頻率限制，做完之後還要再約一次這幾個可以先收合到其他設定之類的，平常不用顯示

問她「有沒有一門課同時要選診間又要選醫師？」，她回：

> 問題 2：目前沒有

## 為什麼會這樣

這張表是一輪一輪加欄位長出來的（分類、別稱、Abovee 寫法、三種時長、系統、指派、兩種診間限制、常用診間、器材、品項、醫師、療程單、紀錄、不算次數、頻率、再約一次），
現在二十排由上到下一樣大。她平常只改得到前面幾排。

## 談定的版面（第一段給她看過，她沒有反對）

```
（這門課的設定是暫定的 —— 只有 provisional 的那幾門有這一條）
課程名稱 [          ]
分類      (復能)(ILIB)(醫師門診)(EECP)(運動區)(營養點滴)(健檢)(其他)(＋)
月曆別稱 [    ]   LINE 別稱 [    ]        ← 要選器材的那一門（復能）不畫
Abovee 上的寫法 [          ]
壓哪幾個系統   □Abovee □Examine □耀聖
排班時要指派   (診間)(物理治療師)(醫師)(都不用)
    選「診間」才出現：可用的診間類型／只能排在這幾間／常用診間
    選「醫師」才出現：哪一科（哪一科都可以／指定一科）
簽療程單 ◉    補紀錄 ○    不算次數 ○
▸ 其他設定     60 分・買的時候選 30／60・要選器材      ← 收著，但看得到現在的值
    時長｜買的時候可選｜約的時候可選（三格並排）
    要選器材、要選點滴品項、頻率限制、做完之後還要再約一次
```

### 一排一排講

1. **分類的「＋」**：分類那一排最後一顆 `＋`，按了在原地露出一格輸入框（不重畫整張表，ADR-0038）。做法照 `buy.js` 的 `TIER_OTHER`：
   那一顆不是一個分類，是一顆展開輸入框的鈕。`parse()`：她打了字就用那個字；**按了 `＋` 但沒打字就退回原本那一組**
   （不可以把那一顆的內部值存進 `group`）。原本獨立那一格「新的分類」拿掉
2. **兩個別稱並排**：月曆別稱（`shortName`）、LINE 別稱（`lineName`）。LINE 那一格現在只在「設定 → 名稱怎麼寫」改得到（`naming.js`），
   這裡多一個入口，**寫的是同一格**。
   **要選器材的那一門（`requiresEquipment`，也就是復能）兩格都不畫**：它在月曆上印的是那天用的那一台（器材的別稱），LINE 上講的是課程全名（ADR-0077、0078）。
   那裡放一句「月曆寫法跟著器材，在底下那幾台改」。**沒畫出來的那一格 `parse()` 不可以回 `null`** ——
   回了就是她一按儲存把以前設過的清掉（`CLAUDE.md`：「沒畫出來的那一段整個回原本那個」）。現在的 `parse()` 靠「不帶 `lineName` 這個鍵」保住它，照這個做
3. **Abovee 上的寫法**：那一格不動；預設值是種子與資料健檢的事（03、04、05）
4. **指派四選一**：一排丸子 診間／物理治療師／醫師／都不用。資料上照舊是兩格（`assigns`、`doctorPick`），對照只寫在 `masterData.js`：

   | 丸子 | `assigns` | `doctorPick` |
   |---|---|---|
   | 診間 | `room` | `none` |
   | 物理治療師 | `therapist` | `none` |
   | 醫師 | `none` | 底下那一排選的（預設「哪一科都可以」） |
   | 都不用 | `none` | `none` |

   讀回來：`assigns` 是 `room`／`therapist` 就是那一顆；否則 `doctorRuleOf()` 不是 `none` 就是醫師；否則都不用。
   **既有資料上兩個都有的那一門**（`assigns` 不是 `none` 而且要醫師 —— 她說目前沒有，但資料上存得下去）：亮著 `assigns` 那一顆，旁邊講一句
   「這門課之前另外設了要選醫師」，**她沒動這一排就照舊存回去**；她按了任何一顆才照上面那張表改。

   **這是一個決定，補 ADR-0130**（審查查到的）：ADR-0026 與 ADR-0058 寫明一門課、一段來訪可以同時要診間與醫師 —— 資料上那兩格照舊、
   既有兩個都有的課不動、排班那一側（`assignsFor()`、`doctorChoicesFor()`）一個字都不改；**變的只有設定頁從此設不出「診間＋醫師」**（她問題 2：「目前沒有」）。
   ADR 寫清楚哪天真的有這種課要怎麼開回來（那一排改成可以複選，或醫師另外一個開關）。舊的兩支不改。

   清單上那一行摘要（`summary()`）現在印 `ASSIGN_LABELS[r.assigns]` —— 醫師的課會寫「都不用」，跟表單亮著的「醫師」對不上。**摘要走同一支四選一的推導**
5. **條件顯示**：選「診間」才露出可用的診間類型、只能排在這幾間、常用診間；選「醫師」才露出哪一科。**換 `hidden`，不重畫**
   （她打到一半的字、輸入法的組字狀態不可以掉）。常用診間那一排的「就地換候選」（`data-preferred`、`wanted` 那個 Set）照舊。
   `parse()` 本來就在不是 `room` 時把三格診間清成空的 —— 那是既有行為，不動
6. **三個開關排成一列**：簽療程單、補紀錄、不算次數
7. **「其他設定」收著**：用既有的 `.foldout`（`<details>`，`app.css`）。收著的時候 summary 那一行**印出現在的值**
   （時長一定印；買的時候可選、約的時候可選、要選器材、要選品項、頻率限制、再約一次 有設才印）——
   收起來是縮成一行，不是藏起來（同 `slotNote.js` 那一條「有字的一定看得到」）。
   裡面：三種時長並排（窄螢幕直排）、要選器材、要選點滴品項、頻率限制、做完之後還要再約一次
8. **「設定暫定」**（03 的 `provisional`）：最上面一條＋一個開關「這些設定我確認過了」。關掉就是把 `provisional` 存成 `false`
9. **壓哪幾個系統**：三個都不勾存得下去（02）；`?` 的字跟著改

### 一定要擋的坑：收起來的欄位有錯時「儲存」沒反應

時長是 `type="number" min="1"`。它在一個**關著的 `<details>`** 裡而且不合法時，瀏覽器會擋 submit 而且**不顯示任何訊息**
（它想把焦點移到那一格、那一格不可聚焦）。症狀是「按了儲存什麼都沒發生」。

- 在表單上聽 `invalid`（**要用 capture**，那個事件不冒泡）：把那一格所在的 `<details>` 打開
- domain 驗證（`showErrors()`）報的錯講到裡面的欄位時也打開
- E2E：把時長清空 → 收起來 → 按儲存 → 「其他設定」是開的、看得到哪一格有錯

## 判準

- 舊課程打開、什麼都不改就存一次：存回去的每一格都跟原本一樣？（寫一支測試拿種子每一門課 `fields()` → 讀表單 → `parse()` 比一次；
  或至少對 `assigns`／`doctorPick`／`lineName`／`group`／三種時長做）
- 復能：兩格別稱不出現；存檔之後 `shortName`、`lineName` 一個字都沒變
- 選「醫師」→ 換成「診間」→ 存：`doctorPick` 是 `none`、`requiresDoctor` 是 `false`；反過來三格診間限制是空的
- 一門 `assigns: 'room'` 又要醫師的舊資料：打開、改名字、存 → 兩格都還在
- 按 `＋` 打「醫美」存：清單多一組「醫美」；按 `＋` 不打字就存：分類沒變
- 「其他設定」收著時那一行看得到時長；裡面有錯時存檔會自己展開
- 手機寬度與 iPad 橫式各截一張自己看過（她：「請精心設計UIUX」）；兩顆並排的小按鈕中間留夠（`CLAUDE.md`「一顆小圖示按鈕的觸控區」）
- 掃原始碼的那幾支照舊綠：`tests/number-fields.test.js`（`min`／`step`）、`tests/tip-red-lines.test.js`、`tests/fewer-words.test.js`（常駐說明只准變少）

## 連動

- E2E 裡操作這張表的每一支（`git grep -n "assigns\|groupNew\|doctorPick\|durationChoices\|bookingMinutes" tests-e2e/`）：
  `47-course-groups`、`48-doctor-specialties`、`49-uncounted-course`、`50-booking-minutes`、`17-settings-fields` 至少這五支。
  指派以前是 `<select name="assigns">`，現在是丸子；時長那幾格在收著的那一段裡，要先展開
- `tests-e2e/related.js`：`masterList.js` 對到哪幾支
- 新 ADR `docs/adr/0130-the-course-form-picks-one-of-four.md`
- 分類那一排的 `?`（現在寫「只管這一頁怎麼分組」）：07、08 之後不成立，改成「也決定加購與排班那一排怎麼分組；不會動到待辦、次數」
- `config.update()` 是只寫 `changes` 的 merge（審查查過 `repo.update`）—— 「`parse()` 不帶 `lineName` 這個鍵就保得住」成立；`parse(values, record)` 拿得到原本那一筆
- `naming.js` 那一頁不動（同一格兩個入口）；它的說明寫著「LINE 名只在這一頁改」的話要改
- `public/css/app.css`（新的 class）、`public/sw.js` 的 VERSION
- `docs/操作手冊.md` 設定 → 課程那一段、`docs/常見問題.md`（「時長那一格去哪了」）

## 做完時留下的（2026-10-06）

- **對照只在 `masterData.js`**：`ASSIGN_KINDS`／`ASSIGN_KIND_LABELS`、`assignKindOf()`、`assignFieldsFor(kind, doctorPick, { keepDoctor })`、
  `keepsDoctorBeside()`、`assignSummaryOf()`（清單那一行；醫師的課印「選醫師（復健科）」、兩個都有印「選診間＋醫師」）。
  `tests/course-form.test.js` 拿**種子每一門課**跑「讀回來 → 存下去」，兩格的意思一模一樣
- 選了「醫師」、哪一科那一排卻還是 `none`（從都不用切過來）：`assignFieldsFor()` 存成 `any`，畫面上 `wireForm` 也把「哪一科都可以」按好 ——
  畫面講的跟存的一樣。哪一科那一排**拿掉了「不用」那一顆**（不要醫師就是指派那一排按別顆）
- **兩個都有的舊資料**：隱藏的 `assignTouched` 記她按過指派那一排沒有（連原本亮著的那一顆也算）。沒按 → 醫師照舊存回去
- **分類的「＋」**：`f.chips()` 多一種選項 `add`（虛線框、`aria-label`）。值是 `__new__`（`GROUP_NEW`）；`groupWas` 是打開時那一組，
  按了「＋」沒打字就退回它。分類那一排改成**不是 quiet**（要 change 事件去開關輸入框），沒有別的東西因此重畫
- **別稱**：`parse()` 用「表單上有沒有這個鍵」決定帶不帶 `shortName`／`lineName`（`'shortName' in v`）。復能畫的是一格唯讀「跟著那天用的器材」
- **其他設定**：`<details class="foldout" data-more>`；summary 裡 `[data-more-now]` 收著時印值、展開時 `visibility: hidden`，
  她改裡面的值時就地更新（`moreSummary()`）。**兩條自己打開的路**：表單上 capture 的 `invalid`（瀏覽器擋的，例：時長填 0）、
  `paintForm` 多一個 `ed.onErrors` 鉤子（domain 擋的：錯誤訊息講到 時長／器材／品項／頻率／後續課程 的字，`MORE_WORDS`）
- **設定暫定**：最上面 `[data-provbar]`＋`provisionalDone`。勾了才寫 `provisional: false`，沒那一條的課一個字都不碰
- `f.checkboxes()`／`f.toggle()` 多一個 `inline`（`.choices--inline`，放得下就並排）：系統三個勾、三個開關、診間那三排、器材／品項兩個開關
- 分類那一排的 `?` 這一支只寫「這一頁照它分組」—— 加購（07）與「做什麼」（08）做完各自補上
- E2E：新的一支 `54-course-form`（C1 種子每一門什麼都不改就存、C2 四選一與條件顯示、C3 兩個都有、C4「＋」、C5 別稱、C6 其他設定與自己打開、C7 設定暫定）；
  `17`（S1、S2 先打開其他設定；S1 的固定等待換成 `app.saved()`，`PENDING` 11 → 10）、`47`（G3 指派那一排、G4 按「＋」、G5 LINE 別稱畫出來了）、
  `48`（D2：復能亮物理治療師、門診關掉醫師改按「都不用」）、`50`（M1 先打開其他設定）。五支一起跑 43 條全過
- 手機（375）與 iPad（1024）各截了一張自己看過：手機上三個開關排成 2＋1（字是四個字的話一列放不下三個）；分類那一排的「＋」在手機上要往右滑才看得到（那一排本來就是橫捲）
- ADR-0130；`SPEC.md` 第 8.8 節（那張表的「排班時要指派」一列＋版面一段）；`docs/操作手冊.md` 七之五（版面、「＋」、兩個別稱、四選一、設定暫定）與三處改了名字的欄位；
  `docs/常見問題.md` 新一條「時長那一格去哪了」＋三處欄位名；`CLAUDE.md` 連動表「一門課要不要醫師、哪一科」那一列；`sw.js` v168

