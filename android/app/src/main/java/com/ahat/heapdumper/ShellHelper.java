package com.ahat.heapdumper;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shell-based process listing, meminfo, and heap dumping — mirrors the TypeScript
 * AdbConnection logic from src/adb/capture.ts but runs on-device.
 */
public class ShellHelper {

    // Same regex as TypeScript: LRU_LINE = /^\s*#\d+:\s+(\S+)\s+.*?\s(\d+):([^\s/]+)/
    private static final Pattern LRU_LINE =
            Pattern.compile("^\\s*#\\d+:\\s+(\\S+)\\s+.*?\\s(\\d+):([^\\s/]+)");

    // OOM label map — same as TypeScript OOM_LABEL_MAP
    private static final Map<String, String> OOM_LABEL_MAP = new HashMap<>();
    static {
        OOM_LABEL_MAP.put("pers", "Persistent");
        OOM_LABEL_MAP.put("top", "Top");
        OOM_LABEL_MAP.put("bfgs", "Bound FG");
        OOM_LABEL_MAP.put("btop", "Bound Top");
        OOM_LABEL_MAP.put("fgs", "FG Service");
        OOM_LABEL_MAP.put("fg", "Foreground");
        OOM_LABEL_MAP.put("impfg", "Imp FG");
        OOM_LABEL_MAP.put("impbg", "Imp BG");
        OOM_LABEL_MAP.put("backup", "Backup");
        OOM_LABEL_MAP.put("service", "Service");
        OOM_LABEL_MAP.put("service-rs", "Svc Restart");
        OOM_LABEL_MAP.put("receiver", "Receiver");
        OOM_LABEL_MAP.put("heavy", "Heavy");
        OOM_LABEL_MAP.put("home", "Home");
        OOM_LABEL_MAP.put("lastact", "Last Activity");
        OOM_LABEL_MAP.put("cached", "Cached");
        OOM_LABEL_MAP.put("cch", "Cached");
        OOM_LABEL_MAP.put("frzn", "Frozen");
        OOM_LABEL_MAP.put("native", "Native");
        OOM_LABEL_MAP.put("sys", "System");
        OOM_LABEL_MAP.put("fore", "Foreground");
        OOM_LABEL_MAP.put("vis", "Visible");
        OOM_LABEL_MAP.put("percep", "Perceptible");
        OOM_LABEL_MAP.put("perceptible", "Perceptible");
        OOM_LABEL_MAP.put("svcb", "Service B");
        OOM_LABEL_MAP.put("svcrst", "Svc Restart");
        OOM_LABEL_MAP.put("prev", "Previous");
        OOM_LABEL_MAP.put("lstact", "Last Activity");
    }

    private static String mapOomLabel(String raw) {
        String base = raw.replaceAll("\\+\\d+$", "").replaceAll("\\d+$", "");
        String mapped = OOM_LABEL_MAP.get(base);
        return mapped != null ? mapped : raw;
    }

    /** Run a shell command and return stdout. */
    public static String exec(String... cmd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        Process proc = pb.start();
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append('\n');
            }
        }
        proc.waitFor();
        return sb.toString();
    }

    /** Parse `dumpsys activity lru` — same logic as TypeScript parseLruProcesses. */
    public static List<ProcessInfo> parseLruProcesses(String output) {
        List<ProcessInfo> results = new ArrayList<>();
        Set<Integer> seen = new HashSet<>();

        for (String line : output.split("\n")) {
            Matcher m = LRU_LINE.matcher(line);
            if (!m.find()) continue;
            int pid;
            try {
                pid = Integer.parseInt(m.group(2));
            } catch (NumberFormatException e) {
                continue;
            }
            if (seen.contains(pid)) continue;
            seen.add(pid);

            String oomRaw = m.group(1).replaceAll("\\+\\d+$", "");
            results.add(new ProcessInfo(pid, m.group(3), mapOomLabel(oomRaw)));
        }
        return results;
    }

    /** Get Java process list from dumpsys activity lru + pinned processes. */
    public static List<ProcessInfo> getProcessList() throws Exception {
        String output = exec("dumpsys", "activity", "lru");
        List<ProcessInfo> list = parseLruProcesses(output);

        // Add pinned system processes (same as TypeScript PINNED_PROCESSES)
        Set<Integer> pids = new HashSet<>();
        for (ProcessInfo p : list) pids.add(p.pid);

        for (String name : new String[]{"system_server", "com.android.systemui"}) {
            try {
                String pidStr = exec("pidof", name).trim();
                if (pidStr.isEmpty()) continue;
                int pid = Integer.parseInt(pidStr.split("\\s+")[0]);
                if (!pids.contains(pid)) {
                    list.add(0, new ProcessInfo(pid, name, "System"));
                }
            } catch (Exception ignored) {}
        }
        return list;
    }

    /**
     * Parse `dumpsys meminfo <pid>` for the TOTAL line and category breakdowns.
     * Extracts PSS, RSS (Private Dirty + Private Clean), Java Heap, Native Heap,
     * Code, Stack, Graphics, System.
     */
    public static MemInfo getMemInfo(int pid) throws Exception {
        String output = exec("dumpsys", "meminfo", String.valueOf(pid));
        MemInfo info = new MemInfo();

        // dumpsys meminfo output has lines like:
        //                    Pss  Private  Private  SwapPss  Rss
        //                  Total    Dirty    Clean    Dirty  Total
        //                 ------   ------   ------   ------  ------
        //   Java Heap:     1234     1200       34        0    1500
        //   Native Heap:   5678     5600       78        0    6000
        //   Code:           900      100      800        0    1200
        //   Stack:          100      100        0        0     200
        //   Graphics:       500      500        0        0     600
        //   System:         300
        //   TOTAL:         8712     7500      912        0    9500

        // Also handles the simpler compact format:
        //   TOTAL    8712    7500     912       0    9500

        Pattern categoryLine = Pattern.compile(
                "^\\s*(Java Heap|Native Heap|Code|Stack|Graphics|System|TOTAL):\\s+(\\d+)");
        Pattern totalRssLine = Pattern.compile(
                "^\\s*TOTAL\\b.*?\\s(\\d+)\\s*$");

        for (String line : output.split("\n")) {
            Matcher m = categoryLine.matcher(line);
            if (!m.find()) continue;
            String cat = m.group(1);
            long pssKb = Long.parseLong(m.group(2));

            switch (cat) {
                case "Java Heap":   info.javaHeapKb = pssKb; break;
                case "Native Heap": info.nativeHeapKb = pssKb; break;
                case "Code":        info.codeKb = pssKb; break;
                case "Stack":       info.stackKb = pssKb; break;
                case "Graphics":    info.graphicsKb = pssKb; break;
                case "System":      info.systemKb = pssKb; break;
                case "TOTAL":
                    info.totalPssKb = pssKb;
                    // Try to extract RSS (last number on TOTAL line)
                    Matcher rm = totalRssLine.matcher(line);
                    if (rm.find()) {
                        info.totalRssKb = Long.parseLong(rm.group(1));
                    }
                    // Try to extract SwapPss (4th number)
                    String[] parts = line.trim().split("\\s+");
                    if (parts.length >= 5) {
                        try {
                            info.totalSwapKb = Long.parseLong(parts[4]);
                        } catch (NumberFormatException ignored) {}
                    }
                    break;
            }
        }
        return info;
    }

    /**
     * Trigger heap dump and wait for completion.
     * Same approach as TypeScript: am dumpheap [-b png], then poll file size until stable.
     *
     * @param withBitmaps if true, uses `-b png` to include bitmap pixel data
     * @return path to the .hprof file on device
     */
    public static String dumpHeap(int pid, boolean withBitmaps, ProgressCallback callback) throws Exception {
        String ts = String.valueOf(System.currentTimeMillis());
        String remotePath = "/data/local/tmp/ahat_" + pid + "_" + ts + ".hprof";

        callback.onProgress("Dumping heap for PID " + pid + "\u2026");

        // Same as TypeScript: `am dumpheap ${bmpFlag}${pid} ${remotePath}`
        if (withBitmaps) {
            exec("am", "dumpheap", "-b", "png", String.valueOf(pid), remotePath);
        } else {
            exec("am", "dumpheap", String.valueOf(pid), remotePath);
        }

        // Poll file size until stable (same logic as TypeScript)
        long lastSize = -1;
        int stableCount = 0;
        for (int i = 0; i < 120; i++) {
            Thread.sleep(500);
            callback.onProgress("Waiting for dump\u2026 " + (i / 2) + "s");

            long size;
            try {
                String out = exec("stat", "-c", "%s", remotePath);
                size = Long.parseLong(out.trim());
            } catch (Exception e) {
                size = -1;
            }

            if (size <= 0) {
                stableCount = 0;
                lastSize = -1;
                continue;
            }

            if (size == lastSize) {
                stableCount++;
                if (stableCount >= 3) break; // 1.5s stable = done
            } else {
                stableCount = 0;
                lastSize = size;
            }
        }

        if (lastSize <= 0) {
            throw new Exception("Heap dump failed: file not created");
        }

        callback.onProgress("Dump complete (" + formatSize(lastSize) + ")");
        return remotePath;
    }

    /** List .hprof files in /data/local/tmp/ matching our naming pattern. */
    public static List<HprofFile> listDumps() {
        List<HprofFile> result = new ArrayList<>();
        File dir = new File("/data/local/tmp");
        File[] files = dir.listFiles((d, name) -> name.startsWith("ahat_") && name.endsWith(".hprof"));
        if (files == null) return result;
        for (File f : files) {
            result.add(new HprofFile(f.getAbsolutePath(), f.getName(), f.length(), f.lastModified()));
        }
        // Most recent first
        result.sort((a, b) -> Long.compare(b.lastModified, a.lastModified));
        return result;
    }

    /** Delete an hprof file. */
    public static boolean deleteDump(String path) {
        return new File(path).delete();
    }

    /** Format bytes to human-readable. */
    public static String formatSize(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        return String.format("%.1f MB", bytes / (1024.0 * 1024.0));
    }

    /** Format KB to human-readable. */
    public static String formatKb(long kb) {
        if (kb < 1024) return kb + " KB";
        return String.format("%.1f MB", kb / 1024.0);
    }

    public interface ProgressCallback {
        void onProgress(String message);
    }

    public static class HprofFile {
        public final String path;
        public final String name;
        public final long size;
        public final long lastModified;

        public HprofFile(String path, String name, long size, long lastModified) {
            this.path = path;
            this.name = name;
            this.size = size;
            this.lastModified = lastModified;
        }
    }
}
