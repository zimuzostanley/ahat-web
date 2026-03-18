package com.procstate.monitor.ui

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import com.procstate.monitor.ui.theme.LocalIsDarkTheme
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.procstate.monitor.data.ProcessEntryEntity
import com.procstate.monitor.data.ProcessKey
import com.procstate.monitor.data.SnapshotWithCounts
import com.procstate.monitor.ui.theme.ProcStateColors
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ProcStateTab(
    snapshots: List<SnapshotWithCounts>,
    pinnedProcesses: List<ProcessKey>,
    onPinProcess: (ProcessKey) -> Unit,
    onUnpinProcess: (ProcessKey) -> Unit,
    onLoadEntries: suspend (Long) -> List<ProcessEntryEntity>,
    isRefreshing: Boolean = false,
    getAppLabel: (String) -> String = { it.substringAfterLast('.') },
    hasData: Boolean = false,
    hasStateFilter: Boolean = false,
    visibleStates: Set<String> = emptySet(),
    stateFilter: Set<String> = emptySet(),
    onSetStateFilter: (Set<String>) -> Unit = {},
    onOpenFilterSheet: () -> Unit = {},
) {
    if (snapshots.isEmpty()) {
        if (hasData && !hasStateFilter) {
            // Data exists, no filter active, but snapshots haven't loaded yet
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            }
            return
        }
        val (title, subtitle) = if (hasStateFilter) {
            "No matching states" to "Adjust the state filter or tap the legend to change it"
        } else {
            "No snapshots yet" to "Pull down to capture, or tap Record above"
        }
        // Use LazyColumn so pull-to-refresh overscroll detection works
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            item {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.KeyboardArrowDown,
                        contentDescription = null,
                        modifier = Modifier.size(32.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        title,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    )
                }
            }
        }
        return
    }

    val context = LocalContext.current
    val expandedSnapshots = remember { mutableStateMapOf<Long, List<ProcessEntryEntity>>() }
    val expandedStates = remember { mutableStateMapOf<Long, Set<String>>() }
    val scope = rememberCoroutineScope()
    val isDark = LocalIsDarkTheme.current
    var processDetail by remember { mutableStateOf<DotDetail?>(null) }
    // Long-press timestamp for time diff measurement
    var diffAnchorMs by remember { mutableStateOf<Long?>(null) }

    // Process detail drawer
    processDetail?.let { detail ->
        ProcessDetailSheet(
            detail = detail,
            isDark = isDark,
            appLabel = getAppLabel(detail.name),
            onDismiss = { processDetail = null },
        )
    }
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()

    // Auto-scroll to top after pull-to-refresh (not during recording)
    androidx.compose.runtime.LaunchedEffect(isRefreshing) {
        if (!isRefreshing && snapshots.isNotEmpty()) {
            listState.animateScrollToItem(0)
        }
    }

    val scrolledFromTop by remember {
        androidx.compose.runtime.derivedStateOf { listState.firstVisibleItemIndex > 2 }
    }

    Column(Modifier.fillMaxSize()) {
    // State filter chips (like pinned process chips in Process tab)
    val displayedStates = if (stateFilter.isNotEmpty()) stateFilter else visibleStates
    if (displayedStates.isNotEmpty()) {
        StateFilterChips(
            states = displayedStates,
            isDark = isDark,
            onRemoveState = { state ->
                if (stateFilter.isEmpty()) {
                    // Currently showing all — switch to all except this one
                    onSetStateFilter(visibleStates - state)
                } else {
                    val next = stateFilter - state
                    onSetStateFilter(next)
                }
            },
            onTap = onOpenFilterSheet,
        )
    }

    Box(Modifier.fillMaxSize().weight(1f)) {
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(snapshots, key = { it.id }) { snapshot ->
            val isExpanded = snapshot.id in expandedSnapshots

            SnapshotRow(
                snapshot = snapshot,
                isExpanded = isExpanded,
                isDark = isDark,
                diffAnchorMs = diffAnchorMs,
                onTimestampTap = { ms ->
                    val anchor = diffAnchorMs
                    if (anchor != null) {
                        // Second tap: show diff and clear
                        val diffMs = kotlin.math.abs(ms - anchor)
                        Toast.makeText(context, formatTimeDiff(diffMs), Toast.LENGTH_SHORT).show()
                        diffAnchorMs = null
                    } else {
                        // Normal tap: show full date
                        Toast.makeText(context, formatTimestampFull(ms), Toast.LENGTH_SHORT).show()
                    }
                },
                onTimestampLongPress = { ms ->
                    diffAnchorMs = ms
                    Toast.makeText(context, "Anchor set. Tap another timestamp for diff.", Toast.LENGTH_SHORT).show()
                },
                onClick = {
                    if (isExpanded) {
                        expandedSnapshots.remove(snapshot.id)
                        expandedStates.remove(snapshot.id)
                    } else {
                        scope.launch {
                            expandedSnapshots[snapshot.id] = onLoadEntries(snapshot.id)
                        }
                    }
                },
            )

            androidx.compose.animation.AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically(),
                exit = shrinkVertically(),
            ) {
                val entries = expandedSnapshots[snapshot.id] ?: emptyList()
                val expandedStateSet = expandedStates[snapshot.id] ?: emptySet()

                SnapshotBreakdown(
                    snapshot = snapshot,
                    entries = entries,
                    expandedStateSet = expandedStateSet,
                    pinnedProcesses = pinnedProcesses,
                    isDark = isDark,
                    onToggleState = { state ->
                        val current = expandedStates[snapshot.id] ?: emptySet()
                        if (state in current) {
                            val next = current - state
                            if (next.isEmpty()) expandedStates.remove(snapshot.id)
                            else expandedStates[snapshot.id] = next
                        } else {
                            expandedStates[snapshot.id] = current + state
                        }
                    },
                    onPinProcess = onPinProcess,
                    onUnpinProcess = onUnpinProcess,
                    onShowDetail = { processDetail = it },
                )
            }
        }
    }

    val showFab = scrolledFromTop

    androidx.compose.animation.AnimatedVisibility(
        visible = showFab,
        modifier = Modifier
            .align(Alignment.BottomEnd)
            .padding(16.dp),
        enter = fadeIn(tween(200)),
        exit = fadeOut(tween(200)),
    ) {
        androidx.compose.material3.SmallFloatingActionButton(
            onClick = { scope.launch { listState.animateScrollToItem(0) } },
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ) {
            Icon(
                Icons.Default.KeyboardArrowUp,
                contentDescription = "Scroll to top",
                modifier = Modifier.size(20.dp),
            )
        }
    }
    } // Box
    } // Column
}

// ── Snapshot row with stacked bar ───────────────────────────────────────────

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SnapshotRow(
    snapshot: SnapshotWithCounts,
    isExpanded: Boolean,
    isDark: Boolean,
    diffAnchorMs: Long?,
    onTimestampTap: (Long) -> Unit,
    onTimestampLongPress: (Long) -> Unit,
    onClick: () -> Unit,
) {
    val timeStr = remember(snapshot.timestamp) { formatTimestamp(snapshot.timestamp) }
    val isAnchor = diffAnchorMs == snapshot.timestamp

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                timeStr,
                style = MaterialTheme.typography.labelSmall,
                color = if (isAnchor) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = if (isAnchor) FontWeight.Bold else null,
                modifier = Modifier
                    .combinedClickable(
                        onClick = { onTimestampTap(snapshot.timestamp) },
                        onLongClick = { onTimestampLongPress(snapshot.timestamp) },
                    ),
            )
            Spacer(Modifier.weight(1f))
            Text(
                buildString {
                    append("${snapshot.totalProcesses} procs")
                    if (snapshot.frozenCount > 0) append(" / ${snapshot.frozenCount} frozen")
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Icon(
                if (isExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(Modifier.height(4.dp))

        StackedBar(snapshot.stateCounts, snapshot.totalProcesses, isDark)
    }
}

@Composable
private fun StackedBar(stateCounts: Map<String, Int>, total: Int, isDark: Boolean) {
    if (total == 0) return

    // Sort by count descending (biggest segments first)
    val sorted = remember(stateCounts) {
        stateCounts.entries
            .sortedByDescending { it.value }
            .map { it.key to it.value }
    }

    val separatorColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(28.dp)
            .clip(RoundedCornerShape(4.dp))
            .border(
                0.5.dp,
                MaterialTheme.colorScheme.outline.copy(alpha = 0.2f),
                RoundedCornerShape(4.dp),
            )
            .drawBehind {
                var x = 0f
                for ((state, count) in sorted) {
                    val w = (count.toFloat() / total) * size.width
                    val color = ProcStateColors.get(state, isDark)
                    drawRect(color, Offset(x, 0f), Size(w, size.height))
                    // Separator line between segments
                    if (x > 0f) {
                        drawRect(separatorColor, Offset(x, 0f), Size(1f, size.height))
                    }
                    x += w
                }
            },
    ) {
        // Overlay count labels for large-enough segments
        Row(Modifier.matchParentSize()) {
            for ((state, count) in sorted) {
                val fraction = count.toFloat() / total
                Box(
                    modifier = Modifier
                        .weight(fraction)
                        .height(28.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (fraction > 0.05f) {
                        val color = ProcStateColors.get(state, isDark)
                        val textColor = if (ProcStateColors.useWhiteText(color)) Color.White else Color(0xFF1A1A1A)
                        Text(
                            "$count",
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                            color = textColor,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

// ── Expanded breakdown ──────────────────────────────────────────────────────

@Composable
private fun SnapshotBreakdown(
    snapshot: SnapshotWithCounts,
    entries: List<ProcessEntryEntity>,
    expandedStateSet: Set<String>,
    pinnedProcesses: List<ProcessKey>,
    isDark: Boolean,
    onToggleState: (String) -> Unit,
    onPinProcess: (ProcessKey) -> Unit,
    onUnpinProcess: (ProcessKey) -> Unit,
    onShowDetail: (DotDetail) -> Unit,
) {
    val sorted = remember(snapshot.stateCounts) {
        snapshot.stateCounts.entries
            .sortedByDescending { it.value }
            .map { it.key to it.value }
    }

    var localSearch by remember { mutableStateOf("") }
    var debouncedSearch by remember { mutableStateOf("") }

    // Debounce search to avoid animating on every keystroke
    LaunchedEffect(localSearch) {
        if (localSearch.isBlank()) {
            debouncedSearch = ""
        } else {
            kotlinx.coroutines.delay(200)
            debouncedSearch = localSearch
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, end = 8.dp, bottom = 8.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
            .padding(8.dp),
    ) {
        // Search bar
        OutlinedTextField(
            value = localSearch,
            onValueChange = { localSearch = it },
            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
            placeholder = { Text("Search\u2026", style = MaterialTheme.typography.bodySmall) },
            leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(16.dp)) },
            trailingIcon = {
                if (localSearch.isNotEmpty()) {
                    IconButton(onClick = { localSearch = "" }, modifier = Modifier.size(24.dp)) {
                        Icon(Icons.Default.Close, null, Modifier.size(14.dp))
                    }
                }
            },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodySmall,
        )

        // When searching, auto-expand states that have matching processes
        val searchMatchingStates = remember(debouncedSearch, entries) {
            if (debouncedSearch.isBlank()) emptySet()
            else {
                val q = debouncedSearch.lowercase()
                val states = entries.filter { q in it.name.lowercase() }.map { it.procState }.toMutableSet()
                if (entries.any { it.frozen && q in it.name.lowercase() }) states.add("__frozen__")
                states
            }
        }

        for ((index, pair) in sorted.withIndex()) {
            val (state, count) = pair
            val isStateExpanded = state in expandedStateSet || state in searchMatchingStates

            val matchCount = if (localSearch.isBlank()) null
                else entries.count { it.procState == state && localSearch.lowercase() in it.name.lowercase() }
            StateRow(
                state = state,
                count = count,
                total = snapshot.totalProcesses,
                matchCount = matchCount,
                isExpanded = isStateExpanded,
                isDark = isDark,
                onClick = { onToggleState(state) },
            )

            AnimatedVisibility(
                visible = isStateExpanded,
                enter = expandVertically(),
                exit = shrinkVertically(),
            ) {
                val stateEntries = entries.filter { it.procState == state }
                val filtered = if (debouncedSearch.isBlank()) stateEntries
                    else stateEntries.filter { debouncedSearch.lowercase() in it.name.lowercase() }
                ProcessList(
                    entries = filtered,
                    pinnedProcesses = pinnedProcesses,
                    onPinProcess = onPinProcess,
                    onUnpinProcess = onUnpinProcess,
                    onShowDetail = onShowDetail,
                )
            }

            if (index < sorted.lastIndex) {
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f),
                    thickness = 0.5.dp,
                )
            }
        }

        // Frozen section (not double-counted in total)
        if (snapshot.frozenCount > 0) {
            HorizontalDivider(
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f),
                thickness = 0.5.dp,
            )
            val isFrozenExpanded = "__frozen__" in expandedStateSet || "__frozen__" in searchMatchingStates
            val frozenColor = ProcStateColors.get("frzn", isDark)
            val frozenMatchCount = if (localSearch.isBlank()) null
                else entries.count { it.frozen && localSearch.lowercase() in it.name.lowercase() }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onToggleState("__frozen__") }
                    .padding(vertical = 6.dp, horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(frozenColor),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "Frozen",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                // Mini proportion bar
                Box(
                    modifier = Modifier
                        .width(60.dp)
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(snapshot.frozenCount.toFloat() / snapshot.totalProcesses.coerceAtLeast(1))
                            .height(8.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(frozenColor),
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    if (frozenMatchCount != null) "$frozenMatchCount/${snapshot.frozenCount}" else "${snapshot.frozenCount}",
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = if (frozenMatchCount != null && frozenMatchCount > 0) MaterialTheme.colorScheme.primary
                           else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(if (frozenMatchCount != null) 48.dp else 36.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                )
                Icon(
                    if (isFrozenExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            AnimatedVisibility(visible = isFrozenExpanded, enter = expandVertically(), exit = shrinkVertically()) {
                val frozenEntries = entries.filter { it.frozen }
                val filtered = if (debouncedSearch.isBlank()) frozenEntries
                    else frozenEntries.filter { debouncedSearch.lowercase() in it.name.lowercase() }
                ProcessList(
                    entries = filtered,
                    pinnedProcesses = pinnedProcesses,
                    onPinProcess = onPinProcess,
                    onUnpinProcess = onUnpinProcess,
                    onShowDetail = onShowDetail,
                )
            }
        }
    }
}

@Composable
private fun StateRow(
    state: String,
    count: Int,
    total: Int,
    matchCount: Int? = null,
    isExpanded: Boolean,
    isDark: Boolean,
    onClick: () -> Unit,
) {
    val color = ProcStateColors.get(state, isDark)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Color dot
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            ProcStateColors.label(state),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        // Mini proportion bar (left-aligned fill)
        Box(
            modifier = Modifier
                .width(60.dp)
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(count.toFloat() / total)
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(color),
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(
            if (matchCount != null) "$matchCount/$count" else "$count",
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = if (matchCount != null && matchCount > 0) MaterialTheme.colorScheme.primary
                   else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.width(if (matchCount != null) 48.dp else 36.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
        Icon(
            if (isExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Process list within a state ─────────────────────────────────────────────

@Composable
private fun ProcessList(
    entries: List<ProcessEntryEntity>,
    pinnedProcesses: List<ProcessKey>,
    onPinProcess: (ProcessKey) -> Unit,
    onUnpinProcess: (ProcessKey) -> Unit,
    onShowDetail: (DotDetail) -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, top = 4.dp, bottom = 4.dp),
    ) {
        val pinnedKeys = remember(pinnedProcesses) { pinnedProcesses.toSet() }
        for (entry in entries) {
            val key = ProcessKey(entry.name, entry.uid)
            val isPinned = key in pinnedKeys

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        onShowDetail(DotDetail(
                            name = entry.name,
                            uid = entry.uid,
                            pid = entry.pid,
                            state = entry.procState,
                            stateLabel = ProcStateColors.label(entry.procState),
                            frozen = entry.frozen,
                            started = false,
                            timestamp = "",
                        ))
                    }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    entry.name,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${entry.pid}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                )
                Spacer(Modifier.width(6.dp))
                if (!isPinned) {
                    IconButton(
                        onClick = { onPinProcess(key) },
                        modifier = Modifier.size(22.dp),
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = "Pin",
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                } else {
                    Text(
                        "pinned",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f),
                        modifier = Modifier.clickable { onUnpinProcess(key) },
                    )
                }
            }
        }
    }
}

// ── Legend ───────────────────────────────────────────────────────────────────

@Composable
fun ProcStateLegend(
    visibleStates: Set<String>,
    stateFilter: Set<String> = emptySet(),
    onTap: () -> Unit = {},
) {
    if (visibleStates.isEmpty()) return

    val isDark = LocalIsDarkTheme.current
    val states = visibleStates.sortedBy { ProcStateColors.label(it) }
    val hasFilter = stateFilter.isNotEmpty()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .clickable(onClick = onTap)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (state in states) {
            val dimmed = hasFilter && state !in stateFilter
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = if (dimmed) Modifier.alpha(0.3f) else Modifier,
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(ProcStateColors.get(state, isDark)),
                )
                Spacer(Modifier.width(3.dp))
                Text(
                    ProcStateColors.label(state),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

private val timeFormat = object : ThreadLocal<SimpleDateFormat>() {
    override fun initialValue() = SimpleDateFormat("HH:mm:ss", Locale.US)
}
private val dateTimeFormat = object : ThreadLocal<SimpleDateFormat>() {
    override fun initialValue() = SimpleDateFormat("MMM dd HH:mm", Locale.US)
}
private val fullDateTimeFormat = object : ThreadLocal<SimpleDateFormat>() {
    override fun initialValue() = SimpleDateFormat("EEEE, MMMM d, HH:mm:ss", Locale.US)
}

fun formatTimestamp(millis: Long): String {
    val now = System.currentTimeMillis()
    return when {
        now - millis < 24 * 60 * 60_000L -> timeFormat.get()!!.format(Date(millis))
        else -> dateTimeFormat.get()!!.format(Date(millis))
    }
}

fun formatTimestampFull(millis: Long): String =
    fullDateTimeFormat.get()!!.format(Date(millis))

fun formatTimeDiff(ms: Long): String {
    val sec = ms / 1000
    val min = sec / 60
    val hr = min / 60
    val day = hr / 24
    return when {
        day > 0 -> "${day}d ${hr % 24}h ${min % 60}m"
        hr > 0 -> "${hr}h ${min % 60}m ${sec % 60}s"
        min > 0 -> "${min}m ${sec % 60}s"
        else -> "${sec}s"
    }
}

// ── State filter chips (same styling as ProcessChip in ProcessTab) ───────────

@Composable
private fun StateFilterChips(
    states: Set<String>,
    isDark: Boolean,
    onRemoveState: (String) -> Unit,
    onTap: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (state in states.sortedBy { ProcStateColors.label(it).lowercase() }) {
            val color = ProcStateColors.get(state, isDark)
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
                    ProcStateColors.label(state),
                    style = MaterialTheme.typography.bodySmall,
                    color = color,
                    maxLines = 1,
                )
                IconButton(onClick = { onRemoveState(state) }, modifier = Modifier.size(18.dp)) {
                    Icon(Icons.Default.Close, null, Modifier.size(11.dp), tint = color)
                }
            }
        }
    }
}
