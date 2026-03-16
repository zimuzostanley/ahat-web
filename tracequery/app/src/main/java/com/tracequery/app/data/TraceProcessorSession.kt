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
 */
class TraceProcessorSession private constructor(
    internal val handle: Long,
    val traceFileName: String,
    val tracePath: String,
) {
    private val mutex = Mutex()
    private var destroyed = false

    companion object {
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

                val allRows = ArrayList<List<String>>(4096)
                while (TraceProcessorNative.nativeQueryNext(cursor)) {
                    coroutineContext.ensureActive()
                    val buffer = TraceProcessorNative.nativeQueryGetRowBuffer(cursor)
                    if (buffer != null) {
                        allRows.add(decodeRowBuffer(buffer, colCount).map { it.toString() })
                    }
                    if (onProgress != null && allRows.size % BATCH_SIZE == 0) {
                        val snap = ArrayList(allRows)
                        onProgress(QueryResult(
                            columns = columns, rows = snap,
                            executionTimeMs = System.currentTimeMillis() - startMs,
                            rowCount = snap.size.toLong(), sql = sql,
                        ))
                    }
                }

                val error = TraceProcessorNative.nativeQueryError(cursor)
                QueryResult(
                    columns = columns, rows = allRows,
                    executionTimeMs = System.currentTimeMillis() - startMs,
                    rowCount = allRows.size.toLong(), sql = sql, error = error,
                )
            } catch (e: Exception) {
                QueryResult(
                    columns = emptyList(), rows = emptyList(),
                    executionTimeMs = System.currentTimeMillis() - startMs,
                    error = e.message ?: "Unknown error", sql = sql,
                )
            } finally {
                if (cursor != 0L) TraceProcessorNative.nativeQueryClose(cursor)
            }
        }
    }

    suspend fun close() = mutex.withLock {
        if (!destroyed) {
            destroyed = true
            withContext(Dispatchers.IO) { TraceProcessorNative.nativeDestroy(handle) }
        }
    }

    val isOpen: Boolean get() = !destroyed
}
