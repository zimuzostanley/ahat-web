package com.tracequery.app.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
// Uses MaterialTheme.shapes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tracequery.app.data.model.HistoryEntry
import com.tracequery.app.ui.ActiveFilter
import com.tracequery.app.ui.MainUiState
import com.tracequery.app.ui.QueryMode
import com.tracequery.app.ui.component.DataGrid
import com.tracequery.app.ui.component.GridAction
import com.tracequery.app.ui.component.SqlEditor
import com.tracequery.app.ui.component.TableBrowser
import com.tracequery.app.ui.theme.CodeFontFamily
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
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
    onAddFilter: (ActiveFilter) -> Unit,
    onRemoveFilter: (Int) -> Unit,
    onClearFilters: () -> Unit,
    onAggregate: (String, String) -> Unit,
    onOpenTrace: (() -> Unit)? = null,
    onOpenSettings: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val tab = uiState.activeTab ?: return
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var showHistory by remember { mutableStateOf(false) }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Text("TraceQuery", Modifier.padding(24.dp),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)

                if (onOpenTrace != null) {
                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.Add, null) },
                        label = { Text("Open Trace") },
                        selected = false,
                        onClick = { scope.launch { drawerState.close() }; onOpenTrace() },
                    )
                }

                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Text("Loaded Traces", Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)

                uiState.tabs.forEach { t ->
                    NavigationDrawerItem(
                        label = { Text(t.fileName, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        selected = t.id == uiState.activeTabId,
                        onClick = { onSwitchTab(t.id); scope.launch { drawerState.close() } },
                        badge = { Icon(Icons.Default.Close, "Close",
                            Modifier.size(18.dp).clickable { onCloseTab(t.id) }) },
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                }

                Spacer(Modifier.weight(1f))
                HorizontalDivider()

                if (onOpenSettings != null) {
                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.Settings, null) },
                        label = { Text("Settings") },
                        selected = false,
                        onClick = { scope.launch { drawerState.close() }; onOpenSettings() },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                    )
                }
                Spacer(Modifier.height(16.dp))
            }
        },
        modifier = modifier,
    ) {
        Column(Modifier.fillMaxSize()) {
            TopAppBar(
                title = { Text(tab.fileName, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = { scope.launch { drawerState.open() } }) {
                        Icon(Icons.Default.Menu, "Menu")
                    }
                },
                actions = {
                    IconButton(onClick = { showHistory = true }) {
                        Icon(Icons.Default.History, "History")
                    }
                },
            )

            if (tab.isLoading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator()
                        Spacer(Modifier.height(16.dp))
                        Text(tab.loadProgress.ifBlank { "Loading trace..." },
                            style = MaterialTheme.typography.bodyMedium)
                    }
                }
                return@Column
            }

            // Tabs
            val tabIndex = if (tab.mode == QueryMode.SQL) 0 else 1
            TabRow(selectedTabIndex = tabIndex) {
                Tab(selected = tabIndex == 0, onClick = { onModeChange(QueryMode.SQL) },
                    text = { Text("SQL") })
                Tab(selected = tabIndex == 1, onClick = { onModeChange(QueryMode.EXPLORE) },
                    text = { Text("Explore") })
            }

            when (tab.mode) {
                QueryMode.EXPLORE -> TableBrowser(
                    tables = uiState.stdlibDocs?.tables ?: emptyList(),
                    onTableSelect = onTableSelect,
                    modifier = Modifier.fillMaxSize(),
                )
                QueryMode.SQL -> {
                    SqlEditor(
                        code = tab.currentSql,
                        onCodeChange = onSqlChange,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 100.dp, max = 200.dp),
                    )

                    // Action bar
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = { onExecuteQuery(tab.currentSql) },
                            enabled = !tab.isQuerying && tab.currentSql.isNotBlank(),
                        ) {
                            if (tab.isQuerying) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.PlayArrow, null, Modifier.size(16.dp))
                            }
                            Spacer(Modifier.width(4.dp))
                            Text("Run")
                        }

                        val r = tab.result
                        if (r != null && !r.isError) {
                            Text(r.statusText, style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }

                    // ── Filter chips ─────────────────────────────────────
                    if (tab.filters.isNotEmpty()) {
                        FlowRow(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            tab.filters.forEachIndexed { idx, filter ->
                                AssistChip(
                                    onClick = { onRemoveFilter(idx) },
                                    label = {
                                        Text(filter.displayText,
                                            style = MaterialTheme.typography.labelSmall,
                                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    },
                                    trailingIcon = {
                                        Icon(Icons.Default.Close, "Remove",
                                            Modifier.size(14.dp))
                                    },
                                    shape = MaterialTheme.shapes.small,
                                    colors = AssistChipDefaults.assistChipColors(
                                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                                        labelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    ),
                                )
                            }
                            TextButton(onClick = onClearFilters, Modifier.height(32.dp)) {
                                Icon(Icons.Default.Clear, null, Modifier.size(14.dp))
                                Spacer(Modifier.width(2.dp))
                                Text("Clear", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }

                    // Error
                    if (tab.error != null) {
                        Surface(color = MaterialTheme.colorScheme.errorContainer) {
                            Text(tab.error!!, Modifier.fillMaxWidth().padding(12.dp),
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily))
                        }
                    }

                    // Grid
                    val queryResult = tab.result
                    if (queryResult != null && !queryResult.isError) {
                        DataGrid(
                            result = queryResult,
                            onAction = { action ->
                                handleGridAction(action, onAddFilter, onAggregate)
                            },
                            modifier = Modifier.fillMaxWidth().weight(1f),
                        )
                    } else if (!tab.isQuerying && tab.result == null) {
                        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                            Text("Execute a query to see results",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }

    // History sheet
    if (showHistory) {
        ModalBottomSheet(
            onDismissRequest = { showHistory = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Text("Query History", Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (tab.history.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text("No queries yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            LazyColumn {
                items(tab.history) { entry ->
                    Column(
                        Modifier.fillMaxWidth()
                            .clickable { onLoadHistory(entry); showHistory = false }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    ) {
                        Text(entry.sql.take(120),
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily),
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Spacer(Modifier.height(2.dp))
                        Text("${entry.rowCount} rows \u2022 ${entry.executionTimeMs}ms" +
                            if (entry.error != null) " \u2022 ERROR" else "",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (entry.error != null) MaterialTheme.colorScheme.error
                                   else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
                }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

private fun handleGridAction(
    action: GridAction,
    onAddFilter: (ActiveFilter) -> Unit,
    onAggregate: (String, String) -> Unit,
) {
    fun esc(v: String) = v.replace("'", "''")
    fun sqlVal(v: String) = v.toLongOrNull()?.toString()
        ?: v.toDoubleOrNull()?.toString()
        ?: "'${esc(v)}'"

    when (action) {
        is GridAction.CopyCellValue -> {} // handled in DataGrid
        is GridAction.FilterEquals ->
            onAddFilter(ActiveFilter(action.column, "=", sqlVal(action.value)))
        is GridAction.FilterNotEquals ->
            onAddFilter(ActiveFilter(action.column, "!=", sqlVal(action.value)))
        is GridAction.FilterGreaterThan ->
            onAddFilter(ActiveFilter(action.column, ">", action.value))
        is GridAction.FilterGreaterOrEqual ->
            onAddFilter(ActiveFilter(action.column, ">=", action.value))
        is GridAction.FilterLessThan ->
            onAddFilter(ActiveFilter(action.column, "<", action.value))
        is GridAction.FilterLessOrEqual ->
            onAddFilter(ActiveFilter(action.column, "<=", action.value))
        is GridAction.FilterIsNull ->
            onAddFilter(ActiveFilter(action.column, "IS NULL", null))
        is GridAction.FilterIsNotNull ->
            onAddFilter(ActiveFilter(action.column, "IS NOT NULL", null))
        is GridAction.FilterContains ->
            onAddFilter(ActiveFilter(action.column, "LIKE", "'%${esc(action.value)}%'"))
        is GridAction.FilterNotContains ->
            onAddFilter(ActiveFilter(action.column, "NOT LIKE", "'%${esc(action.value)}%'"))
        is GridAction.FilterGlob ->
            onAddFilter(ActiveFilter(action.column, "GLOB", "'${esc(action.value)}'"))
        is GridAction.FilterNotGlob ->
            onAddFilter(ActiveFilter(action.column, "NOT GLOB", "'${esc(action.value)}'"))
        is GridAction.Aggregate -> onAggregate(action.function, action.column)
        is GridAction.CountDistinct -> onAggregate("COUNT_DISTINCT", action.column)
    }
}
