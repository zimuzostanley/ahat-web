package com.ahat.heapdumper;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private ProcessAdapter processAdapter;
    private DumpAdapter dumpAdapter;
    private SwipeRefreshLayout swipeRefresh;
    private RecyclerView recyclerView;
    private TextView statusText;
    private FrameLayout progressContainer;
    private TextView progressText;
    private TextView tabProcesses, tabDumps;
    private TextView btnEnrichAll;
    private LinearLayout searchSortBar;
    private EditText searchInput;
    private TextView sortName, sortPid, sortState, sortMem;
    private TextView colPss, colJava, colNative, colCode, colGraphics, colRss;
    private ScrollView logPanel;
    private TextView logText;
    private final StringBuilder logBuffer = new StringBuilder();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private boolean showingDumps = false;
    private boolean logVisible = false;
    private List<ProcessInfo> currentProcesses;

    private final BroadcastReceiver enrichDoneReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (isFinishing() || isDestroyed()) return;
            btnEnrichAll.setText("Enrich All");
            btnEnrichAll.setEnabled(true);
            appendLog("Enrichment complete — snapshot saved");
            // Reload processes to show enriched data
            if (currentProcesses != null) {
                processAdapter.notifyDataSetChanged();
            }
        }
    };

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
        btnEnrichAll = findViewById(R.id.btnEnrichAll);
        logPanel = findViewById(R.id.logPanel);
        logText = findViewById(R.id.logText);
        searchSortBar = findViewById(R.id.searchSortBar);
        searchInput = findViewById(R.id.searchInput);
        sortName = findViewById(R.id.sortName);
        sortPid = findViewById(R.id.sortPid);
        sortState = findViewById(R.id.sortState);
        sortMem = findViewById(R.id.sortMem);
        colPss = findViewById(R.id.colPss);
        colJava = findViewById(R.id.colJava);
        colNative = findViewById(R.id.colNative);
        colCode = findViewById(R.id.colCode);
        colGraphics = findViewById(R.id.colGraphics);
        colRss = findViewById(R.id.colRss);

        recyclerView.setLayoutManager(new LinearLayoutManager(this));

        // Wire up in-app log, context, and dump dir
        ShellHelper.setLogCallback(msg -> runOnUiThread(() -> appendLog(msg)));
        ShellHelper.setContext(this);
        // Use public Downloads/ahat on sdcard — world-writable, any process can write here
        File dumpsDir = new File(android.os.Environment.getExternalStoragePublicDirectory(
                android.os.Environment.DIRECTORY_DOWNLOADS), "ahat");
        ShellHelper.setDumpDir(dumpsDir);

        processAdapter = new ProcessAdapter();
        processAdapter.setOnClickListener(this::enrichAndOpen);
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

        // Request notification permission for FGS on Android 13+
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
            }
        }

        tabProcesses.setOnClickListener(v -> showProcesses());
        tabDumps.setOnClickListener(v -> showDumps());
        btnEnrichAll.setOnClickListener(v -> enrichAll());
        findViewById(R.id.btnScheduleEnrich).setOnClickListener(v -> showDelayedEnrichDialog());
        findViewById(R.id.btnSettings).setOnClickListener(v ->
                startActivity(new Intent(this, SettingsActivity.class)));
        findViewById(R.id.btnDumps).setOnClickListener(v -> showDumps());
        findViewById(R.id.btnLog).setOnClickListener(v -> toggleLog());
        findViewById(R.id.btnHistory).setOnClickListener(v ->
                startActivity(new Intent(this, HistoryActivity.class)));

        // Register broadcast receiver for enrich service completion
        IntentFilter filter = new IntentFilter(EnrichService.ACTION_DONE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(enrichDoneReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(enrichDoneReceiver, filter);
        }

        // Search filter
        searchInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override public void afterTextChanged(Editable s) {
                processAdapter.setFilter(s.toString());
            }
        });

        // Sort buttons
        sortName.setOnClickListener(v -> onSortClicked(ProcessAdapter.SortField.NAME));
        sortPid.setOnClickListener(v -> onSortClicked(ProcessAdapter.SortField.PID));
        sortState.setOnClickListener(v -> onSortClicked(ProcessAdapter.SortField.STATE));
        sortMem.setOnClickListener(v -> onSortClicked(ProcessAdapter.SortField.MEM));

        // Memory column selector
        colPss.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.PSS));
        colJava.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.JAVA));
        colNative.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.NATIVE));
        colCode.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.CODE));
        colGraphics.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.GRAPHICS));
        colRss.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.RSS));

        // Detect permissions + root, then load processes
        appendLog("ahat Heap Dumper starting...");
        appendLog("App UID: " + android.os.Process.myUid());
        executor.execute(() -> {
            ShellHelper.checkDumpPermission(this);
            ShellHelper.detectRoot();
            String mode = ShellHelper.getAccessMode();
            if ("none".equals(mode)) {
                runOnUiThread(() -> {
                    statusText.setText("Need permission \u2014 see log");
                    appendLog("No access. Grant permissions:");
                    appendLog("  adb shell pm grant com.ahat.heapdumper android.permission.DUMP");
                    appendLog("  adb shell pm grant com.ahat.heapdumper android.permission.PACKAGE_USAGE_STATS");
                    if (!logVisible) toggleLog();
                });
            }
            runOnUiThread(this::loadProcesses);
        });
    }

    private void appendLog(String msg) {
        logBuffer.append(msg).append('\n');
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
        // Sync button state with service
        if (EnrichService.running) {
            btnEnrichAll.setText("Cancel");
            btnEnrichAll.setEnabled(true);
        } else {
            btnEnrichAll.setText("Enrich All");
            btnEnrichAll.setEnabled(true);
        }
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
        searchSortBar.setVisibility(View.VISIBLE);
        btnEnrichAll.setVisibility(View.VISIBLE);
        recyclerView.setAdapter(processAdapter);
        if (processAdapter.getItemCount() == 0) loadProcesses();
    }

    private void showDumps() {
        showingDumps = true;
        tabDumps.setTextColor(0xFF3b82f6);
        tabDumps.setTypeface(null, android.graphics.Typeface.BOLD);
        tabProcesses.setTextColor(getThemeColor(R.attr.textSecondaryColor));
        tabProcesses.setTypeface(null, android.graphics.Typeface.NORMAL);
        searchSortBar.setVisibility(View.GONE);
        btnEnrichAll.setVisibility(View.GONE);
        recyclerView.setAdapter(dumpAdapter);
        loadDumps();
    }

    private void onSortClicked(ProcessAdapter.SortField field) {
        processAdapter.setSort(field);
        updateSortButtons();
    }

    private void onMemColumnClicked(ProcessAdapter.MemColumn col) {
        processAdapter.setMemColumn(col);
        updateMemColumnButtons();
    }

    private void updateSortButtons() {
        ProcessAdapter.SortField active = processAdapter.getSortField();
        boolean asc = processAdapter.isSortAscending();
        String arrow = asc ? " \u25B2" : " \u25BC";
        int activeColor = 0xFF3b82f6;
        int inactiveColor = getThemeColor(R.attr.textSecondaryColor);

        sortName.setTextColor(active == ProcessAdapter.SortField.NAME ? activeColor : inactiveColor);
        sortName.setTypeface(null, active == ProcessAdapter.SortField.NAME ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        sortName.setText(active == ProcessAdapter.SortField.NAME ? "Name" + arrow : "Name");

        sortPid.setTextColor(active == ProcessAdapter.SortField.PID ? activeColor : inactiveColor);
        sortPid.setTypeface(null, active == ProcessAdapter.SortField.PID ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        sortPid.setText(active == ProcessAdapter.SortField.PID ? "PID" + arrow : "PID");

        sortState.setTextColor(active == ProcessAdapter.SortField.STATE ? activeColor : inactiveColor);
        sortState.setTypeface(null, active == ProcessAdapter.SortField.STATE ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        sortState.setText(active == ProcessAdapter.SortField.STATE ? "State" + arrow : "State");

        String memLabel = processAdapter.getMemColumn().label;
        sortMem.setTextColor(active == ProcessAdapter.SortField.MEM ? activeColor : inactiveColor);
        sortMem.setTypeface(null, active == ProcessAdapter.SortField.MEM ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        sortMem.setText(active == ProcessAdapter.SortField.MEM ? memLabel + arrow : memLabel);
    }

    private void updateMemColumnButtons() {
        ProcessAdapter.MemColumn active = processAdapter.getMemColumn();
        int activeColor = 0xFF3b82f6;
        int inactiveColor = getThemeColor(R.attr.textSecondaryColor);

        TextView[] buttons = { colPss, colJava, colNative, colCode, colGraphics, colRss };
        ProcessAdapter.MemColumn[] cols = ProcessAdapter.MemColumn.values();
        for (int i = 0; i < buttons.length; i++) {
            boolean isActive = cols[i] == active;
            buttons[i].setTextColor(isActive ? activeColor : inactiveColor);
            buttons[i].setTypeface(null, isActive ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        }

        updateSortButtons();
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
        swipeRefresh.setRefreshing(true);
        statusText.setText("Loading\u2026");

        executor.execute(() -> {
            try {
                List<ProcessInfo> list = ShellHelper.getProcessList();
                runOnUiThread(() -> {
                    currentProcesses = list;
                    processAdapter.setProcesses(list);
                    String mode = ShellHelper.getAccessMode();
                    String modeLabel = "root".equals(mode) ? " [root]" :
                            "dump".equals(mode) ? " [dump perm]" : " [no access]";
                    statusText.setText(list.size() + " processes" + modeLabel);
                    swipeRefresh.setRefreshing(false);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    statusText.setText("Error: " + e.getMessage());
                    appendLog("ERROR: " + e.toString());
                    swipeRefresh.setRefreshing(false);
                    if (!logVisible) toggleLog();
                });
            }
        });
    }

    /** Triggered by "Enrich All" button — starts or cancels enrichment. */
    private void enrichAll() {
        if (EnrichService.running) {
            // Cancel running enrichment
            Intent stop = new Intent(this, EnrichService.class);
            stop.setAction(EnrichService.ACTION_STOP);
            startService(stop);
            btnEnrichAll.setText("Enrich All");
            btnEnrichAll.setEnabled(true);
            appendLog("Enrichment cancelled");
            return;
        }
        startEnrichService(0);
    }

    private void showDelayedEnrichDialog() {
        if (EnrichService.running) {
            appendLog("Enrichment already running");
            return;
        }

        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setHint("Seconds");
        input.setTextSize(16);
        input.setFontFeatureSettings("monospace");
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        input.setPadding(pad, pad, pad, pad);

        new AlertDialog.Builder(this)
                .setTitle("Delayed enrichment")
                .setMessage("Enrich after how many seconds?\nFetches fresh process list after the delay.")
                .setView(input)
                .setPositiveButton("Start", (d, w) -> {
                    String text = input.getText().toString().trim();
                    int seconds = 0;
                    try { seconds = Integer.parseInt(text); } catch (NumberFormatException ignored) {}
                    if (seconds > 0) {
                        startEnrichService(seconds);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();

        input.requestFocus();
    }

    private void startEnrichService(int delaySeconds) {
        if (delaySeconds == 0 && (currentProcesses == null || currentProcesses.isEmpty())) return;
        if (EnrichService.running) {
            appendLog("Enrichment already running");
            return;
        }

        btnEnrichAll.setText("Cancel");
        btnEnrichAll.setEnabled(true);

        // For immediate: pass current process list. For delayed: service fetches fresh list.
        if (delaySeconds == 0) {
            EnrichService.pendingProcesses = new ArrayList<>(currentProcesses);
        } else {
            EnrichService.pendingProcesses = null;
        }

        try {
            Intent serviceIntent = new Intent(this, EnrichService.class);
            serviceIntent.putExtra("delay_seconds", delaySeconds);
            ContextCompat.startForegroundService(this, serviceIntent);

            if (delaySeconds > 0) {
                appendLog("Enrichment scheduled in " + delaySeconds + "s");
            } else {
                appendLog("Started enrichment for " + currentProcesses.size() + " processes");
            }
        } catch (Exception e) {
            appendLog("ERROR starting service: " + e.getMessage());
            android.util.Log.e("ahat", "Failed to start EnrichService", e);
            btnEnrichAll.setText("Enrich All");
            btnEnrichAll.setEnabled(true);
        }
    }

    /** Enrich a single process (called before opening detail screen). */
    private void enrichAndOpen(ProcessInfo process) {
        if (process.enriched) {
            onProcessClick(process);
            return;
        }
        statusText.setText("Loading meminfo\u2026");
        executor.execute(() -> {
            try {
                MemInfo info = ShellHelper.getMemInfo(process.pid);
                process.applyMemInfo(info);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    processAdapter.notifyProcessEnriched(process.pid);
                    statusText.setText("");
                    onProcessClick(process);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    statusText.setText("");
                    // Open detail anyway, it'll try to fetch its own meminfo
                    onProcessClick(process);
                });
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
        StringBuilder sb = new StringBuilder();
        sb.append("PID: ").append(process.pid).append("\n");
        sb.append("OOM: ").append(process.oomLabel != null ? process.oomLabel : "?").append("\n");
        if (process.enriched) {
            sb.append("\nPSS: ").append(ShellHelper.formatKb(process.pssKb));
            sb.append("\nJava: ").append(ShellHelper.formatKb(process.javaHeapKb));
            sb.append("\nNative: ").append(ShellHelper.formatKb(process.nativeHeapKb));
            sb.append("\nCode: ").append(ShellHelper.formatKb(process.codeKb));
            sb.append("\nGraphics: ").append(ShellHelper.formatKb(process.graphicsKb));
            sb.append("\nRSS: ").append(ShellHelper.formatKb(process.rssKb));
        } else {
            sb.append("\nNot enriched — tap to enrich");
        }
        new AlertDialog.Builder(this)
                .setTitle(process.name)
                .setMessage(sb.toString())
                .setPositiveButton("OK", null)
                .show();
    }

    private void startDump(ProcessInfo process, boolean withBitmaps) {
        progressContainer.setVisibility(View.VISIBLE);
        progressText.setText("Starting dump\u2026");

        executor.execute(() -> {
            try {
                String path = ShellHelper.dumpHeap(process.pid, withBitmaps,
                        msg -> runOnUiThread(() -> {
                            if (!(isFinishing() || isDestroyed())) progressText.setText(msg);
                        }));

                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    progressContainer.setVisibility(View.GONE);
                    openDump(path, process.name + ".hprof");
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
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
        try { unregisterReceiver(enrichDoneReceiver); } catch (Exception ignored) {}
        ShellHelper.setLogCallback(null);
        executor.shutdownNow();
    }
}
