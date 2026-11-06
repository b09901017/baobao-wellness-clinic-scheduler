package tw.baofu.notes

import android.app.Activity
import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await

/**
 * 登入：同一個 Google 帳號、同一個 Firebase 專案＝跟網頁 app 同一個 uid，白名單不用改（spec「登入」）。
 *
 * 登入之後問一次白名單（`allowedUsers/{uid}`，Rules 准她讀自己那一筆）：**不在上面就登出、講一句、一筆都不寫**。
 * 就算這裡漏了，Rules 照樣擋所有讀寫（`allowed()`）—— 這一步是讓她看到一句話，不是唯一的防線。
 * 問過了的 uid 記在這台手機（小工具沒網路時照樣知道是誰）。
 */
object SignIn {
    sealed interface Outcome {
        data object Allowed : Outcome
        data class NotAllowed(val email: String?) : Outcome
        data object Cancelled : Outcome
        data class Failed(val message: String) : Outcome
    }

    private const val PREFS = "signin"
    private const val ALLOWED_UID = "allowedUid"

    /** 這台手機記著通過白名單的那一位（登入的就是他才算）。 */
    fun rememberedAllowed(context: Context): Boolean {
        val uid = Backend.auth.currentUser?.uid ?: return false
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(ALLOWED_UID, null) == uid
    }

    suspend fun withGoogle(activity: Activity): Outcome {
        val option = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(activity.getString(R.string.default_web_client_id))
            .setAutoSelectEnabled(false)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val credential = try {
            CredentialManager.create(activity).getCredential(activity, request).credential
        } catch (e: GetCredentialCancellationException) {
            return Outcome.Cancelled
        } catch (e: NoCredentialException) {
            return Outcome.Failed("這支手機上沒有可以用的 Google 帳號")
        } catch (e: Exception) {
            return Outcome.Failed("登入沒有成功：${e.message ?: e::class.simpleName}")
        }
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            return Outcome.Failed("登入沒有成功：拿到的不是 Google 帳號")
        }
        val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
        return finish(activity) { Backend.auth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await() }
    }

    /**
     * 只有 `-Pemulator` 建的那一支：用模擬器認得的假帳號登入（模擬器收沒有簽章的 JSON 當 ID token）。
     * 白名單照樣要有 —— 開發時用 REST 替這個 uid 加（HANDOFF「接 HTC 的路」）。
     */
    suspend fun withEmulatorTestAccount(context: Context): Outcome {
        check(Backend.usesEmulator) { "只有接模擬器的那一支才有測試帳號" }
        val fake = """{"sub":"notes-widget-dev","email":"notes-widget-dev@example.com","email_verified":true}"""
        return finish(context) { Backend.auth.signInWithCredential(GoogleAuthProvider.getCredential(fake, null)).await() }
    }

    private suspend fun finish(context: Context, signIn: suspend () -> Unit): Outcome {
        try {
            signIn()
        } catch (e: Exception) {
            return Outcome.Failed("登入沒有成功：${e.message ?: e::class.simpleName}")
        }
        return checkAllowed(context)
    }

    /** 問白名單。不在上面就登出。 */
    suspend fun checkAllowed(context: Context): Outcome {
        val user = Backend.auth.currentUser ?: return Outcome.Failed("還沒登入")
        val allowed = try {
            Backend.db.collection("allowedUsers").document(user.uid).get().await().exists()
        } catch (e: Exception) {
            return Outcome.Failed("問不到白名單（網路？）：${e.message ?: e::class.simpleName}")
        }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!allowed) {
            prefs.edit().remove(ALLOWED_UID).apply()
            signOut(context)
            return Outcome.NotAllowed(user.email)
        }
        prefs.edit().putString(ALLOWED_UID, user.uid).apply()
        return Outcome.Allowed
    }

    suspend fun signOut(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(ALLOWED_UID).apply()
        Backend.auth.signOut()
        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
    }
}
