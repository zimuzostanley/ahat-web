package com.tracequery.app.ui.component

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.Functions
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState as rememberVScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.TextButton
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tracequery.app.data.PagedQuery
import com.tracequery.app.ui.theme.CodeFontFamily

// ── Grid actions ─────────────────────────────────────────────────────────────

sealed class GridAction {
    data class CopyCellValue(val value: String) : GridAction()
    data class SortColumn(val column: String, val ascending: Boolean) : GridAction()
    data class FilterEquals(val column: String, val value: String) : GridAction()
    data class FilterNotEquals(val column: String, val value: String) : GridAction()
    data class FilterGreaterThan(val column: String, val value: String) : GridAction()
    data class FilterGreaterOrEqual(val column: String, val value: String) : GridAction()
    data class FilterLessThan(val column: String, val value: String) : GridAction()
    data class FilterLessOrEqual(val column: String, val value: String) : GridAction()
    data class FilterIsNull(val column: String) : GridAction()
    data class FilterIsNotNull(val column: String) : GridAction()
    data class FilterContains(val column: String, val value: String) : GridAction()
    data class FilterNotContains(val column: String, val value: String) : GridAction()
    data class FilterGlob(val column: String, val value: String) : GridAction()
    data class FilterNotGlob(val column: String, val value: String) : GridAction()
    data class Aggregate(val function: String, val metricColumn: String, val groupByColumns: List<String>) : GridAction()
}

// ── Width estimation ─────────────────────────────────────────────────────────

private const val ROW_NUM_W = 48

private fun estimateWidths(columns: List<com.tracequery.app.data.model.ColumnInfo>, sampleRows: List<List<String>>): List<Float> {
    return columns.mapIndexed { c, col ->
        var max = col.name.length
        for (r in 0 until minOf(200, sampleRows.size)) {
            if (c < sampleRows[r].size) max = maxOf(max, sampleRows[r][c].length)
        }
        (max * 8 + 28).toFloat().coerceIn(64f, 360f)
    }
}

// ── DataGrid composable ──────────────────────────────────────────────────────

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DataGrid(
    pagedQuery: PagedQuery,
    sortColumns: List<Pair<String, Boolean>> = emptyList(),
    onAction: ((GridAction) -> Unit)? = null,
    onEnsureRows: ((Int) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    if (pagedQuery.columns.isEmpty()) return

    val density = LocalDensity.current
    val clipboard = LocalClipboardManager.current
    val hScroll = rememberScrollState()
    val listState = rememberLazyListState()

    // Estimate widths from first page
    val firstPageRows = remember(pagedQuery.version) {
        (0 until minOf(200, pagedQuery.totalRows.toInt())).mapNotNull { pagedQuery.getRow(it) }
    }
    val widths = remember(pagedQuery.columns, firstPageRows.size) {
        mutableStateListOf(*estimateWidths(pagedQuery.columns, firstPageRows).toTypedArray())
    }

    // Column visibility
    val visibleCols = remember(pagedQuery.columns) {
        mutableStateListOf(*pagedQuery.columns.indices.toList().toTypedArray())
    }
    var showColumnPicker by remember { mutableStateOf(false) }

    // Menu state
    var colMenuIdx by remember { mutableIntStateOf(-1) }
    var cellMenuRow by remember { mutableIntStateOf(-1) }
    var cellMenuCol by remember { mutableIntStateOf(-1) }

    // Aggregate dialog
    var aggDialogCol by remember { mutableStateOf<String?>(null) }
    var aggFunction by remember { mutableStateOf("COUNT") }
    var aggGroupBy by remember { mutableStateOf(setOf<String>()) }

    // Theme colors
    val headerBg = MaterialTheme.colorScheme.surfaceVariant
    val borderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
    val rowEven = MaterialTheme.colorScheme.surface
    val rowOdd = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    val onSurface = MaterialTheme.colorScheme.onSurface
    val onVariant = MaterialTheme.colorScheme.onSurfaceVariant
    val primary = MaterialTheme.colorScheme.primary
    val cellText = TextStyle(fontFamily = CodeFontFamily, fontSize = 12.sp, lineHeight = 18.sp)
    val headerText = cellText.copy(fontWeight = FontWeight.SemiBold)

    // Total from COUNT(*) if known, else rows read + sentinel for loading
    val totalRows = if (pagedQuery.knownTotalRows >= 0) pagedQuery.knownTotalRows.toInt()
                    else pagedQuery.rowsRead + if (pagedQuery.isComplete) 0 else 1
    val displayedColumns = remember(visibleCols.toList(), pagedQuery.columns) {
        visibleCols.map { pagedQuery.columns[it] }
    }

    // ── Trigger cursor read-ahead based on scroll position ──────────
    val lastVisible by derivedStateOf {
        val info = listState.layoutInfo.visibleItemsInfo
        info.lastOrNull()?.index ?: 0
    }
    LaunchedEffect(lastVisible, pagedQuery.version) {
        onEnsureRows?.invoke(lastVisible)
    }

    Column(modifier) {
        // Column picker
        // Column visibility indicator (shows count when not all visible)
        if (visibleCols.size < pagedQuery.columns.size) {
            Text(
                "${visibleCols.size}/${pagedQuery.columns.size} columns shown",
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelSmall,
                color = onVariant,
            )
        }

        // ── Header ───────────────────────────────────────────────────
        Row(Modifier.fillMaxWidth().horizontalScroll(hScroll).background(headerBg)) {
            var showExportMenu by remember { mutableStateOf(false) }
            Box(
                Modifier.width(ROW_NUM_W.dp)
                    .combinedClickable(
                        onClick = { showColumnPicker = true },
                        onLongClick = { showExportMenu = true },
                    )
                    .padding(8.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Text("#", style = headerText, color = onVariant)
                DropdownMenu(expanded = showExportMenu, onDismissRequest = { showExportMenu = false }) {
                    DropdownMenuItem(
                        text = { Text("Copy as TSV") },
                        leadingIcon = { Icon(Icons.Default.ContentCopy, null) },
                        onClick = {
                            val tsv = buildString {
                                append(displayedColumns.joinToString("\t") { it.name })
                                append("\n")
                                for (i in 0 until pagedQuery.rowsRead) {
                                    val row = pagedQuery.getRow(i) ?: continue
                                    append(visibleCols.joinToString("\t") { row.getOrElse(it) { "" } })
                                    append("\n")
                                }
                            }
                            clipboard.setText(AnnotatedString(tsv))
                            showExportMenu = false
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Columns...") },
                        onClick = { showColumnPicker = true; showExportMenu = false },
                    )
                }
            }
            Spacer(Modifier.width(1.dp).background(borderColor))

            displayedColumns.forEachIndexed { idx, col ->
                val sortEntry = sortColumns.find { it.first == col.name }
                val arrow = when {
                    sortEntry != null && sortEntry.second -> " ▲"
                    sortEntry != null -> " ▼"
                    else -> ""
                }
                val origIdx = visibleCols[idx]

                Row(Modifier.width(widths.getOrElse(origIdx) { 100f }.dp)) {
                    Box(
                        Modifier.weight(1f)
                            .combinedClickable(
                                onClick = {
                                    val newAsc = if (sortEntry != null) !sortEntry.second else true
                                    onAction?.invoke(GridAction.SortColumn(col.name, newAsc))
                                },
                                onLongClick = { colMenuIdx = idx },
                            )
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                    ) {
                        Text(
                            col.name + arrow, style = headerText,
                            color = if (sortEntry != null) primary else onSurface,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        // Column menu
                        DropdownMenu(expanded = colMenuIdx == idx, onDismissRequest = { colMenuIdx = -1 }) {
                            DropdownMenuItem(text = { Text("Sort ascending") },
                                onClick = { onAction?.invoke(GridAction.SortColumn(col.name, true)); colMenuIdx = -1 })
                            DropdownMenuItem(text = { Text("Sort descending") },
                                onClick = { onAction?.invoke(GridAction.SortColumn(col.name, false)); colMenuIdx = -1 })
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text("Aggregate...") },
                                leadingIcon = { Icon(Icons.Default.Functions, null) },
                                onClick = {
                                    aggDialogCol = col.name; aggFunction = "COUNT"; aggGroupBy = emptySet()
                                    colMenuIdx = -1
                                },
                            )
                        }
                    }
                    Box(Modifier.width(4.dp).background(borderColor)
                        .pointerInput(origIdx) {
                            detectHorizontalDragGestures { _, delta ->
                                val d = with(density) { delta.toDp().value }
                                widths[origIdx] = (widths[origIdx] + d).coerceIn(48f, 800f)
                            }
                        })
                }
            }
        }

        HorizontalDivider(color = borderColor)

        // ── Rows (paged, scroll-driven) ──────────────────────────────
        LazyColumn(state = listState, modifier = Modifier.fillMaxWidth()) {
            items(count = totalRows, key = { it }) { ri ->
                val row = pagedQuery.getRow(ri)

                Row(
                    Modifier.fillMaxWidth().horizontalScroll(hScroll)
                        .background(if (ri % 2 == 0) rowEven else rowOdd),
                ) {
                    Box(Modifier.width(ROW_NUM_W.dp).padding(horizontal = 4.dp, vertical = 6.dp),
                        contentAlignment = Alignment.CenterEnd) {
                        Text("${ri + 1}", style = cellText, color = onVariant)
                    }
                    Spacer(Modifier.width(1.dp).background(borderColor))

                    if (row == null) {
                        // Loading placeholder
                        Box(Modifier.padding(8.dp)) {
                            Text("...", style = cellText, color = onVariant)
                        }
                    } else {
                        visibleCols.forEachIndexed { ci, origColIdx ->
                            val cell = row.getOrElse(origColIdx) { "" }
                            val isNull = cell == "NULL"
                            val isNum = !isNull && (cell.toLongOrNull() != null || cell.toDoubleOrNull() != null)
                            val colName = displayedColumns.getOrNull(ci)?.name ?: ""

                            Box(
                                Modifier.width(widths.getOrElse(origColIdx) { 100f }.dp)
                                    .combinedClickable(
                                        onClick = { clipboard.setText(AnnotatedString(cell)) },
                                        onLongClick = { cellMenuRow = ri; cellMenuCol = ci },
                                    )
                                    .padding(horizontal = 8.dp, vertical = 6.dp),
                            ) {
                                Text(
                                    cell, style = cellText,
                                    color = when {
                                        isNull -> onVariant
                                        isNum -> primary
                                        else -> onSurface
                                    },
                                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    textAlign = if (isNum) TextAlign.End else TextAlign.Start,
                                    modifier = Modifier.fillMaxWidth(),
                                )

                                // Cell context menu
                                DropdownMenu(
                                    expanded = cellMenuRow == ri && cellMenuCol == ci,
                                    onDismissRequest = { cellMenuRow = -1; cellMenuCol = -1 },
                                    offset = DpOffset(0.dp, 0.dp),
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("Copy") },
                                        leadingIcon = { Icon(Icons.Default.ContentCopy, null) },
                                        onClick = { clipboard.setText(AnnotatedString(cell)); cellMenuRow = -1; cellMenuCol = -1 },
                                    )
                                    HorizontalDivider()
                                    fun dismiss() { cellMenuRow = -1; cellMenuCol = -1 }
                                    val fi = @Composable { Icon(Icons.Default.FilterAlt, null) }
                                    if (!isNull) {
                                        DropdownMenuItem(text = { Text("= $cell") }, leadingIcon = fi,
                                            onClick = { onAction?.invoke(GridAction.FilterEquals(colName, cell)); dismiss() })
                                        DropdownMenuItem(text = { Text("≠ $cell") }, leadingIcon = fi,
                                            onClick = { onAction?.invoke(GridAction.FilterNotEquals(colName, cell)); dismiss() })
                                        if (isNum) {
                                            DropdownMenuItem(text = { Text("> $cell") }, leadingIcon = fi,
                                                onClick = { onAction?.invoke(GridAction.FilterGreaterThan(colName, cell)); dismiss() })
                                            DropdownMenuItem(text = { Text("< $cell") }, leadingIcon = fi,
                                                onClick = { onAction?.invoke(GridAction.FilterLessThan(colName, cell)); dismiss() })
                                        } else {
                                            DropdownMenuItem(text = { Text("Contains") }, leadingIcon = fi,
                                                onClick = { onAction?.invoke(GridAction.FilterContains(colName, cell)); dismiss() })
                                            DropdownMenuItem(text = { Text("Not contains") }, leadingIcon = fi,
                                                onClick = { onAction?.invoke(GridAction.FilterNotContains(colName, cell)); dismiss() })
                                        }
                                    }
                                    HorizontalDivider()
                                    DropdownMenuItem(text = { Text("IS NULL") }, leadingIcon = fi,
                                        onClick = { onAction?.invoke(GridAction.FilterIsNull(colName)); dismiss() })
                                    DropdownMenuItem(text = { Text("IS NOT NULL") }, leadingIcon = fi,
                                        onClick = { onAction?.invoke(GridAction.FilterIsNotNull(colName)); dismiss() })
                                }
                            }
                            if (ci < visibleCols.size - 1) {
                                Spacer(Modifier.width(1.dp).background(borderColor))
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Column visibility dialog ───────────────────────────────────
    if (showColumnPicker) {
        AlertDialog(
            onDismissRequest = { showColumnPicker = false },
            title = { Text("Columns") },
            text = {
                Column(Modifier.verticalScroll(rememberVScrollState())) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        TextButton(onClick = {
                            visibleCols.clear()
                            visibleCols.addAll(pagedQuery.columns.indices)
                        }) { Text("Select all") }
                        TextButton(onClick = {
                            if (visibleCols.size > 1) {
                                val first = visibleCols.first()
                                visibleCols.clear()
                                visibleCols.add(first)
                            }
                        }) { Text("Clear") }
                    }
                    pagedQuery.columns.forEachIndexed { idx, col ->
                        Row(
                            Modifier.fillMaxWidth()
                                .clickable {
                                    if (idx in visibleCols && visibleCols.size > 1) visibleCols.remove(idx)
                                    else if (idx !in visibleCols) visibleCols.add(idx)
                                }
                                .padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = idx in visibleCols,
                                onCheckedChange = { checked ->
                                    if (checked) { if (idx !in visibleCols) visibleCols.add(idx) }
                                    else { if (visibleCols.size > 1) visibleCols.remove(idx) }
                                },
                            )
                            Text(col.name, style = MaterialTheme.typography.bodyMedium.copy(
                                fontFamily = CodeFontFamily))
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showColumnPicker = false }) { Text("Done") }
            },
        )
    }

    // ── Aggregate dialog ─────────────────────────────────────────────
    if (aggDialogCol != null) {
        val metricCol = aggDialogCol!!
        val allCols = pagedQuery.columns.map { it.name }
        val functions = listOf("COUNT", "COUNT_DISTINCT", "SUM", "AVG", "MIN", "MAX")

        AlertDialog(
            onDismissRequest = { aggDialogCol = null },
            title = { Text("Aggregate") },
            text = {
                Column(Modifier.verticalScroll(rememberVScrollState())) {
                    Text("Function", style = MaterialTheme.typography.labelMedium, color = primary)
                    functions.forEach { fn ->
                        val label = when (fn) {
                            "COUNT" -> "COUNT($metricCol)"
                            "COUNT_DISTINCT" -> "COUNT(DISTINCT $metricCol)"
                            else -> "$fn($metricCol)"
                        }
                        Row(Modifier.fillMaxWidth().clickable { aggFunction = fn }.padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            androidx.compose.material3.RadioButton(selected = aggFunction == fn, onClick = { aggFunction = fn })
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    Spacer(Modifier.padding(6.dp))
                    Text("Group by", style = MaterialTheme.typography.labelMedium, color = primary)
                    allCols.forEach { col ->
                        Row(Modifier.fillMaxWidth().clickable {
                            aggGroupBy = if (col in aggGroupBy) aggGroupBy - col else aggGroupBy + col
                        }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = col in aggGroupBy, onCheckedChange = { c ->
                                aggGroupBy = if (c) aggGroupBy + col else aggGroupBy - col
                            })
                            Text(col, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (aggGroupBy.isNotEmpty()) {
                        onAction?.invoke(GridAction.Aggregate(aggFunction, metricCol, aggGroupBy.toList()))
                    }
                    aggDialogCol = null
                }, enabled = aggGroupBy.isNotEmpty()) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { aggDialogCol = null }) { Text("Cancel") } },
        )
    }
}
