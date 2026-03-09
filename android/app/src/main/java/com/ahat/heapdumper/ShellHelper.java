package com.ahat.heapdumper;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
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
 *
 * Commands that need elevated permissions (dumpsys, am dumpheap) are routed
 * through su when available. The app auto-detects root on first use.
 */
public class ShellHelper {

    private static final Pattern LRU_LINE =
            Pattern.compile("^\\s*#\\d+:\\s+(\\S+)\\s+.*?\\s(\\d+):([^\\s/]+)");

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

    // ─── Logging ────────────────────────────────────────────────────────────────

    public interface LogCallback {
        void onLog(String message);
    }

    private static volatile LogCallback logCallback;

    public static void setLogCallback(LogCallback cb) {
        logCallback = cb;
    }

    private static void log(String msg) {
        LogCallback cb = logCallback;
        if (cb != null) cb.onLog(msg);
    }

    // ─── Root detection ─────────────────────────────────────────────────────────

    private static Boolean hasRoot = null;
    private static String suBinary = null; // "su" or null

    /** Detect root once: tries `su -c id` and checks for uid=0. */
    public static synchronized boolean detectRoot() {
        if (hasRoot != null) return hasRoot;
        log("Detecting root...");
        try {
            String result = execDirect("su", "-c", "id");
            if (result.contains("uid=0")) {
                hasRoot = true;
                suBinary = "su";
                log("Root: YES (su -c)");
                return true;
            }
        } catch (Exception e) {
            log("su -c id failed: " + e.getMessage());
        }
        // Try su 0 (toybox variant)
        try {
            String result = execDirect("su", "0", "id");
            if (result.contains("uid=0")) {
                hasRoot = true;
                suBinary = "su";
                log("Root: YES (su 0)");
                return true;
            }
        } catch (Exception e) {
            log("su 0 id failed: " + e.getMessage());
        }
        hasRoot = false;
        log("Root: NO — commands will run as app user (limited)");
        return false;
    }

    public static boolean isRooted() {
        if (hasRoot == null) detectRoot();
        return hasRoot;
    }

    // ─── Shell execution ────────────────────────────────────────────────────────

    /** Run a command directly (no su). Returns stdout+stderr. */
    public static String execDirect(String... cmd) throws Exception {
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
        int exit = proc.waitFor();
        String out = sb.toString();
        if (exit != 0 && out.trim().isEmpty()) {
            throw new Exception("Exit code " + exit);
        }
        return out;
    }

    /**
     * Run a shell command string via su if rooted, otherwise directly via sh.
     * This is the primary exec method — routes through su for privileged commands.
     */
    public static String exec(String command) throws Exception {
        log("$ " + command);
        String result;
        if (isRooted()) {
            // Use su -c 'command' to run as root
            ProcessBuilder pb = new ProcessBuilder("su", "-c", command);
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line).append('\n');
                }
            }
            int exit = proc.waitFor();
            result = sb.toString();
            if (exit != 0) {
                log("  exit=" + exit + " out=" + truncate(result, 200));
            }
        } else {
            // No root, try directly via sh
            ProcessBuilder pb = new ProcessBuilder("sh", "-c", command);
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line).append('\n');
                }
            }
            int exit = proc.waitFor();
            result = sb.toString();
            if (exit != 0) {
                log("  exit=" + exit + " out=" + truncate(result, 200));
            }
        }
        log("  -> " + truncate(result, 120));
        return result;
    }

    private static String truncate(String s, int max) {
        s = s.trim();
        if (s.length() <= max) return s;
        return s.substring(0, max) + "\u2026";
    }

    private static String mapOomLabel(String raw) {
        String base = raw.replaceAll("\\+\\d+$", "").replaceAll("\\d+$", "");
        String mapped = OOM_LABEL_MAP.get(base);
        return mapped != null ? mapped : raw;
    }

    // ─── Process listing ────────────────────────────────────────────────────────

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

    public static List<ProcessInfo> getProcessList() throws Exception {
        log("Fetching process list...");
        String output = exec("dumpsys activity lru");
        log("dumpsys output: " + output.length() + " chars");
        List<ProcessInfo> list = parseLruProcesses(output);
        log("Parsed " + list.size() + " LRU processes");

        // Add pinned system processes (same as TypeScript PINNED_PROCESSES)
        Set<Integer> pids = new HashSet<>();
        for (ProcessInfo p : list) pids.add(p.pid);

        for (String name : new String[]{"system_server", "com.android.systemui"}) {
            try {
                String pidStr = exec("pidof " + name).trim();
                if (pidStr.isEmpty()) continue;
                int pid = Integer.parseInt(pidStr.split("\\s+")[0]);
                if (!pids.contains(pid)) {
                    list.add(0, new ProcessInfo(pid, name, "System"));
                    log("Pinned: " + name + " PID " + pid);
                }
            } catch (Exception e) {
                log("pidof " + name + " failed: " + e.getMessage());
            }
        }
        log("Total: " + list.size() + " processes");
        return list;
    }

    // ─── Meminfo ────────────────────────────────────────────────────────────────

    public static MemInfo getMemInfo(int pid) throws Exception {
        String output = exec("dumpsys meminfo " + pid);
        MemInfo info = new MemInfo();

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
                    Matcher rm = totalRssLine.matcher(line);
                    if (rm.find()) {
                        info.totalRssKb = Long.parseLong(rm.group(1));
                    }
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

    // ─── Heap dump ──────────────────────────────────────────────────────────────

    public static String dumpHeap(int pid, boolean withBitmaps, ProgressCallback callback) throws Exception {
        String ts = String.valueOf(System.currentTimeMillis());
        String remotePath = "/data/local/tmp/ahat_" + pid + "_" + ts + ".hprof";

        callback.onProgress("Dumping heap for PID " + pid + "\u2026");

        String bmpFlag = withBitmaps ? "-b png " : "";
        exec("am dumpheap " + bmpFlag + pid + " " + remotePath);

        // Poll file size until stable (same logic as TypeScript)
        long lastSize = -1;
        int stableCount = 0;
        for (int i = 0; i < 120; i++) {
            Thread.sleep(500);
            callback.onProgress("Waiting for dump\u2026 " + (i / 2) + "s");

            long size;
            try {
                String out = exec("stat -c %s '" + remotePath + "' 2>/dev/null || echo -1");
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
                if (stableCount >= 3) break;
            } else {
                stableCount = 0;
                lastSize = size;
            }
        }

        if (lastSize <= 0) {
            throw new Exception("Heap dump failed: file not created at " + remotePath);
        }

        callback.onProgress("Dump complete (" + formatSize(lastSize) + ")");
        return remotePath;
    }

    // ─── File management ────────────────────────────────────────────────────────

    public static List<HprofFile> listDumps() {
        List<HprofFile> result = new ArrayList<>();
        File dir = new File("/data/local/tmp");
        File[] files = dir.listFiles((d, name) -> name.startsWith("ahat_") && name.endsWith(".hprof"));
        if (files == null) return result;
        for (File f : files) {
            result.add(new HprofFile(f.getAbsolutePath(), f.getName(), f.length(), f.lastModified()));
        }
        result.sort((a, b) -> Long.compare(b.lastModified, a.lastModified));
        return result;
    }

    public static boolean deleteDump(String path) {
        return new File(path).delete();
    }

    public static String formatSize(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        return String.format("%.1f MB", bytes / (1024.0 * 1024.0));
    }

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
