// 拍訂購單的確認層（issue 09，ADR-0099、0101）。
//
// 她 2026-09-17：「拍完後，然後可以先辨識出是誰，甚麼時候的顧客會，買了什麼方案，加購什麼，
// 欠尾款多少，然後點擊小鉛筆的icon可以微調，新增備註等等」。
//
// **一位一張卡，左右滑下一位** —— 借壓表那一頁的卡片組（`.deck`，ADR-0017）：同一種滑法、
// 同一種頭，不另做第二種。卡上五行，每一行旁邊一顆「照片上寫的是」（`seen.js`）：
// 手寫的 10 看成 1，只有看得到原字的人抓得到。
//
// 翻譯全部在 `domain/orderForm.js`，這一支只畫、只接線、只呼叫既有的寫入：
// - 新增一位 → `data/customers.js` 的 `createWithPlan()`（方案展開、健檢配二返，同一個 commit）
// - 加購到既有的 → `addEntitlements()`，那一位身上的備註與警示跟額度同一個 commit
// - 小鉛筆 → 08 的 `mountCustomerForm()`，開在一層裡、事先填好
//
// **照片與辨識出來的字都不存**（她 9/17）：這一層的狀態只在這支檔案的閉包裡，
// 收起來就 `release()` 掉照片網址。確認到一半離開，就是重拍一張。
//
// 屬性名一律 `data-oc-*`：共用元件不可以用頁面身上的名字（CLAUDE.md）。

import * as data from '../../data/customers.js';
import * as rules from '../../domain/customers.js';
import { validateMarks } from '../../domain/customerMarks.js';
import { expandPlan } from '../../domain/entitlements.js';
import { purchaseHeadline } from '../../domain/purchases.js';
import { shortDate } from '../../domain/dates.js';
import { clinicalTerms, partnerNames } from '../../domain/masterData.js';
import {
  addOnChanges, addOnTarget, blockersOf, detachPhoto, groupOrderForms, mergeTranscripts,
  orderDraftFrom, sameNameCustomers, summaryOf,
} from '../../domain/orderForm.js';
import { icon } from '../icons.js';
import { pushLayer } from '../nav.js';
import * as toast from '../toast.js';
import { unitOf } from './buy.js';
import { openBuySheet } from './buySheet.js';
import { mountCustomerForm, purchaseOf } from './customerForm.js';
import { chooseAction } from './dialog.js';
import { esc } from './form.js';
import * as marksUi from './marks.js';
import { seenChip, wireSeen } from './seen.js';
import { tip } from './tip.js';

/** 建好一位之後停一下才滑到下一位：讓她看到章蓋下去。 */
const ADVANCE_MS = 520;

/** 草稿上的欄位（`customerForm.js` 的 `blankDraft()`）。表單送回來的其餘東西不收。 */
const DRAFT_KEYS = ['name', 'phone', 'lineId', 'source', 'purchasedAt', 'priority', 'flags', 'partners',
  'marks', 'planId', 'quantity', 'extras'];

const live = (rows) => (rows ?? []).filter((r) => r && !r.deletedAt);
const trim = (s) => String(s ?? '').trim();
const isOwed = (m) => m.color === 'red' && /^尾款/.test(m.text);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} o
 * @param {{url: string, transcript: object}[]} o.photos 拍照那一層辨識好的（照拍的順序）
 * @param {Function} o.release 收掉照片網址
 * @param {{plans, courses, equipment, ivProducts, products, clinicalFlags, partners}} o.master 主檔的列
 * @param {object[]} o.existing 既有客戶
 * @param {Record<string, object[]>} [o.entsBy] 既有客戶的額度（同名那兩顆要印「買過什麼」分得出是誰）
 * @param {(summary: object) => void} [o.onFinish] 收起來之後（建了幾位在 `summary` 裡）
 */
export function openOrderConfirm({ photos, release, master, existing, entsBy = {}, onFinish }) {
  const plans = live(master.plans).filter((p) => p.active !== false);
  const draftMaster = { ...master, plans };
  const formMaster = {
    courses: master.courses, equipment: master.equipment, ivProducts: master.ivProducts,
    products: master.products, partners: partnerNames(master.partners),
  };
  const alerts = clinicalTerms(master.clinicalFlags);
  // 這一層裡建好的也算「既有」：拆開之後補上同一個名字時，要問得出同名
  const known = [...live(existing)];

  let groups = groupOrderForms(photos);
  let cards = groups.map(cardFor);
  let at = 0;
  let closed = false;

  const node = document.createElement('div');
  node.className = 'deck ocdeck';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-label', '訂購單');
  document.body.append(node);

  let layer = pushLayer(() => requestClose({ fromBack: true }));

  // ---------- 狀態 ----------

  function cardFor(group) {
    const read = orderDraftFrom(mergeTranscripts(group.photos.map((p) => p.transcript)), draftMaster);
    return {
      key: group.key,
      group,
      ...read,
      // 認出來的警示與機構：點掉之後丸子還在，再點回來
      flagOptions: [...read.draft.flags],
      partnerOptions: [...read.draft.partners],
      nameOk: false,
      who: null,
      state: 'open',
      message: '',
      errors: [],
      customerId: null,
    };
  }

  // ---------- 畫 ----------

  function paint() {
    node.innerHTML = `
      ${headHtml()}
      <div class="deck__track noscroll-bar" data-oc-track>
        ${cards.map((c) => `<div class="deck__card ocard-host" data-card="${esc(c.key)}">${cardHtml(c)}</div>`).join('')}
      </div>`;
    wireTrack();
    center(false);
  }

  function headHtml() {
    const c = cards[at];
    const { done } = summaryOf(cards);
    return `
      <div class="deck__head" data-oc-head>
        <button class="deck__btn" type="button" data-oc-step="-1" aria-label="上一位"
                ${at <= 0 ? 'disabled' : ''}>${icon('left', { size: 17, width: 2 })}</button>
        <span class="deck__who">${esc(trim(c?.draft.name) || '認不出名字')}
          <span class="deck__count">${at + 1} / ${cards.length}${done ? `・建好 ${done}` : ''}</span></span>
        <button class="deck__btn" type="button" data-oc-step="1" aria-label="下一位"
                ${at >= cards.length - 1 ? 'disabled' : ''}>${icon('right', { size: 17, width: 2 })}</button>
        <button class="deck__btn" type="button" data-oc-close aria-label="收起">
          ${icon('close', { size: 17, width: 2 })}</button>
      </div>`;
  }

  function paintHead() {
    const head = node.querySelector('[data-oc-head]');
    if (head) head.outerHTML = headHtml();
  }

  function repaintCard(c) {
    const host = [...node.querySelectorAll('[data-card]')].find((el) => el.dataset.card === c.key);
    if (!host) return;
    const top = host.scrollTop;
    host.innerHTML = cardHtml(c);
    host.scrollTop = top;
    paintHead();
  }

  function cardHtml(c) {
    const photo = c.group.photos[0]?.url ?? null;
    const target = addOnTarget(c, known);
    const done = c.state === 'done';
    return `
      <article class="ocard${done ? ' ocard--done' : ''}">
        ${done ? `<p class="ocard__stamp" aria-hidden="true">${esc(c.message)}</p>` : ''}
        ${hintsHtml(c)}
        ${photosHtml(c, done)}
        <dl class="ocard__ledger">
          ${row('是誰', whoHtml(c, photo, target))}
          ${row('顧客會', dateHtml(c, photo))}
          ${row('方案', planHtml(c, photo))}
          ${row('加購', extrasHtml(c, photo))}
          ${row('尾款', owedHtml(c, photo))}
          ${rememberHtml(c)}
        </dl>
        ${unresolvedHtml(c, photo)}
        ${c.unreadable.length ? `<p class="ocard__unreadable">看不清楚：${esc(c.unreadable.join('；'))}</p>` : ''}
        ${barHtml(c, target)}
      </article>`;
  }

  const row = (label, body, help = '') => `
    <div class="ocard__row">
      <dt class="ocard__label">${esc(label)}${help ? tip(help) : ''}</dt>
      <dd class="ocard__value">${body}</dd>
    </div>`;

  /** 便利貼上的字提到器材主檔的提醒詞 → 最上面一張紅卡（ADR-0047 搬過去的那個安全網）。 */
  function hintsHtml(c) {
    if (!c.hints.length) return '';
    const terms = [...new Set(c.hints.map((h) => h.term))];
    const warns = [...new Set(c.hints.flatMap((h) => h.warns))];
    const texts = [...new Set(c.hints.map((h) => h.text))];
    return `
      <section class="card card--danger ocard__danger" role="note">
        <p class="ocard__danger-title">${icon('alert', { size: 16, width: 2.2 })}單子上提到${esc(terms.join('、'))}</p>
        ${texts.map((t) => `<p class="ocard__quote">「${esc(t)}」</p>`).join('')}
        ${warns.length ? `<p class="ocard__sub">排 ${esc(warns.join('、'))} 時會多一句提醒</p>` : ''}
      </section>`;
  }

  function photosHtml(c, done) {
    const name = trim(c.draft.name) || '這一位';
    return `
      <div class="ocard__photos">
        ${c.group.photos.map((p, i) => `
          <figure class="ocard__photo">
            <button class="ocard__thumb" type="button" data-seen-text="" data-seen-photo="${esc(p.url)}"
                    aria-label="看第 ${i + 1} 張照片"><img src="${esc(p.url)}" alt="" /></button>
            ${p.attached ? `
              <figcaption class="ocard__attached">沒有名字，算在${esc(name)}身上
                ${done ? '' : `<button class="ocard__link" type="button" data-oc-detach="${esc(p.url)}">拆開</button>`}
              </figcaption>` : ''}
          </figure>`).join('')}
      </div>`;
  }

  function whoHtml(c, photo, target) {
    const name = trim(c.draft.name);
    if (!name) return `<span class="ocard__missing">認不出名字</span>${seenChip(c.seen.name, { photo })}`;

    const contact = target ? null : rules.fieldWarnings(contactOf(c.draft), known).contact;
    const main = `
      <span class="ocard__line">
        <span class="ocard__main ocard__name">${esc(name)}</span>
        ${seenChip(c.seen.name, { photo })}
        ${contact ? tip(contact, { kind: 'warn' }) : ''}
      </span>`;
    if (c.state === 'done') return main;

    const same = sameNameCustomers(name, known);
    if (!same.length) {
      return `${main}
        <button class="chip chip--sm ocard__nameok" type="button" data-oc-nameok aria-pressed="${c.nameOk}">
          ${icon('check', { size: 14, width: 2.4 })}名字對</button>`;
    }
    // 同名：兩顆**都不預選**（考試名字只對 9/16）
    return `${main}
      <div class="ocard__choices" role="group" aria-label="加購到既有的，還是新增一位">
        ${same.map((x) => choice(x.id, `加購到 ${x.name}`,
          purchaseHeadline(x, entsBy[x.id] ?? [], master) || (x.active === false ? '已停用' : '還沒買過東西'),
          c.who === x.id)).join('')}
        ${choice('new', '新增一位', '同名的另一個人', c.who === 'new')}
      </div>`;
  }

  const choice = (value, label, sub, on) => `
    <button class="ocard__choice" type="button" data-oc-who="${esc(value)}" aria-pressed="${on}">
      <b>${esc(label)}</b><span>${esc(sub)}</span></button>`;

  function dateHtml(c, photo) {
    const d = c.draft.purchasedAt;
    return `
      <span class="ocard__line">
        <span class="${d ? 'ocard__main' : 'ocard__missing'}">${d ? esc(shortDate(d)) : '認不出日期'}</span>
        ${seenChip(c.seen.dates, { photo })}
        ${seenChip(c.seen.formMonth, { photo })}
      </span>`;
  }

  function planHtml(c, photo) {
    const plan = plans.find((p) => p.id === c.draft.planId) ?? null;
    if (!plan) {
      return `<span class="ocard__none">${c.unresolved.some((u) => u.kind === 'plan') ? '認不出是哪一個，見下面' : '沒有'}</span>`;
    }
    const raw = trim(c.draft.quantity);
    const readable = raw !== '' && Number.isInteger(Number(raw)) && Number(raw) >= 0;
    const n = readable ? Number(raw) : 0;
    return `
      <span class="ocard__line">
        <span class="ocard__main">${esc(plan.name)}<span class="ocard__times">×${readable ? n : '?'}</span></span>
        ${seenChip(c.seen.plan, { photo })}
        ${seenChip(c.seen.quantity ? `×${c.seen.quantity}` : '', { photo })}
      </span>
      ${!readable ? '<span class="ocard__warn">幾套讀不出來</span>'
        : n === 0 ? '<span class="ocard__sub">0 套，方案不展開</span>'
          : `<span class="ocard__sub">會展開 ${expandPlan(plan, n).length} 筆額度</span>`}`;
  }

  function extrasHtml(c, photo) {
    if (!c.draft.extras.length) return '<span class="ocard__none">沒有</span>';
    return `
      <ul class="ocard__list">
        ${c.draft.extras.map((x) => `
          <li class="ocard__item">
            <span class="ocard__itemname">${esc(x.label || '（沒有名稱）')}</span>
            <span class="ocard__n">${esc(x.totalQty ?? 0)} ${esc(unitOf(x))}</span>
            ${seenChip(x.seen, { photo })}
          </li>`).join('')}
      </ul>`;
  }

  function owedHtml(c, photo) {
    const owed = c.draft.marks.filter(isOwed);
    return `
      <span class="ocard__line">
        ${owed.length
          ? owed.map((m) => `<span class="ocard__main ocard__owed">${esc(m.text.replace(/^尾款\s*/, ''))}</span>`).join('')
          : '<span class="ocard__none">沒欠</span>'}
        ${seenChip(c.seen.unpaid, { photo })}
      </span>`;
  }

  function rememberHtml(c) {
    const others = c.draft.marks.filter((m) => !isOwed(m));
    if (!c.flagOptions.length && !c.partnerOptions.length && !others.length) return '';
    const chips = [
      ...c.flagOptions.map((x) => `
        <button class="chip chip--sm chip--soft" type="button" data-oc-flag="${esc(x)}"
                aria-pressed="${c.draft.flags.includes(x)}">${esc(x)}</button>`),
      ...c.partnerOptions.map((x) => `
        <button class="chip chip--sm" type="button" data-oc-partner="${esc(x)}"
                aria-pressed="${c.draft.partners.includes(x)}">${esc(x)}</button>`),
    ];
    return row('記得', `
      ${chips.length ? `<span class="ocard__line">${chips.join('')}</span>` : ''}
      ${marksUi.row(others)}`,
    chips.length ? '從單子上的字認出來的警示與合作機構，點一下拿掉。' : '');
  }

  function unresolvedHtml(c, photo) {
    const open = c.unresolved.map((u, i) => ({ u, i })).filter(({ u }) => u.kind !== 'quantity');
    if (!open.length || c.state === 'done') return '';
    return `
      <section class="ocard__unresolved" aria-label="認不出來的">
        <h4 class="ocard__subtitle">認不出來${tip('照片上有寫，但對不上主檔。選一個，或拿掉不建。')}</h4>
        <ul class="ocard__list">
          ${open.map(({ u, i }) => `
            <li class="ocard__item ocard__item--open">
              <span class="ocard__kind">${u.kind === 'plan' ? '方案' : '加購'}</span>
              ${seenChip([u.text, u.quantity && `×${u.quantity}`].filter(Boolean).join(' '), { photo })}
              ${u.kind === 'plan' ? tip('沒有這個方案？設定 → 方案範本 → 拍文宣建一個。離開這裡，照片不會留著。') : ''}
              <span class="ocard__acts">
                <button class="btn btn--sm" type="button" data-oc-pick="${i}">選一個</button>
                <button class="btn btn--sm" type="button" data-oc-drop="${i}">拿掉</button>
              </span>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  function barHtml(c, target) {
    // 建好的卡只蓋章，不放「看這一位」：收掉這一層緊接著換頁，會跟收層那一趟退紀錄撞在一起
    //（換到詳情又被退回清單）。全部建好就回客戶清單，從那裡點
    if (c.state === 'done') return '';
    const blockers = blockersOf(c, known);
    const why = [c.state === 'failed' ? `沒建立：${c.message}` : '', ...c.errors, ...blockers].filter(Boolean);
    const label = c.state === 'saving' ? '建立中…'
      : c.state === 'failed' ? '再試一次'
        : target ? `加購到 ${target.name}` : '建立';
    return `
      <div class="ocard__bar">
        ${why.length ? `<ul class="ocard__why" role="status">${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <button class="btn ocard__edit" type="button" data-oc-edit ${c.state === 'saving' ? 'disabled' : ''}>
          ${icon('pencil', { size: 17 })}<span>修改</span></button>
        <button class="btn btn--primary ocard__go" type="button" data-oc-create
                ${blockers.length || c.state === 'saving' ? 'disabled' : ''}>${esc(label)}</button>
      </div>`;
  }

  // ---------- 接線 ----------

  function onKey(e) {
    if (document.querySelector('.ocedit, .dialog-backdrop, .drawer-backdrop, .seenview')) return;
    if (e.key === 'Escape') requestClose();
    else if (e.key === 'ArrowLeft' && !e.target.closest?.('input, textarea')) goTo(at - 1);
    else if (e.key === 'ArrowRight' && !e.target.closest?.('input, textarea')) goTo(at + 1);
  }

  function onClick(e) {
    const t = e.target.closest('button');
    if (!t || t.disabled || !node.contains(t)) return;
    if (t.matches('[data-oc-close]')) return requestClose();
    if (t.dataset.ocStep) return goTo(at + Number(t.dataset.ocStep));

    const c = cards.find((x) => x.key === t.closest('[data-card]')?.dataset.card);
    if (!c) return undefined;
    // 點到別張卡上的東西：先把那一張拉到正中間
    const i = cards.indexOf(c);
    if (i !== at) goTo(i);

    if (t.matches('[data-oc-nameok]')) {
      c.nameOk = !c.nameOk;
      return repaintCard(c);
    }
    if (t.dataset.ocWho) {
      c.who = c.who === t.dataset.ocWho ? null : t.dataset.ocWho;
      c.nameOk = true;
      return repaintCard(c);
    }
    if (t.dataset.ocFlag) {
      c.draft = { ...c.draft, flags: toggle(c.draft.flags, t.dataset.ocFlag) };
      return repaintCard(c);
    }
    if (t.dataset.ocPartner) {
      c.draft = { ...c.draft, partners: toggle(c.draft.partners, t.dataset.ocPartner) };
      return repaintCard(c);
    }
    if (t.dataset.ocDrop) {
      const drop = Number(t.dataset.ocDrop);
      c.unresolved = c.unresolved.filter((_, k) => k !== drop);
      return repaintCard(c);
    }
    if (t.dataset.ocPick) return pick(c, Number(t.dataset.ocPick));
    if (t.dataset.ocDetach) return detach(c, t.dataset.ocDetach);
    if (t.matches('[data-oc-edit]')) return edit(c);
    if (t.matches('[data-oc-create]')) return create(c);
    return undefined;
  }

  const toggle = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const track = () => node.querySelector('[data-oc-track]');

  function goTo(i, { smooth = true } = {}) {
    if (i < 0 || i >= cards.length || i === at) return;
    at = i;
    paintHead();
    center(smooth);
  }

  function center(smooth) {
    const tr = track();
    const card = tr?.children[at];
    if (!tr || !card) return;
    const left = card.offsetLeft - (tr.clientWidth - card.offsetWidth) / 2;
    if (smooth && !reduced() && typeof tr.scrollTo === 'function') tr.scrollTo({ left, behavior: 'smooth' });
    else tr.scrollLeft = left;
  }

  /** 滑停之後看正中間是哪一張（同壓表的卡片組）。 */
  function wireTrack() {
    const tr = track();
    if (!tr) return;
    const settle = () => {
      const mid = tr.scrollLeft + tr.clientWidth / 2;
      let best = at;
      let gap = Infinity;
      [...tr.children].forEach((el, k) => {
        const g = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
        if (g < gap) { gap = g; best = k; }
      });
      if (best !== at) {
        at = best;
        paintHead();
      }
    };
    if ('onscrollend' in window) tr.addEventListener('scrollend', settle);
    else {
      let timer = null;
      tr.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(settle, 140); });
    }
  }

  /** 認不出來的那一項：方案走小鉛筆（方案那一排在表上），加購開「加一項」那一張。 */
  function pick(c, i) {
    const u = c.unresolved[i];
    if (!u) return;
    if (u.kind === 'plan') {
      edit(c);
      return;
    }
    const said = [u.text, u.quantity && `×${u.quantity}`].filter(Boolean).join(' ');
    openBuySheet(formMaster, (item) => {
      c.draft = { ...c.draft, extras: [...c.draft.extras, { ...item, seen: said }] };
      c.unresolved = c.unresolved.filter((x) => x !== u);
      repaintCard(c);
    }, { title: '選一個', note: `照片上寫的是「${said}」` });
  }

  /** 拆開：掛上去的那一張自己變成一位。動到的那一位重新讀一次，其餘的卡原封不動。 */
  function detach(c, url) {
    groups = detachPhoto(groups, c.key, url);
    const before = new Map(cards.map((x) => [x.key, x]));
    cards = groups.map((g) => {
      const old = before.get(g.key);
      return old && old.group.photos.length === g.photos.length ? { ...old, group: g } : cardFor(g);
    });
    paint();
  }

  /** 小鉛筆：08 的表單開在一層裡、事先填好。它只改草稿，建立還是在卡上按。 */
  function edit(c) {
    const target = addOnTarget(c, known);
    const panel = document.createElement('div');
    panel.className = 'ocedit';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '修改');
    panel.innerHTML = `
      <header class="ocedit__head">
        <p class="ocedit__title">${target ? `加購到 ${esc(target.name)}` : '修改'}</p>
        <button class="deck__btn ocedit__close" type="button" data-ocedit-close aria-label="收起">
          ${icon('close', { size: 17, width: 2 })}</button>
      </header>
      <div class="ocedit__body"><section class="card cform-card" data-ocedit-form></section></div>`;
    document.body.append(panel);
    requestAnimationFrame(() => panel.classList.add('ocedit--in'));

    let shut = false;
    const editLayer = pushLayer(() => close(true));
    function close(fromBack = false) {
      if (shut) return;
      shut = true;
      panel.remove();
      if (!fromBack && editLayer.active) editLayer.pop();
    }
    panel.querySelector('[data-ocedit-close]').addEventListener('click', () => close());
    wireSeen(panel);

    mountCustomerForm(panel.querySelector('[data-ocedit-form]'), {
      draft: c.draft,
      plans,
      existing: known,
      alerts,
      master: formMaster,
      head: seenHead(c),
      submitLabel: '改好了',
      review: false,
      addOnTo: target?.name ?? null,
      onCancel: () => close(),
      onSubmit: ({ values }) => {
        const before = trim(c.draft.name);
        c.draft = Object.fromEntries(DRAFT_KEYS.map((k) => [k, values[k] ?? c.draft[k]]));
        // 她在表上看過、送出了：名字算點過；方案與幾套那兩項算處理過（表上有方案那一排）
        c.nameOk = true;
        if (trim(c.draft.name) !== before) c.who = null;
        c.unresolved = c.unresolved.filter((u) => u.kind !== 'plan' && u.kind !== 'quantity');
        c.flagOptions = [...new Set([...c.flagOptions, ...c.draft.flags])];
        c.partnerOptions = [...new Set([...c.partnerOptions, ...c.draft.partners])];
        c.errors = [];
        close();
        repaintCard(c);
      },
    });
    panel.querySelector('input[name="name"], input[name="purchasedAt"]')?.focus({ preventScroll: true });
  }

  /** 表單最上面那一塊：照片與原字，改的時候對得到。 */
  function seenHead(c) {
    const photo = c.group.photos[0]?.url ?? null;
    const words = [
      c.seen.name, c.seen.dates, c.seen.plan, c.seen.quantity && `×${c.seen.quantity}`,
      ...c.unresolved.filter((u) => u.kind === 'plan').map((u) => u.text),
      ...c.draft.extras.map((x) => x.seen), c.seen.unpaid && `尾款 ${c.seen.unpaid}`,
    ].filter(Boolean);
    return `
      <div class="photohead">
        <button type="button" class="photohead__img" data-seen-text="" data-seen-photo="${esc(photo ?? '')}"
                aria-label="看那一張訂購單"><img src="${esc(photo ?? '')}" alt="" /></button>
        <div class="photohead__seen">
          <span class="photohead__label">照片上寫的是</span>
          ${words.map((w) => seenChip(w, { photo })).join('')}
        </div>
      </div>`;
  }

  async function create(c) {
    if (c.state === 'saving' || c.state === 'done' || blockersOf(c, known).length) return;
    const target = addOnTarget(c, known);
    const { customer, plan, quantity, extras } = purchaseOf(c.draft, plans);
    const changes = target ? addOnChanges(target, c.draft) : null;
    const rows = target
      ? [...expandPlan(plan, quantity, { purchasedAt: customer.purchasedAt ?? null }), ...extras]
      : [];

    c.errors = target
      ? [...(changes?.marks ? validateMarks(changes.marks) : []),
        ...(!rows.length && !changes ? ['沒有東西可以加購：方案、加購、備註都是空的'] : [])]
      : [...rules.validate(customer), ...validateMarks(customer.marks)];
    if (c.errors.length) {
      repaintCard(c);
      return;
    }

    c.state = 'saving';
    repaintCard(c);

    // **重試只會建一次**：失敗時 toast 上有「重試」、卡上有「再試一次」，兩條路走的都是這一支，
    // 先到的那一趟建好之後，另一趟一進來就看到 `customerId` 已經有了
    const write = async () => {
      if (c.customerId) return c.customerId;
      if (target) {
        // 額度、二返、那一位身上的備註與警示：同一個 commit
        await data.addEntitlements(target.id, rows, { customer: target, customerChanges: changes });
        c.customerId = target.id;
        c.message = '已加購';
      } else {
        // 方案展開、加購、健檢配二返：同一個 commit（ADR-0022、0090）
        const id = await data.createWithPlan(customer, { plan, quantity, extras });
        known.push({ id, ...customer });
        c.customerId = id;
        c.message = '已建立';
      }
      c.state = 'done';
      if (!closed) {
        repaintCard(c);
        advance();
      }
      return c.customerId;
    };

    try {
      await toast.withSaveState(write, {
        success: target ? `已加購到 ${target.name}` : `已建立 ${customer.name}`,
        key: `orderform:${c.key}`,
        // 復原會讓卡上的章與資料庫對不上；建錯了到客戶詳情刪
        undoable: false,
      });
    } catch (err) {
      if (c.state === 'done') return;
      c.state = 'failed';
      c.message = err?.message ?? '不知道為什麼';
      if (closed) return;
      // 卡上講得出是哪一位、也有「再試一次」—— 失敗那一條 toast 在手機上正好蓋住那一顆，收掉
      toast.hide();
      repaintCard(c);
    }
  }

  /** 建好一位 → 滑到下一位還沒建的；全部建好 → 一行摘要、回客戶清單。 */
  function advance() {
    const wait = reduced() ? 0 : ADVANCE_MS;
    if (cards.every((x) => x.state === 'done')) {
      setTimeout(() => {
        if (closed) return;
        close();
        toast.info(summaryOf(cards).line);
      }, wait);
      return;
    }
    const next = [...cards.keys()].find((k) => k > at && cards[k].state !== 'done')
      ?? [...cards.keys()].find((k) => cards[k].state !== 'done');
    setTimeout(() => { if (!closed) goTo(next); }, wait);
  }

  /** 還有沒建的就先問（照片不會留著）。回傳真的收起來了沒。 */
  async function requestClose({ fromBack = false } = {}) {
    if (closed) return true;
    const s = summaryOf(cards);
    const pending = s.left + s.failed;
    if (pending && !cards.some((x) => x.state === 'saving')) {
      const pickd = await chooseAction({
        title: `還有 ${pending} 位沒建立`,
        consequences: [s.line, '照片與辨識出來的字都不會留著，離開之後要重拍。'],
        choices: [
          { key: 'leave', label: '離開' },
          { key: 'stay', label: '留下來', tone: 'primary' },
        ],
      });
      if (pickd !== 'leave') {
        // 返回鍵已經退掉那一層了：留下來就再疊回去，下一次返回鍵才收得到這裡
        if (fromBack && !closed) layer = pushLayer(() => requestClose({ fromBack: true }));
        return false;
      }
    }
    close({ fromBack });
    return true;
  }

  // 換頁（例如「看這一位」）：`nav.js` 已經把那一層作廢了，這裡把節點收掉 —— 掛在 body 上，不收就一直蓋著
  function onHash() {
    document.querySelector('.ocedit')?.remove();
    close({ fromBack: true });
  }

  function close({ fromBack = false } = {}) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    if (!fromBack && layer.active) layer.pop();
    node.remove();
    release?.();
    onFinish?.(summaryOf(cards));
  }

  // 開機放在最後：上面那幾支 `const` 箭頭函式要先宣告好，`paint()` 才叫得到
  wireSeen(node);
  node.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onHash);
  paint();
  node.querySelector('[data-oc-close]')?.focus({ preventScroll: true });

  return { close: () => requestClose() };
}

/** 卡上那一顆 ⚠ 要的客戶形狀：只看電話與 LINE。 */
function contactOf(draft) {
  return { name: draft.name, phone: draft.phone || null, lineId: draft.lineId || null };
}
