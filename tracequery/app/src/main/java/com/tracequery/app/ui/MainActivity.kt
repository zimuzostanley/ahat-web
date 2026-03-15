package com.tracequery.app.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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

                Scaffold(modifier = Modifier.fillMaxSize()) { padding ->
                    Crossfade(targetState = state.screen, label = "screen") { screen ->
                        when {
                            screen == Screen.SETTINGS -> {
                                SettingsScreen(
                                    themeMode = state.themeMode,
                                    onThemeChange = vm::setThemeMode,
                                    onClearHistory = vm::clearHistory,
                                    modifier = Modifier.padding(padding),
                                )
                            }
                            !state.hasTraces -> {
                                TraceLoadScreen(
                                    onTraceSelected = { uri, name -> vm.openTrace(uri, name) },
                                    onOpenSettings = { vm.navigateTo(Screen.SETTINGS) },
                                    modifier = Modifier.padding(padding),
                                )
                            }
                            else -> {
                                QueryScreen(
                                    uiState = state,
                                    onExecuteQuery = vm::executeQuery,
                                    onSqlChange = vm::setSql,
                                    onTableSelect = vm::selectTable,
                                    onModeChange = vm::setMode,
                                    onSwitchTab = vm::switchTab,
                                    onCloseTab = vm::closeTab,
                                    onLoadHistory = vm::loadFromHistory,
                                    onOpenTrace = { filePicker.launch(arrayOf("*/*")) },
                                    onOpenSettings = { vm.navigateTo(Screen.SETTINGS) },
                                    modifier = Modifier.padding(padding),
                                )
                            }
                        }
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

    @Deprecated("Use onBackPressedDispatcher", ReplaceWith(""))
    override fun onBackPressed() {
        if (::vm.isInitialized && vm.state.value.screen == Screen.SETTINGS) {
            vm.navigateTo(Screen.QUERY)
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
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
            vm.navigateTo(Screen.QUERY)
            vm.openTrace(uri, resolveFileName(uri))
        }
    }

    private fun resolveFileName(uri: Uri): String {
        if (uri.scheme == "content") {
            try {
                contentResolver.query(
                    uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0) cursor.getString(idx)?.takeIf { it.isNotBlank() }?.let { return it }
                    }
                }
            } catch (_: Exception) {}
        }
        return (uri.lastPathSegment ?: "trace").substringAfterLast('/')
    }
}
