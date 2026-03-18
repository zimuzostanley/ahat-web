package com.tracequery.app.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Records a Perfetto trace on-device using the `perfetto` CLI.
 * Works on userdebug/eng builds where perfetto is available.
 */
class TraceRecorder(private val context: Context) {

    data class RecordingState(
        val isRecording: Boolean = false,
        val elapsedMs: Long = 0,
        val durationMs: Long = 10_000,
        val outputPath: String = "",
        val error: String? = null,
    )

    private val _state = MutableStateFlow(RecordingState())
    val state: StateFlow<RecordingState> = _state

    private var process: Process? = null
    private var startTime = 0L

    suspend fun startRecording(durationSeconds: Int, bufferSizeKb: Int = 32768) {
        val outputFile = File(context.cacheDir, "trace_${System.currentTimeMillis()}.perfetto-trace")
        val durationMs = durationSeconds * 1000L

        _state.value = RecordingState(
            isRecording = true, durationMs = durationMs,
            outputPath = outputFile.absolutePath,
        )

        withContext(Dispatchers.IO) {
            try {
                // Simple config: sched, ftrace, atrace categories
                val configText = """
                    buffers { size_kb: $bufferSizeKb }
                    duration_ms: $durationMs
                    data_sources {
                        config {
                            name: "linux.ftrace"
                            ftrace_config {
                                ftrace_events: "sched/sched_switch"
                                ftrace_events: "sched/sched_waking"
                                ftrace_events: "power/suspend_resume"
                                atrace_categories: "am"
                                atrace_categories: "wm"
                                atrace_categories: "view"
                                atrace_categories: "gfx"
                                atrace_categories: "dalvik"
                            }
                        }
                    }
                    data_sources {
                        config { name: "linux.process_stats" }
                    }
                """.trimIndent()

                val configFile = File(context.cacheDir, "trace_config.pbtxt")
                configFile.writeText(configText)

                val pb = ProcessBuilder(
                    "perfetto", "-c", configFile.absolutePath,
                    "-o", outputFile.absolutePath,
                )
                pb.redirectErrorStream(true)
                process = pb.start()
                startTime = System.currentTimeMillis()

                // Poll elapsed time
                while (process?.isAlive == true) {
                    val elapsed = System.currentTimeMillis() - startTime
                    _state.value = _state.value.copy(elapsedMs = elapsed)
                    delay(200)
                }

                val exitCode = process?.waitFor() ?: -1
                if (exitCode != 0 || !outputFile.exists() || outputFile.length() == 0L) {
                    val output = process?.inputStream?.bufferedReader()?.readText() ?: ""
                    _state.value = _state.value.copy(
                        isRecording = false,
                        error = "perfetto exited $exitCode: $output",
                    )
                } else {
                    _state.value = _state.value.copy(isRecording = false)
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    isRecording = false,
                    error = e.message ?: "Failed to start perfetto",
                )
            }
        }
    }

    fun stopRecording() {
        process?.destroy()
        process = null
    }
}
