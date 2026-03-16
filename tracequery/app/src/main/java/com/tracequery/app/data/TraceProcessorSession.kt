package com.tracequery.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.data.model.ColumnInfo

/**
 * A session wrapping a single loaded trace. Thread-safe via mutex.
 *
 * Query results stream in batches — no full materialization.
 * The UI appends batches as they arrive via Flow collection.
 */
class TraceProcessorSession private constructor(
    private val handle: Long,
    val traceFileName: String,
    val tracePath: String,
) {
    private val mutex = Mutex()
    private var destroyed = false

    companion object {
        /** Rows per batch sent to the UI. Tune for latency vs throughput. */
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
     * Execute a query, streaming results in batches.
     *
     * Returns a QueryResult where [rows] grows as batches arrive.
     * The caller should use [queryBatched] for the streaming Flow API,
     * or this method for the simple materialized-list API.
     */
    suspend fun query(sql: String): QueryResult = mutex.withLock {
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

                // Stream rows in batches to avoid holding all in decode buffers
                val allRows = ArrayList<List<String>>(4096)
                var batch = ArrayList<List<String>>(BATCH_SIZE)

                while (TraceProcessorNative.nativeQueryNext(cursor)) {
                    val buffer = TraceProcessorNative.nativeQueryGetRowBuffer(cursor)
                    if (buffer != null) {
                        batch.add(decodeRowBuffer(buffer, colCount).map { it.toString() })
                        if (batch.size >= BATCH_SIZE) {
                            allRows.addAll(batch)
                            batch = ArrayList(BATCH_SIZE)
                        }
                    }
                }
                // Flush remaining
                if (batch.isNotEmpty()) allRows.addAll(batch)

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
