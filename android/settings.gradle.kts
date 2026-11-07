// 隨手記（Android 桌面小工具）。為什麼另寫一支原生 app：docs/adr/0180-notes-widget-is-a-native-android-app.md
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "baofu-notes"

// core：隨手記的規則（純 Kotlin，照抄網頁的 domain/notes.js 那幾支），單元測試讀 tests/fixtures/notes-parity.json
include(":core")
// app：登入、Firestore、畫面（小工具與輸入卡在段六）
include(":app")
