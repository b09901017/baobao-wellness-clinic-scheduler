// 「這次改動要跑哪幾支 E2E」——唯一的一份對照表。
//
// 全跑一次 25 分鐘（headed）／12 分鐘（無頭），一天改五次就是一整個下午。
// 所以日常只跑相關的那幾支，全量交給 CI。
//
// **這份表是第二個要記得同步的地方，所以它爛掉的方式必須是大聲的。**
// 兩道守衛在 `tests/e2e-related.test.js`：
//   1. `specs/` 底下每一支都要在這裡出現（新增一支忘了登記 → 紅）
//   2. 每一條路徑都要真的存在（檔案搬走或改名 → 紅）
// 第三道在 `pick()` 自己身上：**認不出來的原始碼一律退回全跑**，
// 並且把「因為哪個檔案」印出來。少列一條的代價是多跑幾支，
// 不是「那一支沒跑到而且看不出來」。
//
// 對照表刻意寬鬆：寧可多跑兩支。一條 path 是前綴比對，
// 所以 `public/js/ui/views/` 這種目錄也寫得下。

/** 地基。永遠跑 —— 它紅了底下全部都不用看。 */
export const CORE = ['00-smoke'];

/**
 * 改到這些就沒得挑了：fixture、殼、路由、資料層的共用底座。
 * 它們沒有「相關的那幾支」，每一支都相關。
 */
export const GLOBAL = [
  'tests-e2e/fixtures/',
  'playwright.config.js',
  'public/index.html',
  'public/js/app.js',
  'public/js/ui/shell.js',
  'public/js/ui/router.js',
  'public/js/ui/views.js',
  'public/js/ui/session.js',
  // 導覽列的圖示就是它畫的 —— 它壞了每一頁的殼都壞
  'public/js/ui/icons.js',
  'public/js/data/repo.js',
  'public/js/data/firebase.js',
  'public/js/data/auth.js',
  'public/js/firebase-config.js',
  // 只改一行 script 也會害你全跑一次，但反過來更糟：升一版 firebase SDK
  // 而只跑三支，那三支綠的什麼都不代表。
  'package.json',
  'package-lock.json',
];

/**
 * GLOBAL 裡面的例外：拍照辨識的假抄字（`fixtures/ai/`）。它們住在 fixtures 底下
 * （Function 的假模型照那個路徑讀），但只有拍照那幾支讀得到 —— 改一份假抄字
 * 就全跑二十幾分鐘，會讓人不想加新的假抄字。
 */
export const NOT_GLOBAL = ['tests-e2e/fixtures/ai/'];

/**
 * 不影響 E2E 的：文件、ADR、issue、單元測試自己。
 * （`firestore.rules` 例外處理，見 `pick()` —— 它要跑的是 `test:rules`。）
 */
export const IGNORED = [
  'docs/', '.scratch/', 'README.md', 'SPEC.md', 'CLAUDE.md', 'CONTEXT.md',
  'tests/', '.github/', '.claude/', 'graphify-out/', 'scripts/',
  // 模擬器的每一條指令都自己帶 `demo-` 專案（`tests/deploy-config.test.js` 盯著），
  // 所以預設專案與「哪些檔案不進版控」都摸不到 E2E
  '.firebaserc', '.gitignore',
];

/**
 * 一支 spec 摸得到哪些原始碼。
 * 判準：**這個檔案壞了，這一支會不會紅？** 會就列進去。
 *
 * **`domain/seed.js` 是例外，而且是刻意的**（2026-10-05）。每一支 spec 的主檔
 * 都是 `fixtures/data.js` 的 `masterDocs()` 從種子抄的，照判準它該列在每一支底下 ——
 * 那就等於每改一次種子全跑二十幾分鐘。所以只列**種子的內容本身就是主角**的那幾支：
 * 設定頁（16、17、47）、資料健檢拿種子比對（03）、名稱怎麼寫（23）、警示與擇一池的
 * 指派（14、21）、拍文宣與拍 Abovee 拿主檔認字（38、41）。改種子通常跟著改讀它的
 * domain 檔（`visits.js`、`taskRules.js`…），那幾支會被那一側挑到；只改種子而壞掉
 * 沒列到的那一支，由 CI 的全量接住。
 */
export const COVERAGE = {
  '01-products': [
    'public/js/domain/products.js', 'public/js/domain/purchases.js',
    'public/js/domain/notes.js', 'public/js/data/notes.js',
    'public/js/ui/components/buy.js', 'public/js/ui/components/buySheet.js',
    'public/js/ui/components/note.js', 'public/js/ui/components/planTweak.js',
    'public/js/ui/views/bought.js', 'public/js/ui/views/customerDetail.js',
  ],
  '02-examine-chain': [
    'public/js/domain/followups.js', 'public/js/domain/taskRules.js',
    'public/js/domain/todoFlow.js', 'public/js/data/tasks.js',
    'public/js/ui/components/tasklist.js', 'public/js/ui/components/taskMirror.js',
    'public/js/ui/views/home.js', 'public/js/ui/views/health.js',
    'public/js/ui/views/customerDetail.js',
  ],
  '03-health-and-counts': [
    'public/js/domain/health.js', 'public/js/domain/entitlements.js',
    'public/js/data/health.js', 'public/js/ui/views/health.js',
    'public/js/ui/views/customers.js', 'public/js/ui/views/customerDetail.js',
    'public/js/domain/seed.js',
  ],
  '04-journey-a-happy': [
    'public/js/domain/scheduling.js', 'public/js/domain/visits.js',
    'public/js/domain/taskRules.js', 'public/js/domain/availability.js',
    'public/js/domain/confirmations.js', 'public/js/domain/progress.js',
    'public/js/data/visits.js', 'public/js/ui/nav.js',
    'public/js/ui/components/form.js', 'public/js/ui/components/dialog.js',
    'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js', 'public/js/ui/views/visitEditor.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/progress.js',
    'public/js/ui/views/home.js',
  ],
  '05-journey-b-changes': [
    'public/js/domain/visits.js', 'public/js/domain/consequences.js',
    'public/js/domain/taskRules.js', 'public/js/domain/undo.js',
    'public/js/data/visits.js', 'public/js/ui/nav.js',
    'public/js/ui/components/actions.js', 'public/js/ui/components/dialog.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/visitEditor.js',
    'public/js/ui/views/customerDetail.js', 'public/js/ui/views/home.js',
  ],
  '06-time-travel': [
    'public/js/domain/dates.js', 'public/js/domain/availability.js',
    'public/js/domain/visitTime.js', 'public/js/domain/followups.js',
    'public/js/domain/calendar.js', 'public/js/ui/views/home.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js',
    'public/js/ui/views/availability.js',
  ],
  '07-chaos': [
    'public/js/domain/customers.js', 'public/js/domain/bulkCustomers.js',
    'public/js/domain/notes.js', 'public/js/ui/components/form.js',
    'public/js/ui/components/note.js', 'public/js/ui/toast.js',
    'public/js/ui/views/customers.js', 'public/js/ui/views/customersBulk.js',
    'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js', 'public/js/ui/views/calendar.js',
    'public/js/ui/views/home.js',
  ],
  '08-ux-audit': [
    'public/css/', 'public/js/ui/theme.js',
    'public/js/ui/components/', 'public/js/ui/views/',
  ],
  '09-sheet-and-import': [
    'public/js/domain/sheetReport.js', 'public/js/domain/mergeImport.js',
    'public/js/domain/legacyImport.js', 'public/js/data/sheetSync.js',
    'public/js/data/legacyImport.js', 'public/js/ui/views/report.js',
    'public/js/ui/views/mergeImport.js', 'public/js/ui/views/backfill.js',
    'sheets/',
  ],
  '10-offline': [
    'public/js/ui/toast.js', 'public/js/ui/net.js', 'public/sw.js',
    'public/js/ui/components/note.js',
  ],
  '11-todo-drawer': [
    'public/js/domain/todoFlow.js', 'public/js/domain/taskRules.js',
    'public/js/domain/followups.js', 'public/js/data/tasks.js',
    'public/js/ui/components/tasklist.js', 'public/js/ui/components/taskMirror.js',
    'public/js/ui/views/home.js',
    // 「今天做了什麼」的分段（home 那一頁畫它；00-smoke 的 S4 也盯著，CORE 永遠跑）
    'public/js/domain/dayReview.js',
  ],
  '12-ask-by-month': [
    'public/js/domain/availability.js', 'public/js/domain/availabilityForm.js',
    'public/js/data/formInvites.js', 'public/js/data/formResponses.js',
    'public/js/data/publicForm.js', 'public/js/ui/components/monthnav.js',
    'public/js/ui/components/ban.js', 'public/js/ui/nav.js',
    'public/js/ui/views/availability.js', 'public/js/ui/views/formInbox.js',
    'public/js/ui/views/home.js', 'public/form.html', 'public/js/form/',
  ],
  '13-nth-followup': [
    'public/js/domain/nthFollowup.js', 'public/js/domain/naming.js',
    'public/js/domain/visits.js', 'public/js/domain/followups.js',
    'public/js/data/visits.js', 'public/js/ui/nav.js',
    'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js', 'public/js/ui/views/visitEditor.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/customerDetail.js',
  ],
  '14-clinical-alert': [
    'public/js/domain/clinicalFlags.js', 'public/js/domain/contraindications.js',
    'public/js/domain/customerMarks.js', 'public/js/ui/components/flags.js',
    'public/js/ui/components/marks.js', 'public/js/ui/views/masterList.js',
    'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js', 'public/js/ui/views/customerDetail.js',
    'public/js/domain/seed.js',
  ],
  '15-playbook': [
    'public/js/domain/playbook.js', 'public/js/data/playbooks.js',
    'public/js/ui/components/playbookHint.js', 'public/js/ui/views/playbook.js',
    'public/js/ui/views/trash.js', 'public/js/ui/views/home.js',
  ],
  '16-record-task': [
    'public/js/domain/taskRules.js', 'public/js/domain/todoFlow.js',
    'public/js/domain/masterData.js', 'public/js/data/tasks.js',
    'public/js/ui/views/masterList.js', 'public/js/ui/views/home.js',
    'public/js/domain/seed.js',
  ],
  '17-settings-fields': [
    'public/js/domain/messageTemplates.js', 'public/js/domain/messages.js',
    'public/js/domain/masterData.js', 'public/js/data/config.js',
    'public/js/ui/components/form.js', 'public/js/ui/components/message.js',
    'public/js/ui/views/preferences.js', 'public/js/ui/views/templates.js',
    'public/js/ui/views/masterList.js', 'public/js/ui/views/settings.js',
    'public/js/domain/seed.js',
  ],
  '18-memo-paste-and-emoji': [
    'public/js/domain/playbook.js', 'public/js/domain/events.js',
    'public/js/ui/views/playbook.js', 'public/js/ui/views/eventEditor.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/components/note.js',
  ],
  '19-untick-and-drawer-todos': [
    'public/js/domain/followups.js', 'public/js/domain/taskRules.js',
    'public/js/domain/todoFlow.js', 'public/js/domain/visits.js',
    'public/js/data/tasks.js', 'public/js/data/visits.js',
    'public/js/ui/components/taskMirror.js', 'public/js/ui/components/tasklist.js',
    'public/js/ui/views/home.js', 'public/js/ui/views/calendar.js',
  ],
  '20-drawer-one-slot': [
    'public/js/domain/visits.js', 'public/js/domain/naming.js',
    'public/js/data/visits.js', 'public/js/ui/nav.js',
    'public/js/ui/components/slotNote.js', 'public/js/ui/components/actions.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/visitEditor.js',
  ],
  '21-pool-assignment': [
    'public/js/domain/visits.js', 'public/js/domain/masterData.js',
    'public/js/domain/contraindications.js', 'public/js/ui/nav.js',
    'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js', 'public/js/ui/views/visitEditor.js',
    'public/js/ui/views/home.js',
    'public/js/domain/seed.js',
  ],
  '22-bulk-cancel': [
    'public/js/domain/visits.js', 'public/js/domain/consequences.js',
    'public/js/data/visits.js', 'public/js/ui/nav.js',
    'public/js/ui/views/bulkCancel.js', 'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js',
    'public/js/ui/saveEach.js',
    // 那一條貼在導覽列上是量出來的位置
    'public/css/',
  ],
  '23-naming-read-first': [
    'public/js/domain/naming.js', 'public/js/domain/entitlements.js',
    'public/js/domain/masterData.js', 'public/js/ui/views/naming.js',
    'public/js/domain/seed.js',
  ],
  // 說明泡泡（issue 08／09）。元件本身與掛了 `?` 的那兩頁。
  '26-tip': [
    'public/js/ui/components/tip.js', 'public/js/ui/views/naming.js',
    'public/js/ui/views/health.js',
  ],
  '24-layout-reach': [
    'public/css/', 'public/js/ui/views/calendar.js',
    'public/js/ui/views/playbook.js',
    // toast 不蓋導覽列、懸浮鈕與新增客戶那一條（F1–F3）
    'public/js/ui/toast.js', 'public/js/ui/components/customerForm.js', 'public/js/ui/views/customers.js',
    // 那一疊卡片開著時 toast 站到抬頭上（F5、F6）：壓表的卡片組與拍訂購單的確認卡都是 `.deck`
    'public/js/ui/views/schedule.js', 'public/js/ui/components/orderConfirm.js',
  ],
  // 來訪編輯器那三支 ADR（0083 一天一筆、0084 記一句在段上、0085 改一段）。
  // **`domain/visits.js` 與 `visitEditor.js` 是它的主場** —— 那兩支底下改一行
  // 就該跑這一支，因為單元那一側大半是原始碼掃描（見這支 spec 的檔頭）。
  '25-visit-editor-one-slot': [
    'public/js/domain/visits.js', 'public/js/domain/consequences.js',
    'public/js/domain/entitlements.js', 'public/js/data/visits.js',
    'public/js/ui/components/slotNote.js', 'public/js/ui/components/form.js',
    'public/js/ui/views/visitEditor.js', 'public/js/ui/views/calendar.js',
    'public/js/domain/taskRules.js',
  ],
  // 讀取卡片單段化（issue 10）。`visitReadHtml()` 是**四個畫面共用**的
  // （ADR-0018、0056），所以那四支 view 底下改一行都該跑這一支 ——
  // 單元那一側全部是原始碼掃描（calendar.js 進不了 node）。
  '27-read-card-one-slot': [
    'public/js/domain/visits.js', 'public/js/domain/progress.js',
    'public/js/ui/components/card.js', 'public/js/ui/components/taskMirror.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/progress.js',
    'public/js/ui/views/home.js', 'public/js/ui/views/customerDetail.js',
    'public/js/ui/views/visitEditor.js',
  ],
  // 「記一句」那一塊本身（四個入口共用）。`home.js` 在裡面是因為
  // 2026-09-12 那個 bug 的另一半在確認那一頁的接線上。
  '28-note-box': [
    'public/js/ui/components/slotNote.js',
    'public/js/ui/views/home.js',
    'public/js/ui/views/visitEditor.js',
    'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js',
    'public/js/data/visits.js',
  ],
  // 「一天只是一個抬頭」（ADR-0089）。讀取卡片是四個畫面共用的，
  // 所以那四支 view 底下改一行都該跑這一支。
  '29-slot-first': [
    'public/js/domain/visits.js', 'public/js/domain/todoFlow.js',
    'public/js/domain/playbook.js', 'public/js/domain/progress.js',
    'public/js/ui/components/taskMirror.js', 'public/js/ui/components/playbookHint.js',
    'public/js/ui/components/dialog.js', 'public/js/ui/components/tasklist.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/progress.js',
    'public/js/ui/views/home.js', 'public/js/ui/views/customerDetail.js',
    'public/js/ui/views/visitEditor.js',
  ],
  '30-purchase-headline': [
    'public/js/domain/purchases.js', 'public/js/domain/entitlements.js',
    'public/js/domain/naming.js', 'public/js/ui/views/customers.js',
    'public/js/ui/views/customerDetail.js', 'public/js/ui/views/bought.js',
  ],
  '31-calendar-title': [
    'public/js/domain/calendar.js', 'public/js/ui/views/calendar.js',
    'public/js/ui/components/sheet.js', 'public/css/',
  ],
  // 清掉已完成的待辦之後再存一次，那幾張不可以重長（2026-09-16，報告 §2.2）
  '33-cleared-tasks-do-not-regrow': [
    'public/js/domain/taskRules.js', 'public/js/data/tasks.js',
    'public/js/data/visits.js', 'public/js/ui/views/visitEditor.js',
  ],
  // 壓表與資料健檢不可以通到整天的編輯器（2026-09-16，報告 §2.1）
  '32-no-door-to-the-whole-day-editor': [
    'public/js/ui/views/schedule.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js', 'public/js/ui/views/health.js',
    'public/js/domain/health.js', 'public/js/ui/views.js',
    'public/js/ui/views/visitEditor.js',
  ],
  // 拍照辨識那一支 Function 的五道防護（ADR-0100）。`functions/` 底下每一支都算：
  // 模擬器跑的就是那個資料夾。`firebase.json` 在這裡是因為 functions 模擬器的設定在裡面
  // （hosting 那一段改了照樣有 00-smoke 盯著）。
  '35-ai-guard': [
    'functions/', 'public/js/data/ai.js', 'tests-e2e/fixtures/ai/', 'firebase.json',
    // 抄字格式 domain 那一份（跟 `functions/transcripts/` 一模一樣，`tests/ai-transcripts.test.js` 盯著）
    'public/js/domain/transcripts.js',
  ],
  // 設定 → AI 用量（issue 05）
  '36-ai-usage': [
    'public/js/domain/aiUsage.js', 'public/js/data/aiUsage.js', 'public/js/ui/views/aiUsage.js',
    'public/js/ui/views/settings.js', 'public/js/data/ai.js', 'functions/',
  ],
  // 拍照元件（issue 06）
  '37-camera': [
    'public/js/ui/components/camera.js', 'public/js/ui/components/photo.js',
    'public/js/ui/components/seen.js', 'public/js/data/ai.js', 'public/js/domain/aiUsage.js',
    // 看照片轉 90°（C7）量的是 CSS 畫出來的位置
    'public/css/',
  ],
  // 拍方案文宣 → 方案範本（issue 07）
  '38-photo-plan': [
    'public/js/domain/photoPlan.js', 'public/js/ui/views/masterList.js',
    'public/js/ui/components/camera.js', 'public/js/ui/components/seen.js', 'public/js/domain/legacyImport.js',
    'public/js/domain/seed.js',
  ],
  // 新增客戶畫面重畫（issue 08，ADR-0102）
  '39-new-customer-form': [
    'public/js/ui/components/customerForm.js', 'public/js/ui/components/flags.js',
    'public/js/ui/views/customers.js', 'public/js/domain/customers.js', 'public/js/ui/components/tip.js',
    // 取消／建立客戶那一條貼在導覽列上（N9）是量出來的位置
    'public/css/',
  ],
  // 拍訂購單 → 新增客戶／加購（issue 09）
  '40-order-form': [
    'public/js/domain/orderForm.js', 'public/js/ui/components/orderConfirm.js',
    'public/js/ui/components/customerForm.js', 'public/js/ui/views/customers.js',
    'public/js/ui/components/camera.js', 'public/js/ui/components/seen.js', 'public/js/ui/components/actions.js',
    'public/js/domain/photoPlan.js', 'public/js/domain/legacyImport.js', 'public/js/domain/purchases.js',
    'public/js/data/customers.js', 'tests-e2e/fixtures/ai/',
  ],
  // 拍 Abovee → 一次新增很多來訪（issue 11～13）
  '41-abovee': [
    'public/js/domain/aboveeImport.js', 'public/js/domain/abovee.js', 'public/js/domain/identify.js',
    'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js', 'public/js/ui/components/aboveeConfirm.js', 'public/js/ui/views/schedule.js',
    'public/js/ui/components/camera.js', 'public/js/ui/components/seen.js', 'public/js/domain/masterData.js',
    'public/js/domain/audit.js', 'public/js/ui/views/masterList.js', 'public/js/ui/views/calendar.js',
    'tests-e2e/fixtures/ai/',
    'public/js/domain/seed.js',
  ],
  // 療程單的存放與搜尋（issue 14，ADR-0105）。Storage 模擬器的設定在 firebase.json
  '42-treatment-sheets': [
    'public/js/domain/treatmentSheets.js', 'public/js/data/treatmentSheets.js', 'public/js/ui/components/sheetConfirm.js',
    'public/js/ui/views/treatmentSheets.js', 'public/js/ui/components/camera.js', 'public/js/ui/components/photo.js',
    'public/js/ui/components/seen.js', 'public/js/domain/identify.js', 'public/js/ui/views/trash.js',
    'public/js/ui/views/settings.js', 'public/js/data/backup.js', 'firebase.json', 'tests-e2e/fixtures/ai/',
  ],
  // 療程單比對（issue 15）。比對讀來訪的狀態與器材，連到日曆那一天
  '43-treatment-compare': [
    'public/js/domain/treatmentSheets.js', 'public/js/ui/views/treatmentSheets.js', 'public/js/domain/visits.js',
    'public/js/data/visits.js', 'public/js/ui/views/calendar.js', 'public/js/domain/dates.js',
  ],
  // 確認也是逐段的（2026-09-16，ADR-0097）
  '34-confirm-one-slot': [
    'public/js/domain/visits.js', 'public/js/domain/todoFlow.js',
    'public/js/domain/taskRules.js', 'public/js/ui/views/calendar.js',
    'public/js/ui/views/home.js', 'public/js/data/visits.js',
    'public/js/domain/consequences.js', 'public/js/domain/visitTime.js', 'public/js/ui/views/schedule.js',
  ],
  // 拿了舊的那一份去寫、去畫（prelaunch-audit-2026-09-23 的 03、04、10、18、19、20）
  '44-stale-copies': [
    'public/js/data/visits.js', 'public/js/ui/toast.js', 'public/js/ui/views/calendar.js',
    'public/js/ui/views/home.js', 'public/js/domain/visits.js',
    'public/js/ui/views/schedule.js', 'public/js/ui/saveEach.js',
  ],
  // 試算表推送在路上時又寫了一筆（prelaunch-audit-2026-09-23/issues/05）
  '45-sheet-push-race': ['public/js/data/sheetSync.js', 'public/js/ui/views/calendar.js'],
  // 設定 → 課程：先分類再項目（2026-10-05）。別稱那一條會走到名稱怎麼寫那一頁；
  // 「壓哪幾個系統」那兩條（G8、G9，ADR-0119）一路走到確認之後長哪幾張待辦
  '47-course-groups': [
    'public/js/ui/views/masterList.js', 'public/js/domain/masterData.js', 'public/js/domain/seed.js',
    'public/js/ui/views/naming.js', 'public/js/ui/components/form.js', 'public/js/data/config.js',
    'public/js/domain/taskRules.js', 'public/js/ui/views/calendar.js',
    'public/css/',
  ],
  // 醫師分科、課程指定哪一科（2026-10-05，ADR-0120）：設定頁兩排、壓表與來訪編輯器的醫師那一排
  '48-doctor-specialties': [
    'public/js/domain/masterData.js', 'public/js/domain/seed.js', 'public/js/ui/views/masterList.js',
    'public/js/ui/views/schedule.js', 'public/js/ui/views/visitEditor.js', 'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js',
    'public/js/ui/components/form.js',
  ],
  // 不算次數的課（2026-10-05，ADR-0121）：從設定勾起來、日曆與壓表排進去、做完、取消
  '49-uncounted-course': [
    'public/js/domain/slotOptions.js', 'public/js/domain/slotDraft.js', 'public/js/domain/masterData.js',
    'public/js/domain/visits.js', 'public/js/domain/consequences.js', 'public/js/domain/taskRules.js',
    'public/js/ui/views/schedule.js', 'public/js/ui/views/visitEditor.js', 'public/js/ui/views/masterList.js',
    'public/js/ui/views/home.js', 'public/js/ui/views/calendar.js', 'public/js/ui/components/buy.js',
  ],
  // 約的時候選時長（2026-10-05，ADR-0122）：設定那一格、壓表與來訪編輯器的「排多久」、月曆上的 二返(60)
  '50-booking-minutes': [
    'public/js/domain/visits.js', 'public/js/domain/slotDraft.js', 'public/js/domain/naming.js',
    'public/js/domain/masterData.js', 'public/js/domain/seed.js', 'public/js/ui/views/schedule.js',
    'public/js/ui/views/visitEditor.js', 'public/js/ui/views/masterList.js', 'public/js/ui/views/calendar.js',
  ],
  // 拍 Abovee 代替壓表（2026-10-05，abovee-and-master 的 07–11）：設定頁的 Abovee 寫法、確認層每一列換人與要做什麼
  '51-abovee-picks': [
    'public/js/domain/abovee.js', 'public/js/domain/aboveeImport.js', 'public/js/domain/identify.js',
    'public/js/domain/slotDraft.js', 'public/js/domain/slotOptions.js', 'public/js/domain/masterData.js',
    'public/js/domain/seed.js', 'public/js/domain/customers.js', 'public/js/domain/consequences.js',
    'public/js/ui/components/aboveeConfirm.js', 'public/js/ui/views/masterList.js', 'public/js/ui/views/schedule.js',
  ],
  // 一門課可以哪個系統都不用壓（2026-10-06，ADR-0126）：設定頁三個都不勾、排一段不問壓好了嗎、取消不長取消 Abovee
  '52-book-nowhere': [
    'public/js/domain/taskRules.js', 'public/js/domain/consequences.js', 'public/js/domain/masterData.js',
    'public/js/domain/scheduling.js', 'public/js/domain/todoFlow.js',
    'public/js/ui/views/schedule.js', 'public/js/ui/views/visitEditor.js', 'public/js/ui/views/masterList.js',
    'public/js/ui/views/calendar.js',
  ],
  // 床位那四間是各自的診間（2026-10-06，ADR-0127）：資料健檢建六間＋停用兩間＋床位搬家、壓表選 8A／8B、停用的那一間編輯時不被清掉
  '53-bed-rooms': [
    'public/js/domain/seed.js', 'public/js/domain/masterData.js', 'public/js/domain/abovee.js', 'public/js/domain/health.js',
    'public/js/data/health.js', 'public/js/data/config.js', 'public/js/ui/views/health.js',
    'public/js/ui/views/visitEditor.js', 'public/js/ui/views/schedule.js', 'public/js/ui/views/masterList.js',
    'public/js/ui/components/aboveeConfirm.js', 'public/js/domain/visits.js',
  ],
  // 設定 → 課程 → 編輯 重排（2026-10-06，issue 06，ADR-0130）：指派四選一、分類的「＋」、兩個別稱、收起來的「其他設定」、設定暫定
  '54-course-form': [
    'public/js/ui/views/masterList.js', 'public/js/domain/masterData.js', 'public/js/domain/seed.js',
    'public/js/ui/components/form.js', 'public/js/ui/views/naming.js', 'public/js/data/config.js',
    'public/css/',
  ],
  // 加購那一排先分類再項目（2026-10-06，issue 07）：客戶詳情的加購、新增客戶的「＋ 加一項」
  '55-buy-by-group': [
    'public/js/ui/components/buy.js', 'public/js/ui/components/buySheet.js', 'public/js/domain/masterData.js',
    'public/js/domain/seed.js', 'public/js/ui/views/customerDetail.js', 'public/js/ui/components/customerForm.js',
    'public/js/ui/components/form.js', 'public/js/domain/entitlements.js',
    // B5（issue 20）：資料健檢第 33 項、日曆「改這一段」存一次結束時間重算
    'public/js/domain/health.js', 'public/js/ui/views/health.js', 'public/js/ui/views/visitEditor.js', 'public/js/domain/visits.js',
  ],
  // 來訪「做什麼」那一排照分類排、二返另起一行（2026-10-06，issue 08；小標 issue 16 拿掉了）：壓表與來訪編輯器量位置
  '56-what-to-do-by-group': [
    'public/js/domain/slotOptions.js', 'public/js/domain/masterData.js', 'public/js/domain/scheduling.js',
    'public/js/domain/seed.js', 'public/js/ui/views/schedule.js', 'public/js/ui/views/visitEditor.js',
    'public/js/ui/components/form.js', 'public/css/',
  ],
  // 拍 Abovee：「app 有、這次照片上沒有」（2026-10-06，course-form-and-sheet/09，ADR-0129）：那一塊、抬頭的數字、那一顆按鈕
  '57-abovee-absent': [
    'public/js/domain/aboveeImport.js', 'public/js/domain/taskRules.js', 'public/js/domain/naming.js',
    'public/js/ui/components/aboveeConfirm.js', 'public/js/ui/views/schedule.js', 'public/js/ui/nav.js',
    'functions/transcripts/', 'tests-e2e/fixtures/ai/', 'public/css/',
  ],
  // 2026-10-07 驗證過的問題清單，第一支（verified-bugs-2026-10-07/01–07）：二返那一句、換額度器材重設、
  // 營養品先驗證再建、同一位客戶撞時間、進度追蹤不算取消的段、簽療程單的 toast、「第 N 個時段」
  '58-verified-rules': [
    'public/js/domain/visits.js', 'public/js/domain/followups.js', 'public/js/domain/progress.js',
    'public/js/domain/consequences.js', 'public/js/domain/products.js', 'public/js/domain/entitlements.js',
    'public/js/ui/views/visitEditor.js', 'public/js/ui/views/schedule.js', 'public/js/ui/views/home.js',
    'public/js/ui/views/progress.js', 'public/js/ui/views/customerDetail.js', 'public/js/ui/views/customersBulk.js',
    'public/js/ui/components/buy.js', 'public/js/ui/components/buySheet.js', 'public/js/ui/components/dialog.js',
  ],
  // 2026-10-07 驗證過的問題清單，第二支（verified-bugs-2026-10-07/08–17）：讀取卡片「沒扣」、數字數段、
  // 取消那幾道確認框、不用壓的段、待辦抽屜的返回鍵、長按去簽療程單、稽核用語、內部用語、太長的字、三條小的
  '59-verified-words': [
    'public/js/domain/entitlements.js', 'public/js/domain/consequences.js', 'public/js/domain/calendar.js',
    'public/js/domain/audit.js', 'public/js/domain/dayReview.js', 'public/js/domain/messageTemplates.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/home.js', 'public/js/ui/views/schedule.js',
    'public/js/ui/views/visitEditor.js', 'public/js/ui/views/bulkCancel.js', 'public/js/ui/views/customerDetail.js',
    'public/js/ui/views/customers.js', 'public/js/ui/views/masterList.js', 'public/js/ui/views/settings.js',
    'public/js/ui/components/dialog.js', 'public/js/ui/components/flags.js', 'public/js/ui/nav.js', 'public/css/',
  ],
  // 資料健檢重新設計（verified-bugs-2026-10-07/18，ADR-0136）
  '60-health-redesign': [
    'public/js/domain/health.js', 'public/js/data/health.js', 'public/js/ui/views/health.js', 'public/css/',
  ],
  // 客戶改名、刪掉客戶（prelaunch-audit-2026-09-23 的 09、08、16、17）
  '46-customer-rename-and-delete': [
    'public/js/ui/views/customerDetail.js', 'public/js/data/customers.js', 'public/js/domain/customers.js',
    'public/js/ui/components/dialog.js', 'public/js/ui/nav.js', 'public/js/ui/views/bulkCancel.js',
    // D1b：改名之後在簽療程單結案，任務的名字對齊來訪那一份
    'public/js/ui/views/home.js', 'public/js/domain/taskRules.js',
  ],
  // 上線前修正第一段（prelaunch-fixes-2026-10-08 的 01–08）：匯入頁只跑一趟
  '61-prelaunch-import-and-wall': [
    'public/js/ui/views/mergeImport.js', 'public/js/data/legacyImport.js', 'public/js/domain/mergeImport.js',
    // H1：模擬器回的快取標頭（Windows 上跳過，CI 才真的量）
    'firebase.json',
    // A1、A2：讀取卡片最上面那一排警示（四個畫面共用 `visitReadHtml()`，三頁靠 `fillMirror()` 補讀）
    'public/js/ui/views/calendar.js', 'public/js/ui/components/taskMirror.js', 'public/js/ui/components/flags.js',
  ],
};

const hits = (file, paths) => paths.some((p) => file === p || file.startsWith(p));

/**
 * 改了這些檔案，要跑哪幾支。
 *
 * @param {string[]} files git 給的路徑（POSIX 斜線、從 repo 根算起）
 * @returns {{specs: string[], all: boolean, rules: boolean, why: string[]}}
 *   `all` 為真時 `specs` 是空的 —— 呼叫端不要下 filter，直接全跑。
 */
export function pick(files = []) {
  const why = [];
  const specs = new Set(CORE);
  let all = false;
  let rules = false;

  for (const raw of files) {
    const file = String(raw).replace(/\\/g, '/').trim();
    if (!file) continue;

    // Rules 有自己的一套測試（`npm run test:rules`），不是 E2E 的事。
    if (file === 'firestore.rules' || file === 'firestore.indexes.json' || file === 'storage.rules') {
      rules = true;
      continue;
    }

    if (hits(file, IGNORED)) continue;

    if (hits(file, GLOBAL) && !hits(file, NOT_GLOBAL)) {
      all = true;
      why.push(`${file} 是共用底座 → 全跑`);
      continue;
    }

    // 改到 spec 自己就跑它自己。
    const own = file.match(/^tests-e2e\/specs\/(\d\d-[^.]+)\./);
    if (own) { specs.add(own[1]); continue; }

    // Rules 的測試、start-emulators 之類的，不影響 app 行為。
    if (file.startsWith('tests-e2e/rules/') || file.startsWith('tests-e2e/start-emulators')
      || file === 'tests-e2e/related.js') continue;

    const matched = Object.entries(COVERAGE)
      .filter(([, paths]) => hits(file, paths))
      .map(([spec]) => spec);

    if (matched.length) { for (const s of matched) specs.add(s); continue; }

    // **認不出來 → 全跑。** 對照表可以少一條，不可以安靜地少跑一支。
    all = true;
    why.push(`${file} 沒有登記在 related.js → 全跑`);
  }

  return { specs: all ? [] : [...specs].sort(), all, rules, why };
}
