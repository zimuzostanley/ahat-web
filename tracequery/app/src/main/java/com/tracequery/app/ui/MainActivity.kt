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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.tracequery.app.ui.screen.QueryScreen
import com.tracequery.app.ui.screen.TraceLoadScreen
import com.tracequery.app.ui.theme.TraceQueryTheme

class MainActivity : ComponentActivity() {

    private lateinit var vm: MainViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            TraceQueryTheme {
                vm = viewModel(factory = MainViewModel.Factory(applicationContext))
                val state by vm.state.collectAsState()

                // File picker launcher (reusable from both screens)
                val filePicker = rememberLauncherForActivityResult(
                    ActivityResultContracts.OpenDocument()
                ) { uri: Uri? ->
                    if (uri != null) {
                        val name = resolveFileName(uri)
                        vm.openTrace(uri, name)
                    }
                }

                Scaffold(modifier = Modifier.fillMaxSize()) { padding ->
                    if (!state.hasTraces) {
                        TraceLoadScreen(
                            onTraceSelected = { uri, name -> vm.openTrace(uri, name) },
                            modifier = Modifier.padding(padding),
                        )
                    } else {
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
                            modifier = Modifier.padding(padding),
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

    /**
     * Resolve a human-readable filename from a URI.
     * Queries content resolver for display name (file managers),
     * falls back to path segment.
     */
    private fun resolveFileName(uri: Uri): String {
        if (uri.scheme == "content") {
            try {
                contentResolver.query(
                    uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0) {
                            val name = cursor.getString(idx)
                            if (!name.isNullOrBlank()) return name
                        }
                    }
                }
            } catch (_: Exception) {}
        }
        return (uri.lastPathSegment ?: uri.path ?: "trace").substringAfterLast('/')
    }
}
