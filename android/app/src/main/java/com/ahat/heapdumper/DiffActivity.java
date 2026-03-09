package com.ahat.heapdumper;

import android.os.Bundle;
import android.widget.TextView;

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

        RecyclerView recycler = findViewById(R.id.recyclerView);
        recycler.setLayoutManager(new LinearLayoutManager(this));
        adapter = new DiffAdapter();
        recycler.setAdapter(adapter);

        computeDiff();
        updateColumnButtons();
        updateSortButtons();
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
        List<DiffAdapter.DiffRow> rows = computeDiffRows(snapshotA, snapshotB, memColumn, sortMode);
        adapter.setRows(rows);
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
