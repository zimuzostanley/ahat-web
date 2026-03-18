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

    // No label mapping — use raw state strings from the device as-is.
    // This ensures all states (including device-specific ones like psvc, prcl)
    // show correctly in the UI and legend.

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
        // Read stream in a separate thread to avoid deadlock when pipe buffer fills.
        // StringBuffer is thread-safe (reader thread writes, main thread reads after join).
        val outputBuilder = StringBuffer()
        val reader = Thread {
            proc.inputStream.bufferedReader().use { br ->
                br.forEachLine { outputBuilder.appendLine(it) }
            }
        }
        reader.start()
        val finished = proc.waitFor(SHELL_TIMEOUT_SEC, TimeUnit.SECONDS)
        if (!finished) {
            proc.destroyForcibly()
            reader.interrupt()
            throw Exception("Shell command timed out after ${SHELL_TIMEOUT_SEC}s")
        }
        reader.join(2000) // wait for reader to finish draining
        return outputBuilder.toString()
    }

    fun exec(command: String): String {
        // Snapshot volatile fields to avoid TOCTOU race between hasRoot and suPath reads
        val rootPath = suPath.takeIf { hasRoot == true }
        val result = if (rootPath != null) {
            execRaw("sh", "-c", "$rootPath -c '${command.replace("'", "'\\''")}'")
        } else {
            execRaw("sh", "-c", command)
        }
        if ("Permission Denial" in result || "not allowed" in result) {
            throw Exception("Permission denied. Grant DUMP permission:\nadb shell pm grant com.procstate.monitor android.permission.DUMP")
        }
        return result
    }

    // ── LRU process parsing ─────────────────────────────────────────────────

    data class ProcessEntry(val pid: Int, val name: String, val procState: String, val uid: String = "")

    fun parseLruOutput(output: String): List<ProcessEntry> {
        val results = mutableListOf<ProcessEntry>()
        val seen = mutableSetOf<Int>()
        for (line in output.lines()) {
            val m = LRU_LINE.find(line) ?: continue
            val pid = m.groupValues[2].toIntOrNull() ?: continue
            if (!seen.add(pid)) continue
            // Strip +N suffix (e.g. "cch+1" -> "cch") but keep the raw label
            val state = m.groupValues[1].replace(Regex("""\+\d+$"""), "")
            val uid = m.groupValues.getOrElse(4) { "" }
            results.add(ProcessEntry(pid, m.groupValues[3], state, uid))
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
                    list.add(0, ProcessEntry(pid, name, "sys", "1000"))
                    Log.d(TAG, "Pinned: $name PID $pid")
                }
            } catch (e: Exception) {
                Log.w(TAG, "pidof $name: ${e.message}")
            }
        }
        Log.d(TAG, "Total: ${list.size} processes")
        return list
    }

    // ── Memory info ─────────────────────────────────────────────────────────

    data class MemInfo(
        val totalPssKb: Long = 0,
        val totalRssKb: Long = 0,
        val javaHeapKb: Long = 0,
        val nativeHeapKb: Long = 0,
        val codeKb: Long = 0,
        val stackKb: Long = 0,
        val graphicsKb: Long = 0,
        val systemKb: Long = 0,
        val totalSwapKb: Long = 0,
    )

    // Parse the "App Summary" section which has the correct breakdown.
    // Lines look like: "           Java Heap:    12345"
    // Match category lines from App Summary — use \h (horizontal whitespace) for robustness
    private val SUMMARY_LINE = Regex(
        """(?:^|\n)\s*(Java Heap|Native Heap|Code|Stack|Graphics|System):\s+(\d+)"""
    )
    // Fallback for Graphics from detailed MEMINFO table rows like "GL mtrack" or "Gfx dev"
    private val GFX_LINE = Regex("""^\s+(GL mtrack|Gfx dev|EGL mtrack)\s+(\d+)""")
    private val TOTAL_PSS = Regex("""TOTAL PSS:\s+(\d+)""")
    private val TOTAL_RSS = Regex("""TOTAL RSS:\s+(\d+)""")
    private val TOTAL_SWAP = Regex("""TOTAL SWAP.*?:\s+(\d+)""")

    fun parseMemInfoOutput(output: String): MemInfo {
        var totalPss = 0L; var totalRss = 0L; var totalSwap = 0L
        var javaHeap = 0L; var nativeHeap = 0L; var code = 0L
        var stack = 0L; var graphics = 0L; var system = 0L

        for (line in output.lines()) {
            SUMMARY_LINE.find(line)?.let { m ->
                val kb = m.groupValues[2].toLong()
                when (m.groupValues[1]) {
                    "Java Heap" -> javaHeap = kb
                    "Native Heap" -> nativeHeap = kb
                    "Code" -> code = kb
                    "Stack" -> stack = kb
                    "Graphics" -> graphics = kb
                    "System" -> system = kb
                }
            }

            // Fallback: accumulate graphics from GL/Gfx table rows
            if (graphics == 0L) {
                GFX_LINE.find(line)?.let { m ->
                    graphics += m.groupValues[2].toLong()
                }
            }

            TOTAL_PSS.find(line)?.let { totalPss = it.groupValues[1].toLong() }
            TOTAL_RSS.find(line)?.let { totalRss = it.groupValues[1].toLong() }
            TOTAL_SWAP.find(line)?.let { totalSwap = it.groupValues[1].toLong() }
        }

        // Fallback: TOTAL row from detail table
        if (totalPss == 0L) {
            for (line in output.lines()) {
                if (line.trimStart().startsWith("TOTAL") && !line.contains("PSS") && !line.contains("RSS") && !line.contains("SWAP")) {
                    val parts = line.trim().split(Regex("\\s+"))
                    if (parts.size >= 2) {
                        totalPss = parts[1].toLongOrNull() ?: 0
                        if (totalPss > 0) break
                    }
                }
            }
        }

        // Subtract System from Total PSS — System includes shared libraries
        // that are not exclusively owned by this process
        val adjustedPss = if (system > 0 && totalPss > system) totalPss - system else totalPss
        return MemInfo(adjustedPss, totalRss, javaHeap, nativeHeap, code, stack, graphics, system, totalSwap)
    }

    fun getMemInfo(pid: Int): MemInfo {
        // Use execRaw directly — DUMP permission is sufficient, and su wrapping
        // can alter the output format (e.g. stripping App Summary section)
        val output = try {
            execRaw("sh", "-c", "dumpsys meminfo $pid")
        } catch (_: Exception) {
            exec("dumpsys meminfo $pid")
        }
        val info = parseMemInfoOutput(output)
        Log.d(TAG, "MemInfo PID $pid: PSS=${info.totalPssKb} RSS=${info.totalRssKb} " +
            "Java=${info.javaHeapKb} Native=${info.nativeHeapKb} " +
            "Code=${info.codeKb} Graphics=${info.graphicsKb} System=${info.systemKb}")
        return info
    }
}
