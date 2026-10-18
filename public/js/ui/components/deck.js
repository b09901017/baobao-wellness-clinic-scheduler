// 一疊左右滑的卡：停在哪一張、滑到某一張、丸子與小圓點跟著亮。
//
// 備忘錄（`views/playbook.js`）與長備註（`views/longNotes.js`，ADR-0156）共用 —— 她指名長備註「像備忘錄那樣」，
// 兩頁的手感要是同一個。畫法（`.pbdeck`、`.pbcard`、`.pbchips`、`.pbdots`）也是同一份 CSS。
//
// 這裡不產生 HTML，只讀那一頁自己的三個屬性：`[data-card]`（一張卡）、`[data-goto]`（上面那一排丸子）、
// `[data-dot]`（底下的小圓點），值都是那一張的 id。
//
// ## 左右滑用原生捲動，不自己接手勢
//
// `scroll-snap-type: x mandatory` + 每張 `scroll-snap-align: center`。自己寫 touchmove 永遠差一截慣性與橡皮筋。
// 現在停在第幾張用 `IntersectionObserver` 認，**不用 scroll 事件**：scroll 在 iOS 上捲動時會被節流，
// 圓點與丸子會跟不上手指。

/** 丸子與圓點只改屬性，整塊不重畫（ADR-0038）。 */
export function markActive(root, id) {
  for (const b of root.querySelectorAll('[data-goto]')) {
    b.setAttribute('aria-pressed', String(b.dataset.goto === id));
  }
  for (const d of root.querySelectorAll('[data-dot]')) {
    d.setAttribute('data-on', String(d.dataset.dot === id));
  }
}

/** 滑到那一張。找不到回 false。 */
export function focusCard(root, id, behavior = 'smooth') {
  const card = root.querySelector(`[data-card="${CSS.escape(id)}"]`);
  if (!card) return false;
  markActive(root, id);
  card.scrollIntoView({ behavior, inline: 'center', block: 'nearest' });
  return true;
}

/**
 * 認「現在停在第幾張」。**每次重畫前要先 `disconnect()` 上一個**，不然會愈積愈多。
 *
 * @param {HTMLElement} deck `[data-deck]`
 * @param {(id: string) => void} onActive 換了一張；呼叫端記住它、再叫 `markActive()`
 * @returns {IntersectionObserver|null}
 */
export function watchDeck(deck, onActive) {
  if (!deck) return null;
  const spy = new IntersectionObserver((entries) => {
    // 一次可能有兩張同時越線（一張進一張出），挑露出最多的那一張
    const best = entries
      .filter((x) => x.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    const id = best?.target.dataset.card;
    if (id) onActive(id);
  }, { root: deck, threshold: [0.55, 0.85] });
  for (const card of deck.querySelectorAll('[data-card]')) spy.observe(card);
  return spy;
}
