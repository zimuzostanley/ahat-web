package com.tracequery.app.data

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * JNI bindings to Perfetto trace_processor.
 *
 * Two-level API:
 *   1. Instance: create → loadTrace → [query...] → destroy
 *   2. Cursor:   queryStart → [next → getRowBuffer]... → queryClose
 *
 * The cursor API is zero-copy: row data lives in native memory and is
 * accessed through DirectByteBuffer. The buffer is valid until the next
 * next() or close() call.
 *
 * Memory contract:
 *   - Every nativeCreate() MUST be paired with nativeDestroy()
 *   - Every nativeQueryStart() MUST be paired with nativeQueryClose()
 *   - Failing to close leaks native memory
 */
object TraceProcessorNative {

    init {
        System.loadLibrary("trace_processor_jni")
    }

    // ── Instance lifecycle ────────────────────────────────────────────────

    /** Creates a TraceProcessor instance. Returns native handle. */
    @JvmStatic external fun nativeCreate(): Long

    /** Destroys the instance. Handle is invalid after this call. */
    @JvmStatic external fun nativeDestroy(handle: Long)

    /** Loads a trace file. Returns null on success, error message on failure. */
    @JvmStatic external fun nativeLoadTrace(handle: Long, path: String): String?

    // ── Cursor-based query API ────────────────────────────────────────────

    /** Opens a query cursor. Returns cursor handle (0 on error). */
    @JvmStatic external fun nativeQueryStart(tpHandle: Long, sql: String): Long

    /** Number of columns in the result. */
    @JvmStatic external fun nativeQueryColumnCount(cursorHandle: Long): Int

    /** Column name at index. */
    @JvmStatic external fun nativeQueryColumnName(cursorHandle: Long, index: Int): String

    /** Advance to next row. Returns true if row available. */
    @JvmStatic external fun nativeQueryNext(cursorHandle: Long): Boolean

    /**
     * Returns a DirectByteBuffer pointing to the current row's data.
     * Buffer layout per column: [type:1 byte] [len:4 bytes LE] [data:len bytes]
     *
     * Types: 0=NULL, 1=LONG(8 bytes LE), 2=DOUBLE(8 bytes IEEE754), 3=STRING, 4=BYTES
     *
     * The buffer is backed by native memory and is valid only until the next
     * nativeQueryNext() or nativeQueryClose() call. Do NOT hold references.
     */
    @JvmStatic external fun nativeQueryGetRowBuffer(cursorHandle: Long): ByteBuffer?

    /** Current row index (0-based). -1 before first next(). */
    @JvmStatic external fun nativeQueryRowIndex(cursorHandle: Long): Long

    /** Error message if query failed, null otherwise. */
    @JvmStatic external fun nativeQueryError(cursorHandle: Long): String?

    /** Closes the cursor and frees native memory. MUST be called. */
    @JvmStatic external fun nativeQueryClose(cursorHandle: Long)
}

// ── Row buffer decoder ────────────────────────────────────────────────────

/** Column value types matching SqlValue::Type in C++. */
enum class SqlType(val code: Int) {
    NULL(0), LONG(1), DOUBLE(2), STRING(3), BYTES(4);

    companion object {
        fun fromCode(code: Int) = entries.firstOrNull { it.code == code } ?: NULL
    }
}

/** Decoded cell value from the native row buffer. */
sealed class CellValue {
    data object Null : CellValue() { override fun toString() = "NULL" }
    data class LongVal(val value: Long) : CellValue() { override fun toString() = value.toString() }
    data class DoubleVal(val value: Double) : CellValue() {
        override fun toString() = if (value == value.toLong().toDouble()) {
            value.toLong().toString()  // avoid trailing .0
        } else "%.6g".format(value)
    }
    data class StringVal(val value: String) : CellValue() { override fun toString() = value }
    data class BytesVal(val size: Int) : CellValue() { override fun toString() = "<bytes:$size>" }
}

/**
 * Decodes a DirectByteBuffer row into a list of CellValues.
 * The buffer MUST have been obtained from nativeQueryGetRowBuffer.
 */
fun decodeRowBuffer(buffer: ByteBuffer, columnCount: Int): List<CellValue> {
    buffer.order(ByteOrder.LITTLE_ENDIAN)
    buffer.position(0)

    val cells = ArrayList<CellValue>(columnCount)
    for (i in 0 until columnCount) {
        if (buffer.remaining() < 1) {
            cells.add(CellValue.Null)
            continue
        }

        val type = SqlType.fromCode(buffer.get().toInt() and 0xFF)
        val len = if (buffer.remaining() >= 4) buffer.int else 0

        when (type) {
            SqlType.NULL -> cells.add(CellValue.Null)
            SqlType.LONG -> {
                if (buffer.remaining() >= 8) cells.add(CellValue.LongVal(buffer.long))
                else cells.add(CellValue.Null)
            }
            SqlType.DOUBLE -> {
                if (buffer.remaining() >= 8) cells.add(CellValue.DoubleVal(buffer.double))
                else cells.add(CellValue.Null)
            }
            SqlType.STRING -> {
                if (len > 0 && buffer.remaining() >= len) {
                    val bytes = ByteArray(len)
                    buffer.get(bytes)
                    cells.add(CellValue.StringVal(String(bytes, Charsets.UTF_8)))
                } else {
                    cells.add(CellValue.StringVal(""))
                }
            }
            SqlType.BYTES -> {
                if (len > 0 && buffer.remaining() >= len) {
                    buffer.position(buffer.position() + len)  // skip bytes data
                }
                cells.add(CellValue.BytesVal(len))
            }
        }
    }
    return cells
}
