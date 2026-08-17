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
export function renderGate(root, { state, email, onSignIn, onSignOut }) {
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
      <p class="muted">${email ?? ''} 已登入，但不在白名單裡。到 Firebase Console 的 Firestore 新增一份空文件：</p>
      <code>allowedUsers/{你的 uid}</code>
      <p class="muted">uid 在 Authentication 分頁找得到。</p>
      <p><button class="btn" type="button" data-signout>換一個帳號</button></p>`,
  };

  root.innerHTML = `<div class="gate"><div class="card gate__box">${boxes[state]}</div></div>`;
  root.querySelector('[data-signin]')?.addEventListener('click', onSignIn);
  root.querySelector('[data-signout]')?.addEventListener('click', onSignOut);
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
