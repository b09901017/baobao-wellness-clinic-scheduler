// 拍照：app 內取景、系統相機、相簿（issue 06，ADR-0101）。三個入口共用一支（07、09、13；14 也用）。
//
// 她 2026-09-17：「如果可以不要調出去遍整面拍照就好了，可以沉浸式的在APP內拍，
// 但也是可以切換成整面都是拍照的」「辨識出來的字不存草稿，確認到一半離開就重拍一張」。
//
// 網頁拍照只有兩條路：
// - **app 內取景**：`getUserMedia()` 的即時影像，按快門截一格（通常 1080p～4K）。
//   送 AI 前一律縮到長邊 2000px，所以手寫的訂購單綽綽有餘
// - **系統相機**：`<input capture>`，跳到手機內建相機、整個螢幕 —— 她說的「整面都是拍照」
//
// **不存草稿**：這一層的狀態只在記憶體裡（這支檔案的閉包），收起來就沒了。
// 縮好的照片網址（`blob:`）交給確認層之後由確認層收掉（`release()`）。

import { extract } from '../../data/ai.js';
import { KIND_LABELS, failureSentence } from '../../domain/aiUsage.js';
import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import { esc } from './form.js';
import { shrinkFrame, shrinkPhoto } from './photo.js';

/** 直的一張紙還是橫的一個螢幕 —— 取景框的四個角照這個擺。 */
const LANDSCAPE = new Set(['aboveeList']);

/** 這幾種原因是「整個停下來」：再送下一張只是一樣被擋，而且上限那幾種還會多記一次被擋。 */
const STOP_ALL = new Set(['offline', 'paused', 'monthCap', 'dailyLimit', 'notAllowed', 'verify']);

let current = null;

/**
 * 打開拍照那一層。
 *
 * @param {object} opts
 * @param {'orderForm'|'planFlyer'|'aboveeList'|'treatmentSheet'} opts.kind
 * @param {number} [opts.max] 最多幾張（Abovee 是 2）
 * @param {(photos: {url: string, blob: Blob, transcript: object}[], ctx: {release: Function}) => void} opts.onDone
 *   全部辨識完、她按下去之後。**這一層已經收起來了**，確認層接手；`release()` 收掉照片網址
 * @returns {{close: Function}}
 */
export function openCamera({ kind, max = 10, onDone }) {
  current?.close();

  const label = KIND_LABELS[kind] ?? '單子';
  /** @type {{id: number, blob: Blob, url: string, state: string, transcript?: object, say?: string}[]} */
  let photos = [];
  let seq = 0;
  let stream = null;
  let busy = false;
  let closed = false;
  let handedOver = false;

  const el = document.createElement('div');
  el.className = 'cam';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `拍${label}`);
  el.innerHTML = `
    <header class="cam__top">
      <button class="cam__icon" type="button" data-cam-close aria-label="收起">${icon('close', { size: 22 })}</button>
      <p class="cam__title">${esc(label)}</p>
      <button class="cam__send" type="button" data-cam-send hidden></button>
    </header>
    <div class="cam__stage">
      <video class="cam__video" data-cam-video playsinline muted autoplay></video>
      <div class="cam__frame${LANDSCAPE.has(kind) ? ' cam__frame--wide' : ''}" aria-hidden="true">
        <i></i><i></i><i></i><i></i>
      </div>
      <div class="cam__fallback" data-cam-fallback hidden>
        <p class="cam__fallback-say">這裡用不了相機。改用系統相機拍，或從相簿選。</p>
        <div class="cam__fallback-actions">
          <button class="cam__big" type="button" data-cam-system>${icon('camera', { size: 24 })}<span>系統相機</span></button>
          <button class="cam__big" type="button" data-cam-album>${icon('images', { size: 24 })}<span>相簿</span></button>
        </div>
      </div>
      <div class="cam__flash" data-cam-flash></div>
    </div>
    <p class="cam__say" data-cam-say role="status" aria-live="polite"></p>
    <ol class="cam__tray" data-cam-tray aria-label="拍好的照片"></ol>
    <div class="cam__controls">
      <button class="cam__side" type="button" data-cam-album>${icon('images', { size: 22 })}<span>相簿</span></button>
      <button class="cam__shutter" type="button" data-cam-shutter aria-label="拍這一張"><span></span></button>
      <button class="cam__side" type="button" data-cam-system>${icon('camera', { size: 22 })}<span>系統相機</span></button>
    </div>
    <input type="file" accept="image/*" multiple hidden data-cam-album-input />
    <input type="file" accept="image/*" capture="environment" hidden data-cam-system-input />`;
  document.body.append(el);
  document.body.classList.add('has-cam');

  const $ = (sel) => el.querySelector(sel);
  const video = $('[data-cam-video]');
  const say = (text = '') => { $('[data-cam-say]').textContent = text; };

  const layer = pushLayer(() => close({ fromBack: true }));

  function close({ fromBack = false } = {}) {
    if (closed) return;
    closed = true;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (!handedOver) photos.forEach((p) => URL.revokeObjectURL(p.url));
    photos = [];
    el.classList.add('cam--leaving');
    document.body.classList.remove('has-cam');
    const done = () => el.remove();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    else setTimeout(done, 180);
    document.removeEventListener('keydown', onKey);
    if (!fromBack && layer.active) layer.pop();
    if (current === api) current = null;
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  // ---------- 取景 ----------

  async function startStream() {
    if (!navigator.mediaDevices?.getUserMedia) return showFallback();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
      if (closed) { stream.getTracks().forEach((t) => t.stop()); return undefined; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      el.classList.add('cam--live');
      return undefined;
    } catch {
      return showFallback();
    }
  }

  function showFallback() {
    // 被拒、沒有相機、不是 https：取景框換成一句話＋兩顆，不是一片黑
    el.classList.add('cam--fallback');
    $('[data-cam-fallback]').hidden = false;
  }

  async function shoot() {
    if (busy || photos.length >= max || !stream) return;
    busy = true;
    try {
      el.classList.remove('cam--snap');
      // 重新觸發動畫：讀一次版面
      void el.offsetWidth;
      el.classList.add('cam--snap');
      const track = stream.getVideoTracks()[0];
      let shot;
      // Android Chrome 的 ImageCapture 拍得到整顆感光元件的解析度；拍不到就截一格
      if (typeof ImageCapture === 'function' && track) {
        try {
          shot = await shrinkPhoto(await new ImageCapture(track).takePhoto());
        } catch {
          shot = null;
        }
      }
      shot ??= await shrinkFrame(video);
      add([shot.blob]);
    } catch {
      say('這一張沒有拍起來，再按一次');
    } finally {
      busy = false;
    }
  }

  // ---------- 照片 ----------

  async function addFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    if (!list.length) return;
    const room = max - photos.length;
    if (room <= 0) { say(`最多 ${max} 張`); return; }
    const take = list.slice(0, room);
    say(list.length > room ? `最多 ${max} 張，只收了前 ${take.length} 張` : '縮小中…');
    const blobs = [];
    for (const f of take) {
      try {
        // eslint-disable-next-line no-await-in-loop
        blobs.push((await shrinkPhoto(f)).blob);
      } catch {
        say('有一張照片讀不出來，換一張試試');
      }
    }
    if (closed) return;
    if (el.querySelector('[data-cam-say]').textContent === '縮小中…') say('');
    add(blobs);
  }

  function add(blobs) {
    for (const blob of blobs) {
      seq += 1;
      photos.push({ id: seq, blob, url: URL.createObjectURL(blob), state: 'ready' });
    }
    paint();
  }

  function remove(id) {
    const p = photos.find((x) => x.id === id);
    if (!p || p.state === 'sending') return;
    URL.revokeObjectURL(p.url);
    photos = photos.filter((x) => x.id !== id);
    say('');
    paint();
  }

  const BADGE = {
    sending: '<span class="cam__spin" aria-label="辨識中"></span>',
    done: `<span class="cam__ok" aria-label="辨識好了">${icon('check', { size: 14, width: 2.4 })}</span>`,
    failed: `<span class="cam__bad" aria-label="沒有辨識出來">${icon('alert', { size: 14, width: 2.2 })}</span>`,
    unreadable: `<span class="cam__bad" aria-label="看不出是這一種單子">${icon('alert', { size: 14, width: 2.2 })}</span>`,
  };

  function paint() {
    const tray = $('[data-cam-tray]');
    tray.innerHTML = photos.map((p, i) => `
      <li class="cam__thumb" data-state="${p.state}" data-cam-photo="${p.id}">
        <img src="${p.url}" alt="第 ${i + 1} 張" />
        ${BADGE[p.state] ?? ''}
        ${p.state === 'sending' ? '' : `<button class="cam__x" type="button" data-cam-remove="${p.id}" aria-label="拿掉第 ${i + 1} 張">${icon('close', { size: 14, width: 2.4 })}</button>`}
      </li>`).join('');
    tray.hidden = photos.length === 0;

    const full = photos.length >= max;
    const shutter = $('[data-cam-shutter]');
    shutter.disabled = full || busy || sending();
    el.querySelectorAll('[data-cam-album], [data-cam-system]').forEach((b) => { b.disabled = full || sending(); });
    if (full && !sending() && !$('[data-cam-say]').textContent) say(`最多 ${max} 張，送出或拿掉一張再拍`);

    const send = $('[data-cam-send]');
    const { pending, retry, done } = counts();
    send.hidden = photos.length === 0 || (!pending && !done);
    send.disabled = sending();
    send.dataset.camAction = pending ? 'send' : 'use';
    send.textContent = sending() ? '辨識中…'
      : pending ? `${retry ? '再試' : '送出'} ${pending} 張`
        : `用這 ${done} 張`;
  }

  /** 還沒送的（含連線或模型失敗、可以再試的）、成功的。看不出是這一種單子的那張不重送。 */
  function counts() {
    const pending = photos.filter((p) => p.state === 'ready' || p.state === 'failed').length;
    return {
      pending,
      retry: photos.some((p) => p.state === 'failed'),
      done: photos.filter((p) => p.state === 'done').length,
    };
  }

  const sending = () => photos.some((p) => p.state === 'sending');

  // ---------- 送出 ----------

  async function sendAll() {
    if (sending()) return;
    if (navigator.onLine === false) { say(failureSentence('offline')); return; }

    // **一張一張送**：同時送三張時四成被 429 擋下（2026-09-17 考試量到的）
    for (const p of photos.filter((x) => x.state === 'ready' || x.state === 'failed')) {
      p.state = 'sending';
      paint();
      say(`辨識中…第 ${photos.indexOf(p) + 1} 張`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const { transcript } = await extract(kind, p.blob);
        if (closed) return;
        if (transcript?.readable) {
          p.state = 'done';
          p.transcript = transcript;
          p.say = '';
        } else {
          // 看不出是這一種單子：再送一次也一樣，而且又花一次錢。拿掉或重拍
          p.state = 'unreadable';
          p.say = `這張看起來不是${label}，或拍得不清楚`;
        }
      } catch (err) {
        if (closed) return;
        p.state = 'failed';
        p.say = failureSentence(err?.reason, err?.details);
        if (STOP_ALL.has(err?.reason)) {
          photos.filter((x) => x.state === 'sending').forEach((x) => { x.state = 'ready'; });
          paint();
          say(p.say);
          return;
        }
      }
      paint();
    }

    const bad = photos.filter((p) => p.state === 'failed' || p.state === 'unreadable');
    const done = photos.filter((p) => p.state === 'done');
    if (!bad.length && done.length) return handOver(done);

    const which = bad.map((p) => `第 ${photos.indexOf(p) + 1} 張：${p.say}`).join('；');
    say(done.length ? `${which}。按「用這 ${done.length} 張」先處理辨識好的` : which);
    paint();
    return undefined;
  }

  function handOver(done) {
    handedOver = true;
    const kept = done.map((p) => ({ url: p.url, blob: p.blob, transcript: p.transcript }));
    // 沒用到的那幾張現在就收掉；用到的交給確認層
    photos.filter((p) => !done.includes(p)).forEach((p) => URL.revokeObjectURL(p.url));
    close();
    onDone?.(kept, { release: () => kept.forEach((p) => URL.revokeObjectURL(p.url)) });
  }

  // ---------- 接線 ----------

  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.matches('[data-cam-close]')) close();
    else if (t.matches('[data-cam-shutter]')) shoot();
    else if (t.matches('[data-cam-album]')) $('[data-cam-album-input]').click();
    else if (t.matches('[data-cam-system]')) $('[data-cam-system-input]').click();
    else if (t.matches('[data-cam-send]')) {
      if (t.dataset.camAction === 'use') handOver(photos.filter((p) => p.state === 'done'));
      else sendAll();
    } else if (t.dataset.camRemove) remove(Number(t.dataset.camRemove));
  });

  el.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', () => {
      addFiles(input.files ?? []);
      input.value = '';
    });
  });

  const api = { close: () => close(), el };
  current = api;

  paint();
  requestAnimationFrame(() => el.classList.add('cam--in'));
  startStream();
  $('[data-cam-close]').focus({ preventScroll: true });
  return api;
}
