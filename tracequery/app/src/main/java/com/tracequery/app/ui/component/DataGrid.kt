package com.tracequery.app.ui.component

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.Functions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState as rememberVScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.ui.theme.CodeFontFamily
// All colors resolved from MaterialTheme at composition time

/** Action from cell/column context menus. */
sealed class GridAction {
    data class CopyCellValue(val value: String) : GridAction()
    data class FilterEquals(val column: String, val value: String) : GridAction()
    data class FilterNotEquals(val column: String, val value: String) : GridAction()
    data class FilterGreaterThan(val column: String, val value: String) : GridAction()
    data class FilterLessThan(val column: String, val value: String) : GridAction()
    data class FilterGreaterOrEqual(val column: String, val value: String) : GridAction()
    data class FilterLessOrEqual(val column: String, val value: String) : GridAction()
    data class FilterIsNull(val column: String) : GridAction()
    data class FilterIsNotNull(val column: String) : GridAction()
    data class FilterContains(val column: String, val value: String) : GridAction()
    data class FilterNotContains(val column: String, val value: String) : GridAction()
    data class FilterGlob(val column: String, val value: String) : GridAction()
    data class FilterNotGlob(val column: String, val value: String) : GridAction()
    /** Aggregate with metric column separate from group-by columns. */
    data class Aggregate(
        val function: String,
        val metricColumn: String,
        val groupByColumns: List<String>,
    ) : GridAction()
}

private const val SAMPLE_ROWS = 200
private const val ROW_NUM_W = 48

private fun estimateWidths(result: QueryResult): List<Float> {
    return result.columns.mapIndexed { c, col ->
        var max = col.name.length
        for (r in 0 until minOf(SAMPLE_ROWS, result.rows.size)) {
            if (c < result.rows[r].size) max = maxOf(max, result.rows[r][c].length)
        }
        (max * 8 + 28).toFloat().coerceIn(64f, 360f)
    }
}

private data class SortState(val col: Int = -1, val asc: Boolean = true)
private fun sorted(rows: List<List<String>>, s: SortState): List<List<String>> {
    if (s.col < 0) return rows
    return rows.sortedWith { a, b ->
        val va = a.getOrElse(s.col) { "" }; val vb = b.getOrElse(s.col) { "" }
        val na = va.toLongOrNull(); val nb = vb.toLongOrNull()
        val c = if (na != null && nb != null) na.compareTo(nb)
        else { val da = va.toDoubleOrNull(); val db = vb.toDoubleOrNull()
            if (da != null && db != null) da.compareTo(db) else va.compareTo(vb, true) }
        if (s.asc) c else -c
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DataGrid(
    result: QueryResult,
    onAction: ((GridAction) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    if (result.columns.isEmpty()) return

    val density = LocalDensity.current
    val clipboard = LocalClipboardManager.current
    val widths = remember(result) { mutableStateListOf(*estimateWidths(result).toTypedArray()) }
    val hScroll = rememberScrollState()
    var sort by remember { mutableStateOf(SortState()) }
    val rows by remember(result.rows, sort) { derivedStateOf { sorted(result.rows, sort) } }

    // Menu state
    var colMenuIdx by remember { mutableIntStateOf(-1) }
    var cellMenuRow by remember { mutableIntStateOf(-1) }
    var cellMenuCol by remember { mutableIntStateOf(-1) }

    // Aggregate dialog state
    var aggDialogCol by remember { mutableStateOf<String?>(null) }
    var aggFunction by remember { mutableStateOf("COUNT") }
    var aggGroupBy by remember { mutableStateOf(setOf<String>()) }

    val headerBg = MaterialTheme.colorScheme.surfaceVariant
    val borderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
    val rowEven = MaterialTheme.colorScheme.surface
    val rowOdd = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    val onSurface = MaterialTheme.colorScheme.onSurface
    val onVariant = MaterialTheme.colorScheme.onSurfaceVariant
    val primary = MaterialTheme.colorScheme.primary

    val cellText = TextStyle(fontFamily = CodeFontFamily, fontSize = 12.sp, lineHeight = 18.sp)
    val headerText = cellText.copy(fontWeight = FontWeight.SemiBold)

    Column(modifier) {
        // ── Header ───────────────────────────────────────────────────────
        Row(
            Modifier.fillMaxWidth().horizontalScroll(hScroll).background(headerBg)
        ) {
            // Row # header
            Box(Modifier.width(ROW_NUM_W.dp).padding(8.dp), contentAlignment = Alignment.CenterEnd) {
                Text("#", style = headerText, color = onVariant)
            }
            Spacer(Modifier.width(1.dp).background(borderColor))

            result.columns.forEachIndexed { idx, col ->
                val active = sort.col == idx
                val arrow = if (active) (if (sort.asc) " ▲" else " ▼") else ""

                Row(Modifier.width(widths[idx].dp)) {
                    Box(
                        Modifier
                            .weight(1f)
                            .combinedClickable(
                                onClick = {
                                    sort = if (sort.col == idx) {
                                        if (sort.asc) SortState(idx, false)
                                        else SortState() // clear
                                    } else SortState(idx)
                                },
                                onLongClick = { colMenuIdx = idx },
                            )
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                    ) {
                        Text(
                            col.name + arrow, style = headerText,
                            color = if (active) primary else onSurface,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )

                        // Column menu
                        DropdownMenu(
                            expanded = colMenuIdx == idx,
                            onDismissRequest = { colMenuIdx = -1 },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Sort ascending") },
                                onClick = { sort = SortState(idx, true); colMenuIdx = -1 },
                            )
                            DropdownMenuItem(
                                text = { Text("Sort descending") },
                                onClick = { sort = SortState(idx, false); colMenuIdx = -1 },
                            )
                            if (active) {
                                DropdownMenuItem(
                                    text = { Text("Clear sort") },
                                    onClick = { sort = SortState(); colMenuIdx = -1 },
                                )
                            }
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = { Text("Aggregate...") },
                                leadingIcon = { Icon(Icons.Default.Functions, null) },
                                onClick = {
                                    aggDialogCol = col.name
                                    aggFunction = "COUNT"
                                    aggGroupBy = emptySet()
                                    colMenuIdx = -1
                                },
                            )
                        }
                    }

                    // Resize handle
                    Box(
                        Modifier.width(4.dp).background(borderColor)
                            .pointerInput(idx) {
                                detectHorizontalDragGestures { _, delta ->
                                    val d = with(density) { delta.toDp().value }
                                    widths[idx] = (widths[idx] + d).coerceIn(48f, 800f)
                                }
                            },
                    )
                }
            }
        }

        HorizontalDivider(color = borderColor)

        // ── Rows ─────────────────────────────────────────────────────────
        LazyColumn(state = rememberLazyListState(), modifier = Modifier.fillMaxWidth()) {
            itemsIndexed(rows, key = { i, _ -> i }) { ri, row ->
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(hScroll)
                        .background(if (ri % 2 == 0) rowEven else rowOdd),
                ) {
                    Box(Modifier.width(ROW_NUM_W.dp).padding(horizontal = 4.dp, vertical = 6.dp),
                        contentAlignment = Alignment.CenterEnd) {
                        Text("${ri + 1}", style = cellText, color = onVariant)
                    }
                    Spacer(Modifier.width(1.dp).background(borderColor))

                    row.forEachIndexed { ci, cell ->
                        val isNull = cell == "NULL"
                        val isNum = !isNull && (cell.toLongOrNull() != null || cell.toDoubleOrNull() != null)
                        val colName = result.columns.getOrNull(ci)?.name ?: ""

                        Box(
                            Modifier
                                .width(widths.getOrElse(ci) { 100f }.dp)
                                .combinedClickable(
                                    onClick = {
                                        clipboard.setText(AnnotatedString(cell))
                                    },
                                    onLongClick = {
                                        cellMenuRow = ri; cellMenuCol = ci
                                    },
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
                                    onClick = {
                                        clipboard.setText(AnnotatedString(cell))
                                        cellMenuRow = -1; cellMenuCol = -1
                                    },
                                )
                                HorizontalDivider()
                                fun dismiss() { cellMenuRow = -1; cellMenuCol = -1 }
                                if (!isNull) {
                                    DropdownMenuItem(
                                        text = { Text("= $cell") },
                                        leadingIcon = { Icon(Icons.Default.FilterAlt, null) },
                                        onClick = { onAction?.invoke(GridAction.FilterEquals(colName, cell)); dismiss() },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("≠ $cell") },
                                        onClick = { onAction?.invoke(GridAction.FilterNotEquals(colName, cell)); dismiss() },
                                    )
                                    if (isNum) {
                                        DropdownMenuItem(text = { Text("> $cell") },
                                            onClick = { onAction?.invoke(GridAction.FilterGreaterThan(colName, cell)); dismiss() })
                                        DropdownMenuItem(text = { Text("≥ $cell") },
                                            onClick = { onAction?.invoke(GridAction.FilterGreaterOrEqual(colName, cell)); dismiss() })
                                        DropdownMenuItem(text = { Text("< $cell") },
                                            onClick = { onAction?.invoke(GridAction.FilterLessThan(colName, cell)); dismiss() })
                                        DropdownMenuItem(text = { Text("≤ $cell") },
                                            onClick = { onAction?.invoke(GridAction.FilterLessOrEqual(colName, cell)); dismiss() })
                                    } else {
                                        DropdownMenuItem(text = { Text("Contains '$cell'") },
                                            onClick = { onAction?.invoke(GridAction.FilterContains(colName, cell)); dismiss() })
                                        DropdownMenuItem(text = { Text("Not contains '$cell'") },
                                            onClick = { onAction?.invoke(GridAction.FilterNotContains(colName, cell)); dismiss() })
                                        DropdownMenuItem(text = { Text("Glob '*$cell*'") },
                                            onClick = { onAction?.invoke(GridAction.FilterGlob(colName, "*$cell*")); dismiss() })
                                    }
                                }
                                HorizontalDivider()
                                DropdownMenuItem(text = { Text("IS NULL") },
                                    onClick = { onAction?.invoke(GridAction.FilterIsNull(colName)); dismiss() })
                                DropdownMenuItem(text = { Text("IS NOT NULL") },
                                    onClick = { onAction?.invoke(GridAction.FilterIsNotNull(colName)); dismiss() })
                            }
                        }
                        if (ci < row.size - 1) {
                            Spacer(Modifier.width(1.dp).background(borderColor))
                        }
                    }
                }
            }

            if (result.truncated) {
                item {
                    Box(
                        Modifier.fillMaxWidth()
                            .background(MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.15f))
                            .padding(16.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Result truncated. Add LIMIT to your query.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
        }
    }

    // ── Aggregate dialog ─────────────────────────────────────────────
    if (aggDialogCol != null) {
        val metricCol = aggDialogCol!!
        val allCols = result.columns.map { it.name }
        val functions = listOf("COUNT", "SUM", "AVG", "MIN", "MAX", "COUNT_DISTINCT")

        AlertDialog(
            onDismissRequest = { aggDialogCol = null },
            title = { Text("Aggregate") },
            text = {
                Column(Modifier.verticalScroll(rememberVScrollState()).heightIn(max = 400.dp)) {
                    // Function picker
                    Text("Function", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary)
                    functions.forEach { fn ->
                        val label = if (fn == "COUNT_DISTINCT") "COUNT(DISTINCT $metricCol)"
                                   else if (fn == "COUNT") "COUNT(*)"
                                   else "$fn($metricCol)"
                        Row(
                            Modifier.fillMaxWidth().clickable { aggFunction = fn }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            androidx.compose.material3.RadioButton(
                                selected = aggFunction == fn,
                                onClick = { aggFunction = fn },
                            )
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }

                    Spacer(Modifier.height(12.dp))
                    Text("Group by", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary)

                    allCols.filter { it != metricCol || aggFunction == "COUNT" }.forEach { col ->
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                aggGroupBy = if (col in aggGroupBy) aggGroupBy - col else aggGroupBy + col
                            }.padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = col in aggGroupBy,
                                onCheckedChange = { checked ->
                                    aggGroupBy = if (checked) aggGroupBy + col else aggGroupBy - col
                                },
                            )
                            Text(col, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (aggGroupBy.isNotEmpty()) {
                            onAction?.invoke(GridAction.Aggregate(aggFunction, metricCol, aggGroupBy.toList()))
                        }
                        aggDialogCol = null
                    },
                    enabled = aggGroupBy.isNotEmpty(),
                ) { Text("Apply") }
            },
            dismissButton = {
                TextButton(onClick = { aggDialogCol = null }) { Text("Cancel") }
            },
        )
    }
}
