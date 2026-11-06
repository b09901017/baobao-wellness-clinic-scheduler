package tw.baofu.notes.core

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 小工具的增量同步（她 11/6：背景定時只問上次之後改過的，沒變只花 1 次讀取）。網頁沒有這一支，所以不在共用情境檔裡。
 */
class NotesSyncTest {
    private fun note(id: String, updated: Long?, extra: Map<String, Any?> = emptyMap()): Doc =
        linkedMapOf<String, Any?>(
            "id" to id, "text" to id, "done" to false, "deletedAt" to null,
            "updatedAt" to updated?.let { Ts(it, 0) },
        ) + extra

    /** 照雲端那一份回答兩種查詢、記下問了什麼。 */
    private class Cloud(var docs: List<Doc>) : NoteStore {
        val asked = mutableListOf<String>()

        override suspend fun read(path: String, id: String): Doc? = error("用不到")
        override suspend fun listWhere(path: String, field: String, value: String): List<Doc> = error("用不到")
        override fun newId(path: String): String = error("用不到")
        override suspend fun commit(writes: List<Write>) = error("用不到")

        override suspend fun listOpen(path: String): List<Doc> {
            asked += "open"
            return docs.filter { Notes.isOpen(it) }
        }

        override suspend fun listUpdatedSince(path: String, since: Ts): List<Doc> {
            asked += "since ${since.seconds}"
            return docs.filter { (it["updatedAt"] as? Ts)?.let { t -> NotesSync.later(t, since) == t && t != since } == true }
        }
    }

    @Test
    fun firstPullReadsTheOpenOnesAndTheCursorIsTheLatestUpdatedAt() = runBlocking {
        val cloud = Cloud(listOf(note("a", 100), note("b", 300), note("c", 500, mapOf("done" to true))))
        val s = NotesSync.pull(cloud, null)
        assertEquals(listOf("a", "b"), s.notes.map { it["id"] })
        assertEquals(Ts(300, 0), s.cursor)
        assertEquals(listOf("open"), cloud.asked)
    }

    @Test
    fun laterPullsOnlyAskWhatChangedAndDeletedOrTickedOnesAreRemoved() = runBlocking {
        val cloud = Cloud(listOf(note("a", 100), note("b", 300), note("x", 200)))
        var s = NotesSync.pull(cloud, null)
        cloud.docs = listOf(
            note("a", 400, mapOf("deletedAt" to Ts(400, 0))), // 刪掉
            note("b", 410, mapOf("done" to true, "doneAt" to "2026-11-06T06:30:00.000Z")), // 勾掉
            note("x", 420, mapOf("text" to "改過的字")), // 改字
            note("n", 430), // 別台新記的
        )
        s = NotesSync.pull(cloud, s)
        assertEquals(listOf("x", "n"), s.notes.map { it["id"] })
        assertEquals("改過的字", s.notes.first()["text"])
        assertEquals(Ts(430, 0), s.cursor)
        assertEquals(listOf("open", "since 300"), cloud.asked)
    }

    @Test
    fun takenBackOnesComeBack() = runBlocking {
        val cloud = Cloud(listOf(note("a", 100)))
        var s = NotesSync.pull(cloud, null)
        cloud.docs = listOf(note("a", 100), note("b", 200)) // b 在別台被拿回來（done → false）
        s = NotesSync.pull(cloud, s)
        assertEquals(listOf("a", "b"), s.notes.map { it["id"] })
    }

    @Test
    fun nothingChangedKeepsTheCursorAndTheList() = runBlocking {
        val cloud = Cloud(listOf(note("a", 100)))
        val first = NotesSync.pull(cloud, null)
        val again = NotesSync.pull(cloud, first)
        assertEquals(first, again)
        assertEquals(listOf("open", "since 100"), cloud.asked)
    }

    @Test
    fun pendingWritesDoNotMoveTheCursor() {
        // 還沒回到伺服器的那一筆 updatedAt 是 null；拿手機的時間推游標的話，別台剛寫的會被跳過
        assertEquals(Ts(100, 5), NotesSync.cursorOf(listOf(note("p", null), note("a", 100, mapOf("updatedAt" to Ts(100, 5)))), null))
        assertNull(NotesSync.cursorOf(listOf(note("p", null)), null))
    }

    @Test
    fun laterComparesNanosWithinTheSameSecond() {
        assertEquals(Ts(100, 7), NotesSync.later(Ts(100, 7), Ts(100, 5)))
        assertEquals(Ts(101, 0), NotesSync.later(Ts(100, 999_999_999), Ts(101, 0)))
    }
}
