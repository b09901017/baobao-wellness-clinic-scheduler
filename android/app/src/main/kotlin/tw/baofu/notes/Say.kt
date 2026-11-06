package tw.baofu.notes

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.firestore.FirebaseFirestoreException

/**
 * 寫入的等待與失敗那幾句**只寫在這裡**（REVIEW-android R6；網頁那一份是 `ui/toast.js`，`CLAUDE.md`「寫入的等待與失敗文案」）：
 * 主畫面、輸入卡、選單、登入都讀這一支。
 *
 * - **等待那一句不可以說失敗**：寫進這台手機的快取是馬上的，連上網路 SDK 會自己補傳 —— 說失敗她會再記一次
 * - 失敗那一句不把 SDK 的英文原樣給她看：認得的講白話，認不得的才印原文
 */
object Say {
    /** 寫進手機、還沒回到伺服器（`FirestoreNoteStore.pending`）。 */
    const val PENDING = "存在這台手機上了，連上網路會補傳"

    /** 寫完要講的那一句：還沒回到伺服器就講 [PENDING]，不然是 [success]（null＝不講，例如小工具上已經看得到）。 */
    fun saved(success: String?): String? = if (Backend.store.pending) PENDING else success

    /** 「[what]：為什麼」。 */
    fun failed(what: String, e: Throwable): String = "$what：${why(e)}"

    fun why(e: Throwable): String = when {
        e is FirebaseFirestoreException && e.code == FirebaseFirestoreException.Code.PERMISSION_DENIED ->
            "這個帳號沒有權限（打開「隨手記」重新登入）"
        e is FirebaseFirestoreException && e.code == FirebaseFirestoreException.Code.UNAVAILABLE -> "連不上，等一下再試"
        e is FirebaseNetworkException -> "連不上網路，等一下再試"
        else -> e.message ?: e::class.simpleName ?: "原因不明"
    }
}
