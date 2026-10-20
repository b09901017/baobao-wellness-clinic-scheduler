// 打開 app 先用手機裡的（ADR-0167，`.scratch/after-golive-2026-10-20/issues/06`、07、08）。
//
// 她 2026-10-20：「會卡在載入中 5 6 秒，有辦法讓app先呈現畫面嗎」。快不快只有她的手機量得準（設定頁「打開要多久」），
// 這一支盯的是**形狀**：程式檔真的沒打到網路、新版本那一條的行為、先畫的殼與快取的數字不會帶錯東西。
//
//   P1 第二次打開：程式檔一支都沒有打到網路（service worker 自己去抓的那幾支也算）
//   P2 第一次安裝（還沒有人管這一頁）→ 頁面不會自己重新載入
//   P3 打開 /form.html → 拿到的是客戶填表那一頁，不是 app
//   P11 設定 →「程式」→ 重新下載程式（萬一卡在舊版的逃生門）
//   P5～P8 先畫殼（07）：登入還沒回來殼就在、被移出白名單／登出換掉而且下次不閃、登入還在確認時寫入記的是她
//   P9、P10 首頁先用手機裡的畫（08）：雲端還沒回來數字就在、一樣的話一個節點都不換、不算進 cacheReads()；
//      別的地方改過 → 先畫舊的、雲端回來換成新的
//   P4 新的一版裝好了 → 跳「有新版本」、沒點之前跑的是舊的而且照常用得了 → 點 → 重新載入、跑的是新的；
//      接著離線重新打開照樣打得開
// 換了 VERSION 時清掉哪幾格、留哪幾格在 `tests/sw-cache.test.js`（Playwright 攔不到瀏覽器去比對 sw.js 的那一下）

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, note, TODAY } from '../fixtures/data.js';

const seed = () => [...masterDocs(), customer({ id: 'cust-a', name: '客戶A' })];

/** 這一頁真的被 service worker 管了（第一次安裝要等 `clients.claim()`）。 */
async function controlled(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test.describe('程式檔先用手機裡的（要 service worker）', () => {
  test.use({ serviceWorkers: 'allow' });

  test('P1 第二次打開：程式檔一支都沒有打到網路', async ({ app, page, context }) => {
    await app.seed(seed());
    await app.signIn('/');
    await controlled(page);

    const viaNetwork = [];
    const fromPage = [];
    context.on('request', (r) => {
      const url = new URL(r.url());
      if (url.origin !== 'http://127.0.0.1:5000' || !/\.(js|css|html)$|\/$/.test(url.pathname)) return;
      // service worker 自己去抓的（快取裡沒有才會）
      if (r.serviceWorker()) viaNetwork.push(url.pathname);
    });
    page.on('response', (res) => {
      const url = new URL(res.url());
      if (url.origin === 'http://127.0.0.1:5000' && /\.js$/.test(url.pathname)) {
        fromPage.push({ path: url.pathname, sw: res.fromServiceWorker() });
      }
    });

    await app.reload();

    console.log('[P1] 頁面拿到的程式檔', fromPage.length, '支；service worker 打到網路的', viaNetwork);
    expect(fromPage.length, '第二次打開也要載得到程式檔').toBeGreaterThan(50);
    expect(fromPage.filter((r) => !r.sw).map((r) => r.path), '每一支都經過 service worker').toEqual([]);
    expect(viaNetwork, '程式檔一支都不打到網路').toEqual([]);
  });

  test('P2 第一次安裝：頁面不會自己重新載入', async ({ app, page }) => {
    await app.seed(seed());
    await app.signIn('/');
    // 第一次安裝要下載整份程式檔，接手（clients.claim() → controllerchange）在這之後才來
    await page.evaluate(() => { window.__sameLoad = true; });
    await controlled(page);
    const reloaded = await page.waitForEvent('load', { timeout: 3000 }).then(() => true, () => false);
    expect(reloaded, '接手之後沒有重新載入').toBe(false);
    expect(await page.evaluate(() => window.__sameLoad), '還是同一次載入').toBe(true);
    await expect(page.locator('[data-updatebar]')).toBeHidden();
  });

  test('P3 打開 /form.html → 是客戶填表那一頁，不是 app', async ({ app, page }) => {
    await app.seed(seed());
    await app.signIn('/');
    await controlled(page);

    await page.goto('http://127.0.0.1:5000/form.html');
    await expect(page).toHaveTitle('不方便的時間');
    await expect(page.locator('.app__nav')).toHaveCount(0);
  });

  test('P11 設定 → 程式 → 重新下載程式：清掉這一台的程式檔、重新整理，資料都在', async ({ app, page }) => {
    await app.seed(seed());
    await app.signIn('/settings');
    await controlled(page);
    await page.evaluate(() => caches.open('shell-e2e-old').then((c) => c.put('/x', new Response('x'))));

    await page.locator('[data-redownload-go]').click();
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('.dialog [data-ok]').click(),
    ]);
    await expect(page.locator('#root[data-access="allowed"]')).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => caches.keys()), '舊的程式檔那一格清掉了').not.toContain('shell-e2e-old');
    await app.go('#/customers');
    await expect(page.locator('#view')).toContainText('客戶A');
    // 重新註冊、裝回來（下次打開又是先用手機裡的）
    await controlled(page);
  });

  test('P4 新的一版裝好了 → 跳「有新版本」、點了才換；換完離線照樣打得開', async ({ app, page, context }) => {
    test.info().annotations.push({ type: 'allow-console-errors', description: '最後一段刻意斷線' });
    await app.seed(seed());
    await app.signIn('/');
    await controlled(page);
    // 第二次打開：SDK 這一次經過 service worker，收進它自己的那一格
    await app.reload();

    // 「部署了新的一版」。**Playwright 攔不到瀏覽器去比對 sw.js 的那一下**（量過：route 一次都沒被叫到），
    // 所以換一個網址註冊同一支 sw.js —— 網址不一樣，瀏覽器就當成新的一版、在背景裝。
    // 新的那一版的 index.html 多一個記號（它裝的時候 service worker 自己去抓，這一下攔得到）。
    // 換了 VERSION 之後「舊的程式檔清掉、SDK 那一格留著」在 `tests/sw-cache.test.js` 跑 sw.js 本身
    await context.route(/127\.0\.0\.1:5000\/(index\.html)?(\?.*)?$/, async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace('<title>', '<meta name="e2e-version" content="new" /><title>');
      await route.fulfill({ response: res, body });
    });
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js?e2e=next'));

    const bar = page.locator('[data-updatebar]');
    await expect(bar, '新版裝好了 → 跳那一條').toBeVisible({ timeout: 20_000 });
    await expect(bar).toContainText('有新版本・點一下更新');

    // 沒點之前：跑的還是舊的那一份、照常用得了，管這一頁的也還是舊的那一個
    expect(await page.locator('meta[name="e2e-version"]').count(), '還沒點，是舊的那一份').toBe(0);
    expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), '還沒換手').not.toContain('e2e=next');
    await app.go('#/customers');
    await expect(page.locator('#view')).toContainText('客戶A');

    // 那一條點得到（不被別的東西蓋住）
    const hit = await bar.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return !!document.elementFromPoint(r.left + 20, r.top + r.height / 2)?.closest('[data-updatebar]');
    });
    expect(hit, '那一條點得到').toBe(true);

    await Promise.all([
      page.waitForEvent('load'),
      bar.locator('[data-update-go]').click(),
    ]);
    await expect(page.locator('meta[name="e2e-version"]'), '點了之後跑的是新的').toHaveCount(1);
    expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), '換手了').toContain('e2e=next');
    await expect(page.locator('.app__nav')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-updatebar]')).toBeHidden();

    // 換了之後離線重新打開：照樣打得開
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app__nav'), '離線照樣打得開').toBeVisible({ timeout: 20_000 });
    await context.setOffline(false);
  });
});

// ---------- 先畫殼（issue 07）----------

/** 登入那一側（Auth 模擬器）的每一個請求都慢一點：手機上那一段是先載 iframe、再換 token（spec 第三節）。 */
async function slowAuth(context, ms = 2500) {
  await context.route('http://127.0.0.1:9099/**', async (route) => {
    await new Promise((r) => { setTimeout(r, ms); });
    await route.continue();
  });
}

/** 這一頁有沒有出現過底下那一排（開機前就盯著，閃一下也算）。 */
async function watchNav(page) {
  await page.addInitScript(() => {
    window.__sawNav = false;
    new MutationObserver(() => {
      if (document.querySelector('.app__nav')) window.__sawNav = true;
    }).observe(document, { childList: true, subtree: true });
  });
}

test('P5 這一台上次通過了 → 重新整理時登入還沒回來，殼就在了；確認之後照常', async ({ app, page, context }) => {
  await app.seed(seed());
  await app.signIn('/customers');
  await slowAuth(context);
  await page.reload();
  await expect(page.locator('.app__nav'), '殼先畫出來').toBeVisible({ timeout: 10_000 });
  expect(await page.locator('#root').getAttribute('data-access'), '這時候登入還沒確認').toBeNull();
  await expect(page.locator('#root[data-access="allowed"]')).toBeVisible({ timeout: 30_000 });
  await app.settled();
  await expect(page.locator('#view')).toContainText('客戶A');
});

test('P6 被移出白名單 → 先看到殼、換成「沒有權限」；再打開直接是那一頁', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '移出白名單之後的讀取被 Rules 擋' });
  await app.seed(seed());
  await app.signIn('/');
  const { revokeUser } = await import('../fixtures/emulator.js');
  await revokeUser(app.uid);

  await page.reload();
  await expect(page.locator('.gate'), '確認出來沒有權限 → 換掉').toContainText('這個帳號還沒有權限', { timeout: 30_000 });
  await expect(page.locator('.app__nav')).toHaveCount(0);

  await watchNav(page);
  await page.reload();
  await expect(page.locator('.gate')).toContainText('這個帳號還沒有權限', { timeout: 30_000 });
  expect(await page.evaluate(() => window.__sawNav), '記的那一筆清掉了：一下都沒畫殼').toBe(false);
});

test('P7 登出 → 重新打開直接是登入頁，沒有先閃一下殼', async ({ app, page, context }) => {
  await app.seed(seed());
  await app.signIn('/settings');
  await page.locator('[data-signout]').click();
  await expect(page.locator('[data-signin]')).toBeVisible({ timeout: 15_000 });

  // **另開一頁**：fixture 每一次載入都把登入狀態寫回去（`primeAuth()` 是這一頁的 init script），
  // 這一頁重新整理就又登入了。舊的那一頁先關掉：Firestore 的快取一次只給一頁用；
  // 換到 about:blank 也不行 —— 那個 init script 在 about:blank 上開 IndexedDB 會丟錯
  await page.close();
  const fresh = await context.newPage();
  await watchNav(fresh);
  await fresh.goto('http://127.0.0.1:5000/');
  await expect(fresh.locator('[data-signin]')).toBeVisible({ timeout: 30_000 });
  expect(await fresh.evaluate(() => window.__sawNav), '一下都沒畫殼').toBe(false);
  await fresh.close();
});

test('P8 登入還在確認時就寫入（整批都是新增的那種）→ 稽核記的是她，不是 unknown', async ({ app, page, context }) => {
  await app.seed(seed());
  await app.signIn('/customers');
  await slowAuth(context);
  await page.reload();
  await expect(page.locator('.app__nav')).toBeVisible({ timeout: 10_000 });
  expect(await page.locator('#root').getAttribute('data-access'), '這時候登入還沒確認').toBeNull();

  // 畫面上每一個新增的入口都要先讀資料（讀取排隊等登入），所以直接叫隨手記那一支 —— 它整批都是 create、不先讀任何東西
  const id = await page.evaluate(() => import('/js/data/notes.js')
    .then((notes) => notes.create({ text: '登入還沒回來時記的' })));
  const audit = (await app.readAll('audit')).find((a) => a.targetPath === `notes/${id}`);
  expect(audit?.actor, '稽核記的是她（Rules 也只收她的 uid）').toBe(app.uid);
});

// ---------- 首頁先用手機裡的畫（issue 08）----------

/** 雲端（Firestore 模擬器）的每一個請求都慢一點。只讀手機裡的那一份不經過網路，不受影響 */
async function slowCloud(context, ms = 2500) {
  await context.route('http://127.0.0.1:8080/**', async (route) => {
    await new Promise((r) => { setTimeout(r, ms); });
    await route.continue().catch(() => {});
  });
}

const twoNotesToday = () => [
  ...seed(),
  note({ id: 'n-1', text: '今天的第一件', date: TODAY }),
  note({ id: 'n-2', text: '今天的第二件', date: TODAY }),
];
const todayTile = (page) => page.locator('[data-tile="today"] .tile__n');

test('P9 首頁先用手機裡的畫：雲端還沒回來數字就在了；一樣的話一個節點都不換；不算進「讀到快取」', async ({ app, page, context }) => {
  await app.seed(twoNotesToday());
  await app.signIn('/');
  await expect(todayTile(page)).toHaveText('2');

  await slowCloud(context);
  await page.reload();
  await expect(page.locator('#view[data-home-data="cache"]'), '先用手機裡的畫').toBeVisible({ timeout: 15_000 });
  await expect(todayTile(page)).toHaveText('2');
  const tile = await todayTile(page).elementHandle();
  // ADR-0158：只拿來畫的那一下不可以讓接下來的存檔被擋成「讀不完整」
  expect(await page.evaluate(() => import('/js/data/repo.js').then((r) => r.cacheReads())), '快取先畫那一下不算').toBe(0);

  await expect(page.locator('#view[data-home-data="server"]'), '雲端回來了').toBeVisible({ timeout: 30_000 });
  expect(await tile.evaluate((n) => n.isConnected), '一樣的話首頁一個節點都不換（不閃）').toBe(true);
  await expect(todayTile(page)).toHaveText('2');
});

test('P10 別的地方勾掉一件 → 重新打開先畫舊的數字，雲端回來換成新的', async ({ app, page, context }) => {
  await app.seed(twoNotesToday());
  await app.signIn('/');
  await expect(todayTile(page)).toHaveText('2');

  // 別台勾掉了一件（這一台的快取不知道）
  await app.seed([note({ id: 'n-1', text: '今天的第一件', date: TODAY, done: true, doneAt: `${TODAY}T03:00:00.000Z` })]);

  await slowCloud(context);
  await page.reload();
  await expect(page.locator('#view[data-home-data="cache"]')).toBeVisible({ timeout: 15_000 });
  await expect(todayTile(page), '先畫手機裡的（舊的）').toHaveText('2');
  await expect(page.locator('#view[data-home-data="server"]')).toBeVisible({ timeout: 30_000 });
  await expect(todayTile(page), '雲端回來換成新的').toHaveText('1');
});

