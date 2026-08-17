// Firebase 前端 config。
//
// 這不是密鑰，可以直接 commit —— 它本來就會出現在每個人的瀏覽器裡。
// 真正的防線是 firestore.rules，不是把這串藏起來。
//
// 怎麼填：Firebase Console → 專案設定 → 一般 → 你的應用程式 → SDK 設定和配置
// 整段複製過來覆蓋下面的值即可。

export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.firebasestorage.app',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

export function isConfigured() {
  return !Object.values(firebaseConfig).some((v) => String(v).includes('REPLACE_ME'));
}
