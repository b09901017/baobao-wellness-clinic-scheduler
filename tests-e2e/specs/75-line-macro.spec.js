// 打開 LINE 對話交給手機上的 MacroDroid（ADR-0157，line-macrodroid 02～04）。
//
// 只有瀏覽器量得到的那幾件：設定頁那一段記在這一台、「試一次」真的敲了本機的門；
// 客戶詳情點 LINE、確認時間與問這輪的時間的「打開 LINE」送出去的 name／msg。
// 網址怎麼組、退路講什麼在 `tests/line-macro.test.js`。
//
// **連接埠不用 8080**：那是模擬器的 Firestore（`firebase.json`）—— 攔它會把 app 的連線一起攔掉，
// 不攔又會打到模擬器、回一個看起來像成功的 404。這裡一律 18080，只攔那一個。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

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

test.describe('客戶詳情點 LINE（巨集停在打開對話）', () => {
  const seedOne = (app) => app.seed([...masterDocs(), customer({ id: 'cust-l', name: '客戶A', lineId: '王小明' })]);

  test('D1 這一台勾了：敲本機的門，name 是 LINE 名字、msg 有那個鍵但是空的；不開 line.me', async ({ app, page, context }) => {
    const { calls, opened } = await fakeMacro(context);
    await macroOn(page);
    await seedOne(app);
    await app.signIn('/customers/cust-l');

    await page.locator('[data-notesblock] [data-notes-line]').click();
    await expect(toast(page)).toContainText('已經叫 MacroDroid 打開「王小明」的對話');
    expect(calls).toEqual([{ path: '/line', name: '王小明', msg: '' }]);
    expect(opened).toEqual([]);
  });

  test('D2 這一台沒勾（iPad）：不敲門；複製名字、打開 LINE 的聊天清單', async ({ app, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { calls, opened } = await fakeMacro(context);
    await seedOne(app);
    await app.signIn('/customers/cust-l');

    await page.locator('[data-notesblock] [data-notes-line]').click();
    await expect(toast(page)).toContainText('已複製「王小明」');
    expect(calls).toEqual([]);
    await expect.poll(() => opened).toEqual(['https://line.me/R/nv/chat']);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('王小明');
  });

  test('D3 勾了但 MacroDroid 沒開（連線被拒）：講叫不到，走同一條退路', async ({ app, page, context }) => {
    // 連線被拒時瀏覽器自己會印一句「Failed to load resource」—— 那正是這一條要的情境
    test.info().annotations.push({ type: 'allow-console-errors', description: '刻意讓 MacroDroid 的連線被拒' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { calls, opened } = await fakeMacro(context, { answer: false });
    await macroOn(page);
    await seedOne(app);
    await app.signIn('/customers/cust-l');

    await page.locator('[data-notesblock] [data-notes-line]').click();
    await expect(toast(page)).toContainText('叫不到 MacroDroid');
    await expect(toast(page)).toContainText('已複製「王小明」');
    expect(calls).toHaveLength(1);
    await expect.poll(() => opened).toEqual(['https://line.me/R/nv/chat']);
  });
});

test.describe('確認時間、問這輪的時間的「打開 LINE」（巨集做到貼上）', () => {
  function seedPending({ lineId = '王小明' } = {}) {
    return [
      ...masterDocs(),
      customer({ id: 'cust-m', name: '客戶A', lineId }),
      entitlement('cust-m', { id: 'ent-m', label: '靜脈雷射', courseId: 'course-iv-laser', totalQty: 10 }),
      visit({
        id: 'v-m', customerId: 'cust-m', customerName: '客戶A', date: addDays(TODAY, 3), status: 'pending_confirm',
        slots: [slot({ courseId: 'course-iv-laser', entitlementId: 'ent-m', startsAt: '10:00', endsAt: '11:00' })],
      }),
    ];
  }

  test('M1 確認時間：送出去的是她改過之後的那一段（含換行），剪貼簿也是那一段；name 是 LINE 名字', async ({ app, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { calls, opened } = await fakeMacro(context);
    await macroOn(page);
    await app.seed(seedPending());
    await app.signIn('/todo/confirm');

    // 訊息收在「先看一下訊息」底下；改一個字，中間不開抽屜（開抽屜整頁重畫，改過的字會不見）
    await page.locator('[data-msg-wrap="cust-m"] summary').click();
    const area = page.locator('[data-msg="cust-m"]');
    await area.fill(`${await area.inputValue()}\n（改過）`);
    const sent = await area.inputValue();

    await page.locator('[data-msg-line="cust-m"]').click();
    await expect(toast(page)).toContainText('貼上訊息（不會送出）');
    expect(calls).toEqual([{ path: '/line', name: '王小明', msg: sent }]);
    expect(sent).toContain('\n（改過）');
    // Windows 上的 Chromium 寫進系統剪貼簿時把換行換成 CRLF（本機跑才看得到）—— 比的是字，不是平台
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.split(String.fromCharCode(13)).join('')).toBe(sent);
    expect(opened).toEqual([]);
  });

  test('M2 確認時間、那一位還沒填 LINE 名字：那一顆在，按了講去哪裡填、不敲門', async ({ app, page, context }) => {
    const { calls } = await fakeMacro(context);
    await macroOn(page);
    await app.seed(seedPending({ lineId: null }));
    await app.signIn('/todo/confirm');

    await page.locator('[data-msg-line="cust-m"]').click();
    await expect(toast(page)).toContainText('還沒填 LINE 名字');
    expect(calls).toEqual([]);
  });

  test('M3 問這輪的時間：產生連結之後那一則旁邊也有，送出去的是那一則', async ({ app, page, context }) => {
    const { calls } = await fakeMacro(context);
    await macroOn(page);
    await app.seed([
      ...masterDocs(),
      customer({ id: 'cust-q', name: '客戶B', lineId: '王小明' }),
      entitlement('cust-q', { id: 'ent-q', label: '靜脈雷射', courseId: 'course-iv-laser', totalQty: 10 }),
    ]);
    await app.signIn('/todo/ask');

    await expect(page.locator('[data-msg-line="ask-cust-q"]')).toHaveCount(0); // 還沒有那一則
    await page.locator('[data-makelink="cust-q"]').click();
    await app.saved();
    const area = page.locator('[data-msg="ask-cust-q"]');
    const sent = await area.inputValue();

    await page.locator('[data-msg-line="ask-cust-q"]').click();
    await expect(toast(page)).toContainText('已經叫 MacroDroid');
    expect(calls).toEqual([{ path: '/line', name: '王小明', msg: sent }]);
    expect(sent.length).toBeGreaterThan(0);
  });
});

test.describe('訊息框裡改過的字，整頁重畫之後還在（line-macrodroid 06）', () => {
  function seedTwoSlots() {
    return [
      ...masterDocs(),
      customer({ id: 'cust-r', name: '客戶A', lineId: '王小明' }),
      entitlement('cust-r', { id: 'ent-r', label: '靜脈雷射', courseId: 'course-iv-laser', totalQty: 10 }),
      visit({
        id: 'v-r', customerId: 'cust-r', customerName: '客戶A', date: addDays(TODAY, 3), status: 'pending_confirm',
        slots: [
          slot({ courseId: 'course-iv-laser', entitlementId: 'ent-r', startsAt: '10:00', endsAt: '11:00' }),
          slot({ courseId: 'course-iv-laser', entitlementId: 'ent-r', startsAt: '14:00', endsAt: '15:00' }),
        ],
      }),
    ];
  }

  test('R1 確認時間：改字 → 開抽屜 → 關掉，那一格還是改過的、還展開著；打開 LINE 送的是改過的', async ({ app, page, context }) => {
    const { calls } = await fakeMacro(context);
    await macroOn(page);
    await app.seed(seedTwoSlots());
    await app.signIn('/todo/confirm');

    await page.locator('[data-msg-wrap="cust-r"] summary').click();
    const area = page.locator('[data-msg="cust-r"]');
    await area.fill(`${await area.inputValue()}\n（改過）`);
    const edited = await area.inputValue();

    await page.locator('[data-open="cust-r"]').click();
    await expect(page.locator('.drawer [data-apply]')).toBeVisible();
    await page.locator('[data-close-drawer]').first().click();
    await expect(page.locator('.drawer [data-apply]')).toHaveCount(0);

    await expect(page.locator('[data-msg-wrap="cust-r"]')).toHaveJSProperty('open', true);
    await expect(area).toHaveValue(edited);
    await page.locator('[data-msg-line="cust-r"]').click();
    await expect(toast(page)).toContainText('已經叫 MacroDroid');
    expect(calls.map((c) => c.msg)).toEqual([edited]);
  });

  test('R2 確認時間：確認了其中一段、訊息跟著變 → 那一格是新產生的，不是改過的舊的那一段', async ({ app, page }) => {
    await app.seed(seedTwoSlots());
    await app.signIn('/todo/confirm');

    await page.locator('[data-msg-wrap="cust-r"] summary').click();
    const area = page.locator('[data-msg="cust-r"]');
    expect(await area.inputValue()).toContain('14:00');
    await area.fill(`${await area.inputValue()}\n（改過）`);

    await page.locator('[data-open="cust-r"]').click();
    await page.locator('.drawer [data-pick][data-to="1"]').first().click();
    await page.locator('.drawer [data-apply]').click();
    await app.saved();

    await expect(area).not.toHaveValue(/改過/);
    await expect(area).not.toHaveValue(/10:00/);
    await expect(area).toHaveValue(/14:00/);
  });

  test('R3 問這輪的時間：改了 A 的訊息，再幫 B 產生連結（整頁重讀）→ A 的那一格還是改過的', async ({ app, page }) => {
    await app.seed([
      ...masterDocs(),
      customer({ id: 'cust-a', name: '客戶A', lineId: '王小明' }),
      entitlement('cust-a', { id: 'ent-a', label: '靜脈雷射', courseId: 'course-iv-laser', totalQty: 10 }),
      customer({ id: 'cust-b', name: '客戶B' }),
      entitlement('cust-b', { id: 'ent-b', label: '靜脈雷射', courseId: 'course-iv-laser', totalQty: 10 }),
    ]);
    await app.signIn('/todo/ask');

    await page.locator('[data-makelink="cust-a"]').click();
    await app.saved();
    await app.settled(); // 存完之後整頁重讀；在那之前點的會被換掉
    // 剛產生的那一則自己會展開（`paintAsk()` 的 focus）—— 再點一次 summary 反而收起來
    await expect(page.locator('[data-msg-wrap="ask-cust-a"]')).toHaveJSProperty('open', true);
    const area = page.locator('[data-msg="ask-cust-a"]');
    await area.fill(`${await area.inputValue()}\n（改過）`);
    const edited = await area.inputValue();

    // 產生連結之後停在「已經發出」；B 在「還沒發連結」那一頁 —— 切分段也是一次整頁重畫
    await page.locator('[data-asktab="todo"]').click();
    await page.locator('[data-makelink="cust-b"]').click();
    await app.saved();
    await app.settled();
    await expect(page.locator('[data-msg="ask-cust-b"]')).toHaveCount(1);

    await expect(area).toHaveValue(edited);
    await expect(page.locator('[data-msg-wrap="ask-cust-a"]')).toHaveJSProperty('open', true);
  });
});
