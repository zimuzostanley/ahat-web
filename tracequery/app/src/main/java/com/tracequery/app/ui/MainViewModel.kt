package com.tracequery.app.ui

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.tracequery.app.data.TraceProcessorSession
import com.tracequery.app.data.model.HistoryEntry
import com.tracequery.app.data.model.QueryResult
import com.tracequery.app.data.model.StdlibDocs
import com.tracequery.app.data.model.StdlibTable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

// ── Tab state ────────────────────────────────────────────────────────────────

data class TabState(
    val id: Int,
    val fileName: String,
    val session: TraceProcessorSession? = null,
    val currentSql: String = "SELECT * FROM slice LIMIT 100;",
    val result: QueryResult? = null,
    val isQuerying: Boolean = false,
    val isLoading: Boolean = false,
    val loadProgress: String = "",
    val history: List<HistoryEntry> = emptyList(),
    val mode: QueryMode = QueryMode.SQL,
    val error: String? = null,
)

enum class QueryMode { SQL, EXPLORE }

// ── Main UI state ────────────────────────────────────────────────────────────

data class MainUiState(
    val tabs: List<TabState> = emptyList(),
    val activeTabId: Int = -1,
    val stdlibDocs: StdlibDocs? = null,
    val isLoadingStdlib: Boolean = true,
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

    private var nextTabId = 0

    init {
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

                updateTab(tabId) {
                    it.copy(
                        session = session,
                        isLoading = false,
                        loadProgress = "",
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

            updateActiveTab {
                it.copy(
                    result = result,
                    isQuerying = false,
                    error = result.error,
                    history = listOf(entry) + it.history.take(99),
                )
            }
        }
    }

    fun setSql(sql: String) {
        updateActiveTab { it.copy(currentSql = sql) }
    }

    // ── Table browser ────────────────────────────────────────────────────

    fun selectTable(table: StdlibTable) {
        val sql = table.selectQuery()
        updateActiveTab { it.copy(currentSql = sql, mode = QueryMode.SQL) }
        executeQuery(sql)
    }

    fun setMode(mode: QueryMode) {
        updateActiveTab { it.copy(mode = mode) }
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
        // Deterministic cleanup: close ALL sessions
        _state.value.tabs.forEach { tab ->
            tab.session?.let { session ->
                viewModelScope.launch { session.close() }
            }
        }
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return MainViewModel(context.applicationContext) as T
        }
    }
}
