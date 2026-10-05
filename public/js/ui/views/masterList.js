// 單一主檔類型的清單與編輯。
//
// 破壞性操作刻意不放在主要動線上（SPEC 第 6.5 節）：卡片上只有「編輯」，
// 停用與刪除放在編輯畫面的最下方，而且都要二次確認並顯示具體後果。

import * as config from '../../data/config.js';
import {
  MASTER_LABELS, ROOM_TYPES, STAFF_ROLES, ASSIGNS, ASSIGN_LABELS, validate,
  roomsForCourse,
  planItem, BLANK_PLAN_ITEM,
  copyPlan,
  normalizeGroup, courseGroupNames, coursesByGroup, courseDefaultsFor,
  SYSTEMS,
  DOCTOR_ROLE, DOCTOR_NONE, DOCTOR_ANY, doctorRuleOf, specialtyNames,
} from '../../domain/masterData.js';
import { systemsOf, describeSystems } from '../../domain/taskRules.js';
import {
  ALERT_COLORS, ALERT_FILLS, DEFAULT_ALERT_COLOR, DEFAULT_ALERT_FILL,
  colorTokens, lookOf, styleFor,
} from '../../domain/clinicalFlags.js';
import { isFollowupCourse } from '../../domain/followups.js';
import { MIN_NTH, nthLabel } from '../../domain/nthFollowup.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { icon } from '../icons.js';
import { tip } from '../components/tip.js';
import { pushScreen } from '../nav.js';
import { openCamera } from '../components/camera.js';
import { seenChip, wireSeen } from '../components/seen.js';
import { planDraftFrom } from '../../domain/photoPlan.js';

const esc = f.esc;

/**
 * 一顆警示丸子長什麼樣。**跟真的畫在卡片牆上的那一顆共用同一組 class 與變數**
 * （`ui/components/flags.js` 的 `chipHtml()`）—— 預覽跟真的長得不一樣的話，
 * 這一頁就沒有存在的理由。
 */
function alertPreview(row, text) {
  const look = lookOf(row);
  return `<span class="flag flag--alert flag--${esc(look.fill)}"
                style="${esc(styleFor(look))}">${esc(text ?? '')}</span>`;
}

/**
 * 顏色與填法那兩排，外加一顆即時的預覽。
 *
 * 顏色用 `.swatch`（跟客戶備註的挑色器同一組 class）而不是一排寫著「紅」「藍」
 * 的丸子：這一格挑的就是顏色本身，用文字說它是什麼顏色是多繞一圈。
 * 填法用一般的丸子 —— 那兩個沒有顏色可以看。
 */
function alertLookFields(r) {
  const look = lookOf(r);
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">壓表時長這樣</span>
      <div data-alertpreview style="margin-bottom: var(--space-2)">
        ${alertPreview(r, r.name || '警示')}</div>

      <div class="swatches" role="group" aria-label="顏色">
        ${ALERT_COLORS.map((c) => `
          <button class="swatch ${look.fill === 'outline' ? 'swatch--auto' : ''}" type="button"
                  data-colour="${esc(c.id)}" aria-label="${esc(c.label)}"
                  aria-pressed="${c.id === look.color}"
                  style="--mark: var(${colorTokens(c.id).fg})"></button>`).join('')}
      </div>
      <input type="hidden" name="color" value="${esc(look.color)}" />
    </div>

    ${f.chips({
      name: 'fill',
      label: '填法',
      value: look.fill,
      options: ALERT_FILLS.map((x) => ({ value: x.id, label: x.label })),
      hint: '實心最搶眼，一位客戶身上最好只有一兩個。',
    })}`;
}

/**
 * 常用診間那一排（`orderedRoomsForCourse()`）。**這是排序不是限制** ——
 * 沒勾的那幾間照樣選得到，只是排在「其他診間」底下。
 *
 * **候選只有這個課程排得進去的那幾間**（`roomsForCourse()`）：勾一間它
 * 排不進去的診間，那一顆永遠不會出現在壓表上 —— 一顆按得下去卻什麼都
 * 不會發生的勾選框，比沒有還糟。上面那幾排改了，這一排跟著變。
 */
function preferredRoomsField(r, all) {
  return f.checkboxes({
    name: 'preferredRoomIds', label: '常用診間',
    values: r.preferredRoomIds ?? [],
    options: roomsForCourse(r, (all?.rooms ?? []).filter((x) => !x.deletedAt))
      .map((x) => ({ value: x.id, label: x.name })),
    hint: '勾起來的排在最前面。這是順序不是限制 —— 沒勾的照樣選得到，'
      + '只是收在「其他診間」底下。這裡只列得出上面那幾排選得到的診間。',
  });
}

/**
 * 「只能排在這幾間」的候選：全部還在用的診間。
 *
 * **已經勾著、但停用或刪掉的那一間照樣列出來**（標出來）。不列的話她一按儲存，
 * 那一格就被靜默清掉 —— 而「只剩一間已刪除的」跟「沒有例外」排出來的診間完全不一樣
 * （前者一間都排不進去，後者照類型走）。同 `equipmentOptions()`。
 */
function exceptionRoomOptions(r, all) {
  const rooms = all?.rooms ?? [];
  const opts = rooms.filter((x) => x.active !== false)
    .map((x) => ({ value: x.id, label: x.name }));
  for (const id of r.allowedRoomIds ?? []) {
    if (opts.some((o) => o.value === id)) continue;
    const room = rooms.find((x) => x.id === id);
    opts.push({ value: id, label: room ? `${room.name}（已停用）` : '（診間已刪除）' });
  }
  return opts;
}

/**
 * 「Abovee 上的寫法」那一格（`aboveeNames`）。治療師與醫師、診間、器材、營養點滴品項、課程
 * 共用 —— 拍 Abovee 時那一格的字先比它（`domain/abovee.js`）。頓號分開好幾種。
 * **不用 `parseList()`**：那一支連空白也切，而 Abovee 上的寫法可以有空白（`SIS 60`）。
 */
function aliasField(r, { placeholder, hint }) {
  return f.text({
    name: 'aboveeNames', label: 'Abovee 上的寫法', value: (r.aboveeNames ?? []).join('、'),
    placeholder, hint: `${hint}好幾種用頓號分開；同一種清單裡兩筆不可以同一個寫法。`,
  });
}
const parseAliases = (raw) => [...new Set(String(raw ?? '').split(/[、,，;；\n]/).map((x) => x.trim()).filter(Boolean))];

const editors = {
  // 診間。**2026-09-08 床位那一格拿掉了**（她選的：「取消任何床位區分」），
  // 換成簡寫 —— 月曆與日／週那一列印簡寫，這一頁與試算表印全名。
  rooms: {
    blank: { name: '', type: ROOM_TYPES[0], shortName: null, capacity: null },
    summary: (r) => `${r.type}${r.shortName ? ` · ${r.shortName}` : ''}`
      + `${Number(r.capacity) > 1 ? ` · 同時 ${r.capacity} 位` : ''}`,
    fields: (r) => [
      f.text({ name: 'name', label: '診間名稱', value: r.name, placeholder: '點滴3' }),
      f.select({ name: 'type', label: '類型', value: r.type, options: ROOM_TYPES }),
      f.text({
        name: 'shortName', label: '簡寫', value: r.shortName ?? '', placeholder: '.3',
        hint: '月曆那一格印它，一格只放得下幾個字。留空就印全名。'
          + '數字就是門上那個號碼（點滴3 → .3、VIP3 → vip3）。',
      }),
      // **`min` 與 `step` 要跟 domain 的驗證講同一句話**（CLAUDE.md 那條，
      // 踩過三次）：`step="1"`，不要寫「通常是 N 的倍數」。
      f.number({
        name: 'capacity', label: '同時幾位', value: r.capacity ?? '', min: 1, step: 1,
        placeholder: '1',
        hint: '這一間同一個時間裝得下幾個人。留空就是 1。'
          + '點滴8 放得下兩位（她 2026-09-16：「目前的確不需要床位，都寫 .8」）'
          + ' —— 填了 2 之後，一對夫妻同時排進去就不會再跳撞期的提醒，而第三位照樣會。',
      }),
      aliasField(r, {
        placeholder: '4樓休2',
        hint: '拍 Abovee 時診間或服務資源那一格怎麼寫這一間。'
          + '「治療室5」「點滴室10」「休息室3」「點滴室8床A」這幾種本來就認得，不用填。',
      }),
    ],
    // **`beds` 不在這裡**：舊資料上那一格留著（畫得出既有來訪的「點滴8A」），
    // 但這一頁再也不寫它 —— 寫 `beds: []` 等於她一按儲存就把舊資料清掉，
    // 而清掉那幾筆是資料健檢「來訪上還記著床位」那一列的事。
    parse: (v) => ({
      name: v.name.trim(),
      type: v.type,
      shortName: v.shortName.trim() || null,
      // 空白 → `null`（＝1）。寫 1 進去也可以，兩種在 `roomCapacityOf()` 是同一件事
      capacity: String(v.capacity ?? '').trim() === '' ? null : Number(v.capacity),
      aboveeNames: parseAliases(v.aboveeNames),
    }),
  },

  // 一份清單放兩種人。角色不是標籤而是分流：復能的治療師選單只列物理治療師，
  // 二返的醫師選單只列醫師（domain/masterData.js 的 staffWithRole）。
  staff: {
    blank: { name: '', role: STAFF_ROLES[0], aboveeNames: [], specialties: [] },
    summary: (r) => [
      r.role,
      r.specialties?.length ? r.specialties.join('、') : null,
      r.aboveeNames?.length ? `Abovee：${r.aboveeNames.join('、')}` : null,
    ].filter(Boolean).join(' · '),
    fields: (r, all) => [
      f.text({ name: 'name', label: '姓名', value: r.name, placeholder: '騰崴' }),
      f.select({
        name: 'role', label: '角色', value: r.role, options: STAFF_ROLES,
        hint: '治療師與醫師是兩種人，選錯的話她會在選單裡找不到這個人。',
      }),
      // 科別（ADR-0120）。**只有醫師有** —— 角色不是醫師時整塊藏起來（`wireForm` 切），
      // 存檔時也不寫（`parse()`）。名單＝預設四科＋別的醫師身上已經有的字。
      `<div data-specialties ${r.role === DOCTOR_ROLE ? '' : 'hidden'}>
        ${f.chips({
          name: 'specialties', label: '科別', value: r.specialties ?? [], multi: true, quiet: true,
          options: [...new Set([...specialtyNames(all?.staff ?? []), ...(r.specialties ?? [])])],
          hint: '可以勾不只一科。課程指定了一科的話，那一科的醫師會排在最前面'
            + '（其餘照樣選得到）；那一科只有一位時會先幫你選好。',
        })}
        ${f.text({
          name: 'specialtyNew', label: '其他科別', value: '', placeholder: '神經內科', maxlength: 12,
          hint: '上面沒有的就自己打，好幾科用頓號分開。',
        })}
      </div>`,
      // issue 12：拍 Abovee 時服務資源那一格寫的是全名，認不出來的記在這裡
      f.text({
        name: 'aboveeNames', label: 'Abovee 上的寫法', value: (r.aboveeNames ?? []).join('、'),
        placeholder: '陳小芳',
        hint: '拍 Abovee 時服務資源那一格怎麼寫這個人。好幾種用頓號分開。'
          + '全名結尾就是這個名字的（陳小芳 → 小芳）不用填，認得出來。',
      }),
    ],
    parse: (v) => ({
      name: v.name.trim(),
      role: v.role,
      aboveeNames: parseAliases(v.aboveeNames),
      // 改成治療師就清掉 —— 那一塊藏起來了，她看不到的東西不可以留在資料上
      specialties: v.role === DOCTOR_ROLE
        ? [...new Set([...f.splitMulti(v.specialties), ...f.parseList(v.specialtyNew)])]
        : [],
    }),
    wireForm: ({ form }) => {
      f.wireChips(form);
      form.elements.role?.addEventListener('change', (e) => {
        const box = form.querySelector('[data-specialties]');
        if (box) box.hidden = e.target.value !== DOCTOR_ROLE;
      });
    },
  },

  equipment: {
    lead: '每一台記著「用這台的那一段算哪一個課程」—— 復能四選一是一筆額度、'
      + '四台器材，而 ILIB 那一台要的是診間、其餘三台要的是物理治療師。',
    blank: { name: '', shortName: null, contraindications: [], courseId: null },
    summary: (r, all) => [
      (all?.courses ?? []).find((c) => c.id === r.courseId)?.name ?? '還沒指到課程',
      r.contraindications?.length ? `⚠ 要提醒：${r.contraindications.join('、')}` : null,
    ].filter(Boolean).join(' · '),
    fields: (r, all) => [
      f.text({ name: 'name', label: '器材名稱', value: r.name, placeholder: 'INDIBA' }),
      // 跟 設定 → 名稱怎麼寫 那一頁寫的是同一格（2026-10-05：她要每一項都改得到別稱，
      // 而 SIS／IN／高能量在她嘴裡就是「復能底下的項目」）。
      f.text({
        name: 'shortName', label: '別稱', value: r.shortName ?? '', placeholder: 'IN', maxlength: 12,
        hint: '月曆那一格印它（INDIBA → IN）。留空就印全名。'
          + '跟「設定 → 名稱怎麼寫」改的是同一格。',
      }),
      // 用這台的那一段算哪一個課程（ADR-0075）。指派治療師還是診間、要不要
      // 簽療程單、長出哪些掛號待辦，全部跟著那個課程走。
      f.chips({
        name: 'courseId', label: '用這台算哪一個課程', value: r.courseId ?? null,
        options: [
          { value: null, label: '還沒決定' },
          ...(all?.courses ?? []).filter((c) => !c.deletedAt)
            .map((c) => ({ value: c.id, label: c.name })),
        ],
        hint: '復能三台選這個課程；ILIB 選 ILIB。留空的話，擇一池會退回舊的推導方式。',
      }),
      f.text({
        name: 'contraindications', label: '要特別提醒的狀況',
        value: (r.contraindications ?? []).join('、'), placeholder: '體內金屬',
        hint: '用頓號分隔。客戶身上有同名的永久限制時，選了這一台會跳出一句明顯的提醒'
          + '（不會擋，ADR-0074）。這幾個字也要加進「設定 → 警示」才畫得到客戶身上。',
      }),
      aliasField(r, {
        placeholder: '高能量',
        hint: 'Abovee 課程那一格寫這一台的那幾個字（「高能量60」就填「高能量」，結尾的分鐘不用）。',
      }),
    ],
    parse: (v) => ({
      name: v.name.trim(),
      shortName: v.shortName.trim() || null,
      courseId: v.courseId || null,
      contraindications: f.parseList(v.contraindications),
      aboveeNames: parseAliases(v.aboveeNames),
    }),
    wireForm: ({ form }) => f.wireChips(form),
  },

  // 警示（ADR-0074）。永久限制只剩兩層，這是上面那一層：什麼都不擋，
  // 但壓表那一刻要一眼看得到。跟器材上那一欄**刻意分成兩份主檔** ——
  // 器材那一欄回答的是「選了這一台要不要提醒」，這一份回答的是
  // 「這位客戶身上要畫哪幾顆丸子」，兩者的名單不必一樣（「怕痛」跟器材無關）。
  clinicalFlags: {
    lead: '這裡加的字會出現在客戶的永久限制上，壓表的卡片牆會跟著名字畫出來。'
      + '它不會擋掉任何東西 —— 只是要在你壓表的那一刻一眼看得到。',
    // 卡片上就畫出它真正的樣子。一份清單如果只印名字，
    // 她要點進去才知道自己上次挑了什麼顏色。
    badge: (r) => alertPreview(r, r.name),
    blank: { name: '', hint: '', color: DEFAULT_ALERT_COLOR, fill: DEFAULT_ALERT_FILL },
    summary: (r) => r.hint || '壓表時會跟著名字出現',
    fields: (r) => [
      f.text({ name: 'name', label: '警示名稱', value: r.name, placeholder: '血管難打' }),
      f.text({
        name: 'hint', label: '一句說明', value: r.hint ?? '',
        placeholder: '點滴與抽血要多留時間，先問慣用手',
        hint: '選填。只出現在客戶的永久限制編輯畫面上，不會出現在壓表的卡片牆。',
      }),
      alertLookFields(r),
    ],
    parse: (v) => ({
      name: v.name.trim(),
      hint: v.hint.trim() || null,
      color: v.color || DEFAULT_ALERT_COLOR,
      fill: v.fill || DEFAULT_ALERT_FILL,
    }),
    // **不重畫整張表。** 挑一次顏色重畫一次的話，她打到一半的說明會失去游標
    // 與輸入法的組字狀態（同 ADR-0038）。所以預覽是就地換的。
    wireForm: ({ form }) => {
      f.wireChips(form);
      const sync = () => {
        const v = f.readForm(form);
        const host = form.querySelector('[data-alertpreview]');
        if (host) host.innerHTML = alertPreview(v, v.name || '警示');
      };
      form.addEventListener('click', (e) => {
        const swatch = e.target.closest('[data-colour]');
        if (swatch) {
          form.elements.color.value = swatch.dataset.colour;
          form.querySelectorAll('[data-colour]').forEach((b) =>
            b.setAttribute('aria-pressed', String(b === swatch)));
        }
        if (swatch || e.target.closest('[data-chip="fill"]')) sync();
      });
      form.addEventListener('input', (e) => {
        if (e.target.name === 'name') sync();
      });
    },
  },

  // 合作機構（ADR-0076）。客戶身上打得上的一個標記，例：自然美。
  // **不生任何待辦** —— 標記本身就是提醒（她 2026-09-06 選的）。
  partners: {
    lead: '客戶身上打得上的標記。有這個標記的人，壓完表之後記得跟對方的專員說一聲。'
      + '它不會產生任何待辦，也不影響排班 —— 那顆丸子會跟著名字出現在壓表與待辦上。',
    blank: { name: '' },
    summary: () => '跟著客戶的名字出現',
    fields: (r) => [f.text({ name: 'name', label: '機構名稱', value: r.name, placeholder: '自然美' })],
    parse: (v) => ({ name: v.name.trim() }),
  },

  // 營養點滴品項。**2026-09-08 多了一格簡寫**：日曆上那一段印的是品項不是
  // 課程（她的原話：「就不用寫營養點滴了，而是像這樣，誰，品項，診間」），
  // 而月曆一格放不下「雪顏亮彩」。作法照抄診間那一列。
  ivProducts: {
    blank: { name: '', shortName: null, durationMin: null },
    summary: (r) => [
      r.durationMin ? `${r.durationMin} 分` : null,
      r.shortName ? `月曆寫「${r.shortName}」` : null,
    ].filter(Boolean).join(' · ') || '營養點滴品項',
    fields: (r) => [
      f.text({ name: 'name', label: '品項名稱', value: r.name, placeholder: '護肝排毒' }),
      f.text({
        name: 'shortName', label: '簡寫', value: r.shortName ?? '', placeholder: '雪',
        hint: '日曆上那一段印它（「王小明・雪・.10」），一格只放得下幾個字。'
          + '留空就印全名。貼給客人的那一句不受影響，那裡只講課程。',
      }),
      // **`step` 要是 1**（CLAUDE.md 那一條）：HTML 的 step 從 min 起算，
      // 寫 `step: 30` 的話 180 存得下去但 190 存不下去，而瀏覽器擋在 submit
      // 之前 —— domain 的驗證跑都沒跑到，畫面上只有一個沒人看得懂的泡泡。
      f.number({
        name: 'durationMin', label: '這一款要打多久（分鐘）',
        value: r.durationMin ?? '', min: 1, step: 1,
        hint: '空的就跟著「營養點滴」那個課程走。通常是 30 的倍數。',
      }),
      aliasField(r, {
        placeholder: '雪顏亮采',
        hint: 'Abovee 課程那一格寫這一款的字（Abovee 上營養點滴直接寫品項名）。跟上面的名字一樣就不用填。',
      }),
    ],
    parse: (v) => ({
      name: v.name.trim(),
      shortName: v.shortName.trim() || null,
      durationMin: v.durationMin === '' || v.durationMin == null ? null : Number(v.durationMin),
      aboveeNames: parseAliases(v.aboveeNames),
    }),
  },

  products: {
    blank: { name: '' },
    summary: () => '不排程，只記錄',
    fields: (r) => [f.text({ name: 'name', label: '商品名稱', value: r.name, placeholder: '夜態美' })],
    parse: (v) => ({ name: v.name.trim() }),
  },

  courses: {
    blank: {
      name: '', group: null, shortName: null,
      durationMin: 60, category: 'C', systems: ['Abovee'], assigns: 'room',
      allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      preferredRoomIds: [],
      requiresEquipment: false, requiresIvProduct: false,
      requiresDoctor: false, doctorPick: DOCTOR_NONE,
      needsTreatmentForm: true,
      needsRecord: false,
      uncounted: false,
      bookingMinutes: [],
      frequencyRule: null,
      followupCourseId: null,
      durationChoices: [],
    },
    // 「要寫紀錄」印在摘要上是 2026-09-04 加的：她簽完療程單沒有長出那一張，
    // 而原因是這個勾沒打開 —— 一整排課程掃過去看不出哪幾個開著，
    // 她只能一個一個點進去。ADR-0066。
    summary: (r) =>
      `${r.durationMin} 分 · ${ASSIGN_LABELS[r.assigns] ?? '?'} · ${describeSystems(r)}`
      + `${r.needsRecord ? ' · 要寫紀錄' : ''}${r.uncounted === true ? ' · 不算次數' : ''}`,
    fields: (r, all) => [
      f.text({ name: 'name', label: '課程名稱', value: r.name, placeholder: '復能' }),
      // 分類（2026-10-05）。**只管這一頁怎麼分組** —— 沒有任何規則讀它，
      // 所以這一排是 `quiet` 的：選了什麼都不用重畫別的欄位。
      // 草稿自己也算進名單：她剛打的新分類在重畫之後要有一顆按著的丸子。
      f.chips({
        name: 'group', label: '分類', value: normalizeGroup(r.group), quiet: true,
        options: courseGroupNames([...(all?.courses ?? []), r])
          .map((g) => ({ value: normalizeGroup(g), label: g })),
        hint: '只管這一頁怎麼分組。改分類不會動到待辦、次數或排班。',
      }),
      f.text({
        name: 'groupNew', label: '新的分類', value: '', placeholder: '醫美', maxlength: 12,
        hint: '上面沒有的就自己打一個 —— 打了就用這個字，清單會多一組。',
      }),
      // 跟 設定 → 名稱怎麼寫 那一頁寫的是**同一格**（`shortName`）：兩個入口一份資料。
      // LINE 名只在那一頁改（那裡有預覽）；這裡不畫它，存檔時也不碰它。
      f.text({
        name: 'shortName', label: '別稱', value: r.shortName ?? '', placeholder: 'IL', maxlength: 12,
        hint: '月曆那一格印它，一格只放得下幾個字。留空就印全名。'
          + '跟「設定 → 名稱怎麼寫」改的是同一格。',
      }),
      aliasField(r, {
        placeholder: '心臟門診',
        hint: 'Abovee 課程那一格寫這門課的字（「二返60」就填「二返」，結尾的分鐘不用；'
          + '「EECP20」那種數字是名字一部分的照寫）。',
      }),
      // step 是 1 不是 5：`positiveInt()` 只要求大於 0 的整數，欄位不可以比它嚴
      // —— `min:1 step:5` 的合法值是 1、6、11…… 30 存不下去（見 form.js 的 number()）。
      f.number({ name: 'durationMin', label: '時長（分鐘）', value: r.durationMin, min: 1, step: 1 }),
      // 加購時給不給她挑時長。復能與 ILIB 各有 30 與 60 分鐘兩種規格，
      // 而寫死那兩個課程名字是這個 repo 付過帳的作法（`domain/followups.js` 的檔頭）。
      f.text({
        name: 'durationChoices', label: '可選時長（分鐘）',
        value: (r.durationChoices ?? []).join('、'), placeholder: '30、60',
        hint: '用頓號分隔。買的時候分：填了之後加購那一頁會多一排丸子，名字也會帶著它'
          + '（「超磁場(60)」），30 與 60 是兩筆不同的額度。留空就是只有上面那一個時長。',
      }),
      // 約的時候選（ADR-0122）。跟上面那一格分成兩格是因為它們是兩件事：
      // 上面是兩筆額度，這一格是同一筆額度每一段自己挑（二返 30 或 60）。
      f.text({
        name: 'bookingMinutes', label: '約的時候選時長（分鐘）',
        value: (r.bookingMinutes ?? []).join('、'), placeholder: '30、60',
        hint: '用頓號分隔。約的時候選：填了之後排這門課時會多一排丸子，每一段自己挑要排多久'
          + '（二返 30 或 60），扣的是同一筆額度；預設是上面那個時長。'
          + '跟「可選時長」只能填一格。',
      }),
      // 壓哪幾個系統（ADR-0119）。2026-10-05 之前這裡是「任務類別」四選一的下拉，
      // 做不出「只壓 Abovee＋耀聖」。**舊課程打開時三個勾照 `systemsOf()` 畫好** ——
      // 沒勾過的照它的類別推，所以什麼都不改就存一次，算出來的一個字都不會變。
      f.checkboxes({
        name: 'systems', label: '壓哪幾個系統',
        values: systemsOf(r) ?? [], options: SYSTEMS,
        hint: '勾了 Abovee，壓表就是在 Abovee 那一下；其餘勾起來的等客人說可以之後長成待辦。'
          + '沒勾 Abovee 就是直接壓在 Examine（健檢）。Abovee 與 Examine 至少要勾一個。'
          + '「要不要簽療程單」是底下自己的一個勾。',
      }),
      // 類別那一格留在資料上當退路，這張表不再改它（原樣帶回去）
      `<input type="hidden" name="category" value="${r.category == null ? '__null__' : esc(r.category)}" />`,
      f.select({
        name: 'assigns', label: '排班時要指派', value: r.assigns,
        options: ASSIGNS.map((a) => ({ value: a, label: ASSIGN_LABELS[a] })),
        hint: '復能三器材選治療師；其餘含 ILIB 選診間；心臟科評估都不用。'
          + '擇一池的那一段會改看「這一段選了哪一台器材」屬於哪個課程（ADR-0075）。',
      }),
      f.checkboxes({
        name: 'allowedRoomTypes', label: '可用的診間類型',
        values: r.allowedRoomTypes ?? [], options: ROOM_TYPES,
        hint: '只在「選診間」時有效。',
      }),
      // 例外指定診間（`allowedRoomIds`，**硬限制**）。2026-10-05 之前這一格只在
      // 卡片上看得到一行字、表單裡改不了（`parse()` 照抄舊值）。
      f.checkboxes({
        name: 'allowedRoomIds', label: '只能排在這幾間',
        values: r.allowedRoomIds ?? [],
        options: exceptionRoomOptions(r, all),
        hint: '例外：勾了就只有這幾間排得進去，蓋過上面的類型（例：EECP 只能治5、治8）。'
          + '一間都不勾就是沒有例外，照上面的類型走。只在「選診間」時有效。',
      }),
      // 包一層是為了**就地換**：上面三排（指派、類型、只能排在這幾間）改了，
      // 這一排的候選跟著變，而整張表不重畫（ADR-0038，見 `wireForm`）。
      `<div data-preferred>${preferredRoomsField(r, all)}</div>`,
      f.toggle({
        name: 'requiresEquipment', label: '來訪時要選器材（擇一池）',
        value: !!r.requiresEquipment,
      }),
      f.toggle({
        name: 'requiresIvProduct', label: '來訪時要選營養點滴品項',
        value: !!r.requiresIvProduct,
        hint: '每次施打的品項可能不同，勾了之後來訪編輯器才會出現品項選單。',
      }),
      // 要不要醫師、哪一科（ADR-0120）。2026-10-05 之前這裡是一個開關，而門診（A 類）
      // 一律選得到、那個開關開不開都一樣（ADR-0058）。**舊課程打開時照 `doctorRuleOf()`
      // 畫好** —— 門診是「哪一科都可以」、其餘照原本那個開關，存一次什麼都不變。
      f.chips({
        name: 'doctorPick', label: '來訪時要選醫師', value: doctorRuleOf(r), quiet: true,
        options: [
          { value: DOCTOR_NONE, label: '不用' },
          { value: DOCTOR_ANY, label: '哪一科都可以' },
          // 這門課現在指的那一科就算已經沒有醫師掛著也要列出來 —— 不然那一排一顆都沒按
          ...[...new Set([...specialtyNames(all?.staff ?? []), doctorRuleOf(r)])]
            .filter((s) => s !== DOCTOR_NONE && s !== DOCTOR_ANY)
            .map((s, i) => ({ value: s, label: s, ...(i === 0 ? { lead: '指定一科' } : {}) })),
        ],
        hint: '指定一科的話，那一科的醫師排在最前面，其餘收在「其他醫師」後面、照樣選得到'
          + '（代診那天用得到）。那一科只有一位時會先幫你選好。'
          + '誰是哪一科在「設定 → 治療師與醫師」填。和上面的診間、治療師不衝突。',
      }),
      f.toggle({
        name: 'needsTreatmentForm', label: '來訪當天要請客人簽療程單',
        value: r.needsTreatmentForm !== false,
        hint: '幾乎每一種都要簽 —— 目前只有二返不用（它是回院聽報告，沒有療程可以扣）。',
      }),
      // 跟上面那一個問的是同一種問題（「這個課程做完還要做什麼」），
      // 所以擺在一起。兩個不衝突：二返兩件都是特例，一個不用簽、一個要寫。
      f.toggle({
        name: 'needsRecord', label: '客人走了之後要補一份紀錄',
        value: r.needsRecord === true,
        hint: '目前是二返與營養師諮詢。來訪標成已完成之後，待辦上會長出一張'
          + '「寫紀錄」，死線就是來訪那一天。跟療程單是兩件事，兩個都要就兩個都勾。',
      }),
      // 不算次數（ADR-0121）。功醫門診是第一門；她之後自己勾別的。
      f.toggle({
        name: 'uncounted', label: '不算次數',
        value: r.uncounted === true,
        hint: '不用加購就排得進去；排了也不扣任何次數。'
          + '已經買了這門課的客戶，選他那一筆額度排的照舊扣。勾了之後加購那一排不再列它。',
      }),
      // n返 借的就是這一個課程（ADR-0063：它不是額度，時段的 entitlementId
      // 是 null、courseId 指著二返）。所以上面每一個設定都會套用到三返、四返 ——
      // 2026-09-04 她問「設定那邊的課程沒有 n返？還是其實我設定二返就等於 n返？」，
      // 而畫面上一個字都沒講。只在真的是二返的那一頁講（掛條件，不是每頁一句廢話）。
      isFollowupCourse(r.id, all.courses ?? [])
        ? `<p class="muted" style="margin: calc(var(--space-2) * -1) 0 var(--space-4)">
             ${esc(nthLabel(MIN_NTH))}、${esc(nthLabel(MIN_NTH + 1))}⋯⋯
             借的就是這個課程，所以上面這些設定它們也照著走。</p>`
        : '',
      f.text({
        name: 'frequencyRule', label: '頻率限制', value: r.frequencyRule ?? '',
        placeholder: '每季一次', hint: '只提示不阻擋。留空代表沒有限制。',
      }),
      // 健檢 → 二返。設了之後，買 N 次這個課程就自動有 N 次後續課程的額度，
      // 而且做完一次就長出一筆「約⋯⋯」的待辦（ADR-0022）。
      f.select({
        name: 'followupCourseId', label: '做完之後還要再約一次的課程',
        value: r.followupCourseId ?? null,
        options: [
          { value: null, label: '沒有' },
          ...(all?.courses ?? [])
            .filter((c) => !c.deletedAt && c.id !== r.id)
            .map((c) => ({ value: c.id, label: c.active === false ? `${c.name}（已停用）` : c.name })),
        ],
        hint: '目前只有健檢用得到：健檢買幾次，二返就有幾次，'
          + '而且健檢標成已完成之後會自動長出「約二返」的待辦。',
      }),
    ],
    parse: (v) => ({
      name: v.name.trim(),
      // 她自己打的字優先；沒打就是那一排丸子。「其他」存成空的（`normalizeGroup()`）
      group: normalizeGroup(v.groupNew) ?? normalizeGroup(v.group),
      shortName: v.shortName.trim() || null,
      aboveeNames: parseAliases(v.aboveeNames),
      durationMin: v.durationMin,
      // 「30、60」→ [30, 60]。認不出數字的那幾格直接丟掉 ——
      // 存一個 NaN 進去，加購那一排會冒出一顆按不下去的丸子。
      durationChoices: f.parseList(v.durationChoices)
        .map(Number).filter((n) => Number.isInteger(n) && n > 0),
      bookingMinutes: f.parseList(v.bookingMinutes)
        .map(Number).filter((n) => Number.isInteger(n) && n > 0),
      category: v.category,
      // 存的順序固定（Abovee、Examine、耀聖），不照她勾的先後
      systems: SYSTEMS.filter((s) => (v.systems ?? []).includes(s)),
      assigns: v.assigns,
      allowedRoomTypes: v.assigns === 'room' ? (v.allowedRoomTypes ?? []) : [],
      allowedRoomIds: v.assigns === 'room' ? (v.allowedRoomIds ?? []) : [],
      preferredRoomIds: v.assigns === 'room' ? (v.preferredRoomIds ?? []) : [],
      requiresEquipment: !!v.requiresEquipment,
      requiresIvProduct: !!v.requiresIvProduct,
      doctorPick: v.doctorPick || DOCTOR_NONE,
      // 旗標跟著寫，讀的那一側只認 `doctorRuleOf()`
      requiresDoctor: (v.doctorPick || DOCTOR_NONE) !== DOCTOR_NONE,
      needsTreatmentForm: !!v.needsTreatmentForm,
      needsRecord: !!v.needsRecord,
      uncounted: !!v.uncounted,
      frequencyRule: v.frequencyRule?.trim() || null,
      followupCourseId: v.followupCourseId ?? null,
    }),
    wireForm: ({ form, all, data, readDraft }) => {
      f.wireChips(form);

      // **她勾過的常用診間記在這裡，不只記在畫面上。** 把治8 從「只能排在這幾間」
      // 勾掉，常用診間那一顆治8 會跟著消失（排不進去的不列）；再勾回來時它要還是
      // 勾著的 —— 只讀畫面的話那一下已經被洗掉了，而她什麼都沒說要改。
      const wanted = new Set(data.preferredRoomIds ?? []);
      form.addEventListener('change', (e) => {
        const name = e.target.name;
        if (name === 'preferredRoomIds') {
          if (e.target.checked) wanted.add(e.target.value);
          else wanted.delete(e.target.value);
          return;
        }
        if (!['assigns', 'allowedRoomTypes', 'allowedRoomIds'].includes(name)) return;
        const host = form.querySelector('[data-preferred]');
        if (!host) return;
        host.innerHTML = preferredRoomsField(
          { ...readDraft(), preferredRoomIds: [...wanted] }, all,
        );
      });
    },
    note: (r, all) => {
      const ids = r.allowedRoomIds ?? [];
      if (!ids.length) return '';
      const names = ids.map((id) => all.rooms.find((x) => x.id === id)?.name ?? '（已刪除）');
      return `<p class="muted">例外指定：只能在 ${esc(names.join('、'))}，蓋過上面的類型設定。</p>`;
    },
  },

  plans: {
    blank: { name: '', membershipMonths: 12, note: '', items: [] },
    summary: (r) => `${r.items?.length ?? 0} 個項目 · 會籍 ${r.membershipMonths ?? '?'} 個月`,
    fields: (r, all) => [
      photoHead(r),
      f.text({ name: 'name', label: '方案名稱', value: r.name, placeholder: '筋骨強身' }),
      f.number({ name: 'membershipMonths', label: '會籍（月）', value: r.membershipMonths, min: 1 }),
      f.text({ name: 'note', label: '備註', value: r.note ?? '', placeholder: '總價 288,000，限本人' }),
      itemsField(r.items ?? [], all, r.__seen),
    ],
    parse: (v) => ({
      name: v.name.trim(),
      membershipMonths: v.membershipMonths,
      note: v.note?.trim() || null,
      items: readItems(v),
    }),
    wireForm: wirePlanItems,
    note: (r, all) => {
      if (!r.items?.length) return '<p class="muted">還沒有項目。</p>';
      const rows = r.items.map((it) => {
        const detail =
          it.type === 'pool'
            ? `擇一：${(it.optionEquipmentIds ?? [])
                .map((id) => all.equipment.find((e) => e.id === id)?.name ?? '（已刪除）')
                .join(' / ')}`
            : all.courses.find((c) => c.id === it.courseId)?.name ?? '（課程已刪除）';
        return `<li>${esc(it.label)} <b>${it.qty}</b> 次 <span class="muted">${esc(detail)}</span></li>`;
      });
      return `<ul class="muted">${rows.join('')}</ul>`;
    },
  },
};

// ---------- 方案的項目編輯器 ----------
//
// 方案是唯一有巢狀資料的主檔。項目的欄位隨型態而變，所以這一段需要
// 「讀回表單 → 合併成草稿 → 重畫」，不能像其他主檔那樣 render 一次就結束。
//
// 排序用上下移動按鈕，不做拖拉（SPEC 第 8.0 節：無 hover、無拖拉、
// 最小點擊區 44px）。種子資料就有 7 個項目，實際只會更多，所以一項一張卡單欄堆疊。
//
// 驗證一律呼叫 domain 的 validate()，這裡不另寫一套 —— SPEC 第 6.7 節的雙層是
// 「前端一次、Rules 一次」，不是「UI 一次、domain 一次」。

/**
 * 從文宣照片帶進來的那一張（issue 07）：最上面一張縮圖，旁邊是照片上的方案名、價格、會籍。
 * 手打的那一張沒有 `__photo`，一個像素都不佔。`__` 開頭的那幾格只活在草稿裡，存檔讀的是表單。
 */
function photoHead(r) {
  if (!r.__photo) return '';
  const s = r.__seenPlan ?? {};
  return `
    <div class="photohead">
      <button type="button" class="photohead__img" data-seen-text="${esc(s.title || '文宣')}"
              data-seen-photo="${esc(r.__photo)}" aria-label="看那一張文宣">
        <img src="${esc(r.__photo)}" alt="" />
      </button>
      <div class="photohead__seen">
        <span class="photohead__label">照片上寫的是</span>
        ${seenChip(s.title, { photo: r.__photo })}
        ${seenChip(s.priceText, { photo: r.__photo })}
        ${seenChip(s.membershipText, { photo: r.__photo })}
      </div>
    </div>`;
}

function itemsField(items, all, seen = null) {
  return `
    <fieldset class="field">
      <legend class="field__label">項目<span class="muted"> ${items.length}</span></legend>
      ${items.length
        ? items.map((it, i) => itemCard(it, i, items.length, all, seen?.[i] ?? null)).join('')
        : '<p class="muted">還沒有項目。方案至少要有一個項目才存得進去。</p>'}
      <p><button class="btn" type="button" data-add-item>＋ 新增項目</button></p>
    </fieldset>`;
}

function itemCard(it, i, total, all, seen = null) {
  const isPool = it.type === 'pool';
  const photo = seen?.photo ?? null;

  return `
    <div class="pool${seen?.unresolved ? ' pool--unresolved' : ''}" data-item="${i}">
      ${seen ? `
        <div class="pool__seen">
          ${seenChip([seen.text, seen.detailText].filter(Boolean).join(' '), { photo })}
          ${seenChip(seen.quantityText ? `×${seen.quantityText}` : '', { photo })}
          ${seen.unresolved ? '<span class="pool__unresolved">認不出是哪一個課程，選一個</span>' : ''}
        </div>` : ''}
      <div class="pool__head">
        <span>第 ${i + 1} 個項目</span>
        <span class="pool__actions">
          <button class="btn" type="button" data-move="${i}:-1"
                  ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
          <button class="btn" type="button" data-move="${i}:1"
                  ${i === total - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        </span>
      </div>

      ${f.select({
        name: `item-${i}-type`, label: '型態', value: it.type ?? 'single',
        options: [
          { value: 'single', label: '單一課程（固定療程）' },
          { value: 'pool', label: '擇一池（每次選一種器材）' },
        ],
        hint: '換型態會換掉下面要填的欄位，已經填的名稱與次數不會被清掉。',
      })}

      ${f.text({ name: `item-${i}-label`, label: '顯示名稱', value: it.label ?? '', placeholder: '復能' })}
      ${f.number({ name: `item-${i}-qty`, label: '次數', value: it.qty ?? '', min: 1 })}

      ${isPool
        ? f.checkboxes({
            name: `item-${i}-equip`, label: '可選的器材',
            values: it.optionEquipmentIds ?? [],
            options: equipmentOptions(all.equipment, it.optionEquipmentIds ?? []),
            hint: '至少兩種。擇一池換的是器材，不是課程。',
          })
        : f.select({
            name: `item-${i}-course`, label: '課程', value: it.courseId ?? null,
            options: [
              { value: null, label: '（請選擇）' },
              ...courseOptions(all.courses, it.courseId),
            ],
          })}

      ${f.number({
        name: `item-${i}-duration`, label: '時長（分鐘）', value: it.durationMin ?? '',
        min: 1, step: 1,
        hint: isPool ? '擇一池沒有課程可以帶，要自己填。' : '選課程時會帶入該課程的時長，可以改。',
      })}

      ${f.text({
        name: `item-${i}-freq`, label: '頻率限制', value: it.frequencyRule ?? '',
        placeholder: '每季一次', hint: '只提示不阻擋。留空代表沒有限制。',
      })}

      <p><button class="btn" type="button" data-del-item="${i}">移除這個項目</button></p>
    </div>`;
}

// 已停用的仍然選得到，只標出來 —— validate 只擋已刪除、不擋停用，UI 不要比 domain 嚴。
// 指向已刪除課程的舊資料要原樣留著顯示，絕對不能在重畫時改成第一個選項：
// 那是無聲改資料，違反 SPEC 第 6 節的整個精神。讓 validate 去報錯。
function courseOptions(courses, currentId) {
  const opts = courses.map((c) => ({
    value: c.id,
    label: c.active === false ? `${c.name}（已停用）` : c.name,
  }));
  if (currentId && !courses.some((c) => c.id === currentId)) {
    opts.unshift({ value: currentId, label: '（課程已刪除）' });
  }
  return opts;
}

function equipmentOptions(equipment, currentIds) {
  const opts = equipment.map((e) => ({
    value: e.id,
    label: e.active === false ? `${e.name}（已停用）` : e.name,
  }));
  for (const id of currentIds) {
    if (!equipment.some((e) => e.id === id)) opts.push({ value: id, label: '（器材已刪除）' });
  }
  return opts;
}

/**
 * 從扁平的表單值組回項目陣列。
 * readForm 讀出來是一層物件，所以每個項目的欄位各自帶了 index 當名字。
 */
function readItems(v) {
  const items = [];
  for (let i = 0; `item-${i}-type` in v; i += 1) {
    items.push(
      planItem({
        type: v[`item-${i}-type`],
        label: v[`item-${i}-label`],
        qty: v[`item-${i}-qty`],
        durationMin: v[`item-${i}-duration`],
        courseId: v[`item-${i}-course`],
        optionEquipmentIds: v[`item-${i}-equip`],
        frequencyRule: v[`item-${i}-freq`],
      }),
    );
  }
  return items;
}

function wirePlanItems({ form, all, data, readDraft, repaint }) {
  // 從照片帶進來的那一張：每一項的原字（`__seen`）要跟著項目一起加、刪、搬，
  // 不然搬了一項之後小丸子印的是隔壁那一項的原字
  form.querySelector('[data-add-item]')?.addEventListener('click', () => {
    const next = readDraft();
    next.items = [...next.items, planItem({ ...BLANK_PLAN_ITEM })];
    if (next.__seen) next.__seen = [...next.__seen, null];
    repaint(next, next.items.length - 1);
  });

  form.querySelectorAll('[data-del-item]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = readDraft();
      const drop = Number(btn.dataset.delItem);
      next.items = next.items.filter((_, i) => i !== drop);
      if (next.__seen) next.__seen = next.__seen.filter((_, i) => i !== drop);
      repaint(next);
    }),
  );

  form.querySelectorAll('[data-move]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const [from, step] = btn.dataset.move.split(':').map(Number);
      const to = from + step;
      const next = readDraft();
      if (to < 0 || to >= next.items.length) return;
      const items = [...next.items];
      [items[from], items[to]] = [items[to], items[from]];
      next.items = items;
      if (next.__seen) {
        const seen = [...next.__seen];
        [seen[from], seen[to]] = [seen[to], seen[from]];
        next.__seen = seen;
      }
      // 停留在被移動的那一項，不是停在原本的位置
      repaint({ ...next }, to);
    }),
  );

  // 換型態要換欄位、換課程要帶預設值，兩者都得重畫。
  form.addEventListener('change', (ev) => {
    const m = /^item-(\d+)-(type|course)$/.exec(ev.target.name ?? '');
    if (!m) return;
    const i = Number(m[1]);
    const next = readDraft();
    if (m[2] === 'course') fillFromCourse(next.items[i], data.items?.[i], all.courses);
    repaint(next, i);
  });
}

/**
 * 選了課程就把時長、頻率、名稱帶進來。
 *
 * 只在「還沒填」或「填的正好是上一個課程的預設值」時覆蓋 ——
 * 她自己打過的數字不能被無聲蓋掉。
 */
function fillFromCourse(item, previous, courses) {
  const course = courses.find((c) => c.id === item?.courseId);
  if (!course) return;
  const was = courses.find((c) => c.id === previous?.courseId);

  if (item.durationMin == null || item.durationMin === was?.durationMin) {
    item.durationMin = course.durationMin ?? null;
  }
  if (!item.label || item.label === was?.name) item.label = course.name;

  if (!item.frequencyRule || item.frequencyRule === was?.frequencyRule) {
    if (course.frequencyRule) item.frequencyRule = course.frequencyRule;
    else delete item.frequencyRule;
  }
}

export async function render(el, type) {
  if (!editors[type]) {
    el.innerHTML = `<div class="card"><p>沒有這個主檔類型：${esc(type)}</p></div>`;
    return;
  }
  el.innerHTML = '<p class="muted">載入中…</p>';

  let all;
  try {
    all = await config.loadAll();
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  paintList(el, type, all);
}

function paintList(el, type, all) {
  if (type === 'courses') { paintCourseList(el, all); return; }
  const ed = editors[type];
  const rows = all[type];

  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <section class="card">
      <h2 class="card__title">${MASTER_LABELS[type]}<span class="muted"> ${rows.length}</span>${
        ed.lead ? tip(ed.lead) : ''}</h2>
      <p class="newrow">
        <button class="btn btn--primary" type="button" data-new>新增</button>
        ${type === 'plans' ? `<button class="btn btn--icon" type="button" data-photo-plan
            aria-label="拍方案文宣">${icon('camera', { size: 20 })}<span>拍文宣</span></button>` : ''}
      </p>
    </section>
    ${rows.length === 0 ? '<p class="muted">還沒有資料。</p>' : ''}
    ${rows
      .map(
        (r) => `
      <section class="card row">
        <div class="row__main">
          <div class="row__title">
            ${/* 有 badge 的那幾種在清單上就畫出它真正的樣子（目前只有警示）——
                 一份只印名字的清單，她要點進去才知道上次挑了什麼顏色。 */''}
            ${ed.badge ? ed.badge(r) : esc(r.name)}
            ${r.active === false ? '<span class="badge badge--soon">已停用</span>' : ''}
          </div>
          <div class="muted">${esc(ed.summary(r, all))}</div>
          ${ed.note ? ed.note(r, all) : ''}
        </div>
        <div class="row__actions">
          <button class="btn" type="button" data-edit="${esc(r.id)}">編輯</button>
          ${type === 'plans'
            ? `<button class="btn" type="button" data-copy="${esc(r.id)}">複製一份</button>`
            : ''}
        </div>
      </section>`,
      )
      .join('')}`;

  el.querySelector('[data-new]').addEventListener('click', () =>
    paintForm(el, type, all, null),
  );
  // 拍方案文宣（issue 07）：辨識完開的是**同一張方案編輯器**，事先填好 ——
  // 另做一張確認表遲早會跟這一張分岔。存檔與驗證都走原本那一條。
  el.querySelector('[data-photo-plan]')?.addEventListener('click', () => {
    openCamera({
      kind: 'planFlyer',
      max: 1,
      onDone: ([photo], { release }) => {
        const { plan, seen } = planDraftFrom(photo.transcript, all);
        paintForm(el, type, all, null, {
          ...plan,
          __photo: photo.url,
          __seenPlan: seen,
          __seen: seen.items.map((s) => ({ ...s, photo: photo.url })),
          __release: release,
        });
      },
    });
  });
  el.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(el, type, all, rows.find((r) => r.id === btn.dataset.edit)),
    ),
  );
  // 複製是「開一張帶著內容的新表單」，不是直接寫一筆進去 ——
  // 按了儲存才算數，跟現有的新增流程一致（ADR-0003 的複製，見那張 issue）。
  el.querySelectorAll('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(el, type, all, null, copyPlan(rows.find((r) => r.id === btn.dataset.copy))),
    ),
  );
}

// ---------- 設定 → 課程：先分類再項目（2026-10-05）----------
//
// 她的原話：
//
// > 設定 → 課程 要先分類再項目。
// > 復能：SIS、IN、高能量；…營養點滴
//
// SIS／IN／高能量在她嘴裡是「復能底下的項目」，在 app 裡是**器材**（ADR-0075：
// 三選一是一筆額度、共用一份次數）。所以畫出來是三層：分類 → 課程 → 它的器材或品項。
// 哪一門課在哪一組、底下掛誰，只在 `domain/masterData.js` 的 `coursesByGroup()`。
//
// **底下那幾列打開的是原本那一張器材／品項編輯表**（同一份 `editors`），存完回到
// 這一頁 —— 另做一張的話兩張遲早分岔。設定首頁的「器材」「營養點滴品項」磁磚照舊。

/** 課程底下的一列器材或品項。整列是一顆按鈕，點了開它自己的編輯表。 */
function childRow(type, row) {
  const meta = type === 'equipment'
    ? [
        row.shortName ? `月曆寫「${row.shortName}」` : null,
        row.contraindications?.length ? `⚠ 要提醒：${row.contraindications.join('、')}` : null,
      ]
    : [
        row.durationMin ? `${row.durationMin} 分` : null,
        row.shortName ? `月曆寫「${row.shortName}」` : null,
      ];
  return `
    <li>
      <button class="subrow" type="button" data-child-type="${type}" data-child-id="${esc(row.id)}">
        <span class="subrow__name">${esc(row.name)}${
          row.active === false ? ' <span class="badge badge--soon">已停用</span>' : ''}</span>
        <span class="subrow__meta muted">${esc(meta.filter(Boolean).join(' · '))}</span>
        ${icon('right', { size: 17 })}
      </button>
    </li>`;
}

function courseCard({ course, equipment, ivProducts }, all) {
  const ed = editors.courses;
  const kids = [
    ...equipment.map((e) => childRow('equipment', e)),
    ...ivProducts.map((p) => childRow('ivProducts', p)),
  ];
  // n返 借的就是二返這一門課（ADR-0063）。編輯表上本來就有這一句，清單上也放：
  // 她 2026-09-04 問「設定那邊的課程沒有 n返？」
  const borrowed = isFollowupCourse(course.id, all.courses ?? [])
    ? `<p class="muted">${esc(nthLabel(MIN_NTH))}、${esc(nthLabel(MIN_NTH + 1))}⋯⋯借這門課的設定</p>`
    : '';
  return `
    <section class="card row${kids.length ? ' row--stack' : ''}" data-course="${esc(course.id)}">
      <div class="row__main">
        <div class="row__title">
          ${esc(course.name)}
          ${course.active === false ? '<span class="badge badge--soon">已停用</span>' : ''}
        </div>
        <div class="muted">${esc(ed.summary(course, all))}</div>
        ${ed.note(course, all)}
        ${borrowed}
      </div>
      <div class="row__actions">
        <button class="btn" type="button" data-edit="${esc(course.id)}">編輯</button>
      </div>
      ${kids.length
        ? `<ul class="subrows" aria-label="${esc(course.name)}底下的項目">${kids.join('')}</ul>`
        : ''}
    </section>`;
}

function paintCourseList(el, all) {
  const ed = editors.courses;
  const rows = all.courses;

  // 「放在哪一組」那一排點了「新增」才出現，不佔平常的版面
  el.innerHTML = `
    <a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>
    <section class="card">
      <h2 class="card__title">${MASTER_LABELS.courses}<span class="muted"> ${rows.length}</span></h2>
      <p class="newrow">
        <button class="btn btn--primary" type="button" data-new aria-expanded="false">新增</button>
      </p>
      <div class="fieldgroup" data-grouppick hidden>
        <span class="fieldgroup__label">放在哪一組${tip(
          '表單會先帶好那一組常見的設定，每一格之後都還能改。')}</span>
        <div class="chiprow">
          ${courseGroupNames(rows).map((g) => `
            <button class="chip" type="button" data-newgroup="${esc(g)}">${esc(g)}</button>`).join('')}
        </div>
      </div>
    </section>
    ${rows.length === 0 ? '<p class="muted">還沒有資料。</p>' : ''}
    ${coursesByGroup(all).map((g) => `
      <h3 class="grouphead" data-group="${esc(g.group)}">${esc(g.group)}<span
        class="muted"> ${g.courses.length}</span></h3>
      ${g.courses.map((c) => courseCard(c, all)).join('')}`).join('')}`;

  el.querySelector('[data-new]').addEventListener('click', (e) => {
    const picker = el.querySelector('[data-grouppick]');
    picker.hidden = !picker.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!picker.hidden));
  });
  // 預設**只在建立那一刻抄一次**（`courseDefaultsFor()`）—— 進了表單之後每一格自己改，
  // 改分類也不會回頭重套。
  el.querySelectorAll('[data-newgroup]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(el, 'courses', all, null, {
        ...ed.blank, ...courseDefaultsFor(btn.dataset.newgroup),
      }),
    ),
  );
  el.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(el, 'courses', all, rows.find((r) => r.id === btn.dataset.edit)),
    ),
  );
  // 器材／品項：開它自己那一張編輯表，**回來的是這一頁**（`home`）
  el.querySelectorAll('[data-child-id]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const type = btn.dataset.childType;
      const record = (all[type] ?? []).find((r) => r.id === btn.dataset.childId);
      if (record) paintForm(el, type, all, record, null, null, 'courses');
    }),
  );
}

/**
 * @param {object|null} record 已存在的紀錄，新增時是 null
 * @param {object|null} draft 填到一半的內容。表單要重畫（例如方案加了一個項目）時，
 *   先把畫面上的值讀回來當草稿再重畫，否則其他欄位會被清空。
 * @param {number|null} focusItem 重畫後要捲到第幾個項目
 * @param {string} [home] 離開這一張之後回哪一份清單。預設就是這一種主檔自己的；
 *   從 設定 → 課程 點器材或品項進來的，回的是課程那一頁。
 */
function paintForm(el, type, all, record, draft = null, focusItem = null, home = type) {
  const ed = editors[type];
  // 看有沒有 id，不是看有沒有 record —— 帶著草稿重畫時 record 還是那一筆，
  // 但草稿本身沒有 id，用 !record 判斷會把「新增中」誤判成「編輯既有」。
  const isNew = !record?.id;
  const data = draft ?? record ?? { ...ed.blank };

  el.innerHTML = `
    <a class="backlink" href="#/settings/${home}" data-back>${icon('left', { size: 17 })}${MASTER_LABELS[home]}</a>
    <section class="card">
      <h2 class="card__title">${isNew ? `新增${MASTER_LABELS[type]}` : esc(data.name)}</h2>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${ed.fields(data, all).join('')}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
          ${!isNew && type === 'plans'
            ? '<button class="btn" type="button" data-copy>複製一份</button>'
            : ''}
        </div>
      </form>
    </section>
    ${isNew ? '' : dangerZone(record)}`;

  // 原地換掉整頁 → 疊一層，返回鍵退得回那一份主檔清單而不是離開設定。
  // 從照片帶進來的那一張：離開這一張（按返回、取消、存好）照片就收掉（ADR-0101 不存）
  const leave = pushScreen(`master-${type}`, () => { data.__release?.(); render(el, home); });
  const back = () => { data.__release?.(); leave(); };
  if (data.__photo) wireSeen(el.querySelector('[data-form]'));
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);
  // 帶著這一張的內容開一張新表單。畫面上還沒存的修改不帶過去 ——
  // 複製的是「已經存下來的那一張」，那是她按下去時看到的東西。
  el.querySelector('[data-copy]')?.addEventListener('click', () =>
    paintForm(el, type, all, null, copyPlan(record)),
  );

  const form = el.querySelector('[data-form]');

  // 需要換欄位的編輯器（目前只有方案的項目）用這個重畫，草稿由它自己準備。
  if (ed.wireForm) {
    ed.wireForm({
      form,
      all,
      data,
      readDraft: () => ({ ...data, ...ed.parse(f.readForm(form), data) }),
      repaint: (next, focus = null) => paintForm(el, type, all, record, next, focus, home),
    });
  }

  if (focusItem !== null) {
    const card = el.querySelector(`[data-item="${focusItem}"]`);
    card?.scrollIntoView({ block: 'center' });
    card?.querySelector('input')?.focus({ preventScroll: true });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = f.readForm(e.target);
    const parsed = ed.parse(values, record);
    const candidate = { ...parsed, id: record?.id };

    const errors = validate(type, candidate, {
      existing: all[type],
      courses: all.courses,
      equipment: all.equipment,
    });
    f.showErrors(el, errors);
    if (errors.length) return;

    try {
      if (isNew) {
        await toast.withSaveState(() => config.create(type, { ...parsed, active: true }), {
          success: '已新增', key: `master:create:${type}`,
        });
      } else {
        await toast.withSaveState(() => config.update(type, record.id, parsed), {
          success: '已儲存', key: `master:update:${type}:${record.id}`,
        });
      }
      back();
    } catch {
      /* withSaveState 已顯示錯誤與重試 */
    }
  });

  if (!isNew) wireDangerZone(el, type, record, back);
}

// ---------- 破壞性操作 ----------

function dangerZone(r) {
  const disabled = r.active === false;
  return `
    <section class="card danger">
      <h2 class="card__title">停用與刪除</h2>
      <p class="muted">
        ${disabled
          ? '目前已停用：新增來訪時不會出現在選單，既有來訪不受影響。'
          : '停用後新增來訪時不會再出現在選單，既有來訪不受影響。'}
      </p>
      <p>
        <button class="btn" type="button" data-toggle-active>
          ${disabled ? '重新啟用' : '停用'}
        </button>
        <button class="btn btn--danger" type="button" data-delete>刪除</button>${tip(
          '刪除是標記，資料不會消失，可以在「已刪除項目」還原。')}
      </p>
    </section>`;
}

function wireDangerZone(el, type, r, back) {
  el.querySelector('[data-toggle-active]').addEventListener('click', async () => {
    const turningOff = r.active !== false;
    const ok = await confirmAction({
      title: turningOff ? `停用「${r.name}」？` : `重新啟用「${r.name}」？`,
      consequences: turningOff
        ? [
            '之後新增來訪時，選單裡不會再出現它',
            '已經排好的來訪完全不受影響，照舊留著',
            '資料健檢頁會把指向已停用主檔的來訪列出來讓你有空再處理',
            '隨時可以再啟用',
          ]
        : ['之後新增來訪時，選單裡會重新出現它'],
      confirmLabel: turningOff ? '停用' : '啟用',
      danger: turningOff,
    });
    if (!ok) return;

    const before = r.active !== false;
    try {
      await toast.withSaveState(() => config.update(type, r.id, { active: !before }), {
        success: turningOff ? '已停用' : '已啟用',
      });
      back();
    } catch {
      /* 已處理 */
    }
  });

  el.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: `刪除「${r.name}」？`,
      consequences: [
        '這是標記刪除，資料不會真的消失',
        '清單上不再顯示，新增來訪時也選不到',
        '已經引用它的來訪與方案不會被修改，但會顯示為「已刪除」',
        '可以在設定 → 已刪除項目 還原',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      // 復原按鈕由 withSaveState 自己接上（SPEC 第 6.3 節）
      await toast.withSaveState(() => config.remove(type, r.id), { success: '已刪除' });
      back();
    } catch {
      /* 已處理 */
    }
  });
}
