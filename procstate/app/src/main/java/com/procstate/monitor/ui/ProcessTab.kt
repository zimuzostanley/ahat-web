package com.procstate.monitor.ui

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.procstate.monitor.data.ProcessKey
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
)

private data class DotDetail(
    val name: String,
    val uid: String,
    val pid: Int,
    val state: String,
    val stateLabel: String,
    val frozen: Boolean,
    val started: Boolean,
    val timestamp: String,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProcessTab(
    getAppLabel: (String) -> String = { it.substringAfterLast('.') },
    pinnedProcesses: List<ProcessKey>,
    timelineRows: List<ProcessTimelineRow>,
    allSnapshotTimestamps: List<Long>,
    allProcessKeys: List<ProcessKey>,
    onPinProcess: (ProcessKey) -> Unit,
    onUnpinProcess: (ProcessKey) -> Unit,
    showPicker: Boolean = false,
    onOpenPicker: () -> Unit = {},
    onDismissPicker: () -> Unit = {},
) {
    val isDark = LocalIsDarkTheme.current
    var dotDetail by remember { mutableStateOf<DotDetail?>(null) }

    // Detail drawer
    dotDetail?.let { detail ->
        ModalBottomSheet(
            onDismissRequest = { dotDetail = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
            ) {
                Text(
                    getAppLabel(detail.name),
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(12.dp))
                DetailRow("App", getAppLabel(detail.name))
                DetailRow("Process", detail.name)
                DetailRow("UID", detail.uid)
                DetailRow("PID", detail.pid.toString())
                DetailRow("State", "${ProcStateColors.label(detail.state)} (${detail.state})")
                if (detail.frozen) DetailRow("Frozen", "Yes")
                if (detail.started) DetailRow("Event", "Process start")
                DetailRow("Time", detail.timestamp)
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    if (showPicker) {
        ModalBottomSheet(
            onDismissRequest = onDismissPicker,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        ) {
            ProcessPickerSheet(
                allKeys = allProcessKeys,
                pinnedKeys = pinnedProcesses,
                onSelect = onPinProcess,
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
        val timelineByTimestamp = remember(timelineRows, allSnapshotTimestamps, pinnedProcesses) {
            // Marker detection by ProcessKey (name+uid), not just name
            val markerMap = mutableMapOf<Pair<ProcessKey, Long>, Marker>()
            val byKey = timelineRows.groupBy { ProcessKey(it.name, it.uid) }
            for ((pk, rows) in byKey) {
                val sorted = rows.sortedBy { it.timestamp }
                for (i in 1 until sorted.size) {
                    val prev = sorted[i - 1]
                    val curr = sorted[i]
                    if (curr.pid != prev.pid && prev.pid != 0 && curr.pid != 0) {
                        markerMap[pk to curr.timestamp] = Marker.STARTED
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
                        )
                    }
                }
            // Merge all snapshot timestamps so empty rows show even when all pinned are dead
            val allTs = (dotsByTs.keys + allSnapshotTimestamps).distinct()
            allTs.sortedDescending().map { ts ->
                ts to (dotsByTs[ts] ?: emptyMap())
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

        // Timeline with scroll-to-top
        val listState = androidx.compose.foundation.lazy.rememberLazyListState()
        val scope = androidx.compose.runtime.rememberCoroutineScope()
        val showScrollToTop by remember {
            androidx.compose.runtime.derivedStateOf { listState.firstVisibleItemIndex > 3 }
        }

        Box(Modifier.fillMaxSize()) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 4.dp),
            ) {
                items(timelineByTimestamp, key = { it.first }) { (timestamp, stateMap) ->
                    TimelineRow(
                        timestamp = timestamp,
                        pinnedProcesses = pinnedProcesses,
                        stateMap = stateMap,
                        isDark = isDark,
                        scrollState = scrollState,
                        onShowDetail = { dotDetail = it },
                    )
                }
            }

            androidx.compose.animation.AnimatedVisibility(
                visible = showScrollToTop,
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
                    Icon(Icons.Default.KeyboardArrowUp, "Scroll to top", Modifier.size(20.dp))
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
    onShowDetail: (DotDetail) -> Unit,
) {
    val timeStr = remember(timestamp) { formatTimestamp(timestamp) }
    val fullTimeStr = remember(timestamp) { formatTimestampFull(timestamp) }
    val context = LocalContext.current
    val lineColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f)

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            timeStr,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .width(72.dp)
                .padding(start = 12.dp, top = 6.dp, bottom = 6.dp)
                .clickable { Toast.makeText(context, fullTimeStr, Toast.LENGTH_SHORT).show() },
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
                    // Vertical column lines — full height so they connect across rows
                    val colW = COL_WIDTH_DP.dp.toPx()
                    for (i in pinnedProcesses.indices) {
                        val cx = colW * i + colW / 2
                        drawLine(lineColor, Offset(cx, 0f), Offset(cx, size.height), strokeWidth = 0.5.dp.toPx())
                    }
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

                        var tapped by remember { mutableStateOf(false) }
                        val scale by androidx.compose.animation.core.animateFloatAsState(
                            targetValue = if (tapped) 1.6f else 1f,
                            animationSpec = androidx.compose.animation.core.tween(200),
                            label = "dotScale",
                            finishedListener = { if (tapped) tapped = false },
                        )
                        val fullTimeStr = remember(timestamp) { formatTimestampFull(timestamp) }
                        val onTap: () -> Unit = {
                            tapped = true
                            onShowDetail(DotDetail(
                                name = key.name,
                                uid = dot.uid,
                                pid = dot.pid,
                                state = dot.procState,
                                stateLabel = ProcStateColors.label(dot.procState),
                                frozen = dot.frozen,
                                started = dot.marker == Marker.STARTED,
                                timestamp = fullTimeStr,
                            ))
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
                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .graphicsLayer { scaleX = scale; scaleY = scale }
                                    .clip(CircleShape)
                                    .background(dotColor)
                                    .border(1.dp, dotColor.copy(alpha = 0.3f), CircleShape)
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
                                    val fullTimeStr = formatTimestampFull(timestamp)
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
                                    ))
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
            ProcessChip(label = getAppLabel(key.name), key = key, color = trackColor, onRemove = { onUnpinProcess(key) })
        }
    }
}

@Composable
private fun ProcessChip(label: String, key: ProcessKey, color: Color, onRemove: () -> Unit) {
    val context = LocalContext.current
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(color.copy(alpha = 0.1f))
            .border(1.dp, color.copy(alpha = 0.25f), RoundedCornerShape(14.dp))
            .clickable { Toast.makeText(context, "${key.name} / ${key.uid}", Toast.LENGTH_SHORT).show() }
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
    allKeys: List<ProcessKey>,
    pinnedKeys: List<ProcessKey>,
    onSelect: (ProcessKey) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    val pinnedSet = remember(pinnedKeys) { pinnedKeys.toSet() }
    val filtered = remember(allKeys, search, pinnedSet) {
        val available = allKeys.filter { it !in pinnedSet }
        if (search.isBlank()) available
        else available.filter { search.lowercase() in it.name.lowercase() }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.8f)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Pin Process", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.weight(1f))
            Text(
                "${filtered.size} available",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(12.dp))

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

        LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f, fill = false),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(filtered) { key ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .clickable { onSelect(key) }
                        .padding(vertical = 8.dp, horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            key.name,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (key.uid.isNotEmpty()) {
                            Text(
                                key.uid,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Icon(Icons.Default.Add, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                }
            }
        }

        if (filtered.isEmpty()) {
            Text(
                if (allKeys.isEmpty()) "No processes captured yet" else "No processes match your search",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
    }
}

// ── Detail dialog row ───────────────────────────────────────────────────────

@Composable
private fun DetailRow(label: String, value: String) {
    if (value.isEmpty() || value == "0") return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(80.dp),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
