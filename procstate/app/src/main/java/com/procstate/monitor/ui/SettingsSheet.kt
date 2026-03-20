package com.procstate.monitor.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import com.procstate.monitor.ui.theme.ThemeMode
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale

@Composable
fun SettingsSheet(
    themeMode: ThemeMode,
    snapshotCount: Int,
    isExporting: Boolean,
    exportProgress: String?,
    autoMemoryDump: Boolean,
    exportRange: Long,
    onSetAutoMemoryDump: (Boolean) -> Unit,
    onSetTheme: (ThemeMode) -> Unit,
    onClearAll: () -> Unit,
    onPrune: (Long) -> Unit,
    onExport: (Long) -> Unit,
    onExportRangeChange: (Long) -> Unit,
    onLoadSessions: (suspend () -> List<DataSession>)? = null,
    onPinSession: ((startMs: Long) -> Unit)? = null,
    onExportSession: ((sessionId: String) -> Unit)? = null,
) {
    var confirmClear by remember { mutableStateOf(false) }
    var confirmPrune by remember { mutableStateOf<Long?>(null) }
    var showSessions by remember { mutableStateOf(false) }
    var sessions by remember { mutableStateOf<List<DataSession>?>(null) }
    val hasData = snapshotCount > 0

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.titleLarge)

        Spacer(Modifier.height(16.dp))

        // Theme
        Text("Theme", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        for (mode in ThemeMode.entries) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = themeMode == mode, onClick = { onSetTheme(mode) })
                Column {
                    Text(
                        mode.name.lowercase().replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (mode == ThemeMode.SYSTEM) {
                        Text(
                            "Follow device setting",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
        Spacer(Modifier.height(16.dp))

        // Memory
        Text("Memory", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Auto-dump pinned processes", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "Captures meminfo for each pinned process on every snapshot. Significantly slows recording.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.size(8.dp))
            androidx.compose.material3.Switch(
                checked = autoMemoryDump,
                onCheckedChange = onSetAutoMemoryDump,
            )
        }

        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
        Spacer(Modifier.height(16.dp))

        // Export
        Text("Export", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Export to Perfetto trace format (Chrome JSON)",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for ((label, millis) in listOf(
                "All" to 0L,
                "5m" to 5 * 60_000L,
                "30m" to 30 * 60_000L,
                "1h" to 60 * 60_000L,
                "6h" to 6 * 60 * 60_000L,
                "24h" to 24 * 60 * 60_000L,
                "7d" to 7 * 24 * 60 * 60_000L,
            )) {
                FilterChip(
                    selected = exportRange == millis,
                    onClick = { onExportRangeChange(millis) },
                    label = { Text(label) },
                )
            }
        }
        Spacer(Modifier.height(8.dp))

        OutlinedButton(
            onClick = { onExport(exportRange) },
            enabled = hasData && !isExporting,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (isExporting) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.size(8.dp))
                Text(exportProgress ?: "Exporting\u2026")
            } else {
                Text("Export to Perfetto")
            }
        }

        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
        Spacer(Modifier.height(16.dp))

        // Data management
        Text("Data", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        val scope = androidx.compose.runtime.rememberCoroutineScope()
        Text(
            if (hasData) "$snapshotCount snapshots stored" else "No data stored yet",
            style = MaterialTheme.typography.bodySmall,
            color = if (hasData) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = if (hasData && onLoadSessions != null) {
                Modifier.clickable {
                    showSessions = true
                    scope.launch { sessions = onLoadSessions() }
                }
            } else Modifier,
        )
        Spacer(Modifier.height(8.dp))

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = { confirmPrune = 7 * 24 * 60 * 60_000L }, enabled = hasData) {
                Text("Prune 7d")
            }
            TextButton(onClick = { confirmPrune = 24 * 60 * 60_000L }, enabled = hasData) {
                Text("Prune 24h")
            }
            Spacer(Modifier.weight(1f))
            Button(
                onClick = { confirmClear = true },
                enabled = hasData,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            ) {
                Text("Clear all")
            }
        }

        Spacer(Modifier.height(16.dp))
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Clear all data?") },
            text = { Text("This will permanently delete all $snapshotCount snapshots.") },
            confirmButton = {
                Button(
                    onClick = { onClearAll(); confirmClear = false },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text("Clear") }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Cancel") } },
        )
    }

    confirmPrune?.let { millis ->
        val label = if (millis >= 7 * 24 * 60 * 60_000L) "7 days" else "24 hours"
        AlertDialog(
            onDismissRequest = { confirmPrune = null },
            title = { Text("Prune old data?") },
            text = { Text("Delete all snapshots older than $label?") },
            confirmButton = {
                Button(onClick = { onPrune(millis); confirmPrune = null }) { Text("Prune") }
            },
            dismissButton = { TextButton(onClick = { confirmPrune = null }) { Text("Cancel") } },
        )
    }

    if (showSessions) {
        AlertDialog(
            onDismissRequest = { showSessions = false },
            title = { Text("Collection History") },
            text = {
                if (sessions == null) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    }
                } else if (sessions!!.isEmpty()) {
                    Text("No data collected yet")
                } else {
                    val now = System.currentTimeMillis()
                    val fmt = remember { SimpleDateFormat("MMM d, HH:mm", Locale.getDefault()) }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(sessions.orEmpty()) { session ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .then(if (onPinSession != null) Modifier.clickable {
                                        onPinSession(session.startMs)
                                        showSessions = false
                                    } else Modifier),
                            ) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        if (session.isSingleSnapshot) {
                                            Text("Snapshot", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                                            Text(fmt.format(session.startMs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        } else {
                                            Text("Recording \u00b7 ${session.count} snapshots", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                                            Text("${fmt.format(session.startMs)} \u2013 ${fmt.format(session.endMs)} \u00b7 ${formatDuration(session.durationMs)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    }
                                    Text(
                                        formatAgo(now - session.startMs),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    IconButton(
                                        onClick = {
                                            onExportSession?.invoke(session.sessionId)
                                            showSessions = false
                                        },
                                    ) {
                                        Icon(
                                            Icons.Default.Share,
                                            "Export",
                                            tint = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                                HorizontalDivider(
                                    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.1f),
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showSessions = false }) { Text("Close") }
            },
        )
    }
}

private fun formatAgo(ms: Long): String {
    val sec = ms / 1000
    val min = sec / 60
    val hr = min / 60
    val day = hr / 24
    return when {
        day > 0 -> "${day}d ago"
        hr > 0 -> "${hr}h ago"
        min > 0 -> "${min}m ago"
        else -> "just now"
    }
}

private fun formatDuration(ms: Long): String {
    val sec = ms / 1000
    val min = sec / 60
    val hr = min / 60
    return when {
        hr > 0 -> "${hr}h ${min % 60}m"
        min > 0 -> "${min}m ${sec % 60}s"
        else -> "${sec}s"
    }
}
