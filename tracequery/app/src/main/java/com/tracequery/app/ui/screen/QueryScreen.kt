package com.tracequery.app.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.text.selection.SelectionContainer
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
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tracequery.app.data.model.HistoryEntry
import com.tracequery.app.ui.MainUiState
import com.tracequery.app.ui.QueryMode
import com.tracequery.app.ui.QueryOp
import com.tracequery.app.ui.component.DataGrid
import com.tracequery.app.ui.component.GridAction
import com.tracequery.app.ui.component.SqlEditor
import com.tracequery.app.ui.component.TableBrowser
import com.tracequery.app.ui.theme.CodeFontFamily
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
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
    onAddOp: (QueryOp) -> Unit,
    onRemoveOp: (Int) -> Unit,
    onClearOps: () -> Unit,
    onSort: (String, Boolean) -> Unit,
    onEnsureRows: (Int) -> Unit,
    onGetDistinctValues: (String, (List<String>) -> Unit) -> Unit,
    onOpenTrace: (() -> Unit)? = null,
    onOpenSettings: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val tab = uiState.activeTab ?: return
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var showHistory by remember { mutableStateOf(false) }
    // Distinct value filter state
    var filterValuesCol by remember { mutableStateOf<String?>(null) }
    var filterValuesData by remember { mutableStateOf<List<String>>(emptyList()) }
    var filterValuesLoading by remember { mutableStateOf(false) }
    var filterValuesSearch by remember { mutableStateOf("") }
    var filterValuesSelected by remember { mutableStateOf(setOf<String>()) }

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
                        shape = MaterialTheme.shapes.medium,
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
                        shape = MaterialTheme.shapes.medium,
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
                        shape = MaterialTheme.shapes.medium,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                    )
                }
                Spacer(Modifier.height(16.dp))
            }
        },
        modifier = modifier,
    ) {
        val focusManager = LocalFocusManager.current
        Column(
            Modifier.fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { focusManager.clearFocus() }
        ) {
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
                    onJoinGenerated = { sql ->
                        onSqlChange(sql)
                        onModeChange(QueryMode.SQL)
                        onExecuteQuery(sql)
                    },
                    modifier = Modifier.fillMaxSize(),
                )
                QueryMode.SQL -> {
                    val clipboard = LocalClipboardManager.current

                    SqlEditor(
                        code = tab.currentSql,
                        onCodeChange = onSqlChange,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 100.dp, max = 200.dp),
                    )

                    // Action bar
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        OutlinedButton(
                            onClick = { onExecuteQuery(tab.currentSql) },
                            enabled = !tab.isQuerying && tab.currentSql.isNotBlank(),
                            shape = MaterialTheme.shapes.medium,
                        ) {
                            if (tab.isQuerying) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.PlayArrow, null, Modifier.size(16.dp))
                            }
                            Spacer(Modifier.width(4.dp))
                            Text("Run")
                        }

                        // Copy SQL
                        IconButton(onClick = {
                            clipboard.setText(AnnotatedString(tab.currentSql))
                        }, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Default.ContentCopy, "Copy SQL", Modifier.size(16.dp))
                        }

                        // Format SQL
                        IconButton(onClick = {
                            onSqlChange(com.tracequery.app.data.SqlFormatter.format(tab.currentSql))
                        }, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Default.Code, "Format SQL", Modifier.size(16.dp))
                        }

                        Spacer(Modifier.weight(1f))

                        val pq = tab.pagedQuery
                        if (pq != null && !pq.isError) {
                            val fmt = java.text.NumberFormat.getIntegerInstance()
                            val rowText = if (pq.knownTotalRows >= 0) {
                                "${fmt.format(pq.knownTotalRows)} rows"
                            } else {
                                "${fmt.format(pq.rowsRead)}${if (pq.isComplete) "" else "+"} rows"
                            }
                            Text(
                                "$rowText \u2022 ${pq.executionTimeMs}ms",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    // ── Pipeline chips (sequential: filter → aggregate → filter...) ──
                    if (tab.ops.isNotEmpty()) {
                        FlowRow(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            tab.ops.forEachIndexed { idx, op ->
                                AssistChip(
                                    // Remove this op and everything after it
                                    onClick = { onRemoveOp(idx) },
                                    label = {
                                        Text(op.chipLabel,
                                            style = MaterialTheme.typography.labelSmall,
                                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    },
                                    trailingIcon = {
                                        Icon(Icons.Default.Close, "Remove", Modifier.size(14.dp))
                                    },
                                    shape = MaterialTheme.shapes.medium,
                                    colors = AssistChipDefaults.assistChipColors(
                                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                                        labelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    ),
                                )
                            }
                            TextButton(onClick = onClearOps) {
                                Icon(Icons.Default.Clear, null, Modifier.size(14.dp))
                                Spacer(Modifier.width(2.dp))
                                Text("Clear", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }

                    // Error (selectable/copyable)
                    if (tab.error != null) {
                        Surface(color = MaterialTheme.colorScheme.errorContainer) {
                            SelectionContainer {
                                Text(tab.error!!, Modifier.fillMaxWidth().padding(12.dp),
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily))
                            }
                        }
                    }

                    // Grid (paged or legacy)
                    val paged = tab.pagedQuery
                    if (paged != null && !paged.isError) {
                        DataGrid(
                            pagedQuery = paged,
                            sortColumns = tab.sortColumns,
                            onAction = { action ->
                                when (action) {
                                    is GridAction.SortColumn -> onSort(action.column, action.ascending)
                                    is GridAction.FilterValues -> {
                                        filterValuesCol = action.column
                                        filterValuesData = emptyList()
                                        filterValuesLoading = true
                                        filterValuesSearch = ""
                                        filterValuesSelected = emptySet()
                                        onGetDistinctValues(action.column) { values ->
                                            filterValuesData = values
                                            filterValuesLoading = false
                                        }
                                    }
                                    else -> handleGridAction(action, onAddOp)
                                }
                            },
                            onEnsureRows = onEnsureRows,
                            modifier = Modifier.fillMaxWidth().weight(1f),
                        )
                    } else if (!tab.isQuerying && paged == null) {
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
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
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
                    val histClipboard = LocalClipboardManager.current
                    Column(
                        Modifier.fillMaxWidth()
                            .combinedClickable(
                                onClick = { onLoadHistory(entry); showHistory = false },
                                onLongClick = { histClipboard.setText(AnnotatedString(entry.sql)) },
                            )
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
    // Distinct values filter dialog
    if (filterValuesCol != null) {
        val col = filterValuesCol!!
        // Data is "value\tcount" pairs
        val parsed = filterValuesData.map { raw ->
            val parts = raw.split("\t", limit = 2)
            parts[0] to (parts.getOrNull(1) ?: "")
        }
        val filtered = if (filterValuesSearch.isBlank()) parsed
            else parsed.filter { it.first.contains(filterValuesSearch, ignoreCase = true) }

        AlertDialog(
            onDismissRequest = { filterValuesCol = null },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            title = { Text("Filter: $col") },
            text = {
                Column {
                    // Search bar
                    OutlinedTextField(
                        value = filterValuesSearch,
                        onValueChange = { filterValuesSearch = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Search values...") },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily),
                    )

                    Spacer(Modifier.height(8.dp))

                    if (filterValuesLoading) {
                        CircularProgressIndicator(Modifier.size(24.dp).align(Alignment.CenterHorizontally))
                    } else if (filtered.isEmpty()) {
                        Text("No values found", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("${filtered.size} values",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(1f).align(Alignment.CenterVertically))
                            TextButton(onClick = {
                                filterValuesSelected = filterValuesSelected + filtered.map { it.first }.toSet()
                            }) { Text("Select all", style = MaterialTheme.typography.labelSmall) }
                            TextButton(onClick = {
                                filterValuesSelected = emptySet()
                            }) { Text("Clear", style = MaterialTheme.typography.labelSmall) }
                        }

                        LazyColumn(Modifier.heightIn(max = 350.dp)) {
                            items(count = filtered.size, key = { filtered[it].first }) { idx ->
                                val (value, count) = filtered[idx]
                                Row(
                                    Modifier.fillMaxWidth()
                                        .clickable {
                                            filterValuesSelected = if (value in filterValuesSelected)
                                                filterValuesSelected - value else filterValuesSelected + value
                                        }
                                        .padding(vertical = 2.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Checkbox(
                                        checked = value in filterValuesSelected,
                                        onCheckedChange = { checked ->
                                            filterValuesSelected = if (checked) filterValuesSelected + value
                                                else filterValuesSelected - value
                                        },
                                    )
                                    Text(value, style = MaterialTheme.typography.bodySmall.copy(
                                        fontFamily = CodeFontFamily), maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f))
                                    if (count.isNotBlank()) {
                                        Text(count, style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            textAlign = TextAlign.End,
                                            modifier = Modifier.width(48.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (filterValuesSelected.isNotEmpty()) {
                            val inList = filterValuesSelected.joinToString(", ") { "'${it.replace("'", "''")}'" }
                            onAddOp(QueryOp.Filter(col, "IN", "($inList)"))
                        }
                        filterValuesCol = null
                    },
                    enabled = filterValuesSelected.isNotEmpty(),
                ) { Text("Apply (${filterValuesSelected.size})") }
            },
            dismissButton = {
                TextButton(onClick = { filterValuesCol = null }) { Text("Cancel") }
            },
        )
    }
}

private fun handleGridAction(
    action: GridAction,
    onAddOp: (QueryOp) -> Unit,
) {
    fun esc(v: String) = v.replace("'", "''")
    fun sqlVal(v: String) = v.toLongOrNull()?.toString()
        ?: v.toDoubleOrNull()?.toString()
        ?: "'${esc(v)}'"
    fun f(col: String, op: String, value: String?) = onAddOp(QueryOp.Filter(col, op, value))

    when (action) {
        is GridAction.CopyCellValue -> {}
        is GridAction.SortColumn -> {} // handled directly in DataGrid → ViewModel
        is GridAction.FilterEquals -> f(action.column, "=", sqlVal(action.value))
        is GridAction.FilterNotEquals -> f(action.column, "!=", sqlVal(action.value))
        is GridAction.FilterGreaterThan -> f(action.column, ">", action.value)
        is GridAction.FilterGreaterOrEqual -> f(action.column, ">=", action.value)
        is GridAction.FilterLessThan -> f(action.column, "<", action.value)
        is GridAction.FilterLessOrEqual -> f(action.column, "<=", action.value)
        is GridAction.FilterIsNull -> f(action.column, "IS NULL", null)
        is GridAction.FilterIsNotNull -> f(action.column, "IS NOT NULL", null)
        is GridAction.FilterContains -> f(action.column, "LIKE", "'%${esc(action.value)}%'")
        is GridAction.FilterNotContains -> f(action.column, "NOT LIKE", "'%${esc(action.value)}%'")
        is GridAction.FilterGlob -> f(action.column, "GLOB", "'${esc(action.value)}'")
        is GridAction.FilterNotGlob -> f(action.column, "NOT GLOB", "'${esc(action.value)}'")
        is GridAction.Aggregate -> onAddOp(QueryOp.Aggregate(
            action.metrics.map { (col, fn) -> QueryOp.MetricDef(col, fn) },
            action.groupByColumns,
        ))
        is GridAction.FilterValues -> {} // handled in QueryScreen directly
    }
}
