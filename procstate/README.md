# ProcState Monitor

Android process state timeline monitor. Captures LRU process state via `dumpsys activity lru`, shows stacked bar charts by state and dot timelines by process. Detects process restarts, frozen processes, and supports background recording with configurable intervals.

## Install

Download the APK: **[procstate-debug.apk](release/procstate-debug.apk)**

```bash
adb install procstate-debug.apk
```

## Grant permissions

These are development-only permissions that can't be requested at runtime — they must be granted via ADB. `DUMP` is required to run `dumpsys activity lru` which provides the process state list. `PACKAGE_USAGE_STATS` enables frozen process detection.

```bash
adb shell pm grant com.procstate.monitor android.permission.DUMP
adb shell pm grant com.procstate.monitor android.permission.PACKAGE_USAGE_STATS
```

## Use

- **Pull down** to capture a snapshot
- **Record** button (top bar) to capture continuously at 1s-15m intervals
- **By State** tab: stacked bars per snapshot, tap to expand breakdown
- **By Process** tab: pin processes to see dot timeline across states
- Tap any dot for full details (state, PID, UID, frozen status, state history)
