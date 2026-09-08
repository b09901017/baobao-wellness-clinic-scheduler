# 靜脈雷射只出現在 LINE 那一格，別的地方不要有「靜脈」

Status: todo
來源：使用者，2026-09-08（需求 1）
她的話：「只要 line 是靜脈雷射就好，我不想在其他地方看到『靜脈』，
像是好像目前有課程名稱叫做『靜脈』? 如果是舊資料庫的問題那沒關係」

## 程式已經是對的

種子上 `course-iv-laser` 就是 `name: 'ILIB'`、`shortName: 'IL'`、
`lineName: '靜脈雷射'`（`domain/seed.js:226`）。全站原始碼裡沒有任何一個
課程叫「靜脈」。

## 所以要做的是一列資料健檢

`course-iv-laser` 在 2026-09-06 之前叫「靜脈」，而 `loadSeed()` 只建不覆蓋。
她庫上那一筆還是舊名字，於是額度、月曆、LINE 三個地方都寫「靜脈」。

`domain/health.js` 新增一列，形狀**照抄 `checkEquipmentNames()`**：

```
id     courseNames
label  課程的名字跟建議的不一樣
hint   ILIB 那個課程 2026-09-06 正名過。還停在「靜脈」的話，
       額度、月曆、LINE 三個地方寫的都是舊字
fix    kind: 'renameCourse' —— 全名改成 ILIB、別稱 IL、LINE 名 靜脈雷射
```

**三格要同時還停在舊的才報**（同 `checkEquipmentNames()` 那條）：
她自己改過其中一格就是一個決定，不可以被一顆按鈕改回去。

```js
const LEGACY_COURSES = {
  'course-iv-laser': { name: '靜脈', shortName: null, lineName: null },
};
```

## 為什麼不順手改種子

種子已經對了。改種子對她現有的資料庫沒有作用（那正是這一列存在的理由），
而對還沒建過庫的人來說種子本來就是對的。

## 順手確認一件事

`domain/taskRules.js:98` 的 C 類提示字寫著「復能、靜脈、EECP、營養點滴」——
那是**畫面上的說明文字**，要改成「復能、ILIB、EECP、營養點滴」。
`CONTEXT.md` 的 _Avoid_ 名單上「靜脈」是禁用同義詞。

## 測試

- 健檢認得出還叫「靜脈」的那一筆，修正後再掃是綠的
- 她自己改成別的名字的那一筆**不報**
- `tests/no-secrets.test.js` 那一類的字串掃描不受影響
