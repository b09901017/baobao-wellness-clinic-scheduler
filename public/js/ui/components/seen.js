// 「照片上寫的是」那一小塊（issue 06，ADR-0099）。07、09、13、14 的確認層每一列都用它。
//
// 手寫的 10 看成 1 時，只有看得到原字的人抓得到 —— 所以確認層上每一個從照片翻出來的值，
// 旁邊都有一顆小丸子印著**照片上的原字**，點一下全螢幕看那一張照片、兩指放大。
//
// 屬性名一律 `data-seen-*`：共用元件不可以用頁面身上的名字（CLAUDE.md「共用元件身上的屬性名字」）。

import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import { esc } from './form.js';

/**
 * @param {string} text 照片上的原字（空的就不畫）
 * @param {{photo?: string|null}} [opts] 那一張照片的網址（`blob:`）
 */
export function seenChip(text, { photo = null } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return `<button type="button" class="seen" data-seen-text="${esc(t)}"${photo ? ` data-seen-photo="${esc(photo)}"` : ''}
            aria-label="照片上寫的是 ${esc(t)}，點一下看照片">${icon('images', { size: 13, width: 2 })}<span>${esc(t)}</span></button>`;
}

/** 在一個容器上接一次（委派），裡面長出來的小丸子都點得開。回傳拆掉的函式。 */
export function wireSeen(root) {
  const onClick = (e) => {
    const chip = e.target.closest('[data-seen-text]');
    if (!chip || !root.contains(chip)) return;
    e.preventDefault();
    e.stopPropagation();
    const photo = chip.dataset.seenPhoto;
    if (photo) openPhoto(photo, chip.dataset.seenText);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

/**
 * 全螢幕看一張照片。點兩下放大到兩倍；兩指縮放交給瀏覽器（`touch-action`）。
 *
 * 左上角那一顆轉 90°（她 2026-09-18：「有時候我的照片是橫的，我想要直得看比較方便」，
 * `.scratch/asks-2026-09-18/issues/05`）。**CSS 轉，照片本身一個位元都不動** ——
 * 療程單的照片在 Storage，用 canvas 重畫要另外開 bucket 的 CORS。**不記住**（她同意），
 * 收起再打開是原本的方向。轉的時候收掉放大；轉過之後點兩下不理，放大交給兩指 ——
 * 疊在一起的位置很容易算錯，而點兩下跳回橫的會讓她以為轉壞了。
 */
export function openPhoto(url, caption = '') {
  const el = document.createElement('div');
  el.className = 'seenview';
  el.dataset.seenviewAngle = '0';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '照片');
  el.innerHTML = `
    <button class="seenview__close" type="button" data-seenview-close aria-label="收起">${icon('close', { size: 22 })}</button>
    <button class="seenview__turn" type="button" data-seenview-turn aria-label="轉 90°">${icon('turn', { size: 22 })}</button>
    <div class="seenview__scroll" data-seenview-scroll>
      <img class="seenview__img" src="${esc(url)}" alt="${esc(caption ? `照片（原字：${caption}）` : '照片')}" />
    </div>
    ${caption ? `<p class="seenview__caption">照片上寫的是 <strong>${esc(caption)}</strong></p>` : ''}`;
  document.body.append(el);

  let closed = false;
  const layer = pushLayer(() => close(true));
  function close(fromBack = false) {
    if (closed) return;
    closed = true;
    el.remove();
    document.removeEventListener('keydown', onKey);
    if (!fromBack && layer.active) layer.pop();
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  el.querySelector('[data-seenview-close]').addEventListener('click', () => close());
  el.querySelector('[data-seenview-turn]').addEventListener('click', () => {
    el.dataset.seenviewAngle = String((Number(el.dataset.seenviewAngle) + 1) % 4);
    el.classList.remove('seenview--zoom');
  });
  const img = el.querySelector('img');
  img.addEventListener('dblclick', () => {
    if (el.dataset.seenviewAngle === '0') el.classList.toggle('seenview--zoom');
  });
  el.querySelector('[data-seenview-close]').focus({ preventScroll: true });
  return { close: () => close() };
}
