package com.tracequery.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.ui.theme.CodeFontFamily
import com.tracequery.app.ui.theme.GridColors

// ── Column width calculation ─────────────────────────────────────────────────

private const val CHAR_WIDTH_SP = 8  // approximate monospace char width
private const val MIN_COL_WIDTH_DP = 60
private const val MAX_COL_WIDTH_DP = 400
private const val SAMPLE_ROWS = 200  // sample first N rows for width estimation

private fun computeColumnWidths(result: QueryResult): List<Dp> {
    if (result.columns.isEmpty()) return emptyList()

    return result.columns.mapIndexed { colIdx, col ->
        var maxLen = col.name.length

        // Sample first N rows for width estimation
        val sampleSize = minOf(SAMPLE_ROWS, result.rows.size)
        for (rowIdx in 0 until sampleSize) {
            val row = result.rows[rowIdx]
            if (colIdx < row.size) {
                maxLen = maxOf(maxLen, row[colIdx].length)
            }
        }

        // Convert char count to dp (approximate)
        val estimatedDp = (maxLen * CHAR_WIDTH_SP + 24).coerceIn(MIN_COL_WIDTH_DP, MAX_COL_WIDTH_DP)
        estimatedDp.dp
    }
}

// ── Sort state ───────────────────────────────────────────────────────────────

private data class SortState(
    val columnIndex: Int = -1,
    val ascending: Boolean = true,
)

private fun sortRows(
    rows: List<List<String>>,
    sort: SortState,
): List<List<String>> {
    if (sort.columnIndex < 0) return rows

    return rows.sortedWith(Comparator { a, b ->
        val va = a.getOrElse(sort.columnIndex) { "" }
        val vb = b.getOrElse(sort.columnIndex) { "" }

        // Try numeric comparison first
        val na = va.toLongOrNull()
        val nb = vb.toLongOrNull()
        val cmp = if (na != null && nb != null) {
            na.compareTo(nb)
        } else {
            val da = va.toDoubleOrNull()
            val db = vb.toDoubleOrNull()
            if (da != null && db != null) da.compareTo(db)
            else va.compareTo(vb, ignoreCase = true)
        }

        if (sort.ascending) cmp else -cmp
    })
}

// ── DataGrid composable ──────────────────────────────────────────────────────

@Composable
fun DataGrid(
    result: QueryResult,
    modifier: Modifier = Modifier,
) {
    if (result.columns.isEmpty()) return

    val columnWidths = remember(result) { computeColumnWidths(result) }
    val horizontalScrollState = rememberScrollState()
    val listState = rememberLazyListState()
    var sortState by remember { mutableStateOf(SortState()) }
    val clipboard = LocalClipboardManager.current

    val sortedRows by remember(result.rows, sortState) {
        derivedStateOf { sortRows(result.rows, sortState) }
    }

    Column(modifier = modifier) {
        // ── Header row ───────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(horizontalScrollState)
                .background(GridColors.HeaderBg)
                .height(IntrinsicSize.Min),
        ) {
            // Row number column
            Box(
                modifier = Modifier
                    .width(48.dp)
                    .padding(horizontal = 4.dp, vertical = 8.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Text(
                    text = "#",
                    style = cellStyle().copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            result.columns.forEachIndexed { idx, col ->
                val isActive = sortState.columnIndex == idx
                val arrow = if (isActive) {
                    if (sortState.ascending) " \u25B2" else " \u25BC"
                } else ""

                Box(
                    modifier = Modifier
                        .width(columnWidths[idx])
                        .clickable {
                            sortState = if (sortState.columnIndex == idx) {
                                sortState.copy(ascending = !sortState.ascending)
                            } else {
                                SortState(idx, ascending = true)
                            }
                        }
                        .padding(horizontal = 6.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = col.name + arrow,
                        style = cellStyle().copy(
                            fontWeight = FontWeight.Bold,
                            color = if (isActive) MaterialTheme.colorScheme.primary
                                   else MaterialTheme.colorScheme.onSurface,
                        ),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                // Column separator
                if (idx < result.columns.size - 1) {
                    Spacer(
                        modifier = Modifier
                            .width(1.dp)
                            .fillMaxHeight()
                            .background(GridColors.Border)
                    )
                }
            }
        }

        HorizontalDivider(color = GridColors.Border, thickness = 1.dp)

        // ── Data rows (virtual scroll via LazyColumn) ────────────────────
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth(),
        ) {
            itemsIndexed(
                items = sortedRows,
                key = { index, _ -> index },
            ) { rowIndex, row ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(horizontalScrollState)
                        .background(
                            if (rowIndex % 2 == 0) GridColors.RowEven
                            else GridColors.RowOdd
                        )
                        .height(IntrinsicSize.Min),
                ) {
                    // Row number
                    Box(
                        modifier = Modifier
                            .width(48.dp)
                            .padding(horizontal = 4.dp, vertical = 6.dp),
                        contentAlignment = Alignment.CenterEnd,
                    ) {
                        Text(
                            text = "${rowIndex + 1}",
                            style = cellStyle(),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    row.forEachIndexed { colIdx, cell ->
                        val isNull = cell == "NULL"
                        val isNumber = !isNull && (cell.toLongOrNull() != null || cell.toDoubleOrNull() != null)

                        Box(
                            modifier = Modifier
                                .width(columnWidths.getOrElse(colIdx) { 100.dp })
                                .clickable {
                                    clipboard.setText(AnnotatedString(cell))
                                }
                                .padding(horizontal = 6.dp, vertical = 6.dp),
                        ) {
                            Text(
                                text = cell,
                                style = cellStyle(),
                                color = when {
                                    isNull -> GridColors.NullText
                                    isNumber -> GridColors.NumberText
                                    else -> GridColors.StringText
                                },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }

                        if (colIdx < row.size - 1) {
                            Spacer(
                                modifier = Modifier
                                    .width(1.dp)
                                    .fillMaxHeight()
                                    .background(GridColors.Border)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun cellStyle() = TextStyle(
    fontFamily = CodeFontFamily,
    fontSize = 12.sp,
    lineHeight = 16.sp,
)
