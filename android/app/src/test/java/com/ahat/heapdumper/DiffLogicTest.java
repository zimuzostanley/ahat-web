package com.ahat.heapdumper;

import org.junit.Test;
import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Tests for diff computation logic extracted from DiffActivity.
 * Covers: column selection, sort modes, process added/removed, delta calculation.
 */
public class DiffLogicTest {

    // ── Helper ──────────────────────────────────────────────────────────────────

    private Snapshot.ProcessSnapshot proc(String name, int pid,
            long pss, long rss, long java, long nativeH, long code, long gfx) {
        return new Snapshot.ProcessSnapshot(name, "", pid, pss, rss, java, nativeH, code, gfx);
    }

    private Snapshot snap(long ts, Snapshot.ProcessSnapshot... procs) {
        return new Snapshot(ts, Arrays.asList(procs));
    }

    // ── Basic diff ──────────────────────────────────────────────────────────────

    @Test
    public void basicDeltaCalculation() {
        Snapshot a = snap(1, proc("app1", 1, 1000, 0, 0, 0, 0, 0));
        Snapshot b = snap(2, proc("app1", 1, 1500, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(1, rows.size());
        assertEquals("app1", rows.get(0).name);
        assertEquals(1000, rows.get(0).oldValue);
        assertEquals(1500, rows.get(0).newValue);
        assertEquals(500, rows.get(0).delta);
        assertFalse(rows.get(0).onlyInA);
        assertFalse(rows.get(0).onlyInB);
    }

    @Test
    public void negativeDeltas() {
        Snapshot a = snap(1, proc("app1", 1, 5000, 0, 0, 0, 0, 0));
        Snapshot b = snap(2, proc("app1", 1, 3000, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(-2000, rows.get(0).delta);
    }

    @Test
    public void zeroDelta() {
        Snapshot a = snap(1, proc("app1", 1, 1000, 0, 0, 0, 0, 0));
        Snapshot b = snap(2, proc("app1", 1, 1000, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(0, rows.get(0).delta);
    }

    // ── Process added/removed ───────────────────────────────────────────────────

    @Test
    public void processOnlyInA() {
        Snapshot a = snap(1, proc("removed_app", 1, 2000, 0, 0, 0, 0, 0));
        Snapshot b = snap(2); // empty

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(1, rows.size());
        assertTrue(rows.get(0).onlyInA);
        assertFalse(rows.get(0).onlyInB);
        assertEquals(2000, rows.get(0).oldValue);
        assertEquals(0, rows.get(0).newValue);
        assertEquals(-2000, rows.get(0).delta);
    }

    @Test
    public void processOnlyInB() {
        Snapshot a = snap(1); // empty
        Snapshot b = snap(2, proc("new_app", 2, 3000, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(1, rows.size());
        assertFalse(rows.get(0).onlyInA);
        assertTrue(rows.get(0).onlyInB);
        assertEquals(0, rows.get(0).oldValue);
        assertEquals(3000, rows.get(0).newValue);
        assertEquals(3000, rows.get(0).delta);
    }

    @Test
    public void mixedAddedRemovedAndChanged() {
        Snapshot a = snap(1,
                proc("kept", 1, 1000, 0, 0, 0, 0, 0),
                proc("removed", 2, 500, 0, 0, 0, 0, 0));
        Snapshot b = snap(2,
                proc("kept", 1, 2000, 0, 0, 0, 0, 0),
                proc("added", 3, 800, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.NAME);

        assertEquals(3, rows.size());
        // Sorted by name: added, kept, removed
        assertEquals("added", rows.get(0).name);
        assertTrue(rows.get(0).onlyInB);
        assertEquals("kept", rows.get(1).name);
        assertEquals(1000, rows.get(1).delta);
        assertEquals("removed", rows.get(2).name);
        assertTrue(rows.get(2).onlyInA);
    }

    // ── Column selection ────────────────────────────────────────────────────────

    @Test
    public void diffUsesJavaColumn() {
        Snapshot a = snap(1, proc("app", 1, 100, 0, 5000, 0, 0, 0));
        Snapshot b = snap(2, proc("app", 1, 200, 0, 8000, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.JAVA, DiffActivity.SortMode.DELTA);

        assertEquals(5000, rows.get(0).oldValue);
        assertEquals(8000, rows.get(0).newValue);
        assertEquals(3000, rows.get(0).delta);
    }

    @Test
    public void diffUsesNativeColumn() {
        Snapshot a = snap(1, proc("app", 1, 0, 0, 0, 4000, 0, 0));
        Snapshot b = snap(2, proc("app", 1, 0, 0, 0, 6000, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.NATIVE, DiffActivity.SortMode.DELTA);

        assertEquals(2000, rows.get(0).delta);
    }

    @Test
    public void diffUsesCodeColumn() {
        Snapshot a = snap(1, proc("app", 1, 0, 0, 0, 0, 1000, 0));
        Snapshot b = snap(2, proc("app", 1, 0, 0, 0, 0, 1500, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.CODE, DiffActivity.SortMode.DELTA);

        assertEquals(500, rows.get(0).delta);
    }

    @Test
    public void diffUsesGraphicsColumn() {
        Snapshot a = snap(1, proc("app", 1, 0, 0, 0, 0, 0, 2000));
        Snapshot b = snap(2, proc("app", 1, 0, 0, 0, 0, 0, 3000));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.GRAPHICS, DiffActivity.SortMode.DELTA);

        assertEquals(1000, rows.get(0).delta);
    }

    @Test
    public void diffUsesRssColumn() {
        Snapshot a = snap(1, proc("app", 1, 0, 10000, 0, 0, 0, 0));
        Snapshot b = snap(2, proc("app", 1, 0, 15000, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.RSS, DiffActivity.SortMode.DELTA);

        assertEquals(5000, rows.get(0).delta);
    }

    // ── Sort modes ──────────────────────────────────────────────────────────────

    @Test
    public void sortByDeltaDescending() {
        Snapshot a = snap(1,
                proc("small_change", 1, 1000, 0, 0, 0, 0, 0),
                proc("big_change", 2, 1000, 0, 0, 0, 0, 0),
                proc("medium_change", 3, 1000, 0, 0, 0, 0, 0));
        Snapshot b = snap(2,
                proc("small_change", 1, 1100, 0, 0, 0, 0, 0),
                proc("big_change", 2, 5000, 0, 0, 0, 0, 0),
                proc("medium_change", 3, 2000, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals("big_change", rows.get(0).name);
        assertEquals("medium_change", rows.get(1).name);
        assertEquals("small_change", rows.get(2).name);
    }

    @Test
    public void sortByAbsoluteValue() {
        Snapshot a = snap(1,
                proc("decreased", 1, 5000, 0, 0, 0, 0, 0),
                proc("increased", 2, 1000, 0, 0, 0, 0, 0),
                proc("small", 3, 1000, 0, 0, 0, 0, 0));
        Snapshot b = snap(2,
                proc("decreased", 1, 1000, 0, 0, 0, 0, 0),  // -4000
                proc("increased", 2, 4000, 0, 0, 0, 0, 0),  // +3000
                proc("small", 3, 1100, 0, 0, 0, 0, 0));     // +100

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.ABSOLUTE);

        assertEquals("decreased", rows.get(0).name);  // |4000|
        assertEquals("increased", rows.get(1).name);  // |3000|
        assertEquals("small", rows.get(2).name);       // |100|
    }

    @Test
    public void sortByName() {
        Snapshot a = snap(1,
                proc("zz_app", 1, 1000, 0, 0, 0, 0, 0),
                proc("aa_app", 2, 1000, 0, 0, 0, 0, 0),
                proc("mm_app", 3, 1000, 0, 0, 0, 0, 0));
        Snapshot b = snap(2,
                proc("zz_app", 1, 2000, 0, 0, 0, 0, 0),
                proc("aa_app", 2, 2000, 0, 0, 0, 0, 0),
                proc("mm_app", 3, 2000, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.NAME);

        assertEquals("aa_app", rows.get(0).name);
        assertEquals("mm_app", rows.get(1).name);
        assertEquals("zz_app", rows.get(2).name);
    }

    // ── Edge cases ──────────────────────────────────────────────────────────────

    @Test
    public void emptySnapshots() {
        Snapshot a = snap(1);
        Snapshot b = snap(2);

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(0, rows.size());
    }

    @Test
    public void singleProcessNoChange() {
        Snapshot a = snap(1, proc("app", 1, 5000, 0, 0, 0, 0, 0));
        Snapshot b = snap(2, proc("app", 1, 5000, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(1, rows.size());
        assertEquals(0, rows.get(0).delta);
        assertFalse(rows.get(0).onlyInA);
        assertFalse(rows.get(0).onlyInB);
    }

    @Test
    public void manyProcesses() {
        // Verify we handle many processes correctly
        Snapshot.ProcessSnapshot[] procsA = new Snapshot.ProcessSnapshot[100];
        Snapshot.ProcessSnapshot[] procsB = new Snapshot.ProcessSnapshot[100];
        for (int i = 0; i < 100; i++) {
            procsA[i] = proc("app" + i, i, 1000 + i, 0, 0, 0, 0, 0);
            procsB[i] = proc("app" + i, i, 2000 + i, 0, 0, 0, 0, 0);
        }
        Snapshot a = snap(1, procsA);
        Snapshot b = snap(2, procsB);

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(100, rows.size());
        // All deltas should be exactly 1000
        for (DiffAdapter.DiffRow row : rows) {
            assertEquals(1000, row.delta);
        }
    }

    @Test
    public void getMemValuePss() {
        Snapshot.ProcessSnapshot p = proc("test", 1, 100, 200, 300, 400, 500, 600);
        assertEquals(100, DiffActivity.getMemValue(p, DiffActivity.MemColumn.PSS));
    }

    @Test
    public void getMemValueAllColumns() {
        Snapshot.ProcessSnapshot p = proc("test", 1, 100, 200, 300, 400, 500, 600);
        assertEquals(100, DiffActivity.getMemValue(p, DiffActivity.MemColumn.PSS));
        assertEquals(200, DiffActivity.getMemValue(p, DiffActivity.MemColumn.RSS));
        assertEquals(300, DiffActivity.getMemValue(p, DiffActivity.MemColumn.JAVA));
        assertEquals(400, DiffActivity.getMemValue(p, DiffActivity.MemColumn.NATIVE));
        assertEquals(500, DiffActivity.getMemValue(p, DiffActivity.MemColumn.CODE));
        assertEquals(600, DiffActivity.getMemValue(p, DiffActivity.MemColumn.GRAPHICS));
    }

    @Test
    public void duplicateProcessNamesInSnapshotLastWins() {
        // If a snapshot has two processes with same name, the LinkedHashMap
        // will keep the last one. This tests that behavior is consistent.
        Snapshot a = snap(1,
                proc("dup", 1, 1000, 0, 0, 0, 0, 0),
                proc("dup", 2, 2000, 0, 0, 0, 0, 0));  // overwrites first
        Snapshot b = snap(2,
                proc("dup", 1, 3000, 0, 0, 0, 0, 0));

        List<DiffAdapter.DiffRow> rows = DiffActivity.computeDiffRows(
                a, b, DiffActivity.MemColumn.PSS, DiffActivity.SortMode.DELTA);

        assertEquals(1, rows.size());
        assertEquals(2000, rows.get(0).oldValue);  // from PID 2 (last in A)
        assertEquals(3000, rows.get(0).newValue);
    }
}
