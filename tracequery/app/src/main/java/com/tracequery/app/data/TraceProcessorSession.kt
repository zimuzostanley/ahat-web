package com.tracequery.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.data.model.ColumnInfo

/**
 * A session wrapping a single loaded trace. Thread-safe via mutex.
 * Each session holds a TraceProcessor instance with a trace loaded
 * in memory. Multiple sessions can coexist (multi-tab support).
 */
class TraceProcessorSession private constructor(
    private val handle: Long,
    val traceFileName: String,
    val tracePath: String,
) {
    private val mutex = Mutex()
    private var destroyed = false

    companion object {
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
     * Execute a PerfettoSQL query via the native cursor API.
     * Zero-copy: reads row data from DirectByteBuffer backed by native memory.
     */
    suspend fun query(sql: String): QueryResult = mutex.withLock {
        check(!destroyed) { "Session is closed" }
        withContext(Dispatchers.IO) {
            val startMs = System.currentTimeMillis()
            var cursor = 0L
            try {
                cursor = TraceProcessorNative.nativeQueryStart(handle, sql)
                if (cursor == 0L) {
                    val elapsed = System.currentTimeMillis() - startMs
                    return@withContext QueryResult(
                        columns = emptyList(), rows = emptyList(),
                        executionTimeMs = elapsed,
                        error = "Failed to start query",
                        sql = sql,
                    )
                }

                val colCount = TraceProcessorNative.nativeQueryColumnCount(cursor)
                val columns = (0 until colCount).map { i ->
                    ColumnInfo(
                        name = TraceProcessorNative.nativeQueryColumnName(cursor, i),
                        index = i,
                    )
                }

                // Materialize rows by reading from the cursor
                val rows = mutableListOf<List<String>>()
                while (TraceProcessorNative.nativeQueryNext(cursor)) {
                    val buffer = TraceProcessorNative.nativeQueryGetRowBuffer(cursor)
                    if (buffer != null) {
                        val cells = decodeRowBuffer(buffer, colCount)
                        rows.add(cells.map { it.toString() })
                    }
                }

                // Check for errors
                val error = TraceProcessorNative.nativeQueryError(cursor)
                val elapsed = System.currentTimeMillis() - startMs

                QueryResult(
                    columns = columns,
                    rows = rows,
                    executionTimeMs = elapsed,
                    rowCount = rows.size.toLong(),
                    sql = sql,
                    error = error,
                )
            } catch (e: Exception) {
                val elapsed = System.currentTimeMillis() - startMs
                QueryResult(
                    columns = emptyList(), rows = emptyList(),
                    executionTimeMs = elapsed,
                    error = e.message ?: "Unknown error",
                    sql = sql,
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
