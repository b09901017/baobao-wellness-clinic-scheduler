// 資料健檢（`#/settings/health`）與次數對帳。
//
// ADR-0004：詳情頁**現算**、清單頁**讀快取**，兩邊對不起來時把差異顯示出來，
// **不自動偷改**。這一支就是去踩那條線。

import { test, expect } from '../fixtures/app.js';
import {
  scenarioBrokenCounts, masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

test('H0 一份乾淨的資料庫，資料健檢應該一條都不報', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a-vein', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 20,
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  console.log('[H0] 資料健檢全文 =\n' + body);
  expect(body).not.toMatch(/這一頁出錯了/);
});

test('H1 計數欄位歪掉 → 資料健檢列出來，客戶詳情顯示差異但不偷改', async ({ app, page }) => {
  await app.seed(scenarioBrokenCounts());
  await app.signIn('/settings/health');

  const health = await app.text();
  console.log('[H1] 資料健檢 =\n' + health.slice(0, 1500));
  expect(health, '次數對帳要抓到').toMatch(/次數對帳/);

  // 客戶詳情：顯示差異，畫面上用的是重算值
  await app.go('/customers/cust-e');
  const detail = await app.text();
  expect(detail).toContain('計數欄位與來訪對不起來');
  expect(detail).toContain('把計數欄位改成重算值');

  // 還沒按修正之前，資料庫裡的歪值要原封不動（ADR-0007：只算不寫）
  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-e-vein');
  expect(ent.doneCount, '沒按修正就不准動').toBe(5);
  expect(ent.bookedCount).toBe(3);
});

test('H2 按下「把計數欄位改成重算值」→ 真的改對，而且留得下稽核', async ({ app, page }) => {
  await app.seed(scenarioBrokenCounts());
  await app.signIn('/customers/cust-e');

  await page.locator('[data-fix]').first().click();

  // 修正是破壞性操作，會先跳二次確認並把前後值列出來（SPEC 6.5）
  await expect(app.dialog()).toBeVisible();
  const dialog = await app.dialogText();
  expect(dialog, '要講出改成什麼').toMatch(/已完成\s*5\s*→\s*1/);
  expect(dialog).toMatch(/已排未上\s*3\s*→\s*0/);
  await app.ok();
  await page.waitForTimeout(1500);

  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-e-vein');
  expect(ent.doneCount, '來訪只算得出 1 次已完成').toBe(1);
  expect(ent.bookedCount).toBe(0);

  const audit = await app.readAll('audit');
  expect(audit.length, '每一次寫入都要留稽核').toBeGreaterThan(0);
});

test('H3 客戶總覽讀快取、詳情頁現算 —— 兩邊刻意會不一樣（ADR-0004）', async ({ app }) => {
  await app.seed(scenarioBrokenCounts());
  await app.signIn('/customers');

  // 總覽讀的是 doneCount/bookedCount（5+3=8，剩 12）
  const list = await app.text();
  console.log('[H3] 客戶總覽 =', JSON.stringify(list.slice(0, 400)));

  await app.go('/customers/cust-e');
  const detail = await app.text();
  // 詳情現算：已完成 1、已排 0、剩 19
  expect(detail).toMatch(/已完成\s*1/);
  expect(detail).toMatch(/剩餘\s*19/);
});

test('H4 額度超用只提醒不擋，而且資料健檢列得出來', async ({ app }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-f', name: '客戶F' }),
    entitlement('cust-f', {
      id: 'ent-f', label: '靜脈', type: 'single', courseId: 'course-iv-laser',
      totalQty: 1, doneCount: 2, bookedCount: 1,
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  console.log('[H4] =\n' + body.slice(0, 1200));
  expect(body).toContain('額度超用');
});

test('H5 同一個月記了兩份可用性 → 列出來，但不自動合併（ADR-0053）', async ({ app }) => {
  const { availability } = await import('../fixtures/data.js');
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-g', name: '客戶G' }),
    entitlement('cust-g', {
      id: 'ent-g', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 10,
    }),
    availability('cust-g', {
      id: 'av-1', rawText: '9/6 那星期不行', validFrom: '2026-09-01', validTo: '2026-09-30',
    }),
    availability('cust-g', {
      id: 'av-2', rawText: '禮拜五都不行', validFrom: '2026-09-01', validTo: '2026-09-30',
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  expect(body).toContain('同一個月有兩份');

  // 不自動合併：兩份都還在
  const rows = await app.readAll('customers/cust-g/availability');
  expect(rows.filter((r) => !r.deletedAt)).toHaveLength(2);
});

test('H6 孤兒資料：指向不存在的課程的來訪要被列出來', async ({ app }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-h', name: '客戶H' }),
    entitlement('cust-h', {
      id: 'ent-h', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 10,
    }),
    visit({
      id: 'visit-orphan', customerId: 'cust-h', customerName: '客戶H',
      date: addDays(TODAY, 3), status: 'confirmed',
      slots: [{
        courseId: 'course-does-not-exist', courseName: '不存在的課',
        entitlementId: 'ent-h', startsAt: '10:00', endsAt: '11:00',
      }],
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  console.log('[H6] =\n' + body.slice(0, 1500));
  expect(body).toContain('孤兒資料');
});


// issue 04，2026-09-04：排班的兩個入口以前把主檔裡全部的品項列出來，所以
// 「營養點滴・護肝排毒」那筆額度底下排成別款是存得下去的。現在畫面預設就是
// 買的那一款、存檔會提醒 —— 但**已經存進去的那幾筆不會自己好**，
// 而她看不到。資料健檢就是讓她看得到它們的地方。
test('H8 已經存進去的品項錯配列得出來，而且不自動改', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-i', name: '客戶I' }),
    entitlement('cust-i', {
      id: 'ent-i-drip', label: '營養點滴・護肝排毒', type: 'single',
      courseId: 'course-iv-drip', totalQty: 6, durationMin: 60,
      // 次數要先對得起來，不然這一支會連帶抓到「次數對帳」那一項
      doneCount: 1, bookedCount: 0,
      ivProductId: 'iv-liver',
    }),
    visit({
      id: 'v-i-drip', customerId: 'cust-i', customerName: '客戶I',
      date: addDays(TODAY, -2), status: 'done',
      slots: [slot({
        courseId: 'course-iv-drip', entitlementId: 'ent-i-drip',
        startsAt: '10:00', endsAt: '11:00', roomId: 'room-iv8', bed: 'A',
        ivProductId: 'iv-heart', attended: true,
      })],
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  expect(body).toContain('品項跟買的不一樣');
  expect(body, '一列要講清楚買的是哪一款、排成了哪一款').toContain('買的是 護肝排毒');
  expect(body).toContain('排成了 護心抗老');

  // **不給一鍵修正** —— Abovee 上那一筆也要跟著改，那不是 app 做得到的事
  // **只數那一項的**：一頁上有十九項，而別項（例如「來訪上還記著床位」）
  // 本來就給得出一鍵修正 —— 數整頁的按鈕會被它們弄髒。
  const fixable = await page.locator('#view [data-check="ivMismatch"] [data-fix]').count();
  expect(fixable).toBe(0);
});

// 2026-10-05（abovee-and-master/12，ADR-0124）：種子補到跟 Abovee 一樣，而 `loadSeed()` 只建不覆蓋 ——
// 既有資料庫只能靠這一頁補。這一支拿一份「10/5 之前的主檔」把每一顆新的修正真的按下去：
// 規則在 `tests/master-catch-up.test.js`，這裡盯的是**寫得下去、寫完那一筆在設定頁還存得回去**。
test('H9 10/5 之前的主檔：治7 還原、少的點滴與新課建起來、空格補上，按完整頁沒有一項亮著', async ({ app, page }) => {
  const NEW = ['iv-vitality', 'iv-immune', 'iv-slim', 'iv-guard', 'iv-heal', 'iv-sleep', 'iv-shingles', 'course-fm', 'course-amnion',
    // 2026-10-06 補的六門（設定暫定）
    'course-hrv', 'course-retest', 'course-ha-prp', 'course-prp', 'course-moti', 'course-exercise'];
  const OLD_ROOMS = ['room-t5', 'room-t8'];
  const old = masterDocs()
    .filter((d) => !NEW.includes(d.id))
    .map((d) => {
      // 9/08 照這一頁的建議刪掉的那一間
      if (d.id === 'room-t7') return { ...d, data: { ...d.data, deletedAt: new Date('2026-09-08T10:00:00+08:00') } };
      if (d.path.endsWith('/courses')) {
        const { group, doctorPick, bookingMinutes, aboveeNames, ...rest } = d.data;
        const eecp = d.id.startsWith('course-eecp') ? { allowedRoomIds: OLD_ROOMS, preferredRoomIds: OLD_ROOMS } : {};
        return { ...d, data: { ...rest, ...eecp, ...(d.id === 'course-eecp-trial' ? { durationMin: 30 } : {}) } };
      }
      if (d.path.endsWith('/equipment') || d.path.endsWith('/ivProducts')) {
        const { aboveeNames, ...rest } = d.data;
        return { ...d, data: rest };
      }
      return d;
    });
  await app.seed(old);
  await app.signIn('/settings/health');

  const card = (id) => page.locator(`#view [data-check="${id}"]`);
  /** 那一項的修正全部按下去（不只一筆時是上面那顆「一次…」），等到那一項變成「沒問題」。 */
  const fix = async (id, say) => {
    await expect(card(id).locator('[data-fix]').first()).toBeVisible();
    const all = card(id).locator('[data-fix-all]');
    await ((await all.count()) ? all : card(id).locator('[data-fix]').first()).click();
    await expect(app.dialog()).toBeVisible();
    if (say) expect(await app.dialogText()).toContain(say);
    await app.ok();
    await app.saved();
    await expect(card(id)).toContainText('沒問題');
  };

  await expect(card('roomList')).toContainText('治7');
  await fix('roomList', '還原');
  await fix('seedIvProduct', '元氣活力');
  await fix('seedCourse', '功醫門診');
  await fix('courseDuration', '20 分');
  await fix('seedBlanks', 'Abovee 上的寫法');

  expect((await app.readDoc('config/app/rooms', 'room-t7')).deletedAt, '治7 回來了').toBeNull();
  const iv = (await app.readAll('config/app/ivProducts')).filter((x) => !x.deletedAt);
  expect(iv).toHaveLength(14);
  expect(iv.find((x) => x.id === 'iv-shingles').durationMin).toBe(30);
  const fm = await app.readDoc('config/app/courses', 'course-fm');
  expect([fm.uncounted, fm.needsTreatmentForm, fm.doctorPick]).toEqual([true, false, '功能／二返']);
  // 2026-10-06 的六門：建出來的那一筆整筆照抄種子 —— 暫定的小標、HRV 的不算次數與不用壓都帶著
  const hrv = await app.readDoc('config/app/courses', 'course-hrv');
  expect([hrv.provisional, hrv.uncounted, hrv.systems, hrv.lineName]).toEqual([true, true, [], '自律神經檢查']);
  expect((await app.readDoc('config/app/courses', 'course-prp')).provisional).toBe(true);
  expect(fm.provisional ?? null, '她答過的那一門不標').toBeNull();
  const eecp = await app.readDoc('config/app/courses', 'course-eecp');
  expect(eecp.allowedRoomIds).toEqual(['room-t5', 'room-t7', 'room-t8']);
  expect(eecp.group).toBe('EECP');
  const trial = await app.readDoc('config/app/courses', 'course-eecp-trial');
  expect([trial.durationMin, trial.aboveeNames]).toEqual([20, ['EECP20']]);
  expect((await app.readDoc('config/app/equipment', 'eq-laser')).aboveeNames).toEqual(['高能量']);
  expect((await app.readDoc('config/app/ivProducts', 'iv-snow')).aboveeNames).toEqual(['雪顏亮采']);
  const followup = await app.readDoc('config/app/courses', 'course-followup');
  expect([followup.bookingMinutes, followup.doctorPick]).toEqual([[30, 60], '功能／二返']);

  // 整頁沒有一項還亮著
  await expect(page.locator('#view [data-check] .badge--overdue')).toHaveCount(0);

  // 補過的那幾筆在設定頁打得開、原樣存得回去（補的那幾格沒有被驗證擋住）
  await app.go('/settings/courses');
  await expect(page.locator('[data-provisional-count]')).toContainText('還有 6 門的設定是暫定的');
  // HRV 三個都沒勾（不用壓）原樣存得回去，暫定的小標還在（編輯表不動那一格）
  await page.locator('[data-edit="course-hrv"]').click();
  await expect(page.locator('input[name="systems"]:checked')).toHaveCount(0);
  await page.click('button[type="submit"]');
  await app.saved();
  const again = await app.readDoc('config/app/courses', 'course-hrv');
  expect([again.provisional, again.systems, again.uncounted]).toEqual([true, [], true]);
  await page.locator('[data-edit="course-eecp"]').click();
  await page.click('button[type="submit"]');
  await app.saved();
  await page.locator('[data-edit="course-followup"]').click();
  await page.click('button[type="submit"]');
  await app.saved();
});

// 2026-10-06（course-form-and-sheet/04）：種子的人員補到跟 Abovee 的服務資源清單一樣（治療師 13、醫師 8）。
// 規則在 `tests/seed-staff.test.js`；這裡盯**那一顆按下去寫了什麼**：建新醫師的同時把原本三位空著的科別補上
// （同一個 commit）—— 分兩次的話她只按這一顆時，二返那一排最前面會變成兩位從來不看二返的人。
test('H10 10/6 之前的人員：一次建九位，夏、許、李的科別一起補上；建好的在設定頁存得回去', async ({ app, page }) => {
  const OLD = ['staff-tw', 'staff-zn', 'staff-lulu', 'staff-xy', 'staff-gy', 'staff-zx', 'staff-yt', 'staff-py', 'staff-wt',
    'staff-dr-xia', 'staff-dr-xu', 'staff-dr-li'];
  const old = masterDocs()
    .filter((d) => d.path !== 'config/app/staff' || OLD.includes(d.id))
    .map((d) => {
      if (d.path !== 'config/app/staff') return d;
      const { specialties, ...data } = d.data;
      return { ...d, data };
    });
  await app.seed(old);
  await app.signIn('/settings/health');

  const card = page.locator('#view [data-check="seedStaff"]');
  await expect(card.locator('[data-fix]')).toHaveCount(9);
  await expect(card).toContainText('同時把 夏、許、李 空著的科別補上「功能／二返」');
  await card.locator('[data-fix-all]').click();
  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('把這 9 位都建進治療師與醫師？');
  expect(said, '會多寫哪幾位要講在前面').toContain('同時補上 夏、許、李 空著的科別「功能／二返」');
  await app.ok();
  await app.saved();
  await expect(card).toContainText('沒問題');

  const staff = (await app.readAll('config/app/staff')).filter((x) => !x.deletedAt);
  expect(staff).toHaveLength(21);
  const by = Object.fromEntries(staff.map((x) => [x.id, x]));
  for (const id of ['staff-dr-xia', 'staff-dr-xu', 'staff-dr-li', 'staff-dr-zhang-ya', 'staff-dr-zhang-zheng']) {
    expect(by[id].specialties, id).toEqual(['功能／二返']);
  }
  expect(by['staff-dr-song'].specialties).toEqual(['復健科']);
  expect(by['staff-dr-jian'].specialties).toEqual(['心臟科']);
  expect(by['staff-dr-lin'].specialties ?? [], '判斷不了的那一位先不填').toEqual([]);
  expect(by['staff-pr'].role).toBe('物理治療師');
  expect(by['staff-dr-xia'].name, '原本那三位除了科別一個字都沒變').toBe('夏');

  // 補完之後「主檔有幾格還沒跟上」沒有人員的科別要補了
  await expect(page.locator('#view [data-check="seedBlanks"]')).not.toContainText('科別');

  // 建好的那一位在設定頁打得開、原樣存得回去
  await app.go('/settings/staff');
  await page.locator('[data-edit="staff-dr-zhang-ya"]').click();
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/staff', 'staff-dr-zhang-ya')).specialties).toEqual(['功能／二返']);
});
