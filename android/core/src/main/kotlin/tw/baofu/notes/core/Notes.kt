package tw.baofu.notes.core

/**
 * 隨手記的規則：**網頁 `public/js/domain/notes.js` 的照抄**（ADR-0180）。函式名、參數、回傳的形狀都跟那一支一樣，
 * 註解只寫 Kotlin 這一側特有的事 —— 規則的理由在網頁那一支與 ADR-0179。
 *
 * 改網頁那一支的時候：情境檔 `tests/fixtures/notes-parity.json` 跟著改（`node scripts/notes-parity.mjs --write`），
 * 這裡的單元測試就會紅，照著改到綠。**不要在這裡多一條網頁沒有的規則**：兩邊存出不一樣的資料，
 * Rules 擋下來她看到「存不進去」，擋不下來就是資料長得不一樣。
 */
object Notes {
    const val MAX_LENGTH = 200

    private fun trimmed(v: Any?) = Js.trimmed(v)

    // ---------- 存檔前的檢查、形狀 ----------

    fun validateNote(note: Doc?): List<String> {
        val errors = mutableListOf<String>()
        val text = trimmed(note?.get("text"))
        if (text.isEmpty()) errors += "要寫點東西"
        // 長度是 UTF-16 的格數（JS 的 `.length`）—— Kotlin 的 `String.length` 也是
        if (text.length > MAX_LENGTH) {
            errors += "太長了（${text.length} 字，最多 $MAX_LENGTH 字）。這種份量寫進客戶備註比較找得到"
        }
        if (Js.truthy(note?.get("customerId")) && trimmed(note?.get("customerName")).isEmpty()) {
            errors += "掛了客戶卻沒有名字"
        }
        val date = trimmed(note?.get("date"))
        if (date.isNotEmpty() && !Dates.isValidDate(date)) errors += "日期看不懂"
        if (trimmed(note?.get("linkId")).isNotEmpty() && trimmed(note?.get("entitlementId")).isNotEmpty()) {
            errors += "營養品的提醒不能跟別天連在一起"
        }
        return errors
    }

    /** 新增走這一支（吃一份完整的隨手記，沒帶到的算空的）。 */
    fun normalize(note: Doc?): Doc {
        val customerId = trimmed(note?.get("customerId")).ifEmpty { null }
        return linkedMapOf(
            "text" to trimmed(note?.get("text")),
            "customerId" to customerId,
            "customerName" to if (customerId != null) trimmed(note?.get("customerName")) else null,
            "date" to trimmed(note?.get("date")).ifEmpty { null },
            "done" to Js.truthy(note?.get("done")),
            "entitlementId" to trimmed(note?.get("entitlementId")).ifEmpty { null },
            "linkId" to trimmed(note?.get("linkId")).ifEmpty { null },
        )
    }

    /** 改一筆走這一支：**只整理有帶到的鍵**。 */
    fun normalizePatch(changes: Doc?): Doc {
        val c = changes ?: emptyMap()
        val out = linkedMapOf<String, Any?>()
        if ("text" in c) out["text"] = trimmed(c["text"])
        if ("date" in c) out["date"] = trimmed(c["date"]).ifEmpty { null }
        if ("done" in c) out["done"] = Js.truthy(c["done"])
        if ("linkId" in c) out["linkId"] = trimmed(c["linkId"]).ifEmpty { null }
        if ("customerId" in c || "customerName" in c) {
            val customerId = trimmed(c["customerId"]).ifEmpty { null }
            out["customerId"] = customerId
            out["customerName"] = if (customerId != null) trimmed(c["customerName"]) else null
        }
        return out
    }

    fun isLive(note: Doc?): Boolean = note != null && !note.truthy("deletedAt")

    fun isOpen(note: Doc?): Boolean = isLive(note) && !note!!.truthy("done")

    // ---------- 排序、分組 ----------

    /**
     * 沒勾的在上面（照 `createdAt` 新的在上）、勾掉的沉下去（照 `doneAt`，讀不出來退回 `createdAt`）。
     * 網頁拿 `String(…)` 比（`localeCompare`）；值都是同一種格式的 ISO 字串或 `Timestamp(seconds=…)`，
     * 第一個不一樣的字一定是數字對數字或「沒有」對「有」，UTF-16 的順序跟它一樣。
     */
    fun sortNotes(notes: List<Doc>?): List<Doc> {
        fun whenOf(n: Doc): Any? = if (n.truthy("done")) (if (n.truthy("doneAt")) n["doneAt"] else n["createdAt"]) else n["createdAt"]
        return (notes ?: emptyList()).filter { isLive(it) }.sortedWith { a, b ->
            val ad = a.truthy("done")
            val bd = b.truthy("done")
            if (ad != bd) (if (ad) 1 else -1) else Js.str(whenOf(b)).compareTo(Js.str(whenOf(a)))
        }
    }

    /** 首頁那一列的數字：還沒勾的有幾**列**（一組算 1）。 */
    fun openCount(notes: List<Doc>?): Int = groupLinked((notes ?: emptyList()).filter { isOpen(it) }, null).size

    // ---------- 連在一起的隨手記（ADR-0179） ----------

    private val SHARED_KEYS = listOf("text", "customerId", "customerName", "done")

    /** 同一組其他還活著的那幾筆（不含自己）。**判斷「連在一起」只有這一支。** */
    fun linkedPeers(note: Doc?, notes: List<Doc>?): List<Doc> {
        val linkId = trimmed(note?.get("linkId"))
        if (linkId.isEmpty()) return emptyList()
        return (notes ?: emptyList()).filter { isLive(it) && it.id != note!!.id && it.trimmed("linkId") == linkId }
    }

    fun isLinked(note: Doc?, notes: List<Doc>?): Boolean = linkedPeers(note, notes).isNotEmpty()

    /** null、沒有、空字串都算「沒有」；其餘照 JS 的 `===`。 */
    private fun blankToNull(v: Any?): Any? = if (v == "") null else v
    private fun sameValue(a: Any?, b: Any?): Boolean = blankToNull(a) == blankToNull(b)

    data class Change(val id: String, val changes: Doc)

    /** 改一筆連在一起的隨手記，每一筆要寫什麼（這一筆在第一個；一筆都沒變回空的）。 */
    fun linkedChanges(before: Doc, patch: Doc?, peers: List<Doc>?): List<Change> {
        val p = patch ?: emptyMap()
        val own = linkedMapOf<String, Any?>()
        for (key in listOf("text", "date", "linkId")) {
            if (key in p && !sameValue(before[key], p[key])) own[key] = p[key]
        }
        val customerMoved = ("customerId" in p || "customerName" in p) &&
            (!sameValue(before["customerId"], p["customerId"]) || !sameValue(before["customerName"], p["customerName"]))
        if (customerMoved) {
            own["customerId"] = p["customerId"]
            own["customerName"] = p["customerName"]
        }
        val doneMoved = "done" in p && before.truthy("done") != Js.truthy(p["done"])
        if (doneMoved) {
            own["done"] = Js.truthy(p["done"])
            if ("doneAt" in p) own["doneAt"] = p["doneAt"]
        }

        val writes = mutableListOf<Change>()
        if (own.isNotEmpty()) writes += Change(before.id!!, LinkedHashMap(own))

        val shared = LinkedHashMap(own.filterKeys { it in SHARED_KEYS })
        if ("done" in p) {
            shared["done"] = Js.truthy(p["done"])
            if ("doneAt" in p) shared["doneAt"] = p["doneAt"]
        }
        if (shared.isEmpty()) return writes

        for (peer in peers ?: emptyList()) {
            val changes = linkedMapOf<String, Any?>()
            if ("text" in shared && !sameValue(peer["text"], shared["text"])) changes["text"] = shared["text"]
            if ("customerId" in shared &&
                (!sameValue(peer["customerId"], shared["customerId"]) || !sameValue(peer["customerName"], shared["customerName"]))
            ) {
                changes["customerId"] = shared["customerId"]
                changes["customerName"] = shared["customerName"]
            }
            if ("done" in shared && peer.truthy("done") != shared["done"]) {
                changes["done"] = shared["done"]
                if ("doneAt" in shared) changes["doneAt"] = shared["doneAt"]
            }
            if (changes.isNotEmpty()) writes += Change(peer.id!!, changes)
        }
        return writes
    }

    data class CopyPlan(
        val blocked: String?,
        val linkId: String?,
        val link: Change?,
        val creates: List<Doc>,
        val skipped: List<String>,
        val taken: List<String>,
        val together: Int,
        val sourceIn: Boolean,
    )

    /** 複製到別天要寫哪幾筆（理由在網頁那一支的註解）。`group` 是照 `linkId`（沒有就照它的 id）重讀的、**含已刪除的**。 */
    fun copyPlan(note: Doc, dates: List<String>?, linked: Boolean = true, group: List<Doc>? = null, newLinkId: String? = null): CopyPlan {
        if (note.trimmed("entitlementId").isNotEmpty()) {
            return CopyPlan(
                blocked = "營養品的提醒不給複製 —— 要約別天給，到客戶詳情的「營養品」那一段約時間",
                linkId = null, link = null, creates = emptyList(), skipped = emptyList(), taken = emptyList(), together = 0, sourceIn = false,
            )
        }
        val ownDate = note.trimmed("date")
        val wanted = LinkedHashSet((dates ?: emptyList()).map { trimmed(it) })
            .filter { it.isNotEmpty() && Dates.isValidDate(it) && it != ownDate }
            .sorted()

        val noteId = note.id
        val others = (group ?: emptyList()).filter { it.id != noteId }
        val own = note.trimmed("linkId")
        val byMyId = others.filter { it.trimmed("linkId") == noteId }
        val done = note.truthy("done")
        var linkId: String? = null
        var link: Change? = null
        if (linked) {
            linkId = if (done) {
                if (own.isNotEmpty() || byMyId.any { isLive(it) && it.truthy("done") }) (newLinkId?.ifEmpty { null } ?: noteId) else noteId
            } else if (own.isNotEmpty()) {
                own
            } else {
                if (byMyId.isNotEmpty()) (newLinkId?.ifEmpty { null } ?: noteId) else noteId
            }
            if (!done && own != linkId) link = Change(noteId!!, linkedMapOf("linkId" to linkId))
        }
        val sourceIn = linked && !done

        val members = if (linked) {
            ((if (sourceIn) listOf(note) else emptyList()) + others.filter { it.trimmed("linkId") == linkId }).filter { isLive(it) }
        } else {
            emptyList()
        }
        val taken = LinkedHashSet(members.map { it.trimmed("date") }.filter { it.isNotEmpty() })

        val creates = mutableListOf<Doc>()
        val skipped = mutableListOf<String>()
        for (date in wanted) {
            if (date in taken) {
                skipped += date
                continue
            }
            creates += normalize(
                mapOf(
                    "text" to note["text"],
                    "customerId" to note["customerId"],
                    "customerName" to note["customerName"],
                    "date" to date,
                    "done" to false,
                    "linkId" to linkId,
                ),
            )
        }
        return CopyPlan(
            blocked = null,
            linkId = linkId,
            link = link,
            creates = creates,
            skipped = skipped,
            taken = taken.filter { it != ownDate }.sorted(),
            together = if (linked) members.size + creates.size else 0,
            sourceIn = sourceIn,
        )
    }

    /** 複製完的那一句。 */
    fun copiedSay(created: Int, linked: Boolean, together: Int, sourceIn: Boolean): String {
        if (created == 0) return "那幾天已經有了，沒有多建"
        val base = "複製到 $created 天"
        if (!linked || together < 2) return base
        return if (sourceIn) "$base：勾一天，其他天一起勾" else "$base：新的那幾天連在一起"
    }

    private val BY_DATE_THEN_CREATED = Comparator<Doc> { a, b ->
        val d = a.str("date").compareTo(b.str("date"))
        if (d != 0) d else a.str("createdAt").compareTo(b.str("createdAt"))
    }

    private fun representativeOf(members: List<Doc>, today: String?): Doc {
        val dated = members.filter { it.truthy("date") }.sortedWith(BY_DATE_THEN_CREATED)
        if (dated.isEmpty()) return sortNotes(members).first()
        val next = dated.firstOrNull { today.isNullOrEmpty() || it.str("date") >= today }
        if (next != null) return next
        val lastDate = dated.last()["date"]
        return dated.first { it["date"] == lastDate }
    }

    data class Row(val note: Doc, val members: List<Doc>, val days: List<String>)

    /** 清單類一組一列（小工具也照這一支）。鑰匙是 `linkId`＋勾了沒。 */
    fun groupLinked(notes: List<Doc>?, today: String?): List<Row> {
        val buckets = LinkedHashMap<String, MutableList<Doc>>()
        for (n in (notes ?: emptyList()).filter { isLive(it) }) {
            val linkId = n.trimmed("linkId")
            val key = if (linkId.isNotEmpty()) "link:$linkId:${if (n.truthy("done")) 1 else 0}" else "id:${n.id}"
            buckets.getOrPut(key) { mutableListOf() }.add(n)
        }
        val rows = buckets.values.map { members ->
            val ordered = members.sortedWith { a, b ->
                // `String(a.date ?? '\uFFFF')`：沒有日期的排最後（空字串照舊排最前 —— 照抄）
                val ad = if (a["date"] == null) "\uFFFF" else Js.str(a["date"])
                val bd = if (b["date"] == null) "\uFFFF" else Js.str(b["date"])
                val d = ad.compareTo(bd)
                if (d != 0) d else a.str("createdAt").compareTo(b.str("createdAt"))
            }
            Row(
                note = representativeOf(ordered, today),
                members = ordered,
                days = LinkedHashSet(ordered.map { it["date"] }.filter { Js.truthy(it) }.map { Js.str(it) }).toList(),
            )
        }
        val order = sortNotes(rows.map { it.note }).withIndex().associate { (i, n) -> n.id to i }
        return rows.sortedBy { order[it.note.id] ?: Int.MAX_VALUE }
    }

    data class Reach(val days: Int, val notes: Int, val count: Int, val unit: String, val label: String)

    /** 連在一起的一組「會作用在幾天」。沒連在一起是 null。 */
    fun linkedReach(note: Doc?, peers: List<Doc>?): Reach? {
        if (note == null || peers.isNullOrEmpty()) return null
        val members = listOf(note) + peers
        val days = members.map { it["date"] }.filter { Js.truthy(it) }.toSet().size
        val unit = if (days >= 2) "天" else "筆"
        val count = if (unit == "天") days else members.size
        return Reach(days, members.size, count, unit, "共 $count $unit")
    }

    data class Words(val tick: String?, val change: String?, val date: String?, val card: String, val toast: String, val hint: String)

    fun linkedWords(reach: Reach?): Words {
        if (reach == null) return Words(null, null, null, "", "", "")
        val n = "${reach.count} ${reach.unit}"
        return Words(
            tick = "${n}一起",
            change = "${n}一起改",
            date = "只改這一${reach.unit}",
            card = "${reach.label}會一起改",
            toast = "（${reach.label}）",
            hint = "連在一起：${reach.label}的字與掛給誰會一起改，日期只動這一筆。",
        )
    }

    /** 一列旁邊那一顆：「共 N 天」／「共 N 筆」／一筆的沒有。 */
    fun linkedBadge(row: Row?): String? {
        val members = row?.members ?: return null
        if (members.isEmpty()) return null
        return linkedReach(members.first(), members.drop(1))?.label
    }

    // ---------- 選單（小工具上是點字跳出來的那一張） ----------

    /** `note`、`icon`、`tone` 沒有就是 null（網頁那一份是 undefined —— 不畫）。 */
    data class Action(val id: String, val label: String, val note: String? = null, val icon: String? = null, val tone: String? = null)

    fun noteActions(note: Doc?, reach: Reach? = null): List<Action> {
        val out = mutableListOf<Action>()
        val product = Js.truthy(note?.get("entitlementId"))
        val words = linkedWords(if (product) null else reach)
        val together = words.tick

        if (Js.truthy(note?.get("done"))) {
            out += Action("untick", "拿回來，還沒做", note = together, icon = "todo")
        } else {
            out += Action("tick", "做完了，勾掉", note = if (product) "會先問給了哪幾款" else together, icon = "check", tone = "primary")
        }
        val date = note?.get("date")
        out += Action("date", "改日期", note = words.date ?: (if (Js.truthy(date)) Dates.shortDate(Js.str(date)) else null), icon = "calendar")

        if (product) {
            out += Action("bag", "看那一包營養品", icon = "box")
            return out
        }
        out += Action(
            "who",
            if (Js.truthy(note?.get("customerId"))) "改掛給誰" else "掛給誰",
            // `note?.customerName ?? undefined`：空字串照樣是空字串（不是沒有）
            note = if (together != null) words.change else note?.get("customerName")?.let { Js.str(it) },
            icon = "people",
        )
        out += Action("edit", "改文字", note = if (together != null) words.change else null, icon = "pencil")
        out += Action("copy", "複製到別天", icon = "copy")
        return out
    }

    data class DateChoice(val id: String, val label: String, val note: String? = null)

    /** 「改日期」那張卡上有哪幾個選項。 */
    fun dateChoices(note: Doc?, today: String, onCalendar: Boolean = false): List<DateChoice> {
        val out = mutableListOf<DateChoice>()
        if (!Js.truthy(note?.get("done")) && note?.get("date") != today) out += DateChoice("today", "改成今天")
        out += DateChoice("pick", "改成某天")
        if (Js.truthy(note?.get("date")) && !Js.truthy(note?.get("entitlementId"))) {
            out += DateChoice("undate", if (onCalendar) "從日曆拿掉" else "拿掉日期", "這一筆會留在隨手記裡")
        }
        return out
    }
}
