package com.ahat.heapdumper;

import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;

/**
 * Compares two snapshots side-by-side, showing per-process memory deltas.
 */
public class DiffActivity extends AppCompatActivity {

    public enum MemColumn {
        PSS("PSS"), JAVA("Java"), NATIVE("Native"), CODE("Code"),
        GRAPHICS("Graphics"), RSS("RSS");
        public final String label;
        MemColumn(String l) { this.label = l; }
    }

    public enum SortMode { DELTA, ABSOLUTE, NAME }

    private DiffAdapter adapter;
    private Snapshot snapshotA, snapshotB;
    private MemColumn memColumn = MemColumn.PSS;
    private SortMode sortMode = SortMode.DELTA;

    private TextView colPss, colJava, colNative, colCode, colGraphics, colRss;
    private TextView sortDelta, sortAbs, sortName;
    private HorizontalScrollView stateFilterScroll;
    private LinearLayout stateFilterBar;
    private String stateFilter; // null = show all
    private List<DiffAdapter.DiffRow> allRows; // unfiltered

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_diff);

        long tsA = getIntent().getLongExtra("timestamp_a", 0);
        long tsB = getIntent().getLongExtra("timestamp_b", 0);

        snapshotA = SnapshotStore.load(this, tsA);
        snapshotB = SnapshotStore.load(this, tsB);
        if (snapshotA == null || snapshotB == null) { finish(); return; }

        findViewById(R.id.btnBack).setOnClickListener(v -> finish());

        SimpleDateFormat sdf = new SimpleDateFormat("MMM d, HH:mm", Locale.US);
        ((TextView) findViewById(R.id.timeA)).setText("A: " + sdf.format(new Date(tsA)));
        ((TextView) findViewById(R.id.timeB)).setText("B: " + sdf.format(new Date(tsB)));

        // Column selectors
        colPss = findViewById(R.id.colPss);
        colJava = findViewById(R.id.colJava);
        colNative = findViewById(R.id.colNative);
        colCode = findViewById(R.id.colCode);
        colGraphics = findViewById(R.id.colGraphics);
        colRss = findViewById(R.id.colRss);

        colPss.setOnClickListener(v -> setColumn(MemColumn.PSS));
        colJava.setOnClickListener(v -> setColumn(MemColumn.JAVA));
        colNative.setOnClickListener(v -> setColumn(MemColumn.NATIVE));
        colCode.setOnClickListener(v -> setColumn(MemColumn.CODE));
        colGraphics.setOnClickListener(v -> setColumn(MemColumn.GRAPHICS));
        colRss.setOnClickListener(v -> setColumn(MemColumn.RSS));

        // Sort selectors
        sortDelta = findViewById(R.id.sortDelta);
        sortAbs = findViewById(R.id.sortAbs);
        sortName = findViewById(R.id.sortName);

        sortDelta.setOnClickListener(v -> setSort(SortMode.DELTA));
        sortAbs.setOnClickListener(v -> setSort(SortMode.ABSOLUTE));
        sortName.setOnClickListener(v -> setSort(SortMode.NAME));

        stateFilterScroll = findViewById(R.id.diffStateFilterScroll);
        stateFilterBar = findViewById(R.id.diffStateFilterBar);

        RecyclerView recycler = findViewById(R.id.recyclerView);
        recycler.setLayoutManager(new LinearLayoutManager(this));
        adapter = new DiffAdapter();
        adapter.setOnRowClickListener(this::showProcessDetail);
        recycler.setAdapter(adapter);

        showGlobalMemDiff();
        showStateSummaryDiff();
        computeDiff();
        buildStateFilterBar();
        updateColumnButtons();
        updateSortButtons();
    }

    private void showGlobalMemDiff() {
        TextView globalMem = findViewById(R.id.globalMemDiff);
        if (globalMem == null) return;
        StringBuilder sb = new StringBuilder();
        if (snapshotA.memTotalKb > 0 && snapshotB.memTotalKb > 0) {
            long usedA = snapshotA.memUsedKb();
            long usedB = snapshotB.memUsedKb();
            long delta = usedB - usedA;
            String sign = delta > 0 ? "+" : "";
            sb.append("RAM used: ").append(ShellHelper.formatKb(usedA))
              .append(" \u2192 ").append(ShellHelper.formatKb(usedB))
              .append(" (").append(sign).append(ShellHelper.formatKb(delta)).append(")");
            if (snapshotA.memAvailableKb > 0) {
                long availDelta = snapshotB.memAvailableKb - snapshotA.memAvailableKb;
                String availSign = availDelta > 0 ? "+" : "";
                sb.append("\nAvail: ").append(ShellHelper.formatKb(snapshotA.memAvailableKb))
                  .append(" \u2192 ").append(ShellHelper.formatKb(snapshotB.memAvailableKb))
                  .append(" (").append(availSign).append(ShellHelper.formatKb(availDelta)).append(")");
            }
        } else if (snapshotA.memTotalKb > 0) {
            long usedA = snapshotA.memUsedKb();
            int pct = (int) ((usedA * 100) / snapshotA.memTotalKb);
            sb.append("RAM A: ").append(ShellHelper.formatKb(usedA))
              .append(" / ").append(ShellHelper.formatKb(snapshotA.memTotalKb))
              .append(" (").append(pct).append("%)");
        } else if (snapshotB.memTotalKb > 0) {
            long usedB = snapshotB.memUsedKb();
            int pct = (int) ((usedB * 100) / snapshotB.memTotalKb);
            sb.append("RAM B: ").append(ShellHelper.formatKb(usedB))
              .append(" / ").append(ShellHelper.formatKb(snapshotB.memTotalKb))
              .append(" (").append(pct).append("%)");
        }
        if (sb.length() > 0) {
            globalMem.setText(sb.toString());
            globalMem.setVisibility(android.view.View.VISIBLE);
        } else {
            globalMem.setVisibility(android.view.View.GONE);
        }
    }

    private void showStateSummaryDiff() {
        TextView stateSummary = findViewById(R.id.stateSummaryDiff);
        if (stateSummary == null) return;

        // Count states in each snapshot
        Map<String, Integer> countsA = new LinkedHashMap<>();
        for (Snapshot.ProcessSnapshot p : snapshotA.processes) {
            countsA.merge(p.oomLabel, 1, Integer::sum);
        }
        Map<String, Integer> countsB = new LinkedHashMap<>();
        for (Snapshot.ProcessSnapshot p : snapshotB.processes) {
            countsB.merge(p.oomLabel, 1, Integer::sum);
        }

        // Build diff string
        java.util.TreeSet<String> allStates = new java.util.TreeSet<>();
        allStates.addAll(countsA.keySet());
        allStates.addAll(countsB.keySet());

        StringBuilder sb = new StringBuilder();
        sb.append("Procs: ").append(snapshotA.processes.size())
          .append(" \u2192 ").append(snapshotB.processes.size());

        // Count state transitions
        Map<String, Snapshot.ProcessSnapshot> mapA = new LinkedHashMap<>();
        for (Snapshot.ProcessSnapshot p : snapshotA.processes) mapA.put(p.name, p);
        Map<String, Snapshot.ProcessSnapshot> mapB = new LinkedHashMap<>();
        for (Snapshot.ProcessSnapshot p : snapshotB.processes) mapB.put(p.name, p);

        int stateChanges = 0, added = 0, removed = 0;
        for (String name : mapB.keySet()) {
            if (!mapA.containsKey(name)) added++;
            else if (!mapA.get(name).oomLabel.equals(mapB.get(name).oomLabel)) stateChanges++;
        }
        for (String name : mapA.keySet()) {
            if (!mapB.containsKey(name)) removed++;
        }

        if (stateChanges > 0) sb.append(" | ").append(stateChanges).append(" state changes");
        if (added > 0) sb.append(" | +").append(added).append(" new");
        if (removed > 0) sb.append(" | -").append(removed).append(" removed");

        // Per-state counts (all states, highlight changes)
        sb.append("\n");
        for (String state : allStates) {
            int cA = countsA.getOrDefault(state, 0);
            int cB = countsB.getOrDefault(state, 0);
            sb.append(state).append(": ").append(cA);
            if (cA != cB) {
                sb.append("\u2192").append(cB);
            }
            sb.append("  ");
        }

        stateSummary.setText(sb.toString().trim());
        stateSummary.setVisibility(android.view.View.VISIBLE);
    }

    private void showProcessDetail(DiffAdapter.DiffRow row) {
        StringBuilder sb = new StringBuilder();

        // Always show state
        if (row.oldState != null && row.newState != null) {
            if (row.oldState.equals(row.newState)) {
                sb.append("State: ").append(row.newState).append("\n");
            } else {
                sb.append("State: ").append(row.oldState).append(" \u2192 ").append(row.newState).append("\n");
            }
        } else if (row.onlyInB) {
            sb.append("New process (").append(row.newState).append(")\n");
        } else if (row.onlyInA) {
            sb.append("Removed (was ").append(row.oldState).append(")\n");
        }

        // PID
        if (row.procA != null) sb.append("PID: ").append(row.procA.pid);
        if (row.procB != null && (row.procA == null || row.procA.pid != row.procB.pid)) {
            sb.append(row.procA != null ? " \u2192 " : "PID: ").append(row.procB.pid);
        }
        sb.append("\n\n");

        // Header
        sb.append(String.format(Locale.US, "%-12s %10s %10s %10s\n", "", "A", "B", "Delta"));
        sb.append("────────────────────────────────────────\n");

        // All memory columns
        appendMemRow(sb, "PSS", row.procA, row.procB, p -> p.pssKb);
        appendMemRow(sb, "Java", row.procA, row.procB, p -> p.javaHeapKb);
        appendMemRow(sb, "Native", row.procA, row.procB, p -> p.nativeHeapKb);
        appendMemRow(sb, "Code", row.procA, row.procB, p -> p.codeKb);
        appendMemRow(sb, "Graphics", row.procA, row.procB, p -> p.graphicsKb);
        appendMemRow(sb, "RSS", row.procA, row.procB, p -> p.rssKb);

        new AlertDialog.Builder(this)
                .setTitle(row.name)
                .setMessage(sb.toString())
                .setPositiveButton("OK", null)
                .show();
    }

    private interface MemExtractor {
        long get(Snapshot.ProcessSnapshot p);
    }

    private void appendMemRow(StringBuilder sb, String label,
            Snapshot.ProcessSnapshot a, Snapshot.ProcessSnapshot b, MemExtractor ext) {
        long valA = a != null ? ext.get(a) : 0;
        long valB = b != null ? ext.get(b) : 0;
        long delta = valB - valA;
        String sign = delta > 0 ? "+" : "";
        sb.append(String.format(Locale.US, "%-12s %10s %10s %10s\n",
                label,
                a != null ? ShellHelper.formatKb(valA) : "--",
                b != null ? ShellHelper.formatKb(valB) : "--",
                sign + ShellHelper.formatKb(delta)));
    }

    private void setColumn(MemColumn col) {
        this.memColumn = col;
        computeDiff();
        updateColumnButtons();
    }

    private void setSort(SortMode mode) {
        this.sortMode = mode;
        computeDiff();
        updateSortButtons();
    }

    private void computeDiff() {
        allRows = computeDiffRows(snapshotA, snapshotB, memColumn, sortMode);
        applyStateFilter();
    }

    private void applyStateFilter() {
        if (stateFilter == null) {
            adapter.setRows(allRows);
        } else {
            List<DiffAdapter.DiffRow> filtered = new ArrayList<>();
            for (DiffAdapter.DiffRow r : allRows) {
                // Show if either old or new state matches the filter
                if (stateFilter.equals(r.oldState) || stateFilter.equals(r.newState)) {
                    filtered.add(r);
                }
            }
            adapter.setRows(filtered);
        }
    }

    /** Extract memory value from a ProcessSnapshot for a given column. */
    static long getMemValue(Snapshot.ProcessSnapshot p, MemColumn col) {
        switch (col) {
            case JAVA:     return p.javaHeapKb;
            case NATIVE:   return p.nativeHeapKb;
            case CODE:     return p.codeKb;
            case GRAPHICS: return p.graphicsKb;
            case RSS:      return p.rssKb;
            default:       return p.pssKb;
        }
    }

    /** Compute diff rows between two snapshots. Package-visible for testing. */
    static List<DiffAdapter.DiffRow> computeDiffRows(
            Snapshot a, Snapshot b, MemColumn col, SortMode sort) {
        Map<String, Snapshot.ProcessSnapshot> mapA = new LinkedHashMap<>();
        for (Snapshot.ProcessSnapshot p : a.processes) mapA.put(p.name, p);
        Map<String, Snapshot.ProcessSnapshot> mapB = new LinkedHashMap<>();
        for (Snapshot.ProcessSnapshot p : b.processes) mapB.put(p.name, p);

        List<String> allNames = new ArrayList<>(mapA.keySet());
        for (String name : mapB.keySet()) {
            if (!mapA.containsKey(name)) allNames.add(name);
        }

        List<DiffAdapter.DiffRow> rows = new ArrayList<>();
        for (String name : allNames) {
            Snapshot.ProcessSnapshot pa = mapA.get(name);
            Snapshot.ProcessSnapshot pb = mapB.get(name);
            long valA = pa != null ? getMemValue(pa, col) : 0;
            long valB = pb != null ? getMemValue(pb, col) : 0;

            DiffAdapter.DiffRow row = new DiffAdapter.DiffRow();
            row.name = name;
            row.oldValue = valA;
            row.newValue = valB;
            row.delta = valB - valA;
            row.onlyInA = (pb == null);
            row.onlyInB = (pa == null);
            row.oldState = pa != null ? pa.oomLabel : null;
            row.newState = pb != null ? pb.oomLabel : null;
            row.procA = pa;
            row.procB = pb;
            rows.add(row);
        }

        Comparator<DiffAdapter.DiffRow> cmp;
        switch (sort) {
            case ABSOLUTE:
                cmp = (x, y) -> Long.compare(Math.abs(y.delta), Math.abs(x.delta));
                break;
            case NAME:
                cmp = Comparator.comparing(x -> x.name);
                break;
            default:
                cmp = (x, y) -> Long.compare(y.delta, x.delta);
                break;
        }
        Collections.sort(rows, cmp);
        return rows;
    }

    private void buildStateFilterBar() {
        // Collect all states from both snapshots
        TreeSet<String> states = new TreeSet<>();
        for (Snapshot.ProcessSnapshot p : snapshotA.processes) states.add(p.oomLabel);
        for (Snapshot.ProcessSnapshot p : snapshotB.processes) states.add(p.oomLabel);

        if (states.isEmpty()) {
            stateFilterScroll.setVisibility(View.GONE);
            return;
        }

        stateFilterBar.removeAllViews();
        float dp = getResources().getDisplayMetrics().density;
        int pad = (int) (6 * dp);

        // "All" chip
        addFilterChip("All", null, pad);
        for (String state : states) {
            addFilterChip(state, state, pad);
        }
        stateFilterScroll.setVisibility(View.VISIBLE);
    }

    private void addFilterChip(String text, String state, int pad) {
        TextView chip = new TextView(this);
        chip.setText(text);
        chip.setTextSize(11);
        chip.setTypeface(Typeface.MONOSPACE);
        chip.setPadding(pad * 2, pad, pad * 2, pad);

        boolean active = (state == null && stateFilter == null)
                || (state != null && state.equals(stateFilter));

        if (active && state != null) {
            int badgeColor = ProcessAdapter.getBadgeColor(state);
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
            if (state == null || state.equals(stateFilter)) {
                stateFilter = null;
            } else {
                stateFilter = state;
            }
            applyStateFilter();
            buildStateFilterBar();
        });

        stateFilterBar.addView(chip);
    }

    private void updateColumnButtons() {
        int active = 0xFF3b82f6;
        int inactive = getThemeColor(R.attr.textSecondaryColor);
        TextView[] btns = { colPss, colJava, colNative, colCode, colGraphics, colRss };
        MemColumn[] cols = MemColumn.values();
        for (int i = 0; i < btns.length; i++) {
            boolean isActive = cols[i] == memColumn;
            btns[i].setTextColor(isActive ? active : inactive);
            btns[i].setTypeface(null, isActive
                    ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
        }
    }

    private void updateSortButtons() {
        int active = 0xFF3b82f6;
        int inactive = getThemeColor(R.attr.textSecondaryColor);

        sortDelta.setTextColor(sortMode == SortMode.DELTA ? active : inactive);
        sortDelta.setTypeface(null, sortMode == SortMode.DELTA
                ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);

        sortAbs.setTextColor(sortMode == SortMode.ABSOLUTE ? active : inactive);
        sortAbs.setTypeface(null, sortMode == SortMode.ABSOLUTE
                ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);

        sortName.setTextColor(sortMode == SortMode.NAME ? active : inactive);
        sortName.setTypeface(null, sortMode == SortMode.NAME
                ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
    }

    private int getThemeColor(int attr) {
        android.util.TypedValue tv = new android.util.TypedValue();
        getTheme().resolveAttribute(attr, tv, true);
        return tv.data;
    }
}
