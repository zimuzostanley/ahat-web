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
import com.procstate.monitor.data.ProcessEntryEntity
import com.procstate.monitor.data.ProcessKey
import com.procstate.monitor.data.ShellHelper
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
