// 客戶那一頁（`/form.html`）唯一碰得到的資料層。ADR-0031。
//
// 三件事：讀邀請、讀他自己送出過的那一份、送出。**沒有第四件** ——
// 這支檔案讀不到客戶、額度、來訪、任務，程式碼上就到不了那些地方。
//
// **它刻意不走 `data/repo.js`。** repo 每一次寫入都附一筆稽核紀錄，
// 而稽核的 Rules 要求 `actor == request.auth.uid` —— 客戶沒有登入，寫不進去。
// 所以這裡直接用 SDK 寫一筆。稽核從「她收下」那一刻才開始（ADR-0032），
// 而收下走的是 repo，該留的紀錄還是留得下來。
//
// 不重填不是靠這裡擋的：文件 id 就是 token，第二次送出在 Firestore 眼中是
// `update`，而 Rules 沒有給客戶 update 的權限。**前端擋是體貼，Rules 擋才算數。**

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { initPublicFirebase, getDb } from './firebase.js';
import { normalizePicks } from '../domain/availabilityForm.js';

const INVITES = 'formInvites';
const RESPONSES = 'formResponses';

export function init() {
  initPublicFirebase();
}

/** 這條連結是誰的、要問哪個月。讀不到就是連結不對。 */
export async function getInvite(token) {
  const snap = await getDoc(doc(getDb(), INVITES, token));
  if (!snap.exists()) return null;
  const data = { id: snap.id, ...snap.data() };
  return data.deletedAt ? null : data;
}

/**
 * 他之前送出過的那一份。有就代表這條連結已經填完了。
 *
 * 讀得到是刻意的：他重開連結時要看得到自己填了什麼，不然「我到底填了沒」
 * 這個問題只能打電話問她。拿得到 token 的人就是他本人。
 */
export async function getResponse(token) {
  const snap = await getDoc(doc(getDb(), RESPONSES, token));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * 送出。
 *
 * `deletedAt: null` 不能少 —— `repo.list()` 一律用
 * `where('deletedAt','==',null)` 過濾，沒有這個欄位的文件她的收件匣一筆都看不到。
 *
 * @param {object} invite `getInvite()` 拿到的那一份
 * @param {{weekdays:object[], dates:object[], freeText:string}} picks
 * @returns {Promise<void>} 失敗一律往外丟，畫面要說出是哪一種失敗
 */
export async function submit(invite, { weekdays, dates, freeText }) {
  const clean = normalizePicks({ weekdays, dates });

  await setDoc(doc(getDb(), RESPONSES, invite.id), {
    token: invite.id,
    customerId: invite.customerId,
    customerName: invite.customerName ?? '',
    month: invite.month,
    weekdays: clean.weekdays,
    dates: clean.dates,
    freeText: String(freeText ?? '').trim(),
    submittedAt: serverTimestamp(),
    takenAt: null,
    deletedAt: null,
  });
}
