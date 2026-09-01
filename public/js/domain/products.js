// 營養品：一次購買、一個金額、好幾種、哪天順便給。純函式。
//
// ADR-0057 已經定了「營養品是一筆排不進來訪的額度」。這一支補的是它**裡面**
// 長什麼樣 —— 那一版一筆額度只指得到一款（`productId` 是單數），而她記的是：
//
// > 營養品(5000) : 夜態美+速體淨+粒能康+GABA 7/6 順便給
//
// 一次購買、一個金額、好幾種、一次給完。拆成四筆額度的話 5000 沒有地方放
//（那是整包的價錢，不是四份各自的），而「7/6 一起給」也講不出來。
//
// ## 三件事
//
//   1. **一筆就是一次購買**：`items[]` 好幾種、`amountTwd` 一個金額、
//      `totalQty` 是**幾個月**（她說「次數1就是一個月2就是兩個月的」）
//   2. **哪天給**：一筆有日期的隨手記（ADR-0044），所以它自己就會出現在日曆的
//      「待辦」那一類、改期就是改那筆的日期。**不開日曆的第八種顏色**
//      （色相已經用完了，ADR-0039、0045）
//   3. **給了哪些**：勾掉那筆隨手記時逐項確認，寫進 `deliveries[]`
//
// ## 為什麼交付記在額度上而不是隨手記上
//
// 隨手記是刻意做得很薄的東西（`domain/notes.js` 的檔頭：「一行字、一個勾」），
// 而且她會把它清掉（「清掉這 N 筆已完成的隨手記」）。清掉之後「7/6 給了什麼」
// 就沒了 —— 而那是要進試算表的紀錄。額度不會被清掉。
//
// 所以隨手記是**提醒**，額度是**紀錄**。兩者靠 `note.entitlementId` 連著。

/** 這一筆額度是不是營養品。`entitlements.js` 的 `isProduct()` 是同一個判斷。 */
const isProductEntitlement = (e) => e?.type === 'product';

/** 名字認不回來時印這一句。**不要留空白** —— 一列空白看起來像壞掉的東西。 */
export const UNKNOWN_ITEM = '（不知道是哪一款）';

/**
 * 這一筆營養品裡有哪幾種。
 *
 * **舊資料相容**：2026-08-27 以前一筆額度只指得到一款（`productId` 是單數），
 * 那幾筆讀出來就是一個項目的清單。不寫回去、不自動搬 —— 她下次編輯那一筆時
 * 才會換成新的形狀（同 ADR-0011 的判斷：不知道的不假裝知道）。
 *
 * `name` 跟著存是為了那一款被主檔刪掉之後畫面上還印得出來 ——
 * 同 `payload()` 現在對 `productId` 的理由。
 *
 * ## 為什麼要收一份主檔
 *
 * 2026-08 到 09 之間存進去的那幾筆 `name` 是**空字串**：表單只送得回 id，
 * 而存檔那一下把 `afterDetail()` 補好的名字蓋掉了
 * （`ui/components/buy.js` 的 `commitNewProduct()` 已經修好了往後的）。
 *
 * 既有的那幾筆**不回頭改**（ADR-0011、0059 的同一條原則），
 * 所以認回來的責任在讀的這一側。主檔裡也查不到（那一款被刪了）就退回
 * `UNKNOWN_ITEM` —— 交付面板上一整列空白看起來像壞掉的東西。
 *
 * @param {object} e
 * @param {{products?: object[]}} [master] 有給的話，名字空白的那幾筆從主檔補
 * @returns {{productId: string|null, name: string}[]}
 */
export function itemsOf(e, master) {
  const byId = master?.products
    ? new Map(master.products.map((p) => [p.id, String(p?.name ?? '').trim()]))
    : null;
  const named = (productId, name) => {
    const own = String(name ?? '').trim();
    if (own) return own;
    if (!byId) return '';
    return byId.get(productId) || (productId ? UNKNOWN_ITEM : '');
  };

  const items = e?.items;
  if (Array.isArray(items) && items.length) {
    return items.map((x) => ({
      productId: x?.productId ?? null,
      name: named(x?.productId ?? null, x?.name),
    }));
  }
  if (e?.productId) return [{ productId: e.productId, name: named(e.productId, e.label) }];
  return [];
}

/** 那幾種的名字串起來：`夜態美＋速體淨＋粒能康＋GABA`。 */
export const itemNames = (e, master) =>
  itemsOf(e, master).map((x) => x.name).filter(Boolean).join('＋');

/**
 * 顯示名稱。**金額進名字裡**，因為她的舊表就是那樣寫的（`營養品(5000)`）。
 *
 * 沒有金額就不寫括號 —— 印一個 `(0)` 出來比不印糟。
 */
export function productLabel(e, courseName = '營養品', master) {
  const names = itemNames(e, master);
  const amount = amountOf(e);
  const head = amount ? `${courseName} ${amount.toLocaleString('en-US')}` : courseName;
  return names ? `${head}（${names}）` : head;
}

/** 這一整包多少錢。讀不出數字就是 `null`，不要當成 0 —— 那是兩件事。 */
export function amountOf(e) {
  const n = Number(e?.amountTwd);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** 買了幾個月。她說「次數1就是一個月2就是兩個月的」。 */
export const monthsOf = (e) => Math.max(0, Number(e?.totalQty ?? 0) || 0);

/** 已經交出去的那幾款的 id。同一款給兩次只算一次。 */
export function deliveredIds(e) {
  const out = new Set();
  for (const d of e?.deliveries ?? []) {
    for (const id of d?.productIds ?? []) out.add(id);
  }
  return out;
}

/** 還沒給的那幾種。 */
export function undelivered(e, master) {
  const given = deliveredIds(e);
  return itemsOf(e, master).filter((x) => !x.productId || !given.has(x.productId));
}

/** 全部都給完了嗎。**一種都沒有的那一筆不算給完** —— 沒有東西可以給。 */
export function isFullyDelivered(e) {
  const items = itemsOf(e);
  return items.length > 0 && undelivered(e).length === 0;
}

/**
 * 「給了什麼？」那張面板要列哪幾款，以及**有沒有東西可以列**。
 *
 * 抽出來是為了測得到：那張面板本身在 `ui/components/note.js`，
 * 而那一支 import 了 `components/sheet.js`（碰 DOM），Node 載不動。
 *
 * `left` 是空的有兩種情況，兩種都會讓那張面板變成一條死路
 * （沒有任何一列、按鈕還是灰的，唯一的出路是「先不要」）——
 * 而她看到的就是「點開是完全空白的，完成後不會被勾掉」：
 *
 *   - **一款都沒選的額度**（舊資料）
 *   - **每一款都給過了，但那筆提醒沒被勾掉**（寫入中途失敗、或她手動改過）
 *
 * @param {object} e
 * @param {{products?: object[]}} [master]
 * @returns {{left: object[], items: object[], nothingLeft: boolean, everGave: boolean}}
 */
export function deliveryChoices(e, master) {
  const items = itemsOf(e, master);
  const left = undelivered(e, master);
  return {
    items,
    left,
    nothingLeft: left.length === 0,
    // 分得出「這一包本來就沒選過哪幾款」與「每一款都給過了」——
    // 那張確認框要講的話不一樣。
    everGave: items.length > 0,
  };
}

/** 最後一次交付是哪一天。沒給過就是 `null`。 */
export function lastDeliveredAt(e) {
  const days = (e?.deliveries ?? []).map((d) => d?.at).filter(Boolean).sort();
  return days.length ? days[days.length - 1] : null;
}

/**
 * 這一筆現在給到哪了。客戶詳情那一小段與試算表共用一句話。
 *
 * 三種：還沒給、給了一部分、給完了。**給了一部分要寫出幾種**，
 * 不然她看不出還差什麼 —— 而「還差什麼」正是她要回去補的東西。
 *
 * @returns {{state:'none'|'partial'|'all', text:string, at:string|null}}
 */
export function deliveryState(e, master) {
  const items = itemsOf(e, master);
  const left = undelivered(e, master);
  const at = lastDeliveredAt(e);

  if (!items.length) return { state: 'none', text: '還沒選是哪幾種', at: null };
  if (left.length === items.length) return { state: 'none', text: '還沒給', at: null };
  if (left.length) {
    return {
      state: 'partial',
      text: `給了 ${items.length - left.length}/${items.length} 種，還差 ${left.map((x) => x.name).join('、')}`,
      at,
    };
  }
  return { state: 'all', text: '都給了', at };
}

/**
 * 那一筆提醒她「哪天順便給」的隨手記要寫什麼。
 *
 * 給了一部分之後文字要換成**剩下的那幾種** —— 留著原本那一整串，
 * 她會以為四種都還沒給。
 */
export function noteTextFor(e, customerName = '', master) {
  const left = undelivered(e, master);
  const names = left.map((x) => x.name).filter(Boolean).join('＋');
  const who = String(customerName ?? '').trim();
  const what = names || '營養品';
  return who ? `給${who}營養品：${what}` : `給營養品：${what}`;
}

/**
 * 記一次交付之後，額度上的 `deliveries` 要變成什麼樣。
 *
 * **回的是要蓋上去的那幾個欄位**，不是整筆額度 —— 呼叫端還要保住別的東西。
 * 一個 id 都沒給就什麼都不記（她按了「先不要」）。
 *
 * @param {object} e
 * @param {{at: string, productIds: string[]}} delivery
 * @returns {{deliveries: object[]}|null} null = 沒有東西要記
 */
export function withDelivery(e, { at, productIds = [] } = {}) {
  const fresh = [...new Set(productIds.filter(Boolean))].filter((id) => !deliveredIds(e).has(id));
  if (!fresh.length) return null;
  return { deliveries: [...(e?.deliveries ?? []), { at, productIds: fresh }] };
}

/**
 * 存檔前的檢查。**只管營養品自己那幾格**，其餘（名稱、次數）在
 * `domain/entitlements.js` 的 `validateEntitlement()`。
 *
 * @param {object} e
 * @param {{products?: object[]}} [master]
 * @returns {string[]}
 */
export function validateProduct(e, { products = [] } = {}) {
  if (!isProductEntitlement(e)) return [];
  const errors = [];
  const items = itemsOf(e);
  const alive = products.filter((x) => !x.deletedAt);

  if (!items.length) errors.push('要選至少一種營養品');
  else if (items.some((x) => !x.productId)) errors.push('有一種營養品指不出是哪一款');
  else if (items.some((x) => !alive.some((p) => p.id === x.productId))) {
    errors.push('指定的營養品不存在或已刪除');
  }

  const ids = items.map((x) => x.productId);
  if (new Set(ids).size !== ids.length) errors.push('同一種營養品選了兩次');

  // 金額是選填的，填了就要是一個正整數。**0 也不行** —— 送的東西她不會
  // 記在營養品那一列（那是她賣了什麼的紀錄）。
  //
  // 規則沒有變過，變的是這一句話：她剛剛才被欄位上的 `step="100"` 擋過
  //（「最接近的有效值為 5000 和 5100」），要看得出這一次擋的是別的東西。
  // 整數這一條是 `firestore.rules` 的 `validEntitlement()` 定的
  //（`amountTwd is int`），前端放行只會讓寫入在資料庫那一端整包被拒收。
  if (e.amountTwd != null && e.amountTwd !== '' && amountOf(e) === null) {
    errors.push('金額要是大於 0 的整數（5050 可以，5050.5 不行）');
  }

  return errors;
}

// ---------- 哪天順便給 ----------
//
// 提醒走**一筆有日期的隨手記**（ADR-0044），所以它自己就會出現在日曆的「待辦」
// 那一類、改期就是改那一筆的日期、勾掉畫成刪除線。**不開日曆的第八種顏色** ——
// 色相已經用完了（ADR-0039、0045）。
//
// 隨手記是提醒，額度是紀錄。她會把勾掉的隨手記清掉（「清掉這 N 筆已完成的隨手記」），
// 而「7/6 給了什麼」是要進試算表的東西 —— 那一份存在額度上。

/**
 * 那一筆營養品該配的隨手記長什麼樣。沒有 id —— id 由 /data 那一層給。
 *
 * **不是營養品、或者一款都沒選就不配** —— 提醒她去給一包空的東西沒有意義。
 *
 * @param {object} o
 * @param {object} o.entitlement 那一筆營養品（要有 id）
 * @param {{id:string, name?:string}} o.customer
 * @param {string|null} [o.date] 想在哪一天給。不知道就留空白 ——
 *   **不要猜一天**，猜出來的日期會讓她以為那天客人真的會來。
 */
export function deliveryNoteFor({ entitlement, customer, date = null }) {
  if (!isProductEntitlement(entitlement) || !itemsOf(entitlement).length) return null;

  return {
    text: noteTextFor(entitlement, customer?.name ?? ''),
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    date: date ?? null,
    // 這一筆隨手記講的是哪一包。勾掉時要靠它找回額度去記交付。
    entitlementId: entitlement?.id ?? null,
    done: false,
    doneAt: null,
  };
}

/**
 * 這一包配的那一筆提醒是哪一筆。找不到回 null。
 *
 * 靠 `note.entitlementId` 連著（ADR-0059）。**已經勾掉的不算** ——
 * 那一筆講的是上一次的交付，而她現在要問的是「下一次哪天給」。
 *
 * @param {object[]} notes 手上那幾筆隨手記
 * @param {string} entitlementId
 */
export function existingReminder(notes = [], entitlementId) {
  if (!entitlementId) return null;
  return (notes ?? []).find(
    (n) => !n.deletedAt && !n.done && n.entitlementId === entitlementId,
  ) ?? null;
}

/**
 * 客戶詳情點一列營養品，快捷選單上有哪幾顆（ADR-0060）。
 *
 * 這一列以前直接落進「調整」那一張表。ADR-0020 對日曆定的規矩
 * （「先給看的，不先給改的」）在這裡更該守：她點營養品那一列，
 * 十次有九次要問的是**「這一包給了沒、什麼時候給」**，不是「改幾個月」。
 *
 * 「約時間」那一顆的字要跟著提醒現在的狀態走 —— 她按下去之前要知道
 * 自己在改什麼還是在建什麼。
 *
 * @param {object} e 那一筆營養品
 * @param {object|null} note 它配的那一筆提醒（`existingReminder()`）
 * @param {{products?: object[]}} [master]
 */
export function productActions(e, note, master) {
  const out = [];
  const dated = Boolean(note?.date);

  out.push({
    id: 'when',
    label: dated ? '改時間' : '約時間',
    note: dated ? `現在是 ${note.date}` : '選一天，日曆上會多一件待辦',
    icon: 'calendar',
  });

  // 都給完了就沒有「已經給了」可以按 —— 那一顆按下去只會跳一張
  // 「這一包沒有還沒給的東西」（`deliveryChoices()`）。
  if (!deliveryChoices(e, master).nothingLeft) {
    out.push({
      id: 'gave',
      label: '已經給了',
      note: '選一天，逐款記進交付',
      icon: 'check',
      tone: 'primary',
    });
  }

  out.push({ id: 'edit', label: '編輯這一包', note: '金額、哪幾款、幾個月', icon: 'pencil' });
  return out;
}

/**
 * 現在有東西可以給的客戶，與他們各自的那幾包。
 *
 * 記隨手記時那顆「給營養品」用（issue 12）。她要記的那一件事本來就有專門的
 * 形狀 —— 一筆掛了 `entitlementId` 的隨手記（ADR-0059）—— 所以那一顆不是
 * 第五種欄位，是一條**捷徑**：選客戶、選哪一包，文字與 `entitlementId`
 * 自動填好，她一個字都不用打。
 *
 * **不要讓她自己打「給客戶A營養品：夜態美」那一行字**：那樣打出來的那一筆
 * 沒有 `entitlementId`，於是勾掉的時候不會問「給了哪些」，
 * 那筆要進試算表的交付紀錄就沒了（`ui/components/note.js` 的檔頭）。
 *
 * **給完的那幾包不列**（`isFullyDelivered()`）—— 她要的是「今天要拿什麼給誰」，
 * 而給完的那幾包不是。一包都不剩的客戶整位不出現。
 *
 * **已經有提醒的那幾包照樣列**，只是標出來（「9/3 已經約了」）—— 她可能就是
 * 要改成今天給。選了它是改那一筆提醒的日期，不是長出第二筆。
 *
 * @param {object} o
 * @param {object[]} o.customers
 * @param {Record<string, object[]>} o.entitlementsBy 客戶 id → 他的額度
 * @param {object[]} [o.notes] 手上那幾筆隨手記（用來標「已經約了」）
 * @param {{products?: object[]}} [o.master] 舊資料的空名字靠它認回來
 * @returns {{customerId, customerName, bags: {entitlementId, label, hint, note}[]}[]}
 */
export function givableBags({ customers = [], entitlementsBy = {}, notes = [], master } = {}) {
  const out = [];

  for (const c of customers) {
    if (c?.active === false) continue;
    const bags = (entitlementsBy[c.id] ?? [])
      .filter((e) => isProductEntitlement(e) && !e.deletedAt && !isFullyDelivered(e))
      .map((e) => {
        const note = existingReminder(notes, e.id);
        const left = undelivered(e, master).map((x) => x.name).filter(Boolean).join('＋');
        return {
          entitlementId: e.id,
          entitlement: e,
          label: e.label || productLabel(e, '營養品', master) || '營養品',
          // 還差哪幾款是她真的要看的 —— 「還差什麼」正是她要回去補的東西。
          hint: [left && `還沒給：${left}`, note?.date && `${note.date} 已經約了`]
            .filter(Boolean).join('・'),
          note,
        };
      });

    if (bags.length) out.push({ customerId: c.id, customerName: c.name ?? '（沒有名字）', bags });
  }

  return out;
}

/**
 * 她下一次會見到這位客戶是哪一天。營養品的提醒預設掛在那一天 ——
 * 她的原話：「我都是等客人哪天有預約來，我就順便給」。
 *
 * 找不到就回 `null`（新客戶、這陣子沒有預約）。**不要退回今天** ——
 * 今天客人不見得會來，而一個掛錯日期的待辦比一個沒有日期的待辦糟：
 * 前者她會照著做，後者她會去挑一天。
 *
 * @param {object[]} visits 這位客戶的來訪
 * @param {string} today 'YYYY-MM-DD'
 */
export function nextDeliveryDate(visits = [], today) {
  return (visits ?? [])
    .filter((v) => !v.deletedAt
      && (v.status === 'pending_confirm' || v.status === 'confirmed')
      && typeof v.date === 'string' && v.date >= today)
    .map((v) => v.date)
    .sort()[0] ?? null;
}
