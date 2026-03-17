package com.procstate.monitor.ui

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.procstate.monitor.data.SnapshotWithCounts
import com.procstate.monitor.ui.theme.ProcStateColors
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ProcStateTab(
    snapshots: List<SnapshotWithCounts>,
    trackedProcesses: List<String>,
    onAddTrackedProcess: (String) -> Unit,
    onLoadEntries: suspend (Long) -> List<ProcessEntryEntity>,
) {
    if (snapshots.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "No snapshots yet",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "Tap Snap or Record to capture process state",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                )
            }
        }
        return
    }

    val expandedSnapshots = remember { mutableStateMapOf<Long, List<ProcessEntryEntity>>() }
    val expandedStates = remember { mutableStateMapOf<Long, String>() }
    val scope = rememberCoroutineScope()
    val isDark = LocalIsDarkTheme.current

    LazyColumn(
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

            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically(),
                exit = shrinkVertically(),
            ) {
                val entries = expandedSnapshots[snapshot.id] ?: emptyList()
                val expandedState = expandedStates[snapshot.id]

                SnapshotBreakdown(
                    snapshot = snapshot,
                    entries = entries,
                    expandedState = expandedState,
                    trackedProcesses = trackedProcesses,
                    isDark = isDark,
                    onToggleState = { state ->
                        if (expandedState == state) {
                            expandedStates.remove(snapshot.id)
                        } else {
                            expandedStates[snapshot.id] = state
                        }
                    },
                    onAddTrackedProcess = onAddTrackedProcess,
                )
            }
        }
    }
}

// ── Snapshot row with stacked bar ───────────────────────────────────────────

@Composable
private fun SnapshotRow(
    snapshot: SnapshotWithCounts,
    isExpanded: Boolean,
    isDark: Boolean,
    onClick: () -> Unit,
) {
    val timeStr = remember(snapshot.timestamp) { formatTimestamp(snapshot.timestamp) }
    val fullTimeStr = remember(snapshot.timestamp) { formatTimestampFull(snapshot.timestamp) }
    val context = LocalContext.current

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
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable {
                    Toast.makeText(context, fullTimeStr, Toast.LENGTH_SHORT).show()
                },
            )
            Spacer(Modifier.weight(1f))
            Text(
                "${snapshot.totalProcesses} procs",
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
    expandedState: String?,
    trackedProcesses: List<String>,
    isDark: Boolean,
    onToggleState: (String) -> Unit,
    onAddTrackedProcess: (String) -> Unit,
) {
    val sorted = remember(snapshot.stateCounts) {
        snapshot.stateCounts.entries
            .sortedByDescending { it.value }
            .map { it.key to it.value }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, end = 8.dp, bottom = 8.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
            .padding(8.dp),
    ) {
        for ((index, pair) in sorted.withIndex()) {
            val (state, count) = pair
            val isStateExpanded = expandedState == state

            StateRow(
                state = state,
                count = count,
                total = snapshot.totalProcesses,
                isExpanded = isStateExpanded,
                isDark = isDark,
                onClick = { onToggleState(state) },
            )

            AnimatedVisibility(
                visible = isStateExpanded,
                enter = expandVertically(),
                exit = shrinkVertically(),
            ) {
                ProcessList(
                    entries = entries.filter { it.procState == state },
                    trackedProcesses = trackedProcesses,
                    onAddTrackedProcess = onAddTrackedProcess,
                )
            }

            if (index < sorted.lastIndex) {
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f),
                    thickness = 0.5.dp,
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
            state,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        // Mini proportion bar
        Box(
            modifier = Modifier
                .width(60.dp)
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
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
            "$count",
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
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
    trackedProcesses: List<String>,
    onAddTrackedProcess: (String) -> Unit,
) {
    var searchQuery by remember { mutableStateOf("") }
    val filtered = remember(entries, searchQuery) {
        if (searchQuery.isBlank()) entries
        else entries.filter { searchQuery.lowercase() in it.name.lowercase() }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, top = 4.dp, bottom = 4.dp),
    ) {
        if (entries.size > 5) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Search\u2026", style = MaterialTheme.typography.bodySmall) },
                leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(16.dp)) },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(Icons.Default.Close, null, Modifier.size(16.dp))
                        }
                    }
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(4.dp))
        }

        val context = LocalContext.current
        for (entry in filtered) {
            val isTracked = entry.name in trackedProcesses

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        Toast
                            .makeText(context, "${entry.name} (PID ${entry.pid})", Toast.LENGTH_SHORT)
                            .show()
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
                if (!isTracked && trackedProcesses.size < 5) {
                    IconButton(
                        onClick = { onAddTrackedProcess(entry.name) },
                        modifier = Modifier.size(22.dp),
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = "Track",
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                } else if (isTracked) {
                    Text(
                        "tracking",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f),
                    )
                }
            }
        }
    }
}

// ── Legend ───────────────────────────────────────────────────────────────────

@Composable
fun ProcStateLegend(visibleStates: Set<String>) {
    if (visibleStates.isEmpty()) return

    val isDark = LocalIsDarkTheme.current
    val states = ProcStateColors.order.filter { it in visibleStates }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (state in states) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(ProcStateColors.get(state, isDark)),
                )
                Spacer(Modifier.width(3.dp))
                Text(
                    state,
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
    override fun initialValue() = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
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
