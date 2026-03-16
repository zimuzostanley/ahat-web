package com.tracequery.app.ui

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tracequery.app.data.PagedQuery
import com.tracequery.app.data.QueryHistory
import com.tracequery.app.data.SqlFormatter
import com.tracequery.app.data.TraceProcessorSession
import com.tracequery.app.data.model.HistoryEntry
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.data.model.StdlibDocs
import com.tracequery.app.data.model.StdlibTable
import com.tracequery.app.ui.theme.ThemeMode
import com.tracequery.app.ui.theme.ThemePrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

// ── Tab state ────────────────────────────────────────────────────────────────

/**
 * A single operation in the query pipeline.
 * Operations stack sequentially: base → op1 → op2 → op3...
 * Each wraps the previous SQL in a subquery.
 */
sealed class QueryOp {
    abstract val chipLabel: String

    data class Filter(
        val column: String,
        val op: String,
        val value: String?,
    ) : QueryOp() {
        override val chipLabel: String get() = when (op) {
            "IS NULL" -> "$column IS NULL"
            "IS NOT NULL" -> "$column IS NOT NULL"
            "LIKE" -> "$column contains ${value?.removeSurrounding("'")?.removeSurrounding("%")}"
            "NOT LIKE" -> "$column !contains ${value?.removeSurrounding("'")?.removeSurrounding("%")}"
            else -> "$column $op ${value ?: ""}"
        }

        fun toWhereClause(): String {
            return when (op) {
                "IS NULL" -> "$column IS NULL"
                "IS NOT NULL" -> "$column IS NOT NULL"
                else -> "$column $op $value"
            }
        }

        fun wrapSql(innerSql: String): String =
            "SELECT *\nFROM ($innerSql)\nWHERE ${toWhereClause()}"
    }

    data class Aggregate(
        val function: String,
        val metricColumn: String,
        val groupByColumns: List<String>,
    ) : QueryOp() {
        override val chipLabel: String get() {
            val fn = when (function) {
                "COUNT" -> "COUNT(*)"
                "COUNT_DISTINCT" -> "COUNT(DISTINCT $metricColumn)"
                else -> "$function($metricColumn)"
            }
            val by = groupByColumns.joinToString(", ")
            return "$fn by $by"
        }

        fun wrapSql(innerSql: String): String {
            fun q(c: String) = c
            val groupCols = groupByColumns.joinToString(", ") { q(it) }
            val fn = function.uppercase()
            val metricExpr = when (fn) {
                "COUNT" -> "COUNT(*) as count"
                "COUNT_DISTINCT" -> "COUNT(DISTINCT ${q(metricColumn)}) as count"
                else -> "$fn(${q(metricColumn)}) as ${fn.lowercase()}"
            }
            val orderCol = when (fn) {
                "COUNT", "COUNT_DISTINCT" -> "count"
                else -> fn.lowercase()
            }
            return "SELECT $groupCols, $metricExpr\nFROM ($innerSql)\nGROUP BY $groupCols\nORDER BY $orderCol DESC"
        }
    }
}

data class TabState(
    val id: Int,
    val fileName: String,
    val session: TraceProcessorSession? = null,
    val currentSql: String = "SELECT * FROM slice;",
    val baseSql: String = "",
    val ops: List<QueryOp> = emptyList(),
    val sortColumns: List<Pair<String, Boolean>> = emptyList(),
    val result: QueryResult? = null,
    val pagedQuery: PagedQuery? = null,
    val isQuerying: Boolean = false,
    val isLoading: Boolean = false,
    val loadProgress: String = "",
    val history: List<HistoryEntry> = emptyList(),
    val mode: QueryMode = QueryMode.SQL,
    val error: String? = null,
) {
    /**
     * Compose SQL by applying all ops sequentially.
     * INCLUDE statements are extracted to the top.
     */
    fun composedSql(): String {
        if (ops.isEmpty() && sortColumns.isEmpty()) return currentSql
        val raw = baseSql.ifBlank { currentSql }.trimEnd().removeSuffix(";").trim()

        // Extract INCLUDE statements (must be top-level)
        val includes = mutableListOf<String>()
        val selectLines = mutableListOf<String>()
        for (line in raw.lines()) {
            val t = line.trim()
            if (t.uppercase().startsWith("INCLUDE PERFETTO MODULE")) {
                includes.add(t.removeSuffix(";"))
            } else if (t.isNotEmpty()) {
                selectLines.add(line)
            }
        }

        // Strip trailing LIMIT/OFFSET from base — don't want it constraining
        // the subquery when filters/aggregations are applied on top
        var basePart = selectLines.joinToString("\n").trim().removeSuffix(";")
        basePart = basePart.replace(
            Regex("\\s+LIMIT\\s+\\d+(?:\\s+OFFSET\\s+\\d+)?\\s*$", RegexOption.IGNORE_CASE), ""
        ).trim()

        // Apply ops sequentially — each wraps the previous
        var sql = basePart
        for (op in ops) {
            sql = when (op) {
                is QueryOp.Filter -> op.wrapSql(sql)
                is QueryOp.Aggregate -> op.wrapSql(sql)
            }
        }

        // Append ORDER BY (sort is not a pipeline op, just appended)
        if (sortColumns.isNotEmpty()) {
            val orderBy = sortColumns.joinToString(", ") { (col, asc) ->
                "$col ${if (asc) "ASC" else "DESC"}"
            }
            sql = "SELECT *\nFROM ($sql)\nORDER BY $orderBy"
        }

        val prefix = if (includes.isNotEmpty()) includes.joinToString(";\n") + ";\n" else ""
        return "$prefix$sql;"
    }
}

enum class QueryMode { SQL, EXPLORE }

// ── Main UI state ────────────────────────────────────────────────────────────

enum class Screen { QUERY, SETTINGS }

data class MainUiState(
    val tabs: List<TabState> = emptyList(),
    val activeTabId: Int = -1,
    val stdlibDocs: StdlibDocs? = null,
    val isLoadingStdlib: Boolean = true,
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val screen: Screen = Screen.QUERY,
) {
    val activeTab: TabState? get() = tabs.find { it.id == activeTabId }
    val hasTraces: Boolean get() = tabs.isNotEmpty()
}

// ── ViewModel ────────────────────────────────────────────────────────────────

class MainViewModel(
    private val appContext: Context,
) : ViewModel() {

    private val _state = MutableStateFlow(MainUiState())
    val state: StateFlow<MainUiState> = _state.asStateFlow()

    private val queryHistory = QueryHistory(appContext)
    private var nextTabId = 0

    init {
        _state.update { it.copy(themeMode = ThemePrefs.load(appContext)) }
        // Load stdlib docs in background
        viewModelScope.launch {
            try {
                val docs = StdlibDocs.loadFromAssets(appContext)
                _state.update { it.copy(stdlibDocs = docs, isLoadingStdlib = false) }
            } catch (e: Exception) {
                _state.update { it.copy(isLoadingStdlib = false) }
            }
        }
    }

    // ── Trace loading ────────────────────────────────────────────────────

    fun openTrace(uri: Uri, fileName: String) {
        val tabId = nextTabId++
        _state.update { s ->
            s.copy(
                tabs = s.tabs + TabState(id = tabId, fileName = fileName, isLoading = true),
                activeTabId = tabId,
            )
        }

        viewModelScope.launch {
            try {
                // Copy URI to cache (TP needs a file path)
                val cacheFile = File(appContext.cacheDir, "trace_$tabId")
                updateTab(tabId) { it.copy(loadProgress = "Copying trace...") }

                // Copy with progress
                val inputStream = appContext.contentResolver.openInputStream(uri)
                    ?: throw Exception("Cannot open file")
                val fileSize = try {
                    appContext.contentResolver.query(uri, null, null, null, null)?.use { c ->
                        val idx = c.getColumnIndex(android.provider.OpenableColumns.SIZE)
                        if (c.moveToFirst() && idx >= 0) c.getLong(idx) else -1L
                    } ?: -1L
                } catch (_: Exception) { -1L }

                inputStream.use { input ->
                    cacheFile.outputStream().use { output ->
                        val buf = ByteArray(4 * 1024 * 1024)
                        var copied = 0L
                        var read: Int
                        while (input.read(buf).also { read = it } > 0) {
                            output.write(buf, 0, read)
                            copied += read
                            if (fileSize > 0) {
                                val pct = (copied * 100 / fileSize).toInt()
                                val mb = copied / (1024 * 1024)
                                withContext(Dispatchers.Main) {
                                    updateTab(tabId) { it.copy(loadProgress = "Copying: ${mb}MB ($pct%)") }
                                }
                            }
                        }
                    }
                }

                updateTab(tabId) { it.copy(loadProgress = "Parsing trace...") }

                val session = TraceProcessorSession.open(
                    tracePath = cacheFile.absolutePath,
                    fileName = fileName,
                )

                val history = queryHistory.getAll().filter { h ->
                    h.traceFileName == fileName
                }.take(50)

                updateTab(tabId) {
                    it.copy(
                        session = session,
                        isLoading = false,
                        loadProgress = "",
                        history = history,
                    )
                }
            } catch (e: Exception) {
                updateTab(tabId) {
                    it.copy(
                        isLoading = false,
                        error = "Failed to load: ${e.message}",
                    )
                }
            }
        }
    }

    // ── Query execution ──────────────────────────────────────────────────

    fun executeQuery(sql: String) {
        val tab = _state.value.activeTab ?: return
        val session = tab.session ?: return
        if (tab.isQuerying) return

        // Close old cursor before starting new query
        tab.pagedQuery?.close()
        updateActiveTab { it.copy(currentSql = sql, isQuerying = true, error = null, result = null, pagedQuery = null) }

        viewModelScope.launch {
            val paged = PagedQuery.create(session, sql)

            val entry = HistoryEntry(
                sql = sql,
                timestamp = System.currentTimeMillis(),
                traceFileName = tab.fileName,
                rowCount = paged.totalRows,
                executionTimeMs = paged.executionTimeMs,
                error = paged.error,
            )
            queryHistory.add(entry)

            updateActiveTab {
                it.copy(
                    pagedQuery = paged,
                    result = null, // use pagedQuery instead
                    isQuerying = false,
                    error = paged.error,
                    history = queryHistory.getAll().filter { h ->
                        h.traceFileName == tab.fileName
                    }.take(50),
                )
            }
        }
    }

    /** Read ahead to ensure rows are available for the visible range. */
    fun ensureRowsForScroll(lastVisible: Int) {
        val paged = _state.value.activeTab?.pagedQuery ?: return
        if (paged.isComplete) return
        if (lastVisible < paged.rowsRead - PagedQuery.READ_AHEAD) return // already ahead

        viewModelScope.launch(Dispatchers.IO) {
            val didRead = paged.ensureReadTo(lastVisible)
            if (didRead) {
                withContext(Dispatchers.Main) {
                    updateActiveTab { it.copy(pagedQuery = paged) }
                }
            }
        }
    }

    fun setSql(sql: String) {
        updateActiveTab { it.copy(currentSql = sql) }
    }

    // ── Table browser ────────────────────────────────────────────────────

    fun selectTable(table: StdlibTable) {
        val sql = if (table.isTableFunction) {
            table.selectQueryWithArgs()
        } else {
            table.selectQuery()
        }
        updateActiveTab { it.copy(currentSql = sql, mode = QueryMode.SQL) }
        executeQuery(sql)
    }

    fun setMode(mode: QueryMode) {
        updateActiveTab { it.copy(mode = mode) }
    }

    // ── Pipeline operations (filter + aggregate, sequential) ───────

    // ── Sort (not a pipeline op — separate ORDER BY) ───────────────

    fun sortBy(column: String, ascending: Boolean) {
        val tab = _state.value.activeTab ?: return
        // Replace sort — clicking a column sorts by that column only
        val newSort = listOf(column to ascending)
        // Save original SQL before sort was applied (so we don't nest ORDER BYs)
        val base = if (tab.sortColumns.isEmpty()) tab.currentSql else tab.baseSql.ifBlank { tab.currentSql }
        updateActiveTab { it.copy(sortColumns = newSort, baseSql = base) }
        val newTab = tab.copy(sortColumns = newSort, baseSql = base)
        val composed = SqlFormatter.format(newTab.composedSql())
        // Execute but restore baseSql so currentSql doesn't accumulate ORDER BYs
        updateActiveTab { it.copy(currentSql = composed, baseSql = base) }
        executeQuery(composed)
    }

    fun clearSort() {
        updateActiveTab { it.copy(sortColumns = emptyList()) }
        val tab = _state.value.activeTab ?: return
        val composed = tab.copy(sortColumns = emptyList()).composedSql()
        executeQuery(composed)
    }

    /** Add any operation to the pipeline and execute. */
    fun pushOp(op: QueryOp) {
        val tab = _state.value.activeTab ?: return
        val base = if (tab.ops.isEmpty()) tab.currentSql else tab.baseSql
        val newOps = tab.ops + op
        val newTab = tab.copy(ops = newOps, baseSql = base)
        val sql = SqlFormatter.format(newTab.composedSql())
        updateActiveTab { it.copy(ops = newOps, baseSql = base, currentSql = sql) }
        executeQuery(sql)
    }

    fun addFilter(filter: QueryOp.Filter) {
        pushOp(filter)
    }

    fun addAggregate(function: String, metricColumn: String, groupByColumns: List<String>) {
        pushOp(QueryOp.Aggregate(function, metricColumn, groupByColumns))
    }

    /** Remove the op at [index] and everything after it, then re-execute. */
    fun removeOp(index: Int) {
        val tab = _state.value.activeTab ?: return
        val newOps = tab.ops.take(index)
        if (newOps.isEmpty()) {
            val base = tab.baseSql.ifBlank { tab.currentSql }
            updateActiveTab { it.copy(ops = emptyList(), currentSql = base, baseSql = "") }
            executeQuery(base)
        } else {
            val newTab = tab.copy(ops = newOps)
            val sql = newTab.composedSql()
            updateActiveTab { it.copy(ops = newOps, currentSql = sql) }
            executeQuery(sql)
        }
    }

    fun clearOps() {
        val tab = _state.value.activeTab ?: return
        val base = tab.baseSql.ifBlank { tab.currentSql }
        updateActiveTab { it.copy(ops = emptyList(), currentSql = base, baseSql = "") }
        executeQuery(base)
    }

    // ── Tab management ───────────────────────────────────────────────────

    fun switchTab(tabId: Int) {
        _state.update { it.copy(activeTabId = tabId) }
    }

    fun closeTab(tabId: Int) {
        viewModelScope.launch {
            val tab = _state.value.tabs.find { it.id == tabId }
            tab?.pagedQuery?.close()
            tab?.session?.close()

            // Clean up cache file
            File(appContext.cacheDir, "trace_$tabId").delete()

            _state.update { s ->
                val remaining = s.tabs.filter { it.id != tabId }
                s.copy(
                    tabs = remaining,
                    activeTabId = if (s.activeTabId == tabId) {
                        remaining.lastOrNull()?.id ?: -1
                    } else s.activeTabId,
                )
            }
        }
    }

    // ── History ──────────────────────────────────────────────────────────

    fun loadFromHistory(entry: HistoryEntry) {
        updateActiveTab { it.copy(currentSql = entry.sql, mode = QueryMode.SQL) }
        executeQuery(entry.sql)
    }

    // ── Theme & navigation ─────────────────────────────────────────

    fun setThemeMode(mode: ThemeMode) {
        ThemePrefs.save(appContext, mode)
        _state.update { it.copy(themeMode = mode) }
    }

    fun navigateTo(screen: Screen) {
        _state.update { it.copy(screen = screen) }
    }

    fun clearHistory() {
        queryHistory.clear()
        updateActiveTab { it.copy(history = emptyList()) }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun updateTab(tabId: Int, transform: (TabState) -> TabState) {
        _state.update { s ->
            s.copy(tabs = s.tabs.map { if (it.id == tabId) transform(it) else it })
        }
    }

    private fun updateActiveTab(transform: (TabState) -> TabState) {
        val tabId = _state.value.activeTabId
        if (tabId >= 0) updateTab(tabId, transform)
    }

    override fun onCleared() {
        _state.value.tabs.forEach { tab ->
            tab.pagedQuery?.close()
            tab.session?.let { session ->
                kotlinx.coroutines.runBlocking {
                    try { session.close() } catch (_: Exception) {}
                }
            }
            // Clean up cache files
            File(appContext.cacheDir, "trace_${tab.id}").delete()
        }
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return MainViewModel(context.applicationContext) as T
        }
    }
}
