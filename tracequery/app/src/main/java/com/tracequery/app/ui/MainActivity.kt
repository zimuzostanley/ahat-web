package com.tracequery.app.ui

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
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            TraceQueryTheme {
                val vm: MainViewModel = viewModel(
                    factory = MainViewModel.Factory(applicationContext)
                )
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
    }
}
