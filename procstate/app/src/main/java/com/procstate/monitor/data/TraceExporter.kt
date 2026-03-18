package com.procstate.monitor.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * Exports process state timeline data to Chrome Trace Event Format (JSON).
 * Compatible with Perfetto UI (ui.perfetto.dev) and chrome://tracing.
 *
 * Produces three tracks per process:
 *   1. "State" — Complete events (X) for process state, merged when consecutive same state
 *   2. "Frozen" — Complete events (X) for frozen periods
 *   3. "Lifecycle" — Instant events (i) for process starts (PID changes)
 *
 * Track naming: "processName / packageName / uid / appLabel"
 * Timestamps in microseconds (Chrome default).
 */
object TraceExporter {

    data class Entry(
        val timestampMs: Long,
        val name: String,
        val uid: String,
        val pid: Int,
        val procState: String,
        val frozen: Boolean,
    )

    data class Slice(
        val name: String,
        val startUs: Long,
        val durUs: Long,
        val args: Map<String, Any> = emptyMap(),
    )

    data class Instant(
        val name: String,
        val tsUs: Long,
        val args: Map<String, Any> = emptyMap(),
    )

    /**
     * Convert timeline entries to Chrome JSON trace format.
     * @param entries All process entries sorted by (name, uid, timestamp).
     * @param getAppLabel Resolver for app labels from process names.
     * @param allTimestampsMs All snapshot timestamps in range (for determining slice end times).
     * @return JSON string in Chrome Trace Event Object Format.
     */
    data class MemoryEntry(
        val timestampMs: Long,
        val name: String,
        val uid: String,
        val pid: Int,
        val totalPssKb: Long,
        val totalRssKb: Long,
        val javaHeapKb: Long,
        val nativeHeapKb: Long,
        val codeKb: Long,
        val stackKb: Long,
        val graphicsKb: Long,
        val systemKb: Long,
        val totalSwapKb: Long,
    )

    fun export(
        entries: List<Entry>,
        getAppLabel: (String) -> String,
        allTimestampsMs: List<Long>,
        memoryEntries: List<MemoryEntry> = emptyList(),
        onProgress: ((String) -> Unit)? = null,
    ): String {
        val events = JSONArray()
        val sortedTimestamps = allTimestampsMs.sorted()

        // ── Global counter tracks: process count per state over time ────────
        val globalPid = 0
        events.put(metadataEvent("process_name", globalPid, 0, "Process State Counts"))
        events.put(metadataEvent("process_sort_index", globalPid, 0, -1))

        // Group all entries by timestamp, count processes per state
        val byTimestamp = entries.groupBy { it.timestampMs }
        for (ts in sortedTimestamps) {
            val entriesAtTs = byTimestamp[ts] ?: continue
            val stateCounts = entriesAtTs.groupBy { it.procState }
                .mapValues { it.value.size }
            // Emit one counter event with all state counts as series
            events.put(JSONObject().apply {
                put("ph", "C")
                put("name", "processes")
                put("cat", "state_counts")
                put("pid", globalPid)
                put("tid", 0)
                put("ts", ts * 1000)
                put("args", JSONObject(stateCounts))
            })
            // Frozen count as separate counter
            val frozenCount = entriesAtTs.count { it.frozen }
            events.put(JSONObject().apply {
                put("ph", "C")
                put("name", "frozen")
                put("cat", "frozen_count")
                put("pid", globalPid)
                put("tid", 0)
                put("ts", ts * 1000)
                put("args", JSONObject(mapOf("frozen" to frozenCount)))
            })
        }

        onProgress?.invoke("Building counters (${sortedTimestamps.size} timestamps)")

        // ── Per-process tracks ──────────────────────────────────────────────
        val byProcess = entries.groupBy { it.name to it.uid }
        val memByProcess = memoryEntries.groupBy { it.name to it.uid }

        var processCount = 0
        val totalProcesses = byProcess.size
        for ((key, processEntries) in byProcess) {
            processCount++
            if (processCount % 20 == 0) {
                onProgress?.invoke("Process $processCount/$totalProcesses")
            }
            val (name, uid) = key
            val packageName = name.substringBefore(':')
            val appLabel = getAppLabel(name)
            val trackName = "$name / $packageName / $uid / $appLabel"

            // Use stable pid for the process in the trace (hash of name+uid)
            val tracePid = (name + uid).hashCode() and 0x7FFFFFFF

            // Add process metadata
            events.put(metadataEvent("process_name", tracePid, 0, trackName))
            events.put(metadataEvent("thread_name", tracePid, 1, "State"))
            events.put(metadataEvent("thread_name", tracePid, 2, "Frozen"))
            events.put(metadataEvent("thread_name", tracePid, 3, "Lifecycle"))

            val sorted = processEntries.sortedBy { it.timestampMs }

            // Track 1: State slices (merge consecutive same state)
            val stateSlices = mergeStateSlices(sorted, sortedTimestamps)
            for (slice in stateSlices) {
                events.put(completeEvent(
                    name = slice.name,
                    cat = "state",
                    pid = tracePid,
                    tid = 1,
                    tsUs = slice.startUs,
                    durUs = slice.durUs,
                    args = slice.args,
                ))
            }

            // Track 2: Frozen slices
            val frozenSlices = mergeFrozenSlices(sorted, sortedTimestamps)
            for (slice in frozenSlices) {
                events.put(completeEvent(
                    name = "frozen",
                    cat = "frozen",
                    pid = tracePid,
                    tid = 2,
                    tsUs = slice.startUs,
                    durUs = slice.durUs,
                ))
            }

            // Track 3: Lifecycle instants (process starts = PID changes)
            val instants = detectLifecycleEvents(sorted)
            for (instant in instants) {
                events.put(instantEvent(
                    name = instant.name,
                    cat = "lifecycle",
                    pid = tracePid,
                    tid = 3,
                    tsUs = instant.tsUs,
                    args = instant.args,
                ))
            }

            // Track 4: Memory counters (if any memory data exists)
            val memForProcess = memByProcess[key]?.sortedBy { it.timestampMs } ?: emptyList()
            if (memForProcess.isNotEmpty()) {
                events.put(metadataEvent("thread_name", tracePid, 4, "Memory"))
                for (mem in memForProcess) {
                    events.put(JSONObject().apply {
                        put("ph", "C")
                        put("name", "Memory")
                        put("cat", "Memory")
                        put("pid", tracePid)
                        put("tid", 4)
                        put("ts", mem.timestampMs * 1000)
                        put("args", JSONObject().apply {
                            put("Total PSS (KB)", mem.totalPssKb)
                            put("Total RSS (KB)", mem.totalRssKb)
                            put("Java Heap (KB)", mem.javaHeapKb)
                            put("Native Heap (KB)", mem.nativeHeapKb)
                            put("Code (KB)", mem.codeKb)
                            put("Stack (KB)", mem.stackKb)
                            put("Graphics (KB)", mem.graphicsKb)
                            put("System (KB)", mem.systemKb)
                            if (mem.totalSwapKb > 0) put("Swap (KB)", mem.totalSwapKb)
                        })
                    })
                }
            }
        }

        val root = JSONObject()
        root.put("traceEvents", events)
        root.put("displayTimeUnit", "ms")
        root.put("otherData", JSONObject().apply {
            put("source", "ProcState Monitor")
        })
        return root.toString()
    }

    // ── Slice merging ───────────────────────────────────────────────────────

    /**
     * Merge consecutive entries with the same procState into single slices.
     * Duration extends to the next snapshot timestamp (or stays minimal for the last).
     */
    internal fun mergeStateSlices(
        sorted: List<Entry>,
        allTimestampsMs: List<Long>,
    ): List<Slice> {
        if (sorted.isEmpty()) return emptyList()

        val slices = mutableListOf<Slice>()
        var sliceStart = sorted[0].timestampMs
        var sliceState = sorted[0].procState
        var slicePid = sorted[0].pid

        for (i in 1 until sorted.size) {
            val entry = sorted[i]
            if (entry.procState == sliceState) {
                // Same state — continue extending
                continue
            }
            // State changed — emit previous slice
            val endMs = entry.timestampMs
            slices.add(Slice(
                name = sliceState,
                startUs = sliceStart * 1000,
                durUs = (endMs - sliceStart) * 1000,
                args = mapOf("pid" to slicePid),
            ))
            sliceStart = entry.timestampMs
            sliceState = entry.procState
            slicePid = entry.pid
        }

        // Emit last slice — duration to next timestamp or minimal
        val lastEndMs = nextTimestamp(sorted.last().timestampMs, allTimestampsMs)
            ?: (sorted.last().timestampMs + 1000) // 1s default if no next
        slices.add(Slice(
            name = sliceState,
            startUs = sliceStart * 1000,
            durUs = (lastEndMs - sliceStart) * 1000,
            args = mapOf("pid" to slicePid),
        ))

        return slices
    }

    /**
     * Merge consecutive frozen=true entries into slices.
     */
    internal fun mergeFrozenSlices(
        sorted: List<Entry>,
        allTimestampsMs: List<Long>,
    ): List<Slice> {
        if (sorted.isEmpty()) return emptyList()

        val slices = mutableListOf<Slice>()
        var frozenStart: Long? = null

        for (entry in sorted) {
            if (entry.frozen) {
                if (frozenStart == null) frozenStart = entry.timestampMs
            } else {
                if (frozenStart != null) {
                    slices.add(Slice(
                        name = "frozen",
                        startUs = frozenStart * 1000,
                        durUs = (entry.timestampMs - frozenStart) * 1000,
                    ))
                    frozenStart = null
                }
            }
        }

        // Close open frozen slice
        if (frozenStart != null) {
            val endMs = nextTimestamp(sorted.last().timestampMs, allTimestampsMs)
                ?: (sorted.last().timestampMs + 1000)
            slices.add(Slice(
                name = "frozen",
                startUs = frozenStart * 1000,
                durUs = (endMs - frozenStart) * 1000,
            ))
        }

        return slices
    }

    /**
     * Detect PID changes (process restarts) and emit instant events.
     */
    internal fun detectLifecycleEvents(sorted: List<Entry>): List<Instant> {
        if (sorted.isEmpty()) return emptyList()

        val instants = mutableListOf<Instant>()
        for (i in 1 until sorted.size) {
            if (sorted[i].pid != sorted[i - 1].pid &&
                sorted[i].pid != 0 && sorted[i - 1].pid != 0
            ) {
                instants.add(Instant(
                    name = "process start",
                    tsUs = sorted[i].timestampMs * 1000,
                    args = mapOf(
                        "new_pid" to sorted[i].pid,
                        "old_pid" to sorted[i - 1].pid,
                    ),
                ))
            }
        }
        return instants
    }

    // ── JSON event builders ─────────────────────────────────────────────────

    private fun completeEvent(
        name: String, cat: String, pid: Int, tid: Int,
        tsUs: Long, durUs: Long, args: Map<String, Any> = emptyMap(),
    ): JSONObject = JSONObject().apply {
        put("ph", "X")
        put("name", name)
        put("cat", cat)
        put("pid", pid)
        put("tid", tid)
        put("ts", tsUs)
        put("dur", durUs)
        if (args.isNotEmpty()) put("args", JSONObject(args))
    }

    private fun instantEvent(
        name: String, cat: String, pid: Int, tid: Int,
        tsUs: Long, args: Map<String, Any> = emptyMap(),
    ): JSONObject = JSONObject().apply {
        put("ph", "i")
        put("name", name)
        put("cat", cat)
        put("pid", pid)
        put("tid", tid)
        put("ts", tsUs)
        put("s", "t") // thread scope
        if (args.isNotEmpty()) put("args", JSONObject(args))
    }

    private fun metadataEvent(
        metaName: String, pid: Int, tid: Int, value: String,
    ): JSONObject = JSONObject().apply {
        put("ph", "M")
        put("name", metaName)
        put("pid", pid)
        put("tid", tid)
        put("args", JSONObject().put("name", value))
    }

    private fun metadataEvent(
        metaName: String, pid: Int, tid: Int, sortIndex: Int,
    ): JSONObject = JSONObject().apply {
        put("ph", "M")
        put("name", metaName)
        put("pid", pid)
        put("tid", tid)
        put("args", JSONObject().put("sort_index", sortIndex))
    }

    private fun nextTimestamp(currentMs: Long, allMs: List<Long>): Long? {
        // Binary search for next timestamp after currentMs
        val idx = allMs.binarySearch(currentMs)
        val insertionPoint = if (idx >= 0) idx + 1 else -(idx + 1)
        return if (insertionPoint < allMs.size) allMs[insertionPoint] else null
    }
}
