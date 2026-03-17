package com.procstate.monitor.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
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
import com.procstate.monitor.ui.theme.ThemeMode

@Composable
fun SettingsSheet(
    themeMode: ThemeMode,
    snapshotCount: Int,
    isExporting: Boolean,
    autoMemoryDump: Boolean,
    onSetAutoMemoryDump: (Boolean) -> Unit,
    onSetTheme: (ThemeMode) -> Unit,
    onClearAll: () -> Unit,
    onPrune: (Long) -> Unit,
    onExport: (Long) -> Unit,
    onDismiss: () -> Unit,
) {
    var confirmClear by remember { mutableStateOf(false) }
    var confirmPrune by remember { mutableStateOf<Long?>(null) }
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

        // Export
        Text("Export", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Export to Perfetto trace format (Chrome JSON)",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))

        var exportRange by remember { mutableStateOf(0L) } // 0 = all

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
                    onClick = { exportRange = millis },
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
                Text("Exporting...")
            } else {
                Text("Export to Perfetto")
            }
        }

        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
        Spacer(Modifier.height(16.dp))

        // Auto memory dump
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

        // Data management
        Text("Data", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            if (hasData) "$snapshotCount snapshots stored" else "No data stored yet",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { confirmPrune = 7 * 24 * 60 * 60_000L }, enabled = hasData) {
                Text("Prune older than 7d")
            }
            TextButton(onClick = { confirmPrune = 24 * 60 * 60_000L }, enabled = hasData) {
                Text("Prune older than 24h")
            }
        }

        Spacer(Modifier.height(8.dp))

        Button(
            onClick = { confirmClear = true },
            enabled = hasData,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
        ) {
            Text("Clear all data")
        }

        Spacer(Modifier.height(16.dp))

        TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) {
            Text("Done")
        }
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
}
