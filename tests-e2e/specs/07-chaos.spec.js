// 混沌與邊界：亂點、亂打、連點、跳過必填。
//
// 這一組的判準不是「有沒有擋」，而是 SPEC 第 6.9 節那條：
//   **不可以靜默失敗，也不可以假裝成功。**
// 擋不擋是 ADR-0002 的判斷（app 記錄她的決定，不替她做決定）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, note, TODAY, addDays,
} from '../fixtures/data.js';

const NASTY = [
  ['超長字串', 'あ'.repeat(5000)],
  ['Emoji 與組合字元', '👨‍👩‍👧‍👦🇹🇼🏳️‍🌈 客人說要帶狗 🐕'],
  ['HTML 注入', '<img src=x onerror="window.__pwned=1">'],
  ['script 標籤', '"><script>window.__pwned=1</script>'],
  ['零寬與方向字元', 'a​‮b c'],
  ['全形與特殊符號', '１２３％＆＜＞「」\\\'"`;--'],
];

function baseSeed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
  ];
}

test('C1+C2+C3+C4 隨手記灌各種髒字串：不白屏、不執行、存得回原文', async ({ app, page }) => {
  await app.seed(baseSeed());
  await app.signIn('/todo/notes');

  for (const [what, text] of NASTY) {
    await page.locator('[data-quick]').click();
    await app.layer('[data-quicktext]');
    await page.locator('[data-quicktext]').fill(text);

    // **Enter 就是送出**（`ui/views/home.js` 的 keydown：`preventDefault()` 之後
    // 直接喊 `save()`）。以前這裡在 Enter 後面還補一顆「保險起見」的送出鈕，
    // 而那一下每一輪要等 **8.5 秒** —— 存完之後「復原」那個 toast
    // （`ui/toast.js` 的 `UNDO_MS = 8000`）壓在鈕上面，Playwright 要等它自己
    // 消失才點得到。六輪 51 秒，換來的是一下**根本沒有事情要做**的點擊。
    await page.locator('[data-quicktext]').press('Enter');
    await app.saved();

    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer'), '抽屜要收掉，下一輪才點得到泡泡').toHaveCount(0);

    // 沒有被當成程式碼執行
    const pwned = await page.evaluate(() => window.__pwned === 1);
    expect(pwned, `${what} 不可以被執行`).toBe(false);

    // 畫面沒垮
    const body = await app.text();
    expect(body.trim().length, `${what} 之後畫面不該空白`).toBeGreaterThan(10);
    expect(body, `${what} 之後不該出錯`).not.toMatch(/這一頁出錯了/);
  }

  // 超過 200 字的那一筆應該被擋在寫入之前（Rules 也擋，見 R8.1）
  const notes = (await app.readAll('notes')).filter((n) => !n.deletedAt);
  console.log('[C1] 真的寫進去的隨手記 =', notes.map((n) => `${n.text.slice(0, 30)}…(${n.text.length})`));
  for (const n of notes) {
    expect(n.text.length, '隨手記上限 200 字').toBeLessThanOrEqual(200);
  }
});

test('C3b 髒字串顯示回來時是文字，不是標籤', async ({ app, page }) => {
  const evil = '<img src=x onerror="window.__pwned=1">「客戶A」';
  await app.seed([
    ...baseSeed(),
    note({ id: 'note-evil', text: evil, customerId: 'cust-a', customerName: evil }),
  ]);
  await app.signIn('/todo/notes');

  await expect(page.locator('#view')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__pwned === 1), '不可以被執行').toBe(false);
  expect(await page.locator('#view img').count(), '不可以真的生出一個 img').toBe(0);
});

test('C3c 客戶姓名裡的髒字串在每一頁都是文字', async ({ app, page }) => {
  const evil = '<b onmouseover="window.__pwned=1">客戶A</b>';
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-x', name: evil }),
    entitlement('cust-x', {
      id: 'ent-x', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 10,
    }),
  ]);
  await app.signIn('/customers');

  // **掃 document 不是 `#view`。** 確認框、抽屜、浮出卡片全都掛在 `<body>` 上
  // （`dialog.js` / `sheet.js` / `card.js` 都是 `document.body.appendChild`），
  // 所以只掃 `#view` 的話，那三種疊上來的東西是結構性的死角 ——
  // 而確認框正是最後一個沒有逃脫的地方。
  // 掃「app 自己畫出來的每一片表面」，而不是整份 document —— index.html 本來就有
  // 合法的 <script>，掃整份會永遠大於 0。
  const SURFACES = '#view, .dialog-backdrop, .drawer-backdrop, .popcard-backdrop, #toast';
  const injectedCount = () => page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .reduce((n, root) => n
      + root.querySelectorAll('[onmouseover], [onerror], [onload], script').length, 0), SURFACES);

  for (const hash of ['/customers', '/customers/cust-x', '/', '/settings/health']) {
    await app.go(hash);

    // **不要數 `<b>` 的總數** —— app 自己就用 `<b>` 印數字（`<b>10</b>`）。
    // 要問的是「有沒有一個元素帶著我注入的那個屬性」。
    expect(await injectedCount(), `${hash} 不可以把客戶姓名當成標籤解析`).toBe(0);
    expect(await page.evaluate(() => window.__pwned === 1)).toBe(false);

    // 有印出名字的那幾頁，原文要看得見（她要認得出這位客戶的名字被打成什麼樣）。
    // 待辦首頁沒有任務時根本不會提到任何客戶，所以不能一律要求。
    if (hash.startsWith('/customers')) {
      expect(await app.text(), `${hash} 要印得出原文`).toContain('<b onmouseover=');
    }
  }

  // **二次確認框裡也一樣。** 破壞性動線上的那句話會把客戶姓名整個唸出來
  //（`刪除「⋯」？`），而那正是她判斷要不要按下去的依據 ——
  // 名字被當成標籤解析的話，那句話會顯示不完整。
  await app.go('/customers/cust-x');
  await page.locator('[data-danger]').click();
  await app.layer('[data-delete]');
  await page.locator('[data-delete]').click();
  await expect(app.dialog()).toBeVisible();

  expect(await injectedCount(), '確認框不可以把客戶姓名當成標籤解析').toBe(0);
  expect(await page.evaluate(() => window.__pwned === 1)).toBe(false);
  expect(await app.dialogText(), '確認框要把名字原封不動唸出來').toContain('<b onmouseover=');
  await app.cancelDialog();
});

test('C12 連點 5 次「加這一筆」→ 只寫進去一筆（防重複提交）', async ({ app, page }) => {
  const { availability } = await import('../fixtures/data.js');
  await app.seed([
    ...baseSeed(),
    availability('cust-a', {
      id: 'av', rawText: '都可以', validFrom: '2026-09-01', validTo: '2026-09-30', rules: [],
    }),
  ]);
  await app.signIn('/schedule');

  await page.locator('[data-month="2026-09"]').click();
  await app.settled();
  await page.locator('[data-pick="cust-a"]').first().click();
  await app.layer('[data-day="2026-09-03"]');

  await page.locator('[data-day="2026-09-03"]').first().click();
  await app.layer('[data-ent="ent-a"]');
  await page.locator('[data-ent="ent-a"]').click();
  await app.layer('[data-time]');
  await page.locator('[data-time]').first().click();
  await page.locator('[data-equipment="eq-indiba"]').click();
  await page.locator('[data-therapist="staff-tw"]').click();

  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();

  // 對確認鈕連點 5 下。
  //
  // **短逾時是必要的，不是圖快。** 第一下之後確認框就關了，剩下四下
  // **點不到東西才是對的**；用預設的 `actionTimeout`（15 秒）等於每一下
  // 白等 15 秒、四下 60 秒，而 `.catch()` 把逾時整個吞掉 —— 看起來只會像
  // 「這支測試就是慢」，看不出 60 秒全花在等一個本來就不該在的東西。
  //
  // **測試的力道一點都沒少**：防重複提交壞掉的話那顆鈕還在，這四下照樣
  // 點得到、照樣寫進第二筆，下面那兩句斷言照樣紅。
  const ok = page.locator('.dialog-backdrop [data-ok]');
  for (let i = 0; i < 5; i += 1) {
    await ok.click({ force: true, timeout: 1_000 }).catch(() => {});
  }
  await app.saved();

  const visits = (await app.readAll('visits')).filter((v) => !v.deletedAt);
  console.log('[C12] 連點 5 次之後的來訪筆數 =', visits.length,
    '／時段數 =', visits.map((v) => (v.slots ?? []).length));
  expect(visits, '連點 5 次只該寫進一筆來訪').toHaveLength(1);
  expect(visits[0].slots, '也只該有一個時段').toHaveLength(1);

  const ent = await app.readDoc('customers/cust-a/entitlements', 'ent-a');
  expect(ent.bookedCount, '次數只能加一次').toBe(1);
});

test('C13 連點 5 次「一鍵修正」→ 不會重複扣加', async ({ app, page }) => {
  const { scenarioBrokenCounts } = await import('../fixtures/data.js');
  await app.seed(scenarioBrokenCounts());
  await app.signIn('/customers/cust-e');

  await page.locator('[data-fix]').first().click();
  await expect(app.dialog()).toBeVisible();
  // 短逾時的理由同 C12：第一下之後確認框就關了，剩下四下點不到才是對的。
  const ok = page.locator('.dialog-backdrop [data-ok]');
  for (let i = 0; i < 5; i += 1) {
    await ok.click({ force: true, timeout: 1_000 }).catch(() => {});
  }
  await app.saved();

  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-e-vein');
  expect(ent.doneCount).toBe(1);
  expect(ent.bookedCount).toBe(0);
});

test('C11 跳過必填直接送出 → 擋下來，而且訊息指得出是哪一格', async ({ app, page }) => {
  await app.seed(baseSeed());
  await app.signIn('/customers/new');

  // 什麼都不填直接存
  await page.locator('[data-save], button[type="submit"]').first().click();
  // 等「講出是哪一格沒填」那句話真的出現 —— 那就是這一步該發生的事。
  await expect.poll(async () => app.text(), { timeout: 10_000 })
    .toMatch(/姓名|不可空白|先選/);

  const body = await app.text();
  console.log('[C11] 空表單送出之後 =', JSON.stringify(body.slice(0, 400)));
  expect(body, '要講出哪一格沒填').toMatch(/姓名|不可空白|先選/);

  const customers = (await app.readAll('customers')).filter((c) => !c.deletedAt);
  expect(customers, '不該寫進一筆空客戶').toHaveLength(1); // 只有種子那一位
});

test('C26 打一個不存在的網址 → 不白屏', async ({ app, page }) => {
  await app.seed(baseSeed());
  await app.signIn('/');

  for (const hash of [
    '/visits/does-not-exist',
    '/customers/nope',
    '/events/nope',
    '/settings/not-a-real-type',
    '/todo/not-a-real-group',
  ]) {
    await app.go(hash);
    const body = await page.locator('#view').innerText();
    console.log(`[C26] ${hash} → ${JSON.stringify(body.slice(0, 90))}`);
    expect(body.trim().length, `${hash} 不該是空白`).toBeGreaterThan(2);
  }
});

test('C24 抽屜／卡片／確認框開著時按返回鍵 → 關掉那一層，不是跳走整頁', async ({ app, page }) => {
  await app.seed([
    ...baseSeed(),
    visit({
      id: 'v1', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, 3), status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-a',
        startsAt: '10:00', endsAt: '11:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
      })],
    }),
  ]);
  await app.signIn('/calendar');

  const day = addDays(TODAY, 3);
  await page.locator(`[data-day="${day}"]`).first().click();
  await expect(page.locator('.drawer')).toBeVisible();

  await page.goBack();
  await expect(page.locator('.drawer'), '返回鍵要收掉抽屜').toHaveCount(0);
  expect(page.url(), '不該離開日曆').toContain('#/calendar');
});

test('C25 快速開關抽屜五次再換頁 → 層次對帳不會錯亂', async ({ app, page }) => {
  await app.seed(baseSeed());
  await app.signIn('/calendar');

  const day = addDays(TODAY, 3);
  for (let i = 0; i < 5; i += 1) {
    await page.locator(`[data-day="${day}"]`).first().click();
    await expect(page.locator('.drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer')).toHaveCount(0);
  }

  await app.go('/customers');
  await expect(page.locator('#view')).toContainText('客戶A');
  expect(page.url()).toContain('#/customers');

  // 再按一次返回鍵應該回到日曆，不是回到某一層殘留的抽屜
  await page.goBack();
  // **這一個固定等待是留著的。** 這一步要證明的是「**沒有**一層殘留的抽屜
  // 冒出來」，而證明某件事沒有發生天生需要等一段時間 —— 沒有任何「該發生的
  // 事」可以等（見 issue 02 列的兩種不要換掉的等待）。換成等 locator 的話
  // 等到的是「現在沒有」，而不是「一秒之內都沒有」。
  await page.waitForTimeout(1000);
  await expect(page.locator('.drawer'), '返回之後不該有殘留的抽屜').toHaveCount(0);
  console.log('[C25] 返回之後的網址 =', page.url());
});

// ---------------------------------------------------------------------------
// 全站掃一遍：每一頁都打開，蒐集 console error 與白屏。
// ---------------------------------------------------------------------------
test('C23 遍歷每一頁：沒有未捕獲例外、沒有白屏', async ({ app, page, errors }) => {
  await app.seed([
    ...baseSeed(),
    visit({
      id: 'v1', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, 3), status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-a',
        startsAt: '10:00', endsAt: '11:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
      })],
    }),
    note({ id: 'n1', text: '記得帶健保卡', date: addDays(TODAY, 1) }),
  ]);
  await app.signIn('/');

  const pages = [
    '/', '/customers', '/schedule', '/calendar', '/settings',
    '/customers/new', '/customers/bulk', '/customers/progress', '/customers/cust-a',
    '/customers/cust-a/bought',
    '/todo/confirm', '/todo/close', '/todo/notes', '/todo/ask', '/todo/forms', '/todo/book',
    '/todo/overdue', '/todo/today', '/todo/tomorrow', '/todo/cancel',
    '/todo/Examine', '/todo/耀聖',
    '/schedule/backfill',
    '/settings/trash', '/settings/health', '/settings/report', '/settings/audit',
    '/settings/merge', '/settings/preferences',
    '/settings/rooms', '/settings/courses', '/settings/staff', '/settings/equipment',
    '/settings/plans', '/settings/ivProducts', '/settings/products',
    '/settings/clinicalFlags', '/settings/naming', '/settings/partners', '/playbook',
  ];

  const empty = [];
  for (const hash of pages) {
    await app.go(hash);
    const body = await page.locator('#view').innerText();
    if (body.trim().length < 5 || body.includes('這一頁出錯了')) {
      empty.push([hash, body.slice(0, 120)]);
    }
  }

  console.log('[C23] 掃過', pages.length, '頁');
  if (empty.length) console.log('[C23] 空白或出錯的頁 =', JSON.stringify(empty, null, 1));
  if (errors.length) console.log('[C23] console 錯誤 =', JSON.stringify(errors, null, 1));

  expect(empty, '不該有頁面是空白或出錯的').toEqual([]);
});
