/* ==========================================================================
   Firebase 初始化：匿名登入 + Firestore 連線
   ========================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyA3KKp7mef_yUqsHRGo3btGqYxpSMMhYmM",
  authDomain: "group-travel-56b6f.firebaseapp.com",
  projectId: "group-travel-56b6f",
  storageBucket: "group-travel-56b6f.firebasestorage.app",
  messagingSenderId: "422594331975",
  appId: "1:422594331975:web:bfc3f202692f4b26247862"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// 讓網站在離線狀態下仍可讀寫（本機快取），恢復連線後自動同步
try {
  db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* 多分頁或不支援的瀏覽器就略過，不影響核心功能 */ });
} catch (e) { /* 忽略 */ }

// window.authReady：整個 app.js 會 await 這個 promise 才開始讀寫 Firestore
window.authReady = new Promise((resolve, reject) => {
  auth.onAuthStateChanged(user => {
    if (user) { resolve(user); return; }
    auth.signInAnonymously().catch(err => {
      console.error("匿名登入失敗", err);
      reject(err);
    });
  });
});

window.db = db;
window.auth = auth;
