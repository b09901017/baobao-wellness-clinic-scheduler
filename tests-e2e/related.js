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
];

/**
 * 一支 spec 摸得到哪些原始碼。
 * 判準：**這個檔案壞了，這一支會不會紅？** 會就列進去。
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
  ],
  '04-journey-a-happy': [
    'public/js/domain/scheduling.js', 'public/js/domain/visits.js',
    'public/js/domain/taskRules.js', 'public/js/domain/availability.js',
    'public/js/domain/confirmations.js', 'public/js/domain/progress.js',
    'public/js/data/visits.js', 'public/js/ui/nav.js',
    'public/js/ui/components/form.js', 'public/js/ui/components/dialog.js',
    'public/js/ui/views/schedule.js', 'public/js/ui/views/visitEditor.js',
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
    'public/js/ui/views/calendar.js', 'public/js/ui/views/schedule.js',
    'public/js/ui/views/availability.js',
  ],
  '07-chaos': [
    'public/js/domain/customers.js', 'public/js/domain/bulkCustomers.js',
    'public/js/domain/notes.js', 'public/js/ui/components/form.js',
    'public/js/ui/components/note.js', 'public/js/ui/toast.js',
    'public/js/ui/views/customers.js', 'public/js/ui/views/customersBulk.js',
    'public/js/ui/views/schedule.js', 'public/js/ui/views/calendar.js',
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
    'public/js/ui/views/schedule.js', 'public/js/ui/views/visitEditor.js',
    'public/js/ui/views/calendar.js', 'public/js/ui/views/customerDetail.js',
  ],
  '14-clinical-alert': [
    'public/js/domain/clinicalFlags.js', 'public/js/domain/contraindications.js',
    'public/js/domain/customerMarks.js', 'public/js/ui/components/flags.js',
    'public/js/ui/components/marks.js', 'public/js/ui/views/masterList.js',
    'public/js/ui/views/schedule.js', 'public/js/ui/views/customerDetail.js',
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
  ],
  '17-settings-fields': [
    'public/js/domain/messageTemplates.js', 'public/js/domain/messages.js',
    'public/js/domain/masterData.js', 'public/js/data/config.js',
    'public/js/ui/components/form.js', 'public/js/ui/components/message.js',
    'public/js/ui/views/preferences.js', 'public/js/ui/views/templates.js',
    'public/js/ui/views/masterList.js', 'public/js/ui/views/settings.js',
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
    'public/js/ui/views/schedule.js', 'public/js/ui/views/visitEditor.js',
    'public/js/ui/views/home.js',
  ],
  '22-bulk-cancel': [
    'public/js/domain/visits.js', 'public/js/domain/consequences.js',
    'public/js/data/visits.js', 'public/js/ui/nav.js',
    'public/js/ui/views/bulkCancel.js', 'public/js/ui/views/schedule.js',
  ],
  '23-naming-read-first': [
    'public/js/domain/naming.js', 'public/js/domain/entitlements.js',
    'public/js/domain/masterData.js', 'public/js/ui/views/naming.js',
  ],
  // 說明泡泡（issue 08／09）。元件本身與掛了 `?` 的那兩頁。
  '26-tip': [
    'public/js/ui/components/tip.js', 'public/js/ui/views/naming.js',
    'public/js/ui/views/health.js',
  ],
  '24-layout-reach': [
    'public/css/', 'public/js/ui/views/calendar.js',
    'public/js/ui/views/playbook.js',
  ],
  // 來訪編輯器那三支 ADR（0083 一天一筆、0084 記一句在段上、0085 改一段）。
  // **`domain/visits.js` 與 `visitEditor.js` 是它的主場** —— 那兩支底下改一行
  // 就該跑這一支，因為單元那一側大半是原始碼掃描（見這支 spec 的檔頭）。
  '25-visit-editor-one-slot': [
    'public/js/domain/visits.js', 'public/js/domain/consequences.js',
    'public/js/domain/entitlements.js', 'public/js/data/visits.js',
    'public/js/ui/components/slotNote.js', 'public/js/ui/components/form.js',
    'public/js/ui/views/visitEditor.js', 'public/js/ui/views/calendar.js',
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
    'public/js/ui/views/schedule.js',
    'public/js/data/visits.js',
  ],
  // 「一天只是一個抬頭」（ADR-0089）。讀取卡片是四個畫面共用的，
  // 所以那四支 view 底下改一行都該跑這一支。
  '29-slot-first': [
    'public/js/domain/visits.js', 'public/js/domain/todoFlow.js',
    'public/js/domain/playbook.js', 'public/js/domain/progress.js',
    'public/js/ui/components/taskMirror.js', 'public/js/ui/components/playbookHint.js',
    'public/js/ui/components/dialog.js',
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
    'public/js/ui/views/schedule.js', 'public/js/ui/views/health.js',
    'public/js/domain/health.js', 'public/js/ui/views.js',
    'public/js/ui/views/visitEditor.js',
  ],
  // 拍照辨識那一支 Function 的五道防護（ADR-0100）。`functions/` 底下每一支都算：
  // 模擬器跑的就是那個資料夾。`firebase.json` 在這裡是因為 functions 模擬器的設定在裡面
  // （hosting 那一段改了照樣有 00-smoke 盯著）。
  '35-ai-guard': [
    'functions/', 'public/js/data/ai.js', 'tests-e2e/fixtures/ai/', 'firebase.json',
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
  ],
  // 確認也是逐段的（2026-09-16，ADR-0097）
  '34-confirm-one-slot': [
    'public/js/domain/visits.js', 'public/js/domain/todoFlow.js',
    'public/js/domain/taskRules.js', 'public/js/ui/views/calendar.js',
    'public/js/ui/views/home.js', 'public/js/data/visits.js',
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
    if (file === 'firestore.rules' || file === 'firestore.indexes.json') {
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
