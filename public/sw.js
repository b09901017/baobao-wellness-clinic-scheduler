// Service worker，刻意寫得很小。
//
// 它只負責讓「訊號差時 app 還打得開」——也就是快取 app 殼。
// 資料完全不碰：Firestore 自己有離線快取，讀取走它的，寫入由它排隊重送。
// SW 去插手資料只會製造兩份互相矛盾的快取。
//
// 改了 app 殼的檔案就把 VERSION 加一，舊快取會在啟用時被清掉。

const VERSION = 'v7';
const CACHE = `shell-${VERSION}`;

// 這份清單必須涵蓋 public/ 底下所有 .js / .css / .html / .webmanifest，
// 否則冷啟動離線會少檔案。tests/shell-cache.test.js 會盯著它。
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
  '/js/domain/taskRules.js',
  '/js/domain/masterData.js',
  '/js/domain/seed.js',
  '/js/domain/contraindications.js',
  '/js/domain/entitlements.js',
  '/js/domain/visitTime.js',
  '/js/ui/shell.js',
  '/js/ui/router.js',
  '/js/ui/views.js',
  '/js/ui/toast.js',
  '/js/ui/components/dialog.js',
  '/js/ui/components/form.js',
  '/js/ui/views/settings.js',
  '/js/ui/views/masterList.js',
  '/js/ui/views/trash.js',
  '/js/ui/views/preferences.js',
  '/js/data/config.js',
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

  // 同源以外的東西一律不管：Firebase 的 API 呼叫、Google 登入流程都在這裡被放行。
  // 唯一例外是 firebase SDK 本身，那是 app 殼的一部分。
  const isFirebaseSdk = url.origin === 'https://www.gstatic.com' && url.pathname.includes('/firebasejs/');
  if (url.origin !== self.location.origin && !isFirebaseSdk) return;

  // 導覽請求：先走網路，失敗才用快取的殼。這樣改版能即時生效。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // 靜態資源：先用快取（開得快），背景同時更新。
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
