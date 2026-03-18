package com.procstate.monitor.ui

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.procstate.monitor.data.ProcessKey
import com.procstate.monitor.data.ShellHelper
import com.procstate.monitor.ui.theme.ProcStateColors
import com.procstate.monitor.service.CaptureService
import com.procstate.monitor.ui.theme.ProcStateTheme

class MainActivity : ComponentActivity() {

    private val notifPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {}

    // For Perfetto export
    var pendingExportRange = 0L

    val exportFileLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri == null) return@registerForActivityResult
        val intent = Intent(this, com.procstate.monitor.service.ExportService::class.java).apply {
            action = com.procstate.monitor.service.ExportService.ACTION_EXPORT
            putExtra(com.procstate.monitor.service.ExportService.EXTRA_RANGE_MS, pendingExportRange)
            putExtra(com.procstate.monitor.service.ExportService.EXTRA_URI, uri.toString())
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent)
        else startService(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            val vm: MainViewModel = viewModel()
            val themeMode by vm.themeMode.collectAsState()
            ProcStateTheme(themeMode = themeMode) { ProcStateApp(vm) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterialApi::class)
@Composable
private fun ProcStateApp(vm: MainViewModel) {
    val context = LocalContext.current

    DisposableEffect(Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) { vm.refreshCaptureStatus() }
        }
        val filter = IntentFilter(CaptureService.ACTION_SNAPSHOT_SAVED)
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
        onDispose { context.unregisterReceiver(receiver) }
    }

    var selectedTab by remember { mutableIntStateOf(0) }
    var showSettings by remember { mutableStateOf(false) }
    var showProcessPicker by remember { mutableStateOf(false) }
    var showRecordSheet by remember { mutableStateOf(false) }

    val isCapturing by vm.isCapturing.collectAsState()
    val isRefreshing by vm.isRefreshing.collectAsState()
    val timeRange by vm.timeRange.collectAsState()
    val captureInterval by vm.captureInterval.collectAsState()
    val stopAfter by vm.stopAfter.collectAsState()
    val snapshotCount by vm.snapshotCount.collectAsState()
    val themeMode by vm.themeMode.collectAsState()
    val captureError by vm.captureError.collectAsState()
    val permState by vm.permissionState.collectAsState()
    val captureStartMs by vm.captureStartMs.collectAsState()

    val snapshots by vm.snapshotsWithCounts.collectAsState()
    val filteredSnapshots by vm.filteredSnapshots.collectAsState()
    val pinnedProcesses by vm.pinnedProcesses.collectAsState()
    val timelineRows by vm.processTimeline.collectAsState()
    val snapshotTimestamps by vm.snapshotTimestamps.collectAsState()
    val allProcessKeys by vm.allProcessKeys.collectAsState()
    val allProcessKeysWithTransitions by vm.allProcessKeysWithTransitions.collectAsState()
    val visibleStates by vm.visibleStates.collectAsState()
    val stateFilter by vm.stateFilter.collectAsState()
    var showStateFilterSheet by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("ProcState", fontWeight = FontWeight.SemiBold)
                        if (isCapturing) {
                            Spacer(Modifier.width(8.dp))
                            PulsingDot()
                            Spacer(Modifier.width(6.dp))
                            RecordingStatus(
                                intervalLabel = captureInterval.label,
                                stopAfterMinutes = stopAfter.minutes,
                                startMs = captureStartMs,
                                onDetectStopped = vm::refreshCaptureStatus,
                            )
                        }
                    }
                },
                actions = {
                    // Record / Stop button in top bar
                    if (isCapturing) {
                        IconButton(onClick = vm::stopCapture) {
                            Icon(Icons.Default.Stop, "Stop recording",
                                tint = MaterialTheme.colorScheme.error)
                        }
                    } else {
                        IconButton(onClick = { showRecordSheet = true }) {
                            Icon(Icons.Default.PlayArrow, "Record")
                        }
                    }
                    // State tab: clear filter button
                    if (selectedTab == 0 && stateFilter.isNotEmpty()) {
                        IconButton(onClick = vm::clearStateFilter) {
                            Icon(Icons.Default.Close, "Clear state filter",
                                modifier = Modifier.size(20.dp))
                        }
                    }
                    // Process tab actions
                    if (selectedTab == 1) {
                        if (pinnedProcesses.isNotEmpty()) {
                            IconButton(onClick = vm::clearAllPinnedProcesses) {
                                Icon(Icons.Default.Close, "Unpin all",
                                    modifier = Modifier.size(20.dp))
                            }
                        }
                        IconButton(onClick = { showProcessPicker = !showProcessPicker }) {
                            Icon(
                                if (showProcessPicker) Icons.Default.Close else Icons.Default.Add,
                                "Add process",
                            )
                        }
                    }
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, "Settings")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(MaterialTheme.colorScheme.background),
        ) {
            // Permission warning
            if (!permState.canCapture) {
                PermissionBanner(permState)
            }

            // Error banner
            AnimatedVisibility(
                visible = captureError != null,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically(),
            ) {
                captureError?.let { error ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.errorContainer)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            error,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = vm::dismissError, modifier = Modifier.size(20.dp)) {
                            Icon(Icons.Default.Close, null, Modifier.size(14.dp))
                        }
                    }
                }
            }

            // Time range filter
            TimeRangeSelector(selected = timeRange, onSelect = vm::setTimeRange)

            // Legend
            ProcStateLegend(
                visibleStates = visibleStates,
                stateFilter = stateFilter,
                onTap = { showStateFilterSheet = true },
            )

            // Tabs
            TabRow(
                selectedTabIndex = selectedTab,
                containerColor = MaterialTheme.colorScheme.background,
            ) {
                Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }) {
                    Text("By State", Modifier.padding(12.dp))
                }
                Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }) {
                    Text("By Process", Modifier.padding(12.dp))
                }
            }

            // Pull-to-refresh wraps tab content
            val pullState = rememberPullRefreshState(isRefreshing, vm::pullToRefresh)

            Box(Modifier.fillMaxSize().pullRefresh(pullState)) {
                when (selectedTab) {
                    0 -> ProcStateTab(
                        snapshots = filteredSnapshots,
                        pinnedProcesses = pinnedProcesses,
                        onPinProcess = vm::pinProcess,
                        onUnpinProcess = vm::unpinProcess,
                        onLoadEntries = vm::getSnapshotEntries,
                        isRefreshing = isRefreshing,
                        getAppLabel = vm::getAppLabel,
                        hasData = snapshotTimestamps.isNotEmpty(),
                        hasStateFilter = stateFilter.isNotEmpty(),
                    )
                    1 -> {
                        val memDumpProgress by vm.memoryDumpProgress.collectAsState()
                        val memEnrichedDots by vm.memoryEnrichedDots.collectAsState()
                        ProcessTab(
                            isRefreshing = isRefreshing,
                            getAppLabel = vm::getAppLabel,
                            onDumpMemory = { pid, name, uid, onDone ->
                                vm.dumpMemory(pid, name, uid, onDone)
                            },
                            getMemoryForDot = vm::getMemoryForDot,
                            getMemoryStats = vm::getMemoryStats,
                            memoryDumpProgress = memDumpProgress,
                            memoryEnrichedDots = memEnrichedDots,
                            pinnedProcesses = pinnedProcesses,
                            timelineRows = timelineRows,
                            allSnapshotTimestamps = snapshotTimestamps,
                            allProcessKeys = allProcessKeys,
                            allProcessKeysWithTransitions = allProcessKeysWithTransitions,
                            pickerSort = vm.pickerSort.collectAsState().value,
                            onPickerSortChange = vm::setPickerSort,
                            onPinProcess = vm::pinProcess,
                            onUnpinProcess = vm::unpinProcess,
                            showPicker = showProcessPicker,
                            onOpenPicker = { showProcessPicker = true },
                            onDismissPicker = { showProcessPicker = false },
                        )
                    }
                }

                PullRefreshIndicator(
                    refreshing = isRefreshing,
                    state = pullState,
                    modifier = Modifier.align(Alignment.TopCenter),
                    contentColor = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }

    // Record bottom sheet
    if (showRecordSheet) {
        ModalBottomSheet(
            onDismissRequest = { showRecordSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            RecordSheet(
                captureInterval = captureInterval,
                stopAfter = stopAfter,
                onIntervalChange = vm::setCaptureInterval,
                onStopAfterChange = vm::setStopAfter,
                onStart = {
                    vm.startCapture()
                    showRecordSheet = false
                },
            )
        }
    }

    // State filter sheet
    if (showStateFilterSheet) {
        ModalBottomSheet(
            onDismissRequest = { showStateFilterSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        ) {
            StateFilterSheet(
                allStates = visibleStates,
                selectedStates = stateFilter,
                onChanged = { vm.setStateFilter(it) },
                onShowAll = { vm.clearStateFilter() },
            )
        }
    }

    // Settings bottom sheet
    if (showSettings) {
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            val activity = LocalContext.current as MainActivity
            var isExporting by remember { mutableStateOf(com.procstate.monitor.service.ExportService.running) }
            // Listen for export done
            DisposableEffect(Unit) {
                val r = object : android.content.BroadcastReceiver() {
                    override fun onReceive(ctx: android.content.Context?, i: Intent?) {
                        isExporting = com.procstate.monitor.service.ExportService.running
                    }
                }
                val f = IntentFilter(com.procstate.monitor.service.ExportService.ACTION_DONE)
                if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED)
                else context.registerReceiver(r, f)
                onDispose { context.unregisterReceiver(r) }
            }
            val autoMemDump by vm.autoMemoryDump.collectAsState()
            val exportRange by vm.exportRange.collectAsState()
            SettingsSheet(
                themeMode = themeMode,
                snapshotCount = snapshotCount,
                isExporting = isExporting,
                autoMemoryDump = autoMemDump,
                exportRange = exportRange,
                onSetAutoMemoryDump = vm::setAutoMemoryDump,
                onSetTheme = vm::setTheme,
                onClearAll = vm::clearAllData,
                onPrune = vm::pruneOlderThan,
                onExport = { rangeMs ->
                    activity.pendingExportRange = rangeMs
                    val filename = "procstate_${System.currentTimeMillis()}.json"
                    activity.exportFileLauncher.launch(filename)
                },
                onExportRangeChange = vm::setExportRange,
                onDismiss = { showSettings = false },
            )
        }
    }
}

// ── Recording status with live countdown ────────────────────────────────────

@Composable
private fun RecordingStatus(
    intervalLabel: String,
    stopAfterMinutes: Int,
    startMs: Long,
    onDetectStopped: () -> Unit,
) {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }

    // Tick every second; also poll CaptureService.running to catch stop
    androidx.compose.runtime.LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(1000)
            now = System.currentTimeMillis()
            if (!CaptureService.running) {
                onDetectStopped()
                break
            }
        }
    }

    val elapsedMs = if (startMs > 0) (now - startMs).coerceAtLeast(0) else 0L

    val text = if (stopAfterMinutes > 0) {
        val totalMs = stopAfterMinutes * 60_000L
        "REC $intervalLabel \u00b7 ${formatDuration(elapsedMs)}/${formatDuration(totalMs)}"
    } else {
        "REC $intervalLabel \u00b7 ${formatDuration(elapsedMs)}"
    }

    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.error,
    )
}

private fun formatDuration(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return when {
        h > 0 -> "%d:%02d:%02d".format(h, m, s)
        else -> "%d:%02d".format(m, s)
    }
}

// ── Record sheet ────────────────────────────────────────────────────────────

@Composable
private fun RecordSheet(
    captureInterval: CaptureInterval,
    stopAfter: StopAfter,
    onIntervalChange: (CaptureInterval) -> Unit,
    onStopAfterChange: (StopAfter) -> Unit,
    onStart: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Text("Record", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.size(16.dp))

        Text("Capture every", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.size(8.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            for (interval in CaptureInterval.entries) {
                FilterChip(
                    selected = captureInterval == interval,
                    onClick = { onIntervalChange(interval) },
                    label = { Text(interval.label) },
                )
            }
        }

        Spacer(Modifier.size(16.dp))

        Text("Stop after", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.size(8.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            for (stop in StopAfter.entries) {
                FilterChip(
                    selected = stopAfter == stop,
                    onClick = { onStopAfterChange(stop) },
                    label = { Text(stop.label) },
                )
            }
        }

        Spacer(Modifier.size(24.dp))

        Button(
            onClick = onStart,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Start Recording")
        }

        Spacer(Modifier.size(16.dp))
    }
}

// ── Permission banner ───────────────────────────────────────────────────────

@Composable
private fun PermissionBanner(permState: ShellHelper.PermissionState) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.tertiaryContainer)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Default.Warning, null, Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onTertiaryContainer,
        )
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "Missing permissions",
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            for (cmd in permState.grantCommands) {
                Text(
                    cmd,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.8f),
                )
            }
        }
    }
}

// ── Pulsing recording indicator ─────────────────────────────────────────────

@Composable
private fun PulsingDot() {
    val transition = rememberInfiniteTransition(label = "pulse")
    val alpha by transition.animateFloat(
        initialValue = 1f, targetValue = 0.3f,
        animationSpec = infiniteRepeatable(tween(800), RepeatMode.Reverse),
        label = "pulseAlpha",
    )
    Box(
        modifier = Modifier
            .size(8.dp)
            .alpha(alpha)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.error),
    )
}

// ── Time range chips ────────────────────────────────────────────────────────

@Composable
private fun TimeRangeSelector(selected: TimeRange, onSelect: (TimeRange) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (range in TimeRange.entries) {
            FilterChip(
                selected = selected == range,
                onClick = { onSelect(range) },
                label = { Text(range.label, style = MaterialTheme.typography.labelSmall) },
            )
        }
    }
}

// ── State filter sheet ──────────────────────────────────────────────────────

@Composable
private fun StateFilterSheet(
    allStates: Set<String>,
    selectedStates: Set<String>,
    onChanged: (Set<String>) -> Unit,
    onShowAll: () -> Unit,
) {
    var search by remember { mutableStateOf("") }

    val sorted = remember(allStates) {
        allStates.sortedBy { ProcStateColors.label(it).lowercase() }
    }
    val filtered = remember(sorted, search) {
        if (search.isBlank()) sorted
        else sorted.filter {
            search.lowercase() in ProcStateColors.label(it).lowercase() || search.lowercase() in it.lowercase()
        }
    }

    // All selected by default (empty filter = show all)
    val isShowAll = selectedStates.isEmpty()

    fun toggle(state: String) {
        if (isShowAll) {
            // Currently showing all — switching to filter with all except this one
            onChanged((allStates - state))
        } else if (state in selectedStates) {
            val next = selectedStates - state
            if (next.isEmpty()) onShowAll() // deselecting last = show all
            else onChanged(next)
        } else {
            val next = selectedStates + state
            if (next.size >= allStates.size) onShowAll() // selecting all = show all
            else onChanged(next)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.8f)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Filter States", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.weight(1f))
            if (!isShowAll) {
                androidx.compose.material3.TextButton(onClick = onShowAll) {
                    Text("Show all")
                }
            }
        }
        Spacer(Modifier.height(8.dp))

        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search states\u2026") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = {
                if (search.isNotEmpty()) {
                    IconButton(onClick = { search = "" }) { Icon(Icons.Default.Close, null) }
                }
            },
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(filtered) { state ->
                val isDark = com.procstate.monitor.ui.theme.LocalIsDarkTheme.current
                val color = ProcStateColors.get(state, isDark)
                val checked = isShowAll || state in selectedStates
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .clickable { toggle(state) }
                        .padding(vertical = 6.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    androidx.compose.material3.Checkbox(
                        checked = checked,
                        onCheckedChange = { toggle(state) },
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(color),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        ProcStateColors.label(state),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        state,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}
