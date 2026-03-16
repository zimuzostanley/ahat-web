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
                )
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TableListItem(
    table: StdlibTable,
    searchQuery: String,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
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
