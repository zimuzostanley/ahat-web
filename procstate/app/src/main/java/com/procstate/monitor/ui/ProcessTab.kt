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
import androidx.compose.foundation.layout.IntrinsicSize
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
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
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

/** Track colors: light and dark variants for the column headers. Wraps around. */
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

private const val COL_WIDTH_DP = 64

@Composable
fun ProcessTab(
    trackedProcesses: List<String>,
    timelineRows: List<ProcessTimelineRow>,
    allProcessNames: List<String>,
    onAddProcess: (String) -> Unit,
    onRemoveProcess: (String) -> Unit,
    showPicker: Boolean = false,
    onDismissPicker: () -> Unit = {},
) {
    val isDark = LocalIsDarkTheme.current

    Column(Modifier.fillMaxSize()) {
        // Picker (toggled from top bar +)
        AnimatedVisibility(visible = showPicker, enter = expandVertically(), exit = shrinkVertically()) {
            ProcessPicker(
                allNames = allProcessNames,
                trackedNames = trackedProcesses,
                onSelect = onAddProcess,
                onDismiss = onDismissPicker,
            )
        }

        // Chips row
        if (trackedProcesses.isNotEmpty()) {
            TrackedChipsRow(
                trackedProcesses = trackedProcesses,
                isDark = isDark,
                onRemoveProcess = onRemoveProcess,
            )
        }

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
                        "Add from the By State tab or tap + in the top bar",
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

        val scrollState = rememberScrollState()

        // Column headers (horizontally scrollable, synced with body)
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
                for ((i, name) in trackedProcesses.withIndex()) {
                    val trackColor = TrackColors[i % TrackColors.size].let {
                        if (isDark) it.dark else it.light
                    }
                    Text(
                        name.substringAfterLast('.'),
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

        // Timeline (horizontally scrollable columns, synced scroll)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 4.dp),
        ) {
            items(timelineByTimestamp, key = { it.first }) { (timestamp, stateMap) ->
                TimelineRow(
                    timestamp = timestamp,
                    trackedProcesses = trackedProcesses,
                    stateMap = stateMap,
                    isDark = isDark,
                    scrollState = scrollState,
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
    scrollState: androidx.compose.foundation.ScrollState,
) {
    val timeStr = remember(timestamp) { formatTimestamp(timestamp) }
    val context = LocalContext.current

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            timeStr,
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
            for (name in trackedProcesses) {
                val state = stateMap[name]

                Box(
                    modifier = Modifier.width(COL_WIDTH_DP.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (state != null) {
                        val dotColor = ProcStateColors.get(state, isDark)
                        Box(
                            modifier = Modifier
                                .size(14.dp)
                                .clip(CircleShape)
                                .background(dotColor)
                                .border(1.5.dp, dotColor.copy(alpha = 0.3f), CircleShape)
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
                        Box(
                            modifier = Modifier
                                .size(6.dp)
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
}

// ── Tracked process chips (horizontally scrollable) ─────────────────────────

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TrackedChipsRow(
    trackedProcesses: List<String>,
    isDark: Boolean,
    onRemoveProcess: (String) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for ((i, name) in trackedProcesses.withIndex()) {
            val trackColor = TrackColors[i % TrackColors.size].let {
                if (isDark) it.dark else it.light
            }
            ProcessChip(name = name, color = trackColor, onRemove = { onRemoveProcess(name) })
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
            .padding(start = 8.dp, end = 4.dp, top = 3.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
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
            Icon(Icons.Default.Close, null, Modifier.size(11.dp), tint = color)
        }
    }
}

// ── Process picker (shown from top bar +) ───────────────────────────────────

@Composable
private fun ProcessPicker(
    allNames: List<String>,
    trackedNames: List<String>,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var search by remember { mutableStateOf("") }
    val filtered = remember(allNames, search, trackedNames) {
        val available = allNames.filter { it !in trackedNames }
        if (search.isBlank()) available.take(20)
        else available.filter { search.lowercase() in it.lowercase() }.take(20)
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.TextField(
                value = search,
                onValueChange = { search = it },
                modifier = Modifier
                    .weight(1f)
                    .height(36.dp),
                placeholder = { Text("Search processes\u2026", style = MaterialTheme.typography.bodySmall) },
                leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(14.dp)) },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodySmall,
                colors = TextFieldDefaults.colors(
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                    unfocusedIndicatorColor = Color.Transparent,
                    focusedIndicatorColor = MaterialTheme.colorScheme.primary,
                ),
                shape = RoundedCornerShape(4.dp),
            )
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = onDismiss, modifier = Modifier.size(24.dp)) {
                Icon(Icons.Default.Close, "Close", Modifier.size(16.dp))
            }
        }
        Spacer(Modifier.height(4.dp))
        for (name in filtered) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelect(name) }
                    .padding(vertical = 3.dp, horizontal = 4.dp),
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
