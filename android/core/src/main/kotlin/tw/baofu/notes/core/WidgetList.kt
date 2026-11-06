package tw.baofu.notes.core

/**
 * 小工具上那一份清單怎麼排（spec「一」的「清單順序」，她 11/6：「我希望是優先列今天的。其他都照建議做」）：
 *
 * 今天 → 日期過了還沒勾的 → 沒有日期的 → 以後的（越近越上面）；每一段裡照記的先後、新的在上面。
 *
 * **網頁沒有這一支**（網頁的清單照 `sortNotes()` 一種順序），所以不在共用情境檔裡、有自己的單元測試（`WidgetListTest`）。
 * 一組連在一起的照 `Notes.groupLinked()` 一列（代表的那一筆：今天或之後最早的一天、全部過了是最後一天）——
 * **分組不在這裡另寫一份**。
 */
object WidgetList {
    enum class Part { TODAY, OVERDUE, UNDATED, LATER }

    data class Section(val part: Part, val rows: List<Notes.Row>)

    /** 一列落在哪一段。連在一起的那一組只要有一天是今天就算今天。 */
    fun partOf(row: Notes.Row, today: String): Part {
        if (row.days.contains(today)) return Part.TODAY
        val date = row.note["date"]
        if (!Js.truthy(date)) return Part.UNDATED
        return if (Js.str(date) < today) Part.OVERDUE else Part.LATER
    }

    /**
     * 記的先後：伺服器時間新的在上；**還沒回到伺服器的（`createdAt` 是 null）是剛剛記的，排最上面**。
     */
    private val NEWEST_FIRST = Comparator<Notes.Row> { a, b -> compareCreated(b.note["createdAt"], a.note["createdAt"]) }

    private fun compareCreated(a: Any?, b: Any?): Int {
        if (a == b) return 0
        if (a == null) return 1 // null 當成最新
        if (b == null) return -1
        if (a is Ts && b is Ts) return if (a.seconds != b.seconds) a.seconds.compareTo(b.seconds) else a.nanos.compareTo(b.nanos)
        return Js.str(a).compareTo(Js.str(b))
    }

    /** 還沒勾的那幾筆 → 四段（空的那一段不回）。 */
    fun sections(notes: List<Doc>?, today: String): List<Section> {
        val rows = Notes.groupLinked((notes ?: emptyList()).filter { Notes.isOpen(it) }, today)
        val byPart = rows.groupBy { partOf(it, today) }
        return Part.entries.mapNotNull { part ->
            val list = byPart[part] ?: return@mapNotNull null
            val sorted = if (part == Part.LATER) {
                list.sortedWith(compareBy<Notes.Row> { Js.str(it.note["date"]) }.then(NEWEST_FIRST))
            } else {
                list.sortedWith(NEWEST_FIRST)
            }
            Section(part, sorted)
        }
    }
}
