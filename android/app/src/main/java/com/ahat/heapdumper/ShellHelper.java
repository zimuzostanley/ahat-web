package com.ahat.heapdumper;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Debug;
import android.util.Log;

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
 *
 * Requires permissions (grant via adb):
 *   adb shell pm grant com.ahat.heapdumper android.permission.DUMP
 *   adb shell pm grant com.ahat.heapdumper android.permission.PACKAGE_USAGE_STATS
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

    private static final String TAG = "AhatDumper";

    public interface LogCallback { void onLog(String message); }
    private static volatile LogCallback logCallback;
    public static void setLogCallback(LogCallback cb) { logCallback = cb; }
    private static void log(String msg) {
        Log.d(TAG, msg);
        LogCallback cb = logCallback;
        if (cb != null) cb.onLog(msg);
    }

    // ─── App context & storage dir (set by MainActivity) ───────────────────────

    private static Context appContext;
    private static File dumpDir;

    public static void setContext(Context ctx) { appContext = ctx.getApplicationContext(); }

    /** Set the dump directory to app's own external files dir. */
    public static void setDumpDir(File dir) {
        dumpDir = dir;
        if (!dir.exists()) dir.mkdirs();
        log("Dump dir: " + dir.getAbsolutePath());
    }

    public static File getDumpDir() { return dumpDir; }

    // ─── Root & permission detection ────────────────────────────────────────────

    private static Boolean hasRoot = null;
    private static String suPath = null;
    private static boolean hasDumpPerm = false;

    private static final String[] SU_PATHS = {
            "/sbin/su", "/system/bin/su", "/system/xbin/su",
            "/su/bin/su", "/magisk/.core/bin/su", "/data/adb/ksu/bin/su",
    };

    public static boolean checkDumpPermission(Context ctx) {
        boolean dump = ctx.checkSelfPermission("android.permission.DUMP")
                == PackageManager.PERMISSION_GRANTED;
        boolean usage = ctx.checkSelfPermission("android.permission.PACKAGE_USAGE_STATS")
                == PackageManager.PERMISSION_GRANTED;
        boolean watcher = ctx.checkSelfPermission("android.permission.SET_ACTIVITY_WATCHER")
                == PackageManager.PERMISSION_GRANTED;
        log("DUMP permission: " + (dump ? "YES" : "NO"));
        log("PACKAGE_USAGE_STATS: " + (usage ? "YES" : "NO"));
        log("SET_ACTIVITY_WATCHER: " + (watcher ? "YES" : "NO (needed for heap dump)"));
        hasDumpPerm = dump && usage;
        if (!dump || !usage || !watcher) {
            if (!dump) log("Grant: adb shell pm grant com.ahat.heapdumper android.permission.DUMP");
            if (!usage) log("Grant: adb shell pm grant com.ahat.heapdumper android.permission.PACKAGE_USAGE_STATS");
            if (!watcher) log("Grant: adb shell pm grant com.ahat.heapdumper android.permission.SET_ACTIVITY_WATCHER");
        }
        return hasDumpPerm;
    }

    public static boolean hasDumpPermission() { return hasDumpPerm; }

    public static synchronized boolean detectRoot() {
        if (hasRoot != null) return hasRoot;
        log("Detecting root...");
        for (String path : SU_PATHS) {
            if (!new File(path).exists()) continue;
            log("Found su at: " + path);
            for (String variant : new String[]{path + " -c id", path + " 0 id"}) {
                try {
                    String result = execRaw("sh", "-c", variant);
                    if (result.contains("uid=0")) {
                        hasRoot = true; suPath = path;
                        log("Root: YES (" + variant + ")");
                        return true;
                    }
                } catch (Exception e) { log("  " + variant + " -> " + e.getMessage()); }
            }
        }
        for (String variant : new String[]{"su -c id", "su 0 id"}) {
            try {
                String result = execRaw("sh", "-c", variant);
                if (result.contains("uid=0")) {
                    hasRoot = true; suPath = "su";
                    log("Root: YES (" + variant + ")");
                    return true;
                }
            } catch (Exception e) { log("  " + variant + " -> " + e.getMessage()); }
        }
        hasRoot = false;
        log("Root: NO");
        return false;
    }

    public static boolean isRooted() { if (hasRoot == null) detectRoot(); return hasRoot; }

    public static String getAccessMode() {
        if (isRooted()) return "root";
        if (hasDumpPerm) return "dump";
        return "none";
    }

    // ─── Shell execution ────────────────────────────────────────────────────────

    private static String execRaw(String... cmd) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        Process proc = pb.start();
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append('\n');
        }
        int exit = proc.waitFor();
        if (exit != 0) {
            Log.w(TAG, "Command exited " + exit + ": " + java.util.Arrays.toString(cmd));
        }
        return sb.toString();
    }

    public static String exec(String command) throws Exception {
        log("$ " + command);
        String result;
        if (isRooted() && suPath != null) {
            result = execRaw("sh", "-c", suPath + " -c '" + command.replace("'", "'\\''") + "'");
        } else {
            result = execRaw("sh", "-c", command);
        }
        String trimmed = result.trim();
        if (trimmed.length() > 150) {
            log("  -> " + trimmed.substring(0, 150) + "\u2026 (" + trimmed.length() + " chars)");
        } else {
            log("  -> " + trimmed);
        }
        if (result.contains("Permission Denial") || result.contains("not allowed")) {
            log("  PERMISSION DENIED");
            throw new Exception("Permission denied. Run:\n"
                    + "adb shell pm grant com.ahat.heapdumper android.permission.DUMP\n"
                    + "adb shell pm grant com.ahat.heapdumper android.permission.PACKAGE_USAGE_STATS");
        }
        return result;
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
            try { pid = Integer.parseInt(m.group(2)); }
            catch (NumberFormatException e) { continue; }
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
        List<ProcessInfo> list = parseLruProcesses(output);
        log("Parsed " + list.size() + " LRU processes");

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
            } catch (Exception e) { log("pidof " + name + ": " + e.getMessage()); }
        }
        log("Total: " + list.size() + " processes");
        return list;
    }

    // ─── Bulk meminfo enrichment ────────────────────────────────────────────────

    /**
     * Parse `dumpsys meminfo` (no pid) output to get PSS for all processes in one call.
     * The output has a section "Total PSS by process:" with lines like:
     *     234,567K: com.google.android.gms (pid 1234 / activities)
     *     123,456K: system (pid 567)
     * Returns map of pid -> pssKb.
     */
    public static Map<Integer, Long> getBulkPss() {
        Map<Integer, Long> result = new HashMap<>();
        try {
            log("Fetching bulk meminfo...");
            String output = exec("dumpsys meminfo -s");
            // Parse "Total PSS by process:" section
            //   123,456K: com.example (pid 1234 / activities)
            Pattern pssLine = Pattern.compile(
                    "^\\s*([\\d,]+)K:\\s+\\S+\\s+\\(pid\\s+(\\d+)");
            boolean inSection = false;
            for (String line : output.split("\n")) {
                if (line.contains("Total PSS by process")) {
                    inSection = true;
                    continue;
                }
                if (inSection && line.contains("Total PSS by OOM")) break;
                if (!inSection) continue;

                Matcher m = pssLine.matcher(line);
                if (m.find()) {
                    long pss = Long.parseLong(m.group(1).replace(",", ""));
                    int pid = Integer.parseInt(m.group(2));
                    result.put(pid, pss);
                }
            }
            log("Bulk PSS: " + result.size() + " processes");
        } catch (Exception e) {
            log("Bulk meminfo failed: " + e.getMessage());
        }
        return result;
    }

    // ─── Per-process meminfo (for detail screen) ────────────────────────────────

    /**
     * Get detailed meminfo for a single process.
     * Uses `dumpsys meminfo <pid>` which goes through ActivityManager, not the
     * "meminfo" service directly.
     */
    public static MemInfo getMemInfo(int pid) throws Exception {
        String output = exec("dumpsys meminfo " + pid);
        MemInfo info = parseMemInfoOutput(output);
        log("MemInfo PID " + pid + ": PSS=" + info.totalPssKb + " RSS=" + info.totalRssKb
                + " Java=" + info.javaHeapKb + " Native=" + info.nativeHeapKb
                + " Code=" + info.codeKb + " Gfx=" + info.graphicsKb);
        return info;
    }

    /** Parse `dumpsys meminfo <pid>` output into a MemInfo object. Package-visible for testing. */
    static MemInfo parseMemInfoOutput(String output) {
        MemInfo info = new MemInfo();

        Pattern categoryLine = Pattern.compile(
                "^\\s*(Java Heap|Native Heap|Code|Stack|Graphics|System):\\s+(\\d+)(?:\\s+(\\d+))?");
        Pattern totalPssLine = Pattern.compile("TOTAL PSS:\\s+(\\d+)");
        Pattern totalRssLine = Pattern.compile("TOTAL RSS:\\s+(\\d+)");
        Pattern totalSwapLine = Pattern.compile("TOTAL SWAP.*?:\\s+(\\d+)");

        for (String line : output.split("\n")) {
            Matcher m = categoryLine.matcher(line);
            if (m.find()) {
                String cat = m.group(1);
                long pss = Long.parseLong(m.group(2));
                switch (cat) {
                    case "Java Heap":   info.javaHeapKb = pss; break;
                    case "Native Heap": info.nativeHeapKb = pss; break;
                    case "Code":        info.codeKb = pss; break;
                    case "Stack":       info.stackKb = pss; break;
                    case "Graphics":    info.graphicsKb = pss; break;
                    case "System":      info.systemKb = pss; break;
                }
                continue;
            }

            // TOTAL PSS and TOTAL RSS may appear on the same line — check both
            m = totalPssLine.matcher(line);
            if (m.find()) { info.totalPssKb = Long.parseLong(m.group(1)); }

            m = totalRssLine.matcher(line);
            if (m.find()) { info.totalRssKb = Long.parseLong(m.group(1)); }

            m = totalSwapLine.matcher(line);
            if (m.find()) { info.totalSwapKb = Long.parseLong(m.group(1)); }

            // If any TOTAL line matched, skip fallback
            if (info.totalPssKb > 0 || info.totalRssKb > 0 || info.totalSwapKb > 0) continue;

            // Fallback: main detail table TOTAL row
            if (info.totalPssKb == 0 && line.matches("\\s+TOTAL\\s+\\d+.*")) {
                String[] parts = line.trim().split("\\s+");
                if (parts.length >= 2) {
                    try { info.totalPssKb = Long.parseLong(parts[1]); } catch (NumberFormatException ignored) {}
                }
            }
        }
        return info;
    }

    // ─── Heap dump ──────────────────────────────────────────────────────────────

    /**
     * Dump heap to the app's own external files dir (avoids SELinux/permission issues
     * with /data/local/tmp). The file path is passed to `am dumpheap` which tells the
     * target process to write there.
     *
     * If writing to app dir fails, falls back to /data/local/tmp then copies.
     */
    /**
     * Dump heap for a given PID. Tries multiple approaches:
     * 1. ActivityManager.dumpHeap() via reflection (works with DUMP permission)
     * 2. Shell `am dumpheap` command (works as shell UID or with SELinux permissive)
     */
    public static String dumpHeap(int pid, boolean withBitmaps, ProgressCallback callback) throws Exception {
        if (dumpDir == null) throw new Exception("No dump directory set");
        if (appContext == null) throw new Exception("Context not set — call setContext() first");

        String fileName = "ahat_" + pid + "_" + System.currentTimeMillis() + ".hprof";
        File dumpFile = new File(dumpDir, fileName);
        String dumpPath = dumpFile.getAbsolutePath();

        // Ensure dump dir is world-writable so target process can write
        dumpDir.mkdirs();
        dumpDir.setWritable(true, false);
        dumpDir.setReadable(true, false);
        dumpDir.setExecutable(true, false);

        callback.onProgress("Dumping PID " + pid + "\u2026");

        // Try 1: ActivityManager.dumpHeap() via reflection
        boolean requested = false;
        try {
            ActivityManager am = (ActivityManager) appContext.getSystemService(Context.ACTIVITY_SERVICE);
            // ActivityManager.dumpHeap(pid, managed, nativeDebuggable, dumpBitmaps, path, fd)
            // Hidden API: dumpHeap(int pid, boolean managed, boolean mallocInfo, boolean runGc,
            //              String path, ParcelFileDescriptor fd)
            // Simpler hidden API: IActivityManager.dumpHeap(pid, managed, nativeAlloc, path, fd)
            // But the simplest approach: use the public-ish profileControl or dumpHeap
            java.lang.reflect.Method dumpHeapMethod = null;
            for (java.lang.reflect.Method m : am.getClass().getDeclaredMethods()) {
                if ("dumpHeap".equals(m.getName())) {
                    dumpHeapMethod = m;
                    log("Found AM.dumpHeap: " + java.util.Arrays.toString(m.getParameterTypes()));
                    break;
                }
            }
            if (dumpHeapMethod != null) {
                dumpHeapMethod.setAccessible(true);
                Class<?>[] params = dumpHeapMethod.getParameterTypes();
                log("dumpHeap params: " + params.length);
                if (params.length == 6) {
                    // dumpHeap(String process, int userId, String path, ParcelFileDescriptor fd,
                    //          boolean managed, boolean mallocInfo)
                    // This is the newer signature
                    dumpHeapMethod.invoke(am, String.valueOf(pid), 0, dumpPath, null, true, false);
                    requested = true;
                } else if (params.length == 5) {
                    dumpHeapMethod.invoke(am, String.valueOf(pid), 0, dumpPath, null, true);
                    requested = true;
                }
                if (requested) log("AM.dumpHeap() invoked OK");
            }
        } catch (Exception e) {
            log("AM.dumpHeap() failed: " + e.getMessage());
        }

        // Try 2: shell `am dumpheap` command
        if (!requested) {
            String bmpFlag = withBitmaps ? "-b png " : "";
            String output = exec("am dumpheap " + bmpFlag + pid + " " + dumpPath);
            log("am dumpheap -> [" + output.trim() + "]");
            requested = true;
        }

        // Poll until file appears and size stabilizes
        long lastSize = -1;
        int stableCount = 0;
        for (int i = 0; i < 120; i++) {
            Thread.sleep(1000);
            callback.onProgress("Dumping\u2026 " + (i + 1) + "s");

            long size = dumpFile.exists() ? dumpFile.length() : 0;
            if (size <= 0) { stableCount = 0; lastSize = -1; continue; }
            if (size == lastSize) {
                if (++stableCount >= 3) break;
            } else {
                stableCount = 0;
                lastSize = size;
            }
        }

        if (lastSize <= 0) {
            try { log("Dir: " + execRaw("sh", "-c", "ls -la " + dumpDir.getAbsolutePath() + "/").trim()); }
            catch (Exception ignored) {}
            try { log("id: " + execRaw("sh", "-c", "id").trim()); }
            catch (Exception ignored) {}
            throw new Exception("Heap dump failed: file not created.\nPath: " + dumpPath
                    + "\nCheck log for details.");
        }

        dumpFile.setReadable(true, false);
        callback.onProgress("Done (" + formatSize(lastSize) + ")");
        log("Dump: " + dumpPath + " (" + formatSize(lastSize) + ")");
        return dumpPath;
    }

    // ─── File management ────────────────────────────────────────────────────────

    /** List dumps from app's external files dir. */
    public static List<HprofFile> listDumps() {
        List<HprofFile> result = new ArrayList<>();

        // Check app dir
        if (dumpDir != null) {
            addDumpsFromDir(dumpDir, result);
        }
        // Also check /data/local/tmp for legacy dumps
        addDumpsFromDir(new File("/data/local/tmp"), result);

        // Deduplicate by filename
        Set<String> seen = new HashSet<>();
        List<HprofFile> deduped = new ArrayList<>();
        for (HprofFile f : result) {
            if (seen.add(f.name)) deduped.add(f);
        }

        deduped.sort((a, b) -> Long.compare(b.lastModified, a.lastModified));
        return deduped;
    }

    private static void addDumpsFromDir(File dir, List<HprofFile> out) {
        File[] files = dir.listFiles((d, name) -> name.startsWith("ahat_") && name.endsWith(".hprof"));
        if (files == null) return;
        for (File f : files) {
            if (f.length() > 0) {
                out.add(new HprofFile(f.getAbsolutePath(), f.getName(), f.length(), f.lastModified()));
            }
        }
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
        if (Math.abs(kb) < 1024) return kb + " KB";
        return String.format("%.1f MB", kb / 1024.0);
    }

    public interface ProgressCallback { void onProgress(String message); }

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
