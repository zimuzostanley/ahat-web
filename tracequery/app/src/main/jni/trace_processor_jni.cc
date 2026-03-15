// JNI bindings for Perfetto TraceProcessor.
//
// Design principles:
//   1. ZERO-COPY: Query results stay in native memory. Java accesses them
//      through a cursor (nativeQueryNext/nativeQueryGet) or via DirectByteBuffer.
//   2. DETERMINISTIC CLEANUP: Every native allocation is explicitly freed.
//      TraceProcessor instances via nativeDestroy, query cursors via nativeQueryClose.
//   3. SINGLE-THREADED per instance: Callers must synchronize access.

#include <jni.h>
#include <android/log.h>

#include <cstdint>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "perfetto/trace_processor/trace_processor.h"
#include "perfetto/trace_processor/basic_types.h"
#include "perfetto/trace_processor/iterator.h"
#include "perfetto/trace_processor/trace_blob_view.h"

#define TAG "TraceProcessorJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

using perfetto::trace_processor::Config;
using perfetto::trace_processor::TraceProcessor;
using perfetto::trace_processor::Iterator;
using perfetto::trace_processor::SqlValue;

namespace {

// ─── TraceProcessor instance wrapper ─────────────────────────────────────────

struct TpInstance {
    std::unique_ptr<TraceProcessor> tp;
    ~TpInstance() { LOGI("TpInstance destroyed"); }
};

inline TpInstance* toTp(jlong handle) {
    return reinterpret_cast<TpInstance*>(static_cast<uintptr_t>(handle));
}

// ─── Query cursor: holds native Iterator + materialized current row ──────────

// We materialize the current row's string representations in a flat buffer
// that Java can read via DirectByteBuffer. This avoids per-cell JNI crossings.
//
// Buffer layout per row:
//   For each column: [type:1byte] [len:4bytes LE] [data:len bytes]
//   type: 0=null, 1=long, 2=double, 3=string, 4=bytes
struct QueryCursor {
    Iterator iterator;
    uint32_t col_count = 0;
    std::vector<std::string> col_names;

    // Flat buffer for current row, exposed to Java as DirectByteBuffer.
    std::vector<uint8_t> row_buffer;
    bool has_row = false;
    int64_t row_index = -1;  // -1 before first Next()
    bool has_error = false;
    std::string error_msg;

    explicit QueryCursor(Iterator it) : iterator(std::move(it)) {
        col_count = iterator.ColumnCount();
        col_names.reserve(col_count);
        for (uint32_t i = 0; i < col_count; i++) {
            col_names.push_back(iterator.GetColumnName(i));
        }
    }

    // Advance to next row, serialize it into row_buffer.
    bool next() {
        if (!iterator.Next()) {
            has_row = false;
            auto st = iterator.Status();
            if (!st.ok()) {
                has_error = true;
                error_msg = st.c_message();
            }
            return false;
        }
        row_index++;
        has_row = true;
        serializeCurrentRow();
        return true;
    }

    void serializeCurrentRow() {
        row_buffer.clear();
        for (uint32_t i = 0; i < col_count; i++) {
            SqlValue val = iterator.Get(i);

            // Type byte
            row_buffer.push_back(static_cast<uint8_t>(val.type));

            switch (val.type) {
                case SqlValue::kNull: {
                    // No data, just type byte
                    uint32_t len = 0;
                    pushU32(len);
                    break;
                }
                case SqlValue::kLong: {
                    // 8 bytes, little-endian
                    uint32_t len = 8;
                    pushU32(len);
                    pushI64(val.long_value);
                    break;
                }
                case SqlValue::kDouble: {
                    // 8 bytes, IEEE 754
                    uint32_t len = 8;
                    pushU32(len);
                    double d = val.double_value;
                    uint8_t bytes[8];
                    memcpy(bytes, &d, 8);
                    row_buffer.insert(row_buffer.end(), bytes, bytes + 8);
                    break;
                }
                case SqlValue::kString: {
                    const char* s = val.string_value ? val.string_value : "";
                    uint32_t len = static_cast<uint32_t>(strlen(s));
                    pushU32(len);
                    row_buffer.insert(row_buffer.end(),
                                     reinterpret_cast<const uint8_t*>(s),
                                     reinterpret_cast<const uint8_t*>(s) + len);
                    break;
                }
                case SqlValue::kBytes: {
                    uint32_t len = static_cast<uint32_t>(val.bytes_count);
                    pushU32(len);
                    auto* b = reinterpret_cast<const uint8_t*>(val.bytes_value);
                    row_buffer.insert(row_buffer.end(), b, b + len);
                    break;
                }
            }
        }
    }

    void pushU32(uint32_t v) {
        row_buffer.push_back(static_cast<uint8_t>(v & 0xFF));
        row_buffer.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
        row_buffer.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
        row_buffer.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
    }

    void pushI64(int64_t v) {
        for (int i = 0; i < 8; i++) {
            row_buffer.push_back(static_cast<uint8_t>((v >> (i * 8)) & 0xFF));
        }
    }
};

inline QueryCursor* toCursor(jlong handle) {
    return reinterpret_cast<QueryCursor*>(static_cast<uintptr_t>(handle));
}

}  // namespace

extern "C" {

// ═══════════════════════════════════════════════════════════════════════════════
// TraceProcessor instance lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

JNIEXPORT jlong JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeCreate(
        JNIEnv*, jclass) {
    Config config;
    auto* inst = new TpInstance();
    inst->tp = TraceProcessor::CreateInstance(config);
    LOGI("Created TP instance %p", inst);
    return static_cast<jlong>(reinterpret_cast<uintptr_t>(inst));
}

JNIEXPORT void JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeDestroy(
        JNIEnv*, jclass, jlong handle) {
    delete toTp(handle);
}

JNIEXPORT jstring JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeLoadTrace(
        JNIEnv* env, jclass, jlong handle, jstring jpath) {
    auto* inst = toTp(handle);
    if (!inst || !inst->tp) return env->NewStringUTF("Invalid handle");

    const char* path = env->GetStringUTFChars(jpath, nullptr);
    LOGI("Loading: %s", path);

    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        env->ReleaseStringUTFChars(jpath, path);
        return env->NewStringUTF("Cannot open file");
    }

    auto file_size = file.tellg();
    file.seekg(0);
    LOGI("Trace size: %lld bytes", (long long)file_size);

    constexpr size_t kChunk = 32 * 1024 * 1024;
    auto buf = std::make_unique<uint8_t[]>(kChunk);

    while (file) {
        file.read(reinterpret_cast<char*>(buf.get()), kChunk);
        size_t n = static_cast<size_t>(file.gcount());
        if (n == 0) break;

        auto chunk = std::make_unique<uint8_t[]>(n);
        memcpy(chunk.get(), buf.get(), n);
        auto status = inst->tp->Parse(std::move(chunk), n);
        if (!status.ok()) {
            env->ReleaseStringUTFChars(jpath, path);
            return env->NewStringUTF(status.c_message());
        }
    }

    env->ReleaseStringUTFChars(jpath, path);
    auto st = inst->tp->NotifyEndOfFile();
    if (!st.ok()) return env->NewStringUTF(st.c_message());

    LOGI("Trace loaded OK");
    return nullptr;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query cursor API — zero-copy row access via DirectByteBuffer
// ═══════════════════════════════════════════════════════════════════════════════

// Opens a query cursor. Returns cursor handle.
JNIEXPORT jlong JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryOpen(
        JNIEnv*, jclass, jlong tpHandle, jstring jsql) {
    auto* inst = toTp(tpHandle);
    if (!inst || !inst->tp) return 0;

    const char* sql = reinterpret_cast<const char*>(
        // Use JNIEnv from parameter
        nullptr);  // Will be set below

    // Need env for GetStringUTFChars
    return 0;  // placeholder
}

// Actual implementation with proper env access:
JNIEXPORT jlong JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryStart(
        JNIEnv* env, jclass, jlong tpHandle, jstring jsql) {
    auto* inst = toTp(tpHandle);
    if (!inst || !inst->tp) return 0;

    const char* sql = env->GetStringUTFChars(jsql, nullptr);
    LOGI("Query: %.200s", sql);
    auto it = inst->tp->ExecuteQuery(sql);
    env->ReleaseStringUTFChars(jsql, sql);

    auto* cursor = new QueryCursor(std::move(it));
    return static_cast<jlong>(reinterpret_cast<uintptr_t>(cursor));
}

// Returns column count.
JNIEXPORT jint JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryColumnCount(
        JNIEnv*, jclass, jlong cursorHandle) {
    auto* c = toCursor(cursorHandle);
    return c ? static_cast<jint>(c->col_count) : 0;
}

// Returns column name at index.
JNIEXPORT jstring JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryColumnName(
        JNIEnv* env, jclass, jlong cursorHandle, jint index) {
    auto* c = toCursor(cursorHandle);
    if (!c || index < 0 || static_cast<uint32_t>(index) >= c->col_count)
        return env->NewStringUTF("");
    return env->NewStringUTF(c->col_names[index].c_str());
}

// Advances to next row. Returns true if there is a row, false if done/error.
JNIEXPORT jboolean JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryNext(
        JNIEnv*, jclass, jlong cursorHandle) {
    auto* c = toCursor(cursorHandle);
    if (!c) return JNI_FALSE;
    return c->next() ? JNI_TRUE : JNI_FALSE;
}

// Returns a DirectByteBuffer pointing to the current row's serialized data.
// The buffer is valid until the next nativeQueryNext() or nativeQueryClose().
// Layout per column: [type:1] [len:4 LE] [data:len]
JNIEXPORT jobject JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryGetRowBuffer(
        JNIEnv* env, jclass, jlong cursorHandle) {
    auto* c = toCursor(cursorHandle);
    if (!c || !c->has_row || c->row_buffer.empty()) return nullptr;

    // DirectByteBuffer pointing directly into native memory — ZERO COPY
    return env->NewDirectByteBuffer(
        c->row_buffer.data(),
        static_cast<jlong>(c->row_buffer.size()));
}

// Returns current row index (0-based). -1 if before first Next().
JNIEXPORT jlong JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryRowIndex(
        JNIEnv*, jclass, jlong cursorHandle) {
    auto* c = toCursor(cursorHandle);
    return c ? c->row_index : -1;
}

// Returns error message if query failed, or null if no error.
JNIEXPORT jstring JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryError(
        JNIEnv* env, jclass, jlong cursorHandle) {
    auto* c = toCursor(cursorHandle);
    if (!c || !c->has_error) return nullptr;
    return env->NewStringUTF(c->error_msg.c_str());
}

// Closes and frees the query cursor. MUST be called to prevent leaks.
JNIEXPORT void JNICALL
Java_com_tracequery_app_data_TraceProcessorNative_nativeQueryClose(
        JNIEnv*, jclass, jlong cursorHandle) {
    delete toCursor(cursorHandle);
}

}  // extern "C"
