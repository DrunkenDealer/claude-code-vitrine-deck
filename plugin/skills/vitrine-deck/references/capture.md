# Capturing the screenshots yourself

When the repo has no screenshots, build the app, run it on a headless simulator or emulator, stage
each screen into the state its slide claims, and capture. The developer gets a lived-in app without
populating an account by hand. Everything here runs on devices you start and remove yourself;
the developer's own simulators, emulators and source tree are never touched.

**Budget: about 10 minutes for both platforms.** A run that took 30 spent most of it on a
choked host — emulator and simulator up together right after two builds — and on one-screen-per-turn
round trips. §3–§6 are written against both.

## 1. Shot list first

The slide decides the screen, not the other way round. From the flow found in step 1
(entry → key action → result), write one line per slide before building anything:

```
01  result  "Habits that stick"  Today, 6 habits, 4 done, 47-day streak on "Morning run"
02  history "See every week"     Stats, 5 months filled, a few honest gaps
03  action  "Log it in a tap"    Today, "Read 20 pages" mid-check
```

Five to eight lines. Result screens beat input screens; onboarding, settings, login and empty
states are not on the list. Add one dark-mode line if the app has a dark theme. Keep the list —
it is the bar each capture is judged against.

## 2. What you can reach

```bash
xcrun simctl help >/dev/null 2>&1 && echo ios-ok
command -v adb emulator && emulator -list-avds
command -v maestro
```

| Repo | Reachable | Rows you can fill |
|---|---|---|
| iOS only | `ios-ok` | iOS rows |
| Android only | an AVD exists | Android rows |
| KMP / Flutter / React Native | both | all |
| KMP / Flutter / React Native | Android only | **Android rows only** — an Android capture in an iPhone frame shows Android's status and nav bars, which App Store review reads as another platform (2.3.10). Name the iOS rows as skipped: "install Xcode to add them". |
| any | nothing | ask the developer for PNGs, and say what was missing |

No AVD but the SDK is there: `avdmanager create avd -n vitrine-shots -k "<an installed system image>"`
— only with an image already in `sdkmanager --list_installed`; never download a system image unasked.

## 3. Build

Say in one line what you're building and that it takes a few minutes, then go. Build serially, and
stop the build daemons when done — they keep gigabytes and CPU the emulator needs:

```bash
./gradlew --stop   # its Kotlin daemon goes with it
```

| Stack | Android | iOS simulator |
|---|---|---|
| Native / KMP | `./gradlew :<app-module>:assembleDebug` | `xcodebuild -scheme <s> -sdk iphonesimulator -configuration Debug -derivedDataPath build/vitrine build` |
| Flutter | `flutter build apk --release` | `flutter build ios --simulator --debug` |
| React Native | `cd android && ./gradlew assembleRelease` | `xcodebuild … -configuration Release -sdk iphonesimulator` |
| Expo | `npx expo prebuild` then as React Native — only if `android/`/`ios/` are already committed; otherwise ask, since prebuild writes into the repo | |

- **Flutter's DEBUG ribbon and React Native's LogBox** land in every debug capture — hence the
  release builds (the templates sign them with the debug key). Flutter on the iOS simulator only
  runs debug: if the app doesn't set `debugShowCheckedModeBanner: false`, the ribbon is in the
  shot — report it, don't crop the UI.
- A release build isn't debuggable, so `run-as` (§5) is out; stage through the UI instead.
- A build that needs signing secrets, a `google-services.json` or an `.env` you don't have: stop and
  ask for that one thing.

## 4. Boot your own device, headless

**One platform at a time:** boot Android, capture its whole list, kill the emulator, then boot the
simulator. Both up at once — on a host still running XProtect over two fresh builds — drove the load
average past 100: System UI froze ("isn't responding"), every tap took a minute.

Before the first tap, one bounded wait for the host, not a turn-by-turn one:

```bash
for i in $(seq 1 12); do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$l" -lt "$(sysctl -n hw.ncpu)" ] && break; sleep 10; done
```

```bash
# Android — a fixed port so the serial is known to be yours; -read-only leaves the AVD unchanged
emulator -avd <avd> -port 5590 -no-window -no-audio -no-boot-anim -read-only -no-snapshot &
adb -s emulator-5590 wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done'
adb -s emulator-5590 install -r <apk>

# iOS — a new simulator, never one of theirs; pick the newest 6.3" iPhone from `simctl list devicetypes`
udid=$(xcrun simctl create vitrine-shots "<iPhone device type>" "<latest iOS runtime>")
xcrun simctl boot "$udid"
xcrun simctl spawn "$udid" defaults write -g AppleLocale en_US          # the status bar's clock follows the
xcrun simctl spawn "$udid" defaults write -g AppleLanguages -array en    # device locale, not launch args
xcrun simctl shutdown "$udid" && xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" >/dev/null
xcrun simctl install "$udid" <path>.app
```

A reused simulator — even one the repo's notes call the agent device — keeps its locale (a 24-hour
region draws "09:41") and the last run's app data. That is why a new one is the default.

Shell variables don't survive between Bash calls — write the UDID down and spell it out after.
An iPad or Android-tablet row needs its own device of that class; one device at a time.

**Make it look like a store capture, before the first shot:**

```bash
xcrun simctl status_bar "$udid" override --time "9:41" --batteryState discharging --batteryLevel 100 --cellularBars 4 --wifiBars 3 --dataNetwork wifi
xcrun simctl privacy "$udid" grant all <bundle-id>
xcrun simctl launch "$udid" <bundle-id> -AppleLanguages "(en)" -AppleLocale en_US

adb -s emulator-5590 shell settings put global sysui_demo_allowed 1
adb -s emulator-5590 shell am broadcast -a com.android.systemui.demo -e command enter
adb -s emulator-5590 shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
adb -s emulator-5590 shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb -s emulator-5590 shell am broadcast -a com.android.systemui.demo -e command network -e mobile hide
adb -s emulator-5590 shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true
adb -s emulator-5590 shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
adb -s emulator-5590 shell cmd locale set-app-locales <package> --locales en-US
adb -s emulator-5590 shell pm grant <package> android.permission.POST_NOTIFICATIONS   # and each runtime permission the manifest asks for
```

`charged` draws a bolt, and an ISO `--time` is rejected. Send each demo broadcast once: repeats stack
icons (two wifi glyphs) and a burst of them can hang System UI. Re-send only after System UI restarts.

Dark slide: `xcrun simctl ui "$udid" appearance dark` · `adb shell cmd uimode night yes`.

## 5. Stage the data

The screen has to look like someone has used the app for months. The realism bar — depth of history,
non-round numbers, plausible names, gaps, English-market currency and dates — is
`sources.md` §1; meet it here instead of asking the developer to. Dates are relative to today.

Use the cheapest source that works:

| Source | How |
|---|---|
| **Sample data the repo already has** | Compose `@Preview` parameters, SwiftUI `#Preview`, `PreviewProvider`, test fixtures, fake/mock repositories, `seed`/`demo` scripts, a debug menu or demo-mode flag. Someone already wrote believable content for exactly these screens — reuse its names and values. |
| **A launch argument or deep link the app reads** | `xcrun simctl launch "$udid" <id> -<arg>`, `adb shell am start -n <pkg>/<activity> --es <key> <value>`; links from `AndroidManifest.xml` intent filters, nav-graph `deepLink`s, `CFBundleURLTypes`. |
| **Drive the UI** | Enter the data the way a user would. Universal and goes through real code paths; fine for up to ~10 entries. |
| **Write the app's storage** (debug Android build, or the simulator) | Launch once so migrations create the schema, force-stop, pull the database, insert rows with `sqlite3`, push it back: `adb exec-out run-as <pkg> cat databases/<db> > app.db` … `adb push app.db /data/local/tmp/` then `adb shell run-as <pkg> cp /data/local/tmp/app.db databases/<db>`. iOS: `xcrun simctl get_app_container "$udid" <id> data`, or `… <id> groups` when the store lives in an App Group (KMP and widget apps usually do). Terminate the app first and delete the old `-wal`/`-shm` next to the file you replace, or SQLite replays the old journal over your seed. Plain Room/SQLDelight/GRDB/sqflite tables only — Core Data and SwiftData stores carry internal bookkeeping; drive the UI there. |
| **Change the source** | Last resort, and only after asking: a temporary debug seed, reverted after the capture. |

The device is yours and disposable, so writing its storage needs no permission. The developer's
repo is not.

**A login or a backend** you can't stand up locally: ask for a test account or how to point the app
at a local or mock server. Never sign in with an account that holds real people's data.

**Content rules** — the deck is public:
- Fictional people only; no names, faces, messages or contacts from anywhere real (2.3.9).
- No other company's logo or product name staged into the app.
- No lorem ipsum, "Test 1", "asdf", or data from the developer's own `.env`/fixtures that looks internal.

## 6. Navigate and capture

- **Deep link** where one exists: `xcrun simctl openurl "$udid" <uri>`, `adb shell am start -W -a android.intent.action.VIEW -d <uri> <pkg>`.
- **Maestro**, if installed, drives both platforms from one YAML flow (`launchApp`, `tapOn`,
  `inputText`, `takeScreenshot`) — write flows to scratch, not the repo.
- **Without it, Android:** `adb shell uiautomator dump /sdcard/ui.xml && adb exec-out cat /sdcard/ui.xml`,
  tap a node's bounds centre with `adb shell input tap x y`, type with `adb shell input text`.
- **Without it, iOS:** `simctl` cannot tap; `idb ui tap x y` can, if installed. Otherwise deep links
  and launch arguments only; a screen that needs a tap to reach is reported as unreached, with
  "install Maestro" as the fix.
- **Tap by the whole label, never a substring.** A text-match "Dismiss" hit "Dismiss this pattern"
  and deleted demo data mid-tour. Match the exact label, or tap the node's bounds.

**Tour in one call per platform.** Write the whole shot list as one script — navigate, settle,
capture, next — then tile every capture into one contact sheet and Read that once. Re-shoot only
what fails §7. A screen per turn costs a model round trip each; twenty of them are minutes.

```bash
adb -s emulator-5590 exec-out screencap -p > shots/01-today.png
xcrun simctl io "$udid" screenshot shots/01-today.png
```

Name files `NN-slug` in slide order, into `shots/` next to where `deck.json` will be.

## 7. Read every capture, against its line

Open each PNG with Read. Re-stage and re-shoot when it shows:

- an empty state, a loading spinner or skeleton, a toast, a snackbar, or a keyboard nobody meant;
- onboarding, a login, a splash, a permission or rating dialog;
- a DEBUG ribbon, LogBox, a dev menu or a debug overlay;
- anything that doesn't prove its line in the shot list.

- a list scrolled past its header, so the first card is cut at the top.

Three tries per screen, then drop it and say which slide and why. A device that hangs (System UI
"isn't responding", taps timing out) gets one cold restart — kill it, boot with `-no-snapshot` — not
a wait and retry every turn.

## 8. Clean up

```bash
adb -s emulator-5590 emu kill
xcrun simctl shutdown "$udid" && xcrun simctl delete "$udid"
```

Only what you started. Revert any source change you were allowed to make. Leave `shots/` — it is
the deck's input.
