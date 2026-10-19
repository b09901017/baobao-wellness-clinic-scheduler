// 打開 LINE 對話交給手機上的 MacroDroid（ADR-0157，line-macrodroid 02～04）。
//
// 只有瀏覽器量得到的那幾件：設定頁那一段記在這一台、「試一次」真的敲了本機的門；
// 客戶詳情點 LINE、確認時間與問這輪的時間的「打開 LINE」送出去的 name／msg。
// 網址怎麼組、退路講什麼在 `tests/line-macro.test.js`。
//
// **連接埠不用 8080**：那是模擬器的 Firestore（`firebase.json`）—— 攔它會把 app 的連線一起攔掉，
// 不攔又會打到模擬器、回一個看起來像成功的 404。這裡一律 18080，只攔那一個。

import { test, expect } from '../fixtures/app.js';

const PORT = 18080;
const MACRO = `http://127.0.0.1:${PORT}/**`;

/** 攔下敲本機的每一次，記下 name／msg；`answer: false` 就是 MacroDroid 沒開（連線被拒）。 */
async function fakeMacro(context, { answer = true } = {}) {
  const calls = [];
  await context.route(MACRO, async (route) => {
    const url = new URL(route.request().url());
    calls.push({ path: url.pathname, name: url.searchParams.get('name'), msg: url.searchParams.get('msg') });
    if (answer) await route.fulfill({ status: 200, body: 'ok' });
    else await route.abort('connectionrefused');
  });
  // 退路開的 LINE 聊天清單：不要真的連出去
  const opened = [];
  await context.route('https://line.me/**', async (route) => {
    opened.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>LINE</p>' });
  });
  return { calls, opened };
}

/** 這一台已經勾了 MacroDroid（設定頁那一段存的那一格）。 */
async function macroOn(page) {
  await page.addInitScript((port) => {
    localStorage.setItem('scheduler.lineMacro', JSON.stringify({ on: true, port }));
  }, PORT);
}

const toast = (page) => page.locator('#toast');

test.describe('設定頁「打開 LINE 對話」', () => {
  test('L1 勾起來、改連接埠、試一次：敲的是那個連接埠、送一則好幾段的測試訊息；記在這一台', async ({ app, page, context }) => {
    const { calls } = await fakeMacro(context);
    await app.signIn('/settings');

    const box = page.locator('[data-linemacro]');
    await box.locator('[data-linemacro-on]').check();
    await box.locator('[name="lineMacroPort"]').fill(String(PORT));
    await box.locator('[name="lineMacroPort"]').dispatchEvent('change');
    await box.locator('[name="lineMacroTry"]').fill('王小明');
    await box.locator('[data-linemacro-try]').click();

    await expect(toast(page)).toContainText('送出去了');
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/line');
    expect(calls[0].name).toBe('王小明');
    expect(calls[0].msg).toContain('\n\n第二段');
    expect(calls[0].msg.length).toBeGreaterThan(150);

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('scheduler.lineMacro')));
    expect(saved).toEqual({ on: true, port: PORT });
  });

  test('L2 沒勾就按試一次：講先勾，一次都不敲本機的門', async ({ app, page, context }) => {
    const { calls } = await fakeMacro(context);
    await app.signIn('/settings');

    const box = page.locator('[data-linemacro]');
    await expect(box.locator('[data-linemacro-on]')).not.toBeChecked();
    await box.locator('[name="lineMacroTry"]').fill('王小明');
    await box.locator('[data-linemacro-try]').click();

    await expect(toast(page)).toContainText('先勾');
    expect(calls).toHaveLength(0);
  });

  test('L3 連接埠打錯：講一句、退回原本的值', async ({ app, page }) => {
    await macroOn(page);
    await app.signIn('/settings');

    const port = page.locator('[data-linemacro] [name="lineMacroPort"]');
    await expect(port).toHaveValue(String(PORT));
    await port.fill('70000');
    await port.dispatchEvent('change');
    await expect(toast(page)).toContainText('1 到 65535');
    await expect(port).toHaveValue(String(PORT));
  });
});
