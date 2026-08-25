// 「買了什麼」那一張表。**客戶詳情的「加購」與新增客戶那一頁共用同一份。**
//
// 兩個入口問的是同一句話（「這位客戶多買了什麼」），所以不可以有兩張長得不一樣
// 的表 —— 她在一邊選得到營養點滴的品項、另一邊選不到，那不是兩個畫面，
// 是同一個畫面壞了一半。
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

import * as f from './form.js';
import {
  TIER_PRESETS, tieredLabel, itemisedLabel, validateEntitlement,
} from '../../domain/entitlements.js';
import { followupCourseIdOf } from '../../domain/followups.js';

/** 「買了什麼」那一排裡代表擇一池的那一顆。它不是課程，所以借不到課程 id。 */
export const POOL_PICK = '__pool__';

/** 同上，代表營養品的那一顆。選了它才會冒出「哪一種」那一排。 */
export const PRODUCT_PICK = '__product__';

/** 「幾萬的」那一排裡的「其他…」。它不是一個等級，是一顆展開輸入框的鈕。 */
export const TIER_OTHER = '__other__';

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
    productId: null,
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
        ...(master.courses ?? []).map((c) => ({ value: c.id, label: c.name })),
        { value: POOL_PICK, label: '復能（三選一池）' },
        // 營養品放最後一顆，而且前面隔一條線 —— 它不是課程。一排十幾顆要滑，
        // 滑到底才看到的那一顆如果是另一種東西，得先說一聲。
        { value: PRODUCT_PICK, label: '營養品', lead: '商品' },
      ],
    })}

    ${detailRow(e, master)}
    ${qtyField(e)}`;
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
    const next = {
      type: 'pool',
      courseId: null,
      productId: null,
      ivProductId: null,
      tier: null,
      tierOther: false,
      optionEquipmentIds: equipment.map((x) => x.id),
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
      // 換去營養品再換回來的時候，她剛剛挑的那一款留著
      productId: e.productId ?? null,
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
    optionEquipmentIds: [],
    tier,
    tierOther: Boolean(tier) && !TIER_PRESETS.includes(tier),
    ivProductId: course?.requiresIvProduct ? (e.ivProductId ?? null) : null,
    // 選了課程就把時長帶進來 —— 她一個字都不用打
    durationMin: e.durationMin ?? null,
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
 * 自動帶的顯示名稱。選什麼就叫什麼，她一個字都不用打。
 *
 * 三種接法各有各的來源：健檢是等級＋課程名（ADR-0054）、營養點滴是
 * 課程名＋品項（`itemisedLabel()`，跟舊資料匯進來的那幾筆同一支）、
 * 營養品就是那一款的名字。
 */
export function autoLabel(e, master) {
  if (e?.type === 'product') {
    return (master.products ?? []).find((p) => p.id === e.productId)?.name ?? '';
  }
  if (e?.type === 'pool') return '復能';

  const course = (master.courses ?? []).find((c) => c.id === e?.courseId) ?? null;
  if (!course) return '';
  if (course.requiresIvProduct) {
    const item = (master.ivProducts ?? []).find((p) => p.id === e.ivProductId)?.name ?? '';
    return itemisedLabel(course.name, item);
  }
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
export function read(form, v) {
  const out = {};

  if (form.elements.tier) {
    const pickedTier = v.tier ?? null;
    const other = pickedTier === TIER_OTHER;
    out.tier = (other ? String(v.tierText ?? '').trim() : String(pickedTier ?? '').trim()) || null;
    out.tierOther = other;
  }
  if (form.elements.ivProductId) out.ivProductId = v.ivProductId ?? null;
  if (form.elements.productId) out.productId = v.productId ?? null;

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
    productId: product ? (e.productId ?? null) : null,
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

/** 營養品論份，其餘論次。 */
export const unitOf = (e) => (e?.type === 'product' ? '份' : '次');

// ---------- 底下是這一支自己的欄位 ----------

/**
 * 選了什麼之後才冒出來的那一排。三種情況各一排，同時只會有一排。
 *
 * 判準都不寫死名字：課程是她自己在主檔建的，名字隨時改得了。
 * 「這是健檢」看 `followupCourseId`、「這要選品項」看 `requiresIvProduct`。
 */
function detailRow(e, master) {
  if (e.type === 'product') return productRow(e, master.products ?? []);
  if (e.type === 'pool') return '';

  const course = (master.courses ?? []).find((c) => c.id === e.courseId) ?? null;
  if (!course) return '';
  if (course.requiresIvProduct) return ivRow(e, master.ivProducts ?? [], course);
  if (followupCourseIdOf(course)) return tierRow(e, course);
  return '';
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

/** 營養品的「哪一種」。名字就是那一款的名字，不用再預告一次。 */
function productRow(e, products) {
  return f.chips({
    name: 'productId',
    label: '哪一種',
    value: e.productId ?? null,
    options: products.map((p) => ({ value: p.id, label: p.name })),
  });
}

/**
 * 「會變成『8萬健檢』」那一句。
 *
 * 它不是說明，是**預告** —— 自動帶的名稱藏在「進階設定」裡，不講的話她要
 * 存下去才知道那一筆會叫什麼。還沒選就不印（在講一件還沒發生的事）。
 */
function nameHint(name, hasPick) {
  if (!hasPick || !name) return '';
  return `
    <p class="muted dim" style="margin: calc(var(--space-2) * -1) 0 var(--space-4); font-size: var(--text-2xs)">
      會變成「${f.esc(name)}」</p>`;
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
