// 備註編輯器。新增客戶與客戶詳情共用同一支。
//
// 規則在 domain/customerMarks.js，這裡只負責畫與收事件。
//
// 為什麼不是一個 textarea：她要的是「一眼看到這個人有哪幾件事」，
// 而一段文字要讀完才知道裡面講了幾件。一則一顆丸子、顏色自己挑，
// 掃過去就知道，而且刪一則不必在一段文字裡找逗號。

import { MARK_COLORS, DEFAULT_MARK_COLOR, MAX_MARK_LENGTH, MAX_MARKS, colorToken, normalizeMark }
  from '../../domain/customerMarks.js';
import { icon } from '../icons.js';
import { esc } from './form.js';

/** 一顆唯讀的備註丸子。詳情頁抬頭與壓表卡片都用它。 */
export function chip(mark, { large = false } = {}) {
  const m = normalizeMark(mark);
  return `<span class="mark ${large ? 'mark--lg' : ''}" style="--mark: var(${colorToken(m.color)})">
    <span class="mark__dot"></span>${esc(m.text)}</span>`;
}

/** 一整排唯讀的備註。超過 max 則收成「+N」，不要把整張卡撐開。 */
export function row(marks, { max = Infinity, large = false } = {}) {
  const list = (marks ?? []).map(normalizeMark).filter((m) => m.text);
  if (!list.length) return '';
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return `<div class="marks">
    ${shown.map((m) => chip(m, { large })).join('')}
    ${rest ? `<span class="mark mark--empty">還有 ${rest} 則</span>` : ''}
  </div>`;
}

/**
 * 可編輯的那一份。掛進一個容器，改動時呼叫 onChange。
 *
 * 狀態由呼叫端持有（傳進來的陣列會被換掉，不是就地改）——
 * 這樣「取消」就真的是取消，不必回頭復原編輯器裡的東西。
 *
 * @param {HTMLElement} container
 * @param {{marks: object[], onChange: Function}} opts
 */
export function mount(container, { marks, onChange }) {
  let list = (marks ?? []).map(normalizeMark).filter((m) => m.text);
  let colour = list.at(-1)?.color ?? DEFAULT_MARK_COLOR;

  const paint = () => {
    container.innerHTML = `
      ${list.length
        ? `<div class="marks" style="margin-bottom: var(--space-3)">
            ${list.map((m, i) => `
              <span class="mark" style="--mark: var(${colorToken(m.color)})">
                <span class="mark__dot"></span>${esc(m.text)}
                <button class="mark__x" type="button" data-del="${i}"
                        aria-label="刪掉「${esc(m.text)}」">
                  ${icon('close', { size: 11, width: 2.6 })}
                </button>
              </span>`).join('')}
          </div>`
        : '<p class="muted" style="margin: 0 0 var(--space-3)">還沒有備註。</p>'}

      ${list.length >= MAX_MARKS
        ? `<p class="muted">已經有 ${MAX_MARKS} 則了，先刪掉一則再加。</p>`
        : `
        <div class="swatches" style="margin-bottom: var(--space-2)" role="group" aria-label="顏色">
          ${MARK_COLORS.map((c) => `
            <button class="swatch" type="button" data-colour="${c.id}"
                    aria-pressed="${c.id === colour}" aria-label="${esc(c.label)}"
                    style="--mark: var(${c.token})"></button>`).join('')}
        </div>
        <div style="display: flex; gap: var(--space-2)">
          <input type="text" data-mark-text maxlength="${MAX_MARK_LENGTH}"
                 style="flex: 1; min-width: 0" placeholder="例：喜歡下午、指定騰崴"
                 aria-label="新的備註" />
          <button class="btn" type="button" data-mark-add>加入</button>
        </div>`}`;

    container.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        list = list.filter((_, i) => i !== Number(b.dataset.del));
        commit();
      }),
    );

    container.querySelectorAll('[data-colour]').forEach((b) =>
      b.addEventListener('click', () => {
        colour = b.dataset.colour;
        container.querySelectorAll('[data-colour]').forEach((x) =>
          x.setAttribute('aria-pressed', String(x.dataset.colour === colour)),
        );
      }),
    );

    const input = container.querySelector('[data-mark-text]');
    const add = () => {
      const text = String(input?.value ?? '').trim();
      if (!text) return;
      // 同一句話加第二次多半是手滑，不是真的想要兩則
      if (!list.some((m) => m.text === text)) list = [...list, { text, color: colour }];
      commit();
    };

    container.querySelector('[data-mark-add]')?.addEventListener('click', add);
    // Enter 直接加。這是在表單裡面，不擋下來會變成送出整張表單。
    input?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      add();
    });
  };

  const commit = () => {
    paint();
    onChange?.(list);
    // 剛加完通常還要再加一則，游標留在輸入格裡
    container.querySelector('[data-mark-text]')?.focus();
  };

  paint();
  onChange?.(list);

  return { get value() { return list; } };
}
