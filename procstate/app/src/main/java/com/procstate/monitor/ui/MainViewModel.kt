package com.procstate.monitor.ui

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.compose.runtime.Immutable
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.procstate.monitor.data.AppDatabase
import com.procstate.monitor.data.MemoryDotKey
import com.procstate.monitor.data.ProcessKeyWithTransitions
import com.procstate.monitor.data.STATE_PRIORITY
import com.procstate.monitor.data.MemorySnapshotEntity
import com.procstate.monitor.data.MemoryStatsAggregate
import com.procstate.monitor.data.ProcessEntryEntity
import com.procstate.monitor.data.ProcessKey
import com.procstate.monitor.data.ShellHelper
import com.procstate.monitor.data.TraceExporter
import com.procstate.monitor.data.SnapshotEntity
import com.procstate.monitor.data.SnapshotWithCounts
import com.procstate.monitor.service.CaptureService
import com.procstate.monitor.ui.theme.ThemeMode
import com.procstate.monitor.ui.theme.ThemePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Immutable
enum class TimeRange(val label: String, val millis: Long) {
    MIN_5("5m", 5 * 60_000L),
    MIN_15("15m", 15 * 60_000L),
    MIN_30("30m", 30 * 60_000L),
    HOUR_1("1h", 60 * 60_000L),
    HOUR_6("6h", 6 * 60 * 60_000L),
    HOUR_12("12h", 12 * 60 * 60_000L),
    HOUR_24("24h", 24 * 60 * 60_000L),
    DAY_3("3d", 3L * 24 * 60 * 60_000L),
    DAY_7("7d", 7L * 24 * 60 * 60_000L),
    DAY_30("30d", 30L * 24 * 60 * 60_000L),
}

@Immutable
enum class CaptureInterval(val label: String, val millis: Long) {
    MS_100("100ms", 100),
    MS_500("500ms", 500),
    SEC_1("1s", 1_000),
    SEC_2("2s", 2_000),
    SEC_5("5s", 5_000),
    SEC_10("10s", 10_000),
    SEC_30("30s", 30_000),
    MIN_1("1m", 60_000),
    MIN_5("5m", 300_000),
    MIN_15("15m", 900_000),
}


@Immutable
enum class StopAfter(val label: String, val minutes: Int) {
    NEVER("Never", 0),
    MIN_1("1m", 1),
    MIN_2("2m", 2),
    MIN_5("5m", 5),
    MIN_15("15m", 15),
    MIN_30("30m", 30),
    HOUR_1("1h", 60),
    HOUR_2("2h", 120),
    HOUR_6("6h", 360),
    HOUR_12("12h", 720),
    HOUR_24("24h", 1440),
}

data class DataSession(val sessionId: String, val startMs: Long, val endMs: Long, val count: Int) {
    val durationMs: Long get() = endMs - startMs
    val isSingleSnapshot: Boolean get() = count == 1
}

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val dao = AppDatabase.get(app).snapshotDao()
    private val ctx: Context get() = getApplication()
    private val prefs = app.getSharedPreferences("settings", Context.MODE_PRIVATE)

    // ── App label cache ────────────────────────────────────────────────────

    private val appLabelCache = java.util.concurrent.ConcurrentHashMap<String, String>()

    // ── Auto memory dump ──────────────────────────────────────────────────

    private val _autoMemoryDump = MutableStateFlow(
        prefs.getBoolean("auto_memory_dump", false)
    )
    val autoMemoryDump: StateFlow<Boolean> = _autoMemoryDump.asStateFlow()

    fun setAutoMemoryDump(enabled: Boolean) {
        _autoMemoryDump.value = enabled
        prefs.edit().putBoolean("auto_memory_dump", enabled).apply()
        syncAutoMemoryList()
    }

    /**
     * Resolve app label from package name via PackageManager.
     * Process names like "com.chrome:sandboxed" -> package "com.chrome".
     * Falls back to short name if package not found.
     */
    fun getAppLabel(processName: String): String {
        return appLabelCache.getOrPut(processName) {
            try {
                val packageName = processName.substringBefore(':')
                val pm = ctx.packageManager
                val ai = pm.getApplicationInfo(packageName, 0)
                pm.getApplicationLabel(ai).toString()
            } catch (_: Exception) {
                processName
            }
        }
    }

    // ── Theme ───────────────────────────────────────────────────────────────

    private val _themeMode = MutableStateFlow(ThemePrefs.load(app))
    val themeMode: StateFlow<ThemeMode> = _themeMode.asStateFlow()

    fun setTheme(mode: ThemeMode) {
        _themeMode.value = mode
        ThemePrefs.save(ctx, mode)
    }

    // ── Permissions ─────────────────────────────────────────────────────────

    private val _permissionState = MutableStateFlow(ShellHelper.permissionState)
    val permissionState: StateFlow<ShellHelper.PermissionState> = _permissionState.asStateFlow()

    // ── Time range ──────────────────────────────────────────────────────────

    private val _timeRange = MutableStateFlow(
        prefs.getString("time_range", null)?.let { name ->
            try { TimeRange.valueOf(name) } catch (_: Exception) { null }
        } ?: TimeRange.MIN_30
    )
    val timeRange: StateFlow<TimeRange> = _timeRange.asStateFlow()

    fun setTimeRange(range: TimeRange) {
        _timeRange.value = range
        prefs.edit().putString("time_range", range.name).apply()
    }

    private val _ticker = MutableStateFlow(System.currentTimeMillis())

    /** Pinned absolute start time (non-persisted). Overrides time range when set. */
    private val _pinnedStartMs = MutableStateFlow<Long?>(null)
    val pinnedStartMs: StateFlow<Long?> = _pinnedStartMs.asStateFlow()

    fun pinStartTime(startMs: Long) { _pinnedStartMs.value = startMs }
    fun clearPinnedStart() { _pinnedStartMs.value = null }

    /** Effective start time: pinned start or relative time range. */
    private val effectiveStart = combine(_timeRange, _ticker, _pinnedStartMs) { range, tick, pinned ->
        pinned ?: (tick - range.millis)
    }

    // ── Capture controls ────────────────────────────────────────────────────

    private val _captureInterval = MutableStateFlow(
        prefs.getString("capture_interval", null)?.let { name ->
            try { CaptureInterval.valueOf(name) } catch (_: Exception) { null }
        } ?: CaptureInterval.SEC_30
    )
    val captureInterval: StateFlow<CaptureInterval> = _captureInterval.asStateFlow()

    private val _stopAfter = MutableStateFlow(
        prefs.getString("stop_after", null)?.let { name ->
            try { StopAfter.valueOf(name) } catch (_: Exception) { null }
        } ?: StopAfter.NEVER
    )
    val stopAfter: StateFlow<StopAfter> = _stopAfter.asStateFlow()

    private val _isCapturing = MutableStateFlow(CaptureService.running)
    val isCapturing: StateFlow<Boolean> = _isCapturing.asStateFlow()

    private val _captureStartMs = MutableStateFlow(0L)
    val captureStartMs: StateFlow<Long> = _captureStartMs.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _captureError = MutableStateFlow<String?>(null)
    val captureError: StateFlow<String?> = _captureError.asStateFlow()

    fun setCaptureInterval(v: CaptureInterval) {
        _captureInterval.value = v
        prefs.edit().putString("capture_interval", v.name).apply()
    }
    fun setStopAfter(v: StopAfter) {
        _stopAfter.value = v
        prefs.edit().putString("stop_after", v.name).apply()
    }

    fun refreshCaptureStatus() {
        val running = CaptureService.running
        _isCapturing.value = running
        if (!running) _captureStartMs.value = 0
    }

    fun startCapture() {
        _captureError.value = null
        // Set auto-dump state before starting service
        CaptureService.autoMemoryEnabled = _autoMemoryDump.value
        CaptureService.autoMemoryNames = if (_autoMemoryDump.value) {
            _pinnedProcesses.value.map { it.name to it.uid }
        } else emptyList()

        val intent = Intent(ctx, CaptureService::class.java).apply {
            putExtra(CaptureService.EXTRA_INTERVAL_MS, _captureInterval.value.millis)
            putExtra(CaptureService.EXTRA_STOP_AFTER_MINUTES, _stopAfter.value.minutes)
        }
        if (Build.VERSION.SDK_INT >= 26) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
        _isCapturing.value = true
        _captureStartMs.value = System.currentTimeMillis()
    }

    fun stopCapture() {
        val intent = Intent(ctx, CaptureService::class.java).apply {
            action = CaptureService.ACTION_STOP
        }
        ctx.startService(intent)
        _isCapturing.value = false
        _captureStartMs.value = 0
    }

    fun pullToRefresh() {
        if (_isRefreshing.value) return
        viewModelScope.launch {
            _isRefreshing.value = true
            _captureError.value = null
            try {
                withContext(Dispatchers.IO) {
                    val processes = ShellHelper.getProcessList()
                    val frozenPids = ShellHelper.getFrozenPids()

                    // Dump memory first (slow), then snapshot (fast)
                    val memDumps = mutableListOf<Triple<Int, ProcessKey, ShellHelper.MemInfo>>()
                    if (_autoMemoryDump.value && _pinnedProcesses.value.isNotEmpty()) {
                        for (key in _pinnedProcesses.value) {
                            val proc = processes.find { it.name == key.name && it.uid == key.uid }
                            if (proc != null) {
                                try {
                                    memDumps.add(Triple(proc.pid, key, ShellHelper.getMemInfo(proc.pid)))
                                } catch (e: Exception) {
                                    Log.w("MainVM", "Auto meminfo ${key.name} failed: ${e.message}")
                                }
                            }
                        }
                    }

                    val snapshot = SnapshotEntity(timestamp = System.currentTimeMillis(), sessionId = java.util.UUID.randomUUID().toString())
                    val entries = processes.map { p ->
                        ProcessEntryEntity(
                            snapshotId = 0,
                            pid = p.pid, name = p.name, uid = p.uid,
                            procState = p.procState,
                            frozen = p.pid in frozenPids,
                        )
                    }
                    dao.insertSnapshotWithEntries(snapshot, entries)
                    for ((pid, key, memInfo) in memDumps) {
                        dao.insertMemorySnapshot(MemorySnapshotEntity(
                            timestamp = snapshot.timestamp,
                            pid = pid, name = key.name, uid = key.uid,
                            totalPssKb = memInfo.totalPssKb,
                            totalRssKb = memInfo.totalRssKb,
                            javaHeapKb = memInfo.javaHeapKb,
                            nativeHeapKb = memInfo.nativeHeapKb,
                            codeKb = memInfo.codeKb,
                            stackKb = memInfo.stackKb,
                            graphicsKb = memInfo.graphicsKb,
                            systemKb = memInfo.systemKb,
                            totalSwapKb = memInfo.totalSwapKb,
                        ))
                    }
                }
            } catch (e: Exception) {
                Log.e("MainVM", "Pull-to-refresh failed", e)
                _captureError.value = e.message ?: "Capture failed"
            } finally {
                _isRefreshing.value = false
            }
        }
    }

    fun dismissError() { _captureError.value = null }

    /** Capture a snapshot and return fresh process keys. Compares last 2 snapshots for transitions. */
    suspend fun refreshAndGetProcessKeys(): List<ProcessKeyWithTransitions> = withContext(Dispatchers.IO) {
        // 1. Capture fresh snapshot
        val processes = ShellHelper.getProcessList()
        val frozenPids = ShellHelper.getFrozenPids()
        val snapshot = SnapshotEntity(timestamp = System.currentTimeMillis(), sessionId = java.util.UUID.randomUUID().toString())
        val newEntries = processes.map { p ->
            ProcessEntryEntity(snapshotId = 0, pid = p.pid, name = p.name, uid = p.uid,
                procState = p.procState, frozen = p.pid in frozenPids)
        }
        dao.insertSnapshotWithEntries(snapshot, newEntries)

        // 2. Get the previous snapshot's entries for transition detection
        val start = _pinnedStartMs.value ?: (System.currentTimeMillis() - _timeRange.value.millis)
        val timestamps = dao.getAllTimestampsForExport(start)
        val prevEntries = if (timestamps.size >= 2) {
            val prevTs = timestamps[timestamps.size - 2]
            dao.getAllEntriesForExport(prevTs).filter { it.timestamp == prevTs }
        } else emptyList()
        val prevByKey = prevEntries.associate { ProcessKey(it.name, it.uid) to it }

        // 3. Build current process list with transition detection
        val currentKeys = processes.map { p ->
            val key = ProcessKey(p.name, p.uid)
            val prev = prevByKey[key]
            val stateChanged = prev != null && (prev.procState != p.procState || prev.frozen != (p.pid in frozenPids))
            val unfroze = prev != null && prev.frozen && p.pid !in frozenPids
            ProcessKeyWithTransitions(
                key = key,
                transitions = if (stateChanged) 1 else 0,
                starts = 0, frozenCount = 0,
                lastChangeMs = if (stateChanged) snapshot.timestamp else 0,
                lastChangePriority = STATE_PRIORITY[p.procState] ?: 0,
                lastChangeUnfreeze = unfroze,
            )
        }

        // 4. Historical processes not in current snapshot
        val currentSet = currentKeys.map { it.key }.toSet()
        val allKeys = dao.getDistinctProcessKeysInRange(start)
        val historicalKeys = allKeys
            .map { ProcessKey(it.name, it.uid) }
            .filter { it !in currentSet }
            .map { ProcessKeyWithTransitions(key = it, transitions = 0, starts = 0, frozenCount = 0) }

        // 5. Sort: recently changed first (by time, then priority, then unfreeze), then by state, then historical
        val changed = currentKeys.filter { it.lastChangeMs > 0 }
            .sortedWith(compareByDescending<ProcessKeyWithTransitions> { it.lastChangeMs }
                .thenByDescending { it.lastChangePriority }
                .thenByDescending { it.lastChangeUnfreeze })
        val unchanged = currentKeys.filter { it.lastChangeMs == 0L }
            .sortedByDescending { it.lastChangePriority }
        changed + unchanged + historicalKeys.sortedBy { it.key.name }
    }

    private fun computeTransitions(rows: List<com.procstate.monitor.data.SnapshotDao.TransitionRow>): List<ProcessKeyWithTransitions> {
        val result = mutableListOf<ProcessKeyWithTransitions>()
        var curName = ""; var curUid = ""; var prevState = ""; var prevFrozen = false; var prevPid = 0
        var transitions = 0; var starts = 0; var frozenTransitions = 0
        var lastChangeMs = 0L; var lastChangePriority = 0; var lastChangeUnfreeze = false

        fun flush() {
            if (curName.isNotEmpty()) {
                result.add(ProcessKeyWithTransitions(
                    ProcessKey(curName, curUid), transitions, starts, frozenTransitions, lastChangeMs, lastChangePriority, lastChangeUnfreeze))
            }
        }
        for (row in rows) {
            if (row.name != curName || row.uid != curUid) {
                flush()
                curName = row.name; curUid = row.uid; prevState = row.procState; prevFrozen = row.frozen; prevPid = row.pid
                transitions = 0; starts = 0; frozenTransitions = 0
                lastChangeMs = row.timestamp; lastChangePriority = STATE_PRIORITY[row.procState] ?: 0; lastChangeUnfreeze = false
            } else {
                var changePriority = 0; var changed = false; var unfroze = false
                if (row.procState != prevState) { transitions++; changed = true; changePriority = STATE_PRIORITY[row.procState] ?: 0 }
                if (row.frozen != prevFrozen) {
                    frozenTransitions++; changed = true
                    changePriority = if (!row.frozen) { unfroze = true; maxOf(changePriority, STATE_PRIORITY[row.procState] ?: 0) }
                    else maxOf(changePriority, STATE_PRIORITY["frzn"] ?: 1)
                }
                if (changed) { lastChangeMs = row.timestamp; lastChangePriority = changePriority; lastChangeUnfreeze = unfroze }
                if (row.pid != prevPid && row.pid != 0 && prevPid != 0) starts++
                prevState = row.procState; prevFrozen = row.frozen; prevPid = row.pid
            }
        }
        flush()
        return result.sortedByDescending { it.transitions }
    }

    // ── Proc State tab data ─────────────────────────────────────────────────

    val snapshotsWithCounts: StateFlow<List<SnapshotWithCounts>> =
        effectiveStart
            .flatMapLatest { start ->
                combine(
                    dao.getSnapshotStateCounts(start),
                    dao.getSnapshotFrozenCounts(start),
                ) { stateRows, frozenRows ->
                    val frozenMap = frozenRows.associate { it.id to it.frozenCount }
                    stateRows.groupBy { it.id }.map { (id, group) ->
                        SnapshotWithCounts(
                            id = id,
                            timestamp = group.first().timestamp,
                            stateCounts = group.associate { it.procState to it.count },
                            frozenCount = frozenMap[id] ?: 0,
                        )
                    }.sortedByDescending { it.timestamp }
                }
            }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** Accumulates all states ever seen — never shrinks during the session. */
    private val _seenStates = MutableStateFlow<Set<String>>(
        prefs.getStringSet("seen_states", null) ?: emptySet()
    )
    val visibleStates: StateFlow<Set<String>> = _seenStates.asStateFlow()

    /** State filter: null = show all, empty = nothing selected, non-empty = only these states. */
    private val _stateFilter = MutableStateFlow<Set<String>?>(
        if (prefs.contains("state_filter")) prefs.getStringSet("state_filter", emptySet()) else null
    )
    val stateFilter: StateFlow<Set<String>?> = _stateFilter.asStateFlow()

    val hasStateFilter: Boolean get() = _stateFilter.value != null

    /** Persisted sort key for process picker. */
    private val _pickerSort = MutableStateFlow("last")
    val pickerSort: StateFlow<String> = _pickerSort.asStateFlow()
    fun setPickerSort(sort: String) { _pickerSort.value = sort }
    fun resetPickerSort() { _pickerSort.value = "last" }

    fun setStateFilter(states: Set<String>) {
        _stateFilter.value = states
        prefs.edit().putStringSet("state_filter", states).apply()
    }
    fun clearStateFilter() {
        _stateFilter.value = null
        prefs.edit().remove("state_filter").apply()
    }

    /** Snapshots filtered by selected states (for By State tab only). */
    val filteredSnapshots: StateFlow<List<SnapshotWithCounts>> =
        combine(snapshotsWithCounts, _stateFilter) { snapshots, filter ->
            if (filter == null) snapshots
            else snapshots.map { snapshot ->
                val filtered = snapshot.stateCounts.filter { it.key in filter }
                snapshot.copy(stateCounts = filtered)
            }.filter { it.stateCounts.isNotEmpty() }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    suspend fun getSnapshotEntries(snapshotId: Long): List<ProcessEntryEntity> =
        dao.getEntriesForSnapshot(snapshotId)

    // ── Process tab data (pinned by ProcessKey = name+uid) ──────────────────

    private val _pinnedProcesses = MutableStateFlow<List<ProcessKey>>(emptyList())
    val pinnedProcesses: StateFlow<List<ProcessKey>> = _pinnedProcesses.asStateFlow()

    init {
        loadPinnedProcesses()
        viewModelScope.launch(Dispatchers.IO) {
            ShellHelper.detectRoot()
            _permissionState.value = ShellHelper.checkPermissions(ctx)
        }
        viewModelScope.launch {
            while (isActive) {
                delay(30_000)
                _ticker.value = System.currentTimeMillis()
            }
        }
        // Accumulate all states ever seen in legend — only persist when set grows
        viewModelScope.launch {
            snapshotsWithCounts.collect { snapshots ->
                val newStates = snapshots.flatMap { it.stateCounts.keys }.toSet()
                if (newStates.isNotEmpty()) {
                    val current = _seenStates.value
                    val updated = current + newStates
                    if (updated.size != current.size) {
                        _seenStates.value = updated
                        prefs.edit().putStringSet("seen_states", updated).apply()
                    }
                }
            }
        }
    }

    fun pinProcess(key: ProcessKey) {
        val current = _pinnedProcesses.value
        if (key in current) return
        _pinnedProcesses.value = current + key
        savePinnedProcesses()
        syncAutoMemoryList()
    }

    fun unpinProcess(key: ProcessKey) {
        _pinnedProcesses.value = _pinnedProcesses.value - key
        savePinnedProcesses()
        syncAutoMemoryList()
    }

    fun clearAllPinnedProcesses() {
        _pinnedProcesses.value = emptyList()
        savePinnedProcesses()
        syncAutoMemoryList()
    }

    /** Keep the service's auto-dump list in sync with current pins + toggle. */
    private fun syncAutoMemoryList() {
        CaptureService.autoMemoryEnabled = _autoMemoryDump.value
        CaptureService.autoMemoryNames = if (_autoMemoryDump.value) {
            _pinnedProcesses.value.map { it.name to it.uid }
        } else emptyList()
    }

    /** Timeline rows, filtered by pinned names then by uid in Kotlin. */
    val processTimeline =
        combine(_pinnedProcesses, effectiveStart) { keys, start ->
            keys to start
        }.flatMapLatest { (keys, start) ->
            if (keys.isEmpty()) flowOf(emptyList())
            else {
                val names = keys.map { it.name }.distinct()
                val keySet = keys.toSet()
                dao.getProcessTimeline(names, start).map { rows ->
                    rows.filter { ProcessKey(it.name, it.uid) in keySet }
                }
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** All snapshot timestamps in range (ensures process tab shows rows even when all pinned are dead). */
    val snapshotTimestamps: StateFlow<List<Long>> =
        effectiveStart
            .flatMapLatest { start -> dao.getSnapshotTimestamps(start) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** All process keys with transition counts, computed on IO thread. */
    val allProcessKeysWithTransitions: StateFlow<List<ProcessKeyWithTransitions>> =
        effectiveStart
            .flatMapLatest { start -> dao.getTransitionRows(start) }
            .map { rows ->
                // rows are pre-sorted by name, uid, timestamp from SQL
                // Single pass: detect transitions by comparing consecutive rows for same process
                val result = mutableListOf<ProcessKeyWithTransitions>()
                var curName = ""
                var curUid = ""
                var prevState = ""
                var prevFrozen = false
                var prevPid = 0
                var transitions = 0
                var starts = 0
                var frozenTransitions = 0
                var lastChangeMs = 0L
                var lastChangePriority = 0
                var lastChangeUnfreeze = false

                fun flush() {
                    if (curName.isNotEmpty()) {
                        result.add(ProcessKeyWithTransitions(
                            ProcessKey(curName, curUid), transitions, starts, frozenTransitions, lastChangeMs, lastChangePriority, lastChangeUnfreeze,
                        ))
                    }
                }

                for (row in rows) {
                    if (row.name != curName || row.uid != curUid) {
                        flush()
                        curName = row.name
                        curUid = row.uid
                        prevState = row.procState
                        prevFrozen = row.frozen
                        prevPid = row.pid
                        transitions = 0
                        starts = 0
                        frozenTransitions = 0
                        lastChangeMs = row.timestamp
                        lastChangePriority = STATE_PRIORITY[row.procState] ?: 0
                        lastChangeUnfreeze = false
                    } else {
                        var changed = false
                        var unfroze = false
                        var priority = 0
                        if (row.procState != prevState) {
                            transitions++
                            changed = true
                            priority = STATE_PRIORITY[row.procState] ?: 0
                        }
                        if (row.frozen != prevFrozen) {
                            frozenTransitions++
                            changed = true
                            if (!row.frozen) {
                                // Coming OUT of frozen — tiebreaker only
                                unfroze = true
                                priority = maxOf(priority, STATE_PRIORITY[row.procState] ?: 0)
                            } else {
                                // Going INTO frozen — use frozen priority (lowest)
                                priority = maxOf(priority, STATE_PRIORITY["frzn"] ?: 1)
                            }
                        }
                        if (changed) {
                            lastChangeMs = row.timestamp
                            lastChangePriority = priority
                            lastChangeUnfreeze = unfroze
                        }
                        if (row.pid != prevPid && row.pid != 0 && prevPid != 0) starts++
                        prevState = row.procState
                        prevFrozen = row.frozen
                        prevPid = row.pid
                    }
                }
                flush()
                result.sortedByDescending { it.transitions }
            }
            .flowOn(Dispatchers.IO)
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val snapshotCount: StateFlow<Int> =
        dao.getSnapshotCount()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)

    // ── Memory dump ────────────────────────────────────────────────────────

    private val _memoryDumpProgress = MutableStateFlow<String?>(null)
    val memoryDumpProgress: StateFlow<String?> = _memoryDumpProgress.asStateFlow()

    /**
     * Capture a fresh snapshot, then dump meminfo for a specific process.
     * Stores the memory data linked to the snapshot timestamp.
     */
    fun dumpMemory(pid: Int, name: String, uid: String, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            try {
                // 1. Dump meminfo first (slow op)
                _memoryDumpProgress.value = "Dumping meminfo PID $pid\u2026"
                val memInfo = withContext(Dispatchers.IO) { ShellHelper.getMemInfo(pid) }

                // 2. Capture snapshot (fast), then insert everything with same timestamp
                _memoryDumpProgress.value = "Saving\u2026"
                withContext(Dispatchers.IO) {
                    val processes = ShellHelper.getProcessList()
                    val frozenPids = ShellHelper.getFrozenPids()
                    val snapshot = SnapshotEntity(timestamp = System.currentTimeMillis(), sessionId = java.util.UUID.randomUUID().toString())
                    val entries = processes.map { p ->
                        ProcessEntryEntity(
                            snapshotId = 0,
                            pid = p.pid, name = p.name, uid = p.uid,
                            procState = p.procState,
                            frozen = p.pid in frozenPids,
                        )
                    }
                    dao.insertSnapshotWithEntries(snapshot, entries)
                    dao.insertMemorySnapshot(MemorySnapshotEntity(
                        timestamp = snapshot.timestamp,
                        pid = pid, name = name, uid = uid,
                        totalPssKb = memInfo.totalPssKb,
                        totalRssKb = memInfo.totalRssKb,
                        javaHeapKb = memInfo.javaHeapKb,
                        nativeHeapKb = memInfo.nativeHeapKb,
                        codeKb = memInfo.codeKb,
                        stackKb = memInfo.stackKb,
                        graphicsKb = memInfo.graphicsKb,
                        systemKb = memInfo.systemKb,
                        totalSwapKb = memInfo.totalSwapKb,
                    ))
                }
                _memoryDumpProgress.value = null
                onDone()
            } catch (e: Exception) {
                Log.e("MainVM", "Memory dump failed", e)
                _captureError.value = "Memory dump failed: ${e.message}"
                _memoryDumpProgress.value = null
            }
        }
    }

    fun memoryTimelineFlow(name: String, uid: String): kotlinx.coroutines.flow.Flow<List<MemorySnapshotEntity>> {
        return effectiveStart.flatMapLatest { start ->
            dao.getMemoryTimelineFlow(name, uid, start)
        }
    }

    suspend fun getMemoryForDot(name: String, uid: String, pid: Int, timestamp: Long): MemorySnapshotEntity? =
        dao.getMemoryForDot(name, uid, pid, timestamp)

    suspend fun getMemoryStats(name: String, uid: String, upToMs: Long): MemoryStatsAggregate? {
        val start = _pinnedStartMs.value ?: (System.currentTimeMillis() - _timeRange.value.millis)
        return dao.getMemoryStats(name, uid, start, upToMs)
    }

    /** Set of (timestamp, name, uid) for dots with memory data. */
    val memoryEnrichedDots: StateFlow<Set<MemoryDotKey>> =
        effectiveStart
            .flatMapLatest { start -> dao.getMemoryEnrichedDots(start) }
            .map { rows -> rows.toSet() }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptySet())

    // ── Collapse timeline ─────────────────────────────────────────────────────

    private val _collapseTimeline = MutableStateFlow(prefs.getBoolean("collapse_timeline", false))
    val collapseTimeline: StateFlow<Boolean> = _collapseTimeline.asStateFlow()

    fun toggleCollapseTimeline() {
        val next = !_collapseTimeline.value
        _collapseTimeline.value = next
        prefs.edit().putBoolean("collapse_timeline", next).apply()
    }

    // ── Export ────────────────────────────────────────────────────────────────

    private val _exportRange = MutableStateFlow(prefs.getLong("export_range", 0L))
    val exportRange: StateFlow<Long> = _exportRange.asStateFlow()

    fun setExportRange(millis: Long) {
        _exportRange.value = millis
        prefs.edit().putLong("export_range", millis).apply()
    }

    suspend fun getDataSessions(): List<DataSession> {
        val rows = withContext(Dispatchers.IO) { dao.getSessions() }
        return rows.map { DataSession(it.sessionId, it.startMs, it.endMs, it.count) }
    }

    // ── Data management ─────────────────────────────────────────────────────

    fun clearAllData() {
        viewModelScope.launch(Dispatchers.IO) { dao.deleteAll() }
    }

    fun pruneOlderThan(millis: Long) {
        viewModelScope.launch(Dispatchers.IO) {
            dao.deleteOlderThan(System.currentTimeMillis() - millis)
        }
    }

    // ── Pinned process persistence ──────────────────────────────────────────

    private fun loadPinnedProcesses() {
        val prefs = ctx.getSharedPreferences("pinned", Context.MODE_PRIVATE)
        val listStr = prefs.getString("keys_v2", null)
        if (listStr != null) {
            _pinnedProcesses.value = listStr.split("\n")
                .filter { it.isNotEmpty() }
                .map { ProcessKey.deserialize(it) }
            return
        }
        // Migrate from old name-only format
        val oldPrefs = ctx.getSharedPreferences("tracked", Context.MODE_PRIVATE)
        val oldList = oldPrefs.getString("process_list", null)
        if (oldList != null) {
            _pinnedProcesses.value = oldList.split("|")
                .filter { it.isNotEmpty() }
                .map { ProcessKey(it, "") }
            savePinnedProcesses()
            oldPrefs.edit().clear().apply()
        }
    }

    private fun savePinnedProcesses() {
        ctx.getSharedPreferences("pinned", Context.MODE_PRIVATE).edit()
            .putString("keys_v2", _pinnedProcesses.value.joinToString("\n") { it.serialize() })
            .apply()
    }
}
