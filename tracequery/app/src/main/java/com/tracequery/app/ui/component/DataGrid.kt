package com.tracequery.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.ui.theme.CodeFontFamily
import com.tracequery.app.ui.theme.GridColors

private const val SAMPLE_ROWS = 200
private const val ROW_NUM_WIDTH_DP = 48

private fun estimateColumnWidths(result: QueryResult): List<Float> {
    return result.columns.mapIndexed { colIdx, col ->
        var maxLen = col.name.length
        for (i in 0 until minOf(SAMPLE_ROWS, result.rows.size)) {
            if (colIdx < result.rows[i].size) {
                maxLen = maxOf(maxLen, result.rows[i][colIdx].length)
            }
        }
        (maxLen * 8 + 28).toFloat().coerceIn(64f, 360f)
    }
}

private data class SortState(val col: Int = -1, val asc: Boolean = true)

private fun sortRows(rows: List<List<String>>, s: SortState): List<List<String>> {
    if (s.col < 0) return rows
    return rows.sortedWith(Comparator { a, b ->
        val va = a.getOrElse(s.col) { "" }
        val vb = b.getOrElse(s.col) { "" }
        val na = va.toLongOrNull(); val nb = vb.toLongOrNull()
        val cmp = if (na != null && nb != null) na.compareTo(nb) else {
            val da = va.toDoubleOrNull(); val db = vb.toDoubleOrNull()
            if (da != null && db != null) da.compareTo(db) else va.compareTo(vb, true)
        }
        if (s.asc) cmp else -cmp
    })
}

@Composable
fun DataGrid(result: QueryResult, modifier: Modifier = Modifier) {
    if (result.columns.isEmpty()) return

    val density = LocalDensity.current
    val clipboard = LocalClipboardManager.current
    val colWidths = remember(result) { mutableStateListOf(*estimateColumnWidths(result).toTypedArray()) }
    val hScroll = rememberScrollState()
    var sort by remember { mutableStateOf(SortState()) }
    val sorted by remember(result.rows, sort) { derivedStateOf { sortRows(result.rows, sort) } }

    val headerBg = MaterialTheme.colorScheme.surfaceVariant
    val rowEven = MaterialTheme.colorScheme.background
    val rowOdd = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    val borderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
    val onSurface = MaterialTheme.colorScheme.onSurface
    val onVariant = MaterialTheme.colorScheme.onSurfaceVariant
    val primary = MaterialTheme.colorScheme.primary

    val cellText = TextStyle(fontFamily = CodeFontFamily, fontSize = 12.sp, lineHeight = 16.sp)
    val headerText = cellText.copy(fontWeight = FontWeight.SemiBold)

    Column(modifier = modifier) {
        // ── Header ───────────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(hScroll)
                .background(headerBg)
                .height(IntrinsicSize.Min),
        ) {
            Box(
                Modifier.width(ROW_NUM_WIDTH_DP.dp).padding(horizontal = 4.dp, vertical = 10.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Text("#", style = headerText, color = onVariant)
            }
            Spacer(Modifier.width(1.dp).fillMaxHeight().background(borderColor))

            result.columns.forEachIndexed { idx, col ->
                val active = sort.col == idx
                val arrow = if (active) (if (sort.asc) " \u25B2" else " \u25BC") else ""

                Row(Modifier.width(colWidths[idx].dp).height(IntrinsicSize.Min)) {
                    Box(
                        Modifier
                            .weight(1f)
                            .clickable {
                                sort = if (sort.col == idx) sort.copy(asc = !sort.asc)
                                else SortState(idx)
                            }
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                    ) {
                        Text(
                            col.name + arrow, style = headerText,
                            color = if (active) primary else onSurface,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    // Resize handle
                    Box(
                        Modifier
                            .width(4.dp)
                            .fillMaxHeight()
                            .background(borderColor)
                            .pointerInput(idx) {
                                detectHorizontalDragGestures { _, delta ->
                                    val dpDelta = with(density) { delta.toDp().value }
                                    colWidths[idx] = (colWidths[idx] + dpDelta).coerceIn(64f, 800f)
                                }
                            },
                    )
                }
            }
        }

        HorizontalDivider(color = borderColor)

        // ── Rows ─────────────────────────────────────────────────────────
        LazyColumn(
            state = rememberLazyListState(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            itemsIndexed(sorted, key = { i, _ -> i }) { rowIdx, row ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(hScroll)
                        .background(if (rowIdx % 2 == 0) rowEven else rowOdd)
                        .height(IntrinsicSize.Min),
                ) {
                    Box(
                        Modifier.width(ROW_NUM_WIDTH_DP.dp).padding(horizontal = 4.dp, vertical = 6.dp),
                        contentAlignment = Alignment.CenterEnd,
                    ) {
                        Text("${rowIdx + 1}", style = cellText, color = onVariant)
                    }
                    Spacer(Modifier.width(1.dp).fillMaxHeight().background(borderColor))

                    row.forEachIndexed { colIdx, cell ->
                        val isNull = cell == "NULL"
                        val isNum = !isNull && (cell.toLongOrNull() != null || cell.toDoubleOrNull() != null)

                        Box(
                            Modifier
                                .width(colWidths.getOrElse(colIdx) { 100f }.dp)
                                .clickable { clipboard.setText(AnnotatedString(cell)) }
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                        ) {
                            Text(
                                cell, style = cellText,
                                color = when {
                                    isNull -> GridColors.NullText
                                    isNum -> GridColors.NumberText
                                    else -> onSurface
                                },
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (colIdx < row.size - 1) {
                            Spacer(Modifier.width(1.dp).fillMaxHeight().background(borderColor))
                        }
                    }
                }
            }

            if (result.truncated) {
                item {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.2f))
                            .padding(16.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Showing first ${result.maxRowsHit} rows. Add LIMIT to your query.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
        }
    }
}
