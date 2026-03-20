package com.procstate.monitor.service

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.procstate.monitor.R
import com.procstate.monitor.data.AppDatabase
import com.procstate.monitor.data.MemorySnapshotEntity
import com.procstate.monitor.data.ProcessEntryEntity
import com.procstate.monitor.data.ShellHelper
import com.procstate.monitor.data.SnapshotEntity
import com.procstate.monitor.ui.MainActivity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground service that periodically captures process LRU state and stores
 * snapshots in Room. Uses structured coroutines for proper cancellation.
 */
class CaptureService : Service() {

    companion object {
        private const val TAG = "CaptureService"
        private const val CHANNEL_ID = "procstate_capture"
        private const val NOTIFICATION_ID = 2001

        const val ACTION_STOP = "com.procstate.monitor.STOP_CAPTURE"
        const val ACTION_SNAPSHOT_SAVED = "com.procstate.monitor.SNAPSHOT_SAVED"
        const val EXTRA_INTERVAL_MS = "interval_ms"
        const val EXTRA_STOP_AFTER_MINUTES = "stop_after_minutes"

        @Volatile var running = false
            private set

        /** Set before starting service: process names to auto-dump memory for. */
        @Volatile var autoMemoryNames: List<Pair<String, String>> = emptyList()
        @Volatile var autoMemoryEnabled = false
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var serviceScope: CoroutineScope? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Log.i(TAG, "Stop requested")
            finish()
            return START_NOT_STICKY
        }

        // Cancel any existing scope to prevent double-runs
        serviceScope?.cancel()
        serviceScope = null

        val intervalMs = intent?.getLongExtra(EXTRA_INTERVAL_MS, 30_000L) ?: 30_000L
        val stopAfterMinutes = intent?.getIntExtra(EXTRA_STOP_AFTER_MINUTES, 0) ?: 0

        // Wake lock with safe Long arithmetic
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        val timeoutMs = if (stopAfterMinutes > 0) {
            (stopAfterMinutes.toLong() + 5) * 60 * 1000
        } else {
            24L * 3600 * 1000
        }
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "procstate:capture").apply {
            acquire(timeoutMs)
        }

        val notifText = buildString {
            append("Capturing every ${formatInterval(intervalMs)}")
            if (stopAfterMinutes > 0) append(" \u00b7 stop in ${stopAfterMinutes}m")
        }
        val notification = buildNotification(notifText)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        running = true

        // Schedule exact alarm to stop service at wall-clock deadline
        // This wakes the device from suspend so the stop happens on time
        val stopAtMs = if (stopAfterMinutes > 0) {
            System.currentTimeMillis() + stopAfterMinutes.toLong() * 60 * 1000
        } else {
            Long.MAX_VALUE
        }
        if (stopAfterMinutes > 0) {
            val am = getSystemService(ALARM_SERVICE) as AlarmManager
            val stopIntent = Intent(this, CaptureService::class.java).apply { action = ACTION_STOP }
            val stopPi = PendingIntent.getService(this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, stopAtMs, stopPi)
            } else {
                // Fallback: inexact alarm (may fire a few minutes late)
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, stopAtMs, stopPi)
            }
        }

        val dao = AppDatabase.get(this).snapshotDao()
        val sessionId = java.util.UUID.randomUUID().toString()

        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        serviceScope = scope

        scope.launch {
            var cycleCount = 0
            while (isActive) {
                if (System.currentTimeMillis() >= stopAtMs) {
                    Log.i(TAG, "Stop-after timeout reached ($stopAfterMinutes min)")
                    break
                }
                cycleCount++
                try {
                    val processes = ShellHelper.getProcessList()
                    val frozenPids = ShellHelper.getFrozenPids()

                    // Dump memory first (slow), then snapshot (fast)
                    val memDumps = mutableListOf<Pair<ShellHelper.ProcessEntry, ShellHelper.MemInfo>>()
                    if (autoMemoryEnabled && autoMemoryNames.isNotEmpty()) {
                        for ((mName, mUid) in autoMemoryNames.toList()) {
                            val proc = processes.find { it.name == mName && it.uid == mUid }
                            if (proc != null) {
                                try {
                                    memDumps.add(proc to ShellHelper.getMemInfo(proc.pid))
                                } catch (e: Exception) {
                                    Log.w(TAG, "Auto meminfo $mName failed: ${e.message}")
                                }
                            }
                        }
                    }

                    // Now create snapshot — timestamp reflects when all data is ready
                    val snapshot = SnapshotEntity(timestamp = System.currentTimeMillis(), sessionId = sessionId)
                    val entries = processes.map { p ->
                        ProcessEntryEntity(
                            snapshotId = 0,
                            pid = p.pid,
                            name = p.name,
                            uid = p.uid,
                            procState = p.procState,
                            frozen = p.pid in frozenPids,
                        )
                    }
                    dao.insertSnapshotWithEntries(snapshot, entries)
                    for ((proc, memInfo) in memDumps) {
                        dao.insertMemorySnapshot(MemorySnapshotEntity(
                            timestamp = snapshot.timestamp,
                            pid = proc.pid, name = proc.name, uid = proc.uid,
                            totalPssKb = memInfo.totalPssKb,
                            totalRssKb = memInfo.totalRssKb,
                            javaHeapKb = memInfo.javaHeapKb,
                            nativeHeapKb = memInfo.nativeHeapKb,
                            codeKb = memInfo.codeKb,
                            stackKb = memInfo.stackKb,
                            graphicsKb = memInfo.graphicsKb,
                            systemKb = memInfo.systemKb,
                            totalSwapKb = memInfo.totalSwapKb,
                        ))
                    }

                    Log.d(TAG, "Cycle #$cycleCount: ${processes.size} processes saved")
                    updateNotification("#$cycleCount \u00b7 ${processes.size} procs \u00b7 every ${formatInterval(intervalMs)}")
                    sendBroadcast(Intent(ACTION_SNAPSHOT_SAVED))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Cycle #$cycleCount failed", e)
                    updateNotification("#$cycleCount failed: ${e.message}")
                }
                delay(intervalMs)
            }
            showDoneNotification("Stopped after $cycleCount snapshots")
            finish()
        }

        return START_NOT_STICKY
    }

    private fun finish() {
        running = false
        serviceScope?.cancel()
        serviceScope = null
        // Cancel stop alarm if set
        val stopIntent = Intent(this, CaptureService::class.java).apply { action = ACTION_STOP }
        val stopPi = PendingIntent.getService(this, 1, stopIntent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
        if (stopPi != null) {
            (getSystemService(ALARM_SERVICE) as AlarmManager).cancel(stopPi)
            stopPi.cancel()
        }
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        sendBroadcast(Intent(ACTION_SNAPSHOT_SAVED))
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        running = false
        serviceScope?.cancel()
        serviceScope = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Process Capture", NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Shows progress during process state capture" }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPi = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_IMMUTABLE)

        val stopIntent = Intent(this, CaptureService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPi = PendingIntent.getService(this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ProcState")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notif)
            .setOngoing(true)
            .setContentIntent(openPi)
            .addAction(R.drawable.ic_notif, "Stop", stopPi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun showDoneNotification(text: String) {
        val n = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ProcState")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notif)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID + 1, n)
    }

    private fun formatInterval(ms: Long): String = when {
        ms < 1000 -> "${ms}ms"
        ms % 60_000 == 0L -> "${ms / 60_000}m"
        else -> "${ms / 1000}s"
    }
}
