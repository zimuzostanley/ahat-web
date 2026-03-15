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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tracequery.app.data.model.HistoryEntry
import com.tracequery.app.ui.MainUiState
import com.tracequery.app.ui.QueryMode
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
        // ── Top App Bar ──────────────────────────────────────────────────
        TopAppBar(
            title = {
                Text(
                    text = tab.fileName,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleMedium,
                )
            },
            actions = {
                IconButton(onClick = { showHistory = true }) {
                    Icon(Icons.Default.History, contentDescription = "History")
                }
                if (onOpenTrace != null) {
                    IconButton(onClick = onOpenTrace) {
                        Icon(Icons.Default.Add, contentDescription = "Open trace")
                    }
                }
                if (onOpenSettings != null) {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface,
            ),
        )

        // ── Tab bar (only when multiple tabs) ────────────────────────────
        if (uiState.tabs.size > 1) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                uiState.tabs.forEach { t ->
                    val isActive = t.id == uiState.activeTabId
                    Surface(
                        modifier = Modifier.clickable { onSwitchTab(t.id) },
                        shape = RoundedCornerShape(8.dp),
                        color = if (isActive) MaterialTheme.colorScheme.surface
                               else MaterialTheme.colorScheme.surfaceVariant,
                        tonalElevation = if (isActive) 2.dp else 0.dp,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                text = t.fileName.take(18),
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal,
                            )
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Close",
                                modifier = Modifier
                                    .size(14.dp)
                                    .clickable { onCloseTab(t.id) },
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }

        // ── Loading ──────────────────────────────────────────────────────
        if (tab.isLoading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(16.dp))
                    Text(
                        tab.loadProgress.ifBlank { "Loading trace..." },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            return
        }

        // ── Mode toggle chips ────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = tab.mode == QueryMode.SQL,
                onClick = { onModeChange(QueryMode.SQL) },
                label = { Text("SQL") },
            )
            FilterChip(
                selected = tab.mode == QueryMode.EXPLORE,
                onClick = { onModeChange(QueryMode.EXPLORE) },
                label = { Text("Explore Tables") },
            )
        }

        when (tab.mode) {
            QueryMode.EXPLORE -> {
                TableBrowser(
                    tables = uiState.stdlibDocs?.tables ?: emptyList(),
                    onTableSelect = onTableSelect,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            QueryMode.SQL -> {
                // ── SQL editor ───────────────────────────────────────────
                SqlEditor(
                    code = tab.currentSql,
                    onCodeChange = onSqlChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 100.dp, max = 220.dp),
                )

                // ── Action bar ───────────────────────────────────────────
                Surface(
                    tonalElevation = 1.dp,
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        // Run button
                        SmallFloatingActionButton(
                            onClick = { onExecuteQuery(tab.currentSql) },
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ) {
                            if (tab.isQuerying) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary,
                                )
                            } else {
                                Icon(Icons.Default.PlayArrow, contentDescription = "Run")
                            }
                        }

                        // Status text
                        val result = tab.result
                        if (result != null && !result.isError) {
                            Text(
                                text = result.statusText,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (result.truncated) MaterialTheme.colorScheme.error
                                       else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(1f),
                            )
                        } else {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                }

                // ── Error ────────────────────────────────────────────────
                if (tab.error != null) {
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                    ) {
                        Text(
                            text = tab.error!!,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = CodeFontFamily
                            ),
                        )
                    }
                }

                // ── Data grid ────────────────────────────────────────────
                val queryResult = tab.result
                if (queryResult != null && !queryResult.isError) {
                    DataGrid(
                        result = queryResult,
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
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                "Write a query and tap",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(4.dp))
                            Icon(
                                Icons.Default.PlayArrow,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(32.dp),
                            )
                        }
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
                fontWeight = FontWeight.SemiBold,
            )

            if (tab.history.isEmpty()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "No queries yet",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            LazyColumn {
                items(tab.history) { entry ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                onLoadHistory(entry)
                                showHistory = false
                            }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    ) {
                        Text(
                            text = entry.sql.take(120),
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = CodeFontFamily
                            ),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = buildString {
                                append("${entry.rowCount} rows \u2022 ${entry.executionTimeMs}ms")
                                if (entry.error != null) append(" \u2022 ERROR")
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (entry.error != null) MaterialTheme.colorScheme.error
                                   else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
                }
            }

            Spacer(Modifier.height(32.dp))
        }
    }
}

