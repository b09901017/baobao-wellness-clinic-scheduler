package tw.baofu.notes.core

import java.text.Normalizer

/**
 * 比名字、比病歷號、打名字跳出客戶：網頁那幾支的照抄（ADR-0180）。
 *
 * - `normalizeAlias()`：`masterData.js`（NFKC → 拿掉 JS 的 `\s` → 小寫）
 * - `normalizeChartNo()`、`chartNoInMark()`、`chartNosOf()`：`identify.js`
 * - `nameHas()`、`chartNoHas()`、`nameSuggestions()`：`customers.js`
 *
 * 名字照 zh-Hant 排（網頁是 `localeCompare(…, 'zh-Hant')`，V8 的 ICU）：比的那一支由呼叫端給 ——
 * app 用 `android.icu.text.Collator`、單元測試用 ICU4J，core 不帶 ICU（太大）。
 */
object Names {
    private val ASCII_DIGITS = Regex("^[0-9]+$")
    private val LEADING_ZEROS = Regex("^0+")

    /** `CHART_NO_PREFIX`（'病歷號 '）與 `OLD_CHART_NO_PREFIX`（'姓名欄的編號：'），去掉頭尾空白之後的樣子。 */
    private val CHART_PREFIXES = listOf("病歷號 ", "姓名欄的編號：").map { Js.trim(it) }

    fun normalizeAlias(raw: Any?): String =
        Js.removeSpaces(Normalizer.normalize(Js.str(raw), Normalizer.Form.NFKC)).lowercase()

    fun normalizeChartNo(raw: Any?): String {
        val s = Js.removeSpaces(Normalizer.normalize(Js.str(raw), Normalizer.Form.NFKC))
        return if (ASCII_DIGITS.matches(s)) s.replace(LEADING_ZEROS, "").ifEmpty { "0" } else s
    }

    fun chartNoInMark(text: Any?): String? {
        val t = Js.trim(Js.str(text))
        val prefix = CHART_PREFIXES.firstOrNull { t.startsWith(it) } ?: return null
        return Js.trim(t.substring(prefix.length)).ifEmpty { null }
    }

    /** `readMarks()` 只取字：有 `marks` 陣列照它（字去頭尾空白、空的不要），沒有就把舊的 `notes` 逐行拆。 */
    private fun markTexts(customer: Doc?): List<String> {
        val marks = customer?.get("marks")
        if (marks is List<*>) {
            return marks.map { m -> Js.trimmed((m as? Map<*, *>)?.get("text")) }.filter { it.isNotEmpty() }
        }
        return Js.trimmed(customer?.get("notes")).split('\n').map { Js.trimmed(it) }.filter { it.isNotEmpty() }
    }

    /** 這位客戶身上的病歷號（正規化過；那一格排第一、再來是還寫成短備註的；不重複）。 */
    fun chartNosOf(customer: Doc?): List<String> {
        val out = mutableListOf<String>()
        fun add(raw: Any?) {
            val no = if (raw == null) "" else normalizeChartNo(raw)
            if (no.isNotEmpty() && no !in out) out += no
        }
        add(customer?.get("chartNo"))
        for (text in markTexts(customer)) add(chartNoInMark(text))
        return out
    }

    fun nameHas(name: Any?, query: Any?): Boolean = normalizeAlias(name).contains(normalizeAlias(query))

    fun chartNoHas(customer: Doc?, query: Any?): Boolean {
        val q = normalizeChartNo(query)
        if (!ASCII_DIGITS.matches(q)) return false
        return chartNosOf(customer).any { it.contains(q) }
    }

    /** `SUGGEST_BOUNDARY = /[\s\p{P}\p{S}]/u`：空白、標點、符號。 */
    private fun isBoundary(codePoint: Int): Boolean {
        if (Character.isBmpCodePoint(codePoint) && Js.isSpace(codePoint.toChar())) return true
        return when (Character.getType(codePoint).toByte()) {
            Character.CONNECTOR_PUNCTUATION, Character.DASH_PUNCTUATION, Character.START_PUNCTUATION,
            Character.END_PUNCTUATION, Character.INITIAL_QUOTE_PUNCTUATION, Character.FINAL_QUOTE_PUNCTUATION,
            Character.OTHER_PUNCTUATION,
            Character.MATH_SYMBOL, Character.CURRENCY_SYMBOL, Character.MODIFIER_SYMBOL, Character.OTHER_SYMBOL,
            -> true
            else -> false
        }
    }

    /** `from`／`to` 是 UTF-16 的位置（跟 Android `EditText` 的 selection 同一種）。 */
    data class Suggestions(val from: Int, val to: Int, val matches: List<Doc>)

    /**
     * 記一筆時打名字就跳出客戶：游標前面那一段（往前到空白標點為止）裡**最長的、是某一位名字開頭的尾巴**。
     * 規則與理由在網頁 `customers.js` 那一支；情境在 `notes-parity.json` 的 `nameSuggestions`。
     */
    fun nameSuggestions(
        text: Any?,
        caret: Int?,
        customers: List<Doc>?,
        collator: Comparator<String>,
        currentId: String? = null,
        limit: Int = 6,
    ): Suggestions {
        val value = Js.str(text)
        val to = maxOf(0, minOf(caret ?: value.length, value.length))
        val none = Suggestions(to, to, emptyList())
        val chars = value.substring(0, to).codePoints().toArray().map { String(Character.toChars(it)) }
        var start = chars.size
        while (start > 0 && !isBoundary(chars[start - 1].codePointAt(0))) start -= 1
        val people = (customers ?: emptyList()).filter { !it.truthy("deletedAt") && normalizeAlias(it["name"]).isNotEmpty() }

        for (i in start until chars.size) {
            val tail = chars.subList(i, chars.size).joinToString("")
            val q = normalizeAlias(tail)
            if (q.isEmpty()) continue
            val hits = people.filter { normalizeAlias(it["name"]).startsWith(q) }
            if (hits.isEmpty()) continue
            fun exact(c: Doc) = normalizeAlias(c["name"]) == q
            if (currentId != null && currentId.isNotEmpty() && hits.any { it.id == currentId && exact(it) }) return none
            val matches = hits.sortedWith { a, b ->
                val e = (if (exact(b)) 1 else 0) - (if (exact(a)) 1 else 0)
                if (e != 0) e else collator.compare(Js.str(a["name"]), Js.str(b["name"]))
            }.take(limit)
            return Suggestions(to - tail.length, to, matches)
        }
        return none
    }
}

/**
 * 給小工具的兩條網址（網頁 notes-widget 10，登記在 `public/js/ui/views.js`）。`origin` 是那一個站（`BuildConfig.WEB_ORIGIN`）。
 * 改網址要兩邊一起改 —— 情境檔的 `links` 盯著兩邊。
 */
object WebLinks {
    /** 打開隨手記那一頁、跳出這一筆的選單（營養品的提醒直接問「給了哪幾款」）。 */
    fun note(origin: String, id: String): String = "$origin/#/todo/notes/note/$id"

    /** 打開隨手記那一頁、「記一筆」打開、給營養品已經展開。 */
    fun newGive(origin: String): String = "$origin/#/todo/notes/new/give"
}
