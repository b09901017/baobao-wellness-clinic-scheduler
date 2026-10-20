// Service worker，刻意寫得很小。
//
// 它只負責讓「訊號差時 app 還打得開」——也就是快取 app 殼。
// 資料完全不碰：Firestore 自己有離線快取，讀取走它的，寫入由它排隊重送。
// SW 去插手資料只會製造兩份互相矛盾的快取。
//
// 策略（ADR-0167，推翻 2026-08-18 commit 0ae20497 的網路優先）：
//
// - **自己的檔案先用手機裡的**：`SHELL` 照 `VERSION` 整份預先裝好，打開 app 一個都不問伺服器。
//   以前每一支（一百多支）都先問一次「有沒有新的」，import 排好幾層 → 好幾趟來回才開始跑（她：「卡在載入中 5 6 秒」）
// - **新版本在背景裝好、不自己接管**：瀏覽器打開時自己會去比這一支（`no-cache`），不一樣就裝新的那一份；
//   裝好之後等著，畫面最上面跳一條「有新版本・點一下更新」（`ui/swUpdate.js`），她點了才換、重新載入。
//   8/18 改成網路優先的理由是「部署後打開先看到舊版、要再重新整理一次」—— 那次缺的是這一條提示，不是快取優先本身
// - **整份一起換**：`SHELL` 少一支沒下載到就不算裝好（`addAll()`），下次再試 —— 不會新舊混著
// - Firebase SDK 與字體放自己的快取（`EXTERNAL`），**不跟著版號清**：網址帶版本、內容不變；
//   以前跟 app 的檔案放同一格，換版時一起被刪掉 → 換版後第一次離線打開會開不起來
//
// **改了 `public/` 底下的檔案就把 VERSION 加一**，再跑 `npm run shell:snapshot`。
// 忘了加的話（以前是慢一輪）現在是**永遠停在舊版** —— `tests/shell-version.test.js` 擋著。

const VERSION = 'v206';
const CACHE = `shell-${VERSION}`;
const EXTERNAL = 'external-v1';

// 這份清單必須涵蓋 public/ 底下所有 .js / .css / .html / .webmanifest，
// 否則冷啟動離線會少檔案。tests/shell-cache.test.js 會盯著它。
//
// **唯一的例外是客戶那一頁**（`/form.html` 與它底下的東西）：那不是 app 的一部分，
// 是客戶在 LINE 裡點開的一個連結（ADR-0031）。她的裝置永遠不會離線打開它，
// 預先快取只是浪費；而客戶那一頁本身不註冊 service worker，所以也不靠這裡。
// 排除清單寫在 tests/shell-cache.test.js，有測試盯著它不會愈長愈長。
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/tokens.css',
  '/css/app.css',
  '/js/app.js',
  '/js/firebase-config.js',
  '/js/data/firebase.js',
  '/js/data/ai.js',
  '/js/data/aiUsage.js',
  '/js/domain/aiUsage.js',
  '/js/ui/views/aiUsage.js',
  '/js/ui/components/camera.js',
  '/js/ui/components/photo.js',
  '/js/ui/components/seen.js',
  '/js/domain/photoPlan.js',
  '/js/ui/components/customerForm.js',
  '/js/ui/components/orderConfirm.js',
  '/js/domain/orderForm.js',
  '/js/domain/slotDraft.js',
  '/js/domain/slotOptions.js',
  '/js/domain/identify.js',
  '/js/domain/incompleteRead.js',
  '/js/domain/abovee.js',
  '/js/domain/aboveeImport.js',
  '/js/ui/components/aboveeConfirm.js',
  '/js/domain/treatmentSheets.js',
  '/js/data/treatmentSheets.js',
  '/js/ui/components/sheetConfirm.js',
  '/js/ui/views/treatmentSheets.js',
  '/js/domain/transcripts.js',
  '/js/data/auth.js',
  '/js/data/repo.js',
  '/js/data/events.js',
  '/js/data/notes.js',
  '/js/domain/taskRules.js',
  '/js/domain/todoFlow.js',
  '/js/domain/masterData.js',
  '/js/domain/seed.js',
  '/js/domain/clinicalFlags.js',
  '/js/domain/contraindications.js',
  '/js/domain/entitlements.js',
  '/js/domain/followups.js',
  '/js/domain/nthFollowup.js',
  '/js/domain/visitTime.js',
  '/js/domain/events.js',
  '/js/domain/notes.js',
  '/js/domain/playbook.js',
  '/js/domain/lineText.js',
  '/js/domain/messageTemplates.js',
  '/js/ui/components/taskMirror.js',
  '/js/data/playbooks.js',
  '/js/domain/progress.js',
  '/js/ui/shell.js',
  '/js/ui/router.js',
  '/js/ui/nav.js',
  '/js/ui/views.js',
  '/js/ui/toast.js',
  '/js/ui/toastSwipe.js',
  '/js/ui/saveEach.js',
  '/js/ui/saveFailure.js',
  '/js/ui/relinkFollowup.js',
  '/js/ui/net.js',
  '/js/ui/theme.js',
  '/js/ui/bootTiming.js',
  '/js/ui/swUpdate.js',
  '/js/integrations/lineMacro.js',
  '/js/ui/icons.js',
  '/js/ui/session.js',
  '/js/ui/components/dialog.js',
  '/js/ui/components/ban.js',
  '/js/ui/components/monthnav.js',
  '/js/ui/components/form.js',
  '/js/ui/components/sheet.js',
  '/js/ui/components/card.js',
  '/js/ui/components/marks.js',
  '/js/ui/components/deck.js',
  '/js/ui/components/noteCard.js',
  '/js/ui/components/noteReorder.js',
  '/js/ui/components/notesEditor.js',
  '/js/ui/components/buy.js',
  '/js/ui/components/buySheet.js',
  '/js/ui/components/note.js',
  '/js/ui/components/planTweak.js',
  '/js/ui/components/slotNote.js',
  '/js/ui/components/giftFold.js',
  '/js/ui/components/tasklist.js',
  '/js/ui/components/actions.js',
  '/js/ui/components/flags.js',
  '/js/ui/components/playbookHint.js',
  '/js/ui/components/tip.js',
  '/js/ui/views/settings.js',
  '/js/ui/views/eventEditor.js',
  '/js/ui/views/masterList.js',
  '/js/ui/views/naming.js',
  '/js/ui/views/trash.js',
  '/js/ui/views/preferences.js',
  '/js/ui/views/templates.js',
  '/js/ui/views/todoRows.js',
  '/js/ui/views/playbook.js',
  '/js/ui/views/longNotes.js',
  '/js/data/config.js',
  '/js/data/customers.js',
  '/js/data/visits.js',
  '/js/domain/dates.js',
  '/js/domain/customers.js',
  '/js/domain/customerMarks.js',
  '/js/domain/customerNotes.js',
  '/js/domain/visits.js',
  '/js/domain/confirmations.js',
  '/js/domain/consequences.js',
  '/js/domain/products.js',
  '/js/domain/purchases.js',
  '/js/domain/dayReview.js',
  '/js/domain/undo.js',
  '/js/domain/availability.js',
  '/js/domain/scheduling.js',
  '/js/domain/bulkCustomers.js',
  '/js/ui/views/customers.js',
  '/js/ui/views/customersBulk.js',
  '/js/ui/views/customerDetail.js',
  '/js/ui/views/visitEditor.js',
  '/js/domain/messages.js',
  '/js/domain/naming.js',
  '/js/data/tasks.js',
  '/js/data/batches.js',
  '/js/ui/views/home.js',
  '/js/ui/views/availability.js',
  '/js/ui/views/schedule.js',
  '/js/domain/health.js',
  '/js/domain/audit.js',
  '/js/data/health.js',
  '/js/data/audit.js',
  '/js/data/backup.js',
  '/js/ui/views/health.js',
  '/js/ui/views/audit.js',
  '/js/ui/components/message.js',
  '/js/ui/views/backfill.js',
  '/js/ui/views/bulkCancel.js',
  '/js/domain/calendar.js',
  '/js/domain/sheetReport.js',
  '/js/ui/components/download.js',
  '/js/ui/views/bought.js',
  '/js/ui/views/calendar.js',
  '/js/ui/views/report.js',
  '/js/ui/views/progress.js',
  '/js/domain/legacyImport.js',
  '/js/domain/mergeImport.js',
  '/js/data/legacyImport.js',
  '/js/ui/views/mergeImport.js',
  '/js/data/sheetSync.js',
  '/js/domain/availabilityForm.js',
  '/js/data/formInvites.js',
  '/js/data/formResponses.js',
  '/js/ui/views/formInbox.js',
];

// 打開 app 的那幾個網址（導覽請求）。**只有這兩個**回手機裡的 `index.html`：
// `/form.html` 是客戶在 LINE 裡點開的那一頁（ADR-0031），`/__/auth/…` 是 Google 登入轉回來的那一頁 ——
// 被這一條吃掉的話，一個打開成 app、一個登入轉不回來。其餘的導覽一律照舊走網路
const APP_PAGES = new Set(['/', '/index.html']);

/** Firebase SDK 與網頁字體（ADR-0016）：網址帶著版本或雜湊，同一個網址的內容永遠不變。 */
function isExternal(url) {
  return (url.origin === 'https://www.gstatic.com' && url.pathname.includes('/firebasejs/'))
    || url.origin === 'https://fonts.googleapis.com'
    || url.origin === 'https://fonts.gstatic.com';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // **整份一起裝**：`addAll()` 少一支就整個失敗，這一版不算裝好、下次打開再試 —— 不會新舊混著。
      // `cache: 'reload'`：不拿瀏覽器自己的 HTTP 快取那一份（lessons 九：那一份可能是舊的）
      await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
      await adoptExternals();
      // **不 `skipWaiting()`**：裝好就等著，她點「有新版本・點一下更新」才換（`message` 那一段）。
      // 自己接管的話，她正在用的那一頁底下的程式檔會被換成新的 —— 新舊混著跑
    })(),
  );
});

/**
 * 舊版（v202 以前）把 SDK 與字體跟 app 的檔案放同一格，`activate` 一清就跟著不見。
 * 換到這一版的那一次先搬過來，換版後第一次離線照樣打得開。
 */
async function adoptExternals() {
  const external = await caches.open(EXTERNAL);
  for (const key of await caches.keys()) {
    if (!key.startsWith('shell-')) continue;
    const old = await caches.open(key);
    for (const request of await old.keys()) {
      if (!isExternal(new URL(request.url)) || await external.match(request)) continue;
      const response = await old.match(request);
      if (response) await external.put(request, response);
    }
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // 只清舊版的 app 檔案；SDK 與字體那一格留著
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('shell-') && k !== CACHE).map((k) => caches.delete(k)),
      ))
      // 第一次安裝（這一頁還沒有人管）時接手。**頁面那一側不可以因為這一下就重新載入**
      // （`ui/swUpdate.js` 只在她按了更新之後才重新載入）
      .then(() => self.clients.claim()),
  );
});

// 她按了「有新版本・點一下更新」（`ui/swUpdate.js` 的 `applyUpdate()`）
self.addEventListener('message', (event) => {
  if (event.data?.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isExternal(url)) {
    event.respondWith(cacheFirst(EXTERNAL, request));
    return;
  }
  // 其他跨網域一律不管：Firebase 的 API 呼叫、Google 登入流程都在這裡被放行
  if (url.origin !== self.location.origin) return;
  // Firebase 保留的網址（`/__/auth/…` 登入那一頁與它自己載的程式、`/__/firebase/…`）不是 app 的檔案：
  // 現在 authDomain 是另一個網域、碰不到這裡；哪天改成同一個網域，先用手機裡的就會把登入那一頁的程式凍在舊版
  if (url.pathname.startsWith('/__/')) return;

  if (request.mode === 'navigate') {
    if (!APP_PAGES.has(url.pathname)) return;
    event.respondWith(cacheFirst(CACHE, request, '/index.html'));
    return;
  }

  event.respondWith(cacheFirst(CACHE, request));
});

/**
 * 手機裡有就用手機裡的；沒有才走網路，拿到了收進同一格（圖示那種不在 `SHELL` 裡的）。
 * **讀的是指定的那一格**，不是全部快取一起找：新版裝好、還沒換的那段時間，舊的那一頁要拿到的是舊的那一份。
 *
 * @param {string} name 哪一格
 * @param {Request} request
 * @param {string} [key] 用哪個網址找（打開 app 的導覽一律找 `/index.html`）
 */
async function cacheFirst(name, request, key = request) {
  const cache = await caches.open(name);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await fetch(request);
  // 跨網域的樣式表回來的是 opaque，status 永遠是 0，用 response.ok 判斷會全部漏掉。
  // 那種回應照樣存得起來也用得出去，只是我們看不到裡面 —— 字體就是走這條。
  if (response.ok || response.type === 'opaque') {
    cache.put(key, response.clone()).catch(() => {});
  }
  return response;
}
