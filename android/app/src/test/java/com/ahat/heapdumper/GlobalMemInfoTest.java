package com.ahat.heapdumper;

import org.junit.Test;
import static org.junit.Assert.*;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;

public class GlobalMemInfoTest {

    private static final String REAL_PROC_MEMINFO =
            "MemTotal:       16384000 kB\n"
            + "MemFree:         2048000 kB\n"
            + "MemAvailable:    8192000 kB\n"
            + "Buffers:          204800 kB\n"
            + "Cached:          4096000 kB\n"
            + "SwapCached:        10240 kB\n"
            + "Active:          8000000 kB\n"
            + "Inactive:        4000000 kB\n"
            + "SwapTotal:       2097152 kB\n"
            + "SwapFree:        1048576 kB\n"
            + "Dirty:              1024 kB\n"
            + "Writeback:             0 kB\n";

    private GlobalMemInfo parse(String input) throws IOException {
        return GlobalMemInfo.parse(new BufferedReader(new StringReader(input)));
    }

    @Test
    public void parsesAllFields() throws IOException {
        GlobalMemInfo info = parse(REAL_PROC_MEMINFO);
        assertEquals(16384000, info.memTotalKb);
        assertEquals(2048000, info.memFreeKb);
        assertEquals(8192000, info.memAvailableKb);
        assertEquals(204800, info.buffersKb);
        assertEquals(4096000, info.cachedKb);
        assertEquals(2097152, info.swapTotalKb);
        assertEquals(1048576, info.swapFreeKb);
    }

    @Test
    public void computesUsed() throws IOException {
        GlobalMemInfo info = parse(REAL_PROC_MEMINFO);
        assertEquals(16384000 - 2048000, info.usedKb());
    }

    @Test
    public void computesSwapUsed() throws IOException {
        GlobalMemInfo info = parse(REAL_PROC_MEMINFO);
        assertEquals(2097152 - 1048576, info.swapUsedKb());
    }

    @Test
    public void computesUsedPercent() throws IOException {
        GlobalMemInfo info = parse(REAL_PROC_MEMINFO);
        int expected = (int) (((16384000L - 2048000L) * 100) / 16384000L);
        assertEquals(expected, info.usedPercent());
    }

    @Test
    public void usedPercentZeroWhenEmpty() {
        GlobalMemInfo info = new GlobalMemInfo();
        assertEquals(0, info.usedPercent());
    }

    @Test
    public void fallbackMemAvailableWhenMissing() throws IOException {
        String input = "MemTotal:       8000000 kB\n"
                + "MemFree:         1000000 kB\n"
                + "Buffers:          200000 kB\n"
                + "Cached:          3000000 kB\n";
        GlobalMemInfo info = parse(input);
        assertEquals(1000000 + 200000 + 3000000, info.memAvailableKb);
    }

    @Test
    public void memAvailableNotOverriddenIfPresent() throws IOException {
        String input = "MemTotal:       8000000 kB\n"
                + "MemFree:         1000000 kB\n"
                + "MemAvailable:    5000000 kB\n"
                + "Buffers:          200000 kB\n"
                + "Cached:          3000000 kB\n";
        GlobalMemInfo info = parse(input);
        assertEquals(5000000, info.memAvailableKb);
    }

    @Test
    public void emptyInput() throws IOException {
        GlobalMemInfo info = parse("");
        assertEquals(0, info.memTotalKb);
        assertEquals(0, info.memFreeKb);
    }

    @Test
    public void noSwapOmitsSwapInSummary() throws IOException {
        String input = "MemTotal:       8000000 kB\n"
                + "MemFree:         4000000 kB\n"
                + "MemAvailable:    6000000 kB\n";
        GlobalMemInfo info = parse(input);
        assertFalse(info.summary().contains("Swap"));
    }

    @Test
    public void swapIncludedInSummary() throws IOException {
        GlobalMemInfo info = parse(REAL_PROC_MEMINFO);
        assertTrue(info.summary().contains("Swap"));
    }

    @Test
    public void summaryContainsRAM() throws IOException {
        GlobalMemInfo info = parse(REAL_PROC_MEMINFO);
        assertTrue(info.summary().startsWith("RAM:"));
        assertTrue(info.summary().contains("Avail:"));
    }

    @Test
    public void malformedLinesSkipped() throws IOException {
        String input = "not a valid line\n"
                + "MemTotal:       8000000 kB\n"
                + "Broken: abc kB\n"
                + "MemFree:         4000000 kB\n";
        GlobalMemInfo info = parse(input);
        assertEquals(8000000, info.memTotalKb);
        assertEquals(4000000, info.memFreeKb);
    }
}
