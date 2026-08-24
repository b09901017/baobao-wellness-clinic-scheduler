import { navRoutes, activeNavPath, start } from './router.js';
import { icon } from './icons.js';
import { back } from './nav.js';
import { setSignOut } from './session.js';

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
export function renderGate(root, { state, email, uid, onSignIn, onSignOut }) {
  const boxes = {
    unconfigured: `
      <h2 class="card__title">還沒設定 Firebase</h2>
      <p class="muted">把 Firebase Console 的前端 config 填進 <code>public/js/firebase-config.js</code>。那串不是密鑰，可以直接 commit。</p>`,
    signedOut: `
      <h2 class="card__title">排課系統</h2>
      <p class="muted">請先登入。</p>
      <p><button class="btn btn--primary" type="button" data-signin>使用 Google 登入</button></p>`,
    notAllowed: `
      <h2 class="card__title">這個帳號還沒有權限</h2>
      <p class="muted">${email ?? ''} 已登入，但不在白名單裡。</p>
      <p class="muted">到 Firebase Console → Firestore Database，建一個叫
        <b>allowedUsers</b> 的集合，裡面放一份文件 ID 等於下面這串的空文件：</p>
      <code data-uid>${uid ?? ''}</code>
      <p><button class="btn btn--primary" type="button" data-copy>複製 uid</button></p>
      <p><button class="btn" type="button" data-signout>換一個帳號</button></p>`,
  };

  root.innerHTML = `<div class="gate"><div class="card gate__box">${boxes[state]}</div></div>`;
  root.querySelector('[data-signin]')?.addEventListener('click', onSignIn);
  root.querySelector('[data-signout]')?.addEventListener('click', onSignOut);

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

  root.innerHTML = `
    <nav class="app__nav" aria-label="主選單"></nav>
    <div class="app__body">
      <main class="app__main" id="view" tabindex="-1"></main>
    </div>
  `;

  const view = root.querySelector('#view');
  const navEl = root.querySelector('.app__nav');

  wireBackLinks(root);

  start(({ path, route, params }) => {
    if (!route) return;
    const title = route.titleFor ? route.titleFor(...params) : route.title;
    document.title = `${title} · 排課系統`;
    view.scrollTop = 0;
    navEl.innerHTML = navHtml(activeNavPath(path));
    // render 可能是 async，錯誤要看得見，不能靜默失敗
    Promise.resolve(route.render(view, ...params)).catch((err) => {
      view.innerHTML = `<div class="card"><p>這一頁出錯了：${err.message}</p></div>`;
    });
  });
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
  root.addEventListener('click', (e) => {
    const link = e.target.closest('a.backlink');
    if (!link || link.hasAttribute('data-back')) return;
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('#/')) return;
    e.preventDefault();
    back(href.slice(1));
  });
}
