package com.procstate.monitor.ui

import android.widget.Toast
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.procstate.monitor.data.ProcessTimelineRow
import com.procstate.monitor.ui.theme.LocalIsDarkTheme
import com.procstate.monitor.ui.theme.ProcStateColors

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProcessTab(
    trackedProcesses: List<String>,
    timelineRows: List<ProcessTimelineRow>,
    allProcessNames: List<String>,
    onAddProcess: (String) -> Unit,
    onRemoveProcess: (String) -> Unit,
    showPicker: Boolean = false,
    onOpenPicker: () -> Unit = {},
    onDismissPicker: () -> Unit = {},
) {
    val isDark = LocalIsDarkTheme.current

    // Bottom sheet drawer for process picker
    if (showPicker) {
        ModalBottomSheet(
            onDismissRequest = onDismissPicker,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            ProcessPickerSheet(
                allNames = allProcessNames,
                trackedNames = trackedProcesses,
                onSelect = onAddProcess,
            )
        }
    }

    Column(Modifier.fillMaxSize()) {
        // Chips row
        if (trackedProcesses.isNotEmpty()) {
            TrackedChipsRow(
                trackedProcesses = trackedProcesses,
                isDark = isDark,
                onRemoveProcess = onRemoveProcess,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
        }

        if (trackedProcesses.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "No processes tracked",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Add from the By State tab or tap below",
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

        // Timeline
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

// ── Timeline row ────────────────────────────────────────────────────────────

@Composable
private fun TimelineRow(
    timestamp: Long,
    trackedProcesses: List<String>,
    stateMap: Map<String, String>,
    isDark: Boolean,
    scrollState: androidx.compose.foundation.ScrollState,
) {
    val timeStr = remember(timestamp) { formatTimestamp(timestamp) }
    val fullTimeStr = remember(timestamp) { formatTimestampFull(timestamp) }
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
                .padding(start = 12.dp)
                .clickable {
                    Toast.makeText(context, fullTimeStr, Toast.LENGTH_SHORT).show()
                },
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
                                .border(1.dp, dotColor.copy(alpha = 0.3f), CircleShape)
                                .clickable {
                                    Toast
                                        .makeText(context, "$name: $state", Toast.LENGTH_SHORT)
                                        .show()
                                },
                        )
                    } else {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .border(
                                    1.dp,
                                    MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
                                    CircleShape,
                                ),
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

@Composable
private fun ProcessChip(name: String, color: Color, onRemove: () -> Unit) {
    val context = LocalContext.current
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(color.copy(alpha = 0.1f))
            .border(1.dp, color.copy(alpha = 0.25f), RoundedCornerShape(14.dp))
            .clickable { Toast.makeText(context, name, Toast.LENGTH_SHORT).show() }
            .padding(start = 8.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
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

// ── Process picker (bottom sheet drawer) ────────────────────────────────────

@Composable
private fun ProcessPickerSheet(
    allNames: List<String>,
    trackedNames: List<String>,
    onSelect: (String) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    val filtered = remember(allNames, search, trackedNames) {
        val available = allNames.filter { it !in trackedNames }
        if (search.isBlank()) available.take(30)
        else available.filter { search.lowercase() in it.lowercase() }.take(30)
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Text(
            "Add Process",
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search processes\u2026") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = {
                if (search.isNotEmpty()) {
                    IconButton(onClick = { search = "" }) {
                        Icon(Icons.Default.Close, null)
                    }
                }
            },
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = false),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(filtered) { name ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .clickable { onSelect(name) }
                        .padding(vertical = 8.dp, horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        name,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Icon(
                        Icons.Default.Add, null, Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }

        if (filtered.isEmpty()) {
            Text(
                if (allNames.isEmpty()) "No processes captured yet" else "No processes match your search",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp),
            )
        }

        Spacer(Modifier.height(16.dp))
    }
}
