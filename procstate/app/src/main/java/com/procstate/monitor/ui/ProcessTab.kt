package com.procstate.monitor.ui

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.procstate.monitor.data.MemoryDotKey
import com.procstate.monitor.data.MemorySnapshotEntity
import com.procstate.monitor.data.ProcessKey
import com.procstate.monitor.data.ProcessKeyWithTransitions
import com.procstate.monitor.data.ProcessTimelineRow
import com.procstate.monitor.ui.theme.LocalIsDarkTheme
import com.procstate.monitor.ui.theme.ProcStateColors
import kotlinx.coroutines.launch

private data class TrackColor(val light: Color, val dark: Color)

private val TrackColors = listOf(
    TrackColor(Color(0xFF4A55A2), Color(0xFF8B9CF7)),
    TrackColor(Color(0xFF0F9D9F), Color(0xFF5EEAD4)),
    TrackColor(Color(0xFFDB2777), Color(0xFFF472B6)),
    TrackColor(Color(0xFFD97706), Color(0xFFFBBF24)),
    TrackColor(Color(0xFF16A34A), Color(0xFF4ADE80)),
    TrackColor(Color(0xFF7C3AED), Color(0xFFA78BFA)),
    TrackColor(Color(0xFFDC2626), Color(0xFFF87171)),
    TrackColor(Color(0xFF0891B2), Color(0xFF22D3EE)),
)

private const val COL_WIDTH_DP = 80

private enum class Marker { NORMAL, STARTED }

private data class ProcessDot(
    val procState: String,
    val frozen: Boolean,
    val pid: Int,
    val uid: String,
    val marker: Marker,
    val stateChanged: Boolean = false,
)

data class DotDetail(
    val name: String,
    val uid: String,
    val pid: Int,
    val state: String,
    val stateLabel: String,
    val frozen: Boolean,
    val started: Boolean,
    val timestamp: String,
    val timestampMs: Long = 0,
    val stateHistory: List<Pair<String, Int>> = emptyList(),
    val frozenCount: Int = 0,
    val restartCount: Int = 0,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProcessTab(
    getAppLabel: (String) -> String = { it.substringAfterLast('.') },
    onDumpMemory: ((pid: Int, name: String, uid: String, onDone: () -> Unit) -> Unit)? = null,
    getMemoryForDot: (suspend (name: String, uid: String, pid: Int, timestamp: Long) -> MemorySnapshotEntity?)? = null,
    memoryTimelineFlow: ((name: String, uid: String) -> kotlinx.coroutines.flow.Flow<List<MemorySnapshotEntity>>)? = null,
    memoryDumpProgress: String? = null,
    memoryEnrichedDots: Set<MemoryDotKey> = emptySet(),
    allProcessKeysWithTransitions: List<ProcessKeyWithTransitions> = emptyList(),
    loadProcessKeys: (suspend () -> List<ProcessKeyWithTransitions>)? = null,
    allProcessKeysFlow: kotlinx.coroutines.flow.StateFlow<List<ProcessKeyWithTransitions>>? = null,
    pickerSort: String = "transitions",
    onPickerSortChange: (String) -> Unit = {},
    isRefreshing: Boolean = false,
    pinnedProcesses: List<ProcessKey>,
    timelineRows: List<ProcessTimelineRow>,
    allSnapshotTimestamps: List<Long>,
    onPinProcess: (ProcessKey) -> Unit,
    onUnpinProcess: (ProcessKey) -> Unit,
    collapsed: Boolean = false,
    onRefresh: (() -> Unit)? = null,
    showPicker: Boolean = false,
    onOpenPicker: () -> Unit = {},
    onDismissPicker: () -> Unit = {},
) {
    val isDark = LocalIsDarkTheme.current
    val context = LocalContext.current
    var dotDetail by remember { mutableStateOf<DotDetail?>(null) }
    val timelineListState = androidx.compose.foundation.lazy.rememberLazyListState()
    val coroutineScope = androidx.compose.runtime.rememberCoroutineScope()

    // Scroll to top after pull-to-refresh
    androidx.compose.runtime.LaunchedEffect(isRefreshing) {
        if (!isRefreshing) timelineListState.animateScrollToItem(0)
    }
    var diffAnchorMs by remember { mutableStateOf<Long?>(null) }
    // Track which dot is selected (name, timestamp, pid) for enlarged state
    var selectedDotId by remember { mutableStateOf<Triple<String, Long, Int>?>(null) }

    // Detail drawer with memory data
    dotDetail?.let { detail ->
        ProcessDetailSheet(
            detail = detail,
            isDark = isDark,
            appLabel = getAppLabel(detail.name),
            onDismiss = {
                dotDetail = null
                selectedDotId = null
            },
            getMemoryForDot = getMemoryForDot,
            memoryTimelineFlow = memoryTimelineFlow,
            memoryDumpProgress = memoryDumpProgress,
            onDumpMemory = if (onDumpMemory != null) { pid, name, uid ->
                onDumpMemory(pid, name, uid) {
                    dotDetail = null
                    selectedDotId = null
                    // Scroll to top to show the new snapshot with memory data
                    coroutineScope.launch { timelineListState.animateScrollToItem(0) }
                }
            } else null,
        )
    }

    if (showPicker) {
        ModalBottomSheet(
            onDismissRequest = onDismissPicker,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        ) {
            // Use existing computed data (instant). Refresh button does full capture.
            val liveData = allProcessKeysFlow?.collectAsState()?.value ?: allProcessKeysWithTransitions
            var pickerData by remember { mutableStateOf(liveData) }
            // Update once if initial was empty (cold launch)
            if (pickerData.isEmpty() && liveData.isNotEmpty()) pickerData = liveData
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            ProcessPickerSheet(
                allKeysWithTransitions = pickerData,
                pinnedKeys = pinnedProcesses,
                onSelect = onPinProcess,
                onUnpin = onUnpinProcess,
                onRefresh = loadProcessKeys?.let { load -> {
                    scope.launch { pickerData = load() }
                } },
                sortBy = pickerSort,
                onSortChange = onPickerSortChange,
                hasData = allSnapshotTimestamps.isNotEmpty(),
            )
        }
    }

    Column(Modifier.fillMaxSize()) {
        if (pinnedProcesses.isNotEmpty()) {
            TrackedChipsRow(
                pinnedProcesses = pinnedProcesses,
                isDark = isDark,
                getAppLabel = getAppLabel,
                onUnpinProcess = onUnpinProcess,
                onOpenPicker = onOpenPicker,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
        }

        if (pinnedProcesses.isEmpty()) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "No processes pinned",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Pull down to capture, or pin from the By State tab",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        )
                        Spacer(Modifier.height(16.dp))
                        OutlinedButton(onClick = onOpenPicker) {
                            Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Add Process")
                        }
                    }
                }
            }
            return
        }

        if (allSnapshotTimestamps.isEmpty()) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                item {
                    Text(
                        "No snapshots in this time range",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            return
        }

        // Detect process starts and merge all snapshot timestamps
        val timelineByTimestamp = remember(timelineRows, allSnapshotTimestamps) {
            // Detect process starts and state changes per ProcessKey
            val markerMap = mutableMapOf<Pair<ProcessKey, Long>, Marker>()
            val stateChangedSet = mutableSetOf<Pair<ProcessKey, Long>>()
            val byKey = timelineRows.groupBy { ProcessKey(it.name, it.uid) }
            for ((pk, rows) in byKey) {
                val sorted = rows.sortedBy { it.timestamp }
                for (i in 1 until sorted.size) {
                    val prev = sorted[i - 1]
                    val curr = sorted[i]
                    if (curr.pid != prev.pid && prev.pid != 0 && curr.pid != 0) {
                        markerMap[pk to curr.timestamp] = Marker.STARTED
                    }
                    if (curr.procState != prev.procState || curr.frozen != prev.frozen) {
                        stateChangedSet.add(pk to curr.timestamp)
                    }
                }
            }
            // Build dot map per timestamp, keyed by ProcessKey
            val dotsByTs = timelineRows.groupBy { it.timestamp }
                .mapValues { (ts, rows) ->
                    rows.associate { row ->
                        val pk = ProcessKey(row.name, row.uid)
                        pk to ProcessDot(
                            procState = row.procState,
                            frozen = row.frozen,
                            pid = row.pid,
                            uid = row.uid,
                            marker = markerMap[pk to ts] ?: Marker.NORMAL,
                            stateChanged = (pk to ts) in stateChangedSet,
                        )
                    }
                }
            // Merge all snapshot timestamps so empty rows show even when all pinned are dead
            val allTs = (dotsByTs.keys + allSnapshotTimestamps).distinct()
            allTs.sortedDescending().map { ts ->
                ts to (dotsByTs[ts] ?: emptyMap())
            }
        }

        // Collapse: hide rows where no pinned process changed state/frozen/presence
        val displayRows = remember(timelineByTimestamp, collapsed, pinnedProcesses) {
            if (!collapsed) timelineByTimestamp
            else {
                val pinnedSet = pinnedProcesses.toSet()
                // Walk chronologically (reversed since timelineByTimestamp is newest-first)
                val chrono = timelineByTimestamp.asReversed()
                val kept = mutableListOf<Pair<Long, Map<ProcessKey, ProcessDot>>>()
                var prevPresent: Set<ProcessKey>? = null
                for ((ts, stateMap) in chrono) {
                    val present = stateMap.keys.filter { it in pinnedSet }.toSet()
                    val hasChange = stateMap.values.any {
                        it.stateChanged || it.marker == Marker.STARTED
                    }
                    val presenceChanged = prevPresent != null && present != prevPresent
                    if (kept.isEmpty() || hasChange || presenceChanged) {
                        kept.add(ts to stateMap)
                    }
                    prevPresent = present
                }
                kept.asReversed() // back to newest-first
            }
        }

        val scrollState = rememberScrollState()

        // Column headers
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
                .padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Time",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .width(72.dp)
                    .padding(start = 12.dp),
            )
            Row(
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(scrollState),
            ) {
                for ((i, key) in pinnedProcesses.withIndex()) {
                    val trackColor = TrackColors[i % TrackColors.size].let {
                        if (isDark) it.dark else it.light
                    }
                    Text(
                        getAppLabel(key.name),
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = trackColor,
                        modifier = Modifier.width(COL_WIDTH_DP.dp),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }

        val listState = timelineListState
        val scope = coroutineScope
        val showFab by remember {
            androidx.compose.runtime.derivedStateOf { listState.firstVisibleItemIndex > 3 }
        }

        Box(Modifier.fillMaxSize()) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 4.dp),
            ) {
                items(displayRows, key = { it.first }) { (timestamp, stateMap) ->
                    TimelineRow(
                        timestamp = timestamp,
                        pinnedProcesses = pinnedProcesses,
                        stateMap = stateMap,
                        isDark = isDark,
                        scrollState = scrollState,
                        selectedDotId = selectedDotId,
                        allTimelineRows = timelineRows,
                        memoryEnrichedDots = memoryEnrichedDots,
                        diffAnchorMs = diffAnchorMs,
                        onTimestampTap = { ms ->
                            val anchor = diffAnchorMs
                            if (anchor != null) {
                                val diffMs = kotlin.math.abs(ms - anchor)
                                Toast.makeText(context, formatTimeDiff(diffMs), Toast.LENGTH_SHORT).show()
                                diffAnchorMs = null
                            } else {
                                Toast.makeText(context, formatTimestampFull(ms), Toast.LENGTH_SHORT).show()
                            }
                        },
                        onTimestampLongPress = { ms ->
                            diffAnchorMs = ms
                            Toast.makeText(context, "Anchor set. Tap another for diff.", Toast.LENGTH_SHORT).show()
                        },
                        onShowDetail = { detail, name, ts, pid ->
                            dotDetail = detail
                            selectedDotId = Triple(name, ts, pid)
                        },
                    )
                }
            }

            androidx.compose.animation.AnimatedVisibility(
                visible = showFab,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp),
                enter = androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(200)),
                exit = androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(200)),
            ) {
                androidx.compose.material3.SmallFloatingActionButton(
                    onClick = { scope.launch { listState.animateScrollToItem(0) } },
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ) {
                    Icon(
                        Icons.Default.KeyboardArrowUp,
                        "Scroll",
                        Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}

// ── Timeline row ────────────────────────────────────────────────────────────

@Composable
private fun TimelineRow(
    timestamp: Long,
    pinnedProcesses: List<ProcessKey>,
    stateMap: Map<ProcessKey, ProcessDot>,
    isDark: Boolean,
    scrollState: androidx.compose.foundation.ScrollState,
    selectedDotId: Triple<String, Long, Int>?,
    allTimelineRows: List<ProcessTimelineRow>,
    memoryEnrichedDots: Set<MemoryDotKey>,
    diffAnchorMs: Long?,
    onTimestampTap: (Long) -> Unit,
    onTimestampLongPress: (Long) -> Unit,
    onShowDetail: (DotDetail, String, Long, Int) -> Unit,
) {
    val timeStr = remember(timestamp) { formatTimestamp(timestamp) }
    val isAnchor = diffAnchorMs == timestamp
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        @OptIn(ExperimentalFoundationApi::class)
        Text(
            timeStr,
            style = MaterialTheme.typography.labelSmall,
            color = if (isAnchor) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = if (isAnchor) FontWeight.Bold else null,
            modifier = Modifier
                .width(72.dp)
                .padding(start = 12.dp, top = 6.dp, bottom = 6.dp)
                .combinedClickable(
                    onClick = { onTimestampTap(timestamp) },
                    onLongClick = { onTimestampLongPress(timestamp) },
                ),
        )

        val hLineColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.06f)
        Row(
            modifier = Modifier
                .weight(1f)
                .horizontalScroll(scrollState)
                .drawBehind {
                    // Horizontal connector
                    val y = size.height / 2
                    drawLine(hLineColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 0.5.dp.toPx())
                },
        ) {
            for (key in pinnedProcesses) {
                val dot = stateMap[key]

                Box(
                    modifier = Modifier
                        .width(COL_WIDTH_DP.dp)
                        .padding(vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (dot != null) {
                        val dotColor = ProcStateColors.get(dot.procState, isDark)
                        // Triangle for STARTED, circle for NORMAL
                        val isTriangle = dot.marker == Marker.STARTED

                        val isSelected = selectedDotId == Triple(key.name, timestamp, dot.pid)
                        val scale by androidx.compose.animation.core.animateFloatAsState(
                            targetValue = if (isSelected) 1.5f else 1f,
                            animationSpec = androidx.compose.animation.core.tween(200),
                            label = "dotScale",
                        )
                        val fullTimeStr = remember(timestamp) { formatTimestampFull(timestamp) }
                        val onTap: () -> Unit = {
                            val relevant = allTimelineRows
                                .filter { it.name == key.name && it.uid == key.uid && it.timestamp <= timestamp }
                            val history = relevant
                                .groupBy { it.procState }
                                .map { (state, rows) -> state to rows.size }
                                .sortedByDescending { it.second }
                            val frozen = relevant.count { it.frozen }
                            val sorted = relevant.sortedBy { it.timestamp }
                            val restarts = (1 until sorted.size).count {
                                sorted[it].pid != sorted[it - 1].pid &&
                                sorted[it].pid != 0 && sorted[it - 1].pid != 0
                            }
                            onShowDetail(DotDetail(
                                name = key.name,
                                uid = dot.uid,
                                pid = dot.pid,
                                state = dot.procState,
                                stateLabel = ProcStateColors.label(dot.procState),
                                frozen = dot.frozen,
                                started = dot.marker == Marker.STARTED,
                                timestamp = fullTimeStr,
                                timestampMs = timestamp,
                                stateHistory = history,
                                frozenCount = frozen,
                                restartCount = restarts,
                            ), key.name, timestamp, dot.pid)
                        }

                        if (isTriangle) {
                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .graphicsLayer { scaleX = scale; scaleY = scale }
                                    .drawBehind {
                                        val path = Path().apply {
                                            moveTo(size.width / 2, 0f)
                                            lineTo(size.width, size.height)
                                            lineTo(0f, size.height)
                                            close()
                                        }
                                        drawPath(path, dotColor)
                                    }
                                    .clickable { onTap() },
                            )
                        } else {
                            val hasMemory = memoryEnrichedDots.contains(
                                MemoryDotKey(timestamp, key.name, key.uid)
                            )
                            // Square for state/frozen change, circle for same-state
                            val dotShape = if (dot.stateChanged) RoundedCornerShape(2.dp) else CircleShape
                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .graphicsLayer { scaleX = scale; scaleY = scale }
                                    .then(if (hasMemory) {
                                        Modifier.drawBehind {
                                            if (dot.stateChanged) {
                                                drawRect(
                                                    color = if (isDark) Color.White else Color.Black,
                                                    style = androidx.compose.ui.graphics.drawscope.Stroke(
                                                        width = 1.5.dp.toPx(),
                                                        pathEffect = PathEffect.dashPathEffect(
                                                            floatArrayOf(3f, 3f),
                                                        ),
                                                    ),
                                                )
                                            } else {
                                                drawCircle(
                                                    color = if (isDark) Color.White else Color.Black,
                                                    radius = size.minDimension / 2,
                                                    style = androidx.compose.ui.graphics.drawscope.Stroke(
                                                        width = 1.5.dp.toPx(),
                                                        pathEffect = PathEffect.dashPathEffect(
                                                            floatArrayOf(3f, 3f),
                                                        ),
                                                    ),
                                                )
                                            }
                                        }
                                    } else Modifier)
                                    .clip(dotShape)
                                    .background(dotColor)
                                    .border(1.dp, dotColor.copy(alpha = 0.3f), dotShape)
                                    .clickable { onTap() },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (dot.frozen) {
                                    Text(
                                        "\u2715",
                                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp),
                                        color = Color.White.copy(alpha = 0.8f),
                                    )
                                }
                            }
                        }
                    } else {
                        // Not present = process not running
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .border(
                                    1.dp,
                                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f),
                                    CircleShape,
                                )
                                .clickable {
                                    val ts = formatTimestampFull(timestamp)
                                    onShowDetail(DotDetail(
                                        name = key.name,
                                        uid = key.uid,
                                        pid = 0,
                                        state = "not running",
                                        stateLabel = "Not Running",
                                        frozen = false,
                                        started = false,
                                        timestamp = ts,
                                    ), key.name, timestamp, 0)
                                },
                        )
                    }
                }
            }
        }
    }
}

// ── Tracked process chips ───────────────────────────────────────────────────

@Composable
private fun TrackedChipsRow(
    pinnedProcesses: List<ProcessKey>,
    isDark: Boolean,
    getAppLabel: (String) -> String,
    onUnpinProcess: (ProcessKey) -> Unit,
    onOpenPicker: () -> Unit = {},
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for ((i, key) in pinnedProcesses.withIndex()) {
            val trackColor = TrackColors[i % TrackColors.size].let {
                if (isDark) it.dark else it.light
            }
            ProcessChip(label = getAppLabel(key.name), key = key, color = trackColor, onRemove = { onUnpinProcess(key) }, onTap = onOpenPicker)
        }
    }
}

@Composable
private fun ProcessChip(label: String, key: ProcessKey, color: Color, onRemove: () -> Unit, onTap: () -> Unit = {}) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(color.copy(alpha = 0.1f))
            .border(1.dp, color.copy(alpha = 0.25f), RoundedCornerShape(14.dp))
            .clickable(onClick = onTap)
            .padding(start = 8.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(4.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        IconButton(onClick = onRemove, modifier = Modifier.size(18.dp)) {
            Icon(Icons.Default.Close, null, Modifier.size(11.dp), tint = color)
        }
    }
}

// ── Process picker (bottom sheet) ───────────────────────────────────────────

@Composable
private fun ProcessPickerSheet(
    allKeysWithTransitions: List<ProcessKeyWithTransitions>,
    pinnedKeys: List<ProcessKey>,
    onSelect: (ProcessKey) -> Unit,
    onUnpin: (ProcessKey) -> Unit = {},
    onRefresh: (() -> Unit)? = null,
    sortBy: String = "transitions",
    onSortChange: (String) -> Unit = {},
    hasData: Boolean = true,
) {
    var search by remember { mutableStateOf("") }
    // Local pinned state for immediate UI feedback inside ModalBottomSheet
    var localPinned by remember(pinnedKeys) { mutableStateOf(pinnedKeys.toSet()) }
    var showPinWarning by remember { mutableStateOf(false) }
    var pendingPins by remember { mutableStateOf<List<ProcessKey>>(emptyList()) }
    val pinnedSet = localPinned

    // Track sort direction: false = descending (default), true = ascending
    var sortAscending by remember { mutableStateOf(false) }

    val sorted = remember(allKeysWithTransitions, search, pinnedSet, sortBy, sortAscending) {
        val searched = if (search.isBlank()) allKeysWithTransitions
            else allKeysWithTransitions.filter { search.lowercase() in it.key.name.lowercase() }
        val comparator: Comparator<ProcessKeyWithTransitions> = when (sortBy) {
            "name" -> if (sortAscending) compareBy { it.key.name.lowercase() }
                      else compareByDescending { it.key.name.lowercase() }
            "starts" -> if (sortAscending) compareBy { it.starts }
                        else compareByDescending { it.starts }
            "frozen" -> if (sortAscending) compareBy { it.frozenCount }
                        else compareByDescending { it.frozenCount }
            "transitions" -> if (sortAscending) compareBy { it.transitions }
                             else compareByDescending { it.transitions }
            else -> if (sortAscending) compareBy<ProcessKeyWithTransitions> { it.lastChangeMs }.thenBy { it.lastChangePriority }.thenBy { it.lastChangeUnfreeze }
                    else compareByDescending<ProcessKeyWithTransitions> { it.lastChangeMs }.thenByDescending { it.lastChangePriority }.thenByDescending { it.lastChangeUnfreeze }
        }
        searched.sortedWith(comparator)
    }

    val colWidth = 58.dp

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.8f)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Processes", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.weight(1f))
            if (onRefresh != null) {
                androidx.compose.material3.TextButton(onClick = onRefresh) {
                    Text("Refresh")
                }
            }
            val unpinnedCount = sorted.count { it.key !in pinnedSet }
            if (unpinnedCount > 0) {
                androidx.compose.material3.TextButton(
                    onClick = {
                        val toPins = sorted.filter { it.key !in pinnedSet }.map { it.key }
                        if (localPinned.size + toPins.size > 10) {
                            pendingPins = toPins
                            showPinWarning = true
                        } else {
                            localPinned = localPinned + toPins
                            toPins.forEach { onSelect(it) }
                        }
                    },
                ) {
                    Text("Pin all $unpinnedCount")
                }
            }
        }
        Spacer(Modifier.height(4.dp))

        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search processes\u2026") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = {
                if (search.isNotEmpty()) {
                    IconButton(onClick = { search = "" }) { Icon(Icons.Default.Close, null) }
                }
            },
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))

        // Column headers — tappable to sort
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PickerColumnHeader("Name", "name", sortBy, sortAscending, Modifier.weight(1f)) {
                if (sortBy == "name") sortAscending = !sortAscending
                else { onSortChange("name"); sortAscending = true }
            }
            PickerColumnHeader("Starts", "starts", sortBy, sortAscending, Modifier.width(colWidth)) {
                if (sortBy == "starts") sortAscending = !sortAscending
                else { onSortChange("starts"); sortAscending = false }
            }
            PickerColumnHeader("States", "transitions", sortBy, sortAscending, Modifier.width(colWidth)) {
                if (sortBy == "transitions") sortAscending = !sortAscending
                else { onSortChange("transitions"); sortAscending = false }
            }
            PickerColumnHeader("Freezes", "frozen", sortBy, sortAscending, Modifier.width(colWidth)) {
                if (sortBy == "frozen") sortAscending = !sortAscending
                else { onSortChange("frozen"); sortAscending = false }
            }
            Text(
                "Pin",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.width(32.dp),
                textAlign = TextAlign.Center,
            )
        }

        HorizontalDivider(
            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f),
            modifier = Modifier.padding(vertical = 4.dp),
        )

        LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f, fill = false),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(sorted) { item ->
                val isPinned = item.key in pinnedSet
                val itemContext = androidx.compose.ui.platform.LocalContext.current
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .clickable {
                            if (isPinned) {
                                localPinned = localPinned - item.key
                                onUnpin(item.key)
                            } else if (localPinned.size >= 10) {
                                pendingPins = listOf(item.key)
                                showPinWarning = true
                            } else {
                                localPinned = localPinned + item.key
                                onSelect(item.key)
                                android.widget.Toast.makeText(itemContext, item.key.name, android.widget.Toast.LENGTH_SHORT).show()
                            }
                        }
                        .then(if (isPinned) Modifier.background(
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                        ) else Modifier)
                        .padding(vertical = 8.dp, horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            item.key.name,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (item.key.uid.isNotEmpty()) {
                            Text(
                                item.key.uid,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    PickerCell(item.starts, sortBy == "starts", colWidth)
                    PickerCell(item.transitions, sortBy == "transitions", colWidth)
                    PickerCell(item.frozenCount, sortBy == "frozen", colWidth)
                    androidx.compose.material3.Checkbox(
                        checked = isPinned,
                        onCheckedChange = {
                            if (isPinned) {
                                localPinned = localPinned - item.key
                                onUnpin(item.key)
                            } else if (localPinned.size >= 10) {
                                pendingPins = listOf(item.key)
                                showPinWarning = true
                            } else {
                                localPinned = localPinned + item.key
                                onSelect(item.key)
                            }
                        },
                        modifier = Modifier.size(24.dp),
                    )
                }
            }
        }

        if (sorted.isEmpty()) {
            if (allKeysWithTransitions.isEmpty() && search.isBlank()) {
                if (hasData) {
                    // Data exists but transitions haven't computed yet
                    Row(
                        Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("Loading\u2026", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    Text(
                        "No processes captured yet",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            } else {
                Text(
                    "No processes match your search",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    if (showPinWarning) {
        val totalAfter = localPinned.size + pendingPins.size
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showPinWarning = false; pendingPins = emptyList() },
            title = { Text("Pin $totalAfter processes?") },
            text = { Text("Pinning many processes may slow the UI. Continue?") },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    localPinned = localPinned + pendingPins
                    pendingPins.forEach { onSelect(it) }
                    showPinWarning = false
                    pendingPins = emptyList()
                }) { Text("Pin") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = {
                    showPinWarning = false
                    pendingPins = emptyList()
                }) { Text("Cancel") }
            },
        )
    }
}

// ── Process detail sheet (shared) ────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProcessDetailSheet(
    detail: DotDetail,
    isDark: Boolean,
    appLabel: String,
    onDismiss: () -> Unit,
    getMemoryForDot: (suspend (name: String, uid: String, pid: Int, timestamp: Long) -> MemorySnapshotEntity?)? = null,
    memoryTimelineFlow: ((name: String, uid: String) -> kotlinx.coroutines.flow.Flow<List<MemorySnapshotEntity>>)? = null,
    memoryDumpProgress: String? = null,
    onDumpMemory: ((pid: Int, name: String, uid: String) -> Unit)? = null,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
    ) {
        // Load memory data inside the sheet so it recomposes correctly
        var memoryData by remember(detail) { mutableStateOf<MemorySnapshotEntity?>(null) }
        // Load dot memory data once
        androidx.compose.runtime.LaunchedEffect(detail) {
            if (getMemoryForDot != null && detail.pid > 0) {
                memoryData = getMemoryForDot(detail.name, detail.uid, detail.pid, detail.timestampMs)
            }
        }
        // Reactive memory timeline (updates live as recording captures new data)
        val memoryTimeline = memoryTimelineFlow?.let { flow ->
            flow(detail.name, detail.uid).collectAsState(emptyList()).value
        } ?: emptyList()
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 40.dp),
        ) {
            // Header: color accent bar + app label + state + timestamp
            val stateColor = ProcStateColors.get(detail.state, isDark)

            // Color accent strip
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(stateColor),
            )
            Spacer(Modifier.height(16.dp))

            // App label
            Text(
                appLabel,
                style = MaterialTheme.typography.headlineMedium,
            )
            Spacer(Modifier.height(4.dp))

            // State + timestamp row
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(stateColor),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    ProcStateColors.label(detail.state),
                    style = MaterialTheme.typography.titleMedium,
                    color = stateColor,
                )
                if (detail.timestamp.isNotEmpty()) {
                    Spacer(Modifier.weight(1f))
                    Text(
                        detail.timestamp,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
            Spacer(Modifier.height(16.dp))

            // Details
            DetailRow("Package", detail.name.substringBefore(':'))
            DetailRow("Process", detail.name)
            DetailRow("UID", detail.uid)
            if (detail.pid > 0) DetailRow("PID", detail.pid.toString())
            DetailRow("State", "${ProcStateColors.label(detail.state)} (${detail.state})")
            if (detail.frozen) {
                DetailRow("Frozen", "Yes")
            }
            if (detail.started) {
                DetailRow("Event", "Process start")
            }

            // State history mini bars
            if (detail.stateHistory.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
                Spacer(Modifier.height(12.dp))

                val total = detail.stateHistory.sumOf { it.second }
                Text(
                    "State history ($total snapshots)",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))

                // Stacked bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(20.dp)
                        .clip(RoundedCornerShape(4.dp)),
                ) {
                    for ((state, count) in detail.stateHistory) {
                        val color = ProcStateColors.get(state, isDark)
                        Box(
                            modifier = Modifier
                                .weight(count.toFloat())
                                .fillMaxHeight()
                                .background(color),
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))

                // Breakdown rows
                for ((state, count) in detail.stateHistory) {
                    val color = ProcStateColors.get(state, isDark)
                    val pct = (count * 100f / total).let { "%.0f".format(it) }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(8.dp)
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
                            "$count ($pct%)",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                // Restarts
                if (detail.restartCount > 0) {
                    val pct = (detail.restartCount * 100f / total).let { "%.0f".format(it) }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Starts", style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f))
                        Text("${detail.restartCount} ($pct%)", style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }

                // Frozen count
                if (detail.frozenCount > 0) {
                    val pct = (detail.frozenCount * 100f / total).let { "%.0f".format(it) }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Frozen", style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f))
                        Text("${detail.frozenCount} ($pct%)", style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            // ── Memory section ──────────────────────────────────────────────
            if (detail.pid > 0) {
                Spacer(Modifier.height(16.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
                Spacer(Modifier.height(12.dp))

                if (memoryDumpProgress != null) {
                    // Dumping in progress
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            memoryDumpProgress,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else if (memoryData != null) {
                    val mem = memoryData!!
                    // Show memory breakdown — single scrollable row
                    val sampleCount = memoryTimeline.size
                    Text(
                        if (sampleCount > 1) "Memory \u00b7 $sampleCount samples" else "Memory",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        MemoryChip("PSS", mem.totalPssKb)
                        MemoryChip("RSS", mem.totalRssKb)
                        MemoryChip("Java", mem.javaHeapKb)
                        MemoryChip("Native", mem.nativeHeapKb)
                        MemoryChip("Code", mem.codeKb)
                        MemoryChip("Stack", mem.stackKb)
                        MemoryChip("Graphics", mem.graphicsKb)
                        MemoryChip("System", mem.systemKb)
                        if (mem.totalSwapKb > 0) MemoryChip("Swap", mem.totalSwapKb)
                    }

                    // Memory sparkline (above stats)
                    if (memoryTimeline.size >= 2) {
                        Spacer(Modifier.height(12.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
                        Spacer(Modifier.height(12.dp))

                        // Filter out metrics that are all zeros
                        val availableMetrics = remember(memoryTimeline) {
                            listOf(
                                "PSS" to { e: MemorySnapshotEntity -> e.totalPssKb },
                                "RSS" to { e: MemorySnapshotEntity -> e.totalRssKb },
                                "Java" to { e: MemorySnapshotEntity -> e.javaHeapKb },
                                "Native" to { e: MemorySnapshotEntity -> e.nativeHeapKb },
                                "Code" to { e: MemorySnapshotEntity -> e.codeKb },
                                "Graphics" to { e: MemorySnapshotEntity -> e.graphicsKb },
                            ).filter { (_, extract) -> memoryTimeline.any { e -> extract(e) > 0 } }
                                .map { it.first }
                        }
                        var selectedMetric by remember { mutableStateOf(availableMetrics.firstOrNull() ?: "PSS") }

                        Row(
                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            for (m in availableMetrics) {
                                FilterChip(
                                    selected = selectedMetric == m,
                                    onClick = { selectedMetric = m },
                                    label = { Text(m, style = MaterialTheme.typography.labelSmall) },
                                )
                            }
                        }
                        Spacer(Modifier.height(8.dp))

                        val values = remember(memoryTimeline, selectedMetric) {
                            memoryTimeline.map { e ->
                                when (selectedMetric) {
                                    "PSS" -> e.totalPssKb
                                    "RSS" -> e.totalRssKb
                                    "Java" -> e.javaHeapKb
                                    "Native" -> e.nativeHeapKb
                                    "Code" -> e.codeKb
                                    "Graphics" -> e.graphicsKb
                                    else -> e.totalPssKb
                                }.toFloat()
                            }
                        }
                        SparklineChart(
                            values = values,
                            lineColor = MaterialTheme.colorScheme.primary,
                            minLabel = formatKb(values.min().toLong()),
                            maxLabel = formatKb(values.max().toLong()),
                            startTimeMs = memoryTimeline.first().timestamp,
                            endTimeMs = memoryTimeline.last().timestamp,
                            markerTimeMs = detail.timestampMs,
                        )
                    }

                } else if (onDumpMemory != null) {
                    // Dump button
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Memory", style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.weight(1f))
                        androidx.compose.material3.IconButton(
                            onClick = { onDumpMemory(detail.pid, detail.name, detail.uid) },
                            modifier = Modifier.size(32.dp),
                        ) {
                            Icon(
                                androidx.compose.material.icons.Icons.Default.KeyboardArrowDown,
                                "Dump memory",
                                Modifier.size(20.dp),
                            )
                        }
                    }
                    Text(
                        "Tap to capture memory snapshot for this process",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun MemoryChip(label: String, kb: Long, modifier: Modifier = Modifier) {
    if (kb <= 0) return
    Column(modifier) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            formatKb(kb),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun formatKb(kb: Long): String = when {
    kotlin.math.abs(kb) < 1024 -> "$kb KB"
    else -> "%.1f MB".format(kb / 1024.0)
}

@Composable
private fun DetailRow(label: String, value: String) {
    if (value.isEmpty()) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(80.dp),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

// ── Picker table helpers ─────────────────────────────────────────────────────

@Composable
private fun PickerColumnHeader(
    label: String,
    key: String,
    activeSort: String,
    ascending: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val isActive = activeSort == key
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (key == "name") Arrangement.Start else Arrangement.Center,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal,
            color = if (isActive) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (isActive) {
            Icon(
                if (ascending) Icons.Default.ArrowUpward else Icons.Default.ArrowDownward,
                null,
                modifier = Modifier.size(12.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
private fun PickerCell(value: Int, isActiveSort: Boolean, width: Dp) {
    Text(
        if (value > 0) value.toString() else "\u2014",
        style = MaterialTheme.typography.bodySmall,
        fontWeight = if (isActiveSort) FontWeight.Bold else FontWeight.Normal,
        color = if (isActiveSort && value > 0) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.width(width),
    )
}

// ── Shared sparkline chart ───────────────────────────────────────────────────

@Composable
fun SparklineChart(
    values: List<Float>,
    lineColor: Color,
    minLabel: String,
    maxLabel: String,
    startTimeMs: Long,
    endTimeMs: Long,
    markerTimeMs: Long = 0,
) {
    if (values.size < 2) return
    val fillColor = lineColor.copy(alpha = 0.1f)
    val minVal = values.min()
    val maxVal = values.max()
    val range = (maxVal - minVal).coerceAtLeast(1f)

    Row(Modifier.fillMaxWidth()) {
        Column(
            Modifier.height(80.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(maxLabel, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(minLabel, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.width(4.dp))
        Canvas(
            modifier = Modifier
                .weight(1f)
                .height(80.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)),
        ) {
            val w = size.width
            val h = size.height
            val pad = 4.dp.toPx()
            val drawH = h - pad * 2
            val step = w / (values.size - 1).coerceAtLeast(1)

            val path = androidx.compose.ui.graphics.Path()
            val fillPath = androidx.compose.ui.graphics.Path()

            for ((i, v) in values.withIndex()) {
                val x = i * step
                val y = pad + drawH * (1f - (v - minVal) / range)
                if (i == 0) {
                    path.moveTo(x, y)
                    fillPath.moveTo(x, h)
                    fillPath.lineTo(x, y)
                } else {
                    path.lineTo(x, y)
                    fillPath.lineTo(x, y)
                }
            }
            fillPath.lineTo((values.size - 1) * step, h)
            fillPath.close()

            drawPath(fillPath, fillColor)
            drawPath(path, lineColor, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2.dp.toPx()))

            // Vertical marker line
            if (markerTimeMs in startTimeMs..endTimeMs && endTimeMs > startTimeMs) {
                val markerX = w * (markerTimeMs - startTimeMs).toFloat() / (endTimeMs - startTimeMs)
                drawLine(
                    color = lineColor.copy(alpha = 0.5f),
                    start = androidx.compose.ui.geometry.Offset(markerX, 0f),
                    end = androidx.compose.ui.geometry.Offset(markerX, h),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
                )
            }
        }
    }
    val timeFmt = remember { java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()) }
    val durationMs = endTimeMs - startTimeMs
    val durText = when {
        durationMs < 60_000 -> "${durationMs / 1000}s"
        durationMs < 3600_000 -> "${durationMs / 60_000}m"
        else -> "%.1fh".format(durationMs / 3600_000.0)
    }
    Row(Modifier.fillMaxWidth()) {
        // Invisible spacer matching y-axis width
        Text(maxLabel, style = MaterialTheme.typography.labelSmall,
            color = Color.Transparent)
        Spacer(Modifier.width(4.dp))
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(timeFmt.format(startTimeMs), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(durText, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f))
            Text(timeFmt.format(endTimeMs), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
