package com.tracequery.app.data

import com.tracequery.app.data.model.ColumnInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Scroll-driven query using an open native cursor.
 *
 * The cursor is opened once. Rows are read forward on demand as the user
 * scrolls, and cached in an ArrayList. Backward scroll is served from cache.
 * The producer reads ahead of the scroll position but pauses when far ahead.
 *
 * No LIMIT/OFFSET re-execution. No artificial limits. Query runs once.
 * Memory = rows the user has scrolled through (cached, not evicted —
 * forward-only cursor can't re-read evicted rows).
 */
class PagedQuery private constructor(
    val columns: List<ColumnInfo>,
    private var cursorHandle: Long,
    private val colCount: Int,
    val sql: String,
    val executionTimeMs: Long,
    val error: String? = null,
    val knownTotalRows: Long = -1, // -1 = unknown
) {
    companion object {
        /** Rows to read ahead of the visible scroll position. */
        const val READ_AHEAD = 2000

        /** Extract INCLUDE statements to top level, strip all trailing semicolons. */
        private fun splitIncludes(sql: String): Pair<String, String> {
            val clean = sql.trimEnd().trimEnd(';').trim()
            val includes = mutableListOf<String>()
            val queryLines = mutableListOf<String>()
            for (line in clean.lines()) {
                val t = line.trim()
                if (t.uppercase().startsWith("INCLUDE PERFETTO MODULE")) {
                    includes.add(t.removeSuffix(";"))
                } else if (t.isNotEmpty()) {
                    queryLines.add(line)
                }
            }
            val prefix = if (includes.isNotEmpty()) includes.joinToString(";\n") + ";\n" else ""
            return prefix to queryLines.joinToString("\n").trim().trimEnd(';').trim()
        }

        suspend fun create(session: TraceProcessorSession, sql: String): PagedQuery {
            return withContext(Dispatchers.IO) {
                val startMs = System.currentTimeMillis()
                val (includePrefix, selectSql) = splitIncludes(sql)

                // Get total row count first (wraps user query in subquery)
                var knownTotal = -1L
                try {
                    val countSql = "${includePrefix}SELECT COUNT(*) FROM ($selectSql);"
                    val countResult = session.query(countSql)
                    if (!countResult.isError && countResult.rows.isNotEmpty()) {
                        knownTotal = countResult.rows[0].firstOrNull()?.toLongOrNull() ?: -1L
                    }
                } catch (_: Exception) {}

                // Open the cursor for iteration
                val cursor = TraceProcessorNative.nativeQueryStart(session.handle, sql)

                if (cursor == 0L) {
                    return@withContext PagedQuery(
                        columns = emptyList(), cursorHandle = 0L, colCount = 0,
                        sql = sql, executionTimeMs = System.currentTimeMillis() - startMs,
                        error = "Failed to start query", knownTotalRows = 0,
                    )
                }

                val colCount = TraceProcessorNative.nativeQueryColumnCount(cursor)
                val columns = (0 until colCount).map { i ->
                    ColumnInfo(
                        name = TraceProcessorNative.nativeQueryColumnName(cursor, i),
                        index = i,
                    )
                }

                val elapsed = System.currentTimeMillis() - startMs

                val pq = PagedQuery(
                    columns = columns, cursorHandle = cursor, colCount = colCount,
                    sql = sql, executionTimeMs = elapsed,
                    knownTotalRows = knownTotal,
                )
                // Read first batch so UI has data immediately
                pq.readMore(READ_AHEAD)
                pq
            }
        }
    }

    /** All rows read so far. Grows as user scrolls forward. */
    private val rows = ArrayList<List<String>>(4096)

    /** Whether the cursor has been fully consumed. */
    @Volatile var isComplete = false
        private set

    /** Version counter — bumped on every read, triggers recomposition. */
    @Volatile var version = 0L
        private set

    val isError: Boolean get() = error != null
    val rowsRead: Int get() = rows.size

    /** Total rows — from COUNT(*) if available, else rows read so far. */
    val totalRows: Long get() = if (knownTotalRows >= 0) knownTotalRows else rows.size.toLong()

    /** Get row at index. Returns null if not yet read (need to readMore). */
    fun getRow(index: Int): List<String>? = rows.getOrNull(index)

    /**
     * Read up to [count] more rows from the cursor.
     * Call on Dispatchers.IO. Returns number of new rows read.
     */
    fun readMore(count: Int): Int {
        if (isComplete || cursorHandle == 0L) return 0
        var read = 0
        while (read < count) {
            if (!TraceProcessorNative.nativeQueryNext(cursorHandle)) {
                isComplete = true
                val err = TraceProcessorNative.nativeQueryError(cursorHandle)
                if (err != null) {
                    android.util.Log.e("PagedQuery", "Cursor error: $err")
                }
                break
            }
            val buffer = TraceProcessorNative.nativeQueryGetRowBuffer(cursorHandle)
            if (buffer != null) {
                rows.add(decodeRowBuffer(buffer, colCount).map { it.toString() })
                read++
            }
        }
        if (read > 0) version++
        return read
    }

    /** Ensure we have at least [targetIndex] + READ_AHEAD rows. */
    fun ensureReadTo(targetIndex: Int): Boolean {
        val needed = targetIndex + READ_AHEAD - rows.size
        if (needed <= 0) return false
        return readMore(needed) > 0
    }

    /** Close the cursor. Must be called to prevent leaks. */
    fun close() {
        if (cursorHandle != 0L) {
            TraceProcessorNative.nativeQueryClose(cursorHandle)
            cursorHandle = 0L
        }
        isComplete = true
    }
}
