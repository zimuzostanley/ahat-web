package com.tracequery.app.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
// Uses MaterialTheme.shapes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.JoinInner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material.icons.filled.ViewColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.RadioButton
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
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
import androidx.compose.ui.unit.sp
import com.tracequery.app.data.model.StdlibTable
import com.tracequery.app.ui.theme.CodeFontFamily
// Uses MaterialTheme.colorScheme.secondary for table name color

/**
 * Searchable table browser for Perfetto SQL stdlib tables.
 * Supports real-time fuzzy search on table names, column names, and descriptions.
 */
/** Callback for join/intersect SQL generation. */
typealias OnJoinGenerated = (String) -> Unit

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun TableBrowser(
    tables: List<StdlibTable>,
    onTableSelect: (StdlibTable) -> Unit,
    onJoinGenerated: OnJoinGenerated? = null,
    modifier: Modifier = Modifier,
) {
    var searchQuery by remember { mutableStateOf("") }
    var joinSourceTable by remember { mutableStateOf<StdlibTable?>(null) }
    var showJoinDialog by remember { mutableStateOf(false) }
    var contextMenuTable by remember { mutableStateOf<StdlibTable?>(null) }

    val filtered by remember(searchQuery, tables) {
        derivedStateOf {
            if (searchQuery.isBlank()) {
                tables.take(50)  // Show top 50 by importance when no search
            } else {
                val q = searchQuery.lowercase()
                tables.filter { table ->
                    table.name.lowercase().contains(q)
                        || table.summaryDesc.lowercase().contains(q)
                        || table.moduleName.lowercase().contains(q)
                        || table.columns.any { it.name.lowercase().contains(q) }
                }.take(100)
            }
        }
    }

    Column(modifier = modifier) {
        // Search bar
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            placeholder = { Text("Search tables, columns...") },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = CodeFontFamily),
        )

        // Results count
        Text(
            text = "${filtered.size} table${if (filtered.size != 1) "s" else ""}" +
                   if (searchQuery.isBlank()) " (showing top by importance)" else "",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // Table list
        LazyColumn(modifier = Modifier.fillMaxWidth()) {
            items(
                items = filtered,
                key = { it.name },
            ) { table ->
                TableListItem(
                    table = table,
                    searchQuery = searchQuery,
                    onClick = { onTableSelect(table) },
                    onLongClick = if (onJoinGenerated != null) {
                        { joinSourceTable = table; contextMenuTable = table }
                    } else null,
                    showJoinOption = onJoinGenerated != null,
                )

                // Context menu for join
                if (contextMenuTable == table) {
                    DropdownMenu(
                        expanded = true,
                        onDismissRequest = { contextMenuTable = null },
                    ) {
                        DropdownMenuItem(
                            text = { Text("SELECT * FROM ${table.name}") },
                            onClick = { onTableSelect(table); contextMenuTable = null },
                        )
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text("JOIN with another table...") },
                            leadingIcon = { Icon(Icons.Default.JoinInner, null) },
                            onClick = { showJoinDialog = true; contextMenuTable = null },
                        )
                        // Show interval intersect option if table has ts/dur columns
                        val hasTsDur = table.columns.any { it.name == "ts" } &&
                                table.columns.any { it.name == "dur" }
                        if (hasTsDur) {
                            DropdownMenuItem(
                                text = { Text("Interval intersect...") },
                                onClick = { showJoinDialog = true; contextMenuTable = null },
                            )
                        }
                    }
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
            }
        }
    }

    // ── Join dialog ──────────────────────────────────────────────────────
    if (showJoinDialog && joinSourceTable != null) {
        JoinDialog(
            sourceTable = joinSourceTable!!,
            allTables = tables,
            onDismiss = { showJoinDialog = false },
            onJoinGenerated = { sql ->
                showJoinDialog = false
                onJoinGenerated?.invoke(sql)
            },
        )
    }
}

@Composable
private fun JoinDialog(
    sourceTable: StdlibTable,
    allTables: List<StdlibTable>,
    onDismiss: () -> Unit,
    onJoinGenerated: (String) -> Unit,
) {
    var targetSearch by remember { mutableStateOf("") }
    var targetTable by remember { mutableStateOf<StdlibTable?>(null) }
    var joinType by remember { mutableStateOf("INNER JOIN") }
    var leftJoinColumn by remember { mutableStateOf("") }
    var rightJoinColumn by remember { mutableStateOf("") }
    var useIntervalIntersect by remember { mutableStateOf(false) }
    var partitionColumns by remember { mutableStateOf(setOf<String>()) }

    val sourceHasTsDur = sourceTable.columns.any { it.name == "ts" } &&
            sourceTable.columns.any { it.name == "dur" }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Join: ${sourceTable.name}") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState())
                    .heightIn(max = 600.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Target table search
                Text("Join with:", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary)
                OutlinedTextField(
                    value = targetSearch,
                    onValueChange = { targetSearch = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Search table...") },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFontFamily),
                )

                // Filtered target tables
                val targets = remember(targetSearch, allTables) {
                    if (targetSearch.isBlank()) allTables.take(10)
                    else allTables.filter { it.name.contains(targetSearch, true) }.take(20)
                }
                targets.filter { it.name != sourceTable.name }.take(8).forEach { t ->
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable { targetTable = t; targetSearch = t.name }
                            .background(
                                if (targetTable == t) MaterialTheme.colorScheme.secondaryContainer
                                else MaterialTheme.colorScheme.surface
                            )
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.TableChart, null, Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.secondary)
                        Spacer(Modifier.width(8.dp))
                        Text(t.name, style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = CodeFontFamily))
                    }
                }

                if (targetTable != null) {
                    Spacer(Modifier.height(4.dp))

                    // Check if both have ts/dur for interval intersect
                    val targetHasTsDur = targetTable!!.columns.any { it.name == "ts" } &&
                            targetTable!!.columns.any { it.name == "dur" }
                    val canIntersect = sourceHasTsDur && targetHasTsDur

                    // Join type
                    Text("Type:", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary)

                    listOf("INNER JOIN", "LEFT JOIN").forEach { jt ->
                        Row(Modifier.fillMaxWidth().clickable { joinType = jt; useIntervalIntersect = false },
                            verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = joinType == jt && !useIntervalIntersect,
                                onClick = { joinType = jt; useIntervalIntersect = false })
                            Text(jt, style = MaterialTheme.typography.bodyMedium)
                        }
                    }

                    if (canIntersect) {
                        Row(Modifier.fillMaxWidth().clickable { useIntervalIntersect = true },
                            verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = useIntervalIntersect,
                                onClick = { useIntervalIntersect = true })
                            Text("_interval_intersect", style = MaterialTheme.typography.bodyMedium.copy(
                                fontFamily = CodeFontFamily))
                        }
                    }

                    if (!useIntervalIntersect) {
                        val srcCols = sourceTable.columns.map { it.name }.sorted()
                        val tgtCols = targetTable!!.columns.map { it.name }.sorted()
                        val commonCols = srcCols.toSet().intersect(tgtCols.toSet()).sorted()

                        // Common columns — quick pick
                        if (commonCols.isNotEmpty()) {
                            Text("Common columns:", style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary)
                            commonCols.forEach { col ->
                                Row(Modifier.fillMaxWidth().clickable {
                                    leftJoinColumn = col; rightJoinColumn = col
                                }, verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(
                                        selected = leftJoinColumn == col && rightJoinColumn == col,
                                        onClick = { leftJoinColumn = col; rightJoinColumn = col })
                                    Text(col, style = MaterialTheme.typography.bodySmall.copy(
                                        fontFamily = CodeFontFamily))
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                        }

                        // Independent left/right column selection
                        Text("Left (${sourceTable.name}):", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary)
                        srcCols.forEach { col ->
                            Row(Modifier.fillMaxWidth().clickable { leftJoinColumn = col },
                                verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(selected = leftJoinColumn == col,
                                    onClick = { leftJoinColumn = col })
                                Text(col, style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = CodeFontFamily))
                            }
                        }

                        Spacer(Modifier.height(8.dp))
                        Text("Right (${targetTable!!.name}):", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary)
                        tgtCols.forEach { col ->
                            Row(Modifier.fillMaxWidth().clickable { rightJoinColumn = col },
                                verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(selected = rightJoinColumn == col,
                                    onClick = { rightJoinColumn = col })
                                Text(col, style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = CodeFontFamily))
                            }
                        }
                    } else {
                        // Partition columns for interval intersect
                        val srcCols = sourceTable.columns.map { it.name }
                            .filter { it != "ts" && it != "dur" && it != "id" }
                        val tgtCols = targetTable!!.columns.map { it.name }.toSet()
                        val commonPartition = srcCols.filter { it in tgtCols }.sorted()

                        if (commonPartition.isNotEmpty()) {
                            Text("Partition by (optional):", style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary)
                            commonPartition.forEach { col ->
                                Row(Modifier.fillMaxWidth().clickable {
                                    partitionColumns = if (col in partitionColumns)
                                        partitionColumns - col else partitionColumns + col
                                }, verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(checked = col in partitionColumns,
                                        onCheckedChange = { checked ->
                                            partitionColumns = if (checked) partitionColumns + col
                                            else partitionColumns - col
                                        })
                                    Text(col, style = MaterialTheme.typography.bodySmall.copy(
                                        fontFamily = CodeFontFamily))
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
                    val target = targetTable ?: return@TextButton
                    val sql = generateJoinSql(sourceTable, target, joinType,
                        leftJoinColumn, rightJoinColumn, useIntervalIntersect, partitionColumns.toList())
                    onJoinGenerated(sql)
                },
                enabled = targetTable != null && (useIntervalIntersect ||
                    (leftJoinColumn.isNotBlank() && rightJoinColumn.isNotBlank())),
            ) { Text("Generate SQL") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

private fun generateJoinSql(
    source: StdlibTable,
    target: StdlibTable,
    joinType: String,
    leftCol: String,
    rightCol: String,
    useIntervalIntersect: Boolean,
    partitionColumns: List<String>,
): String {
    val srcInclude = source.includeStatement.let { if (it.isNotBlank()) "$it\n" else "" }
    val tgtInclude = target.includeStatement.let { if (it.isNotBlank()) "$it\n" else "" }
    val includes = (srcInclude + tgtInclude).trim().let { if (it.isNotBlank()) "$it\n" else "" }

    return if (useIntervalIntersect) {
        val partStr = if (partitionColumns.isNotEmpty())
            "(${partitionColumns.joinToString(", ")})" else "()"
        """${includes}SELECT *
FROM _interval_intersect!(
  (${source.name}, ${target.name}),
  $partStr
);"""
    } else {
        """${includes}SELECT
  a.*,
  b.*
FROM ${source.name} AS a
$joinType ${target.name} AS b
  ON a."$leftCol" = b."$rightCol";"""
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun TableListItem(
    table: StdlibTable,
    searchQuery: String,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null,
    showJoinOption: Boolean = false,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick,
            )
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        // Table name + importance badge
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = if (table.type == "view") Icons.Default.ViewColumn
                             else Icons.Default.TableChart,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.secondary,
            )
            Text(
                text = table.name,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontFamily = CodeFontFamily,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.secondary,
            )

            if (table.importance != null) {
                val (label, color) = when (table.importance) {
                    "high" -> "common" to MaterialTheme.colorScheme.primary
                    "mid" -> "mid" to MaterialTheme.colorScheme.onSurfaceVariant
                    else -> "deprecated" to MaterialTheme.colorScheme.error
                }
                Text(
                    text = label,
                    modifier = Modifier
                        .clip(MaterialTheme.shapes.extraSmall)
                        .background(color.copy(alpha = 0.15f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = color,
                    // use labelSmall default size
                )
            }
        }

        // Module name
        Text(
            text = table.moduleName,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )

        // Description
        if (table.summaryDesc.isNotBlank()) {
            Text(
                text = table.summaryDesc,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        // Column chips (show first 6)
        if (table.columns.isNotEmpty()) {
            FlowRow(
                modifier = Modifier
                    .padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                val colsToShow = table.columns.take(6)
                colsToShow.forEach { col ->
                    Text(
                        text = "${col.name}: ${col.type.lowercase().ifBlank { "?" }}",
                        modifier = Modifier
                            .clip(MaterialTheme.shapes.extraSmall)
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        // use labelSmall default size
                        maxLines = 1,
                    )
                }
                if (table.columns.size > 6) {
                    Text(
                        text = "+${table.columns.size - 6} more",
                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        // use labelSmall default size
                    )
                }
            }
        }
    }
}
