package com.procstate.monitor.ui

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import com.procstate.monitor.ui.theme.LocalIsDarkTheme
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
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.procstate.monitor.data.ProcessTimelineRow
import com.procstate.monitor.ui.theme.ProcStateColors

/** Track colors: light and dark variants for the column headers. */
private data class TrackColor(val light: Color, val dark: Color)

private val TrackColors = listOf(
    TrackColor(Color(0xFF4A55A2), Color(0xFF8B9CF7)),
    TrackColor(Color(0xFF0F9D9F), Color(0xFF5EEAD4)),
    TrackColor(Color(0xFFDB2777), Color(0xFFF472B6)),
    TrackColor(Color(0xFFD97706), Color(0xFFFBBF24)),
    TrackColor(Color(0xFF16A34A), Color(0xFF4ADE80)),
)

@Composable
fun ProcessTab(
    trackedProcesses: List<String>,
    timelineRows: List<ProcessTimelineRow>,
    allProcessNames: List<String>,
    onAddProcess: (String) -> Unit,
    onRemoveProcess: (String) -> Unit,
) {
    val isDark = LocalIsDarkTheme.current

    Column(Modifier.fillMaxSize()) {
        TrackedProcessHeader(
            trackedProcesses = trackedProcesses,
            allProcessNames = allProcessNames,
            isDark = isDark,
            onAddProcess = onAddProcess,
            onRemoveProcess = onRemoveProcess,
        )

        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))

        if (trackedProcesses.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "No processes tracked",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Add from the By State tab or tap + above",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    )
                }
            }
            return
        }

        if (timelineRows.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    "No data for tracked processes in this time range",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return
        }

        val timelineByTimestamp = remember(timelineRows) {
            timelineRows.groupBy { it.timestamp }
                .toSortedMap(compareByDescending { it })
                .map { (ts, rows) -> ts to rows.associate { it.name to it.procState } }
        }

        // Column headers
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Time",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.width(72.dp),
            )
            for ((i, name) in trackedProcesses.withIndex()) {
                val trackColor = TrackColors[i % TrackColors.size].let {
                    if (isDark) it.dark else it.light
                }
                Text(
                    name.substringAfterLast('.'),
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = trackColor,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
            }
        }

        // Timeline
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
        ) {
            items(timelineByTimestamp, key = { it.first }) { (timestamp, stateMap) ->
                TimelineRow(
                    timestamp = timestamp,
                    trackedProcesses = trackedProcesses,
                    stateMap = stateMap,
                    isDark = isDark,
                )
            }
        }
    }
}

// ── Timeline row with colored dots ──────────────────────────────────────────

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TimelineRow(
    timestamp: Long,
    trackedProcesses: List<String>,
    stateMap: Map<String, String>,
    isDark: Boolean,
) {
    val timeStr = remember(timestamp) { formatTimestamp(timestamp) }
    val context = LocalContext.current
    val lineColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.1f)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .drawBehind {
                // Dashed vertical connector lines
                val segW = (size.width - 72.dp.toPx()) / trackedProcesses.size.coerceAtLeast(1)
                val startX = 72.dp.toPx()
                for (i in trackedProcesses.indices) {
                    val cx = startX + segW * i + segW / 2
                    drawLine(
                        lineColor, Offset(cx, 0f), Offset(cx, size.height),
                        strokeWidth = 1.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(3f, 3f)),
                    )
                }
            }
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            timeStr,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(72.dp),
        )

        for (name in trackedProcesses) {
            val state = stateMap[name]

            Box(
                modifier = Modifier.weight(1f),
                contentAlignment = Alignment.Center,
            ) {
                if (state != null) {
                    val dotColor = ProcStateColors.get(state, isDark)
                    // Polished dot: filled circle with outer ring
                    Box(
                        modifier = Modifier
                            .size(16.dp)
                            .clip(CircleShape)
                            .background(dotColor)
                            .border(2.dp, dotColor.copy(alpha = 0.3f), CircleShape)
                            .combinedClickable(
                                onClick = {},
                                onLongClick = {
                                    Toast
                                        .makeText(context, "$name: $state", Toast.LENGTH_SHORT)
                                        .show()
                                },
                            ),
                    )
                } else {
                    // Not present: small hollow circle
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .border(
                                1.dp,
                                MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                                CircleShape,
                            ),
                    )
                }
            }
        }
    }
}

// ── Tracked process header ──────────────────────────────────────────────────

@Composable
private fun TrackedProcessHeader(
    trackedProcesses: List<String>,
    allProcessNames: List<String>,
    isDark: Boolean,
    onAddProcess: (String) -> Unit,
    onRemoveProcess: (String) -> Unit,
) {
    var showPicker by remember { mutableStateOf(false) }

    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for ((i, name) in trackedProcesses.withIndex()) {
                val trackColor = TrackColors[i % TrackColors.size].let {
                    if (isDark) it.dark else it.light
                }
                ProcessChip(name = name, color = trackColor, onRemove = { onRemoveProcess(name) })
            }
            if (trackedProcesses.size < 5) {
                IconButton(
                    onClick = { showPicker = !showPicker },
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                ) {
                    Icon(
                        if (showPicker) Icons.Default.Close else Icons.Default.Add,
                        contentDescription = "Add process",
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }
        }

        AnimatedVisibility(visible = showPicker, enter = expandVertically(), exit = shrinkVertically()) {
            ProcessPicker(
                allNames = allProcessNames,
                trackedNames = trackedProcesses,
                onSelect = { name ->
                    onAddProcess(name)
                    if (trackedProcesses.size >= 4) showPicker = false
                },
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ProcessChip(name: String, color: Color, onRemove: () -> Unit) {
    val context = LocalContext.current
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(color.copy(alpha = 0.1f))
            .border(1.dp, color.copy(alpha = 0.25f), RoundedCornerShape(14.dp))
            .combinedClickable(
                onClick = {},
                onLongClick = { Toast.makeText(context, name, Toast.LENGTH_SHORT).show() },
            )
            .padding(start = 8.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(color),
        )
        Spacer(Modifier.width(4.dp))
        Text(
            name.substringAfterLast('.'),
            style = MaterialTheme.typography.bodySmall,
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        IconButton(onClick = onRemove, modifier = Modifier.size(18.dp)) {
            Icon(Icons.Default.Close, null, Modifier.size(12.dp), tint = color)
        }
    }
}

@Composable
private fun ProcessPicker(
    allNames: List<String>,
    trackedNames: List<String>,
    onSelect: (String) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    val filtered = remember(allNames, search, trackedNames) {
        val available = allNames.filter { it !in trackedNames }
        if (search.isBlank()) available.take(20)
        else available.filter { search.lowercase() in it.lowercase() }.take(20)
    }

    Column(Modifier.padding(top = 8.dp)) {
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search all processes\u2026", style = MaterialTheme.typography.bodySmall) },
            leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(16.dp)) },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodySmall,
            colors = OutlinedTextFieldDefaults.colors(
                unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
            ),
        )
        Spacer(Modifier.height(4.dp))
        for (name in filtered) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelect(name) }
                    .padding(vertical = 4.dp, horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    name,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(Icons.Default.Add, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
            }
        }
        if (filtered.isEmpty()) {
            Text(
                if (allNames.isEmpty()) "No processes captured yet" else "No matches",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(8.dp),
            )
        }
    }
}
