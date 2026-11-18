plugins { kotlin("multiplatform"); id("com.android.application"); id("org.jetbrains.compose") }
kotlin { androidTarget(); iosArm64(); iosSimulatorArm64() }
android { namespace = "app.plantly"; defaultConfig { applicationId = "app.plantly"; minSdk = 26 } }
