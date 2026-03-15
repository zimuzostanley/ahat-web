package com.tracequery.app.data

import android.content.Context
import com.tracequery.app.data.model.HistoryEntry
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persists query history in SharedPreferences as JSON.
 * Keeps the last 200 entries across all traces.
 */
class QueryHistory(context: Context) {
    private val prefs = context.getSharedPreferences("query_history", Context.MODE_PRIVATE)
    private val maxEntries = 200

    fun getAll(): List<HistoryEntry> {
        val json = prefs.getString("entries", null) ?: return emptyList()
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                HistoryEntry(
                    sql = obj.getString("sql"),
                    timestamp = obj.getLong("timestamp"),
                    traceFileName = obj.optString("trace", ""),
                    rowCount = obj.optLong("rows", 0),
                    executionTimeMs = obj.optLong("ms", 0),
                    error = obj.optString("error", null).takeIf { it != "null" && !it.isNullOrEmpty() },
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun add(entry: HistoryEntry) {
        val current = getAll().toMutableList()
        // Don't add duplicate of last query
        if (current.isNotEmpty() && current[0].sql == entry.sql &&
            current[0].traceFileName == entry.traceFileName) {
            current[0] = entry  // Update with latest stats
        } else {
            current.add(0, entry)
        }
        // Trim to max
        val trimmed = current.take(maxEntries)
        save(trimmed)
    }

    fun clear() {
        prefs.edit().remove("entries").apply()
    }

    private fun save(entries: List<HistoryEntry>) {
        val arr = JSONArray()
        for (e in entries) {
            val obj = JSONObject()
            obj.put("sql", e.sql)
            obj.put("timestamp", e.timestamp)
            obj.put("trace", e.traceFileName)
            obj.put("rows", e.rowCount)
            obj.put("ms", e.executionTimeMs)
            if (e.error != null) obj.put("error", e.error)
            arr.put(obj)
        }
        prefs.edit().putString("entries", arr.toString()).apply()
    }
}
