package com.tracequery.app.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tracequery.app.data.model.HistoryEntry
import com.tracequery.app.ui.MainUiState
import com.tracequery.app.ui.QueryMode
import com.tracequery.app.ui.TabState
import com.tracequery.app.ui.component.DataGrid
import com.tracequery.app.ui.component.SqlEditor
import com.tracequery.app.ui.component.TableBrowser
import com.tracequery.app.ui.theme.CodeFontFamily

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueryScreen(
    uiState: MainUiState,
    onExecuteQuery: (String) -> Unit,
    onSqlChange: (String) -> Unit,
    onTableSelect: (com.tracequery.app.data.model.StdlibTable) -> Unit,
    onModeChange: (QueryMode) -> Unit,
    onSwitchTab: (Int) -> Unit,
    onCloseTab: (Int) -> Unit,
    onLoadHistory: (HistoryEntry) -> Unit,
    onOpenTrace: (() -> Unit)? = null,
    onOpenSettings: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val tab = uiState.activeTab ?: return
    var showHistory by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxSize()) {
        // ── Tab bar (always show if we have tabs — for "+" button) ─────
        if (uiState.tabs.isNotEmpty()) {
            LazyRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(uiState.tabs, key = { it.id }) { t ->
                    val isActive = t.id == uiState.activeTabId
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (isActive) MaterialTheme.colorScheme.surface
                                else MaterialTheme.colorScheme.surfaceVariant
                            )
                            .clickable { onSwitchTab(t.id) }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = t.fileName.take(20),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal,
                        )
                        Spacer(Modifier.width(4.dp))
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "Close tab",
                            modifier = Modifier
                                .size(14.dp)
                                .clickable { onCloseTab(t.id) },
                        )
                    }
                }
                // "+" button to open another trace
                if (onOpenTrace != null) {
                    item {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(MaterialTheme.colorScheme.surfaceVariant)
                                .clickable { onOpenTrace() }
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        ) {
                            Icon(
                                Icons.Default.Add,
                                contentDescription = "Open trace",
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                }
            }
        }

        // ── Loading state ────────────────────────────────────────────────
        if (tab.isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(16.dp))
                    Text(tab.loadProgress.ifBlank { "Loading..." })
                }
            }
            return
        }

        // ── Mode toggle (SQL / Explore) ──────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilledTonalButton(
                onClick = { onModeChange(QueryMode.SQL) },
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.Code, contentDescription = null, Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("SQL", style = MaterialTheme.typography.labelSmall)
            }
            FilledTonalButton(
                onClick = { onModeChange(QueryMode.EXPLORE) },
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.TableChart, contentDescription = null, Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("Explore", style = MaterialTheme.typography.labelSmall)
            }

            Spacer(Modifier.weight(1f))

            Text(
                text = tab.fileName.take(25),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (onOpenSettings != null) {
                IconButton(onClick = onOpenSettings, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.Settings, contentDescription = "Settings",
                        modifier = Modifier.size(18.dp))
                }
            }
        }

        when (tab.mode) {
            QueryMode.EXPLORE -> {
                // ── Table browser mode ───────────────────────────────────
                TableBrowser(
                    tables = uiState.stdlibDocs?.tables ?: emptyList(),
                    onTableSelect = onTableSelect,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            QueryMode.SQL -> {
                // ── SQL editor mode ──────────────────────────────────────

                // Editor
                SqlEditor(
                    code = tab.currentSql,
                    onCodeChange = onSqlChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 80.dp, max = 200.dp),
                )

                // Action bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = { onExecuteQuery(tab.currentSql) },
                        enabled = !tab.isQuerying && tab.currentSql.isNotBlank(),
                    ) {
                        if (tab.isQuerying) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Icon(Icons.Default.PlayArrow, contentDescription = null, Modifier.size(16.dp))
                        }
                        Spacer(Modifier.width(4.dp))
                        Text("Run")
                    }

                    IconButton(onClick = { showHistory = true }) {
                        Icon(Icons.Default.History, contentDescription = "History")
                    }

                    Spacer(Modifier.weight(1f))

                    // Status
                    val result = tab.result
                    if (result != null && !result.isError) {
                        Text(
                            text = result.statusText,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (result.truncated) MaterialTheme.colorScheme.error
                                   else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                // Error display
                if (tab.error != null) {
                    Text(
                        text = tab.error!!,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.errorContainer)
                            .padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily),
                    )
                }

                HorizontalDivider()

                // Data grid
                if (tab.result != null && !tab.result!!.isError) {
                    DataGrid(
                        result = tab.result!!,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                    )
                } else if (!tab.isQuerying && tab.result == null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Run a query to see results",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }

    // ── History bottom sheet ──────────────────────────────────────────────
    if (showHistory) {
        ModalBottomSheet(
            onDismissRequest = { showHistory = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Text(
                "Query History",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.titleMedium,
            )

            if (tab.history.isEmpty()) {
                Text(
                    "No queries yet",
                    modifier = Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            tab.history.forEach { entry ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            onLoadHistory(entry)
                            showHistory = false
                        }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = entry.sql.take(100),
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily),
                        maxLines = 2,
                    )
                    Text(
                        text = "${entry.rowCount} rows \u2022 ${entry.executionTimeMs}ms" +
                               if (entry.error != null) " \u2022 ERROR" else "",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (entry.error != null) MaterialTheme.colorScheme.error
                               else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                HorizontalDivider()
            }

            Spacer(Modifier.height(32.dp))
        }
    }
}
