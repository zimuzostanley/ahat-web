package com.tracequery.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.data.model.ColumnInfo
import kotlin.coroutines.coroutineContext

/**
 * A session wrapping a single loaded trace. Thread-safe via mutex.
 *
 * Query results stream in batches — the onProgress callback is invoked
 * every [BATCH_SIZE] rows with the current result (shared ArrayList,
 * no copies). LazyColumn picks up the growing list automatically.
 */
class TraceProcessorSession private constructor(
    private val handle: Long,
    val traceFileName: String,
    val tracePath: String,
) {
    private val mutex = Mutex()
    private var destroyed = false

    companion object {
        /** Rows between progress callbacks. */
        const val BATCH_SIZE = 2000

        suspend fun open(tracePath: String, fileName: String): TraceProcessorSession =
            withContext(Dispatchers.IO) {
                val handle = TraceProcessorNative.nativeCreate()
                val error = TraceProcessorNative.nativeLoadTrace(handle, tracePath)
                if (error != null) {
                    TraceProcessorNative.nativeDestroy(handle)
                    throw IllegalStateException("Failed to load trace: $error")
                }
                TraceProcessorSession(handle, fileName, tracePath)
            }
    }

    /**
     * Execute a query, streaming results via [onProgress] every [BATCH_SIZE] rows.
     *
     * The [onProgress] callback receives a QueryResult whose [rows] is a shared
     * ArrayList that grows in place — no copies between batches. The callback
     * should update UI state to trigger recomposition.
     *
     * The mutex is held for the entire duration. Only one query at a time.
     *
     * @return Final QueryResult with all rows.
     */
    suspend fun query(
        sql: String,
        onProgress: (suspend (QueryResult) -> Unit)? = null,
    ): QueryResult = mutex.withLock {
        check(!destroyed) { "Session is closed" }
        withContext(Dispatchers.IO) {
            val startMs = System.currentTimeMillis()
            var cursor = 0L
            try {
                cursor = TraceProcessorNative.nativeQueryStart(handle, sql)
                if (cursor == 0L) {
                    return@withContext QueryResult(
                        columns = emptyList(), rows = emptyList(),
                        executionTimeMs = System.currentTimeMillis() - startMs,
                        error = "Failed to start query", sql = sql,
                    )
                }

                val colCount = TraceProcessorNative.nativeQueryColumnCount(cursor)
                val columns = (0 until colCount).map { i ->
                    ColumnInfo(
                        name = TraceProcessorNative.nativeQueryColumnName(cursor, i),
                        index = i,
                    )
                }

                // Single ArrayList grows in place — shared across progress callbacks
                val allRows = ArrayList<List<String>>(4096)

                while (TraceProcessorNative.nativeQueryNext(cursor)) {
                    // Check for cancellation (e.g., user runs a new query)
                    coroutineContext.ensureActive()

                    val buffer = TraceProcessorNative.nativeQueryGetRowBuffer(cursor)
                    if (buffer != null) {
                        allRows.add(decodeRowBuffer(buffer, colCount).map { it.toString() })
                    }

                    // Emit progress every BATCH_SIZE rows
                    if (onProgress != null && allRows.size % BATCH_SIZE == 0) {
                        val elapsed = System.currentTimeMillis() - startMs
                        // Snapshot copy — safe to read on Main thread while we
                        // continue appending on IO thread
                        val snapshot = ArrayList(allRows)
                        onProgress(QueryResult(
                            columns = columns,
                            rows = snapshot,
                            executionTimeMs = elapsed,
                            rowCount = snapshot.size.toLong(),
                            sql = sql,
                        ))
                    }
                }

                val error = TraceProcessorNative.nativeQueryError(cursor)
                val elapsed = System.currentTimeMillis() - startMs

                QueryResult(
                    columns = columns,
                    rows = allRows,
                    executionTimeMs = elapsed,
                    rowCount = allRows.size.toLong(),
                    sql = sql,
                    error = error,
                )
            } catch (e: Exception) {
                QueryResult(
                    columns = emptyList(), rows = emptyList(),
                    executionTimeMs = System.currentTimeMillis() - startMs,
                    error = e.message ?: "Unknown error", sql = sql,
                )
            } finally {
                if (cursor != 0L) {
                    TraceProcessorNative.nativeQueryClose(cursor)
                }
            }
        }
    }

    suspend fun close() = mutex.withLock {
        if (!destroyed) {
            destroyed = true
            withContext(Dispatchers.IO) {
                TraceProcessorNative.nativeDestroy(handle)
            }
        }
    }

    val isOpen: Boolean get() = !destroyed
}
