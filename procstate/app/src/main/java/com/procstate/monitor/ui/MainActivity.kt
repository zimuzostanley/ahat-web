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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
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
import com.procstate.monitor.data.ShellHelper
import com.procstate.monitor.service.CaptureService
import com.procstate.monitor.ui.theme.ProcStateTheme

class MainActivity : ComponentActivity() {

    private val notifPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {}

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

    val snapshots by vm.snapshotsWithCounts.collectAsState()
    val trackedProcesses by vm.trackedProcesses.collectAsState()
    val timelineRows by vm.processTimeline.collectAsState()
    val allProcessNames by vm.allProcessNames.collectAsState()
    val visibleStates by vm.visibleStates.collectAsState()

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
                            Text(
                                buildString {
                                    append("REC ${captureInterval.label}")
                                    if (stopAfter != StopAfter.NEVER) {
                                        append(" \u00b7 ${stopAfter.label}")
                                    }
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error,
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
                    // Process tab actions
                    if (selectedTab == 1) {
                        if (trackedProcesses.isNotEmpty()) {
                            IconButton(onClick = vm::clearAllTrackedProcesses) {
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
            ProcStateLegend(visibleStates)

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
                        snapshots = snapshots,
                        trackedProcesses = trackedProcesses,
                        onAddTrackedProcess = vm::addTrackedProcess,
                        onRemoveTrackedProcess = vm::removeTrackedProcess,
                        onLoadEntries = vm::getSnapshotEntries,
                    )
                    1 -> ProcessTab(
                        trackedProcesses = trackedProcesses,
                        timelineRows = timelineRows,
                        allProcessNames = allProcessNames,
                        onAddProcess = vm::addTrackedProcess,
                        onRemoveProcess = vm::removeTrackedProcess,
                        showPicker = showProcessPicker,
                        onOpenPicker = { showProcessPicker = true },
                        onDismissPicker = { showProcessPicker = false },
                    )
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

    // Settings bottom sheet
    if (showSettings) {
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            SettingsSheet(
                themeMode = themeMode,
                snapshotCount = snapshotCount,
                onSetTheme = vm::setTheme,
                onClearAll = vm::clearAllData,
                onPrune = vm::pruneOlderThan,
                onDismiss = { showSettings = false },
            )
        }
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
