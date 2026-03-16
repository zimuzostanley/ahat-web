package com.tracequery.app.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.tracequery.app.ui.screen.QueryScreen
import com.tracequery.app.ui.screen.SettingsScreen
import com.tracequery.app.ui.screen.TraceLoadScreen
import com.tracequery.app.ui.theme.TraceQueryTheme

class MainActivity : ComponentActivity() {

    private lateinit var vm: MainViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            vm = viewModel(factory = MainViewModel.Factory(applicationContext))
            val state by vm.state.collectAsState()

            TraceQueryTheme(themeMode = state.themeMode) {
                val filePicker = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument()
                ) { uri: Uri? ->
                    if (uri != null) vm.openTrace(uri, resolveFileName(uri))
                }

                var showSettings by remember { mutableStateOf(false) }

                // Back from settings goes to previous screen
                BackHandler(enabled = showSettings) {
                    showSettings = false
                }

                Crossfade(
                    targetState = when {
                        showSettings -> "settings"
                        !state.hasTraces -> "load"
                        else -> "query"
                    },
                    label = "screen",
                ) { screen ->
                    when (screen) {
                        "settings" -> SettingsScreen(
                            themeMode = state.themeMode,
                            onThemeChange = vm::setThemeMode,
                            onClearHistory = vm::clearHistory,
                            onBack = { showSettings = false },
                            modifier = Modifier.fillMaxSize(),
                        )
                        "load" -> TraceLoadScreen(
                            onTraceSelected = { uri, name -> vm.openTrace(uri, name) },
                            onOpenSettings = { showSettings = true },
                            modifier = Modifier.fillMaxSize(),
                        )
                        else -> QueryScreen(
                            uiState = state,
                            onExecuteQuery = vm::executeQuery,
                            onSqlChange = vm::setSql,
                            onTableSelect = vm::selectTable,
                            onModeChange = vm::setMode,
                            onSwitchTab = vm::switchTab,
                            onCloseTab = vm::closeTab,
                            onLoadHistory = vm::loadFromHistory,
                            onAddFilter = vm::addFilter,
                            onRemoveFilter = vm::removeFilter,
                            onClearFilters = vm::clearFilters,
                            onAggregate = vm::addAggregate,
                            onClearAggregation = vm::clearAggregation,
                            onOpenTrace = { filePicker.launch(arrayOf("*/*")) },
                            onOpenSettings = { showSettings = true },
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
            }
        }

        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM)
            }
            else -> null
        }
        if (uri != null && ::vm.isInitialized) {
            vm.openTrace(uri, resolveFileName(uri))
        }
    }

    private fun resolveFileName(uri: Uri): String {
        if (uri.scheme == "content") {
            try {
                contentResolver.query(
                    uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
                )?.use { c ->
                    if (c.moveToFirst()) {
                        val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (i >= 0) c.getString(i)?.takeIf { it.isNotBlank() }?.let { return it }
                    }
                }
            } catch (_: Exception) {}
        }
        return (uri.lastPathSegment ?: "trace").substringAfterLast('/')
    }
}
