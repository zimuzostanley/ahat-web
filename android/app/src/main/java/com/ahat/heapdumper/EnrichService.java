package com.ahat.heapdumper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.List;

/**
 * Foreground service that enriches each process with meminfo data,
 * saves a snapshot, and broadcasts completion.
 */
public class EnrichService extends Service {

    private static final String TAG = "EnrichService";
    private static final String CHANNEL_ID = "enrich_channel";
    private static final int NOTIFICATION_ID = 1001;
    public static final String ACTION_DONE = "com.ahat.heapdumper.ENRICH_DONE";

    /** Set by the caller before starting the service. */
    public static List<ProcessInfo> pendingProcesses;

    public static volatile boolean running;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int delaySeconds = intent != null ? intent.getIntExtra("delay_seconds", 0) : 0;

        String initialText = delaySeconds > 0
                ? "Enriching in " + delaySeconds + "s\u2026"
                : "Enriching 0/?";
        Notification notification = buildNotification(initialText);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        final List<ProcessInfo> passedProcesses = pendingProcesses;
        pendingProcesses = null;

        running = true;

        new Thread(() -> {
            List<ProcessInfo> processes = passedProcesses;

            // Countdown delay
            if (delaySeconds > 0) {
                for (int s = delaySeconds; s > 0; s--) {
                    updateNotification("Enriching in " + s + "s\u2026");
                    try { Thread.sleep(1000); } catch (InterruptedException e) {
                        running = false;
                        sendBroadcast(new Intent(ACTION_DONE));
                        stopSelf();
                        return;
                    }
                }
                // Fetch fresh process list after delay
                updateNotification("Fetching processes\u2026");
                try {
                    processes = ShellHelper.getProcessList();
                    Log.i(TAG, "Fresh process list: " + processes.size() + " processes");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to fetch process list", e);
                    updateNotification("Failed: " + e.getMessage());
                    running = false;
                    sendBroadcast(new Intent(ACTION_DONE));
                    stopSelf();
                    return;
                }
            }

            if (processes == null || processes.isEmpty()) {
                updateNotification("Done: enriched 0/0 processes");
                running = false;
                sendBroadcast(new Intent(ACTION_DONE));
                stopSelf();
                return;
            }

            int total = processes.size();
            int enriched = 0;

            for (int i = 0; i < total; i++) {
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
            } catch (Exception e) {
                Log.e(TAG, "Failed to save snapshot", e);
            }

            updateNotification("Done: enriched " + enriched + "/" + total + " processes");

            running = false;
            sendBroadcast(new Intent(ACTION_DONE));
            stopSelf();
        }).start();

        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Memory Enrichment", NotificationManager.IMPORTANCE_LOW);
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("ahat")
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_launcher)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIFICATION_ID, buildNotification(text));
    }
}
