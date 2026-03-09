package com.ahat.heapdumper;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
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

        // Wire up in-app log and dump dir
        ShellHelper.setLogCallback(msg -> runOnUiThread(() -> appendLog(msg)));
        File dumpsDir = getExternalFilesDir("dumps");
        if (dumpsDir != null) ShellHelper.setDumpDir(dumpsDir);

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
        recyclerView.setAdapter(processAdapter);
        // Only load if we haven't loaded yet (pull-to-refresh reloads)
        if (processAdapter.getItemCount() == 0) loadProcesses();
    }

    private void showDumps() {
        showingDumps = true;
        tabDumps.setTextColor(0xFF3b82f6);
        tabDumps.setTypeface(null, android.graphics.Typeface.BOLD);
        tabProcesses.setTextColor(getThemeColor(R.attr.textSecondaryColor));
        tabProcesses.setTypeface(null, android.graphics.Typeface.NORMAL);
        searchSortBar.setVisibility(View.GONE);
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

        // Also update sort button label if sorting by mem
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
                    if (!logVisible) toggleLog();
                });
            }
        });
    }

    /**
     * Per-process enrichment: calls `dumpsys meminfo <pid>` for each process
     * to get full breakdown (PSS, Java, Native, Code, Graphics, RSS).
     * Updates each row progressively as data comes in.
     */
    private void startEnrichment(List<ProcessInfo> processes) {
        enrichTask = executor.submit(() -> {
            int enriched = 0;
            for (ProcessInfo p : processes) {
                if (Thread.currentThread().isInterrupted()) return;
                try {
                    MemInfo info = ShellHelper.getMemInfo(p.pid);
                    if (info.totalPssKb > 0 || info.javaHeapKb > 0) {
                        p.applyMemInfo(info);
                        runOnUiThread(() -> processAdapter.notifyProcessEnriched(p.pid));
                        enriched++;
                    }
                } catch (Exception e) {
                    // Skip this process, continue with next
                }
            }
            final int count = enriched;
            runOnUiThread(() -> appendLog("Enriched " + count + "/" + processes.size() + " processes"));
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
