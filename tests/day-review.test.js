// 「今天做了什麼」。ADR-0062。
//
// 這一頁的價值全部在**歸類對不對**：她開它是為了確認「有沒有漏掉登記」，
// 而一則落錯段、或是被安靜地丟掉，正好毀掉那個用途。
//
// 素材是既有的稽核紀錄，一則都不多寫（SPEC 第 6.2 節）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { reviewOf, visitIdsIn, dayTitle, NOBODY } from '../public/js/domain/dayReview.js';

/** 一則稽核。`after` 是這一次寫進去的那幾欄，`before` 是寫之前。 */
const ev = (action, { before = {}, after = {}, at = 'T' } = {}) => ({
  action, before, after, at, targetPath: `${action.split('.')[0]}/x`,
});

/** 那一段裡的句子。 */
const textsOf = (review, id) =>
  review.groups.find((g) => g.stage.id === id)?.rows.map((r) => r.text) ?? [];

const idsOf = (review) => review.groups.map((g) => g.stage.id);

/** 濾掉的那幾則的句子（ADR-0071）。 */
const hiddenTexts = (review) => review.hiddenRows.map((r) => r.text);

describe('照她的流程分段', () => {
  test('新增一筆來訪 → 壓表', () => {
    const review = reviewOf([ev('visits.create', {
      after: { customerName: '客戶A', date: '2026-09-03', status: 'pending_confirm' },
    })]);
    assert.deepEqual(idsOf(review), ['book']);
    // 句子由 domain/audit.js 翻譯，這裡只確認歸類對了、而且那一句
    // 講得出誰與哪一天（那一支的測試盯著完整的寫法）
    assert.deepEqual(textsOf(review, 'book'), ['新增 客戶A・9/3(四)']);
  });

  test('狀態改成已確認 → 跟客人確認', () => {
    const review = reviewOf([ev('visits.update', {
      before: { customerName: '客戶A', status: 'pending_confirm' },
      after: { status: 'confirmed' },
    })]);
    assert.deepEqual(idsOf(review), ['confirm']);
  });

  test('「禮拜一再問問」也算在跟客人確認那一段', () => {
    const review = reviewOf([ev('visits.update', {
      before: { customerName: '客戶A', followupNote: null },
      after: { followupNote: '禮拜一再問問' },
    })]);
    assert.deepEqual(idsOf(review), ['confirm']);
  });

  test('狀態改成已完成／未到 → 簽療程單', () => {
    for (const status of ['done', 'no_show']) {
      const review = reviewOf([ev('visits.update', {
        before: { customerName: '客戶A', status: 'confirmed' },
        after: { status },
      })]);
      assert.deepEqual(idsOf(review), ['close'], status);
    }
  });

  test('狀態改成已取消 → 取消與改期', () => {
    const review = reviewOf([ev('visits.update', {
      before: { customerName: '客戶A', status: 'confirmed' },
      after: { status: 'cancelled' },
    })]);
    assert.deepEqual(idsOf(review), ['cancel']);
  });

  // 這一段叫「取消與改期」，而改期以前落進最後的「其他」——
  // 段落名在講一件它收不到的事。
  test('改一筆來訪的日期算在取消與改期那一段', () => {
    const review = reviewOf([ev('visits.update', {
      before: { customerName: '客戶A', date: '2026-09-14', status: 'confirmed' },
      after: { date: '2026-09-20' },
    })]);
    assert.deepEqual(idsOf(review), ['cancel']);
  });

  test('刪掉一筆來訪也算在取消那一段', () => {
    const review = reviewOf([ev('visits.softDelete', {
      before: { customerName: '客戶A' },
      after: { deletedAt: 'T' },
    })]);
    assert.deepEqual(idsOf(review), ['cancel']);
  });

  test('勾掉一張任務 → 登記掛號；**拿回來不算**', () => {
    const ticked = reviewOf([ev('tasks.update', {
      before: { customerName: '客戶A', kind: 'Examine', done: false },
      after: { done: true },
    })]);
    assert.deepEqual(idsOf(ticked), ['register']);

    // 拿回來是把一件事放回去，不是做完它 —— 落到「其他」，而「其他」
    // 這一頁不印（ADR-0071）。但它照樣數得出來、點得開。
    const unticked = reviewOf([ev('tasks.update', {
      before: { customerName: '客戶A', kind: 'Examine', done: true },
      after: { done: false },
    })]);
    assert.deepEqual(idsOf(unticked), []);
    assert.equal(unticked.hidden, 1);
    assert.deepEqual(hiddenTexts(unticked), ['拿回來 客戶A・Examine']);
  });

  // 2026-09-04 她說「好啊可以另外開一段給它」。在這之前它落進④「登記掛號」，
  // 而段落名在講一件它收不到的事。ADR-0066。
  describe('「寫紀錄」自己一段', () => {
    const tick = (kind) => ev('tasks.update', {
      before: { customerName: '客戶A', kind, done: false },
      after: { done: true },
    });

    test('勾掉一張「寫紀錄」→ 落在寫紀錄那一段，不在登記掛號', () => {
      const review = reviewOf([tick('寫紀錄')]);
      assert.deepEqual(idsOf(review), ['record']);
    });

    test('掛號那一族照舊落在登記掛號', () => {
      assert.deepEqual(idsOf(reviewOf([tick('Examine')])), ['register']);
      assert.deepEqual(idsOf(reviewOf([tick('耀聖')])), ['register']);
    });

    test('拿回來一張「寫紀錄」還是不算做了 —— 不列出來，但數得出來', () => {
      const review = reviewOf([ev('tasks.update', {
        before: { customerName: '客戶A', kind: '寫紀錄', done: true },
        after: { done: false },
      })]);
      assert.deepEqual(idsOf(review), []);
      assert.equal(review.hidden, 1);
    });

    test('讀不出種類的（舊的稽核沒有 before）照舊落在登記掛號 —— 一則都不可以掉', () => {
      const review = reviewOf([ev('tasks.update', { before: {}, after: { done: true } })]);
      assert.deepEqual(idsOf(review), ['register']);
    });

    test('照人分組時也在，而且只出現一次', () => {
      const review = reviewOf([tick('寫紀錄')]);
      const mine = review.people.find((x) => x.who === '客戶A');
      assert.equal(mine.n, 1);
      assert.deepEqual(mine.rows.map((r) => r.stage), ['寫紀錄']);
    });
  });

  test('隨手記與行事備註 → 日曆與待辦', () => {
    const review = reviewOf([
      ev('notes.create', { after: { text: '幫王小明問週六' } }),
      ev('events.create', { after: { title: '宜蘭休假', category: 'leave' } }),
    ]);
    assert.deepEqual(idsOf(review), ['calendar']);
    assert.equal(textsOf(review, 'calendar').length, 2);
  });

  test('客戶與額度各自落在同一段', () => {
    const review = reviewOf([
      ev('customers.update', { before: { name: '客戶A', phone: '1' }, after: { phone: '2' } }),
      ev('customers/abc/entitlements.create', { after: { label: '8萬健檢', totalQty: 1 } }),
    ]);
    assert.deepEqual(idsOf(review), ['customer']);
  });

  test('療程單：新增與換照片落在「客戶與額度」；清掉舊照片檔收進「另外 N 則」（issue 14）', () => {
    const at = (action, o) => ({ ...ev(action, o), targetPath: 'customers/abc/treatmentSheets/s1' });
    const review = reviewOf([
      at('customers/abc/treatmentSheets.create', { before: null, after: { customerName: '客戶A', courseName: '復能', rows: [] } }),
      at('customers/abc/treatmentSheets.update', {
        before: { customerName: '客戶A', courseName: '復能', rows: [], photoPath: 'a' }, after: { photoPath: 'b', rows: [{}] },
      }),
      at('customers/abc/treatmentSheets.update', {
        before: { customerName: '客戶A', courseName: '復能', stalePhotoPaths: ['a'] }, after: { stalePhotoPaths: [] },
      }),
    ]);
    assert.deepEqual(idsOf(review), ['customer']);
    assert.equal(textsOf(review, 'customer').length, 2);
    assert.equal(review.hidden, 1);
  });

  // 2026-09-04 她決定設定那一段收進「另外 N 則」。**那一段仍然在 STAGES 上**
  // —— 那一則還是有它的段，只是這一頁不印。
  test('主檔設定收進「另外 N 則」', () => {
    const review = reviewOf([ev('config/courses.create', { after: { name: '復能' } })]);
    assert.deepEqual(idsOf(review), []);
    assert.equal(review.hidden, 1);
  });

  test('問時間那三種收在同一段', () => {
    const review = reviewOf([
      ev('formInvites.create', { after: { customerName: '客戶A' } }),
      ev('formResponses.update', { before: { customerName: '客戶A' }, after: { accepted: true } }),
      ev('customers/abc/availability.create', { after: { collectedAt: '2026-09-01' } }),
    ]);
    assert.deepEqual(idsOf(review), ['ask']);
    assert.equal(textsOf(review, 'ask').length, 3);
  });

  test('段落照流程排，不照進來的順序', () => {
    const review = reviewOf([
      ev('visits.update', {
        before: { customerName: '客戶A', status: 'confirmed' },
        after: { status: 'done' },
      }),
      ev('visits.create', { after: { customerName: '客戶A' } }),
      ev('formInvites.create', { after: { customerName: '客戶B' } }),
    ]);
    assert.deepEqual(idsOf(review), ['ask', 'book', 'close']);
  });
});

// ADR-0071 把 ADR-0062 的「一則都不可以被丟掉」換成這一條。
//
// 那條規矩真正在防的是**「安靜地」三個字**，不是「不可以不列」。她開這一頁
// 是為了確認沒有漏掉東西，而一個安靜消失的項目正好是最該被看到的那一種。
// 所以濾掉的不列出來，但要數出來、要點得開，而 `total` 永遠算得回去。
describe('一則都不可以安靜地消失', () => {
  test('對不上的不列出來，但數得出來、點得開', () => {
    const review = reviewOf([ev('batches.update', {
      before: { cursor: 1 }, after: { cursor: 2 },
    })]);
    assert.deepEqual(idsOf(review), []);
    assert.equal(review.hidden, 1);
    assert.equal(review.hiddenRows.length, 1);
  });

  test('留下來的加上濾掉的等於進去的筆數', () => {
    const rows = [
      ev('visits.create', { after: { customerName: '客戶A' } }),
      ev('batches.update', { before: { cursor: 1 }, after: { cursor: 2 } }),
      ev('notes.create', { after: { text: '一件事' } }),
      ev('config/rooms.create', { after: { name: '治3' } }),
    ];
    const review = reviewOf(rows);
    assert.equal(review.total, rows.length);
    assert.equal(review.shown + review.hidden, rows.length);
    assert.equal(review.groups.reduce((n, g) => n + g.n, 0), review.shown);
  });

  test('空的段不出現', () => {
    assert.deepEqual(reviewOf([]).groups, []);
    assert.deepEqual(reviewOf([]).tiles, []);
    assert.equal(reviewOf([]).hidden, 0);
    assert.deepEqual(reviewOf([]).hiddenRows, []);
  });

  // 她一天對帳二十筆，那一攤開來不能是二十列一模一樣的字。
  test('濾掉的那幾則照樣收合連著一樣的句子', () => {
    const one = ev('customers/c1/entitlements.update', {
      before: { label: '復能', bookedCount: 0 }, after: { bookedCount: 1 },
    });
    const review = reviewOf([one, one, one]);
    assert.equal(review.hidden, 3, '數的是收合前的筆數');
    assert.equal(review.hiddenRows.length, 1);
    assert.equal(review.hiddenRows[0].times, 3);
  });

  // 那幾列底下沒有抬頭可以靠，所以它們**帶著名字**。
  test('濾掉的那一列講得出是誰', () => {
    const review = reviewOf([ev('customers/c1/entitlements.update', {
      before: { label: '復能', doneCount: 7 }, after: { doneCount: 8 },
    })], { nameOf: (id) => (id === 'c1' ? '客戶A' : null) });
    assert.deepEqual(hiddenTexts(review), ['客戶A・復能・已完成 7 → 8 次']);
  });
});

// 她的原話（2026-09-04）：「客戶與額度那個類別其實沒什麼必要……
// 像是對帳過了、已排未上 0->1 這種都沒必要，這類別只需要留新增客戶、
// 新增額度這兩個就好。還有像是其他：新增備忘錄、修改備忘錄，其實也不需要。
// 這邊需要呈現的就只要重要的那些就好，不是流水帳。」
describe('份量閘門', () => {
  const kept = (event) => reviewOf([event]).shown === 1;

  describe('⑨ 客戶與額度只留五種', () => {
    test('新增客戶、新增額度 —— 她點名的那兩種', () => {
      assert.ok(kept(ev('customers.create', { after: { name: '王小明' } })));
      assert.ok(kept(ev('customers/c1/entitlements.create', {
        after: { label: '復能', totalQty: 10 },
      })));
    });

    test('刪掉客戶、刪掉額度 —— 新增的反面，而且刪額度最貴', () => {
      assert.ok(kept(ev('customers.softDelete', {
        before: { name: '王小明' }, after: { deletedAt: 'T' },
      })));
      assert.ok(kept(ev('customers/c1/entitlements.softDelete', {
        before: { label: '復能' }, after: { deletedAt: 'T' },
      })));
    });

    // 那是一筆要進試算表的紀錄（ADR-0059），而這一頁的用途正是
    // 「確認有沒有漏掉登記」—— 濾掉它等於濾掉這一頁最該抓的一種漏。
    test('給了哪幾款營養品', () => {
      assert.ok(kept(ev('customers/c1/entitlements.update', {
        before: { label: '營養品', deliveries: [] },
        after: { deliveries: [{ productId: 'p1', at: 'T' }] },
      })));
    });

    // 那兩欄會改變她往後每一次壓表能用哪一台器材（ADR-0064）。
    test('改永久限制、改特殊狀況', () => {
      assert.ok(kept(ev('customers.update', {
        before: { name: '王小明', flags: [] }, after: { flags: ['血管難打'] },
      })));
      assert.ok(kept(ev('customers.update', {
        before: { name: '王小明', notes: '' }, after: { notes: '怕冷' },
      })));
    });

    // 這幾種是**來訪的副作用**：那筆來訪就在上面幾列（②壓表）。
    test('次數的變化濾掉 —— 那是來訪造成的', () => {
      assert.ok(!kept(ev('customers/c1/entitlements.update', {
        before: { label: '復能', bookedCount: 0 }, after: { bookedCount: 1 },
      })));
      assert.ok(!kept(ev('customers/c1/entitlements.update', {
        before: { label: '復能', doneCount: 3 }, after: { doneCount: 4 },
      })));
    });

    test('「對帳過了」濾掉', () => {
      assert.ok(!kept(ev('customers/c1/entitlements.update', {
        before: { label: '復能', lastReconciledAt: 'a' }, after: { lastReconciledAt: 'b' },
      })));
    });

    // 白名單不是黑名單：客戶身上之後多一個欄位時，預設應該是安靜的。
    test('改電話、改喜好程度濾掉', () => {
      assert.ok(!kept(ev('customers.update', {
        before: { name: '王小明', phone: '1' }, after: { phone: '2' },
      })));
      assert.ok(!kept(ev('customers.update', {
        before: { name: '王小明', priority: 1 }, after: { priority: 3 },
      })));
    });
  });

  test('⑪ 備忘錄濾掉 —— 她點名的「新增備忘錄、修改備忘錄」', () => {
    assert.ok(!kept(ev('playbooks.create', { after: { title: '二返怎麼跑' } })));
    assert.ok(!kept(ev('playbooks.update', {
      before: { title: '二返怎麼跑', body: 'a' }, after: { body: 'b' },
    })));
  });

  // 一個人身上的事全部被濾掉時，那一組整個不出現 —— 空的抬頭比多一列糟。
  test('一個人身上的事全部被濾掉，那一組就不出現', () => {
    const review = reviewOf([ev('customers/c1/entitlements.update', {
      before: { label: '復能', bookedCount: 0 }, after: { bookedCount: 1 },
    })], { nameOf: () => '客戶A' });
    assert.deepEqual(review.people, []);
    assert.equal(review.hidden, 1);
  });

  test('剩下的那些照樣掛得到人', () => {
    const review = reviewOf([
      ev('customers/c1/entitlements.update', {
        before: { label: '復能', bookedCount: 0 }, after: { bookedCount: 1 },
      }),
      ev('visits.create', {
        after: { customerId: 'c1', customerName: '客戶A', date: '2026-09-14' },
      }),
    ], { nameOf: () => '客戶A' });
    assert.deepEqual(review.people.map((p) => p.who), ['客戶A']);
    assert.equal(review.people[0].n, 1);
  });

  // 畫面上寫「壓了 6 筆」，底下就要數得出六列。
  test('頂端那一排數的是留下來的', () => {
    const review = reviewOf([
      ev('visits.create', { after: { customerName: '客戶A' } }),
      ev('customers/c1/entitlements.update', {
        before: { label: '復能', bookedCount: 0 }, after: { bookedCount: 1 },
      }),
    ]);
    assert.deepEqual(review.tiles.map((t) => [t.id, t.n]), [['book', 1]]);
  });
});

// 勾掉一張任務的那一句要講得出「誰的、哪一天的、哪一項」，而任務身上只有
// `visitId` —— 來訪日與課程名不該存在任務上（`domain/audit.js` 的檔頭）。
describe('要讀哪幾筆來訪', () => {
  const tick = (visitId, done = true) => ev('tasks.update', {
    before: { customerName: '客戶A', kind: 'Examine', done: !done, visitId },
    after: { done },
  });

  test('勾掉與拿回來的都要 —— 兩種都會印出那一句', () => {
    assert.deepEqual(visitIdsIn([tick('v1'), tick('v2', false)]), ['v1', 'v2']);
  });

  test('同一場只讀一次', () => {
    assert.deepEqual(visitIdsIn([tick('v1'), tick('v1')]), ['v1']);
  });

  // 客人一確認就長出一批任務，那幾則不會印出日期，讀它們是白讀的。
  test('新增任務不算 —— 它沒有 done 的變化', () => {
    assert.deepEqual(visitIdsIn([ev('tasks.create', {
      after: { customerName: '客戶A', kind: 'Examine', visitId: 'v1' },
    })]), []);
  });

  test('不是任務的、身上沒有 visitId 的都不算', () => {
    assert.deepEqual(visitIdsIn([
      ev('visits.create', { after: { customerName: '客戶A' } }),
      tick(null),
    ]), []);
    assert.deepEqual(visitIdsIn(), []);
  });
});

describe('連著一樣的句子收成一則', () => {
  const tick = (kind = 'Examine') => ev('tasks.update', {
    before: { customerName: '客戶A', kind, done: false },
    after: { done: true },
  });

  test('連著三則收成一則，寫 ×3', () => {
    const review = reviewOf([tick(), tick(), tick()]);
    const rows = review.groups[0].rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].times, 3);
    assert.equal(review.groups[0].n, 3, '收合前的筆數要留著給摘要數字用');
  });

  test('**中間隔了別的就不收** —— 早上勾三張、下午又勾兩張是兩件事', () => {
    const other = ev('tasks.update', {
      before: { customerName: '客戶B', kind: 'Examine', done: false },
      after: { done: true },
    });
    const rows = reviewOf([tick(), other, tick()]).groups[0].rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.times === 1));
  });

  test('收成一則之後時間留最早那一下 —— 那是她開始做那件事的時間', () => {
    const rows = reviewOf([
      { ...tick(), at: '16:05' },
      { ...tick(), at: '16:03' },
      { ...tick(), at: '16:01' },
    ]).groups[0].rows;
    assert.equal(rows[0].at, '16:01');
  });
});

describe('頂端那一排數字', () => {
  test('只印有值的那幾顆', () => {
    const review = reviewOf([
      ev('visits.create', { after: { customerName: '客戶A' } }),
      ev('visits.create', { after: { customerName: '客戶B' } }),
      ev('notes.create', { after: { text: '一件事' } }),
    ]);
    assert.deepEqual(review.tiles.map((t) => [t.id, t.n]), [['book', 2], ['calendar', 1]]);
  });

  test('數的是收合前的筆數 —— 連著壓三筆就是三筆', () => {
    const one = ev('visits.create', { after: { customerName: '客戶A' } });
    assert.equal(reviewOf([one, one, one]).tiles[0].n, 3);
  });
});

describe('撈到上限要講出來', () => {
  test('不講的話她會以為那幾筆沒發生（SPEC 第 6.9 節）', () => {
    const rows = Array.from({ length: 5 }, () =>
      ev('visits.create', { after: { customerName: '客戶A' } }));
    assert.equal(reviewOf(rows, { limit: 5 }).truncated, true);
    assert.equal(reviewOf(rows, { limit: 6 }).truncated, false);
    assert.equal(reviewOf(rows).truncated, false, '沒給上限就不講');
  });
});

describe('那一天的抬頭', () => {
  test('今天寫「今天」，別天寫日期', () => {
    assert.equal(dayTitle('2026-09-01', '2026-09-01'), '今天');
    assert.equal(dayTitle('2026-08-31', '2026-09-01'), '8 月 31 日');
  });

  test('讀不出來不要編一個', () => {
    assert.equal(dayTitle(null, '2026-09-01'), '？');
  });
});

// ---------- 照人分組 ----------
//
// 她的原話：「在今天做了什麼那邊也許可以以人為群組分類呈現？用客戶姓名作為
// 大標題，底下條列式列出對他做了什麼事」。
//
// 兩種分組是同一批資料的兩種排法，所以**兩邊的總數都要等於進去的筆數** ——
// 她開這一頁就是為了確認沒有漏掉東西，一則安靜消失正好毀掉那個用途。

describe('照人分組', () => {
  const person = (review, who) => review.people.find((p) => p.who === who);

  test('一位客戶身上的事收成一組，而且照她做的順序由早到晚', () => {
    // 進來的順序是新的在前（`listOnDay()` 給的）
    const review = reviewOf([
      ev('tasks.update', {
        at: '16:40',
        before: { customerName: '客戶A', kind: 'Examine', done: false },
        after: { done: true },
      }),
      ev('visits.update', {
        at: '15:03',
        before: { customerName: '客戶A', date: '2026-09-14', status: 'pending_confirm' },
        after: { status: 'confirmed' },
      }),
      ev('visits.create', {
        at: '14:22',
        after: { customerName: '客戶A', date: '2026-09-14', status: 'pending_confirm' },
      }),
    ]);

    assert.equal(review.people.length, 1);
    const mine = person(review, '客戶A');
    assert.equal(mine.n, 3);
    assert.deepEqual(mine.rows.map((r) => r.at), ['14:22', '15:03', '16:40']);
    assert.deepEqual(mine.rows.map((r) => r.stage), ['壓表', '跟客人確認', '登記掛號']);
  });

  test('那一列不含名字 —— 抬頭已經寫了', () => {
    const review = reviewOf([ev('visits.create', {
      after: { customerName: '客戶A', date: '2026-09-14' },
    })]);
    const row = person(review, '客戶A').rows[0];
    assert.ok(!row.text.includes('客戶A'), `不該再印一次名字：${row.text}`);
    // 照流程那一格照樣要有名字（那一格沒有抬頭可以靠）
    assert.ok(review.groups[0].rows[0].text.includes('客戶A'));
  });

  test('掛不到人的收成一組，排最後，而且不叫「其他」', () => {
    const review = reviewOf([
      ev('events.create', { after: { title: '宜蘭', category: 'leave', startDate: '2026-09-05' } }),
      ev('visits.create', { after: { customerName: '客戶A', date: '2026-09-14' } }),
    ]);
    assert.deepEqual(review.people.map((p) => p.who), ['客戶A', null]);
    assert.equal(NOBODY, '沒有掛客戶');
  });

  test('人的順序是「最近碰過的排最上面」', () => {
    const review = reviewOf([
      ev('visits.create', { at: '17:00', after: { customerName: '客戶B', date: '2026-09-14' } }),
      ev('visits.create', { at: '09:00', after: { customerName: '客戶A', date: '2026-09-14' } }),
    ]);
    assert.deepEqual(review.people.map((p) => p.who), ['客戶B', '客戶A']);
  });

  // ADR-0071 的那一條規矩對兩種分組都成立：兩邊算出來的「留下來的筆數」
  // 要一樣，而且加上濾掉的就是進去的筆數。
  test('一則都不會安靜地消失 —— 兩種分組數出來的一樣多', () => {
    const events = [
      ev('visits.create', { after: { customerName: '客戶A', date: '2026-09-14' } }),
      ev('notes.create', { after: { text: '一件事' } }),
      ev('config/app/courses.create', { after: { name: '復能' } }),
      ev('weird.thing', { after: { x: 1 } }),
    ];
    const review = reviewOf(events);
    const sum = (rows) => rows.reduce((n, g) => n + g.n, 0);
    assert.equal(sum(review.groups), review.shown);
    assert.equal(sum(review.people), review.shown);
    assert.equal(review.shown + review.hidden, events.length);
    assert.equal(review.total, events.length);
    // 設定與認不得的那兩則被濾掉了，剩下壓表與待辦
    assert.equal(review.shown, 2);
  });

  test('連著一樣的句子在照人那一格也收成一則', () => {
    const one = ev('tasks.update', {
      before: { customerName: '客戶A', kind: 'Examine', done: false },
      after: { done: true },
    });
    const rows = person(reviewOf([one, one, one]), '客戶A').rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].times, 3);
  });

  test('沒傳解析器照樣不會爆 —— 那幾則落進沒有掛客戶那一組', () => {
    const review = reviewOf([ev('customers/c1/entitlements.create', {
      after: { label: '復能', totalQty: 10 },
    })]);
    assert.equal(review.people.length, 1);
    assert.equal(review.people[0].who, null);
  });

  test('傳了解析器，子集合那幾則就掛得到人', () => {
    const events = [{
      action: 'customers/c1/entitlements.create',
      targetPath: 'customers/c1/entitlements/e1',
      before: {},
      after: { label: '復能', totalQty: 10 },
      at: 'T',
    }];
    const review = reviewOf(events, { nameOf: (id) => (id === 'c1' ? '客戶A' : null) });
    assert.equal(review.people[0].who, '客戶A');
    assert.equal(review.people[0].rows[0].text, '新增額度 復能・10 次');
  });
});
