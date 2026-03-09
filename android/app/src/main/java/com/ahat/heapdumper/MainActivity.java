package com.ahat.heapdumper;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.io.File;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class MainActivity extends AppCompatActivity {

    private ProcessAdapter processAdapter;
    private DumpAdapter dumpAdapter;
    private SwipeRefreshLayout swipeRefresh;
    private RecyclerView recyclerView;
    private TextView statusText;
    private FrameLayout progressContainer;
    private TextView progressText;
    private TextView tabProcesses, tabDumps;
    private ScrollView logPanel;
    private TextView logText;
    private final StringBuilder logBuffer = new StringBuilder();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private boolean showingDumps = false;
    private boolean logVisible = false;
    private volatile Future<?> enrichTask;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        applyTheme();
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        swipeRefresh = findViewById(R.id.swipeRefresh);
        recyclerView = findViewById(R.id.recyclerView);
        statusText = findViewById(R.id.statusText);
        progressContainer = findViewById(R.id.progressContainer);
        progressText = findViewById(R.id.progressText);
        tabProcesses = findViewById(R.id.tabProcesses);
        tabDumps = findViewById(R.id.tabDumps);
        logPanel = findViewById(R.id.logPanel);
        logText = findViewById(R.id.logText);

        recyclerView.setLayoutManager(new LinearLayoutManager(this));

        // Wire up in-app log
        ShellHelper.setLogCallback(msg -> runOnUiThread(() -> appendLog(msg)));

        processAdapter = new ProcessAdapter();
        processAdapter.setOnClickListener(this::onProcessClick);
        processAdapter.setOnLongClickListener(this::onProcessLongClick);

        dumpAdapter = new DumpAdapter();
        dumpAdapter.setListener(new DumpAdapter.OnDumpActionListener() {
            @Override public void onOpen(ShellHelper.HprofFile dump) { openDump(dump.path, dump.name); }
            @Override public void onShare(ShellHelper.HprofFile dump) { shareDump(dump.path); }
            @Override public void onDelete(ShellHelper.HprofFile dump) { confirmDelete(dump); }
        });

        recyclerView.setAdapter(processAdapter);
        swipeRefresh.setOnRefreshListener(this::refresh);
        swipeRefresh.setColorSchemeColors(0xFF3b82f6);

        tabProcesses.setOnClickListener(v -> showProcesses());
        tabDumps.setOnClickListener(v -> showDumps());
        findViewById(R.id.btnSettings).setOnClickListener(v ->
                startActivity(new Intent(this, SettingsActivity.class)));
        findViewById(R.id.btnDumps).setOnClickListener(v -> showDumps());
        findViewById(R.id.btnLog).setOnClickListener(v -> toggleLog());

        // Detect permissions + root, then load processes
        appendLog("ahat Heap Dumper starting...");
        appendLog("App UID: " + android.os.Process.myUid());
        executor.execute(() -> {
            ShellHelper.checkDumpPermission(this);
            ShellHelper.detectRoot();
            String mode = ShellHelper.getAccessMode();
            if ("none".equals(mode)) {
                runOnUiThread(() -> {
                    statusText.setText("Need permission — see log");
                    appendLog("No access. Grant DUMP permission:");
                    appendLog("  adb shell pm grant com.ahat.heapdumper android.permission.DUMP");
                    if (!logVisible) toggleLog();
                });
            }
            runOnUiThread(this::loadProcesses);
        });
    }

    private void appendLog(String msg) {
        logBuffer.append(msg).append('\n');
        // Keep last 200 lines
        String full = logBuffer.toString();
        String[] lines = full.split("\n");
        if (lines.length > 200) {
            logBuffer.setLength(0);
            for (int i = lines.length - 200; i < lines.length; i++) {
                logBuffer.append(lines[i]).append('\n');
            }
        }
        logText.setText(logBuffer.toString());
        logPanel.post(() -> logPanel.fullScroll(View.FOCUS_DOWN));
    }

    private void toggleLog() {
        logVisible = !logVisible;
        logPanel.setVisibility(logVisible ? View.VISIBLE : View.GONE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyTheme();
        if (showingDumps) loadDumps();
    }

    private void applyTheme() {
        SharedPreferences prefs = getSharedPreferences("ahat_prefs", MODE_PRIVATE);
        int mode = prefs.getInt("theme_mode", AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);
        AppCompatDelegate.setDefaultNightMode(mode);
    }

    private void showProcesses() {
        showingDumps = false;
        tabProcesses.setTextColor(0xFF3b82f6);
        tabProcesses.setTypeface(null, android.graphics.Typeface.BOLD);
        tabDumps.setTextColor(getThemeColor(R.attr.textSecondaryColor));
        tabDumps.setTypeface(null, android.graphics.Typeface.NORMAL);
        recyclerView.setAdapter(processAdapter);
        loadProcesses();
    }

    private void showDumps() {
        showingDumps = true;
        tabDumps.setTextColor(0xFF3b82f6);
        tabDumps.setTypeface(null, android.graphics.Typeface.BOLD);
        tabProcesses.setTextColor(getThemeColor(R.attr.textSecondaryColor));
        tabProcesses.setTypeface(null, android.graphics.Typeface.NORMAL);
        recyclerView.setAdapter(dumpAdapter);
        loadDumps();
    }

    private int getThemeColor(int attr) {
        android.util.TypedValue tv = new android.util.TypedValue();
        getTheme().resolveAttribute(attr, tv, true);
        return tv.data;
    }

    private void refresh() {
        if (showingDumps) loadDumps();
        else loadProcesses();
    }

    private void loadProcesses() {
        if (enrichTask != null) enrichTask.cancel(true);

        swipeRefresh.setRefreshing(true);
        statusText.setText("Loading\u2026");

        executor.execute(() -> {
            try {
                List<ProcessInfo> list = ShellHelper.getProcessList();
                runOnUiThread(() -> {
                    processAdapter.setProcesses(list);
                    String mode = ShellHelper.getAccessMode();
                    String modeLabel = "root".equals(mode) ? " [root]" :
                            "dump".equals(mode) ? " [dump perm]" : " [no access]";
                    statusText.setText(list.size() + " processes" + modeLabel
                            + " \u2022 tap \u2022 long-press to dump");
                    swipeRefresh.setRefreshing(false);
                    startEnrichment(list);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    statusText.setText("Error: " + e.getMessage());
                    appendLog("ERROR: " + e.toString());
                    swipeRefresh.setRefreshing(false);
                    // Auto-show log on error
                    if (!logVisible) toggleLog();
                });
            }
        });
    }

    private void startEnrichment(List<ProcessInfo> processes) {
        enrichTask = executor.submit(() -> {
            for (ProcessInfo p : processes) {
                if (Thread.currentThread().isInterrupted()) return;
                try {
                    MemInfo info = ShellHelper.getMemInfo(p.pid);
                    p.applyMemInfo(info);
                    runOnUiThread(() -> processAdapter.notifyProcessEnriched(p.pid));
                } catch (Exception e) {
                    // Process may have died
                }
            }
        });
    }

    private void loadDumps() {
        swipeRefresh.setRefreshing(true);
        executor.execute(() -> {
            List<ShellHelper.HprofFile> dumps = ShellHelper.listDumps();
            runOnUiThread(() -> {
                dumpAdapter.setDumps(dumps);
                statusText.setText(dumps.isEmpty() ? "No dumps yet" :
                        dumps.size() + " dump" + (dumps.size() > 1 ? "s" : ""));
                swipeRefresh.setRefreshing(false);
            });
        });
    }

    private void onProcessClick(ProcessInfo process) {
        Intent intent = new Intent(this, DetailActivity.class);
        intent.putExtra("process", process);
        startActivity(intent);
    }

    private void onProcessLongClick(ProcessInfo process) {
        SharedPreferences prefs = getSharedPreferences("ahat_prefs", MODE_PRIVATE);
        boolean bitmaps = prefs.getBoolean("include_bitmaps", false);

        String[] options = bitmaps ?
                new String[]{"Dump heap (+ bitmaps)", "Dump heap (no bitmaps)", "Cancel"} :
                new String[]{"Dump heap", "Dump heap (+ bitmaps)", "Cancel"};

        new AlertDialog.Builder(this)
                .setTitle(process.name + " (PID " + process.pid + ")")
                .setItems(options, (d, which) -> {
                    if (options[which].equals("Cancel")) return;
                    boolean withBmp = options[which].contains("bitmap");
                    startDump(process, withBmp);
                })
                .show();
    }

    private void startDump(ProcessInfo process, boolean withBitmaps) {
        if (enrichTask != null) enrichTask.cancel(true);

        progressContainer.setVisibility(View.VISIBLE);
        progressText.setText("Starting dump\u2026");

        executor.execute(() -> {
            try {
                String path = ShellHelper.dumpHeap(process.pid, withBitmaps,
                        msg -> runOnUiThread(() -> progressText.setText(msg)));

                runOnUiThread(() -> {
                    progressContainer.setVisibility(View.GONE);
                    openDump(path, process.name + ".hprof");
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    progressContainer.setVisibility(View.GONE);
                    new AlertDialog.Builder(this)
                            .setTitle("Dump failed")
                            .setMessage(e.getMessage())
                            .setPositiveButton("OK", null)
                            .show();
                });
            }
        });
    }

    private void openDump(String path, String name) {
        Intent intent = new Intent(this, ViewerActivity.class);
        intent.putExtra("hprof_path", path);
        intent.putExtra("process_name", name.replace(".hprof", ""));
        startActivity(intent);
    }

    private void shareDump(String path) {
        File file = new File(path);
        if (!file.exists()) return;
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_STREAM, Uri.fromFile(file));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(intent, "Share heap dump"));
    }

    private void confirmDelete(ShellHelper.HprofFile dump) {
        new AlertDialog.Builder(this)
                .setTitle("Delete dump?")
                .setMessage(dump.name + " (" + ShellHelper.formatSize(dump.size) + ")")
                .setPositiveButton("Delete", (d, w) -> {
                    ShellHelper.deleteDump(dump.path);
                    loadDumps();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        ShellHelper.setLogCallback(null);
        if (enrichTask != null) enrichTask.cancel(true);
        executor.shutdownNow();
    }
}
