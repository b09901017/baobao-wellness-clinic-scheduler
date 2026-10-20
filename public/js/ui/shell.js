import { navRoutes, activeNavPath, start, stop as stopRouter } from './router.js';
import { icon } from './icons.js';
import { esc } from './components/form.js';
import { back } from './nav.js';
import { setSignOut } from './session.js';
import { watchSystemTheme } from './theme.js';
import { watchOffline } from './net.js';
import { envBanner } from '../firebase-config.js';
import { onUpdateReady, applyUpdate } from './swUpdate.js';

// 殼可能畫第二次（被登出又登入、先畫的殼換成另一個帳號，ADR-0167）：上一個殼掛的通知先拆掉
let stopUpdateWatch = null;
let stopNetWatch = null;

/** 殼換成登入頁（被登出、沒有權限、連不上）：殼掛在 `window` 上的那幾個一起拆 —— 登入頁沒有 `#view`、沒有那兩條。 */
function unmountShell() {
  stopRouter();
  stopNetWatch?.();
  stopNetWatch = null;
  stopUpdateWatch?.();
  stopUpdateWatch = null;
}

/**
 * app 叫什麼。登入畫面的抬頭與分頁標題讀它；主畫面圖示底下那個名字在
 * `manifest.webmanifest` 與 `index.html`（那兩支讀不到 JS），改名三個地方一起改。
 */
const APP_NAME = '暴富日常';

/**
 * 「這裡不是正式環境」那一條。正式環境回空字串 —— **一個元素都不畫**，
 * 所以它不佔高度、也不需要在正式環境上驗證任何排版。
 *
 * 登入前後都要畫（`renderGate` 與 `renderShell` 各接一次）：她在 staging 上
 * 卡在登入畫面時，最需要知道的正是「這條是 staging，白名單要另外加」。
 */
function envBarHtml() {
  const bar = envBanner();
  if (!bar) return '';
  return `
    <div class="envbar" role="status">
      <span class="envbar__label">${esc(bar.label)}</span>
      <span class="envbar__hint">${esc(bar.hint)}</span>
    </div>`;
}

function navHtml(activePath) {
  return navRoutes()
    .map(
      (r) => `
        <a href="#${r.path}" ${r.path === activePath ? 'aria-current="page"' : ''}>
          ${icon(r.icon, { size: 23, cls: 'app__nav-icon', width: 1.7 })}
          <span>${r.title}</span>
          <span class="app__nav-dot" aria-hidden="true"></span>
        </a>`,
    )
    .join('');
}

/** 未登入、或登入了但不在白名單時顯示的畫面。 */
export function renderGate(root, { state, email, uid, onSignIn, onSignOut, onRetry }) {
  const boxes = {
    unconfigured: `
      <h2 class="card__title">還沒設定 Firebase</h2>
      <p class="muted">把 Firebase Console 的前端 config 填進 <code>public/js/firebase-config.js</code>。那串不是密鑰，可以直接 commit。</p>`,
    signedOut: `
      <h2 class="card__title">${APP_NAME}</h2>
      <p class="muted">請先登入。</p>
      <p><button class="btn btn--primary" type="button" data-signin>使用 Google 登入</button></p>`,
    notAllowed: `
      <h2 class="card__title">這個帳號還沒有權限</h2>
      <p class="muted">${esc(email ?? '')} 已登入，但不在白名單裡。</p>
      <p class="muted">到 Firebase Console → Firestore Database，建一個叫
        <b>allowedUsers</b> 的集合，裡面放一份文件 ID 等於下面這串的空文件：</p>
      <code data-uid>${esc(uid ?? '')}</code>
      <p><button class="btn btn--primary" type="button" data-copy>複製 uid</button></p>
      <p><button class="btn" type="button" data-signout>換一個帳號</button></p>`,
    // 「讀不到白名單」跟「不在白名單」要講不一樣的話（data/auth.js 的
    // accessState）。這一頁刻意**不提 Firebase Console** —— 她照著上面那一頁
    // 的指示跑去 Console 加一筆自己早就在裡面的 uid，那是白忙一場。
    unreachable: `
      <h2 class="card__title">連不上</h2>
      <p class="muted">${esc(email ?? '')} 已經登入了，但現在讀不到權限設定，
        通常是網路不穩。</p>
      <p class="muted">已經記進去的資料都在，不會因為這樣不見。</p>
      <p><button class="btn btn--primary" type="button" data-retry>再試一次</button></p>
      <p><button class="btn" type="button" data-signout>換一個帳號</button></p>`,
  };

  unmountShell();
  root.innerHTML = `${envBarHtml()}<div class="gate"><div class="card gate__box">${boxes[state]}</div></div>`;
  root.querySelector('[data-signin]')?.addEventListener('click', onSignIn);
  root.querySelector('[data-signout]')?.addEventListener('click', onSignOut);
  root.querySelector('[data-retry]')?.addEventListener('click', onRetry);

  // 手機上在 Console 和 app 之間手抄 uid 很容易抄錯，給一顆複製鈕。
  root.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
    const text = root.querySelector('[data-uid]')?.textContent?.trim() ?? '';
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = '已複製 ✓';
    } catch {
      // iOS 在非安全情境或沒有使用者手勢時會擋剪貼簿，退而求其次選取起來讓她自己長按複製
      const range = document.createRange();
      range.selectNodeContents(root.querySelector('[data-uid]'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      e.target.textContent = '已選取，長按複製';
    }
  });
}

/**
 * 登入且在白名單內時的主畫面。
 *
 * 沒有頂端橫幅：每一頁自己有大標，再放一條寫著同一個詞的橫幅是白白吃掉
 * 手機上的一整列。登出搬進設定頁（見 ui/session.js）。
 */
export function renderShell(root, { onSignOut }) {
  setSignOut(onSignOut);
  // 選了「跟著系統」的話，她在 iPad 的控制中心切深色時 app 通常還開著。
  // `data-theme` 本身在 index.html 的 `<head>` 就蓋好了（ADR-0055）。
  watchSystemTheme();

  root.innerHTML = `
    ${envBarHtml()}
    <div class="netbar" role="status" hidden>
      <span class="netbar__label">目前離線</span>
      <span class="netbar__hint">還是可以記，連上網路會自動送出去</span>
    </div>
    <nav class="app__nav" aria-label="主選單"></nav>
    <div class="app__body">
      <div class="updatebar" data-updatebar hidden>
        <button class="updatebar__go" type="button" data-update-go>有新版本・點一下更新</button>
        <button class="updatebar__x" type="button" data-update-x aria-label="先不要">${icon('close', { size: 16 })}</button>
      </div>
      <main class="app__main" id="view" tabindex="-1"></main>
    </div>
  `;

  // 離線時常駐一條。**不是彈窗** —— 她離線連做十件事，跳十次視窗只會讓她
  // 學會忽略它（同 `data/sheetSync.js` 對推送失敗的判斷）。
  // 這一條也不擋任何操作：資料進得了本機快取，記得下來才是重點。
  const netBar = root.querySelector('.netbar');
  stopNetWatch?.();
  stopNetWatch = watchOffline((offline) => { netBar.hidden = !offline; });

  // 有新版本在等（ADR-0167）。跟離線那一條同一個位置：底部已經有導覽列、toast、懸浮鈕、釘住的條四樣在搶。
  // **不擋任何操作**；收掉之後這一次打開不再跳（下次打開還在等的話再跳）
  const updateBar = root.querySelector('[data-updatebar]');
  let dismissed = false;
  stopUpdateWatch?.();
  stopUpdateWatch = onUpdateReady(() => { if (!dismissed) updateBar.hidden = false; });
  updateBar.querySelector('[data-update-go]').addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = '更新中…';
    applyUpdate();
  });
  updateBar.querySelector('[data-update-x]').addEventListener('click', () => {
    dismissed = true;
    updateBar.hidden = true;
  });

  const navEl = root.querySelector('.app__nav');

  wireBackLinks(root);

  start(({ path, route, params }) => {
    if (!route) return;
    const title = route.titleFor ? route.titleFor(...params) : route.title;
    // 分頁標題也帶上環境。橫幅在螢幕上，但**切分頁**的時候只看得到標題 ——
    // 而「兩個分頁開著、按錯那一個」正是這個安排最容易出的事。
    const env = envBanner();
    document.title = `${env ? `[${env.label}] ` : ''}${title} · ${APP_NAME}`;
    const view = freshView(root);
    navEl.innerHTML = navHtml(activeNavPath(path));
    // render 可能是 async，錯誤要看得見，不能靜默失敗
    Promise.resolve(route.render(view, ...params)).catch((err) => {
      // `esc()` 不可以少：例外訊息裡帶得進使用者的資料（`data/legacyImport.js`
      // 會把舊試算表的分頁名放進來，而那些分頁名就是客戶姓名）。
      // 每一個 view 自己的「讀取失敗」一直都有逃脫，只有這一條總路漏掉了。
      view.innerHTML = `<div class="card"><p>這一頁出錯了：${esc(err.message)}</p></div>`;
    });
  });
}

/**
 * 換頁時把 `#view` 整個換成一個新的空節點。
 *
 * **每一頁都畫在同一個元素上**，而好幾頁會把委派的 click 監聽掛在那個元素本身
 * （一次接住兩百列比接兩百顆按鈕便宜得多，ADR-0038 的那一段就是這樣寫的）。
 * 那些監聽跟著元素走，所以**換頁不會收掉它們** —— 它們會一路活到重新整理，
 * 而且在別的頁面上照樣被觸發：`data-kind`（匯入的分類鈕）跟日曆頂端的篩選丸
 * 是同一個屬性名，`data-task` 在客戶詳情與待辦中心各有一個意思。
 *
 * 一頁一頁去記得拆監聽是做不到的（漏掉的那一個只有在特定順序點過兩頁才看得到，
 * 而那正是 2026-08-25 那個「換月份箭頭跳到記一次」的形狀）。
 * 換掉節點是唯一不用任何人記得的作法：舊節點連同它身上的監聽一起被丟掉。
 *
 * 順帶修掉另一件事：`render()` 是 async 的，換頁時上一頁可能還在等資料。
 * 以前它回來之後會把**新的那一頁**蓋掉；現在它畫進一個已經離開文件的節點，
 * 什麼事都不會發生。
 */
function freshView(root) {
  const old = root.querySelector('#view');
  // cloneNode(false)：屬性照抄（id、class、tabindex），子節點與監聽都不抄。
  const next = old.cloneNode(false);
  // 上一頁掛在自己身上的記號（`data-*`）也不抄：待辦首頁的 `data-home-data="cache"` 跟過來的話，
  // 雲端還沒回來就換頁時下一頁一直帶著它（E2E 的 `settled()` 把它當成還沒畫完，等到逾時）
  for (const key of Object.keys(next.dataset)) delete next.dataset[key];
  old.replaceWith(next);
  return next;
}

/**
 * 每一頁左上角那個「回上一頁」。
 *
 * 它們本來是普通的 `<a href="#/customers">`，而那是**往前推一筆**不是往回退：
 * 客戶列表 → 客戶詳情 → 按「客戶」，紀錄裡就有三筆，手機返回鍵會把她送回
 * 剛剛才離開的客戶詳情。她的原話是「跳到奇怪的頁面」。
 *
 * 用事件委派接在整個 app 上，不是每一頁各接一次 —— 這種連結有十五個以上，
 * 而漏掉的那幾個會變成「有時候正常有時候怪」，比全部都怪更難查。
 *
 * `href` 留著沒有拿掉：長按「在新分頁開啟」照樣有意義，JS 壞掉時也還走得掉。
 * 自己接了事件的（`data-back`）跳過 —— 那幾個回的不是某個網址，
 * 是同一頁上的前一個畫面。
 */
function wireBackLinks(root) {
  // `#root` 換殼時不會換（只換裡面），**只接一次** —— 接兩次的話按一下回上一頁會退兩步
  if (root.dataset.backlinks) return;
  root.dataset.backlinks = '1';
  root.addEventListener('click', (e) => {
    const link = e.target.closest('a.backlink');
    if (!link || link.hasAttribute('data-back')) return;
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('#/')) return;
    e.preventDefault();
    back(href.slice(1));
  });
}
