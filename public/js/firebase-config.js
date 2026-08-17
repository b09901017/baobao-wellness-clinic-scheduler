// Firebase 前端 config。
//
// 這不是密鑰，可以直接 commit —— 它本來就會出現在每個人的瀏覽器裡。
// 真正的防線是 firestore.rules，不是把這串藏起來。
//
// 怎麼填：Firebase Console → 專案設定 → 一般 → 你的應用程式 → SDK 設定和配置
// 整段複製過來覆蓋下面的值即可。

// 刻意不收 measurementId、也不初始化 Analytics：那會載入 Google 的追蹤
// 程式碼，而這個 app 處理的是客戶健康資訊，沒有理由多接一個第三方。

export const firebaseConfig = {
  apiKey: 'AIzaSyAeFnPeVOoKfGbf5eZof1AA9ev-u9bEifM',
  authDomain: 'wellness-clinic-scheduler.firebaseapp.com',
  projectId: 'wellness-clinic-scheduler',
  storageBucket: 'wellness-clinic-scheduler.firebasestorage.app',
  messagingSenderId: '4875686059',
  appId: '1:4875686059:web:8feeca1150e4a0ef07a7ee',
};

export function isConfigured() {
  return !Object.values(firebaseConfig).some((v) => String(v).includes('REPLACE_ME'));
}
