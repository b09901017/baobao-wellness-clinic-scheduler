// Firebase 前端 config，**一份原始碼跑兩個環境**。
//
// 這不是密鑰，可以直接 commit —— 它本來就會出現在每個人的瀏覽器裡。
// 真正的防線是 firestore.rules 與各環境自己的 allowedUsers，不是把這串藏起來。
//
// 怎麼填：Firebase Console → 專案設定 → 一般 → 你的應用程式 → SDK 設定和配置
//
// 刻意不收 measurementId、也不初始化 Analytics：那會載入 Google 的追蹤
// 程式碼，而這個 app 處理的是客戶健康資訊，沒有理由多接一個第三方。
// （staging 的 config 從 Console 複製過來時帶著 measurementId，這裡一樣拿掉。）

/**
 * 環境是**照網址挑的，不是照 build 挑**。
 *
 * 這個專案刻意沒有 build 步驟（`package.json` 的 description），所以不能靠
 * 打包時抽換檔案或注入環境變數。照 hostname 判斷的好處是：
 * 兩個環境部署的是**位元組相同的同一份原始碼**，不會出現「staging 上是好的、
 * 正式上壞掉」這種只可能是建置差異造成的問題。
 *
 * 代價是這三份 config 都會出現在兩邊的瀏覽器裡 —— 而那沒有關係，見上面。
 */
const PROJECTS = {
  prod: {
    apiKey: 'AIzaSyAeFnPeVOoKfGbf5eZof1AA9ev-u9bEifM',
    authDomain: 'wellness-clinic-scheduler.firebaseapp.com',
    projectId: 'wellness-clinic-scheduler',
    storageBucket: 'wellness-clinic-scheduler.firebasestorage.app',
    messagingSenderId: '4875686059',
    appId: '1:4875686059:web:8feeca1150e4a0ef07a7ee',
  },
  staging: {
    apiKey: 'AIzaSyA-oG2joe7Kz1amDIN3htdOT5m3_PjIO-4',
    authDomain: 'wellness-clinic-staging.firebaseapp.com',
    projectId: 'wellness-clinic-staging',
    storageBucket: 'wellness-clinic-staging.firebasestorage.app',
    messagingSenderId: '306220040308',
    appId: '1:306220040308:web:4fd377d8b6186afb501121',
  },
  // 本機模擬器。**`demo-` 開頭是有意義的**：Firebase 看到這個前綴才會進入
  // 完全離線模式，任何沒被模擬到的服務會直接報錯，而不是安靜地打到真的專案上。
  // 用正式專案 id 跑模擬器是 2026-09-01 那份體檢報告的 §2.7 盲區六。
  //
  // 這個值要跟三個地方一致：`tests-e2e/start-emulators.sh` 的 `--project`、
  // `tests-e2e/fixtures/emulator.js` 的 `PROJECT_ID`、以及這裡。
  // 對不上的話 app 讀的是一個空的命名空間，畫面全空但沒有任何錯誤。
  // `tests/env.test.js` 盯著這三邊。
  emulator: {
    apiKey: 'demo-api-key',
    authDomain: 'localhost',
    projectId: 'demo-scheduler',
    storageBucket: 'demo-scheduler.firebasestorage.app',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
  },
};

/**
 * 這個網址是哪一個環境。**純函式，可以測。**
 *
 * 判斷用「專案 id 有沒有出現在 hostname 裡」而不是完全比對，因為 Firebase
 * Hosting 的預覽頻道長成 `wellness-clinic-scheduler--pr-12-a1b2c3.web.app`。
 * 預覽頻道是正式專案的一個頻道，它就該連正式的資料庫 —— 那正是預覽的意義。
 *
 * 兩個 id 沒有互相包含（`…-staging` 不含 `…-scheduler`），所以順序不會誤判，
 * 但還是先問 staging：**認錯環境的代價是不對稱的**。
 * 把 staging 認成正式 = 在真資料上做測試；把正式認成 staging = 看到空資料庫。
 * 後者一眼就看得出來，前者看不出來。
 *
 * @param {string} hostname
 * @returns {'emulator'|'staging'|'prod'}
 */
export function envOf(hostname = '') {
  const host = String(hostname ?? '').toLowerCase();
  if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return 'emulator';
  if (host.includes(PROJECTS.staging.projectId)) return 'staging';
  return 'prod';
}

/**
 * 現在跑在哪一個環境。
 *
 * `globalThis.location?.` 是為了讓這支檔案在 Node 裡 import 得動（測試要驗
 * `envOf()`）。在瀏覽器裡 `location` 一定在，所以那個 `?.` 永遠不會走到。
 */
export const ENV = envOf(globalThis.location?.hostname ?? '');

export const firebaseConfig = PROJECTS[ENV];

/** 要不要接模擬器。`data/firebase.js` 讀它 —— 這件事只判斷一個地方。 */
export const usingEmulator = () => ENV === 'emulator';

/**
 * 非正式環境要在畫面上講出來，回 null 代表正式環境（不畫任何東西）。
 *
 * 她會兩個環境都開著，而**在 staging 上刪掉一筆資料然後以為刪掉了正式的那一筆**
 * 是這個安排最容易造成的事故。CLAUDE.md：「畫面在講一件不會發生的事，
 * 比沒講還糟」—— 反過來也成立，畫面沒講出「這裡的資料是假的」同樣糟。
 */
export function envBanner() {
  if (ENV === 'staging') return { label: '測試環境', hint: '這裡的資料是假的，改壞了沒關係' };
  if (ENV === 'emulator') return { label: '本機模擬器', hint: '資料只存在這台電腦上' };
  return null;
}

export function isConfigured() {
  return !Object.values(firebaseConfig ?? {}).some((v) => String(v).includes('REPLACE_ME'));
}
