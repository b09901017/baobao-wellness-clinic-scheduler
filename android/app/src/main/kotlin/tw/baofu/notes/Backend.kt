package tw.baofu.notes

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.firestoreSettings
import com.google.firebase.firestore.persistentCacheSettings
import tw.baofu.notes.core.NotesWriter

/**
 * 接哪一個 Firebase。
 *
 * - 一般：google-services.json 那一個（測試版＝staging、正式版＝正式站），跟網頁 app 同一個專案、同一個帳號＝同一個 uid
 * - `-Pemulator` 建的 debug：本機模擬器的 `demo-scheduler`（網頁 `firebase-config.js` 的 `projectIdFor(0)`）——
 *   `demo-` 開頭的專案碰不到任何真的服務；HTC 用 `adb reverse` 把 8080／9099 接到筆電
 *
 * **開本機快取**：沒網路照記，連上補傳（spec「沒網路也記得下來」）。
 */
object Backend {
    private const val EMULATOR_PROJECT = "demo-scheduler"
    private const val EMULATOR_HOST = "127.0.0.1"

    lateinit var app: FirebaseApp
        private set

    val auth: FirebaseAuth get() = FirebaseAuth.getInstance(app)
    val db: FirebaseFirestore get() = FirebaseFirestore.getInstance(app)

    val usesEmulator: Boolean get() = BuildConfig.USE_EMULATOR

    /** 隨手記的寫入（core 的 `NotesWriter`，網頁 `data/notes.js` 的照抄）。稽核記的「誰」是登入的 uid。 */
    val store: FirestoreNoteStore by lazy { FirestoreNoteStore(db) }
    val notes: NotesWriter by lazy { NotesWriter(store, actor = { auth.currentUser?.uid ?: "unknown" }) }

    fun init(context: Context) {
        app = if (BuildConfig.USE_EMULATOR) {
            FirebaseApp.getApps(context).firstOrNull { it.name == "emulator" } ?: FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setProjectId(EMULATOR_PROJECT)
                    .setApplicationId("1:1:android:1")
                    .setApiKey("demo-api-key")
                    .build(),
                "emulator",
            )
        } else {
            FirebaseApp.getInstance()
        }
        db.firestoreSettings = firestoreSettings { setLocalCacheSettings(persistentCacheSettings {}) }
        if (BuildConfig.USE_EMULATOR) {
            auth.useEmulator(EMULATOR_HOST, 9099)
            db.useEmulator(EMULATOR_HOST, 8080)
        }
    }
}
