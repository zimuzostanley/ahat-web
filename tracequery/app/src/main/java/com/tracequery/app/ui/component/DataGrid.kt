package com.tracequery.app.ui.component

import android.content.Intent
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.height
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.Functions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

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

// ── DataGrid ─────────────────────────────────────────────────────────────────

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
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val hScroll = rememberScrollState()
    val listState = rememberLazyListState()

    val firstPageRows = remember(pagedQuery.version) {
        (0 until minOf(200, pagedQuery.rowsRead)).mapNotNull { pagedQuery.getRow(it) }
    }
    val widths = remember(pagedQuery.columns, firstPageRows.size) {
        mutableStateListOf(*estimateWidths(pagedQuery.columns, firstPageRows).toTypedArray())
    }
    val visibleCols = remember(pagedQuery.columns) {
        mutableStateListOf(*pagedQuery.columns.indices.toList().toTypedArray())
    }
    var showColumnPicker by remember { mutableStateOf(false) }
    var colMenuIdx by remember { mutableIntStateOf(-1) }
    // Cell menu: store row/col index, show menu outside the LazyColumn
    var cellMenuRow by remember { mutableIntStateOf(-1) }
    var cellMenuCol by remember { mutableIntStateOf(-1) }
    var cellMenuValue by remember { mutableStateOf("") }
    var cellMenuColName by remember { mutableStateOf("") }
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
    val textMeasurer = rememberTextMeasurer()
    val rowHeightDp = 30.dp

    val totalRows = if (pagedQuery.knownTotalRows >= 0) pagedQuery.knownTotalRows.toInt()
                    else pagedQuery.rowsRead + if (pagedQuery.isComplete) 0 else 1

    val displayedColumns = remember(visibleCols.toList(), pagedQuery.columns) {
        visibleCols.map { pagedQuery.columns[it] }
    }

    // Scroll-driven loading
    val lastVisible by derivedStateOf {
        listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
    }
    LaunchedEffect(lastVisible, pagedQuery.version) {
        onEnsureRows?.invoke(lastVisible)
    }

    // The entire grid (header + rows) scrolls horizontally together
    Column(modifier) {
        // Column visibility indicator
        if (visibleCols.size < pagedQuery.columns.size) {
            Text("${visibleCols.size}/${pagedQuery.columns.size} columns",
                Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelSmall, color = onVariant)
        }

        // SINGLE horizontal scroll wrapping header + body
        Column(Modifier.horizontalScroll(hScroll)) {
            // ── Header ───────────────────────────────────────────────
            Row(Modifier.background(headerBg)) {
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
                            text = { Text("Copy all as TSV") },
                            leadingIcon = { Icon(Icons.Default.ContentCopy, null) },
                            onClick = {
                                showExportMenu = false
                                scope.launch(Dispatchers.IO) {
                                    pagedQuery.readAll()
                                    val tsv = buildTsv(pagedQuery, displayedColumns, visibleCols)
                                    kotlinx.coroutines.withContext(Dispatchers.Main) {
                                        clipboard.setText(AnnotatedString(tsv))
                                        Toast.makeText(context, "Copied ${pagedQuery.rowsRead} rows", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Share as TSV") },
                            onClick = {
                                showExportMenu = false
                                scope.launch(Dispatchers.IO) {
                                    pagedQuery.readAll()
                                    try {
                                        val dir = File(context.cacheDir, "export")
                                        dir.mkdirs()
                                        val fileName = "tracequery_${System.currentTimeMillis()}.tsv"
                                        val file = File(dir, fileName)
                                        file.bufferedWriter().use { w ->
                                            w.write(displayedColumns.joinToString("\t") { it.name })
                                            w.newLine()
                                            for (i in 0 until pagedQuery.rowsRead) {
                                                val row = pagedQuery.getRow(i) ?: continue
                                                w.write(visibleCols.joinToString("\t") { row.getOrElse(it) { "" } })
                                                w.newLine()
                                            }
                                        }
                                        kotlinx.coroutines.withContext(Dispatchers.Main) {
                                            // Share via intent — user can save to Downloads, Drive, etc.
                                            try {
                                                val uri = androidx.core.content.FileProvider.getUriForFile(
                                                    context, "${context.packageName}.fileprovider", file)
                                                val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                                    type = "text/tab-separated-values"
                                                    putExtra(android.content.Intent.EXTRA_STREAM, uri)
                                                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                                }
                                                context.startActivity(android.content.Intent.createChooser(intent, "Share TSV"))
                                            } catch (e: Exception) {
                                                // FileProvider not configured — just show path
                                                Toast.makeText(context, "Saved: ${file.absolutePath}", Toast.LENGTH_LONG).show()
                                            }
                                        }
                                    } catch (e: Exception) {
                                        kotlinx.coroutines.withContext(Dispatchers.Main) {
                                            Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                }
                            },
                        )
                        HorizontalDivider()
                        DropdownMenuItem(text = { Text("Columns...") },
                            onClick = { showColumnPicker = true; showExportMenu = false })
                    }
                }

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
                            Text(col.name + arrow, style = headerText,
                                color = if (sortEntry != null) primary else onSurface,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                            DropdownMenu(expanded = colMenuIdx == idx, onDismissRequest = { colMenuIdx = -1 }) {
                                DropdownMenuItem(text = { Text("Sort ascending") },
                                    onClick = { onAction?.invoke(GridAction.SortColumn(col.name, true)); colMenuIdx = -1 })
                                DropdownMenuItem(text = { Text("Sort descending") },
                                    onClick = { onAction?.invoke(GridAction.SortColumn(col.name, false)); colMenuIdx = -1 })
                                HorizontalDivider()
                                DropdownMenuItem(text = { Text("Aggregate...") },
                                    leadingIcon = { Icon(Icons.Default.Functions, null) },
                                    onClick = { aggDialogCol = col.name; aggFunction = "COUNT"; aggGroupBy = emptySet(); colMenuIdx = -1 })
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

            // ── Rows ─────────────────────────────────────────────────
            val colWidthSnapshot = remember(widths.toList()) { widths.toList() }

            LazyColumn(state = listState, modifier = Modifier.fillMaxWidth()) {
                items(count = totalRows, key = { it }) { ri ->
                    val row = pagedQuery.getRow(ri)

                    Row(
                        Modifier.background(if (ri % 2 == 0) rowEven else rowOdd)
                            .pointerInput(ri) {
                                detectTapGestures(
                                    onTap = { offset ->
                                        if (row == null) return@detectTapGestures
                                        val ci = columnAtX(offset.x, ROW_NUM_W.toFloat() * density.density, colWidthSnapshot, visibleCols, density.density)
                                        if (ci >= 0) {
                                            val origIdx = visibleCols.getOrNull(ci) ?: return@detectTapGestures
                                            clipboard.setText(AnnotatedString(row.getOrElse(origIdx) { "" }))
                                        }
                                    },
                                    onLongPress = { offset ->
                                        if (row == null) return@detectTapGestures
                                        val ci = columnAtX(offset.x, ROW_NUM_W.toFloat() * density.density, colWidthSnapshot, visibleCols, density.density)
                                        if (ci >= 0) {
                                            val origIdx = visibleCols.getOrNull(ci) ?: return@detectTapGestures
                                            cellMenuValue = row.getOrElse(origIdx) { "" }
                                            cellMenuColName = displayedColumns.getOrNull(ci)?.name ?: ""
                                            cellMenuRow = ri
                                            cellMenuCol = ci
                                        }
                                    },
                                )
                            },
                    ) {
                        Text("${ri + 1}", style = cellText, color = onVariant,
                            textAlign = TextAlign.End,
                            modifier = Modifier.width(ROW_NUM_W.dp).padding(horizontal = 4.dp, vertical = 6.dp))

                        if (row == null) {
                            Text("...", style = cellText, color = onVariant,
                                modifier = Modifier.padding(8.dp))
                        } else {
                            visibleCols.forEach { origColIdx ->
                                val cell = row.getOrElse(origColIdx) { "" }
                                val isNull = cell == "NULL"
                                val firstChar = cell.firstOrNull()
                                val isNum = !isNull && firstChar != null &&
                                    (firstChar.isDigit() || firstChar == '-' || firstChar == '.')

                                Text(
                                    text = cell,
                                    style = cellText,
                                    color = when {
                                        isNull -> onVariant
                                        isNum -> primary
                                        else -> onSurface
                                    },
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier
                                        .width(colWidthSnapshot.getOrElse(origColIdx) { 100f }.dp)
                                        .padding(horizontal = 8.dp, vertical = 6.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Cell context menu (composed ONCE, outside LazyColumn) ────────────
    if (cellMenuRow >= 0) {
        val cell = cellMenuValue
        val colName = cellMenuColName
        val isNull = cell == "NULL"
        val firstChar = cell.firstOrNull()
        val isNum = !isNull && firstChar != null && (firstChar.isDigit() || firstChar == '-' || firstChar == '.')

        DropdownMenu(
            expanded = true,
            onDismissRequest = { cellMenuRow = -1 },
        ) {
            fun dismiss() { cellMenuRow = -1 }
            val fi = @Composable { Icon(Icons.Default.FilterAlt, null) }

            DropdownMenuItem(text = { Text("Copy") },
                leadingIcon = { Icon(Icons.Default.ContentCopy, null) },
                onClick = { clipboard.setText(AnnotatedString(cell)); dismiss() })
            HorizontalDivider()
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

    // ── Column visibility dialog ─────────────────────────────────────────
    if (showColumnPicker) {
        AlertDialog(
            onDismissRequest = { showColumnPicker = false },
            title = { Text("Columns") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { visibleCols.clear(); visibleCols.addAll(pagedQuery.columns.indices) }) { Text("Select all") }
                        TextButton(onClick = { if (visibleCols.size > 1) { val f = visibleCols.first(); visibleCols.clear(); visibleCols.add(f) } }) { Text("Clear") }
                    }
                    pagedQuery.columns.forEachIndexed { idx, col ->
                        Row(Modifier.fillMaxWidth().clickable {
                            if (idx in visibleCols && visibleCols.size > 1) visibleCols.remove(idx)
                            else if (idx !in visibleCols) visibleCols.add(idx)
                        }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = idx in visibleCols, onCheckedChange = { c ->
                                if (c) { if (idx !in visibleCols) visibleCols.add(idx) }
                                else { if (visibleCols.size > 1) visibleCols.remove(idx) }
                            })
                            Text(col.name, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = CodeFontFamily))
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showColumnPicker = false }) { Text("Done") } },
        )
    }

    // ── Aggregate dialog ─────────────────────────────────────────────────
    if (aggDialogCol != null) {
        val metricCol = aggDialogCol!!
        val allCols = pagedQuery.columns.map { it.name }
        val functions = listOf("COUNT", "COUNT_DISTINCT", "SUM", "AVG", "MIN", "MAX")
        AlertDialog(
            onDismissRequest = { aggDialogCol = null },
            title = { Text("Aggregate") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text("Function", style = MaterialTheme.typography.labelMedium, color = primary)
                    functions.forEach { fn ->
                        val label = when (fn) { "COUNT" -> "COUNT($metricCol)"; "COUNT_DISTINCT" -> "COUNT(DISTINCT $metricCol)"; else -> "$fn($metricCol)" }
                        Row(Modifier.fillMaxWidth().clickable { aggFunction = fn }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            androidx.compose.material3.RadioButton(selected = aggFunction == fn, onClick = { aggFunction = fn })
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    Spacer(Modifier.padding(6.dp))
                    Text("Group by", style = MaterialTheme.typography.labelMedium, color = primary)
                    allCols.forEach { col ->
                        Row(Modifier.fillMaxWidth().clickable { aggGroupBy = if (col in aggGroupBy) aggGroupBy - col else aggGroupBy + col }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = col in aggGroupBy, onCheckedChange = { c -> aggGroupBy = if (c) aggGroupBy + col else aggGroupBy - col })
                            Text(col, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { if (aggGroupBy.isNotEmpty()) onAction?.invoke(GridAction.Aggregate(aggFunction, metricCol, aggGroupBy.toList())); aggDialogCol = null }, enabled = aggGroupBy.isNotEmpty()) { Text("Apply") } },
            dismissButton = { TextButton(onClick = { aggDialogCol = null }) { Text("Cancel") } },
        )
    }
}

/** Given a tap X position in pixels, return which visible column index was tapped. */
private fun columnAtX(x: Float, rowNumWidthPx: Float, colWidths: List<Float>, visibleCols: List<Int>, density: Float): Int {
    var accum = rowNumWidthPx
    for (ci in visibleCols.indices) {
        val origIdx = visibleCols[ci]
        val widthPx = (colWidths.getOrElse(origIdx) { 100f }) * density
        if (x < accum + widthPx) return ci
        accum += widthPx
    }
    return -1
}

private fun buildTsv(paged: PagedQuery, columns: List<com.tracequery.app.data.model.ColumnInfo>, visibleCols: List<Int>): String = buildString {
    append(columns.joinToString("\t") { it.name }); append("\n")
    for (i in 0 until paged.rowsRead) {
        val row = paged.getRow(i) ?: continue
        append(visibleCols.joinToString("\t") { row.getOrElse(it) { "" } }); append("\n")
    }
}
