package com.tracequery.app.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
                            modifier = Modifier.padding(padding),
                        )
                    }
                }
            }
        }

        // Handle intent if opened from file manager
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        @Suppress("DEPRECATION")
        val uri: Uri? = intent.data ?: intent.getParcelableExtra(Intent.EXTRA_STREAM)
        if (uri != null && ::vm.isInitialized) {
            val name = uri.lastPathSegment?.substringAfterLast('/') ?: "trace"
            vm.openTrace(uri, name)
        }
    }
}
