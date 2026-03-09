package com.ahat.heapdumper;

import org.junit.Test;
import static org.junit.Assert.*;

public class ProcessInfoTest {

    @Test
    public void constructorSetsFields() {
        ProcessInfo p = new ProcessInfo(1234, "com.example.app", "Top");
        assertEquals(1234, p.pid);
        assertEquals("com.example.app", p.name);
        assertEquals("Top", p.oomLabel);
    }

    @Test
    public void defaultFieldsAreZero() {
        ProcessInfo p = new ProcessInfo(1, "test", "cached");
        assertEquals(0, p.pssKb);
        assertEquals(0, p.rssKb);
        assertEquals(0, p.javaHeapKb);
        assertEquals(0, p.nativeHeapKb);
        assertEquals(0, p.codeKb);
        assertEquals(0, p.graphicsKb);
        assertFalse(p.enriched);
    }

    @Test
    public void applyMemInfoSetsAllFields() {
        ProcessInfo p = new ProcessInfo(100, "com.app", "fg");
        MemInfo info = new MemInfo();
        info.totalPssKb = 50000;
        info.totalRssKb = 80000;
        info.javaHeapKb = 20000;
        info.nativeHeapKb = 15000;
        info.codeKb = 8000;
        info.graphicsKb = 5000;

        p.applyMemInfo(info);

        assertEquals(50000, p.pssKb);
        assertEquals(80000, p.rssKb);
        assertEquals(20000, p.javaHeapKb);
        assertEquals(15000, p.nativeHeapKb);
        assertEquals(8000, p.codeKb);
        assertEquals(5000, p.graphicsKb);
        assertTrue(p.enriched);
    }

    @Test
    public void applyMemInfoWithZeroValues() {
        ProcessInfo p = new ProcessInfo(1, "test", "cached");
        MemInfo info = new MemInfo();
        // All zeros — still marks as enriched
        p.applyMemInfo(info);
        assertTrue(p.enriched);
        assertEquals(0, p.pssKb);
    }

    @Test
    public void applyMemInfoOverwritesPreviousValues() {
        ProcessInfo p = new ProcessInfo(1, "test", "cached");

        MemInfo first = new MemInfo();
        first.totalPssKb = 100;
        first.javaHeapKb = 50;
        p.applyMemInfo(first);
        assertEquals(100, p.pssKb);

        MemInfo second = new MemInfo();
        second.totalPssKb = 200;
        second.javaHeapKb = 80;
        p.applyMemInfo(second);
        assertEquals(200, p.pssKb);
        assertEquals(80, p.javaHeapKb);
    }
}
