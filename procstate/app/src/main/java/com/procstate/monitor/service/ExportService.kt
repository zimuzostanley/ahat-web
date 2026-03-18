package com.procstate.monitor.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.procstate.monitor.R
import com.procstate.monitor.data.AppDatabase
import com.procstate.monitor.data.TraceExporter
import com.procstate.monitor.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Foreground service for Perfetto trace export.
 * Runs the export on IO thread so it survives app backgrounding.
 */
class ExportService : Service() {

    companion object {
        private const val TAG = "ExportService"
        private const val CHANNEL_ID = "procstate_export"
        private const val NOTIFICATION_ID = 3001

        const val ACTION_EXPORT = "com.procstate.monitor.EXPORT"
        const val ACTION_DONE = "com.procstate.monitor.EXPORT_DONE"
        const val EXTRA_RANGE_MS = "range_ms"
        const val EXTRA_URI = "uri"

        private val _running = MutableStateFlow(false)
        val runningFlow = _running.asStateFlow()
        val running: Boolean get() = _running.value

        private val _progress = MutableStateFlow<String?>(null)
        val progressFlow = _progress.asStateFlow()
    }

    private var serviceScope: CoroutineScope? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_EXPORT) {
            stopSelf()
            return START_NOT_STICKY
        }

        val rangeMs = intent.getLongExtra(EXTRA_RANGE_MS, 0L)
        val uriStr = intent.getStringExtra(EXTRA_URI) ?: run { stopSelf(); return START_NOT_STICKY }
        val uri = Uri.parse(uriStr)

        val notification = buildNotification("Exporting\u2026")
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        _running.value = true
        val dao = AppDatabase.get(this).snapshotDao()
        val pm = packageManager

        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        serviceScope = scope

        scope.launch {
            try {
                updateNotification("Querying database\u2026")
                val startMs = if (rangeMs > 0) System.currentTimeMillis() - rangeMs else 0L
                val entries = dao.getAllEntriesForExport(startMs)
                val timestamps = dao.getAllTimestampsForExport(startMs)
                val memSnapshots = dao.getAllMemoryForExport(startMs)

                updateNotification("Building trace (${entries.size} entries)\u2026")
                val exportEntries = entries.map { row ->
                    TraceExporter.Entry(
                        timestampMs = row.timestamp,
                        name = row.name, uid = row.uid, pid = row.pid,
                        procState = row.procState, frozen = row.frozen,
                    )
                }
                val memEntries = memSnapshots.map { m ->
                    TraceExporter.MemoryEntry(
                        timestampMs = m.timestamp,
                        name = m.name, uid = m.uid, pid = m.pid,
                        totalPssKb = m.totalPssKb, totalRssKb = m.totalRssKb,
                        javaHeapKb = m.javaHeapKb, nativeHeapKb = m.nativeHeapKb,
                        codeKb = m.codeKb, stackKb = m.stackKb,
                        graphicsKb = m.graphicsKb, systemKb = m.systemKb,
                        totalSwapKb = m.totalSwapKb,
                    )
                }
                val getAppLabel = { name: String ->
                    try {
                        val pkgName = name.substringBefore(':')
                        pm.getApplicationLabel(pm.getApplicationInfo(pkgName, 0)).toString()
                    } catch (_: Exception) { name }
                }

                val json = TraceExporter.export(exportEntries, getAppLabel, timestamps, memEntries) { progress ->
                    updateNotification(progress)
                }

                updateNotification("Writing file\u2026")
                contentResolver.openOutputStream(uri)?.use { out ->
                    out.write(json.toByteArray())
                }

                showDoneNotification("Export complete")
                Log.i(TAG, "Export done: ${entries.size} entries")
            } catch (e: Exception) {
                Log.e(TAG, "Export failed", e)
                showDoneNotification("Export failed: ${e.message}")
            } finally {
                withContext(Dispatchers.Main) { finish() }
            }
        }

        return START_NOT_STICKY
    }

    private fun finish() {
        _running.value = false
        _progress.value = null
        serviceScope?.cancel()
        serviceScope = null
        sendBroadcast(Intent(ACTION_DONE))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        _running.value = false
        _progress.value = null
        serviceScope?.cancel()
        serviceScope = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Trace Export", NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Shows progress during Perfetto export" }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPi = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_IMMUTABLE)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ProcState Export")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notif)
            .setOngoing(true)
            .setContentIntent(openPi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun updateNotification(text: String) {
        _progress.value = text
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun showDoneNotification(text: String) {
        val n = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ProcState Export")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notif)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID + 1, n)
    }
}
