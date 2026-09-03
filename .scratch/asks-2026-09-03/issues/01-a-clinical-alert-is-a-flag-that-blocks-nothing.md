# 壓表的時候看不到「血管難打」

Status: done
來源：她的三件事，2026-09-03（`../spec.md`）
動工前先讀：ADR-0002（app 記錄決定，不做決定）、ADR-0019（備註是彩色小丸，顏色不改變行為）、
ADR-0039（色相已經用完了）、ADR-0046（壓表卡片牆與待辦的「壓表登記」共用同一顆丸子）、
SPEC 第 4.3 節、`CONTEXT.md` 的「永久限制」「備註」

## 她要的

> 目前不是可以幫客人備註體內有金屬嗎，要多備註一個，血管難打，就是我壓表的時候
> 要能明顯看到這個客人是血管難打，像體內有金屬那樣標記。

她筆記裡的原始場景是點滴：「預約系統註記（第一針或血管難打）」——
**壓表的那一刻**要看得到，因為那一下她要把這件事抄進 Abovee 的註記欄。

## 為什麼加一個字不夠

「體內金屬」不是備註，是**永久限制**裡的**醫療禁忌** —— 它會硬性擋掉超磁場與
高能量雷射，那是全站唯一的硬性阻擋（`domain/contraindications.js` 的檔頭）。
而它之所以出現在壓表卡片牆上，是因為 `ui/components/flags.js` 的 `blockChips()`
**只畫會擋掉器材的那幾個字**：

```js
const blocking = new Set(terms);
const mine = flags.filter((x) => blocking.has(x));
if (!mine.length) return '';
```

那一支的檔頭寫著為什麼：

> **不擋器材的永久限制不畫。**「固定禮拜五不行」也是永久限制，但一張卡上
> 十個紅字等於全都不紅。

所以把「血管難打」打進永久限制的自由輸入欄，結果是**它一個畫面都不會出現在
壓表那一頁上**（客戶詳情與來訪編輯器會，但那不是她問的地方）。

而把它塞進器材的醫療禁忌欄更糟：那會讓「禁忌」變成一個**不擋任何東西**的字，
而下一個讀那段程式的人會以為禁忌清單是可信的。

## 決定：永久限制底下開第二層，叫「臨床提醒」

```
永久限制（跟著客戶一輩子）
├── 醫療禁忌      體內金屬        → 硬性擋掉器材 → 卡片牆上實心紅
├── 臨床提醒（新） 血管難打、第一針 → 什麼都不擋   → 卡片牆上茶色外框   ← 這一輪
└── 其他          固定禮拜五不行   → 什麼都不擋   → 卡片牆上不畫
```

判準（寫進 ADR，之後每加一個字都拿來問一次）：

> **忘了這件事，會不會讓她在這位客人身上做錯一件事？**
>
> 會，而且錯了有實際傷害 → 醫療禁忌（做成器材的禁忌，它自己會擋）
> 會，但錯了只是那一次比較不順、要重來一次 → **臨床提醒**
> 不會，只是排班要避開 → 其他

「固定禮拜五不行」留在第三層是對的：它是**排班**的事，而排班有本輪可用性
與可用日在管，卡片牆上另外印一次只是雜訊。

## 名單做成主檔（2026-09-03 她選的）

`config/app/clinicalFlags/{id}`，形狀跟診間、器材同一種：

```js
{ name: '血管難打', hint: '點滴要留時間，先問慣用手', active, deletedAt }
```

- **為什麼不寫死**：她手上的筆記裡至少已經有兩個（血管難打、第一針），
  而下一個一定還會有。寫死等於每加一個字都要改程式、重新部署，
  而這個專案的設定頁第一句話就是「診間與治療師都在這裡自己加，沒有寫死在程式碼裡」。
- **為什麼不從別的地方推**：醫療禁忌是從器材主檔推出來的
  （`contraindicationTerms()`），因為它本來就得跟器材上的字**完全相同**才擋得住。
  臨床提醒沒有對應的東西可以推，所以它自己就是那份名單。
- `hint` 是選填的一句話，只出現在**編輯永久限制**那一排丸子底下，
  不出現在卡片牆上 —— 牆上一張卡只回答一個問題（ADR-0046）。

### 改名的代價要先講清楚

客戶身上存的是**字串**（`flags: ['血管難打']`），不是 id。所以主檔上把
「血管難打」改成別的名字，既有客戶身上那個字**不會跟著改**，那顆丸子就變回
「其他」（不畫在牆上）。這跟器材的醫療禁忌是同一個行為，不是這一輪新引入的
問題 —— 但編輯畫面上要有一句話講出來，不然她會以為改名是安全的。

**不做自動搬移。** 那要掃全部客戶並改寫他們的 `flags`，而「這兩個字是不是同一件事」
是她的判斷（ADR-0002）。改名後那幾位客戶會落進資料健檢的既有清單，那是對的位置。

## 要改的地方

### `/domain`

| 檔案 | 改什麼 |
|---|---|
| `domain/masterData.js` | `MASTER_TYPES` 加 `'clinicalFlags'`、`MASTER_LABELS` 加「臨床提醒」、`validate()` 多一個 case（名稱必填、不可同名）。多一支 `clinicalTerms(rows)`（還在用的 → 名字），擺在 `staffWithRole()` 旁邊 —— 兩支問的是同一句話：「從主檔拿出一份可以點的名單」 |
| `domain/customers.js` | `splitFlags(customer, equipment)` → `splitFlags(customer, equipment, clinical)`，回三份 `{contraindications, clinical, others}`。`splitFlagsForEdit(flags, terms)` → 多收一份 `clinical`，回 `{picked, clinicalPicked, others}` —— **`others` 要同時排掉兩份名單**，不然臨床提醒會在自由輸入欄裡再出現一次，存檔時 `validate()` 會因為重複而擋下整張表單，而畫面上沒有一個欄位看起來是錯的（`mergeFlags()` 的註解已經記過這個坑一次） |
| `domain/contraindications.js` | **一個字都不改。** 那一支是「唯一的硬性阻擋」，臨床提醒不擋任何東西，混進去就是在稀釋它 |
| `domain/seed.js` | `SEED.clinicalFlags = [{ id: 'cf-veins', name: '血管難打', hint: '…' }, { id: 'cf-first', name: '第一針', hint: '…' }]` |

### `/ui`

| 檔案 | 改什麼 |
|---|---|
| `ui/components/flags.js` | `blockChips()` **改名 `alertChips()`** 並多收 `clinical`。名字要跟著意思走 —— 它現在畫的不只是「會擋的」。三個呼叫端跟著改（`tests/module-names.test.js` 會盯著漏掉的那一個）。`mount()` 多一排丸子，標題「臨床提醒　不會擋任何東西，只是要一眼看得到」 |
| `ui/views/schedule.js` | 本地的 `blockChips(row)` 跟著改名，`blockingTerms()` 旁邊多一支 `clinicalTerms()`（同樣**一批算一次**，不是一張卡算一次） |
| `ui/views/home.js` | `renderGroup('book')` 那一段多讀一次 `config.listAll('clinicalFlags')`，跟現有的 `equipment` 併進同一組 `Promise.all`，不多一輪往返 |
| `ui/views/customerDetail.js` | hero 那一排三分：禁忌紅、臨床提醒茶、其他灰 |
| `ui/views/visitEditor.js` | 第 197 行那一排 `.flag` 同上 |
| `ui/views/masterList.js` | `editors.clinicalFlags`：名稱 + 一句提示 |

### CSS

```css
/* 臨床提醒。比 .flag--block 輕一級：那一顆是「這台機器不能用」，
   這一顆是「這個人做起來要注意」。**不開新色相**（ADR-0039）——
   借 --tea（次要強調），而茶色目前沒有被任何狀態丸用掉。 */
.flag--alert { color: var(--tea); background: transparent; box-shadow: inset 0 0 0 1px var(--tea); }
```

`tokens.css` **不加任何新變數**（`--tea` 與 `--tea-soft` 兩份都已經有了）。

### 其他連動

- `public/sw.js` 的 `SHELL`：這一支不新增檔案，**不用改**（`VERSION` 照樣要加一）
- `firestore.rules`：`match /config/{docId=**}` 已經涵蓋 `config/app/clinicalFlags`，**不用開洞**
- `firestore.indexes.json`：主檔一律 `repo.list()` 不排序，**不用補索引**
- `data/backup.js` 的 `exportMaster()`：走 `MASTER_TYPES`，加進去就自動含進備份 —— 動工時要親眼確認這一句是真的
- `domain/dayReview.js`：`config/…` 開頭的稽核落在「設定」那一段，**已經對了**

## 測試

- `tests/master-data.test.js`：`clinicalFlags` 的驗證與 `clinicalTerms()`
- `tests/customers.test.js`：`splitFlags()` 三分、`splitFlagsForEdit()` 的 `others` 不含兩份名單裡的字
- `tests/tokens.test.js`：不會紅（沒加新變數）
- 端對端：卡片牆上看得到那顆茶色丸子。**塞進 `13-nth-followup.spec.js` 旁邊開一支
  `14-clinical-alert.spec.js`**，不要擠進 `00-smoke`（那一支是 CI 每次都跑的三支之一）

## 刻意不做的：日曆上不畫

日曆的 `load()` 只讀來訪、行事備註、隨手記、診間、治療師 —— **沒有讀客戶**。
要在日曆那一筆的讀取卡片上印「血管難打」，得為每一張卡多讀一次客戶文件。

而且 `visitReadHtml()` 是四個畫面共用的（ADR-0018、0056），加在那裡等於四個
畫面都要有客戶名單。

**先不做。** 她要的是壓表那一刻，而點滴當天那一刻由備忘錄那一條路回答
（issue 06：日曆上點那一筆 → 備忘錄的「當天」那一節）。真的需要再回來，
那時候的做法是「打開卡片時補讀一次那一位客戶」，不是把客戶名單塞進日曆的 `load()`。

## 要補的 ADR

`docs/adr/0064-a-clinical-alert-is-a-permanent-limit-that-blocks-nothing.md`

`CONTEXT.md` 的「永久限制」要改（它現在寫著「這裡的字系統看得懂並且會拿來擋」，
而臨床提醒看得懂但不擋），並新增一個詞條「臨床提醒」。
