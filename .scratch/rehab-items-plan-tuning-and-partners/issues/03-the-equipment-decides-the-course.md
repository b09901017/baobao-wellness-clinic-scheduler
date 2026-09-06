# ILIB 補成第四台器材，那一段算哪個課程由器材決定

Status: 待確認

## 她說的

> 我是想說可以是有復能和ILIB這兩個課程，然後復能點了之後可以選，要高能量雷射，
> sis，indiba，三選一，四選一，這五種……然後治療師和診間不應該是在加購的時候選，
> 而是壓表壓這個課程的時候選

> ILIB 雖然也屬於復能的一種 但不用治療師 也不是3選一的一種 他是獨立的

四選一選到 ILIB 時：**選了哪一台就跟著換**（2026-09-06 確認）——
選 SIS／雷射／INDIBA 出現治療師那一排，選 ILIB 換成診間那一排。

## 這件事卡在哪

「復能四選一」是**一筆額度**，但它的四台器材要的資源不一樣：三台要物理治療師、
ILIB 要診間。而現在「要指派什麼」只寫在**課程**上（`course.assigns`），
一筆額度的所有時段共用同一個課程 —— 所以四選一在今天的模型裡表達不出來。

還有三處會擋住：

| 位置 | 現在 |
|---|---|
| ADR-0005 | 擇一池的時段課程用「`requiresEquipment` 為真的課程」推導 —— 目前只有復能一個 |
| `masterData.js` 的 `courses` 驗證 | 「要選器材的課程必須同時指派治療師」 |
| `entitlements.js` 的 `validateEntitlement()` | 「擇一池至少要有兩種器材可選」 |

## 要做什麼

### 一、器材主檔補 ILIB，並且每一台記著「用這台算哪個課程」

```js
equipment: [
  { id: 'eq-indiba', name: 'INDIBA',    courseId: 'course-recovery',  contraindications: [] },
  { id: 'eq-sis',    name: '超磁場',     courseId: 'course-recovery',  contraindications: ['體內金屬'] },
  { id: 'eq-laser',  name: '高能量雷射', courseId: 'course-recovery',  contraindications: ['體內金屬'] },
  { id: 'eq-ilib',   name: 'ILIB',      courseId: 'course-iv-laser',  contraindications: [] },
],
```

`courseId` 是**選填**。沒填的照舊走 `requiresEquipment` 那條推導，所以既有資料
一筆都不會壞。

同時 `course-iv-laser` 的 `name` 從「靜脈」改成「ILIB」（她 2026-09-06 正名）。
**課程改名不會搬既有時段上的 `courseName` 快照** —— 那是刻意的（主檔改名不動
歷史紀錄）。正式資料庫上那一筆要她自己到設定 → 課程改一次，`12` 的手冊會寫。

### 二、`coursesForEntitlement()` 改成從器材推

```js
export function coursesForEntitlement(entitlement, courses = []) {
  const alive = courses.filter((c) => !c.deletedAt);
  if (entitlement?.type !== 'pool') return alive.filter((c) => c.id === entitlement?.courseId);

  // 池裡每一台器材各自指到的課程，去重、維持池上的順序。
  // 一台都指不出來就退回舊行為（ADR-0005）—— 舊資料的器材身上沒有 courseId。
  …
}
```

**這一支要多收一個 `equipment` 參數**，四個呼叫端跟著改
（`visitEditor.js` 三處、`schedule.js` 一處）。

### 三、換器材時課程跟著換

只寫在一個地方：`domain/visits.js` 新增

```js
/** 這一段選了這台器材，那它算哪一個課程。推不出來就維持原來的。 */
export function courseForEquipment(equipmentId, equipment, fallbackCourseId) { … }
```

`visitEditor.js` 與 `schedule.js` 換器材的那一下都呼叫它，順手把 `courseName`
快照跟著換。**兩邊各寫一次的話**，會出現一邊寫「復能・ILIB」一邊寫「ILIB」的
資料，而那要等到她看試算表才會發現。

四選一的那一段：課程那一排**不出現**（她選的是器材，課程是推出來的）。
三選一與單台本來就只推得出一個課程，行為一個字都沒有變。

### 四、把兩條擋路的驗證放寬

| 位置 | 改成 | 為什麼 |
|---|---|---|
| `masterData.js` `courses` | 「要選器材的課程必須同時指派治療師」→ **刪掉** | 四選一裡的 ILIB 要的是診間；指派已經由器材推 |
| `masterData.js` `plans` | 擇一池至少 **1** 種器材 | 方案裡也可能只買單台 |
| `entitlements.js` | 同上 | 單買 SIS(60) 就是「池裡只有一台」 |

「擇一池至少要有兩種」這條原本擋的是**打錯字**（選了池卻一台都沒挑）。
放寬到 1 之後那個保護還在（0 台仍然擋），只是「一台」現在是合法的意思。

### 五、`assignsFor()`：一段要指派什麼

`domain/masterData.js` 現在沒有這一支 —— 呼叫端各自讀 `course.assigns`。
這一輪加一支，讓「這一段要治療師還是診間」只有一個答案：

```js
/** 這一段要指派什麼。課程說了算，而課程是器材推出來的（見 courseForEquipment）。 */
export const assignsFor = (course) => course?.assigns ?? 'none';
```

看起來多餘，但它是**接縫**：以後真的要讓器材蓋過課程時，只有這一支要改。

## 不做的

- **不把禁忌搬到課程上。** CLAUDE.md 明文：醫療禁忌記在器材主檔。
- **不動 `course-iv-laser` 的 `requiresEquipment`（維持 false）。** 單買 ILIB 的
  那筆額度是 `single`，它的時段不記器材 —— 跟今天一模一樣。只有從**四選一池**
  排出來的那一段才會同時有 `courseId: course-iv-laser` 與 `equipmentId: eq-ilib`，
  而 `visitErrors()` 現在就收得下這種組合（已核對過，不必改）。
- **不改 `slot` 的欄位。** 這一輪一個新欄位都不加在時段上。

## 測試

- `tests/visits.test.js`：`coursesForEntitlement()` 對四選一回兩個課程、對三選一
  回一個；器材身上沒有 `courseId` 時退回舊行為。
- 同上：`courseForEquipment()` 推不出來時維持原課程（不要回 null 把資料清掉）。
- `tests/visits.test.js`：四選一 + ILIB 的時段存得下去，`errors` 是空的。
- `tests/master-data.test.js`：一台器材的池過得了驗證、零台仍然擋。
- `tests/domain.test.js`：種子裡每一台器材的 `courseId` 都指得到一個活著的課程。

## 連帶

`CONTEXT.md` 的「復能」「靜脈」「擇一池」「器材」四條要改寫，
`ADR-0005` 要補一支後續 ADR（`12`）。
