import { routeList, current, start } from './router.js';

function navHtml(activePath) {
  return routeList()
    .map(
      (r) => `
        <a href="#${r.path}" ${r.path === activePath ? 'aria-current="page"' : ''}>
          <span class="app__nav-icon" aria-hidden="true">${r.icon}</span>
          <span>${r.title}</span>
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

/** 登入且在白名單內時的主畫面。 */
export function renderShell(root, { onSignOut }) {
  root.innerHTML = `
    <nav class="app__nav" aria-label="主選單">${navHtml(current())}</nav>
    <div class="app__body">
      <header class="app__header">
        <h1 class="app__title" data-title>排課系統</h1>
        <span class="app__spacer"></span>
        <button class="btn" type="button" data-signout>登出</button>
      </header>
      <main class="app__main" id="view" tabindex="-1"></main>
    </div>
  `;

  root.querySelector('[data-signout]').addEventListener('click', onSignOut);

  const view = root.querySelector('#view');
  const titleEl = root.querySelector('[data-title]');

  start((path) => {
    const route = routeList().find((r) => r.path === path);
    if (!route) return;
    titleEl.textContent = route.title;
    document.title = `${route.title} · 排課系統`;
    view.scrollTop = 0;
    route.render(view);
    root.querySelector('.app__nav').innerHTML = navHtml(path);
  });
}
