package com.tracequery.app.data.model

/** Metadata about a result column. */
data class ColumnInfo(
    val name: String,
    val index: Int,
)

/** Represents the result of a SQL query — rows held in memory. */
data class QueryResult(
    val columns: List<ColumnInfo>,
    val rows: List<List<String>>,
    val executionTimeMs: Long,
    val rowCount: Long = rows.size.toLong(),
    val sql: String = "",
    val error: String? = null,
) {
    val isError: Boolean get() = error != null
    val isEmpty: Boolean get() = rows.isEmpty() && error == null
}

/** Entry in the query history. */
data class HistoryEntry(
    val sql: String,
    val timestamp: Long,
    val traceFileName: String,
    val rowCount: Long,
    val executionTimeMs: Long,
    val error: String? = null,
)
