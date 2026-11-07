import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// 隨手記的規則：純 Kotlin、不認得 Android 也不認得 Firestore SDK（寫入走 NoteStore 這一層介面）。
// 單元測試讀網頁那一側同一份情境檔 —— 網頁的規則改了、情境檔跟著改，這裡就紅（ADR-0180）。
plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(libs.coroutines.core)
    testImplementation(libs.junit)
    testImplementation(libs.serialization.json)
    // 名字照 zh-Hant 排（網頁是 V8 的 ICU）。app 那一側用 android.icu，這裡只給測試
    testImplementation(libs.icu4j)
}

val parityFile = rootProject.layout.projectDirectory.file("../tests/fixtures/notes-parity.json")

tasks.test {
    inputs.file(parityFile).withPropertyName("parity")
    systemProperty("notes.parity", parityFile.asFile.absolutePath)
}
