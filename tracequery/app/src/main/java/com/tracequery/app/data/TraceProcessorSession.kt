package com.tracequery.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.data.model.ColumnInfo

/**
 * A session wrapping a single loaded trace. Thread-safe via mutex.
 *
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
        /**
         * Opens a trace file and creates a new session.
         * This is a potentially long operation (seconds for large traces).
         */
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
     * Execute a PerfettoSQL query and return the result.
     */
    suspend fun query(sql: String): QueryResult = mutex.withLock {
        check(!destroyed) { "Session is closed" }
        withContext(Dispatchers.IO) {
            val startMs = System.currentTimeMillis()
            try {
                val raw = TraceProcessorNative.nativeQuery(handle, sql)
                val elapsed = System.currentTimeMillis() - startMs

                if (raw.isEmpty()) {
                    return@withContext QueryResult(
                        columns = emptyList(),
                        rows = emptyList(),
                        executionTimeMs = elapsed,
                    )
                }

                val columnNames = raw[0].toList()
                val dataRows = (1 until raw.size).map { i ->
                    raw[i].toList()
                }

                QueryResult(
                    columns = columnNames.mapIndexed { idx, name ->
                        ColumnInfo(name = name, index = idx)
                    },
                    rows = dataRows,
                    executionTimeMs = elapsed,
                    rowCount = dataRows.size.toLong(),
                    sql = sql,
                )
            } catch (e: Exception) {
                val elapsed = System.currentTimeMillis() - startMs
                QueryResult(
                    columns = emptyList(),
                    rows = emptyList(),
                    executionTimeMs = elapsed,
                    error = e.message ?: "Unknown error",
                    sql = sql,
                )
            }
        }
    }

    /**
     * Close this session, releasing the native TraceProcessor instance.
     */
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
