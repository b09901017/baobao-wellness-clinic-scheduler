// 來訪編輯器的版面不變量。
//
// 這一支盯的是**畫面上長不長得出來**，不是業務規則 —— 規則在
// `domain/visits.js`，而且已經有 `tests/visits.test.js` 盯著。
// 這裡防的是「規則對了，但那一排沒有被畫出來／被畫成空的」那一類 bug，
// 而那一類在瀏覽器上看起來跟做對了很像。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { chips } from '../public/js/ui/components/form.js';

const SRC = readFileSync(
  new URL('../public/js/ui/views/visitEditor.js', import.meta.url), 'utf8',
);

/** 那一段時段卡的原始碼。 */
const slotCard = SRC.slice(SRC.indexOf('function slotCard('), SRC.indexOf('function slotXButton('));

// 她 2026-09-08：「我選復能四選一 三選一什麼的 為什麼會多一個空白的『課程』」
//
// 擇一池的課程是從器材推出來的（ADR-0075），所以 `coursesForEntitlement()`
// 那一排刻意是空的。而那一行只問了 `length === 1`，於是 `[]` 走進去畫了
// 一個「課程」標籤加一列什麼都沒有的丸子。
//
// 上面那段註解自己寫著這一條當初是為了 n返 加的 —— 修的時候只補了 `nth` 那一半。
describe('一排零顆的丸子畫不出來（issue 08）', () => {
  test('沒有選項就整排不畫 —— 一個標籤底下什麼都沒有看起來像壞掉', () => {
    assert.equal(chips({ name: 'x', label: '課程', value: null, options: [] }), '');
  });

  test('options 沒給也一樣', () => {
    assert.equal(chips({ name: 'x', label: '課程', value: null }), '');
  });

  test('一顆照樣畫得出來 —— 這一支不是「少於兩顆就不畫」', () => {
    const out = chips({ name: 'x', label: '課程', value: 'a', options: [{ value: 'a', label: 'A' }] });
    assert.match(out, /data-chip="x"/);
  });

  test('課程那一排的判斷是「不到兩個選項就不畫」', () => {
    assert.match(slotCard, /courseChoices\.length <= 1/,
      '=== 1 的話擇一池的空陣列會走進去畫一排空的');
  });
});

// 她 2026-09-08：「我選器材也沒有跟著產生選治療師或診間？…為什麼壓表那邊可以，
// 但這邊卻不行？他們的不是共用同一個邏輯嗎？」
//
// **domain 確實共用**（兩邊都呼叫 `assignsFor()`，`tests/visits.test.js` 還有
// 一條掃描盯著沒有人自己比 `assigns`）。壞掉的是它什麼時候被重算：
// 器材那一排掛著 `quiet: true`，而 `quiet` 的意思就是「選了不派 change」，
// 於是 `paint()` 不跑，那一排永遠不出現。
//
// 那個 `quiet` 是 `<select>` 時代留下來的 —— ADR-0075 讓器材開始決定課程
// 之後就錯了，只是沒人回頭改。同一個原因也讓禁忌提醒不會跟著換。
describe('換器材要重畫（issue 09）', () => {
  const equipmentField = SRC.slice(
    SRC.indexOf('function equipmentField('), SRC.indexOf('function doctorField('),
  );

  test('器材那一排不可以 quiet —— 課程、指派、禁忌提醒三件事都跟著它', () => {
    assert.match(equipmentField, /name: `s\$\{i\}-equip`/);
    assert.ok(!equipmentField.includes('quiet: true'),
      'quiet = 不派 change = paint() 不跑 = 治療師那一排永遠不出現');
  });

  test('額度那一排本來就沒有 quiet，維持不動', () => {
    const ent = slotCard.slice(slotCard.indexOf('name: `s${i}-ent`'));
    assert.ok(!ent.slice(0, 200).includes('quiet'));
  });

  for (const [what, name] of [['治療師', 's${i}-staff'], ['醫師', 's${i}-doc'], ['診間', 's${i}-room']]) {
    test(`${what}那一排照樣 quiet —— 換它不影響任何別的欄位（ADR-0038）`, () => {
      const at = SRC.indexOf(`name: \`${name}\``);
      assert.ok(at > 0, `找不到 ${name}`);
      assert.match(SRC.slice(at, at + 260), /quiet: true/);
    });
  }
});

// 空的理由分兩種，而它們該長得不一樣。
describe('那一排為什麼是空的', () => {
  test('沒有選項也沒有 hint → 整排不畫（擇一池的課程）', () => {
    assert.equal(chips({ name: 'x', label: '課程', options: [] }), '');
  });

  test('沒有選項但有 hint → 標籤與那一句留著（主檔裡還沒有人）', () => {
    const out = chips({ name: 'x', label: '治療師', options: [], hint: '主檔裡還沒有治療師' });
    assert.match(out, /治療師/);
    assert.match(out, /主檔裡還沒有治療師/);
    assert.ok(!out.includes('data-chip='), '一顆丸子都不要畫');
  });

  test('來訪編輯器的治療師那一排講得出「主檔裡還沒有」', () => {
    assert.match(slotCard, /主檔裡還沒有治療師/, '壓表那一頁講得出來，這裡也要');
  });
});

// 她 2026-09-08：「就請讓我只能修改這一個時段的東西，而不是讓我還可以新增
// 還可以修其他時段的東西」。
//
// 每一條進得了編輯器的路**本來就知道是哪一段**（日／週那一列的 `data-open`
// 從 ADR-0080 起就是三格），只是進去之後把那個數字丟掉了。
describe('改一筆來訪＝改那一段（issue 07）', () => {
  const CAL = readFileSync(
    new URL('../public/js/ui/views/calendar.js', import.meta.url), 'utf8',
  );

  test('mountEdit() 收得到 slotIndex', () => {
    assert.match(SRC, /export async function mountEdit\(el, \{ visitId, slotIndex = null/);
  });

  test('讀取卡片上的鉛筆把她點的那一段帶過去', () => {
    const at = CAL.indexOf("kind: 'visit', visitId: visit.id, date: visit.date, backDate: date");
    assert.ok(at > 0, '找不到讀取卡片的鉛筆');
    assert.match(CAL.slice(at, at + 120), /slotIndex: focus/);
  });

  test('長按選單的「改這一筆」也帶', () => {
    const at = CAL.indexOf("if (action === 'edit')");
    assert.ok(at > 0);
    assert.match(CAL.slice(at, at + 300), /slotIndex/);
  });

  test('抽屜那一層轉手時不可以掉', () => {
    assert.match(CAL, /visitEditor\.mountEdit\(host, \{ visitId: spec\.visitId, slotIndex: spec\.slotIndex/);
  });

  test('沒畫出來的那一段整個回原本那一個物件，不是重組一份', () => {
    const at = SRC.indexOf('function readDraft(');
    const body = SRC.slice(at, at + 1600);
    assert.match(body, /if \(!isEditable\(ctx, i\)\) return slot;/,
      '重組的話 attended／status 那幾格會被底下寫死的 null 清掉');
  });

  test('只畫一段時「＋新增一個時段」不出現', () => {
    assert.match(SRC, /ctx\.canAddSlots \? `/);
    assert.match(SRC, /canAddSlots: !existing/);
  });

  // 這一段的歷史：2026-09-10 把整筆那兩塊從「摺起來」改成「帶了 slotIndex
  // 就不畫」（ADR-0085／0088），第二條路是日曆讀取卡片底下那一顆「改這一天」。
  //
  // **2026-09-12 整個拿掉**（ADR-0089）。她：「並且也不需要出現改這一整天的
  // 按鈕，如果要改我也會一項一項改」，追問之後「整個拿掉，兩件事都不要了」。
  // 取消一整天的第二條路是壓表的批次取消（ADR-0082），改日期與刪除這一天
  // 她說不要了。
  test('整筆的那幾顆一顆都不畫了', () => {
    // 比的是那一摺的標記，不是那四個字 —— 她的原話裡就有那四個字，
    // 而它是這一段程式為什麼長這樣的理由，不可以被一支測試逼著刪掉。
    assert.equal(SRC.includes('<summary class="advanced__head">這一天整筆的'), false,
      '摺起來不算拿掉（ADR-0085）');
    assert.ok(!SRC.includes('function statusCard'), '整天的狀態卡還在');
    assert.ok(!SRC.includes('function dangerZone'), '危險區還在');
  });

  test('沒畫出來就不接線 —— 接在 null 上會讓整頁停在「載入中…」', () => {
    assert.ok(!SRC.includes('wireStatus('), '那一塊不在了，接線也不該在');
    assert.ok(!SRC.includes('wireDangerZone('), '那一塊不在了，接線也不該在');
  });
});

// 她 2026-09-08：「為什麼同一個人可以來訪一次裡面有兩項 然後又可以同一天
// 再來訪一次然後一項？」—— 壓表會併、日曆不查，同一件事兩種樣子。
describe('一人一天一筆（issue 04）', () => {
  const SCH = readFileSync(
    new URL('../public/js/ui/views/schedule.js', import.meta.url), 'utf8',
  );

  test('日曆新增時先找同一天那一筆', () => {
    assert.match(SRC, /sameDayState\(customerVisits, customer\.id, day\)/);
  });

  // **兩軸審查各自獨立抓到的那一個**：`existing ?? merging` 再一律
  // `withNewSlot()`，於是改一筆既有的來訪也會被偷偷接上一段空的。
  test('要編哪一筆、要不要接新的一段，走 domain 那一支', () => {
    assert.match(SRC, /const target = editorTarget\(\{ existing, open: sameDay\.open \}\);/);
    assert.match(SRC, /target\.addSlot \? withNewSlot\(base, entitlements, all, settings\) : \{ \.\.\.base \}/);
  });

  // **2026-09-16 起那一句每次重畫都算一次**（`sameDayNote()`）：以前是在
  // `boot()` 算好一份 `closedToday`，而她改了日期之後那一句就在講另一天的事。
  test('那一天已經結案時要講一句 —— 壓表早就講得出來，日曆以前什麼都不說', () => {
    assert.match(SRC, /function sameDayNote\(ctx, draft\)/);
    assert.match(SRC, /sameDayState\(ctx\.customerVisits, ctx\.customer\.id, draft\.date\)/);
    assert.match(SRC, /所以這是另外一次來訪/);
  });

  test('那一天已經有一段時也要講一句 —— 存下去只會有一筆（ADR-0083）', () => {
    assert.match(SRC, /存下去會加進那一天的那一筆/);
  });

  // **2026-09-16 判準從 `isNew` 換成 `isNewDoc`**（報告 §1.2）：
  // 併進同一天既有那一筆時 `isNew` 也是 true，所以那條路照樣畫得出日期欄，
  // 而改它會把那一天原本那幾段一起搬走。細節在同一支測試檔的
  //「日期那一格給不給改」那一組。
  test('只改一段時「來訪日期」不給改 —— 它是整筆的', () => {
    assert.match(SRC, /\$\{wholeVisit \|\| isNewDoc \? `/);
  });

  test('壓表走同一支，不自己比一份狀態清單', () => {
    const at = SCH.indexOf('function sameDayVisit(row, date)');
    assert.ok(at > 0);
    const body = SCH.slice(at, SCH.indexOf('\n}', at));
    assert.match(body, /sameDayVisitFor\(/);
    assert.ok(!body.includes('acceptsMoreSlots('), '兩份判斷遲早有一份漏掉一個狀態');
  });

  test('併進來時只有新加的那一段改得動', () => {
    assert.match(SRC, /target\.merged \? \[base\.slots\.length\] : null/);
  });

  test('Abovee 那一道問的是「有沒有新的時段」，不是「這筆來訪是新的」', () => {
    assert.match(SRC, /if \(hasNewSlots\(ctx, draft\)\) \{/);
    assert.ok(!SRC.includes('if (isNew) {'), 'isNew 在併進來的時候是 false，那一道會整個不問');
  });

  test('確認框只列這一次新加的那幾段', () => {
    assert.match(SRC, /draft\.slots\.slice\(ctx\.storedSlotCount \?\? 0\)/);
  });

  test('那顆 × 逐段問「存過了沒」，不是問整筆', () => {
    const at = SRC.indexOf('function slotXButton(');
    const body = SRC.slice(at, SRC.indexOf(String.fromCharCode(10) + '}', at))
      // 註解裡照樣講得到 `ctx.isNew` —— 那一段就是在解釋為什麼不能問它
      .split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith('//'))
      .join(String.fromCharCode(10));
    assert.match(body, /i < \(ctx\.storedSlotCount \?\? 0\)/);
    assert.ok(!body.includes('ctx.isNew'), '新加的那一段走取消那條路會長出一張假的「取消 Abovee」');
  });
});

// 她 2026-09-09：「我也根本不需要知道這天還有另外多少個時段，不需要。」
describe('日期那一格給不給改（報告 §1.2）', () => {
  test('條件問的是「這份文件是新的嗎」，不是「她按的是新增嗎」', () => {
    // `isNew: !existing` 對**併進同一天既有那一筆**也是 true —— 那條路
    // 改日期會把那一天原本那幾段一起搬走。
    assert.doesNotMatch(SRC, /wholeVisit \|\| isNew/,
      '問 isNew 的話，併進既有那一天時日期欄照樣畫得出來');
    assert.match(SRC, /wholeVisit \|\| isNewDoc/);
  });

  test('那一格寫回去的是整筆的日期 —— 所以它只能在新文件上出現', () => {
    assert.match(SRC, /date: v\.date \|\| draft\.date/);
  });
});

describe('畫面上一律講那一段（issue 06）', () => {
  const CAL2 = readFileSync(
    new URL('../public/js/ui/views/calendar.js', import.meta.url), 'utf8',
  );
  const code = CAL2
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//'))
    .join(String.fromCharCode(10));

  test('讀取卡片抬頭印那一段的狀態', () => {
    assert.match(code, /describeStatus\(statusForCard\(visit, focus\)\)/);
  });

  test('長按選單抬頭也是', () => {
    assert.match(code, /describeStatus\(statusForCard\(visit, slotIndex\)\)/);
  });

  test('「共 N 段」一個字都不剩', () => {
    assert.ok(!/共 \$\{slots\.length\} 段/.test(code));
  });

  // 那個數字本來是煞車（要按的是真的會取消五段的按鈕，ADR-0070）——
  // **2026-09-12 連那一顆一起拿掉了**（ADR-0089），所以連煞車都不需要了。
  test('「取消一整天（N 段）」那一顆不在了', () => {
    const dom = readFileSync(
      new URL('../public/js/domain/visits.js', import.meta.url), 'utf8',
    );
    // 比的是那一顆真的會產生的字串，不是那四個字 —— 檔頭寫著它為什麼被
    // 拿掉，而那段歷史不可以被一支測試逼著刪掉。
    assert.ok(!dom.includes('取消一整天（${slots.length} 段）'), '整天那一顆還在');
  });
});

// 她 2026-09-08：「我希望當我按下紀錄這『些』來訪…可以先提醒那個時段會導致
// 超過次數、那個時段沒有選醫生診間等等，如果沒有就可以不用提醒。然後我按下
// 了解之類的，才會再跳出壓 abovee 了嗎 的那些提醒。」
describe('兩道確認框的順序（issue 10）', () => {
  const code = SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//'))
    .join(String.fromCharCode(10));

  test('表單最上面那張「提醒」卡整個不見了', () => {
    assert.ok(!code.includes('warningsHtml'), '她說「最上面就不需要還有一個提醒了」');
    assert.ok(!code.includes("card__title\">提醒"));
  });

  test('errors 那一塊留著 —— 那是擋著不讓存的，不是提醒', () => {
    assert.match(code, /data-errors/);
  });

  // **兩個入口共用一支**（`confirmReview()`）。各自把 `reviewWarnings()` 的
  // 四個欄位攤開餵進 `confirmAction()` 的話，遲早有一邊漏掉 `cancelLabel`，
  // 而那顆按鈕就會變回意思模糊的「取消」。
  test('第一道走共用那一支，畫面不自己組句子', () => {
    assert.match(code, /if \(!await confirmReview\(warnings\)\) return;/);
    assert.ok(!code.includes('confirmLabel: review.'), '把欄位攤開就是第二份實作');
  });

  test('第一道排在 Abovee 那一道前面', () => {
    const a = code.indexOf('confirmReview(warnings)');
    const b = code.indexOf('bookingConsequences({');
    assert.ok(a > 0 && b > 0 && a < b, '順序反了');
  });

  test('沒有 warnings 就不跳第一道 —— 閘門在 confirmReview() 裡', () => {
    const dlg = readFileSync(
      new URL('../public/js/ui/components/dialog.js', import.meta.url), 'utf8',
    );
    assert.match(dlg, /if \(!said\) return true;/);
  });

  test('兩顆按鈕都講出按下去會怎樣', () => {
    const dom = readFileSync(
      new URL('../public/js/domain/consequences.js', import.meta.url), 'utf8',
    );
    assert.match(dom, /confirmLabel: '知道了，繼續'/);
    assert.match(dom, /cancelLabel: '回去改'/);
  });
});
