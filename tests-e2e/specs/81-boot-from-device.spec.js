// 打開 app 先用手機裡的（ADR-0167，`.scratch/after-golive-2026-10-20/issues/06`、07、08）。
//
// 她 2026-10-20：「會卡在載入中 5 6 秒，有辦法讓app先呈現畫面嗎」。快不快只有她的手機量得準（設定頁「打開要多久」），
// 這一支盯的是**形狀**：程式檔真的沒打到網路、新版本那一條的行為、先畫的殼與快取的數字不會帶錯東西。
//
//   P1 第二次打開：程式檔一支都沒有打到網路（service worker 自己去抓的那幾支也算）
//   P2 第一次安裝（還沒有人管這一頁）→ 頁面不會自己重新載入
//   P3 打開 /form.html → 拿到的是客戶填表那一頁，不是 app
//   P4 新的一版裝好了 → 跳「有新版本」、沒點之前跑的是舊的而且照常用得了 → 點 → 重新載入、跑的是新的；
//      接著離線重新打開照樣打得開
// 換了 VERSION 時清掉哪幾格、留哪幾格在 `tests/sw-cache.test.js`（Playwright 攔不到瀏覽器去比對 sw.js 的那一下）

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer } from '../fixtures/data.js';

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
