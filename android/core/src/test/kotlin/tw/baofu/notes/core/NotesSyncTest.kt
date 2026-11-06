package tw.baofu.notes.core

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

        override suspend fun listOpen(path: String): Listing {
            asked += "open"
            return Listing(openOf(docs))
        }

        override suspend fun listUpdatedSince(path: String, since: Ts): Listing {
            asked += "since ${since.seconds}"
            return Listing(changedSince(docs, since))
        }
    }

    /**
     * 照 SDK 預設來源（`Source.DEFAULT`）的行為：連得上問伺服器、**連不上回這台手機的快取、不丟錯**（`fromCache` 是 true）。
     * 快取只有這台手機看過的那幾筆（自己寫的、選單打開時讀的）—— REVIEW-android R2。
     */
    private class Sdk(var server: List<Doc>, var cache: List<Doc>, var online: Boolean) : NoteStore {
        override suspend fun read(path: String, id: String): Doc? = error("用不到")
        override suspend fun listWhere(path: String, field: String, value: String): List<Doc> = error("用不到")
        override fun newId(path: String): String = error("用不到")
        override suspend fun commit(writes: List<Write>) = error("用不到")

        override suspend fun listOpen(path: String): Listing = Listing(openOf(if (online) server else cache), fromCache = !online)

        override suspend fun listUpdatedSince(path: String, since: Ts): Listing =
            Listing(changedSince(if (online) server else cache, since), fromCache = !online)
    }

    private companion object {
        fun openOf(docs: List<Doc>) = docs.filter { Notes.isOpen(it) }
        fun changedSince(docs: List<Doc>, since: Ts) =
            docs.filter { (it["updatedAt"] as? Ts)?.let { t -> NotesSync.later(t, since) == t && t != since } == true }
    }

    private val done = mapOf("done" to true, "doneAt" to "2026-11-06T06:30:00.000Z")

    @Test
    fun anOfflinePullFromTheCacheMustNotSkipChangesMadeElsewhere() = runBlocking {
        // 10:00 有網路同步過；iPad 勾掉 x（200）；小工具勾掉 y（300，這台手機的快取裡有）；
        // 沒網路時按 ＋（讀到快取）；連上之後再同步 —— x 一定要離開（REVIEW-android R2 的五步）
        val sdk = Sdk(listOf(note("a", 100), note("x", 100), note("y", 100)), listOf(note("a", 100), note("x", 100), note("y", 100)), online = true)
        var s = NotesSync.pull(sdk, null)
        sdk.server = listOf(note("a", 100), note("x", 200, done), note("y", 300, done))
        sdk.cache = listOf(note("a", 100), note("x", 100), note("y", 300, done))
        sdk.online = false
        s = NotesSync.pull(sdk, s)
        sdk.online = true
        s = NotesSync.pull(sdk, s)
        assertEquals(listOf("a"), s.notes.map { it["id"] })
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

    @Test
    fun theFirstPullWithoutNetworkShowsTheCacheButReadsEverythingAgainLater() = runBlocking {
        // 第一次就沒網路：先畫快取裡的（不畫「沒有還沒做的事」），但不算同步過 —— 游標留空、連上之後整份讀
        val sdk = Sdk(listOf(note("a", 100), note("b", 200)), listOf(note("a", 100)), online = false)
        val first = NotesSync.fetch(sdk, null)
        assertFalse(first.fresh)
        var s = NotesSync.apply(NotesSync.State(emptyList(), null), first)
        assertEquals(listOf("a"), s.notes.map { it["id"] })
        assertNull(s.cursor)
        sdk.online = true
        s = NotesSync.pull(sdk, s)
        assertEquals(listOf("a", "b"), s.notes.map { it["id"] })
        assertEquals(Ts(200, 0), s.cursor)
    }

    @Test
    fun aNoteWrittenHereWhileThePullWasWaitingStaysOnTheList() = runBlocking {
        // REVIEW-android R3：點 ＋ 開始同步 → 網路慢 → 她記下一筆（本機那一份 updatedAt 還是 null）→ 同步回來
        val cloud = Cloud(listOf(note("a", 100)))
        val before = NotesSync.pull(cloud, null)
        cloud.docs = listOf(note("a", 100), note("n", 200)) // 別台新記的
        val pulled = NotesSync.fetch(cloud, before)
        val current = before.copy(notes = before.notes + note("mine", null)) // 等網路時換進來的
        val after = NotesSync.apply(current, pulled)
        assertEquals(listOf("a", "mine", "n"), after.notes.map { it["id"] })
        assertEquals(Ts(200, 0), after.cursor)
    }

    @Test
    fun aFullReadKeepsNotesThatHaveNotReachedTheServerYet() = runBlocking {
        // 整份讀（登入那一次）回來時，本機剛記、還沒送到伺服器的那一筆不在讀回來的裡面 —— 留著
        val cloud = Cloud(listOf(note("a", 100)))
        val pulled = NotesSync.fetch(cloud, null)
        val current = NotesSync.State(listOf(note("mine", null), note("old", 50)), null)
        val after = NotesSync.apply(current, pulled)
        assertEquals(listOf("a", "mine"), after.notes.map { it["id"] })
    }

    @Test
    fun aPullFromTheCacheLeavesTheCurrentListAlone() = runBlocking {
        val sdk = Sdk(listOf(note("a", 100)), listOf(note("a", 100)), online = true)
        val s = NotesSync.pull(sdk, null)
        sdk.online = false
        sdk.cache = listOf(note("a", 300, done))
        val pulled = NotesSync.fetch(sdk, s)
        assertFalse(pulled.fresh)
        val current = s.copy(notes = s.notes + note("mine", null))
        assertEquals(current, NotesSync.apply(current, pulled))
    }
}
