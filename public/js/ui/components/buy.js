// 「買了什麼」那一張表。**三個入口共用同一份**：客戶詳情的「加購」、
// 新增客戶那一頁的「加一項」、批次建立那一頁「微調」面板裡的「加一項」。
//
// 三個入口問的是同一句話（「這位客戶多買了什麼」），所以不可以有三張長得不一樣
// 的表 —— 她在一邊選得到營養點滴的品項、另一邊選不到，那不是兩個畫面，
// 是同一個畫面壞了一半。第三個入口比這個檔案早兩天寫，所以它自己長了一張
// 下拉選單的表，2026-08-26 才接進來（`.scratch/buying-in-bulk/issues/01`）。
//
// ## 草稿的形狀就是一筆額度
//
// 這一支收的 `draft` 與吐的 `payload()` 都是**額度的形狀**，不是另一種
// 「購買意圖」物件。兩種形狀就要有人翻譯，而翻譯漏掉一個欄位的那一天
// 沒有人看得出來（`tier` 就差點是這樣，見 ADR-0054 的 Consequences）。
//
// ## 為什麼全部是丸子
//
// `components/form.js` 的 `chips()` 檔頭已經寫過三個理由。這一頁還有第四個：
// 她的原話是「可以不要用下拉選單而是用小丸」。
//
// ## 規則在上半段，接線在下半段
//
// 上半段（到 `unitOf()` 為止）沒有一行碰 DOM，`tests/buy.test.js` 盯著它。
// 下半段的 `wire()` 是三個入口共用的那一份接線 —— 以前那幾行在每個入口各寫
// 一次，於是「其他…」那一格漏了兩次都沒有人發現
// （`.scratch/buying-in-bulk/issues/02`）。

import * as f from './form.js';
import {
  TIER_PRESETS, tieredLabel, itemisedLabel, validateEntitlement,
  poolName, timedLabel, durationChoicesOf, countWord,
} from '../../domain/entitlements.js';
import { followupCourseIdOf } from '../../domain/followups.js';
import { itemsOf, productLabel } from '../../domain/products.js';
import { addMonths, isValidDate, todayISO } from '../../domain/dates.js';

/**
 * 「買了什麼」那一排裡代表擇一池的那一顆。它不是課程，所以借不到課程 id。
 *
 * **它取代了「復能」那個課程本身**：要選器材的課程不可以買成 `single`，
 * 那一筆額度排班時沒有池可以選器材（`picksEquipment()`）。所以課程那一排
 * 濾掉 `requiresEquipment` 的課程，換成這一顆。
 */
export const POOL_PICK = '__pool__';

/** 「哪一種」那一排裡的兩顆整組。其餘每一台器材各一顆，值就是器材 id。 */
export const POOL_SET_HOME = '__set_home__';
export const POOL_SET_ALL = '__set_all__';

/** 同上，代表營養品的那一顆。選了它才會冒出「哪一種」那一排。 */
export const PRODUCT_PICK = '__product__';

/** 「幾萬的」那一排裡的「其他…」。它不是一個等級，是一顆展開輸入框的鈕。 */
export const TIER_OTHER = '__other__';

/**
 * 「哪幾種」那一排裡的「＋ 新增…」。同上 —— 它不是一款營養品，
 * 是一顆展開輸入框的鈕。存下去的時候才真的寫進主檔。
 */
export const PRODUCT_NEW = '__newproduct__';

/** 「到期日」那一排的兩顆特別的。其餘幾顆的值**就是算好的那個日期**。 */
export const EXPIRY_NONE = '__none__';
export const EXPIRY_OTHER = '__other__';

/** 「半年」「一年」。她 2026-09-06 講的就是這兩個。 */
export const EXPIRY_PRESETS = [
  { months: 6, label: '半年' },
  { months: 12, label: '一年' },
];

/** 一張空白的草稿。 */
export function blank() {
  return {
    type: 'single',
    label: '',
    totalQty: 1,
    durationMin: null,
    courseId: null,
    optionEquipmentIds: [],
    frequencyRule: null,
    expiresAt: null,
    tier: null,
    tierOther: false,
    ivProductId: null,
    // 一次購買可以有好幾種營養品，外加一個金額（`domain/products.js`）。
    // `productId` 留著只為了讀得懂舊資料 —— 新的一律寫進 `items`。
    productId: null,
    items: [],
    amountTwd: null,
    // 「＋ 新增…」那一格開著沒有。跟 `tierOther` 一模一樣的作法 ——
    // 開合狀態存在草稿上，畫的時候就決定，不必另外接一段。
    newProduct: false,
    newProductName: '',
  };
}

/** 「買了什麼」那一排現在按著的是哪一顆。 */
export function picked(e) {
  if (e?.type === 'product') return PRODUCT_PICK;
  if (e?.type === 'pool') return POOL_PICK;
  return e?.courseId ?? null;
}

/**
 * 這一張表的全部欄位：買了什麼、（哪一種／幾萬的）、幾次。
 *
 * @param {object} e 草稿（額度的形狀）
 * @param {{courses:object[], equipment:object[], ivProducts:object[], products:object[]}} master
 */
export function fields(e, master) {
  return `
    ${f.chips({
      name: 'buy',
      label: '買了什麼',
      value: picked(e),
      options: [
        ...courseChips(master),
        // 營養品放最後一顆，而且前面隔一條線 —— 它不是課程。一排十幾顆要滑，
        // 滑到底才看到的那一顆如果是另一種東西，得先說一聲。
        { value: PRODUCT_PICK, label: '營養品', lead: '商品' },
      ],
    })}

    ${detailRow(e, master)}
    ${qtyField(e)}`;
}

/**
 * 「買了什麼」那一排的課程那一段。
 *
 * **要選器材的課程換成擇一池那一顆，而且留在它原本的位置上。**
 * 那一筆額度要帶著「可以用哪幾台」（`poolChoices()`），買成 `single` 的話
 * 排班時沒有池可以選器材。
 *
 * 留在原位是刻意的：這一排橫著捲，而她最常買的就是復能 ——
 * 接在最後面等於每一次都要滑到底。
 *
 * **復能與 ILIB 一定並排**（2026-09-07 她指名的）：
 *
 * > 我希望復能和ILIB這兩個丸子可以在隔壁
 *
 * 它們是同一個分類底下的兩個課程（`CONTEXT.md` 的「物理賦能課程」），
 * 而她每一次加購都是先看這兩顆。判準**不是名字**：接在復能後面的是
 * 「擁有四選一裡那幾台器材、但自己不是復能」的課程，也就是 ADR-0075 那條
 * 推導的另一端。她之後多接一台新器材、指到一個新課程，那個課程也會自己
 * 跟過來 —— 一行程式都不用改。
 */
function courseChips(master) {
  const out = [];
  let pooled = false;
  let poolAt = -1;
  for (const c of master.courses ?? []) {
    if (!c.requiresEquipment) {
      out.push({ value: c.id, label: c.name });
    } else if (!pooled) {
      pooled = true;
      poolAt = out.length;
      out.push({ value: POOL_PICK, label: c.name });
    }
  }
  if (poolAt < 0) return out;

  const siblings = poolSiblingCourseIds(master);
  if (!siblings.size) return out;

  const moved = out.filter((x, i) => i !== poolAt && siblings.has(x.value));
  if (!moved.length) return out;
  const rest = out.filter((x, i) => i === poolAt || !siblings.has(x.value));
  const at = rest.findIndex((x) => x.value === POOL_PICK);
  return [...rest.slice(0, at + 1), ...moved, ...rest.slice(at + 1)];
}

/**
 * 擇一池那個課程的「鄰居」是哪幾個課程。
 *
 * 四選一裡那幾台器材身上的 `courseId`，扣掉復能自己那一個 —— 現在就是
 * ILIB 那一個。空的（她還沒把 ILIB 建成器材）就回空的，那時候
 * 資料健檢的「器材主檔少了一台」會講這件事。
 *
 * 設定 →「名稱怎麼寫」那一頁也問同一句話（她那六種的第六種就是這裡回的
 * 那一個課程），所以它 export 出去 —— 兩邊各判斷一次的話，她之後多接一台
 * 新器材、指到一個新課程時，加購那一排跟著變而名稱那一頁沒有。
 */
export function poolSiblingCourseIds(master = {}) {
  const home = poolCourseOf(master);
  const ids = new Set();
  for (const eq of master.equipment ?? []) {
    if (eq.deletedAt || eq.active === false) continue;
    if (eq.courseId && eq.courseId !== home?.id) ids.add(eq.courseId);
  }
  return ids;
}

/**
 * 選了「買了什麼」的某一顆之後，草稿要變成什麼樣。
 *
 * 回的是**要蓋上去的那幾個欄位**，不是整張草稿 —— 呼叫端還要把表單上
 * 沒送出去的字（顯示名稱、到期日）保住。
 */
export function pick(value, e, master) {
  const equipment = master.equipment ?? [];

  if (value === POOL_PICK) {
    const choices = poolChoices(master);
    const course = poolCourseOf(master);
    const next = {
      type: 'pool',
      courseId: null,
      productId: null,
      ivProductId: null,
      tier: null,
      tierOther: false,
      // 預設是**整組那一顆**（方案裡的那一項就是它），不是全部器材 ——
      // 她最常買的就是三選一，先幫她按好。
      optionEquipmentIds: choices.sets[0]?.ids ?? equipment.map((x) => x.id),
      durationMin: e.durationMin ?? course?.durationMin ?? null,
    };
    return { ...next, label: keptLabel(e, master) ?? autoLabel({ ...e, ...next }, master) };
  }

  if (value === PRODUCT_PICK) {
    const next = {
      type: 'product',
      courseId: null,
      optionEquipmentIds: [],
      ivProductId: null,
      tier: null,
      tierOther: false,
      // 換去營養品再換回來的時候，她剛剛挑的那幾款與金額都留著
      productId: e.productId ?? null,
      items: e.items ?? [],
      amountTwd: e.amountTwd ?? null,
      newProduct: Boolean(e.newProduct),
      newProductName: e.newProductName ?? '',
      durationMin: null,
      frequencyRule: null,
    };
    return { ...next, label: keptLabel(e, master) ?? autoLabel({ ...e, ...next }, master) };
  }

  const course = (master.courses ?? []).find((c) => c.id === value) ?? null;
  // 換到不配二返的課程（也就是不是健檢）就把等級丟掉 ——
  // 「8萬復能」是一句沒有意義的話。品項同理。
  const tier = followupCourseIdOf(course) ? (e.tier ?? null) : null;
  const next = {
    type: 'single',
    courseId: course?.id ?? null,
    productId: null,
    items: [],
    amountTwd: null,
    newProduct: false,
    newProductName: '',
    optionEquipmentIds: [],
    tier,
    tierOther: Boolean(tier) && !TIER_PRESETS.includes(tier),
    ivProductId: course?.requiresIvProduct ? (e.ivProductId ?? null) : null,
    // 有「可選時長」的課程（ILIB）先幫她按好預設那一顆 —— 不然她要多點一下
    // 才存得下去，而那一下的答案永遠是課程本身的時長。
    durationMin: durationChoicesOf(course).length
      ? (e.durationMin ?? course?.durationMin ?? null)
      : (e.durationMin ?? null),
  };
  return { ...next, label: keptLabel(e, master) ?? autoLabel({ ...e, ...next }, master) };
}

/**
 * 換了等級或品項之後的顯示名稱。**她自己打過的不覆蓋。**
 *
 * `prev` 是換之前那一版，`next` 是換之後 —— 「改過沒有」一定要拿換之前的
 * 那一版去問，不然她打的字會被自己的下一次點擊蓋掉。
 */
export function retitle(prev, next, master) {
  return keptLabel(prev, master) ?? autoLabel(next, master);
}

/**
 * 點了「買了什麼」的某一顆之後的**整張**草稿。
 *
 * `typed` 是表單現在說的話（她打進去的字、還沒送出去的數量），全部要留著 ——
 * 換一顆課程不該把她打了一半的「幾次」清掉。
 *
 * **但「她自己改過名稱嗎」只拿草稿加上她打的名稱去問。** 等級與品項要用
 * 草稿上的那一版：它們在畫面上永遠跟顯示名稱同步（換了就改名），
 * 混著表單上的值去問會得出「她改過」，然後名字就再也不跟了。
 */
export function afterPick(value, draft, typed, master) {
  const prev = typed && 'label' in typed ? { ...draft, label: typed.label } : draft;
  return { ...draft, ...typed, ...pick(value, prev, master) };
}

/**
 * 換了「幾萬的」「哪一種」、或在「自己打」那一格打字之後的**整張**草稿。
 *
 * 這一下 `typed` 裡的等級／品項已經是**新的**（丸子換的是 hidden input，
 * 打字換的是那一格本身），所以「她自己改過名稱嗎」要拿 `draft` 去問 ——
 * 加上她打在顯示名稱那一格的字，那一格這一下沒有變。
 *
 * **連續打字時 `draft` 一定要是上一個字那一版。** 呼叫端每一下都要把回傳的
 * 草稿收起來，不然第二個字開始，app 自己填的名字會被誤判成「她改過的」
 * 而停在那裡不再跟（`.scratch/buying-in-bulk/issues/02`）。
 */
export function afterDetail(draft, typed, master) {
  const prev = typed && 'label' in typed ? { ...draft, label: typed.label } : draft;
  const next = withItemNames({ ...draft, ...typed }, master);
  return { ...next, label: retitle(prev, next, master) };
}

/**
 * 把 `items` 上的名字從主檔補齊。
 *
 * 表單只送得回 id（丸子上的 `data-chip-value`），但名字要**跟著存** ——
 * 那一款之後被主檔刪掉時，畫面上還要印得出來（同 `payload()` 對
 * `productId` 的理由）。認不出來的那一筆留著 id、名字空白，不要丟掉。
 *
 * **這一支要在存檔前再跑一次**，不是只有換丸子的時候。`afterDetail()` 補好的
 * 那一份會被存檔那一下的 `values(form)` 蓋掉（表單只回得了 id），
 * 而名字沒了之後 `productLabel()`、`noteTextFor()` 與交付面板會一起變空白 ——
 * 她看到的就是「營養品：營養品」與一張空的「給了什麼？」
 * （`.scratch/quick-actions-and-supplements/issues/08`）。
 * 最後一站是 `commitNewProduct()`，三個入口都會經過它。
 */
function withItemNames(e, master) {
  if (e?.type !== 'product' || !Array.isArray(e.items)) return e;
  const byId = new Map((master.products ?? []).map((p) => [p.id, p.name]));
  return { ...e, items: e.items.map((x) => ({ ...x, name: byId.get(x.productId) ?? x.name ?? '' })) };
}

/**
 * 自動帶的顯示名稱。選什麼就叫什麼，她一個字都不用打。
 *
 * 三種接法各有各的來源：健檢是等級＋課程名（ADR-0054）、營養點滴是
 * 課程名＋品項（`itemisedLabel()`，跟舊資料匯進來的那幾筆同一支）、
 * 營養品就是那一款的名字。
 */
export function autoLabel(e, master) {
  // 一次購買一筆，名字裡帶金額與那幾款 —— 她的舊表就是那樣寫的
  // （`營養品(5000) : 夜態美+速體淨…`）。規則只在 `domain/products.js`。
  if (e?.type === 'product') return itemsOf(e).length ? productLabel(e) : '';

  // 擇一池：一台就叫那一台，多台叫「復能三選一」，後面接時長。
  // 名字**算出來的**（`poolName()`）—— 她多加一台器材，「四選一」自己會變。
  if (e?.type === 'pool') {
    return timedLabel(
      poolName(e.optionEquipmentIds ?? [], master.equipment ?? [], master.courses ?? []),
      e.durationMin,
    );
  }

  const course = (master.courses ?? []).find((c) => c.id === e?.courseId) ?? null;
  if (!course) return '';
  if (course.requiresIvProduct) {
    const item = (master.ivProducts ?? []).find((p) => p.id === e.ivProductId)?.name ?? '';
    return itemisedLabel(course.name, item);
  }
  // 分得出時長的課程（ILIB）名字裡帶著它 —— 她身上會同時有 ILIB(30) 與 ILIB(60)
  if (durationChoicesOf(course).length) return timedLabel(course.name, e?.durationMin);
  return tieredLabel(e?.tier, course.name);
}

/**
 * 她自己打過的顯示名稱。**沒改過就回 `null`**，讓呼叫端重新帶一個自動的。
 *
 * 「改過」的判準是「跟自動帶的那一個不一樣」。這一支是為了讓「換課程」
 * 「換等級」「換品項」三條路用同一個判斷：三邊各寫一次，遲早有一邊
 * 把她打的字蓋掉。
 */
export function keptLabel(e, master) {
  const auto = autoLabel(e, master);
  return e?.label && e.label !== auto ? e.label : null;
}

/**
 * 表單上那幾個**只有這一張表管**的欄位。
 *
 * **只有那一排真的在畫面上時才回報。** 少帶一個欄位就等於把它清成 null，
 * 而「調整」那一張表沒有這幾排 —— 見 ADR-0054 的 Consequences。
 *
 * @param {HTMLFormElement} form
 * @param {object} v `f.readForm(form)` 的結果
 */
export function read(form, v, master = {}) {
  const out = {};

  if (form.elements.tier) {
    const pickedTier = v.tier ?? null;
    const other = pickedTier === TIER_OTHER;
    out.tier = (other ? String(v.tierText ?? '').trim() : String(pickedTier ?? '').trim()) || null;
    out.tierOther = other;
  }
  if (form.elements.ivProductId) out.ivProductId = v.ivProductId ?? null;

  // 「哪一種」那一排送回來的是**一顆的值**（整組或某一台），這裡換回
  // 真正要存的那一串器材 id —— 存的是 ids，不是她按了哪一顆。
  if (form.elements.poolKind) {
    out.optionEquipmentIds = idsForPoolKind(v.poolKind, master) ?? [];
  }
  // 時長那一排。`'__null__'` 是 `f.chips()` 對 null 的寫法。
  if (form.elements.durationMin) {
    const raw = v.durationMin;
    out.durationMin = raw && raw !== '__null__' ? Number(raw) : null;
  }

  // 到期日那一排。**值就是算好的日期**（`expiryRow()` 算的），所以這裡不做
  // 任何日期運算 —— 兩邊各算一次的話，畫面上按著「一年」而存進去的是別的一天。
  if (form.elements.expiryPreset) {
    const preset = v.expiryPreset ?? EXPIRY_NONE;
    out.expiryOther = preset === EXPIRY_OTHER;
    out.expiresAt = out.expiryOther
      ? (String(v.expiresAt ?? '').trim() || null)
      : (preset === EXPIRY_NONE ? null : preset);
  }

  if (form.elements.productIds) {
    // 值從 `v`（`readForm()` 的結果）讀，不從 `form.elements` ——
    // `form.elements.productIds` 只回答「這一排在不在畫面上」（同上面的 tier）。
    const raw = f.splitMulti(v.productIds);
    out.newProduct = raw.includes(PRODUCT_NEW);
    // 「新增…」不是一款，是一顆展開輸入框的鈕（同「其他…」那一格）。
    out.newProductName = out.newProduct ? String(v.newProductName ?? '').trim() : '';
    out.items = raw
      .filter((id) => id !== PRODUCT_NEW)
      .map((id) => ({ productId: id, name: '' }));
    out.amountTwd = String(v.amountTwd ?? '').trim() === '' ? null : Number(v.amountTwd);
  }

  return out;
}

/**
 * 存得下去嗎。
 *
 * **「她還沒選」與「她選了但填錯」是兩件事。** 一張什麼都還沒點的表送出去，
 * `validateEntitlement()` 會同時吐「額度名稱不可空白」與「要選一個課程」——
 * 兩句話講同一件事，而且第一句用的是她不會用的詞。這裡先攔下來。
 */
export function validate(e, master) {
  if (!picked(e)) return ['先選一個「買了什麼」'];
  // 「復能」那一顆只是分類，還要說是哪一種。這句話比
  // `validateEntitlement()` 的「要挑至少一種器材」好懂 —— 她看到的畫面上
  // 那一排叫「哪一種」，不叫「器材」。
  if (e.type === 'pool' && !(e.optionEquipmentIds ?? []).length) {
    return [`還要選一種${poolCourseOf(master)?.name ?? ''}`];
  }
  return validateEntitlement(e, master);
}

/** 草稿 → 可以寫進 `entitlements` 的那幾個欄位。 */
export function payload(e) {
  const product = e.type === 'product';
  return {
    type: e.type,
    label: e.label,
    totalQty: e.totalQty,
    durationMin: product ? null : (e.durationMin ?? null),
    courseId: e.type === 'single' ? (e.courseId ?? null) : null,
    optionEquipmentIds: e.type === 'pool' ? (e.optionEquipmentIds ?? []) : null,
    frequencyRule: product ? null : (e.frequencyRule ?? null),
    expiresAt: e.expiresAt ?? null,
    // 底下這三個都只影響顯示名稱（ADR-0054、0057）。存 id 而不是只留在名字裡，
    // 是因為主檔上的名字她隨時改得了，而字串比對正是舊 Apps Script 靜默失效的
    // 原因（`domain/followups.js` 的檔頭）。
    tier: e.tier ?? null,
    ivProductId: e.type === 'single' ? (e.ivProductId ?? null) : null,
    // 一次購買一筆，裡面好幾款（`domain/products.js`）。`productId` 保持
    // 寫 null —— 舊資料上有值的那幾筆讀得懂就好，新的不再寫它。
    productId: null,
    // 形狀統一：只有 `productId` 與 `name` 兩個欄位，名字 trim 過。
    // `itemNames()` 本來就 `filter(Boolean)`，所以空字串跟沒有是一樣的 ——
    // 統一是為了讓存進去的東西可預測（Rules 只驗 `items is list`）。
    items: product
      ? (e.items ?? []).map((x) => ({
        productId: x?.productId ?? null,
        name: String(x?.name ?? '').trim(),
      }))
      : null,
    amountTwd: product ? (e.amountTwd ?? null) : null,
  };
}

/** 草稿 → 一筆完整的、可以直接建立的額度文件。新增客戶那一頁用。 */
export function toEntitlement(e, { purchasedAt = null } = {}) {
  return {
    ...payload(e),
    sourcePlanName: null, // 單項加購，不是從範本展開的
    purchasedAt,
    doneCount: 0,
    bookedCount: 0,
    lastReconciledAt: null,
  };
}

/** 一列草稿要怎麼唸出來：`8萬健檢 1 次` / `夜態美 2 份`。 */
export function summaryLine(e) {
  return `${e.label || '（沒有名稱）'} ${e.totalQty ?? 0} ${unitOf(e)}`;
}

/**
 * 營養品論**月**，其餘論次。
 *
 * 她的原話：「次數1就是一個月2就是兩個月的」。以前寫「份」是猜的 ——
 * 一次購買裡有四款，「2 份」那個數字對不上任何東西。
 */
export const unitOf = (e) => (e?.type === 'product' ? '個月' : '次');

// ---------- 底下是這一支自己的欄位 ----------

/**
 * 選了什麼之後才冒出來的那一排。三種情況各一排，同時只會有一排。
 *
 * 判準都不寫死名字：課程是她自己在主檔建的，名字隨時改得了。
 * 「這是健檢」看 `followupCourseId`、「這要選品項」看 `requiresIvProduct`。
 */
function detailRow(e, master) {
  if (e.type === 'product') return productRow(e, master.products ?? []);
  if (e.type === 'pool') {
    return `${poolKindRow(e, master)}${durationRow(e, master)}${nameHint(autoLabel(e, master), picked(e))}`;
  }

  const course = (master.courses ?? []).find((c) => c.id === e.courseId) ?? null;
  if (!course) return '';
  if (course.requiresIvProduct) return ivRow(e, master.ivProducts ?? [], course);
  if (followupCourseIdOf(course)) return tierRow(e, course);
  const rows = durationRow(e, master);
  return rows ? `${rows}${nameHint(autoLabel(e, master), e.courseId)}` : '';
}

// ---------- 復能：哪一種 → 幾分鐘 ----------

/**
 * 「復能」是哪一個課程。**不寫死名字** —— 判準是「排班時要選器材」，
 * 跟 `picksEquipment()` 問的是同一件事。
 *
 * 有兩個以上就取第一個：那時候這一排本來就講不清楚，而她會在主檔上看到問題。
 */
export function poolCourseOf(master = {}) {
  return (master.courses ?? []).find((c) => !c.deletedAt && c.requiresEquipment) ?? null;
}

/**
 * 「哪一種」那一排有哪幾顆。她 2026-09-07 指名的五顆：
 *
 * > 三選一/四選一/高能量雷射/SIS/INDIBA
 *
 * 前面是**整組**（三選一、四選一），後面是**單買一台**。順序是刻意的：
 * 方案裡的那一項就是三選一，她最常買的排最前面（同 `ivChoicesFor()` 的判斷）。
 *
 * 兩組整組的定義：
 *
 * - **三選一** = 復能那個課程自己的器材（`courseId` 指到它的那幾台）
 * - **四選一** = 全部還在用的器材（多出來的就是 ILIB）
 *
 * 兩組一樣大時只留一顆 —— 畫兩顆一模一樣的丸子等於在問一個沒有答案的問題。
 * 一台器材都沒有指到課程（舊資料）時，「整組」就是全部，只有一顆。
 *
 * **單買那一排只有復能自己的器材**，ILIB 不在裡面：它在「買了什麼」那一排
 * 自己有一顆（就在復能隔壁），而單買 ILIB 是那個課程的 `single` 額度 ——
 * 它要的是診間不是治療師，跟池裡那三台不是同一種東西。同一件事給兩條路買，
 * 兩邊算出來的次數會對不起來。
 *
 * 丸子上印的是器材的**全名**，跟 `poolName()` 算出來的名字同一份 ——
 * 按下去之後名字變成什麼，按之前就看得到。（別稱那一格留給月曆，
 * 那裡 INDIBA 是 `IN`，但這一排要印 `INDIBA`，見 2026-09-08 那一輪。）
 */
export function poolChoices(master = {}) {
  const equipment = (master.equipment ?? []).filter((e) => !e.deletedAt && e.active !== false);
  const home = poolCourseOf(master);
  const tagged = equipment.filter((e) => e.courseId);

  const mine = home && tagged.length
    ? equipment.filter((e) => e.courseId === home.id)
    : equipment;
  const homeIds = mine.map((e) => e.id);
  const allIds = equipment.map((e) => e.id);

  const sets = [];
  if (homeIds.length > 1) sets.push({ value: POOL_SET_HOME, ids: homeIds });
  if (allIds.length > homeIds.length && allIds.length > 1) {
    sets.push({ value: POOL_SET_ALL, ids: allIds });
  }

  return {
    sets: sets.map((x) => ({ ...x, label: `${countWord(x.ids.length)}選一` })),
    singles: mine.map((eq) => ({
      value: eq.id,
      ids: [eq.id],
      label: String(eq.name ?? '').trim(),
    })),
  };
}

/** 那一顆的值 → 要存進去的那一串器材 id。認不得的回 null（呼叫端當成沒選）。 */
export function idsForPoolKind(value, master = {}) {
  if (!value || value === '__null__') return null;
  const { sets, singles } = poolChoices(master);
  return [...sets, ...singles].find((x) => x.value === value)?.ids ?? null;
}

/**
 * 現在按著的是哪一顆。**比的是那一串 id，不是記她按了什麼** ——
 * 從方案展開出來的額度身上只有 ids，而她點進去調整時那一排也要按對。
 */
export function poolPickOf(e, master = {}) {
  const mine = [...(e?.optionEquipmentIds ?? [])].sort().join('|');
  if (!mine) return null;
  const { sets, singles } = poolChoices(master);
  return [...sets, ...singles]
    .find((x) => [...x.ids].sort().join('|') === mine)?.value ?? null;
}

/**
 * 「哪一種」那一排。
 *
 * 她的原話：「點了之後可以選選是三選一，四選一，或是單一的哪一項」。
 * 整組與單買中間隔一條線＋一個小標，跟「買了什麼」那一排把營養品分出來
 * 同一個作法 —— 一排七八顆要滑，而後面那一組是另一種東西，得先說一聲。
 */
function poolKindRow(e, master) {
  const { sets, singles } = poolChoices(master);
  if (!sets.length && singles.length < 2) return '';

  return `
    ${f.chips({
      name: 'poolKind',
      label: '哪一種',
      value: poolPickOf(e, master),
      options: [
        ...sets,
        ...singles.map((x, i) => (i === 0 ? { ...x, lead: '單買一台' } : x)),
      ].map(({ value, label, lead }) => ({ value, label, ...(lead ? { lead } : {}) })),
    })}`;
}

/**
 * 「幾分鐘」那一排。**名單在課程主檔上**（`durationChoices`），不寫死課程名字。
 *
 * 沒填的課程整排不出現 —— 健檢那一格永遠不會被按的丸子只是噪音。
 */
function durationRow(e, master) {
  const course = e.type === 'pool'
    ? poolCourseOf(master)
    : (master.courses ?? []).find((c) => c.id === e.courseId) ?? null;
  const choices = durationChoicesOf(course);
  if (choices.length < 2) return '';

  return `
    ${f.chips({
      name: 'durationMin',
      label: '幾分鐘',
      value: e.durationMin == null ? null : String(e.durationMin),
      options: choices.map((n) => ({ value: String(n), label: `${n} 分鐘` })),
    })}`;
}

/**
 * 「幾萬的」那一排。**只在選到有配二返的課程時出現**（健檢就是那一種）。
 *
 * 等級只進顯示名稱（ADR-0054），所以它就長在名稱旁邊，不進「進階設定」。
 * 「其他…」讓她自己打 —— 她的資料裡有「5萬(心臟)」這種。
 */
function tierRow(e, course) {
  const tier = String(e.tier ?? '').trim();
  const custom = Boolean(e.tierOther) || (Boolean(tier) && !TIER_PRESETS.includes(tier));

  return `
    ${f.chips({
      name: 'tier',
      label: '幾萬的',
      value: custom ? TIER_OTHER : (tier || null),
      options: [
        ...TIER_PRESETS.map((t) => ({ value: t, label: t })),
        { value: TIER_OTHER, label: '其他…' },
      ],
    })}
    <div data-tierother ${custom ? '' : 'hidden'}>
      ${f.text({
        name: 'tierText', label: '自己打', value: custom ? tier : '',
        placeholder: '5萬(心臟)',
      })}
    </div>
    ${nameHint(tieredLabel(tier, course.name), tier)}`;
}

/**
 * 營養點滴的「哪一種」。
 *
 * `CONTEXT.md`：營養點滴品項「各自有各自的次數，不合併計算」，所以一筆額度
 * 就是一個品項。舊資料匯進來的時候本來就是這樣拆的
 *（`domain/legacyImport.js`），只有她手動加購這條路以前做不到。
 */
function ivRow(e, ivProducts, course) {
  return `
    ${f.chips({
      name: 'ivProductId',
      label: '哪一種',
      value: e.ivProductId ?? null,
      options: ivProducts.map((p) => ({ value: p.id, label: p.name })),
    })}
    ${nameHint(
      itemisedLabel(course.name, ivProducts.find((p) => p.id === e.ivProductId)?.name ?? ''),
      e.ivProductId,
    )}`;
}

/**
 * 營養品的「哪幾種」與「多少錢」。
 *
 * **複選**，因為一次購買就是好幾種：她記的是
 * `營養品(5000) : 夜態美+速體淨+粒能康+GABA`，那是一筆不是四筆
 *（金額是整包的，拆成四筆就沒有地方放）。見 `domain/products.js`。
 *
 * 「新增…」讓她當場加一款沒有事先設定好的 —— 她的原話是
 * 「有些可能沒有事先設定好的這邊可以新增」。按下去在旁邊展開一格打名字，
 * 送出時才真的寫進主檔（`config/products`）。
 */
function productRow(e, products) {
  const ids = itemsOf(e).map((x) => x.productId).filter(Boolean);
  const adding = Boolean(e.newProduct);
  return `
    ${f.chips({
      name: 'productIds',
      label: '哪幾種　可以複選',
      value: adding ? [...ids, PRODUCT_NEW] : ids,
      multi: true,
      options: [
        ...products.map((p) => ({ value: p.id, label: p.name })),
        { value: PRODUCT_NEW, label: '＋ 新增…', lead: '沒有的' },
      ],
    })}
    <div data-newproduct ${adding ? '' : 'hidden'}>
      ${f.text({
        name: 'newProductName', label: '新的那一款叫什麼',
        value: e.newProductName ?? '',
        placeholder: '例：Q10',
        hint: '存下去的時候會一起加進「設定 → 營養品」，下次就選得到了。',
      })}
    </div>
    ${f.number({
      name: 'amountTwd', label: '多少錢　選填',
      // **step 是 1，不是 100。** 以前是 100，於是 5050 被瀏覽器的內建驗證
      // 擋下來（「最接近的有效值為 5000 和 5100」）—— 表單連 submit 都不會
      // 觸發，所以 `validateProduct()` 那條規則其實一次都沒攔到她。
      // 那個 100 是「金額通常是整百」的猜測，而 5050 就是反例。
      //
      // min 是 1 不是 0：`validateProduct()` 本來就擋 0
      //（送的東西她不會記在營養品那一列），欄位要跟驗證講同一句話。
      value: e.amountTwd ?? '', min: 1, step: 1,
      hint: '整包的價錢，打多少就是多少。會寫進名稱裡，也會進試算表。',
    })}
    ${nameHint(productLabel(e), ids.length)}`;
}

/**
 * 「到期日」那一排。**進階設定裡的東西**，不在主體上。
 *
 * 她 2026-09-06：
 *
 * > 其實現在不需要到期日了，可以保留但就是選填，基本上不會到期……
 * > 也許可以選一年半年自訂時間等等
 *
 * 所以預設按在「不到期」，而不是像以前一樣算一個出來。半年與一年從**購買日**
 * 起算（沒有購買日就從今天）—— 那兩顆的值**就是算好的那一天**，
 * 所以 `read()` 一行日期運算都不用做。
 *
 * 「自己選」跟「其他…」「＋ 新增…」是同一個作法：開合狀態存在草稿上
 * （`expiryOther`），畫的時候就決定，不必另外接一段。
 *
 * @param {object} e 草稿
 * @param {{from?: string|null}} [o] 從哪一天起算
 */
export function expiryRow(e, { from = null } = {}) {
  const base = isValidDate(from) ? from : todayISO();
  const options = EXPIRY_PRESETS.map((x) => ({
    value: addMonths(base, x.months),
    label: x.label,
  }));
  const now = e?.expiresAt ?? null;
  const custom = Boolean(e?.expiryOther)
    || (Boolean(now) && !options.some((o) => o.value === now));

  return `
    ${f.chips({
      name: 'expiryPreset',
      label: '到期日',
      value: custom ? EXPIRY_OTHER : (now ?? EXPIRY_NONE),
      options: [
        { value: EXPIRY_NONE, label: '不到期' },
        ...options,
        { value: EXPIRY_OTHER, label: '自己選' },
      ],
      hint: `半年與一年從${isValidDate(from) ? '購買日' : '今天'}起算。`,
    })}
    <div data-expiryother ${custom ? '' : 'hidden'}>
      ${f.date({ name: 'expiresAt', label: '哪一天', value: custom ? (now ?? '') : '' })}
    </div>`;
}

/**
 * 「會變成『8萬健檢』」那一句。
 *
 * 它不是說明，是**預告** —— 自動帶的名稱藏在「進階設定」裡，不講的話她要
 * 存下去才知道那一筆會叫什麼。還沒選就不講（那是在講一件還沒發生的事）。
 *
 * **不講的時候節點還是要在**，只是 `hidden`。她在「自己打」那一格打字時
 * 這一頁不重畫（會洗掉游標與輸入法的組字狀態），所以那一句是就地換字的 ——
 * 沒有節點的話第一個字打下去就沒有東西可以改。
 */
function nameHint(name, hasPick) {
  const show = Boolean(hasPick) && Boolean(name);
  return `
    <p class="muted dim" data-namehint ${show ? '' : 'hidden'}
       style="margin: calc(var(--space-2) * -1) 0 var(--space-4); font-size: var(--text-2xs)"
       >${show ? `會變成「${f.esc(name)}」` : ''}</p>`;
}

/** 幾次／幾份。營養品論份 —— 一罐夜態美不是「一次」。 */
function qtyField(e) {
  const unit = `幾${unitOf(e)}`;
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">${unit}</span>
      <div class="qty">
        <input class="qty__n" type="number" name="totalQty" min="1" step="1"
               inputmode="numeric" value="${f.esc(e.totalQty ?? 1)}" aria-label="${unit}" />
        ${[1, 5, 10].map((n) => `
          <button class="chip chip--sm" type="button" data-qty="${n}">+${n}</button>`).join('')}
      </div>
    </div>`;
}

/**
 * **存檔前的最後一站。** 做兩件事：
 *
 *   1. 她在「＋ 新增…」那一格打的那一款，寫進主檔並選起來
 *   2. **把 `items` 上的名字從主檔補齊**（`withItemNames()`）
 *
 * 第二件事看起來多餘 —— `afterDetail()` 已經補過了。但那一份會被存檔那一下的
 * `values(form)` 蓋掉：表單只送得回 id（`read()` 給的 `name` 一律是空字串）。
 * 於是寫進 Firestore 的是一排沒有名字的 `items`，而三個地方會一起壞：
 * 顯示名稱少了那幾款、提醒那一句變成「給營養品：營養品」、
 * 交付面板每一列都是空白（`issues/08`）。
 *
 * **三個入口共用同一支**，理由跟 `wire()` 一樣：三邊各寫一次的話，遲早有一邊
 * 忘了把新建的那一筆選進 `items`，於是她打了名字、存下去，那一款卻不在裡面。
 *
 * 存檔前叫一次。沒有要新增就只補名字，一次 IO 都不會發生。
 *
 * **寫入那一下是呼叫端傳進來的**，這一支不 import `/data` ——
 * `tests/buy.test.js` 直接載入這個檔案，而 `data/config.js` 那條路會一路
 * import 到 Firebase SDK（一個 `https:` 網址），Node 載不動。
 *
 * @param {object} draft
 * @param {{products?: object[]}} master 呼叫端手上的主檔（會被就地補一筆）
 * @param {(data: {name: string}) => Promise<string>} createProduct 回新的 id
 * @returns {Promise<object>} 換掉之後的草稿
 */
export async function commitNewProduct(draft, master = {}, createProduct) {
  const name = String(draft?.newProductName ?? '').trim();
  if (!draft?.newProduct || !name || typeof createProduct !== 'function') {
    return withItemNames(draft, master);
  }

  // 同名的已經有了就用既有那一筆，不要長出第二個「Q10」——
  // 主檔上兩筆同名的東西，她之後分不出該選哪一個。
  const existing = (master.products ?? []).find(
    (p) => !p.deletedAt && String(p.name).trim() === name,
  );
  const id = existing?.id ?? await createProduct({ name });
  if (!existing) (master.products ??= []).push({ id, name });

  const items = [...(draft.items ?? [])];
  if (!items.some((x) => x.productId === id)) items.push({ productId: id, name });

  return withItemNames(
    { ...draft, items, newProduct: false, newProductName: '', label: draft.label },
    master,
  );
}

// ---------- 底下是三個入口共用的那一份接線 ----------

/** 「哪一種／幾萬的」那幾排丸子。換了它們要跟著改顯示名稱。 */
const DETAIL_CHIPS = '[data-chip="tier"], [data-chip="ivProductId"], [data-chip="productIds"], '
  + '[data-chip="poolKind"], [data-chip="durationMin"], [data-chip="expiryPreset"]';

/**
 * **打字**會改到顯示名稱的那幾格。
 *
 * 「多少錢」以前不在裡面，所以金額有存進去、就是**沒有進名字** ——
 * 而 `productLabel()` 的整個設計（ADR-0059：`營養品(5000)` 是她舊表的寫法）
 * 都依賴那個名字。她看到的症狀是「輸入的價格沒有被加入到名稱顯示中」
 * （`.scratch/quick-actions-and-supplements/issues/09`）。
 */
const TYPED_FIELDS = '[name="tierText"], [name="newProductName"], [name="amountTwd"]';

/**
 * 這一張表自己管的那幾個欄位，從表單上讀回來。
 *
 * 客戶詳情那一張還要讀顯示名稱、時長、到期日那幾格，所以它自己給一支
 * （`wire()` 的 `typed` 參數）。沒給的就是這一支 —— 兩張只有加購的表
 *（新增客戶、批次建立的微調）表上就只有這些。
 */
export function values(form, master = {}) {
  const v = f.readForm(form);
  return { totalQty: v.totalQty, ...read(form, v, master) };
}

/**
 * 把這一張表接起來。**三個入口共用同一份。**
 *
 * 以前這幾行在每個入口各寫一次，於是「其他…」展開的那一格漏了兩次都沒有人
 * 發現 —— 打字不是點擊，而三個入口都只聽了點丸子
 *（`.scratch/buying-in-bulk/issues/02`）。
 *
 * 呼叫端只回答一件事：**哪一塊要重畫**。`repaint` 是 false 的那幾下
 *（`+1` 與打字）一定也要把草稿收起來，`afterDetail()` 的檔頭寫了為什麼。
 *
 * 事件用委派，所以重畫之後不必重掛 —— 但 `root` 必須是**重畫時會被換掉**
 * 的那一層（或者本來就只有一個，例如一張面板），不然每重畫一次就多一組。
 * `f.wireChips(root)` 要先掛，它換的 hidden input 就是這裡讀回來的東西。
 *
 * @param {HTMLElement} root 事件委派掛在這上面
 * @param {object} o
 * @param {() => HTMLFormElement|null} o.form 現在畫面上的那一張表
 * @param {() => object} o.draft 現在的草稿
 * @param {{courses:object[], equipment:object[], ivProducts:object[], products:object[]}} o.master
 * @param {(form: HTMLFormElement) => object} [o.typed] 表單上還要讀哪些欄位
 * @param {(next: object, o: {repaint: boolean}) => void} o.onChange
 */
export function wire(root, { form, draft, master, typed = (box) => values(box, master), onChange }) {
  root.addEventListener('click', (ev) => {
    const box = form();
    if (!box) return;

    const chosen = ev.target.closest('[data-chip="buy"]');
    if (chosen) {
      onChange(afterPick(chosen.dataset.chipValue, draft(), typed(box), master), { repaint: true });
      return;
    }

    if (ev.target.closest(DETAIL_CHIPS)) {
      onChange(afterDetail(draft(), typed(box), master), { repaint: true });
      return;
    }

    const qty = ev.target.closest('[data-qty]');
    if (qty) {
      const n = box.elements.totalQty;
      if (!n) return;
      n.value = Math.max(1, Number(n.value || 0) + Number(qty.dataset.qty));
      // 只改了一個數字，畫面上沒有別的東西要跟著變 —— 重畫只會讓她的下一下
      // 「+1」落空（ADR-0038）。
      onChange({ ...draft(), ...typed(box) }, { repaint: false });
    }
  });

  // 「其他…」與「新增…」展開的那一格。**打字不重畫** —— 重畫會把游標與
  // 輸入法的組字狀態一起洗掉，所以顯示名稱與那句預告是就地改的。
  root.addEventListener('input', (ev) => {
    if (!ev.target.matches?.(TYPED_FIELDS)) return;
    const box = form();
    if (!box) return;

    const next = afterDetail(draft(), typed(box), master);
    onChange(next, { repaint: false });
    reflect(root, box, next, master);
  });
}


/** 不重畫的那條路上，把新的顯示名稱寫回畫面。兩個地方會講到它。 */
function reflect(root, form, e, master) {
  // 顯示名稱那一格只有客戶詳情那一張表有（另外兩張沒有「進階設定」）
  if (form.elements.label) form.elements.label.value = e.label ?? '';

  const hint = root.querySelector('[data-namehint]');
  if (!hint) return;
  const name = autoLabel(e, master);
  hint.textContent = name ? `會變成「${name}」` : '';
  hint.hidden = !name;
}
