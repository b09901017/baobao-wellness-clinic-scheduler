package tw.baofu.notes.core

import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** 網頁 `domain/dates.js` 照抄的那幾支。 */
object Dates {
    private val ISO_DATE = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
    private val WEEKDAYS = listOf("日", "一", "二", "三", "四", "五", "六")

    /** `isValidDate()`：`YYYY-MM-DD` 而且那一天存在。 */
    fun isValidDate(iso: Any?): Boolean {
        if (iso !is String || !ISO_DATE.matches(iso)) return false
        val (y, m, d) = iso.split('-').map { it.toInt() }
        if (m < 1 || m > 12 || d < 1) return false
        return d <= lastDayOf(y, m)
    }

    /** JS 的 `Date.UTC(y, m, 0)`：0～99 年當成 1900 年起算（照抄，不然 0000-02-29 兩邊答案不一樣）。 */
    private fun lastDayOf(year: Int, month: Int): Int =
        YearMonth.of(if (year in 0..99) year + 1900 else year, month).lengthOfMonth()

    /** `shortDate()`：'11/9(一)'。 */
    fun shortDate(iso: String): String {
        val (y, m, d) = iso.split('-').map { it.toInt() }
        val weekday = LocalDate.of(y, m, d).dayOfWeek.value % 7 // 星期日 7 → 0
        return "$m/$d(${WEEKDAYS[weekday]})"
    }

    private val ISO_INSTANT: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /**
     * JS 的 `new Date().toISOString()`：**一定三位毫秒＋`Z`**。`Instant.toString()` 在整秒時會把 `.000` 拿掉 ——
     * `doneAt` 是拿字串比的（`sortNotes()`），少三個字就排錯。
     */
    fun isoInstant(epochMillis: Long): String = ISO_INSTANT.format(Instant.ofEpochMilli(epochMillis))

    /** `todayISO()`：這台手機的本地日期（跟網頁一樣用裝置的時區，不是 UTC）。 */
    fun todayIso(): String = LocalDate.now().toString()
}
