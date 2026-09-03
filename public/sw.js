// Service worker，刻意寫得很小。
//
// 它只負責讓「訊號差時 app 還打得開」——也就是快取 app 殼。
// 資料完全不碰：Firestore 自己有離線快取，讀取走它的，寫入由它排隊重送。
// SW 去插手資料只會製造兩份互相矛盾的快取。
//
// 策略：自己的檔案網路優先（逾時 3 秒退回快取），Firebase SDK 快取優先。
// 網路優先是為了「部署完打開就是最新的」——快取優先會讓每次改版都慢一輪。
//
// 改了 app 殼的檔案就把 VERSION 加一，舊快取會在啟用時被清掉。

const VERSION = 'v86';
const CACHE = `shell-${VERSION}`;

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
  '/js/data/auth.js',
  '/js/data/repo.js',
  '/js/data/events.js',
  '/js/data/notes.js',
  '/js/domain/taskRules.js',
  '/js/domain/todoFlow.js',
  '/js/domain/masterData.js',
  '/js/domain/seed.js',
  '/js/domain/contraindications.js',
  '/js/domain/entitlements.js',
  '/js/domain/followups.js',
  '/js/domain/nthFollowup.js',
  '/js/domain/visitTime.js',
  '/js/domain/events.js',
  '/js/domain/notes.js',
  '/js/domain/progress.js',
  '/js/ui/shell.js',
  '/js/ui/router.js',
  '/js/ui/nav.js',
  '/js/ui/views.js',
  '/js/ui/toast.js',
  '/js/ui/net.js',
  '/js/ui/theme.js',
  '/js/ui/icons.js',
  '/js/ui/session.js',
  '/js/ui/components/dialog.js',
  '/js/ui/components/ban.js',
  '/js/ui/components/monthnav.js',
  '/js/ui/components/form.js',
  '/js/ui/components/sheet.js',
  '/js/ui/components/card.js',
  '/js/ui/components/marks.js',
  '/js/ui/components/buy.js',
  '/js/ui/components/note.js',
  '/js/ui/components/tasklist.js',
  '/js/ui/components/actions.js',
  '/js/ui/components/flags.js',
  '/js/ui/views/settings.js',
  '/js/ui/views/eventEditor.js',
  '/js/ui/views/masterList.js',
  '/js/ui/views/trash.js',
  '/js/ui/views/preferences.js',
  '/js/data/config.js',
  '/js/data/customers.js',
  '/js/data/visits.js',
  '/js/domain/dates.js',
  '/js/domain/customers.js',
  '/js/domain/customerMarks.js',
  '/js/domain/visits.js',
  '/js/domain/confirmations.js',
  '/js/domain/consequences.js',
  '/js/domain/products.js',
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
  '/js/domain/calendar.js',
  '/js/domain/sheetReport.js',
  '/js/ui/components/download.js',
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 個別失敗不要讓整個安裝掛掉
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFirebaseSdk =
    url.origin === 'https://www.gstatic.com' && url.pathname.includes('/firebasejs/');
  // 網頁字體（ADR-0016）。第一次上線時抓下來收好，之後離線也還是那套字 ——
  // 沒收到就退回系統內建，畫面照樣完整，只是長相回到以前。
  const isWebFont =
    url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';

  // 其他跨網域一律不管：Firebase 的 API 呼叫、Google 登入流程都在這裡被放行。
  if (!sameOrigin && !isFirebaseSdk && !isWebFont) return;

  // 這兩種的網址都帶著版本或雜湊，同一個網址的內容永遠不變，可以放心快取優先。
  if (isFirebaseSdk || isWebFont) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetchAndCache(request)),
    );
    return;
  }

  // 自己的檔案一律網路優先。
  //
  // 之前用快取優先，結果每次部署後她都會先看到舊版，要再重新整理一次才會更新
  // —— 那是會天天發生的困惑。app 的檔案總共才幾十 KB，網路優先的代價很小，
  // 但「打開就是最新的」這件事很重要。
  //
  // 網路慢的時候不能一直等，超過 3 秒就先用快取，畫面照樣打得開。
  event.respondWith(networkFirst(request));
});

const NETWORK_TIMEOUT_MS = 3000;

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    // 跨網域的樣式表回來的是 opaque，status 永遠是 0，用 response.ok 判斷會全部漏掉。
    // 那種回應照樣存得起來也用得出去，只是我們看不到裡面 —— 字體就是走這條。
    if (response.ok || response.type === 'opaque') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

async function networkFirst(request) {
  const cached = await caches.match(request);

  try {
    const response = await Promise.race([
      fetchAndCache(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('network-timeout')), NETWORK_TIMEOUT_MS),
      ),
    ]);
    return response;
  } catch {
    // 逾時或離線。有快取就用快取，沒有就讓瀏覽器自己報錯
    // （index.html 的保險絲會把它變成看得見的訊息）。
    if (cached) return cached;
    return fetch(request);
  }
}
