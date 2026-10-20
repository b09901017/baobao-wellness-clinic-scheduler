# ADR 索引：哪一支現在還算數

舊的 ADR 一個字都不改，連「狀態：」那一行也不加註記（`docs/agents/domain.md`「推翻一支舊 ADR 時」）——
所以**從舊的那一支看不出它被推翻了**。這一頁補的就是這一塊：讀任何一支之前，先看它在下面是不是「部分被推翻」或「被取代」；
是的話，那一點算數的是箭頭指的那一支。

- 這一頁只照各支 ADR 自己寫明的「推翻：」整理（2026-10-20 逐支讀過）。ADR 之間沒有寫明、但其實互相衝突的，以 `CLAUDE.md` 的連動表與現在的程式為準。
- **新增一支會推翻舊 ADR 的 ADR**：同一個 commit 改這一頁 —— 「被推翻的」那張表加一列、「全部」那張表舊的那一列改「現在」那一格。
  `tests/adr-index.test.js` 盯著：ADR 開頭寫了「推翻：ADR-NNNN」，這一頁 NNNN 那一列就要提到新的那一支；每一支 ADR 都要在「全部」裡。

## 被推翻的（一部分或整支）

| 舊的 | 不算數的是哪一點 | 現在照 |
|---|---|---|
| [0002](./0002-app-records-decisions-it-does-not-make-them.md) app 是記錄者，不是判斷者 | 例外條款（醫療禁忌硬性阻擋）—— 禁忌改成只提醒 | [0074](./0074-a-contraindication-warns-it-does-not-block.md) |
| [0008](./0008-startup-health-scan-runs-once-a-day.md) 啟動時的資料健檢每天最多跑一次 | 整支：待辦中心不再跑背景的資料健檢 | [0049](./0049-the-todo-centre-does-not-run-the-health-scan.md) |
| [0025](./0025-what-happened-is-recorded-per-slot.md) 預約的狀態記在來訪上，那天實際發生了什麼記在時段上 | 後半（「前三個逐段不會不一樣」）—— 整條生命週期記在時段上 | [0081](./0081-the-slot-carries-the-lifecycle.md) |
| [0030](./0030-future-candidates-are-ticked-by-default.md) 還沒發生的候選預設勾起來，已經發生的預設不勾 | 用在拍 Abovee 過去那幾列的做法（日子過了的不預設勾） | [0149](./0149-the-abovee-photo-status-is-what-gets-recorded.md) |
| [0033](./0033-a-sent-link-is-a-third-state-of-asking.md) 「連結已發出、還沒填」是問時間的第三種狀態，但不改變那一列的定義 | 一半：待辦中心一列的說明搬到她真的要操作的那一頁 | [0072](./0072-a-row-on-the-todo-centre-is-only-a-title.md) |
| [0041](./0041-the-sheet-is-the-registration.md) 壓表本身就是登記，所以 Abovee 不是待辦 | 「同一種取消任務只長一張」—— 改成逐段長 | [0091](./0091-a-cancel-task-knows-which-slots.md) |
| [0042](./0042-the-report-comes-before-the-follow-up.md) 二返前面還有一站：報告還沒拿到 | 「追蹤健檢報告只在還欠二返時產生」 | [0139](./0139-the-report-task-does-not-wait-on-the-follow-up.md) |
| [0050](./0050-the-health-check-can-rename-an-imported-note.md) 資料健檢也改得掉匯入寫錯的那個字 | 整支的核心：病歷號不再是一則備註，是客戶身上的一格 | [0160](./0160-chart-number-is-a-field.md) |
| [0056](./0056-only-the-calendar-can-change-a-visit.md) 只有日曆改得了一筆來訪 | 多一條窄路：拍 Abovee 改治療師／診間 | [0123](./0123-abovee-confirm-picks-like-the-board.md) |
| [0056](./0056-only-the-calendar-can-change-a-visit.md) 只有日曆改得了一筆來訪 | 多一條窄路：照片上的狀態與時間 | [0149](./0149-the-abovee-photo-status-is-what-gets-recorded.md) |
| [0063](./0063-an-nth-followup-is-a-visit-without-an-entitlement.md) n返 是一場沒有額度的來訪 | 那張表「sheetReport 的矩陣」那一列 —— n返 在矩陣裡自己一列 | [0131](./0131-an-nth-followup-gets-its-own-row-on-the-sheet.md) |
| [0064](./0064-a-clinical-alert-is-a-permanent-limit-that-blocks-nothing.md) 臨床提醒是一種什麼都不擋的永久限制 | 整支被取代 | [0074](./0074-a-contraindication-warns-it-does-not-block.md) |
| [0068](./0068-growing-a-task-and-keeping-it-are-two-rules.md) 待辦「長不長得出來」跟「還算不算數」是兩條規則 | 那張表「追蹤健檢報告：長出來要 owed > 0」那一格 | [0139](./0139-the-report-task-does-not-wait-on-the-follow-up.md) |
| [0072](./0072-a-row-on-the-todo-centre-is-only-a-title.md) 待辦中心的一列只有標題，說明搬到她真的要操作的那一頁 | 前提「一句都不會真的消失」的一部分 —— 跟標題講同一件事的說明直接不畫 | [0114](./0114-say-nothing-the-title-already-says.md) |
| [0078](./0078-there-are-only-three-names.md) 全站只有三種名字，「一般」那一種不存在 | 一部分：「買了什麼」那一行是第四種名字（簡寫） | [0090](./0090-what-they-bought-is-one-computed-line.md) |
| [0079](./0079-the-equipment-decides-who-and-the-rooms-have-no-four.md) 指派由器材決定，而空間清單一間 4 號都沒有 | 診間清單裡的治7 回來了 | [0124](./0124-treatment-room-7-is-back.md) |
| [0088](./0088-the-day-lives-on-the-read-card.md) 整天的那幾顆離開來訪編輯器，搬到讀取卡片上 | 整支被取代：「改這一天」連同整天的狀態卡與危險區收掉 | [0089](./0089-the-day-is-only-a-heading.md) |
| [0093](./0093-an-imported-visit-grows-no-tasks.md) 已經發生的那一筆匯進來，一張任務都不長 | 有取消掉的段時，取消類的待辦一出生就勾好（其餘照舊） | [0164](./0164-imported-cancelled-slots-settle-their-cancel-task.md) |
| [0094](./0094-a-room-holds-how-many.md) 一間診間裝得下幾個人 | 拿點滴8 當「一間裝得下兩位」的那個例子 | [0127](./0127-bed-rooms-are-rooms.md) |
| [0097](./0097-confirming-is-per-slot-too.md) 確認也是逐段的 | 「一次確認整天」與「visitsToClose() 不改」兩句 | [0110](./0110-both-todo-drawers-decide-some-slots.md) |
| [0097](./0097-confirming-is-per-slot-too.md) 確認也是逐段的 | issue 14「整筆也要准」的那一層交集 | [0111](./0111-a-no-show-only-goes-back-to-closing.md) |
| [0104](./0104-many-slots-from-one-photo.md) 照片一次記很多段 —— 確認層就是第一道、存檔前只問一次、直接標成壓完 | 第 2、3、4（壓完）、6 點 —— 拍 Abovee 照片上的狀態為準 | [0149](./0149-the-abovee-photo-status-is-what-gets-recorded.md) |
| [0108](./0108-changing-a-slots-time-rebooks-it.md) 改一段的時間或課程＝取消那一段、重新排一段 | 拍 Abovee 改期時，新的那一段照照片的狀態（不是待確認） | [0149](./0149-the-abovee-photo-status-is-what-gets-recorded.md) |
| [0112](./0112-records-and-the-checkup-chain-read-the-slot.md) 寫紀錄與健檢那條鏈問那一段 | 「後果」最後一行（「這是哪一次健檢」只剩已完成的） | [0145](./0145-a-follow-up-can-link-to-an-exam-not-yet-done.md) |
| [0116](./0116-abovee-status-is-a-cross-check.md) 拍 Abovee 拿預約狀態跟 app 對一次，只講不改 | 「只講不改」的治療師／診間 | [0123](./0123-abovee-confirm-picks-like-the-board.md) |
| [0116](./0116-abovee-status-is-a-cross-check.md) 拍 Abovee 拿預約狀態跟 app 對一次，只講不改 | 那張表第三格（app 取消了、Abovee 還掛著 → 新的一段） | [0144](./0144-a-slot-cancelled-in-the-app-and-still-on-abovee-is-a-new-row.md) |
| [0116](./0116-abovee-status-is-a-cross-check.md) 拍 Abovee 拿預約狀態跟 app 對一次，只講不改 | 「只講不改」的狀態那一部分 | [0149](./0149-the-abovee-photo-status-is-what-gets-recorded.md) |
| [0118](./0118-staging-holds-a-rehearsal-of-real-data.md) staging 放真資料的預演，切換那天不搬 | 預演做完了（2026-10-20 切換）；staging 現在是切換那天正式站的複本 | [0165](./0165-after-cutover-production-is-the-only-copy.md) |
| [0119](./0119-a-course-ticks-its-own-systems.md) 課程自己勾壓哪幾個系統 | 「Abovee 與 Examine 至少勾一個」—— 可以都不勾 | [0126](./0126-a-course-can-be-booked-nowhere.md) |
| [0119](./0119-a-course-ticks-its-own-systems.md) 課程自己勾壓哪幾個系統 | 「改了勾法不追溯」—— 已經談定的回頭重算 | [0140](./0140-changing-a-course-recomputes-the-tasks-of-agreed-visits.md) |
| [0122](./0122-minutes-are-picked-at-booking.md) 約的時候選時長 | 「沒做的」第三條（EECP 的 20／60 是兩門課） | [0154](./0154-eecp-is-one-course.md) |
| [0123](./0123-abovee-confirm-picks-like-the-board.md) 拍 Abovee 的確認層跟壓表一樣選得了 | 第 10 段（改了時間不替她做）與第 11 段（治療師／診間她按了才改） | [0149](./0149-the-abovee-photo-status-is-what-gets-recorded.md) |
| [0124](./0124-treatment-room-7-is-back.md) 治7 回來了 | 「治6、休息室1 等她第一次用到再自己加」 | [0127](./0127-bed-rooms-are-rooms.md) |
| [0127](./0127-bed-rooms-are-rooms.md) 點滴8A／8B、VIP7A／7B 是四間各自的診間；點滴8、VIP7 是「沒選床位」 | 點滴8、VIP7 留著停用 —— 拿掉了 | [0155](./0155-bedless-rooms-go-and-the-merge-file-is-born-current.md) |
| [0139](./0139-the-report-task-does-not-wait-on-the-follow-up.md) 「追蹤健檢報告」長不長，不等二返約了沒 | 「還沒有答案的」那一段 —— 名額先給報告勾過的那一次 | [0142](./0142-the-booking-slot-goes-to-the-exam-whose-report-is-in.md) |
| [0139](./0139-the-report-task-does-not-wait-on-the-follow-up.md) 「追蹤健檢報告」長不長，不等二返約了沒 | 「名額」的上限 —— 健檢超用也追報告 | [0159](./0159-an-extra-exam-still-gets-its-report.md) |
| [0143](./0143-cutover-day-deletes-production-with-firebase-tools.md) 切換那天正式站連主檔一起刪掉，用 firebase-tools 一類一類刪 | 不是推翻：切換做完了，實際做法跟它寫的步驟不一樣（記在 0165 與 STAGING.md） | [0165](./0165-after-cutover-production-is-the-only-copy.md) |
| [0148](./0148-a-slot-can-be-a-trial-or-a-gift.md) 一段可以是體驗或送的 —— 存在段上，課程的那一格變成「預設體驗」 | 第一排順序的「EECP體驗」與「沒做的」第二條（扣法不一樣） | [0154](./0154-eecp-is-one-course.md) |
| [0152](./0152-today-counts-close-and-dated-notes.md) 今天／明天算進簽療程單與有日期的隨手記，逾期算進前幾天沒簽完的 | 決定 1 的「明天」那一格 —— 明天要來的也算 | [0162](./0162-tomorrow-counts-tomorrows-visits.md) |
| [0152](./0152-today-counts-close-and-dated-notes.md) 今天／明天算進簽療程單與有日期的隨手記，逾期算進前幾天沒簽完的 | 決定 4 的「『已完成』那一格照舊只有任務」—— 已完成照日子算，三種一起列 | [0166](./0166-bucket-done-is-counted-by-the-day.md) |
| [0156](./0156-long-notes-and-the-notes-order.md) 長備註是備註的長版本；備註那一段電話、LINE、長備註、短備註一起排順序 | 「LINE 點了開他的 LINE」—— 存名字、交給 MacroDroid | [0157](./0157-line-field-is-the-name-macrodroid-opens-the-chat.md) |
| [0156](./0156-long-notes-and-the-notes-order.md) 長備註是備註的長版本；備註那一段電話、LINE、長備註、短備註一起排順序 | 「客戶清單卡片只看短備註」 | [0160](./0160-chart-number-is-a-field.md) |
| [0156](./0156-long-notes-and-the-notes-order.md) 長備註是備註的長版本；備註那一段電話、LINE、長備註、短備註一起排順序 | 沒排過的預設順序 | [0163](./0163-notes-default-order-chart-number-first-phone-last.md) |
| [0160](./0160-chart-number-is-a-field.md) 病歷號是一格，照樣在備註那一段；客戶清單卡片照她的順序畫前四個 | 「病歷號接在 LINE 後面」—— 病歷號最前面 | [0163](./0163-notes-default-order-chart-number-first-phone-last.md) |

## 全部（166 支）

| ADR | 決定 | 日期 | 現在 |
|---|---|---|---|
| [0001](./0001-scheduling-queue-state-is-derived.md) | 待壓表與待收集時間是推導狀態，不存欄位 | 2026-08-17 | 現行 |
| [0002](./0002-app-records-decisions-it-does-not-make-them.md) | app 是記錄者，不是判斷者 | 2026-08-17 | 部分被推翻 → ADR-0074 |
| [0003](./0003-plan-templates-have-no-version.md) | 方案範本不做版本，改用複製 | 2026-08-17 | 現行 |
| [0004](./0004-counts-are-derived-in-detail-cached-in-lists.md) | 次數在詳情頁現算，在清單頁讀計數欄位 | 2026-08-18 | 現行 |
| [0005](./0005-pool-slots-get-their-course-from-requires-equipment.md) | 擇一池的時段課程，用「需要選器材」推導 | 2026-08-18 | 現行 |
| [0006](./0006-status-transitions-are-not-enforced-in-rules.md) | 狀態轉移的合法性留在前端，Rules 不擋 | 2026-08-18 | 現行 |
| [0007](./0007-health-check-reads-only.md) | 資料健檢只算不寫，一鍵修正只有計數欄位 | 2026-08-18 | 現行 |
| [0008](./0008-startup-health-scan-runs-once-a-day.md) | 啟動時的資料健檢每天最多跑一次 | 2026-08-18 | **被取代** → ADR-0049 |
| [0009](./0009-backfill-excludes-but-explains.md) | 時段反查可以把人排除，但要說得出理由 | 2026-08-18 | 現行 |
| [0010](./0010-sheet-sync-is-an-export-not-a-service.md) | 試算表同步做成匯出，不做 Apps Script 定時抓 Firestore | 2026-08-18 | 現行 |
| [0011](./0011-imported-visits-are-incomplete-on-purpose.md) | 匯入的來訪缺欄位是刻意的，不是漏填 | 2026-08-18 | 現行 |
| [0012](./0012-legacy-import-is-a-paste-not-an-integration.md) | 舊資料匯入吃貼上的文字，不接 Google Sheets API | 2026-08-18 | 現行 |
| [0013](./0013-sheet-sync-is-a-push-not-a-pull.md) | 試算表同步改成 app 主動推，Apps Script 只收不取 | 2026-08-18 | 現行 |
| [0014](./0014-scheduling-is-per-customer-not-per-course.md) | 壓表以客戶為單位，不以課程為單位 | 2026-08-19 | 現行 |
| [0015](./0015-calendar-is-a-first-class-surface.md) | 日曆是可以編輯的第一線畫面，來訪與個人行程並存 | 2026-08-19 | 現行 |
| [0016](./0016-web-fonts-with-a-system-fallback.md) | 字體改用網路字體，離線退回系統內建 | 2026-08-19 | 現行 |
| [0017](./0017-recording-happens-in-a-card-deck.md) | 壓表的記錄面板是疊上來的一組卡片，不是另一個畫面 | 2026-08-19 | 現行 |
| [0018](./0018-detail-pages-are-one-page-not-a-stack-of-cards.md) | 詳情頁是一頁，不是一疊卡片；少用的東西從底部滑出來 | 2026-08-19 | 現行 |
| [0019](./0019-customer-notes-become-coloured-marks.md) | 客戶的特殊狀況改成多筆彩色備註，會籍退出畫面 | 2026-08-19 | 現行 |
| [0020](./0020-the-calendar-never-changes-pages.md) | 日曆上的任何操作都不換頁，而且先給看的再給改的 | 2026-08-19 | 現行 |
| [0021](./0021-the-sheet-is-dragged-by-transform.md) | 底部面板只用 transform 拖，而且整張都拖得動 | 2026-08-19 | 現行 |
| [0022](./0022-followup-entitlements-are-expanded-in-pairs.md) | 二返額度跟著健檢額度成對展開，配對記在課程主檔上 | 2026-08-19 | 現行 |
| [0023](./0023-health-check-can-also-create-the-missing-followup.md) | 資料健檢的一鍵修正多一種：補上缺的二返額度 | 2026-08-19 | 現行 |
| [0024](./0024-the-sheet-mirrors-her-old-one.md) | 試算表照抄她舊表的樣子，而且是 app 在填，不是她 | 2026-08-20 | 現行 |
| [0025](./0025-what-happened-is-recorded-per-slot.md) | 預約的狀態記在來訪上，那天實際發生了什麼記在時段上 | 2026-08-20 | 部分被推翻 → ADR-0081 |
| [0026](./0026-doctors-are-assignable-staff.md) | 醫師進 `config/staff`，約二返時用選的 | 2026-08-20 | 現行 |
| [0027](./0027-registration-tasks-wait-for-the-customer.md) | 登記任務等客人確認之後才產生 | 2026-08-20 | 現行 |
| [0028](./0028-asking-for-times-is-a-todo-row-not-a-queue.md) | 「問這輪的時間」是待辦中心的一列，範圍照壓表那道濾網，但順序不照它的計分 | 2026-08-20 | 現行 |
| [0029](./0029-imported-visits-take-their-status-from-the-date.md) | 匯進來的來訪依匯入當下的日期決定狀態 | 2026-08-21 | 現行 |
| [0030](./0030-future-candidates-are-ticked-by-default.md) | 還沒發生的候選預設勾起來，已經發生的預設不勾 | 2026-08-21 | 部分被推翻 → ADR-0149 |
| [0031](./0031-the-customer-form-is-its-own-page.md) | 客戶填時間的那一頁是獨立入口，不是 app 的一條路由 | 2026-08-21 | 現行 |
| [0032](./0032-what-the-customer-fills-in-waits-in-an-inbox.md) | 客戶填的時間先進收件匣，不直接變成本輪可用性 | 2026-08-21 | 現行 |
| [0033](./0033-a-sent-link-is-a-third-state-of-asking.md) | 「連結已發出、還沒填」是問時間的第三種狀態，但不改變那一列的定義 | 2026-08-21 | 部分被推翻 → ADR-0072 |
| [0034](./0034-the-customer-page-does-one-thing-per-screen.md) | 客戶那一頁改成一頁一件事，「整個禮拜五」由日期推出來 | 2026-08-21 | 現行 |
| [0035](./0035-the-wall-shows-rules-not-the-raw-answer.md) | 壓表卡片上只放解析出來的條件，原文收進摺疊 | 2026-08-22 | 現行 |
| [0036](./0036-availability-is-picked-by-the-month-being-scheduled.md) | 本輪可用性照「壓哪個月」挑，不照「今天」挑 | 2026-09-01 | 現行 |
| [0037](./0037-the-wall-can-be-re-sorted-but-never-re-scored.md) | 卡片牆的排序可以換，但每一種都只是同一份名單的重排 | 2026-08-22 | 現行 |
| [0038](./0038-picking-an-option-does-not-repaint-the-page.md) | 在壓表面板上選一個東西，不重畫整頁 | 2026-08-22 | 現行 |
| [0039](./0039-six-things-on-the-calendar-need-six-colours.md) | 日曆上有六種東西要分辨，所以狀態色不再借用語意色 | 2026-08-23 | 現行 |
| [0040](./0040-a-personal-event-picks-its-own-colour.md) | 個人行程自己挑顏色，存的是名字不是色碼 | 2026-08-23 | 現行 |
| [0041](./0041-the-sheet-is-the-registration.md) | 壓表本身就是登記，所以 Abovee 不是待辦 | 2026-08-23 | 部分被推翻 → ADR-0091 |
| [0042](./0042-the-report-comes-before-the-follow-up.md) | 二返前面還有一站：報告還沒拿到 | 2026-08-23 | 部分被推翻 → ADR-0139 |
| [0043](./0043-the-todo-centre-follows-the-flow.md) | 待辦中心照流程分段，階段色就是來訪狀態色 | 2026-08-23 | 現行 |
| [0044](./0044-a-dated-note-goes-on-the-calendar.md) | 隨手記可以掛一個日期，掛了就上日曆 | 2026-08-23 | 現行 |
| [0045](./0045-the-calendar-has-four-kinds.md) | 日曆上是四類，而第四類用記號分辨 | 2026-08-23 | 現行 |
| [0046](./0046-the-wall-only-answers-who-is-next.md) | 卡片牆只回答「下一個是誰」 | 2026-08-23 | 現行 |
| [0047](./0047-there-is-one-way-in.md) | 舊資料只有一條路進得來 | 2026-08-23 | 現行 |
| [0048](./0048-a-layer-on-screen-is-a-step-back.md) | 畫面上多一層東西，就多一步返回鍵退得掉的路 | 2026-08-24 | 現行 |
| [0049](./0049-the-todo-centre-does-not-run-the-health-scan.md) | 待辦中心不再跑背景的資料健檢 | 2026-08-24 | 現行 |
| [0050](./0050-the-health-check-can-rename-an-imported-note.md) | 資料健檢也改得掉匯入寫錯的那個字 | 2026-08-24 | **被取代** → ADR-0160 |
| [0051](./0051-she-records-availability-on-a-calendar-too.md) | 她自己記的那一份也改用日曆，原文從輸入變成產出 | 2026-08-24 | 現行 |
| [0052](./0052-the-deck-is-one-layer.md) | 壓表的卡片組是一層，不是一位客戶一層 | 2026-08-25 | 現行 |
| [0053](./0053-one-collection-per-month.md) | 一份「不能的時間」就是一個月，而畫面要把那個月講出來 | 2026-08-25 | 現行 |
| [0054](./0054-a-checkup-tier-lives-on-the-entitlement.md) | 健檢的金額等級是額度上的一個欄位，不是三個課程 | 2026-08-25 | 現行 |
| [0055](./0055-she-can-switch-to-dark-herself.md) | 深色模式她自己切得動，不是只跟著裝置 | 2026-08-25 | 現行 |
| [0056](./0056-only-the-calendar-can-change-a-visit.md) | 只有日曆改得了一筆來訪 | 2026-08-25 | 部分被推翻 → ADR-0123、ADR-0149 |
| [0057](./0057-a-product-is-an-entitlement-that-cannot-be-scheduled.md) | 營養品也是一筆額度，只是排不進來訪 | 2026-08-25 | 現行 |
| [0058](./0058-outpatient-always-picks-a-doctor.md) | 門診一律選得到醫師，旗標降級成非門診的例外開關 | 2026-08-27 | 現行 |
| [0059](./0059-a-supplement-purchase-is-one-record-handed-over-once.md) | 一次營養品購買是一筆紀錄，交付走一筆有日期的隨手記 | 2026-08-27 | 現行 |
| [0060](./0060-a-row-answers-two-gestures.md) | 一列回答兩個手勢：點一下是看，長按是做 | 2026-09-01 | 現行 |
| [0061](./0061-a-cancelled-visit-is-drawn-but-dimmed.md) | 取消的來訪在日曆上畫出來，暗掉，但不算數 | 2026-09-01 | 現行 |
| [0062](./0062-today-is-a-plain-language-view-of-the-audit-log.md) | 「今天做了什麼」是稽核紀錄的白話版，不是第二份紀錄 | 2026-09-01 | 現行 |
| [0063](./0063-an-nth-followup-is-a-visit-without-an-entitlement.md) | n返 是一場沒有額度的來訪 | 2026-09-02 | 部分被推翻 → ADR-0131 |
| [0064](./0064-a-clinical-alert-is-a-permanent-limit-that-blocks-nothing.md) | 臨床提醒是一種什麼都不擋的永久限制 | 2026-09-03 | **被取代** → ADR-0074 |
| [0065](./0065-two-things-happen-when-the-report-arrives.md) | 報告到手的那一刻有兩件事要做 | 2026-09-03 | 現行 |
| [0066](./0066-a-record-is-a-task-that-is-born-after-the-visit.md) | 紀錄是來訪之後才長出來的任務 | 2026-09-03 | 現行 |
| [0067](./0067-a-playbook-is-read-not-ticked.md) | 備忘錄是拿來讀的，不是拿來勾的 | 2026-09-03 | 現行 |
| [0068](./0068-growing-a-task-and-keeping-it-are-two-rules.md) | 待辦「長不長得出來」跟「還算不算數」是兩條規則 | 2026-09-04 | 部分被推翻 → ADR-0139 |
| [0069](./0069-a-memo-is-one-box-of-text.md) | 備忘錄是一個大框框，一疊卡 | 2026-09-04 | 現行 |
| [0070](./0070-a-warning-may-only-say-what-really-happens.md) | 警示只能講真的會發生的事，多講跟少講一樣糟 | 2026-09-04 | 現行 |
| [0071](./0071-today-shows-what-she-did-not-what-was-written.md) | 「今天做了什麼」只留她做的事，系統跟著寫的那些收成一行 | 2026-09-04 | 現行 |
| [0072](./0072-a-row-on-the-todo-centre-is-only-a-title.md) | 待辦中心的一列只有標題，說明搬到她真的要操作的那一頁 | 2026-09-04 | 部分被推翻 → ADR-0114 |
| [0073](./0073-a-read-card-closes-when-its-one-action-happened.md) | 讀取卡片在它唯一的動作**真的發生**之後自己收掉 | 2026-09-05 | 現行 |
| [0074](./0074-a-contraindication-warns-it-does-not-block.md) | 醫療禁忌只提醒，不阻擋；永久限制只剩兩層 | 2026-09-06 | 現行 |
| [0075](./0075-the-equipment-decides-the-slots-course.md) | 擇一池的時段課程，由選到的那台器材決定 | 2026-09-06 | 現行 |
| [0076](./0076-a-memo-can-hang-on-a-partner.md) | 合作機構是客戶身上的第四種標記，而備忘錄掛得上它 | 2026-09-06 | 現行 |
| [0077](./0077-the-line-draft-never-names-the-machine.md) | 貼給客人的那一句不寫器材，她自己看的那一格只寫器材 | 2026-09-07 | 現行 |
| [0078](./0078-there-are-only-three-names.md) | 全站只有三種名字，「一般」那一種不存在 | 2026-09-08 | 部分被推翻 → ADR-0090 |
| [0079](./0079-the-equipment-decides-who-and-the-rooms-have-no-four.md) | 指派由器材決定，而空間清單一間 4 號都沒有 | 2026-09-08 | 部分被推翻 → ADR-0124 |
| [0080](./0080-a-read-card-draws-the-slot-she-tapped.md) | 點一段，讀取卡片就只畫那一段 | 2026-09-08 | 現行 |
| [0081](./0081-the-slot-carries-the-lifecycle.md) | 整條生命週期記在時段上，來訪是那一天的容器 | 2026-09-08 | 現行 |
| [0082](./0082-bulk-cancel-is-its-own-door.md) | 批次取消自己一個入口，而它只取消不給改 | 2026-09-08 | 現行 |
| [0083](./0083-a-day-is-one-visit.md) | 一位客戶一天只有一筆來訪，而那一筆就是「那一天」 | 2026-09-09 | 現行 |
| [0084](./0084-the-note-belongs-to-the-slot.md) | 「記一句」記在時段上，收在一顆夾板後面 | 2026-09-09 | 現行 |
| [0085](./0085-editing-a-visit-means-editing-that-slot.md) | 改一筆來訪，就是改她點的那一段 | 2026-09-09 | 現行 |
| [0086](./0086-two-confirms-before-saving.md) | 存檔前是兩道，而第一道只在有話要講時出現 | 2026-09-09 | 現行 |
| [0087](./0087-the-screen-says-slot-or-day-never-record.md) | 畫面上只有「這一段」與「這一天」，「筆」不上畫面 | 2026-09-10 | 現行 |
| [0088](./0088-the-day-lives-on-the-read-card.md) | 整天的那幾顆離開來訪編輯器，搬到讀取卡片上 | 2026-09-10 | **被取代** → ADR-0089 |
| [0089](./0089-the-day-is-only-a-heading.md) | 一天只是一個抬頭，動得了的只有一段 | 2026-09-12 | 現行 |
| [0090](./0090-what-they-bought-is-one-computed-line.md) | 「買了什麼」是算出來的一行，而且用簡寫 | 2026-09-13 | 現行 |
| [0091](./0091-a-cancel-task-knows-which-slots.md) | 取消類的待辦逐段長，不逐天 | 2026-09-13 | 現行 |
| [0092](./0092-imports-carry-flags-and-partners.md) | 舊資料匯入時，照舊表的字帶上警示與合作機構 | 2026-09-15 | 現行 |
| [0093](./0093-an-imported-visit-grows-no-tasks.md) | 已經發生的那一筆匯進來，一張任務都不長 | 2026-09-16 | 部分被推翻 → ADR-0164 |
| [0094](./0094-a-room-holds-how-many.md) | 一間診間裝得下幾個人 | 2026-09-16 | 部分被推翻 → ADR-0127 |
| [0095](./0095-imported-entitlements-take-the-apps-names.md) | 匯進來的額度用 app 的寫法，算不出來的保留她原本的字 | 2026-09-16 | 現行 |
| [0096](./0096-a-slot-note-reaches-the-spreadsheet.md) | 那一段的記一句會上試算表 | 2026-09-16 | 現行 |
| [0097](./0097-confirming-is-per-slot-too.md) | 確認也是逐段的 | 2026-09-16 | 部分被推翻 → ADR-0110、ADR-0111 |
| [0098](./0098-an-iv-product-carries-its-own-duration.md) | 一款營養點滴品項自己帶時長，而且它排在額度前面 | 2026-09-16 | 現行 |
| [0099](./0099-ai-only-copies-the-words.md) | AI 只抄字，不翻譯 | 2026-09-17 | 現行 |
| [0100](./0100-the-first-server-code-and-its-five-locks.md) | 第一支伺服器程式 —— 一支 Cloud Function、五道防護、自己數的上限 | 2026-09-17 | 現行 |
| [0101](./0101-photos-and-privacy.md) | 照片與隱私 —— 哪些送出去、哪些留下來、什麼時候真的刪 | 2026-09-17 | 現行 |
| [0102](./0102-new-customer-warnings-become-a-triangle.md) | 新增客戶那一頁的提醒收成 ⚠，存檔前再講一次 | 2026-09-17 | 現行 |
| [0103](./0103-chart-number-helps-identify.md) | 認人時名字與病歷號一起比，對不上就不挑 | 2026-09-17 | 現行 |
| [0104](./0104-many-slots-from-one-photo.md) | 照片一次記很多段 —— 確認層就是第一道、存檔前只問一次、直接標成壓完 | 2026-09-17 | 部分被推翻 → ADR-0149 |
| [0105](./0105-treatment-sheets-kept-and-matched.md) | 療程單怎麼留、怎麼比 —— 同一張由規則認、拿不準就是新的一張、舊照片最後才刪、只比到最後一次簽名 | 2026-09-17 | 現行 |
| [0106](./0106-a-deleted-task-counts-only-if-it-was-ticked.md) | 被刪掉的任務，勾過的才算做過 | 2026-09-23 | 現行 |
| [0107](./0107-a-registration-task-knows-which-slots.md) | 掛號的待辦也逐段長 | 2026-09-23 | 現行 |
| [0108](./0108-changing-a-slots-time-rebooks-it.md) | 改一段的時間或課程＝取消那一段、重新排一段 | 2026-09-23 | 部分被推翻 → ADR-0149 |
| [0109](./0109-a-customer-with-live-visits-cannot-be-deleted.md) | 還掛著來訪、待辦或隨手記的客戶刪不掉 | 2026-09-23 | 現行 |
| [0110](./0110-both-todo-drawers-decide-some-slots.md) | 待辦中心的兩張抽屜都可以先決定幾段 | 2026-09-24 | 現行 |
| [0111](./0111-a-no-show-only-goes-back-to-closing.md) | 未到只能退回簽療程單 | 2026-09-24 | 現行 |
| [0112](./0112-records-and-the-checkup-chain-read-the-slot.md) | 寫紀錄與健檢那條鏈問那一段 | 2026-09-24 | 部分被推翻 → ADR-0145 |
| [0113](./0113-registration-closes-when-the-day-has-passed.md) | 日子過了才談定的段不長掛號待辦 | 2026-09-24 | 現行 |
| [0114](./0114-say-nothing-the-title-already-says.md) | 跟標題講同一件事的說明直接不畫，連 `?` 都不要 | 2026-09-24 | 現行 |
| [0115](./0115-the-sheet-shows-what-was-bought.md) | 試算表也印「買過什麼」 | 2026-09-24 | 現行 |
| [0116](./0116-abovee-status-is-a-cross-check.md) | 拍 Abovee 拿預約狀態跟 app 對一次，只講不改 | 2026-09-24 | 部分被推翻 → ADR-0123、ADR-0144、ADR-0149 |
| [0117](./0117-merge-picks-follow-her-decisions.md) | 合併檔的候選，她在決定頁決定過的照她的勾 | 2026-09-28 | 現行 |
| [0118](./0118-staging-holds-a-rehearsal-of-real-data.md) | staging 放真資料的預演，切換那天不搬 | 2026-10-05 | 部分被推翻 → ADR-0165 |
| [0119](./0119-a-course-ticks-its-own-systems.md) | 課程自己勾壓哪幾個系統 | 2026-10-05 | 部分被推翻 → ADR-0126、ADR-0140 |
| [0120](./0120-doctors-have-specialties.md) | 醫師有科別，課程指定哪一科 —— 排前面，不是限制 | 2026-10-05 | 現行 |
| [0121](./0121-a-course-can-be-uncounted.md) | 一段可以不扣任何額度 —— 課程上的「不算次數」 | 2026-10-05 | 現行 |
| [0122](./0122-minutes-are-picked-at-booking.md) | 約的時候選時長 | 2026-10-05 | 部分被推翻 → ADR-0154 |
| [0123](./0123-abovee-confirm-picks-like-the-board.md) | 拍 Abovee 的確認層跟壓表一樣選得了 | 2026-10-05 | 部分被推翻 → ADR-0149 |
| [0124](./0124-treatment-room-7-is-back.md) | 治7 回來了 | 2026-10-05 | 部分被推翻 → ADR-0127 |
| [0125](./0125-the-health-check-does-not-build-a-twin.md) | 她已經有一筆同名的，資料健檢就不再建一筆 | 2026-10-05 | 現行 |
| [0126](./0126-a-course-can-be-booked-nowhere.md) | 一門課可以哪個系統都不用壓 | 2026-10-06 | 現行 |
| [0127](./0127-bed-rooms-are-rooms.md) | 點滴8A／8B、VIP7A／7B 是四間各自的診間；點滴8、VIP7 是「沒選床位」 | 2026-10-06 | 部分被推翻 → ADR-0155 |
| [0128](./0128-a-matching-chart-number-forgives-one-character.md) | 病歷號對上、名字只差一個字，算認得 | 2026-10-06 | 現行 |
| [0129](./0129-abovee-photo-checks-what-is-missing.md) | 拍 Abovee 也講「app 有、這次照片上沒有」 | 2026-10-06 | 現行 |
| [0130](./0130-the-course-form-picks-one-of-four.md) | 設定頁的「排班時要指派」是四選一（資料上兩格照舊） | 2026-10-06 | 現行 |
| [0131](./0131-an-nth-followup-gets-its-own-row-on-the-sheet.md) | 三返、四返在試算表的矩陣裡各自一列 | 2026-10-07 | 現行 |
| [0132](./0132-the-sheet-reads-every-past-visit.md) | 試算表讀全部過去的來訪 | 2026-10-07 | 現行 |
| [0133](./0133-one-customer-in-two-slots-at-once-is-a-warning.md) | 同一位客戶的兩段撞時間：提醒，不擋 | 2026-10-07 | 現行 |
| [0134](./0134-progress-counts-only-slots-that-still-count.md) | 進度追蹤與「這個月」只講還算數的段 | 2026-10-07 | 現行 |
| [0135](./0135-numbers-about-visits-count-slots.md) | 講來訪的數字數的是段，不是筆 | 2026-10-07 | 現行 |
| [0136](./0136-data-health-says-whether-and-what.md) | 資料健檢那一頁只回答「有沒有事、要做什麼」 | 2026-10-07 | 現行 |
| [0137](./0137-pools-in-use-come-first.md) | 「剩幾次」那幾行，有在用的排前面 | 2026-10-08 | 現行 |
| [0138](./0138-abovee-warnings-show-on-collapsed-rows.md) | 拍 Abovee —— 會改變寫入結果的提醒，收著的列與存檔前那一道都要看得到 | 2026-10-08 | 現行 |
| [0139](./0139-the-report-task-does-not-wait-on-the-follow-up.md) | 「追蹤健檢報告」長不長，不等二返約了沒 | 2026-10-08 | 部分被推翻 → ADR-0142、ADR-0159 |
| [0140](./0140-changing-a-course-recomputes-the-tasks-of-agreed-visits.md) | 改了課程「壓哪幾個系統／寫紀錄」，已經談定的來訪回頭重算待辦 | 2026-10-08 | 現行 |
| [0141](./0141-staff-show-full-names-with-a-short-name.md) | 人員的顯示名是全名、多一格簡寫；全名跟著合併檔進來 | 2026-10-09 | 現行 |
| [0142](./0142-the-booking-slot-goes-to-the-exam-whose-report-is-in.md) | 「約二返」的名額先給報告勾過的那一次 | 2026-10-09 | 現行 |
| [0143](./0143-cutover-day-deletes-production-with-firebase-tools.md) | 切換那天正式站連主檔一起刪掉，用 firebase-tools 一類一類刪 | 2026-10-09 | 做完了 → ADR-0165 |
| [0144](./0144-a-slot-cancelled-in-the-app-and-still-on-abovee-is-a-new-row.md) | app 上取消過、Abovee 上還掛著的那一格，拍 Abovee 時算新的一段（不預設打勾） | 2026-10-09 | 現行 |
| [0145](./0145-a-follow-up-can-link-to-an-exam-not-yet-done.md) | 二返可以先接上還沒做完的那一次健檢 | 2026-10-09 | 現行 |
| [0146](./0146-booking-another-exam-can-take-the-stranded-follow-up.md) | 另約一次健檢時，可以順便把那一場二返接過來（她按了才改） | 2026-10-12 | 現行 |
| [0147](./0147-the-installed-app-runs-fullscreen.md) | 裝到主畫面的那一顆是全螢幕的 | 2026-10-12 | 現行 |
| [0148](./0148-a-slot-can-be-a-trial-or-a-gift.md) | 一段可以是體驗或送的 —— 存在段上，課程的那一格變成「預設體驗」 | 2026-10-14 | 部分被推翻 → ADR-0154 |
| [0149](./0149-the-abovee-photo-status-is-what-gets-recorded.md) | 拍 Abovee 時，照片上的預約狀態就是要記的狀態 | 2026-10-15 | 現行 |
| [0150](./0150-health-check-has-reminders.md) | 資料健檢多一種「提醒」—— 知道就好、沒有要做的事 | 2026-10-18 | 現行 |
| [0151](./0151-she-picks-which-rows-the-todo-home-shows.md) | 待辦首頁畫哪幾列由她選 —— 一直顯示／有才顯示／不顯示 | 2026-10-18 | 現行 |
| [0152](./0152-today-counts-close-and-dated-notes.md) | 今天／明天算進簽療程單與有日期的隨手記，逾期算進前幾天沒簽完的 | 2026-10-18 | 部分被推翻 → ADR-0162、ADR-0166 |
| [0153](./0153-abovee-absent-checks-people-on-photo.md) | 「app 有、這次照片上沒有」對誰，看照片上有幾位 | 2026-10-18 | 現行 |
| [0154](./0154-eecp-is-one-course.md) | EECP 只有一門 —— 約的時候 20／60，20 就是體驗 | 2026-10-18 | 現行 |
| [0155](./0155-bedless-rooms-go-and-the-merge-file-is-born-current.md) | 沒寫哪一床的點滴8、VIP7 拿掉；合併檔一開始就是新的 | 2026-10-18 | 現行 |
| [0156](./0156-long-notes-and-the-notes-order.md) | 長備註是備註的長版本；備註那一段電話、LINE、長備註、短備註一起排順序 | 2026-10-19 | 部分被推翻 → ADR-0157、ADR-0160、ADR-0163 |
| [0157](./0157-line-field-is-the-name-macrodroid-opens-the-chat.md) | 客戶的 LINE 那一格存「LINE 上的名字」；打開對話交給手機上的 MacroDroid | 2026-10-19 | 現行 |
| [0158](./0158-incomplete-read-does-not-save.md) | 讀不完整時，會動到次數或健檢那一串待辦的存檔先不存 | 2026-10-19 | 現行 |
| [0159](./0159-an-extra-exam-still-gets-its-report.md) | 健檢做的比買的多，多出來那一次也追報告；補了二返額度之後那一串重算 | 2026-10-19 | 現行 |
| [0160](./0160-chart-number-is-a-field.md) | 病歷號是一格，照樣在備註那一段；客戶清單卡片照她的順序畫前四個 | 2026-10-19 | 部分被推翻 → ADR-0163 |
| [0161](./0161-sheet-remembers-fingerprints.md) | 試算表那一側記每一頁的指紋，沒變的那幾頁不重畫 | 2026-10-19 | 現行 |
| [0162](./0162-tomorrow-counts-tomorrows-visits.md) | 「明天」也算明天還開著的那幾天（點下去開讀取卡片，不開簽單抽屜） | 2026-10-19 | 現行 |
| [0163](./0163-notes-default-order-chart-number-first-phone-last.md) | 備註沒排過的預設順序 —— 病歷號最前面、電話最後面 | 2026-10-20 | 現行 |
| [0164](./0164-imported-cancelled-slots-settle-their-cancel-task.md) | 匯進來的取消段，「取消 X」一出生就勾好 | 2026-10-20 | 現行 |
| [0165](./0165-after-cutover-production-is-the-only-copy.md) | 切換之後，正式站是唯一的一份 —— 不再整份重匯 | 2026-10-20 | 現行 |
| [0166](./0166-bucket-done-is-counted-by-the-day.md) | 逾期／今天／明天的「已完成」照日子算，任務、簽療程單、隨手記一起列 | 2026-10-21 | 現行 |
