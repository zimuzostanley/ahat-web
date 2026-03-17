package com.procstate.monitor.data

import android.app.AppOpsManager
import android.content.Context
import android.os.Process
import android.util.Log
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * On-device shell helper for fetching process LRU state via `dumpsys activity lru`.
 * Adapted from the ahat Android app's ShellHelper.java.
 *
 * Requires: adb shell pm grant com.procstate.monitor android.permission.DUMP
 *           adb shell pm grant com.procstate.monitor android.permission.PACKAGE_USAGE_STATS
 */
object ShellHelper {

    private const val TAG = "ProcState"
    private const val SHELL_TIMEOUT_SEC = 30L

    // Groups: 1=oomState, 2=PID, 3=name, 4=UID (optional)
    private val LRU_LINE = Regex("""^\s*#\d+:\s+(\S+)\s+.*?\s(\d+):([^\s/]+)(?:/(\S+))?""")

    private val OOM_LABEL_MAP = mapOf(
        "pers" to "Persistent",
        "top" to "Top",
        "bfgs" to "Bound FG",
        "btop" to "Bound Top",
        "fgs" to "FG Service",
        "fg" to "Foreground",
        "impfg" to "Imp FG",
        "impbg" to "Imp BG",
        "backup" to "Backup",
        "service" to "Service",
        "service-rs" to "Svc Restart",
        "receiver" to "Receiver",
        "heavy" to "Heavy",
        "home" to "Home",
        "lastact" to "Last Activity",
        "cached" to "Cached",
        "cch" to "Cached",
        "frzn" to "Frozen",
        "native" to "Native",
        "sys" to "System",
        "fore" to "Foreground",
        "vis" to "Visible",
        "percep" to "Perceptible",
        "perceptible" to "Perceptible",
        "svcb" to "Service B",
        "svcrst" to "Svc Restart",
        "prev" to "Previous",
        "lstact" to "Last Activity",
    )

    // ── Permission state ────────────────────────────────────────────────────

    data class PermissionState(
        val hasDump: Boolean,
        val hasUsageStats: Boolean,
        val hasRoot: Boolean,
    ) {
        val canCapture: Boolean get() = hasDump || hasRoot
        val grantCommands: List<String> get() = buildList {
            if (!hasDump) add("adb shell pm grant com.procstate.monitor android.permission.DUMP")
            if (!hasUsageStats) add("adb shell pm grant com.procstate.monitor android.permission.PACKAGE_USAGE_STATS")
        }
    }

    @Volatile
    var permissionState = PermissionState(hasDump = false, hasUsageStats = false, hasRoot = false)
        private set

    // ── Root detection ──────────────────────────────────────────────────────

    private var hasRoot: Boolean? = null
    private var suPath: String? = null

    private val SU_PATHS = arrayOf(
        "/sbin/su", "/system/bin/su", "/system/xbin/su",
        "/su/bin/su", "/magisk/.core/bin/su", "/data/adb/ksu/bin/su",
    )

    @Synchronized
    fun detectRoot(): Boolean {
        hasRoot?.let { return it }
        Log.d(TAG, "Detecting root...")
        for (path in SU_PATHS) {
            if (!File(path).exists()) continue
            for (variant in arrayOf("$path -c id", "$path 0 id")) {
                try {
                    val result = execRaw("sh", "-c", variant)
                    if ("uid=0" in result) {
                        hasRoot = true; suPath = path
                        Log.d(TAG, "Root: YES ($variant)")
                        return true
                    }
                } catch (_: Exception) {}
            }
        }
        for (variant in arrayOf("su -c id", "su 0 id")) {
            try {
                val result = execRaw("sh", "-c", variant)
                if ("uid=0" in result) {
                    hasRoot = true; suPath = "su"
                    Log.d(TAG, "Root: YES ($variant)")
                    return true
                }
            } catch (_: Exception) {}
        }
        hasRoot = false
        Log.d(TAG, "Root: NO")
        return false
    }

    fun checkPermissions(ctx: Context): PermissionState {
        val dump = ctx.checkSelfPermission("android.permission.DUMP") ==
                android.content.pm.PackageManager.PERMISSION_GRANTED

        // PACKAGE_USAGE_STATS is a special AppOps permission — checkSelfPermission
        // always returns DENIED. Must use AppOpsManager instead.
        val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val usageStats = appOps.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            ctx.packageName,
        ) == AppOpsManager.MODE_ALLOWED

        val root = hasRoot ?: detectRoot()

        if (!dump) Log.w(TAG, "Grant: adb shell pm grant ${ctx.packageName} android.permission.DUMP")
        if (!usageStats) Log.w(TAG, "Grant: adb shell pm grant ${ctx.packageName} android.permission.PACKAGE_USAGE_STATS")

        permissionState = PermissionState(hasDump = dump, hasUsageStats = usageStats, hasRoot = root)
        return permissionState
    }

    // ── Shell execution ─────────────────────────────────────────────────────

    private fun execRaw(vararg cmd: String): String {
        val proc = ProcessBuilder(*cmd).redirectErrorStream(true).start()
        val output = proc.inputStream.bufferedReader().use { it.readText() }
        val finished = proc.waitFor(SHELL_TIMEOUT_SEC, TimeUnit.SECONDS)
        if (!finished) {
            proc.destroyForcibly()
            throw Exception("Shell command timed out after ${SHELL_TIMEOUT_SEC}s: ${cmd.joinToString(" ")}")
        }
        return output
    }

    fun exec(command: String): String {
        val result = if (hasRoot == true && suPath != null) {
            execRaw("sh", "-c", "$suPath -c '${command.replace("'", "'\\''")}'")
        } else {
            execRaw("sh", "-c", command)
        }
        if ("Permission Denial" in result || "not allowed" in result) {
            throw Exception("Permission denied. Grant DUMP permission:\nadb shell pm grant com.procstate.monitor android.permission.DUMP")
        }
        return result
    }

    // ── LRU process parsing ─────────────────────────────────────────────────

    private fun mapOomLabel(raw: String): String {
        val base = raw.replace(Regex("""\+\d+$"""), "").replace(Regex("""\d+$"""), "")
        return OOM_LABEL_MAP[base] ?: raw
    }

    data class ProcessEntry(val pid: Int, val name: String, val procState: String, val uid: String = "")

    fun parseLruOutput(output: String): List<ProcessEntry> {
        val results = mutableListOf<ProcessEntry>()
        val seen = mutableSetOf<Int>()
        for (line in output.lines()) {
            val m = LRU_LINE.find(line) ?: continue
            val pid = m.groupValues[2].toIntOrNull() ?: continue
            if (!seen.add(pid)) continue
            val oomRaw = m.groupValues[1].replace(Regex("""\+\d+$"""), "")
            val uid = m.groupValues.getOrElse(4) { "" }
            results.add(ProcessEntry(pid, m.groupValues[3], mapOomLabel(oomRaw), uid))
        }
        return results
    }

    /**
     * Get PIDs of frozen processes from `dumpsys activity` "Apps frozen:" section.
     * Output format:
     *   Apps frozen: 164
     *     499170472: 637 com.google.android.apps.aiwallpapers
     *     492503897: 949 com.google.android.apps.gcs
     * Returns empty set if command fails.
     */
    private val FROZEN_LINE = Regex("""^\s*\d+:\s+(\d+)\s+""")

    fun getFrozenPids(): Set<Int> {
        return try {
            // Use execRaw directly to avoid the Permission Denial check
            // (dumpsys output may contain that string in unrelated sections)
            val cmd = "dumpsys activity | grep -A 1000 'Apps frozen:'"
            val output = if (hasRoot == true && suPath != null) {
                execRaw("sh", "-c", "$suPath -c '${cmd.replace("'", "'\\''")}'")
            } else {
                execRaw("sh", "-c", cmd)
            }
            val pids = mutableSetOf<Int>()
            var inSection = false
            for (line in output.lines()) {
                if ("Apps frozen:" in line) { inSection = true; continue }
                if (!inSection) continue
                // Section ends at next non-indented line or empty line
                if (line.isBlank() || (!line.startsWith(" ") && !line.startsWith("\t"))) break
                FROZEN_LINE.find(line)?.groupValues?.get(1)?.toIntOrNull()?.let { pids.add(it) }
            }
            Log.d(TAG, "Frozen PIDs: ${pids.size}")
            pids
        } catch (e: Exception) {
            Log.w(TAG, "Failed to detect frozen processes: ${e.message}")
            emptySet()
        }
    }

    fun getProcessList(): List<ProcessEntry> {
        Log.d(TAG, "Fetching process list...")
        val output = exec("dumpsys activity lru")
        val list = parseLruOutput(output).toMutableList()
        Log.d(TAG, "Parsed ${list.size} LRU processes")

        val pids = list.map { it.pid }.toSet()
        for (name in arrayOf("system_server", "com.android.systemui")) {
            try {
                val pidStr = exec("pidof $name").trim()
                if (pidStr.isEmpty()) continue
                val pid = pidStr.split(Regex("\\s+"))[0].toInt()
                if (pid !in pids) {
                    list.add(0, ProcessEntry(pid, name, "System", "1000"))
                    Log.d(TAG, "Pinned: $name PID $pid")
                }
            } catch (e: Exception) {
                Log.w(TAG, "pidof $name: ${e.message}")
            }
        }
        Log.d(TAG, "Total: ${list.size} processes")
        return list
    }
}
