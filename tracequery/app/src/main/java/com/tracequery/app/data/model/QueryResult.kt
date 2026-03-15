package com.tracequery.app.data.model

data class ColumnInfo(
    val name: String,
    val index: Int,
)

data class QueryResult(
    val columns: List<ColumnInfo>,
    val rows: List<List<String>>,
    val executionTimeMs: Long,
    val rowCount: Long = rows.size.toLong(),
    val sql: String = "",
    val error: String? = null,
    val truncated: Boolean = false,
    val maxRowsHit: Int = 0,
) {
    val isError: Boolean get() = error != null
    val isEmpty: Boolean get() = rows.isEmpty() && error == null
    val statusText: String get() = buildString {
        append("${rowCount} row${if (rowCount != 1L) "s" else ""}")
        if (truncated) append(" (showing first $maxRowsHit)")
        append(" \u2022 ${executionTimeMs}ms")
    }
}

data class HistoryEntry(
    val sql: String,
    val timestamp: Long,
    val traceFileName: String,
    val rowCount: Long,
    val executionTimeMs: Long,
    val error: String? = null,
)
