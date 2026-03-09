package com.ahat.heapdumper;

import org.junit.Test;
import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class SnapshotTest {

    @Test
    public void constructorSetsFields() {
        List<Snapshot.ProcessSnapshot> procs = new ArrayList<>();
        procs.add(makeProc("app1", 100));
        Snapshot s = new Snapshot(1234567890L, procs);

        assertEquals(1234567890L, s.timestamp);
        assertEquals(1, s.processes.size());
        assertEquals("app1", s.processes.get(0).name);
    }

    @Test
    public void fromProcessListFiltersNonEnriched() {
        ProcessInfo enriched = new ProcessInfo(100, "com.enriched", "Top");
        MemInfo info = new MemInfo();
        info.totalPssKb = 5000;
        info.javaHeapKb = 2000;
        enriched.applyMemInfo(info);

        ProcessInfo notEnriched = new ProcessInfo(200, "com.not.enriched", "Cached");
        // Not enriched — no applyMemInfo called

        List<ProcessInfo> list = Arrays.asList(enriched, notEnriched);
        Snapshot s = Snapshot.fromProcessList(list);

        assertEquals(1, s.processes.size());
        assertEquals("com.enriched", s.processes.get(0).name);
        assertEquals(5000, s.processes.get(0).pssKb);
        assertEquals(2000, s.processes.get(0).javaHeapKb);
    }

    @Test
    public void fromProcessListEmptyInput() {
        Snapshot s = Snapshot.fromProcessList(new ArrayList<>());
        assertEquals(0, s.processes.size());
        assertTrue(s.timestamp > 0);
    }

    @Test
    public void fromProcessListAllNonEnriched() {
        ProcessInfo p1 = new ProcessInfo(1, "a", "Top");
        ProcessInfo p2 = new ProcessInfo(2, "b", "Cached");
        Snapshot s = Snapshot.fromProcessList(Arrays.asList(p1, p2));
        assertEquals(0, s.processes.size());
    }

    @Test
    public void fromProcessListCopiesAllMemoryFields() {
        ProcessInfo p = new ProcessInfo(100, "test.app", "FG Service");
        MemInfo info = new MemInfo();
        info.totalPssKb = 50000;
        info.totalRssKb = 80000;
        info.javaHeapKb = 20000;
        info.nativeHeapKb = 15000;
        info.codeKb = 8000;
        info.graphicsKb = 5000;
        p.applyMemInfo(info);

        Snapshot s = Snapshot.fromProcessList(Arrays.asList(p));
        Snapshot.ProcessSnapshot ps = s.processes.get(0);

        assertEquals("test.app", ps.name);
        assertEquals("FG Service", ps.oomLabel);
        assertEquals(100, ps.pid);
        assertEquals(50000, ps.pssKb);
        assertEquals(80000, ps.rssKb);
        assertEquals(20000, ps.javaHeapKb);
        assertEquals(15000, ps.nativeHeapKb);
        assertEquals(8000, ps.codeKb);
        assertEquals(5000, ps.graphicsKb);
    }

    @Test
    public void fromProcessListTimestampIsRecent() {
        long before = System.currentTimeMillis();
        Snapshot s = Snapshot.fromProcessList(new ArrayList<>());
        long after = System.currentTimeMillis();
        assertTrue(s.timestamp >= before);
        assertTrue(s.timestamp <= after);
    }

    @Test
    public void processSnapshotFieldsAreImmutable() {
        Snapshot.ProcessSnapshot ps = new Snapshot.ProcessSnapshot(
                "test", "Top", 42, 1000, 2000, 500, 300, 100, 50);
        assertEquals("test", ps.name);
        assertEquals("Top", ps.oomLabel);
        assertEquals(42, ps.pid);
        assertEquals(1000, ps.pssKb);
        assertEquals(2000, ps.rssKb);
        assertEquals(500, ps.javaHeapKb);
        assertEquals(300, ps.nativeHeapKb);
        assertEquals(100, ps.codeKb);
        assertEquals(50, ps.graphicsKb);
    }

    private Snapshot.ProcessSnapshot makeProc(String name, long pssKb) {
        return new Snapshot.ProcessSnapshot(name, "", 1, pssKb, 0, 0, 0, 0, 0);
    }
}
