package com.tracequery.app.ui.screen

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
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
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import com.tracequery.app.ui.MainUiState
import com.tracequery.app.ui.QueryMode
import com.tracequery.app.ui.component.DataGrid
import com.tracequery.app.ui.component.GridAction
import com.tracequery.app.ui.component.SqlEditor
import com.tracequery.app.ui.component.TableBrowser
import com.tracequery.app.ui.theme.CodeFontFamily
import kotlinx.coroutines.launch

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
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var showHistory by remember { mutableStateOf(false) }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                // Drawer header
                Text(
                    "TraceQuery",
                    modifier = Modifier.padding(24.dp),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )

                // Open trace
                if (onOpenTrace != null) {
                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.Add, null) },
                        label = { Text("Open Trace") },
                        selected = false,
                        onClick = {
                            scope.launch { drawerState.close() }
                            onOpenTrace()
                        },
                    )
                }

                HorizontalDivider(Modifier.padding(vertical = 8.dp))

                // Loaded traces
                Text(
                    "Loaded Traces",
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                uiState.tabs.forEach { t ->
                    NavigationDrawerItem(
                        label = {
                            Text(t.fileName, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        selected = t.id == uiState.activeTabId,
                        onClick = {
                            onSwitchTab(t.id)
                            scope.launch { drawerState.close() }
                        },
                        badge = {
                            Icon(
                                Icons.Default.Close, "Close",
                                modifier = Modifier.size(18.dp).clickable { onCloseTab(t.id) },
                            )
                        },
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                }

                Spacer(Modifier.weight(1f))

                HorizontalDivider()

                // Settings
                if (onOpenSettings != null) {
                    NavigationDrawerItem(
                        icon = { Icon(Icons.Default.Settings, null) },
                        label = { Text("Settings") },
                        selected = false,
                        onClick = {
                            scope.launch { drawerState.close() }
                            onOpenSettings()
                        },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                    )
                }

                Spacer(Modifier.height(16.dp))
            }
        },
        modifier = modifier,
    ) {
        Column(Modifier.fillMaxSize()) {
            // ── Top bar ──────────────────────────────────────────────────
            TopAppBar(
                title = {
                    Text(
                        tab.fileName, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium,
                    )
                },
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
                // Use default M3 TopAppBar colors
            )

            // ── Loading ──────────────────────────────────────────────────
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

            // ── SQL / Explore tabs ───────────────────────────────────────
            val tabIndex = if (tab.mode == QueryMode.SQL) 0 else 1
            TabRow(selectedTabIndex = tabIndex) {
                Tab(selected = tabIndex == 0, onClick = { onModeChange(QueryMode.SQL) },
                    text = { Text("SQL") })
                Tab(selected = tabIndex == 1, onClick = { onModeChange(QueryMode.EXPLORE) },
                    text = { Text("Explore Tables") })
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
                    // ── Editor ────────────────────────────────────────────
                    SqlEditor(
                        code = tab.currentSql,
                        onCodeChange = onSqlChange,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 100.dp, max = 220.dp),
                    )

                    // ── Action bar ────────────────────────────────────────
                    Surface(tonalElevation = 1.dp) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            OutlinedButton(
                                onClick = { onExecuteQuery(tab.currentSql) },
                                enabled = !tab.isQuerying && tab.currentSql.isNotBlank(),
                            ) {
                                if (tab.isQuerying) {
                                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                } else {
                                    Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
                                }
                                Spacer(Modifier.width(6.dp))
                                Text("Run")
                            }

                            val r = tab.result
                            if (r != null && !r.isError) {
                                Text(
                                    r.statusText,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    // ── Error ─────────────────────────────────────────────
                    if (tab.error != null) {
                        Surface(color = MaterialTheme.colorScheme.errorContainer) {
                            Text(
                                tab.error!!,
                                Modifier.fillMaxWidth().padding(12.dp),
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily),
                            )
                        }
                    }

                    // ── Grid ──────────────────────────────────────────────
                    val queryResult = tab.result
                    if (queryResult != null && !queryResult.isError) {
                        DataGrid(
                            result = queryResult,
                            onAction = { action -> handleGridAction(action, tab.currentSql, onSqlChange, onExecuteQuery) },
                            modifier = Modifier.fillMaxWidth().weight(1f),
                        )
                    } else if (!tab.isQuerying && tab.result == null) {
                        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                            Text(
                                "Write a query and tap Run",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }

    // ── History ──────────────────────────────────────────────────────────
    if (showHistory) {
        ModalBottomSheet(
            onDismissRequest = { showHistory = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Text(
                "Query History", Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
            )
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
                        Text(
                            entry.sql.take(120),
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily),
                            maxLines = 2, overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "${entry.rowCount} rows • ${entry.executionTimeMs}ms" +
                                if (entry.error != null) " • ERROR" else "",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (entry.error != null) MaterialTheme.colorScheme.error
                                   else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
                }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

/**
 * Handles grid actions by generating modified SQL from the current query.
 * Filter actions append WHERE clauses. Aggregate generates GROUP BY.
 */
private fun handleGridAction(
    action: GridAction,
    currentSql: String,
    onSqlChange: (String) -> Unit,
    onExecuteQuery: (String) -> Unit,
) {
    val baseSql = currentSql.trimEnd().removeSuffix(";").trim()

    fun esc(v: String) = v.replace("'", "''")
    fun col(name: String) = "\"${name.replace("\"", "\"\"")}\""  // Quote column identifiers

    val c = { name: String -> col(name) }
    val v = { value: String ->
        value.toLongOrNull()?.toString()
            ?: value.toDoubleOrNull()?.toString()
            ?: "'${esc(value)}'"
    }

    val newSql = when (action) {
        is GridAction.CopyCellValue -> return
        is GridAction.FilterEquals ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} = ${v(action.value)};"
        is GridAction.FilterNotEquals ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} != ${v(action.value)};"
        is GridAction.FilterGreaterThan ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} > ${action.value};"
        is GridAction.FilterGreaterOrEqual ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} >= ${action.value};"
        is GridAction.FilterLessThan ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} < ${action.value};"
        is GridAction.FilterLessOrEqual ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} <= ${action.value};"
        is GridAction.FilterIsNull ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} IS NULL;"
        is GridAction.FilterIsNotNull ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} IS NOT NULL;"
        is GridAction.FilterContains ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} LIKE '%${esc(action.value)}%';"
        is GridAction.FilterNotContains ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} NOT LIKE '%${esc(action.value)}%';"
        is GridAction.FilterGlob ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} GLOB '${esc(action.value)}';"
        is GridAction.FilterNotGlob ->
            "SELECT * FROM ($baseSql) WHERE ${c(action.column)} NOT GLOB '${esc(action.value)}';"
        is GridAction.Aggregate ->
            "SELECT ${c(action.column)}, ${action.function}(*) as ${action.function.lowercase()} FROM ($baseSql) GROUP BY ${c(action.column)} ORDER BY ${action.function.lowercase()} DESC;"
        is GridAction.CountDistinct ->
            "SELECT ${c(action.column)}, COUNT(*) as count FROM ($baseSql) GROUP BY ${c(action.column)} ORDER BY count DESC;"
    }

    onSqlChange(newSql)
    onExecuteQuery(newSql)
}
