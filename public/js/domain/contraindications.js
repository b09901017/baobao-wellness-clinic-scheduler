// 器材提醒：哪一台對這位客戶要提醒，以及建議改用哪一台。
//
// ## 這裡不再擋任何東西
//
// 2026-09-06 之前，「體內金屬 → 超磁場與高能量雷射」是整個系統唯一的硬性阻擋
// （ADR-0002 的例外條款）。她那天說：
//
// > 有體內金屬只能壓 INDIBA（但是其他兩個也不是一定不行（只要儀器不要在金屬的
// > 上方或附近），只是會強烈建議用 INDIBA），所以其實體內有金屬這件事不用硬性擋
// > 不能壓其他兩個，就只要明顯的標註提醒就好，不用擋
//
// 那個例外當初站得住的理由是「它不需要推算，只是比對客戶身上有沒有那個標記」。
// 現在知道它**其實需要推算**（要看儀器擺在哪裡），所以理由不成立了。
// 見 docs/adr/0074-a-contraindication-warns-it-does-not-block.md。
//
// 所以這一支從「擋不擋」變成兩個問題：
//
//   noticeFlags()        這一台對這位客戶，有哪幾個字要提醒
//   suggestedEquipment() 這一池裡，哪幾台沒有東西要提醒
//
// ## 檔名沒有跟著改
//
// 改檔名要動 `public/sw.js` 的 SHELL 清單、十幾支 import 與測試，換來的只有一個
// 更貼切的名字。同一個取捨這個專案做過一次：「個人行程」改名成「行事備註」之後，
// 資料上的 `category` id（`personal` / `leave`）沒有跟著改（CONTEXT.md）。
//
// ## 那些字仍然記在器材主檔上
//
// 她 2026-09-06 選的：「留在器材主檔上，只改行為」。這樣「建議改用 INDIBA」是
// **算出來的**（那一池裡唯一沒有東西要提醒的那台），器材主檔一改它跟著改 ——
// 而不是另外維護一份「哪個狀況建議哪一台」的名單。

/** 這一台對這位客戶有沒有東西要提醒。 */
export function hasNotice(customer, equipment) {
  return noticeFlags(customer, equipment).length > 0;
}

/**
 * 這一台對這位客戶，是哪幾個字要提醒。
 *
 * UI 一定要講得出是哪一個字 —— 「這台要注意」而不說為什麼，跟沒說一樣。
 */
export function noticeFlags(customer, equipment) {
  const flags = customer?.flags ?? [];
  const contra = equipment?.contraindications ?? [];
  return flags.filter((f) => contra.includes(f));
}

/**
 * 把擇一池的器材選項標上「要不要提醒」。
 *
 * 回傳的順序與輸入相同 —— 要提醒的那幾台**照樣可以選**（2026-09-06 之後不再
 * 劃掉），順序變了她會找不到剛才那一顆。
 *
 * @param {{flags?: string[]}} customer
 * @param {{id:string, name:string, contraindications?: string[]}[]} equipmentOptions
 */
export function annotateOptions(customer, equipmentOptions) {
  return equipmentOptions.map((eq) => {
    const reasons = noticeFlags(customer, eq);
    return { ...eq, notice: reasons.length > 0, reasons };
  });
}

/**
 * 這一池裡，哪幾台沒有東西要提醒、哪幾台有。
 *
 * 「建議改用 INDIBA」那一句就是從這裡來的 —— **算出來的，不是打字打的**。
 * 器材主檔上的字一改，這句話跟著改。
 *
 * 沒有任何一台要提醒就回 `null`：那時候整句話都不必講，
 * 不然它會變成每一位客戶都看得到的裝飾。
 *
 * @param {{flags?: string[]}} customer
 * @param {{id:string, name:string, contraindications?: string[]}[]} equipmentOptions
 * @returns {{suggested: object[], noticed: object[]}|null}
 */
export function suggestedEquipment(customer, equipmentOptions = []) {
  const annotated = annotateOptions(customer, equipmentOptions);
  const noticed = annotated.filter((eq) => eq.notice);
  if (!noticed.length) return null;
  return { suggested: annotated.filter((eq) => !eq.notice), noticed };
}

/**
 * 她剛剛選了這一台，畫面上要講的那一句。沒有東西要提醒就回 `null`。
 *
 * 分兩段是刻意的，因為它們的重量不一樣：
 *
 *   headline  這一台對這位客戶要注意，而且建議改用哪一台   —— 有底色，一眼看得到
 *   detail    真的要用的話要先確認什麼                    —— 小字
 *
 * `detail` 寫得**通用**，不寫死「金屬」：這一段字對任何一種提醒都成立，
 * 而器材主檔上之後會有別的字。她的原話（「只要儀器不要在金屬的上方或附近」）
 * 講的正是這件事 —— 位置避得開就做得了。
 *
 * @param {{flags?: string[]}} customer
 * @param {{id:string, name:string, contraindications?: string[]}} equipment 她選的那一台
 * @param {object[]} [options] 這一段可以選的那幾台，用來算「建議改用」
 * @returns {{headline: string, detail: string, reasons: string[]}|null}
 */
export function noticeSentence(customer, equipment, options = []) {
  const reasons = noticeFlags(customer, equipment);
  if (!reasons.length) return null;

  // 建議名單裡不要有她剛剛選的那一台 —— 「建議改用超磁場」而她選的就是超磁場，
  // 那句話會讓她以為自己點錯了。
  const better = annotateOptions(customer, options)
    .filter((eq) => !eq.notice && eq.id !== equipment?.id)
    .map((eq) => eq.name);

  const what = `${equipment?.name ?? '這一台'} 對「${reasons.join('、')}」要注意`;
  return {
    headline: better.length ? `${what} — 建議改用 ${better.join('、')}` : what,
    detail: '真的要用的話，先確認儀器的擺放位置避得開。',
    reasons,
  };
}

/**
 * 送出前的檢查。**回的是 warnings 不是 errors** —— 存得下去。
 *
 * 2026-09-06 之前這一支叫 `validateSlots()`，它的回傳被 `domain/visits.js` 接進
 * `visitErrors()`。現在接進 `visitWarnings()`：她那天在診間裡看得到儀器擺在哪，
 * app 看不到（ADR-0002 的主體）。
 *
 * @returns {{slotIndex:number, equipmentId:string, message:string}[]}
 */
export function equipmentNotices(customer, slots, equipmentById) {
  const out = [];
  for (const [i, slot] of (slots ?? []).entries()) {
    if (!slot.equipmentId) continue;
    const eq = equipmentById[slot.equipmentId];
    if (!eq) continue;
    const reasons = noticeFlags(customer, eq);
    if (reasons.length) {
      out.push({
        slotIndex: i,
        equipmentId: slot.equipmentId,
        message: `${eq.name} 對「${reasons.join('、')}」要注意`,
      });
    }
  }
  return out;
}

/**
 * 目前所有器材宣告的提醒詞，去重，維持器材主檔上的順序。
 *
 * 2026-09-06 之前這是「哪些字會真的擋下器材」的唯一來源。現在它回答的是
 * **「哪些字會讓某一台器材跳出提醒」**，而那份名單要**進得了警示主檔**
 * （`config/app/clinicalFlags`）才畫得到客戶身上 —— 器材上有、警示主檔沒有的
 * 那幾個字由資料健檢列出來，見 `domain/health.js`。
 *
 * @param {{contraindications?: string[], deletedAt?: any}[]} equipment 器材主檔
 * @returns {string[]}
 */
export function contraindicationTerms(equipment = []) {
  const alive = (equipment ?? []).filter((e) => e && !e.deletedAt);
  return [...new Set(alive.flatMap((e) => e.contraindications ?? []))];
}

/**
 * 文字裡有沒有出現主檔登記的提醒詞。
 *
 * 舊表沒有「永久限制」這個欄位，所以那些話寫在購買名稱裡（`0604 顧客會-手有金屬，
 * 只能INDIBA`）或空白處。匯進來之後 `customer.flags` 是空的，而那位客戶身上
 * 就不會有任何提醒 —— 壓表那一刻她看不到「這個人有金屬」。
 *
 * 要找的字不寫死在這裡，從主檔的器材上推出來（CLAUDE.md：那些字記在器材上）。
 * 她之後新增一台有別的提醒詞的器材，這裡自動就會找那個字。
 *
 * **只提示，不自動填 flags。** 「手有金屬」是要提醒的，但「金屬已取出」不是，
 * 而兩句話都含有「金屬」—— 那是她的判斷（ADR-0002）。
 *
 * @returns {{where: string, text: string, term: string, blocks: string[]}[]}
 *   `blocks` 這個欄位名留著 —— 匯入報告那兩支（`legacyImport.js`、`mergeImport.js`）
 *   與它們的測試都讀它，而它現在的意思是「這幾台會跳提醒」。
 */
export function contraindicationHints(sources, equipment) {
  const alive = equipment.filter((e) => !e.deletedAt);
  // 要找哪些字跟「客戶身上可以點哪些丸子」是同一個問題，共用同一支
  const terms = contraindicationTerms(equipment);
  const hints = [];

  for (const term of terms) {
    // 「體內金屬」寫在舊表上可能是「手有金屬」。前面的限定詞拿掉再找一次。
    const needles = [...new Set([term, term.replace(/^(體內|身上|身體|有)/, '')])]
      .filter((n) => n.length >= 2);
    const blocks = alive.filter((e) => (e.contraindications ?? []).includes(term))
      .map((e) => e.name);

    for (const { where, text } of sources) {
      if (!text || !needles.some((n) => text.includes(n))) continue;
      hints.push({ where, text, term, blocks });
    }
  }
  return hints;
}
