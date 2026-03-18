# ProcState Monitor

Android process state timeline monitor. Captures LRU process state via `dumpsys activity lru`, shows stacked bar charts by state and dot timelines by process. Detects process restarts, frozen processes, and supports background recording with configurable intervals.

## Install

Download the APK: **[procstate-debug.apk](https://github.com/zimuzostanley/ahat-web/raw/master/procstate/release/procstate-debug.apk)**

```bash
adb install procstate-debug.apk
```

## Grant permissions

These are development-only permissions that can't be requested at runtime — they must be granted via ADB. `DUMP` is required to run `dumpsys activity lru` (process state list) and `dumpsys meminfo <pid>` (per-process memory). `PACKAGE_USAGE_STATS` enables frozen process detection via `dumpsys activity | grep 'Apps frozen:'`.

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
- **Memory dump**: tap the dump button in the detail drawer to capture `dumpsys meminfo` for a process — shows PSS, RSS, Java/Native heap, Code, Stack, Graphics, System breakdown. Enable auto-dump in Settings to capture memory for all pinned processes on every snapshot.
- **Export**: Settings > Export to Perfetto — generates a Chrome JSON trace with state slices, frozen periods, lifecycle events, process count counters, and memory counter tracks. Open in [Perfetto UI](https://ui.perfetto.dev).
