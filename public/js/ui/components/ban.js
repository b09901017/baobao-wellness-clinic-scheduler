// 「不能的時間」那一塊。
//
// **只放解析出來的條件丸子**，原文收在摺疊裡。原本原文是這一塊最大的一段，
// 現在幾乎每一份都是客戶自己在表單上填的，而那份原文是系統照他的答案產生的
// —— 把同一件事講第二次，佔掉的是她一眼要掃到的位置（ADR-0035）。
//
// 三個畫面共用一份：壓表卡片牆、壓表記錄面板、客戶詳情。
// 第三個是 2026-08-24 加的 —— 她的原話是「不能的時間，我希望呈現方式可以
// 像是壓表客戶牆那邊呈現的一樣」，而在那之前客戶詳情自己有一套：原文用正常
// 字級擺最上面、規則變成項目符號清單、再加兩行說明。同一件事兩種樣子。
//
// ## 哪一份算數不是這裡決定的
//
// 這一支只管畫。**綁月份的畫面（壓表）與問「現在」的畫面（客戶詳情）
// 該拿哪一份是不一樣的**，見 `CLAUDE.md` 的連動表與 ADR-0036 ——
// 挑錯的後果是假的「可用 0 天」把人推到排序第一位。呼叫端自己挑好再傳進來。

import { esc } from './form.js';
import { availableDates, partLabel } from '../../domain/availability.js';

/**
 * @param {object} row
 * @param {boolean} [row.needsAvailability] 這個月沒問過
 * @param {string} [row.collectedAt] 什麼時候問的
 * @param {object[]} [row.rules]
 * @param {number} [row.availableDays]
 * @param {string} [row.rawText]
 * @param {boolean} [row.fromForm] 客戶自己填的（比她轉述的可信，值得看得見）
 * @param {{month: string, raw?: boolean, rawLabel?: string}} options
 *   month：講給人聽的月份，例：'9月'。raw：附不附「他原本是怎麼說的」那一摺。
 */
export function banBlock(row, { month, raw = false, rawLabel = '他原本是怎麼說的' } = {}) {
  if (row.needsAvailability) {
    return `
      <span class="ban ban--unknown" style="display: block">
        <span class="ban__head"><span>還沒問${esc(month)}的時間</span>
          <span class="ban__when">${row.collectedAt ? `上次 ${esc(row.collectedAt)}` : ''}</span></span>
        <span class="ban__raw">不知道他${esc(month)}哪幾天可以 —— 先傳訊息問。</span>
      </span>`;
  }

  const rules = (row.rules ?? []).filter((r) => r.kind !== 'prefer');
  const chips = rules.map((r) => `<span class="ban__chip">${esc(describeShort(r))}</span>`).join('');

  // 問過了、而且他沒說哪天不行 —— 那是好消息，不要用紅色講出來。
  // 紅色在這裡的意思是「有東西擋著」，沒有限制卻紅著會讓她每次都停下來確認。
  const none = rules.length === 0;

  return `
    <span class="ban ${none ? 'ban--none' : ''}" style="display: block">
      <span class="ban__head"><span>${none ? '沒有說哪天不行' : '不能的時間'}</span>
        <span class="ban__when">
          ${row.fromForm ? '<span class="badge badge--ok">客戶自己填的</span>' : ''}
          ${row.collectedAt ? `${esc(row.collectedAt)} 收集` : ''}</span></span>
      ${chips ? `<span class="ban__chips">${chips}</span>` : ''}
      ${row.availableDays == null ? '' : `
        <span class="ban__chips" style="margin-top: var(--space-2)">
          <span class="ban__chip">可用 ${row.availableDays} 天</span>
        </span>`}
      ${raw && row.rawText ? `
        <details class="ban__more">
          <summary>${esc(rawLabel)}</summary>
          <span class="ban__raw">「${esc(row.rawText)}」</span>
        </details>` : ''}
    </span>`;
}

/**
 * 一份收集記錄 → `banBlock()` 吃的形狀。
 *
 * 客戶詳情用。壓表那邊的 row 是 `buildCustomerQueue()` 算好的，
 * 已經是這個形狀了。
 */
export function rowFromCollection(record) {
  if (!record) return { needsAvailability: true, collectedAt: null };

  const rules = record.rules ?? [];
  return {
    needsAvailability: false,
    collectedAt: record.collectedAt ?? null,
    rules,
    availableDays: record.validFrom && record.validTo
      ? availableDates(rules, record.validFrom, record.validTo).length
      : null,
    rawText: record.rawText ?? null,
    fromForm: record.source === 'form',
  };
}

/** 卡片上的一行塞不下完整句子，這裡只給日期本身。完整的在原文裡。 */
function describeShort(rule) {
  if (rule.kind === 'exclude_weekday') return `每週${weekdayLabelOf(rule.weekday)}${partLabel(rule.partOfDay)}`;
  if (rule.kind === 'exclude_date') return `${short(rule.date)}${partLabel(rule.partOfDay)}`;
  if (rule.kind === 'exclude_range') return `${short(rule.from)}–${short(rule.to)}`;
  return '';
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const weekdayLabelOf = (n) => WD[n] ?? '?';
const short = (iso) => (typeof iso === 'string' ? iso.slice(5).replace('-', '/') : '');
