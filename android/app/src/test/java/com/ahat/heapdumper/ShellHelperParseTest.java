package com.ahat.heapdumper;

import org.junit.Test;
import static org.junit.Assert.*;

import java.util.List;

public class ShellHelperParseTest {

    // ── parseLruProcesses ───────────────────────────────────────────────────────

    private static final String REAL_LRU_OUTPUT =
            "ACTIVITY MANAGER LRU PROCESSES (dumpsys activity lru)\n"
            + "  Activities:\n"
            + "  #0: fg     T  29613:com.android.launcher3/u0a62 act:activities\n"
            + "  #1: vis    T  1729:com.android.systemui/1000 act:activities\n"
            + "  #2: fgs    S  3456:com.google.android.gms.persistent/u0a120\n"
            + "  #3: cch+1  S  4567:com.example.cached/u0a200\n"
            + "  #4: bfgs   S  5678:com.android.inputmethod/u0a50\n"
            + "  #5: pers   S  891:com.android.phone/1001\n"
            + "  #6: top    T  12345:com.example.topapp/u0a300 act:activities\n"
            + "  #7: home   T  2345:com.android.launcher3/u0a62\n";

    @Test
    public void parsesProcessNames() {
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(REAL_LRU_OUTPUT);
        assertTrue(procs.size() >= 7);
        assertEquals("com.android.launcher3", procs.get(0).name);
        assertEquals("com.android.systemui", procs.get(1).name);
    }

    @Test
    public void parsesPids() {
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(REAL_LRU_OUTPUT);
        assertEquals(29613, procs.get(0).pid);
        assertEquals(1729, procs.get(1).pid);
        assertEquals(3456, procs.get(2).pid);
    }

    @Test
    public void mapsOomLabels() {
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(REAL_LRU_OUTPUT);
        assertEquals("Foreground", procs.get(0).oomLabel);  // fg -> Foreground
        assertEquals("Visible", procs.get(1).oomLabel);     // vis -> Visible
        assertEquals("FG Service", procs.get(2).oomLabel);  // fgs -> FG Service
        assertEquals("Cached", procs.get(3).oomLabel);      // cch+1 -> Cached
        assertEquals("Bound FG", procs.get(4).oomLabel);    // bfgs -> Bound FG
        assertEquals("Persistent", procs.get(5).oomLabel);  // pers -> Persistent
        assertEquals("Top", procs.get(6).oomLabel);          // top -> Top
    }

    @Test
    public void deduplicatesByPid() {
        // launcher3 appears twice (PID 29613 at #0 and #7 with different PID 2345)
        // Actually #7 has PID 2345 which is different, so both should appear
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(REAL_LRU_OUTPUT);
        // PID 29613 should appear once
        long countLauncher = procs.stream().filter(p -> p.pid == 29613).count();
        assertEquals(1, countLauncher);
    }

    @Test
    public void duplicatePidIsSkipped() {
        String output =
                "  #0: fg     T  1000:com.app.first/u0a1\n"
              + "  #1: cch    S  1000:com.app.first/u0a1\n";  // same PID
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(output);
        assertEquals(1, procs.size());
    }

    @Test
    public void emptyInput() {
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses("");
        assertEquals(0, procs.size());
    }

    @Test
    public void noMatchingLines() {
        String output = "Some random text\nMore text\n";
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(output);
        assertEquals(0, procs.size());
    }

    @Test
    public void handlesProcessNameWithDots() {
        String output = "  #0: fg     T  100:com.very.long.package.name.here/u0a1\n";
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(output);
        assertEquals(1, procs.size());
        assertEquals("com.very.long.package.name.here", procs.get(0).name);
    }

    @Test
    public void handlesUnknownOomLabel() {
        String output = "  #0: unknownstate T  100:com.app/u0a1\n";
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(output);
        assertEquals(1, procs.size());
        // Unknown labels are passed through as-is
        assertEquals("unknownstate", procs.get(0).oomLabel);
    }

    @Test
    public void parsesOomLabelWithPlusNumber() {
        // "cch+1" should strip the +1 and map "cch" -> "Cached"
        String output = "  #3: cch+2  S  9999:com.app.cached2/u0a50\n";
        List<ProcessInfo> procs = ShellHelper.parseLruProcesses(output);
        assertEquals(1, procs.size());
        assertEquals("Cached", procs.get(0).oomLabel);
    }

    // ── parseMemInfoOutput ──────────────────────────────────────────────────────

    private static final String MEMINFO_OUTPUT =
            "Applications Memory Usage (in Kilobytes):\n"
            + "Uptime: 123456789 Realtime: 123456789\n"
            + "\n"
            + "** MEMINFO in pid 12345 [com.example.app] **\n"
            + "                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap\n"
            + "                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free\n"
            + "                ------   ------   ------   ------   ------   ------   ------   ------\n"
            + "  Native Heap    15234    15100      100       20    16000    20480    18432     2048\n"
            + "  Dalvik Heap    20456    20200      200       10    22000    32768    28672     4096\n"
            + "        Stack      512      512        0        0      520\n"
            + "       Ashmem       10        0       10        0       40\n"
            + "    Other dev       20        4        0        0       80\n"
            + "     .so mmap     8192      200     7000       50    12000\n"
            + "    .jar mmap        0        0        0        0     2000\n"
            + "    .apk mmap      100        0      100        0     1000\n"
            + "    .dex mmap     5000        4     4996        0     5200\n"
            + "    .oat mmap       50        0       50        0      200\n"
            + "    .art mmap     3000     2800      100       30     5000\n"
            + "   Other mmap      200       20      100        0      400\n"
            + "   EGL mtrack     4000     4000        0        0     4000\n"
            + "    GL mtrack     3000     3000        0        0     3000\n"
            + "      Unknown     1000      900      100        0     1100\n"
            + "        TOTAL    60774    46740    12756      110    72540    53248    47104     6144\n"
            + "\n"
            + " App Summary\n"
            + "                       Pss(KB)                        Rss(KB)\n"
            + "                        ------                         ------\n"
            + "           Java Heap:    23456                          27000\n"
            + "         Native Heap:    15234                          16000\n"
            + "                Code:    13342                          20400\n"
            + "               Stack:      512                            520\n"
            + "            Graphics:     7000                           7000\n"
            + "       Private Other:     2230\n"
            + "              System:     2000\n"
            + "\n"
            + "           TOTAL PSS:    63774      TOTAL RSS:    72540\n"
            + "      TOTAL SWAP PSS:      110\n";

    @Test
    public void parseMemInfoExtractsTotalPss() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(63774, info.totalPssKb);
    }

    @Test
    public void parseMemInfoExtractsTotalRss() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(72540, info.totalRssKb);
    }

    @Test
    public void parseMemInfoExtractsJavaHeap() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(23456, info.javaHeapKb);
    }

    @Test
    public void parseMemInfoExtractsNativeHeap() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(15234, info.nativeHeapKb);
    }

    @Test
    public void parseMemInfoExtractsCode() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(13342, info.codeKb);
    }

    @Test
    public void parseMemInfoExtractsStack() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(512, info.stackKb);
    }

    @Test
    public void parseMemInfoExtractsGraphics() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(7000, info.graphicsKb);
    }

    @Test
    public void parseMemInfoExtractsSystem() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(2000, info.systemKb);
    }

    @Test
    public void parseMemInfoExtractsSwapPss() {
        MemInfo info = ShellHelper.parseMemInfoOutput(MEMINFO_OUTPUT);
        assertEquals(110, info.totalSwapKb);
    }

    @Test
    public void parseMemInfoEmptyOutput() {
        MemInfo info = ShellHelper.parseMemInfoOutput("");
        assertEquals(0, info.totalPssKb);
        assertEquals(0, info.javaHeapKb);
    }

    @Test
    public void parseMemInfoFallbackToTotalRow() {
        // Output with TOTAL row but no TOTAL PSS: line
        String output =
                "        TOTAL    45000    30000     5000      100    50000\n";
        MemInfo info = ShellHelper.parseMemInfoOutput(output);
        assertEquals(45000, info.totalPssKb);
    }

    @Test
    public void parseMemInfoTotalPssLinePreferred() {
        // Both TOTAL row and TOTAL PSS: line present — TOTAL PSS: should win
        String output =
                "        TOTAL    45000    30000     5000      100    50000\n"
              + "           TOTAL PSS:    63774      TOTAL RSS:    72540\n";
        MemInfo info = ShellHelper.parseMemInfoOutput(output);
        // First TOTAL row sets 45000, then TOTAL PSS: overwrites to 63774
        assertEquals(63774, info.totalPssKb);
    }

    @Test
    public void parseMemInfoNoSwapLine() {
        String output =
                "           Java Heap:    10000                          12000\n"
              + "           TOTAL PSS:    30000      TOTAL RSS:    40000\n";
        MemInfo info = ShellHelper.parseMemInfoOutput(output);
        assertEquals(0, info.totalSwapKb);
        assertEquals(10000, info.javaHeapKb);
        assertEquals(30000, info.totalPssKb);
        assertEquals(40000, info.totalRssKb);
    }

    @Test
    public void parseMemInfoCategoriesOnly() {
        String output =
                "           Java Heap:    5000\n"
              + "         Native Heap:    3000\n"
              + "                Code:    2000\n"
              + "               Stack:     100\n"
              + "            Graphics:    1500\n"
              + "              System:     500\n";
        MemInfo info = ShellHelper.parseMemInfoOutput(output);
        assertEquals(5000, info.javaHeapKb);
        assertEquals(3000, info.nativeHeapKb);
        assertEquals(2000, info.codeKb);
        assertEquals(100, info.stackKb);
        assertEquals(1500, info.graphicsKb);
        assertEquals(500, info.systemKb);
        assertEquals(0, info.totalPssKb); // No TOTAL PSS line
    }
}
