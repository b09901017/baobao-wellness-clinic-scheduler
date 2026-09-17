# 拍方案文宣 → 方案範本

Status: todo
Blocked by: 03、06
來源：`../spec.md`
動工前先讀：`ui/views/masterList.js:661`（「新增」那一顆）與它的方案編輯器、
`domain/masterData.js` 的 `validators.plans()`、`domain/seed.js` 的 `plans`（`membershipMonths`、`note`、`items`）、
`domain/legacyImport.js:138` 的 `rowShape()`、`domain/entitlements.js` 的 `poolName()`／`timedLabel()`、
`docs/adr/0003`（範本沒有版本）、`docs/adr/0075`、`docs/adr/0078`（只有三種名字）

**這一支是整條路的第一刀**：沒有個資、一張照片、一條寫入的路。地基（02、03、06）在它身上走通。

## 她要的（原話）

> 第三 : 拍方案 → 新增方案範本，可以再設定方案範本新增旁邊多一個相機的icon，然後一樣是可以拍照選照片，然後說辯是到了什麼內容，然後可以微調，然後介面一樣不要太複雜

## 為什麼會這樣

方案範本現在只能一項一項打（`masterList.js` 的方案編輯器）。文宣上的寫法跟主檔不一樣：

- 文宣：`高能量雷射 或 超磁場 或 INDIBA 共計60min` ×12
- 主檔：`{ type: 'pool', label: '復能-三選一(60)', qty: 12, durationMin: 60, optionEquipmentIds: [...] }`

「超磁場」是 SIS 的舊名（SPEC 第 12 節），`rowShape()` 已經認得 `超磁`。
項目的名字**不抄文宣**，由 `poolName()`／`timedLabel()` 算（ADR-0078）。

## 要做什麼

- 設定 → 方案範本，「新增」旁邊一顆相機（只有 `plans` 這一種主檔有）
- `openCamera({ kind: 'planFlyer', max: 1 })`
- `domain/photoPlan.js`（純函式）：`planDraftFrom(transcript, master)` →
  - `title` → `name`；`membershipText`（「會籍1年」）→ `membershipMonths`；`priceText` → `note`
  - 每一個 `items[]` → 走 `rowShape()` 與課程名稱比對 → `single`（`courseId`）或 `pool`（`optionEquipmentIds`）＋ `durationMin` ＋ `qty`
  - **認不出來的項目**：留一列，`courseId` 空著、帶著原字，讓她選
  - `label` 一律算出來
- **確認就是那張方案編輯器，事先填好**。不另做一張表 —— 另做一張遲早會分岔（「其他…」那一格漏了兩次就是這個形狀）
  - 每一列旁邊放 06 的「照片上寫的是」小丸子
  - 存檔走原本那顆，驗證走原本的 `validators.plans()`

## 判準

- 拿 `.local/references/images/方案-筋骨強身-價目表.jpg` 走一次（模擬器用那張的假抄字）：
  編輯器裡是七個項目，次數 6／4／4／4／4／12／20，復能那一項是**三台的擇一池、60 分**，ILIB 是 single、60 分
- 名字是 `復能-三選一(60)`，**不是**「高能量雷射 或 超磁場 或 INDIBA 共計60min」
- 把假抄字裡一個項目改成主檔沒有的課程 → 那一列空著、看得到原字、存不下去直到她選好
- **這一支有沒有任何一行，讓 AI 決定一個項目是擇一池還是單一課程？**（應該是 `rowShape()` 決定）
- 存下去之後，跟手打的那一份範本長得一模一樣（沒有「來自照片」之類多出來的欄位）
