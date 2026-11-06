package tw.baofu.notes.core

/**
 * 網頁那一份是 JavaScript：這裡把幾個 JS 的行為照抄成 Kotlin，**不要換成 Kotlin 自己的版本**。
 *
 * - `trim()`／正規表示式的 `\s`：ECMAScript 的 WhiteSpace ＋ LineTerminator。Kotlin 的 `trim()` 多收 U+001C–U+001F、
 *   少收 U+FEFF（BOM），貼上來的字就會一邊算空白一邊不算
 * - `String(v ?? '')`：排序拿它比字串，Firestore 的 Timestamp 在 JS 裡是 `Timestamp(seconds=…, nanoseconds=…)`
 * - 真假值（truthy）：`''`、`0`、`null`、`false` 都算沒有
 *
 * 情境檔 `tests/fixtures/notes-parity.json` 的 `normalize`、`normalizeAlias` 那幾題（全形空白、BOM、U+001F…）盯著。
 */
object Js {
    /** ECMAScript 的 WhiteSpace（含 Zs 全部）＋ LineTerminator。 */
    fun isSpace(c: Char): Boolean = when (c) {
        '\u0009', '\u000B', '\u000C', ' ', '\u00A0', '\uFEFF',
        '\u000A', '\u000D', '\u2028', '\u2029',
        '\u1680', '\u202F', '\u205F', '\u3000',
        -> true
        in '\u2000'..'\u200A' -> true
        else -> false
    }

    fun trim(s: String): String = s.trim { isSpace(it) }

    /** `s.replace(/\s+/g, '')` */
    fun removeSpaces(s: String): String = s.filterNot { isSpace(it) }

    /** `String(v ?? '')` */
    fun str(v: Any?): String = when (v) {
        null -> ""
        is String -> v
        is Ts -> "Timestamp(seconds=${v.seconds}, nanoseconds=${v.nanos})"
        is Double -> if (v == Math.floor(v) && !v.isInfinite() && Math.abs(v) < 1e21) v.toLong().toString() else v.toString()
        else -> v.toString()
    }

    /** `trimmed = (v) => String(v ?? '').trim()`：網頁 domain 檔頭那一支。 */
    fun trimmed(v: Any?): String = trim(str(v))

    /** JS 的真假值。 */
    fun truthy(v: Any?): Boolean = when (v) {
        null -> false
        is Boolean -> v
        is String -> v.isNotEmpty()
        is Long -> v != 0L
        is Int -> v != 0
        is Double -> v != 0.0 && !v.isNaN()
        else -> true
    }

    /** `a ?? b`：只有 null 才換。 */
    fun <T> nullish(a: T?, b: T?): T? = a ?: b
}

/** Firestore 的時間（伺服器寫的 `createdAt`、`updatedAt`、`deletedAt`）。app 那一層跟 `com.google.firebase.Timestamp` 互換。 */
data class Ts(val seconds: Long, val nanos: Int)

/** 寫進去時換成伺服器時間（`serverTimestamp()`）。 */
object ServerTimestamp {
    override fun toString() = "\$server"
}

/** 一筆文件：跟網頁一樣是 `{ id, ...data }` 的形狀，值是 String、Boolean、Long、Double、null、List、Map、[Ts]。 */
typealias Doc = Map<String, Any?>

internal fun Doc.str(key: String): String = Js.str(this[key])
internal fun Doc.trimmed(key: String): String = Js.trimmed(this[key])
internal fun Doc.truthy(key: String): Boolean = Js.truthy(this[key])
internal val Doc.id: String? get() = this["id"] as String?
