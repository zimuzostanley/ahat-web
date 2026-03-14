package com.ahat.heapdumper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.List;

/**
 * Foreground service that enriches each process with meminfo data,
 * saves a snapshot, and broadcasts completion.
 *
 * Holds a partial wake lock so the CPU stays awake during the delay
 * and enrichment even with screen off.
 */
public class EnrichService extends Service {

    private static final String TAG = "EnrichService";
    // New channel ID — old "enrich_channel" was created with IMPORTANCE_LOW
    // and Android won't let us upgrade it. Using v2 forces a new channel.
    private static final String CHANNEL_ID = "enrich_channel_v2";
    private static final int NOTIFICATION_ID = 1001;
    public static final String ACTION_DONE = "com.ahat.heapdumper.ENRICH_DONE";
    public static final String ACTION_STOP = "com.ahat.heapdumper.ENRICH_STOP";

    /** Set by the caller before starting the service. */
    public static List<ProcessInfo> pendingProcesses;

    public static volatile boolean running;

    private PowerManager.WakeLock wakeLock;
    private volatile Thread workerThread;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        // Delete old channel if it exists
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.deleteNotificationChannel("enrich_channel");
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Handle stop action from notification button
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.i(TAG, "Stop requested");
            if (workerThread != null) workerThread.interrupt();
            finish();
            return START_NOT_STICKY;
        }

        int delaySeconds = intent != null ? intent.getIntExtra("delay_seconds", 0) : 0;
        int recurringInterval = intent != null ? intent.getIntExtra("recurring_interval_seconds", 0) : 0;

        // Acquire partial wake lock
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ahat:enrich");
        long timeoutMs = recurringInterval > 0
                ? 24 * 3600 * 1000L  // 24h for recurring
                : (delaySeconds + 600) * 1000L;
        wakeLock.acquire(timeoutMs);
        Log.i(TAG, "Wake lock acquired, timeout=" + timeoutMs + "ms");

        String initialText = recurringInterval > 0
                ? "Recording every " + recurringInterval + "s\u2026"
                : delaySeconds > 0
                    ? "Enriching in " + delaySeconds + "s\u2026"
                    : "Starting enrichment\u2026";
        Notification notification = buildNotification(initialText);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        Log.i(TAG, "startForeground called, delay=" + delaySeconds + ", recurring=" + recurringInterval);

        final List<ProcessInfo> passedProcesses = pendingProcesses;
        pendingProcesses = null;

        running = true;

        workerThread = new Thread(() -> {
            // ── Recurring mode ──
            if (recurringInterval > 0) {
                int snapCount = 0;
                while (!Thread.currentThread().isInterrupted()) {
                    snapCount++;
                    int enriched = runOneEnrichCycle(snapCount);
                    if (Thread.currentThread().isInterrupted()) break;
                    updateNotification("Snapshot #" + snapCount + " saved (" + enriched
                            + " enriched). Next in " + recurringInterval + "s\u2026");
                    try {
                        Thread.sleep(recurringInterval * 1000L);
                    } catch (InterruptedException e) {
                        break;
                    }
                }
                showDoneNotification("Recording stopped: " + snapCount + " snapshots saved");
                finish();
                return;
            }

            // ── One-shot mode ──
            List<ProcessInfo> processes = passedProcesses;

            if (delaySeconds > 0) {
                for (int s = delaySeconds; s > 0; s--) {
                    if (Thread.currentThread().isInterrupted()) { finish(); return; }
                    updateNotification("Enriching in " + s + "s\u2026");
                    try { Thread.sleep(1000); } catch (InterruptedException e) {
                        finish(); return;
                    }
                }
                updateNotification("Fetching processes\u2026");
                try {
                    processes = ShellHelper.getProcessList();
                } catch (Exception e) {
                    Log.e(TAG, "Failed to fetch process list", e);
                    updateNotification("Failed: " + e.getMessage());
                    finish(); return;
                }
            }

            if (processes == null || processes.isEmpty()) {
                updateNotification("Done: no processes to enrich");
                finish(); return;
            }

            int total = processes.size();
            int enriched = 0;
            for (int i = 0; i < total; i++) {
                if (Thread.currentThread().isInterrupted()) { finish(); return; }
                ProcessInfo process = processes.get(i);
                try {
                    MemInfo info = ShellHelper.getMemInfo(process.pid);
                    process.applyMemInfo(info);
                    enriched++;
                } catch (Exception e) {
                    Log.w(TAG, "Failed to enrich pid " + process.pid + ": " + e.getMessage());
                }
                updateNotification("Enriching " + (i + 1) + "/" + total);
            }

            try {
                Snapshot snapshot = Snapshot.fromProcessList(processes);
                SnapshotStore.save(EnrichService.this, snapshot);
                Log.i(TAG, "Snapshot saved: " + enriched + "/" + total);
            } catch (Exception e) {
                Log.e(TAG, "Failed to save snapshot", e);
            }

            showDoneNotification("Done: enriched " + enriched + "/" + total + " processes");
            finish();
        });
        workerThread.start();

        return START_NOT_STICKY;
    }

    /** Run one cycle: fetch processes, enrich all, save snapshot. Returns enriched count. */
    private int runOneEnrichCycle(int cycleNum) {
        updateNotification("Cycle #" + cycleNum + ": fetching processes\u2026");
        List<ProcessInfo> processes;
        try {
            processes = ShellHelper.getProcessList();
        } catch (Exception e) {
            Log.e(TAG, "Cycle #" + cycleNum + " failed to fetch processes", e);
            return 0;
        }

        int total = processes.size();
        int enriched = 0;
        for (int i = 0; i < total; i++) {
            if (Thread.currentThread().isInterrupted()) return enriched;
            ProcessInfo p = processes.get(i);
            try {
                MemInfo info = ShellHelper.getMemInfo(p.pid);
                p.applyMemInfo(info);
                enriched++;
            } catch (Exception e) {
                Log.w(TAG, "Cycle #" + cycleNum + " failed pid " + p.pid);
            }
            updateNotification("Cycle #" + cycleNum + ": " + (i + 1) + "/" + total);
        }

        try {
            Snapshot snapshot = Snapshot.fromProcessList(processes);
            SnapshotStore.save(this, snapshot);
            Log.i(TAG, "Cycle #" + cycleNum + " saved: " + enriched + "/" + total);
        } catch (Exception e) {
            Log.e(TAG, "Cycle #" + cycleNum + " failed to save snapshot", e);
        }
        sendBroadcast(new Intent(ACTION_DONE));
        return enriched;
    }

    /** Clean up: release wake lock, remove FGS notification, broadcast done, stop service. */
    private void finish() {
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.i(TAG, "Wake lock released");
        }
        sendBroadcast(new Intent(ACTION_DONE));
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /** Post a separate non-ongoing notification for "Done" that the user can swipe away. */
    private void showDoneNotification(String text) {
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("ahat")
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_notif)
                .setAutoCancel(true)
                .build();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_ID + 1, n);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (workerThread != null) workerThread.interrupt();
        Log.i(TAG, "Service destroyed");
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Memory Enrichment", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Shows progress during memory enrichment");
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        // Tap notification opens the app
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, openIntent,
                PendingIntent.FLAG_IMMUTABLE);

        // Stop button on the notification
        Intent stopIntent = new Intent(this, EnrichService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 0, stopIntent,
                PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("ahat")
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_notif)
                .setOngoing(true)
                .setContentIntent(openPi)
                .addAction(0, "Stop", stopPi)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_ID, buildNotification(text));
    }
}
