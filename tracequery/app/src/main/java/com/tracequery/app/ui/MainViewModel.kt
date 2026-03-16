package com.tracequery.app.ui

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tracequery.app.data.QueryHistory
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
import kotlinx.coroutines.launch
import java.io.File

// ── Tab state ────────────────────────────────────────────────────────────────

/** A filter applied via the DataGrid cell/column context menu. */
data class ActiveFilter(
    val column: String,
    val op: String,       // =, !=, >, >=, <, <=, LIKE, NOT LIKE, GLOB, NOT GLOB, IS NULL, IS NOT NULL
    val value: String?,   // null for IS NULL / IS NOT NULL
) {
    val displayText: String get() = when (op) {
        "IS NULL" -> "$column IS NULL"
        "IS NOT NULL" -> "$column IS NOT NULL"
        "LIKE" -> "$column contains ${value?.removeSurrounding("%")}"
        "NOT LIKE" -> "$column !contains ${value?.removeSurrounding("%")}"
        else -> "$column $op ${value ?: ""}"
    }

    fun toSqlClause(): String {
        val qCol = "\"${column.replace("\"", "\"\"")}\""
        return when (op) {
            "IS NULL" -> "$qCol IS NULL"
            "IS NOT NULL" -> "$qCol IS NOT NULL"
            else -> "$qCol $op $value"
        }
    }
}

data class TabState(
    val id: Int,
    val fileName: String,
    val session: TraceProcessorSession? = null,
    val currentSql: String = "SELECT * FROM slice LIMIT 100;",
    val baseSql: String = "",  // SQL before filters/aggregation
    val filters: List<ActiveFilter> = emptyList(),
    val aggregation: String? = null,  // e.g. "COUNT(name)" — displayed as chip
    val result: QueryResult? = null,
    val isQuerying: Boolean = false,
    val isLoading: Boolean = false,
    val loadProgress: String = "",
    val history: List<HistoryEntry> = emptyList(),
    val mode: QueryMode = QueryMode.SQL,
    val error: String? = null,
) {
    /** Compose the full SQL from base + filters.
     *  INCLUDE PERFETTO MODULE statements are extracted to the top —
     *  they cannot be inside a subquery. */
    fun composedSql(): String {
        if (filters.isEmpty()) return currentSql
        val raw = baseSql.ifBlank { currentSql }.trimEnd().removeSuffix(";").trim()

        // Extract INCLUDE statements (must be top-level, not in subquery)
        val lines = raw.lines()
        val includes = mutableListOf<String>()
        val queryParts = mutableListOf<String>()
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.uppercase().startsWith("INCLUDE PERFETTO MODULE")) {
                includes.add(trimmed.removeSuffix(";"))
            } else if (trimmed.isNotEmpty()) {
                queryParts.add(line)
            }
        }

        val selectSql = queryParts.joinToString("\n").trim().removeSuffix(";")
        val whereClauses = filters.joinToString(" AND ") { it.toSqlClause() }
        val prefix = if (includes.isNotEmpty()) includes.joinToString(";\n") + ";\n" else ""
        return "${prefix}SELECT * FROM ($selectSql) WHERE $whereClauses;"
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

                appContext.contentResolver.openInputStream(uri)?.use { input ->
                    cacheFile.outputStream().use { output ->
                        input.copyTo(output, bufferSize = 4 * 1024 * 1024)
                    }
                } ?: throw Exception("Cannot open file")

                updateTab(tabId) { it.copy(loadProgress = "Loading into trace processor...") }

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

        updateActiveTab { it.copy(currentSql = sql, isQuerying = true, error = null) }

        viewModelScope.launch {
            val result = session.query(sql)

            val entry = HistoryEntry(
                sql = sql,
                timestamp = System.currentTimeMillis(),
                traceFileName = tab.fileName,
                rowCount = result.rowCount,
                executionTimeMs = result.executionTimeMs,
                error = result.error,
            )

            // Persist to disk
            queryHistory.add(entry)

            updateActiveTab {
                it.copy(
                    result = result,
                    isQuerying = false,
                    error = result.error,
                    history = queryHistory.getAll().filter { h ->
                        h.traceFileName == tab.fileName
                    }.take(50),
                )
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

    // ── Filters ──────────────────────────────────────────────────────

    fun addFilter(filter: ActiveFilter) {
        val tab = _state.value.activeTab ?: return
        // Save current SQL as base if first filter
        val base = if (tab.filters.isEmpty()) tab.currentSql else tab.baseSql
        val newFilters = tab.filters + filter
        updateActiveTab { it.copy(filters = newFilters, baseSql = base) }
        // Execute with filters
        val composed = tab.copy(filters = newFilters, baseSql = base).composedSql()
        executeQuery(composed)
    }

    fun removeFilter(index: Int) {
        val tab = _state.value.activeTab ?: return
        val newFilters = tab.filters.toMutableList().apply { removeAt(index) }
        updateActiveTab { it.copy(filters = newFilters) }
        if (newFilters.isEmpty()) {
            // Restore base SQL
            val base = tab.baseSql.ifBlank { tab.currentSql }
            updateActiveTab { it.copy(currentSql = base, baseSql = "") }
            executeQuery(base)
        } else {
            val composed = tab.copy(filters = newFilters).composedSql()
            executeQuery(composed)
        }
    }

    fun clearFilters() {
        val tab = _state.value.activeTab ?: return
        val base = tab.baseSql.ifBlank { tab.currentSql }
        updateActiveTab { it.copy(filters = emptyList(), currentSql = base, baseSql = "") }
        executeQuery(base)
    }

    fun addAggregate(function: String, column: String) {
        val tab = _state.value.activeTab ?: return
        val raw = tab.currentSql.trimEnd().removeSuffix(";").trim()

        // Extract INCLUDE statements
        val lines = raw.lines()
        val includes = mutableListOf<String>()
        val queryParts = mutableListOf<String>()
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.uppercase().startsWith("INCLUDE PERFETTO MODULE")) {
                includes.add(trimmed.removeSuffix(";"))
            } else if (trimmed.isNotEmpty()) {
                queryParts.add(line)
            }
        }

        val selectSql = queryParts.joinToString("\n").trim().removeSuffix(";")
        val qCol = "\"${column.replace("\"", "\"\"")}\""
        val prefix = if (includes.isNotEmpty()) includes.joinToString(";\n") + ";\n" else ""

        val sql = if (function == "COUNT_DISTINCT") {
            "${prefix}SELECT $qCol, COUNT(*) as count FROM ($selectSql) GROUP BY $qCol ORDER BY count DESC;"
        } else {
            "${prefix}SELECT $qCol, $function(*) as ${function.lowercase()} FROM ($selectSql) GROUP BY $qCol ORDER BY ${function.lowercase()} DESC;"
        }
        val aggLabel = if (function == "COUNT_DISTINCT") "COUNT(DISTINCT $column)" else "$function($column)"
        val base = tab.currentSql  // save pre-aggregation SQL
        updateActiveTab { it.copy(currentSql = sql, filters = emptyList(), baseSql = base, aggregation = aggLabel) }
        executeQuery(sql)
    }

    fun clearAggregation() {
        val tab = _state.value.activeTab ?: return
        val base = tab.baseSql.ifBlank { return }
        updateActiveTab { it.copy(currentSql = base, baseSql = "", aggregation = null, filters = emptyList()) }
        executeQuery(base)
    }

    // ── Tab management ───────────────────────────────────────────────────

    fun switchTab(tabId: Int) {
        _state.update { it.copy(activeTabId = tabId) }
    }

    fun closeTab(tabId: Int) {
        viewModelScope.launch {
            val tab = _state.value.tabs.find { it.id == tabId }
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
        // Synchronous cleanup: close ALL sessions deterministically.
        // Cannot use viewModelScope (already cancelled at this point).
        _state.value.tabs.forEach { tab ->
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
