// 全螢幕（manifest 的 `display: fullscreen`，ADR-0147）之後，螢幕最上面那一條不可以有東西。
//
// 系統的狀態列收起來，畫面一路畫到螢幕最上緣 —— 前鏡頭那個洞也在裡面。瀏覽器把那個洞的高度
// 報成 `safe-area-inset-top`，讓不讓得開是 CSS 自己的事；沒讓的那一頁，抬頭或第一顆按鈕就在
// 鏡頭底下，看不到也不好按。
//
// **只能在瀏覽器裡量**：桌機的 Chromium 那個值永遠是 0，所以每一條 `env(safe-area-inset-top)`
// 寫對寫錯畫面都一樣。這裡用 CDP 把它設成 40px（常見的挖孔螢幕大約 30～40），再問
// 「最上面 40px 裡，有沒有畫得出來的字或按得到的東西」。
//
// 模擬器上有一條「本機模擬器」的橫幅，正式站沒有 —— 兩種各量一次：橫幅在的時候讓開鏡頭的是它，
// 不在的時候是 `.app__body`。只量有橫幅的那一種的話，正式站走的那一條規則一次都沒被跑到。

import { test, expect } from '../fixtures/app.js';
import { scenarioFresh } from '../fixtures/data.js';

const CUTOUT = 40;

/** 把前鏡頭那一塊的高度告訴瀏覽器（＝全螢幕時 Android 報給網頁的值）。 */
async function withCutout(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: CUTOUT, bottom: 0, left: 0, right: 0 },
  });
  await expect
    .poll(() => page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;height:env(safe-area-inset-top)';
      document.body.append(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    }), { message: '瀏覽器沒有吃到模擬的 safe-area-inset-top' })
    .toBe(CUTOUT);
}

/**
 * 最上面那一條裡畫得出來的東西：字、圖示、按得到的元件。回它們的樣子（空陣列＝讓開了）。
 *
 * 「畫得出來」問的是 `elementFromPoint()` —— 被捲動區切掉的內容它的外框也在那一條裡，
 * 但那一點摸到的是別人，不算。容器自己的底色與內距不算（那正是讓開的樣子）。
 */
function underCutout(page) {
  return page.evaluate((cutout) => {
    const hits = [];
    const seen = (el, rect) => {
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, cutout);
      if (bottom - top < 1 || rect.width < 1) return false;
      const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
      const at = document.elementFromPoint(x, (top + bottom) / 2);
      // 摸到的是它自己或它裡面的東西才算。摸到它的上層（捲動區外面那一圈）＝它被切掉了，沒畫出來
      return !!at && (at === el || el.contains(at));
    };
    const say = (el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).trim().replace(/\s+/g, '.')}`
      + `「${(el.textContent ?? '').trim().slice(0, 12)}」`;

    for (const el of document.querySelectorAll('button, a, input, select, textarea, [role="button"], svg, img')) {
      if (seen(el, el.getBoundingClientRect())) hits.push(say(el));
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim()) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (seen(node.parentElement, rect)) { hits.push(say(node.parentElement)); break; }
      }
    }
    return [...new Set(hits)];
  }, CUTOUT);
}

const TABS = ['/', '/customers', '/schedule', '/calendar', '/settings'];

/** 正式站沒有橫幅。拿掉它，量的就是正式站走的那一條規則。 */
async function likeProduction(page) {
  await page.evaluate(() => document.querySelectorAll('.envbar').forEach((el) => el.remove()));
  await expect(page.locator('.envbar')).toHaveCount(0);
}

test('T1 沒有橫幅（正式站）：五個分頁最上面那一條都是空的，捲下去也不會從鏡頭底下穿過去', async ({ app, page }) => {
  await app.seed(scenarioFresh());
  await app.signIn();
  await withCutout(page);

  for (const hash of TABS) {
    await app.go(hash);
    await likeProduction(page);

    expect(await underCutout(page), `${hash} 一進來`).toEqual([]);
    const main = await page.locator('.app__main').boundingBox();
    expect(main.y, `${hash} 的捲動區從鏡頭底下開始`).toBeGreaterThanOrEqual(CUTOUT);

    // 捲一小段：第一排內容剛好卡在那條線上（一半在線上面），最容易穿過去的就是這個位置
    await page.locator('.app__main').evaluate((el) => { el.scrollTop = 30; });
    expect(await underCutout(page), `${hash} 捲下去之後`).toEqual([]);
  }
});

test('T2 有橫幅（staging）：讓開鏡頭的是橫幅，內容不再多讓一次', async ({ app, page }) => {
  await app.seed(scenarioFresh());
  await app.signIn();
  await withCutout(page);
  await app.go('/customers');

  await expect(page.locator('.envbar')).toBeVisible();
  expect(await underCutout(page)).toEqual([]);

  // 橫幅的底色一路鋪到最上緣，字在鏡頭底下
  const bar = await page.locator('.envbar').boundingBox();
  const label = await page.locator('.envbar__label').boundingBox();
  expect(bar.y).toBe(0);
  expect(label.y).toBeGreaterThanOrEqual(CUTOUT);

  // 內容緊接在橫幅底下 —— 沒有再空一塊鏡頭的高度
  const main = await page.locator('.app__main').boundingBox();
  expect(Math.abs(main.y - (bar.y + bar.height))).toBeLessThan(1);
});

test('T3 蓋住整頁的那幾層：相機的抬頭也讓開', async ({ app, page }) => {
  await app.signIn('/');
  await withCutout(page);
  await likeProduction(page);

  await page.evaluate(async () => {
    const { openCamera } = await import('/js/ui/components/camera.js');
    openCamera({ kind: 'planFlyer', max: 10, onDone: () => {} });
  });
  await expect(page.locator('.cam')).toBeVisible();
  expect(await underCutout(page)).toEqual([]);
});

test('T4 沒有鏡頭的洞（不是全螢幕、或螢幕沒有洞）：版面跟以前一樣，不多留一塊', async ({ app, page }) => {
  await app.seed(scenarioFresh());
  await app.signIn('/customers');
  await likeProduction(page);

  const main = page.locator('.app__main');
  expect((await main.boundingBox()).y).toBe(0);
  expect(await main.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('12px');
});

// 上面四條都在等一個空陣列 —— 量法壞掉（永遠回空的）的話它們照樣綠。
// 所以把「讓開」拿掉一次，確定它真的量得出東西。
test('T5 量法本身：把讓開的那一條拿掉，量得出鏡頭底下有東西', async ({ app, page }) => {
  await app.seed(scenarioFresh());
  await app.signIn('/settings');
  await withCutout(page);
  await likeProduction(page);
  expect(await underCutout(page)).toEqual([]);

  await page.addStyleTag({ content: '.app__body { padding-top: 0 !important; }' });
  expect((await underCutout(page)).length).toBeGreaterThan(0);
});
