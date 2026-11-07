package tw.baofu.notes.core

import org.junit.Assert.assertEquals
import org.junit.Test
import tw.baofu.notes.core.WidgetList.Part

/** 小工具的清單順序（spec「一」）。網頁沒有這一支，所以不在共用情境檔裡。 */
class WidgetListTest {
    private val today = "2026-11-06"

    private fun note(id: String, created: Long?, date: String? = null, extra: Map<String, Any?> = emptyMap()): Doc =
        linkedMapOf<String, Any?>(
            "id" to id, "text" to id, "date" to date, "done" to false, "deletedAt" to null,
            "createdAt" to created?.let { Ts(it, 0) },
        ) + extra

    private fun order(notes: List<Doc>) = WidgetList.sections(notes, today).map { s -> s.part to s.rows.map { it.note.id } }

    @Test
    fun todayThenOverdueThenUndatedThenLater() {
        val notes = listOf(
            note("later", 1, "2026-11-09"),
            note("undated", 2),
            note("overdue", 3, "2026-11-04"),
            note("today", 4, today),
        )
        assertEquals(
            listOf(Part.TODAY to listOf("today"), Part.OVERDUE to listOf("overdue"), Part.UNDATED to listOf("undated"), Part.LATER to listOf("later")),
            order(notes),
        )
    }

    @Test
    fun newestFirstInsideEachPartAndLaterIsNearestFirst() {
        val notes = listOf(
            note("u-old", 1), note("u-new", 5),
            note("t-old", 2, today), note("t-new", 6, today),
            note("l-far", 9, "2026-12-01"), note("l-near-old", 3, "2026-11-08"), note("l-near-new", 7, "2026-11-08"),
            note("o-old", 4, "2026-10-01"), note("o-new", 8, "2026-11-05"),
        )
        assertEquals(
            listOf(
                Part.TODAY to listOf("t-new", "t-old"),
                Part.OVERDUE to listOf("o-new", "o-old"),
                Part.UNDATED to listOf("u-new", "u-old"),
                Part.LATER to listOf("l-near-new", "l-near-old", "l-far"),
            ),
            order(notes),
        )
    }

    @Test
    fun notYetOnTheServerIsTheNewest() {
        val notes = listOf(note("old", 5), note("pending", null))
        assertEquals(listOf(Part.UNDATED to listOf("pending", "old")), order(notes))
    }

    @Test
    fun aLinkedGroupIsOneRowAndCountsAsTodayIfAnyDayIsToday() {
        val link = mapOf("linkId" to "g")
        val notes = listOf(
            note("g1", 1, "2026-11-04", link), note("g2", 2, today, link), note("g3", 3, "2026-11-10", link),
            note("solo", 4, "2026-11-05"),
        )
        val sections = WidgetList.sections(notes, today)
        assertEquals(listOf(Part.TODAY to listOf("g2"), Part.OVERDUE to listOf("solo")), sections.map { s -> s.part to s.rows.map { it.note.id } })
        assertEquals(listOf("2026-11-04", today, "2026-11-10"), sections.first().rows.single().days)
    }

    @Test
    fun aLinkedGroupWithPastAndFutureDaysIsLaterAndOneEntirelyPastIsOverdue() {
        val a = mapOf("linkId" to "a")
        val b = mapOf("linkId" to "b")
        val notes = listOf(
            note("a1", 1, "2026-11-01", a), note("a2", 2, "2026-11-12", a),
            note("b1", 3, "2026-10-01", b), note("b2", 4, "2026-11-02", b),
        )
        assertEquals(listOf(Part.OVERDUE to listOf("b2"), Part.LATER to listOf("a2")), order(notes))
    }

    @Test
    fun tickedAndDeletedAreNotListed() {
        val notes = listOf(
            note("open", 1),
            note("done", 2, extra = mapOf("done" to true)),
            note("gone", 3, extra = mapOf("deletedAt" to Ts(9, 0))),
        )
        assertEquals(listOf(Part.UNDATED to listOf("open")), order(notes))
    }
}
