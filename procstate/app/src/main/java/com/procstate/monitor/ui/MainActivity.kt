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
import androidx.activity.enableEdgeToEdge
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
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.navigationBarsPadding
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
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.UnfoldLess
import androidx.compose.material.icons.filled.UnfoldMore
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
import androidx.compose.material3.RadioButton
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
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
        enableEdgeToEdge()
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

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterialApi::class, ExperimentalFoundationApi::class)
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

    val pagerState = androidx.compose.foundation.pager.rememberPagerState(pageCount = { 2 })
    val selectedTab = pagerState.settledPage
    val pagerScope = rememberCoroutineScope()
    var showSettings by remember { mutableStateOf(false) }
    var showProcessPicker by remember { mutableStateOf(false) }
    var showRecordSheet by remember { mutableStateOf(false) }

    var showHelpDialog by remember { mutableStateOf(false) }
    var showColorLegendDialog by remember { mutableStateOf(false) }

    // Temporary sort for By State tab (never persisted)
    var sortColumn by remember { mutableStateOf("timestamp") }
    var sortAscending by remember { mutableStateOf(false) } // default: descending
    var showSortDialog by remember { mutableStateOf(false) }
    var showTimeDropdown by remember { mutableStateOf(false) }

    val isCapturing by vm.isCapturing.collectAsState()
    val isRefreshing by vm.isRefreshing.collectAsState()
    val timeRange by vm.timeRange.collectAsState()
    val pinnedStart by vm.pinnedStartMs.collectAsState()
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
    val collapseTimeline by vm.collapseTimeline.collectAsState()
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
                    if (isCapturing) {
                        IconButton(onClick = vm::stopCapture) {
                            Icon(Icons.Default.Stop, "Stop recording",
                                tint = MaterialTheme.colorScheme.error)
                        }
                    } else {
                        IconButton(onClick = { showRecordSheet = true }) {
                            Icon(Icons.Default.RadioButtonChecked, "Record",
                                tint = MaterialTheme.colorScheme.error)
                        }
                    }
                    IconButton(onClick = {
                        if (selectedTab == 0) showColorLegendDialog = true
                        else showHelpDialog = true
                    }) {
                        Icon(Icons.Default.Info, "Guide")
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
        bottomBar = {
            androidx.compose.material3.Surface(
                color = MaterialTheme.colorScheme.surfaceContainer,
                tonalElevation = 3.dp,
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // Time range
                    if (pinnedStart != null) {
                        // Pinned to a specific recording/snapshot
                        val fmt = remember { java.text.SimpleDateFormat("MMM d HH:mm", java.util.Locale.getDefault()) }
                        androidx.compose.material3.TextButton(onClick = { vm.clearPinnedStart() }) {
                            Icon(Icons.Default.Close, null, Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(fmt.format(pinnedStart!!), style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.primary)
                        }
                    } else {
                        androidx.compose.material3.TextButton(onClick = { showTimeDropdown = true }) {
                            Text(timeRange.label, style = MaterialTheme.typography.labelLarge)
                            Icon(Icons.Default.KeyboardArrowDown, null)
                        }
                    }

                    // Left actions (next to time range)
                    if (selectedTab == 0) {
                        // Sort: click toggles asc/desc, long-press picks column
                        val sortLabel = when (sortColumn) {
                            "timestamp" -> "Time"
                            "total" -> "Total"
                            "frozen" -> "Frozen"
                            else -> ProcStateColors.label(sortColumn)
                        }
                        Box(
                            modifier = Modifier
                                .combinedClickable(
                                    onClick = { sortAscending = !sortAscending },
                                    onLongClick = { showSortDialog = true },
                                )
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    if (sortAscending) Icons.Default.ArrowUpward else Icons.Default.ArrowDownward,
                                    null,
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(sortLabel, style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    } else if (pinnedProcesses.isNotEmpty()) {
                        // Collapse toggle
                        IconButton(onClick = vm::toggleCollapseTimeline) {
                            Icon(
                                if (collapseTimeline) Icons.Default.UnfoldMore else Icons.Default.UnfoldLess,
                                if (collapseTimeline) "Expand" else "Collapse",
                            )
                        }
                    }

                    Spacer(Modifier.weight(1f))

                    // Right actions
                    if (selectedTab == 1 && pinnedProcesses.isNotEmpty()) {
                        IconButton(onClick = vm::clearAllPinnedProcesses) {
                            Icon(Icons.Default.Close, "Unpin all")
                        }
                    }
                    if (selectedTab == 0 && stateFilter != null) {
                        IconButton(onClick = vm::clearStateFilter) {
                            Icon(Icons.Default.Close, "Clear filter")
                        }
                    }
                    // Filter: state filter (tab 0) or process picker (tab 1)
                    IconButton(onClick = {
                        if (selectedTab == 0) showStateFilterSheet = true
                        else showProcessPicker = !showProcessPicker
                    }) {
                        Icon(
                            Icons.Default.FilterList,
                            if (selectedTab == 0) "States" else "Processes",
                            tint = if ((selectedTab == 0 && stateFilter != null) ||
                                       (selectedTab == 1 && pinnedProcesses.isNotEmpty()))
                                MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
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

            // Tabs
            TabRow(
                selectedTabIndex = selectedTab,
                containerColor = MaterialTheme.colorScheme.background,
            ) {
                Tab(selected = selectedTab == 0, onClick = { pagerScope.launch { pagerState.animateScrollToPage(0) } }) {
                    Row(
                        Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text("State")
                        if (stateFilter != null) {
                            Box(
                                Modifier
                                    .size(6.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary),
                            )
                        }
                    }
                }
                Tab(selected = selectedTab == 1, onClick = { pagerScope.launch { pagerState.animateScrollToPage(1) } }) {
                    Text("Process", Modifier.padding(12.dp))
                }
            }

            // Pull-to-refresh wraps tab content
            val pullState = rememberPullRefreshState(isRefreshing, vm::pullToRefresh)

            // Apply temporary sort to By State snapshots
            val sortedSnapshots = remember(filteredSnapshots, sortColumn, sortAscending) {
                val selector: (com.procstate.monitor.data.SnapshotWithCounts) -> Long = { snap ->
                    when (sortColumn) {
                        "timestamp" -> snap.timestamp
                        "total" -> snap.totalProcesses.toLong()
                        "frozen" -> snap.frozenCount.toLong()
                        else -> (snap.stateCounts[sortColumn] ?: 0).toLong()
                    }
                }
                if (sortAscending) filteredSnapshots.sortedBy(selector)
                else filteredSnapshots.sortedByDescending(selector)
            }

            Box(Modifier.fillMaxSize().pullRefresh(pullState)) {
                androidx.compose.foundation.pager.HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxSize(),
                ) { page -> when (page) {
                    0 -> ProcStateTab(
                        snapshots = sortedSnapshots,
                        pinnedProcesses = pinnedProcesses,
                        onPinProcess = vm::pinProcess,
                        onUnpinProcess = vm::unpinProcess,
                        onLoadEntries = vm::getSnapshotEntries,
                        isRefreshing = isRefreshing,
                        getAppLabel = vm::getAppLabel,
                        hasData = snapshotTimestamps.isNotEmpty(),
                        hasStateFilter = stateFilter != null,
                        visibleStates = visibleStates,
                        stateFilter = stateFilter ?: emptySet(),
                        onSetStateFilter = { vm.setStateFilter(it) },
                        onOpenFilterSheet = { showStateFilterSheet = true },
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
                            collapsed = collapseTimeline,
                            showPicker = showProcessPicker,
                            onOpenPicker = { showProcessPicker = true },
                            onDismissPicker = { showProcessPicker = false },
                        )
                    }
                } }

                PullRefreshIndicator(
                    refreshing = isRefreshing,
                    state = pullState,
                    modifier = Modifier.align(Alignment.TopCenter),
                    contentColor = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }

    // Time range bottom sheet
    if (showTimeDropdown) {
        ModalBottomSheet(
            onDismissRequest = { showTimeDropdown = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text("Time Range", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    for (range in TimeRange.entries) {
                        FilterChip(
                            selected = timeRange == range,
                            onClick = { vm.setTimeRange(range); vm.clearPinnedStart(); showTimeDropdown = false },
                            label = { Text(range.label) },
                        )
                    }
                }
                Spacer(Modifier.height(16.dp))
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

    // State filter sheet — collect stateFilter inside the sheet's composition
    // so changes from callbacks (Clear all, toggle) trigger recomposition here
    if (showStateFilterSheet) {
        ModalBottomSheet(
            onDismissRequest = { showStateFilterSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        ) {
            val sheetFilter by vm.stateFilter.collectAsState()
            StateFilterSheet(
                allStates = visibleStates,
                selectedStates = sheetFilter,
                onChanged = { vm.setStateFilter(it) },
                onShowAll = { vm.clearStateFilter() },
            )
        }
    }

    // Sort column picker dialog
    if (showSortDialog) {
        val sortOptions = remember(visibleStates) {
            listOf("timestamp" to "Timestamp", "total" to "Total processes", "frozen" to "Frozen count") +
                visibleStates.sortedBy { ProcStateColors.label(it).lowercase() }
                    .map { it to ProcStateColors.label(it) }
        }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showSortDialog = false },
            title = { Text("Sort by") },
            text = {
                val isDark = com.procstate.monitor.ui.theme.LocalIsDarkTheme.current
                LazyColumn {
                    items(sortOptions) { (key, label) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(4.dp))
                                .clickable {
                                    sortColumn = key
                                    showSortDialog = false
                                }
                                .padding(vertical = 8.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = sortColumn == key,
                                onClick = {
                                    sortColumn = key
                                    showSortDialog = false
                                },
                            )
                            Spacer(Modifier.width(8.dp))
                            if (key != "timestamp" && key != "total" && key != "frozen") {
                                Box(
                                    Modifier
                                        .size(10.dp)
                                        .clip(CircleShape)
                                        .background(ProcStateColors.get(key, isDark)),
                                )
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = { showSortDialog = false }) {
                    Text("Cancel")
                }
            },
        )
    }

    // Settings bottom sheet
    if (showSettings) {
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            val activity = LocalContext.current as MainActivity
            val autoMemDump by vm.autoMemoryDump.collectAsState()
            val exportRange by vm.exportRange.collectAsState()
            val isExporting by com.procstate.monitor.service.ExportService.runningFlow.collectAsState()
            val exportProgress by com.procstate.monitor.service.ExportService.progressFlow.collectAsState()
            SettingsSheet(
                themeMode = themeMode,
                snapshotCount = snapshotCount,
                isExporting = isExporting,
                exportProgress = exportProgress,
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
                onLoadSessions = { vm.getDataSessions() },
                onPinSession = { startMs ->
                    vm.pinStartTime(startMs)
                    showSettings = false
                },
            )
        }
    }

    // Help dialog — dot shapes & symbols guide
    if (showHelpDialog) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showHelpDialog = false },
            title = { Text("By Process — Dot Guide") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    HelpRow("\u25CF", "Circle", "Same state as previous snapshot")
                    HelpRow("\u25A0", "Square", "State or frozen status changed")
                    HelpRow("\u25B2", "Triangle", "Process restarted (new PID)")
                    HelpRow("\u2715", "Cross overlay", "Process is frozen")
                    HelpRow("\u25CB", "Empty circle", "Process not running")
                    HelpRow("\u2504", "Dashed border", "Has memory dump data")
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Colors correspond to process state (see legend). Tap a dot for details, long-press a timestamp to set a diff anchor.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = { showHelpDialog = false }) {
                    Text("Got it")
                }
            },
        )
    }

    // Color legend dialog (By State tab)
    if (showColorLegendDialog) {
        val isDark = com.procstate.monitor.ui.theme.LocalIsDarkTheme.current
        val states = remember(visibleStates) {
            visibleStates.sortedBy { ProcStateColors.label(it).lowercase() }
        }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showColorLegendDialog = false },
            title = { Text("State Colors") },
            text = {
                LazyColumn {
                    items(states) { state ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(12.dp)
                                    .clip(CircleShape)
                                    .background(ProcStateColors.get(state, isDark)),
                            )
                            Spacer(Modifier.width(12.dp))
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
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = { showColorLegendDialog = false }) {
                    Text("Got it")
                }
            },
        )
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


// ── State filter sheet ──────────────────────────────────────────────────────

@Composable
private fun StateFilterSheet(
    allStates: Set<String>,
    selectedStates: Set<String>?,
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

    // null = show all (no filter active)
    val isShowAll = selectedStates == null

    fun toggle(state: String) {
        if (isShowAll) {
            // Currently showing all — switch to filter with all except this one
            onChanged(allStates - state)
        } else if (state in selectedStates!!) {
            onChanged(selectedStates - state)
        } else {
            onChanged(selectedStates + state)
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
            if (isShowAll) {
                androidx.compose.material3.TextButton(onClick = { onChanged(emptySet()) }) {
                    Text("Clear all")
                }
            } else {
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
                val checked = isShowAll || state in (selectedStates ?: emptySet())
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

@Composable
private fun HelpRow(symbol: String, name: String, description: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            symbol,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.width(24.dp),
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.width(12.dp))
        Column {
            Text(name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
