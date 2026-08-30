// 沉浸式 UI/UX 審查：對比度、字級、觸控目標、橫向溢出、深色模式、載入狀態。
//
// 這一支**大部分不是 pass/fail，是量測**：把數字印出來，判斷留給人。
// 只有三件事是硬性的（會讓測試紅掉）：
//   1. 手機寬度下 body 不可以橫向捲動
//   2. 深色模式不可以有「背景與前景同色」那種看不見的字
//   3. 破壞性操作一定要有二次確認

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, note, event, TODAY, addDays,
} from '../fixtures/data.js';

const PAGES = [
  ['/', '待辦中心'],
  ['/customers', '客戶總覽'],
  ['/customers/cust-a', '客戶詳情'],
  ['/schedule', '壓表起點'],
  ['/calendar', '日曆'],
  ['/settings', '設定'],
  ['/todo/close', '簽療程單'],
  ['/todo/notes', '隨手記'],
  ['/settings/health', '資料健檢'],
  ['/customers/progress', '進度追蹤'],
];

function richSeed() {
  return [
    ...masterDocs(),
    customer({
      id: 'cust-a', name: '客戶A', priority: 4, flags: ['體內金屬'],
      marks: [{ text: '喜歡下午', color: 'teal' }, { text: '指定騰崴', color: 'plum' }],
    }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12, bookedCount: 1,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    entitlement('cust-a', {
      id: 'ent-b', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 20,
    }),
    visit({
      id: 'v1', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, -1), status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-a',
        startsAt: '10:00', endsAt: '11:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
      })],
    }),
    note({ id: 'n1', text: '下次記得帶健保卡', date: TODAY, customerId: 'cust-a', customerName: '客戶A' }),
    event({ id: 'e1', title: '宜蘭休假', category: 'leave', startDate: addDays(TODAY, 2), endDate: addDays(TODAY, 4) }),
    event({ id: 'e2', title: '高齡演講', category: 'personal', startDate: addDays(TODAY, 6), color: 'plum' }),
  ];
}

/** WCAG 相對亮度對比。 */
const contrast = `(function () {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => (s.match(/[\\d.]+/g) ?? []).slice(0, 3).map(Number);
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const p = parse(bg);
      if (p.length === 3 && !/rgba\\(.*,\\s*0\\)/.test(bg)) return p;
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const out = [];
  for (const el of document.querySelectorAll('#view *')) {
    if (!el.childNodes.length) continue;
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (fg.length !== 3) continue;
    const l1 = lum(fg);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    out.push({
      text: text.slice(0, 24),
      size: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      ratio: Math.round(ratio * 100) / 100,
    });
  }
  return out;
})()`;

for (const theme of ['light', 'dark']) {
  test(`U5+U6 ${theme === 'dark' ? '深色' : '淺色'}模式：對比度量測`, async ({ app, page }) => {
    await app.seed(richSeed());
    await page.addInitScript((t) => {
      try { localStorage.setItem('scheduler.theme', t); } catch { /* 無痕 */ }
    }, theme);
    await app.signIn('/');

    const bad = [];
    for (const [hash, label] of PAGES) {
      await app.go(hash);
      const rows = await page.evaluate(contrast);
      // WCAG AA：一般文字 4.5、大字（>=18.66px 或 >=14px 粗體）3.0
      for (const r of rows) {
        const large = r.size >= 18.66 || (r.size >= 14 && Number(r.weight) >= 700);
        const need = large ? 3 : 4.5;
        if (r.ratio < need) bad.push({ page: label, ...r, need });
      }
      await page.screenshot({
        path: `.artifacts/shots/${theme}-${label}.png`, fullPage: true,
      });
    }

    // 依比值排序，最糟的先講
    bad.sort((a, b) => a.ratio - b.ratio);
    console.log(`[U6-${theme}] 對比度不足 ${bad.length} 處，最糟的 15 處：`);
    for (const b of bad.slice(0, 15)) {
      console.log(`  ${b.ratio}:1（需要 ${b.need}）${b.size}px ${b.page}「${b.text}」`);
    }

    // 硬性：完全看不見的字（比值 < 1.6 幾乎等於同色）一個都不能有
    const invisible = bad.filter((b) => b.ratio < 1.6);
    expect(invisible, `${theme} 模式有幾乎看不見的字`).toEqual([]);
  });
}

test('U7+U8 字級與觸控目標量測', async ({ app, page }) => {
  await app.seed(richSeed());
  await app.signIn('/');

  const tiny = [];
  const small = [];
  for (const [hash, label] of PAGES) {
    await app.go(hash);

    const t = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#view *')) {
        const text = [...el.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim()).join('');
        if (!text) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 12) out.push({ text: text.slice(0, 20), size });
      }
      return out;
    });
    for (const x of t) tiny.push({ page: label, ...x });

    const s = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#view button, #view a, #view input, #view [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.width < 40 || r.height < 40) {
          out.push({
            label: (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 20),
            w: Math.round(r.width), h: Math.round(r.height),
          });
        }
      }
      return out;
    });
    for (const x of s) small.push({ page: label, ...x });
  }

  console.log(`[U7] 小於 12px 的文字 ${tiny.length} 處：`);
  for (const x of tiny.slice(0, 20)) console.log(`  ${x.size}px ${x.page}「${x.text}」`);

  console.log(`[U8] 觸控目標小於 40×40 的 ${small.length} 個：`);
  const seen = new Set();
  for (const x of small) {
    const key = `${x.page}|${x.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${x.w}×${x.h} ${x.page}「${x.label}」`);
  }
});

test('U9 手機寬度下 body 不可以橫向捲動', async ({ app, page }) => {
  await app.seed(richSeed());
  await app.signIn('/');

  const overflow = [];
  for (const [hash, label] of PAGES) {
    await app.go(hash);
    const info = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      wide: [...document.querySelectorAll('#view *')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2)
        .slice(0, 4)
        .map((el) => `${el.tagName}.${el.className}`.slice(0, 60)),
    }));
    if (info.scrollW > info.clientW + 2) overflow.push({ page: label, ...info });
  }

  console.log('[U9] 橫向溢出 =', JSON.stringify(overflow, null, 1));
  expect(overflow, '手機上整頁不該左右捲').toEqual([]);
});

test('U12 破壞性操作一定要有二次確認，而且講出後果', async ({ app, page }) => {
  await app.seed([
    ...richSeed(),
    note({ id: 'n-done', text: '已經做完的一件事', done: true, doneAt: new Date().toISOString() }),
  ]);
  await app.signIn('/todo/notes');

  await page.locator('[data-notes-tab="done"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-clear-done]').click();

  await expect(app.dialog(), '清掉是破壞性操作，要先問').toBeVisible();
  const text = await app.dialogText();
  console.log('[U12] 清掉隨手記的確認框 =', JSON.stringify(text));
  expect(text, '要講出筆數').toMatch(/\d+\s*筆/);
  expect(text, '要講出還原得回來').toMatch(/還原|已刪除項目/);
  await app.cancelDialog();

  // 按了取消就什麼都不該發生
  await page.waitForTimeout(600);
  const notes = (await app.readAll('notes')).filter((n) => !n.deletedAt);
  expect(notes.some((n) => n.id === 'n-done'), '取消之後那一筆要還在').toBe(true);
});

// 這一條路以前沒有任何測試走過，而它是壞的：`calendar.js` 傳給 confirmAction 的
// 參數名是 `body` / `confirm`，而簽章要的是 `consequences` / `confirmLabel`。
// 於是元件對 undefined 做 .map() 丟出 TypeError，而它發生在 Promise 的執行器裡 ——
// 對話框一次都沒出現、那筆待辦永遠刪不掉，畫面上一個字都不說（SPEC 6.9）。
//
// fixture 會把未捕獲的 pageerror 判成失敗，所以**光是走過這條路**就守得住它；
// 底下的斷言是為了讓壞掉的時候一眼看出壞在哪一步。
test('U13 日曆上刪掉一筆待辦：確認框出得來，而且真的刪得掉', async ({ app, page }) => {
  await app.seed(richSeed());
  await app.signIn('/calendar');

  // 點那一天 → 底部滑出 → 點那一筆待辦 → 浮出讀取卡片 → 鉛筆 → 編輯器
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-open^="note:"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-card-edit]').click();
  await page.waitForTimeout(600);

  await page.locator('[data-drop]').click();

  await expect(app.dialog(), '刪掉是破壞性操作，要先問').toBeVisible();
  const text = await app.dialogText();
  console.log('[U13] 日曆刪待辦的確認框 =', JSON.stringify(text));
  expect(text, '要講出還原得回來').toMatch(/還原|已刪除項目/);
  await app.ok();
  await page.waitForTimeout(1200);

  const gone = await app.readDoc('notes', 'n1');
  expect(gone.deletedAt, '按了確定就要真的刪掉（軟刪除）').not.toBe(null);
});

test('U14 取消刪除就什麼都不該發生', async ({ app, page }) => {
  await app.seed(richSeed());
  await app.signIn('/calendar');

  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-open^="note:"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-card-edit]').click();
  await page.waitForTimeout(600);

  await page.locator('[data-drop]').click();
  await expect(app.dialog()).toBeVisible();
  await app.cancelDialog();
  await page.waitForTimeout(600);

  const still = await app.readDoc('notes', 'n1');
  expect(still.deletedAt, '按了取消那一筆要還在').toBe(null);
});

test('U15 日曆七種東西各自畫得出來、而且分得出來', async ({ app, page }) => {
  await app.seed(richSeed());
  await app.signIn('/calendar');

  const legend = await app.text();
  for (const kind of ['客戶來訪', '待辦', '行事備註', '休假', '待確認', '已確認', '已完成', '未到']) {
    expect(legend, `圖例上要有「${kind}」`).toContain(kind);
  }

  // 休假走斜線紋、待辦走方框勾勾 —— 因為色相已經用完了（ADR-0039、0045）
  const paints = await page.evaluate(() => {
    const out = {};
    for (const sel of ['.kind-leave', '.kind-todo', '.kind-personal']) {
      const el = document.querySelector(`#view ${sel}`);
      if (!el) { out[sel] = null; continue; }
      const cs = getComputedStyle(el);
      out[sel] = { bg: cs.backgroundColor, image: cs.backgroundImage.slice(0, 60), color: cs.color };
    }
    return out;
  });
  console.log('[U15] 三種畫法 =', JSON.stringify(paints, null, 1));

  await page.screenshot({ path: '.artifacts/shots/calendar-month.png', fullPage: true });
});

test('U10 每一個存檔動作都要有「儲存中」，不可以靜默', async ({ app, page }) => {
  await app.seed(richSeed());
  await app.signIn('/todo/notes');

  // 記一筆，觀察 toast 有沒有出現
  await page.locator('[data-quick]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-quicktext]').fill('測試一下有沒有儲存中');

  const seen = [];
  const stop = setInterval(async () => {
    const t = await page.locator('#toast').innerText().catch(() => '');
    if (t && !seen.includes(t)) seen.push(t);
  }, 60);

  await page.locator('.drawer [type="submit"], .drawer [data-save]').first().click().catch(() => {});
  await page.waitForTimeout(2500);
  clearInterval(stop);

  console.log('[U10] toast 出現過的字 =', JSON.stringify(seen));
  expect(seen.join('｜'), '存完要講一聲').toMatch(/記下來了|已儲存|儲存中/);
});

test('U17 空狀態：一筆資料都沒有的時候每一頁都要講人話', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/');

  const empties = [];
  for (const [hash, label] of PAGES.filter(([h]) => !h.includes('cust-a'))) {
    await app.go(hash);
    const body = await app.text();
    empties.push([label, body.replace(/\n+/g, ' ').slice(0, 110)]);
    expect(body.trim().length, `${label} 空狀態不該是空白`).toBeGreaterThan(8);
  }
  console.log('[U17] 空狀態：');
  for (const [label, body] of empties) console.log(`  ${label} → ${body}`);
});
