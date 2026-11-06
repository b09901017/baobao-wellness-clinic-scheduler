package tw.baofu.notes.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import tw.baofu.notes.AppScope
import tw.baofu.notes.Backend
import tw.baofu.notes.NoteTaps
import tw.baofu.notes.SignIn
import tw.baofu.notes.core.Dates
import tw.baofu.notes.core.Doc
import tw.baofu.notes.core.Notes
import tw.baofu.notes.core.NotesSync
import tw.baofu.notes.core.NotesWriter
import java.util.concurrent.TimeUnit

/**
 * 小工具什麼時候跟雲端對（她 11/6「好照建議做」，HANDOFF「她已經決定的」）：
 *
 * - **在小工具上自己寫的存完馬上換**（[afterLocalWrite]：讀這台手機的快取 —— 自己剛寫的已經在裡面，不等網路）
 * - **按 ＋ 打開輸入卡時抓一次**（[pull]）
 * - **背景 WorkManager 最短 15 分鐘**（[PullWorker]）：只問游標之後改過的（core 的 [NotesSync.pull]，刪掉、勾掉的也問得到），
 *   沒變是 1 次讀取；要網路、**不加會叫醒手機的條件**（不用 expedited、不用鬧鐘），手機睡著讓系統延後
 *
 * 寫入一律走 core 的 `NotesWriter`（`Backend.notes`），同一個 commit 帶稽核 —— 這裡只管「手上那一份」。
 * 寫入排隊（[writes]）：劃線那 3 秒裡再點一下拿回來，不會跟勾掉那一筆交錯。
 */
object WidgetSync {
    private const val PERIODIC = "notes-widget-pull"
    private val writes = Mutex()

    /** 這台手機登入的、通過白名單的那一位（沒有就是 null —— 小工具講一句、不讀）。 */
    fun allowedUid(context: Context): String? =
        if (SignIn.rememberedAllowed(context)) Backend.auth.currentUser?.uid else null

    suspend fun push(context: Context) {
        NotesWidget().updateAll(context)
    }

    /** 手上那一份是這一位的才算（換帳號、登出 → 從頭讀）。 */
    private fun mine(context: Context, uid: String): WidgetStore.View? =
        WidgetStore.current(context)?.takeIf { it.uid == uid }

    /** 改手上那一份（是這一位的才改；沒有就從空的開始）。 */
    private fun change(context: Context, uid: String, transform: (WidgetStore.View) -> WidgetStore.View) {
        WidgetStore.update(context) { v -> transform(v?.takeIf { it.uid == uid } ?: WidgetStore.View(uid)) }
    }

    /**
     * 跟雲端對一次（沒有手上那一份就整份讀）。讀不到、或讀到的是這台手機的快取 → 不算同步成功：清單照舊、講一句「讀不到最新的」（REVIEW-android R2）。
     * **讀回來的套在現在那一份上**（在 [WidgetStore.update] 那把鎖裡，core 的 [NotesSync.apply]）：等網路的那段時間裡自己記的、勾掉的
     * 已經換進清單了，拿讀之前那一份算的結果整份蓋上去，剛記的那一筆會從小工具上消失（REVIEW-android R3）。
     */
    suspend fun pull(context: Context, full: Boolean = false) {
        val uid = allowedUid(context) ?: return signedOut(context)
        val before = mine(context, uid)
        try {
            val pulled = NotesSync.fetch(Backend.store, if (full) null else before?.sync)
            change(context, uid) { cur ->
                val next = NotesSync.apply(cur.sync, pulled)
                cur.copy(
                    notes = next.notes,
                    cursor = next.cursor,
                    syncedAt = if (pulled.fresh) System.currentTimeMillis() else cur.syncedAt,
                    stale = !pulled.fresh,
                    // 整份讀到快取也畫（第一次就沒網路時不畫「沒有還沒做的事」，底下那一行講讀不到最新的）
                    loaded = cur.loaded || pulled.full || pulled.fresh,
                )
            }
        } catch (e: Exception) {
            change(context, uid) { it.copy(stale = true) }
        }
        push(context)
    }

    /** 自己剛寫完：從快取換掉清單（游標照舊 —— 下一次背景同步照樣問得到別台改的）。 */
    suspend fun afterLocalWrite(context: Context) {
        val uid = allowedUid(context) ?: return
        val cached = runCatching { Backend.store.listOpenCached(NotesWriter.PATH) }.getOrNull()
        if (cached != null) change(context, uid) { it.copy(notes = cached, loaded = true) }
        push(context)
    }

    /**
     * 輸入卡、選單上的一次寫入：跟勾選排同一個隊（不交錯）、寫完馬上換清單。
     * 寫入本身走 core 的 `NotesWriter`（`block` 裡叫 `Backend.notes.…`）。
     */
    suspend fun <T> localWrite(context: Context, block: suspend () -> T): T {
        val result = writes.withLock { block() }
        afterLocalWrite(context)
        return result
    }

    private suspend fun signedOut(context: Context) {
        if (WidgetStore.current(context) != null) WidgetStore.write(context, null)
        push(context)
    }

    /** 登出、換帳號：丟掉手上那一份。 */
    suspend fun forget(context: Context) = signedOut(context)

    // ---------- 勾掉（劃線 3 秒後才離開，3 秒內再點一下回來） ----------

    /**
     * 點一列的勾選框。連在一起的整組一起（`NotesWriter.setDone()` 自己重讀那一組）。
     *
     * - **畫面先換**（劃線），寫入與那 3 秒在 [AppScope] 跑：Glance 一個小工具的點擊是一個一個處理的，
     *   在這裡等的話，3 秒內那一下「拿回來」要等到劃線結束才輪到它（HTC 上量到的）
     * - **先寫、再等**：3 秒是給她反悔的，不是延後寫。拿回來是另一次寫入（稽核上是「勾掉」又「拿回來」）；
     *   兩次寫入排同一個隊（[writes]，先來先寫），拿回來一定寫在勾掉後面
     */
    fun tick(context: Context, id: String) {
        val uid = allowedUid(context) ?: return
        val view = mine(context, uid) ?: return
        if (view.ticking.containsKey(id)) {
            change(context, uid) { it.copy(ticking = it.ticking - id) }
            AppScope.launch {
                push(context)
                val ok = writes.withLock { runCatching { Backend.notes.setDone(id, false) }.isSuccess }
                if (!ok) change(context, uid) { it.copy(stale = true) }
                afterLocalWrite(context)
            }
            return
        }
        val row = Notes.groupLinked(view.notes, Dates.todayIso()).firstOrNull { it.note["id"] == id } ?: return
        // 營養品的提醒不在這裡勾（畫面上那一格打開網頁問「給了哪幾款」，`NoteTaps`）—— 萬一走到這裡也不寫
        if (NoteTaps.asksWhatWasGiven(row.note)) return
        val until = System.currentTimeMillis() + WidgetStore.LINGER_MS
        change(context, uid) { it.copy(ticking = it.ticking + (id to WidgetStore.Ticking(until, row.members))) }
        AppScope.launch {
            push(context)
            val ok = writes.withLock { runCatching { Backend.notes.setDone(id, true) }.isSuccess }
            if (!ok) {
                // 勾不掉：劃線拿掉、講一句（清單照舊）
                change(context, uid) { it.copy(ticking = it.ticking - id, stale = true) }
                push(context)
                return@launch
            }
            delay((until - System.currentTimeMillis()).coerceAtLeast(0))
            settle(context)
        }
    }

    /** 劃線時間到了的那幾列離開清單。 */
    suspend fun settle(context: Context) {
        val uid = allowedUid(context) ?: return
        val now = System.currentTimeMillis()
        if (mine(context, uid)?.ticking?.values?.none { it.until <= now } != false) return
        change(context, uid) { v -> v.copy(ticking = v.ticking.filterValues { it.until > now }) }
        afterLocalWrite(context)
    }

    /**
     * 畫面要畫的那一份：手上的＋還在劃線的那幾列（照原本的樣子放回去，才排得回原位）。
     * 劃線的時間過了很久還在（程式在那 3 秒被收掉），就當它離開了。
     */
    fun shown(view: WidgetStore.View, now: Long = System.currentTimeMillis()): Pair<List<Doc>, Set<String>> {
        val live = view.ticking.filterValues { it.until > now - 60_000 }
        val ids = view.notes.mapTo(HashSet()) { it["id"] as String? }
        val extra = live.values.flatMap { t -> t.members.filter { it["id"] !in ids } }
        return (view.notes + extra) to live.keys
    }

    // ---------- 背景 ----------

    /** 有小工具在桌面上就排著（已經排了就不動）。 */
    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<PullWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun unschedule(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
    }

    class PullWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            pull(applicationContext)
            return Result.success()
        }
    }
}
