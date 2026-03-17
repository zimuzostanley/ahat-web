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
    MIN_5("5m", 5),
    MIN_15("15m", 15),
    MIN_30("30m", 30),
    HOUR_1("1h", 60),
    HOUR_6("6h", 360),
    HOUR_24("24h", 1440),
}

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val dao = AppDatabase.get(app).snapshotDao()
    private val ctx: Context get() = getApplication()

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

    /**
     * Ticker that periodically slides the start boundary forward.
     * Room's InvalidationTracker handles new inserts automatically (no upper bound),
     * but the start boundary needs periodic refresh so old data drops off.
     */
    private val _ticker = MutableStateFlow(System.currentTimeMillis())

    // ── Capture controls ────────────────────────────────────────────────────

    private val _captureInterval = MutableStateFlow(CaptureInterval.SEC_30)
    val captureInterval: StateFlow<CaptureInterval> = _captureInterval.asStateFlow()

    private val _stopAfter = MutableStateFlow(StopAfter.NEVER)
    val stopAfter: StateFlow<StopAfter> = _stopAfter.asStateFlow()

    private val _isCapturing = MutableStateFlow(CaptureService.running)
    val isCapturing: StateFlow<Boolean> = _isCapturing.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _captureError = MutableStateFlow<String?>(null)
    val captureError: StateFlow<String?> = _captureError.asStateFlow()

    fun setCaptureInterval(v: CaptureInterval) { _captureInterval.value = v }
    fun setStopAfter(v: StopAfter) { _stopAfter.value = v }

    fun refreshCaptureStatus() {
        _isCapturing.value = CaptureService.running
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
    }

    fun stopCapture() {
        val intent = Intent(ctx, CaptureService::class.java).apply {
            action = CaptureService.ACTION_STOP
        }
        ctx.startService(intent)
        _isCapturing.value = false
    }

    /** Pull-to-refresh: capture a snapshot on demand. */
    fun pullToRefresh() {
        if (_isRefreshing.value) return
        viewModelScope.launch {
            _isRefreshing.value = true
            _captureError.value = null
            try {
                withContext(Dispatchers.IO) {
                    val processes = ShellHelper.getProcessList()
                    val snapshot = SnapshotEntity(timestamp = System.currentTimeMillis())
                    val entries = processes.map { p ->
                        ProcessEntryEntity(
                            snapshotId = 0,
                            pid = p.pid,
                            name = p.name,
                            procState = p.procState,
                        )
                    }
                    dao.insertSnapshotWithEntries(snapshot, entries)
                    Log.d("MainVM", "Pull-to-refresh: ${processes.size} processes")
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

    /**
     * Snapshots with state counts. Room re-emits on every insert (no upper bound),
     * so new bars appear in realtime. The ticker only slides the start boundary.
     */
    val snapshotsWithCounts: StateFlow<List<SnapshotWithCounts>> =
        combine(_timeRange, _ticker) { range, tick ->
            tick - range.millis
        }.flatMapLatest { start ->
            dao.getSnapshotStateCounts(start)
        }.map { rows ->
            rows.groupBy { it.id }.map { (id, group) ->
                SnapshotWithCounts(
                    id = id,
                    timestamp = group.first().timestamp,
                    stateCounts = group.associate { it.procState to it.count },
                )
            }.sortedByDescending { it.timestamp }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val visibleStates: StateFlow<Set<String>> =
        snapshotsWithCounts.map { snapshots ->
            snapshots.flatMap { it.stateCounts.keys }.toSet()
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptySet())

    suspend fun getSnapshotEntries(snapshotId: Long): List<ProcessEntryEntity> =
        dao.getEntriesForSnapshot(snapshotId)

    // ── Process tab data ────────────────────────────────────────────────────

    private val _trackedProcesses = MutableStateFlow<List<String>>(emptyList())
    val trackedProcesses: StateFlow<List<String>> = _trackedProcesses.asStateFlow()

    init {
        loadTrackedProcesses()
        viewModelScope.launch(Dispatchers.IO) {
            ShellHelper.detectRoot()
            _permissionState.value = ShellHelper.checkPermissions(ctx)
        }
        // Ticker: slide the start boundary forward every 30s
        viewModelScope.launch {
            while (isActive) {
                delay(30_000)
                _ticker.value = System.currentTimeMillis()
            }
        }
    }

    fun addTrackedProcess(name: String) {
        val current = _trackedProcesses.value
        if (name in current) return
        _trackedProcesses.value = current + name
        saveTrackedProcesses()
    }

    fun removeTrackedProcess(name: String) {
        _trackedProcesses.value = _trackedProcesses.value - name
        saveTrackedProcesses()
    }

    val processTimeline =
        combine(_trackedProcesses, _timeRange, _ticker) { names, range, tick ->
            Triple(names, range, tick)
        }.flatMapLatest { (names, range, tick) ->
            if (names.isEmpty()) flowOf(emptyList())
            else dao.getProcessTimeline(names, tick - range.millis)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val allProcessNames: StateFlow<List<String>> =
        dao.getDistinctProcessNames()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

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

    // ── Tracked process persistence ─────────────────────────────────────────

    private fun loadTrackedProcesses() {
        val prefs = ctx.getSharedPreferences("tracked", Context.MODE_PRIVATE)
        val oldFormat = prefs.getString("processes", null)
        if (oldFormat != null) {
            val list = oldFormat.split("\u0000").filter { it.isNotEmpty() }
            _trackedProcesses.value = list
            prefs.edit()
                .remove("processes")
                .putString("process_list", list.joinToString("|"))
                .apply()
            return
        }
        val listStr = prefs.getString("process_list", null) ?: return
        _trackedProcesses.value = listStr.split("|").filter { it.isNotEmpty() }
    }

    private fun saveTrackedProcesses() {
        ctx.getSharedPreferences("tracked", Context.MODE_PRIVATE).edit()
            .putString("process_list", _trackedProcesses.value.joinToString("|"))
            .apply()
    }
}
