import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
}

// release 簽章：本機讀 ~/.gradle/gradle.properties（鑰匙在 ~/.android），CI 讀 GitHub Secrets 給的環境變數。
// 兩邊都沒有 → release 不簽（debug 照常建）。**鑰匙與密碼不進 repo、不印進 log**（ADR-0180）
fun secret(prop: String, env: String): String? =
    (findProperty(prop) as String?)?.takeIf { it.isNotBlank() } ?: System.getenv(env)?.takeIf { it.isNotBlank() }

val releaseStore = secret("baofuNotesStoreFile", "BAOFU_NOTES_STORE_FILE")

android {
    namespace = "tw.baofu.notes"
    // 2026 的 AndroidX／Compose 要編 37 以上；targetSdk（執行時的行為）照舊 36
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "tw.baofu.notes"
        minSdk = 26
        targetSdk = 36
        // **每派送一版（App Distribution）versionCode 加一**：手機照它判斷是不是新版，同一個號碼裝不上去（docs/STAGING.md「桌面小工具」）
        versionCode = 2
        versionName = "0.1.1"
    }

    signingConfigs {
        if (releaseStore != null) {
            create("release") {
                storeFile = file(releaseStore)
                storePassword = secret("baofuNotesStorePassword", "BAOFU_NOTES_STORE_PASSWORD")
                keyAlias = secret("baofuNotesKeyAlias", "BAOFU_NOTES_KEY_ALIAS")
                keyPassword = secret("baofuNotesKeyPassword", "BAOFU_NOTES_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            // `-Pemulator`：寫本機模擬器（demo-scheduler，跟網頁的 E2E 同一個命名空間），HTC 用 `adb reverse` 接過來。
            // 開發時寫這裡、不寫 staging（CLAUDE.md「會寫入的驗收在本機模擬器走」）
            buildConfigField("boolean", "USE_EMULATOR", if (project.hasProperty("emulator")) "true" else "false")
        }
        release {
            buildConfigField("boolean", "USE_EMULATOR", "false")
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    // 兩個版本可以同時裝：測試版接 staging（HTC）、正式版接正式站（三星）。套件名與 Firebase 登記的一樣
    flavorDimensions += "site"
    productFlavors {
        create("staging") {
            dimension = "site"
            applicationIdSuffix = ".staging"
            buildConfigField("String", "WEB_ORIGIN", "\"https://wellness-clinic-staging.web.app\"")
        }
        create("prod") {
            dimension = "site"
            buildConfigField("String", "WEB_ORIGIN", "\"https://wellness-clinic-scheduler.web.app\"")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.credentials)
    implementation(libs.credentials.play)
    implementation(libs.googleid)
    implementation(libs.coroutines.play)
    implementation(libs.glance.appwidget)
    implementation(libs.work.runtime)
}
