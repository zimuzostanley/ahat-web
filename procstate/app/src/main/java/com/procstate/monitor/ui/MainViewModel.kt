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
    HOUR_24("24h", 24 * 60 * 60_000L),
    DAY_7("7d", 7 * 24 * 60 * 60_000L),
    DAY_30("30d", 30L * 24 * 60 * 60_000L),
}

@Immutable
enum class CaptureInterval(val label: String, val seconds: Int) {
    SEC_1("1s", 1),
    SEC_2("2s", 2),
    SEC_5("5s", 5),
    SEC_10("10s", 10),
    SEC_30("30s", 30),
    MIN_1("1m", 60),
    MIN_5("5m", 300),
    MIN_15("15m", 900),
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
    HOUR_24("24h", 1440),
}

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val dao = AppDatabase.get(app).snapshotDao()
    private val ctx: Context get() = getApplication()

    // ── App label cache ────────────────────────────────────────────────────

    private val appLabelCache = mutableMapOf<String, String>()

    // ── Auto memory dump ──────────────────────────────────────────────────

    private val _autoMemoryDump = MutableStateFlow(
        ctx.getSharedPreferences("settings", Context.MODE_PRIVATE)
            .getBoolean("auto_memory_dump", false)
    )
    val autoMemoryDump: StateFlow<Boolean> = _autoMemoryDump.asStateFlow()

    fun setAutoMemoryDump(enabled: Boolean) {
        _autoMemoryDump.value = enabled
        ctx.getSharedPreferences("settings", Context.MODE_PRIVATE).edit()
            .putBoolean("auto_memory_dump", enabled).apply()
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

    private val _timeRange = MutableStateFlow(TimeRange.MIN_30)
    val timeRange: StateFlow<TimeRange> = _timeRange.asStateFlow()

    fun setTimeRange(range: TimeRange) { _timeRange.value = range }

    private val _ticker = MutableStateFlow(System.currentTimeMillis())

    // ── Capture controls ────────────────────────────────────────────────────

    private val _captureInterval = MutableStateFlow(CaptureInterval.SEC_30)
    val captureInterval: StateFlow<CaptureInterval> = _captureInterval.asStateFlow()

    private val _stopAfter = MutableStateFlow(StopAfter.NEVER)
    val stopAfter: StateFlow<StopAfter> = _stopAfter.asStateFlow()

    private val _isCapturing = MutableStateFlow(CaptureService.running)
    val isCapturing: StateFlow<Boolean> = _isCapturing.asStateFlow()

    private val _captureStartMs = MutableStateFlow(0L)
    val captureStartMs: StateFlow<Long> = _captureStartMs.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _captureError = MutableStateFlow<String?>(null)
    val captureError: StateFlow<String?> = _captureError.asStateFlow()

    fun setCaptureInterval(v: CaptureInterval) { _captureInterval.value = v }
    fun setStopAfter(v: StopAfter) { _stopAfter.value = v }

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
            putExtra(CaptureService.EXTRA_INTERVAL_SECONDS, _captureInterval.value.seconds)
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
                    val snapshot = SnapshotEntity(timestamp = System.currentTimeMillis())
                    val entries = processes.map { p ->
                        ProcessEntryEntity(
                            snapshotId = 0,
                            pid = p.pid,
                            name = p.name,
                            uid = p.uid,
                            procState = p.procState,
                            frozen = p.pid in frozenPids,
                        )
                    }
                    dao.insertSnapshotWithEntries(snapshot, entries)
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

    // ── Proc State tab data ─────────────────────────────────────────────────

    val snapshotsWithCounts: StateFlow<List<SnapshotWithCounts>> =
        combine(_timeRange, _ticker) { range, tick -> tick - range.millis }
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
    private val _seenStates = MutableStateFlow<Set<String>>(emptySet())
    val visibleStates: StateFlow<Set<String>> = _seenStates.asStateFlow()

    /** State filter: empty = show all, non-empty = only these states. */
    private val _stateFilter = MutableStateFlow<Set<String>>(emptySet())
    val stateFilter: StateFlow<Set<String>> = _stateFilter.asStateFlow()

    val hasStateFilter: Boolean get() = _stateFilter.value.isNotEmpty()

    fun setStateFilter(states: Set<String>) { _stateFilter.value = states }
    fun clearStateFilter() { _stateFilter.value = emptySet() }

    /** Snapshots filtered by selected states (for By State tab only). */
    val filteredSnapshots: StateFlow<List<SnapshotWithCounts>> =
        combine(snapshotsWithCounts, _stateFilter) { snapshots, filter ->
            if (filter.isEmpty()) snapshots
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
        // Accumulate all states ever seen in legend
        viewModelScope.launch {
            snapshotsWithCounts.collect { snapshots ->
                val newStates = snapshots.flatMap { it.stateCounts.keys }.toSet()
                if (newStates.isNotEmpty()) {
                    _seenStates.value = _seenStates.value + newStates
                }
            }
        }
    }

    fun pinProcess(key: ProcessKey) {
        val current = _pinnedProcesses.value
        if (key in current) return
        _pinnedProcesses.value = current + key
        savePinnedProcesses()
    }

    fun unpinProcess(key: ProcessKey) {
        _pinnedProcesses.value = _pinnedProcesses.value - key
        savePinnedProcesses()
    }

    fun clearAllPinnedProcesses() {
        _pinnedProcesses.value = emptyList()
        savePinnedProcesses()
    }

    /** Timeline rows, filtered by pinned names then by uid in Kotlin. */
    val processTimeline =
        combine(_pinnedProcesses, _timeRange, _ticker) { keys, range, tick ->
            Triple(keys, range, tick)
        }.flatMapLatest { (keys, range, tick) ->
            if (keys.isEmpty()) flowOf(emptyList())
            else {
                val names = keys.map { it.name }.distinct()
                val keySet = keys.toSet()
                dao.getProcessTimeline(names, tick - range.millis).map { rows ->
                    rows.filter { ProcessKey(it.name, it.uid) in keySet }
                }
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** All snapshot timestamps in range (ensures process tab shows rows even when all pinned are dead). */
    val snapshotTimestamps: StateFlow<List<Long>> =
        combine(_timeRange, _ticker) { range, tick -> tick - range.millis }
            .flatMapLatest { start -> dao.getSnapshotTimestamps(start) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** All distinct process keys for the picker. */
    val allProcessKeys: StateFlow<List<ProcessKey>> =
        dao.getDistinctProcessKeys().map { rows ->
            rows.map { ProcessKey(it.name, it.uid) }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

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
            _memoryDumpProgress.value = "Capturing snapshot..."
            try {
                // 1. Capture a fresh snapshot first
                val snapshotTs = withContext(Dispatchers.IO) {
                    val processes = ShellHelper.getProcessList()
                    val frozenPids = ShellHelper.getFrozenPids()
                    val snapshot = SnapshotEntity(timestamp = System.currentTimeMillis())
                    val entries = processes.map { p ->
                        ProcessEntryEntity(
                            snapshotId = 0,
                            pid = p.pid, name = p.name, uid = p.uid,
                            procState = p.procState,
                            frozen = p.pid in frozenPids,
                        )
                    }
                    dao.insertSnapshotWithEntries(snapshot, entries)
                    snapshot.timestamp
                }

                // 2. Dump meminfo for the specific PID
                _memoryDumpProgress.value = "Dumping meminfo PID $pid..."
                val memInfo = withContext(Dispatchers.IO) { ShellHelper.getMemInfo(pid) }

                // 3. Store memory snapshot
                withContext(Dispatchers.IO) {
                    dao.insertMemorySnapshot(MemorySnapshotEntity(
                        timestamp = snapshotTs,
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

    suspend fun getMemoryForDot(name: String, uid: String, pid: Int, timestamp: Long): MemorySnapshotEntity? =
        dao.getMemoryForDot(name, uid, pid, timestamp)

    suspend fun getMemoryStats(name: String, uid: String): MemoryStatsAggregate? {
        val start = System.currentTimeMillis() - _timeRange.value.millis
        return dao.getMemoryStats(name, uid, start)
    }

    /** Set of (timestamp, name, uid) for dots with memory data. */
    val memoryEnrichedDots: StateFlow<Set<MemoryDotKey>> =
        combine(_timeRange, _ticker) { range, tick -> tick - range.millis }
            .flatMapLatest { start -> dao.getMemoryEnrichedDots(start) }
            .map { rows -> rows.toSet() }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptySet())

    // ── Export ────────────────────────────────────────────────────────────────

    private val _isExporting = MutableStateFlow(false)
    val isExporting: StateFlow<Boolean> = _isExporting.asStateFlow()

    fun exportTrace(rangeMillis: Long, writeOutput: suspend (String) -> Unit) {
        if (_isExporting.value) return
        viewModelScope.launch {
            _isExporting.value = true
            try {
                val json = withContext(Dispatchers.IO) {
                    val startMs = if (rangeMillis > 0) {
                        System.currentTimeMillis() - rangeMillis
                    } else 0L
                    val entries = dao.getAllEntriesForExport(startMs)
                    val timestamps = dao.getAllTimestampsForExport(startMs)
                    val memSnapshots = dao.getAllMemoryForExport(startMs)
                    val exportEntries = entries.map { row ->
                        TraceExporter.Entry(
                            timestampMs = row.timestamp,
                            name = row.name,
                            uid = row.uid,
                            pid = row.pid,
                            procState = row.procState,
                            frozen = row.frozen,
                        )
                    }
                    val memEntries = memSnapshots.map { m ->
                        TraceExporter.MemoryEntry(
                            timestampMs = m.timestamp,
                            name = m.name, uid = m.uid, pid = m.pid,
                            totalPssKb = m.totalPssKb, totalRssKb = m.totalRssKb,
                            javaHeapKb = m.javaHeapKb, nativeHeapKb = m.nativeHeapKb,
                            codeKb = m.codeKb, stackKb = m.stackKb,
                            graphicsKb = m.graphicsKb, systemKb = m.systemKb,
                            totalSwapKb = m.totalSwapKb,
                        )
                    }
                    TraceExporter.export(exportEntries, ::getAppLabel, timestamps, memEntries)
                }
                writeOutput(json)
            } catch (e: Exception) {
                Log.e("MainVM", "Export failed", e)
                _captureError.value = "Export failed: ${e.message}"
            } finally {
                _isExporting.value = false
            }
        }
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
