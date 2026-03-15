package com.ahat.heapdumper;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
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
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
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
    private TextView memInfoBar;
    private HorizontalScrollView stateSummaryScroll;
    private LinearLayout stateSummaryBar;
    private final StringBuilder logBuffer = new StringBuilder();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private boolean showingDumps = false;
    private boolean logVisible = false;
    private List<ProcessInfo> currentProcesses;
    private boolean viewingSnapshot = false;
    private long snapshotTimestamp;
    private static long lastLightweightSnapshotMs;
    /** Previous process states keyed by "pid:name" for detecting OOM label changes. */
    private final java.util.HashMap<String, PrevState> prevStates = new java.util.HashMap<>();

    private static class PrevState {
        final String oomLabel;
        final long lastChangedMs;
        PrevState(String oomLabel, long lastChangedMs) {
            this.oomLabel = oomLabel;
            this.lastChangedMs = lastChangedMs;
        }
    }

    private final BroadcastReceiver enrichDoneReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (isFinishing() || isDestroyed()) return;
            btnEnrichAll.setText("Enrich All");
            btnEnrichAll.setEnabled(true);
            appendLog("Enrichment complete \u2014 snapshot saved");
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
        memInfoBar = findViewById(R.id.memInfoBar);
        stateSummaryScroll = findViewById(R.id.stateSummaryScroll);
        stateSummaryBar = findViewById(R.id.stateSummaryBar);

        recyclerView.setLayoutManager(new LinearLayoutManager(this));

        ShellHelper.setLogCallback(msg -> runOnUiThread(() -> appendLog(msg)));
        ShellHelper.setContext(this);
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
        findViewById(R.id.btnRecord).setOnClickListener(v -> showRecordDialog());
        findViewById(R.id.btnSettings).setOnClickListener(v ->
                startActivity(new Intent(this, SettingsActivity.class)));
        findViewById(R.id.btnDumps).setOnClickListener(v -> showDumps());
        findViewById(R.id.btnLog).setOnClickListener(v -> toggleLog());
        findViewById(R.id.btnHistory).setOnClickListener(v ->
                startActivity(new Intent(this, HistoryActivity.class)));

        IntentFilter filter = new IntentFilter(EnrichService.ACTION_DONE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(enrichDoneReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(enrichDoneReceiver, filter);
        }

        searchInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override public void afterTextChanged(Editable s) {
                processAdapter.setFilter(s.toString());
                buildStateSummaryBar();
            }
        });

        sortName.setOnClickListener(v -> onSortClicked(ProcessAdapter.SortField.NAME));
        sortPid.setOnClickListener(v -> onSortClicked(ProcessAdapter.SortField.PID));
        sortState.setOnClickListener(v -> onSortClicked(ProcessAdapter.SortField.STATE));
        sortMem.setOnClickListener(v -> onSortClicked(ProcessAdapter.SortField.MEM));
        colPss.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.PSS));
        colJava.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.JAVA));
        colNative.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.NATIVE));
        colCode.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.CODE));
        colGraphics.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.GRAPHICS));
        colRss.setOnClickListener(v -> onMemColumnClicked(ProcessAdapter.MemColumn.RSS));

        // Check if we're viewing a snapshot from HistoryActivity
        long snapTs = getIntent().getLongExtra("snapshot_timestamp", 0);
        if (snapTs > 0) {
            loadSnapshotView(snapTs);
        } else {
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
    }

    // ── Snapshot viewing mode ────────────────────────────────────────────────

    private void loadSnapshotView(long timestamp) {
        viewingSnapshot = true;
        snapshotTimestamp = timestamp;
        executor.execute(() -> {
            Snapshot snap = SnapshotStore.load(this, timestamp);
            if (snap == null) {
                runOnUiThread(this::finish);
                return;
            }
            List<ProcessInfo> procs = new ArrayList<>();
            for (Snapshot.ProcessSnapshot ps : snap.processes) {
                procs.add(ps.toProcessInfo());
            }
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                currentProcesses = procs;
                processAdapter.setProcesses(procs);
                SimpleDateFormat sdf = new SimpleDateFormat("MMM d, HH:mm:ss", Locale.US);
                String label = snap.enriched ? "" : " (states only)";
                statusText.setText("\u23F1 " + sdf.format(new Date(timestamp)) + label
                        + " \u2022 " + procs.size() + " procs");
                // Show global memory from snapshot
                if (snap.memTotalKb > 0) {
                    long used = snap.memUsedKb();
                    int pct = snap.memTotalKb > 0 ? (int) ((used * 100) / snap.memTotalKb) : 0;
                    StringBuilder mem = new StringBuilder();
                    mem.append("RAM: ").append(ShellHelper.formatKb(used))
                       .append(" / ").append(ShellHelper.formatKb(snap.memTotalKb))
                       .append(" (").append(pct).append("%)");
                    mem.append("  Avail: ").append(ShellHelper.formatKb(snap.memAvailableKb));
                    if (snap.swapTotalKb > 0) {
                        mem.append("  Swap: ").append(ShellHelper.formatKb(snap.swapTotalKb - snap.swapFreeKb))
                           .append(" / ").append(ShellHelper.formatKb(snap.swapTotalKb));
                    }
                    memInfoBar.setText(mem.toString());
                    memInfoBar.setVisibility(View.VISIBLE);
                }

                // Keep swipeRefresh enabled — pull down exits snapshot and fetches live
                btnEnrichAll.setVisibility(View.GONE);
                findViewById(R.id.btnScheduleEnrich).setVisibility(View.GONE);
                findViewById(R.id.btnRecord).setVisibility(View.GONE);
                buildStateSummaryBar();
            });
        });
    }

    // ── State summary bar ────────────────────────────────────────────────────

    private void buildStateSummaryBar() {
        if (currentProcesses == null || currentProcesses.isEmpty()) {
            stateSummaryScroll.setVisibility(View.GONE);
            return;
        }

        String textFilter = searchInput.getText().toString();
        LinkedHashMap<String, Integer> counts = ProcessAdapter.computeStateCounts(
                currentProcesses, textFilter);

        stateSummaryBar.removeAllViews();

        // "All" chip
        int total = 0;
        for (int c : counts.values()) total += c;
        addStateChip("All: " + total, null);

        for (java.util.Map.Entry<String, Integer> e : counts.entrySet()) {
            addStateChip(e.getKey() + ": " + e.getValue(), e.getKey());
        }

        stateSummaryScroll.setVisibility(View.VISIBLE);
    }

    private void addStateChip(String text, String stateLabel) {
        TextView chip = new TextView(this);
        chip.setText(text);
        chip.setTextSize(11);
        chip.setTypeface(Typeface.MONOSPACE);
        int pad = (int) (6 * getResources().getDisplayMetrics().density);
        chip.setPadding(pad * 2, pad, pad * 2, pad);

        boolean active = (stateLabel == null && processAdapter.getStateFilter() == null)
                || (stateLabel != null && stateLabel.equals(processAdapter.getStateFilter()));

        if (active && stateLabel != null) {
            int badgeColor = ProcessAdapter.getBadgeColor(stateLabel);
            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.RECTANGLE);
            bg.setCornerRadius(12f);
            bg.setColor(badgeColor);
            chip.setBackground(bg);
            chip.setTextColor(0xFFFFFFFF);
        } else if (active) {
            chip.setTextColor(0xFF3b82f6);
            chip.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        } else {
            chip.setTextColor(getThemeColor(R.attr.textSecondaryColor));
        }

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd((int) (4 * getResources().getDisplayMetrics().density));
        chip.setLayoutParams(lp);

        chip.setOnClickListener(v -> {
            if (stateLabel == null) {
                // "All" chip — clear filter
                processAdapter.setStateFilter(null);
            } else if (stateLabel.equals(processAdapter.getStateFilter())) {
                // Same chip — toggle off
                processAdapter.setStateFilter(null);
            } else {
                processAdapter.setStateFilter(stateLabel);
            }
            buildStateSummaryBar();
        });

        stateSummaryBar.addView(chip);
    }

    // ── Recording (recurring snapshots) ──────────────────────────────────────

    private void showRecordDialog() {
        if (EnrichService.running) {
            appendLog("Service already running");
            return;
        }

        float dp = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * dp);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(pad, pad, pad, 0);

        // Interval input
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setHint("Seconds between snapshots");
        input.setTextSize(16);
        layout.addView(input);

        // Enrich checkbox
        android.widget.CheckBox enrichCheck = new android.widget.CheckBox(this);
        enrichCheck.setText("Enrich selected processes");
        enrichCheck.setChecked(false);
        LinearLayout.LayoutParams cbLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        cbLp.topMargin = (int) (12 * dp);
        enrichCheck.setLayoutParams(cbLp);
        layout.addView(enrichCheck);

        // Process multi-select (initially hidden)
        List<String> names = new ArrayList<>();
        if (currentProcesses != null) {
            java.util.TreeSet<String> unique = new java.util.TreeSet<>();
            for (ProcessInfo p : currentProcesses) unique.add(p.name);
            names.addAll(unique);
        }

        android.widget.ListView listView = new android.widget.ListView(this);
        listView.setChoiceMode(android.widget.AbsListView.CHOICE_MODE_MULTIPLE);
        android.widget.ArrayAdapter<String> listAdapter = new android.widget.ArrayAdapter<>(
                this, android.R.layout.simple_list_item_multiple_choice, names);
        listView.setAdapter(listAdapter);
        LinearLayout.LayoutParams lvLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, (int) (300 * dp));
        lvLp.topMargin = (int) (8 * dp);
        listView.setLayoutParams(lvLp);
        listView.setVisibility(View.GONE);
        layout.addView(listView);

        enrichCheck.setOnCheckedChangeListener((btn, checked) ->
                listView.setVisibility(checked ? View.VISIBLE : View.GONE));

        new AlertDialog.Builder(this)
                .setTitle("Record snapshots")
                .setMessage("Capture snapshots every X seconds.\nCheck below to also enrich selected processes.")
                .setView(layout)
                .setPositiveButton("Start", (d, w) -> {
                    String text = input.getText().toString().trim();
                    int seconds = 0;
                    try { seconds = Integer.parseInt(text); } catch (NumberFormatException ignored) {}
                    if (seconds <= 0) return;

                    boolean enrich = enrichCheck.isChecked();
                    ArrayList<String> selectedNames = null;
                    if (enrich) {
                        selectedNames = new ArrayList<>();
                        android.util.SparseBooleanArray checked =
                                listView.getCheckedItemPositions();
                        for (int i = 0; i < checked.size(); i++) {
                            if (checked.valueAt(i)) {
                                selectedNames.add(names.get(checked.keyAt(i)));
                            }
                        }
                        if (selectedNames.isEmpty()) {
                            enrich = false;
                            selectedNames = null;
                        }
                    }
                    startRecording(seconds, enrich, selectedNames);
                })
                .setNegativeButton("Cancel", null)
                .show();
        input.requestFocus();
    }

    private void startRecording(int intervalSeconds, boolean enrichEnabled,
                                ArrayList<String> enrichNames) {
        if (EnrichService.running) return;
        btnEnrichAll.setText("Cancel");
        btnEnrichAll.setEnabled(true);
        EnrichService.pendingProcesses = null;
        EnrichService.enrichEnabled = enrichEnabled;
        EnrichService.enrichNames = enrichNames;
        try {
            Intent serviceIntent = new Intent(this, EnrichService.class);
            serviceIntent.putExtra("recurring_interval_seconds", intervalSeconds);
            ContextCompat.startForegroundService(this, serviceIntent);
            String msg = enrichEnabled
                    ? "Recording every " + intervalSeconds + "s (enriching "
                        + enrichNames.size() + " processes)"
                    : "Recording every " + intervalSeconds + "s (lightweight)";
            appendLog(msg);
        } catch (Exception e) {
            appendLog("ERROR starting service: " + e.getMessage());
            btnEnrichAll.setText("Enrich All");
            btnEnrichAll.setEnabled(true);
        }
    }

    // ── State change detection ─────────────────────────────────────────────

    /** Compare current process list against previous, set lastChangedMs on each. */
    private void computeStateChanges(List<ProcessInfo> list) {
        long now = System.currentTimeMillis();
        boolean firstFetch = prevStates.isEmpty();
        java.util.HashMap<String, PrevState> newStates = new java.util.HashMap<>();

        for (ProcessInfo p : list) {
            String key = p.pid + ":" + p.name;
            PrevState prev = prevStates.get(key);

            if (firstFetch) {
                // First fetch — no previous data to compare, leave at 0
                p.lastChangedMs = 0;
            } else if (prev == null) {
                // New process appeared after first fetch
                p.lastChangedMs = now;
            } else if (!prev.oomLabel.equals(p.oomLabel)) {
                // OOM label changed
                p.lastChangedMs = now;
            } else {
                // Same state — carry forward
                p.lastChangedMs = prev.lastChangedMs;
            }

            newStates.put(key, new PrevState(p.oomLabel, p.lastChangedMs));
        }

        prevStates.clear();
        prevStates.putAll(newStates);
    }

    // ── Core UI ──────────────────────────────────────────────────────────────

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
        if (!viewingSnapshot) {
            if (EnrichService.running) {
                btnEnrichAll.setText("Cancel");
            } else {
                btnEnrichAll.setText("Enrich All");
            }
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
        tabProcesses.setTypeface(null, Typeface.BOLD);
        tabDumps.setTextColor(getThemeColor(R.attr.textSecondaryColor));
        tabDumps.setTypeface(null, Typeface.NORMAL);
        searchSortBar.setVisibility(View.VISIBLE);
        btnEnrichAll.setVisibility(viewingSnapshot ? View.GONE : View.VISIBLE);
        recyclerView.setAdapter(processAdapter);
        if (processAdapter.getItemCount() == 0 && !viewingSnapshot) loadProcesses();
    }

    private void showDumps() {
        showingDumps = true;
        tabDumps.setTextColor(0xFF3b82f6);
        tabDumps.setTypeface(null, Typeface.BOLD);
        tabProcesses.setTextColor(getThemeColor(R.attr.textSecondaryColor));
        tabProcesses.setTypeface(null, Typeface.NORMAL);
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
        sortName.setTypeface(null, active == ProcessAdapter.SortField.NAME ? Typeface.BOLD : Typeface.NORMAL);
        sortName.setText(active == ProcessAdapter.SortField.NAME ? "Name" + arrow : "Name");

        sortPid.setTextColor(active == ProcessAdapter.SortField.PID ? activeColor : inactiveColor);
        sortPid.setTypeface(null, active == ProcessAdapter.SortField.PID ? Typeface.BOLD : Typeface.NORMAL);
        sortPid.setText(active == ProcessAdapter.SortField.PID ? "PID" + arrow : "PID");

        sortState.setTextColor(active == ProcessAdapter.SortField.STATE ? activeColor : inactiveColor);
        sortState.setTypeface(null, active == ProcessAdapter.SortField.STATE ? Typeface.BOLD : Typeface.NORMAL);
        sortState.setText(active == ProcessAdapter.SortField.STATE ? "State" + arrow : "State");

        String memLabel = processAdapter.getMemColumn().label;
        sortMem.setTextColor(active == ProcessAdapter.SortField.MEM ? activeColor : inactiveColor);
        sortMem.setTypeface(null, active == ProcessAdapter.SortField.MEM ? Typeface.BOLD : Typeface.NORMAL);
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
            buttons[i].setTypeface(null, isActive ? Typeface.BOLD : Typeface.NORMAL);
        }
        updateSortButtons();
    }

    private int getThemeColor(int attr) {
        android.util.TypedValue tv = new android.util.TypedValue();
        getTheme().resolveAttribute(attr, tv, true);
        return tv.data;
    }

    private void refresh() {
        if (viewingSnapshot) {
            // Exit snapshot view and fetch live data
            viewingSnapshot = false;
            swipeRefresh.setEnabled(true);
            btnEnrichAll.setVisibility(View.VISIBLE);
            findViewById(R.id.btnScheduleEnrich).setVisibility(View.VISIBLE);
            findViewById(R.id.btnRecord).setVisibility(View.VISIBLE);
            loadProcesses();
            return;
        }
        if (showingDumps) loadDumps();
        else loadProcesses();
    }

    private void loadProcesses() {
        if (viewingSnapshot) return;
        swipeRefresh.setRefreshing(true);
        statusText.setText("Loading\u2026");

        executor.execute(() -> {
            try {
                List<ProcessInfo> list = ShellHelper.getProcessList();
                GlobalMemInfo gmi = GlobalMemInfo.read();
                computeStateChanges(list);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    currentProcesses = list;
                    processAdapter.setProcesses(list);
                    String mode = ShellHelper.getAccessMode();
                    String modeLabel = "root".equals(mode) ? " [root]" :
                            "dump".equals(mode) ? " [dump perm]" : " [no access]";
                    statusText.setText(list.size() + " processes" + modeLabel);
                    swipeRefresh.setRefreshing(false);

                    // Show global memory
                    if (gmi.memTotalKb > 0) {
                        memInfoBar.setText(gmi.summary());
                        memInfoBar.setVisibility(View.VISIBLE);
                    }

                    buildStateSummaryBar();
                });

                // Save lightweight snapshot (throttle: max once per 10s)
                long now = System.currentTimeMillis();
                if (now - lastLightweightSnapshotMs > 10_000) {
                    lastLightweightSnapshotMs = now;
                    try {
                        Snapshot snap = Snapshot.fromProcessListAll(list);
                        snap.setGlobalMem(gmi);
                        SnapshotStore.save(MainActivity.this, snap);
                    } catch (Exception e) {
                        Log.w("ahat", "Failed to save lightweight snapshot", e);
                    }
                }
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    statusText.setText("Error: " + e.getMessage());
                    appendLog("ERROR: " + e.toString());
                    swipeRefresh.setRefreshing(false);
                    if (!logVisible) toggleLog();
                });
            }
        });
    }

    private void enrichAll() {
        if (EnrichService.running) {
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
            appendLog("Service already running");
            return;
        }

        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setHint("Seconds");
        input.setTextSize(16);
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
            appendLog("Service already running");
            return;
        }

        btnEnrichAll.setText("Cancel");
        btnEnrichAll.setEnabled(true);

        if (delaySeconds == 0) {
            // Respect active state filter — only enrich filtered processes
            String sf = processAdapter.getStateFilter();
            if (sf != null) {
                ArrayList<ProcessInfo> filtered = new ArrayList<>();
                for (ProcessInfo p : currentProcesses) {
                    if (sf.equals(p.oomLabel)) filtered.add(p);
                }
                EnrichService.pendingProcesses = filtered;
            } else {
                EnrichService.pendingProcesses = new ArrayList<>(currentProcesses);
            }
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
                int count = EnrichService.pendingProcesses != null
                        ? EnrichService.pendingProcesses.size() : 0;
                String filter = processAdapter.getStateFilter();
                String msg = "Started enrichment for " + count + " processes";
                if (filter != null) msg += " [" + filter + "]";
                appendLog(msg);
            }
        } catch (Exception e) {
            appendLog("ERROR starting service: " + e.getMessage());
            Log.e("ahat", "Failed to start EnrichService", e);
            btnEnrichAll.setText("Enrich All");
            btnEnrichAll.setEnabled(true);
        }
    }

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
            sb.append("\nNot enriched \u2014 tap to enrich");
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
