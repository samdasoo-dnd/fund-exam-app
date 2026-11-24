plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ── 고정 서명 키 설정 ─────────────────────────────────────────────
// ANDROID_KEYSTORE_PATH 가 실제 파일로 존재할 때만 고정 키 서명을 씁니다.
// (GitHub Actions 에서는 Secret ANDROID_KEYSTORE_BASE64 를 디코딩해 이 경로를 지정합니다.)
// 환경변수가 없으면 디버그 서명으로 폴백합니다.
val releaseKeystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")
val hasReleaseKeystore: Boolean =
    !releaseKeystorePath.isNullOrBlank() && project.file(releaseKeystorePath).exists()

android {
    namespace = "com.donsik.fundexam"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.donsik.fundexam"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.1"

        // 다크 네이비 로딩 화면 / 재시도 화면에 쓸 주소를 한 곳에서 관리
        resValue("string", "app_url", "https://fund-exam-app.onrender.com")
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("fundRelease") {
                storeFile = project.file(releaseKeystorePath!!)
                storeType = "PKCS12"
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "badatoeic"
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                    ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isDebuggable = true
            // 고정 키가 준비돼 있으면 디버그 빌드도 같은 키로 서명합니다.
            if (hasReleaseKeystore) {
                signingConfig = signingConfigs.getByName("fundRelease")
            }
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("fundRelease")
            } else {
                // 키가 없을 때만 예전 방식(디버그 키)으로 폴백합니다.
                runCatching { signingConfigs.getByName("debug") }.getOrNull()
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "DebugProbesKt.bin")
    }
}

dependencies {
    // 외부 라이브러리 없이 플랫폼 WebView API 만 사용합니다(빌드 실패 요인 최소화).
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.24")
}
