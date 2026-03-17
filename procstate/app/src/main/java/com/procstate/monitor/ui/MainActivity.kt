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
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
    ) { /* best effort */ }

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
            ProcStateTheme(themeMode = themeMode) {
                ProcStateApp(vm)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProcStateApp(vm: MainViewModel) {
    val context = LocalContext.current

    DisposableEffect(Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                vm.refreshCaptureStatus()
            }
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

    val isCapturing by vm.isCapturing.collectAsState()
    val isSnapping by vm.isSnapping.collectAsState()
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
                                "REC",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                },
                actions = {
                    if (selectedTab == 1) {
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
            // Permission warning banner
            if (!permState.canCapture) {
                PermissionBanner(permState)
            }

            // Capture controls
            CaptureControls(
                isCapturing = isCapturing,
                isSnapping = isSnapping,
                captureInterval = captureInterval,
                stopAfter = stopAfter,
                onIntervalChange = vm::setCaptureInterval,
                onStopAfterChange = vm::setStopAfter,
                onStart = vm::startCapture,
                onStop = vm::stopCapture,
                onCaptureOnce = vm::captureOnce,
            )

            // Error banner
            androidx.compose.animation.AnimatedVisibility(
                visible = captureError != null,
                enter = androidx.compose.animation.fadeIn() + androidx.compose.animation.expandVertically(),
                exit = androidx.compose.animation.fadeOut() + androidx.compose.animation.shrinkVertically(),
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

            // Time range filter (scrollable)
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

            when (selectedTab) {
                0 -> ProcStateTab(
                    snapshots = snapshots,
                    trackedProcesses = trackedProcesses,
                    onAddTrackedProcess = vm::addTrackedProcess,
                    onLoadEntries = vm::getSnapshotEntries,
                )
                1 -> ProcessTab(
                    trackedProcesses = trackedProcesses,
                    timelineRows = timelineRows,
                    allProcessNames = allProcessNames,
                    onAddProcess = vm::addTrackedProcess,
                    onRemoveProcess = vm::removeTrackedProcess,
                    showPicker = showProcessPicker,
                    onDismissPicker = { showProcessPicker = false },
                )
            }
        }
    }

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
            Icons.Default.Warning,
            null,
            Modifier.size(16.dp),
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
        initialValue = 1f,
        targetValue = 0.3f,
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

// ── Capture controls ────────────────────────────────────────────────────────

@Composable
private fun CaptureControls(
    isCapturing: Boolean,
    isSnapping: Boolean,
    captureInterval: CaptureInterval,
    stopAfter: StopAfter,
    onIntervalChange: (CaptureInterval) -> Unit,
    onStopAfterChange: (StopAfter) -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onCaptureOnce: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        // Main row: Record/Stop + Snapshot + expand arrow
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (isCapturing) {
                Button(
                    onClick = onStop,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                    ),
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Default.Stop, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Stop")
                }
            } else {
                Button(onClick = onStart, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Record")
                }
            }

            OutlinedButton(
                onClick = onCaptureOnce,
                enabled = !isSnapping,
            ) {
                if (isSnapping) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Default.CameraAlt, null, Modifier.size(16.dp))
                }
                Spacer(Modifier.width(4.dp))
                Text("Snapshot")
            }

            // Expand/collapse arrow with smooth rotation
            val arrowRotation by androidx.compose.animation.core.animateFloatAsState(
                targetValue = if (expanded) 180f else 0f,
                animationSpec = androidx.compose.animation.core.tween(300),
                label = "arrowRotation",
            )
            IconButton(
                onClick = { expanded = !expanded },
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    Icons.Default.KeyboardArrowDown,
                    contentDescription = "Recording options",
                    modifier = Modifier
                        .size(20.dp)
                        .graphicsLayer { rotationZ = arrowRotation },
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Collapsible details
        androidx.compose.animation.AnimatedVisibility(
            visible = expanded,
            enter = androidx.compose.animation.expandVertically(),
            exit = androidx.compose.animation.shrinkVertically(),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Every:",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                DropdownSelector(
                    selected = captureInterval,
                    options = CaptureInterval.entries,
                    label = { it.label },
                    onSelect = onIntervalChange,
                    enabled = !isCapturing,
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    "Stop after:",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                DropdownSelector(
                    selected = stopAfter,
                    options = StopAfter.entries,
                    label = { it.label },
                    onSelect = onStopAfterChange,
                    enabled = !isCapturing,
                )
            }
        }
    }
}

@Composable
private fun <T> DropdownSelector(
    selected: T,
    options: List<T>,
    label: (T) -> String,
    onSelect: (T) -> Unit,
    enabled: Boolean = true,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        FilledTonalButton(
            onClick = { if (enabled) expanded = true },
            enabled = enabled,
            contentPadding = ButtonDefaults.TextButtonContentPadding,
            shape = RoundedCornerShape(4.dp),
        ) {
            Text(label(selected), style = MaterialTheme.typography.bodySmall)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for (option in options) {
                DropdownMenuItem(
                    text = { Text(label(option), style = MaterialTheme.typography.bodySmall) },
                    onClick = { onSelect(option); expanded = false },
                )
            }
        }
    }
}

// ── Time range chips (scrollable) ───────────────────────────────────────────

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
